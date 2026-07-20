# Phase 1-11 — Authorized-Receiver Contract

**Requirement:** BR-REC-001, P1-11-DB-013, §17-7 / M-dlv-2. Owner-authorized technical
self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing
Technical Authorization Policy — not an independent third-party review.

## Verified receiver, delivery-gated

`sal.authorized_receivers` records the verified receiver for a delivery: `delivery_record_id`
(composite FK → `sal.delivery_records(...)`; one receiver per delivery,
`uq_authorized_receivers_delivery`), `receiver_partner_id` (composite FK →
`crm.business_partners(tenant_id, id)`), `identity_evidence_document_version_id` (composite FK →
`shared.document_versions(tenant_id, id)`, **restricted**), `verified_by`, `verified_at`.

- **SELECT** is gated by `sal.delivery.view` (receiver identity evidence is sensitive);
  **INSERT/UPDATE** by `sal.delivery.manage`.

## Time-aware role validation (M-dlv-2)

`sal.guard_authorized_receiver` (BEFORE INSERT OR UPDATE) validates the receiver against an
**active `rec.reception_party_roles` role for this visit** at verification time — or a valid CRM
authorized-person relationship for the vehicle at `delivered_at`. A receiver who is not an
authorized party for the vehicle/visit context is rejected. This binds the handover to a person
the reception chain already recorded, preventing receiver impersonation.

## Identity evidence is restricted

`identity_evidence_document_version_id` is classified `restricted` and lives in a
`sal.delivery.view`-gated table; the document blob and its `sha256` remain in
`shared.document_versions`. A role without `sal.delivery.view` cannot read the receiver or the
evidence reference.

**Tests:** `sal-delivery`.
