# P1-29 W9 — the First-Owner bootstrap, and the Tenant Administrator set

Owner decisions of 2026-09-02, executed on develop `a419f497`. The three decisions and their
executable consequences; nothing here is a design document.

## 1. The first platform operator is a sanctioned genesis act

`scripts/platform/genesis-platform-operator.mjs` — deployment infrastructure, not an application
route. One transaction on a privileged connection establishes a home tenant reserved for operators
(`org.provision_organization`, activated only after the operator exists), the operator's account, the
three `platform.*` grants, and a `platform.operator.genesis` audit record; optionally the
`app_platform` LOGIN role for `PLATFORM_DATABASE_URL`. It refuses when any other account already
holds a platform grant, is a no-op for the same address that already holds every grant, fails closed
as a whole, writes rows and never privileges, and records evidence without a secret in it. Proofs
G1–G5: `tests/backend/p1-29-w9-platform-genesis.test.ts`.

## 2. `first_owner` is preserved exactly

`apps/api/src/modules/iam/domain/bootstrap-roles.ts` — `FIRST_OWNER_ROLE`: role code `first_owner`,
`is_system = false`, unrestricted grant, account inserted `active`, and exactly
`iam.user.manage`, `iam.role.manage`, `iam.grant.manage`. Recovered from the planning-branch freeze
(`planning/pre-p1-29-wave-b-revision-5` at `5f7da460`, slice-05 contract §2 and design v2 §6.3.1),
brought onto develop as the constant the bootstrap writes, and pinned by proof W9-B2.

## 3. A separate `tenant_administrator` role, with an explicit finite set

`TENANT_ADMINISTRATOR_ROLE` in the same file. The role code is the one the repository's own six-role
baseline already carries for this actor (`tests/db/iam-seeds.test.ts`,
`docs/database/permission-catalog-reference.md`); the bootstrap writes it `is_system = false`.

The set was derived mechanically on 2026-09-02 by walking 132 operations — every route the W1–W8
experiences call, the authentication/session routes, the IAM administration routes, and the
organisation reads those routes require — and then checked twice independently (completeness against
every walked declaration; minimality and legality against the catalogue). Every code is declared by
at least one operation on the journey. `platform.*`, wildcards and codes no walked operation declares
are absent by construction.

| Code                           | Declared by (one of)                                                                                                       | Source             | Exercise |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- |
| `iam.user.read`                | `iam.auth-session`, `iam.user-list`                                                                                        | session            | direct   |
| `iam.user.manage`              | `iam.invitation-create`, `-activate`, `iam.user-*`                                                                         | IAM administration | direct   |
| `iam.role.read`                | `iam.role-list`, `iam.role-permission-list`                                                                                | IAM administration | direct   |
| `iam.role.manage`              | `iam.role-create`, `iam.role-permission-add`                                                                               | IAM administration | direct   |
| `iam.grant.manage`             | `iam.grant-issue`, `iam.grant-revoke`                                                                                      | IAM administration | direct   |
| `iam.session.view_all`         | `iam.user-status-change` (AND with `iam.user.manage`)                                                                      | IAM administration | direct   |
| `org.department.read`          | `org.department-list` (W3 routing)                                                                                         | org prerequisite   | both     |
| `org.department.manage`        | `org.department-create` — the only writer of a department; W3 routing needs one                                            | org prerequisite   | direct   |
| `tech.technician.manage`       | `tech.technician-create`, `-availability-record` — the only writer of a profile; W3 assignment and every W4 write need one | org prerequisite   | direct   |
| `wo.work_order.read`           | `wo.work-order-list`, `wo.work-order-detail` (W1–W8)                                                                       | journey            | both     |
| `wo.work_order.transition`     | `wo.work-order-transition` (W3 submit for QA)                                                                              | journey            | both     |
| `wo.work_order.close`          | `wo.work-order-closure` (W8)                                                                                               | journey            | both     |
| `wo.job.manage`                | `wo.job-update` (W3 job edit and routing)                                                                                  | journey            | both     |
| `wo.additional_work.request`   | `wo.additional-work-request` (W8)                                                                                          | journey            | both     |
| `wo.additional_work.approve`   | `wo.additional-work-approval` (W8)                                                                                         | journey            | both     |
| `tech.technician.read`         | `tech.technician-me-queue` (W4), `wo.job-assignment-list`                                                                  | journey            | both     |
| `tech.assignment.manage`       | `wo.job-assignment-create` (W3)                                                                                            | journey            | both     |
| `tech.labor.record`            | `tech.labor-session-start` (W4), blockers (W8)                                                                             | journey            | both     |
| `tech.labor.correct`           | `tech.labor-session-correct` (W4)                                                                                          | journey / persona  | both     |
| `dia.diagnostic.read`          | `dia.diagnostic-type-list`, templates (W5/W7)                                                                              | journey            | both     |
| `dia.catalogue.manage`         | `dia.template-create` … (W7 catalogue)                                                                                     | journey            | both     |
| `dia.diagnostic.record`        | `dia.template-version-list-publishable`, report (W7)                                                                       | journey            | both     |
| `dia.diagnostic.complete`      | `dia.diagnostic-complete` (W7)                                                                                             | journey            | both     |
| `dia.diagnostic.review`        | `dia.diagnostic-review` (W7, separate actor)                                                                               | persona            | both     |
| `qms.quality_control.read`     | `qms.qc-record-branch-list`, `qms.qc-check-list` (W8)                                                                      | journey            | both     |
| `qms.quality_control.record`   | `qms.qc-record-open`, `qms.qc-check-result` (W8)                                                                           | journey            | both     |
| `qms.quality_control.finalize` | `qms.qc-record-finalize` (W8)                                                                                              | journey            | both     |
| `qms.rework.manage`            | `qms.rework-create` (W8)                                                                                                   | journey            | both     |
| `qms.rework.sign_off`          | `qms.rework-sign-off` (W8, separate actor)                                                                                 | persona            | both     |
| `iam.sensitive.view`           | `wo.additional-work-detail-read`, rework cost (W8)                                                                         | persona            | both     |
| `shared.document.read`         | `shared.document-category-list`, evidence reads (W6)                                                                       | journey            | both     |
| `shared.document.manage`       | `shared.attachment-upload-authorize`, evidence (W6)                                                                        | journey            | both     |

"Both" means the administrator exercises the code directly on the acceptance journey and must also
hold it to delegate it: `ins_role_permissions_delegable` and `ins_role_grants_delegable`
(`supabase/migrations/20260726090000`) admit a mapping or a grant only for codes the acting
administrator holds. The two separation-of-duty codes are held to be delegable; the database still
refuses their direct exercise on the holder's own work.

Excluded, with the reason: `iam.approval.manage` and `iam.login.view_all` (no walked route on the
journey declares them), `org.company.read` / `org.branch.read` (every screen takes its target from the
session's own scope), `wo.job.transition` (no W1–W8 adapter calls it), every reception, CRM and
vehicle code (W3's customer context is resolved server-side through the reception port).

## 4. How the bootstrap runs

`platform.organization-provision` now carries the whole act (design v2 §6.2 + §6.3, frozen contract:
"B7 publishes no new operation"). The body gains `owner` (email, display name, optional allow-listed
return destination — identity and profile only) and a top-level `activate`. Order, in one transaction
on the control-plane connection as `app_platform`:

1. `org.provision_organization` — tenant, history, subscription, company, branch, settings,
   overrides, sequences, replay record; `tenant.activate` is never forwarded, so the tenant is
   `provisioning` and the §6.3 window is open;
2. `withPlatformTarget` (`apps/api/src/server/db/transaction.ts`) — the platform-on-target context,
   derived from what step 1 returned: refuses the primary connection, and refuses any tenant this
   transaction did not create or that is no longer provisioning;
3. the identity through the configured provider's invite (reused if the address already has one),
   the account `active` with its status row, `first_owner`, `tenant_administrator`, their mappings
   resolved through the catalogue, an unrestricted grant of each, and the invariant check (exactly two
   grants);
4. the `org.tenant.provisioned` audit record in the new tenant's own trail, with the account and role
   identifiers and whether activation was requested — never a credential;
5. only then, if `activate` was requested and the caller also holds
   `platform.organization.lifecycle` (checked before the first write), the transition to `active`.

Any refusal anywhere throws and the route's transaction rolls everything back: the committed states
are nothing, or a tenant with its administrator. The DB delta is one migration
(`20260902130000`): a column-scoped read of `iam.permissions (id, permission_code)` under an
authority-predicated policy, and EXECUTE on the delegation backstop the grant trigger calls at commit.
The bootstrap policies of `20260831093000` are untouched — measured live before the migration was
written, they admit the two-role shape as they stand.

Proofs W9-B1…B10, the real login and the role-administration proof:
`tests/backend/p1-29-w9-owner-bootstrap.test.ts`.
