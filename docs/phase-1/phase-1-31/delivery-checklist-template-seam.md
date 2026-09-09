# P1-31 — the delivery checklist template seam (P-9)

What was published, why each shape is the shape it is, what was proved on real rows, and the
completion-gate defect the slice measured and did not fix.

|                              |                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Phase**                    | P1-31 — Vehicle Delivery, Warranty, and Reporting Frontend                                                                 |
| **Authority**                | Prerequisite **P-9** of [`a0-preflight.md`](./a0-preflight.md), Artefact 4 — **PPD-12**                                    |
| **Lane**                     | `remediation/p1-31-backend-checklist-template-seam`, ownership profile `p1-31-backend`                                     |
| **Baseline**                 | protected `develop` **f4309a8e**; `main` `1262de74`, untouched                                                             |
| **Change control**           | [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) — **CC-14**                                               |
| **Closes no canonical task** | P-9 is an execution prerequisite. The 29 remain 29, each still owing its own evidence under Field 7, Field 27 and Field 32 |

---

## 1. The measured problem

`sal.delivery_checklist_templates` and `sal.delivery_checklist_template_items` landed in P1-11
carrying `SELECT`, `INSERT` and `UPDATE` grants for `app_runtime` and an `INSERT` and an `UPDATE`
policy each — and **no code anywhere in `apps/api/src` had ever written either one.** The single
method that touched them, `DeliveryRepository.findTemplateItem`, is a per-item existence probe
called by the checklist-result write path.

The consequence is the one A0 records for FE-004. On a tenant provisioned through the product the
handover checklist is empty and permanently so: there is no way to add an item, no way to list the
templates, and no way to resolve a `template_item_id` to anything a person can read. The P-4
checklist-RESULT read published two months earlier answers for items no caller could create or
enumerate, and every backend suite that needed a checklist item seeded one by **admin SQL**, which
is itself the measurement.

## 2. The eight operations

Two reads declare `sal.delivery.view` with `auditClass: 'none'`; six commands declare
`sal.delivery.manage` with `auditClass: 'privileged'`.

| operation                                     | method | path                                                | guards                         |
| --------------------------------------------- | ------ | --------------------------------------------------- | ------------------------------ |
| `sal.delivery-checklist-template-list`        | GET    | `/delivery-checklist-templates`                     | paged                          |
| `sal.delivery-checklist-template-read`        | GET    | `/delivery-checklist-templates/{templateId}`        | —                              |
| `sal.delivery-checklist-template-create`      | POST   | `/delivery-checklist-templates`                     | `idempotent`, 201              |
| `sal.delivery-checklist-template-rename`      | PATCH  | `/delivery-checklist-templates/{templateId}`        | `versionGuarded`               |
| `sal.delivery-checklist-template-status-set`  | POST   | `/delivery-checklist-templates/{templateId}/status` | `idempotent`, `versionGuarded` |
| `sal.delivery-checklist-template-item-create` | POST   | `.../{templateId}/items`                            | `idempotent`, 201              |
| `sal.delivery-checklist-template-item-update` | PATCH  | `.../{templateId}/items/{itemId}`                   | `versionGuarded`               |
| `sal.delivery-checklist-template-item-remove` | DELETE | `.../{templateId}/items/{itemId}`                   | soft delete                    |

The register moves 382 → **390** operations, 299 → **304** paths, 216 → **222** audit actions. Five
route modules; three of them carry two verbs, which is why the two counts move by eight and five.

### The governing precedent, and where this slice departs from it

`svc.service-category-create` (P1-30 A1) is the configuration-writer precedent and this follows it
in every respect it can: a strict body that refuses `id` and `status`, a code mirrored from the
column's own CHECK, `23505` surfaced as `ERR-CON-001` with `rule: 'duplicate_code'`, and no minted
permission. It departs in one respect, and the reason is a property of the schema rather than a
choice: a service category has no company, so its authority is tenant-wide; a checklist template
has a company and no branch, so its authority is **company-wide** and is evaluated against the
row's own company rather than tenant-wide. Section 4.

The item removal follows `tech.technician-skill-withdraw`: a `DELETE` verb performing an `UPDATE`
that sets `deleted_at`. The item list inside the detail read follows
`dia.template-version-item-list` and is deliberately unpaged — the order IS the checklist, so a
page boundary would cut one in half.

## 3. The permission — nothing was minted

**Reads declare `sal.delivery.view`. Writes declare `sal.delivery.manage`.** Both are verified in
`supabase/seeds/04_iam_permission_catalog.sql` before use, and both are already in the tenant
administrator bundle through P-1. **No seed changed, no bundle changed, no code was minted.**

The catalogue seeds no delivery _configure_ code, and the repository rule — stated by
`svc.service-category-create` in its own docblock — is to reuse the module's `.manage` code rather
than add one the A0 least-privilege review did not approve. The alternative would have been a
`sal.delivery.catalogue.manage` that no bundle carries and no actor could hold, which is the
"declared but never wired" defect this phase keeps finding.

`sal.delivery.read` still does not exist (**RES-05 / P-8**, untouched here), so the reads declare
`sal.delivery.view` exactly as the P-2…P-5 read seam does.

## 4. How the authority is scoped — the company-scope decision

**The writes require the permission for the TARGET COMPANY: company-wide, or wider.** Every command
calls `authorizeScope({ companyId })` against the row's own company after the row is read, or
against the body's claimed company before the row is written.

There is **no company-scope helper in the repository** and none was added. `authorizeScope` is
`requireScopedPermissions`, which accepts a company-only target — the shape
`iam.company-settings-read` and `iam.company-settings-write` already pass — and resolves it through
`iam.has_permission_in_scope(code, company, NULL, NULL)`. That predicate is satisfied only by
`scope_mode = 'unrestricted'` or by a `company`-type grant scope naming the company: a BRANCH-scoped
grant compares `s.branch_id = NULL` and does not apply. So the check means exactly "company-wide or
wider", by the deployed function rather than by a second definition of scope written here.
`callerHoldsPermissionTenantWide` was **not** used: it would have demanded an unrestricted grant for
a row that genuinely belongs to one company.

Why company-wide and not branch: **`sal.complete_delivery` counts mandatory checklist items by
`(tenant_id, company_id)` across every template**, because `sal.delivery_records` carries no template
reference. One mandatory item authored here therefore blocks the handover of every vehicle in every
branch of that company until each delivery records a `passed` or `waived` outcome for it. That reach
is the argument, and it is measured rather than assumed.

**The READS are scoped differently, deliberately.** They declare `scope: 'tenant'` and lean on
`sel_delivery_checklist_templates_scope`, which narrows by `iam.allowed_company_ids()` — a set that
includes the company of a BRANCH-scoped grant, because `ck_grant_scopes_shape` requires every scope
row to name its company. Requiring company-wide authority to read would have denied the checklist to
the branch-scoped delivery officer who works through it, which is the P-2…P-5 rule restated: a read
on this surface must be holdable by the principal that acts on it.

The tenant boundary on a create is `fk_delivery_checklist_templates_company`, whose tenant half comes
from the session context rather than from the request, so a company in another tenant is refused as
`ERR-VAL-001` and no row can be written outside the caller's tenant.

## 5. Absence, and what a 404 means here

`findTemplate` returns null for absent and out-of-scope alike, and the service turns both into one
`ERR-RES-001` — decided **before** any scope decision, so a 403 never confirms that an id names a
real row somewhere. A foreign tenant gets 404 on the detail read and on every command; a caller
holding `sal.delivery.manage` but not `sal.delivery.view` gets 403 on the reads, which is the
missing code and nothing else.

An item addressed through the WRONG parent template is a 404 as well, and that check is load-bearing:
`findTemplateItem` resolves within the COMPANY, so without it the item path would edit a sibling
template's item and report success.

## 6. Paging, and what is deliberately not paged

The template LIST is keyset-paged under `sal.delivery_checklist_templates:created_at_desc`, newest
first, with the cursor's sort value minted by `cursorTimestamp()` **in SQL at microsecond
precision** — a JS `Date` truncates to milliseconds and silently SKIPS rows sharing the boundary
row's millisecond (`P1-27-INT-006`), which bites exactly here because a suite's templates are
frequently written inside one transaction. The suite proves two pages disjoint.

The ITEMS of one template are **not** paged, on the `dia.template-version-item-list` precedent: the
set is bounded by authoring, the order is the checklist, and a page boundary would cut it in half.
The ordering is `(sort_order, item_code)` because `sort_order` is not unique and two reads must
answer in the same order.

Inactive templates are **not** hidden from the list. A configuration list that hid retired rows
would make the restore command unreachable, which is the trap
`apt.catalogue-source-channel-status-set` records for its own catalogue.

## 7. Money

**None crosses this surface, and that is a measurement rather than an omission.** Neither table has
a `numeric` column of any kind. `sortOrder` and `recordVersion` are `integer` and are rendered as
JSON numbers: the decimal-string rule this codebase applies to money exists because `numeric` cannot
survive IEEE-754, which does not apply to an `integer`. The suite walks every response for a JSON
number under any money-shaped key and asserts there is none, so a future field cannot introduce a
float here either.

## 8. The completion-gate finding — measured, recorded, NOT fixed

**An INACTIVE template still blocks a handover.**

`sal.complete_delivery` (`supabase/migrations/20260724094000_sal_delivery.sql`, section 8) counts
mandatory items with `ti.tenant_id = … AND ti.company_id = … AND ti.is_mandatory AND ti.deleted_at
IS NULL`. It never joins `sal.delivery_checklist_templates` and reads no template `status`. So
deactivating a template does not withdraw its items from the completion gate:

| state                                         | before this slice | after this slice |
| --------------------------------------------- | ----------------- | ---------------- |
| item of an `active` template, mandatory       | blocks            | blocks           |
| item of an **`inactive`** template, mandatory | **blocks**        | **blocks**       |
| item soft-deleted (`deleted_at` set)          | does not block    | does not block   |

The application mirror in `DeliveryRepository.mandatoryChecklistGaps` reproduces the primitive
exactly, including this, and **was deliberately not "corrected"**. A mirror that filtered inactive
templates would report a delivery ELIGIBLE that `sal.complete_delivery` then refuses inside the
transaction — the repository's own rule, written above that method: "a mirror that improved on the
primitive would report a delivery as eligible that the primitive then refuses". Fixing the behaviour
means replacing the protected function, which is a forward migration and a schema decision this
prerequisite does not sanction; it is filed as **CC-14**.

What this slice does give an operator is the remedy that works today: **withdraw the ITEM.**
`sal.delivery-checklist-template-item-remove` sets exactly the column the primitive filters on, and
the suite proves the sequence end to end on real rows — an inactive template's mandatory item
produces `checklist_incomplete` with the item named in the gap sample, and withdrawing the item
clears the blocker.

## 9. What was proved, on real rows

`tests/backend/p1-31-delivery-checklist-template-seam.test.ts` — **27 cases, all passing**. Every
row the suite reads was authored **through the published routes**; unlike every suite before it,
this one seeds neither table by admin SQL, because "a checklist can be configured through the
product" is the claim under test.

1. **Authored and read back.** A template with two items is created in one call, returned in
   checklist order, and read back by `SAL_READER` — which holds `sal.delivery.view` and not
   `sal.delivery.manage`, so it wrote none of the rows it reads.
2. **The authority is company-wide, from three sides.** `SAL_SCOPED_A2` holds `sal.delivery.manage`
   through a BRANCH-scoped grant in `COMPANY_A1` and is refused every write while still being able to
   READ; `SAL_COMPANY_SCOPED`, whose grant is `scope_type = 'company'` on the same company, is
   admitted there and refused in `COMPANY_A9`.
3. **Refused correctly.** A caller without `sal.delivery.view` is refused both reads with
   `ERR-IAM-001`; a reader is refused all six commands; another tenant gets 404 `ERR-RES-001` on a
   read and on a write and never a 403.
4. **The guards hold.** `If-Match` absent is 428, stale is 409 with the row asserted unchanged, and a
   success advances the version by exactly one. An item's `If-Match` is the ITEM's version, and the
   suite exercises that trap directly. A patch carrying one field leaves the others untouched.
5. **Replay.** The same key and body answers with the identical document and creates one template and
   one audit record. (The replay answers 200 rather than the declared 201: `withIdempotency` stores
   the body and replays it as a plain result, which is a platform contract rather than a property of
   this route.)
6. **The gate finding**, as section 8 describes, in `COMPANY_A9` so that no other suite's in-flight
   delivery can see the mandatory item, which is withdrawn inside the same case.

## 10. What this does not close

- **P1-27-INT-088.** All three limbs of the GAP side stand: the eligibility read returns
  mandatory-and-unsatisfied items only, capped at 20, with `missingCount` computed and then dropped
  before the wire. This slice publishes the template, which is the other half of **CC-06** — a
  caller can now resolve a `template_item_id` to a code and a label — and touches none of the three.
- **The company-wide mandatory scan.** Closing it needs a template reference on
  `sal.delivery_records`, which is a schema question and therefore not this lane's.
- **The inactive-template gate**, section 8, filed as **CC-14**. It needs a forward migration
  replacing `sal.complete_delivery`.
- **Bilingual names.** The table has one `name` column and one `label` column and no locale column,
  so an Arabic label cannot be stored. Adding one is a migration; the surface publishes what the
  column holds and invents nothing.
- **Template removal.** There is no delete and no soft delete for a TEMPLATE, only deactivation.
  A soft-deleted template would not withdraw its items from the completion gate either — the
  primitive filters the ITEM's `deleted_at`, not the parent's — so a route that appeared to retire a
  checklist would leave it gating every handover in the company.
- **FE-004 itself.** `apps/web` is unchanged except through the generated idempotency manifest, which
  every published operation moves. The screen is a later slice on the `p1-31-frontend` lane, and it
  is that lane which owes the request-payload mirror; the five body-carrying writes are declared
  `PENDING` in `check-p1-30-payload-parity.mjs`, which fails the moment a mirror appears and the
  entry is not deleted.
