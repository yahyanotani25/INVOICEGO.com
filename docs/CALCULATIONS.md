# Invoice calculations

All amounts use `decimal.js` in the application and `NUMERIC` in PostgreSQL. No floating-point arithmetic is used. JSON requests carry exact decimal literals (`server/src/fbr/payload.ts`).

## Automatic mode (invoice builder and Excel uploads)

Per item (`server/src/fbr/calc.ts`):

| Field | Rule |
|---|---|
| Gross | `quantity × unitPrice` |
| `discount` | The amount entered for the line. It is deducted **once**, here, and never again. |
| `valueSalesExcludingST` | `gross − discount` |
| `fixedNotifiedValueOrRetailPrice` | `retailPricePerUnit × quantity` when a per-unit retail price is entered; otherwise the value entered |
| `salesTaxApplicable` | Depends on the parsed rate (see below) |
| `totalValues` | `valueSalesExcludingST + salesTaxApplicable + furtherTax + extraTax + fedPayable` |

Rates are strings (`ratE_DESC`, reference API §5.8) and are parsed (`server/src/fbr/rate.ts`):

| Rate kind | Example | Sales tax |
|---|---|---|
| Percent | `18%`, `1.43%`, `0%` | `valueSalesExcludingST × rate%`. For **Third Schedule** sale types the base is the retail value: `fixedNotifiedValueOrRetailPrice × rate%`. |
| Fixed per unit | `Rs.3 per unit`, `Rs.200/unit` | `quantity × amount` |
| Composite | `18% + Rs.60/kg`, `18% along with rupees 60 per kilogram` | `valueSalesExcludingST × rate% + quantity × amount` |
| Exempt | `Exempt` | `0` |
| Unknown | anything else (e.g. `DTRE`) | **Not calculated.** The user enters the amount and a warning is shown. |

- **Further tax**: never applied automatically. A business may set an optional helper percentage in Settings. The builder then offers a one-click suggestion for unregistered buyers, but nothing is applied by default.
- **Withholding**: `salesTaxWithheldAtSource` is reported but not deducted from the invoice total. FBR error 0008 requires it to be 0 or equal to the sales tax, and a warning is shown otherwise.
- **Totals**:
  - *Grand total (gross invoice value)* = Σ `totalValues`.
  - *Net receivable* = grand total − Σ ST withheld.
  - These two are shown separately and never mixed.
- **Rounding**: full precision internally; ROUND_HALF_UP to 2 decimals per line amount; quantity kept to 4 decimals.

## Manual mode (supplied sandbox scenario examples, special cases)

Values are sent **exactly as entered**. The general formula is still computed, and every difference is shown as a warning, for example: "Sales tax: entered 145.00, general formula gives 180.00 (kept as entered — review)". Supplied examples are never silently overwritten. Several of them do not follow a single formula; see `docs/SOURCE_CONFLICTS.md` B2–B3.

## Unresolved points (need FBR/PRAL confirmation)

- Whether `valueSalesExcludingST` is before or after discount (InvoiceGO: after; see B1).
- The meaning of `fixedNotifiedValueOrRetailPrice` for fixed-per-unit rates (B3).
- The treatment of `extraTax` when FBR requires it to be "empty" (A4). An explicit per-item option sends `""`.
