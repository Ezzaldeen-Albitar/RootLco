# P1-29 W9 — the First-Owner bootstrap, and the Tenant Administrator set

Owner decisions of 2026-09-02, executed on develop `a419f497`. The three decisions and their
executable consequences; nothing here is a design document.

## 1. The first platform operator is a sanctioned genesis act

`scripts/platform/genesis-platform-operator.mjs` — deployment infrastructure, not an application
route. One transaction on a privileged connection establishes a home tenant reserved for operators
(`org.provision_organization`, activated only after the operator exists), the operator's account, the
three `platform.*` grants, and a `platform.operator.genesis` audit record; optionally the
`app_platform` LOGIN role for `PLATFORM_DATABASE_URL`. It refuses when any other account already
holds a platform grant, is a no-op for the same address that already holds every grant, completes
the same address in its home tenant when it holds fewer (what an environment reset leaves behind —
account and tenant survive, grants and the provisioning function's replay memory do not; measured
on the local acceptance stack), fails closed as a whole, writes rows and never privileges, and
records evidence without a secret in it. Proofs G1–G6:
`tests/backend/p1-29-w9-platform-genesis.test.ts`.

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

| Code                           | Declared by (one of)                                                                                                        | Source             | Exercise |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- |
| `iam.user.read`                | `iam.auth-session`, `iam.user-list`                                                                                         | session            | direct   |
| `iam.user.manage`              | `iam.invitation-create`, `-activate`, `iam.user-*`                                                                          | IAM administration | direct   |
| `iam.role.read`                | `iam.role-list`, `iam.role-permission-list`                                                                                 | IAM administration | direct   |
| `iam.role.manage`              | `iam.role-create`, `iam.role-permission-add`                                                                                | IAM administration | direct   |
| `iam.grant.manage`             | `iam.grant-issue`, `iam.grant-revoke`                                                                                       | IAM administration | direct   |
| `iam.session.view_all`         | `iam.user-status-change` (AND with `iam.user.manage`)                                                                       | IAM administration | direct   |
| `org.tenant.read`              | `iam.tenant-settings-read` — the Administration › Organization screen’s Workspace card                                      | org prerequisite   | direct   |
| `org.company.read`             | `org.company-list`; the Administration › Organization screen; the company a grant scope names                               | org prerequisite   | both     |
| `org.branch.read`              | `org.branch-list`; the Administration › Organization screen; the branch a grant scope names                                 | org prerequisite   | both     |
| `org.department.read`          | `org.department-list` (W3 routing)                                                                                          | org prerequisite   | both     |
| `org.department.manage`        | `org.department-create` — the only writer of a department; W3 routing needs one                                             | org prerequisite   | direct   |
| `tech.technician.manage`       | `tech.technician-create`, `-availability-record` — the only writer of a profile; W3 assignment and every W4 write need one  | org prerequisite   | direct   |
| `wo.work_order.read`           | `wo.work-order-list`, `wo.work-order-detail` (W1–W8)                                                                        | journey            | both     |
| `wo.work_order.transition`     | `wo.work-order-transition` (W3 submit for QA)                                                                               | journey            | both     |
| `wo.work_order.close`          | `wo.work-order-closure` (W8)                                                                                                | journey            | both     |
| `wo.job.manage`                | `wo.job-update` (W3 job edit and routing)                                                                                   | journey            | both     |
| `wo.job.transition`            | `wo.job-transition` — the only route that moves a job into the states that accept labour, diagnostics and QC (W4–W8 proofs) | journey            | both     |
| `wo.additional_work.request`   | `wo.additional-work-request` (W8)                                                                                           | journey            | both     |
| `wo.additional_work.approve`   | `wo.additional-work-approval` (W8)                                                                                          | journey            | both     |
| `tech.technician.read`         | `tech.technician-me-queue` (W4), `wo.job-assignment-list`                                                                   | journey            | both     |
| `tech.assignment.manage`       | `wo.job-assignment-create` (W3)                                                                                             | journey            | both     |
| `tech.labor.record`            | `tech.labor-session-start` (W4), blockers (W8)                                                                              | journey            | both     |
| `tech.labor.correct`           | `tech.labor-session-correct` (W4)                                                                                           | journey / persona  | both     |
| `dia.diagnostic.read`          | `dia.diagnostic-type-list`, templates (W5/W7)                                                                               | journey            | both     |
| `dia.catalogue.manage`         | `dia.template-create` … (W7 catalogue)                                                                                      | journey            | both     |
| `dia.diagnostic.record`        | `dia.template-version-list-publishable`, report (W7)                                                                        | journey            | both     |
| `dia.diagnostic.complete`      | `dia.diagnostic-complete` (W7)                                                                                              | journey            | both     |
| `dia.diagnostic.review`        | `dia.diagnostic-review` (W7, separate actor)                                                                                | persona            | both     |
| `qms.quality_control.read`     | `qms.qc-record-branch-list`, `qms.qc-check-list` (W8)                                                                       | journey            | both     |
| `qms.quality_control.record`   | `qms.qc-record-open`, `qms.qc-check-result` (W8)                                                                            | journey            | both     |
| `qms.quality_control.finalize` | `qms.qc-record-finalize` (W8)                                                                                               | journey            | both     |
| `qms.rework.manage`            | `qms.rework-create` (W8)                                                                                                    | journey            | both     |
| `qms.rework.sign_off`          | `qms.rework-sign-off` (W8, separate actor)                                                                                  | persona            | both     |
| `iam.sensitive.view`           | `wo.additional-work-detail-read`, rework cost (W8)                                                                          | persona            | both     |
| `shared.document.read`         | `shared.document-category-list`, evidence reads (W6)                                                                        | journey            | both     |
| `shared.document.manage`       | `shared.attachment-upload-authorize`, evidence (W6)                                                                         | journey            | both     |

"Both" means the administrator exercises the code directly on the acceptance journey and must also
hold it to delegate it: `ins_role_permissions_delegable` and `ins_role_grants_delegable`
(`supabase/migrations/20260726090000`) admit a mapping or a grant only for codes the acting
administrator holds. The two separation-of-duty codes are held to be delegable; the database still
refuses their direct exercise on the holder's own work.

`org.company.read` and `org.branch.read` were excluded by the first derivation (every screen takes
its target from the session's own scope) and admitted by the acceptance run on the production build
(2026-09-02): this role's grants are unrestricted, so its session scope is empty; the Administration ›
Organization screen shows the company and branch only to a holder of the two codes; and scoping any
other grant (`iam.grant-scope-add`) takes a company and branch identifier nobody can learn without
them. An administrator who cannot name a branch cannot scope a grant, and cannot delegate a code it
does not hold. `org.tenant.read` joined for the same screen’s Workspace card, which the production build refused to the first administrator of its own organization. `wo.job.transition` joined last: a job accepts labour, diagnostics and quality work only from the states `wo.job-transition` puts it in, every W4–W8 proof moves the job through that route, and no screen offers the move — on the production build the technician’s clock answered 409 on a `planned` job and nobody in the organization could change that. The set is 48 codes.

Excluded, with the reason: `iam.approval.manage` and `iam.login.view_all` (no walked route on the
journey declares them), the organisation settings writes `org.settings.manage`, `org.company.manage` and `org.branch.manage` (no walked route declares them; the Organization screen renders read-only without them — residual W9-R2, Owner disposition requested: hold them from provisioning, or leave settings to a later administrative grant), every reception, CRM and
vehicle code beyond the creation path below (W3's customer context is resolved server-side through
the reception port).

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

## 5. Findings from the acceptance run on the production build (2026-09-02)

The first real-provider exercise of the credential paths — the platform operator setting a
password through the shipped `forgot-password` → mailbox → completion route → login sequence —
found one defect and one provider limit. Both are on record with the identity adapter
(`apps/api/src/modules/iam/provider/supabase-provider.ts`); every earlier proof ran against the
fake provider, which cannot show either.

- **Defect, fixed:** `iam.auth-password-reset-completion` answered `401` for every completion
  against the real provider, while the fake provider passed. Two client-library facts the adapter
  had assumed away, both measured with a probe on the local stack: (1) the second client the
  adapter built to carry the recovery session's token in a header serves `updateUser` from its
  own stored session, not from that header, so with `persistSession: false` it refused with
  "session missing" before the provider was asked; (2) the library's `admin.signOut(jwt)` answers
  the same "session missing" from inside the client. The adapter now writes the credential
  through the service role for exactly the identity the recovery token verified, and ends every
  session of that identity with the provider's own `POST /logout?scope=global` carrying the
  recovery session's token — and treats the provider's 401, 403 or 404 as the end state already reached, because the service-role credential change itself ends the identity's sessions at the provider (measured: 403 on the token the recovery exchange had issued).
- **Residual W9-R1, provider limit:** GoTrue 2.x exposes no admin revocation by user id. The
  adapter's `revokeAllSessions(subject)` could never have worked; it is now honest about it. The
  controls that actually end access are unchanged and stated in the code: the API refuses a bearer
  whose RootLco session is revoked (the callers revoke it before reaching the provider), and a
  disabled identity is banned at the provider, which refuses refresh and sign-in. What remains is
  the lifetime of an already-issued provider access token — one hour on the local stack. Owner
  disposition requested: accept the one-hour residual for Phase 1, or shorten the provider's
  access-token lifetime in the environment configuration. Not a P1-29 release blocker: no
  operation grants authority through it, and the API's own session ledger is the enforced control.

The run then continued into the first real provisioning — the operator creating the acceptance
tenant through `POST /platform/organizations` and the invited Owner setting a credential on the
shipped `activate-account` page — and found three more defects, each fixed on the same branch.

- **Defect, fixed (genesis):** the operator's bearer answered `401 ERR-IAM-002` on every
  authenticated call although sign-in had answered `200`. The bearer path resolves the tenant
  from the provider token's `app_metadata.tenant_id` and refuses a token without it; the genesis
  had created the identity but never bound it to its home tenant, so the operator could sign in
  and do nothing. `genesis-platform-operator.mjs` now binds the identity to the home tenant it
  creates, and re-running it reports `identityBoundToHomeTenant`. Sign-in without a caller-supplied
  tenant, then `GET /platform/organizations`, answers `200` on the production build.
- **Defect, fixed (invitation):** the Owner's invitation token was refused as expired on the
  shipped activation page (`iam.auth-password-reset-completion` → `401`). The provider files an
  invitation's token hash under `invite` and a reset's under `recovery`, and the adapter asked only
  for `recovery`, so no invited human could ever set a credential — the page that exists for
  exactly that purpose had never been exercised with a real invitation. The adapter now asks
  `recovery` first and `invite` second, and refuses exactly as before when neither verifies.
  Pinned by `tests/foundation/p1-29-w9-supabase-adapter-units.test.ts`, the adapter's first suite.
- **Defect, fixed (provisioning):** a second provisioning request with a tenant code already in
  use answered `500 ERR-SYS-001` (`uq_tenants_tenant_code` raw in the log). It answers
  `409 ERR-RES-002` now, the same conflict a duplicate role or department code answers.
- **Defect, fixed (bootstrap):** an Owner address that already existed at the provider was reused
  without regard to which organization it was bound to. Sign-in resolves the tenant from that
  binding, so a second organization provisioned for an address bound elsewhere answered `201` and
  could never be entered by its Owner (`no-account` at sign-in). Measured when the acceptance
  tenant was re-provisioned for an address whose earlier binding survived. The bootstrap now
  refuses an address bound to a different organization with `409 ERR-RES-002`, and the
  provisioning transaction unwinds the tenant with it (`W9-B12`).
- **Derivation gap, closed (bundle):** the administrator's session on the production build carried
  an empty company and branch scope (its grants are unrestricted), the Administration › Organization
  screen would show it neither, and scoping a persona's grant needs a branch identifier it had no
  route to read. `org.company.read`, `org.branch.read`, `org.tenant.read` and `wo.job.transition` join the set (44 → 48); the derivation
  record in §3 states the refuted theory and the rule that replaces it.
- **Derivation gap, closed (job transition) + Frontend residual W9-R3:** on the production build the technician’s clock answered `409 ERR-TRN-001` on a `planned` job (corr `7f29570a-2fc7-4106-b58c-0e05f63a0212`); a job accepts labour only from the states `wo.job-transition` puts it in, the code was excluded because no screen calls it, and therefore no human could ever start work. `wo.job.transition` joins the set (47 → 48). The W3 job panel offers routing and assignment but no job-state move — the transition is reachable through the shipped route only (Frontend residual W9-R3, P1-30 candidate). The workspace also reports every 409 as “This record changed since you loaded it” (W9-O4).
- **Residual W9-R4 (Owner content decision):** a fresh organization holds no `dia.diagnostic_types` row — no seed ships and no route creates one (BR-04 DoD item OPEN since 2026-08) — so W7 cannot run for a real workshop and the canonical closure condition §3 cannot be met by code. Disposition requested: approve the initial diagnostic-type vocabulary and its delivery (seed migration or administration route). The QC check vocabulary is unseeded the same way (observation O6).
- **The acceptance itself** — every screen, route, refusal and correlation id — is in `w9-acceptance-record.md`.
- **Environment, not product:** the local identity provider's redirect allow-list holds only the
  API origin, so the invitation mail's link lands on the API instead of the web app; the token in
  that link opened the activation page directly, which is the page's documented contract. And a
  `supabase start` re-issues an asymmetric signing key that the HS256-only verifier refuses
  (`P1-26-F-045`); the shipped alignment helper reported the stack already aligned. Both are
  Database-phase configuration (`supabase/config.toml`), outside this Backend slice's ownership.
