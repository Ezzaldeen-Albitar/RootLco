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
`#199` (PR #77), `#202` (PR #79) — all Success 4/4.

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
rolled-back command publishes nothing. `appointment.changed` and
`reception.approved` are the two envelopes this phase emits; conversion emits
none, because the approved catalog defines none for that fact.

**Known limits.** Persisting denials to `iam.security_events` requires a write
privilege `app_runtime` does not hold (DBCR-P1-13-001, platform-wide,
pre-existing). Path-parameter validation runs before `handleOperation`, so a
malformed id produces a framework 500 without a correlation id or rate limiting —
the platform-wide route idiom, touching no database, recorded here because this
document is the observability evidence for these ten routes.

**Not claimed.** No production monitoring, no alert routing to a live on-call
destination, no dashboards, no SLOs. Alerting configuration is not part of
Phase 1-18.
