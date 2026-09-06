# P1-30 — closure record (P1-G30)

**Closed 2026-09-06 at protected `develop` `de7ce932`**, reproof **19/19**; `main` at
`73297fd8`, untouched by this phase. Promotion is a separate act (§5).

## 1. What closed, and on whose word

P1-30 — Services, Quotations, Inventory, Billing and Payments Frontend — met its own completion
condition (canonical plan §5) at the head above. The Owner's explicit acceptance verdict on the
production build is the directive's W9 sentence and remains the Owner's to give; this record states
what the repository can prove and names what only the Owner can.

## 2. The 34 canonical tasks, reconciled to evidence

The canonical plan turns the Owner register's P1-30 field 5 into twenty-one FE tasks and names
four SEC, five QA and two DOC items, with A0 and W9 as the phase's two bracketing items — 34.

| task    | item                                       | delivered by | record / proof                                                               |
| ------- | ------------------------------------------ | ------------ | ---------------------------------------------------------------------------- |
| FE-001  | service catalogue, per-branch availability | W1 (#314)    | wave-records §W1; `p1-30-w1-service-catalogue.test.ts` 7; DOM 21 + 15        |
| FE-002  | price lists                                | W2 (#315)    | wave-records §W2; `p1-30-w2-pricing.test.ts` 9; DOM 18 + 18                  |
| FE-003  | quotation builder                          | W3 (#316)    | wave-records §W3; `p1-30-w3-quotations.test.ts` 11; DOM 16 + 20              |
| FE-004  | quotation versions                         | W3 (#316)    | same                                                                         |
| FE-005  | discount request                           | W3 (#316)    | the line's `discount` field, authorised synchronously; refusal rendered      |
| FE-006  | tax display                                | W2 (#315)    | `taxRate` as the fraction; no tax rate reachable on a fresh tenant (CC-06)   |
| FE-007  | approval display                           | W3 (#316)    | decisions read + form; limits under `iam.approval.manage`                    |
| FE-008  | item search                                | W4 (#317)    | wave-records §W4; `p1-30-w4-inventory.test.ts` 16; DOM 30                    |
| FE-009  | stock balance                              | W4 (#317)    | same; acceptance step 32 (`12.000` on hand)                                  |
| FE-010  | reservations                               | W4 (#317)    | same                                                                         |
| FE-011  | issues                                     | W5 (#318)    | wave-records §W5; `p1-30-w5-parts-movements.test.ts` 13; DOM 22              |
| FE-012  | returns                                    | W5 (#318)    | same; `returnedQty` scale fixed #322 (CC-07)                                 |
| FE-013  | stock movements                            | W5 (#318)    | same; DOM 12; acceptance step 33                                             |
| FE-014  | invoice preview                            | W6 (#319)    | wave-records §W6; `p1-30-w6-invoices.test.ts` 14; DOM 28; acceptance step 56 |
| FE-015  | invoice issue                              | W6 (#319)    | same; acceptance step 58 (`000001`)                                          |
| FE-016  | payment form                               | W7 (#320)    | wave-records §W7; `p1-30-w7-payments.test.ts` 16; DOM 50; acceptance step 61 |
| FE-017  | partial payment                            | W7 (#320)    | recording and allocating are separate acts; acceptance steps 61-62           |
| FE-018  | receipt                                    | W7 (#320)    | same                                                                         |
| FE-019  | outstanding balance                        | W6/W7        | `sal.invoice-outstanding-read`; acceptance step 63 (`0.0000`)                |
| FE-020  | invoice print                              | W6 (#319)    | `PrintDocument` composed client-side; DOM-asserted                           |
| FE-021  | receipt print                              | W7 (#320)    | same                                                                         |
| SEC-001 | least privilege, resolved scope            | W8           | `w8-security-and-qa-evidence.md` §1                                          |
| SEC-002 | sensitive splits                           | W8           | §2                                                                           |
| SEC-003 | scope hygiene, abuse cases                 | W8           | §3 (+ CC-14)                                                                 |
| SEC-004 | write-shape gate                           | W8           | §4                                                                           |
| QA-001  | contract-mirror coverage                   | W8           | §5                                                                           |
| QA-002  | contract, error path, replay coverage      | W8           | §6                                                                           |
| QA-003  | isolation                                  | W8           | §7                                                                           |
| QA-004  | concurrency, idempotency, versions         | W8           | §8                                                                           |
| QA-005  | regression, immutable evidence             | W8           | §9                                                                           |
| DOC-001 | plan, wave records, traceability           | W8 (#325)    | `wave-records.md`; §10                                                       |
| DOC-002 | guidance and the change record             | W8           | §11                                                                          |
| A0      | preflight                                  | #310         | `a0-read-surface-matrix.md`, corrected by `f02-remeasurement.md`             |
| W9      | acceptance on a fresh organisation         | this closure | `w9-acceptance-record.md`; the Owner's own verdict remains theirs            |

DOM figures in this table are the wave records' `it(` counts at each wave's head; today's executed
counts, which expand `it.each`, are in `w8-security-and-qa-evidence.md` §5.

The corrective path the closure needed, outside the 34: A1 (#311), A2 (#313), the tenant bootstrap
(#321), the commercial setup (#322) and the W10 screens (#323), all recorded in `wave-records.md`
and `change-control-2026-09-06.md`.

## 3. The plan's completion condition, item by item

1. Every §1.1 scope item implemented, reachable and mapped in A0's record — the 21 FE rows above;
   the A0 matrix mapped each to an operation or a named prerequisite, and every prerequisite (S-02 …
   S-16, then the F-02 remeasurement's three writers) has landed.
2. No screen computes money — `check-p1-30-server-arithmetic.mjs` 0 violations at every head and
   at `de7ce932` (the W8 record's figures, re-measured on that checkout; its executable tree is
   `ea8c0666`'s, the acceptance build's).
3. PC-1 on a real response for every screen — each wave's backend proof (authorised sees,
   unpermitted refused, cross-tenant invisible) and the acceptance's two organisations; the
   `inv.cost.view` / `sal.finance.view` splits as the contracts say (W8 §2).
4. No static fixture on the production path — `security:all` no-fake-data 0 findings; the
   acceptance taken on a production build with product-created data only.
5. The Frontend/Backend boundary — every Frontend PR judged under `p1-30-frontend` (forbids
   `apiSource`), every Backend prerequisite under `p1-30-backend`; 0 violations each.
6. The access and payload-parity gates non-vacuous over the P1-30 route pages — hosted
   `Repository gates` on every merge; W8 §1 and §4 with today's figures.
7. Owner acceptance recorded as an explicit verdict on a production build — **the repository's
   acceptance is recorded (`w9-acceptance-record.md`, PASSED); the Owner's own verdict is the
   condition's last word and is stated as pending the Owner.**

## 4. Residuals carried out of the phase, each with an owner

CC-06 (unconfigured tax/numbering/discount/approval entities — register gaps), CC-08 (backfill of the
six pre-#321 organisations — Owner decision), CC-09 (store-layout authority), CC-11 (Area D demand
rules — pending OD-D-a/b/c), CC-12 (two cost codes outside the bundle), CC-13 (company/branch manage
codes excluded by design), CC-14 (scope check for an unrestricted foreign target), CC-15 (the branch-pair picker's
identifier fields while its list loads), CC-16 (the W4 category filter made stale by W10), the no-batch-read
absence (register C-2) and the un-keyed opening line create — all in `change-control-2026-09-06.md`
and the Owner register's follow-on section. The B1 pg_net provider blocker stays OPEN and outside
this phase.

## 5. What this record does not claim

This is a closure record, not a promotion record. Promotion of `develop` to `main` is the
governed act (a content-free synchronisation first, then a merge-commit promotion) recorded in its
own pull requests. P1-31 — Vehicle Delivery, Warranty and Reporting Frontend — begins on this
closure and on the Owner's verdict.
