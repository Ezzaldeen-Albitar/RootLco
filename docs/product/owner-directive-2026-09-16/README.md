# Owner directive of 2026-09-16 — SaaS operation before daily use

## Status

Recorded 2026-09-16 at protected develop `2c573a24`. Implementation in progress; nothing in this
directive is complete until its row in `capability-status.md` says so.

**Where it stands at 2026-09-21, develop `fe09f1a9`.** Every section of the directive has merged
work behind it, and most of that work has now been exercised rather than only read: sixty of the
ninety-seven rows in `capability-status.md` carry a `measured` marker naming the day the behaviour
was read back on the local acceptance stack, twelve still carry an owed-proof marker, and twenty-five
carry none because there is nothing to demonstrate. Those figures were taken while the campaign ran,
and it ended at `f30ce918`. The measurement also produced eight new change-control rows, `CC-OD-24`
to `CC-OD-31`, of which six are Owner decisions rather than defects.

**One of them has closed since.** PR #430 merged at `fe09f1a9`: a refused request for material now
names the rule that refused it, in both languages, which closes `CC-OD-27` and opens the narrower
`CC-OD-32` for the pre-checks that still answer without a rule token.

**Two statements that must never be run together.** The work is on `develop` and has **not** been
promoted to `main`; and promotion to `main` is a statement about reviewed source, not a deployment.
Neither has happened, and neither would put the product anywhere but the one local machine it runs
on (D-OD-05).

**The user manual and the quick start are at `fe09f1a9`.** `docs/user-manual/README.md` records what
changed, which parts were re-read at that head, and that no screenshot was re-captured and no PDF was
rebuilt for the revision.

## The directive

The Owner's eleven numbered sections, restated as requirements. Each requirement is the statement
the work is measured against; the measurement itself lives in `capability-status.md`, and every
prerequisite found while measuring is a row in `change-control.md`.

### OD-1 — Environment configuration

A complete inventory of every environment value the platform reads, with tracked templates that
carry no secret; a working local configuration; a production template in which every value that
must come from outside the repository is identified as such; validation at startup that refuses to
run on an incomplete or contradictory configuration; and one list of the values the Owner or a
provider must supply.

### OD-2 — Platform Owner Console

A console operated on the existing platform-operator identity, never on a tenant administrator.
It must list, search and open organisations; create a tenant together with its first company and
its first branch; add further companies and branches where the tenant's plan permits; create or
invite the tenant's first administrator; record a subscription term with its dates, plan, enabled
modules, branch limit and user limit; support annual and multi-year terms; support renewal,
upgrade, downgrade, suspension and reactivation; show usage against entitlement; keep the
subscription lifecycle and its change history; and enforce every limit on the server under
concurrency, so two simultaneous requests cannot both pass the last seat.

It must also report platform statistics: active, suspended and expiring tenants, counts, amounts
by currency, service health, and a searchable administrative audit history. Subscription revenue
is reported separately from workshop revenue, because they are different businesses that happen to
share a database. The initial commercial flow is owner-recorded sales and receipts; no card
provider is assumed to exist. Plan prices are configurable.

### OD-3 — Organisation administration

Administration of companies, branches, departments, employees, users, invitations, roles and
scopes, each with a clear explanation when an action is refused — the reason in the operator's
language, not a transport code.

### OD-4 — Inventory, sales, barcodes and returns

**Inventory.** Warehouses and their locations; on-hand, reserved, available and in-transit
quantities; receiving, transfers, issues, returns and approved adjustments; stock counts that
record variances and cope with movements that happen during a count; and a traceable cost history
that is appended to rather than rewritten.

**Sales.** Both the internal issue against a work order and the external sale with no work order
at all. An external garage buying parts is a customer of the selling tenant, and the sale is
recorded as such.

**Barcodes.** Tenant-scoped identification of items, manufacturer codes, packaging units,
printable labels, camera and hand scanner input, a manual fallback when neither reads, and
duplicate-frame protection so one physical scan is one event. A product barcode identifies a
product; a serialized unit identifier identifies one physical unit. They are not the same field.

**Returns.** A return is linked to the original lines, may be partial, and enforces the remaining
returnable quantity. It distinguishes what was received from what is restockable and what is
damaged. Its effects are applied exactly once. Cancelling a document is not a physical return and
must not be recorded as one.

Screens that show stock update as it moves, and when an update cannot be delivered the screen says
the figure is stale rather than presenting an old number as current.

### OD-5 — Duplicate-demand controls

The approved material requirement for a work order and service operation is a business quantity,
and it must not be exceeded across separate requests, reservations or issues, including under
concurrency. Exceeding it is possible only as an authorized exception carrying the authorizing
role, a reason and an audit entry. Quantity arithmetic is exact in the declared unit. An oil
specification is attributable to a source; capacity is never guessed by a language model.

### OD-6 — Operational intelligence

Concrete intelligence, not a slogan: dashboards, low-stock suggestions, discrepancy and unusual
consumption alerts, routing of duplicate demand to whoever decides it, expiring-subscription and
capacity alerts, a stated freshness for every figure and drill-through to the records behind it. A
suggestion is a suggestion until a person accepts it; it never becomes a transaction on its own.
No external AI provider is required. Camera capture of a chassis number or an odometer reading is
a separate question from barcode scanning and is judged separately.

### OD-7 — Search

Search by customer name, by customer phone, by vehicle make and model, by chassis number and by
plate number including a plate's history; consistent normalization between Arabic and English
input, including digits; paging on the server; and the same scope isolation that governs every
other read.

### OD-8 — Execution order and reporting

Work proceeds in the order A to F the Owner set, and progress is reported as a compact status row
per capability rather than as prose. `capability-status.md` is that report.

### OD-9 — The pending code-scanning result

Consume the pending code-scanning result on `2c573a24` once, and fix the classification defect
that produced it narrowly, without widening any allow-list.

### OD-10 — Prove the journey

Prove the business journey end to end with controlled isolated acceptance records, never against
the shared working data of another run.

### OD-11 — Delivery

Correct the administrator runbook so it provisions the Platform Owner identity rather than a
tenant's first owner; deliver that access privately; update the manual and the quick start; and
state the deployment status plainly.

## Coordinator decisions

**D-OD-01 — Who the Platform Owner is.** The Platform Owner is the holder of a row in
`iam.platform_grants`: the platform-operator identity created by
`scripts/platform/genesis-platform-operator.mjs`. It is never a tenant administrator, and a tenant
administrator is never given platform authority to stand in for one.

**D-OD-02 — How this work travels.** Branches are named `feature/owner-directive-*` and are judged
under ownership profile `owner-directive-saas-operation`. Every prerequisite discovered while
measuring is recorded in `change-control.md` under change control, not inserted as a P1-32 task.
P1-32 remains the validation phase and its task list is not reopened by this directive.

**D-OD-03 — Who creates companies and branches.** A tenant's administrator creates further
companies and branches inside the tenant, and the server enforces the plan's limits on those
creations. The console can also create them, and can raise the limits — that is the console's
distinct authority, not a duplicate of the administrator's.

**D-OD-04 — The commercial flow.** The initial flow is owner-recorded subscription charges and
owner-recorded receipts against them, with configurable plan prices. No payment provider exists in
this repository and none is assumed; a future integration is its own decision.

**D-OD-05 — Deployment status.** The application is LOCAL-ONLY (ADR-012). The deploy workflows
present in the repository are inert. A merge to `main` is a promotion of reviewed source, not a
deployment, and must never be reported as one.

**D-OD-06 — The classification correction.** The correction is a new `docsTooling` change category
that triggers the `code-security` job and no other. It is deliberately narrower than reusing the
`scripts` category, which would also trigger two database jobs that a documentation tool cannot
affect.

**D-OD-07 — Task identifiers.** Task ids for this work are `P1-32-PRE-NNN`, carried in the commit
subject and in the `change-control.md` row the commit closes or opens.

**D-OD-08 — Acceptance data.** Acceptance uses controlled isolated records whose tenant codes match
no backend suite prefix, so no suite's cleanup can delete them and they can delete nothing of a
suite's. Acceptance never wipes the shared database.

## Owner directive of 2026-10-01: the complete operational product

Recorded 2026-10-02 at develop `ec91239b`, under task id P1-32-PRE-207. The Owner's direction of
2026-10-01 is binding. It consolidates the work already under way and supersedes nothing in ADR-023;
where the directive puts full accounting in scope, the effect on D16 is stated in the accounting
section of `capability-status.md` and would be recorded by a new ADR, never by editing ADR-023. The
binding points are restated below as requirements OD-12 to OD-21, continuing OD-1 to OD-11 above.
The directive's own section number is given with each.

Nothing in this section is a measurement. What the code does is in
[`docs/platform/architecture-assessment-2026-10-01.md`](../../platform/architecture-assessment-2026-10-01.md);
what is verified is in `capability-status.md`; what is open is in `change-control.md`; and what is
proposed for module entitlements is in
[ADR-024](../../adr/ADR-024-module-entitlements-and-commercial-packaging.md).

### OD-12 — The complete operational product (directive section 1)

The goal is the complete operational product, not a workshop-only first release: the workshop from
reception through work orders to delivery and after-sales; administration of companies, branches,
users, roles and approval authority; sales and finance (quotations, invoices, payments, credit
notes, refunds and their controls); inventory and purchasing (receipt, costing, movements, issues,
sales, returns and reconciliation); full accounting and financial reporting, whose scope the pending
accounting questionnaire will finalise; and configuration, audit, reporting, printing, onboarding
and documentation. HR and other modules are future expansions, for which only boundaries are
prepared.

### OD-13 — Continuous development of a live product (directive section 2)

Versioned database and integration contracts; backward-compatible, additive changes; explicit
transition plans; tested upgrades; backups; application rollback or database forward recovery;
controlled release of new capabilities, so that an unfinished feature is not switched on for every
customer; monitoring and diagnostics; and one product with no customer forks. Restoring an earlier
application version does not reverse a migration. Development and QA data stay apart from live data,
and an upgrade never silently changes historical amounts, configuration, permissions or behaviour.

### OD-14 — Policies that wait on the accounting questionnaire (directive section 3)

Accounting, costing, pricing and tax policies are in scope and deferred until the questionnaire is
answered. D1 to D17 continue only where they are independent of it; overlaps are identified;
financial policy is never invented; and configurable commercial policy is kept apart from
accounting invariants.

### OD-15 — A modular commercial product (directive section 5)

Validated packages — the complete system, workshop with selected finance, standalone inventory,
workshop with inventory, and other combinations once verified — with subscription and licence models
in the design and no invented prices or terms. One maintained product with shared foundations and
explicit module boundaries, improved incrementally: no rewrite, no forks, no speculative services. A
bounded assessment records the shared core, each module's responsibility and data, required
dependencies and optional integrations, existing and planned capabilities, the concrete couplings
that prevent standalone packages, and the focused changes that remove them — in the existing
records, with no competing source of truth.

### OD-16 — Shared foundations (directive section 6)

Tenant (the customer organisation), legal entities, branches and warehouses are distinguished.
Shared identities and records have one owner, so enabling a module never duplicates customers,
items, documents or balances. Module contracts state transaction boundaries, retries, duplicate
prevention and recovery, and a retry never duplicates a stock movement, invoice, payment or
accounting effect. Standalone inventory needs no vehicle, appointment or work order. A workshop
without inventory records parts and charges without pretending that warehouse balances,
reservations or FIFO exist. Basic invoicing and payments are distinguished from advanced accounting,
and the minimum dependencies of each package are stated.

### OD-17 — Entitlements, settings and permissions kept apart (directive section 7)

Three layers stay separate: platform subscription and licence entitlements; authorised company and
branch settings; and user roles, permissions and approval authority. All are enforced on the server,
including APIs, background jobs, reports and exports. A tenant administrator cannot grant a module
that is not licensed, and buying a module does not give every user its permissions. Disclosure is
progressive. Configuration never switches off accounting correctness, audit, document integrity or
tenant isolation.

### OD-18 — Adding and removing modules (directive section 8)

A workshop can add inventory later without restarting its records. Activation validates
dependencies and guides setup: warehouses, permissions, item mapping and duplicate resolution,
approved opening quantities and values, a cutover date and verification. No opening stock is
invented, nothing is deducted retroactively and nothing is silently re-posted. Activation, upgrade,
downgrade, expiry and reactivation are defined; data and relationships are preserved when a module
is switched off; open transactions and historical viewing and export are addressed. Advanced
accounting added later uses approved opening balances and a cutover, never silent historical
entries.

### OD-19 — Tax configuration (directive section 9)

Tax is configured around legal entities and transaction, item or service classifications, with
authorisation, effective dates and audit. A branch respects its legal entity. No rate is inferred or
hard-coded, and issued documents are never recalculated. Sales tax stays separate from income tax.
Whether selling prices include tax waits on the questionnaire.

### OD-20 — What must be demonstrated before modular readiness is claimed (directive section 10)

Workshop without inventory; inventory without workshop; a workshop adding inventory with its history
preserved and the cutover verified; the full product across module boundaries; server-side
entitlement and permission enforcement; tenant isolation; safe downgrade, expiry and reactivation;
and safe updates for existing data.

### OD-21 — A concrete delivery matrix (directive section 12)

Five columns — completed and verified; implemented, awaiting integration or verification; remaining
in current scope; blocked on accounting answers; future expansion — and, for each new feature, its
owning module, dependencies, configurable behaviour, integration effects and upgrade impact. Merged
code is never equated with a verified running product, and configurable navigation is never
equated with a modular commercial system.

### Coordinator decisions for the 2026-10-01 directive

**D-OD-09 — The assessment.** The architecture assessment is
`docs/platform/architecture-assessment-2026-10-01.md`. It is a dated reading of the code at
`ec91239b`, not a decision record, and it decides nothing.

**D-OD-10 — The delivery matrix.** The delivery matrix and the accounting section are new sections
at the end of `capability-status.md`. The matrix's five columns map onto that file's four states:
_completed and verified_ is implemented with a dated marker; _implemented, awaiting integration or
verification_ is implemented or partial without one; _remaining in current scope_ is missing or
partial; _blocked on accounting answers_ is externally blocked, naming the questionnaire; and
_future expansion_ is outside current scope. The 97 capability rows keep their count.

**D-OD-11 — Module entitlements.** Entitlements, the module lifecycle, licence options and packaging
live in ADR-024, which is proposed for the mechanism and open for packages and terms.

**D-OD-12 — No invented financial policy.** No financial policy is invented, and every item that
waits on the accounting questionnaire stays blocked until it is answered.

**D-OD-13 — Packages are drafts.** The package matrix stays a draft, marked "derived from code, not
validated", until the Owner answers the package questions below and each package's scenario has
been demonstrated.

**D-OD-14 — One owner per fact.** The assessment's section 4 owns each coupling's statement and
evidence. A `change-control.md` row owns its disposition, names the C-id and does not restate the
evidence. Where an earlier finding already records a coupling, it stays the record and no new row
is opened: PPD-01 and ADR-023 D6 for C-08, PPD-03 for C-17 (`docs/product/README.md:272,274`).
ADR-023 owns the D1 to D17 decision text and implementation state (its mapping table, "Mapping:
decision → today → what is missing → tests → pull request", `:270-288` at develop `02a0462c`; the
line range `:197-214` cited here earlier is where that table stood at `ec91239b`, before later
additions to ADR-023 moved it), and other records cite it by line. The delivery matrix owns verification state. The accounting section owns the split
between invariants, policy and configuration, and between independent and blocked. ADR-024 alone
owns the module lifecycle definitions and the licence options; the assessment states only today's
state and links to ADR-024.

### Owner decisions of 2026-10-03

Recorded 2026-10-04 at develop `02a0462c`, under task id P1-32-PRE-OD-LIC. Each line is the Owner's
decision in substance and the pull request or record that delivered it. Evidence folders named here
are outside the repository, under the coordinator's `orchestration/evidence/`.

- **CI time limit (open decision 21).** The web-quality job limit is raised from 30 to 45 minutes
  through one focused, reviewed pull request: delivered by #502. This is separate from the
  clean-room limit raised from 60 to 90 minutes by #493. Slow tests keep being improved; no
  unlimited retries and no extra concurrency are introduced.
- **The `braces` advisory.** A local patched copy is used while upstream publishes no fix, with its
  documented limitations and replacement condition: delivered by #501
  (`docs/engineering/dependency-maintenance/ghsa-vfj7-8cjw-p6xm-braces/README.md`, sections 9 and
  10; change-control row CC-OD-55).
- **D12 extension.** Permission refusals on the four finance decisions are recorded: delivered by
  #505 (ADR-023, "D12 extension (approved by the Owner 2026-10-03)"). Browser-tested at `5d3dcbec`
  (evidence `owner-directive-2026-10-04-fxe-d12x-retest`).
- **Finish fix PR D.** #500 is completed and merged; its signed-in retest at `c8940b1c` is the
  evidence `owner-directive-2026-10-03-fxd-retest`. The failures that retest found were fixed by
  fix PR E (#504) and passed at `5d3dcbec` (evidence `owner-directive-2026-10-04-fxe-d12x-retest`).
- **One worker.** The work queue continues with one worker at a time.
- **Module licensing method (open decision 7).** Recorded against decision 7 below and as the
  2026-10-03 amendment in ADR-024.
- **The two checkpoint findings (open decision 19).** Both are defects. Recorded against decision 19
  below.

### Open Owner decisions raised by the 2026-10-01 records

Listed so that each can be answered once. Where the Owner has answered, the answer is recorded
against the question with its date; every other question is still open.

1. **Package definitions.** Which modules are sold separately, and which package holds which? In
   particular, are appointments, diagnostics, quality control, warranty and reporting part of every
   workshop package or licensed separately? Diagnostics and quality are code dependencies of work
   orders today.
2. **Standalone inventory.** Does it include basic invoicing (counter sales and receipts)? Today that
   is the only way stock leaves without a work order. Or must it run with no finance module at all,
   which needs a new internal-issue capability?
3. **Workshop packages.** Is basic invoicing and payment recording always included? The delivery
   check reads the open receivable.
4. **Licence structure.** Per organisation, legal entity, branch, user seat, per module, or a
   combination? Are trial and grace periods wanted? ADR-024 lists what the schema supports today.
   Structure only, no prices.
5. **Downgrade and expiry.** What may users still do after a module is switched off or expires: view
   and export history only, and for how long? Must open work (reservations, unpaid invoices, pending
   credit notes, open work orders) be finished first, or may it continue read-only? Is expiry
   treated like a downgrade?
6. **Upgrade.** May a module added by a plan change take effect immediately, or only at a stated
   effective date once activation checks pass?
7. **Existing organisations.** When module entitlements are switched on, should every existing
   organisation keep all the modules it uses today until its plan is explicitly changed? This is
   ADR-024's default-on proposal.

   **Method decided by the Owner, 2026-10-03; the question is otherwise still open.** Do not grant
   every company every module, and do not assign packages silently. Before anything is enforced,
   inventory what each existing company actually uses and depends on, and prepare a reviewed,
   explicit mapping from existing access to initial entitlements that proves no access is removed
   and none is added. Rehearse it, make it idempotent, and test server enforcement and tenant
   isolation. Any part of the mapping that depends on an open commercial question (package
   composition and the other decisions in this list) stays pending, with a recommendation and its
   consequence. This supersedes ADR-024's default-on proposal (ADR-024, "Owner decision
   2026-10-03"). The inventory and the proposed mapping are in
   [`docs/platform/module-entitlement-inventory-2026-10-04.md`](../../platform/module-entitlement-inventory-2026-10-04.md);
   nothing in it is enforced or applied.

8. **D13 transition (CC-OD-50).** Organisations provisioned earlier cannot approve credit notes after
   upgrade until the code is granted and a limit set, and the backfill covers only the named QA
   organisations. Should the backfill extend to every existing organisation, or stay limited with
   the change stated to them?
9. **D17 transition (CC-OD-50).** Implementing D17 removes finance visibility from users who hold
   quotation codes without the finance permission. Should existing organisations be told in
   advance, with a list of affected roles, or should a defined period pass before the change
   applies? The same question applies to any future print permission (D10).
10. **Tax permission (CC-OD-50, FC-20).** Once a tax write path exists, who should hold
    `org.tax.manage` in existing and new organisations? No provisioned administrator holds it today,
    and it cannot be delegated. Separately: the records hold FC-20 as a design until the
    questionnaire is answered. Should its structural part (permission, approval, effective-dated
    insert and audit, setting no rate) go ahead before then, or stay held with the rates?
11. **A price with no tax class (CC-OD-48).** Once tax is configured, may a price with no tax class
    still mean untaxed at a zero rate? Or must every sellable price name an explicit class,
    including an explicit exempt or zero-rated one? This belongs with the questionnaire.
12. **Accounting activation (S-9).** Who approves opening balances? Is a cutover date mandatory? Are
    financial events from before the cutover ever posted? (Proposed: never silently.) Do inventory
    valuations at cutover wait on the costing policy?
13. **Who activates a module.** Only the platform operator (the owner-recorded commercial flow,
    D-OD-04), or may an organisation administrator request or purchase one in the product?
14. **Buying a module.** Should the first administrator automatically receive that module's
    permission codes, or should every grant be explicit?
15. **Purchasing scope.** Are suppliers, purchase orders, receipt matching and supplier invoices or
    payables in current scope under "inventory and purchasing" (PROC-18)? Or are they part of full
    accounting, awaiting the questionnaire?
16. **Part prices once inventory exists.** Which price wins, the service price list or the item
    selling price? This belongs with the questionnaire's pricing-policy questions (CC-OD-47).
17. **Adding inventory later.** Is an opening value required at activation, or may quantities be
    approved first and values follow the costing answer? Who approves opening quantities and values?
18. **QA identities.** The cross-tenant cases need a login for the second tenant, and the
    new-organisation case on the new interface needs a platform-operator identity. Will the Owner
    provide both? **Still open.** Until it is answered, the second-company cases of every browser
    checkpoint remain NOT RUN for this reason, including the 2026-10-03 and 2026-10-04 finance
    checkpoints.
19. **Decisions flagged by the browser checkpoints.** The check-in wizard's step buttons discard
    typed input without asking (`78602752`), and a concern recorded with no severity is stored as
    "medium", a value the customer did not give (`78602752`). Should either change?

    **Answered by the Owner in the continuation instruction of 2026-10-03: both are defects.**
    Moving between check-in steps must not discard typed input without the unsaved-work
    confirmation. A concern recorded with no severity must be stored as "not stated", instead of
    being stored silently as "medium". Historical data is not rewritten. Neither fix is delivered at
    the time of this record.

20. **Email verification with the mail provider.** Stage 4 waits on the Owner's choice of recipient.
21. **CI.** The web-quality job runs close to its 30-minute limit. Should the limit be raised, or the
    job split?

    **Answered by the Owner, 2026-10-03.** The limit is raised from 30 to 45 minutes through one
    focused, reviewed pull request, delivered by #502. This is separate from the clean-room limit
    raised from 60 to 90 minutes by #493. Slow tests keep being improved; no unlimited retries and
    no extra concurrency.

## Code-scanning result on `2c573a24`, consumed once (section 9)

Observed 2026-09-16, read-only, through the check-runs API.

At develop head `2c573a24` all 40 check runs completed with conclusion `success`, including both
code-security language jobs — `code-security / code-security (javascript-typescript)` and
`code-security / code-security (actions)` — and `protected-gate`.

At the head commit of pull request #409, `7926f634`, the umbrella `code-security` check was
`skipped`. The pull request changed one file, `docs/user-manual/tools/build-pdf.mjs`, and the
change classifier read every path under `docs/` as prose, so the change was classified
documentation-only and the conditional job was recorded as not required.

Stated plainly: code scanning passed on the merge commit, not on the pull request. The window in
which a finding could have been reviewed before merge did not exist. That is the defect corrected
by P1-32-PRE-001, recorded as CC-OD-01.
