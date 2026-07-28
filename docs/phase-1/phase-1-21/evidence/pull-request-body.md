Implements P1-21 — Inventory Backend. Fourteen operations over the frozen Phase 1-10
`inv` schema, with **no migration**.

## Verification mode

**GitHub Actions is the primary and authoritative verification path.**

P1-21 began under the Owner-Approved Temporary Local CI Primary Mode, because the
repository was private and its Actions credits were exhausted, so hosted jobs failed
before startup with a billing message. **Before merge the repository was made public**,
which restores standard GitHub-hosted runners on the free public tier, and hosted
Actions became authoritative again.

Two hosted proofs are required on the exact head, both on `ubuntu-latest`:

- **`CI`** (`.github/workflows/ci.yml`) — quality, database, docker and secrets jobs.
- **`P1-21 Hosted Clean Room`** (`.github/workflows/p1-21-clean-room.yml`) — a fresh VM
  at the **exact pull-request head**, asserting an empty database before migration, an
  unchanged schema hash across every suite, and a clean worktree afterwards. `ci.yml`
  proves none of those three, which is why the workflow exists rather than being
  declared redundant. See `hosted-clean-room.md`.

The local reproduction and the local clean room are retained as **corroboration**, not
as the gate. **No billing waiver is used, and no required check is bypassed.**

## Exact state

|                   |                                                        |
| ----------------- | ------------------------------------------------------ |
| Protected base    | `bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2`             |
| Final feature SHA | this pull request's head                               |
| Local CI SHA      | the same — the full matrix ran against the head itself |
| Clean room SHA    | the same — a fresh clone detached at the head itself   |

No SHA for the head is hard-coded here, and that is deliberate: writing one into a file
on this branch changes the very commit it names, and every attempt to correct it moves
the target again.

**An earlier revision of this file did hard-code the local-CI and clean-room SHAs and
stated that the executable diff between them and the head was empty.** That was true
when written and became **false** when the H6 fix landed, because that commit changed
`src` and `tests`. Stale-by-construction evidence is worse than none, so the
transcription is gone and the invariant is stated instead.

The invariant: the local equivalent CI and the fresh clean room both ran against **this
pull request's head commit**, not against an ancestor of it. The exact SHA is recorded
in the gate record, which is created from the protected merge commit — the first
document in this process that can name a SHA without moving it.

## Tasks — 28/28

BE-001…BE-015, SEC-001…SEC-004, QA-001…QA-005, DO-001…DO-002, DOC-001…DOC-002, all
enforced mechanically by `npm run validate:p1-21-inventory`, which proves each task
against **artifacts** — a registered operation, a seeded-and-declared permission, an
audit action with a real producer, a published event, an exported symbol, or a test
title with comments stripped — not against prose.

## Operations — 14

`GET /items` · `GET /stock-availability` · `GET /stock-movements` ·
`GET /inventory-reconciliations` · `POST /opening-inventory-batches` ·
`POST /opening-inventory-batches/{batchId}/lines` ·
`POST /opening-inventory-batches/{batchId}/approval` · `POST /stock-reservations` ·
`POST /stock-reservations/{reservationId}/release` · `POST /stock-issues` ·
`POST /stock-returns` · `POST /damaged-stock` · `POST /customer-supplied-parts` ·
`POST /external-purchase-parts`

OpenAPI: **169 paths / 199 operations** — exactly `185 + 14`, parity in both
directions. Permissions 96 → **100**. Eleven audit actions, three events.

## Database

**No migration.** 119 migrations, no migration 120, none modified. Schema hash
`a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`, unchanged and
identical before and after every suite. Every write uses an existing `app_runtime`
grant or an existing `SECURITY INVOKER` function, so no database change request was
raised.

## Local equivalent CI — all 37 steps, exit 0

Quality, secrets, database and docker, each command's real exit code captured before
any pipe. No `|| true`, no ignored result.

| Suite    | Result                      |
| -------- | --------------------------- |
| Unit     | **926 passed / 43 files**   |
| Database | **1624 passed / 137 files** |
| Backend  | **1380 passed / 59 files**  |

Plus lint, typecheck, format, stylelint, module boundaries (378 files, 11 rules),
authorization coverage, operation coverage, the P1-19/P1-20/P1-21 inventories,
OpenAPI, encoding, six classification guards, seeds applied twice with every business
table empty, production build, Docker dev and runner images, and the non-root runtime
assertion (**uid 1001**).

Full record: `docs/phase-1/phase-1-21/evidence/final-local-ci.md`.

## Clean room

Fresh clone detached at the exact SHA, lockfile-only install, own `postgres:17-alpine`
on an isolated port **verified to hold zero application tables before use**. All of
the above reproduced independently, schema hash identical before and after, worktree
clean, container and clone torn down.

Full record: `docs/phase-1/phase-1-21/evidence/clean-room.md`.

## Reviews and audit

Four independent adversarial reviews over inventory domain correctness and
concurrency; authorization, RLS and isolation; exact quantity, audit/outbox and API
contracts; and task/evidence honesty. Every finding was reproduced personally before
being accepted.

**One Critical, six High and one test-honesty finding were found and all are fixed**,
each with a regression test that fails if the fix is removed:

- **C1** — `npm run test` had been **red at every commit of the phase** and was
  reported green. 11 audit actions and 3 events were added to the controlled catalogs
  without extending the foundation allow-lists. The count in the checkpoint was right;
  the outcome line was never read.
- **H1** — the branch scope check was **skippable by omitting a query parameter**. The
  same principal was refused branch A1 (403) and served A1 with the parameter left out
  (200). `companyId` + `branchId` are now required on all three branch-scoped reads.
- **H2** — a 0.001-unit damage destroyed an arbitrarily large reservation, unaudited
  and unpublished, because `inv.free_reservations_for_loss` releases whole rows.
- **H3** — `stock.movement.posted` was published for issues only, contradicting the
  event catalog and the change log.
- **H4** — `release()` decided from an unlocked pre-read, so a concurrent issue
  produced an audit record and an event for a release that never happened.
- **H5** — quarantined (damaged) stock could be **reserved and issued back onto a
  customer's vehicle**, invisibly, because availability excludes quarantine by default.
- **H6** — an **incoherent (company, branch) pair disclosed another company's stock**.
  H1's fix was complete at the service layer and incomplete at the SQL layer:
  availability and movements filter on `company_id` AND `branch_id`, the reconciliation
  read filtered on `branch_id` alone. Since `iam.has_permission_in_scope` matches
  company **or** branch, a company-scoped grant passes the check while naming a branch
  of a different company. Measured: `200` with one cell — the other company's SKU and
  `storedOnHand` `7.000` — against `items: []` from availability on the identical query
  string.
- **T1** — `idempotency` was declared for two operations with no replay test behind it.

Evidence defects fixed too: random-UUID "cross-tenant" proofs replaced with a real
tenant-B row; a quarantine assertion that was vacuous in both directions; two false
claims in the gate's own header; five documentary tasks given structural proofs —
which closes the mutation where deleting the CI step kept the gate green, **verified
by performing that deletion and watching the gate fail**.

Full adjudication: `docs/phase-1/phase-1-21/review-adjudication.md`.

**Unresolved Critical: 0. Unresolved High: 0.**

## Protected-contract mitigations

Three defects in the frozen Phase 1-10 functions were reproduced against a live
database _before_ any code was written, and are closed in application code because no
migration is authorized:

- `inv.issue_part` posts the `out` movement **before** consuming the reservation, so
  issuing against a reservation covering all available stock trips
  `ck_stock_balances_available`. The repository composes the same granted primitives
  in the order the constraints permit.
- It reads `wo.work_orders.state` and never checks it, so a `draft` work order
  accepted an issue.
- It consumes whatever reservation id it is handed, including one belonging to a
  different item.

These are recorded as protected-contract mitigations and change-control candidates,
not as silently fixed database behaviour.

## Accepted limitations

Recorded in the checkpoint and the change log, none blocking: the scheduled
`inv.expire_reservations` caller is not built (`inv.reserve_stock` expires
opportunistically); the database closure guard still raises only B1–B6, so the
inventory closure blocker is enforced in the application because extending
`wo.guard_work_order_closure` needs a migration; and the Medium/Low findings listed in
the adjudication that are not merge-blocking.

## Scope

No Benzene hard-coding, no Zoom functionality, no P1-22 work, no new product naming,
no unapproved country/tax/currency/retention defaults. Product name remains
`[PRODUCT NAME — Pending Final Approval]`.
