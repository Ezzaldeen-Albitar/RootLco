# P1-31 — developer guidance

**Task:** P1-31-DOC-002. **Technical owner and review recipient:** Eng. Ezzaldeen Al-Bitar,
under the existing [combined-role policy](../../governance/solo-developer-review-policy.md).
**Implementation basis:** FE-009 protected merge `32c797546f39bc9033dda95181571ce38b2f11cc`
and the report-export implementation recorded in the change-control register.
This guide accompanies the [operator runbook](./operator-runbook.md) and
[change-control register](./change-control-2026-09-08.md). Engineering verification,
Owner acceptance and human certifications are recorded separately.

## 1. Locate the authoritative contract before changing a screen

Use [canonical-plan.md](./canonical-plan.md) for each task's criteria and
[task-matrix.md](./task-matrix.md) for its evidence state. Published operations are defined in
[OpenAPI](../../api/openapi.v1.json); the backend module and route remain the authority for
scope checks, request validation, transactions and outcomes.

| Area                                   | Feature and adapter                                                         | Contract or implementation record                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Delivery readiness and handover        | `apps/web/src/features/delivery/`                                           | [Readiness](./delivery-readiness-seam.md), [delivery reads](./delivery-read-seam.md), [template gate](./p9b-complete-delivery-template-gate.md)              |
| Warranty records, policies and history | `apps/web/src/features/warranty/warranty-api.ts` and `warranty-contract.ts` | [Record screens](./warranty-record-screens.md), [history reader](./warranty-history-seam.md), [policy administration](./warranty-policy-administration.md)   |
| Reports                                | `apps/web/src/features/reports/`                                            | [Report engine](./report-engine-seam.md), [configuration](./report-configuration-seam.md), [screens](./report-screens.md), [export](./report-export-seam.md) |
| Operational overview                   | Follow the feature links in its record                                      | [Operational overview](./operational-overview.md)                                                                                                            |

Keep HTTP calls in `apps/web/src/lib/api` and feature adapters. A component must not call the
database, import backend source, invent an unpublished command, or infer permission from a hidden
button. Route/page gates and server authorization must both remain effective. Add a newly consumed
P1-31 operation to the access gate's explicit operation set as part of the same reviewed change.

## 2. Preserve versions, scope and read outcomes

For a version-guarded command, take `If-Match` from a server read or successful command response.
After a conflict, refresh the authoritative state before another attempt. Do not increment a
version locally or reuse the rejected version. Preserve the adapter's request mirror; a TypeScript
shape does not prove server validation of length, pattern or array cardinality.

Keep a read failure distinct from an empty successful response. Render failures through the shared
state components, including their correlation reference. Do not compose a message key directly
from a `ReadFailureStatus`: `not-found` is not the catalogue spelling `notFound`. Preserve the
English and Arabic translations together, and label opaque actor and entity references.

For further pages, retain already loaded rows on failure, expose a translated failure state and
allow recovery using the same cursor. Show a paging control only when the server reports another
page and supplies a usable cursor. Discard a late response when the screen has moved to another
record; do not append one record's rows under another record's heading.

Warranty history is read from `wty.warranty-status-history`. Render the server's origin row and
transitions as returned. The current implementation has no writer advancing warranty status, so
one origin row is a legitimate history. An actor identifier is a labelled reference, not a resolved
employee name.

Report exports use the displayed successful run's company, branch and period, together with a
required reason. Unsubmitted filter edits must not change the exported selection. The typed
adapter calls `POST /reports/{reportCode}:export` with exactly those five body fields and validates
the returned file context before disclosure. Keep the download control unavailable without
`rpt.export` and configured export authority; the backend also rechecks dataset and scope access.
The CSV is a live result, contains a context record even when no detail rows match, and is disclosed
only after the export audit commits. It is neither a saved snapshot nor an audit-log export.
Preserve duplicate-submission prevention, late-response disposal, URL cleanup and refusal recovery.
Use `reports-api.test.ts`, `report-export.dom.test.tsx`, and the real HTTP/browser companion for
their respective adapter, UI and end-to-end claims. Privileged acceptance fixture setup must stay
separately labelled; it cannot prove that an ordinary administrator delegated export authority.

The [monitoring runbook](./monitoring-runbook.md) describes the local fault queue and its real
exception-capture rehearsal. Fault routing does not resolve the separate D-10 event-consumption
decision or establish delivery to an external service.

## 3. Verify the behavior that changed

Run commands from the repository root unless stated otherwise. Match the checks to the change:

```text
npm run typecheck:web
npm run lint:web
npm run format:check:web
npm run test --workspace @rootlco/web -- tests/warranty.dom.test.tsx
npm run validate:web-boundary
npm run validate:p1-31-access
npm run validate:p1-31-version-sourcing
npm run validate:p1-31-write-shape
npm run verify:policies
```

_2026-09-15 note (DO-001): what the three P1-31 gates read, how to read a red, when to revert the
change that made one red rather than correct the gate through a reviewed change, and why disabling,
skipping or bypassing a required gate is never an operator act are recorded in
[operator runbook § 11](./operator-runbook.md#11-the-three-p1-31-gates--running-them-reading-a-red-and-what-an-operator-may-do-about-it).
Local branch state, pending the hosted run._

Choose the affected DOM files for delivery or policies instead of treating the example as a full
suite. Add meaningful negatives for permission/scope refusals, failed paging and stale responses.
A test behind a mocked adapter proves the UI response; it does not establish server authorization.
Use the [error-path](./error-path-matrix.md), [isolation](./isolation-matrix.md) and
[least-privilege](./least-privilege-grant-map.md) matrices to locate backend proof obligations.
Database execution follows [fixture isolation](./test-fixture-isolation.md) and the current resource
handoff. Existing acceptance and business records are not disposable test fixtures.

The canonical frontend criterion includes Arabic/English, RTL/LTR, desktop/tablet, accessibility,
and loading/empty/error/permission states. A collection count or desktop-only run does not prove
all of those. Use the current [acceptance plan](./acceptance-plan.md) and head-bound handoff for the
browser run. The authenticated workspace command is:

```text
npm run test:e2e:authenticated --workspace @rootlco/web
```

The configured authentication and journey handoff are prerequisites; do not invent credentials or
records to make a case run. A failed warranty-history prerequisite is published as an explicit
failure and must fail its browser case before the legacy-handoff skip. A skipped dependent case
is not a passing proof.

## 4. Record and integrate one complete candidate

After executable changes settle, record the full affected tiers with the repository's writer:

```text
node scripts/ci/check-p1-27-closing-values.mjs --record unit
node scripts/ci/check-p1-27-closing-values.mjs --record web
node scripts/ci/build-p1-27-evidence-manifest.mjs
npm run verify:policies
```

These commands produce local evidence. Retain the source SHA, runner verdict and raw reports;
do not turn a local measurement into hosted evidence by editing its provenance. Update linked
measured values from the actual records. The closing-values validator detects stale executable
heads and inconsistent citations; do not weaken it to retain an obsolete record.

Freeze the complete candidate for review, then push through a PR targeting `develop`. Read the
live required contexts and the conditional-job classification for that actual head. Check the
protected merge commit separately; PR success is not post-merge verification. The
[standing verification policy](../../../CONTRIBUTING.md) permits targeted local checks and the
required hosted aggregate; report commands that were not run accurately.

Update the register, task matrix and guidance when behavior or evidence changes. Retain historical
observations with their source heads. The current decision packet remains the authority for
unresolved export, monitoring, permission, documentation-path and acceptance decisions. This guide
does not supply those decisions or a human certification. Route the final controlled document and
its evidence to the named technical owner through that packet.
