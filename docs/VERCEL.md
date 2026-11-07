# Deploying InvoiceGO on Vercel

The repository deploys to Vercel as-is:

- `vercel.json` builds the single-page app (`web/dist`) and the API.
- The API is a single Node.js function, `api/index.js`, that runs the same Fastify app used on a VM.
- `scripts/vercel-build.mjs` compiles everything. When a database is connected, it also runs the Prisma migrations and the reference-data import (28 scenarios, 104 applicability rows, 108 error codes, 7,494 HS codes) over the **direct** connection.

This was verified with an offline `vercel build` (Vercel CLI 64.7.0) from a clean clone. The bundled function was then exercised in production mode against PostgreSQL: registration, admin bootstrap with TOTP, invoices, PDF and Excel all worked. It has **not** yet been deployed to a real Vercel account, because that needs the account owner.

## Before you start: plan and network facts

| Topic | What it means for InvoiceGO |
|---|---|
| **Plan** | Vercel's Hobby plan is for personal, non-commercial use only. InvoiceGO is a commercial service, so use **Pro**. |
| **Function time** | Each request can run for up to 300 s (Hobby and Pro default). Bulk FBR runs are processed in slices of that size, driven by the open bulk-upload page. Keep that page open while a bulk run is in progress. |
| **Cron** | `vercel.json` schedules `/api/cron/maintenance` daily (02:17 PKT). This is allowed on every plan. On Pro you may change it to every few minutes (e.g. `*/5 * * * *`) so unfinished bulk runs continue even if nobody keeps the page open. |
| **Static outbound IP for FBR** | Vercel functions have no fixed outbound IP unless you buy Vercel **Static IPs** (Pro add-on). Businesses must whitelist the IP that FBR sees. Choose **one** of the two options in step 6. |
| **Backups** | `pg_dump` cannot run inside Vercel functions. Use your database provider's backups (Neon point-in-time restore and branches), or run `scripts/backup.ts` from another machine. |
| **Email** | Without SMTP, registration still works, but administrators must activate new accounts manually (Admin → Users → Activate). Configure SMTP for automatic verification and password-reset emails. |

## Step 1: Import the repository

1. In Vercel, go to **Add New → Project** and import `yahyanotani25/INVOICEGO.com`. If it is already connected, open that project.
2. **Framework preset:** Other. **Root directory:** `./`. Leave the build and output settings empty; `vercel.json` provides them.
3. **Settings → Git → Production Branch:** use the branch that holds this code (currently `claude/brave-dirac-j6hdgf`), or merge it into your production branch first.

## Step 2: Create the database (Neon Postgres)

**Storage → Create Database → Neon (Postgres) → Connect** to the project, for all environments.

This adds `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct). InvoiceGO uses the pooled URL at runtime and the direct URL for migrations. The variable names of Vercel Postgres, Supabase and plain `DIRECT_URL` are also accepted.

## Step 3: Environment variables

Set these under **Settings → Environment Variables** (Production; also Preview if you use previews).

| Variable | Value | Required |
|---|---|---|
| `DATA_ENCRYPTION_KEY` | 32 random bytes, base64. **Keep a copy offline** — without it, saved FBR tokens cannot be decrypted. | Yes |
| `ADMIN_BOOTSTRAP_TOKEN` | A long random string (24+ characters). Used once in step 5, then deleted. | For the first admin |
| `CRON_SECRET` | A long random string. Vercel sends it automatically to the cron endpoint. | Recommended |
| `APP_BASE_URL` | `https://invoicego.com` once the domain is attached. Defaults to the Vercel production URL. | Recommended |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Any SMTP provider. For example, Resend: `smtp.resend.com`, `465`, `true`, `resend`, `<API key>`, `InvoiceGO <no-reply@invoicego.com>` (after verifying the domain with the provider). | Recommended |
| `FBR_PROXY_URL` | `http://user:pass@host:port` of a static-IP proxy (option B in step 6). | Option B only |
| `OUTBOUND_IPS`, `HOSTING_COMPANY`, `HOSTING_COUNTRY` | The static IP(s) FBR will see, and the hosting details businesses enter in IRIS. | Yes, for FBR |

Generate random values with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

You do not need to set `NODE_ENV`, `COOKIE_SECURE` or `TRUST_PROXY`. Vercel sets `NODE_ENV=production`, and the other two default correctly on Vercel.

## Step 4: Deploy

Open **Deployments → Redeploy** (or push a commit). The build log should show `prisma migrate deploy`, followed by `Reference data imported: { scenarios: 28, … hsCodes: 7494 … }`.

Then check `https://<your-project>.vercel.app/api/health`. It should return `{"ok":true,"db":"ok","referenceData":true,…}`.

If the API answers `SERVER_NOT_CONFIGURED`, the message names the missing variable. Add it and redeploy.

## Step 5: Create the first administrator

1. Open `https://<your-domain>/admin/setup`.
2. Enter the `ADMIN_BOOTSTRAP_TOKEN`, your name and a password of at least 12 characters. The account is `admininvoicego@gmail.com`.
3. Sign in at `/admin/login` and scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password). Two-factor authentication is mandatory.
4. **Delete `ADMIN_BOOTSTRAP_TOKEN`** from the environment variables and redeploy. Setup closes automatically once an administrator exists; deleting the token removes the endpoint entirely.

Invite other administrators from **Admin → Security**.

## Step 6: Static outbound IP for FBR (choose one)

- **A. Vercel Static IPs** (Pro add-on): enable it in project settings, then copy the assigned IPs into `OUTBOUND_IPS`.
- **B. Static-IP proxy** (e.g. QuotaGuard Static or Fixie): set `FBR_PROXY_URL` to the proxy URL and `OUTBOUND_IPS` to the proxy's static IPs. Only FBR traffic uses the proxy.

Then verify from **Admin → FBR / PRAL monitoring → Detect current egress IP**. That check goes through the same path as FBR calls.

Each business enters these IPs in IRIS (Digital Invoicing → API Integration → IP Whitelisting) and waits for PRAL approval before its sandbox token will work.

## Step 7: Custom domain `invoicego.com`

1. Go to **Settings → Domains** and add `invoicego.com` and `www.invoicego.com`.
2. At the domain registrar, remove the current parking/forwarding records.
3. Add **exactly** the records Vercel's domain card shows: an A record for the apex and a CNAME for `www`. Vercel now assigns project-specific values, so copy them from the card.
4. Wait for Vercel to show **Valid configuration**. Then set `APP_BASE_URL=https://invoicego.com` and redeploy.

## After going live

- Register a real business and complete the IRIS steps on the **Onboarding** page.
- Save its sandbox token under **FBR integration**, run the required scenarios, then add the production token from IRIS.
- Turn on Neon's backups and point-in-time restore. Test a restore into a Neon branch periodically.
