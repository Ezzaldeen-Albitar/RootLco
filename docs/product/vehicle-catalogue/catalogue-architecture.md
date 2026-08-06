# Vehicle Catalogue Architecture

**Status:** Planning — not implemented · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Recorded:** 2026-08-06 · **Phase authority:** P1-27 Owner-acceptance remediation

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 0. Planning and traceability only

**Nothing described in this document as "planned", "required" or "must" is
implemented, and Phase 1-27 does not implement any of it.**

This document exists so that a future phase can be scoped, costed and argued
with. It is a specification of an intended shape, not a description of a working
system. Every forward-looking sentence describes work that has not been written,
merged, tested or accepted.

Three separate kinds of statement appear below, and they are kept visually
distinct throughout:

| marker in the text                    | meaning                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Exists today**, or a table under §2 | Read out of this repository on branch `remediation/p1-27-owner-acceptance-ux` and traceable to a named file.   |
| **Planned**                           | Does not exist. No code, no migration, no route, no permission. A future phase would have to build it.         |
| **Not established**                   | A number, limit, threshold, provider, price or owning phase that nobody has decided. It is not estimated here. |

Section 2 is the only section that describes reality. Sections 3 to 6 describe a
target that does not exist. Section 8 records, as numbered integration findings,
every contract this architecture needs and could not find.

No count, threshold, service level, refresh interval, page size, licence fee or
vendor price is invented anywhere in this document. Where a number would be
required to build the thing described, the text says **not established** and
names what would establish it.

---

## 1. Purpose, audience and scope

### 1.1 The problem this addresses

A workshop cannot book a vehicle in, quote for it, order parts for it or warrant
work on it until the vehicle is identified. Identification in the product today
means choosing a make, a model, a trim, a body type and a powertrain type from
five reference lists, plus typing a model year. Those five lists are stored, are
readable, and — in every environment the platform currently has — are **empty**,
because the platform seeds no reference data (§2.7).

That leaves two problems, and they are different problems:

1. **Where does approved reference data come from?** Somebody has to put makes
   and models into the platform catalogue, keep them current, and be able to say
   where each row came from. That is the synchronisation problem (§5).
2. **How does a receptionist identify a vehicle in front of them in a few
   seconds, including a fifteen-year-old import that no catalogue will ever
   list?** That is the selection-flow problem (§3).

An architecture that solves only the first produces a tidy database nobody can
use at the counter. An architecture that solves only the second produces a free
text box and a vehicle history that cannot be reported on.

### 1.2 Who this is written for

Workshop managers and business owners deciding whether to fund the work;
the Product Owner, who must take the commercial and licensing decisions in §6
and the open decisions in §7; and the phase planner who will turn §8 into tasks.

It is not a developer guide. It names files and contracts because a claim that
cannot be checked is not worth recording, but it explains what each one means in
business terms.

### 1.3 What is deliberately out of scope

- Any change to Phase 1-27. P1-27 is a Frontend phase and may not touch
  `apps/api/src/**`, `supabase/**` or migrations at all.
- Any recommendation to buy, licence or contract a data provider (§6.2).
- Vehicle **service** history, work orders, parts and pricing. This document is
  about identifying the vehicle, not about what is done to it.

---

## 2. What exists today

Everything in this section was read out of the repository. File paths are given
so each claim can be re-checked.

### 2.1 The five reference tables

Source: `supabase/migrations/20260720091000_veh_reference_catalogs.sql`
(Phase 1-7, task `P1-07-DB-006`).

| table                  | parent       | columns beyond the common set                    |
| ---------------------- | ------------ | ------------------------------------------------ |
| `veh.makes`            | none         | —                                                |
| `veh.body_types`       | none         | —                                                |
| `veh.powertrain_types` | none         | `category`                                       |
| `veh.models`           | `veh.makes`  | `make_id`, `first_model_year`, `last_model_year` |
| `veh.trims`            | `veh.models` | `model_id`                                       |

All five carry the same common column set:

| column                     | notes                                                               |
| -------------------------- | ------------------------------------------------------------------- |
| `id uuid`                  | Generated. The only stable handle published over HTTP.              |
| `scope text`               | `platform` or `tenant`. See §2.3.                                   |
| `tenant_id uuid NULL`      | `NULL` for platform rows; set for tenant rows. Tied to `scope`.     |
| `code text`                | Machine key. Format constrained — see §2.2. **Immutable once set.** |
| `name text`                | Display text. Non-blank. One column, one language — see §2.8.       |
| `status text`              | `active` or `inactive`. Defaults to `active`.                       |
| `record_version integer`   | Optimistic-concurrency counter. Defaults to 1.                      |
| `created_at`, `created_by` | Immutable once set.                                                 |
| `updated_at`, `updated_by` | Maintained by `shared.touch_row_metadata`.                          |
| `deleted_at`, `deleted_by` | Soft delete. No row is ever physically removed by the application.  |

`veh.powertrain_types.category` is constrained to `ice`, `ev`, `hybrid`, `phev`
or `other`. The table comment states that the category here is _descriptive_ and
that the authoritative electric-drive driver is `veh.vehicles.powertrain_category`.

`veh.models.first_model_year` and `last_model_year` are each nullable, each
constrained to 1900–2100, and `last_model_year` may not precede
`first_model_year`.

The migration header states explicitly that **model year is a vehicle attribute,
never a catalogue table**.

### 2.2 The catalogue code format constraint

This is the single most consequential constraint in the existing schema for
anything that imports data, and it is easy to miss.

Every one of the five tables carries:

```
CONSTRAINT ck_<table>_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$')
```

Read in plain terms, a catalogue code:

| rule                                                       | consequence for imported data                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Must start with a lower-case letter `a`–`z`                | `3_series` is rejected. A model whose public name begins with a digit needs a prefixed code. |
| May then contain only `a`–`z`, `0`–`9` and underscore      | No spaces, no hyphens, no full stops, no accented letters, no Arabic, no upper case.         |
| Is 2 to 63 characters long in total (1 + between 1 and 62) | A one-character code is impossible. `i` and `q` cannot be codes.                             |

So a provider value such as `Mercedes-Benz`, `Citroën`, `MINI`, `Rolls-Royce`,
`E-Class` or `X3 M40i` cannot be stored as a code in the form it arrives in. It
must be transformed — for example to `mercedes_benz`, `citroen`, `mini`,
`rolls_royce`, `e_class` — and the untransformed public form belongs in `name`,
which has no format constraint beyond being non-blank.

Two further facts make this constraint sharper than it first appears:

1. **`code` is immutable.** The `tg_<table>_immutable` trigger on each of the
   five tables lists `scope`, `tenant_id`, `code`, `created_at` and `created_by`
   (plus `make_id` on models and `model_id` on trims) as columns that may never
   change after insert. A code written by a faulty transliteration rule cannot be
   corrected in place. The row must be retired and a new row created, and every
   vehicle pointing at the old row keeps pointing at the old row.
2. **A retired code can be reissued.** The unique indexes are partial on
   `deleted_at IS NULL` — `uq_makes_platform_code`, `uq_makes_tenant_code`, and
   the equivalents on the other four. The repository docblock in
   `apps/api/src/modules/vehicle/data/vehicle-catalogue-repository.ts` states the
   reason: a list that ignored `deleted_at` would show a retired `toy` and a
   current `toy` as two makes with one name.

Uniqueness is namespaced, not global:

| table                  | platform namespace | tenant namespace              |
| ---------------------- | ------------------ | ----------------------------- |
| `veh.makes`            | `(code)`           | `(tenant_id, code)`           |
| `veh.body_types`       | `(code)`           | `(tenant_id, code)`           |
| `veh.powertrain_types` | `(code)`           | `(tenant_id, code)`           |
| `veh.models`           | `(make_id, code)`  | `(tenant_id, make_id, code)`  |
| `veh.trims`            | `(model_id, code)` | `(tenant_id, model_id, code)` |

The models entry is why the HTTP surface nests models under a make: two different
makes may legitimately both carry a model coded `camry`, so a flat model list
would be ambiguous. The route docblock says so.

The migration header records this as deliberate: _"a tenant extension MAY reuse a
platform code within its own scope (separate partial-unique namespaces);
resolution is tenant-first then platform. This is an intentional override, not
corruption."_

### 2.3 Scope, visibility and who may add a row

Each of the five tables is dual-scope. A **platform** row (`scope = 'platform'`,
`tenant_id NULL`) is a shared default visible to every tenant. A **tenant** row
(`scope = 'tenant'`, `tenant_id` set) is one workshop group's own addition.

Row-level security expresses the union once, in the policy:

```
USING (scope = 'platform' OR tenant_id = iam.current_tenant_id())
```

Consequences, all present in the migration:

| behaviour                                              | how it is enforced                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A tenant reads platform rows plus its own              | `sel_<table>_visible` on all five.                                                            |
| A tenant may insert and update only its own extensions | `ins_`/`upd_<table>_tenant`, both `scope = 'tenant' AND tenant_id = current`.                 |
| A tenant can never claim or edit a platform row        | The UPDATE policy carries an explicit `USING`, so a platform row cannot enter the update set. |
| Nothing may be physically deleted                      | The grant is `SELECT, INSERT, UPDATE` only. There is no `DELETE` grant on any of the five.    |
| A model's make must be platform or the same tenant     | Trigger `tg_models_make_scope` → `veh.guard_model_make_scope()`.                              |
| A trim's model must be platform or the same tenant     | Trigger `tg_trims_model_scope` → `veh.guard_trim_model_scope()`.                              |

Both guards run `SECURITY INVOKER`, so a cross-tenant parent hidden by row-level
security is simply not found, and the insert is rejected rather than silently
accepted.

The application layer deliberately adds no tenant filter of its own. The
repository docblock states that a `tenant_id = $1` predicate there would be
_strictly wrong_ rather than merely redundant, because it would hide every
platform row from every tenant.

### 2.4 The five published read operations

Source: `apps/api/src/app/api/v1/vehicle-catalogue/**/route.ts`. Added by the
P1-17 remediation recorded as `P1-27-INT-007`.

| method | path                                        | operation id                         | permission         |
| ------ | ------------------------------------------- | ------------------------------------ | ------------------ |
| GET    | `/vehicle-catalogue/makes`                  | `veh.catalogue-make-list`            | `veh.vehicle.read` |
| GET    | `/vehicle-catalogue/makes/{makeId}/models`  | `veh.catalogue-model-list`           | `veh.vehicle.read` |
| GET    | `/vehicle-catalogue/models/{modelId}/trims` | `veh.catalogue-trim-list`            | `veh.vehicle.read` |
| GET    | `/vehicle-catalogue/body-types`             | `veh.catalogue-body-type-list`       | `veh.vehicle.read` |
| GET    | `/vehicle-catalogue/powertrain-types`       | `veh.catalogue-powertrain-type-list` | `veh.vehicle.read` |

All five share the same registration:

| property          | value               | what it means                                                                              |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| `scope`           | `tenant`            | Not branch-scoped. One catalogue per tenant, not per branch.                               |
| `auditClass`      | `none`              | Reading the catalogue writes no audit record.                                              |
| `rateLimitPolicy` | `low-risk-metadata` | Chosen over `expensive-read` because a picker opens constantly and holds no personal data. |
| `cacheCategory`   | `never`             | The published contract currently forbids caching these responses.                          |

Each returns the standard keyset page — `{ items, nextCursor, hasMore }`. There
is **no `total`**. `apps/api/src/server/db/pagination.ts` fetches one extra row
to detect `hasMore` without a second count query, and defines
`DEFAULT_PAGE_SIZE = 50` and `MAX_PAGE_SIZE = 100`.

**An over-large page request is refused, not clamped**, and two layers disagree
about that in a way a screen designer must not get wrong. The published query
schema every list shares — `schemas.limit` in
`apps/api/src/server/http/validation.ts` — is
`z.coerce.number().int().min(1).max(100)`, so `limit=1000` is a **422 naming the
field** and never reaches the data layer. `resolveLimit()` beneath it would
return 100, and its own comment describes clamping; that path is defence in
depth for internal callers, not the published behaviour. A screen must therefore
never request more than 100 rows, and the default when `limit` is omitted is 50.
The same statement is carried in
`docs/product/workshop/vehicle-history-model.md` §7.

The projected fields are:

| relation                            | fields returned                         |
| ----------------------------------- | --------------------------------------- |
| makes, body types, powertrain types | `id`, `scope`, `code`, `name`, `status` |
| models                              | the same five, plus `makeId`            |
| trims                               | the same five, plus `modelId`           |

Ordering is `(name, id)` ascending, and the cursor is minted from `name` — the
same column the `ORDER BY` names. The repository docblock explains both choices:
a picker ordered by creation time is ordered by nothing a human can see, and a
cursor minted from a column other than the sort key silently skips rows. Because
no timestamp appears in the sort key, these five reads are structurally immune to
the microsecond-truncation defect recorded as `P1-27-INT-006`.

Two behaviours are worth stating for anyone designing screens against them:

- **An unknown or invisible parent returns an empty page, not a 404.** Asking for
  the models of a make that belongs to another tenant gives the same answer as
  asking for the models of a real make that has none. The service docblock names
  the reason: any other behaviour would turn the endpoint into an existence
  oracle for another tenant's catalogue additions.
- **Soft-deleted rows are excluded.** Every query carries `deleted_at IS NULL`.

### 2.5 How a vehicle binds to the catalogue

Source: `supabase/migrations/20260720092000_veh_vehicles.sql` and
`apps/api/src/modules/vehicle/domain/vehicle-write.ts`.

`veh.vehicles` carries five nullable catalogue references — `make_id`,
`model_id`, `trim_id`, `body_type_id`, `powertrain_type_id` — plus
`model_year integer NULL` (1900–2100) and `powertrain_category text NOT NULL`
defaulting to `ice`.

The trigger `tg_vehicles_catalog_refs` runs `veh.guard_vehicle_catalog_refs()`
and enforces, fail-closed:

| rule                                                                            | error raised                   |
| ------------------------------------------------------------------------------- | ------------------------------ |
| The make must be visible to this tenant                                         | foreign-key violation          |
| The body type must be visible to this tenant                                    | foreign-key violation          |
| The model must be visible, and must belong to the chosen make                   | foreign-key or check violation |
| The trim must be visible, and must belong to the chosen model                   | foreign-key or check violation |
| The powertrain type's `category` must equal the vehicle's `powertrain_category` | check violation                |

The last rule matters for §3 and for finding `VCAT-01`: the database rejects a
vehicle whose chosen powertrain type disagrees with its powertrain category, and
the read operation does not publish the category, so a screen cannot avoid the
rejection in advance.

The fields a caller may write are frozen in `VEHICLE_WRITABLE_COLUMNS`:
`vin`, `makeId`, `modelId`, `trimId`, `bodyTypeId`, `powertrainTypeId`,
`modelYear`, `powertrainCategory`, `color`, `displayNumber`. Edge bounds are
`MAX_VIN_INPUT = 64`, `MAX_COLOR = 40`, `MAX_DISPLAY_NUMBER = 40`,
`MODEL_YEAR_MIN = 1900`, `MODEL_YEAR_MAX = 2100`.

Two write operations consume them, both gated on **`veh.vehicle.manage`**:

| method | path                    | operation id         |
| ------ | ----------------------- | -------------------- |
| POST   | `/vehicles`             | `veh.vehicle-create` |
| PATCH  | `/vehicles/{vehicleId}` | `veh.vehicle-update` |

There is no `veh.vehicle.create` permission. `veh.vehicle.manage` is the code
that gates both creating and editing, and the permission seed describes it as
"Create and edit vehicles in the caller tenant".

### 2.6 What the operator screens do with the catalogue today

Source: `apps/web/src/features/vehicles/catalogue-api.ts` and
`apps/web/src/app/[locale]/(dashboard)/vehicles/new/page.tsx`.

| behaviour today                                                              | note                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The three parentless catalogues are read on the server before first paint    | Makes, body types and powertrain types, read in parallel.                                                                                                                          |
| Models and trims are fetched when a make or a model is chosen                | Nothing to fetch before then.                                                                                                                                                      |
| Each adapter walks every page to build one option list                       | A picker that pages is a picker nobody can use.                                                                                                                                    |
| The walk is bounded at `MAX_PAGES = 20` pages of `PAGE_SIZE = 100`           | An unbounded "walk until the cursor stops" loop against a remote service would hang the form on a malformed `hasMore`.                                                             |
| Reaching the bound is reported, not hidden                                   | The result carries `truncated`, and the selector says the list is incomplete.                                                                                                      |
| Nothing is cached between requests                                           | The docblock states that a module-level cache would become a second source of truth for what a tenant's catalogue contains, and would go stale exactly when a tenant added a make. |
| The creation screen is gated on `veh.vehicle.manage`, not `veh.vehicle.read` | Read access must not render write controls.                                                                                                                                        |

### 2.7 The catalogue is empty, by policy

The migration header states it plainly: _"Per the standing no-fake-data policy
this migration seeds ZERO rows — platform defaults are provisioned admin-side at
onboarding, not baked into a migration."_

No migration, seed or fixture script anywhere in the repository inserts a
catalogue row; the only inserts are the ephemeral fixtures inside the database
and backend test suites, which create their rows and discard them. So a running
environment starts with all five lists empty and stays that way until somebody
puts something in them — and there is no published operation that can (§2.8).
This is the practical starting condition for everything in §5.

### 2.8 What does not exist — verified absences

Each row below is something this architecture needs and that was searched for and
not found. These are the raw material of the findings in §8.

| looked for                                                                                            | result                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A generation concept — table, column, route or permission                                             | **Does not exist anywhere.** A search of every migration for "generation" returns one unrelated comment about random token material.                                                                  |
| A model-year catalogue relation                                                                       | Does not exist by design. Year is `veh.vehicles.model_year`, a plain integer.                                                                                                                         |
| Publication of `veh.models.first_model_year` / `last_model_year`                                      | The columns exist; no read operation projects them.                                                                                                                                                   |
| Publication of `veh.powertrain_types.category`                                                        | The column exists and the database enforces it; the read projects `id`, `scope`, `code`, `name`, `status` only.                                                                                       |
| Any write route for any of the five catalogues                                                        | None. All five are read-only over HTTP.                                                                                                                                                               |
| A catalogue-management permission code                                                                | None. The seed carries seven `veh.*` codes and not one concerns the catalogue.                                                                                                                        |
| Localised catalogue labels                                                                            | One `name` column per row. `shared.localization_keys` and `shared.localized_texts` exist, are described as runtime SELECT-only, carry no tenant column, are not linked to `veh.*`, and have no route. |
| Source provenance — source id, source version, source market, effective dates, last-synchronised time | None of these columns exists on any of the five tables.                                                                                                                                               |
| A brand logo or vehicle image column                                                                  | No `logo`, `image`, `photo` or `thumbnail` column exists in any migration in the repository.                                                                                                          |
| A `VehicleCatalogProvider`, or any provider abstraction in the vehicle module                         | None. `apps/api/src/modules/vehicle/index.ts` composes ten services and not one is a provider.                                                                                                        |
| A VIN decode operation                                                                                | None. `veh.vin_verifications` exists — append-only, `check_kind` in `checksum`/`format`/`manual`/`external`, `result` in `passed`/`failed`/`overridden` — and no code reads or writes it.             |
| An import or synchronisation job, a staging table, a conflict report, a catalogue approval workflow   | None of these exists.                                                                                                                                                                                 |
| Engine or motor specification on the catalogue                                                        | Not on the catalogue. `veh.engine_history` holds `displacement_cc`, `power_kw numeric(7,2)` and `fuel_note` **per vehicle**, and has no route.                                                        |

---

## 3. The required operator selection flow — planned

**None of this section is implemented.** It specifies what an operator-facing
vehicle identification flow must do, so that the Backend contracts in §8 can be
scoped against a concrete requirement.

### 3.1 The steps

| step | operator does                                  | source of the options                                 | exists today?                                                       |
| ---- | ---------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| 1    | Searches or selects a manufacturer/make        | `veh.catalogue-make-list`                             | Operation exists. Server-side search does not — see §3.3.           |
| 2    | Selects a model year                           | Would need a per-model year range or year list        | **No contract.** `VCAT-02`, `VCAT-04`.                              |
| 3    | Selects a model                                | `veh.catalogue-model-list`                            | Operation exists; it is not year-aware.                             |
| 4    | Selects a generation, where one exists         | Would need a generation relation                      | **No contract at all.** `VCAT-03`.                                  |
| 5    | Selects a trim                                 | `veh.catalogue-trim-list`                             | Operation exists; keyed by model only, not by year. `VCAT-05`.      |
| 6    | Selects a body type                            | `veh.catalogue-body-type-list`                        | Operation exists. The named types are data, not schema — see below. |
| 7    | Selects a powertrain                           | `veh.catalogue-powertrain-type-list`                  | Operation exists; category is not published. `VCAT-01`.             |
| 8    | Sees engine/motor specification                | Would need licensed specification data and a contract | **No contract.** `VCAT-09`.                                         |
| 9    | Sees brand identity and a representative image | Would need a licensed-asset contract                  | **No contract.** `VCAT-08`, and `P1-OD-025` binds.                  |

**On body types.** The requirement names SUV, saloon, hatchback, coupé, pick-up,
van, estate, convertible and "other approved type". None of these is a schema
value. `veh.body_types` is a free catalogue with a `code`/`name` pair and no
enumerated vocabulary, so this list is a **data-provisioning decision** — which
rows the platform catalogue ships with — not a migration. It must be recorded as
an approved vocabulary somewhere the provisioning process reads, and the codes
must satisfy §2.2 (`suv`, `saloon`, `hatchback`, `coupe`, `pick_up`, `van`,
`estate`, `convertible`, `other`). The display names are what appear on screen.

**On powertrains.** Unlike body types, powertrain **category** is schema. The
five permitted values are `ice`, `ev`, `hybrid`, `phev` and `other`, fixed by
`ck_powertrain_types_category` and mirrored by
`ck_vehicles_powertrain_category`. A sixth category cannot be introduced by
provisioning; it needs a migration. Individual powertrain **types** within those
categories are data, as body types are.

### 3.2 Coherence rules the flow must hold

| rule                       | statement                                                                                           | enforced today by                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| make → model               | Only models of the chosen make may be offered, and a saved vehicle's model must belong to its make. | The nested route; and `veh.guard_vehicle_catalog_refs()` on save.                                     |
| model → trim               | Only trims of the chosen model may be offered.                                                      | The nested route; and the same guard on save.                                                         |
| model → year               | A year outside the model's production range should not be offered without a warning.                | **Nothing.** The range columns are not published. `VCAT-02`.                                          |
| trim → year                | A trim that did not exist in the chosen year should not be offered.                                 | **Nothing.** Trims carry no year. `VCAT-05`.                                                          |
| powertrain type → category | The chosen powertrain type's category must equal the vehicle's powertrain category.                 | The database rejects a mismatch; the screen cannot see it coming. `VCAT-01`.                          |
| generation → model, year   | A generation belongs to a model and spans a year range.                                             | **Nothing exists.** `VCAT-03`.                                                                        |
| tenant override            | Where a tenant addition and a platform row share a code, the tenant row wins.                       | Stated in the migration header as intended resolution; `scope` is published so a screen can apply it. |

Three of the seven rules can be held today. Make → model and model → trim are in
good order: the nested routes offer only coherent options and the database agrees
on save. Tenant override is applicable because `scope` is published on every
catalogue row, so a screen can prefer a tenant's own entry without asking the
Backend for anything new.

The remaining four are not, and they fail in three quite different ways.
Conflating them would produce the wrong remedy for each.

| state                                                           | which rules                                   | what an operator experiences                                                                                                                                               |
| --------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The database enforces the rule; the screen cannot anticipate it | **One** rule — powertrain type → category     | The save is rejected after the operator has finished typing, because `veh.guard_vehicle_catalog_refs()` compares a category the read does not publish.                     |
| Nothing enforces the rule anywhere                              | **Two** rules — model → year, and trim → year | An incoherent choice is accepted in silence. A 2024 model year recorded against a model discontinued in 2009 is saved without complaint, because nothing compares the two. |
| The rule has nothing to attach to                               | **One** rule — generation → model, year       | Nothing at all. There is no generation field to fill in, so the step of the flow simply cannot be offered.                                                                 |

The first row is a visible annoyance. The second is the one that quietly damages
a vehicle history, because nobody finds out. The third is an absent capability,
and §3.7 forbids presenting it as a disabled control.

### 3.3 Speed and searchability

The requirement is a fast, searchable selector at every step. Two facts constrain
how that can be met.

- **There is no server-side search on any catalogue read.** The query schema on
  all five operations accepts `cursor` and `limit` and nothing else. Filtering
  happens after the client has assembled the list.
- **The client assembles the list by walking pages**, bounded at twenty pages of
  one hundred (§2.6). A catalogue larger than that bound is reported as truncated
  rather than silently trimmed.

A planned flow therefore has two honest options, and the choice is a real one:

| option                                                      | what it needs                                                                               | consequence                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Keep client-side filtering over a fully walked list         | Nothing new, until a tenant catalogue exceeds the walk bound                                | Simple; degrades to "truncated" on a large catalogue, which a global make list will reach. |
| Add a server-side name-prefix filter to the catalogue reads | A Backend change to the query schema and the repository, owned by the Vehicle Backend phase | Scales; is new API surface and must be scoped as such. `VCAT-13`.                          |

**No page-size, list-length or response-time target is established.** Establishing
one requires a decision on how large the platform catalogue will be, which is
downstream of §5 and §6.2.

### 3.4 Localised labels

Arabic and English are both first-class in this product. The catalogue tables
carry one `name` column each, so today a make has exactly one label in exactly
one language, whichever language the row was created in.

A planned flow needs a label per locale, and it must degrade gracefully: where a
source publishes only one language, the operator sees that one rather than a
blank. The platform has a localisation store (`shared.localization_keys`,
`shared.localized_texts`) but it is a **platform** catalogue with no tenant
column, is described as runtime SELECT-only, and has no link to `veh.*` and no
route. A tenant's own make additions could not be localised through it as it
stands. Recorded as `VCAT-10`.

### 3.5 Provenance and freshness, on screen

Every catalogue-derived value an operator sees must be able to answer two
questions: **where did this come from**, and **when was it last confirmed**.

| shown against               | planned content                                                  | exists today?                                                         |
| --------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| A make, model, trim or type | The source it came from, in words a workshop manager understands | No — `VCAT-07`                                                        |
| The same                    | The date it was last synchronised                                | No — `VCAT-07`                                                        |
| A tenant's own addition     | That it is this workshop's own entry, and its approval state     | Partly. `scope` is published; there is no approval state — `VCAT-06`. |
| A manually entered vehicle  | That the details were typed, not selected                        | No contract                                                           |

`scope` is the one provenance signal that exists today, and it distinguishes only
"platform" from "this tenant". It cannot say which platform source a platform row
came from, because platform rows currently have no source.

### 3.6 Manual entry and the rare-vehicle path

A catalogue that cannot describe the vehicle on the ramp must not stop the job.
The flow must therefore support, at every step:

| situation                                                                | planned behaviour                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| The make is not listed                                                   | The operator may type a make name and continue. The vehicle is saved with the catalogue reference left unset. |
| The model or trim is not listed                                          | The same. The schema already permits it: all five catalogue references on `veh.vehicles` are nullable.        |
| An import, a grey import, or a vehicle older than any catalogue coverage | The same path, with the typed values recorded against the vehicle rather than against the catalogue.          |
| The operator believes the catalogue should carry this                    | The operator may **propose** an addition, which goes to review (§5.7) rather than into the live catalogue.    |

Two constraints on the manual path, both from the schema:

1. A typed make or model has **nowhere to live on `veh.vehicles` today**. The
   writable field list is fixed and contains no free-text make, model or trim
   field — only the five catalogue uuids, `modelYear`, `powertrainCategory`,
   `color` and `displayNumber`. A manual-entry fallback that preserves what the
   operator typed needs either new columns or a proposal record. Recorded as
   `VCAT-11`.
2. A proposal must never be written straight into `veh.makes` or `veh.models`.
   Row-level security would permit it — a tenant may insert its own extensions —
   but there is no route, no permission code, no approval state and no audit
   class for it, so an unreviewed proposal would become an indistinguishable
   catalogue entry the moment it was saved. Recorded as `VCAT-06`.

### 3.7 Prohibitions

These are binding on any implementation of this flow.

| prohibited                                                            | why                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Showing a UUID to an operator                                         | Catalogue rows publish `id`, `scope`, `code`, `name` and `status`. The screen carries `id` internally and displays `name`; `code` is a machine key and reads as jargon.                                |
| Scraping arbitrary websites for vehicle data                          | It is not a licensed source, it has no provenance, and it cannot be defended commercially or legally.                                                                                                  |
| The browser calling a third-party data service directly               | It would put a credential in the browser, make the tenant's traffic visible to the provider, bypass permission and scope checks, and make provider availability a property of each operator's network. |
| Copying a manufacturer logo or a vehicle photograph without a licence | Trade marks and photographs are owned by somebody. §6.1.                                                                                                                                               |
| Presenting a partial list as if it were complete                      | Already the standing rule in the Web adapter, which reports `truncated` rather than trimming silently.                                                                                                 |
| A disabled control where a capability does not exist                  | A disabled button says "you lack permission". An absent capability must be an absent affordance with a sentence explaining what is pending — the rule P1-27 applies to `P1-OD-017`.                    |

---

## 4. `VehicleCatalogProvider` — planned server-side abstraction

**This does not exist.** No file, class, interface or configuration key of this
name is present in the repository.

### 4.1 Position in the system

The provider is a **server-side** interface inside the API application. It is the
only place in the platform that knows a third-party vehicle-data source exists.

```
operator's browser
      │  (only ever talks to the platform's own API)
      ▼
API operation  ──►  application service  ──►  local catalogue tables (veh.*)
                          │
                          └──►  VehicleCatalogProvider  ──►  adapter  ──►  external source
                                    (used by the synchronisation job,
                                     never on the operator's request path)
```

Two rules follow from that placement, and they are the point of the abstraction:

1. **The browser never calls the provider.** Operator screens read the platform's
   own catalogue operations, which read the platform's own tables.
2. **Operator screens never depend on provider availability.** A provider outage
   changes how fresh the catalogue is; it cannot change whether a vehicle can be
   booked in.

### 4.2 Capabilities

Every capability below is planned. None exists.

| capability                | input                            | returns                                                                 | nearest thing that exists today                                                           |
| ------------------------- | -------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `listMakes`               | none                             | Candidate makes with source identity and display names                  | `veh.catalogue-make-list` reads the **local** table                                       |
| `listModelYears`          | make                             | The years the source covers for that make                               | Nothing                                                                                   |
| `listModels`              | make, year                       | Candidate models for that make in that year                             | `veh.catalogue-model-list` — local, and not year-aware                                    |
| `listGenerations`         | model                            | Candidate generations with their year spans                             | Nothing at all                                                                            |
| `listTrims`               | model, year                      | Candidate trims for that model in that year                             | `veh.catalogue-trim-list` — local, and not year-aware                                     |
| `getVehicleSpecification` | a resolved model/generation/trim | Engine or motor specification, where the licence permits publishing it  | Nothing. `veh.engine_history` is per-vehicle and has no route                             |
| `decodeVin`               | a VIN                            | The source's interpretation of the VIN, as a **proposal**, never a fact | Nothing. `veh.vin_verifications` supports `check_kind = 'external'` and no code writes it |
| `getBodyTypes`            | none                             | The source's body-type vocabulary                                       | `veh.catalogue-body-type-list` — local                                                    |
| `getPowertrainTypes`      | none                             | The source's powertrain vocabulary, mapped to the five fixed categories | `veh.catalogue-powertrain-type-list` — local, category unpublished                        |
| `getLicensedBrandAsset`   | make                             | A brand asset **only where a licence covers it**, else nothing          | Nothing, and no asset column exists                                                       |
| `getLicensedVehicleImage` | a resolved model/generation/trim | A representative image **only where a licence covers it**, else nothing | Nothing, and no image column exists                                                       |
| `getSourceProvenance`     | none                             | Source identity, version, market and the time the source was last read  | Nothing                                                                                   |

### 4.3 Rules the interface must obey

| rule                                                                                 | reason                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every returned item carries source identity, source version and source market        | Without them a conflict report cannot say which side is which, and a synchronised row cannot be explained.                                                                                                                                                                                                                                                                          |
| Numeric measurements are decimal strings, never floating point                       | `numeric` and `bigint` values arrive as strings and stay strings across the whole platform. `power_kw` and `usable_capacity_kwh` are both `numeric(7,2)`.                                                                                                                                                                                                                           |
| Money, if a provider ever returns any, is a decimal string plus an ISO currency code | `shared.currencies` (ISO 4217, `P1-03-DB-013`) exists, but it is a reference list, **not a default**. Its migration records that no jurisdiction policy is encoded and no application currency exists — a company states its own `base_currency_code`. So an amount arriving without a currency code cannot be resolved from a platform default and must be refused, never assumed. |
| Lists are keyset-paginated as `{ items, nextCursor, hasMore }`                       | The platform has one pagination shape and no `total`.                                                                                                                                                                                                                                                                                                                               |
| `decodeVin` returns a proposal, never a decision                                     | A decoded VIN is a claim by a third party. Accepting it is a recorded human act — see `veh.vin_verifications`, whose `check_kind` already anticipates `external`, and whose `overridden` result requires a non-blank reason.                                                                                                                                                        |
| Missing data is absent, not blank or zero                                            | "Not supplied by this source" and "zero" are different, and reporting cannot recover the difference later.                                                                                                                                                                                                                                                                          |
| Licensed assets are absent unless a licence covers them                              | The provider must not return an asset it cannot prove the right to use. §6.1.                                                                                                                                                                                                                                                                                                       |
| The provider never writes to `veh.*`                                                 | Writing is the synchronisation pipeline's job, through staging and approval (§5). A provider that writes directly bypasses every control in §5.                                                                                                                                                                                                                                     |

### 4.4 No provider configured

The default state of the platform is **no provider**. That is not an error state.

| capability call with no provider | result                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| Any of the twelve                | Reports "no source configured". No exception, no empty list masquerading as an answer. |
| The synchronisation job          | Does not run, and says why.                                                            |
| Operator screens                 | Unaffected. They read the local catalogue, which is where they read from anyway.       |

A provider that supports only some capabilities is normal — one source may list
makes and models and decode nothing. The interface must let a provider declare
which capabilities it supports, and a caller must not infer support from a
successful call to a different capability.

---

## 5. Synchronisation architecture — planned

**None of this exists.** There is no adapter, no job, no staging table, no
conflict report, no approval workflow and no catalogue audit trail.

### 5.1 The pipeline

| stage | name      | what happens                                                                                             | what it must never do                                               |
| ----- | --------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1     | Fetch     | The adapter reads from the configured source through `VehicleCatalogProvider`                            | Touch `veh.*`                                                       |
| 2     | Stage     | Everything fetched lands in staging, unchanged, with its source identity, version, market and fetch time | Overwrite anything live                                             |
| 3     | Validate  | Staged rows are checked against the platform's rules, including the code format constraint (§2.2)        | Silently drop a row that fails                                      |
| 4     | Normalise | Names, codes, categories and years are mapped to platform vocabulary                                     | Invent a value the source did not supply                            |
| 5     | Compare   | Staged rows are matched against the live catalogue; differences are collected                            | Apply a difference                                                  |
| 6     | Report    | A conflict report is produced for a human                                                                | Resolve a conflict automatically where a human decision is required |
| 7     | Approve   | A person with the (not yet existing) catalogue permission accepts or rejects each change                 | Approve by default                                                  |
| 8     | Apply     | Approved changes are written to `veh.*` — inserts, updates, and soft retirements                         | Physically delete anything                                          |
| 9     | Audit     | Every applied change is recorded with actor, time, source and before/after                               | Be optional                                                         |

The pipeline is deliberately not a single "sync" step. A catalogue import that
writes straight into the live tables cannot be reviewed, cannot be explained
afterwards, and cannot be undone — and the schema makes the last point literal,
because `code` is immutable and there is no delete grant.

### 5.2 Provenance columns the local catalogue would have to gain

None of these exists on any of the five tables today. Each would need a migration
owned by a Vehicle Database phase.

| field                    | purpose                                             | notes                                                                                          |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| source id                | Which source this row came from                     | `platform` rows created by an administrator would carry an internal source id                  |
| source record identifier | The source's own key for the row                    | Required for stable re-matching across imports                                                 |
| source version           | The version or release of the source data           | Two rows from different versions are not a conflict; they are a sequence                       |
| source market            | The market or region the source describes           | A model sold in one market under another name is the commonest conflict class                  |
| effective from / to      | The period the source says the entry applies to     | Distinct from `first_model_year`/`last_model_year`, which describe the vehicle, not the record |
| last synchronised at     | When this row was last confirmed against its source | This is what §3.5 shows on screen                                                              |
| approval state           | Proposed, approved, rejected, retired               | Required by §5.7; `status` today is only `active`/`inactive`                                   |

Two existing constraints shape how these can be added:

- `scope`, `tenant_id`, `code`, `created_at` and `created_by` are **immutable**.
  A provenance field that could change on re-sync must not be one of them, and
  `code` in particular cannot be re-derived later.
- The partial unique indexes key on `code` within a scope. Two source records
  that normalise to the same code are a duplicate (§5.6) and must be resolved
  before apply, not discovered as a constraint violation at write time.

### 5.3 Staging and validation

Staging is a separate holding area, not a flag on the live rows. Its purpose is
that a bad import is discarded by deleting staging rows, with the live catalogue
never having been touched.

Validation must reject, with a reason recorded per row:

| check                          | rule                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| Code format                    | `^[a-z][a-z0-9_]{1,62}$` after normalisation (§2.2, §5.4)                                     |
| Name present                   | Non-blank; the `ck_*_name_not_blank` constraints require it                                   |
| Status vocabulary              | `active` or `inactive` only                                                                   |
| Powertrain category vocabulary | `ice`, `ev`, `hybrid`, `phev`, `other` only — a sixth value is a migration, not data          |
| Year bounds                    | 1900–2100, and `last_model_year >= first_model_year`                                          |
| Hierarchy                      | Every model names a make present in the same import or already live; every trim names a model |
| Scope coherence                | A platform row carries no tenant; a tenant row carries one                                    |

A row that fails validation is reported, never silently dropped. A source that
produces failures in bulk is a signal about the source, and swallowing it hides
the signal.

### 5.4 Normalisation

Normalisation turns a source's vocabulary into the platform's. Its most
consequential job is producing a **code** that satisfies §2.2 from a name that
usually does not.

| input from a source | why it fails the constraint           | normalised code                           | `name` retains  |
| ------------------- | ------------------------------------- | ----------------------------------------- | --------------- |
| `Mercedes-Benz`     | upper case, hyphen                    | `mercedes_benz`                           | `Mercedes-Benz` |
| `Citroën`           | upper case, non-Latin character       | `citroen`                                 | `Citroën`       |
| `MINI`              | upper case                            | `mini`                                    | `MINI`          |
| `3 Series`          | starts with a digit, contains a space | needs a prefix rule — **not established** | `3 Series`      |
| `X3 M40i`           | upper case, space                     | `x3_m40i`                                 | `X3 M40i`       |

The `3 Series` row is not an oversight. There is no correct answer available from
the repository: a prefix convention (`m3_series`, `bmw_3_series`, `s3_series`) is
a naming decision nobody has taken, and inventing one here would put a fabricated
convention into a canonical document. It must be decided before any import runs,
because **the code cannot be changed afterwards**.

Normalisation must also be:

- **Deterministic.** The same input produces the same code on every run, or the
  second import creates duplicates of the first import's rows.
- **Recorded.** The rule version that produced a code is provenance. When the
  rule changes, every previously produced code stays as it is, and the change is
  a migration of data by retirement and re-creation, not an edit.
- **Reversible in reporting, not in data.** The `name` keeps the human form. The
  code is not expected to be turned back into the name.

### 5.5 Conflict report

A conflict is any difference between a staged row and its live counterpart, or
between two sources describing the same thing. The report is for a person.

| conflict class                                  | example                                                     | default disposition                                                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Name changed at source                          | A model renamed between source versions                     | Human decision                                                                                                                   |
| Hierarchy changed at source                     | A model moved to a different make                           | Human decision. `make_id` on a model is immutable, so this is a retire-and-recreate, not an update                               |
| Two source records normalise to one code        | Two market variants of one model                            | Human decision — see §5.6                                                                                                        |
| A live row no longer appears at source          | A discontinued model                                        | Soft retirement (§5.8), never deletion                                                                                           |
| A tenant addition now duplicates a platform row | A workshop added `toyota` before the platform catalogue did | Human decision; the migration header records tenant-first resolution as intended, so the tenant row is not automatically removed |
| A source value fails a platform constraint      | A powertrain category outside the five                      | Rejected at validation, reported, never coerced                                                                                  |

The report must state, for every entry: the live value, the staged value, the
source and version each came from, and what applying the change would do to
vehicles that already reference the live row. That last column is the one that
makes the report usable by a workshop manager rather than only by an engineer.

### 5.6 Duplicate detection

Duplicate detection here is about **catalogue entries**, and must not be confused
with the vehicle-level duplicate machinery that already exists:
`veh.duplicate_candidates` and `veh.vehicle_merges` are about two records of the
same physical vehicle, are reachable through `veh.vehicle-duplicate-list`,
`veh.vehicle-duplicate-scan` and `veh.vehicle-duplicate-review`, and are gated on
`veh.vehicle.duplicate.review` and `veh.vehicle.merge`. They have nothing to do
with two catalogue rows for one model.

Catalogue duplicate detection is required at three points:

| point                                              | question                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| Within one import                                  | Do two staged rows normalise to the same code in the same namespace? |
| Between import and live catalogue                  | Does a staged row already exist live under a different code?         |
| Between a tenant addition and a later platform row | Has the platform caught up with something a tenant added itself?     |

**`P1-OD-017` binds here.** Duplicate and merge rules are an open Owner decision.
Until it is taken, this architecture may specify _detection and reporting_ but
must not specify an automatic merge of two catalogue entries, and must not ship a
merge affordance — the same disposition P1-27 applies to customer and vehicle
duplicates.

### 5.7 Approval workflow

Every route into the live catalogue is a reviewed route. There are two:

| route in                                  | who proposes                         | who approves                                         |
| ----------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| A synchronisation run                     | The pipeline, from a source          | A person holding the catalogue-management permission |
| A manual proposal from an operator (§3.6) | Any operator who may create vehicles | The same person                                      |

Neither is possible today:

- There is **no catalogue-management permission code**. The seed carries
  `veh.vehicle.read`, `veh.vehicle.manage`, `veh.vehicle.merge`,
  `veh.vehicle.duplicate.review`, `veh.vehicle.relationship.manage`,
  `veh.vehicle.odometer.record` and `veh.vehicle.status.manage`. None of them
  concerns the catalogue, and the platform has no wildcard and no `*.admin` code.
- There is **no route** that writes any of the five tables.
- There is **no approval state**. `status` is `active` or `inactive`, which is a
  usability flag, not a review state.

A proposed entry must be visibly distinct from an approved one wherever it
appears, and must not silently become selectable for every operator in the tenant
before it has been reviewed.

### 5.8 Soft retirement, never destructive deletion

The schema already forces this and the architecture must not fight it.

| fact                                                         | consequence                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| No `DELETE` grant on any of the five tables                  | The application cannot delete a catalogue row at all.                  |
| `deleted_at` / `deleted_by` exist on all five                | Retirement is setting a timestamp.                                     |
| All catalogue reads carry `deleted_at IS NULL`               | A retired row disappears from every picker immediately.                |
| The unique indexes are partial on `deleted_at IS NULL`       | A retired code can be reissued later, deliberately.                    |
| Vehicle foreign keys are `ON DELETE RESTRICT`                | Even if a delete grant existed, a referenced row could not be removed. |
| `code`, `scope`, `tenant_id` and the parent id are immutable | A wrong row is retired and replaced, never rewritten.                  |

So a discontinued model stops being offered, and every vehicle already recorded
against it keeps a valid reference and a readable history. Retirement must not
change what an existing vehicle displays.

### 5.9 Audit

Catalogue reads are registered `auditClass: 'none'` — reading a list of makes is
not an auditable event, and recording it would bury real events in noise.

Catalogue **writes** are the opposite. Every applied change must record the
actor, the time, the source and version it came from, the before and after
values, and the approval that authorised it. There is no such record today
because there is no write path. Any new catalogue write operation must declare an
audit class deliberately rather than inheriting `none` from the reads it sits
beside.

### 5.10 Caching

Two facts constrain any caching design, and both are current published contract:

1. All five catalogue operations are registered `cacheCategory: 'never'`.
2. The Web adapter caches nothing between requests, on purpose, and says why: a
   module-level cache would become a second source of truth for what a tenant's
   catalogue contains, and would go stale exactly when a tenant added a make.

Therefore **caching is not merely unbuilt; it is currently ruled out by the
operation registration**, and introducing it is a Backend change to the registry
rather than a Frontend optimisation. Recorded as `VCAT-13`.

A planned caching design has to answer three questions that nobody has answered:
how long a catalogue response may be considered current (**not established**),
how a tenant's own addition invalidates it immediately (a tenant that adds a make
and cannot see it has a bug, not a cache), and where the cache lives such that it
cannot serve one tenant's additions to another.

### 5.11 Retry, rate limiting and provider outage

All of this concerns the synchronisation job only. None of it can reach an
operator's request path, because the operator's request path never touches a
provider.

| condition                            | required behaviour                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A transient failure                  | Retry with increasing delay, bounded. **The bound and the delays are not established** — they depend on a provider that has not been chosen. |
| A rate limit signalled by the source | Honour it. Do not retry faster than the source permits, and do not treat a rate limit as a failure.                                          |
| A permanent failure                  | Stop, record, and leave the live catalogue untouched.                                                                                        |
| A partial run                        | Apply nothing. A half-applied hierarchy can leave a model whose make was never imported.                                                     |
| A provider outage                    | The job does not run. The catalogue is unchanged and remains fully usable.                                                                   |
| A run that produces conflicts        | Nothing is applied until they are reviewed.                                                                                                  |

### 5.12 What "keeps working during an outage" means precisely

This is the claim that most needs to be exact, because it is the one a workshop
owner will rely on — and an imprecise version of it would be read as a promise
that everything below is built and working.

The column answers one narrow question: **would a provider outage change this?**
It is not a statement that the journey named in the row is delivered, and it is
not a statement that there is anything in the catalogue to select. The catalogue
is empty until it is provisioned (§2.7) and no catalogue read offers a
server-side search (§3.3); neither of those facts has anything to do with a
provider.

| behaviour                                                         | would a provider outage change it?                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Selecting a make, model or trim from the platform's own catalogue | No. Those five reads query the platform's own tables and have no provider in the path.             |
| Creating a vehicle                                                | No.                                                                                                |
| Booking in, quoting, working on a vehicle and invoicing           | No. No operation on any of those paths reads a provider.                                           |
| The catalogue becoming newer                                      | Yes. Freshness is the only thing an outage stops.                                                  |
| Telling the operator that the catalogue is stale                  | The operator cannot be told either way until the last-synchronised field exists (§5.2, `VCAT-07`). |

The architectural reason this holds is structural rather than a matter of good
behaviour: the provider is only ever called by the synchronisation job, and the
operator's request path reads `veh.makes`, `veh.models`, `veh.trims`,
`veh.body_types` and `veh.powertrain_types` and nothing else.

---

## 6. Licensing and the commercial boundary

### 6.1 Brand identity and vehicle images

The requirement is explicit that a brand logo or a representative image appears
**only where a licensed asset exists**. This architecture must therefore treat
the absence of an asset as the normal case, not the failure case.

| rule                                                                          | consequence                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| No asset is displayed without a recorded licence covering that use            | The default rendering of a make is its name, with no logo, and that is complete, not degraded. |
| An asset is never fetched by the browser from a third-party host              | Same reasoning as §3.7: credentials, tracking, and availability.                               |
| An asset's licence terms are recorded alongside the asset                     | "We have it" is not the same as "we may show it".                                              |
| No asset is copied from a manufacturer site, a marketplace or a search result | That is the scraping prohibition, applied to images.                                           |

Nothing supporting any of this exists. There is no logo, image, photo or
thumbnail column in any migration in the repository. The general document store
(`shared.documents`, `shared.document_versions`, `shared.document_links`) could
in principle hold assets — `document_links.entity_type` is a constrained
`schema.table` token with no fixed vocabulary — but four facts stand between that
and a brand asset:

| fact about the document store today                                                                                                                                                                                              | consequence for a brand asset                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Upload is authorisation-only: `shared.attachment-upload-authorize` (`POST /attachments/upload-authorizations`) issues a signed URL and records metadata.                                                                         | Nothing in this phase accepts or serves bytes.                                                                                          |
| Both published document reads — `shared.document-read` (one document's metadata) and `veh.vehicle-document-list` (the document ids reachable from **one named vehicle**) — are gated on the write code `shared.document.manage`. | A picker that showed a make's logo to a receptionist would be showing it to somebody who is not required to hold a document permission. |
| No operation lists or searches documents **by entity type**. The only list is per vehicle, and it returns ids — no names, no storage keys, no bytes.                                                                             | There is no way to ask "what asset belongs to this make", which is the question a brand asset exists to answer.                         |
| A make is not a linkable entity today. `veh.vehicle-document-list` resolves `entity_type` `veh.vehicle`; nothing links a document to `veh.makes` or `veh.models`.                                                                | The association a brand asset needs does not exist even as a link.                                                                      |

Above all of that, **`P1-OD-025` (media and file upload policy) is open**, so no
accepted type, size limit or storage assumption may be written around it.
Recorded as `VCAT-08`.

### 6.2 Paid data providers

Vehicle reference data of the depth this flow describes — makes, model years,
models, generations, trims and engine specifications, with licensed brand assets
— is a commercial product. Several vendors sell it. Coverage, market breadth,
licensing terms and price vary widely between them and cannot be established from
this repository.

**Purchasing or contracting a paid data provider is a commercial decision
reserved to the Product Owner.** This document recommends no vendor and no
purchase, and states no price, because no price is known and inventing one would
be worse than saying so.

What is recommended is an **evaluation**, and an evaluation needs criteria. The
following are the criteria this architecture actually depends on:

| criterion                          | why this architecture cares                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Market coverage                    | A source that covers only one market produces conflicts in every other (§5.5).                                              |
| Historical depth                   | The manual-entry fallback exists precisely because old vehicles are not covered. Depth changes how often that path is used. |
| Generation data                    | Step 4 of the flow has no contract and no data today. A source without generations does not enable it.                      |
| Trim-by-year granularity           | Step 5 needs trims resolved by year; the local schema has no year dimension on trims.                                       |
| VIN decoding                       | `decodeVin` is a proposal path, not a decision path — but a source without it removes an entire fallback.                   |
| Brand and image licensing          | Whether assets may be shown at all, and under what terms, is §6.1's whole question.                                         |
| Localisation                       | Whether the source publishes Arabic labels, or only English (§3.4).                                                         |
| Update cadence and versioning      | Determines what "last synchronised" can honestly mean.                                                                      |
| Rate limits and availability terms | Determines the retry and outage behaviour in §5.11, which is currently unspecifiable.                                       |
| Redistribution terms               | The platform is multi-tenant. Whether one licence may serve many tenants is a licensing question, not a technical one.      |

An evaluation would produce the numbers this document deliberately leaves as
**not established**: page sizes, refresh cadence, retry bounds, expected
catalogue size, and the cost of the whole capability.

---

## 7. Owner decisions that bind this architecture

| decision    | subject                      | state    | where it binds here                                                                                                                        |
| ----------- | ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `P1-OD-017` | Duplicate and merge rules    | **Open** | §5.6 catalogue duplicate detection may be specified; automatic merging of two catalogue entries may not, and no merge affordance may ship. |
| `P1-OD-025` | Media and file upload policy | **Open** | §6.1 licensed brand assets and vehicle images. No accepted types, no size limits and no storage assumptions may be written around it.      |

Neither is written around anywhere in this document. Where either binds, the
capability is described as pending and the decision is named.

A third item is **not** an open decision and must not be recorded as one: the
absence of a vehicle-catalogue write surface, a catalogue permission code, a
generation concept and provenance columns is a **capability gap**, not a decision
awaiting an answer. Nobody is being asked a question about it. §8 records it.

---

## 8. Integration findings

Each row is a contract this architecture requires and that was searched for in
the repository and not found. Identifiers are local to this document (`VCAT-nn`);
the P1-27 finding register currently runs to `P1-27-INT-009`, and assigning
register identifiers is the register owner's act, not this document's.

"Vehicle Database" below means the phase that owns the `veh` schema
(historically P1-07); "Vehicle Backend" means the phase that owns
`apps/api/src/modules/vehicle` (P1-17). Where no phase owns the work, the entry
says **not established** rather than guessing.

| finding   | what is missing                                                                                                                                                                                                                                                                                                                                                          | owning Backend phase                                                                                   | owning Frontend phase                                                                                                                         | required action                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VCAT-01` | `veh.powertrain_types.category` is stored and enforced by `veh.guard_vehicle_catalog_refs()` but is not published by `veh.catalogue-powertrain-type-list`, whose projection is `id`, `scope`, `code`, `name`, `status`. A screen cannot tell an electric powertrain type from a petrol one, so it cannot prevent a save the database will reject with a check violation. | Vehicle Backend (P1-17)                                                                                | P1-27 for the vehicle creation and EV screens (`FE-018`, `FE-024`)                                                                            | Project `category` on the powertrain-type read; then have the screen bind the vehicle's powertrain category to the chosen type instead of letting the two diverge.                                                                          |
| `VCAT-02` | `veh.models.first_model_year` and `veh.models.last_model_year` exist and are published by nothing, so model-to-year coherence cannot be checked or even hinted at.                                                                                                                                                                                                       | Vehicle Backend (P1-17)                                                                                | Not established — beyond P1-27 scope                                                                                                          | Project both columns on `veh.catalogue-model-list`.                                                                                                                                                                                         |
| `VCAT-03` | There is **no generation concept anywhere in the platform** — no table, no column, no operation, no permission. Step 4 of the required flow has nothing to bind to.                                                                                                                                                                                                      | Vehicle Database (new migration; phase not established) then Vehicle Backend                           | Not established                                                                                                                               | Decide whether generations are in scope at all; if so, a `veh.generations` relation with a model parent and a year span, plus a read operation, plus a nullable vehicle reference.                                                          |
| `VCAT-04` | There is no source for a model-year selector. Year is a free integer 1900–2100 on `veh.vehicles` with no per-model constraint published, so step 2 of the flow is an unconstrained text field.                                                                                                                                                                           | Vehicle Backend (P1-17) — depends on `VCAT-02`                                                         | Not established                                                                                                                               | Derive the offered years from the model's published production range once `VCAT-02` closes; keep free entry available for the rare-vehicle path.                                                                                            |
| `VCAT-05` | Trims are keyed by model only. `veh.catalogue-trim-list` takes `modelId` and no year, and `veh.trims` carries no year columns, so `listTrims(model, year)` has no backing contract.                                                                                                                                                                                      | Vehicle Database then Vehicle Backend                                                                  | Not established                                                                                                                               | Decide whether trim-by-year is in scope; it requires year columns on `veh.trims` or a generation dimension (`VCAT-03`), plus a year parameter on the read.                                                                                  |
| `VCAT-06` | There is **no write route for any of the five catalogue tables and no catalogue-management permission code**. The seven `veh.*` codes concern vehicles, never the catalogue. So a tenant cannot add a missing make through the product, a proposal cannot be reviewed, and there is no approval state (`status` is only `active`/`inactive`).                            | Vehicle Backend (P1-17) for routes and services; the IAM permission seed for the code                  | Not established                                                                                                                               | Add catalogue write operations with a new permission code, an explicit audit class, and an approval state distinct from `status`. Row-level security already permits tenant extensions, so the gap is entirely above the database.          |
| `VCAT-07` | No provenance on any catalogue row: no source id, no source record identifier, no source version, no source market, no effective dates, no last-synchronised time. §3.5 and §5.12 both depend on these, and neither can be delivered without them.                                                                                                                       | Vehicle Database (new migration; phase not established)                                                | Not established                                                                                                                               | Add the provenance columns of §5.2, keeping them out of the immutable set where a re-sync must update them.                                                                                                                                 |
| `VCAT-08` | No brand-asset or vehicle-image contract. No `logo`, `image`, `photo` or `thumbnail` column exists in any migration, there is no licence record, and there is no way to associate an asset with a make or a model.                                                                                                                                                       | Vehicle Database and Shared Services                                                                   | Not established                                                                                                                               | Blocked in part on **`P1-OD-025`**. Decide storage and licence recording before any asset surface is designed; the general document store is a candidate but its upload path is authorisation-only and its reads are gated on a write code. |
| `VCAT-09` | No engine or motor specification is reachable. The catalogue holds none, and `veh.engine_history` (`displacement_cc`, `power_kw numeric(7,2)`, `fuel_note`) is per-vehicle and has **no route at all**. Step 8 of the flow cannot show anything.                                                                                                                         | Vehicle Backend (P1-17) for a per-vehicle read; Vehicle Database for any catalogue-level specification | Not established                                                                                                                               | Decide whether specification belongs to the catalogue entry or to the vehicle. Note that `power_kw` is `numeric` and must be carried as a decimal string.                                                                                   |
| `VCAT-10` | No localised catalogue labels. Each row has one `name`. `shared.localization_keys` and `shared.localized_texts` exist, carry no tenant column, are described as runtime SELECT-only, are not linked to `veh.*`, and have no route — so they cannot localise a tenant's own additions as they stand.                                                                      | Shared Services, then Vehicle Database and Vehicle Backend                                             | Not established                                                                                                                               | Decide whether catalogue labels are localised per row or through the shared store; either way a tenant addition must be localisable.                                                                                                        |
| `VCAT-11` | No VIN decode contract, and nowhere to record a manually typed make, model or trim. `veh.vin_verifications` anticipates `check_kind = 'external'` and is read and written by no code; `VEHICLE_WRITABLE_COLUMNS` contains no free-text make, model or trim field. The manual-entry fallback therefore loses what the operator typed.                                     | Vehicle Backend (P1-17); Vehicle Database if free-text columns are chosen                              | P1-27 already delivers VIN validation as format checking plus the server's uniqueness verdict, and states the fuller workflow is out of scope | Decide between free-text columns on `veh.vehicles` and a separate proposal record; a decode workflow additionally needs a route onto `veh.vin_verifications` and an override policy.                                                        |
| `VCAT-12` | No staging area, no conflict report and no catalogue-level duplicate detection. The existing `veh.duplicate_candidates` and `veh.vehicle_merges` are about two records of the same physical vehicle and are unrelated.                                                                                                                                                   | Vehicle Database and Vehicle Backend                                                                   | Not established                                                                                                                               | Build stages 2, 5 and 6 of §5.1. **`P1-OD-017`** binds the merge half; detection and reporting may proceed, automatic merging may not.                                                                                                      |
| `VCAT-13` | Caching is ruled out by the published contract: all five catalogue operations are registered `cacheCategory: 'never'`, and there is no server-side name search on any of them — the query schema accepts `cursor` and `limit` only. So both the freshness strategy and the "fast searchable selector" requirement need Backend change, not Frontend tuning.              | Vehicle Backend (P1-17)                                                                                | Not established                                                                                                                               | Decide a cache category and an invalidation rule that a tenant's own addition defeats immediately; separately, decide whether a server-side name filter is added to the five reads.                                                         |

None of the thirteen is a blocker for Phase 1-27, which is a Frontend phase and
consumes only the contracts that exist. Each is a prerequisite for the
architecture this document describes.

---

## 9. What must be true before any of this is built

In order. Each depends on the ones above it.

| #   | prerequisite                                                                | who decides                         | state today           |
| --- | --------------------------------------------------------------------------- | ----------------------------------- | --------------------- |
| 1   | A decision that a vehicle catalogue capability is funded and in scope       | Product Owner                       | Not taken             |
| 2   | An evaluation of candidate data sources against the criteria in §6.2        | Product Owner, with technical input | Not started           |
| 3   | `P1-OD-025` (media and upload policy) resolved, for brand assets and images | Product Owner                       | **Open**              |
| 4   | `P1-OD-017` (duplicate and merge rules) resolved, for catalogue merge       | Product Owner                       | **Open**              |
| 5   | A code normalisation convention, including the leading-digit case (§5.4)    | Technical owner                     | Not established       |
| 6   | An approved body-type and powertrain-type vocabulary, as data               | Product Owner and technical owner   | Not recorded anywhere |
| 7   | A phase that owns new `veh` migrations                                      | Phase planning                      | Not established       |
| 8   | The findings in §8 assigned to phases and scheduled                         | Phase planning                      | Not done              |

Steps 1 to 6 are decisions. Steps 7 and 8 are planning. No implementation work
should begin before step 5, because `code` is immutable and a catalogue imported
under a convention that is later changed cannot be corrected — only retired and
rebuilt.

---

## 10. Terms used

| term              | meaning in this document                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Catalogue         | The five reference lists: makes, models, trims, body types, powertrain types.                                                              |
| Platform row      | A shared reference entry visible to every workshop group on the platform.                                                                  |
| Tenant row        | A workshop group's own addition, visible only to that group.                                                                               |
| Scope             | Whether a row is a platform row or a tenant row. Published on every catalogue read.                                                        |
| Code              | The machine key for a catalogue entry. Never shown to an operator. Format-constrained and immutable.                                       |
| Name              | The text an operator reads.                                                                                                                |
| Provider          | A third-party source of vehicle reference data, reached only by the server, only by the synchronisation job.                               |
| Adapter           | The piece of code that speaks one particular provider's language.                                                                          |
| Staging           | A holding area where imported data is checked before anything live is changed.                                                             |
| Soft retirement   | Marking an entry as withdrawn so it stops being offered, while every vehicle already recorded against it keeps a valid reference.          |
| Provenance        | Where a piece of data came from, which version of that source, which market, and when it was last confirmed.                               |
| Keyset pagination | The platform's one pagination shape: a page of items, a cursor for the next page, and a flag saying whether more exist. There is no total. |
