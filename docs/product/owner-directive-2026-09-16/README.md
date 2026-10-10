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
decision → today → what is missing → tests → pull request", `:751-773` at develop `d5ce97b7`,
re-anchored 2026-10-08; it stood at `:270-288` at develop `02a0462c`, and the line range `:197-214`
cited here earlier is where it stood at `ec91239b`, before later additions to ADR-023 moved it), and
other records cite it by line. The delivery matrix owns verification state. The accounting section owns the split
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

The decision pack of 2026-10-08, [`decision-pack-2026-10-08.md`](decision-pack-2026-10-08.md),
sets out worked examples, the options, the planner's recommendation and the interim treatment for questions 8, 9 and 22 to 27, and for
the other plan labels linked in the table under "Completion plan labels and canonical ids" below.
Nothing in it is an Owner decision, and it changes no question below.

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
   the change stated to them? _Decision pack:_ [PERM01](decision-pack-2026-10-08.md#perm01-giving-new-rights-to-existing-organisations).
9. **D17 transition (CC-OD-50).** Implementing D17 removes finance visibility from users who hold
   quotation codes without the finance permission. Should existing organisations be told in
   advance, with a list of affected roles, or should a defined period pass before the change
   applies? The same question applies to any future print permission (D10). _Decision pack:_
   [PERM01](decision-pack-2026-10-08.md#perm01-giving-new-rights-to-existing-organisations), [PRINT01-a](decision-pack-2026-10-08.md#print01-a-a-print-permission-for-each-document), [PRINT01-b](decision-pack-2026-10-08.md#print01-b-quotation-amounts-on-paper) and [PRINT01-c](decision-pack-2026-10-08.md#print01-c-invoice-details-for-a-user-without-finance-visibility).
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
16. **Part prices once inventory exists.** _Reworded 2026-10-05 (P1-32-PRE-OD-FD6):_ today only the
    item selling price can price a part, because the service price list prices services only, and
    quotation part lines use it (ADR-023 D6). If price lists are ever extended to items, which price
    wins, the service price list or the item selling price? This belongs with the questionnaire's
    pricing-policy questions (CC-OD-47). **Still open.**
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

    **Corrected 2026-10-08 (P1-32-PRE-OD-WP00): both fixes are delivered.** The step guard and the
    "not stated" severity by #508 (P1-32-PRE-OD-RWS, merged 2026-10-04 as `1bde8e95`), and chosen
    files counted as unsaved work by #511 (P1-32-PRE-OD-RCF, merged 2026-10-05 as `6214ae2a`). Their
    records and residual items are in `route-checklist.md` (sections P1-32-PRE-OD-RWS, `:3951`, and
    P1-32-PRE-OD-RCF, `:4026`). Rows stored before the fix keep the value they were stored with.

20. **Email verification with the mail provider.** Stage 4 waits on the Owner's choice of recipient.
21. **CI.** The web-quality job runs close to its 30-minute limit. Should the limit be raised, or the
    job split?

    **Answered by the Owner, 2026-10-03.** The limit is raised from 30 to 45 minutes through one
    focused, reviewed pull request, delivered by #502. This is separate from the clean-room limit
    raised from 60 to 90 minutes by #493. Slow tests keep being improved; no unlimited retries and
    no extra concurrency.

22. **Refund decision code (CC-OD-58, ADR-023 D2 part 2).** Organisations provisioned earlier cannot
    approve or reject a refund request after upgrade until `sal.refund.approve` is granted, and the
    backfill covers only the named QA organisations. Should the backfill extend to every existing
    organisation, or stay limited with the change stated to them? _Decision pack:_ [PERM01](decision-pack-2026-10-08.md#perm01-giving-new-rights-to-existing-organisations).

Questions 23 to 28 were added on 2026-10-08 (P1-32-PRE-OD-WP00) for the decision labels of the
completion plan of 2026-10-08 (outside the repository) that had no canonical id. Each states the
exact question, the options, the planner's recommendation (not an Owner decision), what it affects,
and the interim treatment that holds until it is answered.

23. **Item category rename and move (plan label CAT01).** May an organisation rename an item
    category, and move it under another parent? Today the category API only creates and lists
    (`apps/api/src/app/api/v1/item-categories/route.ts`: `inv.item-category-create` declares
    `inv.item.manage`, `inv.item-category-list` declares `inv.item.read`); there is no rename,
    move or retire operation.
    - (a) A read-only tree only.
    - (b) Rename only: a name unique among its siblings within the same scope, under the existing
      English and Arabic naming rules.
    - (c) Rename and move, with invariants: no category becomes its own parent or moves under one of
      its own descendants; a move stays within the same scope; inactive categories and the
      descendants that move with their parent are treated by a stated rule; each change carries
      If-Match on the category's version, runs in one transaction and writes one audit event. No
      deletion and no mass reassignment of items.

    _Recommendation:_ (c), gated by the code that governs category creation today,
    `inv.item.manage`; no new code. _Affects:_ new inventory operations (each a literal
    `defineOperation` with its audit action), a forward migration if a version column or a cycle
    guard is needed, the inventory interface (completion-plan package WP02), the user manual's
    inventory part, and the inventory acceptance cases. _Interim:_ the category tree is shown
    read-only and labelled read-only; categories are still created as today. _Decision pack:_
    [CAT01](decision-pack-2026-10-08.md#cat01-renaming-and-moving-item-categories), [CAT01-NAME](decision-pack-2026-10-08.md#cat01-name-category-names-among-siblings-and-second-language-names) and [CAT01-TREE](decision-pack-2026-10-08.md#cat01-tree-the-rules-a-category-move-follows).

24. **Cancelling an approved refund that is not yet paid out (plan label FIN03).** Under ADR-023 D2
    part 2 at most one request per obligation is live (pending, or approved and not yet paid out;
    `refund_request_live_exists`), each request is paid out once, and an obligation cannot be
    cancelled (ADR-023 D2 open point (e)). So an approved request that will not be paid blocks every
    new request on its obligation; paying back in parts is done by several requests. May an approved
    request that has not been fully paid out be cancelled, and by whom?
    - (a) No cancellation (today).
    - (b) A holder of `sal.refund.approve` other than the requester may cancel an approved request
      that has not been fully paid out, with a reason; the unpaid remainder of the obligation can
      then be requested again; payouts already recorded stay.
    - (c) The requester asks for cancellation, and a second person approves it.

    _Recommendation:_ (b). _Affects:_ `sal.refund_requests` and its guard (a forward migration
    for the new transition), a new refund operation with its audit action and its D12 refusal
    records, the refunds panel and list in English and Arabic, ADR-023 D2 (a new open point recorded
    by a further ADR change, not by editing the decision), and the D2 acceptance cases (D2-3, D2-4).
    _Interim:_ today's behaviour: an approved request not yet paid out blocks a new request on its
    obligation. _Decision pack:_ [FIN03](decision-pack-2026-10-08.md#fin03-cancelling-an-approved-refund-that-is-not-yet-paid-out).

25. **Who may record a refund payout (plan label FIN04).** Today a different person must approve a
    refund (the approver differs from the requester), and any holder of `sal.payment.record` in the
    branch records the payout, the requester included (ADR-023 D2 part 2). Must the person who
    records the payout differ from someone else in the chain?
    - (a) No restriction beyond today's rule.
    - (b) The person recording the payout must differ from the approver.
    - (c) The person recording the payout must differ from both the requester and the approver.

    _Recommendation:_ (b). _Affects:_ the payout command and its database guard (a forward
    migration), a new refusal code with its D12 record, who is offered the payout form, the D2-3
    acceptance cases; with (c), an organisation needs three people who can handle a refund.
    _Interim:_ today's rule stays: the approver differs from the requester, and the recorder is not
    restricted further. _Decision pack:_ [FIN04](decision-pack-2026-10-08.md#fin04-who-may-record-a-refund-payout).

26. **Credit-note numbering and legal fields (plan label DOC01).** A credit note has no document
    number today; its print carries a reference composed from the invoice number and the request
    time (`capability-status.md`, accounting section, row D10). Should credit notes be numbered?
    - (a) Keep the composed reference.
    - (b) A credit-note number sequence per company and branch, assigned on approval as invoice
      numbers are; the legal and tax fields of the document wait on the accounting questionnaire
      (plan label ACC01; questions 10 to 12).

    _Recommendation:_ (b) for the numbering; the legal fields with the questionnaire. _Affects:_
    the number-sequence configuration (a new document type, and provisioning the sequence for
    existing organisations, since a document number has no fallback), the credit-note approval
    path, the credit-note screens and print, ADR-023 D10, and the D10 print cases (PC-1, PC-2).
    _Interim:_ the composed reference; no numbering policy is invented. _Decision pack:_
    [DOC01](decision-pack-2026-10-08.md#doc01-credit-note-numbering).

27. **Report configuration in organisations provisioned earlier (plan label RPT03).** The
    administrator bundle has carried `rpt.report.configure` since 2026-09-09 (P1-31 P-11;
    `apps/api/src/modules/iam/domain/bootstrap-roles.ts`). An organisation provisioned before then
    gains it only through the operator backfill, so its administrators may lack it, cannot grant
    themselves a code they do not hold, and since #532 cannot save a report snapshot (VL-P132-010).
    Which existing organisations should receive it?
    - (a) Named organisations, on request: a dry run, then an audited backfill of their
      administrator role with `scripts/platform/backfill-tenant-administrator-bundle.mjs`,
      preserving a customised role (the pattern of CC-OD-53 and CC-OD-58).
    - (b) Every existing organisation.
    - (c) None.

    _Recommendation:_ (a); answer together with questions 8 and 22, which ask the same of other
    codes. _Affects:_ existing organisations' administrator roles, the backfill script's tenant
    list, the D16 snapshot acceptance cases, and the snapshot-code question (VL-P132-010).
    _Interim:_ no grant; such an organisation cannot configure a report or save a snapshot until an
    operator acts on the answer. _Decision pack:_ [RPT03](decision-pack-2026-10-08.md#rpt03-report-configuration-in-organisations-provisioned-earlier) and [PERM01](decision-pack-2026-10-08.md#perm01-giving-new-rights-to-existing-organisations).

28. **The standing promotion pull request #503 (plan label CI01).** #503 (`develop` → `main`)
    is open; its head is the `develop` branch itself, so it carries no commits of its own, and it
    has no reviews and no comments (read 2026-10-08). Each push to `develop` re-runs `main`'s full
    gate on it (22 runs and 1,607 job-minutes from 2026-09-27 to 2026-10-05,
    `docs/engineering/ci-automation/pr-gate.md`, "What was removed from the development path").
    Close it, or keep it?
    - (a) Close it. Nothing is lost: it has no unique commits, reviews or comments. The next
      promotion opens a new `develop` → `main` pull request after a `main` → `develop` sync.
    - (b) Keep it open, accepting the repeated `main`-targeted runs.

    Never merge it to stop the runs. _Recommendation:_ (a). _Affects:_ hosted CI minutes, the
    promotion procedure, and VL-CI-004, whose probe B is "the next synchronize run of the standing
    promotion pull request" and would move to the next promotion pull request. _Interim:_ #503 stays
    open and untouched; it is the Owner's.

### Completion plan labels and canonical ids (2026-10-08)

The completion plan of 2026-10-08 (outside the repository) names its decisions with navigation
labels. They are cross-references only: the canonical ids below stay the record, and a label never
carries a state of its own. Imported 2026-10-08 (P1-32-PRE-OD-WP00); the 104 audit items and the
200 requirement ids are crosswalked at the end of `capability-status.md`. The last column links the
section of the decision pack of 2026-10-08 that prepares each label for the Owner; a link records no
answer.

| Label     | Canonical ids (where the decision is recorded)                                                                                                                | Decision pack (2026-10-08)                                                                                                                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAT01     | Question 23 (new 2026-10-08)                                                                                                                                  | [CAT01](decision-pack-2026-10-08.md#cat01-renaming-and-moving-item-categories), [CAT01-NAME](decision-pack-2026-10-08.md#cat01-name-category-names-among-siblings-and-second-language-names), [CAT01-TREE](decision-pack-2026-10-08.md#cat01-tree-the-rules-a-category-move-follows)                                                                                      |
| PLAN01    | CC-OD-24; related CC-OD-49                                                                                                                                    | [PLAN01](decision-pack-2026-10-08.md#plan01-the-plan-chosen-when-an-organisation-is-provisioned)                                                                                                                                                                                                                                                                          |
| ACCESS01  | Question 18, its second-company half                                                                                                                          | not in this pack                                                                                                                                                                                                                                                                                                                                                          |
| ACCESS02  | Question 18, its platform-operator half; D-OD-01                                                                                                              | not in this pack                                                                                                                                                                                                                                                                                                                                                          |
| FIN01     | VL-P132-003; ADR-023 D5 and D15, open policy point "the same service approved again"                                                                          | [FIN01](decision-pack-2026-10-08.md#fin01-the-same-service-sold-again-on-a-second-quotation), [FIN01-b](decision-pack-2026-10-08.md#fin01-b-two-quotations-with-approved-work-on-one-work-order), [FIN01-c](decision-pack-2026-10-08.md#fin01-c-a-quantity-or-price-lowered-after-it-was-invoiced)                                                                        |
| FIN02     | VL-P132-001, VL-P132-002; ADR-023 D8 open points                                                                                                              | [FIN02 part 1](decision-pack-2026-10-08.md#fin02-part-1-who-may-approve-a-discount-vl-p132-001), [FIN02 part 2](decision-pack-2026-10-08.md#fin02-part-2-an-approvers-own-changes-vl-p132-002)                                                                                                                                                                            |
| FIN03     | Question 24 (new 2026-10-08); nearest existing: ADR-023 D2 open point (e)                                                                                     | [FIN03](decision-pack-2026-10-08.md#fin03-cancelling-an-approved-refund-that-is-not-yet-paid-out)                                                                                                                                                                                                                                                                         |
| FIN04     | Question 25 (new 2026-10-08)                                                                                                                                  | [FIN04](decision-pack-2026-10-08.md#fin04-who-may-record-a-refund-payout)                                                                                                                                                                                                                                                                                                 |
| PERM01    | Questions 8, 9 and 22; CC-OD-50 (items 1 to 3 and 7), CC-OD-53, CC-OD-54, CC-OD-58                                                                            | [PERM01](decision-pack-2026-10-08.md#perm01-giving-new-rights-to-existing-organisations)                                                                                                                                                                                                                                                                                  |
| PRINT01   | VL-P132-005; question 9, its print part; CC-OD-50 item 3                                                                                                      | [PRINT01-a](decision-pack-2026-10-08.md#print01-a-a-print-permission-for-each-document), [PRINT01-b](decision-pack-2026-10-08.md#print01-b-quotation-amounts-on-paper), [PRINT01-c](decision-pack-2026-10-08.md#print01-c-invoice-details-for-a-user-without-finance-visibility), [PRINT01-d](decision-pack-2026-10-08.md#print01-d-payer-and-customer-wording-on-prints) |
| DOC01     | Question 26 (new 2026-10-08); ADR-023 D10                                                                                                                     | [DOC01](decision-pack-2026-10-08.md#doc01-credit-note-numbering)                                                                                                                                                                                                                                                                                                          |
| RPT01     | VL-P132-008 (Owner decision CC-04 of 2026-09-08)                                                                                                              | [RPT01](decision-pack-2026-10-08.md#rpt01-who-may-export-a-report-as-csv-vl-p132-008)                                                                                                                                                                                                                                                                                     |
| RPT02     | VL-P132-010                                                                                                                                                   | [RPT02](decision-pack-2026-10-08.md#rpt02-a-separate-permission-for-saving-report-snapshots-vl-p132-010)                                                                                                                                                                                                                                                                  |
| RPT03     | Question 27 (new 2026-10-08); related P1-31 O-19 (not among D-32 to D-38) and O-4 (answered as D-34)                                                          | [RPT03](decision-pack-2026-10-08.md#rpt03-report-configuration-in-organisations-provisioned-earlier)                                                                                                                                                                                                                                                                      |
| ODO01     | VL-P132-009                                                                                                                                                   | [ODO01](decision-pack-2026-10-08.md#odo01-who-may-record-odometer-readings-vl-p132-009)                                                                                                                                                                                                                                                                                   |
| LIC01     | Questions 1 to 7, 13, 14 and 17; ADR-024; CC-OD-33 to CC-OD-39, CC-OD-49. Question 7's method was decided on 2026-10-03; the rest is open                     | not in this pack                                                                                                                                                                                                                                                                                                                                                          |
| ACC01     | Questions 10, 11, 12, 15, 16 and 17; CC-OD-25, CC-OD-47, CC-OD-48; D-OD-12                                                                                    | not in this pack                                                                                                                                                                                                                                                                                                                                                          |
| EMAIL01   | Question 20; P1-15 OD-02 (`docs/phase-1/phase-1-15/open-decisions.md`). The plan's "OD-02" is P1-15's message-provider decision, not this directive's D-OD-02 | not in this pack                                                                                                                                                                                                                                                                                                                                                          |
| AUTH01    | CC-OD-31 (its behaviour half is open); the W9-R1 residual recorded in CC-OD-29                                                                                | [AUTH01](decision-pack-2026-10-08.md#auth01-signing-other-devices-out-after-a-password-change)                                                                                                                                                                                                                                                                            |
| GOV01     | P1-31 O-1, O-2, O-3, O-4, O-10 and O-20, answered by the Owner on 2026-09-16 as D-38, D-32, D-33, D-34, D-35 and D-36 (CONDITIONAL PASS); see below           | not in this pack                                                                                                                                                                                                                                                                                                                                                          |
| CI01      | Question 28 (new 2026-10-08); related VL-CI-003, VL-CI-004                                                                                                    | not in this pack                                                                                                                                                                                                                                                                                                                                                          |
| DATA01    | CC-OD-28, CC-OD-15; `docs/product/owner-requirements-2026-09-06.md` area F and H-3                                                                            | not in this pack                                                                                                                                                                                                                                                                                                                                                          |
| RELEASE01 | OIR-01, the product name (`docs/phase-1/phase-1-25/owner-input-required.md`); P1-31 O-11 (not answered by D-32 to D-38); D-OD-05                              | not in this pack                                                                                                                                                                                                                                                                                                                                                          |

**GOV01, stated precisely.** The plan presents the P1-31 phase decisions as unanswered. They are
not: the Owner answered O-1, O-2, O-3, O-4, O-10 and O-20 on 2026-09-16, recorded as D-32 to D-38 in
`docs/phase-1/phase-1-31/owner-decisions-2026-09-16.md` (D-38: CONDITIONAL PASS for the documented
P1-31 scope, answering O-1; D-32 answers O-2, D-33 O-3, D-34 O-4, D-35 O-10, D-36 O-20). What is
still open is narrower: the nine determinations QA-C1 to QA-C5 and SEC-C1 to SEC-C4 are absent, and
gate conditions 2 and 3 are unsatisfied (`docs/phase-1/phase-1-31/closure-record.md`, the
verdict and its conditions). P1-31 is not promoted.

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
