# P1-19 — Execution checkpoint

Updated after every major wave. This file is the recovery point if context is lost.

## Current position

| Field               | Value                                                             |
| ------------------- | ----------------------------------------------------------------- |
| Protected base SHA  | `f326e24c0340e2ce97a94a768868a26d0cfbb04f`                        |
| Current branch      | `feature/p1-19-module-foundation`                                 |
| Current HEAD        | see `git rev-parse HEAD` — first commit is the Wave 0–2 record    |
| `origin/develop`    | `f326e24…` — unchanged by this phase                              |
| `origin/main`       | `491c4e0…` — moved by the owner's PR #78 merge, not by this phase |
| Pull request        | not opened — see Current blocker                                  |
| GitHub Actions runs | none yet                                                          |
| Delivery model      | wave-per-PR (README §4)                                           |

## Completed

| Wave | Content                                               | Status                    |
| ---- | ----------------------------------------------------- | ------------------------- |
| 0    | Protected ground truth                                | **Complete**              |
| 1    | Repository archaeology and schema reconciliation      | **Complete**              |
| 2    | Feature branch, protected baseline, documentation dir | **Complete**              |
| 3    | Module skeleton, permission catalog, event CR         | **Complete** — PR pending |
| 4–9  | See README §4                                         | Not started               |

## Established facts — do not re-derive

1. `origin/develop` matched the expected P1-18 closure SHA exactly; no intervening
   commits. `main` moved only because the owner merged PR #78 (`491c4e0`, parents
   `3e2c44d` + `f326e24`); `develop` is unaffected and remains the correct base.
2. **The execution brief's table names are wrong.** Use only the verified names in
   README §2. The authoritative handoff is
   `docs/phase-1/phase-1-9/p1-19-backend-contract.md`.
3. **44 tables and 27 functions** exist across `wo`, `tech`, `dia`, `qms`.
4. `wo.guard_work_order_closure()` defines blockers **B1–B6** and raises on the
   **first** one only. The eligibility endpoint must independently re-evaluate all
   six. There is no reservation or part-issue blocker — that is Phase 1-21.
5. Cancellation states (`is_cancellation`) bypass B1–B6 by design.
6. **Zero** `wo`/`tech`/`dia`/`qms` permissions are seeded. P1-19 must extend
   `supabase/seeds/04_iam_permission_catalog.sql` — a seed, not a migration.
7. `EVT-WO-001` / `EVT-TECH-001` / `EVT-DIA-001` / `EVT-QMS-001` **do not exist**
   in the repository. See `ECR-P1-19-001`. Decision taken: follow the shipped
   unsuffixed convention with P1-09 granularity.
8. Module convention: `src/modules/<name>/{application,data,domain}/*.ts` plus
   `index.ts` as the only public surface; cross-module imports must use
   `@/modules/<name>`.
9. Baseline is green: Unit **829** / DB **1547** / Backend **771**, 110 OpenAPI
   operations, 1104 tracked files.
10. `validate:seed-state` ignores `DATABASE_URL` and fails on a dev database after
    `test:db` — pre-existing `P1-05-SEEDRESIDUE`, not a P1-19 signal.

## Open decisions

| ID              | Decision needed                        | Blocking                                   |
| --------------- | -------------------------------------- | ------------------------------------------ |
| `ECR-P1-19-001` | Event type names and suffix convention | Acceptance 6 only; implementation proceeds |

## Wave 3 progress

| Slice                                                                     | Status                                        | Commit    |
| ------------------------------------------------------------------------- | --------------------------------------------- | --------- |
| `work-order` module — domain, catalog repository, catalog service, index  | **Done, green**                               | `0445ee1` |
| Error codes `ERR-WO-001` / `ERR-TECH-001` / `ERR-DIA-001` / `ERR-QMS-001` | **Done, green**                               | `0445ee1` |
| `technician` module                                                       | **Done, green**                               | `e8d6235` |
| `diagnostics` module                                                      | **Done, green**                               | `e8d6235` |
| `quality` module                                                          | **Done, green**                               | `e8d6235` |
| IAM permission seed for the `wo`/`tech`/`dia`/`qms` domains (22 codes)    | **Done, green**                               | `e8d6235` |
| Event envelope registrations (11 reserved names)                          | **Done, green**                               | `e8d6235` |
| Module-boundary tests for the new modules (11 tests)                      | **Done, green**                               | `e8d6235` |
| Permission-total pin `71 → 93`                                            | **Done, green**                               | `662b2f3` |
| Clean room at `662b2f3`                                                   | **Done, green**                               | —         |
| Wave 3 evidence document                                                  | **Done**                                      | —         |
| Adversarial review (2 reviewers, 0 Crit / 1 High / 10 Med, all fixed)     | **Done**                                      | `81c9d5c` |
| Clean room re-run at the remediated SHA                                   | **Done**                                      | `81c9d5c` |
| Branch pushed                                                             | **Done**                                      | `595bfd5` |
| Wave 3 PR                                                                 | **BLOCKED** — no browser, no gh CLI, no token | —         |
| Hosted CI                                                                 | Blocked on the PR                             | —         |

Gates green at `595bfd5`: format, lint, typecheck, module boundaries (**269**
files scanned), OpenAPI (94 paths / 110 operations), authorization coverage,
operation coverage, encoding, `security:all`, build. Unit **842** (was 829) /
DB **1595** (was 1547) / Backend **771**.

Clean room at `81c9d5c`: 119 migrations, 7 seeds, `schema_hash a677eb05…`
**unchanged** from the P1-18 baseline, 242 tables / 212 functions / 631 policies /
541 triggers / 999 indexes, 0 SECURITY DEFINER, 0 unforced RLS, 93 permissions
(22 P1-19), `validate:seed-state` exit 0, business tables empty. Full evidence in
[`evidence/wave-3-module-foundation.md`](evidence/wave-3-module-foundation.md).

The `baseline_fingerprint` moved `0ee203f2…` → `f7baf9b0…`. That is correct, not a
regression: the fingerprint covers seed content, and the permission catalog grew
by 22 rows. A fingerprint that had NOT moved would mean the seed had not landed.

One flake, recorded rather than hidden: the first full `test:db` run failed
`shared event-outbox worker lifecycle > a single claim never returns more than its
limit`. It passed in isolation and on a clean re-run. Not attributable to this
wave — every P1-19 event entry is `implementedIn: null` and nothing in the diff
touches the outbox.

## Corrections made during Wave 3 — do not re-derive

1. **Four vocabularies in the phase brief were wrong**, caught only by reading
   `pg_constraint` rather than trusting the brief: `wo.work_orders.kind` is
   `('ordinary','rework')` with no `warranty` or `internal`; `parts_forward_state`
   is `('none','requested','reserved_elsewhere')` with no `reserved` and no
   `issued`; additional-work state uses `rejected` not `declined`; fulfillment uses
   `waived` not `not_required`. **Verify every remaining vocabulary the same way
   before writing it.**
2. **`ERR-TRN-001` already exists** and already means "transition not permitted
   from the current state" (409, conflict, owner `transition`). Plain graph
   refusals reuse it; the four new codes cover only genuinely new semantics.
3. **`SafeDetails` is a closed platform shape** — only `violations`,
   `retryAfterSeconds`, `contract`, `requiredPermissions`. Do not widen it from a
   module. `message` is log-only and never reaches a caller.
4. **`src/server/events/envelope.ts` IS a formal `EVT-` registry** with 20 codes
   allocated (IAM, CRM, VEH, APT, REC, DOC, NTF, TPL, ORG) and none for
   `wo`/`tech`/`dia`/`qms`. This refines `ECR-P1-19-001`: the registry exists, and
   P1-17 and P1-18 both allocated new codes in it with documented rationale, so
   allocating `EVT-WO-*` and siblings is precedented rather than novel.
5. **Three inventories move together** when an error code is added — the sorted
   code list and the sorted status/owner/class inventory, both in
   `tests/foundation/p1-15-catalogs.test.ts`, plus the error enum in
   `docs/api/openapi.v1.json`. All three are alphabetically ordered.
6. The transition graph is **rows, not code**. Read it through
   `WorkOrderCatalogRepository`; never mirror it in TypeScript.

## Current blocker

PR creation is externally blocked. The Claude-in-Chrome extension disconnected
mid-wave (three retries), is not installed, and no /
is present. The branch IS pushed — =
— so only the PR-open step is missing. Body prepared at
.

## Next action

Continue Wave 3 with the three remaining module skeletons (`technician`,
`diagnostics`, `quality`) against the verified table names, then the IAM permission
seed additions, the event envelope registrations, and module-boundary coverage for
the new modules. Then run the full battery, the clean room, open the Wave 3 pull
request and take it to green hosted CI.
