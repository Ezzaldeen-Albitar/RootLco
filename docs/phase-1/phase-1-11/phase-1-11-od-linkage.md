# Phase 1-11 — Open-Decision Linkage

How the P1-11 database holds the open decisions and dependencies (P1-OD-007/023/024/042,
DEP-07/11) as **configuration** rather than inventing owner-reserved values. Every open
point is either a configuration column with a documented default posture or a deferred
contract; none is hard-coded to a value a founder has not approved.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

| Decision  | Question                                                     | How P1-11 holds it                                                                                                                                                                                          | Status            |
| --------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| P1-OD-007 | Jurisdiction / currency / tax defaults (OIR-04)              | No currency/tax figure invented. `currency_code` is an FK to `shared.currencies`; tax reuses `org.tax_classes`; money is `NUMERIC(18,4)`. Finance-controller structural review advisory-pending.            | Held (config)     |
| P1-OD-023 | Invoice / payment / numbering / delivery rules               | Delivery eligible-state set is a **documented open contract**, not invented state names (`delivery-eligibility-contract`). Payment methods limited to cash/card_terminal/bank_transfer (ASM-14).            | Held (config)     |
| P1-OD-024 | Warranty defaults / claim adjudication                       | Warranty terms are effective-dated coverage rows (no default values seeded); full claim adjudication deferred to P1-22 — only `warranty_status_history` (…claimed_against) is prepared (Figure 4.25).       | Held / deferred   |
| P1-OD-042 | Gapless vs gapped invoice numbering (jurisdiction-dependent) | `sal.invoice_numbering_configs.mode` CHECK IN ('gapless','gapped'); both use the rollback-safe `shared.next_display_number` allocator; default mode is **configuration**, not schema. Proven rollback-safe. | **Open** (config) |
| DEP-07    | Finance configuration input                                  | Structural only; amount/tax columns present, values are configuration. Finance-controller review advisory-pending (P1-OD-007).                                                                              | Recorded          |
| DEP-11    | KPI / report definitions                                     | Only the `rpt` **configuration foundation** and saved filters are built; no report datasets or KPI formulas. `export_permission_code` recorded for P1-23.                                                   | Recorded          |

## Held as configuration (not invented)

- **Numbering mode (P1-OD-042).** The mechanism supports gapless and gapped; the legal
  posture is a per-(tenant, company) config row. See
  [phase-1-11-invoice-numbering-contract.md](phase-1-11-invoice-numbering-contract.md).
- **Delivery eligible-state set (P1-OD-023).** The "closed/billable" eligible state is a
  documented open contract, not hard-coded state names. See
  [phase-1-11-delivery-eligibility-contract.md](phase-1-11-delivery-eligibility-contract.md).
- **Warranty defaults (P1-OD-024).** No warranty duration/odometer values are seeded; terms
  are tenant-configured effective-dated coverage. Claim adjudication deferred to P1-22.

## Not invented / out of scope

No jurisdiction-specific tax rate, currency, or warranty figure is written into any P1-11
table; every such value is either an FK to a structural reference or a tenant-configured
row. No general ledger, no online-payment gateway, no report dataset. See
[phase-1-11-no-general-ledger-boundary.md](phase-1-11-no-general-ledger-boundary.md).
