# P1-30 W8 — security and QA evidence (SEC-001 … SEC-004, QA-001 … QA-005, DOC-001, DOC-002)

**Measured 2026-09-06 at protected `develop` `de7ce932`** (after #322, #323 and #325), with the
gates run by name on that tree, the hosted runs named by id, and the fresh-organisation
acceptance (`w9-acceptance-record.md`) cited where a control was exercised on a real response.

The canonical plan (§4, W8) names the eleven items by id and defines none of them in this
repository; the definitions below transpose P1-28's (`docs/phase-1/phase-1-28/canonical-plan.md`
lines 172-212), the only in-repo precedent, onto P1-30's surface. Every figure is today's; a
number in this prose describes a run, and the gate's own derivation is the authority.

| item    | P1-30 definition                                                                | evidence | state       |
| ------- | ------------------------------------------------------------------------------- | -------- | ----------- |
| SEC-001 | least-privilege permission and resolved-scope enforcement on every P1-30 screen | §1       | held        |
| SEC-002 | the two sensitive splits: `sal.finance.view` money, `inv.cost.view` cost        | §2       | held        |
| SEC-003 | scope hygiene and abuse cases: no client-asserted scope, cross-tenant, replay   | §3       | held, 1 obs |
| SEC-004 | the write-shape gate: every P1-30 write mirrored or declared, none unwired      | §4       | held        |
| QA-001  | contract-mirror unit and component coverage                                     | §5       | held        |
| QA-002  | API contract, error-path and replay-shape coverage                              | §6       | held        |
| QA-003  | tenant / company / branch isolation                                             | §7       | held, 1 obs |
| QA-004  | concurrency, idempotency and record-version sourcing                            | §8       | held        |
| QA-005  | regression and immutable evidence packaging                                     | §9       | held        |
| DOC-001 | canonical plan, wave records and traceability synchronised                      | §10      | done        |
| DOC-002 | operator / developer guidance and the change record                             | §11      | done        |

## 1. SEC-001 — least privilege and resolved scope

- `check-p1-28-access.mjs` (derives every `page.tsx` under `(dashboard)`, P1-30's included): every
  screen gates before it reads, consults only published codes, requires no more than its operations
  require, asserts no scope in a URL — **OK** at `de7ce932`.
- `check-p1-29-access.mjs`: 8 route pages / 15 owned segments, 0 violations.
- `check-p1-30-access.mjs`: **20 route pages / 31 owned segments** derived from the
  operation register, 0 violations (the W10 pages included).
- RES-05 held on every wave: every code a screen consults was resolved from the operations it
  consumes; the one live defect (navigation gating `/billing` on the non-existent
  `sal.invoice.read`) was fixed in W6 and its permission-parity register entry deleted;
  `check-permission-parity.mjs` OK with one open-debt entry outside P1-30 (`sal.delivery.read`,
  owned by the delivery Frontend).
- Resolved scope: every branch-scoped read travels through `branchTargetQuery` with both halves
  required (P1-18-A-01); the receipt list's required target is the route's own authorization target
  (W7). Proved on real responses in the acceptance: a caller of organisation B addressing
  organisation A's pair sees no row (§7).
- The administrator bundle is the code the First Owner holds: 67 codes at `de7ce932`
  (`TENANT_ADMINISTRATOR_ROLE`), with `sal.*`, `inv.item.manage` and `inv.adjustment.approve`
  added by #321/#322 because delegation admits only held codes; the acceptance session shows the
  fresh owner holding `inv.item.manage`, `inv.adjustment.approve`, `inv.stock.operate`,
  `iam.user.manage`, `svc.service.manage`, `svc.price.manage`, `quo.quotation.manage`,
  `sal.invoice.manage`, `sal.payment.record` and `rec.reception.convert` (step 12).

## 2. SEC-002 — the sensitive splits

- `sal.finance.view` NULLS amounts, never zeroes: `tests/backend/p1-30-w6-invoices.test.ts`
  pins that a finance-less read carries no `0.0000` in its body; the W6 and W7 screens render
  "not available" for absent money areas. The cashier shape reaches the open balance only through
  the payment screen (W7 record).
- `inv.cost.view`: no inventory read publishes a cost; the W4 catalogue says so; #322's
  `inv.item-create` takes no cost. `inv.cost.view` and `inv.external_purchase.record` are outside
  the bundle by design — recorded as change-control CC-12 (off the P1-30 screens).
- `iam.sensitive.view`: outside P1-30's surface (rework cost, P1-28 complaint text); untouched.
- Money crosses the API as decimal strings and is rendered as such: `check-p1-30-server-arithmetic.mjs`
  **0 violations** across 45 files in the six feature trees and the six dashboard
  segments; `taxRate` renders as the fraction it is (W2, W3, W6).

## 3. SEC-003 — scope hygiene and abuse cases

- No client-asserted scope: `check-p1-28-access` "asserts no scope in a URL" holds over every
  P1-30 page; `branchTargetQuery` refuses a scope name among ordinary filters (W4).
- Cross-tenant, exercised on two fresh organisations in the acceptance (steps 64-68): the item
  search is empty; the invoice, the work order and the batch line are refused **404**; the
  location list for the other organisation's pair answers **200 with no row**.
- **Observation, recorded not hidden (also QA-003):** a query-scoped read addressed to another
  tenant's company/branch pair by an UNRESTRICTED holder is not refused by the scope check — RLS
  returns no row. The same class was met in #322 (MD-X1: the write path reached the composite FK
  instead of a 403, mapped to 404) and in A2's honest negative. No data crosses; the refusal shape
  differs from a 403. Recorded as change-control **CC-14** for the Backend lane (`authorizeScope`
  semantics for an unrestricted grant against a foreign pair), not worked around on a screen.
- Abuse of authority: the counter approving their own opening batch is refused **409** (maker ≠
  checker, step 24), and the second person's login is refused **401** until an administrator
  activates the invitation (step 27) — both the product's order, both on screen (W10 record).
- Replays: a same-key retry never books twice — reservation body-key replay (W4), issue/return
  header-key replay adding no movement (W5), invoice create/issue replays (W6), receipt replay (W7),
  the approval replayed with the same key (step 31), two identical category creates in parallel
  resolving to one row (step 69).

## 4. SEC-004 — the write-shape gate

The P1-30 analogue of the write-reachability class (declared-but-never-wired) is the payload-parity
gate: every `svc`/`quo`/`inv`/`sal` write is either mirrored by a hand-transcribed request
interface a screen sends, declared BODYLESS with its reason, or declared PENDING with the screen
that owes it — and a PENDING entry cannot outlive its reason. `check-p1-30-payload-parity.mjs` at
`de7ce932`: **70 operations in scope, 41 writes, 38 with a body, 3 bodyless, 9 pending
(damage, intake, credit notes, deliveries — outside every P1-30 FE row), 31 mirror
interfaces, 0 problems.** `check-p1-28-version-sourcing.mjs`: 22 guarded operations, 27 adapters,
28 guarded call sites — every `If-Match` sourced from a read or a command response.

## 5. QA-001 — contract-mirror coverage

Six mirror files under `apps/web/src/lib/contracts/` carry the 31 P1-30 request interfaces the
parity gate counts (four more files hold the P1-28/P1-29 mirrors), and one DOM suite per screen
— executed cases per a vitest run of these files today, which expands `it.each`, so three
detail suites exceed the `it(` counts the wave records quote: services-catalogue 21 +
services-detail 20, pricing 18 + price-list-detail 23, quotations 16 + quotation-detail 25,
inventory 30, inventory-parts 22, inventory-movements 12, invoices 28, payments 50,
inventory-setup 17, inventory-opening-stock 14 — every route page rendered behind a mocked
session with a throwing `notFound`, LTR and RTL. Web tier at
`de7ce932`: **130 files, 3490 tests, 0 failed** (hosted run 34038179042).

## 6. QA-002 — API contract, error paths and replay shapes

Adapter suites (executed cases today): services-api 17, pricing-api 16, quotations-api 14,
inventory-api 38 (W4, W5, W10), billing-api 16, payments-api 15 — paths, bodies as typed, the transport key attached to every
idempotent send, refusals mapped by the field, expired sessions reported before any request.
Backend proofs on real rows: W1 7, W2 9, W3 11, W4 16, W5 13, W6 14, W7 16, A1 31, A2 41 + 21,
#321 12, #322 15 + 8 — the 428/409/422/403 branches per operation and each wave's replay shape
(W4's body key, W5's header key, W6's stored-answer replay, W7's `replayed` only on the record).
Unit tier at `de7ce932`: **118 files, 3212 tests, 0 failed** (hosted run
34039719991); backend tier in the clean room: 124 files, 2647 tests; database tier 144 files, 1738 tests
(clean-room job of run 34039719991).

## 7. QA-003 — isolation

Two layers, never collapsed (A2): the database layer hides the parent (404 by RLS); the application
layer refuses the widening grant (403 by `authorizeScope`). Every wave's backend proof carries a
cross-tenant case; #322's master-data suite carries MD-X1. The acceptance's organisation B probes
(§3) are the same property on a fresh pair of organisations, plus the observation CC-14.

## 8. QA-004 — concurrency, idempotency, record versions

- The If-Match trap, handled and disclosed three times: price-list version create/publish guard the
  LIST version (W2, proved by a stale-version 409); quotation issue/revision guard the QUOTATION
  version (W3, a backend docblock recorded as wrong); invoice issue/cancel guard the INVOICE version
  (W6, 428 / 409 / 200 proved). Reception approve and convert guard the reception's version
  (acceptance steps 51-52, `If-Match` from the detail read).
- Same key twice in parallel → one row, one id (step 69); same code under two keys → one 201 and
  one 409 (step 70); every idempotent send carries the transport key (`requiresIdempotencyKey`
  asserted per path in the adapter suites); `inv.opening-batch-line-create` carries none and the
  W10 record states it.
- Version sourcing gate OK (§4).

## 9. QA-005 — regression and immutable evidence

- Every wave's web and unit tiers were recorded from their hosted runs into the run ledger
  (`docs/phase-1/phase-1-27/evidence/local-run-ledger.json`), digest-checked, then a docs-only
  successor closed the cycle; the evidence manifest digests the ledger and the records (40 evidence
  documents). Run ids per wave: `wave-records.md`. #322: web 34034909066, unit 34036060603; #323:
  web 34038179042, unit 34039719991.
- Protected reproofs on `develop`: `159727b1` (#322) **19/19**; `de7ce932` (#323/#325)
  **19/19**.
- `verify:policies` at `de7ce932`: every gate green including `validate:p1-27-closing-values`
  (0 problems once both records are taken); `security:all` green (tracked secrets, service-role
  exposure, pilot-tenant hard-coding, excluded-scope, no-fake-data — 0 findings each).

## 10. DOC-001 — plan, wave records, traceability

`wave-records.md` (#325, replacing #324 whose branch name no ownership rule mapped) is the record per W-item the plan §4 required, re-verified on develop;
`a0-read-surface-matrix.md` carries the F-02 correction banner; `f02-remeasurement.md`,
`change-control-2026-09-06.md` (CC-01 … CC-16) and `tenant-bootstrap-corrective-slice.md` §4
carry the corrective path; the P1-24 operation register and the P1-21 endpoint inventory are
regenerated at every head; `owner-workflow-requirements.md` rows refreshed with evidence and the
nine-area companion grounded with its critiques applied.

## 11. DOC-002 — guidance and the change record

No change-log file exists in this repository; the change record P1-28 counted under DOC-002 is the
deliverable manifest and the pull-request bodies, and P1-30's is `wave-records.md` plus this
record. Operator guidance for the P1-30 screens is the screens' own copy, held to the plain-language
gate (0 findings across every wave's strings, both languages): each screen states what has no read,
what needs a second person, and where a figure is the server's. Developer guidance is in the
records named above and in the memory of the gates: a new operation moves the P1-15 audit-action
pin, the wire-shape buckets, the route/operation/status pins, the P1-19 and P1-21 inventories, the
run ledger and its locators — listed in `wave-records.md` and the #322 record so the next wave
does not rediscover them.
