Establishes the four P1-19 module boundaries (`P1-19-BE-001`). Foundation only —
no route handler, no write path, **no migration**.

|                   |                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Protected base    | `f326e24c0340e2ce97a94a768868a26d0cfbb04f`                                                                       |
| Final feature SHA | `595bfd563d0955445ad4a6f4edd6363194eb2f75`                                                                       |
| Clean-room SHA    | `81c9d5c453bd855f103160d78bc482b6ff76ddab` — delta to head is **documentation-only**, executable-path diff empty |
| Diff              | 30 files, +3842 / −5                                                                                             |

## Scope

| Module        | Owns   | Delivers                                                             |
| ------------- | ------ | -------------------------------------------------------------------- |
| `work-order`  | `wo`   | vocabulary, closure-blocker registry, state/transition catalog reads |
| `technician`  | `tech` | eligibility arithmetic, catalog and held-credential reads            |
| `diagnostics` | `dia`  | report vocabulary, template and completion-gate reads                |
| `quality`     | `qms`  | QC and rework reads answering closure blockers B5 and B6             |

Plus 4 error codes, 11 reserved event names, 22 IAM permission codes (catalog
71 → 93), and 20 structural tests.

**Out of scope, unchanged:** migrations, routes, frontend, quotation pricing
(P1-20), stock reservation/issue (P1-21), P1-22, P1-29.

## Three decisions worth reviewing

**The transition graph is read, never mirrored.** `wo.work_order_transitions` and
`wo.job_transitions` are tenant-overridable catalog _tables_, not a `CHECK`. A
TypeScript mirror would reject legitimate tenant edges and drift silently, so
`WorkOrderCatalogRepository` reads them, repeating the guards'
`(scope='platform' OR tenant_id=$1) ORDER BY (scope='tenant') DESC` precedence. A
test forbids the mirror from reappearing in any layer of any of the four modules.

**Six closure blockers, not seven.** `wo.guard_work_order_closure` implements
B1–B6. The brief also asked for reservation and part-issue blockers; neither
exists, because that is P1-21 and no protected table records those facts. A
seventh blocker evaluating "clear" would read, in the API response and every audit
snapshot, as a check that ran and passed. Both are recorded in
`DEFERRED_CLOSURE_BLOCKERS` and pinned by test.

**The registry reports; the trigger enforces.** The guard raises on the _first_
blocker and aborts, so a caller clearing B1 learns of B2 only on the next attempt.
Wave 4's `GET /closure-eligibility` evaluates all six independently. No path may
close an order by asserting the registry passed.

## Corrections the schema forced

Every vocabulary was read from `pg_constraint`. **Four in the phase brief were
wrong** and would have reached PostgreSQL as `23514`:

| Brief                                     | Reality                                     |
| ----------------------------------------- | ------------------------------------------- |
| `kind` includes `warranty`, `internal`    | `('ordinary','rework')` only                |
| `parts_forward_state` `reserved`/`issued` | `('none','requested','reserved_elsewhere')` |
| additional-work `declined`                | `rejected`                                  |
| fulfillment `not_required`                | `waived`                                    |

Two further conflicts resolved toward the repository: `ERR-TRN-001` already means
"transition not permitted", so no per-module duplicate was minted and `ERR-WO-001`
was narrowed to the B1–B6 closure gate; and `EVT-WO-001`/`EVT-TECH-001` cannot
exist because the pinned code format is exactly three letters — the allocation is
`EVT-WOR-*`, `EVT-TEC-*`, `EVT-DIA-*`, `EVT-QMS-*`. See `ECR-P1-19-001`.

## Adversarial review — 0 Critical, 1 High, 10 Medium, all fixed

Two independent read-only reviewers (architecture/DB-contract, security/QA). Every
finding was re-verified before acting; the High was reproduced with a runnable
script first.

**High:** `certificationIsValidOn` read a DATE with UTC accessors the driver never
produces in UTC. `pg-types` routes DATE through `postgres-date`, which builds
_local_ midnight, so at UTC+3 `DATE '2026-07-26'` became `2026-07-25T21:00Z` and a
certification valid through the 26th was refused on the 26th — the exact
off-by-one its own docblock promised could not happen. Now carried as
`to_char(...,'YYYY-MM-DD')`.

**Mediums:** catalog reads filtered `status` before resolving the platform/tenant
override (the guards resolve first) ×6 queries; `cert_status='expired'` ignored
when a date was present; availability coverage required one row to span the window
when a split shift is two legal rows; transition-reason validation ignored the
target state's `reason_required` and the terminal-source refusal; `validationRule`
typed `string` for a `jsonb` column; `job.assigned`/`job.state-changed` owned by
`tech` for `wo.job` aggregates, which would have made Wave 5's own write path
throw; `qms.quality_control.perform` collapsed recording from finalizing;
ineligibility reasons and outstanding item codes placed only in the log-only
`message`; and the claimed registry-vs-guard reconciliation did not exist.

Security posture reviewed clean: all 17 statements bind tenancy from
`context.principal.tenantId`, the two template interpolations are closed unions
with literal-only call sites, and BR-QMS-001 independence survives one principal
holding both rework codes because the constraint enforces it on identity.

## Test evidence

| Suite / gate                                                 | Result                                |
| ------------------------------------------------------------ | ------------------------------------- |
| `test` (unit)                                                | **40 files / 842 tests** (was 829)    |
| `test:db`                                                    | **134 files / 1595 tests** (was 1547) |
| `test:backend`                                               | **38 files / 771 tests**              |
| format, lint, typecheck, build                               | green                                 |
| module boundaries                                            | OK — 269 files                        |
| OpenAPI                                                      | 94 paths, 110 operations, all guarded |
| authorization + operation coverage, encoding, `security:all` | OK                                    |

New tests deliberately fail when a _later_ wave takes a shortcut: no module may
reference a sibling P1-19 schema (matching the qualified name itself, so a
schema-qualified function call cannot slip through); the domain layer stays
database-free; the graph must not be mirrored in any layer; the registry stays at
six; and `tests/db/p1-19-catalog-reconciliation.test.ts` reconciles all 17
vocabularies against live `CHECK` constraints plus every permission code by name,
domain and risk.

Two guards earned themselves during the wave: the sibling-schema check caught
three vocabularies defined in the wrong module, and the reconciliation check
caught that `ck_template_versions_status` exists on both `shared.template_versions`
and `dia.template_versions` with different vocabularies, so the lookup had to be
relation-qualified.

## Clean room — PostgreSQL 17.6, from `81c9d5c`

119 migrations, 7 seeds, `schema_hash`
`a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — **unchanged**,
which is the proof the wave alters no schema object. 242 tables / 212 functions /
631 policies / 541 triggers / 999 indexes, 0 `SECURITY DEFINER`, 0 unforced RLS,
93 permissions, `validate:seed-state` exit 0, business tables empty.

`baseline_fingerprint` moved `0ee203f2…` → `f7baf9b0…`. That is correct, not
drift: the fingerprint covers seed content and the catalog grew by 22 rows. A
fingerprint that had _not_ moved would mean the seed never landed.

## Integrity

Migrations unchanged (119, no `120`, zero M/D/R) · only `supabase/` change is
`seeds/04_iam_permission_catalog.sql` · no routes · no frontend · no P1-20/21/22
work · `main` not pushed · `develop` not pushed · PR #78 untouched (already merged
by the owner before this wave began).

One `test:db` flake recorded rather than omitted: `shared event-outbox worker
lifecycle > a single claim never returns more than its limit` failed once, then
passed in isolation and on clean re-runs. Not attributable here — every P1-19
event entry is `implementedIn: null` and nothing in the diff touches the outbox.

## Remaining P1-19 waves

4 work-order core · 5 technician execution · 6 additional work and approval ·
7 diagnostics · 8 quality, closure and rework · 9 phase-wide hardening.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
