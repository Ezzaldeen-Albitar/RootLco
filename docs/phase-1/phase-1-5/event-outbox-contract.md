# Phase 1-5 — Event Outbox Contract

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-5 · **Date:** 2026-07-18 ·
**Author:** Eng. Ezzaldeen Al-Bitar

> **Amendment — 2026-07-21,
> [DBCR-P1-13-001](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md).**
> The producer grant this contract described as a later-phase decision now exists. Migration
> `20260725090000_iam_shared_runtime_write_capabilities.sql` gives `app_runtime` tenant-scoped
> SELECT and INSERT on `shared.event_outbox` under `sel_event_outbox_producer` and
> `ins_event_outbox_producer`. Nothing else in the contract moved: the envelope, the guard trigger,
> the claim/complete/fail semantics, and the worker's exclusive hold on the three lifecycle
> functions are unchanged. §6 carries the amended access model.

## 1. Scope

The transactional-outbox database contract — `shared.event_outbox`, the
`app_worker` role archetype, and the three atomic lifecycle functions
`shared.claim_outbox_events`, `shared.complete_outbox_event`, and
`shared.fail_outbox_event` — created by migration
`20260718106000_shared_event_outbox.sql`. The consumer-side at-most-once
registry (`shared.processed_events`, migration `20260718107000`) completes the
pipeline's other end and is summarized in §7.

**This is a database contract only. No publisher process, no worker process,
no broker or transport integration, and no consumer framework is
implemented** — Phase 1-6 is not started. The functions exist and are tested;
nothing calls them in production.

## 2. Event envelope

`shared.event_outbox` persists one durable, tenant-owned integration-event
envelope per row:

| Field                                    | Contract                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `event_key`                              | Caller-supplied idempotent identity, non-blank, ≤ 255 chars, `UNIQUE (tenant_id, event_key)`                                 |
| `event_type` / `aggregate_type`          | Machine-readable, format `^[a-z][a-z0-9_.-]{1,62}$`                                                                          |
| `aggregate_id`                           | Opaque UUID of the originating aggregate; no generic cross-domain FK is possible                                             |
| `schema_version`                         | Payload contract version consumers use to interpret the event; integer ≥ 1                                                   |
| `aggregate_version`                      | Optimistic-concurrency version of the source aggregate when the event occurred; integer ≥ 1                                  |
| `producer`                               | Producing component identity, same format rule                                                                               |
| `occurred_at`                            | Business occurrence time, defaults to `now()`                                                                                |
| `correlation_id` / `causation_id`        | Optional UUIDs for tracing a flow and the direct cause event                                                                 |
| `payload` / `headers`                    | Must be JSON **objects** (`jsonb_typeof = 'object'`); see [event-payload-security-rules.md](event-payload-security-rules.md) |
| `tenant_id` / `company_id` / `branch_id` | Composite org FKs; a branch requires its company; scope cannot drift across tenants or companies                             |

Lifecycle state lives beside the envelope: `status ∈
pending|claimed|published|dead_letter`, `available_at`, `attempt_count`,
`claimed_at`/`claimed_by`, `published_at`, `last_error`, with pairing CHECKs
(`claimed` ⇔ both claim stamps, `published` ⇔ `published_at`, `dead_letter`
requires non-blank `last_error`).

## 3. Producer contract — same transaction, honest initial state

- A producer MUST insert the outbox row **in the same database transaction
  that commits the originating business change**. That atomicity is the reason
  the table exists: a rollback removes both the change and the event, and a
  commit durably owes the event to downstream consumers.
- Direct INSERT cannot forge lifecycle state. The
  `tg_event_outbox_guard_initial_state` trigger requires `pending`,
  `attempt_count` 0, and NULL claim/publish/error fields — even a
  CHECK-consistent set of forged stamps is rejected.
- `event_key` gives producers tenant-scoped insert idempotency: replaying the
  same key is a `23505`, not a second event. Synthetic example:
  `fx_vehicle_intake_fx_0001`.

## 4. Claim / complete / fail semantics

All three functions are `SECURITY INVOKER`, validate the claimant token
against `^[a-z][a-z0-9_.-]{1,62}$` (synthetic example: `fx_dispatch_worker_a`),
and are executable by `app_worker` only.

- **Claim** — `claim_outbox_events(p_claimant, p_limit, p_lease default
'5 minutes')` is one UPDATE over a `FOR UPDATE SKIP LOCKED` candidate
  subquery, so there is no read-then-write race and parallel workers claim
  disjoint sets. Eligible rows are **due pending** (`status = 'pending' AND
available_at <= now()`) or **stale claimed** (`status = 'claimed' AND
claimed_at < now() - p_lease`). Claiming stamps `claimed_at`/`claimed_by`
  and increments `attempt_count`.
- **Lease and stale reclaim.** A claim is a lease, not permanent ownership. If
  a worker dies, its rows become claimable by any claimant after the lease
  elapses, and the reclaim increments `attempt_count` again — abandoned work
  still counts against the retry budget.
- **Unordered RETURNING.** Candidate selection is deterministic
  (`ORDER BY available_at, occurred_at, id`), but the claimed set is returned
  through UPDATE ... RETURNING, whose order is **deliberately unspecified**.
  Callers MUST treat the result as an unordered set and MUST NOT infer
  dispatch order from it.
- **Complete** — `complete_outbox_event(p_id, p_claimant)` is one conditional
  UPDATE bound to `status = 'claimed' AND claimed_by = p_claimant`. It stamps
  `published_at` and clears both claim fields; if no row matches — wrong
  claimant, expired-and-reclaimed lease, or terminal row — it raises. A
  different worker can never finalize someone else's claim.
- **Fail** — `fail_outbox_event(p_id, p_claimant, p_error, p_retry_in,
p_max_attempts)` is claimant-bound the same way and requires a non-blank
  sanitized `p_error`. Below the attempt budget it returns the row to
  `pending` with `available_at = now() + p_retry_in`; at or above it
  (`attempt_count` already includes the failed attempt) it dead-letters the
  row. Both paths clear the claim fields and persist `last_error`.

## 5. Retry and dead-letter

Retries are due-time gated: a failed row is not claimable again until its
scheduled `available_at`. `published` and `dead_letter` are terminal and are
never reclaimed — the claim eligibility predicate simply cannot match them. A
dead-letter row always carries a non-blank `last_error`. Operator re-drive of
dead-letter rows is a deliberately deferred later-phase concern; no such
function exists.

## 6. Access model — all-tenant dispatch, tenant-scoped production

- `app_worker` is a NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
  NOREPLICATION, NOBYPASSRLS archetype. **No standing LOGIN credential is
  created in this phase**; a later phase supplies one, and it must be
  backend-only, tightly held, and monitored.
- On `shared.event_outbox` the role holds SELECT/INSERT/UPDATE (never DELETE)
  plus EXECUTE on the three functions and on `iam.current_user_id()`. PUBLIC
  execute is revoked from every routine.
- The `wkr_event_outbox_all` policy (`USING true / WITH CHECK true`)
  deliberately spans all tenants: infrastructure dispatch cannot depend on a
  user tenant session. This is not BYPASSRLS — FORCE RLS stays on — and the
  Phase 1-5 adversarial review (2026-07-18) probe-verified that the all-tenant
  surface is confined to the enumerated worker tables.
- As delivered in Phase 1-5, `app_runtime` and `app_readonly` had **zero**
  grant and **zero** policy on the table and functions. Since DBCR-P1-13-001
  (2026-07-21) `app_runtime` holds SELECT and INSERT on the table under two
  policies scoped `tenant_id = iam.current_tenant_id()` — a producer writes and
  reads back its own tenant's envelopes and no others. It holds **no** UPDATE,
  DELETE, or TRUNCATE and **no** EXECUTE on the three lifecycle functions, so it
  cannot claim, complete, fail, or dead-letter anything: producing an event and
  draining the queue stay separate powers held by separate roles.
  `app_readonly` remains at zero grant and zero policy; its SELECT attempts
  still fail with `42501`, as do every runtime EXECUTE attempt on the three
  functions and every runtime UPDATE or DELETE on the table.

## 7. Consumer-side pairing — `shared.processed_events`

Delivery is at-least-once, so consumers must be idempotent.
`shared.processed_events` (`PRIMARY KEY (consumer_code, event_id)`,
append-only, worker SELECT/INSERT only) is the atomic-claim registry: a
consumer claims with `INSERT ... ON CONFLICT DO NOTHING RETURNING` and
performs the side effect **only** when the statement returns a row. A `failed`
outcome still owns the claim and blocks automatic reprocessing; operator
intervention is a later-phase concern.

## 8. Evidence

`tests/db/shared-event-outbox.test.ts` (13 tests at the Phase 1-5 closeout;
extended by DBCR-P1-13-001 to assert the amended surface) exercises duplicate
event-key rejection, envelope CHECKs, role-boundary denials (readonly SELECT,
runtime EXECUTE on the lifecycle functions, runtime UPDATE and DELETE, worker
DELETE) and the tenant-scoped producer surface, claim stamping and attempt
accounting, disjoint parallel claims across two worker connections,
stale-lease reclaim by a different claimant, wrong-claimant complete/fail
raising, retry scheduling and its due-time gate, dead-letter at the attempt
budget, and that terminal rows are never reclaimed.
`tests/db/shared-processed-errors.test.ts` proves exactly one of two
concurrent registry claimants receives a row. The suite runs via
`npm run test:db`; the CI result on the final SHA is owner-verifiable (the
closeout PR is not opened and the owner gate is Pending).
