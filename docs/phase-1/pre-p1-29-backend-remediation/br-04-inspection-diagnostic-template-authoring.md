# BR-04 — Inspection and Diagnostic Template Authoring

|                      |                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Closes               | `BE-4` · finding `INS-09` (**CRITICAL**) · Owner requirements 9, 10, 11 · closure blocker `B4` |
| Depends on           | `BR-08a` (soft-strong) — this slice mints the code the parity gate exists to police            |
| Database change      | **none to the template tables**; one seed addition                                             |
| New permission codes | **one** — `dia.catalogue.manage`, risk `high`                                                  |
| Complexity           | **M** — the largest slice in the plan                                                          |

---

## 1. Problem statement

**No diagnostic report can be created at all.** `POST /jobs/{jobId}/inspections` takes
`{templateVersionId}` and nothing else. `dia.inspection_templates`, `dia.template_versions` and
`dia.template_items` hold **zero rows**, and so does `dia.diagnostic_types`, which a template
requires NOT NULL. No `INSERT` or `UPDATE` against any of the three template tables exists anywhere
in `apps/api/src`.

Diagnostics is not thin, or partial, or unpolished. It is **unreachable**.

This blocks P1-29 slice E in its entirety, Owner requirements 9, 10 and 11, and closure blocker
`B4` — _"a job requiring diagnostics has no completed diagnostic report"_ — which today can never be
satisfied because its subject cannot be produced.

`execution-decision.md` §1.1 settles the scope question: **diagnostics stays in P1-29 final scope,
`BE-4` is funded as a prerequisite of this phase, and P1-29 may not be declared complete without
the diagnostics experience.** This slice is that prerequisite.

## 2. Existing repository evidence

All in `supabase/migrations/20260722101000_dia_templates_versions_items.sql` unless noted.

### The database layer is complete and guarded

| artefact                   | evidence                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dia.inspection_templates` | `:28` — `id, tenant_id NOT NULL, code, name, diagnostic_type_id NOT NULL, status, …`                                                                                                             |
| template code format       | `ck_inspection_templates_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$')` — `:47`                                                                                                            |
| **template status**        | `ck_inspection_templates_status CHECK (status IN ('active','inactive'))` — `:49`                                                                                                                 |
| `dia.template_versions`    | `:73` — `template_id, version_number, status, published_at, …`                                                                                                                                   |
| version number             | `ck_template_versions_number CHECK (version_number > 0)` — `:92`                                                                                                                                 |
| **version status**         | `ck_template_versions_status CHECK (status IN ('draft','published','retired'))` — `:93`                                                                                                          |
| published-at coherence     | `ck_template_versions_published_at` — `:94`                                                                                                                                                      |
| **the publish guard**      | `dia.guard_template_version_publish()` — `:104-132`, trigger `tg_template_versions_publish BEFORE UPDATE OF status` at `:131`. Enforces `draft → published → retired` and stamps `published_at`. |
| `dia.template_items`       | `:152` — `template_version_id, item_code, prompt, response_type, unit?, is_mandatory, validation_rule jsonb?, sequence`                                                                          |
| item code format           | `ck_template_items_code_format` — `:175`                                                                                                                                                         |
| response vocabulary        | `ck_template_items_response_type CHECK (response_type IN ('numeric','text','boolean','select'))` — `:177`                                                                                        |
| unit coherence             | `ck_template_items_unit CHECK (response_type <> 'numeric' OR unit IS NOT NULL)` — `:178`                                                                                                         |
| sequence                   | `ck_template_items_sequence CHECK (sequence > 0)` — `:180`                                                                                                                                       |
| **the freeze guard**       | `dia.guard_template_item_frozen()` — `:188-207`, trigger `tg_template_items_frozen` **`BEFORE INSERT OR UPDATE`** at `:212`                                                                      |
| grants                     | `GRANT SELECT, INSERT, UPDATE … TO app_runtime` on all three — `:67-68`, `:146-147`, `:227-228`                                                                                                  |

**The write path is already permitted at the row layer.** Nothing in this slice touches SQL.

### Two lifecycles, not one

See [C-05](repository-corrections.md#c-05--template-activation-is-modelled-at-two-levels-meaning-two-different-things).
`inspection_templates.status` (`active`/`inactive`) and `template_versions.status`
(`draft`/`published`/`retired`) are orthogonal and mean different things. The API must expose both
and must not conflate them.

### The freeze is stronger than the preparation stated

`tg_template_items_frozen` is `BEFORE INSERT OR UPDATE`, so an item cannot be **appended** to a
published version either — the invariant is on the version's item _set_. See
[C-06](repository-corrections.md#c-06--the-item-freeze-covers-insert-so-a-published-versions-item-set-is-closed).
"Add one more check to the published inspection" is therefore not a supported operation and must
not appear in the surface.

### The read path already ships

The tables are **not** unused. `dia.template_versions JOIN dia.inspection_templates` is read at
`diagnostics-repository.ts:264-265` from `diagnostic-report-service.ts:239`, behind
`dia.diagnostic-create`; `dia.template_items` is read at repository lines 298, 583, 647, 686, 753
and 1255. **Only the authoring surface is absent.**

### The permission vocabulary

The seed carries exactly four `dia` codes — `record` (`:233`), `complete` (`:234`), `review`
(`:237`), `read` (`:238`). Seven spellings were searched for a template code
(`dia.catalogue.`, `dia.catalog.`, `dia.template.`, `dia.templates.`,
`dia.inspection_template.`, `dia.diagnostic_type.`, `dia.diagnostic.template`) and **none exists.**

### Platform-seeding a template is not representable

`dia.inspection_templates.tenant_id` is `NOT NULL` with **no `scope` column** — unlike
`dia.diagnostic_types`, which **is** dual-scope. Every template belongs to exactly one tenant by
design. So even setting aside the standing no-fake-data policy, **there is no row to insert.**

`dia.diagnostic_types` is the exception and the first link in the chain:
`inspection_templates.diagnostic_type_id` is NOT NULL (`:33`), the table is dual-scope, and a
platform _type vocabulary_ is a legitimate seed.

## 3. Gap

| gap                                                                         | class                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------- |
| no operation creates, reads, versions, publishes or retires a template      | **API**                                                  |
| no permission code governs template administration                          | **Authorization**                                        |
| `dia.diagnostic_types` is unseeded, and a template cannot exist without one | **DB (seed)**                                            |
| a technician has no way to choose which template to inspect against         | **Contract**                                             |
| closure blocker `B4` has an unsatisfiable subject                           | **Domain model** — closed as a consequence, not directly |
| no test proves cross-tenant template isolation, because no template exists  | **Test**                                                 |

**Not a gap:** the three tables, both guards, the status vocabularies, the response-type
vocabulary, the grants, the RLS policies, or the read path. This slice writes no migration against
the `dia` template tables.

## 4. Proposed architecture

**A template service over the three existing tables, plus one platform seed, plus one permission
code. No schema design, no new guard.**

Four positions, each forced:

### 4.1 Publication is a status transition, not a separate resource

The guard is `BEFORE UPDATE OF status` and enforces `draft → published → retired`. So publish and
retire are the same operation with different targets — a `POST …/status` carrying the target
status, matching how every other lifecycle in this platform is driven
(`wo.work-order-transition`, `dia.diagnostic-transition`).

**Do not model publish as `POST …/publication` and retire as `DELETE`.** Two verbs for one guarded
transition invites the two to diverge, and `DELETE` is granted to nobody in this domain —
`app_runtime` holds SELECT + INSERT + UPDATE only.

### 4.2 The version status graph is hard-coded by the UI, unlike the work-order graph

`draft → published → retired` lives in plpgsql and a CHECK constraint, not in a catalogue table. It
is **not tenant-overridable.** This is the same trap `execution-decision.md` §5 binding 4 names:
the work-order and job graphs must never be hard-coded, and the diagnostic lifecycles must be.
Getting either backwards is a defect. This slice's contract states the graph explicitly so the
mirror can encode it.

### 4.3 Items are authored only while the version is `draft`

Because the freeze covers INSERT, item authoring is a **draft-only** capability. The supported
shape of "change a published inspection" is:

1. create a new version of the template (it starts `draft`);
2. author its items;
3. publish it;
4. retire the old version.

Reports already citing the old version remain valid and pinned — which is the whole point of
version pinning, and the reason `dia.diagnostic_reports` cites a `template_version_id` rather than
a `template_id`.

**Offer a version-copy on create.** Re-typing forty items to change one is the failure mode that
makes people avoid versioning; `POST …/versions` with an optional `copyFromVersionId` is a small
addition that makes the correct path the easy one.

### 4.4 `dia.diagnostic_types` is seeded at platform scope — and that is not fake business data

The distinction matters and must be argued, not assumed. The standing no-fake-data policy forbids
shipping invented business content. A _type vocabulary_ — the kinds of inspection that exist — is
platform reference data of the same class as `wo.work_order_states`, `shared.retention_classes` and
the seeded permission catalogue, all of which ship. The table is dual-scope precisely so that
platform rows are representable and a tenant may add its own.

**What may not be seeded is a template.** That is the business content, it is structurally
impossible to seed, and this slice must not attempt it by any route.

The seed content is an **Owner decision, not this slice's**. The slice ships the mechanism and
records the question.

## 5. Database impact

**No migration against `dia.inspection_templates`, `dia.template_versions` or
`dia.template_items`.** No new column, index, function, trigger, policy or grant.

**Two seed changes:**

| change                                       | file                                           | effect                                             |
| -------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| the new permission code                      | `supabase/seeds/04_iam_permission_catalog.sql` | `permissionCount` 112 → 113 (→ 114 with `BR-03`'s) |
| a platform `dia.diagnostic_types` vocabulary | a `dia` seed file                              | rows at `scope = 'platform'`, `tenant_id NULL`     |

**Rollback.** Remove the routes and the service; the permission code and the type vocabulary stay,
because a code the gate has already policed and a reference vocabulary a tenant may already have
built on are not safely removable. **Published versions remain, frozen, as the guard intends** —
that is the correct behaviour, not a rollback failure.

**The `permissionCount` baseline cannot be measured locally.** The shared container reports 115
because three codes belong to the unmerged B1 branch (`INS-42`). Take the figure from a CI run.

## 6. API impact

Eight operations.

| #   | id                                      | method  | route                                         | permission              |
| --- | --------------------------------------- | ------- | --------------------------------------------- | ----------------------- |
| 1   | `dia.template-create`                   | `POST`  | `/inspection-templates`                       | `dia.catalogue.manage`  |
| 2   | `dia.template-list`                     | `GET`   | `/inspection-templates`                       | `dia.diagnostic.read`   |
| 3   | `dia.template-detail`                   | `GET`   | `/inspection-templates/{templateId}`          | `dia.diagnostic.read`   |
| 4   | `dia.template-update`                   | `PATCH` | `/inspection-templates/{templateId}`          | `dia.catalogue.manage`  |
| 5   | `dia.template-version-create`           | `POST`  | `/inspection-templates/{templateId}/versions` | `dia.catalogue.manage`  |
| 6   | `dia.template-version-status-set`       | `POST`  | `/template-versions/{versionId}/status`       | `dia.catalogue.manage`  |
| 7   | `dia.template-item-create`              | `POST`  | `/template-versions/{versionId}/items`        | `dia.catalogue.manage`  |
| 8   | `dia.template-version-list-publishable` | `GET`   | `/jobs/{jobId}/inspection-templates`          | `dia.diagnostic.record` |

All are `scope: 'tenant'` except 8, which is `branch` (it is reached through a job).

**Why the templates are tenant-scoped and not branch-scoped.** The three tables carry **no
`company_id` or `branch_id` column**, so their nine RLS policies are pure
`tenant_id = iam.current_tenant_id()`. A branch-scoped declaration would be a claim the row layer
cannot support. `rec.damage_map_templates` can carry a scoped predicate only because it has nullable
company/branch columns; these do not.

### 1 · `dia.template-create`

body `{code: string(^[a-z][a-z0-9_]{1,62}$), name: string(1..200), diagnosticTypeId: uuid}`
`.strict()` · `201` · `InspectionTemplateView` · **idempotent**.

Creating a template does **not** create a version. A template with no version is a legitimate
intermediate state and the list must render it.

### 2 · `dia.template-list`

query `{status?: 'active'|'inactive', diagnosticTypeId?: uuid, cursor?, limit?}` `.strict()` ·
`200` · `Page<InspectionTemplateView>` — keyset-paged; a tenant's template library is unbounded.

### 3 · `dia.template-detail`

`200` · `InspectionTemplateDetail = {template, versions: TemplateVersionView[]}`.

Versions are **not** paged — a template has few — and each carries `itemCount` so the list can show
whether a draft is empty without a second read.

### 4 · `dia.template-update`

body `{name?: string, status?: 'active'|'inactive'}` `.strict()` · `200` · **version-guarded**.

`code` is absent from the body. A template code is an identifier tenants build on; changing it
after versions exist would silently re-label published history.

### 5 · `dia.template-version-create`

body `{copyFromVersionId?: uuid}` `.strict()` · `201` · `TemplateVersionView` · **idempotent**.

`version_number` is **server-assigned** (`max + 1`), never client-supplied — `ck_template_versions_number`
guards the value but not the sequence, and a client-chosen number is a collision waiting to happen.
The new version is always `draft`. `copyFromVersionId` copies the item set; it must reference a
version of the **same template** or 422.

### 6 · `dia.template-version-status-set`

body `{toStatus: 'published'|'retired'}` `.strict()` · `200` · **version-guarded** and
**idempotent**.

| condition                                | result                                     |
| ---------------------------------------- | ------------------------------------------ |
| `draft → published`                      | permitted; the guard stamps `published_at` |
| `published → retired`                    | permitted                                  |
| `draft → retired`                        | **refused by the guard** — `ERR-TRN-001`   |
| any move out of `retired`                | refused — `ERR-TRN-001`                    |
| publishing a version with **zero items** | **refused by the service** — see §9        |

`toStatus` is a **closed enum**, unlike `wo.work-order-transition`'s `toState`. The work-order
vocabulary is a live tenant-extensible catalogue; this one is a CHECK constraint. The mirror must
declare an enum here and must **not** declare one there.

### 7 · `dia.template-item-create`

body `{itemCode, prompt, responseType: 'numeric'|'text'|'boolean'|'select', unit?, isMandatory?, validationRule?, sequence?}` `.strict()` ·
`201` · **idempotent**.

`unit` is required when `responseType = 'numeric'` — mirroring `ck_template_items_unit` in Zod so
the caller gets a violation path rather than a `23514`.

**Refused when the parent version is not `draft`** — by `tg_template_items_frozen`, and by the
service first, so the caller sees `ERR-TRN-001` rather than a SQLSTATE.

### 8 · `dia.template-version-list-publishable`

`GET /jobs/{jobId}/inspection-templates` · `dia.diagnostic.record` · `200` ·
`{items: PublishableTemplateVersion[]}`.

**This is the operation that makes the technician's screen possible.** It returns the tenant's
`published` versions of `active` templates — exactly the set `POST /jobs/{jobId}/inspections` will
accept. Without it a technician must be handed a `templateVersionId` from somewhere, which is the
same defect as `INS-04` in a different costume.

It carries `dia.diagnostic.record` rather than `dia.diagnostic.read` because its only consumer is
the act of opening an inspection, and that is the code `dia.diagnostic-create` already requires.
Anyone who may open an inspection may see what they can open it against; nobody else needs to.

### Error cases across the slice

| condition                                    | status | code          |
| -------------------------------------------- | ------ | ------------- |
| duplicate template code in the tenant        | 409    | `ERR-RES-002` |
| illegal version status move                  | 409    | `ERR-TRN-001` |
| item write against a non-draft version       | 409    | `ERR-TRN-001` |
| publishing an empty version                  | 422    | `ERR-VAL-001` |
| `unit` absent for a numeric item             | 422    | `ERR-VAL-001` |
| `copyFromVersionId` from another template    | 422    | `ERR-VAL-001` |
| `diagnosticTypeId` out of scope              | 422    | `ERR-VAL-001` |
| template / version not found or cross-tenant | 404    | `ERR-RES-001` |

## 7. Permission model

**One new code: `dia.catalogue.manage`, domain `dia`, risk `high`.**

**Derived, not invented.** The seed states the rule at `:309-311`: _"One code per schema, not per
catalogue."_ It is applied twice at `:312-313` — `apt.catalogue.manage` and `rec.catalogue.manage`,
both risk `high`.

Two template-plus-versions lifecycles already ship over HTTP under that rule:

- `rec.damage_map_templates` — five operations (list, create, read, version-publish, status-set),
  **all on `rec.catalogue.manage`**, whose route header is titled _"Template administration is not a
  receptionist function"_;
- the shared message templates — eight operations, all on `org.settings.manage`.

**Neither minted a `*.template.*` code.** Codes are named for the surface, not the artefact.

**A `manage`/`publish` split is rejected.** `svc.service.manage` / `svc.price.publish` is a real
precedent, but it separates _pricing_ authority, which is commercially sensitive in a way template
publication is not. `rec.damage_map_templates` is the closer analogue — a template lifecycle
including publication — and it uses one code.

**Risk `high`, matching both catalogue-manage precedents.** A published template version becomes
the immutable structure of every inspection recorded against it; the authority to freeze that is
not a `medium`.

**Enforcement is route-layer, not RLS**, and this is forced rather than chosen. Only seven distinct
permission codes are consulted anywhere in the migration set (23 call sites), `apt.catalogue.manage`
appears in **zero** RLS policies, and — decisively — the three `dia` template tables have no
`company_id`/`branch_id`, so a scoped RLS predicate is impossible without adding columns this slice
otherwise does not need.

**The consequence must be stated plainly:** for these eight operations the declaration is the only
authorization control. There is no second line of defence. That is exactly why `BR-08a` should land
first.

| actor                 | author / publish                       | read the library               | open an inspection against a version |
| --------------------- | -------------------------------------- | ------------------------------ | ------------------------------------ |
| Owner / company admin | yes                                    | yes                            | if they hold `dia.diagnostic.record` |
| workshop manager      | grantable                              | yes                            | typically yes                        |
| service advisor       | no                                     | yes with `dia.diagnostic.read` | no                                   |
| technician            | **no**                                 | yes                            | **yes** — operation 8                |
| cross-tenant          | refused by RLS **and** the declaration | refused by RLS                 | refused by RLS                       |

## 8. Security requirements

| abuse case                         | required behaviour                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **cross-tenant template reuse**    | tenant A cannot open an inspection against tenant B's version — enforced by RLS on `dia.template_versions` and by the report's own tenant predicate. **This is the slice's headline security test** and it has never been executable before, because no template existed. |
| **publishing without authority**   | operation 6 requires `dia.catalogue.manage`; a holder of `dia.diagnostic.record` alone is refused                                                                                                                                                                         |
| **mass assignment**                | every body `.strict()`; `version_number`, `published_at`, `tenant_id` are server-assigned and rejected if sent                                                                                                                                                            |
| **forged foreign ids**             | `diagnosticTypeId` must be `scope = 'platform'` **or** the caller's tenant; `copyFromVersionId` must belong to the same template                                                                                                                                          |
| **IDOR**                           | template and version ids resolve under RLS; out of tenant is 404, indistinguishable from absent                                                                                                                                                                           |
| **privilege escalation**           | the new code is minted rather than reused; a holder of the other four `dia` codes gains nothing                                                                                                                                                                           |
| **unauthorized status transition** | `draft → retired` and any move out of `retired` are refused by the guard; the service refuses first so the caller gets `ERR-TRN-001`                                                                                                                                      |
| **integrity of published history** | items cannot be inserted, updated or soft-deleted on a published version — the guard, not the service, is the authority                                                                                                                                                   |
| **empty published version**        | refused at validation; a published version with no items would let a technician open an inspection that can never be completed, and `outstandingMandatory` would be vacuously satisfied                                                                                   |
| **race**                           | two callers publishing one version — the second sees `ERR-CON-001` from the version guard, then `ERR-TRN-001` on re-read                                                                                                                                                  |
| **stale reference**                | a report already citing a retired version continues to resolve; retirement stops **new** reports only                                                                                                                                                                     |

## 9. Validation

| concern                     | rule                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ids                         | `schemas.uuid` throughout                                                                                                                                                                                                                         |
| codes                       | `code` and `itemCode` mirror `^[a-z][a-z0-9_]{1,62}$` client-side **and** server-side — the same regex the CHECK uses                                                                                                                             |
| enums                       | template `status`: `['active','inactive']`; version `toStatus`: `['published','retired']`; `responseType`: `['numeric','text','boolean','select']` — all closed, all mirrored                                                                     |
| lengths                     | `name` 1..200, `prompt` 1..1000, `unit` 1..32, all non-blank                                                                                                                                                                                      |
| **conditional requirement** | `responseType === 'numeric'` ⇒ `unit` required. Mirror `ck_template_items_unit` in Zod.                                                                                                                                                           |
| **state compatibility**     | item writes require the parent version `status = 'draft'`; publish requires `status = 'draft'`; retire requires `status = 'published'`                                                                                                            |
| **non-empty publish**       | publishing requires ≥ 1 item on the version — a service rule with no database counterpart, so it must be tested directly                                                                                                                          |
| duplicate prevention        | template `code` unique per tenant; `itemCode` unique per version; `sequence` need not be unique but the read orders by it, then by `item_code`, for a stable order                                                                                |
| relationship validation     | `copyFromVersionId` ∈ the same template; `diagnosticTypeId` platform-or-own-tenant                                                                                                                                                                |
| empty / partial update      | operation 4 with no field is 422                                                                                                                                                                                                                  |
| `validationRule`            | `jsonb`, accepted as an opaque object. **This slice does not define its semantics** — nothing in the platform interprets it today, and inventing a schema for it here would create a contract no consumer honours. Record it as an open question. |

Export every `Body`, `Params` and `Query`.

## 10. Error contract

**No new error codes.** All eight operations map onto the existing catalogue.

| condition                                            | HTTP      | code                          | frontend behaviour                                                                                           |
| ---------------------------------------------------- | --------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| duplicate template code                              | 409       | `ERR-RES-002`                 | conflict, warning — offer the existing template                                                              |
| illegal status move                                  | 409       | `ERR-TRN-001`                 | _"this is no longer possible"_ + the refreshed action list. **Not** `ERR-CON-001` — re-reading cannot fix it |
| item write on a published version                    | 409       | `ERR-TRN-001`                 | explain that a published version is frozen and offer "create a new version"                                  |
| empty publish, numeric without unit, bad code format | 422       | `ERR-VAL-001`                 | field errors as keys                                                                                         |
| not found / cross-tenant                             | 404       | `ERR-RES-001`                 | existence not disclosed                                                                                      |
| lacks `dia.catalogue.manage`                         | 403       | `ERR-IAM-001`                 | denial + correlation id                                                                                      |
| stale / absent `If-Match`                            | 409 / 428 | `ERR-CON-001` / `ERR-CON-002` | re-read, re-render, never auto-retry                                                                         |

**`ERR-TRN-001` versus `ERR-CON-001` is the distinction this slice must not blur.** The catalogue
states it: `ERR-TRN-001` means the move is illegal from here — _"re-reading and retrying fixes a
version conflict and cannot fix this one."_ Rendering the same banner for both trains users to
reload and retry an action that will never succeed.

## 11. Audit and history behaviour

`auditClass: privileged` on all six writes; `none` on the two reads.

| requirement                                            | how it is met                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| who published a version, and when                      | `published_at` is stamped by the guard; `updated_by` by the row-metadata trigger; `correlation_id` and `actor_id` from the request context                                                                                                                  |
| the structure a historical report was recorded against | **guaranteed by pinning plus the freeze** — a report cites a `template_version_id`, and that version's items cannot change after publication. This is the mechanism that makes historical diagnostic reports honest, and it exists already.                 |
| template rename history                                | **not recorded.** `name` is last-write-wins with attribution. A renamed template silently re-labels its published versions in every future read. Stated as a known limitation, not fixed here — fixing it means a history table, which is a separate slice. |
| retirement                                             | `status = 'retired'` is durable; the version and its items remain readable forever                                                                                                                                                                          |

**Nothing here is append-only in the `dia.diagnostic_evidence` sense**, and it does not need to be:
the freeze guard delivers immutability where it matters, and everything else is reference data with
attribution.

## 12. Tests

### Positive

| #   | case                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **the end-to-end chain**: seed a diagnostic type → create a template → create a version → author three items → publish → a technician calls operation 8 and sees it → `POST /jobs/{jobId}/inspections` succeeds |
| P2  | `published_at` is stamped by the guard, not by the service                                                                                                                                                      |
| P3  | a second version is created with `copyFromVersionId`; its item set matches the source and is independently editable while `draft`                                                                               |
| P4  | publishing v2 and retiring v1 leaves a report citing v1 fully readable, with v1's original items                                                                                                                |
| P5  | `dia.template-list` pages correctly and a conclusion drawn from page two matches the whole set                                                                                                                  |
| P6  | an `inactive` template's published versions do **not** appear in operation 8                                                                                                                                    |

### Negative

| #   | case                                                       | expected                                                                                                          |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| N1  | no auth                                                    | 401                                                                                                               |
| N2  | holder of `dia.diagnostic.record` only attempts to publish | 403                                                                                                               |
| N3  | duplicate template code                                    | 409 `ERR-RES-002`                                                                                                 |
| N4  | `draft → retired`                                          | 409 `ERR-TRN-001`                                                                                                 |
| N5  | any transition out of `retired`                            | 409 `ERR-TRN-001`                                                                                                 |
| N6  | **item INSERT on a published version**                     | 409 `ERR-TRN-001` — refused by the service **and**, with the service check removed, by `tg_template_items_frozen` |
| N7  | item UPDATE on a published version                         | 409                                                                                                               |
| N8  | item soft-delete on a published version                    | 409                                                                                                               |
| N9  | publish a version with zero items                          | 422                                                                                                               |
| N10 | numeric item without `unit`                                | 422                                                                                                               |
| N11 | `itemCode` violating the format regex                      | 422                                                                                                               |
| N12 | `copyFromVersionId` from a different template              | 422                                                                                                               |
| N13 | client-supplied `versionNumber`                            | 422 (`.strict()`)                                                                                                 |
| N14 | `diagnosticTypeId` from another tenant                     | 422                                                                                                               |
| N15 | `If-Match` absent on publish                               | 428                                                                                                               |

### Security

| #   | case                                                                                                      | expected                                                                |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| S1  | **cross-tenant inspection**: tenant A opens an inspection against tenant B's published version            | refused — **the slice's headline test**, executable for the first time  |
| S2  | **cross-tenant read**: tenant A lists templates and sees none of tenant B's                               | restricted user                                                         |
| S3  | **cross-tenant item write**                                                                               | 404                                                                     |
| S4  | **mass assignment**: body carries `tenantId`, `publishedAt`, `versionNumber`                              | 422                                                                     |
| S5  | **escalation**: a holder of all four existing `dia` codes cannot author or publish                        | 403                                                                     |
| S6  | **freeze backstop**: direct `INSERT INTO dia.template_items` against a published version as `app_runtime` | refused by the trigger                                                  |
| S7  | **race**: two concurrent publishes of one version                                                         | one succeeds; the other gets `ERR-CON-001`, then `ERR-TRN-001` on retry |

S1–S3 as restricted users.

### Regression — must remain green

- `dia.diagnostic-create` — unchanged, and reachable for the first time.
- Every `dia` read path (`diagnostics-repository.ts` lines 264-265, 298, 583, 647, 686, 753, 1255) — now returning rows rather than empty sets.
- **Closure blocker `B4`** — a job with `requires_diagnostic = true` and no completed report must block closure. This branch has never been exercised with real data.
- `permissionCount` 112 → 113 (→ 114 with `BR-03`), from a CI measurement.
- `check-authorization-coverage` / `check-openapi` equality: **+8**.
- `tests/openapi-contract.test.ts` import list: eight new modules.

## 13. Definition of Done

- [ ] Eight operations registered, published, in the operation register.
- [ ] **Zero** migrations against `dia.inspection_templates`, `dia.template_versions`, `dia.template_items`.
- [ ] Exactly **one** permission code added: `dia.catalogue.manage`, risk `high`.
- [ ] A platform `dia.diagnostic_types` vocabulary is seeded, its content approved by the Owner, and it contains **no** invented template.
- [ ] `grep` confirms no `INSERT INTO dia.inspection_templates` exists in any seed or migration.
- [ ] P1 passes end to end, with **no** `INSERT` run by hand at any step.
- [ ] N6, N7, N8 each pass twice: once refused by the service, once by the trigger with the service check disabled.
- [ ] N9 passes — an empty version cannot be published.
- [ ] S1 passes — cross-tenant inspection refused.
- [ ] S5 passes — the four existing `dia` codes confer no authoring authority.
- [ ] `B4` is provably enforceable: a `requires_diagnostic` job without a completed report blocks closure, and with one does not.
- [ ] The mirror declares `toStatus` and `responseType` as **closed enums**, and declares **no** enum for `wo.*` `toState`.
- [ ] `validationRule` semantics are recorded as an open question, not invented.
- [ ] The known limitation — template rename silently re-labels published versions — is recorded in the slice evidence.
- [ ] No file under `apps/web` is changed.
- [ ] No unresolved Critical or High finding open against this slice.
