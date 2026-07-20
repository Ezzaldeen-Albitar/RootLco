# Phase 1-11 — Financial-Event Provenance Contract

**Requirement:** TS-002, P1-11-DB-009, §17-5 / H-fin-3, TC-P1-11-005. Owner-authorized
technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the
Standing Technical Authorization Policy — not an independent third-party review.

## The trust model (three controls)

Because `SECURITY DEFINER` is forbidden repo-wide, `app_runtime` holds a direct `INSERT` grant
on `sal.financial_events`. The trust root is therefore on the **table**, not a privileged
function:

1. **Single-use.** `uq_financial_events_source UNIQUE(tenant_id, source_type, source_id,
event_type)` — one event per (source, event_type). A replayed command cannot emit a second
   event.
2. **Provenance guard.** `sal.guard_financial_event_provenance` (BEFORE INSERT) requires the
   named source row to **exist in the event's scope**, be in its **authorized/terminal state**,
   and **bind the amount** to the source: issued invoice → `gross_total` (and Σ warranty-pay for
   `warranty_split_recorded`); recorded receipt → `amount`; allocation → allocation `amount`;
   approved credit → credit `amount`; approved reversal → reversal `amount`. **A raw forged
   event with no valid source is rejected** — proven by a raw-insert bypass test.
3. **Append-only.** No UPDATE/DELETE grant; `org.guard_immutable_columns` and the SELECT+INSERT
   posture make the row immutable once written.

## Completeness is a constraint (H-fin-3)

The five deferred completeness constraint triggers (listed in the
[financial-event-catalogue](phase-1-11-financial-event-catalogue.md)) enforce the **converse**:
an issued invoice / recorded receipt / allocation / approved credit / approved reversal that
lacks its matching event at commit fails. Together with the provenance guard, this yields
**exactly one event per successful financial command** — a completeness property test asserts
the bijection.

## Why this is enforcement, not convention

The `sal.*` primitives that emit events are `SECURITY INVOKER` and advisory under the
no-`DEFINER` rule; the real enforcement is the single-use unique + provenance guard +
completeness triggers on the table. A caller with the ordinary `INSERT` grant still cannot mint
a financial event that does not correspond to a real, authorized, amount-matched source fact.

**Tests:** `sal-financial-event` (raw-insert bypass rejected; completeness property).
