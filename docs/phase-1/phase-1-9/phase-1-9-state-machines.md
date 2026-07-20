# Phase 1-9 — State Machines

Two guarded, **configurable** state machines: the work order and the job. Both are
data-driven — states and transitions are dual-scope catalog rows
(`wo.work_order_states`/`wo.work_order_transitions` and
`wo.job_states`/`wo.job_transitions`) — but their **safety** is code, not data.

## Configurable graph over platform-governed terminals

A transition is valid only if it exists as an **active** row in the approved
transition graph; a transition guard rejects any edge not present. Configurability
is bounded so a tenant can route work but never route _around_ a mandatory control:

- **Configurable routing (data).** A tenant may add its own intermediate
  **non-terminal** states and transitions.
- **Platform-governed terminals (code + CHECK, design finding F1).** The
  `is_terminal` / `is_closed` / `is_cancellation` flags are platform-governed. A
  CHECK forbids a `scope='tenant'` state row from being terminal, closed, or
  cancellation, and CHECKs enforce flag coherence (closed ⇒ terminal; cancellation
  ⇒ closed + terminal). A tenant cannot define a terminal-but-not-closed state to
  slip past the gate.
- **Non-configurable safety (triggers/constraints).** The closure gate, the
  no-reopen invariant (BR-WO-002), the append-only ledgers, the independent-sign-off
  rule (BR-QMS-001), and labor-overlap exclusion are enforced in triggers and
  constraints and are not data-configurable. A terminal-freeze trigger hard-blocks
  any outbound transition from a terminal state, independent of any graph row.

The platform state graph is seeded as **structural reference** in
`supabase/seeds/06_wo_job_state_graph.sql` (tenant-neutral, idempotent
`ON CONFLICT`): **9 work-order states / 15 transitions** and **6 job states / 10
transitions**. No business data is seeded.

## Work-order state matrix

Platform-default states (a tenant may extend, not weaken). Flags drive the gate.

| State               | terminal | closed | reason req. | jobs run | labor run | add'l work | QC req. | reopenable |
| ------------------- | :------: | :----: | :---------: | :------: | :-------: | :--------: | :-----: | :--------: |
| `draft`             |    no    |   no   |     no      |    no    |    no     |     no     |   no    |     —      |
| `open`              |    no    |   no   |     no      |   yes    |    yes    |    yes     |   no    |     —      |
| `in_progress`       |    no    |   no   |     no      |   yes    |    yes    |    yes     |   no    |     —      |
| `awaiting_parts`    |    no    |   no   |     yes     |   yes    |    no     |    yes     |   no    |     —      |
| `awaiting_customer` |    no    |   no   |     yes     |    no    |    no     |    yes     |   no    |     —      |
| `qc_pending`        |    no    |   no   |     no      |    no    |    no     |     no     |   yes   |     —      |
| `ready_to_close`    |    no    |   no   |     no      |    no    |    no     |     no     |   yes   |     —      |
| `closed`            |   yes    |  yes   |     no      |    no    |    no     |     no     |    —    |   **no**   |
| `cancelled`         |   yes    |  yes   |     yes     |    no    |    no     |     no     |    —    |   **no**   |

### Work-order transitions (platform graph)

Working-state routing edges (11):

```
draft ──► open
open ◄──► in_progress
in_progress ◄──► awaiting_parts
in_progress ◄──► awaiting_customer
in_progress ──► qc_pending
qc_pending ──► in_progress          (QC-fail rework loop)
qc_pending ──► ready_to_close
ready_to_close ──► closed
```

The remaining four seeded transitions route non-terminal states into `cancelled`,
for **15 transitions** over **9 states**. `closed` and `cancelled` are terminal and
frozen — no outbound transition exists (enforced by the terminal flag, the
transition guard, and BR-WO-002). The gate fires on the transition **into** any
`is_closed` state; a `cancelled` target bypasses the work-completeness blockers but
still records history.

## Job state matrix

| State         | terminal | reason req. | assignment req. | labor allowed |    closure-eligible     |
| ------------- | :------: | :---------: | :-------------: | :-----------: | :---------------------: |
| `planned`     |    no    |     no      |       no        |      no       |           no            |
| `assigned`    |    no    |     no      |       yes       |      yes      |           no            |
| `in_progress` |    no    |     no      |       yes       |      yes      |           no            |
| `paused`      |    no    |   **yes**   |       yes       |      no       |           no            |
| `completed`   |   yes    |     no      |        —        |      no       |           yes           |
| `cancelled`   |   yes    |   **yes**   |        —        |      no       | yes (does not block B1) |

### Job transitions (platform graph)

Working-state routing edges (6):

```
planned ──► assigned ──► in_progress
in_progress ◄──► paused
in_progress ──► completed
paused ──► assigned
```

The remaining four seeded transitions route non-terminal states into `cancelled`
(reason required), for **10 transitions** over **6 states**. A job may not enter
`assigned`/`in_progress` without an active assignment (trigger); labor may run only
in `assigned`/`in_progress`. Pause and cancel require a reason; reassignment from
`paused` enforces a reassignment reason. Every real change emits an append-only
`wo.job_status_history` row, coherence-guarded to the live job.
