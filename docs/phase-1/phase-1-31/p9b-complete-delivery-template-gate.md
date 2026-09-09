# P-9b — `sal.complete_delivery` honours active, non-deleted checklist templates

**Slice:** `remediation/p1-31-backend-complete-delivery-template-gate`, ownership profile
`p1-31-backend`.
**Owner approval:** 2026-09-09.
**Closes:** **CC-14**, recorded by the P-9 checklist-template seam (#355) as a defect it measured
and deliberately did not fix.
**Migration:** `supabase/migrations/20260909090000_sal_complete_delivery_active_template_gate.sql`
(139).

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
  stays at 397 operations.
- **No template-removal route.** The obstacle that made publishing one unsafe is gone — a
  soft-deleted template now does withdraw its items — but publishing the route is a separate
  decision and is not taken here.
- **The company-wide mandatory scan is not closed.** Narrowing it needs a template reference on
  `sal.delivery_records`, which is a schema question this slice does not open.
- **`apps/web` is untouched**, including the generated idempotency manifest: no operation moved.
