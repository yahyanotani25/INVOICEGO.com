# Deferred Scope (not implemented in this release)

The client explicitly instructed: **"Subscription abhi add nhi krni."** (Do not add subscriptions yet.)

The following items appear in the older client document (DETAILS.docx, admin panel sections
1, 2, 3, 6, 7, 9, 10) and are recorded here as **future scope only**. None of them is
implemented, exposed in navigation, or enforced anywhere in the application.

| Area | Deferred item |
|---|---|
| Subscription management | Monthly subscription; 30-day countdown per user; activation/deactivation; expiry date; renewal |
| Payments | Payment list; successful / pending / failed payments; payment methods; verification; history |
| Gateway | Easypaisa or any other payment gateway; checkout; payment gateway settings |
| Dashboard | "Expired subscriptions", "Total revenue", "Monthly revenue" (platform revenue) |
| Reports | Active/expired subscription reports; monthly platform sales/revenue |
| Notifications | Subscription expiry alerts; payment received |
| Marketing | Pricing plans, pricing tables, "PKR 5,000/month" messaging |
| Access control | Paid-account activation; subscription-expiry restrictions |

What **is** retained:

* The invoice-level **Payment Mode** field (how a buyer pays an invoice). It has nothing to
  do with platform subscriptions and is never sent to FBR.
* Reports of each business's **invoice sales values** are labelled as the business's sales.
  They are not InvoiceGO revenue.
