# BR-09 — Assignment Notification Delivery (execution record)

Targets `BE-6`, `DEP-B6`, finding `INS-25` (**BLOCKER**) and Owner requirement 6.

|                                   |                                                              |
| --------------------------------- | ------------------------------------------------------------ |
| Contract                          | `br-09-assignment-notification-delivery.md`                  |
| Branch                            | `remediation/p1-29-backend-br-09-assignment-notification`    |
| Base                              | `4082e396` — `origin/develop` at the `job.assigned` v2 merge |
| Ownership profile                 | `p1-29-backend`                                              |
| New migrations                    | **0**                                                        |
| New operations / permission codes | **0**                                                        |

---

## 1. Four claims in the preserved record were wrong, and they are corrected first

The earlier BR-09 branch is **63 commits behind develop and holds 3 of its own**, so it is
re-cut rather than resumed. Its record carried four statements that do not survive contact
with the live database. Each correction below is measured, not argued.

### 1.1 `dead_letter` is a STATUS, not a table

The record described dead-lettering as a destination. It is a value of
`shared.event_outbox.status`:

```
CHECK (status IN ('pending', 'claimed', 'published', 'dead_letter'))
```

Migrations creating a table by that name: **zero**. The consumer therefore implements no
dead-letter storage and references none. It THROWS; the existing worker moves the row's
status after the attempt ceiling and writes `shared.error_records`.

### 1.2 schemaVersion 1 never carried the fields the contract said the consumer used

The contract listed `technicianProfileId` and `workOrderId` among the consumed fields. The
v1 publisher emitted exactly `{jobId, assignmentId, assignmentRole}` — three fields, neither
of them those. The earlier record noted this and filed it under "already resolved", which it
was not: it was deferred. It is resolved now, by `job.assigned` **schemaVersion 2**, merged
separately as its own published-contract change.

### 1.3 Worker-side resolution through `wo`/`tech` is impossible BY DESIGN

The record presented "widen the worker" as a live option. It is not one, and the boundary is
not a gap awaiting a grant:

```
has_table_privilege('app_worker','shared.template_versions','SELECT')  ->  false
app_worker USAGE on wo    ->  false
app_worker USAGE on tech  ->  false
```

`message-dispatch-repository.ts` already recorded that the worker gets "nothing at all" on
the template tables, and `message-dispatcher.ts` that rendered content is "never persisted,
never logged". The platform had decided this before BR-09 was written.

### 1.4 "No application role has INSERT on `shared.outbound_messages`" was FALSE

The record stated this as a measured fact, and that "every GRANT ever written for that table
is `SELECT`". Both are false. `app_runtime` holds **15 column-level INSERT grants** on that
table today — thirteen from the original request path, two added by the approval-witness
migration. The request-side enqueue path existed and worked the whole time.

Two instruments agreed on the wrong answer, which is why it looked corroborated:
`information_schema.role_table_grants` reports TABLE-level grants only and is blind to
column-level ones, and a single-line grep missed a statement whose target sits three lines
below `GRANT INSERT`. The live database settles it by ERROR CLASS —
`new row violates row-level security policy` (the grant passed) versus
`permission denied for table` (it did not).

## 2. The architecture, stated correctly

**REQUEST PATH — unchanged, and it always worked.** `app_runtime` →
`NotificationService.queueMessage` → direct INSERT under `ins_outbound_messages_enqueue` and
tenant RLS. It reads templates, renders, and keeps the database guard's CURRENT-state check.

**WORKER PATH — new.** `job.assigned` v2 → this consumer → facts carried by the event →
worker enqueue authority (column GRANT + `wkr_outbound_messages_enqueue_scope`) → an
`outbound_messages` row that can only be `pending`, naming a real `template_version_id`
proved approved by an immutable witness.

The worker reads no business table and no template table. It does not even read the witness:
the database validates the carried witness through
`fk_outbound_messages_approval_witness` when the row is inserted.

## 3. What the consumer may and may not touch

| may                                  | may NOT                        |
| ------------------------------------ | ------------------------------ |
| the event envelope                   | `wo`                           |
| the v2 immutable payload             | `tech`                         |
| `shared.processed_events` (existing) | `shared.message_templates`     |
| the existing retry / dead-letter STATUS machinery | `shared.template_versions` |
| the proven worker enqueue path       | `shared.template_version_approvals` |

No consumer-local dedupe. No new delivery platform.

## 4. Status

**Nothing here may be reported as delivering Owner requirement 6 until this lands.**
Assigning a technician still notifies nobody, and no P1-29 screen may claim otherwise.
