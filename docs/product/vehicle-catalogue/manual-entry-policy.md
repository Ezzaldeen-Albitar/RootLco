# Manual Vehicle Entry Policy

**Status:** Planning — not implemented · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Recorded:** 2026-08-06 · **Phase authority:** P1-27 Owner-acceptance remediation

---

## 0. Planning and traceability only

**Nothing in this document is implemented by Phase 1-27.**

This is a planning and traceability record. It states the policy the platform is
intended to follow when a workshop enters a vehicle by hand, and it states —
field by field, operation by operation — how far the contracts that exist today
fall short of that policy. It does not describe behaviour an operator can use.

Three consequences follow, and they bind every reader:

| statement in this document | how to read it                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "the platform accepts …"   | Verified against a route, a domain module or a migration, and cited. This is the only class of sentence that describes today.                                 |
| "manual entry must …"      | A **rule for future work**. No screen, route or column enforces it. It is written down so that the phase which implements it cannot quietly choose otherwise. |
| "there is no …"            | Searched for and not found. The search is named so a later reader can repeat it rather than trust it.                                                         |

Every numbered gap between the policy and the platform is recorded in §7 as an
integration finding. Those findings are **document-local**: they are not yet
entries in `docs/phase-1/phase-1-27/findings.md` and carry no `P1-27-INT-###`
identifier, because raising a finding into that register is a governance act and
this document is not authorised to perform it.

---

## 1. Purpose and audience

This policy is written for workshop reception staff, service advisers and the
managers who supervise them, and for the Product Owner who must decide what the
platform is allowed to do on their behalf.

A workshop cannot refuse a car because a database does not recognise it. The
vehicle is on the forecourt, the customer is waiting, and the job has to be
booked in. Manual entry is the path that keeps the workshop working when the
platform's own reference data cannot describe what has arrived. Its danger is
the mirror image of its purpose: a record created under time pressure, by a busy
person, with no verification behind it, must never be allowed to look like a
verified record — and must never silently become reference data that every other
branch and every other tenant then inherits.

The whole of this policy follows from those two sentences.

---

## 2. When an operator must be able to enter a vehicle by hand

Eight situations. Each is a real workshop condition, not a system state.

| #     | situation                                        | what the operator is facing                                                                                                                          |
| ----- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | The model is old                                 | A vehicle older than the reference data goes back. The make may exist and the model may not, or neither may.                                         |
| **2** | The vehicle is imported                          | A grey import, a personal import, or a specification sold only in another market. The plate, the papers and the trim names may all be foreign.       |
| **3** | The provider lacks the market                    | Reference data that covers one region and not another. See the warning below: the platform has no data provider at all.                              |
| **4** | The catalogue is incomplete                      | The make is present, the model is missing; or the model is present and the trim is not. The commonest case, and the least dramatic.                  |
| **5** | The vehicle is custom or modified                | A rebuilt engine, a converted powertrain, a bodied chassis, a competition or utility conversion. No catalogue entry is truthful about it.            |
| **6** | The VIN cannot be decoded                        | A VIN is present and legible, and nothing the platform holds can turn it into a make, model or year.                                                 |
| **7** | The vehicle has no standard VIN                  | Plant machinery, trailers, older or locally assembled vehicles, and vehicles whose plate has been replaced. A chassis number may be all that exists. |
| **8** | The operator is working during a provider outage | The reference lookup that normally answers is not answering. Work does not stop.                                                                     |

### 2.1 Situations 3 and 8 presuppose something that does not exist

**The platform integrates no external vehicle-data provider.** There is no
provider client, no provider credential, no provider table and no operation that
calls one, in any of the 243 published operations. `veh.vin_verifications` —
the only place in the schema that even names an `external` check — is written by
nothing (§6, `MVE-03`).

So situations 3 and 8 are recorded here as **anticipated** conditions, valid the
day a provider is contracted and meaningless before it. They are not evidence
that a provider is planned, and §9 governs how that question may be raised.

Situations 1, 2, 4, 5, 6 and 7 are live today, because they are properties of
vehicles rather than of integrations. Entering the vehicle by hand is the only
possible answer to all six.

### 2.2 There is no manual-entry capability to describe

This has to be said once, plainly, because everything after it is easier to
misread without it.

**The platform has no manual-entry mode, no manual-entry screen, no manual-entry
setting, and no way to tell a hand-typed vehicle from any other.** There is
exactly one vehicle creation operation (§3.1). It does not ask where the
information came from and has nowhere to record the answer (`MVE-01`).

So §3 is a description of that one operation and nothing more. The rules in §4.4
and §5, and every finding in §7, describe work nobody has done.

---

## 3. What the platform accepts today

Everything in this section is read out of the repository and cited. It is the
baseline any future manual-entry work starts from.

### 3.1 The creation operation

Read from `apps/api/src/app/api/v1/vehicles/route.ts`.

| property             | value                                                         |
| -------------------- | ------------------------------------------------------------- |
| Operation id         | `veh.vehicle-create`                                          |
| Method and path      | `POST /api/v1/vehicles`                                       |
| Permission           | **`veh.vehicle.manage`** — a single code, shared with editing |
| Scope                | `tenant`                                                      |
| Audit class / action | `privileged` / `veh.vehicle.created`                          |
| Idempotency          | `idempotent: true` — an `Idempotency-Key` header is required  |
| Rate-limit policy    | `standard-command`                                            |
| Success status       | `201`                                                         |

**There is no `veh.vehicle.create` permission code.** The catalogue seed
`supabase/seeds/04_iam_permission_catalog.sql` publishes seven `veh.` codes and
that is not one of them; creating and editing a vehicle are the same authority,
described in the seed as "Create and edit vehicles in the caller tenant". An
earlier P1-27 wave invented `veh.vehicle.create`, and the account-bootstrap
catalogue check refused the whole grant rather than issuing thirty of
thirty-one. That refusal is the reason the code is named here.

### 3.2 The ten fields the creation operation accepts

Read from the `CreateBody` Zod schema in the same route module, and from
`toVehicleCreatePlan` in
`apps/api/src/modules/vehicle/domain/vehicle-write.ts`.

| field                | type accepted                     | bound                      | physical column       |
| -------------------- | --------------------------------- | -------------------------- | --------------------- |
| `vin`                | string, nullable, optional        | 1–64 characters            | `vin_raw`             |
| `makeId`             | uuid, nullable, optional          | —                          | `make_id`             |
| `modelId`            | uuid, nullable, optional          | —                          | `model_id`            |
| `trimId`             | uuid, nullable, optional          | —                          | `trim_id`             |
| `bodyTypeId`         | uuid, nullable, optional          | —                          | `body_type_id`        |
| `powertrainTypeId`   | uuid, nullable, optional          | —                          | `powertrain_type_id`  |
| `modelYear`          | integer, nullable, optional       | 1900–2100                  | `model_year`          |
| `powertrainCategory` | enum, optional — **not** nullable | `ice ev hybrid phev other` | `powertrain_category` |
| `color`              | string, nullable, optional        | 1–40 characters            | `color`               |
| `displayNumber`      | string, nullable, optional        | 1–40 characters            | `display_number`      |

**Every field is optional.** A vehicle may be created as a bare draft with no
content at all. The route docblock states the reason and it is a workshop
reason: "a vehicle often arrives at a workshop before anyone has its papers."

**The schema is `.strict()`.** One unrecognised key — a stray `plate`, a
`source`, a `notes` — is a `422` for the whole request, not a dropped field. A
manual-entry form that posts a field this table does not list will fail
entirely, and the operator will lose everything they typed.

`modelYear` is an `integer` and travels as a **real JSON number**. It is the one
numeric on this path that is not a decimal string; nothing on the vehicle
creation surface is money, and no `numeric` or `bigint` column is reachable
from it.

### 3.3 The frontend contract carries exactly the same ten fields

`apps/web/src/features/vehicles/contract.ts` declares `VehicleCreateInput` with
ten optional properties, name-for-name identical to the table above, and
`validateVehicleCreate` enforces the same bounds at the edge (`MAX_VIN_INPUT`
64, `MAX_COLOR` 40, `MAX_DISPLAY_NUMBER` 40, `MODEL_YEAR_MIN` 1900,
`MODEL_YEAR_MAX` 2100) plus two coherence rules the database also enforces: a
model requires its make, and a trim requires its model.

**So the answer to "what does the current create operation accept" is the same
on both sides of the wire: those ten fields and nothing else.** Every field this
policy needs beyond them is recorded in §7.

### 3.4 What creation decides for the operator, whatever they type

| decision               | value              | authority                                                                |
| ---------------------- | ------------------ | ------------------------------------------------------------------------ |
| Lifecycle status       | always `draft`     | `lifecycleStatus` is not a `CreateBody` key; the column defaults `draft` |
| Workshop status        | always `none`      | Column default; no creation field                                        |
| Powertrain category    | `ice` when omitted | `normalizeCategory(input.powertrainCategory, 'ice')`                     |
| Tenant                 | from the session   | `context.principal.tenantId`, never accepted from a caller               |
| Entered-by attribution | from the session   | `created_by` ← `context.principal.userId`                                |
| Entered-at timestamp   | database `now()`   | `created_at` column default                                              |

Blank strings are turned into nulls before they reach SQL (`blankToNull`), so an
untouched form field is genuinely "unset" rather than a blank the column's
`ck_*_not_blank` guards would reject with a raw constraint error.

### 3.5 How the platform treats a VIN

| fact                                                                                 | authority                                                                  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| The stored VIN is the raw value; the normalised form is generated                    | `vin_normalized … GENERATED ALWAYS AS (veh.normalize_vin(vin_raw)) STORED` |
| Normalisation is upper-case plus stripping everything outside `[A-Z0-9]`             | `veh.normalize_vin`, `20260720090000_veh_normalization.sql`                |
| `I`, `O` and `Q` are **preserved**, never "corrected"                                | Same function; the migration says so explicitly                            |
| There is no length rule and no format `CHECK`                                        | `veh.vehicles` has `ck_vehicles_vin_raw_not_blank` and nothing else        |
| There is no check-digit calculation anywhere                                         | Searched the vehicle module; none                                          |
| **Nothing decodes a VIN into a make, model or year**                                 | No route, service or repository does; no provider exists (§2.1)            |
| Uniqueness is on the generated column, per tenant, excluding merged and deleted rows | `uq_vehicles_active_vin`                                                   |

The frontend states the same boundary and refuses to invent more: a
17-character rule "would refuse legitimate older, imported and non-road vehicles
that the database accepts" (`profile-contract.ts`). It reports a non-standard
length as an observation and never as a rejection.

**This is exactly the behaviour situations 1, 2, 6 and 7 need**, and it is the
one thing manual entry will require that the platform already does correctly.
It is a property of how a VIN is stored, not a manual-entry feature: there is no
manual-entry capability to get anything right or wrong (§2.2).

### 3.6 What the operator gets back

`CreatedVehicle`, from `vehicle-write-service.ts`:

| field                | value                                    |
| -------------------- | ---------------------------------------- |
| `vehicleId`          | the new id                               |
| `lifecycleStatus`    | `'draft'`, always                        |
| `powertrainCategory` | as resolved, including the `ice` default |
| `hasVin`             | a boolean — **not** the VIN              |

The VIN is `internal`-classified and is deliberately not echoed. There is **no
duplicate advisory**: unlike CRM customer creation, the vehicle response carries
no candidate list, and `veh.vehicle-duplicate-scan` is a privileged audited
write that must never be fired to populate a screen (§8, `P1-OD-017`).

### 3.7 How refusals are reported

From `VehicleWriteService.mapWriteConflict`:

| database condition                     | published error                       | status |
| -------------------------------------- | ------------------------------------- | ------ |
| Unique violation (`23505`)             | `ERR-RES-002`                         | 409    |
| Foreign-key violation (`23503`)        | `ERR-VAL-001`, `unknown_reference`    | 422    |
| Check violation (`23514`)              | `ERR-VAL-001`, `incoherent_reference` | 422    |
| Edge/domain bound (length, year, enum) | `ERR-VAL-001` with the offending path | 422    |

The `23505` row is the important one for manual entry, and it is wrong in a way
the operator will feel. Two unique indexes can raise it —
`uq_vehicles_active_vin` and `uq_vehicles_active_display_number` — and the
mapping renders both as "A live vehicle with this VIN already exists in the
tenant". An operator who typed a workshop reference somebody else already used
is told their VIN is a duplicate. Recorded as `MVE-08`.

---

## 4. The reference catalogue, and the hard rule

### 4.1 How the catalogue is built

Five relations — `veh.makes`, `veh.models`, `veh.trims`, `veh.body_types`,
`veh.powertrain_types` — each **dual-scope**, per
`20260720091000_veh_reference_catalogs.sql`:

| scope      | `tenant_id` | who sees it          | who may write it             |
| ---------- | ----------- | -------------------- | ---------------------------- |
| `platform` | `NULL`      | every tenant         | nobody at runtime (see §4.2) |
| `tenant`   | set         | that one tenant only | that tenant, in principle    |

The migration states its own seeding posture plainly: "this migration seeds
ZERO rows — platform defaults are provisioned admin-side at onboarding, not
baked into a migration." That is the standing no-fake-data policy applied to
reference data, and it means **a new tenant starts with an empty catalogue** —
which makes situation 4 the normal case at go-live rather than an edge case.

Reading it is possible. Five list operations exist, all on `veh.vehicle.read`:

| operation                            | path                                        |
| ------------------------------------ | ------------------------------------------- |
| `veh.catalogue-make-list`            | `/vehicle-catalogue/makes`                  |
| `veh.catalogue-model-list`           | `/vehicle-catalogue/makes/{makeId}/models`  |
| `veh.catalogue-trim-list`            | `/vehicle-catalogue/models/{modelId}/trims` |
| `veh.catalogue-body-type-list`       | `/vehicle-catalogue/body-types`             |
| `veh.catalogue-powertrain-type-list` | `/vehicle-catalogue/powertrain-types`       |

Each returns `{ items, nextCursor, hasMore }` — keyset pages, ordered by
`(name, id)`, with **no total**. Each item carries `id`, `scope`, `code`,
`name`, `status`, plus `makeId` on a model and `modelId` on a trim
(`vehicle-catalogue-repository.ts`). The `scope` field is what lets a screen
mark a tenant's own additions apart from platform defaults.

A screen cannot count the catalogue, because no operation publishes a count. The
web adapter walks pages to a hard bound and reports `truncated` when it stops
short, rather than presenting a partial list as the whole one
(`apps/web/src/features/vehicles/catalogue-api.ts`).

### 4.2 What the database already prevents

The runtime role **cannot create a platform catalogue row.** Every insert policy
on all five relations reads:

```
WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
```

and the update policy carries a matching `USING`, "so a platform row can never
enter a tenant's update set (no platform-row claim)". A tenant also cannot
reference another tenant's catalogue row: `veh.guard_vehicle_catalog_refs` runs
`SECURITY INVOKER`, so a row hidden by row-level security is simply not found
and the write is refused.

So the "**global**" half of the hard rule is already structurally impossible.
That is worth knowing and it is not the same as the rule being satisfied.

### 4.3 What nothing prevents, because nothing is possible

**There is no catalogue write operation of any kind.** Searched every route
module under `apps/api/src/app/api/v1/` — the twenty-seven vehicle operations
include five catalogue reads and no catalogue write. **There is no
catalogue-management permission code**: the 104-code seed has no `veh.catalogue.*`
entry and no `veh.*.manage` code covering makes, models, trims, body types or
powertrain types.

The practical position today is therefore:

| question                                           | answer                                   |
| -------------------------------------------------- | ---------------------------------------- |
| Can manual entry create a global catalogue record? | No — RLS forbids it (§4.2)               |
| Can manual entry create a tenant catalogue record? | No — no operation exists                 |
| Can anything create a catalogue record over HTTP?  | No                                       |
| Is the hard rule therefore satisfied?              | **No.** It is unreachable, not enforced. |

The distinction matters because the moment a catalogue write is added — by any
phase, for any reason — the hard rule becomes live and unprotected unless it was
designed in first. This document exists partly so that the phase which adds that
operation cannot claim nobody had stated the constraint.

### 4.4 The rule

> **Manual vehicle entry must never create a catalogue record — platform-scope or
> tenant-scope — as a side effect. A make, model, trim, body type or powertrain
> type proposed during manual entry is routed to catalogue review and takes
> effect only when a reviewer with the catalogue-management authority accepts
> it.**

Three corollaries, each stated so it cannot be argued away later:

1. **Silence is not consent.** A catalogue record that appears because somebody
   typed a name into a vehicle form is invisible governance: no reviewer saw it,
   no reviewer can be named for it, and every subsequent vehicle inherits it.
2. **A pending proposal must not be selectable.** If a proposal appeared in the
   picker before review, the review would be decorative — the value would already
   be in use by the time anyone looked at it.
3. **Rejecting a proposal must not destroy the vehicle record.** The vehicle was
   real and the job was done. A rejected proposal leaves the vehicle exactly as
   the operator left it, with its catalogue references unset and its free-text
   description intact.

Until the review path exists, the interim rule is the conservative one:

> **Manual entry leaves catalogue references unset.** A vehicle whose make is not
> in the catalogue is created with `makeId` null. It is not created with a
> nearest-match make, and no make is created for it.

### 4.5 What "routed to catalogue review" would require

None of this exists. It is listed so the size of the gap is visible rather than
implied.

| element                         | current state                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------- |
| A proposal record               | No table. `veh` has 23 tables and none is a catalogue proposal or review queue. |
| A submit operation              | None.                                                                           |
| A review queue read             | None.                                                                           |
| An accept / reject operation    | None.                                                                           |
| A permission code for reviewing | None. Not one of the 104 seeded codes.                                          |
| A status vocabulary             | None. No `CHECK` constraint anywhere admits a catalogue-review status.          |
| An audit action                 | None registered in `apps/api/src/server/auth/audit-actions.ts`.                 |

The nearest existing pattern in the platform is the duplicate-candidate queue
(`crm.duplicate_candidates`, `veh.duplicate_candidates`, with
`*.duplicate.review` permissions and dedicated review operations). It is a
pattern, not a substitute: those queues review whether two **vehicles** are the
same vehicle, and have nothing to do with reference data.

---

## 5. The five markings manual entry must carry

The policy requires five facts to be visible on any manually entered vehicle.
This table states, for each, whether the platform can carry it today.

| marking                     | policy requirement                                                         | state today                                                                                                                                          | finding  |
| --------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Source = Manual**         | The record states that a person entered it rather than a reference lookup. | **Absent.** No column on `veh.vehicles`, no field on the create body, no field on either read projection.                                            | `MVE-01` |
| **Entered by**              | The person is named on the vehicle.                                        | **Recorded, not readable.** `created_by` is stamped from the session and is not in the detail read's `SELECT`.                                       | `MVE-02` |
| **Entered at**              | The moment is on the vehicle.                                              | **Carried.** `created_at` is published as `createdAt` on both `VehicleDetail` and `VehicleSearchHit`.                                                | —        |
| **Verification status**     | Whether the identity has been checked, and how.                            | **Absent from the API.** `veh.vin_verifications` exists with a full vocabulary and no route reads or writes it. `P1-OD-025` binds it too — see §5.1. | `MVE-03` |
| **Catalogue-review status** | Whether a proposed make/model/trim is pending, accepted or rejected.       | **Absent entirely.** No table, no column, no operation, no permission code, no vocabulary.                                                           | `MVE-04` |

One of five is deliverable today. That ratio is the honest summary of this
document.

### 5.1 The verification vocabulary that already exists, unused

`veh.vin_verifications` (`20260720094000_veh_vin_verifications.sql`) is
append-only, server-attributes its actor and timestamp, and constrains:

| column            | admitted values                               |
| ----------------- | --------------------------------------------- |
| `check_kind`      | `checksum`, `format`, `manual`, `external`    |
| `result`          | `passed`, `failed`, `overridden`              |
| `override_reason` | required exactly when `result = 'overridden'` |

The migration's own words: "No external verification is performed here and none
is fabricated." A `manual` check kind and an `overridden` result with a
mandatory reason is precisely the shape a manual-entry policy needs — a person
looked at the papers, said what they saw, and their reason is on the record.

**No code path writes it.** A repository-wide search for `vin_verifications`
returns two migrations — its own, and `20260720090000_veh_normalization.sql`,
which names this table as the home of the format and checksum validation that
normalisation deliberately does not do — plus four files under `tests/db` and a
number of documentation artefacts. It returns **nothing whatever under
`apps/api/src` or `apps/web/src`**, and that clause is the one that matters. The
canonical plan already records this as a capability gap for `FE-020` rather than
an open decision.

**`P1-OD-025` binds this marking as well, and §8 states why.** A `manual` check
is a person saying what they saw on the VIN plate or the chassis stamping, and
the evidence for that is a photograph. Whether a photograph may be captured,
stored or shown is precisely what `P1-OD-025` has not decided. A verification
marking specified before that decision would be an assertion with nothing behind
it.

### 5.2 The platform already has a source-of-entry precedent, in another module

`MVE-01` asks for a column that says a person typed this record. That shape
exists elsewhere and is worth naming, so the phase which builds it does not
invent a seventh convention.

| table                  | column   | shape                                                                              |
| ---------------------- | -------- | ---------------------------------------------------------------------------------- |
| `tech.labor_sessions`  | `source` | `NOT NULL DEFAULT 'manual'`, `CHECK (source IN ('manual', 'timer', 'correction'))` |
| `veh.plate_history`    | `source` | Nullable free text, immutable once written. **No operation writes it.**            |
| `veh.battery_readings` | `source` | Nullable free text.                                                                |
| `crm.partner_roles`    | `source` | Nullable, non-blank when present.                                                  |
| `crm.consent_history`  | `source` | Nullable.                                                                          |
| `shared.error_records` | `source` | `NOT NULL`. Platform diagnostics, not business provenance.                         |

`tech.labor_sessions.source` is the closest match by some distance: it is
mandatory, it defaults to `manual`, its vocabulary is closed by a `CHECK`, and it
is immutable after insert. A vehicle source-of-entry column built the same way
would be answerable to the same rules. This is a precedent, **not** an
implementation: `veh.vehicles` carries no such column, and adding one is the work
`MVE-01` describes.

---

## 6. The candidate field set, field by field

Subject in every case to the approved schema. "Deliverable" means the field can
be sent to a published operation today.

| candidate field | deliverable today                         | how, or why not                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Make**        | Only as a catalogue id                    | `makeId`, a uuid from `veh.catalogue-make-list`. **No free-text make.** An unlisted make is recorded as absence. (`MVE-06`)                                                                                                        |
| **Model**       | Only as a catalogue id                    | `modelId`; requires `makeId`, enforced both at the edge and by `guard_vehicle_catalog_refs`. **No free-text model.** (`MVE-06`)                                                                                                    |
| **Year**        | Yes                                       | `modelYear`, integer, **1900–2100** (`ck_vehicles_model_year`). A pre-1900 vehicle must leave it blank. (`MVE-11`)                                                                                                                 |
| **Body type**   | Only as a catalogue id                    | `bodyTypeId`. **No free-text body type.** An unlisted body shape is recorded as absence, exactly as an unlisted make is. (`MVE-06`)                                                                                                |
| **Powertrain**  | Category yes, type only as a catalogue id | `powertrainCategory` is a free choice from five values and defaults to `ice`. `powertrainTypeId` must match it or the database refuses the write (`23514` → 422), and there is **no free-text powertrain type**. (`MVE-06`)        |
| **Trim**        | Only as a catalogue id                    | `trimId`; requires `modelId`. (`MVE-06`)                                                                                                                                                                                           |
| **VIN**         | Yes                                       | `vin`, 1–64 characters, stored raw, normalised by the database. No format rule, no checksum, no decode. (§3.5)                                                                                                                     |
| **Chassis**     | **No**                                    | `veh.vehicle_identifiers` supports `chassis` as a `restricted` identifier type. **No operation writes or reads it.** The missing _read_ is open as `P1-17-A-01`; the missing _write_ is raised here for the first time. (`MVE-09`) |
| **Plate**       | Yes, but as a **second** operation        | `POST /vehicles/{vehicleId}/plates` — `countryCode`, `plateRaw`, `effectiveDate`. Not a creation field; no transactional bundle. (`MVE-07`)                                                                                        |
| **Colour**      | Yes                                       | `color`, free text, 1–40 characters, non-blank. There is no colour catalogue and no colour vocabulary.                                                                                                                             |
| **Notes**       | **No**                                    | `shared.notes` is polymorphic, but the only note write is CRM-pinned to `entity_type = 'crm.business_partners'`. No vehicle note operation exists. (`MVE-10`)                                                                      |

### 6.1 Two consequences worth stating plainly

**A manually entered vehicle with no VIN can never leave draft.**
`veh.guard_vehicle_activation` requires either a normalised VIN or an active
alternate identifier row (`chassis`, `engine_no`, `fleet_no`, `other`) before
`lifecycle_status` may become `active`. On insert the migration notes that no
identifier rows can exist yet, so "an active identity-less vehicle must be built
draft → add identifier → activate" — and **no operation performs the middle
step**. Situation 7 therefore produces a permanent draft. Recorded as `MVE-09`;
the screen must say so rather than offer an activation certain to fail.

**A model's production years are invisible.** `veh.models` carries
`first_model_year` and `last_model_year`, and the catalogue read publishes
neither (`SELECT id, scope, code, name, status, make_id`). Nothing on the server
compares a vehicle's `model_year` to them either — `guard_vehicle_catalog_refs`
checks make/model/trim coherence and powertrain category, and does not read
those columns. So no warning about a year outside a model's production range is
possible, in either direction. Recorded as `MVE-12`.

---

## 7. Integration findings

Twelve. Each is a contract this policy needs and the repository does not carry.
Identifiers are document-local (§0).

| finding  | what is missing                                                                                                                                                                                                                                                                                                                                                   | owning Backend phase                      | owning Frontend phase          | required action                                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MVE-01` | **No source-of-entry marker.** `veh.vehicles` has no such column; `CreateBody` has no such key and is `.strict()`; neither `VehicleDetail` nor `VehicleSearchHit` publishes one. Six other tables do carry a `source` column (§5.2), including two in `veh` — and no vehicle operation writes either of them.                                                     | P1-07 (column), P1-17 (field, projection) | P1-27 (`FE-018`, `FE-019`)     | Backend adds the column, the creation field and the read projection, following the `tech.labor_sessions.source` precedent in §5.2 rather than a new convention. No screen may label a record "Manual" before it exists.                                                                           |
| `MVE-02` | **"Entered by" is stamped and not published.** `created_by` is `NOT NULL` and set from `context.principal.userId`; the detail read's `SELECT` (`vehicle-read-repository.ts`) does not include it.                                                                                                                                                                 | P1-17                                     | P1-27 (`FE-019`)               | Publish `createdBy` on `veh.vehicle-read`, or state in the profile that attribution is audit-only. Do not resolve a display name without deciding it.                                                                                                                                             |
| `MVE-03` | **No VIN/identity verification surface.** `veh.vin_verifications` exists with `check_kind` and `result` vocabularies; no route, service or repository touches it, and no permission code covers it.                                                                                                                                                               | P1-17                                     | P1-27 (`FE-020`), read-only    | None inside P1-27 — already a recorded capability gap. A Backend phase must define the operation and its permission code.                                                                                                                                                                         |
| `MVE-04` | **No catalogue-review capability at all** — no table, operation, permission code, status vocabulary or audit action.                                                                                                                                                                                                                                              | **Not assigned**                          | **Not assigned**               | Owner assigns a Backend phase. Until then §4.4's interim rule applies: manual entry leaves catalogue references unset.                                                                                                                                                                            |
| `MVE-05` | **No catalogue write operation and no catalogue-management permission code.** Five relations, five reads, zero writes; no `veh.catalogue.*` code among the 104 seeded.                                                                                                                                                                                            | **Not assigned**                          | **Not assigned**               | Define the code and the operation together with `MVE-04`. A catalogue write shipped without the review queue makes the §4.4 rule unenforceable.                                                                                                                                                   |
| `MVE-06` | **No free text for any of the five catalogue-referenced fields** — make, model, trim, body type and powertrain type. Creation accepts uuids only, so an unlisted vehicle is recorded as absence rather than as a description. Because a tenant's catalogue starts empty (§4.1), all five are unselectable on the first day of use, not only in the awkward cases. | P1-17                                     | P1-27 (`FE-018`)               | Owner chooses between free-text capture on the vehicle and a review-queue proposal. Both are Backend work; neither may be simulated on the client.                                                                                                                                                |
| `MVE-07` | **Plate is a separate command with no transactional bundle.** Manual entry with a plate is two idempotent operations and two audit records; a failure between them leaves a vehicle with no plate.                                                                                                                                                                | P1-17                                     | P1-27 (`FE-018`, `FE-022`)     | Frontend sequences the two calls and reports the partial outcome honestly. A combined operation is Backend work and must not be assumed.                                                                                                                                                          |
| `MVE-08` | **A duplicate display number is reported as a duplicate VIN.** Two unique indexes raise `23505` and `mapWriteConflict` renders both as "A live vehicle with this VIN already exists in the tenant".                                                                                                                                                               | P1-17                                     | P1-27 (`FE-018`)               | Backend distinguishes the constraints. Until then the Frontend must not name which field collided. The published wording — "already exists in the tenant" — is separately unfit to show an operator: "tenant" is not a word used in a workshop. A plain-English replacement is owed with the fix. |
| `MVE-09` | **No alternate-identifier write, so a VIN-less vehicle cannot be activated.** The activation guard needs a `chassis`/`engine_no`/`fleet_no`/`other` row and no operation creates one. `P1-17-A-01` records the missing `iam.sensitive.view`-gated **read** of `veh.vehicle_identifiers`; the missing **write** is recorded nowhere else and is raised here.       | P1-17                                     | P1-27 (`FE-018`, `FE-019`)     | Backend adds the identifier operations — both directions, since `P1-17-A-01` covers only one. The screen states that the vehicle stays a draft rather than offering activation.                                                                                                                   |
| `MVE-10` | **No vehicle notes.** `shared.notes` is polymorphic; the only note write pins `entity_type = 'crm.business_partners'`. None of the 27 vehicle operations is a note.                                                                                                                                                                                               | P1-17 (or a shared-services phase)        | P1-27, deferred                | Either a vehicle note operation is added, or `notes` is dropped from the candidate field set. It cannot be delivered as it stands.                                                                                                                                                                |
| `MVE-11` | **Model year cannot be recorded before 1900.** `ck_vehicles_model_year` admits `1900–2100` only, and the edge validation mirrors it.                                                                                                                                                                                                                              | P1-07 (migration)                         | P1-27 (`FE-018`), message only | Owner decides whether pre-1900 vehicles are in scope. Changing the `CHECK` is a migration change and is not P1-27 work.                                                                                                                                                                           |
| `MVE-12` | **A model's production years are neither published nor checked.** `first_model_year`/`last_model_year` are absent from the catalogue read projection and from every server-side guard.                                                                                                                                                                            | P1-17                                     | P1-27, deferred                | Publish them, or drop year-versus-model warnings from the policy. Do not warn from a client-side guess.                                                                                                                                                                                           |

### 7.1 Contracts looked for and not found

Recorded separately from the findings because these are search results rather
than obligations.

| looked for                                                            | result                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `veh.vehicle.create`                                                  | Does not exist. The real code is **`veh.vehicle.manage`**.                                                                                 |
| A `source`, `entrySource` or `origin` field on vehicle creation       | Not in `CreateBody`, not in `VehicleCreateInput`, not a column on `veh.vehicles`.                                                          |
| A catalogue create, update or delete route                            | None, in any of the 243 published operations.                                                                                              |
| A `veh.catalogue.*` or catalogue-management permission code           | None among the 104 seeded codes.                                                                                                           |
| A catalogue proposal, submission or review table                      | None. `veh` holds 23 tables and none is one.                                                                                               |
| Any read or write of `veh.vin_verifications`                          | None under `apps/api/src` or `apps/web/src`. The name appears only in two migrations, four database test files and documentation.          |
| Any read or write of `veh.vehicle_identifiers`                        | None. Three docblock mentions under `apps/**/src` (`contract.ts`, `vehicle-search.ts`, `vehicle-read-repository.ts`), and no SQL anywhere. |
| A source-of-entry column on `veh.vehicles`                            | None. Six other tables carry a `source` column (§5.2); the vehicle master is not one of them.                                              |
| A write that sets `veh.plate_history.source`                          | None. The insert names `tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by`.                                           |
| `createdBy` on the vehicle detail read                                | Not in the projection.                                                                                                                     |
| A vehicle note operation                                              | None.                                                                                                                                      |
| A `total` on any catalogue or vehicle list                            | Does not exist. Every page is `{ items, nextCursor, hasMore }`.                                                                            |
| An external vehicle-data provider client, credential or configuration | None anywhere in the repository.                                                                                                           |
| A VIN check-digit or decode implementation                            | None. `veh.normalize_vin` normalises and does not validate.                                                                                |

---

## 8. Owner decisions that bind this policy

### `P1-OD-017` — duplicate and merge rules · **OPEN**

Manual entry is a duplicate-creation mechanism. A vehicle whose VIN cannot be
decoded, entered twice by two receptionists on two days, is two records for one
car — and the platform will not object unless both carry the same VIN, because
active-VIN uniqueness is the only automatic defence and a VIN-less vehicle
evades it entirely.

`P1-OD-017` binds `veh.vehicle.duplicate.review`, `veh.vehicle.merge`,
`veh.duplicate_candidates` and `veh.vehicle_merges`. While it is open:

- **No merge affordance may appear on any manual-entry surface.** Absent, not
  disabled. A disabled control asserts that the capability exists and the
  operator lacks permission, which is a different and false statement.
- **No duplicate scan may be fired to populate a screen.**
  `veh.vehicle-duplicate-scan` is a privileged audited write, throttled at
  30/minute, that creates candidate rows. A manual-entry form that "checked for
  duplicates" would write audit history on every keystroke.
- The manual-entry screen may **say** that duplicate handling rules are pending
  a decision. It may not act as though they have been taken.

### `P1-OD-025` — vehicle document and media file policy · **OPEN**

Manual entry is precisely when an operator wants to photograph the VIN plate,
the chassis stamping and the registration document — because those photographs
are the only evidence behind a record nothing else verifies.

`P1-OD-025` is open and binds directly. While it is open:

- **No upload path may be built.** No accepted file types are asserted, no size
  limit is invented, no object store is assumed, no storage credential is
  exposed, and an object key is never treated as authorisation.
- The document surface that exists is a **read**:
  `veh.vehicle-document-list`, gated — unusually — on
  **`shared.document.manage`**, a write-shaped code from a different module.
  There is no `shared.document.read` code to cite instead.
- Upload elsewhere in the platform is **authorisation-only**: the API mints an
  authorisation and the bytes go to a storage provider. No route accepts a file
  body. A manual-entry policy that promised photograph capture would be
  promising something the platform's own document design does not offer yet.

The consequence must be stated to the Owner rather than designed around:
**manual entry currently produces an unverified record with no attached
evidence**, and `P1-OD-025` is the decision that would change that.

---

## 9. External vehicle-data providers

Situations 3 and 8 name a provider. Two things follow.

**Contracting a paid vehicle-data provider is a commercial decision reserved to
the Product Owner.** This document does not recommend a vendor, does not name
one, and states no price, no coverage figure and no service level, because it
has none to state.

**What may be recommended is an evaluation**, and its shape is determined by the
gaps above rather than by any vendor's feature list:

| evaluation question                                     | why this policy needs the answer                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Which markets does the data cover?                      | Situation 3 exists because coverage is regional. A provider that lacks the pilot market changes nothing. |
| Does it decode a VIN into make, model, year and trim?   | Nothing in the platform does this today (§3.5).                                                          |
| Does it return identifiers this catalogue can hold?     | The catalogue is code-plus-name per relation, with a `^[a-z][a-z0-9_]{1,62}$` code format.               |
| What does it return for a vehicle it does not know?     | The manual path must remain the answer, so the failure mode matters more than the success rate.          |
| Can its output be routed to review rather than applied? | §4.4 binds a provider exactly as it binds an operator. A provider is not a reviewer.                     |
| What happens during an outage?                          | Situation 8 is the requirement that manual entry never depends on it.                                    |

Even with a provider contracted, **`MVE-04` and `MVE-05` still apply**: provider
output is a proposal, not an accepted catalogue record. A provider that wrote
straight into the catalogue would breach the hard rule in §4.4 more thoroughly
than a busy receptionist ever could, because it would do so at volume.

---

## 10. Numbers this document does not state

Per the standing rule against fabricated figures, the following are **not
established**, and each is paired with what would establish it.

| quantity                                                   | state           | what would establish it                                                                           |
| ---------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| How many vehicles a pilot workshop enters manually         | Not established | Measurement against a running pilot tenant. No business data exists; business tables start empty. |
| What share of vehicles the catalogue will fail to describe | Not established | The same measurement. A tenant's catalogue starts at zero rows, so the early share is total.      |
| How long a catalogue review should take                    | Not established | An Owner service-level decision, taken once the review capability is specified (`MVE-04`).        |
| The cost or coverage of any vehicle-data provider          | Not established | The evaluation in §9, run by the Product Owner. Not a technical output.                           |
| The platform's maximum page size for catalogue reads       | Not stated here | `MAX_PAGE_SIZE` in the pagination foundation. Cited rather than copied so the two cannot drift.   |
| How many catalogue rows a tenant will hold                 | Not established | No operation publishes a count, by design — every page reports `hasMore` and no total.            |

---

## 11. Traceability

| claim class                            | authority read                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Creation operation and accepted fields | `apps/api/src/app/api/v1/vehicles/route.ts`                                                                         |
| Normalisation, defaults, bounds        | `apps/api/src/modules/vehicle/domain/vehicle-write.ts`                                                              |
| Response shape and error mapping       | `apps/api/src/modules/vehicle/application/vehicle-write-service.ts`                                                 |
| Columns actually written               | `apps/api/src/modules/vehicle/data/vehicle-write-repository.ts`                                                     |
| Detail-read projection                 | `apps/api/src/modules/vehicle/data/vehicle-read-repository.ts`                                                      |
| Catalogue reads and their shape        | `apps/api/src/modules/vehicle/data/vehicle-catalogue-repository.ts`, `.../application/vehicle-catalogue-service.ts` |
| Plate assignment                       | `apps/api/src/app/api/v1/vehicles/[vehicleId]/plates/route.ts`                                                      |
| Status change and activation           | `apps/api/src/app/api/v1/vehicles/[vehicleId]/status/route.ts`                                                      |
| Audit action registration              | `apps/api/src/server/auth/audit-actions.ts`                                                                         |
| Audit trail read                       | `apps/api/src/app/api/v1/audit-events/route.ts`                                                                     |
| Frontend creation contract             | `apps/web/src/features/vehicles/contract.ts`                                                                        |
| Frontend profile and VIN contract      | `apps/web/src/features/vehicles/profile-contract.ts`                                                                |
| Frontend catalogue adapter             | `apps/web/src/features/vehicles/catalogue-api.ts`                                                                   |
| Permission codes                       | `supabase/seeds/04_iam_permission_catalog.sql`                                                                      |
| Vehicle master schema and guards       | `supabase/migrations/20260720092000_veh_vehicles.sql`                                                               |
| Catalogue schema, scope and RLS        | `supabase/migrations/20260720091000_veh_reference_catalogs.sql`                                                     |
| Identifier ledger and activation guard | `supabase/migrations/20260720093000_veh_vehicle_identifiers.sql`                                                    |
| VIN verification vocabulary            | `supabase/migrations/20260720094000_veh_vin_verifications.sql`                                                      |
| VIN and plate normalisation            | `supabase/migrations/20260720090000_veh_normalization.sql`                                                          |
| Plate history and its `source` column  | `supabase/migrations/20260720098000_veh_plate_history.sql`                                                          |
| Note polymorphism                      | `supabase/migrations/20260718110000_shared_tags_notes_comments.sql`                                                 |
| Open decisions and phase rules         | `docs/phase-1/phase-1-27/canonical-plan.md`, `docs/phase-1/phase-1-27/findings.md`                                  |

**Review trigger.** This document must be re-read against the repository
whenever any of the following changes: the `CreateBody` schema in the vehicle
route, the `veh.` permission codes in the catalogue seed, the catalogue
relations' RLS policies, or the disposition of `P1-OD-017` or `P1-OD-025`. A
policy that cites a contract is only as current as its last comparison to it.
