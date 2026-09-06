/**
 * The two roles the First-Owner bootstrap writes (P1-29 W9; Owner decisions 2
 * and 3 of 2026-09-02). SERVER-OWNED: no request names a role code or a
 * permission code, and the route's `.strict()` body refuses any attempt to.
 *
 * Both are ordinary, editable tenant roles (`is_system = false`): the codes are
 * labels the bootstrap writes, never something the runtime branches on
 * (PRE29-AD-06). After the bootstrap window closes the tenant administers
 * them under the normal delegation rules like any other role.
 *
 * ## `first_owner` — frozen B7, exactly three codes
 *
 * The narrow bootstrap IAM authority: enough to establish the tenant's IAM,
 * nothing else. Not a business super-role; not widened here or anywhere.
 * Frozen by the Owner on 2026-08-31 (wave-b-slice-05 contract §2, design v2
 * §6.3.1) and preserved verbatim by decision 2 of 2026-09-02.
 *
 * ## `tenant_administrator` — the explicit finite administration set
 *
 * Derived from the executable repository on 2026-09-02 by walking every route
 * the W1–W8 experiences call, the authentication/session routes, the IAM
 * administration routes, the personas the P1-29 acceptance journey needs, and
 * the organisation reads those routes require — 132 operations walked, each
 * code below declared by at least one of them. The role code reuses the name
 * the repository's own six-role baseline already carries for this actor
 * (tests/db/iam-seeds.test.ts, docs/database/permission-catalog-reference.md).
 *
 * Why the administrator holds the journey's codes and not only IAM codes: the
 * runtime's delegation rule (`ins_role_permissions_delegable`,
 * `ins_role_grants_delegable`, 20260726090000) lets an actor map or grant only
 * codes they themselves hold. The personas that exercise P1-29 — coordinator,
 * technician, timekeeper, template author, diagnostic recorder, independent
 * reviewer, QC finalizer, sensitive viewer — are established by this
 * administrator through `iam.role-create`, `iam.role-permission-add` and
 * `iam.invitation-create`, so every code a persona needs is a code the
 * administrator must hold. The two separation-of-duty codes
 * (`dia.diagnostic.review`, `qms.rework.sign_off`) are held to be delegable;
 * the database still refuses their direct exercise on the holder's own work.
 *
 * One precondition the W1–W8 walk cannot see and the journey on a production
 * build cannot do without: a work order EXISTS only through P1-28's reception
 * conversion (`rec.reception-convert-to-work-order` is the sole in-product
 * writer of `wo.work_orders`; no seed and no other operation creates one).
 * The receptionist persona that creates it — customer and vehicle intake, the
 * reception visit, its party role and authorization, signature, approval, and
 * the conversion — is therefore a persona this administrator must be able to
 * establish, so its codes are held. They are the P1-28 acceptance matrix's own
 * rows FE-006, FE-007, FE-009, FE-018, FE-020 and FE-022, each declared by the
 * route named there.
 *
 * `org.company.read` and `org.branch.read` were first excluded on the theory
 * that every screen takes its target from the session's own scope. The
 * acceptance run on the production build refuted that for THIS role: its
 * grants are unrestricted, so its session scope is empty; the Administration
 * › Organization screen shows the company and branch only to a holder of
 * those two codes; and scoping anyone else's grant (`iam.grant-scope-add`)
 * takes a company and branch identifier nobody can learn without them. An
 * administrator who cannot name a branch cannot scope a grant, and cannot
 * delegate a code it does not hold. Both are held, and so is `org.tenant.read`
 * — the same screen's Workspace card (`iam.tenant-settings-read`), which the
 * production build refused to the first administrator of its own organization.
 * The settings WRITES (`org.settings.manage`, `org.company.manage`,
 * `org.branch.manage`) stay out: no walked route on the journey declares them,
 * and the card renders read-only without them (residual W9-R2, Owner
 * disposition requested in the derivation record).
 *
 * `wo.job.transition` was excluded because no W1–W8 adapter calls it — and
 * that is exactly why it must be held: a job accepts labour, diagnostics and
 * quality work only from the states `wo.job-transition` puts it in
 * (`tech.guard_labor_session`; every W4–W8 proof moves the job to `assigned`,
 * `in_progress`, `qc_pending` … through that route), and no screen offers
 * the move. On the production build the technician's clock answered 409 on
 * a `planned` job and nobody in the organization could change that. The
 * code is held and delegable; the missing control is a Frontend residual
 * (W9-R3) recorded in the derivation record.
 *
 * Excluded on purpose, each with its reason in the W9 derivation record:
 * `platform.*` (never a tenant code), `iam.login.view_all` (no walked route on
 * the journey declares it), and the reception, CRM and vehicle codes beyond the
 * creation path above (W3's customer context is resolved server-side through the
 * reception port under scope-only policies, and no W1–W8 screen writes them).
 *
 * ## The P1-30 commercial block (corrective slice, 2026-09-06)
 *
 * The derivation above walked ONE phase's routes, and the blind spot was exactly
 * the shape of that method: the set carried no `svc.`, `quo.`, `inv.` or `sal.`
 * code at all. Because `ins_role_permissions_delegable` admits a mapping only
 * when the acting administrator already holds the code being mapped, that was
 * not an inconvenience an operator could work around — it was a CLOSURE. No
 * principal in a tenant created by the shipped provisioning operation could ever
 * hold a commercial code, so the service catalogue, pricing, quotation,
 * inventory, invoice and payment surfaces P1-30 ships were unreachable in every
 * such tenant, permanently. Measured at develop `029fc20d`: across the six
 * organisations on the stack, roles held ZERO `sal.*` codes between them.
 *
 * The seventeen codes below are DERIVED, not chosen: each is declared by a P1-30
 * screen's own contract (`apps/web/src/features/{services,pricing,quotations,
 * inventory,billing,payments}/*-contract.ts`) or gates one of its navigation
 * entries, and each already exists in the 118-code catalogue — this slice mints
 * none. `iam.approval.manage` moves out of the exclusion list above for the same
 * reason it was in it: the rule was "no walked route declares it", and W3's
 * quotation screen now walks `iam.approval-limit-list`.
 *
 * They are held so they can be DELEGATED. The commercial personas a workshop
 * actually runs — a service advisor, a parts keeper, a cashier — are roles the
 * Owner creates, and an administrator can create none of them out of codes it
 * does not hold.
 *
 * The bundle is written ONCE, at provisioning. Organisations created before this
 * slice keep the set they were given; bringing them forward is a backfill
 * decision, recorded as a residual rather than performed here.
 */

export interface BootstrapRoleDefinition {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly permissionCodes: readonly string[];
}

export const FIRST_OWNER_ROLE: BootstrapRoleDefinition = Object.freeze({
  code: 'first_owner',
  name: 'First Owner',
  description:
    'Bootstrap IAM authority established at provisioning: manages users, roles and grants. Not a business role.',
  permissionCodes: Object.freeze(['iam.user.manage', 'iam.role.manage', 'iam.grant.manage']),
});

export const TENANT_ADMINISTRATOR_ROLE: BootstrapRoleDefinition = Object.freeze({
  code: 'tenant_administrator',
  name: 'Tenant Administrator',
  description:
    'Tenant administration established at provisioning: session reachability, IAM administration, the organisation reads the workshop screens require, and every code the P1-29 and P1-30 personas need, so that they can be delegated.',
  permissionCodes: Object.freeze([
    // Session reachability and IAM administration (direct).
    'iam.user.read',
    'iam.user.manage',
    'iam.role.read',
    'iam.role.manage',
    'iam.grant.manage',
    'iam.session.view_all',
    // Organisation prerequisites the journey's screens and personas need (direct).
    'org.tenant.read',
    'org.company.read',
    'org.branch.read',
    'org.department.read',
    'org.department.manage',
    'tech.technician.manage',
    // The W1–W8 journey: held to be exercised and to be delegated to the personas.
    'wo.work_order.read',
    'wo.work_order.transition',
    'wo.work_order.close',
    'wo.job.manage',
    'wo.job.transition',
    'wo.additional_work.request',
    'wo.additional_work.approve',
    'tech.technician.read',
    'tech.assignment.manage',
    'tech.labor.record',
    'tech.labor.correct',
    'dia.diagnostic.read',
    'dia.catalogue.manage',
    'dia.diagnostic.record',
    'dia.diagnostic.complete',
    'dia.diagnostic.review',
    'qms.quality_control.read',
    'qms.quality_control.record',
    'qms.quality_control.finalize',
    'qms.rework.manage',
    'qms.rework.sign_off',
    'iam.sensitive.view',
    'shared.document.read',
    'shared.document.manage',
    // The work order's own precondition on a production build: P1-28's
    // creation path, held so the receptionist persona can be established.
    'crm.customer.read',
    'crm.customer.create',
    'crm.customer.vehicle.manage',
    'veh.vehicle.read',
    'veh.vehicle.manage',
    'rec.reception.read',
    'rec.reception.manage',
    'rec.reception.party.manage',
    'rec.reception.authorization.verify',
    'rec.reception.signature.manage',
    'rec.reception.approve',
    'rec.reception.convert',
    // The P1-30 commercial chain: held to be exercised and to be delegated to
    // the commercial personas. Each is declared by a shipped P1-30 screen or
    // gates one of its navigation entries; none is minted here.
    'svc.service.read',
    'svc.service.manage',
    'svc.price.read',
    'svc.price.manage',
    'svc.price.publish',
    'quo.quotation.read',
    'quo.quotation.manage',
    'quo.decision.record',
    'iam.approval.manage',
    'inv.item.read',
    // The catalogue write — items, categories, units, and (until a code of its
    // own is decided) stock locations. The seventeen commercial codes above
    // were derived from the shipped P1-30 SCREENS, and no screen wrote the
    // inventory master data because no operation did; the F-02 remeasurement
    // of 2026-09-06 added the operations, and this is the authority they need.
    'inv.item.manage',
    'inv.stock.read',
    'inv.stock.operate',
    // Held so the Owner can DELEGATE it: an opening batch is maker–checker
    // (`ck_opening_inventory_batches_maker`), so the administrator who counts
    // cannot also approve, and an approver role can only be built out of a
    // code the administrator holds. Without it no stock could ever appear in a
    // fresh organisation — the F-02 remeasurement of 2026-09-06 found this
    // the one AUTHORIZATION gap left after PR #321.
    'inv.adjustment.approve',
    'sal.invoice.manage',
    'sal.invoice.issue',
    'sal.finance.view',
    'sal.payment.record',
    'sal.payment.allocate',
  ]),
});
