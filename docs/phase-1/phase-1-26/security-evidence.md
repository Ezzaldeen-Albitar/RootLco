# Phase 1-26 — security evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

`P1-26-SEC-001` … `P1-26-SEC-004`.

Every claim below names where it is enforced and where it is proven. A claim with
no test behind it is written as a claim, not as evidence.

---

## 1. `P1-26-SEC-001` — permission and resolved-scope enforcement

### Unknown means denied

`apps/web/src/lib/permissions.ts` is unchanged from P1-25 and remains the
authority: a code the actor's set does not contain is **not held**, and there is
no `isAdmin`, no `role === 'owner'`, and no tenant, company or branch identifier
read from client state anywhere in the phase.

**Proven by** `apps/web/tests/navigation.test.ts` — "denies everything when
capabilities are absent" and "shows only the ungated entries to an actor with no
capabilities"; `apps/web/tests/administration.test.ts` — "treats unknown as
denied, and holds no role shortcut".

### The client check is usability, and the code says so

Every screen issues its request regardless. The route-level check renders
`PermissionDeniedState` **instead of** the content — never over it — so a denied
visitor does not cause the first read to be issued at all, and no protected
markup exists to be covered up.

Where the two disagree, the backend wins: `useServerTable` maps a `403` to
`status: 'denied'` and `DataTable` renders the denial in place of the table.

### Every permission code exists

`P1-26-F-011`: the P1-25 Settings entry was gated on `org.settings.read`, a code
in **no operation and no seed catalogue**, so it could never be visible to any
actor who has ever existed. A filter that hides too much looks exactly like a
filter working.

**Proven by** `apps/web/tests/administration.test.ts` — "every code this phase
uses exists in the seeded platform catalogue", read from
`supabase/seeds/04_iam_permission_catalog.sql`, plus a companion assertion that
the broken code is _not_ in it, so the check can fail.

### Scope is server-resolved

`GET /api/v1/auth/session` runs the full authorization pipeline and returns
`tenantId`, `companyIds`, `branchIds` and `permissions` as the server resolved
them **for that request**. Nothing in the phase writes a scope, and no request
body carries one.

Company and branch identifiers appear as **path parameters** on the settings
operations. `requireCompanyInScope` runs `assertScopeWithinAuthority` **before**
`companyExists`, so an identifier outside the caller's authority is refused
identically whether or not it names a real company — typing one buys no
information and no access.

**Proven by** `apps/web/tests/authentication.test.ts` — "treats an EMPTY scope as
unrestricted, not as no access", which is the inversion that would be expensive.

### No protected-content flash

`requireSession` runs in the `(dashboard)` **layout**, before any child page's
markup exists. An expired or missing session redirects; protected markup is never
generated, so it can never be sent and then hidden.

**Proven by** `apps/web/tests/e2e/foundation.spec.ts` — "a protected route
redirects to sign-in and never renders the shell", which asserts the navigation
landmark is absent, across five browser projects.

---

## 2. `P1-26-SEC-002` — sensitive data, exports and file access

| Control                                                                      | Where                                                                                          | Proof                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| No token in `localStorage`, `sessionStorage`, IndexedDB or a persisted store | the session is a `httpOnly` cookie                                                             | `check-p1-26-frontend.mjs` rule `browser-storage`; `administration.test.ts` |
| The cookie is `httpOnly`, `sameSite=lax`, `secure` outside local             | `src/lib/api/session-cookie.ts`                                                                | `authentication.test.ts` — asserted for all three environments              |
| One session-cookie authority                                                 | one file names the cookie                                                                      | gate rule `session-cookie-authority`                                        |
| No secret in URL state                                                       | the table refuses free text in a URL by construction                                           | P1-25 `table-state.ts`; `security.test.ts`                                  |
| No reset or invitation token in a log, a cookie, a URL or a returned state   | the token lives in component state for the life of the form and the fragment is erased on read | `RecoveryTokenBridge`; `authentication.test.ts`                             |
| No `problem.detail` rendered                                                 | only a translation key and the correlation ID                                                  | `FormFeedback`, `action-result.ts`                                          |
| No export of audit records                                                   | none is offered, and the screen says so                                                        | `AuditLogScreen`; there is no export operation to call                      |
| No direct database or Supabase access                                        | the web tier holds no credential                                                               | `check-api-boundary.mjs`, `check-web-topology.mjs`                          |
| No unsafe HTML                                                               |                                                                                                | gate rule `unsafe-html`; `check-api-boundary.mjs`                           |

### Why a `httpOnly` cookie satisfies "no token in browser storage"

The prohibition exists to stop a cross-site scripting defect from reading a
credential. `localStorage`, `sessionStorage`, IndexedDB and a persisted store are
all readable by any script that executes in the document. A `httpOnly` cookie is
**not readable by page script at all** — the browser attaches it and the document
never sees it. That is the property the rule is protecting, satisfied
structurally rather than by convention.

### The refresh token is discarded

`POST /api/v1/auth/login` returns one and there is no `/auth/refresh` operation
in the route tree. Storing a credential nothing can spend would be strictly
worse than not having it. Recorded as `P1-26-OD-006`.

---

## 3. `P1-26-SEC-003` — abuse and privilege escalation

| Attempt                                      | Outcome                               | Where it is refused                                                    |
| -------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| Grant a role the actor cannot delegate       | denied                                | `DelegationPolicy.assertDelegable`, server-side                        |
| Grant a permission the actor does not hold   | denied                                | same                                                                   |
| Change a system role                         | refused                               | `assertNotSystemRole`; the row also offers no control                  |
| Edit another user from the Profile screen    | impossible                            | the action reads `session.userId`; the form carries no identifier      |
| Cross-tenant read                            | fails closed                          | tenant comes from the verified token, never from a request             |
| Cross-company or cross-branch settings write | denied before existence is checked    | `assertScopeWithinAuthority`                                           |
| Hidden-value manipulation (`recordVersion`)  | conflict, never success               | `If-Match`; a wrong version can only cause refusal                     |
| Stale-command replay                         | conflict                              | version-guarded operations; append-only settings versions              |
| Duplicate submission                         | blocked while pending                 | `useFormStatus` disables the submit for the life of the action         |
| Duplicate invitation                         | `ERR-RES-002`, reported as a conflict | the backend refuses a second live token for one identity               |
| Reset-token tampering                        | refused by the provider               | the token is the provider's; shape is bounded, validity is not assumed |
| Session expiry during a privileged action    | reported as expired, not as a failure | `fromFailure` maps 401 to `expired`                                    |

### The escalation rule is not duplicated here

`assertDelegable` is the authority. This phase warns before a high-risk grant and
does **not** re-implement the check — a second implementation of an authorization
rule is a second place for it to be wrong, and the copy with no database behind
it is the one that would be wrong.

---

## 4. `P1-26-SEC-004` — audit-event coverage

Every privileged operation this phase calls carries an `auditClass` and an
`auditAction` **declared by the backend**, and the record is written by the
backend inside the same transaction as the change:

| Screen action                    | Operation                            | Audit action                           |
| -------------------------------- | ------------------------------------ | -------------------------------------- |
| Invite                           | `iam.invitation-create`              | `iam.user.invited`                     |
| Cancel invitation                | `iam.invitation-cancel`              | `iam.user.invitation_cancelled`        |
| Activate                         | `iam.invitation-activate`            | `iam.user.activated`                   |
| Lock / unlock / archive          | `iam.user-status-change`             | `iam.user.locked`                      |
| Revoke sessions                  | `iam.user-session-revoke-all`        | `iam.session.revoked_all`              |
| Create / update role             | `iam.role-create`, `iam.role-update` | `iam.role.created`, `iam.role.updated` |
| Map / change / remove permission | `iam.role-permission-*`              | `iam.role.permission_*`                |
| Create / end approval limit      | `iam.approval-limit-*`               | `iam.approval_limit.created`, `.ended` |
| Tenant settings                  | `iam.tenant-settings-update`         | `org.tenant.settings_updated`          |
| Company / branch settings        | `iam.*-settings-write`               | `org.*.settings_updated`               |
| Reading the audit log            | `iam.audit-event-list`, `-detail`    | `iam.audit.viewed`                     |

`shared.branch-status-change` is **not** in that table. An adapter for it
exists (`changeBranchStatusAction`) and **no screen calls it** — listing it
among shipped actions would have been an audit claim for a code path an operator
cannot reach (`P1-26-F-036`). It is carried for the phase that builds the branch
directory the control would need.

**The Frontend creates no authoritative audit or domain event**, and does not
reproduce transactional-outbox behaviour. It displays a correlation ID, which is
a diagnostic reference, and nothing else.

Where the contract requires a written reason it is collected through
`ReasonConfirmDialog` and sent — an empty one is refused by the backend, and the
dialog refuses it first so the operator is not sent a round trip to learn it.
