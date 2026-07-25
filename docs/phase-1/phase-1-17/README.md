# Phase 1-17 — Vehicle Backend

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-24 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**No document in this folder is an independent third-party audit.**

> **Authority.** Phase scope and sequencing are governed by the canonical documents recorded in
> [canonical-documents.md](../../governance/canonical-documents.md), which live outside this
> repository by owner decision.

---

## Status

**The owner gate is [Go — P1-17 Vehicle Backend Gate Passed](phase-1-17-owner-gate.md), recorded
against evidence on protected `develop` `f18b855`.** The decision was made only after the whole
phase — the feature merge and three post-merge remediations — reached protected history and was
re-verified there; it was never filled from intention. Phase 1-18 remains unauthorized until the
gate-record pull request is merged and that protected merge is separately verified.

This phase builds the **application backend for the vehicle domain** on top of the vehicle database
delivered by Phase 1-7 and consumed unchanged, and on the request/authorization/audit/outbox
foundation delivered by Phases 1-13, 1-14, and 1-15 (with the customer domain from Phase 1-16). It
adds **no migration**: the 119 migrations on protected `develop` are consumed as they stand. If a
mandatory vehicle operation cannot be performed under the real runtime role because of a database gap,
that gap is raised as a controlled change request (DBCR) and delivered in its own remediation pull
request — never as a convenience migration inside this feature.

| Step                                                                         | State                                                                                    |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Wave 0 — ground truth                                                        | **Complete** — `feature/p1-17-vehicle-backend` from protected `develop` `a1cfa36`, clean |
| Wave 1 — canonical requirements + dependency audit (P1-7/13/14/15/16 all Go) | **Complete**                                                                             |
| Wave 2 — vehicle runtime feasibility audit                                   | **Complete — NO BLOCKERS** (no feature migration / no DBCR required)                     |
| Waves 3–11 — vehicle module implementation (20 operations)                   | **Complete** — see the operation inventory below                                         |
| Local validation (CI-equivalent battery on protected `develop` `f18b855`)    | **Complete** — Unit 733 / DB 1547 / Backend 567, build + all guards green                |
| Post-merge remediations (PR #71, PR #72, PR #73)                             | **Complete** — see the owner gate for what each fixed and why                            |
| Owner gate                                                                   | **Go** — recorded on `f18b855`; see [the gate record](phase-1-17-owner-gate.md)          |

## Feasibility result (Wave 2)

**P1-17 DATABASE CAPABILITY AUDIT — NO BLOCKERS.** The frozen `veh` schema (23 tables, Phase 1-7)
already grants the least-privilege `app_runtime` role SELECT + INSERT on all 23 tables and UPDATE on
16 (seven history/event tables are append-only by design); no application role has physical vehicle
DELETE; FORCE RLS and tenant isolation are in place; the four foundation write capabilities
(`audit.append`, `outbox.publish`, `idempotency.store`, `security-event.record`) are platform-granted.
`veh.vehicles` requires only the context-supplied tenant and actor (VIN, `display_number`, and catalog
references are all nullable). Phase 1-16 already writes `veh.vehicle_relationships` under the runtime
role, and the Phase 1-7 database suite exercises all 23 vehicle tables under the runtime role. **No
migration and no DBCR are required for the feature path.**

Application-layer obligations that follow from the frozen schema (handled in the services, not the
database): resolve or refuse **merged** vehicles before any UPDATE; gate **restricted** identifiers
(chassis / engine number) behind `iam.sensitive.view`; map PostgreSQL exclusion conflicts (`23P01`)
and lifecycle-guard conflicts (`23514`) to stable `409` responses; treat tenant vehicle catalogs as
optional scoped extensions.

## Decisions

- **New module `src/modules/vehicle`** (domain / application / data / index.ts), mirroring
  `src/modules/crm`; the only legal import path is the module barrel `@/modules/vehicle`.
- **Reuse, do not duplicate**: the shared VIN normalizer (`@/modules/shared-services`), the shared
  attachment/document service (Phase 1-15), and the whole request/audit/outbox/idempotency pipeline.
- **Single source of truth**: `veh.vehicle_relationships` for customer↔vehicle relations; the existing
  narrow CRM `crm.vehicle-link` writer is not duplicated. Ownership transfer is the separate
  `veh.ownership_history` table.
- **Route convention** (approved in Phase 1-16, canonical here): slash sub-resources, not colon verbs
  (`POST /vehicle-duplicates/{candidateId}/review`, `POST /vehicles/{vehicleId}/merge`), because colon
  segments are unbuildable as Windows directory / Next.js filesystem routes. Operation identifiers,
  permissions, and semantics are exactly as specified.
- **Known limitation (not a defect)**: vehicle document/media byte-**download acceptance** is not
  available because the malware-scanner acceptance path (DBCR-P1-15-001, withheld) and a production
  object store (ADR-012, open) are unresolved platform concerns outside P1-17 scope. P1-17 delivers
  vehicle document **link / list / association** over the approved shared infrastructure only.

## Operations delivered (20)

Every operation is guarded, registered in the OpenAPI contract, and carries genuine
operation-depth test evidence (the strict operation-coverage gate reports **P1-17: 20 registered,
20 operation-depth, 0 pending / invocation-only / unit-only / unreferenced / metadata-only**). The
machine-readable matrix is `docs/phase-1/phase-1-17/evidence/operation-test-matrix.json` (the P1-17
slice; the global aggregate at `docs/phase-1/phase-1-14/evidence/operation-test-matrix.json` is
regenerated at the same time).

| Operation                             | Method / path                                                               | Permission                        | Audit      |
| ------------------------------------- | --------------------------------------------------------------------------- | --------------------------------- | ---------- |
| `veh.vehicle-search`                  | `GET /vehicles`                                                             | `veh.vehicle.read`                | none       |
| `veh.vehicle-create`                  | `POST /vehicles`                                                            | `veh.vehicle.manage`              | privileged |
| `veh.vehicle-update`                  | `PATCH /vehicles/{vehicleId}`                                               | `veh.vehicle.manage`              | privileged |
| `veh.vehicle-duplicate-scan`          | `POST /vehicles/{vehicleId}/duplicate-scans`                                | `veh.vehicle.duplicate.review`    | privileged |
| `veh.vehicle-duplicate-review`        | `POST /vehicle-duplicates/{candidateId}/review`                             | `veh.vehicle.duplicate.review`    | privileged |
| `veh.vehicle-merge`                   | `POST /vehicles/{vehicleId}/merge`                                          | `veh.vehicle.merge`               | privileged |
| `veh.vehicle-plate-history`           | `GET /vehicles/{vehicleId}/plates`                                          | `veh.vehicle.read`                | none       |
| `veh.vehicle-plate-assign`            | `POST /vehicles/{vehicleId}/plates`                                         | `veh.vehicle.manage`              | privileged |
| `veh.vehicle-ownership-history`       | `GET /vehicles/{vehicleId}/ownerships`                                      | `veh.vehicle.read`                | none       |
| `veh.vehicle-ownership-transfer`      | `POST /vehicles/{vehicleId}/ownerships`                                     | `veh.vehicle.relationship.manage` | privileged |
| `veh.vehicle-relationship-list`       | `GET /vehicles/{vehicleId}/relationships`                                   | `veh.vehicle.read`                | none       |
| `veh.vehicle-authorized-party-add`    | `POST /vehicles/{vehicleId}/authorized-parties`                             | `veh.vehicle.relationship.manage` | privileged |
| `veh.vehicle-authorized-party-retire` | `POST /vehicles/{vehicleId}/authorized-parties/{relationshipId}/retirement` | `veh.vehicle.relationship.manage` | privileged |
| `veh.vehicle-odometer-history`        | `GET /vehicles/{vehicleId}/odometer-readings`                               | `veh.vehicle.read`                | none       |
| `veh.vehicle-odometer-record`         | `POST /vehicles/{vehicleId}/odometer-readings`                              | `veh.vehicle.odometer.record`     | privileged |
| `veh.vehicle-ev-profile-read`         | `GET /vehicles/{vehicleId}/ev-profile`                                      | `veh.vehicle.read`                | none       |
| `veh.vehicle-ev-profile-set`          | `POST /vehicles/{vehicleId}/ev-profile`                                     | `veh.vehicle.manage`              | privileged |
| `veh.vehicle-status-change`           | `PATCH /vehicles/{vehicleId}/status`                                        | `veh.vehicle.status.manage`       | privileged |
| `veh.vehicle-history`                 | `GET /vehicles/{vehicleId}/history`                                         | `veh.vehicle.read`                | none       |
| `veh.vehicle-document-list`           | `GET /vehicles/{vehicleId}/documents`                                       | `shared.document.manage`          | none       |

**Permissions.** This phase adds all **seven** `veh` permission codes (`veh.vehicle.read`, `.manage`,
`.merge`, `.duplicate.review`, `.relationship.manage`, `.odometer.record`, `.status.manage`) and
reuses the pre-existing `shared.document.manage`; the platform catalog holds **62** permissions after
this phase. `veh.vehicle.status.manage` is kept distinct from `veh.vehicle.manage` so descriptive
editing does not carry the power to scrap or deactivate a vehicle (least privilege; mirrors the CRM
`governance.manage` / `profile.write` split). Plate assignment and the EV profile are part of
`veh.vehicle.manage` (master-registration data), while lifecycle, merge, ownership, and relationship
changes are separate, higher capabilities. **No application role holds physical vehicle DELETE;
`app_readonly` stays read-only; `app_worker` is unchanged.**

**Audit.** This phase adds **twelve** `veh` audit actions across all its operations: `veh.vehicle`
`.created`, `.updated`, `.merged`, `.duplicates_scanned`, `.duplicate_reviewed`, `.plate_assigned`,
`.ownership_changed`, `.authorized_party_added`, `.authorized_party_retired`, `.odometer_recorded`,
`.ev_profile_set`, and `.status_changed`. Details name which columns changed and enum categories,
never sensitive values (see Observability).

**Events.** This phase publishes three vehicle event types, and only one of them was a reservation.
`vehicle.relationship.changed` (EVT-VEH-001) is the Chapter 4 Table 4.5 reservation; this phase
implements it, published by ownership transfer and by authorized-party changes. `vehicle.created`
(EVT-VEH-002) and `vehicle.merged` (EVT-VEH-003) are **new P1-17 allocations beyond that
reservation** — registered in the catalog in the same change that adds their producers, as P1-15 did
for its own document and template events. No further event type is invented by the odometer, EV,
status, history, or document operations: odometer and EV writes emit no event, and a status change
publishes none — the append-only status-history ledger is its durable record.

## Controlled-transaction conformance (BE-016)

`tests/backend/p1-17-transaction-conformance.test.ts` proves, through the real module services on the
deployed `app_runtime` identity, that a vehicle command's business row, its audit record, its outbox
event (where the operation announces a change), and the frozen trigger's append-only history all land
in **one transaction or none**: on success exactly the right rows appear (the create event carries the
command's correlation id); on an injected post-write failure the counts are zero everywhere. Both
shapes are covered — row + audit + event (create), and row + audit + ledger with no event (status
change).

## Security self-review (SEC-001…004) — no Critical or High

Refute-oriented self-review under the Solo Developer Review Policy; findings adjudicated below. **Zero
Critical, zero High, zero unaccepted Medium.**

| ID      | Concern probed                                                                                          | Outcome                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-001 | Restricted identifiers (chassis / engine number) leaking through search or a projection                 | **Not present.** Search is a closed allow-list and never inputs or projects restricted identifiers; the attribute-history read tracks internal master columns only (restricted values are not master columns).                                                           |
| SEC-002 | Cross-tenant read/write through any new operation                                                       | **Not present.** Every operation is tenant-scoped by FORCE RLS; the backend suites assert a tenant-B principal is refused or sees nothing for each new read and write (odometer, EV, status, history, documents).                                                        |
| SEC-003 | Privilege breadth — one permission standing in for several higher-consequence actions                   | **Mitigated by design.** Lifecycle governance (`veh.vehicle.status.manage`) is separated from attribute editing; document reachability is held to `shared.document.manage`, not the low vehicle-read.                                                                    |
| SEC-004 | Sensitive payload reaching logs (full VIN / plate / PII / signed URL / storage key / odometer payloads) | **Not present.** Operation logs carry only correlation id, tenant/actor refs, operation, duration, and error code (see Observability). Audit details classify VIN as internal and never copy it; the document list returns document ids only — no storage key, no bytes. |

## Observability and safe logging (DO-001 / DO-002)

The vehicle operations use the shared backend logger (boundary rule B7) and add nothing of their own
to the standard structured record: `severity`, `time`, `module`, `operation`, `correlationId`,
`tenantRef`, `actorRef`, `durationMs`, `result`, `errorCode`, plus `causationId` when the request
carries one. The logger's own base adds `service`, `version` and `env` to every record it emits
(`src/server/observability/logger.ts`); those are deployment identifiers, not request data. **No full
VIN, plate, PII, signed URL, storage key, odometer payload, or secret is logged** — the failing-path
test output in the backend suites shows exactly these safe fields and nothing more. Audit records name which columns changed,
never their values, for internal-classified data (VIN); the EV/status/odometer audit details carry
only enum categories and ids.

## QA evidence (QA-001…005)

Local CI-equivalent battery — every gate the hosted pipeline runs, plus the full database and backend
suites — all green on **protected `develop` `f18b855`**, the merge of the last remediation. The totals
below are that measurement, not the feature SHA's: the feature merge `aff8923a` carried fewer backend
tests, because PR #71, PR #72 and PR #73 each added assertions. Reading them as one number for one SHA
would misstate when the evidence came to exist.

| Suite / gate                                                                               | Result                                                                                                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Unit (`npm run test`)                                                                      | **733 passed** (floor maintained)                                                                              |
| Database (`npm run test:db`)                                                               | **1547 passed** (floor maintained; schema frozen)                                                              |
| Backend (`npm run test:backend`)                                                           | **567 passed** (raised from the 455 floor by the new operations, then by the post-merge evidence remediations) |
| `typecheck` / `lint` / `format:check` / `style:check`                                      | green                                                                                                          |
| `security:all` (tracked/browser secrets, scope exclusions, no-fake-data)                   | green                                                                                                          |
| `validate:module-boundaries` / `authorization-coverage` / `operation-coverage` / `openapi` | green                                                                                                          |
| `validate:veh-classification` / `canonical-docs` / `encoding`                              | green                                                                                                          |
| `build` / `docker compose config`                                                          | green                                                                                                          |

## What this phase deliberately does not deliver

Named here so no reader infers a capability from the presence of a port, an interface, or a table.

| Not delivered                                                        | Why                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Any database migration                                               | The vehicle schema is frozen. Gaps are raised as DBCRs, not added here                   |
| A frontend                                                           | P1-17 is backend only                                                                    |
| Zoom Vehicle Inspection and Evaluation Services                      | Explicitly outside Phase 1                                                               |
| Legacy vehicle/media data migration                                  | Out of scope; no legacy import is performed or claimed                                   |
| Machine learning, external VIN decoding, or battery-health analytics | Duplicate scoring and validation are deterministic and explainable only                  |
| Byte-download acceptance / production object storage                 | Depends on a scanner acceptance path and object store not provisioned in Phase 1         |
| Fake, demo, or sample business data                                  | Prohibited by standing policy. Reference data is structural only; test data is ephemeral |
| Phase 1-18 work                                                      | Not started                                                                              |

`origin/main` remains `8ca1da2` and is not modified by this phase. Phase 1-18 has not been started.
