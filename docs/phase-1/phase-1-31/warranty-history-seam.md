# P1-31 — the warranty history seam (prerequisite P-18)

What this slice published, what it deliberately did not change, and what it leaves open.

|                         |                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prerequisite closed** | **P-18** (warranty history reader), named in [`a0-preflight.md`](./a0-preflight.md) and raised as **CC-31**                                                                                                       |
| **Change control**      | **CC-55** in [`change-control-2026-09-08.md`](./change-control-2026-09-08.md), section 65; closes the ledger limb of **CC-10** and the backend half of **CC-31**                                                  |
| **Lane**                | `p1-31-backend` — `remediation/p1-31-backend-warranty-history`, pull request [#390](https://github.com/Ezzaldeen-Albitar/RootLco/pull/390)                                                                        |
| **Baseline**            | protected `develop` **72f3a71e**; `main` **1262de74**, untouched                                                                                                                                                  |
| **Canonical tasks**     | **none.** P-18 is an execution prerequisite of **FE-009**, not one of the 29                                                                                                                                      |
| **Authority to do it**  | the Owner instruction of 2026-09-13: where a prerequisite is only the missing backend half of an already-required behaviour, the existing full-completion authority applies through the appropriate backend slice |

---

## 1. The defect this closes

A0 item 9 recorded "warranty history" as blocked on two facts. P-6 and P-7 closed the first — the
declared `GET /api/v1/warranties` now exists and the detail read is gated on a read code. The second
stood untouched through five subsequent slices, each of which restated it rather than closing it:

> `wty.warranty_status_history` is written by the database and read by **no operation anywhere** in
> `apps/api/src`

That is **CC-10**, and it is why FE-009 shipped partial: the warranty record screen states in the
operator's own language that the transition record cannot be read, because composing a sequence from
the record's current status would be an invented ledger, which is worse than an absent one.

So the screen is not the gap. The read is.

---

## 2. What this slice did NOT have to decide

The reason this is a publication rather than a design is worth stating precisely, because it is what
makes it safe to ship under an existing authorization rather than a new one.

| would have needed a decision     | measured state                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a table                          | `wty.warranty_status_history` ships in `supabase/migrations/20260724095000_wty_warranty.sql:288`                                                                                           |
| row-level security               | `ENABLE` and `FORCE` at `:311`–`:312`; `sel_warranty_status_history_scope` for `app_runtime` and `app_readonly` at `:313`                                                                  |
| a grant                          | `GRANT SELECT … TO app_runtime` and `TO app_readonly` at `:321`–`:322`                                                                                                                     |
| an index for the read's ordering | `ix_warranty_status_history_record (tenant_id, company_id, branch_id, warranty_record_id, occurred_at DESC, seq DESC)` at `:309` — the predicate and the ordering below lead on it exactly |
| server-stamped attribution       | `tg_warranty_status_history_stamp` at `:310`, running `shared.stamp_status_history`                                                                                                        |
| a permission code                | `wty.warranty.read`, seeded by P-7 at `supabase/seeds/04_iam_permission_catalog.sql:112`                                                                                                   |
| a precedent for the shape        | `sal.delivery-status-history` (P-5), one schema over, at `apps/api/src/app/api/v1/deliveries/[deliveryId]/status-history/route.ts`                                                         |

**No migration, no seed, no permission code, no baseline value, no bundle change.** Nothing about
who may see what moved: a caller who could already read the warranty record can now read how it
reached its status, under the same code, in the same scope.

---

## 3. What was published

| operation                     | path                                          | permission          | scope    | audit  | rate limit       |
| ----------------------------- | --------------------------------------------- | ------------------- | -------- | ------ | ---------------- |
| `wty.warranty-status-history` | `GET /warranties/{warrantyId}/status-history` | `wty.warranty.read` | `branch` | `none` | `expensive-read` |

The response is `WarrantyStatusHistoryEnvelope`:

```
{ warrantyId, transitions: Page<WarrantyStatusHistoryEntryView> }
```

and one row is `{ id, fromStatus, toStatus, reason, actorId, occurredAt }` — field for field, and in
the same order, as `DeliveryStatusHistoryEntryView`. A screen that renders a delivery's ledger and
then a warranty's handles ONE shape rather than two that can drift. `warrantyId` travels beside the
page so a response is self-identifying when it is logged or composed into a warranty document.

**`correlationId` is deliberately absent.** The column exists and is written; a correlation id is
platform diagnostics rather than a fact about the warranty, and the delivery ledger publishes none.

**`occurredAt` is an ISO-8601 instant**, server-stamped, never a value any caller supplied.
`actorId` is never null — the column is NOT NULL and the trigger sets it — so an unattributed
transition cannot be published. `reason` is null where none was given rather than an empty string
standing in for one.

**No money, by measurement.** `wty` has 80 columns and not one is an amount, a currency or a cap in
any unit of account.

**What a web slice must build against, and what it must not.** The published OpenAPI 200 schema for
this GET is `{"type":"object"}` — a generator default, not a choice this operation made. All 296
operations in `docs/api/openapi.v1.json` that publish a 200 carry exactly that body, and this GET's
entry is identical key for key to `sal.delivery-status-history`'s. The wire contract is therefore the
exported TypeScript pair, `WarrantyStatusHistoryEnvelope` and `WarrantyStatusHistoryEntryView` from
`@/modules/warranty`, which `check-named-wire-shapes.mjs` requires to be NAMED for precisely this
reason: field names, types and nullability come from those two interfaces. Enriching the generator's
body schemas would be a platform-wide change to all 296 and is not this slice's to make.

---

## 4. The four decisions the read still had to make

**Scope, and the ORDER it is decided in.** The record is read first and `authorizeScope` runs against
the record's OWN company and branch — `readWarranty`'s order, not `listWarranties`'. So
`ERR-RES-001` is decided before any scope decision, a record outside the caller's grants is
invisible to row-level security and reported as absent rather than as forbidden, and the branch this
ledger is paged in is the row's own rather than one a caller supplied. The list's reverse order is
correct only where there is no row to take a scope from.

**The permission is the record's own.** How a warranty reached its status says no more about it than
the record does. A distinct code would produce a caller who can read the record but not its history,
or the reverse, and `sel_warranty_status_history_scope` carries no permission term of its own, so
the route declaration is the only permission gate on these rows.

**Paged, not a single row.** On every record this application can create the ledger holds exactly
ONE row — see section 5 — and it is published as a page anyway. The table is append-only with no
ceiling in the DDL and its later writers are the subject of later work; a "the genesis row"
contract would have to break the day the first of them lands.

**The cursor is minted in SQL at microsecond precision.** `occurred_at` defaults to `now()`, which is
transaction-stable, so rows written by one statement share it exactly. A JS `Date` truncates to
milliseconds and then silently SKIPS every row on the boundary — `P1-27-INT-006` — so `sort_value`
comes from `cursorTimestamp('occurred_at')`. The keyset tie-breaks on `id` and not the `seq` identity
column, because `keysetFragment` compares `(sort, id)` and `Cursor.i` is validated as an identifier;
`seq` orders identically within one `occurred_at`. The ordering key
`wty.warranty_status_history:occurred_at_desc` is qualified, so a cursor minted for the delivery
ledger — the read this one mirrors — cannot be spent here.

---

## 5. What the ledger actually contains today, and why that is not this read's limitation

**One row per record: the genesis `NULL -> 'issued'`.**

`wty.issue_warranty` writes it in the same statement that creates the record. Nothing else in this
repository has ever written the table, and nothing in this phase advances
`wty.warranty_records.status` — `assertWritableStatus` refuses `active`, `expired` and `voided`
structurally, and the `warranty` module's own surface has recorded "no status advance" since P1-22.

That is a fact about the WRITERS. It is stated here, in the route docblock, in the repository method
and twice in the suite, rather than left for a caller to infer from an unexpectedly short page. The
suite proves it as an honest negative on a warranty the product alone created and no fixture touched.

**No `origin` block is synthesised.** `wo.job_status_history` and `wo.work_order_status_history` are
written by AFTER UPDATE triggers, so the insert that CREATES the row emits no entry and their
readers must publish a separate initial state. This table has no such trigger: the primitive writes
the genesis row itself with `from_status = NULL`. The oldest entry is therefore already the origin,
and inventing an `origin` block would publish a second, unsourced claim about the same fact. The
suite asserts the response carries no `origin` key.

**The ledger is the record and not a reconstruction.** SELECT and INSERT grants only — no UPDATE and
no DELETE for any application role — and the BEFORE INSERT trigger sets `actor_id` and `occurred_at`
from the session context. A transition cannot be back-dated or re-attributed after the fact, and
`actor_id NOT NULL` fails loudly rather than recording an unattributed row.

---

## 6. Files changed

| file                                                                                               | change                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/app/api/v1/warranties/[warrantyId]/status-history/route.ts`                          | **new** — `wty.warranty-status-history`                                                                                                                                                |
| `apps/api/src/modules/warranty/data/warranty-repository.ts`                                        | `WARRANTY_STATUS_HISTORY_ORDER`, `WarrantyStatusHistoryRow`, `toStatusHistory`, `listStatusHistory` — the query and the mapper are both new, as P-5's were                             |
| `apps/api/src/modules/warranty/application/warranty-service.ts`                                    | `WarrantyStatusHistoryEntryView`, `WarrantyStatusHistoryEnvelope`, `readStatusHistory`                                                                                                 |
| `apps/api/src/modules/warranty/index.ts`                                                           | exports the two views, the row and the order; the composition-root and "no status advance" docblocks record the fourth method                                                          |
| `apps/api/src/server/http/route-templates.ts`                                                      | registers `/warranties/{warrantyId}/status-history`, without which every idempotent request to that path would fail `ERR-INT-002`                                                      |
| `tests/backend/p1-31-warranty-read-seam.test.ts`                                                   | EXTENDED with the P-18 section — section 7 below. Extended rather than added, because a new backend file moves the derived P1-27 file-count markers                                    |
| `tests/openapi-contract.test.ts`                                                                   | imports the new route, without which it would be absent from the document rather than reported missing                                                                                 |
| `tests/ci/repository-paths.test.ts`, `named-wire-shapes.test.ts`, `openapi-success-status.test.ts` | the five pins one operation moves — section 8                                                                                                                                          |
| `scripts/check-operation-test-coverage.mjs`                                                        | the `wty.warranty-status-history` manifest entry                                                                                                                                       |
| generated                                                                                          | `docs/api/openapi.v1.json`, the P1-14 and P1-22 operation-test matrices, the P1-19 and P1-22 endpoint inventories, the P1-24 register, `apps/web/src/lib/api/idempotent-operations.ts` |
| records                                                                                            | this file; `change-control-2026-09-08.md` § 65 / CC-55; `a0-preflight.md`; the three live misnamings corrected in place                                                                |

---

## 7. Proof

`tests/backend/p1-31-warranty-read-seam.test.ts`, P-18 section — ten cases on the isolated clone,
never on the shared acceptance database. The file goes from 23 cases to 33. The four that carry the
claim:

- **the ledger is published newest first with the genesis row last**, and the wire rows are compared
  id for id against `wty.warranty_status_history` ordered `occurred_at DESC, id DESC` — the read's
  own tie-break, not `seq` — so a mapper that dropped, duplicated or re-ordered a transition fails
  rather than passing unexamined. The published stamps are additionally asserted to decrease, so the
  order is the read's doing rather than an accident of insertion;
- **the honest negative**: a warranty issued through `POST /deliveries/{id}/warranties` and never
  touched again returns EXACTLY one row, `NULL -> 'issued'`, `hasMore` false and `nextCursor` null,
  and its record still reads `issued` — one row and not an empty page, because an empty one would
  mean the primitive had not written the genesis row;
- **paging walks straight through a microsecond tie**: a SECOND ledger fixture appends its two
  transitions in ONE transaction, so they share `occurred_at` exactly, and the walk to exhaustion is
  asserted complete and disjoint against the table AND asserted to have crossed a duplicate stamp —
  the `P1-27-INT-006` condition, which a two-page sample cannot see;
- **the branch refusal in both layers**: a caller scoped to another branch is answered 404
  `ERR-RES-001` by row-level security, and the caller whose unrelated widening grant puts the
  record's branch inside its permission-blind branch union — so the row IS visible to RLS and the
  scope-blind pre-handler check passes — is answered 403 `ERR-IAM-001` by the in-service
  `authorizeScope` alone. Deleting that one call turns the second into a 200 that publishes another
  branch's ledger.

Plus the cross-tenant pair (a real id and an invented one are indistinguishable), the two permission
counterfactuals (`wty.warranty.issue` alone and `wty.policy.manage` alone are both refused with
`ERR-IAM-001` naming `wty.warranty.read`), the 401, the three cursor refusals — malformed, oversized
and minted for the delivery ledger — and the registration assertions.

**The multi-row fixture is SQL, and the suite says so above the helper.** No operation advances a
warranty status, so there is no product path that appends a second transition; the helper does what a
writer would have to do and no more — the record's status moves and the row is appended in the same
transaction as that move, under the actor GUC the stamp trigger reads, so `actor_id` and
`occurred_at` are server-stamped exactly as in production and nothing is inserted with a chosen id,
actor or timestamp.

**Two ledger fixtures, one property each — and that split is a correction made inside this slice.**
`occurred_at` is `now()` and therefore transaction-stable, so rows appended in one transaction tie to
the microsecond and the read then falls back to its `id` tie-break, a random uuid. The first version
of this suite appended both transitions in one transaction AND asserted their exact order; it passed,
then failed, then passed, because it was asserting a uuid comparison. The fix is not a looser
assertion: the strictly ordered fixture is advanced in SEPARATE transactions and its order is
asserted exactly, and the tied fixture is used only for the paging walk, which asserts completeness
and disjointness and never an order. Recorded as **CC-55** rather than quietly repaired, because a
test that asserts more than its contract gives is the failure mode this phase keeps finding.

`tests/db/p1-11-isolation.test.ts` covers this table's tenant isolation by enumeration — see
section 9.

---

## 8. Pins moved

Six, and each is the count a single new operation on a single new route module legitimately moves.
Nothing was widened and nothing else in the tier moved. _(This sentence read "Five" while the table
below it listed six rows — the resolved-operation count in `openapi-success-status.test.ts` was
moved and proved but not counted in the prose. Corrected in place; no figure changes.)_

| file                                      | pin                 | before → after |
| ----------------------------------------- | ------------------- | -------------- |
| `tests/ci/repository-paths.test.ts`       | route modules       | 320 → 321      |
| `tests/ci/repository-paths.test.ts`       | operations          | 411 → 412      |
| `tests/ci/named-wire-shapes.test.ts`      | `bodies`            | 411 → 412      |
| `tests/ci/named-wire-shapes.test.ts`      | `named`             | 358 → 359      |
| `tests/ci/openapi-success-status.test.ts` | resolved operations | 411 → 412      |
| `tests/ci/openapi-success-status.test.ts` | `counts[200]`       | 295 → 296      |

Route modules and operations move by exactly one each, so the asymmetry the P-9, P-10 and P-17
comments explain is absent here: this operation is one verb on one new module. `counts[201]` (115)
and `counts[202]` (1) are asserted UNCHANGED, and that is the assertion carrying weight — a ledger
read that had shipped an append beside it would show up in that pair and nowhere else in the tier.
`composed` and `anonymous` are unchanged for the same reason: the envelope is a named interface.

---

## 9. What stays open

- **CC-31, the frontend half.** P-18 is the backend prerequisite FE-009 was missing; it does not
  render anything. The warranty record screen still states that the transition record cannot be read,
  and it must be changed to render this ledger before FE-009 can move out of partial. That is a web
  slice and is not in this lane — the ownership profile of this branch forbids `apps/web` source.
- **No warranty status WRITER exists**, and this slice does not add one. `wty.warranty_records.status`
  can still only ever read `issued` on a record this product created, so the published ledger is one
  row until a writer lands. Whether one should exist — expiry evaluated and recorded rather than
  derived, and voiding as an authority — is a product decision nobody has been asked for.
- **P1-22-L-01 is unchanged.** No claim table exists in any schema, `'claimed_against'` is in the
  `to_status` CHECK vocabulary and nothing anywhere writes it. This read would publish such a row if
  one existed; nothing can create one.
- **CC-08 is unchanged.** An organisation provisioned before P-7 holds `wty.warranty.issue` and not
  `wty.warranty.read`, so its administrator is refused this read exactly as it is refused the other
  two, until the A0 **D-2** backfill decision or a freshly provisioned organisation.
