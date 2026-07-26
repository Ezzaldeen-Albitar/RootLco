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
| Pull request        | none yet                                                          |
| GitHub Actions runs | none yet                                                          |
| Delivery model      | wave-per-PR (README §4)                                           |

## Completed

| Wave | Content                                               | Status                  |
| ---- | ----------------------------------------------------- | ----------------------- |
| 0    | Protected ground truth                                | **Complete**            |
| 1    | Repository archaeology and schema reconciliation      | **Complete**            |
| 2    | Feature branch, protected baseline, documentation dir | **Complete**            |
| 3    | Module skeleton, permission catalog, event CR         | In progress — CR raised |
| 4–9  | See README §4                                         | Not started             |

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

## Next action

Wave 3 — implement the four module skeletons (`work-order`, `technician`,
`diagnostics`, `quality`) with domain types, Zod schemas and repositories against
the verified table names; extend the permission catalog seed with the `wo`, `tech`,
`dia`, `qms` domains; register the proposed event envelopes; add module-boundary
coverage. Then run the scoped battery and commit atomically.
