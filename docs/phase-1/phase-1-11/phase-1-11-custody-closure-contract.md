# Phase 1-11 — Custody-Closure Contract

**Requirement:** BR-REC-001 (custody ends at recorded handover), P1-11-DB-011, TC-P1-11-003,
**C1** + **H-dlv-1**. Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under
the Solo Developer Review Policy and the Standing Technical Authorization Policy — not an
independent third-party review.

## `sal.complete_delivery` — atomic, idempotent closure

`sal.complete_delivery(p_delivery_id uuid, p_final_odometer_value numeric, p_odometer_unit
text, p_correlation_id uuid)` (SECURITY INVOKER, `app_runtime`), in one transaction:

1. **locks its own `sal.delivery_records` row `FOR UPDATE`** and re-checks status (idempotent —
   a duplicate completion returns without a second effect);
2. verifies eligibility + coherence (`guard_delivery_coherence`), the verified authorized
   receiver (`guard_authorized_receiver`), the mandatory checklist (passed/waived under the
   lock, L-dlv-1), and final-odometer coherence;
3. inserts the final odometer reading and sets `final_odometer_reading_id`;
4. sets `status='delivered'` (`ck_delivery_records_delivered_shape` binds delivered_at +
   odometer);
5. writes the `rec.custody_history` release/handover row **once**;
6. appends `sal.delivery_status_history`.

## Exactly-once custody release (C1)

One **additive-forward** object on the pre-existing `rec.custody_history` (same pattern as
P1-10's `wo` forward FKs) makes the release fact unique:

- `uq_custody_history_released` — partial unique on `rec.custody_history(reception_visit_id)
WHERE to_state='released'`: a **second** release for the visit fails with `23505` (hard
  exactly-once backstop, C1).

## Delivery gating (H-dlv-1) — accepted residual

The delivery gates — verified authorized receiver, mandatory checklist, signature, and
coherent final odometer — are enforced **inside `sal.complete_delivery`**, the sanctioned
delivery path. A rec-forward `BEFORE INSERT` guard on `rec.custody_history` requiring a
delivered `sal.delivery_records` row was prototyped
(`rec.guard_custody_release_requires_delivery` / `tg_custody_history_delivery_gate`) but
**removed** — those objects no longer exist. Adding it broke the merged,
independently-valid Phase 1-8 custody state machine (which legitimately releases custody
without a commercial delivery) and inverted the module dependency (`rec` must not depend on
`sal`). A raw custody-release INSERT produces no delivery record, warranty, or invoice, so
it cannot fabricate a completed commercial delivery; it only closes custody, which the
merged custody chain + `uq_custody_history_released` already govern (accepted →
in_workshop → released, exactly once). A privileged rec-domain actor closing custody
outside the delivery pipeline is an audited rec operation that bypasses no billing/warranty
control. **Accepted residual.**

## Guarantee

Via the sanctioned path, custody is released **exactly once** per visit through a
fully-gated `sal.complete_delivery`. Concurrent completions serialize on the delivery row
and, at worst, the second hits `uq_custody_history_released`. A raw rec-domain custody close
outside the pipeline remains possible but is an audited rec operation that produces no
delivery/warranty/invoice and bypasses no commercial control (H-dlv-1, accepted).

**Tests:** `sal-custody-closure`, `sal-delivery` (TC-P1-11-003).
