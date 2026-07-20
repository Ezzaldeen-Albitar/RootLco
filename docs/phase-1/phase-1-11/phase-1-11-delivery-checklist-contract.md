# Phase 1-11 — Delivery-Checklist Contract

**Requirement:** P1-11-DB-012, TC-P1-11-003, L-dlv-1. Owner-authorized technical self-review by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing Technical
Authorization Policy — not an independent third-party review.

## Tenant-configurable template + per-delivery results

- `sal.delivery_checklist_templates` — company-scoped, structural (no business content seeded):
  `template_code` (`^[a-z][a-z0-9_]{1,62}$`; `uq_..._code` partial), `name`, `status` CHECK IN
  `('active','inactive')`.
- `sal.delivery_checklist_template_items` — `template_id` (composite FK →
  `sal.delivery_checklist_templates(tenant_id, company_id, id)`), `item_code`, `label`,
  **`is_mandatory boolean`**, `sort_order`.
- `sal.delivery_checklist_results` — per delivery: `delivery_record_id` +
  `template_item_id` (one result per (delivery, item), `uq_..._item`), `outcome` CHECK IN
  `('passed','failed','waived')`, `waiver_reason`. `ck_delivery_checklist_results_waiver`
  enforces `outcome='waived'` **iff** `waiver_reason IS NOT NULL`.

## Mandatory gate (L-dlv-1)

`sal.complete_delivery` evaluates the mandatory-item aggregate **inside the completion lock**:
every `is_mandatory` template item must have a result that is `passed` or `waived` (with a
reason). A `failed` or missing mandatory item blocks completion. Once the delivery reaches
`status='delivered'`, the checklist results **freeze** (no further INSERT/UPDATE).

## Structural only

No checklist template rows are seeded as business content; templates and items are tenant
configuration (no-fake-data policy). A delivery with no mandatory items is completable once the
receiver, odometer, and signature gates pass.

**Tests:** `sal-delivery` (TC-P1-11-003).
