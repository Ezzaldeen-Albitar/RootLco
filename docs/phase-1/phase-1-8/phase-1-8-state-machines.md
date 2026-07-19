# Phase 1-8 — State Machines

Three guarded state machines, each enforced by a `SECURITY INVOKER` trigger
function. Terminal states are frozen; every real transition is validated and,
where a ledger exists, recorded append-only with a coherence guard.

## Appointment lifecycle (`apt.guard_appointment_transition`)

```
requested ──► pending_confirmation ──► confirmed ──► checked_in   (terminal)
    │                    │                  │
    └──► cancelled       └──► cancelled     ├──► cancelled         (terminal)
                                            └──► no_show           (terminal)
```

- `no_show` and `checked_in` are reachable **only** from `confirmed`.
- Cancellation is allowed from `requested`, `pending_confirmation`, `confirmed`.
- `cancelled`, `no_show`, `checked_in` are terminal (no reopen contract).
- `confirmed`/`checked_in` require a confirmed window; only these reserve
  constrained capacity (the same-Vehicle confirmed-overlap `EXCLUDE`).
- Cancellation and no-show are integrated on the master (set-once, coherent) and
  evidenced by the append-only `apt.appointment_status_history` (emit trigger,
  one row per real change, no-op safe, coherence-guarded to the live master).

## Reception lifecycle (`rec.guard_reception_transition`)

```
opened ──► inspecting ──► authorized ──► converted            (terminal)
   │           │              │
   └───────────┴──────────────┴──► closed_without_work        (terminal)
   └───────────┴──────────────┴──► refused                    (terminal)
```

- A visit is created directly in `opened` with custody accepted (normally via
  `rec.accept_check_in`).
- Advancing to `authorized` requires **an active service-requester party role AND
  an approved `rec.authorizations` record** (the activation contract).
- `converted` records that the visit will become a work order in **Phase 1-9** —
  P1-08 creates no work-order row.
- `converted`, `closed_without_work`, `refused` are terminal.
- Recorded append-only in `rec.reception_status_history` (emit trigger,
  coherence-guarded).

## Custody chain (`rec.guard_custody_transition`)

```
accepted ──► in_workshop ──► released     (terminal)
    └────────────────────► released
```

- The **first** custody event must be `accepted` (no prior state); thereafter a
  new event's `from_state` must equal the last recorded `to_state`.
- No release before acceptance; no duplicate acceptance (`uq_custody_history_
accepted` partial unique is the concurrency backstop, the guard the in-tx gate).
- `released` is terminal. Actor and time are server-stamped; a monotonic `seq`
  gives deterministic ordering, so the full chain is reconstructable and
  attributable.
