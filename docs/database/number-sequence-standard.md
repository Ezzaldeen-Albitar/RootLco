# Number Sequence and Display Number Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Adopted — binding for Phase 1-2 and every later phase ·
**Date:** 2026-07-16 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
technical self-review, not an independent review) ·
**Tasks:** P1-02-DB-004 / P1-02-DB-019 ·
**Implemented by:** [`supabase/migrations/0003_number_sequences.sql`](../../supabase/migrations/0003_number_sequences.sql) ·
**Verified by:** [`tests/db/number-sequences.test.ts`](../../tests/db/number-sequences.test.ts)
(part of the 68-test suite, all passing on 2026-07-16 via `npm run test:db`) ·
**Related:** [Database Architecture](./database-architecture.md) ·
[RLS Standard](./rls-standard.md) ·
[Role and Grant Standard](./role-and-grant-standard.md) ·
[Naming Standard](./database-naming-standard.md) ·
[ADR-008 — Configuration-Driven Tenant Onboarding](../adr/ADR-008-configuration-driven-tenant-onboarding.md) ·
[ADR-009 — Benzene as First Configured Pilot Tenant](../adr/ADR-009-benzene-as-first-configured-pilot-tenant.md)

---

## 1. Why display numbers exist

Every row in the platform is identified internally by a UUID
(`gen_random_uuid()`, native in PostgreSQL 13+). UUIDs are the right primary
key for a multi-tenant system, but they are **internal identifiers only**:

- **UUIDs must never be shown to humans.** A customer, mechanic, or accountant
  reads "INV-2026-000042", never `3f2a…`. Human-facing documents issued by
  later phases (quotation numbers, work-order numbers, invoice numbers) must
  carry a display number allocated by this standard.
- **UUIDs are never authorization tokens.** Knowledge of an ID — UUID or
  display number — never grants access. Every read and write is authorised by
  Row-Level Security against the server-resolved tenant context (see the
  [RLS Standard](./rls-standard.md)), not by possession of an identifier.
- **Display numbers must never be primary keys or foreign keys.** They are
  presentation data with business meaning (sequence, period, scope). Rows are
  related by UUID; the display number is a column on the issuing document.

Phase 1-2 therefore delivers the numbering _mechanism_ only:
`shared.number_sequences` and `shared.next_display_number()`. No
business-domain table exists in Phase 1-2 and none consumes a number yet;
the phases that create document tables (Phase 1-3 onward) must allocate their
display numbers exclusively through this mechanism. Ad-hoc numbering
(`max(number) + 1`, application counters, PostgreSQL `SEQUENCE` objects shared
across tenants) is prohibited.

## 2. The `shared.number_sequences` design

The table lives in the `shared` schema because numbering is a cross-module
primitive owned by no single module (see migration
[`0002_base_schemas.sql`](../../supabase/migrations/0002_base_schemas.sql)).
The definition below mirrors migration 0003 exactly.

### 2.1 Columns

| Column              | Type          | Null     | Default             | Meaning                                                                                                        |
| ------------------- | ------------- | -------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `id`                | `uuid`        | NOT NULL | `gen_random_uuid()` | Surrogate primary key. Internal only.                                                                          |
| `tenant_id`         | `uuid`        | NOT NULL | —                   | Owning tenant. Every sequence belongs to exactly one tenant.                                                   |
| `company_id`        | `uuid`        | NULL     | —                   | Optional narrowing to one company within the tenant.                                                           |
| `branch_id`         | `uuid`        | NULL     | —                   | Optional narrowing to one branch. Requires `company_id` (see §3).                                              |
| `sequence_code`     | `text`        | NOT NULL | —                   | Logical sequence name, e.g. `invoice`. Format-checked (see §2.2).                                              |
| `prefix_template`   | `text`        | NOT NULL | `''`                | Literal prefix rendered before the padded value. Supported token: `{period}` (see §7).                         |
| `next_value`        | `bigint`      | NOT NULL | `1`                 | Next value to issue. Read and advanced **only** under `SELECT … FOR UPDATE` by `shared.next_display_number()`. |
| `pad_width`         | `integer`     | NOT NULL | `6`                 | Zero-padding width, `0..18`. `0` means no padding.                                                             |
| `period_reset_rule` | `text`        | NOT NULL | `'never'`           | One of `never` / `yearly` / `monthly` / `daily` (CHECK-constrained text, not an enum — data-type standard).    |
| `current_period`    | `text`        | NULL     | —                   | Period key of the last allocation (e.g. `2026`, `2026-07`). `NULL` for never-resetting sequences.              |
| `record_version`    | `integer`     | NOT NULL | `1`                 | Optimistic-concurrency version, advanced exactly 1 per update by `shared.touch_row_metadata()`.                |
| `created_at`        | `timestamptz` | NOT NULL | `now()`             | Base metadata standard.                                                                                        |
| `created_by`        | `uuid`        | NOT NULL | —                   | Provisioning actor.                                                                                            |
| `updated_at`        | `timestamptz` | NULL     | —                   | Set by the metadata trigger.                                                                                   |
| `updated_by`        | `uuid`        | NULL     | —                   | Set by the metadata trigger from `iam.current_user_id()`.                                                      |

**Honest note on referential integrity:** `tenant_id`, `company_id`, and
`branch_id` carry **no foreign keys yet**, because the `org.*` tables they will
reference do not exist until Phase 1-3. The FKs are added by the Phase 1-3
migration that creates those tables; until then the columns are constrained
only by NOT NULL / the scope checks below. This gap is recorded in the table's
`COMMENT ON` and in the data dictionary, and must not be silently forgotten.

### 2.2 Constraints (named per the [Naming Standard](./database-naming-standard.md))

| Constraint                                    | Kind        | Rule                                                                                                                                                                                                               |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pk_number_sequences`                         | PRIMARY KEY | `(id)`                                                                                                                                                                                                             |
| `uq_number_sequences_scope`                   | UNIQUE      | `NULLS NOT DISTINCT (tenant_id, sequence_code, company_id, branch_id)` — exactly one row per scope (see §3). Doubles as the tenant-leading access index (index standard).                                          |
| `ck_number_sequences_code_format`             | CHECK       | `sequence_code ~ '^[a-z][a-z0-9_]{1,62}$'` — snake_case, 2–63 chars.                                                                                                                                               |
| `ck_number_sequences_next_value_positive`     | CHECK       | `next_value >= 1`                                                                                                                                                                                                  |
| `ck_number_sequences_pad_width_range`         | CHECK       | `pad_width BETWEEN 0 AND 18`                                                                                                                                                                                       |
| `ck_number_sequences_period_reset_rule`       | CHECK       | `period_reset_rule IN ('never','yearly','monthly','daily')`                                                                                                                                                        |
| `ck_number_sequences_never_has_no_period`     | CHECK       | `period_reset_rule <> 'never' OR current_period IS NULL` — a never-resetting sequence has no period, closing the rewind bypass where a writer invents a period change to satisfy the guard. Verified by test (§6). |
| `ck_number_sequences_branch_requires_company` | CHECK       | `branch_id IS NULL OR company_id IS NOT NULL`                                                                                                                                                                      |

### 2.3 Triggers

| Trigger                                | When          | Function                                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tg_number_sequences_touch_metadata`   | BEFORE UPDATE | `shared.touch_row_metadata()`               | Stamps `updated_at`/`updated_by`, advances `record_version` by exactly 1 (base metadata standard).                                                                                                                                                                                                                                                                                     |
| `tg_number_sequences_guard_regression` | BEFORE UPDATE | `shared.guard_number_sequence_regression()` | Blocks lowering `next_value` unless `current_period` changes legitimately; on never-resetting sequences ANY `current_period` change is rejected (hardening from the Phase 1-2 adversarial review — the UPDATE column grant covers both columns, so a writer could otherwise invent a period change to sneak a rewind past the guard). Raises SQLSTATE `23514`. Verified by tests (§6). |

The regression guard exists because rewinding a counter re-issues numbers that
may already appear on issued documents — a falsification risk, not merely a
bug. It is `SECURITY INVOKER` with `search_path = ''`, like every function in
the foundation.

### 2.4 Row-Level Security

RLS is **ENABLED and FORCED** — the table owner is not exempt unless the role
itself carries `BYPASSRLS` (the honest statement about superusers, the
`postgres` role's `BYPASSRLS` attribute, and Supabase-managed roles is in the
[RLS Standard](./rls-standard.md); nothing executed as `postgres` is ever
evidence that these policies work).

| Policy                        | Action | Roles                         | USING                                 | WITH CHECK                            |
| ----------------------------- | ------ | ----------------------------- | ------------------------------------- | ------------------------------------- |
| `sel_number_sequences_tenant` | SELECT | `app_runtime`, `app_readonly` | `tenant_id = iam.current_tenant_id()` | —                                     |
| `upd_number_sequences_tenant` | UPDATE | `app_runtime`                 | `tenant_id = iam.current_tenant_id()` | `tenant_id = iam.current_tenant_id()` |

There is deliberately **no INSERT policy and no DELETE policy** for runtime
roles, and no permissive fallback policy. With no tenant context,
`iam.current_tenant_id()` is `NULL` and the comparison matches no rows —
default deny.

### 2.5 Grants (least privilege)

| Grant                                                       | To                            | Why                                                                                             |
| ----------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `SELECT` on the table                                       | `app_runtime`, `app_readonly` | Reading sequence configuration within the tenant.                                               |
| `UPDATE (next_value, current_period)` — column-restricted   | `app_runtime`                 | The only columns the allocator writes. Metadata columns are written by the trigger.             |
| `EXECUTE` on `shared.next_display_number(text, uuid, uuid)` | `app_runtime`                 | The allocation entry point. Not granted to `app_readonly` (a read-only role must not allocate). |

No `INSERT` or `DELETE` grant exists for either runtime role: even if a policy
were mistakenly added later, the privilege layer independently refuses.
Verified by test — runtime `INSERT`/`DELETE` fail with SQLSTATE `42501`.

## 3. Scope model

A sequence row is identified by `(tenant_id, sequence_code, company_id,
branch_id)` under `UNIQUE NULLS NOT DISTINCT`. `NULLS NOT DISTINCT` matters:
without it, two rows with `company_id IS NULL` would not collide and a
tenant-wide sequence could silently be duplicated.

| Scope       | `company_id` | `branch_id` | Example use                                       |
| ----------- | ------------ | ----------- | ------------------------------------------------- |
| Tenant-wide | NULL         | NULL        | One numbering run across the whole tenant.        |
| Company     | set          | NULL        | Each legal entity numbers its own invoices.       |
| Branch      | set          | set         | Each workshop branch numbers its own work orders. |

Binding rules:

- **A branch-scoped sequence must state its company**
  (`ck_number_sequences_branch_requires_company`): a branch without a company
  is an undefined scope in the organisation model.
- **`tenant_id` is NOT NULL — no global cross-tenant sequence exists, and none
  may ever be created.** A "platform-wide" numbering run would leak allocation
  order across tenants and create a cross-tenant hot spot. Verified by test:
  tenant B's `ticket` sequence starts at 1 regardless of tenant A's position.
- The three scopes of the same `sequence_code` are **independent sequences**.
  A tenant that wants per-branch invoice numbering provisions branch rows and
  does not also allocate from a tenant-wide row of the same code.

## 4. Provisioning is configuration, never schema

Sequence rows are **tenant-onboarding configuration**
([ADR-008](../adr/ADR-008-configuration-driven-tenant-onboarding.md)). They
are inserted by the administrative provisioning path when a tenant (or a
company/branch within it) is onboarded — never by application runtime code and
never hard-coded in a migration.

- Runtime roles **deliberately cannot INSERT or DELETE** sequence rows
  (no policy, no grant — §2.4/§2.5). Creating or retiring a sequence is an
  administrative configuration action, executed and auditable on the
  migration/admin path.
- Migration 0003 seeds **no tenant rows**. `supabase/seed.sql` is intentionally
  empty of rows in Phase 1-2 (governance comments only) and must stay that way.
- **Benzene Vehicle Services** is the first configured pilot tenant
  ([ADR-009](../adr/ADR-009-benzene-as-first-configured-pilot-tenant.md)). A
  Benzene invoice sequence, when it exists, is **seed class 3 data** (tenant-
  specific controlled provisioning) delivered in a later controlled
  configuration package — it is never schema, never a migration literal, and
  it does not exist in Phase 1-2. Zoom Vehicle Inspection and Evaluation
  Services is outside Phase 1 entirely; no sequence may be defined for it.

Provisioning inserts must follow the seed standard: idempotent, deterministic,
and safe to rerun. Illustration of the future provisioning path (**Phase 1-3+
example — `org.*` tables and real tenant IDs do not exist in Phase 1-2**):

```sql
-- ILLUSTRATION ONLY (Phase 1-3+ provisioning path, administrative role).
-- Values come from the tenant's configuration package, never from code.
INSERT INTO shared.number_sequences
  (tenant_id, company_id, sequence_code, prefix_template,
   pad_width, period_reset_rule, created_by)
VALUES
  (:tenant_id, :company_id, 'invoice', 'INV-{period}-',
   6, 'yearly', :provisioning_actor_id)
ON CONFLICT ON CONSTRAINT uq_number_sequences_scope DO NOTHING;
```

## 5. Allocation: `shared.next_display_number()`

```sql
shared.next_display_number(
  p_sequence_code text,
  p_company_id    uuid DEFAULT NULL,
  p_branch_id     uuid DEFAULT NULL,
  OUT display_number text,
  OUT sequence_value bigint
) RETURNS record
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
```

Binding semantics (each verified — see §6):

1. **`SECURITY INVOKER`** — the function runs with the caller's rights. RLS
   applies in full; the function is not an RLS bypass and must never become
   one.
2. **The tenant comes exclusively from the server-resolved context**
   (`iam.current_tenant_id()`, reading transaction-local `app.tenant_id`).
   There is **no tenant parameter, by design**: a caller can never allocate
   into a tenant it merely names. With no tenant context the function raises
   SQLSTATE `42501` (`insufficient_privilege`).
3. **`p_company_id` / `p_branch_id` select a narrower sequence scope** and are
   validated against the session's allowed lists (`iam.allowed_company_ids()`
   / `iam.allowed_branch_ids()`) when those are set; a value outside the
   allowed list raises `42501`. They are scope selectors, not authorization —
   RLS remains the enforcement layer.
4. **`SELECT … FOR UPDATE` serialises allocation per sequence row.** Two
   transactions can never read the same `next_value`; concurrent allocators
   for the same scope queue on the row lock. An unknown or invisible sequence
   (including another tenant's row, hidden by RLS) raises SQLSTATE `P0002`
   (`no_data_found`) — provisioning is a configuration action, and the
   function never auto-creates rows.
5. **The function runs in the caller's transaction.** The allocation must be
   made in the **same transaction as the business write that consumes the
   number**, so the number and the document commit or roll back atomically.

Usage pattern (context is set server-side by the application layer; the
consuming document table is a Phase 1-3+ illustration):

```sql
BEGIN;
-- Transaction-local context, resolved server-side from the authenticated
-- session (see the RLS standard). Never from client-supplied identifiers.
SELECT set_config('app.tenant_id', '<tenant uuid>', true);
SELECT set_config('app.user_id',   '<actor uuid>',  true);

SELECT display_number, sequence_value
FROM shared.next_display_number('invoice', '<company uuid>');

-- ILLUSTRATION ONLY (Phase 1-3+): the document INSERT that consumes the
-- number happens here, in the SAME transaction.
COMMIT;
```

### Rollback semantics (verified)

Allocation is transactional. If the caller's transaction rolls back, the
increment of `next_value` rolls back with it, and the same value is re-issued
to the next caller:

- **No duplicate**: the aborted transaction never committed anything carrying
  the number, so re-issuing it is safe — verified by test (the next committed
  caller receives exactly the value the aborted transaction had taken).
- **No gap from rollbacks**: committed allocations form a gapless consecutive
  run — verified under concurrency with deliberate mixed rollbacks (§6).
- The trade-off is that the row lock is held from allocation until
  COMMIT/ROLLBACK — see the hot-spot risk in §10.3. Allocate as late in the
  transaction as practical.

## 6. Verified behaviour (test evidence, 2026-07-16)

All evidence below comes from the database test suite (**68 tests, all passing on 2026-07-16**, `npm run test:db`, vitest + `pg` against the local
Supabase PostgreSQL 17.6). Every isolation and allocation assertion runs as
the login `rootlco_test_runtime` (member of `app_runtime`, created by the
harness, never by migrations) — **never as `postgres`**, which carries
`BYPASSRLS` locally and would prove nothing. Fixtures use the deterministic
tenant UUIDs `aaaaaaaa-…` / `bbbbbbbb-…` and are cleaned up by the suite.

| #   | Verified behaviour                                     | Observed result                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sequential formatted issue                             | `T-0001`, then `T-0002` (prefix `T-`, pad 4).                                                                                                                                                                                      |
| 2   | Tenant independence — no global sequence               | Tenant B's first `ticket` number is `T-0001` regardless of tenant A's position.                                                                                                                                                    |
| 3   | No tenant context                                      | SQLSTATE `42501`.                                                                                                                                                                                                                  |
| 4   | Unknown sequence code                                  | SQLSTATE `P0002`.                                                                                                                                                                                                                  |
| 5   | Another tenant's sequence (RLS-hidden)                 | SQLSTATE `P0002` — indistinguishable from "not configured".                                                                                                                                                                        |
| 6   | Company narrowing enforced                             | Allocation against a company outside the session's `app.company_ids` list → `42501`; with the right company in scope → `C-0001`.                                                                                                   |
| 7   | Period reset + `{period}` rendering                    | Sequence positioned at `next_value = 42`, `current_period = '2020-01'` (admin fixture manipulation); the next runtime allocation in the current month issued value **1** rendered as `M<YYYY-MM>-001`.                             |
| 8   | Rollback returns the number                            | A rolled-back allocation's value is re-issued to the next committed caller — no duplicate, no gap.                                                                                                                                 |
| 9   | Regression guard                                       | Runtime `UPDATE … SET next_value = 1` without a period change → SQLSTATE `23514`.                                                                                                                                                  |
| 10  | **Concurrency, 50 parallel workers, one sequence row** | 50 unique values, consecutive from the starting position (no duplicates, no lost values); the counter advanced by exactly 50. Dedicated connections per worker; the harness fails rather than silently shrinking the worker count. |
| 11  | **Mixed commit/rollback under concurrency**            | 30 concurrent allocations, every third rolled back: committed values unique and a gapless consecutive run; the counter advanced exactly once per committed allocation.                                                             |

These are statements about the local stack on 2026-07-16, reproducible by
`npm run supabase:start`, `npm run supabase:reset`, `npm run test:db`. CI
re-runs the same suite against plain `postgres:17-alpine`; the known
difference in Supabase-managed role attributes there is documented and
accepted in the [Role and Grant Standard](./role-and-grant-standard.md).

## 7. Period reset semantics and formatting

Period keys are computed **in UTC** (`clock_timestamp() AT TIME ZONE 'UTC'`) at
allocation time — statement time, read **after** the row lock is taken, never
`now()`. Local business calendars are a presentation/configuration concern of
later phases; the allocator itself is jurisdiction-neutral (no timezone or
calendar assumption is hard-coded — Jordan included).

> **Why `clock_timestamp()` and not `now()`.** `now()` is transaction-start time
> and does not advance while a transaction is open, so a transaction that began
> before a boundary and allocated after it computed the **old** key — and because
> the reset test below is a plain inequality, an older key restarted the run at 1
> and stamped itself back onto the row, re-issuing numbers that period had already
> used. That was **P1-15-SR-014**, reproduced on protected `develop` and closed by
> migration 118
> ([DBCR-P1-15-002](./change-requests/DBCR-P1-15-002-number-sequence-period-hardening.md)).
> Every allocator reads the same database clock, so the key is monotonic across
> concurrent callers by construction.

| `period_reset_rule` | Period key format | Example key  |
| ------------------- | ----------------- | ------------ |
| `never`             | — (`NULL`)        | —            |
| `yearly`            | `YYYY`            | `2026`       |
| `monthly`           | `YYYY-MM`         | `2026-07`    |
| `daily`             | `YYYY-MM-DD`      | `2026-07-16` |

Reset is **lazy**: the first allocation whose computed period key differs from
`current_period` issues value `1` and stamps the new key. No scheduled job
touches the counter. The regression guard permits the counter to move backwards
**only** together with a period change (§2.3) — and since migration 118 a period
change is only legitimate when it is the key the database clock yields now, so a
writer can no longer invent one to carry a rewind past the guard.

Rendering: `display_number = replace(prefix_template, '{period}',
coalesce(period_key, '')) || padded_value`, where the value is zero-padded to
`pad_width` (`pad_width = 0` → no padding). Examples:

| `prefix_template` | `pad_width` | Rule      | Value | Rendered          |
| ----------------- | ----------- | --------- | ----- | ----------------- |
| `T-`              | 4           | `never`   | 1     | `T-0001`          |
| `M{period}-`      | 3           | `monthly` | 1     | `M2026-07-001`    |
| `INV-{period}-`   | 6           | `yearly`  | 42    | `INV-2026-000042` |
| `` (empty)        | 0           | `never`   | 17    | `17`              |

The first two rows are exactly what the test suite observed; the third is a
rendering illustration of a future invoice format.

**Uniqueness of rendered numbers is a downstream obligation.** The sequence
table guarantees unique committed `sequence_value`s per scope and period; it
does not store issued numbers. Every Phase 1-3+ document table that carries a
display number **must** add its own tenant-scoped uniqueness constraint on
that column (per the constraint standard), so that a mis-provisioned template
collision is caught at write time rather than discovered on paper.

## 8. Gap tolerance policy

Committed allocations are gapless (§6, evidence rows 8 and 11). Gaps that
appear later at the **business level** are a different matter:

- A document may be **voided** after its number was committed.
- A **period reset** intentionally starts a new run at 1.

Such gaps are **tolerated and never renumbered**. Renumbering issued documents
falsifies records already handed to customers, auditors, or authorities —
it is prohibited without exception. Where a jurisdiction or auditor requires
an explanation of gaps, the explanation is the void/reset event itself, which
later phases must record (voided documents are soft-deleted/status-tracked,
never hard-deleted, per the retention standard). No compaction, reuse, or
"fill the hole" mechanism may ever be built.

## 9. Administrative changes are audited configuration events

Changing a sequence (its template, pad width, reset rule — or, exceptionally
and with a period change, its counter) is a **configuration change event**:

- Today, the metadata trigger records `updated_at`, `updated_by` (from
  `iam.current_user_id()`), and an exact `+1` `record_version` on every
  update, and the regression guard blocks counter rewinds without a period
  change. Administrative changes run on the controlled admin/migration path —
  never ad-hoc SQL against production-like data.
- **Honest gap:** a full configuration-audit trail (who changed what, before/
  after values, justification) does not exist yet; it arrives with the tenant
  provisioning module in a later phase. Until then, `record_version` plus the
  admin path's own change control (migrations, PRs, the
  [defective-migration rehearsal process](../phase-1/phase-1-2/rehearsal-defective-migration.md))
  are the audit surface — this is stated plainly rather than claimed away.

## 10. Risks — documented honestly

### 10.1 Sequence enumeration

Display numbers are **guessable by design** — they are small, sequential, and
often printed on paper. This is acceptable _only_ because they carry no
authority:

- Display numbers **must never be used for authorization**. Access to the
  document behind `INV-2026-000042` is decided by RLS against the session's
  tenant context, exactly as for any other row.
- Display numbers **must never be lookup keys without scope checks**. A
  "find by number" feature in later phases must query within the caller's
  RLS-scoped view (which it gets automatically as a runtime role); no
  endpoint may resolve a bare number across tenants.
- Sequence positions are still commercially revealing (invoice volume).
  Cross-tenant isolation of the sequences themselves is enforced by RLS
  (§2.4, evidence row 5) and there is no global sequence to observe (§3).

### 10.2 Exhaustion and pad overflow

- `next_value` is `bigint` (ceiling 9,223,372,036,854,775,807). At any
  realistic document volume this is unreachable; no rotation scheme is needed.
- **Pad overflow — measured defect, FIXED before merge.** The binding rule is:
  when a value outgrows `pad_width`, the rendered number **widens** past the
  pad; it must never be truncated and allocation must not fail. The defect:
  a plain `lpad(sequence_value::text, pad_width, '0')` **truncates on the
  right** when the input is longer than the target length — measured on the
  local PostgreSQL 17.6 on 2026-07-16: `lpad('12345', 4, '0')` → `'1234'`.
  A sequence reaching `10^pad_width` would have rendered truncated, colliding
  display numbers. The Phase 1-2 review caught this **before migration 0003
  was ever merged**, so 0003 itself was corrected (permissible under the
  migration standard, which freezes migrations only once merged) to:

  ```sql
  lpad(sequence_value::text,
       greatest(pad_width, length(sequence_value::text)), '0')
  ```

  which pads short values and leaves longer values whole. Verified by the
  regression test "WIDENS (never truncates) when a value outgrows pad_width"
  in `tests/db/number-sequences.test.ts` (value 12345 through a pad of 4
  renders `T-12345`). Defence in depth remains:
  1. Provisioning must set `pad_width` with documented headroom (the default
     `6` allows 999,999 values per period — generous for pilot scale, and
     period resets restart the run).
  2. The mandatory tenant-scoped uniqueness constraint on document display
     numbers (§7) is the backstop: any collision would be rejected at write
     time instead of silently issued.

### 10.3 Serialisation hot spot

`SELECT … FOR UPDATE` makes each sequence row a serialisation point: the lock
is held from allocation to COMMIT/ROLLBACK, so concurrent allocators for the
same scope queue. This is the deliberate price of gapless, duplicate-free,
transactional numbering.

- **Accepted at pilot scale**: 50 parallel workers on one row completed
  correctly (evidence row 10); a single pilot tenant's document volume is far
  below this contention level.
- Mitigations, documented now for later phases (no premature machinery is
  built in Phase 1-2):
  - **Narrower scopes** — per-company or per-branch sequences (§3) shard
    contention naturally along real business lines.
  - **Allocate late** — call `next_display_number()` as close to COMMIT as
    the workflow allows, minimising lock hold time; never perform slow work
    (external calls, large writes) between allocation and COMMIT.
  - If a future tenant's volume genuinely outgrows row-lock throughput, any
    alternative (numbering ranges, batched hand-out) is a standards change
    requiring an ADR — it must not be improvised, because every alternative
    weakens the gapless/no-duplicate guarantees this standard proves.

## 11. Binding rules — summary

| #   | Rule                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | UUIDs are never shown to humans, never authorization tokens, and never display numbers. Human-facing document numbers come only from `shared.next_display_number()`.                                                                              |
| 2   | No global cross-tenant sequence exists and none may ever be created; every sequence row is tenant-owned.                                                                                                                                          |
| 3   | Sequence provisioning and retirement are administrative configuration actions (ADR-008). Runtime roles must never gain INSERT/DELETE on `shared.number_sequences`.                                                                                |
| 4   | Tenant-specific sequences (including Benzene's) are controlled provisioning data in a later configuration package — never schema, never hard-coded, not in Phase 1-2.                                                                             |
| 5   | Allocation happens in the same transaction as the business write that consumes the number.                                                                                                                                                        |
| 6   | The allocator never accepts a tenant parameter; the tenant comes from the server-resolved transaction context only.                                                                                                                               |
| 7   | Business-level gaps (voids, period resets) are tolerated and never renumbered.                                                                                                                                                                    |
| 8   | Counters may never be rewound except as part of a period change, and a period key may only ever be set to the one the database clock yields now (enforced by trigger; the second half was added by migration 118 after P1-15-SR-014 and PMR-004). |
| 9   | Document tables carrying display numbers must add tenant-scoped uniqueness on that column (Phase 1-3+ obligation).                                                                                                                                |
| 10  | Rendered numbers widen past `pad_width` and are never truncated (defect found and fixed pre-merge, §10.2; regression-tested).                                                                                                                     |

## 12. Related documents

- [Database Architecture](./database-architecture.md) — schemas, base metadata, modular-monolith placement of `shared`.
- [RLS Standard](./rls-standard.md) — context contract, default deny, FORCE RLS, honest role caveats.
- [Role and Grant Standard](./role-and-grant-standard.md) — `app_runtime` / `app_readonly`, measured attributes of Supabase-managed roles.
- [Naming Standard](./database-naming-standard.md) — identifier, constraint, policy, and trigger naming used throughout.
- [ADR-008](../adr/ADR-008-configuration-driven-tenant-onboarding.md) · [ADR-009](../adr/ADR-009-benzene-as-first-configured-pilot-tenant.md) · [ADR-012](../adr/ADR-012-local-first-environment-with-controlled-promotion.md)
- Migration [`0003_number_sequences.sql`](../../supabase/migrations/0003_number_sequences.sql) · Tests [`tests/db/number-sequences.test.ts`](../../tests/db/number-sequences.test.ts)
