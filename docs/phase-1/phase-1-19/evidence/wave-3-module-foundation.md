# P1-19 Wave 3 — Module foundation evidence (P1-19-BE-001)

```
P1_19_BASE_SHA  = f326e24c0340e2ce97a94a768868a26d0cfbb04f
Branch          = feature/p1-19-module-foundation
CLEAN_ROOM_SHA  = 81c9d5c453bd855f103160d78bc482b6ff76ddab
```

## 1. What Wave 3 delivers

Four bounded modules, each owning exactly one schema and exposing a single public
surface. No route handler, no write path, no migration.

| Module        | Owns schema | Domain                                   | Data                          | Application                    |
| ------------- | ----------- | ---------------------------------------- | ----------------------------- | ------------------------------ |
| `work-order`  | `wo`        | vocabulary, closure-blocker registry     | `WorkOrderCatalogRepository`  | `WorkOrderCatalogService`      |
| `technician`  | `tech`      | eligibility arithmetic, labor vocabulary | `TechnicianCatalogRepository` | `TechnicianEligibilityService` |
| `diagnostics` | `dia`       | report vocabulary, completion gate       | `DiagnosticsRepository`       | `DiagnosticsCompletionService` |
| `quality`     | `qms`       | QC / rework / reopen rules               | `QualityRepository`           | `QualityGateService`           |

## 2. Three design decisions worth defending

**The transition graph is read, never mirrored.** Every prior module in this
repository restates its trigger-enforced graph as a frozen literal, because those
graphs live in `CHECK` constraints and PL/pgSQL. The work-order graph is different:
`wo.work_order_transitions` and `wo.job_transitions` are catalog **tables** with a
`scope` of `platform` or `tenant`, and `wo.guard_work_order_transition` reads them
at write time. A TypeScript mirror would reject legitimate tenant edges and drift
the moment an edge is added or deactivated. `WorkOrderCatalogRepository` therefore
reads the graph, repeating the guards' own
`(scope = 'platform' OR tenant_id = $1) ORDER BY (scope = 'tenant') DESC`
precedence so the API cannot report a graph the database does not enforce. A
foundation test forbids the mirror from reappearing.

**Eligibility lives in `technician`, not `work-order`.** An assignment is a `wo`
row, so the opposite would be defensible — but eligibility is decided entirely
from `tech` rows, and deciding it inside `work-order` would mean `work-order`
reading `tech` tables directly, which ADR-001 rule 3 prohibits. Wave 5 composes
the two through the public surface instead.

**The closure registry reports; it never enforces.**
`wo.guard_work_order_closure` stays the authority — it runs inside the same
statement as the state change, so nothing can slip between check and write. But it
`RAISE`s on the **first** blocker and aborts, so a caller clearing B1 discovers B2
only on the next attempt. `CLOSURE_BLOCKER_REGISTRY` exists so Wave 4's
`GET /closure-eligibility` can evaluate all six independently and return every
unmet one. No code path may close an order by asserting the registry passed.

## 3. Blockers: six, not seven

`wo.guard_work_order_closure` implements exactly B1–B6:

| Code | Blocker                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| B1   | A non-terminal job remains on the work order                                       |
| B2   | An open-ended (`ended_at IS NULL`) labor session remains                           |
| B3   | A **required** additional-work request is `pending`, or `approved` + `unfulfilled` |
| B4   | A `requires_diagnostic` job has no `completed` diagnostic report                   |
| B5   | QC failed with no passing record, **or** a mandatory check exists with no pass     |
| B6   | Safety-critical rework on this order lacks `independent_sign_off_by`               |

The phase brief also asked for "no active reservation" and "no open part issue".
Neither is in the guard, because stock reservation and issue execution are Phase
1-21 and no protected table records them. A seventh blocker that always evaluated
clear would be worse than its absence: in the API response and in every audit
snapshot it would read as a check that ran and passed. Both are recorded in
`DEFERRED_CLOSURE_BLOCKERS` with `owner: 'P1-21'`, and a test pins that.

`wo.work_orders.parts_forward_state` is the forward hook, and its vocabulary makes
the point — `none` → `requested` → `reserved_elsewhere`, with no `issued` value,
because issuing stock is not a fact this schema can record.

## 4. Corrections forced by the schema

Every vocabulary was read from `pg_constraint`. Four in the phase brief were wrong
and would have reached PostgreSQL as `23514`:

| Brief said                                | `pg_constraint` says                        |
| ----------------------------------------- | ------------------------------------------- |
| `kind` includes `warranty`, `internal`    | `('ordinary','rework')` only                |
| `parts_forward_state` `reserved`/`issued` | `('none','requested','reserved_elsewhere')` |
| additional-work state `declined`          | `rejected`                                  |
| fulfillment `not_required`                | `waived`                                    |

Two further conflicts with the brief were resolved in the repository's favour:

- **`ERR-WO-001` was nearly a duplicate.** `ERR-TRN-001` already exists and already
  means "transition not permitted from the current state" (409, conflict). Plain
  graph refusals reuse it. `ERR-WO-001` was kept but narrowed to the B1–B6 closure
  gate specifically, which is a different fact: the `ready_to_close → closed` edge
  _does_ exist and the aggregate _is_ in a legal starting state.
- **`EVT-WO-001` and `EVT-TECH-001` cannot exist here.** The pinned code format is
  exactly three letters, `^EVT-[A-Z]{3}-\d{3}$`. The allocation uses `EVT-WOR-*`,
  `EVT-TEC-*`, `EVT-DIA-*`, `EVT-QMS-*`. See `ECR-P1-19-001`.

## 5. Catalog additions

**Error codes** — four, in `src/server/errors/catalog.ts`:
`ERR-WO-001` (closure blocked, 409), `ERR-TECH-001` (technician ineligible, 422),
`ERR-DIA-001` (mandatory diagnostic items unresolved, 409), `ERR-QMS-001`
(reopen rejected / missing independent sign-off, 409).

**Events** — eleven reserved names, all `implementedIn: null` because a reserved
name is not an implementation:

`work-order.created`, `work-order.state-changed`, `work-order.closed`,
`job.assigned`, `job.state-changed`, `labor.session-changed`,
`additional-work.requested`, `customer-approval.recorded`,
`diagnostic-report.completed`, `quality-control.finalized`, `rework.linked`.

Wire names are unsuffixed, matching all twenty pre-existing entries; version is
carried by `schemaVersion`, which is what that field is for.

**Permissions** — twenty-two codes, `71 → 93`, in
`supabase/seeds/04_iam_permission_catalog.sql` (a seed, not a migration).
Deliberate separations: raising additional work from approving it; recording labor
from correcting it; rework management from independent sign-off, because
BR-QMS-001 requires the sign-off authority to be separable from the doer.

## 6. Test evidence

| Suite / gate                        | Result                                    |
| ----------------------------------- | ----------------------------------------- |
| `test` (unit)                       | **40 files / 842 tests** passed (was 829) |
| `test:db`                           | **134 files / 1595 tests** passed         |
| `test:backend`                      | **38 files / 771 tests** passed           |
| `format:check`, `lint`, `typecheck` | green                                     |
| `validate:module-boundaries`        | OK — 269 files scanned (was 253)          |
| `validate:openapi`                  | 94 paths, 110 operations, all guarded     |
| `validate:authorization-coverage`   | OK                                        |
| `validate:operation-coverage`       | OK                                        |
| `validate:encoding`                 | OK                                        |
| `security:all`                      | OK                                        |
| `build`                             | Compiled successfully                     |

The eleven new tests are in `tests/foundation/p1-19-module-foundation.test.ts` and
are deliberately the kind that fail when a **later** wave takes a shortcut: no
module may write SQL against a sibling P1-19 schema, the domain layer stays
database-free, the transition graph must not be mirrored, the registry must stay
at six with the P1-21 conditions recorded as deferred, and every vocabulary is
pinned to what `pg_constraint` allows.

**The sibling-schema guard immediately earned itself.** It failed on first run and
caught three vocabularies defined in `work-order` that belong to `diagnostics`,
`quality` and `technician`. Two definitions of one `CHECK` constraint only ever
diverge silently; each now lives with the module that owns its table.

### One flake, recorded rather than hidden

The first full `test:db` run reported
`shared event-outbox worker lifecycle > a single claim never returns more than its limit`
as failed. It passed in isolation and passed on a clean re-run of the full suite.
It is not attributable to this wave: every P1-19 event entry is
`implementedIn: null` and nothing in the diff publishes, claims or completes an
outbox row. Recorded as a pre-existing full-suite flake.

## 7. Clean room — PostgreSQL 17.6, exact SHA

Built from `81c9d5c` only: 119 migrations in order, then the 7 declared seeds.

| Measure                    | Value                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| Migrations / seeds         | **119** / **7**                                                    |
| `schema_hash`              | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` |
| Schemas / tables / columns | 17 / **242** / 3562                                                |
| Functions / triggers       | **212** / **541**                                                  |
| Policies / indexes         | **631** / **999**                                                  |
| Constraints / views        | 1845 / 0                                                           |
| `SECURITY DEFINER`         | **0**                                                              |
| RLS enabled but not forced | **0**                                                              |
| `iam.permissions`          | **92** (21 in `wo`/`tech`/`dia`/`qms`)                             |
| `validate:seed-state`      | **exit 0** — 7 files applied twice, counts idempotent              |

The `schema_hash` is **byte-identical to the P1-18 baseline**, which is the proof
that Wave 3 changed no schema object.

The `baseline_fingerprint` **did** move, `0ee203f2…` → `f7baf9b0…`, and that is
correct rather than a regression: the fingerprint covers seed content as well as
schema, and the permission catalog grew from 71 to 93 rows. A fingerprint that had
_not_ moved would mean the seed addition had not landed.

Business tables are empty. The only rows are structural reference data: the four
`wo` state and transition catalogs (9 / 15 / 6 / 10), seeded by the Phase 1-9
migrations, plus the platform catalogs the earlier phases own.

## 8. Scope verification

| Check                         | Result                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| Migration files changed       | **none** — `git diff f326e24..HEAD -- supabase/migrations` is empty |
| Migration count               | 119, unchanged, no `120`                                            |
| Only `supabase/` change       | `seeds/04_iam_permission_catalog.sql`                               |
| Route handlers added          | none — Waves 4–8                                                    |
| Frontend changed              | none                                                                |
| Phase 1-20 / 1-21 / 1-22 work | none                                                                |
| `origin/main` pushed          | no                                                                  |
| `origin/develop` pushed       | no                                                                  |
| PR #78                        | untouched (already merged by the owner before this wave)            |

## 8b. Adversarial review

Two independent read-only reviewers ran against the full Wave 3 diff: one on
architecture and database contract, one on security and QA. Neither ran tests,
edited a file, or ran state-changing git; both verified claims against the live
catalog with read-only .

**0 Critical. 1 High. 10 Medium. Every confirmed finding is fixed** — see commit
. Each was re-verified before acting rather than taken on trust, and the
High was reproduced with a runnable script before a line was changed.

The High is worth stating plainly because it was in code, not prose:
read a DATE with UTC accessors that the driver never
produces in UTC, so a certification valid through its expiry day was refused on
that day, east of Greenwich — the exact off-by-one its own docblock promised could
not happen. This machine sits at UTC+3 and reproduced it on the first attempt.

Findings clustered in three places, and the pattern is worth recording: catalog
reads that filtered before resolving the platform/tenant override rather than
after; validations narrower than the guard they claim to pre-empt; and error
payloads placed in a channel the caller never receives. All three are cases of the
code doing something slightly different from what its own comment said — the same
class of defect the P1-18 phase kept finding, and the reason both reviewers were
asked to check comments against code rather than only code against schema.

Security posture was reviewed and found clean: all 17 statements bind tenancy from
and none takes it from an argument; the two template
interpolations are closed unions with literal-only call sites; and BR-QMS-001
independence survives one principal holding both rework codes, because the
constraint enforces it on identity rather than on permission.

## 9. Remaining P1-19 waves

Wave 4 work-order core · Wave 5 technician execution · Wave 6 additional work and
approval · Wave 7 diagnostics · Wave 8 quality, closure and rework · Wave 9
phase-wide hardening and final evidence.
