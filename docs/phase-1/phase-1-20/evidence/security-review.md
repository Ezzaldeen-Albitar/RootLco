# P1-20 security review

Covers **P1-20-SEC-001** (permission and resolved-scope enforcement),
**P1-20-SEC-002** (sensitive-data, export and file-access controls),
**P1-20-SEC-003** (abuse-case and privilege-escalation controls) and
**P1-20-SEC-004** (security audit-event coverage).

Every claim below names the test that backs it. A claim with no test is recorded as
an open item rather than asserted.

## P1-20-SEC-001 — permission and resolved-scope enforcement

### Authorization map

| Operation                        | Permissions (conjunction)                    | Scope      | How the scope target is obtained                                            |
| -------------------------------- | -------------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| `svc.service-list`               | `svc.service.read`                           | tenant     | `availableAtBranchId` is re-authorized as a concrete target when supplied   |
| `svc.price-list-list`            | `svc.price.read`                             | tenant     | none — `svc.price_lists` has no company or branch column                    |
| `svc.price-list-create`          | `svc.price.manage`                           | tenant     | as above                                                                    |
| `svc.price-list-version-create`  | `svc.price.manage`                           | tenant     | as above                                                                    |
| `svc.price-rule-record`          | `svc.price.manage`                           | **branch** | `companyId`/`branchId` in the body ARE the selectors, authorized before use |
| `svc.price-list-version-publish` | `svc.price.publish`                          | tenant     | as above                                                                    |
| `svc.price-resolve`              | `svc.price.read`                             | **branch** | `companyId` + `branchId` are REQUIRED query parameters and are the target   |
| `quo.quotation-create`           | `quo.quotation.manage`, `wo.work_order.read` | **branch** | the work order's own company and branch, via `requireWorkOrder`             |
| `quo.quotation-detail`           | `quo.quotation.read`                         | **branch** | the quotation row's own company and branch, after it is read                |
| `quo.quotation-revision-create`  | `quo.quotation.manage`                       | **branch** | the locked quotation's own scope                                            |
| `quo.quotation-issue`            | `quo.quotation.manage`                       | **branch** | the locked quotation's own scope                                            |
| `quo.quotation-item-decide`      | `quo.decision.record`                        | **branch** | the locked parent quotation's own scope                                     |
| `quo.quotation-revision-decide`  | `quo.decision.record`                        | **branch** | the locked parent quotation's own scope                                     |

**No operation declares `scope: 'branch'` without enforcing it.** That is checked
structurally, not asserted: `scripts/p1-20-endpoint-inventory.mjs` fails the build
for any `scope: 'branch'` operation whose handler contains no `authorizeScope`,
`authorizationTarget` or `scopeTargetOption`. Comments are stripped before the
search, because P1-19's equivalent guard was first satisfied by the comment
explaining the fix.

### ¹ Tenant-scoped is not the same as unguarded

The map above says `tenant` for the price-list operations because a price list carries no
company and no branch. That is accurate as a REGISTRY fact and was, until `7a58272`, an
incomplete description of the control — an earlier revision of this section reasoned from it
as though the tenant check were sufficient, and an independent audit caught that the section
still described the escalation as the design after the code had closed it.

Two of those operations now require **tenant-wide authority** in the handler:
`svc.price-rule-record` when both selectors are omitted (a wildcard rule prices every
branch), and `svc.price-list-version-publish` (publication makes a version's prices the ones
the tenant charges). Both ask the deployed `iam.has_permission_in_scope` with an all-NULL
target, which only `scope_mode = 'unrestricted'` satisfies. A branch-scoped actor keeps the
ability to write rules naming its own branch.

### Why the tenant-scoped operations are correct rather than convenient

`svc.price_lists` carries no `company_id` and no `branch_id` — a price list is
tenant-wide reference data, and `svc.price_list_assignments` is what binds it to a
company, branch or customer class. There is therefore no branch to target, and
declaring one would be actively harmful: `authorizeScope` would have to be called
with a concrete target on every path, and `requireScopedPermissions` fails closed on
an empty one, so every call would 403. `svc.service-list` is the same case with one
addition — when the caller _does_ name a branch, that branch is authorized before it
is used as a filter, which is strictly stronger than the tenant check.

### Why `svc.price-rule-record` is branch-scoped

A price list has no company or branch, but a price **rule** does. `company_id` and
`branch_id` are the selectors `svc.resolve_price` scores at
`branch*4 + company*2 + class*1`, so one rule row decides one branch's price — and they
arrive from the request body with no foreign key behind them. Declaring `tenant` made
the pre-handler check scope-blind, so an actor holding `svc.price.manage` scoped only to
branch A2 could write a branch-A1-specific rule at maximum priority and set the price
charged in a branch they hold nothing in. The handler now authorizes the selector it is
given, before the row is written.

A wildcard rule (both selectors omitted) names no scope to narrow and is left to the
tenant check, because `authorizeScope({})` fails closed and would refuse every wildcard
rule. And the company/branch pair is checked for COHERENCE before it is authorized:
`iam.has_permission_in_scope` is disjunctive across grant-scope rows, so an incoherent
pair could otherwise be authorized against whichever half happens to match.

### The decisive isolation cases

An isolation case only proves something if the principal **holds the operation's own
permission** and the target row is **readable**. Both halves are load-bearing:

- Without the permission, the 403 is a missing permission, and a scope-blind
  `iam.has_permission` produces exactly the same 403 — the test cannot fail on the
  defect it names.
- Without a widening grant, the target branch is outside
  `iam.allowed_branch_ids()` — the permission-**blind** union of every active grant —
  so RLS hides the row and the request fails whether scope was consulted or not.

With both, a scope-blind check would **allow** the request. The three principals below
each hold their operation's permission in full, scoped to branch A2, plus an unrelated
permission scoped to A1:

| Principal                  | Holds                                                             | Proves                                                             |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `SVC_PERMISSION_ELSEWHERE` | `svc.service.read`                                                | the catalog branch filter                                          |
| `SVC_PRICE_SCOPED_A2`      | `svc.price.read`, `svc.price.manage`, `svc.price.publish`         | price resolution and the price-rule selector                       |
| `SVC_QUO_SCOPED_A2`        | `quo.quotation.read`/`.manage`, `quo.decision.record`, `wo.…read` | quotation create, detail, revise, issue and both decision surfaces |

This is a Wave 9 correction. Before it, the pricing and quotation isolation cases used
`SVC_SCOPED_A2` and `SVC_PERMISSION_ELSEWHERE`, which hold `svc.service.read` alone —
so every one of those 403s was a missing-permission refusal wearing an isolation label,
and this document's earlier claim that `SVC_PERMISSION_ELSEWHERE` "holds the read
permission" was true only of the catalog operation. The old cases are kept beside the
new ones as the permission-refusal half.

- `tests/backend/p1-20-service-catalog.test.ts` — "refuses A1 for a caller whose A1
  grant carries an UNRELATED permission".
- `tests/backend/p1-20-pricing.test.ts` — "refuses a branch the caller holds no price
  permission in (P1-18-A-01)" and "svc.price-rule-record refuses … another branch".
- `tests/backend/p1-20-quotation.test.ts` — the four `quo writes` floor cases and the
  create/detail isolation cases.

### A role's approval ceiling stops where its grant stops

`iam.approval_limits` rows are per `(role, company)`, and a role grant may be confined
to particular companies or branches. `callerApprovalCeiling` filtered its role subquery
on tenant and user only, so an actor inherited a role's ceiling in **every** company that
role had a limit in — including companies their grant of that role never covered. Hold
role R scoped to company A and role S scoped to company B, and acting in company B you
were credited with R's company-B limit.

It is now gated on `scope_mode = 'unrestricted'` OR a `grant_scopes` row naming the
company, which `ck_grant_scopes_shape` guarantees is populated for all three scope
types — so the ceiling check and `iam.has_permission_in_scope` cannot disagree about
which grants reach a company. Demonstrating it needs two companies in one tenant, which
is why the fixtures seed `COMPANY_A2`; both halves are asserted, because "always return
null" would satisfy the negative alone.

### Citing a quotation revision requires `quo.quotation.read`

`wo.additional-work-approval` is a P1-19 operation and declares no commercial
permission. On its own that let a caller holding `wo.additional_work.approve` learn a
revision's acceptance state and revision status from the refusal messages the linking
path produces — the exact surface `quo.quotation.read` governs.

The requirement is enforced inside `assertLinkableQuotationRevision` rather than added
to the operation's `permissions`, because that list is a **conjunction**: declaring it
would force every P1-19 caller recording an approval _without_ a quotation to hold a
commercial permission it has no business holding. It names the concrete company and
branch, so the answer consults grant scope rather than the scope-blind fallback.

The scope check also runs **before** the work-order check now. Testing the work order
first told a caller naming a revision from another company _which_ work order it
belonged to before the scope check ever ran — a foreign work-order id disclosed to a
caller holding nothing in that scope, from an endpoint they legitimately reach.

### Separated authorities

- `svc.price.manage` drafts a price; `svc.price.publish` makes it the price the
  tenant charges. Publication is effectively irreversible — the freeze guard permits
  only `published → archived` — so the authority to draft is not the authority to
  commit.
- `quo.quotation.manage` builds and issues; `quo.decision.record` records what the
  customer decided. A workshop that can issue a quotation must not thereby be able
  to record the customer's acceptance of it.
- `quo.quotation-create` additionally requires `wo.work_order.read`, because it reads
  the work order to derive scope. Permissions are a conjunction, so this is a
  declaration rather than a hidden dependency.

## P1-20-SEC-002 — sensitive data, export and file access

### The catalog read carries no price

`ServiceView` has no amount, currency, tax-rate or price-rule field, and no query in
`service-catalog` reads `svc.price_rules`. Price resolution depends on company,
branch, customer class and date and is gated on `svc.price.read`, which is `medium`
risk precisely because a price list exposes what the business charges every customer
segment. Bolting a price onto the catalog read would hand the price book to every
holder of `svc.service.read`.

Asserted by scanning the whole response body for `unitPrice`, `amount`, `currency`,
`priceRule`, `captured` and `taxRate` —
`tests/backend/p1-20-service-catalog.test.ts`, "returns no amount, currency, or
price-rule field anywhere in the body".

### Money never crosses as a float

Every monetary value crosses the API as a decimal **string** with an explicit
currency. `numeric(18,4)` holds values IEEE-754 cannot represent, so a JSON number
would lose money for some inputs, silently and unrepeatably. The detail test asserts
both the positive (`"unitPrice":"100.0000"`) and the negative (no unquoted
`"unitPrice": 100`).

### Approval evidence

`quo.approval_evidence.document_version_id` is a `shared.document_versions` id. A
direct storage key is **unexpressible** on this surface — the field is a uuid, so a
key like `tenant-a/quotations/blob.pdf` is refused by validation before any storage
layer is consulted.

Beyond existence, `AttachmentService.verifyEvidenceVersion` confirms the version is
in the caller's scope, shares the quotation's company and branch, and **is actually
linked to this quotation**. Without that last check any document the caller could see
could be attached as evidence for any quotation.

Evidence content never appears in an event payload, an audit detail or a problem
document. Audit records the evidence **row id** and its kind, never the note text.

Tests: `tests/backend/p1-20-quotation.test.ts` — direct-storage-key rejection,
document/verbal shape coupling (`ck_approval_evidence_document`), and the LINK case,
which is the one that carries this control.

That case seeds TWO real `shared.document_versions` rows on the quotation's own company
and branch, differing only in which entity their live `shared.document_links` row names:
one the quotation under test, the other a second quotation that genuinely exists. The
foreign one is refused **422/ERR-VAL-001** — distinguishable from the missing-version
404 and the wrong-branch 403 — and the own one is ACCEPTED, writing exactly one
`quo.approval_evidence` row counted in SQL, with `approval_decisions.evidence_ref`
holding the same version id. That acceptance is the only execution `insertEvidence` has
anywhere in the phase.

Both halves are load-bearing, and an earlier version of this case had neither. It passed
a version id nothing had inserted, so it died on `findVersion` with a 404 and never
reached the link check at all: `linkedToEntity` could have been hard-coded and the only
assertion (`status >= 400`) would still have held. Mutation-verified in both directions —
forcing the link check to `true` makes the foreign document succeed where 422 is
expected, forcing it to `false` makes the own document fail — so neither constant
survives.

### No export surface

P1-20 adds no export operation, so `export` audit class is unused by this phase.
Recorded here so its absence is a decision rather than an oversight.

## P1-20-SEC-003 — abuse cases and privilege escalation

| Abuse case                           | Refused by                                                                                     | Test                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Price tampering                      | the client cannot send a price; `.strict()` rejects `unitPrice`                                | quotation: "REJECTS a client-supplied price, tax or total"                                    |
| Tax tampering                        | `taxRate`/`taxAmount` likewise rejected; the rate comes from `org.tax_rates`                   | same                                                                                          |
| Total tampering                      | `lineTotal` rejected; totals are `quo.issue_revision`'s SUM                                    | same                                                                                          |
| Discount escalation past the policy  | threshold from `svc.pricing_approval_policies`; over it, the configured permission is required | pricing unit: "refuses when the actor lacks the required permission"                          |
| Discount escalation past the ceiling | `iam.approval_limits`, read through the foundation                                             | pricing unit: "refuses when the discount exceeds the actor ceiling"                           |
| Discount with NO ceiling configured  | fail-closed — no ceiling is no authority                                                       | quotation: "refuses a discount when the actor has NO approval ceiling"                        |
| Self-approved discount               | `maker_approver_distinct`                                                                      | pricing unit: "refuses when the requester and the approver are the same actor"                |
| Currency mismatch / silent FX        | `Money` exposes no conversion; a mismatch is a hard failure                                    | decimal unit: "exposes no conversion path at all"; pricing: ceiling currency mismatch         |
| Negative price or discount           | refused at the boundary and by CHECK                                                           | pricing: "refuses over-scale, negative and exponential amounts"                               |
| Decimal overflow                     | precision checked against the column                                                           | decimal unit: "rejects one digit more than the precision allows"                              |
| Scientific notation                  | rejected, not normalised                                                                       | decimal unit: "rejects exponential notation outright"                                         |
| Duplicate issue                      | `quo.issue_revision` requires `draft`; one event key                                           | quotation: "refuses a second issue … and publishes no second event"                           |
| Concurrent publication               | one winner, one event                                                                          | pricing: "leaves exactly one published version and one event under a forced race"             |
| Duplicate decision                   | `uq_approval_decisions_item`; same decision settles, opposite conflicts                        | quotation: "is idempotent for the same decision and a conflict for the opposite"              |
| Approval after expiry                | `hasExpired` against the database clock                                                        | link: "refuses an EXPIRED revision"                                                           |
| Approving a superseded revision      | `presentedRevisionId` + `current_revision_id`                                                  | quotation: "refuses a decision on a SUPERSEDED revision"                                      |
| Forged deciding party                | validated against `payer_partner_ref`                                                          | quotation: "refuses a forged deciding party"                                                  |
| Forged attachment                    | must be linked to THIS quotation, not merely visible                                           | quotation: "refuses a version linked to ANOTHER quotation and accepts the one linked to this" |
| Direct storage key                   | unexpressible (uuid field)                                                                     | quotation: "rejects a direct storage key"                                                     |
| Idempotency omission                 | `idempotent: true` on every command                                                            | quotation: "requires an Idempotency-Key"                                                      |
| Ambiguous price selection            | structurally impossible; guard retained                                                        | pricing: "cannot construct a rule-level tie"                                                  |
| Enumeration via a branch filter      | the filter is authorized before use                                                            | service catalog isolation cases                                                               |
| Search wildcard abuse                | `%` and `_` escaped with `ESCAPE`                                                              | service catalog: "treats LIKE metacharacters … as literals"                                   |

Rate limiting uses the existing registered policies (`expensive-read`,
`standard-command`, `low-risk-metadata`); no new policy was invented.

## P1-20-SEC-004 — security audit-event coverage

P1-20 registers **17** audit actions (110 → 127) and is the first phase to use the
`financial` class, which was previously unused. That class is right here: these acts
commit the platform to a monetary figure a customer can hold it to.

The decision actions are `approval`, not `financial`, because what they record is a
party's authorization — the amounts were frozen when the revision was issued and
cannot move afterwards.

| Act                          | Action                                 | Class      |
| ---------------------------- | -------------------------------------- | ---------- |
| Price list created           | `svc.price_list.created`               | financial  |
| Draft version created        | `svc.price_list_version.created`       | privileged |
| Price rule recorded          | `svc.price_rule.recorded`              | financial  |
| Version published            | `svc.price_list_version.published`     | financial  |
| Discount authorized          | `svc.discount.authorized`              | financial  |
| Quotation created            | `quo.quotation.created`                | financial  |
| Revision created             | `quo.quotation_revision.created`       | financial  |
| Revision issued              | `quo.quotation_revision.issued`        | financial  |
| Quotation expired            | `quo.quotation.expired`                | financial  |
| Item decided                 | `quo.quotation_item.decided`           | approval   |
| Revision decided (aggregate) | `quo.quotation_revision.decided`       | approval   |
| Quotation accepted           | `quo.quotation.accepted`               | approval   |
| Quotation rejected           | `quo.quotation.rejected`               | approval   |
| Additional-work link         | `quo.additional_work.quotation_linked` | approval   |
| Service updated              | `svc.service.updated`                  | privileged |
| Branch availability changed  | `svc.branch_availability.changed`      | privileged |
| Service version published    | `svc.service_version.published`        | privileged |

Class agreement is enforced twice: `defineOperation` rejects a mismatch at module
load, and `scripts/p1-20-endpoint-inventory.mjs` re-checks by reading the source, so
an operation no test imports still fails CI.

### Every declared action has a producer, and two did not

`svc.discount.authorized` and `quo.additional_work.quotation_linked` were registered in
the controlled catalog and emitted by **nothing**. The catalog therefore documented
behaviour that did not exist, and in both cases the missing record was the one an
auditor would actually reach for:

- **The discount.** `DiscountAuthorizationService.authorize` returns the threshold that
  applied and the ceiling it checked precisely so the caller can record them — its own
  doc says "authorized" with no reason is not an auditable fact — and the return value
  was discarded. It is now written once per revision that needed elevated authority,
  carrying the policy id (or `unconfigured`, which means threshold zero and is _why_ the
  discount needed authorizing), the threshold kind and value, the permission required,
  the document-level discount total and the ceiling. Once per revision rather than per
  line, because the ceiling limits the actor and the document-level check is what
  enforces it; 200 identical records would bury the fact rather than record it. The
  catalog's `entityType` was corrected from `svc.discount_rules` — no such row need
  exist — to `quo.quotation_revision`.
- **The link.** `wo.customer_approvals.quotation_revision_ref` is frozen by
  `tg_customer_approvals_immutable`, so it is written exactly once and can never be
  corrected — and nothing recorded that it had been written. The approval record carries
  the decision, the channel and the party, and nothing about the quotation, so "on what
  commercial basis was this extra work released?" was unanswerable from the trail. It is
  now its own record, naming the revision, the request and the work order. No amount:
  the totals live in `quo.quotation_revisions` under their own authorization, and the
  reference is what makes them reachable.

Both are asserted by tests that read `iam.audit_record_details` and check the
classification of each field, not merely that a row exists.

### Audit content rules observed

- Amounts are classified `restricted` (`svc.price_rule.recorded`,
  `quo.quotation_revision.issued`, and both amounts in `svc.discount.authorized`),
  because a price is what the business charges.
- Free text a customer or advisor typed is `internal`, never `public`.
- Evidence **content** and reference notes are never recorded — only the row id.
- An **outbox payload is not an audit record.** `quotation.accepted` and
  `quotation.rejected` carried `grandTotal`; they no longer do. An acceptance is a state
  change, the totals are `restricted`, and an outbox row has different retention and no
  per-consumer authorization — every consumer would receive the figure whether it needed
  it or not. `quotation.revision-issued` keeps its total, because issuing _is_ the act of
  quoting a figure and its consumer is the delivery intent that presents it.

## Open security items

| Id           | Severity   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-20-A-03` | Low        | `quo.approval_decisions.decided_by` is the STAFF user who recorded the decision, not the customer. The schema has no customer-principal column, so the integrity control is that a claimed `decidingPartyRef` must equal the quotation's `payer_partner_ref`. The recorded fact is truthfully "staff user X recorded that the payer decided Y over channel Z". Stated rather than papered over.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `P1-20-A-04` | **CLOSED** | Three service-catalog audit actions (`svc.service.updated`, `svc.branch_availability.changed`, `svc.service_version.published`) were registered with no producing operation. The justification recorded here — "this phase ships the catalog READ surface, and the protected requirements do not mandate public mutations" — **was false**: `docs/phase-1/phase-1-10/p1-20-backend-contract.md` lists service INSERT/UPDATE and `svc.publish_service_version` as P1-20 deliverables. The actions had no producer because the operations had never been built. All three now have producers — `svc.service-create`/`svc.service-update`, `svc.branch-availability-set` and `svc.service-version-publish` — see `P1-20-G-01` in `open-decisions.md`. The structural point in the original text still stands and is still not implemented: the audit catalog has no `implementedIn` field, so nothing mechanically refuses a registered action with no producer, and this table remains the only place such an absence would be stated. That is now the only residue of the finding. |
| `P1-20-A-09` | Low        | Three module cycles pre-date this phase (`work-order` ↔ `diagnostics`, ↔ `quality`, ↔ `technician`, all present at `0d86a19`) and `check-module-boundaries.mjs` has no cycle rule, so `validate:module-boundaries` reports OK with all three live. P1-20 introduced none — `CommercialApprovalReader` is the correct pattern and the reason none was added — but a B13 rule now would fail the build on another phase's debt. The false claim that mutual imports are "the shape this repository avoids" has been removed from `commercial-approval.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `P1-20-A-07` | Low        | (also recorded in `open-decisions.md`) `countTiedPriceRules` mirrors ~45 lines of `svc.resolve_price` precedence SQL for a tie `uq_price_rules_signature` makes structurally impossible, with no test comparing the two. Retained deliberately: it defends a correctness property that rests on that index continuing to exist — drop or widen it and resolution silently becomes an `id`-ordered coin flip on a customer's price. The structural guarantee is asserted directly instead of pretending the branch has a positive test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
