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

**The owner gate is [Pending](phase-1-17-owner-gate.md), and stays Pending until the approval owner
records a decision against evidence on the exact merged SHA.** Nothing in this folder is a gate
decision, and no document here claims the phase has passed.

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
| Waves 3–11 — vehicle module implementation                                   | **In progress**                                                                          |
| Owner gate                                                                   | **Pending** — no decision recorded                                                       |

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
