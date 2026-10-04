# ADR-024: Module Entitlements and Commercial Packaging

## Status

Proposed — for the entitlement mechanism and the module lifecycle definitions below (activation,
upgrade, downgrade, expiry and reactivation). No owner has accepted them; they carry no authority
and must not be cited as approval.

Open — for the package definitions, the licence structure chosen, the downgrade and expiry rules
for reads, exports and open transactions, and accounting activation. No price or term is proposed
anywhere in this record.

Nothing in this record is implemented. It does not claim that any package has been validated or
that any module can be licensed separately today.

Amended 2026-10-04: the Owner decided on 2026-10-03 how existing organisations receive their initial
entitlements. That decision supersedes the default-on proposal below; it is recorded in "Owner
decision 2026-10-03 (amendment)", and the status above is unchanged.

## Context

The Owner directive of 2026-10-01 (recorded as OD-12 to OD-21 in
[`docs/product/owner-directive-2026-09-16/README.md`](../product/owner-directive-2026-09-16/README.md))
asks for one maintained product sold as validated packages, with platform entitlements, company and
branch settings, and user permissions kept apart and all enforced on the server (directive sections
5, 7 and 8).

What exists today — the flag register, plan entitlements, tenant overrides, the resolver and the
inert request-pipeline hook, and the couplings that stop separate packages — is stated in sections
4 and 5 of the
[architecture assessment of 2026-10-01](../platform/architecture-assessment-2026-10-01.md), and is
not restated here. The disposition of each coupling is its row in
[`change-control.md`](../product/owner-directive-2026-09-16/change-control.md).

### Options: licence structures and existing support

Each structure is listed with what the schema already supports and what it lacks. This is not a
recommendation, and no price or term is proposed. Migration file names are under
`supabase/migrations/`.

| Structure          | Supported today                                                                                                                                                                              | Gap                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Per organisation   | One active subscription per tenant at any instant (`20260717102000_org_subscriptions.sql:206-235`); versioned plans (`:104-134`)                                                             | No module effect (C-01)                                                                                                             |
| Modules per plan   | Boolean entitlement document over registered flags (`:109,148-201`); tenant overrides                                                                                                        | Inert                                                                                                                               |
| Per legal entity   | `max_companies` ceiling (`20260916093000_org_capacity_enforcement.sql:31-38`)                                                                                                                | A ceiling, not a licence. Entitlement resolves per tenant (`20260717105000:322-326`), so a module cannot be licensed to one company |
| Per branch         | `max_branches` ceiling                                                                                                                                                                       | No per-branch module licence                                                                                                        |
| Per user seat      | `max_users`; a seat is an invited or active account (`20260916093000:209`)                                                                                                                   | No per-module seat                                                                                                                  |
| Term and price     | `term_months`, `list_price`, `currency_code` (`20260916091000_org_subscription_commerce.sql:44-75`)                                                                                          | No billing interval separate from term                                                                                              |
| Renewal and change | Event kinds assigned, renewed, upgraded, downgraded, cancelled, suspended, reactivated, each with a reason (`:104-110`); status draft, active, cancelled, expired (`20260717102000:225-226`) | Whether anything writes `expired` is unverified                                                                                     |
| Trial and grace    | None. A search of migrations for trial or grace found nothing                                                                                                                                | Would be additive                                                                                                                   |

## Decision

**Proposed: the entitlement mechanism.**

- Reuse the existing flag register, plan entitlements, tenant overrides and pipeline hook. No new
  entitlement store is introduced.
- **Superseded on 2026-10-03 by the Owner's decision recorded below; the original proposal is kept
  as written.** Register one flag per licensable module, with `default_enabled` set to true. The
  column defaults to false (`20260717102000_org_subscriptions.sql:73`), and a module flag left at
  that default would switch the module off for every tenant whose plan does not name it — a silent
  change on upgrade, which directive section 2 forbids. Unfinished capabilities may be registered
  default-off and released per tenant.
- Enforce the entitlement on APIs, background jobs, reports and exports, not only in navigation.
- Filter grants by entitlement: a tenant administrator cannot grant a code of a module that is not
  entitled, and buying a module grants no user anything by itself.
- Treat the item master and units of measure as shared identity, available without the stock
  entitlement, so that a workshop without inventory can reference an item and adding inventory later
  maps rather than duplicates.

**Proposed: the module lifecycle definitions.**

| Event        | Definition                                                                                                                                                                                                                                                                                                               | Directive basis |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Activation   | Entitlement on at an effective time. Dependencies validated first, guided setup, nothing posted retroactively, audited                                                                                                                                                                                                   | Section 8       |
| Upgrade      | A plan change adding modules or capacity. Each added module goes through activation, and existing records are untouched                                                                                                                                                                                                  | Section 8       |
| Downgrade    | A plan change removing modules. Data and relationships are preserved (required by the directive). The module's writes are refused from the effective time (proposed). Reads, exports and open transactions follow the Owner's rule. Capacity below current use follows the existing override (`capability-status.md:93`) | Section 8       |
| Expiry       | The term ends without renewal. Treated as a downgrade unless the Owner sets another rule                                                                                                                                                                                                                                 | Section 8       |
| Reactivation | Access restored, nothing re-created, every change audited                                                                                                                                                                                                                                                                | Section 8       |

### Open

- **Package definitions** — which modules are sold separately, and which package holds which. The
  package matrix in the assessment is derived from code and not validated.
- **The licence structure chosen** — among the options above, or a combination.
- **Downgrade and expiry rules** — what users may still read and export, for how long, and what
  happens to open transactions.
- **Accounting activation** — opening balances, cutover and who approves them; this waits on the
  accounting questionnaire.

The questions themselves are listed once, under "Open Owner decisions raised by the 2026-10-01
records" in the directive record.

### Owner decision 2026-10-03 (amendment)

Recorded 2026-10-04 under task id P1-32-PRE-OD-LIC. The Owner decided the METHOD by which existing
organisations receive module entitlements. Package composition and the other commercial questions
stay open. This record's status stays Proposed: the decision governs how the mechanism is introduced,
and it does not accept the mechanism.

The decision, in substance:

- Do not grant every company every module (no blanket grant), and do not assign packages silently.
- Before anything is enforced, what each existing company actually uses and depends on is
  inventoried.
- A reviewed, explicit mapping from existing access to initial entitlements is prepared. It must
  prove that no access is removed and none is added.
- The mapping is rehearsed, is idempotent, and server enforcement and tenant isolation are tested.
- Any part of the mapping that depends on an open commercial question stays pending, with a
  recommendation and its consequence.

What it supersedes: the proposal above to register every module flag with `default_enabled` true,
so that existing organisations keep every module by default. Under the decision, an existing
organisation's initial entitlements are explicit rows per organisation and module, derived from the
reviewed mapping, so the result depends neither on a flag default nor on a plan document. The
column-default concern in "Alternatives Considered" still holds for any flag that is registered: a
default must never switch a module off silently.

The inventory, the proposed mapping rules and the measured proof are in the analysis
[`docs/platform/module-entitlement-inventory-2026-10-04.md`](../platform/module-entitlement-inventory-2026-10-04.md).
It enforces nothing and applies nothing, and its recommendations are not approvals. The decision is
also recorded against open decision 7 in the directive record.

## Alternatives Considered

- **A rewrite, customer forks, or extracting modules as separate services.** Rejected: directive
  section 5 asks for incremental improvement of one product, and the assessment found no coupling
  that needs more than a focused, additive change.
- **Gating modules in navigation only.** Rejected: navigation filtered by permission is access
  control, not entitlement, and directive section 7 requires enforcement on the server, including
  jobs, reports and exports.
- **Registering module flags with the column default (off).** Rejected: it would switch modules off
  for existing tenants on upgrade without any decision by them.
- **A new entitlement store beside the existing register.** Rejected: the register, plan document,
  overrides and resolver already exist; a second store would be a competing source of truth.

## Consequences

- Once accepted and built, a module can be switched off for a tenant without deleting any record,
  and no tenant loses a module it uses today until its plan is changed.
- Every operation, report dataset and background consumer has to name its module, and a gate has to
  fail the build when one does not.
- Grants and the provisioning bundle become dependent on entitlement, which changes who may do what
  in some organisations; each such transition needs its own plan (CC-OD-50).
- The warehouse register (FC-13) and any accounting subsystem are decided by later ADRs, not here.
  Relaxing any rule of ADR-001 would need a superseding ADR.

## Security Impact

Entitlement is an additional refusal on top of permission checks and row-level security; it never
replaces either, and it never widens what a permission allows. Each entitlement change on an active
tenant is audited. Tenant isolation is unaffected: entitlements resolve per tenant and one tenant's
entitlements never change another's answers.

## Operational Impact

None until implemented. When implemented, the flag registrations and any new policy arrive as
additive forward migrations, rehearsed on a restored copy before they are applied, and the generated
OpenAPI document is regenerated, never hand-edited.

## Related Phase 1 Task and Requirement IDs

Owner directive of 2026-10-01, OD-15 to OD-18 and OD-20; D-OD-11; change-control rows CC-OD-33 to
CC-OD-39, CC-OD-45 and CC-OD-49; focused changes FC-01 to FC-06, FC-15 and FC-16 in the
architecture assessment; task id P1-32-PRE-207; ADR-001; ADR-004; ADR-023.

Identifiers prefixed `P1-` are defined in the canonical Word documents, which live outside this
repository by owner decision — see
[../governance/canonical-documents.md](../governance/canonical-documents.md).

## Decision Owner

The Owner — the package definitions, the licence structure and its terms, and the downgrade, expiry
and accounting-activation rules.

The technical and IT owner — the entitlement mechanism and the lifecycle mechanics, once the Owner's
rules are set.

## Date

2026-10-02
