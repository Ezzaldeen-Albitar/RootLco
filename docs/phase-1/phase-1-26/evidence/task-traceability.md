# Phase 1-26 — task traceability

**Classification:** Confidential — Commercial Product and Pilot Planning

Every task, the operations it calls, the files it produced, and the named proof.
The machine-readable form is `task-traceability.json`.

---

## Frontend

| Task                        | Operations                                                      | Output                                                                             | Proof                                                                                  |
| --------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `FE-001` Login              | `iam.auth-login`                                                | `(auth)/login/page.tsx`, `LoginForm.tsx`, `actions/login.ts`                       | `authentication.test.ts`; `e2e/foundation.spec.ts` — sign-in form, Arabic RTL          |
| `FE-002` Forgot password    | `iam.auth-password-reset`                                       | `(auth)/forgot-password/page.tsx`, `ForgotPasswordForm.tsx`                        | `authentication.test.ts` — forgot schema asks for no tenant                            |
| `FE-003` Password reset     | `iam.auth-password-reset-completion`                            | `(auth)/reset-password/page.tsx`, `SetPasswordForm.tsx`, `RecoveryTokenBridge.tsx` | `authentication.test.ts` — token bounds, fixed post-reset path; `e2e` — no-token state |
| `FE-004` Invitation         | `iam.invitation-create`, `-cancel`, `iam.role-list`             | `users/actions.ts`, `UsersScreen.tsx`                                              | `administration.test.ts`; `api-client.test.ts` — idempotency key                       |
| `FE-005` Activation         | `iam.auth-password-reset-completion`, `iam.invitation-activate` | `(auth)/activate-account/page.tsx`, `users/actions.ts`                             | `authentication.test.ts`; `api-contract-evidence.md` §2                                |
| `FE-006` Profile            | `iam.auth-session`, `iam.user-detail`, `iam.user-update`        | `(dashboard)/profile/page.tsx`, `ProfileForm.tsx`, `actions/profile.ts`            | `authentication.test.ts` — scope; `api-client.test.ts` — `If-Match`                    |
| `FE-007` Session expiration | `iam.auth-session`, `iam.auth-logout`                           | `api/session.ts`, `session-cookie.ts`, `(dashboard)/layout.tsx`                    | `authentication.test.ts` — cookie attributes; `e2e` — redirect with no shell           |
| `FE-008` Organization       | `iam.tenant-settings-*`, `iam.*-settings-*`                     | `administration/organization/*`                                                    | `administration.test.ts` — coercion, keys                                              |
| `FE-009` Users              | `iam.user-*`                                                    | `administration/users/*`                                                           | `administration.test.ts`; `api-client.test.ts`                                         |
| `FE-010` Roles              | `iam.role-list`, `-create`, `-update`                           | `access/components/RolesScreen.tsx`                                                | `administration.test.ts` — cursor mode                                                 |
| `FE-011` Permissions        | `iam.permission-list`, `iam.role-permission-*`                  | `access/components/PermissionsScreen.tsx`                                          | `administration.test.ts` — catalogue drift                                             |
| `FE-012` Approval limits    | `iam.approval-limit-*`                                          | `access/components/ApprovalLimitsScreen.tsx`                                       | `administration.test.ts` — money as strings; `data-table.dom.test.tsx`                 |
| `FE-013` Numbering          | organization settings                                           | `administration/numbering-rules/page.tsx`                                          | `administration.test.ts` — no default ships                                            |
| `FE-014` Taxes              | organization settings                                           | `administration/taxes/page.tsx`                                                    | as above; rate declared `string`                                                       |
| `FE-015` Currencies         | organization settings                                           | `administration/currencies/page.tsx`                                               | as above                                                                               |
| `FE-016` Languages          | `iam.tenant-settings-*`                                         | `administration/languages/page.tsx`                                                | `i18n.test.ts`                                                                         |
| `FE-017` Audit log          | `iam.audit-event-*`                                             | `administration/audit/*`                                                           | field names copied from `audit-repository.ts` (`F-017`)                                |
| `FE-018` System settings    | tenant / company / branch settings                              | `administration/system-settings/page.tsx`                                          | `administration.test.ts`                                                               |

## Security

| Task      | Proof                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SEC-001` | `navigation.test.ts` — unknown means denied · `administration.test.ts` — catalogue membership, two-permission operations · `e2e` — no shell before redirect                                      |
| `SEC-002` | `authentication.test.ts` — cookie attributes, token bounds · `check-p1-26-frontend.mjs` rules `browser-storage`, `session-cookie-authority`, `unsafe-html` · `observability.test.ts` — redaction |
| `SEC-003` | `security-evidence.md` §3 — each attempt mapped to where it is refused                                                                                                                           |
| `SEC-004` | `security-evidence.md` §4 — the `auditClass`/`auditAction` the backend declares for every operation this phase calls                                                                             |

## QA

| Task     | Proof                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QA-001` | `authentication.test.ts`, `administration.test.ts`, `observability.test.ts`, `data-table.dom.test.tsx`, `navigation.test.ts`, `table-state.test.ts` |
| `QA-002` | `api-client.test.ts` — every failure kind, idempotency, `If-Match`, no mutation retry                                                               |
| `QA-003` | `authentication.test.ts` — empty scope is unrestricted · `isolation-evidence.md` §4 names what is not proven                                        |
| `QA-004` | `concurrency-idempotency-evidence.md`; `api-client.test.ts`                                                                                         |
| `QA-005` | this file, `test-register.md`, `changed-file-ownership.md`                                                                                          |

## DevOps

| Task     | Proof                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DO-001` | `tests/ci/p1-26-frontend-gate.test.ts` — 26 mutation tests; the gate caught its own author's violation during this phase |
| `DO-002` | `observability.test.ts` — redaction by key and by value shape, route sanitising, adapter null until attached             |

## Documentation

| Task      | Proof                                                                                 |
| --------- | ------------------------------------------------------------------------------------- |
| `DOC-001` | `api-contract-evidence.md`, `findings.md`, this register, `changed-file-ownership.md` |
| `DOC-002` | `operator-guide.md`, `developer-guide.md`                                             |
