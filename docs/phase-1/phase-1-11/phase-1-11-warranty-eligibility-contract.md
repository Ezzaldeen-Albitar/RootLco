# Phase 1-11 — Warranty Eligibility Contract

**Requirement:** BR-WTY-001 (eligibility uses coverage effective at the service date), FR-WTY-001,
§17-8 / M-wty-1, P1-OD-024. Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar
under the Solo Developer Review Policy and the Standing Technical Authorization Policy — not an
independent third-party review.

## Eligibility is evaluated at the service/delivery date

Warranty eligibility uses the `wty.warranty_coverage` terms **effective at the original
service/delivery date** — not the terms current at claim time. Because the delivery binds
`warranty_records.start_date := delivery.delivered_at` and `odometer_at_issue :=
delivery.final_odometer_reading_id` value (M-wty-2), the record captures the service-date basis,
and coverage is selected by `effective_from ≤ start_date < effective_to`.

## Backdating is neutralized (M-wty-1)

- **No-overlap on active coverage** (`ex_warranty_coverage_no_overlap`, gist EXCLUDE) means at
  most one active coverage interval applies to a policy+scope at any date, so the effective-date
  lookup is unambiguous.
- A coverage row added later with an earlier `effective_from` is a distinct interval; it cannot
  overlap an existing active interval, and it cannot change a warranty **record already issued**
  (records are frozen after issue). A backdated policy therefore cannot change historical
  eligibility — proven by test.

## Odometer + duration limits

Eligibility additionally respects the coverage `duration_months` and optional `odometer_limit`.
`wty.warranty_records` captures `expiry_date` (`> start_date`) and `odometer_limit`
(`>= odometer_at_issue`); a claim past the date or odometer limit is out of coverage. Full
**claim adjudication** is deferred to P1-22 (P1-OD-024); P1-11 prepares the record + status
history only.

**Tests:** `wty-warranty`.
