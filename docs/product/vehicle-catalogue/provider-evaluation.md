# Vehicle Data Provider Evaluation

**Status:** Planning — not implemented · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Recorded:** 2026-08-06 · **Phase authority:** P1-27 Owner-acceptance remediation

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 0. Planning and traceability only

**This document is PLANNING AND TRACEABILITY ONLY. Nothing it proposes is
implemented — not by Phase 1-27 and not by any other phase — and no proposal in
it may be read as a statement that a capability exists.** Where the document
reports what the repository already contains, it says so explicitly and names the
file the statement was read from (§2). Everything else is a proposal, a
requirement, a finding or a question.

Specifically, and to remove any doubt:

| statement a reader might infer                                   | the truth                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "the platform is connected to a vehicle-data provider"           | It is not. A search of the whole repository for `NHTSA`, `vPIC`, `JATO`, `TecDoc`, `TecAlliance` and `CarAPI` matches **exactly one file — this one**. No application code, configuration, migration or seed names, configures, contracts or calls a provider anywhere. |
| "a provider interface exists and only needs a vendor plugged in" | It does not. The only outbound provider ports in the API are `apps/api/src/modules/shared-services/provider/storage-provider.ts` and `.../message-provider.ts`. There is no vehicle-data port and no adapter of any kind.                                               |
| "the vehicle catalogue is populated"                             | It is not. `supabase/migrations/20260720091000_veh_reference_catalogs.sql` seeds **zero rows** in all five catalogue relations, by the standing no-fake-data policy, and says so in its own header.                                                                     |
| "P1-27 delivers catalogue maintenance"                           | It does not. P1-27 is a **consumer** of the five catalogue read operations (task register entry for `FE-017`, `FE-018`). No P1-27 task creates, edits, imports or retires a catalogue entry.                                                                            |
| "a vendor has been chosen, or a budget approved"                 | Neither. Selecting or contracting a paid provider is a commercial decision reserved to the Product Owner (§9), and no such decision is recorded anywhere in this repository.                                                                                            |

This document records what exists, what a professional vehicle-selection
experience would require, what each candidate source would have to prove, and the
question the Product Owner must answer. It recommends **an evaluation**. It does
not recommend, authorise or imply a purchase.

### Provenance of the statements in this document

| kind of statement                                        | where it comes from                                                                                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anything about the RootLco platform                      | Read out of this repository. Every table, column, constraint, operation identifier, permission code and file path below was read from the file named beside it.            |
| Anything about NHTSA vPIC                                | General knowledge of a well-known public service. **No live call was made while writing this document.** Every vPIC statement carries a re-verification obligation in §13. |
| Anything about JATO, TecAlliance/TecDoc, CarAPI or feeds | **Nothing.** No vendor documentation, contract, price list or service description was read. Almost every cell for these candidates is therefore "not established".         |

Where a value is unknown this document writes **"not established — requires
vendor confirmation"**. It does not estimate and it does not average. **No price,
no rate limit, no update interval, no availability figure and no coverage
percentage appears anywhere below** — for any candidate, the free one included.

One narrow exception is declared rather than hidden: the regulatory model-year
references in §5.1 (the 17-character VIN standard, and model year 2010 being
inside vPIC's era) are general knowledge, not values read from a file in this
repository. They carry the re-verification obligation recorded in §5.1 and §13,
and nothing in this document depends on them being right.

---

## 1. What this is for, in workshop terms

A service adviser receiving a vehicle needs to record what the vehicle **is**:
its make, its model, the model year, the trim or grade, the body style, and
whether it is petrol, diesel, hybrid, plug-in hybrid or fully electric. That
record is not paperwork. It decides which service items apply, which parts fit,
which labour times are quoted, whether the technician needs high-voltage
precautions, and whether the warranty position is knowable later.

Today the adviser can be offered nothing to choose from, because the catalogue is
empty and there is no supported way to fill it. The three ways out are:

| option                       | what it means in practice                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manual catalogue**         | The workshop's own staff enter the makes and models they actually see. Small, accurate, entirely under the workshop's control, and slow to build.       |
| **Free public source**       | Import a public reference set. No licence fee, no contract, and a market and depth limitation that has to be accepted honestly rather than talked past. |
| **Paid commercial provider** | Buy breadth, depth, images and refresh cadence. A recurring cost, a contract, and a redistribution question that has to be answered before it is used.  |

These are not mutually exclusive: a manual catalogue is the **fallback that must
exist regardless**, because every source will be missing the grey-import,
regional-variant and modified vehicles a real workshop receives. §11 explains why
that fallback also means no vendor decision can block the Frontend.

---

## 2. What the platform actually has today

### 2.1 The five catalogue relations

All five were created by `supabase/migrations/20260720091000_veh_reference_catalogs.sql`
(Phase 1-7, task `P1-07-DB-006`).

| relation               | parent       | columns beyond the common set                    | notes read from the migration                                        |
| ---------------------- | ------------ | ------------------------------------------------ | -------------------------------------------------------------------- |
| `veh.makes`            | —            | —                                                | `code`, `name`, `status`                                             |
| `veh.models`           | `veh.makes`  | `make_id`, `first_model_year`, `last_model_year` | Year bounds are `1900`–`2100` and `last >= first` where both are set |
| `veh.trims`            | `veh.models` | `model_id`                                       | —                                                                    |
| `veh.body_types`       | —            | —                                                | —                                                                    |
| `veh.powertrain_types` | —            | `category`                                       | `category` is one of `ice`, `ev`, `hybrid`, `phev`, `other`          |

The common set on every one of the five is `id`, `scope`, `tenant_id`, `code`,
`name`, `status`, `record_version`, and the created/updated/deleted metadata.

Four properties of this design decide everything an import has to do:

1. **Every catalogue is dual-scope.** A row is either a **platform default**
   (`scope = 'platform'`, `tenant_id IS NULL`) readable by every tenant, or a
   **tenant extension** (`scope = 'tenant'`, `tenant_id NOT NULL`). The check
   constraint `ck_makes_scope_tenant` and its four siblings tie the two together
   so neither can be set without the other.
2. **`code` has a strict form.** `ck_makes_code_format` is
   `code ~ '^[a-z][a-z0-9_]{1,62}$'` on all five relations: lower-case letters,
   digits and underscores, beginning with a letter, between 2 and 63 characters.
   `Mercedes-Benz`, `Land Rover`, `MINI` and a numeric provider identifier are all
   **rejected as codes**. A mapping is required, and it must be deterministic.
3. **Model year is a vehicle attribute, not a catalogue.** The migration header
   states it in as many words. `veh.vehicles.model_year` is an integer bounded
   `1900`–`2100`; `veh.models.first_model_year` / `last_model_year` describe the
   production window of the model, not a selectable year list.
4. **Zero rows are seeded.** The header records that platform defaults are
   "provisioned admin-side at onboarding, not baked into a migration", under the
   standing no-fake-data policy. The catalogue starts empty in every environment.

### 2.2 The five published read operations

Added by the P1-17 remediation recorded as `P1-27-INT-007` (PR #197). Verified in
`apps/api/src/app/api/v1/vehicle-catalogue/**/route.ts`.

| method | path                                        | operation id                         | permission         | scope    | rate policy         |
| ------ | ------------------------------------------- | ------------------------------------ | ------------------ | -------- | ------------------- |
| GET    | `/vehicle-catalogue/makes`                  | `veh.catalogue-make-list`            | `veh.vehicle.read` | `tenant` | `low-risk-metadata` |
| GET    | `/vehicle-catalogue/makes/{makeId}/models`  | `veh.catalogue-model-list`           | `veh.vehicle.read` | `tenant` | `low-risk-metadata` |
| GET    | `/vehicle-catalogue/models/{modelId}/trims` | `veh.catalogue-trim-list`            | `veh.vehicle.read` | `tenant` | `low-risk-metadata` |
| GET    | `/vehicle-catalogue/body-types`             | `veh.catalogue-body-type-list`       | `veh.vehicle.read` | `tenant` | `low-risk-metadata` |
| GET    | `/vehicle-catalogue/powertrain-types`       | `veh.catalogue-powertrain-type-list` | `veh.vehicle.read` | `tenant` | `low-risk-metadata` |

`low-risk-metadata` is defined in `apps/api/src/server/http/rate-limit.ts` as
**600 requests per 60 000 ms, keyed by operation and tenant**. `expensive-read`,
which these deliberately do not use, is **30 per 60 000 ms keyed by operation,
tenant and user**.

### 2.3 What those reads return — and what they do not

The projection is identical for all five, from
`apps/api/src/modules/vehicle/data/vehicle-catalogue-repository.ts`:

```
{ id, scope, code, name, status }   (+ makeId on models, modelId on trims)
```

Wrapped in the platform page envelope `{ items, nextCursor, hasMore }`. **There is
no `total`** — `apps/api/src/server/db/pagination.ts` fetches one extra row to
detect `hasMore` without a second `COUNT`, and publishes no count anywhere.
Page size is bounded by `schemas.limit` in
`apps/api/src/server/http/validation.ts` at **1–100**.

Consequences that matter to an import and to a selection screen:

| not published                         | consequence                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `first_model_year`, `last_model_year` | The columns exist on `veh.models` and no read returns them. A "2010 onward" filter cannot be driven from the published contract. See `VDP-03`. |
| any year, text or status filter       | All five query schemas are `.strict()` and accept `cursor` and `limit` only. A filter parameter would be answered `422`, not applied.          |
| any count                             | "How many makes did the import create?" cannot be answered by the API. Reconciling an import against the catalogue requires a full page walk.  |
| any image, logo, or media reference   | No such column exists on any of the five relations. See `VDP-04`.                                                                              |
| the provider's own identifier         | No external-reference column exists on any of the five relations. A refresh cannot recognise the rows it created last time. See `VDP-06`.      |

### 2.4 How a vehicle references the catalogue

`apps/api/src/modules/vehicle/domain/vehicle-write.ts` freezes the writable set:

| field                | column                |
| -------------------- | --------------------- |
| `vin`                | `vin_raw`             |
| `makeId`             | `make_id`             |
| `modelId`            | `model_id`            |
| `trimId`             | `trim_id`             |
| `bodyTypeId`         | `body_type_id`        |
| `powertrainTypeId`   | `powertrain_type_id`  |
| `modelYear`          | `model_year`          |
| `powertrainCategory` | `powertrain_category` |
| `color`              | `color`               |
| `displayNumber`      | `display_number`      |

Five of those ten are catalogue uuids. `veh.guard_vehicle_catalog_refs()` enforces
that a referenced row is visible to the tenant, that a model belongs to its make,
that a trim belongs to its model, and that a powertrain type's category matches
`veh.vehicles.powertrain_category`. The write permission is **`veh.vehicle.manage`**
("Create and edit vehicles in the caller tenant",
`supabase/seeds/04_iam_permission_catalog.sql`). There is no `veh.vehicle.create`.

The EV consequence is real and dictated by the database: `veh.vehicle_ev_profiles`
may exist only when the vehicle's `powertrain_category` matches its `ev_kind`
(`bev` → `ev`, `hybrid` → `hybrid`, `phev` → `phev`), enforced in both directions
with a `FOR SHARE` lock so the two cannot race. **If the catalogue's powertrain
classification is wrong, the EV profile — usable capacity, charge port,
high-voltage warning — cannot be recorded at all.** Powertrain accuracy is not a
cosmetic axis in this platform.

### 2.5 What does not exist

Each of these was looked for and is absent. They are the reason §12 exists.

| looked for                                                                                   | result                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any route that creates or edits a make, model, trim, body type or powertrain type            | None. The five relations are **read-only over HTTP**.                                                                                                             |
| A catalogue-management permission code                                                       | None. The `veh.` prefix holds exactly seven codes and not one of them concerns the catalogue.                                                                     |
| Any way to create a **platform-scope** row through the application role                      | None. `ins_makes_tenant` and its four siblings are `WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id())`.                                       |
| A `DELETE` grant on any catalogue relation                                                   | None. `app_runtime` holds `SELECT, INSERT, UPDATE` only; `app_readonly` holds `SELECT`.                                                                           |
| A VIN decode operation, or any outbound vehicle-data call                                    | None. `veh.vin_verifications.check_kind` admits `'external'`, and the migration states plainly that no external verification is performed and none is fabricated. |
| An image or logo column, or a platform-scope document link                                   | None, and none is possible: `shared.document_links.tenant_id` is `NOT NULL`, so a platform row (`tenant_id IS NULL`) can carry no linked document.                |
| A vehicle-data provider port                                                                 | None. The two ports that exist are for object storage and outbound messaging.                                                                                     |
| Any mention of a vehicle-data vendor in application code, configuration, migrations or seeds | None. The only file in the repository that names any candidate is this document.                                                                                  |

---

## 3. What "a professional vehicle-selection experience from model year 2010 onward" requires

Stated as requirements so each can be tested against a candidate rather than
argued about. Nothing in this table is implemented.

| id      | requirement                                                                                     | met today?                                                                       |
| ------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `VS-01` | An adviser can pick a make from a list rather than typing free text                             | No — the list is empty and cannot be filled through the API                      |
| `VS-02` | Picking a make narrows the models; picking a model narrows the trims                            | The three reads support this shape; the data does not exist                      |
| `VS-03` | Only model years the model was actually built in are offerable, for 2010 onward                 | No — the year columns exist and are not published, and no read filters on year   |
| `VS-04` | Body style is selectable from a controlled list                                                 | Read exists; data does not                                                       |
| `VS-05` | Powertrain is selectable and correct, because it gates the EV profile and high-voltage handling | Read exists; data does not                                                       |
| `VS-06` | EV and hybrid vehicles carry usable capacity and charge-port type                               | Columns exist on `veh.vehicle_ev_profiles`; no source populates them             |
| `VS-07` | A VIN can be decoded to pre-fill make, model, year and body style                               | No — no decode operation exists                                                  |
| `VS-08` | A search result grid shows "Toyota Camry", not two uuids                                        | No — `veh.vehicle-search` projects `make_id` and `model_id` and no names         |
| `VS-09` | A workshop can add a make or model the reference set does not have                              | No — no write route; the dual-scope schema anticipates it and nothing exposes it |
| `VS-10` | A discontinued model can be retired without breaking the vehicles that reference it             | No — no route sets `status` and there is no delete grant                         |
| `VS-11` | A make logo or model image can be shown, if the Owner decides that is wanted                    | No — no column, no platform-scope link, and **P1-OD-025 is open**                |
| `VS-12` | The catalogue can be refreshed without duplicating what it already holds                        | No — nothing stores the source's own identifier                                  |

`VS-08` deserves its own sentence because it is the one a user sees first.
`apps/api/src/modules/vehicle/data/vehicle-search-repository.ts` projects
`id, display_number, vin_normalized, make_id, model_id, model_year,
powertrain_category, lifecycle_status, workshop_status, created_at,
merged_into_id`. The **detail** read
(`apps/api/src/modules/vehicle/data/vehicle-read-repository.ts`) resolves
`make_name` and `model_name`; the search read does not. A results grid must
therefore resolve names itself from the catalogue lists — at up to 100 entries per
page, with no count to size the work.

---

## 4. The evaluation axes, and what each one decides

A comparison table is only useful if the reader knows what each row would change.

| axis                              | what it decides for this platform                                                                                                                                     | what would establish it                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Country / market coverage         | Whether the vehicles the pilot workshop actually receives are in the source at all. A source that misses the local market is not a cheaper option, it is a wrong one. | The Owner names the markets; the spike counts local-market vehicles found in a real sample. |
| 2010-onward historical coverage   | Whether a 2011 vehicle can be recorded as precisely as a 2024 one.                                                                                                    | Sampling known 2010–2015 vehicles and measuring what the source returns.                    |
| VIN support                       | Whether `VS-07` is possible, and whether `veh.vin_verifications` can ever record an `external` check honestly.                                                        | Decoding a set of real VINs and comparing the result with the vehicle in front of you.      |
| Make/model/year/trim completeness | Whether the four-level narrowing in `VS-02`/`VS-03` has anything to narrow.                                                                                           | Counting distinct trims returned for a sample of models, per market, per year.              |
| Body type                         | Whether `veh.body_types` can be populated from the source or must be curated by hand.                                                                                 | Comparing the source's body vocabulary with the one the workshop actually uses.             |
| Powertrain                        | Whether `veh.powertrain_types.category` can be derived, which gates the EV profile.                                                                                   | Mapping the source's powertrain vocabulary onto `ice / ev / hybrid / phev / other`.         |
| EV / hybrid fields                | Whether `usable_capacity_kwh` and `charge_port_type` can be pre-filled or must be measured per vehicle.                                                               | Checking whether the source publishes battery capacity and charge port at all.              |
| Images                            | Whether `VS-11` is achievable, and at what storage and licensing cost.                                                                                                | Vendor confirmation of image availability, resolution, and the right to display.            |
| Logos                             | Same, plus a trade-mark question that is not a data-licensing question.                                                                                               | Legal review. A manufacturer logo is a trade mark whoever supplies the file.                |
| Licensing                         | Whether the platform may use the data at all, and under what conditions.                                                                                              | The vendor's actual licence text, read by the Owner.                                        |
| Redistribution rights             | **The single most architecture-changing axis.** Whether data may be stored in the platform's own tables and shown to tenants, or must be fetched per request.         | The licence's redistribution clause, in writing.                                            |
| API limits                        | Whether an import can complete, and whether a per-request architecture is even viable.                                                                                | Vendor confirmation, then measurement.                                                      |
| Update frequency                  | How stale the catalogue is allowed to become, and how often the refresh job runs.                                                                                     | Vendor confirmation of publication cadence.                                                 |
| Cost                              | Whether the option is affordable. **Reserved to the Product Owner.**                                                                                                  | A written quotation. Nothing else.                                                          |
| SLA                               | Whether the vehicle-selection screen may depend on the source being up.                                                                                               | The vendor's service-level document, or the absence of one.                                 |
| Data export                       | Whether a bulk snapshot exists, which decides whether the import is a job or a crawl.                                                                                 | Vendor confirmation of a bulk file, its format and its size.                                |
| Offline cache                     | Whether the workshop can work when the link is down — the normal state of a workshop network.                                                                         | The licence (may we cache?) and the architecture (do we?).                                  |
| Vendor lock-in                    | What it costs to change one's mind later.                                                                                                                             | Whether the imported rows survive termination, per the licence.                             |

---

## 5. The candidates

### 5.1 NHTSA vPIC — the one source that can be described with confidence

vPIC (Product Information Catalog and Vehicle Listing) is published by the
**National Highway Traffic Safety Administration**, an agency of the United States
Department of Transportation. It is a **public United States government source**.
Access requires no API key and no contract, and there is no licence fee.

Its content derives from what manufacturers are required to submit to a United
States federal regulator about vehicles offered for sale in the United States.
That is the origin of both its strength and its limitation.

**Be explicit about the market limitation.** vPIC is a **United States** catalogue.
A vehicle sold only in the Gulf, in Europe, in Japan or in any other market, and
never offered in the United States, is not in it. A vehicle sold in several
markets appears with its **United States** specification, which may differ from
the local one in trim naming, engine availability and equipment. For a workshop
outside the United States, vPIC's usefulness is an empirical question about that
workshop's actual vehicle mix, and it must be measured rather than assumed.

Statements made with confidence:

- It is free to access and requires no key.
- It publishes no images and no manufacturer logos.
- It offers **no service-level agreement**. It is a public service with no
  availability commitment to anyone, and any design that depends on it being up
  is a design with an unowned single point of failure.
- 17-character VINs are standardised for United States market vehicles from model
  year 1981, which is the basis on which vPIC decodes a VIN. Model year 2010
  onward is therefore comfortably inside its era — but _era_ is not _completeness_,
  and completeness is measured in the spike.

Statements that must be re-verified before they are relied on (see §13), because
**no live call was made while writing this document**:

- The exact endpoint names for listing makes, listing models for a make, listing
  models for a make and year, and decoding a VIN.
- Whether trim is returned at all, and how often it is populated. Trim is the
  axis where a free regulatory source is most likely to disappoint, because trim
  is a marketing construct and the regulator's interest is safety and identity.
- Whether the bulk database snapshot NHTSA has historically published is still
  offered, in what format, and how large it is.
- The precise redistribution position. A work of the United States federal
  government is ordinarily not subject to domestic copyright, which is the usual
  basis for treating vPIC as freely reusable — but the **actual terms published
  by NHTSA** are what govern, and they must be read before the data is imported
  into a commercial product.

### 5.2 JATO Dynamics

A commercial automotive market-data business. **Nothing about JATO was read while
writing this document**: no product description, no coverage list, no licence, no
price. Every axis is therefore "not established — requires vendor confirmation",
and this document deliberately does not repeat impressions of what JATO is
generally said to cover. The evaluation asks; it does not assume.

### 5.3 TecAlliance / TecDoc

A commercial automotive data business whose TecDoc standard is used to link parts
to vehicles. **Nothing about TecAlliance or TecDoc was read while writing this
document.** Every axis is "not established — requires vendor confirmation".

One structural note that is worth putting to the vendor, and is a question rather
than a claim: a parts-linkage data model identifies a _vehicle type_ for fitment
purposes, and a fitment identity is not always the same thing as the
make/model/year/trim identity a service adviser selects. If TecAlliance is
evaluated, the mapping between its vehicle identity and
`veh.makes / models / trims / body_types / powertrain_types` must be established
explicitly, not presumed.

### 5.4 CarAPI

A commercial vehicle-data API. **Nothing about CarAPI was read while writing this
document** — no coverage statement, no rate limit, no price, no licence. Every
axis is "not established — requires vendor confirmation".

### 5.5 Manufacturer feeds, where contractually available

Not one source but a class of them: data supplied directly by a manufacturer or
its importer under a specific agreement. Coverage is by definition limited to that
manufacturer, and availability is entirely a matter of what the workshop's own
commercial relationships permit.

This class is worth listing because a franchised or authorised workshop may
already have an entitlement it is not using, and because a manufacturer feed is
usually the only source that is authoritative for that marque's own trim naming
in the local market. It is also the class with the highest integration cost per
unit of coverage: every feed is its own format, its own transport and its own
contract. Every axis is "not established" until a specific agreement is on the
table.

---

## 6. The comparison matrix

Every axis, every candidate. Read this table with §4 beside it, and with §0's
provenance note in mind: the four commercial columns are honestly empty because
no vendor material was read, not because the vendors are poor.

| axis                              | NHTSA vPIC                                                                                                                                     | JATO                                           | TecAlliance / TecDoc                           | CarAPI                                         | Manufacturer feeds                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Country / market coverage         | **United States only.** Non-US-market vehicles are absent; multi-market vehicles carry the US specification.                                   | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | Limited to the marque and territory of the agreement — not established |
| 2010-onward historical coverage   | Model years from 2010 are within its era (17-character VINs standardised from model year 1981). Completeness per make/model must be measured.  | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| VIN support                       | Yes — VIN decoding is its principal function. Field-by-field usefulness must be measured against real vehicles.                                | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Make/model/year/trim completeness | Make, model and year: strong for the US market. **Trim: expect weakness**; must be measured, not assumed.                                      | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Body type                         | A body/vehicle-type classification is published; its vocabulary must be mapped onto `veh.body_types`.                                          | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Powertrain                        | Fuel and propulsion attributes are published; mapping onto `ice / ev / hybrid / phev / other` must be defined and tested.                      | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| EV / hybrid fields                | Whether usable battery capacity and charge-port type are published is **not established** — verify in the spike.                               | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Images                            | **None.** vPIC publishes no vehicle imagery.                                                                                                   | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Logos                             | **None.** And a logo is a trade mark whoever supplies it — see §7.                                                                             | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Licensing                         | No licence fee and no contract to sign. The governing terms are NHTSA's own and **must be read** before import.                                | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | Entirely defined by the individual agreement — not established         |
| Redistribution rights             | Ordinarily unproblematic for a US federal government work, but **not established until NHTSA's published terms are read**.                     | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| API limits                        | No published rate limit that this document can cite — **not established**. Observed throttling must be measured.                               | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Update frequency                  | Refreshed as submissions arrive; **no published cadence or commitment — not established**.                                                     | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Cost                              | **No charge for access.** Total cost of ownership is not zero — mapping, import and refresh are ours (§8).                                     | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| SLA                               | **None offered.** Design for the service being unavailable.                                                                                    | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Data export                       | A downloadable database snapshot has historically been published alongside the API; **current availability, format and size not established**. | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Offline cache                     | Architecturally straightforward once imported; the licence question is the gate, and it is not established.                                    | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |
| Vendor lock-in                    | **Low.** No contract, no key, no termination clause. The real risk is market fit, not lock-in.                                                 | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation | not established — requires vendor confirmation                         |

**A note on how to read the empty columns.** Four candidates showing "not
established" on almost every axis is not a verdict against them. It is an accurate
statement that this document did not read their material, and a refusal to
manufacture the appearance of a comparison. §13 is the work that fills those
cells; the Owner should not be asked to decide until it has been done.

---

## 7. Licensing and redistribution decide the architecture, not the other way round

This is the section to read if only one is read.

There are two possible architectures, and the licence chooses between them:

| architecture          | how it works                                                                                                                                     | when it is permitted                                                                           | what it costs the workshop                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Import and hold**   | Provider data is transformed once into `veh.makes / models / trims / body_types / powertrain_types` and served from the platform's own database. | Only where the licence permits storing and displaying the data to third parties (the tenants). | Nothing at request time. The catalogue works when the link is down.              |
| **Fetch per request** | The platform calls the provider each time a picker opens, and stores nothing beyond what a vehicle record needs.                                 | Where redistribution or caching is restricted.                                                 | Every picker becomes a network round trip. **The workshop cannot work offline.** |

The platform as built today assumes the first. The five catalogue relations _are_
a stored copy; the read operations serve from the database; there is no outbound
call anywhere in the vehicle module. Choosing a provider whose licence forbids
storage does not simply cost more money — **it invalidates the schema that
already exists**, and would require a different design for vehicle selection.

That is why "redistribution rights" is the first question to put to any vendor,
before price. A cheap source that cannot be stored is more expensive than a dear
one that can.

Two further points, both reserved to the Owner rather than decided here:

1. **Logos are trade marks.** Whether a provider supplies a manufacturer logo file
   is a data question. Whether the platform may display that manufacturer's mark
   in a commercial product is a **trade-mark** question, and it does not become
   answered by a data licence. It needs its own legal view.
2. **Multi-tenant display is redistribution.** The platform serves many tenants.
   Showing licensed data to a tenant is showing it to a third party. A licence
   that permits internal use only does not permit this product's normal operation,
   and the distinction must be put to the vendor in exactly those terms.

---

## 8. Cost, limits and service levels — deliberately blank

**No price, no rate limit, no refresh interval and no availability figure appears
anywhere in this document.** None was read; inventing one would make the whole
evaluation worthless, because a decision taken against a fabricated number is
worse than a decision deferred.

What must be true of cost evidence when it does arrive:

| rule                                                                                                                   | why                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every money figure is recorded as a **decimal string plus an ISO 4217 currency code** — never a floating-point number. | The platform's own money contract (`apps/api/src/modules/pricing/domain/money.ts`) works this way, and a quotation transcribed as a float is a quotation that can be wrong in the last place. |
| Recurring and one-off costs are recorded separately.                                                                   | A licence fee and an integration effort are different decisions with different owners.                                                                                                        |
| The cost of **not** buying is recorded too.                                                                            | Manual catalogue maintenance is staff time, and it is a real cost that a purchase would displace.                                                                                             |
| No figure is carried into a document until it is in writing from the vendor.                                           | A number heard in a call is not evidence.                                                                                                                                                     |

The same discipline applies to limits and service levels. "Generous", "unlimited"
and "high availability" are not values; a documented request budget and a
documented availability commitment are.

---

## 9. This is a commercial decision reserved to the Product Owner

**Selecting, contracting, subscribing to or paying for a vehicle-data provider is
a COMMERCIAL AND FINANCIAL DECISION reserved entirely to the Product Owner.**

This document:

- **recommends an evaluation** (§13), which costs engineering time and no money;
- **recommends that a decision be taken and recorded** (§10);
- **does not recommend a vendor**;
- **does not recommend a purchase**;
- **does not authorise any expenditure, trial subscription, sign-up, or acceptance
  of any vendor's terms**;
- **does not treat any vendor as a default**, including the free one. vPIC is
  described more fully than the others because it can be described honestly, not
  because it is preferred.

No engineer may enter into a vendor agreement, accept vendor terms, or begin a
paid trial on the strength of this document. The evaluation in §13 is scoped so
that it can be completed **without any account that requires accepting commercial
terms**; where a candidate cannot be evaluated without one, that fact is reported
back to the Owner as a finding rather than resolved by signing.

---

## 10. Proposed open decision

A new open decision is proposed. It does not exist yet; recording it is the
Owner's act, not this document's.

| field                      | value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Suggested identifier**   | **`P1-OD-043`** — _suggested, not assigned_. `P1-OD-` numbers are issued by the canonical Word documents, which live outside this repository and govern it (`docs/governance/canonical-documents.md`; `docs/phase-1/phase-1-1/open-decisions.md` makes the same point, and its own entries are numbered `OIR-`, not `P1-OD-`). **This repository holds no open-decision register to allocate from**: `P1-OD-042` is merely the highest identifier _referenced_ anywhere in it. If `043` is already taken, the Owner assigns the next free number and this document is corrected. |
| **Title**                  | Vehicle reference-data source for the vehicle-selection experience                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Who decides**            | Product Owners jointly (commercial and financial), with a technical recommendation from Eng. Ezzaldeen Al-Bitar                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Blocks P1-27?**          | **No.** See §11. No P1-27 screen waits on this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Blocks later phases?**   | Only a phase that promises populated reference data at launch. No such phase commitment was found in this repository.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Related open decisions** | **`P1-OD-025`** (media upload policy) binds any answer involving images or logos. **`P1-OD-017`** (duplicate/merge rules) binds indirectly: a richer catalogue changes what "the same vehicle" means to `veh.vehicle.duplicate.review` and `veh.vehicle.merge`.                                                                                                                                                                                                                                                                                                                  |

### The exact questions the Owner must answer

Each is written so that it can be answered with a short, recordable answer.
Question 1 is the one that unblocks everything else.

| #     | question                                                                                                                                                                                  | answer format                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **1** | **Which markets must the vehicle catalogue cover for the pilot?** Name the countries.                                                                                                     | A list of countries                                       |
| **2** | **Is expenditure on a paid vehicle-data provider authorised in principle, or must the platform launch on a free source plus manual maintenance?**                                         | "Authorised in principle" / "Free source and manual only" |
| **3** | If expenditure is authorised in principle, **what is the approved evaluation budget and the maximum recurring cost** the Owner is willing to consider?                                    | Decimal string + ISO 4217 code, or "no ceiling set"       |
| **4** | **Are manufacturer logos and vehicle images required for launch, or are they desirable later?** (This is where `P1-OD-025` binds, and it carries a trade-mark question — §7.)             | "Required at launch" / "Desirable later" / "Not wanted"   |
| **5** | **Must reference data be stored in the platform's own database and shown to tenants?** (If yes, any provider whose licence forbids redistribution is excluded before price is discussed.) | "Yes — storage and tenant display required" / "No"        |
| **6** | **Must the vehicle-selection screen work when the workshop's internet link is down?**                                                                                                     | "Yes" / "No"                                              |
| **7** | **Who owns the platform-scope catalogue** — is it curated centrally by RootLco for all tenants, or does each tenant build its own?                                                        | "Central platform catalogue" / "Per tenant" / "Both"      |
| **8** | Does any workshop in scope **already hold a manufacturer data entitlement** that could be used?                                                                                           | Yes (name the marques) / No / Unknown                     |

**Until question 1, 2 and 5 are answered, no vendor conversation should begin**,
because those three answers eliminate candidates for free.

---

## 11. No vendor decision blocks the Frontend

**The provider interface and the manual catalogue fallback are to be built
independently of whichever vendor is eventually chosen — or of choosing none at
all. No Frontend work is blocked by this decision, and none should be paused
waiting for it.**

To be exact about tense: **neither the provider interface nor the manual
catalogue fallback exists today** (`VDP-07` and `VDP-01` record their absence).
The claim is not that they are built; it is that **their design does not depend
on the answer**, so building them need not wait for it and choosing a vendor
later does not invalidate them.

This is not an assertion of convenience. It is the pattern the platform already
uses, and there is a precedent in the repository to point at.

### The precedent

`apps/api/src/modules/shared-services/provider/storage-provider.ts` faces exactly
this situation for object storage. Its own docblock records that no production
object store is provisioned, that what the phase delivered is **the port** — the
shape every adapter must satisfy — together with a deterministic local adapter
that reaches no network, and that selecting and provisioning a real provider is an
owner decision recorded as open. The port was built, the decision stayed open, and
nothing was blocked.

A vehicle-data port would take the same shape and the same honesty.

### The three independent tracks

| track                            | depends on the vendor decision? | what it is                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend selection screens**   | **No**                          | The five catalogue read operations are published and stable. A picker built against `{ items, nextCursor, hasMore }` behaves identically whether the rows came from a vendor, an import, or an operator typing them.                                                |
| **Manual catalogue maintenance** | **No**                          | The dual-scope schema already supports tenant extensions. What is missing is a write route and a permission code (`VDP-01`) — Backend work that no vendor decision affects.                                                                                         |
| **Provider port and adapter**    | **Only the adapter**            | No such port exists yet (`VDP-07`). The port — "given a market and a model year range, yield candidate makes, models, trims, body types and powertrain types, plus optionally a VIN decode" — would be written once, and each vendor is then one adapter behind it. |

### What the Frontend must not do while the decision is open

| do not                                                            | because                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship a bundled list of makes or models inside the web application | It is fabricated business data and the no-fake-data policy forbids it. The guard allows the discussion in `docs/`, not the data in the product. |
| Show a placeholder catalogue "until the real one arrives"         | An operator cannot tell a placeholder from a thin catalogue, and will record vehicles against invented rows.                                    |
| Assume the catalogue is non-empty                                 | It is empty in every environment today. The empty state is the **normal** state and must read as a real, explained state, not as an error.      |
| Call any provider directly from the browser                       | It would put a vendor credential in a browser and bypass every tenant-scoping control the platform has.                                         |

---

## 12. Integration findings

These are findings raised **by this document**, in its own `VDP-` namespace. They
are proposed for adoption into the Phase 1-27 integration register at
`docs/phase-1/phase-1-27/findings.md`; the next free identifier in that register
at the time of writing is `P1-27-INT-010`. **This document does not edit that
register**, and no `VDP-` finding should be cited as though it were already
recorded there.

| finding    | what is missing                                                                                                                                                                                                                                                                                                                 | owning Backend phase                    | owning Frontend phase                                    | required action                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VDP-01** | No write operation of any kind for the five catalogue relations, and **no permission code** that could gate one. The seven `veh.` codes cover vehicles, never the catalogue.                                                                                                                                                    | P1-17 (routes); P1-14 (permission seed) | None — no P1-27 task maintains the catalogue             | Raise a Backend remediation adding catalogue create/edit operations and a permission code for them. Do not invent the code name here; it must be added to the seed and reviewed.                |
| **VDP-02** | **Platform-scope rows cannot be created through the application role at all.** `ins_makes_tenant` and its four siblings require `scope = 'tenant'`. The migration states platform defaults are "provisioned admin-side at onboarding".                                                                                          | P1-07 (schema) / P1-17                  | None                                                     | Decide and record whether a platform catalogue is loaded by an administrative job outside the API, or by a new privileged operation, and write the decision down before any import is designed. |
| **VDP-03** | `veh.models.first_model_year` and `last_model_year` exist and **are not published by any read**, and no catalogue read accepts a year filter (all five query schemas are `.strict()` with `cursor` and `limit` only). "Model year 2010 onward" cannot be expressed.                                                             | P1-17                                   | P1-27 (consumer — `FE-017`, `FE-018`)                    | Publish both year columns on the model read and add a year filter; or record explicitly that year narrowing is client-side over a full page walk, with the cost stated.                         |
| **VDP-04** | **No image or logo column on any catalogue relation, and no possible link.** `shared.document_links.tenant_id` is `NOT NULL`, so a platform-scope row (`tenant_id IS NULL`) can carry no document link. **`P1-OD-025` binds.**                                                                                                  | P1-15 (documents) / P1-17               | None until `P1-OD-025` is answered                       | Do not design imagery until `P1-OD-025` is decided. If imagery is wanted, the platform-scope link gap must be closed first — it is a schema change, not a screen change.                        |
| **VDP-05** | **No VIN decode operation and no provider port.** `veh.vin_verifications.check_kind` admits `'external'` and the migration states plainly that no external verification is performed and none is fabricated. There is a place to record a decode and no way to perform one.                                                     | P1-17                                   | P1-27 is the eventual consumer; not in its task register | Build the port before any adapter. Nothing may write `check_kind = 'external'` until a real external check exists — a fabricated one would be worse than no check.                              |
| **VDP-06** | **No external-reference column anywhere.** Nothing stores the source's own identifier for a make, model or trim, and `code` must match `^[a-z][a-z0-9_]{1,62}$`, which rejects `Mercedes-Benz`, `Land Rover` and any numeric provider id. A refresh cannot recognise the rows it created.                                       | P1-07 (schema) / P1-17                  | None                                                     | Design the identifier mapping and its storage **before** the first import. An import that cannot be re-run idempotently is a one-way operation.                                                 |
| **VDP-07** | **No vehicle-data provider port exists.** The only ports in the codebase are `storage-provider.ts` and `message-provider.ts`.                                                                                                                                                                                                   | P1-17, or a later integration phase     | None                                                     | Build the port and a manual-entry path first, following the `storage-provider.ts` precedent: the port is delivered, the vendor stays an open decision.                                          |
| **VDP-08** | **The vehicle search projection publishes no names.** `veh.vehicle-search` returns `make_id` and `model_id` and no `make_name` or `model_name`; the detail read resolves both. A results grid shows uuids unless the client resolves names itself, at 100 rows per page with no count.                                          | P1-17                                   | P1-27 (the workaround lives in the client today)         | Add the two names to the search projection, or record the client-side resolution and its request cost as an accepted limitation.                                                                |
| **VDP-09** | **No supported way to retire or supersede a catalogue entry.** No route sets `status`, and `app_runtime` holds no `DELETE` grant on any of the five relations. A provider refresh that discontinues a model cannot be reflected.                                                                                                | P1-17                                   | None                                                     | Include retirement in the write surface raised by `VDP-01`, and define what a retired entry does to vehicles that already reference it.                                                         |
| **VDP-10** | **The provider question is recorded nowhere.** A repository-wide search for every candidate name matches only this document — no application code, configuration, migration or seed mentions one — and no open decision covers vehicle reference data. `P1-OD-017` and `P1-OD-025` bind adjacent areas and neither is this one. | Not a Backend defect — a governance gap | Not a Frontend defect                                    | The Owner records the open decision proposed in §10 and answers questions 1, 2 and 5 before any vendor is approached.                                                                           |

**None of these ten blocks a P1-27 screen.** They block a populated catalogue,
which is a different thing and is nobody's P1-27 commitment.

---

## 13. The evaluation this document recommends

A bounded, time-boxed technical spike whose only output is evidence. It costs
engineering time and **no money**, and it must not require accepting any vendor's
commercial terms.

| step | activity                                                                                                                                                                   | output                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1    | The Owner answers questions 1, 2 and 5 of §10.                                                                                                                             | The candidate list shrinks before any work is done.                                         |
| 2    | Assemble a **real vehicle sample** from the pilot workshop: the makes, models, years and trims actually received, 2010 onward. Not a wish list.                            | The measurement set. Without it every coverage claim is untestable.                         |
| 3    | Re-verify every vPIC statement in §5.1 against the live public service: endpoint names, trim population rate, bulk snapshot availability, published terms.                 | A corrected §5.1, or a record that a statement did not survive contact.                     |
| 4    | Measure vPIC against the sample: what fraction of the sample is found, and at what precision (make / model / year / trim / body / powertrain).                             | A coverage figure derived from counting, with the sample size stated beside it.             |
| 5    | Request written coverage, licensing, redistribution, limit, cadence and pricing information from the commercial candidates. **Requesting information is not contracting.** | The empty columns of §6 filled with vendor-attributable statements.                         |
| 6    | Map each candidate's vocabulary onto `veh.body_types` and the `ice / ev / hybrid / phev / other` powertrain categories on paper.                                           | The mapping cost per candidate, which is a real integration cost and is usually overlooked. |
| 7    | Report to the Owner: filled matrix, coverage figures, mapping costs, and the open questions that survived.                                                                 | A decision paper. **Not a purchase.**                                                       |

Two rules bind the spike:

- **Nothing the spike produces enters the product database.** Sample decodes,
  coverage counts and mapping tables are evidence, and evidence lives in
  documentation. Business tables start empty and stay empty until real data is
  entered by a real user or by an approved import.
- **No account is created and no terms are accepted.** If a candidate cannot be
  evaluated without one, that is reported to the Owner as a finding for the Owner
  to resolve, not resolved by an engineer signing up.

---

## 14. Constraints any import must satisfy

Recorded here so that a future import is designed against them rather than
discovering them.

| constraint                                                                  | source                                                                    | consequence for an import                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| No fabricated business data ships                                           | Standing no-fake-data policy; `scripts/check-no-fake-data.mjs`            | Imported reference data must be real reference data. A "starter set" invented to make screens look populated is prohibited.               |
| `code` must match `^[a-z][a-z0-9_]{1,62}$`                                  | `ck_makes_code_format` and its four siblings                              | A deterministic, recorded transliteration is required, and collisions must be resolved by a rule, not by chance.                          |
| Tenant extensions may reuse a platform `code`                               | Partial unique indexes are separate per scope; resolution is tenant-first | A tenant's own "Toyota" legitimately shadows the platform's. An import must not treat that as corruption.                                 |
| A model's make and a trim's model must be platform-scope or the same tenant | `veh.guard_model_make_scope()`, `veh.guard_trim_model_scope()`            | The import must load makes before models before trims, and cannot mix scopes within a hierarchy.                                          |
| `scope`, `tenant_id`, `code`, `created_*` are immutable                     | `org.guard_immutable_columns` triggers on all five relations              | A mis-coded row cannot be renamed into correctness. It must be retired and replaced — and `VDP-09` says there is no retirement route yet. |
| Reads are keyset-paginated with no total                                    | `apps/api/src/server/db/pagination.ts`; `limit` bounded 1–100             | Reconciling an import against the API costs a full page walk. Reconcile in the database instead.                                          |
| Powertrain category is load-bearing                                         | `veh.guard_ev_profile_powertrain()`, `veh.guard_vehicle_ev_powertrain()`  | A wrong powertrain classification makes the EV profile unrecordable. Powertrain mapping must be reviewed by a human, not inferred.        |

---

## 15. What this document does not decide

| not decided                                             | who decides it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which provider, if any                                  | Product Owner, on the evidence from §13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Whether any money is spent                              | Product Owner — a commercial and financial decision (§9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Whether images or logos are in scope                    | Product Owner, through `P1-OD-025`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Whether the platform catalogue is central or per tenant | Product Owner, §10 question 7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| The permission code that would gate catalogue writes    | A reviewed Backend change to `supabase/seeds/04_iam_permission_catalog.sql`. **This document deliberately does not name one**, because a code invented in documentation and then implemented from it is how an operation ends up gated by something the catalogue never approved.                                                                                                                                                                                                                                           |
| The shape of the provider port                          | The Backend phase that builds it, following the `storage-provider.ts` precedent                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Whether an ADR is required                              | If the Owner takes a decision, it is recorded per `docs/adr/README.md`: take the next free number, never reuse one (including for superseded records), and use the mandatory heading template. **Take the number from the directory, not from that README's worked example, which is stale**: it names `ADR-019` as the highest in use, while the highest file present in `docs/adr/` is `ADR-021`. The next free number is therefore `ADR-022`, and the README should be corrected in whichever change next adds a record. |

---

**Nothing above is implemented. Nothing above authorises a purchase. The
recommendation is an evaluation and a recorded Owner decision.**
