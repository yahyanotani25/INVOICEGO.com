# InvoiceGO — Implementation Plan

Scope: a production-oriented FBR Digital Invoicing web application for Pakistani
businesses, deployed at invoicego.com. **Subscriptions and platform payments are
out of scope for this release** (client: "Subscription abhi add nhi krni") — see
[DEFERRED_SCOPE.md](DEFERRED_SCOPE.md).

## Sources read (all 11 files in the supplied Drive folder)

| File | Used for |
|---|---|
| DETAILS.docx (text + 4 embedded screenshots) | Invoice/buyer/item field layout, Excel bulk upload, Registered/Unregistered mismatch errors, customer/product actions, FBR integration settings, autofilled editable scenarios, admin panel modules, admin email |
| FBR API DOCUMENTATUIN (2).pdf — *Technical Specification for DI API v1.12 (24-Jul-2025)* | Endpoints, payloads, field rules, responses, reference APIs, QR/logo, error codes, scenarios, applicability matrix |
| SANDBOX SIMPLE JASON FORMAT.docx | Generic sandbox template + production sample |
| Scenario Data.docx | 28 scenario JSON examples |
| Scenarios for Sandbox Testing / Applicable Scenarios / Sales Error Codes / Purchase Error Codes PDFs | Verified to be byte-for-byte text extracts of spec pages 36–51 (no extra data) |
| USER MANUAL.pdf — *DI User Manual v1.5* | IRIS onboarding, technical details, IP whitelisting, sandbox→production, dashboard, reattempt after connection loss, CRM |
| PCT Codes (1).docx, HS CODE WITH DISCRIPTION.pdf | PCT/HS catalogue (same 7,494 unique codes in both) |

Reference-only: the demo site (visual/workflow reference; its pricing/subscription
content is deliberately **not** reproduced). The two YouTube videos could not be
retrieved from the build environment (YouTube bot-check); **no video-specific
behaviour has been incorporated**.

## Architecture

```
invoicego/
  server/   Fastify 5 + TypeScript + Prisma (PostgreSQL 16) — API, FBR integration, jobs
  web/      React 18 + Vite + Tailwind — public site, /app (business users), /admin (platform admins)
  server/data/   Committed datasets extracted from the supplied documents (+ provenance)
  tools/extract/ Reproducible extraction scripts (pandoc + pdfplumber)
  docs/          Plan, conflicts, deployment, checklist
```

* One Node process serves the API (`/api/*`) and the built SPA. A DB-backed job
  runner (`SELECT … FOR UPDATE SKIP LOCKED`) executes bulk validation/submission.
* All FBR traffic is server-side; tokens are AES-256-GCM encrypted at rest and
  never reach the browser, URLs, analytics or logs.
* Sessions are opaque random tokens (SHA-256 hashed in DB) in `HttpOnly; Secure;
  SameSite=Lax` cookies; separate cookies and session kinds for `/app` and `/admin`;
  CSRF token required on every state-changing request.
* Admin access is granted only via a server-side bootstrap/invitation CLI.
  Admins must enrol TOTP 2FA before any admin action.
* Money uses `decimal.js` end-to-end and PostgreSQL `NUMERIC`; JSON payloads are
  serialised with exact decimal literals (no float conversion).
* Business-date rules use trusted server time in `Asia/Karachi`; timestamps are
  stored in UTC.

## Build stages

1. **Source extraction** → `server/data/*.json` (scenarios, 28 templates with raw
   text, full applicability matrix with gaps/anomalies, all sales & purchase error
   rows, PCT/HS catalogue with continuation merges and a reconciliation report,
   official DI logo image).
2. **Core server**: schema + migrations, config, crypto, Karachi current-month rule,
   rate parser + calculation engine, FBR payload serializer (sandbox vs production),
   response classifier, FBR HTTP client with host/path allow-list (SSRF guard),
   auth/session/CSRF/rate-limit, audit log, job runner.
3. **User modules**: business profile & onboarding, customers, products, HS search,
   invoice builder lifecycle (Draft → Validating → Validated → Submitting →
   Accepted / Rejected / Reconciliation Required), buyer registration verification,
   sandbox workspace + applicability engine, FBR settings, Excel bulk upload,
   dashboard/reports, support tickets, notifications, A4 print/PDF with QR + logo.
4. **Admin modules**: dashboard, users, invoice oversight, FBR/PRAL monitoring,
   reports & exports, support, announcements/notifications, settings, security,
   backups.
5. **Frontend** for all of the above.
6. **Tests**: unit (date rule incl. month/year rollover & PKT boundaries, decimal
   calc, payload, response classification, applicability, Excel parsing, catalogue
   import) + integration against real PostgreSQL with a **mock** FBR HTTP server
   (labelled as mocked — not evidence of FBR acceptance).
7. **Docs**: deployment for invoicego.com, env vars, outbound static IP &
   whitelisting, admin bootstrap, backup/restore, requirement checklist, conflicts.

Conflicts and missing data are tracked in [SOURCE_CONFLICTS.md](SOURCE_CONFLICTS.md).
