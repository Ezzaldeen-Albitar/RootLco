# DBCR-P1-15-002 — Display-number period hardening

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Raised by:** Eng. Ezzaldeen Al-Bitar, during the Phase 1-15 post-merge gate review ·
**Date raised:** 2026-07-23 ·
**Status:** **Remediated — awaiting owner merge.** Migration 118 implements the change and is proven
by 19 executable database proofs plus 6 application-layer proofs. This record becomes Resolved only
after the remediation is merged into protected `develop` and re-verified from the merged protected
state as the runtime role. ·
**Scope note:** this change request covers **two** findings against the same contract — the stale
transaction clock (P1-15-SR-014 / PMR-003) and the invented-period bypass of the regression guard
(PMR-004). The second was found while verifying the fix for the first, and is recorded in
[the post-merge security review](../../phase-1/phase-1-15/post-merge-security-review.md) §3. ·
**Severity:** **Medium** — duplicate human-facing document numbers inside one tenant scope. No
tenant-isolation, authorization, or RLS boundary is involved. ·
**Finding:** P1-15-SR-014 (raised, and deliberately left open, in the Phase 1-15 feature security
review) ·
**Protected state inspected:** `origin/develop` = `0b843bf` (merge of feature PR #61),
`origin/main` = `8ca1da2`, 117 migrations ·
**Governance:** raised under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md);
this is owner-authorized technical self-review, never an independent third-party audit.

---

## 1. Summary

`shared.next_display_number()` (migration 0003) derived its period key from **`now()`**, which
PostgreSQL fixes at **transaction start** and does not advance while the transaction is open.

A transaction that began before a period boundary and reached the allocation after it therefore
computed the **old** period key. The reset test is a plain inequality:

```sql
IF v_row.period_reset_rule <> 'never' AND v_period IS DISTINCT FROM v_row.current_period THEN
  sequence_value := 1;
```

so an **earlier** key is treated exactly like a later one. The run restarts at `1` and the earlier key
is stamped back onto the row. The regression trigger did not stop it, because its counter check only
fires when the period is unchanged — and here the period _did_ change, just backwards.

The result is **duplicate issued display numbers within one tenant scope**: invoice numbers,
quotation numbers, work-order numbers. That directly contradicts what
[the number-sequence standard](../number-sequence-standard.md) states in its own words — unique
committed `sequence_value`s per scope and period, and counters that "may never be rewound except as
part of a period change".

A backwards period change is not a period change. It is a rewind wearing one.

## 2. Executable proof, on the protected contract

Run against `origin/develop` = `0b843bf`, as `rootlco_test_runtime` (a member of `app_runtime`,
`NOBYPASSRLS`, non-super). The admin connection only staged fixtures and read results back.

### 2.1 The mechanism

```
BEGIN; SELECT now();  -- 2026-07-23 17:15:17
SELECT pg_sleep(1.2);
SELECT now(), clock_timestamp();
-- now() unchanged; clock_timestamp() 1210 ms ahead
```

`now()` is frozen for the transaction. A transaction open across a period boundary computes the key
of the period it _started_ in.

### 2.2 The duplicate

| Step | Actor                         | Result                                                                                                           |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | `app_runtime`, daily sequence | issued `2026-07-23-000001`                                                                                       |
| 2    | `app_runtime`                 | issued `2026-07-23-000002`; row = `next_value 3`, `current_period 2026-07-23`                                    |
| 3    | staged                        | row placed at `next_value 2`, `current_period 2026-07-24` — exactly the write a next-period transaction performs |
| 4    | `app_runtime`, `now()` = D1   | **issued `2026-07-23-000001` again**; row rewound to `next_value 2`, `current_period 2026-07-23`                 |

Only the _clock_ is simulated in step 3, and §2.1 shows the simulation is faithful: a transaction
that began at 23:59 and allocated at 00:01 produces exactly the state in step 4 without any staging
at all. The write in step 3 is the allocator's own write, performed by the allocator itself in the
ordinary course of a next-period allocation.

### 2.3 The guard let it through

A single statement moving the period backwards _and_ lowering the counter
(`next_value 9 → 2`, `current_period → '2000-01-01'`) was accepted, because
`guard_number_sequence_regression()` only refuses a decrease when the period is **unchanged**.

## 3. Reachability — and why "zero rows today" is not a boundary

`shared.number_sequences` holds **0 rows** on protected `develop`, verified after a full rebuild.
Nothing is seeded (the no-fake-data policy forbids it) and `app_runtime` holds no `INSERT`.

That is a statement about _today's configuration_, not about the contract:

- `org.provision_organization()` (migration `20260717107000`, section 7/7) inserts sequence rows with
  an operator-supplied `period_reset_rule`, including `yearly`, `monthly` and `daily`. Provisioning a
  vulnerable sequence is an ordinary, authorized configuration action.
- Once such a row exists, the P1-15 `NumberAllocationService` reaches the defect directly: it calls
  `shared.next_display_number()` and carries no period guard of its own.

So the correct reading is **latent, not absent** — and a latent defect in a numbering contract is
worth fixing before the first sequence is provisioned, not after the first duplicate invoice.

## 4. Requested change (additive only)

Migration **118** — `20260729090000_shared_number_sequence_period_hardening.sql`. Two function bodies
are replaced. No table, column, constraint, index, policy, grant, role, trigger attachment or row is
created, altered or destroyed.

### 4.1 Layer one — the allocator reads statement time

`now()` becomes **`clock_timestamp()`**, evaluated after the row lock is taken, so the key names the
period the allocation is actually committing in however long the transaction has been open. Every
allocator reads the same database clock, so the key is monotonic across concurrent callers by
construction.

### 4.2 Layer two — the guard refuses an invented period

`guard_number_sequence_regression()` additionally raises `23514` when, on a sequence whose
`period_reset_rule` is unchanged and not `never`, `current_period` is set to anything other than the
key the database clock yields now.

**The first draft of this migration said "may only move backwards" and that was not enough**, which is
recorded here rather than presented as the plan all along. `next_value` may legitimately fall
_together with_ a period change, so a writer holding the ordinary
`UPDATE (next_value, current_period)` grant can lower the counter in the same statement that changes
the period — and both `NULL` and a far-future key satisfy "not backwards". Verified as
`rootlco_test_runtime` against that draft, on a yearly sequence sitting at `next_value = 42`:

| Statement                                     | Forward-only draft                               | Final                               |
| --------------------------------------------- | ------------------------------------------------ | ----------------------------------- |
| `SET current_period = NULL`                   | **accepted**                                     | `23514`                             |
| `SET next_value = 1, current_period = '2099'` | **accepted**                                     | `23514`                             |
| commit the first, then allocate               | issued **`FXY-2026-001`**, a number already used | run untouched, next number is `042` |

Comparing against the clock instead of against the old value closes all three at once. Two legitimate
operations still pass: the first stamp on a fresh sequence (`NULL → current key`, because the new
value _is_ the current key), and an administrator retuning `period_reset_rule` — reachable only by an
administrator, because `app_runtime` holds no grant on that column.

Layer one keeps the allocator from ever writing a stale key; layer two keeps every other writer,
including a raw caller of the function, from creating the state the allocator would misread.

### 4.3 Application layer

`NumberAllocationService` now maps `23514` from this path to **`ERR-CON-001`** with a message that
names the correct client action — retry in a new transaction. Untranslated it surfaced as
`ERR-SYS-001`, which invites a retry loop against what looks like a fault.

## 5. What this change is not

- It is **not** a fix for tenant isolation, authorization, or RLS. Those were never involved: the
  tenant boundary held throughout the reproduction, and this migration changes no policy or grant.
- It does **not** eliminate gaps. Gaps from rollbacks and from business events (voided documents,
  period resets) remain tolerated and are never renumbered — that is the standard's deliberate
  position and it is unchanged.
- It does **not** make the numbering run globally unique. Uniqueness is per tenant scope and period,
  as before; what changes is that the "and period" half can no longer be rewound.

## 6. Evidence

| Proof                                                                                         | Where                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 19 database proofs on the real runtime login                                                  | `tests/db/p1-15-number-sequence-period-hardening.test.ts`                       |
| 6 application proofs of the SQLSTATE translation table                                        | `tests/foundation/p1-15-number-allocation-translation.test.ts`                  |
| Pre-existing allocation, concurrency, rollback and guard behaviour unchanged (13 + 24 proofs) | `tests/db/number-sequences.test.ts`, `tests/db/p1-15-number-allocation.test.ts` |
| Migration count 118, with 117 and 118 last and 1–116 untouched                                | `tests/db/p1-15-shared-services-runtime-capabilities.test.ts`                   |

The regression locks that matter, each of which behaves differently against the contract it replaces:

- **"the state SR-014 needed can no longer be created by any writer"** — under 0003 the staging UPDATE
  was accepted; now it raises `23514`.
- **"the run cannot be restarted by clearing the period and allocating again"** — under the
  forward-only draft this issued `FXY-<year>-001` against a sequence at 42; now the clear is refused
  and the next number is `042`.

### 6.1 One consequence, recorded rather than absorbed

Two existing fixtures staged a past period with an `UPDATE`, and the tightened guard refuses that —
for the admin connection too, because a `BEFORE UPDATE` trigger does not care who you are. They now
provision by `INSERT`
(`tests/db/number-sequences.test.ts`, `tests/db/p1-15-number-sequence-period-hardening.test.ts`).

That is the contract change working as intended, and it is stated here so nobody later reads the edit
as a test bent to fit a result: a writer inventing a period is precisely how a run gets restarted and
numbers get re-issued, and a fixture is a writer.

## 7. Disposition

**Approved and implemented as migration 118**, under the Standing Technical Authorization, as the
minimum additive change that closes P1-15-SR-014 at the contract level rather than only for the
callers Phase 1-15 happens to own.

The Phase 1-15 owner gate remains **Pending** and may not be converted while this remediation is
unmerged.
