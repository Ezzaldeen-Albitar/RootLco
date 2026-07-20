# Phase 1-10 — Damage / Quarantine Contract

**Requirement:** BR-INV-001 (damaged/quarantined stock excluded from sellable
availability). Table: `inv.damaged_stock`.

## Single-step quarantine move

`inv.record_damage(item, from_location, quarantine_location, qty, reason,
disposition?, responsible?, evidence?, correlation?)` (`SECURITY INVOKER`):

1. resolves the from-location's company/branch;
2. inserts an `inv.damaged_stock` row — composite FKs to item, `from_location_id`, and
   `quarantine_location_id` (CHECK `from ≠ quarantine`); `quantity > 0`; `disposition
∈ {quarantined, scrapped, returned_to_supplier}`; `reason` not blank; optional
   `responsible_party_ref`/`evidence_ref`;
3. **releases conflicting active reservations** at the sellable location
   (`inv.free_reservations_for_loss`, junior-first) so `available` stays `>= 0` (H9);
4. posts a **paired** `damage` movement: `out` of the sellable `from_location` and `in`
   to the `quarantine_location` (both provenance-guarded to the damage row and
   quantity; the single-use unique distinguishes them by `direction`).

## Availability effect

After the move, the damaged units live at a `quarantine`-type location. Because
availability is per (item, location) and `available = on_hand − reserved` at each
location, the quantity has **left** the sellable location's `on_hand` and is excluded
from that location's sellable availability. Inter-location transfers (a general move
primitive) are out of scope — deferred to P1-21.

## No forged loss

A `damage` movement cannot exist without an `inv.damaged_stock` source (provenance
guard). The disposition/reason/evidence/responsible party are captured on the record;
the stock effect is entirely mediated by the movement ledger.

**Tests:** the `inv` operations suite (damage pairing, reservation release,
availability) in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
