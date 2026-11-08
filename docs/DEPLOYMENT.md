# Deploying InvoiceGO to invoicego.com

InvoiceGO is one Node.js 22 process. It serves the API (`/api/*`) and the built single-page app, and runs the background job worker. It needs PostgreSQL 14 or later (16 recommended). This guide covers a single production host with a **static outbound IP**, which FBR/PRAL IP whitelisting requires.

## 1. Infrastructure decisions (do these first)

| Need | Recommendation | Why |
|---|---|---|
| **Static egress IP** | A VM with a reserved/static public IPv4 (e.g. AWS EC2 + Elastic IP, Azure VM + static public IP, GCP + static external IP, or a Pakistani data-centre VPS with a fixed IP). If the app runs behind NAT, use a NAT gateway with a fixed Elastic IP. | Businesses must whitelist the IP that FBR sees (DI User Manual §4.1.1). Serverless or auto-scaling platforms with changing egress IPs **will not work** without a fixed-IP NAT. |
| Hosting company / country | Record the exact values in `HOSTING_COMPANY` / `HOSTING_COUNTRY`. | IRIS asks for both. They are shown to businesses on the onboarding page. |
| Database | Managed PostgreSQL 16, or PostgreSQL on the same VM with automated backups. | |
| TLS | nginx or Caddy in front of port 8080, with Let's Encrypt certificates for `invoicego.com` and `www.invoicego.com`. | Cookies are `Secure`, so HTTPS is mandatory. |
| Email | Any SMTP provider (SES, Mailgun, Postmark, your mail host). | Needed for email verification, password reset and admin invitations. |

After the VM is provisioned, confirm the egress IP from the server itself:

```bash
curl -s https://api.ipify.org
```

Put that value into `OUTBOUND_IPS`. The admin panel's *FBR / PRAL monitoring → Detect current egress IP* shows the same check.

> Each business whitelists the InvoiceGO server IP(s) in its own IRIS account (1–3 IPs in the form, or an `.xls` upload ≤ 1 MB). PRAL normally approves within about 2 working hours. If you later change the IP, **every business must re-whitelist**. Plan IP changes carefully.

## 2. DNS

- `A invoicego.com → <static IP>` and `A www.invoicego.com → <static IP>` (or a CNAME for www).

## 3. Install (VM, no containers)

```bash
sudo apt-get install -y nodejs npm postgresql-16 postgresql-client-16 nginx
```

```bash
sudo -u postgres createuser --pwprompt invoicego
```

```bash
sudo -u postgres createdb -O invoicego invoicego
```

```bash
git clone https://github.com/yahyanotani25/INVOICEGO.com.git /opt/invoicego && cd /opt/invoicego
```

```bash
cp server/.env.example server/.env && chmod 600 server/.env
```

Edit `server/.env`. See `server/.env.example`, where every variable is documented. Generate the two keys:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Use separate values for `DATA_ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY`. **Store copies of both keys outside the server** (in a password manager or vault). Without `DATA_ENCRYPTION_KEY`, the saved FBR tokens cannot be decrypted. Without `BACKUP_ENCRYPTION_KEY`, backups cannot be restored.

Build, migrate and import the reference data:

```bash
npm run install:all && npm run build
```

```bash
cd server && set -a && . ./.env && set +a && npx prisma migrate deploy
```

```bash
node dist/scripts/import-reference-data.js
```

The import is idempotent and refuses to run if any dataset is incomplete. Expected output: 28 scenarios, 28 templates, 104 applicability rows, 108 error codes, 7,494 HS codes.

### systemd unit (`/etc/systemd/system/invoicego.service`)

```ini
[Unit]
Description=InvoiceGO
After=network-online.target postgresql.service

[Service]
WorkingDirectory=/opt/invoicego/server
EnvironmentFile=/opt/invoicego/server/.env
ExecStart=/usr/bin/node dist/src/index.js
Restart=always
User=invoicego
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/var/lib/invoicego

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now invoicego
```

### nginx

```nginx
server {
  listen 443 ssl http2;
  server_name invoicego.com www.invoicego.com;
  ssl_certificate     /etc/letsencrypt/live/invoicego.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/invoicego.com/privkey.pem;
  client_max_body_size 6m;               # 5 MB uploads + multipart overhead
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;             # FBR calls can take up to the configured response timeout
  }
}
server { listen 80; server_name invoicego.com www.invoicego.com; return 301 https://invoicego.com$request_uri; }
```

Set `TRUST_PROXY=true` so client IPs in audit and login logs are correct.

## 4. Containers (alternative)

`Dockerfile` builds one image that contains the API, the SPA and `pg_dump` 16. `docker-compose.example.yml` shows the app with PostgreSQL. The container runs `prisma migrate deploy` on start. Run the reference import once:

```bash
docker compose exec app node dist/scripts/import-reference-data.js
```

The **host's** egress IP is what FBR sees. The static-IP requirement still applies.

## 5. Secure administrator bootstrap

No administrator exists by default and no default password exists anywhere. Public registration can never grant admin rights, and the address `admininvoicego@gmail.com` is blocked from public registration.

```bash
cd /opt/invoicego/server && set -a && . ./.env && set +a && node dist/scripts/admin-invite.js --email admininvoicego@gmail.com --role SUPER_ADMIN
```

- With SMTP configured, the one-time link (valid 24 hours) is emailed. Otherwise it is printed to the terminal; deliver it over a secure channel.
- The administrator opens `https://invoicego.com/admin/accept-invite?token=…` and sets a password of at least 12 characters.
- At first sign-in at `/admin/login`, TOTP two-factor enrolment is **mandatory** (Google Authenticator, Microsoft Authenticator, 1Password and similar apps). No admin endpoint works until 2FA is verified.
- Further administrators are invited from *Admin → Security* with the roles SUPER_ADMIN, ADMIN, SUPPORT or AUDITOR.
- To recover an administrator who lost their authenticator, re-run the CLI for that email. This issues a new invitation and resets the password and 2FA.

## 6. Backups and recovery

- **Encrypted logical backups**: `pg_dump --format=custom` → AES-256-GCM. The file layout is `IGBK1 | IV | ciphertext | tag`.
  - From the CLI: `node dist/scripts/backup.js`
  - From *Admin → Backups* (SUPER_ADMIN).
- Schedule a nightly backup and copy the files **off the server**. Example cron (02:15 PKT = 21:15 UTC):

  ```bash
  15 21 * * * cd /opt/invoicego/server && set -a && . ./.env && set +a && node dist/scripts/backup.js >> /var/log/invoicego-backup.log 2>&1
  ```

  ```bash
  30 21 * * * rclone copy /var/lib/invoicego/backups remote:invoicego-backups --max-age 48h
  ```

- **Restore** is deliberately CLI-only. Restore into a **new** database, verify it, then switch `DATABASE_URL`:

  ```bash
  createdb -O invoicego invoicego_restore
  ```

  ```bash
  BACKUP_ENCRYPTION_KEY=... node dist/scripts/restore.js --file /var/lib/invoicego/backups/invoicego-<stamp>.dump.enc --target-url postgresql://invoicego:...@127.0.0.1:5432/invoicego_restore --confirm
  ```

  The GCM authentication tag is checked before anything is restored, so a tampered or corrupted file is rejected.
- Also keep your managed-database provider's point-in-time recovery enabled if you use one.
- **Retention**: invoices, FBR attempts, snapshots and audit logs are never deleted by the application. "Deleting" a user anonymises personal data and keeps financial and audit records. Set the backup retention (Admin → Settings → Backup) to match your legal record-keeping obligations.
- **Test a restore** at least quarterly.

## 7. Upgrades

```bash
cd /opt/invoicego && git pull && npm run install:all && npm run build
```

```bash
cd server && set -a && . ./.env && set +a && npx prisma migrate deploy && node dist/scripts/import-reference-data.js
```

```bash
sudo systemctl restart invoicego
```

Take a backup before every upgrade. When the server restarts, the stale-lock sweeper marks any invoice left in *Submitting* as **Reconciliation required**; it never resends automatically.

### Dependency security advisories

Check with `npm audit --omit=dev` in `server/` and `web/` before each release.

On 2026-11-08, `fastify` (5.12.8), `undici` (7.30.2), `@fastify/static` (10.1.10), `nodemailer` (10.4.0) and `react-router-dom` (6.30.6) were upgraded to clear their published advisories. All 154 server tests passed afterwards.

These advisories remain open, because each fix needs a major-version migration that should be planned and tested on its own:

| Package | Why it is still open | Exposure in InvoiceGO |
|---|---|---|
| `prisma` / `@prisma/client` 6 → 7 | Advisories are in the Prisma CLI's configuration tooling (`effect`, `deepmerge-ts`). Prisma 7 requires driver adapters and a `prisma.config.ts`. | Build-time tooling only; not reachable from requests. |
| `zod` 3 → 4 | Memory exhaustion when validating oversized constrained collections. | Limited: request bodies are capped by Fastify's body limit and upload size limits. |
| `react-router-dom` 6 → 7 | Open redirect via backslash paths in `<Link>`/`navigate`, and an SSR-only issue. | The only user-supplied navigation target (`?next=` after login) is restricted to `/app` paths. InvoiceGO does not use SSR. |
| `exceljs` (via `uuid`) | npm's suggested "fix" is a downgrade to exceljs 3, which is not acceptable. | The advisory needs a caller-supplied output buffer with uuid v3/v5/v6; InvoiceGO does not call `uuid` itself. |

## 8. Key rotation

1. Set `DATA_ENCRYPTION_KEY_PREVIOUS` to the old key and `DATA_ENCRYPTION_KEY` to the new one, then restart. Both keys can now decrypt.
2. Ask businesses to re-save their FBR tokens (re-saving encrypts with the new key). Administrators can re-enrol 2FA through a CLI re-invite.
3. Once everything is re-encrypted, remove `DATA_ENCRYPTION_KEY_PREVIOUS`.

## 9. Production checklist

- [ ] HTTPS works; `COOKIE_SECURE=true`; `TRUST_PROXY=true` behind the proxy.
- [ ] `DATA_ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY` are generated, and copies are stored offline.
- [ ] SMTP is configured and a test email arrives (registration verification).
- [ ] `OUTBOUND_IPS` is set to the verified static egress IP; `HOSTING_COMPANY` and `HOSTING_COUNTRY` are set.
- [ ] `FBR_ALLOW_TEST_ORIGINS` is **unset** (startup refuses it in production).
- [ ] The reference data import reports the expected counts.
- [ ] The administrator is bootstrapped through the CLI and has enrolled 2FA.
- [ ] Nightly encrypted backups run, are copied off-host, and a restore has been tested.
- [ ] Logs are shipped and rotated. Tokens, cookies, CSRF tokens and passwords are redacted by the logger.
- [ ] A real business has completed IRIS onboarding, whitelisted the IP and passed its sandbox scenarios **with real credentials** before production is enabled for it.
