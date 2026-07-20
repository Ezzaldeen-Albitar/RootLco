# Phase 1-11 — Delivery-Signature Evidence Contract

**Requirement:** P1-11-DB-014, §17-7 / L-dlv-2, NFR-DAT-003. Owner-authorized technical
self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing
Technical Authorization Policy — not an independent third-party review.

## Append-only, document-bound, delivery-gated

`sal.delivery_signatures` is an **append-only** ledger (SELECT+INSERT only): `delivery_record_id`
(composite FK → `sal.delivery_records(...)`), `signer_role` CHECK IN
`('receiver','delivering_employee','witness')`, `signature_document_version_id` (composite FK →
`shared.document_versions(tenant_id, id)`, **restricted**), `signed_at`.

- **SELECT** gated by `sal.delivery.view`; **INSERT** by `sal.delivery.manage`. There is no
  UPDATE/DELETE grant — corrections are a **new** signature only.

## Hash anchoring (forged-signature control)

The signature binds an **immutable** `shared.document_versions` row whose `sha256` anchors the
signed artefact. Because that document row is itself immutable and hash-bound, a signature
cannot be silently swapped for a different document after the fact — the DB anchors the
tamper-evident hash.

## Storage-tier residual (L-dlv-2, accepted)

Verifying that the stored signature **blob** matches its `sha256` is a storage-tier concern
(object store integrity), accepted as out of the DB's scope. The database's responsibility is to
anchor the immutable `sha256` and keep the signature append-only and permission-gated; the
blob↔hash check lives in the storage layer.

## Delivery status history

`sal.delivery_status_history` is the append-only, server-stamped ledger
(`shared.stamp_status_history`) recording `ready → receiver_verified → signed → delivered`
(and `exception`); `to_status` CHECK matches the delivery states.

**Tests:** `sal-delivery`, `p1-11-security`.
