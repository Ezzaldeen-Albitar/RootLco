# P1-18 — DevOps and observability evidence (P1-18-DO-001…002)

Gate condition 13 cites these identifiers. Until this document existed they
appeared **only in the gate's own condition table**.

Requirements are quoted from the canonical Phase 1 Development Plan. This phase
adds no infrastructure: it consumes the Phase 1-13 backend foundation and the
Phase 1-1 container setup unchanged.

---

## P1-18-DO-001 — Continuous-integration quality gate

_Prepare and automate the continuous-integration quality gate with environment
segregation, least privilege, observable execution, rollback criteria, and a
recorded operator runbook._

**Hosted gate.** Four required checks on every pull request and every push to a
protected branch:

| Check                             | Purpose                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Lint, types, tests, build         | format, ESLint, `tsc --noEmit`, unit suite, production build                                                |
| Docker build validation           | `docker compose config`, dev stage, production runner stage, and a **non-root runtime assertion** (ADR-007) |
| Database migrations and RLS tests | all migrations against a fresh `postgres:17-alpine` service container, then the full database suite         |
| Secret and sensitive-file scan    | tracked secrets, browser-exposed service-role variables                                                     |

**Environment segregation.** The database job runs against an ephemeral service
container with throwaway credentials; no shared or production database is
reachable from CI. Locally the same commands are driven through
`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`, which is the single
connection convention.

**Least privilege.** Application work runs as `app_runtime` — not a superuser,
no `BYPASSRLS`, owner of no application table, no `DELETE` grant on `apt`, `rec`
or `wo`. `app_readonly` is SELECT-only; `app_worker` is confined to the `shared`
schema. Verified in every clean room.

**Observable execution and rollback criteria.** Migrations are immutable once
merged — a pull request may only ADD migration files, and CI fails closed if the
base ref cannot be resolved. P1-18 adds none: 119 migrations, no 120, zero
modified/deleted/renamed. The rollback criterion for this phase is therefore
`git revert` of the feature merge; no data migration has to be undone.

**Runbook.** `npm run dev:up` / `dev:reset` / `supabase:start` / `supabase:reset`
for local; `db:apply-migrations` + `validate:seed-state` against a fresh
container for clean-room reproduction. The exact sequence used for this phase is
recorded in `local-release-candidate-validation.md`.

**Reproducibility.** Exact-SHA clean rooms were run from an empty PostgreSQL 17
container with the worktree verified clean at the candidate SHA, and produced
schema hash `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` —
byte-identical to the frozen P1-17 baseline, which is what a phase adding no DDL
must produce.

**Artifact stability.** Operation matrices and the OpenAPI document regenerate
byte-identically across two consecutive runs; second-run drift zero.

**Historical CI, disclosed rather than hidden.** `CI #195` (PR #76 opened)
**failed**; `CI #196` (synchronize) passed after the correction; `CI #197` merged
green. Authoritative protected push runs: `#194` (PR #75), `#197` (PR #76),
`#199` (PR #77), `#202` (PR #79) and **`#205` (PR #80, run id `30192246332`, SHA
`a13ff8b`)** — all Success 4/4. `#205` is the run the gate is decided against;
the PR-head run `#204` is not treated as protected-merge evidence.

**Not claimed.** No production deployment, no registry push, no environment
promotion, no release artefact.

---

## P1-18-DO-002 — Structured logging, monitoring, and alert routing

_Prepare and automate structured logging, monitoring, and alert routing…_

**Correlation and causation.** Every request carries a correlation id, echoed on
the response and present on every log line; a caller-supplied causation id is
carried when given. Both are stamped on audit records and outbox envelopes, so a
business fact can be traced back to the request that caused it.

**Structured logging.** JSON lines with a fixed field set — severity, service,
version, env, module, operation, correlationId, tenantRef, actorRef, durationMs,
result, errorCode. Identifiers are references, not payloads.

**Safe error logging — what is deliberately absent.** No permission code a
principal holds, no company or branch id, no resource id, and no restricted
narrative appears in a log line. An authorization denial logs
`result: 'denied'`, `errorCode: 'ERR-IAM-001'` and the failed permission codes —
which are documented API metadata — and nothing about the resource. The deferred
empty-target refusal logs `reason: 'deferred-scope-target-missing'` and the
declared scope.

**Monitoring and exception behaviour.** Denials increment
`METRICS.errorCount` tagged by code and operation. `5xx` responses are forwarded
to the exception monitor; `4xx` are not — which is why the row-policy mappers
convert a policy refusal into `ERR-IAM-001` rather than letting it escape as
`ERR-SYS-001`, since an authenticated caller could otherwise manufacture
unlimited incidents at will.

**Transactional outbox.** Events are written on the request transaction, so a
rolled-back command publishes nothing. `appointment.changed`,
`vehicle.checked-in` (EVT-REC-001) and `reception.approved` are the **three**
envelopes this phase emits; conversion emits none, because the approved catalog
defines none for that fact.

**Known limits.**

_Denials are not durably recorded, and the reason previously given here was
false._ An earlier revision of this document stated that persisting denials to
`iam.security_events` "requires a write privilege `app_runtime` does not hold
(DBCR-P1-13-001)". That is untrue and was untrue when written. `af240f0`
(P1-13, 2026-07-21) added both
`GRANT INSERT ON iam.security_events TO app_runtime` and the policy
`ins_security_events_runtime`
(`supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql:366,368-370`),
and `recordSecurityEvent` probes that capability before writing
(`src/server/audit/security-events.ts:56-73`), so the write would land today.

The real cause is narrower and is **not** a privilege at all: `noteDenial`
(`src/server/http/route-handler.ts:466`) is the only bridge from an authorization
denial to `recordSecurityEvent`, and it has **no call site**. `grep -rn noteDenial
src/ tests/ scripts/` returns exactly one hit — its own definition. Neither
`requirePermissions` nor `requireScopedPermissions` calls it; both only
`log.warn` and increment a counter. Failed logins do persist
(`src/modules/iam/application/authentication-service.ts:309`); authorization
refusals do not.

Consequence, stated plainly: a cross-branch privilege probe — the exact attack
this phase exists to stop — is refused correctly, but the only trace is a stdout
log line and an in-memory counter that exports nowhere — the default recorder is
`InMemoryMetricsRecorder` (`src/server/observability/metrics.ts:135`) and the
exported `setMetricsRecorder` (`:142`) is never called in `src/` or `tests/`.
Nothing reaches
`iam.security_events`, so `iam.audit.view` shows an empty security log and the
evidence does not survive a container restart.

This is pre-existing and platform-wide, not introduced by P1-18: the unwired
`noteDenial` and the stale comments at `src/server/auth/authorization.ts:127-130`
and `src/server/audit/security-events.ts:7-9` all date to `cf85615` (P1-13), and
the grant that falsified them landed in the same phase. It was booked at P1-13 as
`ADV-07` — _"`noteDenial` has no call site … three source comments are stale",
**Accepted**, "the capability is proven, the wiring is P1-14"_
(`docs/phase-1/phase-1-13/phase-1-13-owner-gate.md:157`). That row is decisive:
P1-13 itself recorded the capability as **proven**, so the privilege was never the
obstacle and this document should never have said it was. Five phases later it is
still unwired, and the justification had hardened into a claimed immovable
platform constraint. It is re-opened here as **P1-18-R-03, Medium** — raised from
Low because the scheduling promise lapsed and the stated blocker was never real,
and because P1-18 is the first phase whose primary control is the one going
unrecorded. Wiring it is a `src/` change and therefore outside a
documentation-only gate branch; it is carried forward, not closed.

_Path-parameter validation_ runs before `handleOperation`, so a malformed id
produces a framework 500 without a correlation id or rate limiting — the
platform-wide route idiom, touching no database, recorded here because this
document is the observability evidence for these ten routes.

_A refusal names the operation but not the scope._ The log carries `module`,
`operation`, `correlationId`, `tenantRef`, `actorRef` and the failed permission
codes, but never the `AuthorizationTarget` the decision was made against, and
never the resource id. An operator therefore cannot distinguish "holds the
permission nowhere" from "holds it, but in a different branch than the target" —
which is precisely the distinction this phase introduced. Recorded as
**P1-18-R-04, Low**. Note for whoever closes it: `redaction.ts:31-60` matches
`auth` as a case-insensitive substring, so a field named `authorizationTarget`
would be redacted to `[REDACTED]`; the field needs a different name.

_Denials are counted twice into one series._ `authorization.ts:142` and `:202`
increment `METRICS.errorCount{code,operation}` and then throw;
`route-handler.ts:427` catches the `AppFailure` and increments the same metric
with the same labels. `InMemoryMetricsRecorder.seriesKey` sorts label keys
(`metrics.ts:90-95`), so both land on one series and
`http.error.count{code=ERR-IAM-001}` reads exactly 2× reality while
`http.request.count{result=failure}` reads 1×. Pre-existing (the same shape is in
`entitlement.ts:71`), inherited unchanged by the new scoped path. Recorded as
**P1-18-R-05, Low**.

_Six gate scripts are declared in `package.json` but never executed by CI._
Measured by resolving every `validate:*` / `security:* `/ `gate:*` script to its
underlying `scripts/**.mjs` file and searching `.github/workflows/ci.yml` for
both the script name and the file path — 24 gate scripts exist, and these six
match neither:

| Script                       | What goes unguarded                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `validate:canonical-docs`    | canonical DOCX hash drift                                                                                                                  |
| `validate:schema-inventory`  | live schema hash                                                                                                                           |
| `validate:structural-review` | unvalidated FK; `ON DELETE CASCADE` parented on a financial/append-only/audit table; a live module table missing from `data-dictionary.md` |
| `validate:upgrade-matrix`    | phase-boundary upgrade equivalence                                                                                                         |
| `validate:baseline-manifest` | the Release-2 baseline fingerprint                                                                                                         |
| `gate:p1-12`                 | the consolidated database pipeline, whose own header says "Reusable in CI"                                                                 |

Each exits non-zero on failure, so each is a real gate that can rot undetected. A
future change that alters the `a677eb05…` schema hash, or adds a table absent
from the data dictionary, passes all four CI jobs green; those invariants are
currently checked only when a human runs a clean room by hand — as this phase did.
Four of the six need only a live Postgres with migrations applied, which the
`database` job already has.

The rot is not hypothetical. `scripts/db/phase-upgrade-matrix.mjs` carries
`CUTOFFS` ending at phase 13 and warns `expected 114 migrations, found 119`
(`:93`); the P1-14, P1-15 and P1-16 phase boundaries are silently not exercised,
and nothing detects it because the script is not in CI. Both the constant and the
cutoff table date to `af240f0` (P1-13) and are untouched by P1-18.

Recorded as **P1-18-R-08, Medium**. Pre-existing and platform-wide; adding jobs to
`.github/workflows/ci.yml` is outside a documentation-only gate branch.

_The migration-immutability control does not run on push._ `ci.yml` guards that
step with `if: github.event_name == 'pull_request'` while the workflow also
triggers on `push` to `develop` and `main`, so a direct push or an admin-bypassed
merge can modify an already-merged migration without the check executing. The step
itself is well built (`set -euo pipefail`, explicit `git rev-parse --verify` so an
unresolvable base fails closed); only the trigger condition leaves the gap.
Recorded as **P1-18-R-11, Low**.

**Not claimed.** No production monitoring, no alert routing to a live on-call
destination, no dashboards, no SLOs. Alerting configuration is not part of
Phase 1-18.
