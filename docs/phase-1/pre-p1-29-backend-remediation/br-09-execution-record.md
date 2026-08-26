# BR-09 — execution record (BLOCKED, preserved)

Assignment Notification Delivery. Targets `BE-6`, `DEP-B6`, finding `INS-25`
(**BLOCKER**) and Owner requirement 6.

|                                   |                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Contract                          | [br-09-assignment-notification-delivery.md](br-09-assignment-notification-delivery.md)                                  |
| Branch                            | `remediation/p1-29-backend-assignment-notification-delivery`                                                            |
| Status                            | **BLOCKED — `BR-09-BLOCK-01`.** Consumer implemented and registered; it cannot function until a grant decision is made. |
| Migrations                        | zero (and that is the problem — see §2)                                                                                 |
| New operations / permission codes | zero                                                                                                                    |

---

## 1. What is built and correct

The consumer exists, is registered, typechecks, and respects every boundary:

- **`wo.job_assigned_notifier`** registered for `job.assigned`, which previously had
  **no consumer at all** — `consumersFor('job.assigned')` returned an empty set, so
  the worker completed the event having done nothing (`INS-25`).
- **No dedupe of its own.** Exactly-once stays `shared.processed_events` keyed
  `(consumer_code, event_id)`.
- **Registration is explicit**, not an import side effect, so it neither depends on
  import order nor becomes unrestorable after `__resetConsumersForTests()`.
- **Foundation boundary respected.** `server/` may not import a domain module
  (rule `B3`), so the notification service is reached through
  `server/contracts/notification-service.ts` — the seam that exists for exactly
  this.
- **Three outcomes**: `applied`, `skipped` (completed-not-delivered, recorded), and
  `throw` (transient → backoff → dead letter).

## 2. `BR-09-BLOCK-01` — the worker cannot execute this slice

**Measured on the live database carrying all 126 migrations**, not inferred:

| fact                                                          | value                |
| ------------------------------------------------------------- | -------------------- |
| `app_worker` USAGE on `wo`                                    | **false**            |
| `app_worker` USAGE on `tech`                                  | **false**            |
| tables `app_worker` may SELECT                                | six, all in `shared` |
| **any `app%` role with INSERT on `shared.outbound_messages`** | **NONE**             |

Two independent failures follow:

1. **The recipient cannot be resolved.** An assignment's technician lives in
   `wo.job_assignments` → `tech.technician_profiles`, and the worker role has
   USAGE on neither schema. The consumer's resolution query fails with
   `permission denied for schema wo`.
2. **The notification cannot be enqueued by anyone.** `queueMessage` performs a
   plain `INSERT INTO shared.outbound_messages`; there is **no SECURITY DEFINER
   enqueue function**, and every GRANT ever written for that table is `SELECT`:

   ```
   20260718105000_shared_outbound_messages.sql:433  GRANT SELECT … TO app_runtime, app_readonly;
   20260728090000_shared_services_runtime_write…:177 GRANT SELECT … TO app_worker;
   ```

   **This is bigger than BR-09.** `DEP-B6` records notifications as
   "enqueue-on-request only" — but no application role can enqueue at all, so the
   request path is equally unable to write. That is a pre-existing defect this
   slice discovered, not one it introduced.

**How it was found:** the suite's last case runs the resolution query through the
_worker role_ rather than the admin connection, precisely so a grant gap fails in
a test instead of in production. It did.

## 3. Why this was not resolved unilaterally

The BR-09 contract states **"Database change: none. No migration, no table, no
column, no policy, no grant."** Delivering the slice needs, at minimum:

- `GRANT USAGE ON SCHEMA wo, tech TO app_worker`
- `GRANT SELECT` on three tables the worker currently cannot see
- `GRANT INSERT ON shared.outbound_messages` to whichever role is to enqueue

That is a **security-posture change**: it widens the worker's reach into two more
schemas and gives write access to the outbound message queue. It is the kind of
decision that should be made deliberately and reviewed on its own, not slipped in
under a slice whose contract forbids exactly it.

**Two designs are available and they are not equivalent**, which is the second
reason not to choose alone:

- **A — widen the worker.** Grants as above. Keeps the effect behind the outbox
  (the contract's stated intent) at the cost of a broader worker role.
- **B — keep the worker narrow.** Put `technicianProfileId`, the recipient's user
  id and the job title in the `job.assigned` **payload**, so the consumer needs no
  `wo`/`tech` access at all. The publisher already holds all three. This is close
  to what the contract assumed the payload contained. It still needs the
  `outbound_messages` INSERT grant, so it shrinks the problem rather than removing
  it.

## 4. A separate contract discrepancy, already resolved

Independent of the blocker, three contract statements did not match the repository
and were resolved against live evidence:

1. **The proposed consumer name is structurally impossible.**
   `ck_processed_events_consumer_code_format` is `^[a-z][a-z0-9_.]{1,62}$` — no
   hyphen — so `wo.job-assigned-notifier` could never be written. Used
   `wo.job_assigned_notifier`. The code is half of a primary key, so it is a stable
   KEY: renaming it later re-delivers every historical event.
2. **The consumed payload fields do not exist.** The contract lists
   `technicianProfileId` and `workOrderId`; the publisher emits exactly
   `{jobId, assignmentId, assignmentRole}`.
3. **`purpose` cannot identify a template.**
   `ck_message_templates_purpose` is a closed vocabulary
   (`transactional | marketing | system`); `template_code` is the identifier.

## 5. `BR-09-OPEN-01` — the channel, still an Owner decision

`ck_message_templates_channel` is exactly `email | in_app`, so "in-app, email, or
both" is **one template row per channel** rather than a third value. The consumer
resolves whichever ACTIVE, APPROVED templates exist for its template code and
enqueues one per channel — so the decision changes **seeded content**, not code.

**Zero templates are seeded today.** The consumer therefore returns `skipped` and
records it; it never claims delivery and never guesses a channel.

## 6. Honest status

**Nothing about this slice may be reported as delivering Owner requirement 6.**
Assigning a technician still notifies nobody, and it will continue to until the
grant decision in §3 is made. The consumer is preserved, registered and correct so
that the decision is the only remaining work.

**No P1-29 screen may claim a notification was sent.**
