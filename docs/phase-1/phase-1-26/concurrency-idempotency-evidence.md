# Phase 1-26 — concurrency and idempotency evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

`P1-26-QA-004`.

---

## 1. `If-Match`, and why it is never defaulted

Six operations in P1-26's surface declare `versionGuarded: true`. The backend
refuses each of them outright with `ERR-CON-002` when the header is absent —
which is the correct failure, because an unguarded update is a lost update
waiting to happen.

| Operation                                       | Where the version comes from                          |
| ----------------------------------------------- | ----------------------------------------------------- |
| `PATCH /org/tenant`                             | the tenant record the form was rendered from          |
| `PATCH /iam/users/{id}`                         | the account record the profile form was rendered from |
| `PATCH /iam/roles/{id}`                         | the row the operator acted on                         |
| `PATCH /iam/roles/{id}/permissions/{mappingId}` | the mapping row                                       |
| `PATCH /iam/approval-limits/{id}`               | the limit row                                         |
| `DELETE /iam/grants/{id}`                       | the grant row                                         |
| `POST /organization/branches/{id}/status`       | the branch status view                                |

**The version travels with the rendered record.** Two alternatives were rejected:

- **Sending a constant.** Guarantees the guard never fires.
- **Re-reading and using whatever comes back.** Converts the guard into a
  lost update: the re-read picks up the other writer's version, the update
  succeeds, and their change is silently overwritten. This is the more dangerous
  option because it _looks_ correct and the operator sees a success.

`recordVersion` travels in a hidden field on the forms. That is not a
capability: a tampered version can only cause the update to be **refused** as a
conflict, never to succeed against a record the actor may not touch.

## 2. Settings are append-only, and a race is reported

Company and branch settings insert the **next version** for a key. A concurrent
writer that takes that version first produces a unique violation, which the
service translates to `ERR-CON-001`.

The action reports it as a conflict. It does **not** re-read and re-submit:
the loser's value was based on a state that is no longer current, and silently
retrying would overwrite whatever the winner just decided.

## 3. Idempotency

Five operations declare `idempotent: true` — invitation create, invitation
activate, user status change, role create, role-permission add, grant issue,
grant scope add, approval-limit create. The backend's idempotency keys make a
deliberate retry safe.

**This phase issues no automatic retry on any mutation.** `ApiClient.send` has no
retry path at all. Retrying is the caller's deliberate act, and no caller in
P1-26 does it. A retried POST that actually succeeded the first time creates a
second record, and the transport layer is the wrong place to decide that risk is
acceptable.

## 4. Double submit

Blocked by `useFormStatus`, which reads the pending state of the form the button
is inside. It is owned by React, so an action that redirects or throws cannot
leave the flag stuck — the failure mode of a manually-tracked `pending` boolean,
where the form is dead until the page is reloaded.

Row actions run inside `useTransition`; the confirmation dialog's confirm button
is disabled while `isPending`.

## 5. Duplicate and stale cases

| Case                                                        | Outcome                                                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Invite an address that already has an account in the tenant | `ERR-RES-002` → conflict, with its own sentence. Deliberate: re-inviting would issue a second live token for one identity. |
| Activate an invitation the provider has not confirmed       | refused with `invitation_not_accepted` → its own sentence, because it is a precondition, not a fault                       |
| Activate twice                                              | idempotent server-side                                                                                                     |
| Reuse a reset token                                         | refused by the provider; one message, one next step                                                                        |
| Cancel an invitation that is no longer `invited`            | `ERR-VAL-001`                                                                                                              |
| Archive an archived account                                 | the action is not offered — `archived` is terminal                                                                         |

## 6. What is not claimed

**Concurrency is not claimed for read-only operations.** The audit log, the
permission catalogue and every list have no version guard and none is asserted.
Pretending a read participates in optimistic concurrency would be evidence of
nothing.

**Real concurrent-writer races are proven in the Database tier**, not here —
`tests/db/p1-09-concurrency.test.ts`, `p1-11-concurrency.test.ts`,
`crm-concurrency.test.ts`, `veh-concurrency.test.ts` and `number-sequences.test.ts`
run parallel writers against the real database. The Frontend's contribution is to
send the guard and to report the verdict; it cannot create or prevent the race.
