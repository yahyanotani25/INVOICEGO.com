# InvoiceGO

FBR Digital Invoicing web application for Pakistani businesses, intended for **invoicego.com**. It is built against PRAL's *Technical Specification for DI API v1.12* and the *DI User Manual v1.5* supplied by the client.

> InvoiceGO is independent software. It is **not** FBR-certified, FBR-approved or an FBR-licensed integrator.
> Subscriptions and payments are **deferred** by the client's instruction (see `docs/DEFERRED_SCOPE.md`).

## What's inside

```
server/   Fastify + TypeScript + Prisma (PostgreSQL). API, FBR integration, background jobs.
web/      React + Vite + Tailwind single-page app: public site, /app (businesses), /admin (platform).
server/data/      Datasets extracted from the supplied documents (with provenance).
tools/extract/    Reproducible extraction script (pdfplumber).
docs/             Plan, source conflicts, deployment, calculations, testing, requirement checklist.
```

Key behaviours:

- **Current-month invoicing only.** Dates are checked in Asia/Karachi on the client and on the server, with the exact message "You can't create future or previous month invoices".
- **Exact FBR payloads.**
  - Uses the property names from the specification.
  - Sandbox requests include `scenarioId`; production requests omit it.
  - Decimal values are sent as exact literals.
- **Careful submission.**
  - A request is accepted only when the header and every item are Valid; HTTP 200 alone is never treated as success.
  - Submissions are locked against duplicates.
  - Exact payload snapshots are kept.
  - Uncertain outcomes go to a **reconciliation** workflow instead of being resent blindly.
- **Buyer registration check** (Get_Reg_Type), with "<Buyer> is Registered. Please select Registered." style messages. A lookup failure is never treated as "unregistered".
- **Sandbox workspace** for all 28 supplied scenarios.
  - Each scenario opens as an editable form or as JSON.
  - Scenarios are checked against the full applicability matrix.
  - A scenario is marked passed only after a genuine FBR sandbox acceptance.
- **Excel bulk upload** (20+ multi-item invoices): preview, row-level errors, FBR validation and selective submission.
- **Teams and account security.**
  - Owners invite team members by email with a role (Admin, Accountant, Operator, Viewer).
  - Optional two-factor sign-in for business users, with recovery codes.
  - Notification emails (when SMTP is configured), which each user can switch off.
- **Official FBR lists in the invoice builder**: sale type → rate → SRO → SRO item and HS → UOM, from FBR's reference APIs; STATL active status for registered buyers.
- **Admin console.**
  - Admins are created by invitation only and must use mandatory TOTP two-factor authentication.
  - Covers users, invoice oversight, FBR monitoring, reports and exports, support, announcements, settings, security and encrypted backups.

## Quick start (development)

Requirements: Node 22 and PostgreSQL 16.

```bash
npm run install:all
```

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:
- Set `DATABASE_URL`.
- Generate the two keys.
- For local HTTP, set `NODE_ENV=development` and `COOKIE_SECURE=false`.

```bash
cd server && npx prisma migrate deploy && npx tsx scripts/import-reference-data.ts
```

```bash
cd server && npx tsx src/index.ts
```

```bash
cd web && npx vite
```

Open http://localhost:5173. The API proxies to :8080. Without SMTP, development emails (verification links) are written to the server log.

Bootstrap the administrator:

```bash
cd server && npx tsx scripts/admin-invite.ts --email admininvoicego@gmail.com --role SUPER_ADMIN
```

## Production

- **Vercel (recommended if the repo is connected to Vercel):** [docs/VERCEL.md](docs/VERCEL.md). It covers the Neon database, environment variables, first-admin setup, the static outbound IP and the custom domain.
- **VM or containers:** see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. It covers:
  - the static outbound IP needed for IRIS whitelisting;
  - TLS and the systemd/nginx or container setup;
  - secure admin bootstrap;
  - encrypted backups and CLI-only restore;
  - upgrades and key rotation.

```bash
npm run build && npm start
```

## Tests

```bash
cd server && npx vitest run
```

167 tests pass. FBR is **mocked** in the automated tests; see [docs/TESTING.md](docs/TESTING.md) for what this does and does not prove, and how to verify against the real sandbox.

## Documents

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Source conflicts, missing data and external dependencies](docs/SOURCE_CONFLICTS.md)
- [Requirement checklist](docs/REQUIREMENTS_CHECKLIST.md)
- [Calculations](docs/CALCULATIONS.md)
- [Deferred scope (subscriptions)](docs/DEFERRED_SCOPE.md)
