# Phase 1-15 — Display Number Allocation Service

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-23 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) — never an
independent third-party audit, and never independent QA).

**Owner gate:** [Phase 1-15 Owner Gate](./phase-1-15-owner-gate.md) — **Pending**. Nothing in this
document records or anticipates a gate decision.

**Implemented by:**
[`src/modules/shared-services/application/number-allocation-service.ts`](../../../src/modules/shared-services/application/number-allocation-service.ts) ·
[`src/modules/shared-services/data/number-sequence-repository.ts`](../../../src/modules/shared-services/data/number-sequence-repository.ts) ·
[`src/modules/shared-services/domain/sequence-registry.ts`](../../../src/modules/shared-services/domain/sequence-registry.ts)

**Related:** [Number Sequence and Display Number Standard](../../database/number-sequence-standard.md) ·
[Binding implementation decisions](./phase-1-15-implementation-decisions.md) §2.6 ·
[Role and Grant Standard](../../database/role-and-grant-standard.md) ·
[RLS Standard](../../database/rls-standard.md) ·
[Error Catalog v0.1](../../standards/error-catalog-v0.1.md) ·
[ADR-008 — Configuration-Driven Tenant Onboarding](../../adr/ADR-008-configuration-driven-tenant-onboarding.md) ·
Migration [`0003_number_sequences.sql`](../../../supabase/migrations/0003_number_sequences.sql)

---

## 1. The contract is a function call, not a route

`NumberAllocationService.allocate()` takes an already-open `DbHandle` as its first argument. That is
the whole design decision, and everything else follows from it.

```ts
await withTransaction(context, async (db) => {
  const number = await sharedServices().numbers.allocate(db, { sequenceCode: 'invoice' });
  await invoices.insert(db, { ...input, invoiceNumber: number.displayNumber });
});
```

The planning material labelled this capability `POST /api/v1/numbers:allocate`. It is **not
implemented**, for two independent reasons.

The first is mechanical: the operation registry's path grammar rejects a colon, so the literal
planning label could not be registered even if the design were sound.

The second is the one that matters. An endpoint returns after its own transaction commits. A number
returned that way has already advanced `next_value`, and if the caller then fails — a validation
error on the document, a network drop, a user who closes the tab — **no business row ever carries
that number**. The counter has moved and nothing accounts for the movement. That is a permanent gap
in a sequence whose entire purpose is to be gapless on issued documents, and no document in the
platform would carry an explanation for it: [the standard's §8](../../database/number-sequence-standard.md)
tolerates business-level gaps only where a **void or a period reset** explains them, and records that
renumbering issued documents is prohibited without exception. A separately committed number is
neither a void nor a reset. It is an unexplained hole.

The dishonesty is worse than the hole. An endpoint called `numbers:allocate` implicitly promises the
gaplessness the standard proves, while structurally producing gaps. Rule 5 of the standard binds
allocation to the same transaction as the business write that consumes the number; a service taking
a `DbHandle` is the only shape that can keep that promise, because the counter advance and the
document insert are then literally the same transaction and roll back together.

## 2. What the caller is not allowed to decide

| Input                    | Where it comes from                                        | Why not from the caller                                                                                        |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Tenant                   | `iam.current_tenant_id()` inside the SQL function          | The function has **no tenant parameter**. A caller can never allocate into a tenant it merely names.           |
| Prefix, pad width, reset | The `shared.number_sequences` row                          | Duplicating them in code would create a second source of truth that could disagree with the row actually used. |
| Sequence code            | The reviewed registry (§4)                                 | The database CHECK constrains only spelling; the application constrains meaning.                               |
| Company / branch scope   | Passed, then validated against the session's allowed lists | They are scope _selectors_, not authorization. RLS remains the enforcement layer.                              |

`allocate()` therefore leaves the caller exactly one decision: **which recognised sequence, inside a
scope it already holds.**

One narrowing rule is checked in TypeScript before the call reaches SQL: a `branchId` without a
`companyId` is rejected as `ERR-VAL-001` with the violation path `branchId`. The table would refuse
it too, through `ck_number_sequences_branch_requires_company`, but a constraint violation message is
not a caller-safe contract. The same reasoning governs `SEQUENCE_CODE_PATTERN`, which reproduces
`ck_number_sequences_code_format` (`^[a-z][a-z0-9_]{1,62}$`) in the service.

## 3. The privilege surface, measured rather than assumed

`shared.next_display_number()` is `SECURITY INVOKER`, so it runs with the caller's own privileges and
is not an RLS bypass. That makes the grant surface the actual security boundary, and a claim about a
grant surface is worth nothing unless it was measured. The commands below were run against the local
Supabase PostgreSQL container on 2026-07-23; the output is reproduced verbatim.

**Table-level grants.**

```bash
docker exec supabase_db_RootLco psql -U postgres -d postgres -X -A -t -c \
  "SELECT grantee||'|'||privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='shared' AND table_name='number_sequences' ORDER BY 1"
```

```text
app_readonly|SELECT
app_runtime|SELECT
postgres|DELETE
postgres|INSERT
postgres|REFERENCES
postgres|SELECT
postgres|TRIGGER
postgres|TRUNCATE
postgres|UPDATE
```

Both runtime archetypes hold `SELECT` and nothing else at table level. There is **no table-wide
`UPDATE`, no `INSERT`, and no `DELETE`** for either — the `postgres` rows are the owner's, and
nothing executed as `postgres` is evidence about the runtime.

**Column-level grants.**

```bash
docker exec supabase_db_RootLco psql -U postgres -d postgres -X -A -t -c \
  "SELECT grantee||'|'||column_name||'|'||privilege_type FROM information_schema.column_privileges
    WHERE table_schema='shared' AND table_name='number_sequences'
      AND grantee IN ('app_runtime','app_readonly','app_worker') ORDER BY 1"
```

The observed result lists `SELECT` on all fifteen columns for both runtime archetypes, and exactly
two `UPDATE` entries in the whole output:

```text
app_runtime|current_period|UPDATE
app_runtime|next_value|UPDATE
```

That is the column-scoped grant the standard specifies, confirmed as a fact about the running
database rather than as a restatement of the migration. `record_version`, `updated_at`, and
`updated_by` are written by `shared.touch_row_metadata()` on the trigger path, so the allocator
cannot forge them; `app_worker` appears nowhere in the output at all.

**Function privilege and security type.**

```bash
docker exec supabase_db_RootLco psql -U postgres -d postgres -X -A -t -c \
  "SELECT p.proname||'|secdef='||p.prosecdef||'|acl='||COALESCE(array_to_string(p.proacl,';'),'(null)')
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='shared' AND p.proname='next_display_number'"
```

```text
next_display_number|secdef=false|acl=postgres=X/postgres;app_runtime=X/postgres
```

`secdef=false` confirms `SECURITY INVOKER`. `EXECUTE` is held by `app_runtime` and by the owner —
and **not** by `app_readonly`, which is the point: a read-only role that could allocate would be able
to consume numbers it can never write into a document.

**Row-level security.** `relrowsecurity` and `relforcerowsecurity` are both `true`, and the table
carries two policies: `sel_number_sequences_tenant` (`SELECT`, `app_runtime` + `app_readonly`) and
`upd_number_sequences_tenant` (`UPDATE`, `app_runtime`). There is no INSERT policy and no DELETE
policy. Privilege and policy therefore refuse provisioning **independently** — removing either one
still leaves the other saying no.

The practical consequence for this service: `isProvisioned()` exists precisely because provisioning
is an operator action the runtime cannot perform ([ADR-008](../../adr/ADR-008-configuration-driven-tenant-onboarding.md)).
A module that would otherwise do expensive work and then discover at allocation time that no sequence
row exists can ask first.

## 4. The sequence-code registry, and why every entry names a real column

`shared.next_display_number()` will allocate against **any** `sequence_code` that happens to have a
row provisioned. That is correct for the database, which is a mechanism rather than a policy. It is
wrong for an application service: a caller that mistypes `invoce` would silently allocate from a
sequence nobody reviewed, and a caller that invents `invoice_2` would open a second numbering run for
the same document type. Both produce duplicate or gapped numbers on issued documents, which is a
falsification risk rather than a bug.

So [`domain/sequence-registry.ts`](../../../src/modules/shared-services/domain/sequence-registry.ts)
keeps an allow-list. Its defining property is that it is **derived, not invented**: each entry names
the table and column that already exist in protected schema and will actually store the number.

| Sequence code      | Target column                          | Introduced | What the number is on                              |
| ------------------ | -------------------------------------- | ---------- | -------------------------------------------------- |
| `appointment`      | `apt.appointments.display_number`      | P1-08      | Human-facing appointment number                    |
| `business_partner` | `crm.business_partners.display_number` | P1-06      | Human-facing customer/supplier number              |
| `invoice`          | `sal.invoices.invoice_number`          | P1-11      | Invoice number as printed on the issued document   |
| `quotation`        | `quo.quotations.quotation_number`      | P1-10      | Quotation number as printed on the issued document |
| `receipt`          | `sal.receipts.receipt_number`          | P1-11      | Payment receipt number                             |
| `reception_visit`  | `rec.reception_visits.display_number`  | P1-08      | Vehicle reception (check-in) number                |
| `vehicle`          | `veh.vehicles.display_number`          | P1-07      | Human-facing vehicle number                        |
| `work_order`       | `wo.work_orders.display_number`        | P1-09      | Work-order number as printed on the job card       |

Naming a real column is not decoration. It is what makes the registry falsifiable: an entry for a
document type the platform does not have cannot be written without inventing a column, and a reviewer
can check any row of the table against the schema in one query. All eight pairs were verified present
in `information_schema.columns` on 2026-07-23 by a single query over the live database; every one
returned `PRESENT`.

**A gap stated plainly.** The source comment in `sequence-registry.ts` says the columns are asserted
by `tests/db/p1-15-number-allocation.test.ts`. **No file of that name exists in the tree**, and no
test in the repository imports `SEQUENCE_DEFINITIONS` or `NumberAllocationService`. The eight columns
above are therefore backed by the query just described and by review — not by a committed automated
assertion. The comment overstates what is committed, and this document does not repeat the overstatement.

Two things the registry deliberately does **not** do:

- **It does not provision.** A code being registered means "recognised", never "ready". Allocating
  against a registered-but-unprovisioned code is a configuration failure and is reported as one (§5).
- **It does not carry prefix, pad width, or reset rule.** Those live on the sequence row where an
  operator sets them.

## 5. Failure mapping

`shared.next_display_number()` raises two SQLSTATEs deliberately, and the service maps each to a
stable catalog code. The reason to map rather than propagate: a caller can act on "this is not
configured" and can act on "you asked for a scope you do not hold", and can act on neither if both
arrive as `ERR-SYS-001`.

| Condition                                                                                   | SQLSTATE                         | Mapped to     | HTTP | Why that code                                                                                                                        |
| ------------------------------------------------------------------------------------------- | -------------------------------- | ------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| No sequence row for this code in this scope — including another tenant's row, hidden by RLS | `P0002` `no_data_found`          | `ERR-RES-001` | 404  | A configuration gap the caller cannot fix by changing the request. A missing resource, not a bad one.                                |
| No tenant context, or a company/branch outside the session's allowed lists                  | `42501` `insufficient_privilege` | `ERR-IAM-001` | 403  | An authorization denial, reported with the same uniform shape as every other denial.                                                 |
| `branchId` without `companyId`                                                              | — (rejected in TypeScript)       | `ERR-VAL-001` | 422  | The caller can fix this by changing the request.                                                                                     |
| Unregistered or malformed sequence code                                                     | — (rejected in TypeScript)       | `ERR-VAL-001` | 422  | Never echoes the submitted code back: it reaches logs, and it is exactly the input a caller controls.                                |
| The function returns no row                                                                 | —                                | `ERR-SYS-001` | 500  | The function always returns one record or raises. A null row means the contract changed underneath us — a fault, not a client error. |

Note the deliberate indistinguishability in the first row. An unknown code and another tenant's
sequence both produce `P0002`, so a caller cannot use allocation failures to probe which sequences
another tenant has provisioned.

Every branch increments `numbering.allocation.count` with a `result` label of `success`,
`not-provisioned`, `denied`, or `failure`, and the `sequence` label carries the registered code —
low-cardinality catalogue metadata. **The allocated number is business data and is deliberately
absent from both the metric labels and the log line**; the success log records only the sequence code
and whether the allocation was scoped.

Metrics are recorded in-process through the existing `METRICS` keys. No monitoring, alerting, or
dashboard is provisioned by this phase, and none is claimed.

## 6. What is guaranteed — and what is not a state at all

**Committed allocations are gapless.** The counter advance happens inside the caller's transaction,
behind `SELECT … FOR UPDATE` on the sequence row, so concurrent allocators for the same scope queue
rather than interleave. This is the property the
[standard's §6 evidence rows 10 and 11](../../database/number-sequence-standard.md) recorded against
the local stack in Phase 1-2 (50 parallel workers on one row; 30 concurrent allocations with every
third rolled back). P1-15 adds no allocator of its own — that is the deliberate reason
`NumberSequenceRepository.allocate()` is a single `SELECT … FROM shared.next_display_number(…)` and
re-implements none of the lock, the reset decision, the increment, or the rendering. A second
allocator could disagree with the first, and then the regression guard would be the only thing
between a bug and a re-issued invoice number.

**A rolled-back allocation is not consumed.** If the caller's transaction aborts, the increment aborts
with it and the same value goes to the next caller. Nothing committed ever carried the number, so
re-issuing it is safe. This is exactly why there is no `COMMIT` in the repository and why there must
never be one.

**What is not guaranteed.** Uniqueness of the _rendered_ string is a downstream obligation: the
sequence table guarantees unique committed `sequence_value`s per scope and period, but it does not
store issued numbers. Every document table carrying a display number must add its own tenant-scoped
uniqueness constraint on that column, so a mis-provisioned template collision is caught at write time
rather than discovered on paper.

**"Disabled sequence" is not a state that exists.** The frozen table has fifteen columns —

```text
id, tenant_id, company_id, branch_id, sequence_code, prefix_template, next_value,
pad_width, period_reset_rule, current_period, record_version,
created_at, created_by, updated_at, updated_by
```

— and **none of them is an `enabled`, `is_active`, `status`, or `disabled` flag.** There is no soft
switch to turn a sequence off. The only two conditions the service can report are _provisioned in
this scope_ and _not provisioned in this scope_, and retiring a sequence is an administrative action
on the configuration path, not a runtime state change. This is stated rather than papered over
because inventing a "disabled" concept in documentation would describe a control the operator does
not have, and an operator who believed in it would think they had disarmed a numbering run they had
not.

Equally, this phase adds no throughput, latency, or contention figure. The serialisation hot spot the
standard documents in its §10.3 is unchanged by P1-15, and no measurement of it was taken here.

## 6.1 The period contract, and the defect that changed it after the merge

The service reads no clock and decides no period: the period key is computed inside
`shared.next_display_number()`, from the sequence row's own `period_reset_rule`. That was true before
and after the correction below; what changed is which clock the function reads.

Until migration 118 the function used **`now()`**, which PostgreSQL fixes at transaction start. A
transaction that began before a period boundary and allocated after it therefore computed the _older_
key — and because the reset test is a plain inequality, an older key restarted the run at 1 and
stamped itself back onto the row, **re-issuing numbers that period had already used**. That is
P1-15-SR-014. It was recorded but not fixed by the feature branch, which adds no migration;
it was reproduced on protected `develop` during the post-merge gate review and closed by
[DBCR-P1-15-002](../../database/change-requests/DBCR-P1-15-002-number-sequence-period-hardening.md).

Two things follow for a caller of this service:

- **Nothing in the call signature changes.** `allocate()` takes the same input and returns the same
  `AllocatedNumber`. The period key is now taken from `clock_timestamp()` after the row lock, so it
  names the period the allocation actually commits in however long the transaction has been open.
- **One new failure is possible, and it is retryable.** The regression guard now refuses a backwards
  `current_period` move, raising `23514`; the service maps that to **`ERR-CON-001`** with a message
  naming the correct action — retry in a new transaction. Nothing is issued and nothing moves when it
  fires. With the allocator reading a single database clock it should not fire at all; it exists so a
  raw caller of the function, or a host clock stepped backwards, aborts loudly instead of silently
  duplicating a number.

## 7. Related documents

- [Number Sequence and Display Number Standard](../../database/number-sequence-standard.md) — the
  binding contract this service implements: scope model, period semantics, rendering, gap policy.
- [Binding implementation decisions](./phase-1-15-implementation-decisions.md) §2.6 — the record of
  why the planned endpoint was rejected.
- [Role and Grant Standard](../../database/role-and-grant-standard.md) ·
  [RLS Standard](../../database/rls-standard.md) — the archetypes and the context contract the
  measurements in §3 are read against.
- [Error Catalog v0.1](../../standards/error-catalog-v0.1.md) — the stable codes §5 maps onto.
- [Phase 1-15 Owner Gate](./phase-1-15-owner-gate.md) — **Pending**.
