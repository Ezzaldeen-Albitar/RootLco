# Phase 1-26 — task register

**Classification:** Confidential — Commercial Product and Pilot Planning

31 tasks: 18 Frontend, 4 Security, 5 QA, 2 DevOps, 2 Documentation.

A task is **Complete** only when its acceptance condition is proven by a named
test or a named evidence file. "Implemented" is not "complete".

Disposition: **Complete** · **Complete with recorded limitation** — the
acceptance condition is met for everything the platform publishes, and what it
does not publish is named in `findings.md`.

---

## Frontend — 18 / 18

| ID             | Screen                | Backend contract                                                                           | Disposition                                                      |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `P1-26-FE-001` | Login                 | `iam.auth-login`                                                                           | **Complete**                                                     |
| `P1-26-FE-002` | Forgot password       | `iam.auth-password-reset`                                                                  | **Complete**                                                     |
| `P1-26-FE-003` | Password reset        | `iam.auth-password-reset-completion`                                                       | **Complete**                                                     |
| `P1-26-FE-004` | User invitation       | `iam.invitation-create`, `-cancel`, `iam.role-list`                                        | **Complete**                                                     |
| `P1-26-FE-005` | Account activation    | `iam.auth-password-reset-completion` (invitee) · `iam.invitation-activate` (administrator) | **Complete with recorded limitation** — `P1-26-F-009` context    |
| `P1-26-FE-006` | Profile               | `iam.auth-session`, `iam.user-detail`, `iam.user-update`                                   | **Complete with recorded limitation** — `P1-26-F-009`            |
| `P1-26-FE-007` | Session expiration    | `iam.auth-session`, `iam.auth-logout`                                                      | **Complete**                                                     |
| `P1-26-FE-008` | Organization settings | `iam.tenant-settings-*`, `iam.company-settings-*`, `iam.branch-settings-*`                 | **Complete with recorded limitation** — `P1-26-F-008`            |
| `P1-26-FE-009` | Users                 | `iam.user-list`, `-detail`, `-update`, `-status-change`, `-session-*`                      | **Complete**                                                     |
| `P1-26-FE-010` | Roles                 | `iam.role-list`, `-create`, `-update`                                                      | **Complete with recorded limitation** — no delete, no user count |
| `P1-26-FE-011` | Permissions           | `iam.permission-list`, `iam.role-permission-*`                                             | **Complete**                                                     |
| `P1-26-FE-012` | Approval limits       | `iam.approval-limit-*`                                                                     | **Complete with recorded limitation** — `P1-26-F-010`, `F-018`   |
| `P1-26-FE-013` | Numbering rules       | organization settings — **no dedicated operation** (`P1-26-F-003`)                         | **Complete with recorded limitation**                            |
| `P1-26-FE-014` | Taxes                 | organization settings — **no dedicated operation** (`P1-26-F-004`)                         | **Complete with recorded limitation**                            |
| `P1-26-FE-015` | Currencies            | organization settings — **no dedicated operation** (`P1-26-F-005`)                         | **Complete with recorded limitation**                            |
| `P1-26-FE-016` | Languages             | `iam.tenant-settings-*` — **no catalogue operation** (`P1-26-F-006`)                       | **Complete with recorded limitation**                            |
| `P1-26-FE-017` | Audit log             | `iam.audit-event-list`, `-detail`                                                          | **Complete with recorded limitation** — no export                |
| `P1-26-FE-018` | System settings       | tenant / company / branch settings — **no platform scope** (`P1-26-F-007`)                 | **Complete with recorded limitation**                            |

### Acceptance notes worth keeping

**`FE-001` Login.** Every credential failure is indistinguishable; only a rate
limit and an outage differ, because neither is a credential verdict. Double
submit blocked by `useFormStatus`. The token reaches only a `httpOnly` cookie.
The post-login transition is a redirect, so no protected markup is produced
before the session exists.

**`FE-002` Forgot password.** The same success state for every outcome except a
rate limit and an outage. The form is replaced by the confirmation. `redirectTo`
is not sent.

**`FE-003` Password reset.** The token is read from the query **or** the
fragment, erased from the address bar in **both** shapes (`P1-26-F-021`), and
never written to storage, a cookie, a log or a returned state. No `next` /
`returnTo` / `redirect` parameter exists anywhere in the flow.

**`FE-005` Activation.** The invitee sets a password through the approved public
operation; the screen states that an administrator completes activation, because
no request path exists that would let an invitee activate itself.

**`FE-006` Profile.** Read-only without `iam.user.manage`, and it says so. The
user identifier comes from the session, never from the form.

**`FE-007` Session expiration.** `requireSession` runs in the layout, before any
child page's markup exists. A 401 clears the cookie; a **403 does not**
(`P1-26-F-022`) — clearing a valid credential because a permission is missing
produced an unbreakable sign-in loop.

**`FE-009` Users.** Every row action is a confirmation with a written reason,
because four of the operations require one. Only legal transitions are offered.
The status filter has a control that applies it (`P1-26-F-031`).

**`FE-012` Approval limits.** Money is a decimal string end to end;
`inputMode="decimal"`, never `type="number"`. Above the server's 200-row cap the
screen says the list may be incomplete rather than calling a window a set
(`P1-26-F-018`).

**`FE-017` Audit log.** Field names are copied from the API, not chosen
(`P1-26-F-017`). A withheld detail is distinct from an absent one. No export is
offered, because no export operation exists.

---

## Security — 4 / 4

| ID              | Scope                                     | Disposition  | Evidence                  |
| --------------- | ----------------------------------------- | ------------ | ------------------------- |
| `P1-26-SEC-001` | Permission and resolved-scope enforcement | **Complete** | `security-evidence.md` §1 |
| `P1-26-SEC-002` | Sensitive data, exports, file access      | **Complete** | §2                        |
| `P1-26-SEC-003` | Abuse and privilege escalation            | **Complete** | §3                        |
| `P1-26-SEC-004` | Security audit-event coverage             | **Complete** | §4                        |

## QA — 5 / 5

| ID             | Scope                                | Disposition                           | Evidence                              |
| -------------- | ------------------------------------ | ------------------------------------- | ------------------------------------- |
| `P1-26-QA-001` | Unit and component coverage          | **Complete**                          | `qa-evidence.md` §1                   |
| `P1-26-QA-002` | API contract and error-path coverage | **Complete**                          | §2                                    |
| `P1-26-QA-003` | Tenant / company / branch isolation  | **Complete with recorded limitation** | `isolation-evidence.md` §4            |
| `P1-26-QA-004` | Concurrency and idempotency          | **Complete**                          | `concurrency-idempotency-evidence.md` |
| `P1-26-QA-005` | Regression and evidence packaging    | **Complete**                          | `evidence/`                           |

## DevOps — 2 / 2

| ID             | Scope                                         | Disposition                           | Evidence                                                   |
| -------------- | --------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `P1-26-DO-001` | CI quality gate with mutation tests           | **Complete**                          | `ci-evidence.md` §1 — 27 mutation tests                    |
| `P1-26-DO-002` | Structured logging, monitoring, alert routing | **Complete with recorded limitation** | §2 — adapter boundary only; no external service is claimed |

## Documentation — 2 / 2

| ID              | Scope                                                | Disposition                                              |
| --------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `P1-26-DOC-001` | Contract, catalogue and traceability synchronisation | **Complete**                                             |
| `P1-26-DOC-002` | Operator and developer guidance                      | **Complete** — `operator-guide.md`, `developer-guide.md` |

---

## Totals

| Group         | Complete | Total  |
| ------------- | -------- | ------ |
| Frontend      | 18       | 18     |
| Security      | 4        | 4      |
| QA            | 5        | 5      |
| DevOps        | 2        | 2      |
| Documentation | 2        | 2      |
| **Total**     | **31**   | **31** |

**"Complete with recorded limitation" is counted as complete**, and that is a
claim worth defending: in every case the acceptance condition is met for
everything the platform publishes, and the part it does not publish is named in
`findings.md` with a disposition, stated in the interface, and listed in
`known-limitations.md`. What is _not_ claimed anywhere is that the missing
capability exists.
