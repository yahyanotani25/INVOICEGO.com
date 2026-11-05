# Requirement → implementation checklist

**Legend**
- **Tested**: implemented and covered by automated tests (FBR mocked where it is involved).
- **Built**: implemented and checked manually (API calls or the browser).
- **Live FBR**: implemented, but behaviour against the real FBR gateway is not verified because no real token was available.
- **Partial**: only part of the requirement is implemented; the gap is described.
- **External**: depends on infrastructure, credentials or client confirmation.
- **Deferred**: excluded by the client ("Subscription abhi add nhi krni").

| # | Requirement | Implementation | Status |
|---|---|---|---|
| 1 | Read all 11 supplied files; import full datasets | `tools/extract/extract_sources.py` → `server/data/*.json`; `server/scripts/import-reference-data.ts` aborts if any dataset is incomplete | Tested (counts) |
| 1 | Review demo and videos | Demo reviewed (visual reference only; its pricing was not copied). Videos could **not** be retrieved (YouTube bot check); nothing from them was implemented | External |
| 2 | No subscriptions/payments | No pricing, checkout, countdown or payment statistics anywhere. `docs/DEFERRED_SCOPE.md` lists the deferred items. Invoice-level Payment Mode is kept | Built |
| 3 | Separate `/app` and `/admin` | Separate SPAs, cookies (`ig_session` on `/api`, `ig_admin` on `/api/admin`), CSRF tokens and guards | Tested |
| 3 | Admin `admininvoicego@gmail.com` via secure bootstrap | `scripts/admin-invite.ts` issues a one-time invite. Public registration with that email is refused. No default password | Tested |
| 3 | Relational DB, migrations, tenant isolation, decimal arithmetic, backend-only FBR calls, background jobs | Prisma/PostgreSQL migrations; `businessId` on every tenant query; `decimal.js` + NUMERIC; jobs via `SKIP LOCKED` worker | Tested |
| 4 | Responsive, accessible UI with tables, filters, pagination, states, confirmations, env badges, PKR formatting, PKT dates | `web/src/components/ui.tsx` and all pages | Built |
| 4 | No "FBR-certified/approved" claims | The landing page and sidebar state that InvoiceGO is not FBR-certified or approved | Built |
| 5 | Registration, email verification, sign-in/out, reset, sessions, statuses, roles, login history, audit | `modules/auth`, `plugins/auth.ts`, `AuditLog`, `LoginEvent` | Tested |
| 5 | Admin 2FA | Mandatory TOTP enrolment before any admin endpoint works | Tested |
| 5 | Business profile: NTN/CNIC/STRN (strings), address, province, multiple business natures, one sector, logo | Registration form + Settings → Business profile; logo upload checked by magic bytes | Built |
| 5 | Business-user 2FA | Not implemented (only administrator 2FA was required) | Partial |
| 6 | Current-month rule with the exact message; picker limits; server enforcement on create/edit/duplicate/Excel/sandbox/submit; recheck before submission; PKT; not rolling 30 days | `lib/time.ts` + every entry point; the date picker uses `min`/`max`; old drafts are blocked at submission | Tested |
| 7 | Dashboard counts, values, recent activity, integration status, scenario progress; sandbox kept separate | `/api/app/dashboard`, `Dashboard.tsx` | Built |
| 7 | Daily/monthly/quarterly/yearly reports; Sale Invoice vs Debit Note | `/api/app/reports/summary`, Excel export | Built |
| 8 | Invoice builder with every requested field, add/remove lines, saved products, preview, draft, validate, submit, responses, print | `InvoiceBuilder.tsx`, `InvoiceView.tsx` | Built |
| 8 | Invoice types | Sale Invoice and Debit Note only (the documented contract) | Built |
| 8 | Decimal-safe calculations; percent/fixed/composite/exempt/3rd Schedule; no universal further tax; no double discount; discrepancies shown, not overwritten | `fbr/calc.ts`, `docs/CALCULATIONS.md` | Tested |
| 9 | Exact payload names/order; scenarioId sandbox-only; YYYY-MM-DD; numeric types; string identifiers; app-only fields excluded; extraTax normalisation | `fbr/payload.ts` | Tested |
| 10 | Registered/Unregistered mismatch message with the buyer's name; highlighted field; blocks submission; single invoice + Excel; result stored; timeout ≠ unregistered; no invented names | `fbr/service.ts` (Get_Reg_Type), `checkBuyer` | Tested (mocked); Live FBR |
| 11 | Customers: add/view/edit/delete/save, search, filters, verification; accepted snapshots unaffected | `Customers.tsx`, `modules/customers` | Tested |
| 12 | Products: SKU, description, HS code, UOM, sale type, price; add/view/edit/delete | `Products.tsx`, `modules/products` | Tested |
| 12 | Full PCT/HS catalogue: code/description search, leading zeros, provenance, duplicates/alternates, reconciliation report | 7,494 codes; `HsCodes.tsx` + import report | Tested |
| 12 | Cascading FBR reference selections (HS→UOM, sale type→rate, rate→SRO, SRO→item) | Backend proxy with caching for all §5 endpoints exists (`/api/app/reference/:name`). The builder offers suggestion lists, and Lookups uses cached FBR UOM/sale-type/province data once fetched. **Fully cascading dropdowns driven by live FBR data are not wired into the builder yet** | Partial; Live FBR |
| 13 | Excel template; 20+ invoices with multiple items; grouping by import_ref; instructions; preview; row/field errors; bulk FBR validation; submit selected; progress; error report; no resubmission of accepted invoices; formula-injection safe | `modules/bulk`, `Bulk.tsx`, `BulkJob.tsx` | Tested |
| 14 | Separate sandbox/production URL, validation URL and token; connection test; status; last checked; encrypted, masked tokens; SSRF allow-list; no accidental cross-environment submission | `modules/fbrSettings`, `fbr/endpoints.ts`; the connection test calls the Provinces API and creates no invoice | Tested; Live FBR |
| 14 | Production endpoints | Explicit spec URLs (`postinvoicedata`, `validateinvoicedata`), editable within the allow-list. The "routing by token" note is flagged in `SOURCE_CONFLICTS.md` A1 | External (confirm) |
| 15 | Sandbox workspace: scenario selector, autofilled editable form + JSON with sync, reset, seller replacement, date normalisation, preview, validate/submit to the real sandbox, raw response, explanations, FBR number, attempt history, progress; success only on a genuine FBR response | `Sandbox.tsx`, `modules/sandbox` | Tested (mocked); Live FBR |
| 15 | No fabricated production tokens or IRIS status changes | No such code exists; the UI explains that IRIS issues tokens | Built |
| 16 | All 28 scenarios; readable labels vs exact API sale types; retailer-only SN026–28; SN009 purchase-type | `ScenarioDefinition` + templates | Tested |
| 17 | Applicability engine using the full matrix; multiple natures; dedupe; provenance; reasons; official IRIS assignment; conflicts flagged | `sandbox/applicability.ts` | Tested |
| 18 | Reference-data layer with cache timestamps and refresh | `fetchReference` with `ReferenceCache` (24 h TTL, `?refresh=1`) | Built; Live FBR |
| 18 | STATL | Endpoint is defined, but no feature uses STATL yet (registration checks use Get_Reg_Type) | Partial |
| 18 | All 86 sales and 22 purchase error codes with original text, guidance, field mapping, source; unknown errors preserved; HTTP vs business errors | `ErrorCode` table, `fbr/explain.ts`, `ErrorCodes.tsx` | Tested |
| 19 | Lifecycle Draft → Validating → Validated → Submitting → Accepted/Rejected/Reconciliation; changes invalidate validation; lock; exact payload snapshots; attempts stored; item results required; immutable accepted invoices; duplicate prevention; reconciliation workflow; no blind retry; month recheck | `invoices/service.ts` | Tested |
| 20 | A4 print/PDF with seller, buyer, items, taxes, totals, payment mode; FBR number + DI logo + QR only after acceptance; sandbox watermark; drafts carry no FBR number | `InvoicePrint.tsx`, `invoices/pdf.ts`, official logo from spec p.35 | Built |
| 20 | QR version 2 (25×25), 1×1 inch, no truncation | `invoices/qr.ts` encodes the FBR invoice number. The payload is an assumption: see `SOURCE_CONFLICTS.md` A7 | Tested; External (confirm payload) |
| 21 | Onboarding checklist, technical-contact details, server IP/hosting info, whitelisting status, CRM guidance; no IRIS/CRM passwords collected | `Onboarding.tsx`, `/api/app/onboarding`, `OUTBOUND_IPS` | Built |
| 21 | Stable outbound IP | Documented in `docs/DEPLOYMENT.md` §1 | External |
| 22 | Admin dashboard (no subscription/payment statistics) | `AdminDashboard.tsx` | Tested |
| 22 | User management: list, details, activate/deactivate, suspend/block, password reset, controlled deletion with retention | `AdminUsers.tsx`, admin routes | Built |
| 22 | Invoice oversight with sanitised responses, history and audited access; controlled retry | Admin invoices + `/retry` (only for not-delivered failures) | Built |
| 22 | FBR/PRAL monitoring: statuses, logs, failures, retry, response codes, server IP, usage | `AdminFbr.tsx` | Built |
| 22 | Reports and CSV/Excel export; business sales ≠ InvoiceGO revenue | `AdminReports.tsx` | Built |
| 22 | Support: complaints/messages/technical, replies, status, history, priority, query type, PDF ≤ 5 MB | `modules/support`, admin support | Tested |
| 22 | Notifications: registrations, failed FBR submissions, maintenance, announcements, support replies | In-app notifications and announcements. **Email delivery of these notifications is not implemented** (auth emails only) | Partial |
| 22 | System settings: name, company info, email (non-secret), API, invoice, backup, version | `AdminSettings.tsx`. A platform logo *upload* is not implemented (text only); SMTP secrets stay in environment variables | Partial |
| 22 | Security: 2FA, roles, login history, sessions, activity logs, protected backup/restore | Admin Security + Backups; restore is CLI-only | Built |
| 23 | Data model for every listed entity | `prisma/schema.prisma` | Built |
| 23 | Security controls: rate limits, secure cookies, CSRF, upload limits/types, redaction, no secrets in browser or localStorage | Fastify plugins, `REDACT`, CSRF in memory only | Tested |
| 23 | Business team invitations | Roles and permissions are enforced, but there is **no UI/API to invite additional team members** into a business yet | Partial |
| 24 | Acceptance criteria | See `docs/TESTING.md`. Anything that depends on real FBR acceptance is unverified until it is run with real credentials | Tested / Live FBR |
| 25 | Deployment guide, env example, static-IP guidance, admin bootstrap, backup/recovery, checklist, conflicts | `docs/DEPLOYMENT.md`, `server/.env.example`, `docs/SOURCE_CONFLICTS.md` | Built |
