# Testing

## Automated tests (server)

```bash
createdb -O invoicego invoicego_test
```

```bash
cd server && npx vitest run
```

The tests use a separate `invoicego_test` database; `test/global-setup.ts` migrates it and imports the reference data. Current result: **20 files, 154 tests passing**.

| Area | File(s) |
|---|---|
| Current-month rule: Karachi timezone boundaries, month and year rollover, calendar month (not a rolling 30 days), exact message | `time.test.ts`, `int-invoice.test.ts` |
| Rate parsing and exact decimal calculations | `calc.test.ts` |
| Payload: exact key names and order; sandbox includes `scenarioId`, production omits it; exact decimal literals; leading zeros | `payload.test.ts` |
| Response classification using the spec's sample bodies (HTTP 200 is never enough) | `response.test.ts` |
| Applicability engine over the full 104-row matrix, the client's examples, retailer-only rule, official IRIS override | `applicability.test.ts` |
| Scenario template preparation and the JSON → invoice parser | `prepare.test.ts` |
| Excel: 25 multi-line invoices, repeated-header mismatch, formula rejection, leading zeros, month rule, error report escaping | `excel.test.ts`, `int-bulk.test.ts` |
| QR version 2 (25×25) and refusal to truncate; FBR URL allow-list (SSRF) | `qr-endpoints.test.ts` |
| Reference data counts (28 / 28 / 104 / 86+22 / 7,494) | `reference-data.test.ts` |
| Auth, email verification, reserved admin email, CSRF, sessions, admin MFA enforcement | `int-auth.test.ts` |
| Tenant isolation across invoices, customers, products, import jobs, tickets, attachments | `int-tenant.test.ts` |
| Validate → submit → accepted; immutability; duplicate-submission lock; reconciliation; uncertain outcomes; tokens never exposed | `int-invoice.test.ts`, `int-network.test.ts` |
| Malformed input returns 4xx, not 500 | `int-input.test.ts` |
| Regressions (no-token validate keeps the state; PKT report grouping; invite link fallback) | `int-regressions.test.ts` |
| Serverless hosting: bulk runs sliced across requests with no duplicate FBR calls, browser-driven `/process`, orphan re-queue, env-token admin bootstrap, health, cron secret | `int-serverless.test.ts` |
| Email unavailable: registration still succeeds; admin activation verifies the account | `int-mail-unavailable.test.ts` |
| Hosted Postgres URL handling (Neon pooled/direct variables) | `dburl.test.ts` |

### Important: what the automated tests do NOT prove

**All FBR interactions in the automated tests are MOCKED.** `test/mockFbr.ts` is a local HTTP server that returns the response shapes documented in the spec. The tests prove InvoiceGO's own behaviour: payload construction, outcome classification, locking, reconciliation and tenant isolation. They are **not** evidence that FBR will accept a given invoice.

## Live sandbox verification (manual, needs real credentials)

This has **not** been performed during development: no real sandbox token was available. The only live call made was a connection test with a placeholder token, which FBR correctly rejected with HTTP 401. To verify live:

1. Register a business with its real NTN/CNIC and the business nature and sector selected in IRIS.
2. Whitelist the server's static IP in IRIS and wait for PRAL approval.
3. Paste the IRIS sandbox token under **FBR integration → Sandbox** and click **Verify connection**. You should get HTTP 200 from the Provinces API.
4. Open **Sandbox scenarios**. For each required scenario: load it, adjust it if needed, then **Validate & submit to sandbox**.
5. A scenario is recorded as passed only when FBR returns a Valid header, Valid results for every item, and an invoice number. Compare with the scenario status shown in IRIS.
6. After IRIS issues the production token, save it under **Production**, verify the connection, and enable production.

## Frontend

```bash
cd web && npx tsc --noEmit && npx vite build
```

The UI was exercised manually in Chromium (Playwright): login, dashboard, invoice builder (the previous-month date shows the exact error immediately), sandbox workspace, print layout, FBR settings, and the admin invite → set password → TOTP enrolment → dashboard flow. There are no automated browser tests yet.
