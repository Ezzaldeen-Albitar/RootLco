# Transaction and Concurrency Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Active — binding for all database work from Phase 1-2 onward ·
**Date:** 2026-07-16 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
technical self-review, never to be described as independent review) ·
**Task IDs:** P1-02-DB-012 (transactions and concurrency), P1-02-DB-013
(idempotency storage pattern) ·
**Related:** [Database Architecture](./database-architecture.md) ·
[RLS Standard](./rls-standard.md) ·
[Number Sequence Standard](./number-sequence-standard.md) ·
[Role and Grant Standard](./role-and-grant-standard.md) ·
[Naming Standard](./database-naming-standard.md) ·
[Retention and Sensitive-Data Standard](./retention-and-sensitive-data-standard.md)

Verified basis: PostgreSQL 17.6 (Supabase local stack, DB port 54322), migrations
`0001`–`0003` under `supabase/migrations/`, and the database test suite — **all 61
tests passing on 2026-07-16** via `npm run test:db` (vitest + `pg`), with every
isolation and concurrency assertion executed as the login `rootlco_test_runtime`
(member of `app_runtime`, no `BYPASSRLS`). Nothing in this document is claimed
beyond what those files and tests demonstrate; where a rule binds a **future**
phase, that is stated explicitly.

Phase 1-2 creates **no business-domain tables**. This standard therefore defines
_how_ every later phase must write transactional code; the only permanent
transactional object that exists today is `shared.number_sequences` with
`shared.next_display_number()` (migration `0003`), which serves as the reference
implementation for row locking and transactional allocation.

---

## 1. The atomicity rule — one business change, one transaction

**Rule (binding on every phase that creates business operations).** A business
state change and _everything that evidences or completes it_ must commit in the
**same database transaction**:

1. the business row change itself (e.g. a status column update);
2. the append-only **status-history row** recording the transition
   (`from_state` / `to_state` / `reason` / `actor_id` / `occurred_at` /
   `correlation_id` — the pattern proven in `tests/db/patterns.test.ts`);
3. any **audit evidence** rows the operation is required to produce;
4. the **idempotency completion** (marking the idempotency key `completed` and
   storing the response snapshot — Section 8);
5. any **display-number allocation** consumed by the change —
   `shared.next_display_number()` deliberately runs in the _caller's_
   transaction for exactly this reason (see Section 2);
6. _(future)_ the **outbox entry** for any event that must be published because
   the change happened. No outbox table or messaging infrastructure exists in
   Phase 1; when a later phase introduces one, the outbox row must be written in
   the same transaction as the state change, and a separate dispatcher delivers
   it after commit. Publishing directly from inside the transaction (or after it,
   without an outbox) is prohibited because it creates hidden partial success.

**Rationale.** If any of these commits separately, a crash or rollback between
them produces a state the business cannot explain: a document with no history, a
number issued for a document that does not exist, an idempotency key that claims
completion for work that was rolled back. PostgreSQL gives atomicity for free
inside one transaction; the standard simply forbids giving it away.

**Prohibited:** autocommit-per-statement for multi-step operations; "best
effort" follow-up writes after commit; catching an error, discarding it, and
committing the remainder ("hidden partial success"). If part of the bundle
fails, the whole transaction must roll back and the retry policy (Section 6)
applies.

Illustration — **Phase 1-3+ example**; `crm.quotations` and its history table do
not exist yet:

```sql
BEGIN;
-- Transaction-local context, resolved SERVER-SIDE from the authenticated
-- session (migration 0002 contract) — never from client-supplied identifiers.
SELECT set_config('app.tenant_id', '<tenant uuid>', true);
SELECT set_config('app.user_id',   '<actor uuid>',  true);

-- (a) idempotency claim (Section 8) ... then:

-- (b) business change, guarded by optimistic concurrency (Section 3)
UPDATE crm.quotations
SET status = 'submitted'
WHERE id = $1 AND record_version = $2;          -- rowCount must be 1

-- (c) display number, allocated in THIS transaction (commits or dies with it)
SELECT display_number FROM shared.next_display_number('quotation', $company_id);

-- (d) status-history row (append-only, same transaction)
INSERT INTO crm.quotation_status_history
  (tenant_id, quotation_id, from_state, to_state, actor_id, correlation_id)
VALUES ($tenant, $1, 'draft', 'submitted', $actor, $correlation);

-- (e) idempotency completion (Section 8), (f) future outbox entry ...
COMMIT;
```

---

## 2. Row locking standard — `SELECT ... FOR UPDATE`

**Rule.** Counter-like records — rows whose value is read, decided upon, and
written back (sequences, allocation cursors, quota counters) — must be accessed
with `SELECT ... FOR UPDATE` inside the transaction that consumes the value.
Read-then-write on such rows without a lock is prohibited: under the default
READ COMMITTED isolation, two transactions would read the same value and both
"succeed".

The reference implementation is `shared.next_display_number()` (migration
`0003`), which is `SECURITY INVOKER` (RLS applies in full — it is not a bypass),
takes the tenant **only** from `iam.current_tenant_id()` (no tenant parameter,
by design), and serialises on the sequence row:

```sql
SELECT * INTO v_row
FROM shared.number_sequences ns
WHERE ns.tenant_id = v_tenant_id
  AND ns.sequence_code = p_sequence_code
  AND ns.company_id IS NOT DISTINCT FROM p_company_id
  AND ns.branch_id  IS NOT DISTINCT FROM p_branch_id
FOR UPDATE;
```

### 2.1 Verified rollback semantics (tested, 2026-07-16)

Because the allocation runs in the **caller's** transaction:

- **Rollback re-issues the number.** A rolled-back allocation rolls back the
  `next_value` increment too; the next committed caller receives the _same_
  value the aborted transaction had taken. Proven in
  `tests/db/number-sequences.test.ts` ("a rolled-back allocation returns the
  number to the sequence"). No duplicate is possible — the aborted transaction
  never made its number visible to anyone.
- **Committed allocations form a gapless consecutive run.** In the mixed test,
  a third of 30 concurrent allocations roll back; the committed values are a
  gapless consecutive run and the counter durably advanced exactly once per
  commit.
- **Concurrency holds at the approved baseline.** 50 parallel workers on one
  sequence row produced 50 unique consecutive values — no duplicates, no lost
  values, counter advanced exactly 50.

**Gaps.** Rollbacks create no gaps. Gaps arise only from _business_ events
(voided documents, period resets) and are **tolerated, never renumbered** — see
the [Number Sequence Standard](./number-sequence-standard.md).

**Trade-off (accepted, documented).** Allocation serialises on the sequence
row: concurrent allocators for the same scope queue on the row lock. This is
the price of transactional, duplicate-free, rollback-safe numbering. Phases
whose throughput cannot tolerate this must raise a design decision — they must
not "fix" it by moving allocation outside the transaction.

### 2.2 Lock variant guidance

| Variant                  | Use                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FOR UPDATE`             | Default for counter-like rows and any row about to be updated/deleted based on what was read.                                                                                         |
| `FOR NO KEY UPDATE`      | Acceptable when the key columns will not change and concurrent `FOR KEY SHARE` (FK checks) should not block. Must be justified in review.                                             |
| `FOR UPDATE SKIP LOCKED` | Queue-consumer patterns only (e.g. a future outbox dispatcher): each worker takes unclaimed rows without queueing. Prohibited for sequences — skipping a sequence row is meaningless. |
| `FOR UPDATE NOWAIT`      | Only where the caller has a defined immediate-failure path. Prefer `lock_timeout` (Section 7) for uniform behaviour.                                                                  |

**Prohibited:** advisory locks as a substitute for row locks on tenant data
(they are invisible to RLS and to reviewers of the schema); table-level
`LOCK TABLE` in runtime paths; holding row locks across user interaction
(Section 4).

---

## 3. Optimistic concurrency — `record_version`

Every mutable controlled table carries `record_version integer NOT NULL DEFAULT 1`,
advanced by **exactly 1** per update by the shared `BEFORE UPDATE` trigger
`shared.touch_row_metadata()` (migration `0002`):

```sql
NEW.updated_at := now();
NEW.updated_by := iam.current_user_id();
NEW.record_version := OLD.record_version + 1;
```

The trigger computes `OLD.record_version + 1` itself, so a caller can neither
skip nor replay versions. It is attached per table by the migration that
creates the table (as `0003` does with `tg_number_sequences_touch_metadata`).

**Rule.** Every user-facing edit of a mutable controlled row must use the
expected-version template:

```sql
UPDATE org.companies                     -- Phase 1-3+ illustration
SET legal_name = $2
WHERE id = $1
  AND record_version = $3;               -- version the client last read
```

The application must check the driver's affected-row count:

- `rowCount = 1` — success; the trigger has advanced `record_version` to
  `$3 + 1`. Return the new version to the client.
- `rowCount = 0` — the row changed since it was read, is soft-deleted, or is
  not visible under RLS. The application must **reload, re-validate, and either
  retry or surface a conflict to the user**. It must never blind-retry the same
  `UPDATE`, and it must never fall back to an unconditioned `UPDATE` "to make
  it work" — that is precisely the lost update the mechanism exists to prevent.

**Rationale.** Optimistic concurrency protects long-lived read-modify-write
cycles (a user editing a form) where holding a row lock is impossible.
Pessimistic locking (Section 2) protects short in-transaction cycles. Each
table uses the one that matches its access pattern; counter-like rows use
`FOR UPDATE`, user-edited business rows use `record_version`.

---

## 4. Deadlock avoidance

**Rules (binding).**

1. **Fixed lock ordering.** When a transaction must lock rows in more than one
   table, it must acquire locks in a fixed, documented order: **parents before
   children** (e.g. company before branch before document before document
   lines). When it must lock several rows of the same table, it must lock them
   in **ascending key order** (lower-sorted keys first — e.g. iterate ids
   sorted ascending before `SELECT ... FOR UPDATE`). Two transactions that
   respect the same total order cannot deadlock with each other.
2. **Keep transactions short.** A transaction spans one business operation —
   open it, do the work, commit. Batch jobs must chunk their work into bounded
   transactions rather than holding locks across millions of rows.
3. **No user interaction inside a transaction.** A transaction must never stay
   open while waiting for user input, an external HTTP call, or any
   non-database wait. The read happens in one transaction; the user thinks; the
   write happens in a new transaction guarded by `record_version` (Section 3).
4. Lock only what will be written. Broad `FOR UPDATE` over rows that are merely
   read inflates the deadlock surface.

Deadlocks that still occur despite ordering (e.g. against a background job) are
handled by the retry policy — PostgreSQL detects them and kills one victim with
SQLSTATE `40P01`.

---

## 5. Isolation levels

**Rule.** The platform default is **READ COMMITTED**, and code must be written
to be correct at READ COMMITTED. This suffices because correctness never rests
on isolation level alone:

- lost updates on counter-like rows are prevented by explicit `FOR UPDATE`
  (Section 2 — proven under 50-way concurrency at READ COMMITTED);
- lost updates on user-edited rows are prevented by `record_version`
  (Section 3);
- invariants are enforced by declared constraints — unique / partial unique,
  composite tenant FKs, `CHECK`, and `EXCLUDE USING gist` overlap constraints —
  which hold regardless of isolation level (all proven in the test suite).

**SERIALIZABLE is reserved** for cases where a multi-row invariant genuinely
cannot be expressed as a constraint or protected by explicit locking. Each such
use must be documented (where, why, and the retry handling), and the code path
must treat SQLSTATE `40001` as a normal, retryable outcome. No such case exists
in Phase 1-2. REPEATABLE READ may be used for internally consistent multi-query
_reads_ (reports); writers must not rely on it as a locking substitute.

---

## 6. Retry policy

**Rule.** Retries operate on **whole transactions**, never on individual
statements — after an error the transaction is aborted and must be rolled back
and restarted from `BEGIN` (including re-issuing the `set_config` context calls,
which are transaction-local and evaporate at rollback — proven in the test
suite).

| SQLSTATE | Meaning                                             | Policy                                                                                                    |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `40001`  | `serialization_failure`                             | Retryable.                                                                                                |
| `40P01`  | `deadlock_detected`                                 | Retryable.                                                                                                |
| `55P03`  | `lock_not_available` (from `lock_timeout`)          | Retryable, bounded — persistent contention is a design signal, not a retry problem.                       |
| `57014`  | `query_canceled` (from `statement_timeout`)         | Not blind-retried. Investigate: the statement exceeded its budget.                                        |
| `23505`  | `unique_violation`                                  | Not retryable as-is. Either the idempotency signal (Section 8) or a genuine business conflict to surface. |
| `42501`  | `insufficient_privilege` (RLS/grant/context denial) | Never retried. A context or authorisation defect — fail loudly.                                           |

**Bounded retries with jitter.** A bounded attempt count (recommended default:
3 attempts total) with exponential backoff and randomised jitter, so competing
retriers do not re-collide in lockstep. Unbounded retries are prohibited.

**Idempotency guard first.** Before any retry of an operation that has
side effects, the idempotency key (Section 8) must be consulted: if the first
attempt actually committed (e.g. the error struck after commit, or a network
failure hid a success), the retry must **replay the stored response, not
re-execute**. Retrying without the guard is how duplicate invoices happen.

---

## 7. `lock_timeout` and `statement_timeout`

**Rule.** User-facing transaction paths must set both, **per transaction**,
with `SET LOCAL` so the values die with the transaction and cannot leak across
pooled connections:

```sql
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
-- ... work ...
COMMIT;
```

**Fail fast and retry (Section 6) rather than queue forever.** A user request
stuck behind a lock for tens of seconds is a worse outcome than a fast, clean
`55P03` followed by a jittered retry or an honest error. Batch/administrative
jobs may set larger budgets, explicitly, in their own transactions.

The values above are the recommended starting defaults for interactive paths;
they must be tuned against real measurements once application endpoints exist
(Phase 1-13+). **Honest note:** no cluster- or role-level default is configured
by migrations `0001`–`0003`, and no application layer exists yet to apply the
per-transaction settings — this rule binds future phases and is not yet
exercised by the test suite.

---

## 8. The idempotency storage pattern (P1-02-DB-013)

### 8.1 Status and honesty

The **permanent table is deliberately NOT created in Phase 1-2** — no business
operation exists to be idempotent yet. The pattern is **pinned** by this
standard and by executable tests
(`tests/db/patterns.test.ts`, "idempotency-key storage pattern"), which prove
the semantics against a disposable fixture in the `p1_02_test` schema (created
and dropped by the suite). Implementation lands with the first phase that ships
a business operation, and must match this section exactly.

**Honest evidence note:** the fixture assertions in `patterns.test.ts` run
through the harness admin connection and prove the **constraint and replay
semantics** (unique violation, fingerprint comparison, tenant independence,
expiry-as-data). They are not RLS evidence, and the fixture table carries no
policies. The permanent table must add full RLS per Section 8.4 and prove it
under the runtime role, per the [RLS Standard](./rls-standard.md).

### 8.2 DDL of the future `shared.idempotency_keys`

Exactly as pinned by the tested fixture (naming per the
[Naming Standard](./database-naming-standard.md)):

```sql
CREATE TABLE shared.idempotency_keys (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  idempotency_key     text        NOT NULL,
  request_fingerprint text        NOT NULL,
  operation_name      text        NOT NULL,
  status              text        NOT NULL DEFAULT 'in_progress',
  response_snapshot   jsonb       NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  completed_at        timestamptz NULL,
  CONSTRAINT pk_idempotency_keys PRIMARY KEY (id),
  CONSTRAINT uq_idempotency_keys_tenant_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ck_idempotency_keys_status
    CHECK (status IN ('in_progress', 'completed', 'failed'))
);
```

Notes:

- `uq_idempotency_keys_tenant_key` is the load-bearing control **and** the
  tenant-leading access index (per the index rules — no duplicate index is
  added for it).
- `gen_random_uuid()` is native PostgreSQL (13+); pgcrypto is **not** used for
  UUIDs. pgcrypto (`extensions.digest` / `hmac`, migration `0001`) is the
  approved primitive for computing `request_fingerprint`: a deterministic
  SHA-256 over the **canonicalised** request payload (stable field order,
  normalised encoding), computed in the application layer or via
  `encode(extensions.digest($canonical_bytes, 'sha256'), 'hex')`.
- `response_snapshot` is `jsonb` because the stored response genuinely has no
  relational structure — a documented exception under the data-type standard.
- `status` is `text` + `CHECK`, never a PostgreSQL enum (volatile business
  set). Lifecycle: `in_progress` → `completed` (with `response_snapshot` and
  `completed_at` set) or `failed`.
- When later phases FK `tenant_id` to `org.tenants`, the same honest rule as
  `shared.number_sequences` applies: the FK is added in/after Phase 1-3 when
  `org.*` exists.

### 8.3 Semantics (tested)

| Situation                                           | Behaviour                                                                                                                                                                                                                                             | Evidence                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| First request (tenant + key unseen)                 | Row inserted `in_progress`; operation executes; completion stores `response_snapshot`, `status = 'completed'`, `completed_at` — in the **same transaction** as the business change (Section 1).                                                       | Tested (insert + completed snapshot).         |
| Same tenant + same key + **same fingerprint**       | **Replay the original `response_snapshot`. Never re-execute.**                                                                                                                                                                                        | Tested (fingerprint match + snapshot replay). |
| Same tenant + same key + **different fingerprint**  | **Conflict** (HTTP 409/422 semantics). Never execute, never replay — the client reused a key for a different request.                                                                                                                                 | Tested (fingerprint mismatch detected).       |
| Same tenant + same key, concurrent second insert    | `23505` on `uq_idempotency_keys_tenant_key` stops the second execution.                                                                                                                                                                               | Tested (unique violation).                    |
| Same key, **different tenants**                     | Fully independent — keys are tenant-scoped, never global.                                                                                                                                                                                             | Tested.                                       |
| Row past `expires_at`                               | Expiry is **data**, not deletion: the row remains until the controlled cleanup job removes it.                                                                                                                                                        | Tested (expiry queried as data).              |
| Row `status = 'in_progress'` encountered by a retry | The first attempt may still be running: respond "in progress / retry later". Taking over an `in_progress` row is only permitted through an explicit, documented staleness rule (e.g. `created_at` far past the operation's statement-timeout budget). | Binding rule (not fixture-tested).            |
| Row `status = 'failed'`                             | A retry with the same key **and same fingerprint** may re-execute by atomically re-claiming the row (`UPDATE ... SET status = 'in_progress' WHERE status = 'failed'`).                                                                                | Binding rule (not fixture-tested).            |

Tested reusable snippets (from `tests/db/patterns.test.ts`, table name adjusted
to the permanent target):

```sql
-- Claim / completion write (first request):
INSERT INTO shared.idempotency_keys
  (tenant_id, idempotency_key, request_fingerprint, operation_name,
   status, response_snapshot, expires_at, completed_at)
VALUES ($1, $2, $3, 'create_thing', 'completed', '{"result":"ok"}',
        now() + interval '24 hours', now());

-- Duplicate detection: same tenant + key → SQLSTATE 23505 on
-- uq_idempotency_keys_tenant_key; the caller then runs the replay lookup:

SELECT response_snapshot,
       request_fingerprint = $3 AS fingerprint_matches
FROM shared.idempotency_keys
WHERE tenant_id = $1 AND idempotency_key = $2;
-- fingerprint_matches = true  → return response_snapshot (replay)
-- fingerprint_matches = false → 409/422 conflict; never execute
```

### 8.4 Controls the permanent table must ship with

- **RLS `ENABLE` + `FORCE`**, default deny; `sel_` / `ins_` / `upd_` policies
  scoped to `tenant_id = iam.current_tenant_id()` with `WITH CHECK` on writes;
  **no DELETE policy or grant for runtime roles** — cleanup is administrative.
- Grants per the [Role and Grant Standard](./role-and-grant-standard.md):
  `SELECT, INSERT` plus column-restricted
  `UPDATE (status, response_snapshot, completed_at)` to `app_runtime`;
  `SELECT` to `app_readonly`.
- **Expiry and cleanup** belong to the _temporary_ retention class: removal of
  expired rows runs as the controlled, audited deletion job defined in the
  [Retention and Sensitive-Data Standard](./retention-and-sensitive-data-standard.md)
  — never ad-hoc SQL, honouring legal hold. `expires_at` (e.g. 24 hours for
  API idempotency windows) is a per-operation configuration value, never a
  hard-coded jurisdictional assumption.
- Behavioural proof re-run as the runtime role (`rootlco_test_runtime`
  pattern), since the Phase 1-2 fixture evidence is constraint-level only
  (Section 8.1).

---

## 9. Verification evidence and honest gaps

**Evidence (2026-07-16, real system).** Migrations `0001`–`0003` applied to a
clean database; 68/68 tests passing via `npm run test:db`. Directly relevant to
this standard: transaction-local context evaporates at `ROLLBACK`; rolled-back
allocation re-issues its number; 50-worker single-row concurrency with zero
duplicates/loss; 30-allocation mixed commit/rollback run staying gapless; the
regression-guard trigger blocking `next_value` rewinds without a period change;
append-only history denying runtime `UPDATE`/`DELETE` (`42501`); the
idempotency fixture semantics of Section 8.3. CI re-runs the full suite against
`postgres:17-alpine` on every change (`.github/workflows/ci.yml`).

**Honest gaps.**

- Results obtained as the `postgres` role are never RLS evidence — in the local
  stack `postgres` is not superuser but holds `BYPASSRLS` (measured); in the
  plain CI container it _is_ superuser. All isolation claims above rest on the
  runtime-role tests only.
- CI runs plain PostgreSQL 17, not the full Supabase stack; Supabase-managed
  roles differ there. Documented and accepted.
- `shared.idempotency_keys` does not exist yet (deliberate — Section 8.1); the
  outbox pattern is future-phase; timeout defaults (Section 7) are not yet
  applied by any running application; `tenant_id` FKs arrive with `org.*` in
  Phase 1-3.
- Retry policy, deadlock ordering, and isolation rules are binding design rules
  for future application code; they are not independently exercised by the
  Phase 1-2 suite beyond the concurrency and rollback behaviour listed above.

All future tenant behaviour — including the first pilot tenant, Benzene Vehicle
Services — is reached through configuration under these rules; nothing in this
standard is tenant-specific and no tenant is hard-coded.
