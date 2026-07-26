# P1-19 — DevOps and observability

## What this phase added to CI

_Delivers **P1-19-DO-001** — continuous-integration quality gate._

One step, in the `quality` job, immediately after the operation-coverage check:

```yaml
- name: P1-19 endpoint inventory and catalog reconciliation
  run: npm run validate:p1-19-inventory
```

`scripts/p1-19-endpoint-inventory.mjs --check` fails the build when any of the
following is true:

- a P1-19 operation declares a permission code that is **not in
  `supabase/seeds/04_iam_permission_catalog.sql`**;
- a P1-19 operation declares an audit action that is not in the controlled catalog,
  **or declares a different audit class than the catalog assigns it**;
- an event catalog entry claims `implementedIn: 'P1-19'` while **no module publishes
  it**, or a module publishes a type the catalog does not reserve at all;
- an operation's route file carries no `P1-19-BE` annotation;
- an operation is missing from `operation-test-matrix.json`;
- either generated document — [`endpoint-inventory.md`](endpoint-inventory.md) or
  [`task-traceability.md`](task-traceability.md) — is **stale or hand-edited**.

The seed reconciliation runs **code → seed**, never the reverse. The catalogs
legitimately carry codes for phases that have not been implemented yet, so demanding
that every seeded code be consumed would fail for a reason that is not a defect. The
honest direction is that every code this phase _declares_ must exist.

Both documents are rendered through Prettier by the generator itself. Otherwise
`--check` and `format:check` would be permanently in conflict: the generator would
write unformatted markdown and `npm run format` would immediately rewrite it, so one
of the two gates would always be red.

Nothing else in CI changed. No job, no service container, no matrix entry, no timeout,
no permission block.

## Structured logging

_Delivers **P1-19-DO-002** — structured logging, monitoring and alert routing, together with the error-monitoring and metrics sections below._

`handleOperation` is the only logging path a P1-19 operation takes, and it logs the
operation id, the outcome, the timing, and the correlation id. No P1-19 service calls
the logger directly with row content, and none constructs a log line from a request
body.

Two protections sit under that, both pre-existing and neither weakened here:

- **Boundary rule B7** forces backend code onto `@/server/observability/logger` rather
  than the Phase 1-1 bootstrap logger, so there is one path to reason about.
- **`src/server/observability/redaction.ts`** applies two independent layers —
  key-name redaction at every nesting depth, and value-shape scrubbing for
  credential-shaped strings under innocent keys. Its own header is explicit that
  restricted _business_ data is not guessed at: the standard is that callers pass
  identifiers and classifications, never row payloads.

**A limitation worth naming.** Redaction's key list covers columns the classification
registries mark restricted; it is a backstop against an accidental spread, not a
licence to log rows. P1-19's two restricted columns —
`wo.additional_work_request_details.description` and
`qms.rework_link_details.rework_cost` — are protected by never being passed to a
logger, not by trusting the key list to catch them. The Wave 6 suite asserts the
stronger property directly, with a token unique to the restricted description that must
appear in no audit detail, no outbox payload and no non-detail response — while
separately asserting the detail row and the authorized read DO carry it, so the negative
assertions cannot pass against a write that stored nothing.

That sentence was **not true when it was first written**: the test queried
`iam.audit_record_details` alone, and the final adversarial review caught the
overstatement. The test was extended to cover the outbox and the responses rather than
the sentence narrowed to match it.

## Error monitoring

`src/server/observability/monitoring.ts` is a capture **port**, not a provisioned
platform: no DSN, no project and no environment beyond Local exists (ADR-012), so a
real Sentry client here would need a secret this repository must not hold, or would
silently no-op. P1-19 changes none of that and installs no adapter.

What matters for this phase is the boundary the port enforces: an adapter only ever
receives an already-sanitised `MonitoringEvent` — scrubbed message, error class,
catalog code, correlation id, opaque tenant and actor references, scrubbed stack. A
third-party SDK is never handed a raw error carrying request bodies, headers or
database rows. P1-19's failures are `AppFailure` instances carrying a catalog code and
a message that names the rule and the entity id, so a captured P1-19 event contains no
business value even before scrubbing.

## Metrics

No P1-19 service increments a metric directly. The counters that exist
(`src/server/observability/metrics.ts`) are incremented by the request pipeline and by
the authentication path, and P1-19 inherits the former unchanged. Adding per-operation
business counters would be a new observability surface with no consumer in Phase 1, and
this phase does not invent one.

## Deployment posture

No migration, no grant, no role, no environment variable and no `docker-compose` service
changed.

**One seed file changed**, and this section previously said none did.
`supabase/seeds/04_iam_permission_catalog.sql` gained 22 permission codes in Wave 3, so a
deployment of this branch is a code deployment **plus a seed re-run** — not a migration.
The seed is idempotent and additive (`INSERT … ON CONFLICT DO NOTHING` on a stable
`permission_code`), which the clean room proves by applying all seven declared seed files
twice and asserting the counts do not move.

Rollback is still a redeploy of the previous build. The extra permission rows are inert
without a role mapping, so leaving them in place after a rollback grants nobody anything
— removing them is optional cleanup, not a rollback step.
