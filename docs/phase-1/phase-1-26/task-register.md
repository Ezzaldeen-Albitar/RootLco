# Phase 1-26 — task register

**Classification:** Confidential — Commercial Product and Pilot Planning

31 tasks: 18 Frontend, 4 Security, 5 QA, 2 DevOps, 2 Documentation.

A task is **Complete** only when its acceptance condition is proven by a named
test or a named evidence file. "Implemented" is not "complete".

Disposition: **Complete** · **In progress** · **Not started** ·
**Complete with recorded limitation** — the acceptance condition is met for
everything the platform publishes, and what it does not publish is named in
`findings.md`.

---

## Frontend

| ID             | Screen                | Backend contract                                                                                      | Disposition                                                                                         |
| -------------- | --------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `P1-26-FE-001` | Login                 | `iam.auth-login`                                                                                      | **Complete**                                                                                        |
| `P1-26-FE-002` | Forgot password       | `iam.auth-password-reset`                                                                             | **Complete**                                                                                        |
| `P1-26-FE-003` | Password reset        | `iam.auth-password-reset-completion`                                                                  | **Complete**                                                                                        |
| `P1-26-FE-004` | User invitation       | `iam.invitation-create`, `iam.invitation-cancel`, `iam.role-list`                                     | Not started                                                                                         |
| `P1-26-FE-005` | Account activation    | `iam.auth-password-reset-completion` (invitee) · `iam.invitation-activate` (administrator)            | **Complete with recorded limitation** — `P1-26-F-009` context; administrator half lands with FE-009 |
| `P1-26-FE-006` | Profile               | `iam.auth-session`, `iam.user-detail`, `iam.user-update`                                              | **Complete with recorded limitation** — `P1-26-F-009`                                               |
| `P1-26-FE-007` | Session expiration    | `iam.auth-session`, `iam.auth-logout`                                                                 | **Complete**                                                                                        |
| `P1-26-FE-008` | Organization settings | `iam.tenant-settings-*`, `iam.company-settings-*`, `iam.branch-settings-*`, `shared.branch-status-*`  | Not started                                                                                         |
| `P1-26-FE-009` | Users                 | `iam.user-list`, `iam.user-detail`, `iam.user-update`, `iam.user-status-change`, `iam.user-session-*` | Not started                                                                                         |
| `P1-26-FE-010` | Roles                 | `iam.role-list`, `iam.role-create`, `iam.role-update`                                                 | Not started                                                                                         |
| `P1-26-FE-011` | Permissions           | `iam.permission-list`, `iam.role-permission-*`                                                        | Not started                                                                                         |
| `P1-26-FE-012` | Approval limits       | `iam.approval-limit-*`                                                                                | Not started                                                                                         |
| `P1-26-FE-013` | Numbering rules       | organization settings — **no dedicated operation** (`P1-26-F-003`)                                    | Not started                                                                                         |
| `P1-26-FE-014` | Taxes                 | organization settings — **no dedicated operation** (`P1-26-F-004`)                                    | Not started                                                                                         |
| `P1-26-FE-015` | Currencies            | organization settings — **no dedicated operation** (`P1-26-F-005`)                                    | Not started                                                                                         |
| `P1-26-FE-016` | Languages             | `iam.tenant-settings-*` — **no catalogue operation** (`P1-26-F-006`)                                  | Not started                                                                                         |
| `P1-26-FE-017` | Audit log             | `iam.audit-event-list`, `iam.audit-event-detail`                                                      | Not started                                                                                         |
| `P1-26-FE-018` | System settings       | tenant / company / branch settings — **no platform scope** (`P1-26-F-007`)                            | Not started                                                                                         |

### `P1-26-FE-001` — Login

- **Requirement** §13 of the P1-26 instruction package.
- **Inputs** `tenantId` (uuid), `email`, `password`.
- **Output** `apps/web/src/app/[locale]/(auth)/login/page.tsx`,
  `features/authentication/components/LoginForm.tsx`,
  `features/authentication/actions/login.ts`.
- **Acceptance** every credential failure is indistinguishable; rate-limit and
  outage are distinguishable because neither is a credential verdict; no field
  error names an account; double submit is blocked by `useFormStatus`; the token
  reaches only a `httpOnly` cookie; the post-login transition is a redirect, so
  no protected markup is produced before the session exists.
- **Evidence** `docs/phase-1/phase-1-26/security-evidence.md` §1;
  `apps/web/tests/authentication.test.ts`.

### `P1-26-FE-002` — Forgot password

- **Acceptance** the same success state for every outcome except a rate-limit and
  an outage; the form is replaced by the confirmation rather than left beneath
  it; no address existence is disclosed; `redirectTo` is not sent, because the
  allow-list lives in the backend and a value invented here would either be
  refused or force someone to widen it.

### `P1-26-FE-003` — Password reset

- **Acceptance** the token is read from the query **or the URL fragment**, erased
  from the address bar on first read, and never written to storage, a cookie, a
  log or a returned state; expired, invalid and already-used are one message with
  one useful next step; the success state states that other sessions ended;
  there is no `next`/`returnTo` parameter anywhere in the flow.

### `P1-26-FE-005` — Account activation

- **Acceptance** the invitee sets a password through the approved public
  operation; the screen states that an administrator completes activation,
  because `iam.has_permission` returns false for a non-`active` account and no
  request path exists that would let an invitee activate itself. A screen
  claiming "your account is now active" would be wrong every time.

### `P1-26-FE-006` — Profile

- **Acceptance** read-only unless the actor holds `iam.user.manage`, and it says
  so rather than presenting a form the backend will refuse; the update uses
  `If-Match` with the version the form was rendered from; the user identifier
  comes from the session, never from the form, so the screen cannot be turned
  into an edit-any-user surface by a hidden field.

### `P1-26-FE-007` — Session expiration

- **Acceptance** `requireSession` runs in the `(dashboard)` layout, before any
  child page's markup exists, so protected content is never produced; a rejected
  token is cleared on the way out, which is what makes the redirect terminal
  instead of a loop; the sign-in page performs no session check, which is the
  other half of that guarantee.

---

## Security

| ID              | Scope                                     | Disposition |
| --------------- | ----------------------------------------- | ----------- |
| `P1-26-SEC-001` | Permission and resolved-scope enforcement | Not started |
| `P1-26-SEC-002` | Sensitive data, exports, file access      | Not started |
| `P1-26-SEC-003` | Abuse and privilege escalation            | Not started |
| `P1-26-SEC-004` | Security audit-event coverage             | Not started |

## QA

| ID             | Scope                                | Disposition |
| -------------- | ------------------------------------ | ----------- |
| `P1-26-QA-001` | Unit and component coverage          | Not started |
| `P1-26-QA-002` | API contract and error-path coverage | Not started |
| `P1-26-QA-003` | Tenant / company / branch isolation  | Not started |
| `P1-26-QA-004` | Concurrency and idempotency          | Not started |
| `P1-26-QA-005` | Regression and evidence packaging    | Not started |

## DevOps

| ID             | Scope                                         | Disposition |
| -------------- | --------------------------------------------- | ----------- |
| `P1-26-DO-001` | CI quality gate with mutation tests           | Not started |
| `P1-26-DO-002` | Structured logging, monitoring, alert routing | Not started |

## Documentation

| ID              | Scope                                                | Disposition |
| --------------- | ---------------------------------------------------- | ----------- |
| `P1-26-DOC-001` | Contract, catalogue and traceability synchronisation | In progress |
| `P1-26-DOC-002` | Operator and developer guidance                      | Not started |

---

## Totals

| Group         | Complete | Total  |
| ------------- | -------- | ------ |
| Frontend      | 6        | 18     |
| Security      | 0        | 4      |
| QA            | 0        | 5      |
| DevOps        | 0        | 2      |
| Documentation | 0        | 2      |
| **Total**     | **6**    | **31** |
