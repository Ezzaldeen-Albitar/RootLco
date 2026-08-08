# DBCR-P1-18-001 — custody release frees the one-visit-per-Vehicle index

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-18 — Appointment & Reception Backend · **Owner:** Eng. Ezzaldeen
Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review.**

- **Finding:** `P1-27-INT-013` (Critical) — a Vehicle could be received exactly once, ever
- **Migration:** `supabase/migrations/20260731090000_rec_custody_release_visit_marker.sql` (the 120th)
- **Seed change:** none. No permission code is minted and none is required
- **Executable proof:** `tests/db/rec-custody-release.test.ts` (11 tests)
- **Rollback classification:** **ROLL-FORWARD-ONLY** once any Vehicle has been received a second
  time. The structural inverse is in the migration footer, but restoring the old predicate fails on
  any Vehicle legitimately received more than once — which is the entire point of the change

---

## 1. The defect

`uq_reception_visits_open_vehicle` enforces a real operational fact: a Vehicle cannot be in the
custody of two open visits at once. Since `20260721097000` it has spelled that as four reception
statuses:

```sql
CREATE UNIQUE INDEX uq_reception_visits_open_vehicle
  ON rec.reception_visits (tenant_id, vehicle_id)
  WHERE reception_status IN ('opened', 'inspecting', 'authorized', 'converted')
    AND deleted_at IS NULL;
```

Its own comment, two lines above it, states the intent:

> One OPEN visit per Vehicle+tenant (custody cannot be in two places). Terminal visits
> (closed_without_work/refused) do not block a later visit.

**`converted` is also terminal.** `rec.guard_reception_transition()` gives it no outgoing edge, and
`TERMINAL_RECEPTION_STATUSES` in `apps/api/src/modules/reception/domain/reception.ts` lists it beside
the other two. It is the one terminal state the **successful** path reaches: a visit that becomes a
work order ends its life in `converted`.

So the comment names two of the three terminal states and the predicate retains the third. The
effect is that the normal, correct completion of a reception permanently forbade that Vehicle from
ever being received again in that tenant. **Every returning customer was a permanent `23505`.**

## 2. Reproduction against the live database

Read from source first, then reproduced — inside one transaction that was rolled back, driven by
`rec.accept_check_in` (the primitive the reception route itself calls) rather than a raw `INSERT`,
because a probe that shortcuts the real path cannot testify about the real path.

```
visit 1 reached `converted` — the normal, successful path
visit 2 REFUSED — SQLSTATE 23505  uq_reception_visits_open_vehicle
   duplicate key value violates unique constraint "uq_reception_visits_open_vehicle"
control: after `closed_without_work`, a second check-in IS allowed
escape:  `converted` cannot be left —
         invalid reception transition converted -> closed_without_work
```

Four facts, and the last two are what make it unambiguous:

1. The normal path reaches `converted`, driven by the production primitive.
2. The second check-in of the same Vehicle is refused by that exact index.
3. **The control passes.** A Vehicle taken to `closed_without_work` accepts a second check-in — the
   table, the guard trigger and the primitive all behave as designed. The single fault is `converted`
   sitting in the predicate.
4. **There is no workaround.** `converted` has no outgoing edge and the status trigger enforces that
   in SQL as well as in TypeScript, so nothing an operator, a support engineer or a screen can do
   recovers that Vehicle.

## 3. Why the obvious fix is wrong

Dropping `converted` from the predicate would restore the returning customer and break the invariant
the index exists for. While the work order is open the Vehicle is **physically in the workshop**, and
a second reception must still be refused; `converted` is doing real work for that whole period.

What the predicate should test is **custody**, which is what the index always meant. Custody release
is already a first-class, exactly-once fact — `rec.custody_history.to_state = 'released'`, backstopped
by `uq_custody_history_released` and written by `sal.complete_delivery` when the Vehicle is handed
back. A partial index cannot reference another table, so the fact is denormalised onto the visit.

## 4. The change

### 4.1 `rec.reception_visits.custody_released_at`

A nullable `timestamptz`. NULL means the workshop still holds the Vehicle. Backfilled from the ledger
in the same migration, before the guard and the new index exist, so neither observes a half-built
state.

### 4.2 The guard — the marker is evidence, not an assertion

`app_runtime` already holds a **table-level** `UPDATE` grant on `rec.reception_visits`, so a new
column is writable by request code the moment it exists. Without a guard, a caller could free the
index by assertion and a Vehicle that never left the workshop could be received again — a worse
defect than the one being fixed.

`tg_reception_visits_custody_release_marker` (BEFORE INSERT OR UPDATE OF `custody_released_at`)
therefore refuses all four ways of forging it:

| attempt                                      | result                                             |
| -------------------------------------------- | -------------------------------------------------- |
| create a visit already released              | `23514` — a new visit cannot already have released |
| set the marker with no release in the ledger | `23514` — requires a released custody record       |
| clear a recorded release                     | `23514` — recorded once, cannot be changed         |
| move a recorded release to a different time  | `23514` — same                                     |

The ledger lookup runs inside the caller's own RLS view, so it cannot be satisfied by another
tenant's row.

### 4.3 The maintainer — the ledger drives the marker

`tg_custody_history_apply_release` (AFTER INSERT ON `rec.custody_history` WHEN
`to_state = 'released'`) stamps the visit from the ledger row. `SECURITY INVOKER`, so RLS applies
exactly as to the caller.

It **RAISEs** rather than silently skipping when it matches no visit. `uq_custody_history_released`
already makes a second release impossible, so the only way to match nothing is a caller whose scope
excludes the visit it just released — and silently leaving the marker unset would recreate
`P1-27-INT-013` for that Vehicle. A defect that reappears only under a scope mismatch is the hardest
kind to find, so it fails loudly instead.

### 4.4 The index, restated as what it always meant

```sql
CREATE UNIQUE INDEX uq_reception_visits_open_vehicle
  ON rec.reception_visits (tenant_id, vehicle_id)
  WHERE reception_status IN ('opened', 'inspecting', 'authorized', 'converted')
    AND custody_released_at IS NULL
    AND deleted_at IS NULL;
```

The status list is **unchanged**. `converted` still blocks — for exactly as long as the workshop
holds the Vehicle, and no longer.

## 5. Executable evidence

`tests/db/rec-custody-release.test.ts` — 11 tests, every mutation through the least-privilege
`rootlco_test_runtime` login, each inside a rolled-back transaction.

The regression, which is why the migration exists:

1. the same Vehicle is received again once custody has been released;
2. a custody release stamps `custody_released_at` from the ledger row, equal to its `occurred_at`.

The invariant the index exists for — the half a careless fix would destroy:

3. a second check-in is still refused while a visit is open (`23505`);
4. a second check-in is still refused while the Vehicle is under an open work order (`23505`);
5. `closed_without_work` still does not block, as before;
6. `refused` still does not block, as before.

The guard:

7. releasing a visit with no custody release recorded is refused (`23514`);
8. clearing a recorded release is refused (`23514`);
9. moving a recorded release to a different time is refused (`23514`);
10. creating a visit that is already released is refused (`23514`).

The index itself:

11. the live `indexdef` contains the custody term, still contains `'converted'`, and still contains
    `deleted_at IS NULL`.

### 5.1 The regression test was proved to fail

A green test proves nothing until it has been seen to fail. The defective predicate was restored on
the live database and the suite re-run:

```
× P1-27-INT-013 — a returning customer > receives the same Vehicle again once custody has been released
× the index itself > tests custody rather than reception status alone
✓ (the other nine)
```

Both the **behavioural** regression and the structural assertion fail on the old predicate — the
behavioural one is the load-bearing proof, since a structural assertion alone would only be checking
that the migration text was applied. The nine that pass either way are the preserved invariants; they
are not measuring the fix, they are guarding against over-fixing it, and passing under both predicates
is the correct outcome for them.

## 6. Blast radius

Full `npm run test:db` — **1647 passed / 139 files**. Full `npm run test:backend` —
**1834 passed / 80 files**. Beyond the new file, four registries required updating because the change
adds a column, two functions and two triggers, and the repository asserts each inventory exactly:

| registry                                                  | change                                                    |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `tests/db/foundation.test.ts`                             | two routines and two triggers added to the approved lists |
| `tests/db/p1-15-…-runtime-capabilities.test.ts`           | migration count 119 → 120                                 |
| `docs/database/data-dictionary.md`                        | `rec.reception_visits.custody_released_at`                |
| `docs/database/apt-rec-personal-data-classification.json` | the same column, `internal`, not searchable               |

## 7. Security analysis

- **No new grant, role, policy, permission code, table or index privilege.** The change is a column,
  two trigger functions, two triggers and a replaced index.
- The marker cannot be forged, cleared or moved (§4.2), and the ledger lookup that authorises it runs
  inside the caller's RLS view, so it cannot be satisfied cross-tenant.
- The maintainer is `SECURITY INVOKER` and fails closed rather than silently.
- No data-loss path: the migration adds a column and backfills it; nothing is dropped or rewritten
  except the index definition itself.
- The change does not widen who may release custody. That authority still lives entirely in
  `sal.complete_delivery` and its gates (verified authorised receiver, mandatory checklist,
  signature, coherent final odometer), unchanged.

## 8. What this change does NOT do

It does not add a reception read of any kind. `P1-27-INT-010` (no reception detail read) and
`P1-27-INT-011` (no reception list read) remain open and are owned by their own remediations. A
Vehicle can now be received twice; **finding it in order to do so is still unsolved.**

## 9. Governance

Delivered on branch `remediation/p1-18-reception-custody-release` from protected `origin/develop`
(`a56eeea0`), as a pull request into `develop`, gated by the same hosted CI as every other change. It
is deliberately **not** carried inside the P1-27 Frontend branch: Database work does not travel in a
Frontend pull request. Nothing reaches protected `develop` outside the approved pull-request and
hosted-CI flow. No dependency scanning, malware scanning, production monitoring, or independent review
exists or is claimed.
