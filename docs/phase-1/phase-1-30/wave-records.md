# P1-30 — the wave records (A0 … A2, W1 … W7, the corrective slices)

**Written 2026-09-06 under DOC-001, re-verified against protected `develop` `159727b1`.**

The canonical plan (§4) says each W-item is measured before it is claimed, in a record under
`docs/phase-1/phase-1-30/`. Until this document the measurements lived in the merged pull
requests alone; this consolidates them, one section per item, and states for each what was
re-checked today rather than copied: the merge commit is an ancestor of `develop`, the cited proof
files exist and hold the case counts given, the mirrors and gates are present. Case counts below are
today's `it(`/`test(` counts of the files on `develop`, which is why some exceed the number the
pull request stated at the time (later waves added cases to shared files).

Standing facts across every wave: no Frontend branch changed `apps/api`, a migration, a permission
or a generated contract (`p1-30-frontend` ownership profile, 0 violations each); every money or
quantity figure is the server's decimal string (`P1-30 RENDERS SERVER ARITHMETIC ONLY`, gate
`check-p1-30-server-arithmetic.mjs`, 0 violations at every head); every code a screen consults was
resolved from the operations it consumes (RES-05, nothing minted); a browser walk on a running
stack was not performed by the author (it needs an authenticated session, and the author does not
enter credentials) — the DOM tier and the backend proof are the evidence each wave offered, and
the integrated acceptance on a fresh organisation is the step W9 owes.

| item | PR   | merged     | items                              | backend cases | web cases (api / dom)    |
| ---- | ---- | ---------- | ---------------------------------- | ------------- | ------------------------ |
| A0   | #310 | `f6381020` | preflight, profiles, matrix, gate  | —             | —                        |
| A1   | #311 | `bf78cea6` | seams S-02, S-03, S-04             | 31            | —                        |
| A2   | #313 | `96cf4ec3` | seams S-07 … S-16                  | 41 + 21       | —                        |
| W1   | #314 | `0eb9d3e2` | FE-001                             | 7             | 17 / 21 + 15             |
| W2   | #315 | `d52bf3d1` | FE-002, FE-006                     | 9             | 16 / 18 + 18             |
| W3   | #316 | `f2bd512a` | FE-003, FE-004, FE-005, FE-007     | 11            | 14 / 16 + 20             |
| W4   | #317 | `64159666` | FE-008, FE-009, FE-010             | 16            | 29 (shared) / 30         |
| W5   | #318 | `2748d044` | FE-011, FE-012, FE-013             | 13            | (shared) / 22 + 12       |
| W6   | #319 | `0e280dc3` | FE-014, FE-015, FE-019, FE-020     | 14            | 16 / 28                  |
| W7   | #320 | `029fc20d` | FE-016, FE-017, FE-018, FE-021     | 16            | 15 / 50                  |
| TB   | #321 | `6f6236c3` | tenant bootstrap (CC-01 precursor) | 12            | —                        |
| CS   | #322 | `159727b1` | F-02 writers, CC-01 … CC-13        | 15 + 8        | —                        |
| W10  | #323 | pending    | CC-05 screens                      | —             | +8 / 17 + 14 (on the PR) |

Operations: 352 at P1-30's start → 356 (A1) → 368 (A2) → **373** (#322). Migrations 136 → **137**
(#321). Permission codes **118** throughout. Administrator bundle 48 → 65 (#321) → **67** (#322).

---

## A0 — preflight (#310, `f6381020`)

The two ownership profiles (`p1-30-frontend`, `p1-30-backend`), the read-surface measurement of
every §1.1 screen against `develop` (`a0-read-surface-matrix.md`, seams S-01 … S-16 with a class
each), and the server-arithmetic gate armed before any screen existed. Its F-02 count ("eleven
master-data tables with no writer") was later found stale and is corrected in
`f02-remeasurement.md`; the matrix carries the banner.

## A1 — the head of the commercial chain (#311, `bf78cea6`)

Four operations, seams S-02/S-03/S-04: `svc.service-category-list`, `svc.service-category-create`,
`svc.service-version-create`, `svc.price-list-assignment-create` (352 → 356; no migration, no code,
no frontend). The assignment is top-level because `uq_price_list_assignments_signature` keys on the
context, not the price list; a wildcard assignment demands the permission tenant-wide. Proof:
`tests/backend/p1-30-a1-service-catalogue-head.test.ts` (31 cases) — the chain test builds a
service from nothing through shipped routes, proves `GET /prices` still refuses with everything
published, then assigns and proves `250.0000`. Falsifiability recorded including one honest
negative (the tenant predicate mutation stays green because RLS absorbs it). A gate defect found
and deliberately left for its own change (the comment-blind `defineOperation` parser, fixed in #312).

## A2 — the ten read seams (#313, `96cf4ec3`)

Twelve operations, S-07 … S-16 (356 → 368; zero migrations, codes, audit actions): quotation list
and revision reads, decisions read, work-order invoice read, receipt list (reclassified B → C by
Owner decision 2026-09-04), service detail, price-list detail and rules, reservation list,
per-work-order part issues, location list. The RES-05 finding: `sal.invoice.read` does not exist;
S-10 declares `sal.invoice.manage`. Parent-derived scope proved in two layers (404 by RLS, 403 by
`authorizeScope`), never collapsed. Falsifiability measured including what was not proved (the two
S-11 greens are defence in depth). Two defects the gates found were fixed: an anonymous wire shape
(`PriceListRulesView` now exists) and the revision history disagreeing with the detail about the
current revision. The P1-22 §6 isolation test was made operation-precise (fails closed) and
falsified four ways. Proof: `p1-30-a2-published-reads.test.ts` (41) and
`p1-30-a2-inventory-reads.test.ts` (21), every fixture through the shipped route.

## W1 — service catalogue and per-branch availability, FE-001 (#314, `0eb9d3e2`)

Cut from A2. Route `/services` (the gate's pre-named segment; `/catalog` retired). Codes:
`svc.service.read`, `svc.service.manage`, `org.branch.read` (degrades to an identifier field). The
list is tenant-wide with optional filters and reads on first paint; archived rows render as
retired. Absence vs invisibility: a 403 renders the denied state, a refused taxonomy says so, an
unresolvable category id renders as the identifier marked unknown. Writes carry what they read
(`If-Match = recordVersion`; publication guarded on the SERVICE version). Two read gaps stated: no
service-version list, no per-service availability read. Gates added: `validate:p1-30-access`
(gate-before-read, segments derived from the register) and `validate:p1-30-payload-parity` (the
P1-29 comparison scoped to P1-30 domains, PENDING entries with an expiry rule), both with
red-proofs. Proof: `p1-30-w1-service-catalogue.test.ts` (7, PC-1 on real rows),
`services-api.test.ts` (17), `services-catalogue.dom.test.tsx` (21), `services-detail.dom.test.tsx`
(15). Hosted: web run 33936553547, unit run 33937430506, final 33938162331/33938162462 green. The
record cycle took four heads (a CodeQL unused-import note between them).

## W2 — price lists, versions, rules, resolved price, FE-002 and FE-006 (#315, `d52bf3d1`)

Route `/pricing`. Codes: `svc.price.read`, `svc.price.manage`, `svc.price.publish` (tenant-wide by
the backend), `org.branch.read`, `svc.service.read`. `taxRate` renders as the fraction the server
states, never a percent (DOM-asserted). **The If-Match trap:** version create and publish guard the
PRICE LIST's version while echoing the VERSION's; both adapters send the detail's ETag and re-read.
Bounded list (100, no cursor) stated when hit. What has no read is said: no assignment list, no
versions route, no rule change, no tax-class list (the S-06 caveat in copy). The access gate learned
to union the arithmetic gate's segments (the W2 pages had sat outside it). Proof:
`p1-30-w2-pricing.test.ts` (9, incl. the stale list version 409), `pricing-api.test.ts` (16),
`pricing.dom.test.tsx` (18), `price-list-detail.dom.test.tsx` (18). Two gate findings on the first
hosted run, both fixed by conforming, not lowering: the web test-count floor (WTF-08, raised per its
own `howToRaise`) and the web coverage ratchet (route pages enter the denominator at 0 % — all four
P1-30 pages were rendered in their DOM files). Hosted: web 33942550053, unit 33943272089, final
33943982547/33943982668.

## W3 — quotation builder, revisions, decisions, discount, approval display, FE-003/004/005/007 (#316, `f2bd512a`)

Route `/quotations?workOrderId=` (no list wider than a work order is published; a tenant-wide one
would be scope-inert under P1-18-A-01). Codes: `quo.quotation.read`, `quo.quotation.manage`,
`quo.decision.record`, `iam.approval.manage`, `svc.service.read`, `wo.work_order.read`. **Found by
the backend proof:** a DRAFT revision's four totals are database defaults (`0.0000`) until issue —
the screen says so and prints no total. The If-Match trap again (issue and revision-create guard the
QUOTATION version; a backend docblock claiming otherwise is recorded as wrong, not followed). There
is no discount request: FE-005 is the line's `discount` field, authorised synchronously; a refusal
renders as a refusal, never as a quotation with the discount dropped. The P1-28 pin on "not yet
decided" copy caught a phrase reserved for Owner decisions; reworded. Proof:
`p1-30-w3-quotations.test.ts` (11, incl. 100.0000 × 2.000 at 10 % = 220.0000 on issue, the discount
403 and its capture with a ceiling), `quotations-api.test.ts` (14), `quotations.dom.test.tsx` (16),
`quotation-detail.dom.test.tsx` (20). Hosted: web 33947274781, unit 33947968791, final
33948614194/33948614295.

## W4 — item search, stock balance, reservations, FE-008/009/010 (#317, `64159666`)

Route `/inventory`. The item search is tenant-wide; every stock read is addressed to a branch the
screen names once (P1-18-A-01: an empty target leaves the declared scope inert) through
`branchTargetQuery`. Codes: `inv.item.read` (page), `inv.stock.read`, `inv.stock.operate`,
`org.branch.read`. `onHand`/`reserved`/`available` render as sent, one row per cell; no per-item
total exists and none is invented; no cost is published and the catalogue says so. **Replay
semantics measured:** the reservation keeps one row per BODY `idempotencyKey` (200 `replayed: true`);
the transport's header key replays a STORED body (`replayed: false`). **Found while testing:** a
write's notice was destroyed by the remount its re-read caused; notices now live above the remount.
What has no writer is said (S-05 open at the time — closed by #322 and W10). Entering `inv` brought
seven writes into parity scope, declared PENDING with honest reasons; `inv.opening-batch-approve`
declared BODYLESS. Proof: `p1-30-w4-inventory.test.ts` (16, balances `20.000 / 2.500 / 17.500` as
strings, body-key replay, release replay moving nothing), `inventory-api.test.ts` (29 today, shared
with W5 and W10), `inventory.dom.test.tsx` (30). The shell test's planned-module stand-in moved from
Inventory to Reports. Hosted: web 33951249733, unit 33953908483, final 33954831652/33954831931.

## W5 — issues, returns, stock movements, FE-011/012/013 (#318, `2748d044`)

Routes `/inventory/parts?workOrderId=` and `/inventory/movements`. Part issues are published per
work order (parent-scoped, one guard); the order's branch is the target of the pickers. **Two
operands, never a difference:** `quantity` and `returnedQty` side by side, no remaining figure. The
ledger is read only on demand because the server audits every read, and the screen says so. Both
writes are idempotent through the transport key; neither claims a replay (a replay is stated only
when the body says so). Over-issue and over-return are 409 `ERR-TRN-001`, rendered as refusals.
**Found by the backend proof:** `returnedQty` was the unscaled `"0"` before any return and `"1.000"`
after — recorded for the Backend lane, later **fixed in #322 (CC-07)**. Adversarial review before
push: 22 raw findings, 16 confirmed and fixed (an unbounded location-list read loop keyed on object
identity, refusals rendered as emptiness, six vacuous assertions). Proof:
`p1-30-w5-parts-movements.test.ts` (13, header-key replay adding NO movement as a delta),
`inventory-parts.dom.test.tsx` (22), `inventory-movements.dom.test.tsx` (12). Hosted: web
33959609617, unit 33960329271, final 33961220132/33961220265.

## W6 — invoice preview, issue, outstanding balance, print, FE-014/015/019/020 (#319, `0e280dc3`)

Route `/invoices?workOrderId=` (`GET /invoices` is 405). **RES-05 live defect fixed:** navigation had
gated `/billing` on the non-existent `sal.invoice.read`; now `sal.invoice.manage` and `/invoices`,
the permission-parity register entry deleted in the same change. **`sal.finance.view` splits the
screen:** money areas render as "not available" — never zero — for a caller without it; the backend
proof pins that such a body contains no `0.0000`. Issue and cancel send `If-Match` = the INVOICE
record version (428 / 409 / then 200 with the number). Replay semantics measured: a same-key replay
is the stored answer (200, `replayed: false`); `replayed: true` only when a new key meets an invoice
already in the target state. No accepted revision is said, not zeroed. Print is composed
client-side in the shared `PrintDocument` (no print route exists); descriptions join only from a
matching-revision preview. Recorded for acceptance: the bootstrapped administrator held no `sal.*`
code at the time (closed by #321's 65-code bundle); no tax rate is reachable; an unprovisioned
numbering sequence refused issue with a reasonless 404 (closed by #321's sequences). Proof:
`p1-30-w6-invoices.test.ts` (14), `billing-api.test.ts` (16), `invoices.dom.test.tsx` (28).
Adversarial review: 22 raised, 15 applied, 7 refuted. Hosted: web from run 33968381659, unit
33969311330 (one infrastructure-only migration-replay failure classified from its log), final
33970157186/33970157119.

## W7 — payment form, partial payment, receipt, receipt print, FE-016/017/018/021 (#320, `029fc20d`)

Route `/payments`, gated on `sal.finance.view` — the only code both receipt reads declare and the
one a cashier holds; recording and allocating are offered inside by their own codes. This is where
the cashier reaches FE-019 (the invoice screen's gate excludes them). A branch is named before
anything is read (the list's required target, P1-18-A-01). Taking money and applying it are
separate acts, so a partial payment is the ordinary case. Neither write is version-guarded; a
refusal is a BOUND (409 `ERR-TRN-001` inside row locks). Nothing here can be undone and the form
says so first. **Recorded, not hidden:** a platform payment method can never be cited
(`fk_receipts_method` pairs `tenant_id`), and no route creates a tenant method — closed by #321;
the picker read is gated by a WRITE code (A0 matrix residual); no names are published, so none are
shown. Adversarial review: 61 raised, 40 confirmed — two invisible to the suite as first written
(the post-allocation balance rendered on a component the act unmounts; the record form's busy flag
never clearing), both now carried by DOM cases proved to fail without them. `validate:theme`
caught eight headings on a class emitting no CSS (a WEB-workspace gate the root run does not call).
Proof: `p1-30-w7-payments.test.ts` (16), `payments-api.test.ts` (15), `payments.dom.test.tsx` (50).
Hosted: web from run 33984398779, unit 33985268076, final green with `verify:policies` 23 gates.

## TB — the tenant bootstrap corrective slice (#321, `6f6236c3`)

The first corrective on the closure path (`tenant-bootstrap-corrective-slice.md`): tenant payment
methods provisioned in the §6.3 window (the 137th migration), number sequences at their registry
scopes (no migration), the administrator bundle 48 → 65 with the commercial codes. Proof:
`p1-30-tenant-bootstrap-reachability.test.ts` (12) with each half proved falsifiable; the real
product proof over HTTP on a production build (provisioning → credential → login → method list →
customer → receipt → detail → list; invoice, allocation and outstanding NOT proved — the F-02
boundary). Its §4 F-02 statement was re-measured the same day (`f02-remeasurement.md`).

## CS — the commercial-setup corrective slice (#322, `159727b1`)

`f02-remeasurement.md`, `change-control-2026-09-06.md` (CC-01 … CC-13). The genesis suite isolated
into its own database (CC-01, with the drain-before-drop fix for a `pg-pool` race the hosted clean
room exposed); F-02 corrected to three inventory writers, two bundle codes and one screen (CC-02);
five operations, zero migrations (CC-03: `inv.item-category-list/-create`, `inv.uom-list`,
`inv.item-create`, `inv.stock-location-create`); `inv.item.manage` and `inv.adjustment.approve`
into the bundle, 65 → 67 (CC-04); the W5 `returnedQty` scale fixed (CC-07); the nine-area Owner
register with nine completeness critiques applied (CC-10). Proof:
`p1-30-inventory-master-data.test.ts` (15, ending in the chain from an empty catalogue to on-hand
`12.000` through a second person's approval) and the isolated genesis suite (8, G7 sentinel).
Hosted: web run 34034909066, unit run 34036060603, final run on `70e369f2` 21/21 green; merge
second parent `70e369f2`, tree `9aaee140`.

## W10 — the inventory setup and opening-stock screens, CC-05 (#323, pending)

`inventory-setup-slice.md`. Two route pages, zero API change; the last screen a fresh organisation
lacked before stock could exist through the product. Its record states two absences: no
opening-batch read exists, and `inv.opening-batch-line-create` carries no idempotency key. This
row is completed when #323 is on `develop`.
