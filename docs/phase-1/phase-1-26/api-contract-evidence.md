# Phase 1-26 — Backend contract archaeology

**Classification:** Confidential — Commercial Product and Pilot Planning

Measured from the tree at the P1-26 base SHA `3598de62`, by reading every
`defineOperation({...})` under `apps/api/src/app/api/v1/{auth,iam,org,organization,audit-events}`.

**196 route handlers exist repository-wide. 29 of them are in P1-26's surface.**

---

## 1. Authentication

| Operation                            | Method · path                          | Public | Permission      | Scope  | Audit | Notes                                                                                                                                                  |
| ------------------------------------ | -------------------------------------- | ------ | --------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `iam.auth-login`                     | `POST /auth/login`                     | yes    | —               | —      | none  | body `{tenantId, email, password}`; returns `{accessToken, refreshToken, expiresAt, user{id,email,displayName,tenantId}}`; rate policy `auth-adjacent` |
| `iam.auth-logout`                    | `POST /auth/logout`                    | yes    | —               | —      | none  | bearer token is the authority; idempotent; returns `{status:'signed-out'}`                                                                             |
| `iam.auth-session`                   | `GET /auth/session`                    | no     | `iam.user.read` | tenant | none  | returns `{userId, tenantId, email, displayName, companyIds[], branchIds[], permissions[]}`                                                             |
| `iam.auth-password-reset`            | `POST /auth/password-reset`            | yes    | —               | —      | none  | body `{email, redirectTo?}`; **always 202 `{status:'accepted'}`**                                                                                      |
| `iam.auth-password-reset-completion` | `POST /auth/password-reset/completion` | yes    | —               | —      | none  | body `{token(8..2048), password(1..200)}`; returns `{status:'password-updated'}`                                                                       |

**Every authentication failure is `ERR-IAM-002` with one message.** Unknown
tenant, unknown address, wrong password, unconfirmed identity, disabled
identity, `invited`, `locked`, `archived`, tenant mismatch — all identical, by
design (`authentication-service.ts` §1). The Frontend must not add a distinction
the Backend deliberately removed.

`tenantId` is a **lookup key, never a grant**. It is required on login and the
Frontend must therefore collect it. A guessed tenant learns nothing: the answer
is the same generic failure.

## 2. Invitation and activation

| Operation                 | Method · path                               | Permission        | Audit                           | Concurrency                 |
| ------------------------- | ------------------------------------------- | ----------------- | ------------------------------- | --------------------------- |
| `iam.invitation-create`   | `POST /iam/invitations`                     | `iam.user.manage` | `iam.user.invited`              | idempotent                  |
| `iam.invitation-cancel`   | `DELETE /iam/invitations/{userId}`          | `iam.user.manage` | `iam.user.invitation_cancelled` | body `{reason}`             |
| `iam.invitation-activate` | `POST /iam/invitations/{userId}/activation` | `iam.user.manage` | `iam.user.activated`            | idempotent; body `{reason}` |

Invite body: `{email, displayName, mfaRequired?, redirectTo?, roleIds?[≤20]}`.

**There is no invitation table and no invitation token minted by RootLco.** The
provider owns the token, its single use and its lifetime (ADR-019); invitation
_state_ is `iam.user_accounts.status`. Duplicate address in tenant →
`ERR-RES-002`. Role grants are bounded by the inviter's own delegable authority
and a system role is refused outright.

**Activation is administrative, and deliberately so.** `iam.has_permission`
returns false for a non-`active` account, so an invitee cannot activate itself.
`activate()` asks the provider whether the identity is confirmed and **refuses**
if it is not — the invitee's acceptance is a verified precondition of the
administrator's action.

Consequence for the Frontend: the invitee-facing `/activate-account` screen sets
a password through `POST /auth/password-reset/completion` using the provider
recovery token from the invitation mail. It cannot and must not claim to
activate the account. The administrative activation lives on the Users screen.

## 3. Users

| Operation                     | Method · path                         | Permission                                 | Guard                                                                                     |
| ----------------------------- | ------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `iam.user-list`               | `GET /iam/users`                      | `iam.user.read`                            | query `{cursor?, limit?, status?, search?}`; `status ∈ invited\|active\|locked\|archived` |
| `iam.user-detail`             | `GET /iam/users/{userId}`             | `iam.user.read`                            | —                                                                                         |
| `iam.user-update`             | `PATCH /iam/users/{userId}`           | `iam.user.manage`                          | **`If-Match` required**; body `{displayName?, mfaRequired?}`                              |
| `iam.user-session-list`       | `GET /iam/users/{userId}/sessions`    | `iam.session.view_all`                     | —                                                                                         |
| `iam.user-session-revoke-all` | `DELETE /iam/users/{userId}/sessions` | `iam.user.manage` + `iam.session.view_all` | body `{reason}`                                                                           |
| `iam.user-status-change`      | `POST /iam/users/{userId}/status`     | `iam.user.manage` + `iam.session.view_all` | idempotent; body `{status ∈ active\|locked\|archived, reason}`                            |

## 4. Roles, permissions, grants

| Operation                    | Method · path                                        | Permission         | Guard                                                                                        |
| ---------------------------- | ---------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `iam.role-list`              | `GET /iam/roles`                                     | `iam.role.read`    | cursor page                                                                                  |
| `iam.role-create`            | `POST /iam/roles`                                    | `iam.role.manage`  | idempotent; `{roleCode ^[a-z][a-z0-9_]{1,62}$, name, description?}`                          |
| `iam.role-update`            | `PATCH /iam/roles/{roleId}`                          | `iam.role.manage`  | **`If-Match`**; `{name?, description?, archive?}`                                            |
| `iam.permission-list`        | `GET /iam/permissions`                               | `iam.role.read`    | the platform permission catalogue                                                            |
| `iam.role-permission-list`   | `GET /iam/roles/{roleId}/permissions`                | `iam.role.read`    | —                                                                                            |
| `iam.role-permission-add`    | `POST /iam/roles/{roleId}/permissions`               | `iam.role.manage`  | idempotent; `{permissionCode, effect ∈ allow\|deny}`                                         |
| `iam.role-permission-update` | `PATCH /iam/roles/{roleId}/permissions/{mappingId}`  | `iam.role.manage`  | **`If-Match`**; `{effect}`                                                                   |
| `iam.role-permission-remove` | `DELETE /iam/roles/{roleId}/permissions/{mappingId}` | `iam.role.manage`  | —                                                                                            |
| `iam.grant-issue`            | `POST /iam/grants`                                   | `iam.grant.manage` | idempotent; `{userId, roleId, validTo?, approvalRef?, scopes?[≤50]}`                         |
| `iam.grant-revoke`           | `DELETE /iam/grants/{grantId}`                       | `iam.grant.manage` | **`If-Match`**; `{reason}`                                                                   |
| `iam.grant-scope-list`       | `GET /iam/grants/{grantId}/scopes`                   | `iam.role.read`    | —                                                                                            |
| `iam.grant-scope-add`        | `POST /iam/grants/{grantId}/scopes`                  | `iam.grant.manage` | idempotent; `{scopeType ∈ company\|branch\|department, companyId, branchId?, departmentId?}` |
| `iam.grant-scope-remove`     | `DELETE /iam/grants/{grantId}/scopes/{scopeId}`      | `iam.grant.manage` | —                                                                                            |

There is **no role-delete** and **no role-detail** operation. Archiving is
`PATCH … {archive:true}`. There is **no assigned-user count** on a role; the
Users screen is where a grant is visible.

## 5. Approval limits

| Operation                   | Method · path                          | Permission            | Guard                                             |
| --------------------------- | -------------------------------------- | --------------------- | ------------------------------------------------- |
| `iam.approval-limit-list`   | `GET /iam/approval-limits`             | `iam.approval.manage` | query `{companyId?, userId?}` — **not paginated** |
| `iam.approval-limit-create` | `POST /iam/approval-limits`            | `iam.approval.manage` | idempotent                                        |
| `iam.approval-limit-end`    | `PATCH /iam/approval-limits/{limitId}` | `iam.approval.manage` | **`If-Match`**; `{effectiveTo:YYYY-MM-DD}`        |

Create body, exactly:
`{companyId, roleId?|null, userId?|null, limitType ^[a-z][a-z0-9_]{1,62}$, amount ^\d{1,14}(\.\d{1,4})?$, currency ^[A-Z]{3}$, effectiveFrom YYYY-MM-DD, effectiveTo?|null}`.

`amount` is a **decimal string** matched by a regular expression. It must never
pass through a JavaScript number. `limitType` and `currency` are operator-
supplied: the contract fixes their _shape_, not their _meaning_, so the Frontend
supplies neither a default limit type nor a default currency.

## 6. Organization

| Operation                     | Method · path                                   | Permission            | Scope   | Guard                                                                                                                      |
| ----------------------------- | ----------------------------------------------- | --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `iam.tenant-settings-read`    | `GET /org/tenant`                               | `org.tenant.read`     | tenant  | returns `{id, tenantCode, displayName, status, defaultLocale, defaultTimezone, recordVersion}`                             |
| `iam.tenant-settings-update`  | `PATCH /org/tenant`                             | `org.settings.manage` | tenant  | **`If-Match`**; `{displayName?, defaultLocale?, defaultTimezone?}`                                                         |
| `iam.company-settings-read`   | `GET /org/companies/{companyId}/settings`       | `org.company.read`    | company | —                                                                                                                          |
| `iam.company-settings-write`  | `POST /org/companies/{companyId}/settings`      | `org.settings.manage` | company | idempotent; `{settingKey ^[a-z][a-z0-9_.]{1,126}$, settingValue, valueType ∈ string\|number\|boolean\|json, isSensitive?}` |
| `iam.branch-settings-read`    | `GET /org/branches/{branchId}/settings`         | `org.branch.read`     | branch  | —                                                                                                                          |
| `iam.branch-settings-write`   | `POST /org/branches/{branchId}/settings`        | `org.settings.manage` | branch  | same body shape                                                                                                            |
| `shared.branch-status-read`   | `GET /organization/branches/{branchId}/status`  | `org.branch.read`     | branch  | transitions available                                                                                                      |
| `shared.branch-status-change` | `POST /organization/branches/{branchId}/status` | `org.settings.manage` | branch  | **`If-Match`**; `{to ∈ active\|inactive, reason}`                                                                          |

Settings are **append-only versioned rows**: a write inserts the next version for
that key and the current value is the highest version. A concurrent writer that
takes the version first produces `ERR-CON-001`. A value that does not match its
declared type produces `ERR-VAL-001`. `isSensitive` values are **withheld**, not
masked — the caller learns the key exists and is configured, not its shape.

`tenant_code` and tenant `status` are absent from the update contract by design;
tenant status is an owner/operator capability (ADR-008).

Locale and timezone are foreign keys to `shared.languages` and
`shared.timezones`. An unregistered value produces `ERR-VAL-001` "not a
registered platform value" — the Frontend surfaces that verdict and does not
pre-validate against a list it does not have.

## 7. Audit

| Operation                | Method · path                  | Permission       | Notes                                                                                                                                    |
| ------------------------ | ------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `iam.audit-event-list`   | `GET /audit-events`            | `iam.audit.view` | `from` and `to` are **required** ISO datetimes; plus `cursor?, limit?, action?, entityType?, entityId?, actorId?, companyId?, branchId?` |
| `iam.audit-event-detail` | `GET /audit-events/{recordId}` | `iam.audit.view` | details masked unless the caller holds sensitive-view                                                                                    |

Both are themselves audited (`auditClass: 'security'`, `iam.audit.viewed`):
reading the audit log is a recorded act.

The mandatory bounded range means the screen must open with **some** range. It
opens on the last seven days, which is a presentation default the operator
changes freely — not a business rule.

## 8. Operations that do not exist

Read directly from the route tree, not inferred.

| P1-26 screen                | Backing table in the database         | Approved HTTP operation                                       |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Numbering rules             | `sal.invoice_numbering_configs`       | **none**                                                      |
| Taxes                       | `org.tax_classes`, `org.tax_rates`    | **none**                                                      |
| Currencies                  | `shared.currencies`                   | **none**                                                      |
| Languages                   | `shared.languages`                    | **none** (tenant `defaultLocale` only)                        |
| System settings             | `shared.system_settings`              | **none** (tenant/company/branch settings only)                |
| Company / branch directory  | `org.legal_companies`, `org.branches` | **none** — no list or name-read operation                     |
| Self-service profile update | `iam.user_accounts`                   | **none** — `PATCH /iam/users/{id}` requires `iam.user.manage` |

Findings `P1-26-F-003` … `P1-26-F-009` record each of these with its
disposition. **No endpoint was invented, and no screen claims a capability the
Backend does not publish.**
