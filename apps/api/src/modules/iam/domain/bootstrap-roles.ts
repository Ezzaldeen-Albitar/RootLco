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
 * The settings WRITE `org.settings.manage` stays out: no walked route on the
 * journey declares it, and the card renders read-only without it (residual
 * W9-R2, Owner disposition requested in the derivation record).
 * `org.company.manage` and `org.branch.manage` were withheld on that same ground
 * until the Owner directive of 2026-09-16 shipped `org.company-create` and
 * `org.branch-create`, which declare them. The Owner decided they are carried:
 * without them the first administrator of an organisation could never add a
 * second legal company or a second branch, and nobody else in the organisation
 * could either, because nobody could be delegated a code nobody holds.
 * Organisations provisioned before that decision are brought up to the bundle by
 * `scripts/platform/backfill-tenant-administrator-bundle.mjs`, which reads this
 * list rather than carrying a copy of it.
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
 *
 * ## The P1-31 delivery, warranty and reporting block (prerequisite P-1)
 *
 * The same closure a third time, in a third namespace. The P1-31 A0 preflight
 * (`docs/phase-1/phase-1-31/a0-preflight.md`, prerequisite P-1) measured that
 * neither bootstrap role held ANY `sal.delivery`, `wty.`, `rpt.` or `iam.audit`
 * code, and `ins_role_permissions_delegable` admits a mapping only when the
 * acting administrator already holds the code being mapped. So no principal in
 * an organisation created by `platform.organization-provision` could hold one,
 * or ever be granted one — closing all sixteen P1-31 scope items and the audit
 * screen that already ships.
 *
 * The six codes added below are DERIVED by the rule the P1-30 A0 matrix set:
 * a code is proposed only when a SHIPPED operation declares it, and each is
 * already a row in the permission catalogue seed — this slice mints nothing and
 * adds no migration. Declaration is the NECESSARY condition, not the sufficient
 * one: `rpt.export` clears it and is still withheld (CC-04 below). Each one,
 * with the operation that declares it:
 *
 *  - `sal.delivery.manage` — `sal.delivery-create`, `sal.delivery-receiver-verify`,
 *    `sal.delivery-checklist-record`, `sal.delivery-signature-attach`, and the
 *    INSERT half of `ins_authorized_receivers_gated` / the signatures policy.
 *  - `sal.delivery.view` — the eligibility read and the SELECT half of
 *    `sel_authorized_receivers_gated` and `sel_delivery_signatures_gated`. Not
 *    bookkeeping: `sal.complete_delivery` is `SECURITY INVOKER` and two of its
 *    three gates read those tables, so a holder without it is told there is no
 *    authorized receiver for a delivery whose receiver is verified. A0 measured
 *    the eligibility read failing on this ONE code, the bundle already holding
 *    its companion `sal.finance.view`.
 *  - `sal.delivery.complete` — `sal.delivery-complete`, and the sole overridable
 *    blocker (`financial_balance_outstanding`, `OVERRIDABLE_BLOCKERS`). The
 *    high-risk authority is held on the same reasoning as `wo.work_order.close`
 *    and `qms.quality_control.finalize`, which the bundle already carries: an
 *    administrator can build a delivery-officer role only out of codes it holds.
 *  - `wty.warranty.issue` — `wty.warranty-generate`. It also gated
 *    `wty.warranty-detail` until 2026-09-08; see the P-7 entry below.
 *  - `rpt.report.read` — `rpt.report-catalogue` and `rpt.report-read`.
 *  - `iam.audit.view` — `iam.audit-event-list`, `iam.audit-event-detail` and the
 *    four `sel_*_permitted` audit policies. The Audit Log screen already ships.
 *
 * ### CC-01 AND CC-02 ARE NOW CLOSED; ONE exclusion remains (P1-31 CC-04)
 *
 * The three were excluded on two different grounds, and the kinds were never
 * recorded as though they were the same. Two were excluded because nothing
 * declared them; the third is excluded although something does. The undeclared
 * pair are now both declared, and both are held below; the third is still
 * withheld, and on grounds that have not moved.
 *
 * `wty.policy.manage` was the first of the undeclared pair, and **P-10 closed
 * it on 2026-09-09 exactly as CC-01 said it would.** The code is now declared by
 * five registered operations — `wty.warranty-policy-create`,
 * `wty.warranty-policy-rename`, `wty.warranty-policy-status-set`,
 * `wty.warranty-coverage-create` and `wty.warranty-coverage-status-set` — which
 * publish the warranty policy and coverage write surface PPD-04 measured as
 * absent. So the ground for withholding it is gone, and the rule CC-01 stated
 * applies: "the slice that publishes them owns the widening". It is held below.
 *
 * Withholding it now would be worse than withholding it was: `resolvePolicy`
 * refuses a company with no active warranty policy, so an administrator who
 * could not create one could never issue a warranty in a freshly provisioned
 * organisation, and could not delegate the authority to anyone either.
 *
 * `rpt.report.configure` was the second, and **P-11 closed it on 2026-09-09
 * exactly as CC-02 said it would.** The code is now declared by seven registered
 * operations — the two report-configuration reads and the five commands that
 * create, rename, re-status, version and publish-a-version of a report
 * definition — which publish the configuration write surface A0 measured as
 * absent. The same rule applies, and it is held below.
 *
 * Withholding it now would be worse than withholding it was for the same shape
 * of reason: both published report reads filter on `status = 'published'`, and
 * nothing but this code can set that value — so an administrator who could not
 * configure a report could never see one either, in a freshly provisioned
 * organisation, and could not delegate the authority to anyone.
 *
 * EXISTING organisations do not gain either code automatically — this constant
 * is read at provisioning time — so
 * `scripts/platform/backfill-tenant-administrator-bundle.mjs` owes them ONE
 * operator run covering both newly approved codes, exactly as it did for the P-1
 * and P-7 widenings. The run is an operator act and is not performed by this
 * slice.
 *
 * Both followed the `inv.item.manage` sequence exactly: excluded here while no
 * route declared the code, and carried on the day the routes that declare it
 * landed — #322 for `inv.item.manage`, P-10 for `wty.policy.manage`, P-11 for
 * `rpt.report.configure`.
 *
 * `rpt.export` is the third and now the only one, and it is excluded on
 * DIFFERENT grounds — least
 * privilege, by an explicit Owner decision of 2026-09-08 (CC-04). Two shipped
 * operations do declare it, `shared.export-authorize` and
 * `shared.export-catalogue`, so the "nothing declares it" rule above would have
 * carried it. What that rule does not weigh is REACH: `rpt.export` is not a
 * P1-31 code at all but the platform-wide export switch of P1-15, and the
 * bundle already holds the entitlements all three registered resources use
 * (`shared.document.read`, `org.branch.read`) and the sensitive-field second
 * permission (`iam.sensitive.view`). Carrying it would therefore let the
 * administrator of a one-day-old organisation authorize bulk export of
 * documents, outbound messages and branch data, sensitive fields included,
 * before anyone had decided that it should.
 *
 * Excluding it delays nothing that this phase can reach. The reporting items
 * that would consume an export are still blocked regardless — P-11 published the
 * report CONFIGURATION writer and deliberately not the engine, which waits on
 * Owner decision D-4, so there is still no way to run a report and no
 * `POST /reports/{reportCode}:export` route (P-12) — so the only capability
 * withheld today is the one described above. CONSEQUENCE, on the same terms
 * CC-01 and CC-02 were recorded in before they closed: a freshly provisioned
 * administrator is refused `ERR-IAM-001` by `shared.export-catalogue` and
 * `shared.export-authorize`, and cannot delegate the code to anyone. It is
 * revisitable — when the export contract exists and the need is demonstrated,
 * the slice that publishes it owns the widening.
 *
 * The bundle is still written ONCE, at provisioning. The pilot organisation and
 * every other organisation provisioned before this slice keep the set they were
 * given; the backfill remains the unperformed decision recorded above and as
 * P1-31 A0 decision D-2.
 *
 * ## The seventh P1-31 code: `wty.warranty.read` (prerequisite P-7, CC-07)
 *
 * The warranty read seam mints ONE permission — the only shipping insert this
 * phase makes into `iam.permissions` — and the bundle carries it. The reasoning is
 * the same rule, applied rather than reflexed:
 *
 *  - **Declared by shipped operations**, the necessary condition: `wty.warranty-list`
 *    (new) and `wty.warranty-detail` (re-pointed from the write code it was wrongly
 *    gated on). That is two declarers, where CC-01 and CC-02 each withheld a code
 *    with zero — until P-10 published five for `wty.policy.manage` and P-11 seven
 *    for `rpt.report.configure`, and both codes were carried on the same rule.
 *  - **Reach, the question CC-04 added**, and it is the opposite answer.
 *    `rpt.export` is a platform-wide switch over every registered export resource;
 *    `wty.warranty.read` reads warranty records, their coverage terms and their
 *    covered jobs and parts in ONE schema. `wty` has 80 columns, all classified
 *    `internal` and none `restricted`, and NOT ONE is monetary — so the code
 *    confers no money, no restricted identifier and no write of any kind.
 *  - **Withholding it would REMOVE a capability**, which none of CC-01, CC-02 or
 *    CC-04 does. A freshly provisioned administrator can read a warranty today,
 *    through `wty.warranty.issue`, which this bundle already holds. Re-pointing
 *    the detail read without carrying the read code would take that away — a
 *    regression dressed as least privilege. Least privilege here means the
 *    administrator reads warranties under a READ code instead of an ISSUE code,
 *    not that it stops reading them.
 *
 * Nothing is withdrawn: `wty.warranty.issue` stays, because
 * `wty.warranty-generate` still declares it and an administrator that could not
 * hold it could not delegate a warranty clerk.
 *
 * ## The five P1-32 material codes (slice 3c, P1-32-PRE-134)
 *
 * Slice 3a minted `inv.material.request`, `inv.material.approve`,
 * `inv.material.exception.approve`, `inv.unit_conversion.manage` and
 * `inv.specification.manage` together with their schema; slice 3b published the
 * operations that declare them. They were withheld until slice 3c on the "nothing
 * declares it" rule — and slice 3c made the withholding a CLOSURE rather than a
 * delay: since P1-32-PRE-132 EVERY reservation and issue for a work order draws on an
 * approved material requirement, so a freshly provisioned organisation whose
 * administrator could not ask for, approve or delegate one could never issue a part
 * to a job at all. The sequence is the one `inv.item.manage`, `wty.policy.manage` and
 * `rpt.report.configure` went through: carried on the day the rule that required
 * withholding stopped being true.
 *
 * The split, as the codes are held and delegated:
 *
 *  - REQUESTERS hold `inv.material.request`: asking for material on a service line,
 *    asking for an exception, re-checking a requirement once its missing fact exists,
 *    cancelling a requirement nothing is committed against, and closing or cancelling
 *    a material request. It is added to every bundle that already REQUESTS parts —
 *    i.e. that holds `inv.stock.operate`, the authority to reserve and issue.
 *  - APPROVERS hold `inv.material.approve` (how much a job may take) and EXCEPTION
 *    approvers `inv.material.exception.approve` (a finite quantity beyond it). They
 *    are added only to a bundle that already APPROVES — one that holds
 *    `inv.adjustment.approve`, the existing second-person inventory authority. The
 *    requester of a requirement or an exception can never decide it
 *    (`ck_material_requirements_separation`,
 *    `ck_material_requirement_exceptions_separation`), so holding both halves confers
 *    nothing but the ability to decide OTHER people's requests.
 *  - `inv.unit_conversion.manage` and `inv.specification.manage` belong to whoever
 *    maintains parts reference data: a bundle that already holds `inv.item.manage`.
 *    They change what every later requirement is measured against, so they are not a
 *    requester's or an approver's codes.
 *
 * Measured against the bundles this file ships: `first_owner` holds none of
 * `inv.stock.operate`, `inv.adjustment.approve` or `inv.item.manage` and gains
 * nothing. `tenant_administrator` holds all three, so it carries all five — to be
 * exercised, and above all to be DELEGATED, because a service-advisor, parts-keeper
 * or workshop-controller role is one the Owner builds from codes the administrator
 * holds. No other shipped bundle exists: those roles are tenant configuration, and
 * the split above is the rule an Owner-built role follows.
 *
 * Organisations provisioned before this slice keep the set they were given;
 * `scripts/platform/backfill-tenant-administrator-bundle.mjs` owes them one operator
 * run covering the five codes, and that run is not performed by this slice. The
 * transfer write-off slice 3a added needs no new code: it is approved under
 * `inv.adjustment.approve`.
 *
 * ## The three codes the QA campaign found closed (Owner directive, 2026-09-17)
 *
 * A fifth instance of the same closure, in three namespaces at once, and this one
 * was found by exercising the product rather than by walking a phase's routes.
 * Each of the three codes below is declared by at least one SHIPPED operation and
 * already exists in the permission catalogue seed — this widening mints nothing
 * and adds no migration — and none of them was in the bundle, so under
 * `ins_role_permissions_delegable` no principal in any platform-provisioned
 * organisation could hold one or ever be granted one. The capability was not
 * merely withheld from the first administrator: it was shut for the whole
 * organisation, permanently. Each one, with the operations that declare it and
 * the consequence measured:
 *
 *  - `wo.work_order.line.manage` — `wo.service-line-record` and
 *    `wo.required-part-record`. Without it a work order can be created,
 *    transitioned and closed but can never say WHAT work is on it, and no part
 *    can ever be required against it. Since every reservation and issue now
 *    draws on an approved material requirement, and a requirement is asked for
 *    against a line, this one absence closed the whole material-demand surface
 *    the P1-32 material codes above were carried to open. The bundle already
 *    holds `wo.job.manage` and `wo.work_order.transition`, so this is the
 *    narrower of the two authorities, not a wider one.
 *  - `crm.customer.profile.write` — `crm.contact-add`, `crm.address-add` and
 *    `crm.preference-set`. The bundle already carries `crm.customer.create`, so
 *    a freshly provisioned organisation could register a customer and then never
 *    record a telephone number, an address or a preference for it — including
 *    for the customer whose vehicle it had just received.
 *  - `rec.reception.evidence.manage` — `rec.reception-condition-evidence`,
 *    `rec.reception-evidence-binding` and `rec.reception-evidence-binding-finalize`.
 *    The bundle already carries the whole reception path from check-in to
 *    conversion, and this is the one step in the middle of it that nobody could
 *    perform: the pre-service condition record a workshop is answerable for.
 *
 * ### `inv.cost.view` STAYS EXCLUDED, and the consequence is owed to the Owner
 *
 * The same campaign measured a FOURTH code the same way, and this file does not
 * carry it. The measurement stands and is recorded here rather than acted on.
 *
 * `inv.cost.view` is declared by `inv.item-cost-history-read`, and it is read as a
 * SECOND permission by the receipt, adjustment and external-purchase services —
 * and by RLS on `inv.item_cost_layers` — before a unit cost will be accepted or
 * returned. So QA's DEF-T-03 is true as measured: in an organisation the shipped
 * provisioning operation created, NOBODY can record a unit cost on anything
 * received. An unheld code cannot be delegated, so the first administrator cannot
 * hand the authority to anyone either; no cost layer can be written, and no
 * valuation and no margin can be derived from one.
 *
 * It is not carried here because its exclusion is an EXISTING RECORDED DECISION,
 * and reversing a recorded decision is the Owner's act and not this slice's.
 * `docs/phase-1/phase-1-30/change-control-2026-09-06.md` CC-12, still open, files
 * the `inv.cost.view` exclusion from this bundle as DELIBERATE, cites the P1-30 A0
 * matrix for it, and carries it as register gap E-14. The ground that decision
 * rests on is the code's own classification — `high`, disclosing purchase cost.
 * The three codes carried above have no such record against them, which is the
 * whole difference between them and this one.
 *
 * The disposition is therefore: measured, unresolved, and awaiting an Owner
 * decision. If the Owner decides the cost authority belongs in the first
 * administrator's bundle, the change is one entry in the list below plus the
 * backfill run named next. If the Owner decides it stays a separately granted
 * authority, DEF-T-03 still needs an answer — an operator grant made after
 * provisioning — and that answer is not this constant.
 *
 * Organisations provisioned before this widening keep the set they were given;
 * `scripts/platform/backfill-tenant-administrator-bundle.mjs` reads this list at
 * run time and needs no edit, so they owe ONE operator run covering all three
 * codes — one run, not one each. That run is an operator act and is not performed
 * by this slice, and this slice does not claim it was run anywhere.
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
    'Tenant administration established at provisioning: session reachability, IAM administration, the organisation reads the workshop screens require, and every code the P1-29, P1-30, P1-31 and P1-32 personas need, so that they can be delegated.',
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
    // Owner directive 2026-09-16: `org.company-create` and `org.branch-create`
    // declare these, and the Owner decided the first administrator holds them.
    'org.company.manage',
    'org.branch.manage',
    'org.department.read',
    'org.department.manage',
    // P1-31 prerequisite P-17. Both codes are MINTED by that slice and both are
    // carried, on the P-1 rule this bundle is built from: a code is held when a
    // SHIPPED operation declares it and the administrator needs it to exercise
    // or delegate the journey. Four operations declare them — the register's
    // list, detail, create and status command — and withholding either would
    // leave a freshly provisioned organisation unable to create ANY delivery at
    // all, because `sal.delivery-create` now refuses an employee that does not
    // exist and nothing else in the product can create one. That is the same
    // consequence `wty.policy.manage` was carried to avoid.
    'org.employee.read',
    'org.employee.manage',
    'tech.technician.manage',
    // The W1–W8 journey: held to be exercised and to be delegated to the personas.
    'wo.work_order.read',
    'wo.work_order.transition',
    'wo.work_order.close',
    // Owner directive 2026-09-17: the QA campaign's DEF-M-01. `wo.service-line-record`
    // and `wo.required-part-record` declare it, and without it no work order in any
    // provisioned organisation could ever state what work is on it or require a part.
    'wo.work_order.line.manage',
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
    // Owner directive 2026-09-17: the QA campaign's DEF-T-01. `crm.contact-add`,
    // `crm.address-add` and `crm.preference-set` declare it; without it a customer
    // could be registered and then never given a telephone number or an address.
    'crm.customer.profile.write',
    'crm.customer.vehicle.manage',
    'veh.vehicle.read',
    'veh.vehicle.manage',
    'rec.reception.read',
    'rec.reception.manage',
    'rec.reception.party.manage',
    // Owner directive 2026-09-17: the QA campaign's DEF-T-12 and DEF-M-06.
    // `rec.reception-condition-evidence`, `rec.reception-evidence-binding` and
    // `rec.reception-evidence-binding-finalize` declare it. The bundle already
    // carries check-in through conversion; this was the one step in the middle
    // of that path nobody in a provisioned organisation could perform.
    'rec.reception.evidence.manage',
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
    // `inv.cost.view` is deliberately NOT here. The QA campaign measured its
    // absence as DEF-T-03 — nobody in a provisioned organisation can record a unit
    // cost, and an unheld code cannot be delegated — but the exclusion is a
    // recorded decision (change-control CC-12, open; register gap E-14), so
    // carrying it is the Owner's call. See the section above.
    // Held so the Owner can DELEGATE it: an opening batch is maker–checker
    // (`ck_opening_inventory_batches_maker`), so the administrator who counts
    // cannot also approve, and an approver role can only be built out of a
    // code the administrator holds. Without it no stock could ever appear in a
    // fresh organisation — the F-02 remeasurement of 2026-09-06 found this
    // the one AUTHORIZATION gap left after PR #321.
    'inv.adjustment.approve',
    // P1-32 slice 3c (P1-32-PRE-134): the material codes, on the split recorded above.
    // Every reservation and issue for a work order now draws on an approved material
    // requirement, so without these no part could be issued to a job in a freshly
    // provisioned organisation, and no requester, approver or reference-data role
    // could be delegated. REQUESTER: held because the bundle holds inv.stock.operate.
    'inv.material.request',
    // APPROVERS: held because the bundle already approves (inv.adjustment.approve).
    'inv.material.approve',
    'inv.material.exception.approve',
    // REFERENCE DATA: held because the bundle maintains the catalogue (inv.item.manage).
    'inv.unit_conversion.manage',
    'inv.specification.manage',
    'sal.invoice.manage',
    'sal.invoice.issue',
    'sal.finance.view',
    'sal.payment.record',
    'sal.payment.allocate',
    // The P1-31 delivery, warranty and reporting chain (prerequisite P-1). Held
    // to be exercised and to be delegated to a delivery officer, a warranty
    // clerk and a reporting reader; each is declared by a SHIPPED operation.
    // The six P-1 codes all pre-existed in the permission catalogue seed and P-1
    // minted nothing; the seventh, added by P-7 below, is the phase's one minted
    // code; the eighth is added by P-10 below and the ninth by P-11 below. ONE
    // of P-1's nine candidates remains deliberately EXCLUDED: `rpt.export` —
    // which two shipped operations DO declare — on least-privilege grounds by
    // Owner decision, because it is the platform-wide export switch and the
    // bundle already holds every entitlement it pairs with (P1-31 CC-04). The
    // other two, `wty.policy.manage` and `rpt.report.configure`, WERE excluded
    // on the "nothing declares it" rule (CC-01, CC-02) and are now held: see
    // P-10 and P-11 below.
    'sal.delivery.manage',
    'sal.delivery.view',
    'sal.delivery.complete',
    'wty.warranty.issue',
    // P1-31 prerequisite P-7 (CC-07), the phase's ONLY minted code. Declared by
    // `wty.warranty-list` and by `wty.warranty-detail`, which was re-pointed off
    // the write code above on the same day. Carried rather than withheld because
    // withholding it would REMOVE a capability this bundle already confers —
    // the administrator can read a warranty today through `wty.warranty.issue`
    // — which is the one thing CC-01, CC-02 and CC-04 never do.
    'wty.warranty.read',
    // P1-31 prerequisite P-10 (CC-01, now CLOSED). Declared by the five write
    // operations that publish the warranty policy and coverage surface PPD-04
    // measured as absent. Excluded until 2026-09-09 on the "nothing declares it"
    // rule, and carried the moment that stopped being true — the same sequence
    // `inv.item.manage` went through in #322. Withholding it now would leave a
    // freshly provisioned administrator unable to issue ANY warranty, because
    // warranty generation refuses a company that has no active policy and no
    // other code can create one. The code was already in the catalogue seed;
    // nothing is minted here.
    'wty.policy.manage',
    'rpt.report.read',
    // P1-31 prerequisite P-11 (CC-02, now CLOSED). Declared by the seven
    // operations that publish the report CONFIGURATION surface A0 measured as
    // absent. Excluded until 2026-09-09 on the "nothing declares it" rule, and
    // carried the moment that stopped being true — the same sequence
    // `inv.item.manage` went through in #322. Withholding it now would leave a
    // freshly provisioned administrator with an empty report catalogue it could
    // never fill: both published report reads filter on `status = 'published'`
    // and no other code can set that value. The code was already in the catalogue
    // seed; nothing is minted here.
    'rpt.report.configure',
    'iam.audit.view',
  ]),
});
