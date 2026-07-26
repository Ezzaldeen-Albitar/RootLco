# Wave 4 — routes written but deliberately withheld

Two route handlers are complete and were **removed from `src/` on purpose** rather
than shipped. They are preserved verbatim beside this file.

## Why they are not in `src/`

`validate:operation-coverage` requires every registered operation to reach
**operation-depth** — real API tests carrying the declared evidence kinds. Both
routes register cleanly (`validate:authorization-coverage` passed with them in
place, and the regenerated OpenAPI reached 96 paths / 112 operations), but neither
has its backend test yet.

Shipping them would have put the branch — and therefore PR #82 — into a state where
`validate:operation-coverage` fails. The alternative, registering them in the
coverage manifest as `pending`, is worse: P1-18 closed at **0 pending** and a
pending entry is precisely the shape of evidence debt that phase spent four
remediation rounds removing.

So the routes wait for their tests. Nothing about them is speculative — they were
written against the real registry and the real generator, and the two catalog
changes they need are already merged.

## What IS already merged and green

| Piece                                                                                                          | Where                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Four audit actions — `wo.work_order.state_changed`, `wo.work_order.closed`, `wo.job.created`, `wo.job.updated` | `src/server/auth/audit-actions.ts`, pinned in `tests/foundation/p1-15-catalogs.test.ts` (78 → 82) |
| Deferred scoped authorization threaded through every work-order entry point                                    | `work-order-service.ts` — `authorizeScope({ companyId, branchId })` against the row's own scope   |

The scoped-authorization threading is the P1-18-A-01 lesson applied before the
routes exist rather than after: `scope: 'branch'` is inert without a target,
because `requiresScopedEvaluation` returns false on an empty one regardless of the
declared scope, and RLS cannot contain the gap because `app.branch_ids` is the
permission-blind union of every active grant.

## Restoring them — exact steps

1. `mkdir -p "src/app/api/v1/work-orders/[workOrderId]/closure-eligibility"` and
   `.../transition`, then copy the two `.txt` files back as `route.ts`.
2. Add both imports to the hand-maintained list in
   `tests/openapi-contract.test.ts` (after the P1-18 block). **That list is the
   trap** — its own comment records that all twelve P1-18 operations were missing
   from the published contract while every gate read green, because both sides of
   the comparison agreed on the same incomplete registry.
3. Add `'dia'`, `'qms'`, `'tech'`, `'wo'` to `SEEDED_DOMAINS` in the same file, in
   sorted position. Without them the permission-catalog assertion fails with
   `permission "wo.work_order.read" uses an unseeded domain`.
4. Regenerate: `UPDATE_OPENAPI=1 npx vitest run tests/openapi-contract.test.ts`.
   Do **not** hand-edit `docs/api/openapi.v1.json` — it is generated, and a manual
   edit is overwritten and rejected by the contract test.
5. Write `tests/backend/p1-19-work-order-core.test.ts` and add both operations to
   the manifest in `scripts/check-operation-test-coverage.mjs` with the evidence
   kinds each requires.

## Evidence kinds the two operations need

Modelled on `rec.reception-approve`, which requires
`success`, `denial`, `cross-tenant`, `isolation`, `audit`, `outbox`,
`stale-version`, `concurrency`.

**`wo.work-order-closure-eligibility`** (GET, `wo.work_order.read`) —
`success`, `denial`, `cross-tenant`, `isolation`. No audit (class `none`), no
outbox, no version guard. The interesting assertions are behavioural rather than
structural: a work order with two unmet blockers must return **both**, in registry
order, and an order already terminal must return `alreadyTerminal` with an empty
list because the guard evaluates nothing.

**`wo.work-order-transition`** (POST, `wo.work_order.transition`) —
`success`, `denial`, `cross-tenant`, `isolation`, `audit`, `outbox`,
`stale-version`, `concurrency`. Denial covers three distinct refusals that must not
be conflated: an edge absent from the graph (`ERR-TRN-001`), a required reason
missing (`ERR-VAL-001`), and a terminal target with unmet blockers
(`ERR-WO-001`, carrying every blocker rather than the guard's first).

`tests/backend/p1-18-reception-conversion.test.ts` already builds a work order
through the authoritative conversion path; that is the fixture to reuse, not a
second insert.

## Not yet started in Wave 4

Job routes (`POST /work-orders/{id}/jobs`, `PATCH /jobs/{jobId}`), the list and
aggregate-detail queries and their routes, outbox publication for the two
registered work-order events, and the audit wiring for all of the above.
