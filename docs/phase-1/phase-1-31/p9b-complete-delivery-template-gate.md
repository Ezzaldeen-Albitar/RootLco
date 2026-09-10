# P-9b — `sal.complete_delivery` honours active, non-deleted checklist templates

**Slice:** `remediation/p1-31-backend-complete-delivery-template-gate`, ownership profile
`p1-31-backend`.
**Owner approval:** 2026-09-09.
**Closes:** **CC-14**, recorded by the P-9 checklist-template seam (#355) as a defect it measured
and deliberately did not fix.
**Migration:** `supabase/migrations/20260909090000_sal_complete_delivery_active_template_gate.sql`
(139).
**Recorded as:** **CC-21** at section 35 of
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md). The merged report-configuration
writer #361 occupies **CC-20** and section 34; the final integration retains this slice's reserved
identifiers.

## 1. The problem

`sal.delivery_checklist_templates` has carried a lifecycle since P1-11: `status` is
`NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))`, and the row soft-deletes
through `deleted_at`. The completion gate could not see either column.

`sal.complete_delivery` (`20260724094000_sal_delivery.sql`, section 8) counted mandatory items
from `sal.delivery_checklist_template_items` alone, filtered by `(tenant_id, company_id)`,
`is_mandatory`, and the **ITEM's** own `deleted_at`. It never joined the parent template. Two
consequences followed, and the P-9 seam proved both on real rows:

- **Deactivating a template withdrew nothing.** Every mandatory item under it kept refusing every
  handover in the company. The operator who retired the checklist had no way to tell from the
  template surface that it was still load-bearing, and `status` was decorative on the one surface
  where it has to mean something — whether the checklist is in force.
- **Soft-deleting a template was worse.** `uq_delivery_checklist_templates_code` is partial on
  `deleted_at IS NULL` and the detail read filters the row out, so a soft-deleted template
  disappears from every read while its items go on refusing completions from behind a template
  nobody can list, open or reactivate. That is why the seam declined to publish a template-removal
  route at all.

The only remedy that worked was withdrawing each ITEM one at a time, which is why
`sal.delivery-checklist-template-item-remove` exists.

## 2. The migration

The function is re-issued as `CREATE OR REPLACE FUNCTION` with an **identical** signature
`(uuid, numeric, text, uuid)`, `RETURNS uuid`, `LANGUAGE plpgsql`, `VOLATILE`, `SECURITY INVOKER`,
`SET search_path = ''`, and identical `REVOKE`/`GRANT` lines. Only the `FROM`/`WHERE` of the
`v_missing` count changed:

```sql
  SELECT count(*)::int INTO v_missing FROM sal.delivery_checklist_template_items ti
    JOIN sal.delivery_checklist_templates t
      ON t.tenant_id = ti.tenant_id AND t.company_id = ti.company_id AND t.id = ti.template_id
    WHERE ti.tenant_id = v_del.tenant_id AND ti.company_id = v_del.company_id
      AND ti.is_mandatory AND ti.deleted_at IS NULL
      AND t.status = 'active' AND t.deleted_at IS NULL
      AND NOT EXISTS ( ... the results arm, unchanged ... );
```

A textual diff of the two function bodies is **one comment line, the two `JOIN` lines, and the one
predicate line**. Everything else is character-identical.

Two choices worth stating:

- **The join target is `uq_delivery_checklist_templates_scope_id (tenant_id, company_id, id)`** —
  the scoped unique key, which exists to be joined against. The join therefore cannot cross a
  tenant or a company, and the isolation claim is a property of the key rather than of a filter
  someone might later drop.
- **It is an INNER join, not a LEFT join with a null-tolerant predicate.**
  `fk_delivery_checklist_template_items_template` makes `(tenant_id, company_id, template_id)` a
  mandatory reference, so an item without a template does not exist; a LEFT join would only be
  describing an impossible row.

### 2.1 What is preserved, verbatim

The `FOR UPDATE` lock and its tenant scope; the idempotent early return on `status = 'delivered'`
(C1); the authorized-receiver gate and the receiver it resolves into the custody release; the
signature gate; the odometer insert; the flip to `delivered` **before** the custody release, so the
`rec` custody guard sees a delivered record; the custody-release and status-history rows; the
results arm of the checklist gate (`outcome IN ('passed', 'waived')` and `r.deleted_at IS NULL`);
the item's own `deleted_at` filter; ERRCODE `check_violation` (23514) and the message shape; and
`SECURITY INVOKER`, which is what keeps every RLS policy in force for the caller.

**The COMPANY-wide scan is deliberately unchanged.** `sal.delivery_records` carries no
`template_id`, so there is no applicable template to resolve, and narrowing the scan to one
template is not a decision this migration is entitled to make. What changed is which templates
count as in force — not how widely they are looked for.

**Rollback classification: rollback-safe.** One `CREATE OR REPLACE FUNCTION` with an identical
signature and nothing else. A later forward migration re-issuing the previous body restores
exactly what `20260724094000` left, and no state is lost by doing so: the change narrows a count
inside a gate and writes nothing.

## 3. The lockstep mirror

`DeliveryRepository.mandatoryChecklistGaps`
(`apps/api/src/modules/delivery/data/delivery-repository.ts`) gains the **same** join, in the
**same** commit, in both the count and the `LIMIT`-bounded sample. Its docblock gains the template
rule as a third numbered item, and the eligibility fact source in `delivery-read-service.ts` names
the templates table.

This is the rule that made CC-14 unfixable inside the P-9 seam, and it has not changed: **the
mirror must never be better than the primitive.** A mirror that filtered inactive templates while
the primitive did not would report a delivery ELIGIBLE and then have
`sal.complete_delivery` refuse it inside the transaction with 23514. The migration is what makes
the mirror's new predicate true, which is why the two move together or not at all.

`passAllMandatory` in `tests/db/p1-11-helpers.ts` takes the same predicate for the same reason: a
fixture that satisfied an item the gate no longer asks about would insert a result nobody wants and
would hide a regression in the join.

## 4. Why this travels on the `p1-31-backend` lane

`.github/ci-baselines/phase-ownership-profiles.json` describes `p1-31-backend` as the A0 read seams
and configuration writers, and the profile's own `why` states the rule that admits this slice:
**Field 13 of the chapter routes a defect found by the Frontend back to its owning backend phase
under change control.** The defect was measured by a P1-31 backend slice, recorded as a P1-31
change-control disposition, and its remedy is the migration that disposition named. No
`remediation/p1-22-` prefix exists to carry it, and the profile allows the `migrations` bucket
precisely so a slice on this lane can close a finding of this shape.

## 5. What this does not do

- **No table, column, index, policy, trigger, grant or row.** One function body.
- **No permission was minted and no bundle changed.** The gate is inside a primitive that every
  existing caller already invokes.
- **No route, no operation, no audit action.** The published contract is unchanged; the register
  has 405 operations after integration of the merged predecessors; this slice adds none.
- **No template-removal route.** The obstacle that made publishing one unsafe is gone — a
  soft-deleted template now does withdraw its items — but publishing the route is a separate
  decision and is not taken here.
- **The company-wide mandatory scan is not closed.** Narrowing it needs a template reference on
  `sal.delivery_records`, which is a schema question this slice does not open.
- **`apps/web` is untouched**, including the generated idempotency manifest: no operation moved.

## 6. Integrated source verification — 2026-09-10

Source `844fb9c7a1a2cfb55299995df989b232c63912e0` integrates protected `develop` `455bce260c315c2b8727418ba37b8e43a7e24fff` once, after cleanup #365 merged. Three documentation conflicts were reconciled; no executable conflict required a behavior change. The migration tree remains `565ebf2d1c4aef83aa910ccdbe42221a02e60611`, identical to the retained candidate139 replay. No migration was edited or replayed for this verification.

On the newly owned `p131_template_gate_20260910` copy (OID 36457), seed validation applied all eight declared files twice and passed; all six classification validators passed. The full DB tier passed **1743/1743 across 144 files**, and the targeted `tests/backend/p1-31-delivery-checklist-template-seam.test.ts` passed **28/28**. Both actual runner exits were zero, both JSON reporters reported success, and neither reported failed or empty suites. This is full DB and selected backend evidence, not a full backend or end-to-end claim.

The container/database identity and five existing test logins/four memberships were checked before execution. All 255 retained candidate tables (342 rows) retained their before/after content digest, `5184d443de700c445e08ca920216b6b655f622c93055efacd196dc6069bf1cb4`; captured role privilege attributes and memberships were unchanged. The final source/clone connection lists were empty, and the last connection closed at `2026-09-10T10:39:01.495Z`. The disposable copy is retained; no shared-stack reset, source-fixture cleanup, new cluster authority or seed replay against the retained source occurred. Durable raw reports and inventories are in the coordinator evidence bundle under `template-gate-*-20260910`. Historical failed runs remain preserved.

Separate agent-assisted technical review of this exact executable source found no blocking issue in the immutable function, matching count/sample predicates, scoped exclusions, lifecycle cases or permission/version behavior. This is technical review under the Solo Developer Review Policy, not independent human QA or phase acceptance. The gate remains a live company-wide count of mandatory items under active, nondeleted templates; zero applicable items are permitted and no snapshot requirement is introduced.

Final local records at the same executable source: web **3619/3619 across 133 files**, followed by the manifest refresh and **113/113** across the three evidence suites, then unit **3277/3277 across 121 files**. Both tier records retain actual runner exit zero, reporter success, no failed or empty suites and no dirty executable paths. Root/API typechecks, lint and formatting, Stylelint, security checks and contract validators passed. The coordinator separately verified all 19 postmerge checks for cleanup #365 at `455bce260c315c2b8727418ba37b8e43a7e24fff`, releasing the dependency push hold. The standing local aggregate/build/Playwright waiver remains; this branch still requires its own final-head hosted gates and coordinator merge review. No phase acceptance or pending Owner answer is implied.
