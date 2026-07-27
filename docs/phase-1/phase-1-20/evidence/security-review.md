# P1-20 security review

Covers **P1-20-SEC-001** (permission and resolved-scope enforcement),
**P1-20-SEC-002** (sensitive-data, export and file-access controls),
**P1-20-SEC-003** (abuse-case and privilege-escalation controls) and
**P1-20-SEC-004** (security audit-event coverage).

Every claim below names the test that backs it. A claim with no test is recorded as
an open item rather than asserted.

## P1-20-SEC-001 — permission and resolved-scope enforcement

### Authorization map

| Operation                        | Permissions (conjunction)                    | Scope      | How the scope target is obtained                                          |
| -------------------------------- | -------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `svc.service-list`               | `svc.service.read`                           | tenant     | `availableAtBranchId` is re-authorized as a concrete target when supplied |
| `svc.price-list-list`            | `svc.price.read`                             | tenant     | none — `svc.price_lists` has no company or branch column                  |
| `svc.price-list-create`          | `svc.price.manage`                           | tenant     | as above                                                                  |
| `svc.price-list-version-create`  | `svc.price.manage`                           | tenant     | as above                                                                  |
| `svc.price-rule-record`          | `svc.price.manage`                           | tenant     | as above                                                                  |
| `svc.price-list-version-publish` | `svc.price.publish`                          | tenant     | as above                                                                  |
| `svc.price-resolve`              | `svc.price.read`                             | **branch** | `companyId` + `branchId` are REQUIRED query parameters and are the target |
| `quo.quotation-create`           | `quo.quotation.manage`, `wo.work_order.read` | **branch** | the work order's own company and branch, via `requireWorkOrder`           |
| `quo.quotation-detail`           | `quo.quotation.read`                         | **branch** | the quotation row's own company and branch, after it is read              |
| `quo.quotation-revision-create`  | `quo.quotation.manage`                       | **branch** | the locked quotation's own scope                                          |
| `quo.quotation-issue`            | `quo.quotation.manage`                       | **branch** | the locked quotation's own scope                                          |
| `quo.quotation-item-decide`      | `quo.decision.record`                        | **branch** | the locked parent quotation's own scope                                   |
| `quo.quotation-revision-decide`  | `quo.decision.record`                        | **branch** | the locked parent quotation's own scope                                   |

**No operation declares `scope: 'branch'` without enforcing it.** That is checked
structurally, not asserted: `scripts/p1-20-endpoint-inventory.mjs` fails the build
for any `scope: 'branch'` operation whose handler contains no `authorizeScope`,
`authorizationTarget` or `scopeTargetOption`. Comments are stripped before the
search, because P1-19's equivalent guard was first satisfied by the comment
explaining the fix.

### Why the tenant-scoped operations are correct rather than convenient

`svc.price_lists` carries no `company_id` and no `branch_id` — a price list is
tenant-wide reference data, and `svc.price_list_assignments` is what binds it to a
company, branch or customer class. There is therefore no branch to target, and
declaring one would be actively harmful: `authorizeScope` would have to be called
with a concrete target on every path, and `requireScopedPermissions` fails closed on
an empty one, so every call would 403. `svc.service-list` is the same case with one
addition — when the caller _does_ name a branch, that branch is authorized before it
is used as a filter, which is strictly stronger than the tenant check.

### The decisive isolation case

`SVC_PERMISSION_ELSEWHERE` holds the read permission scoped to branch **A2** and an
unrelated permission scoped to branch **A1**. The second grant places A1 in that
principal's `iam.allowed_branch_ids()` union, which is the permission-**blind** union
of every active grant — so RLS alone does not refuse it. Only a scoped permission
check does.

- `tests/backend/p1-20-service-catalog.test.ts` — "refuses A1 for a caller whose A1
  grant carries an UNRELATED permission".
- `tests/backend/p1-20-pricing.test.ts` — "refuses a branch the caller holds no price
  permission in (P1-18-A-01)".

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
document/verbal shape coupling (`ck_approval_evidence_document`), and the unlinked
document case.

### No export surface

P1-20 adds no export operation, so `export` audit class is unused by this phase.
Recorded here so its absence is a decision rather than an oversight.

## P1-20-SEC-003 — abuse cases and privilege escalation

| Abuse case                           | Refused by                                                                                     | Test                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Price tampering                      | the client cannot send a price; `.strict()` rejects `unitPrice`                                | quotation: "REJECTS a client-supplied price, tax or total"                            |
| Tax tampering                        | `taxRate`/`taxAmount` likewise rejected; the rate comes from `org.tax_rates`                   | same                                                                                  |
| Total tampering                      | `lineTotal` rejected; totals are `quo.issue_revision`'s SUM                                    | same                                                                                  |
| Discount escalation past the policy  | threshold from `svc.pricing_approval_policies`; over it, the configured permission is required | pricing unit: "refuses when the actor lacks the required permission"                  |
| Discount escalation past the ceiling | `iam.approval_limits`, read through the foundation                                             | pricing unit: "refuses when the discount exceeds the actor ceiling"                   |
| Discount with NO ceiling configured  | fail-closed — no ceiling is no authority                                                       | quotation: "refuses a discount when the actor has NO approval ceiling"                |
| Self-approved discount               | `maker_approver_distinct`                                                                      | pricing unit: "refuses when the requester and the approver are the same actor"        |
| Currency mismatch / silent FX        | `Money` exposes no conversion; a mismatch is a hard failure                                    | decimal unit: "exposes no conversion path at all"; pricing: ceiling currency mismatch |
| Negative price or discount           | refused at the boundary and by CHECK                                                           | pricing: "refuses over-scale, negative and exponential amounts"                       |
| Decimal overflow                     | precision checked against the column                                                           | decimal unit: "rejects one digit more than the precision allows"                      |
| Scientific notation                  | rejected, not normalised                                                                       | decimal unit: "rejects exponential notation outright"                                 |
| Duplicate issue                      | `quo.issue_revision` requires `draft`; one event key                                           | quotation: "refuses a second issue … and publishes no second event"                   |
| Concurrent publication               | one winner, one event                                                                          | pricing: "leaves exactly one published version and one event under a forced race"     |
| Duplicate decision                   | `uq_approval_decisions_item`; same decision settles, opposite conflicts                        | quotation: "is idempotent for the same decision and a conflict for the opposite"      |
| Approval after expiry                | `hasExpired` against the database clock                                                        | link: "refuses an EXPIRED revision"                                                   |
| Approving a superseded revision      | `presentedRevisionId` + `current_revision_id`                                                  | quotation: "refuses a decision on a SUPERSEDED revision"                              |
| Forged deciding party                | validated against `payer_partner_ref`                                                          | quotation: "refuses a forged deciding party"                                          |
| Forged attachment                    | must be linked to this quotation                                                               | quotation: "refuses an unlinked document as evidence"                                 |
| Direct storage key                   | unexpressible (uuid field)                                                                     | quotation: "rejects a direct storage key"                                             |
| Idempotency omission                 | `idempotent: true` on every command                                                            | quotation: "requires an Idempotency-Key"                                              |
| Ambiguous price selection            | structurally impossible; guard retained                                                        | pricing: "cannot construct a rule-level tie"                                          |
| Enumeration via a branch filter      | the filter is authorized before use                                                            | service catalog isolation cases                                                       |
| Search wildcard abuse                | `%` and `_` escaped with `ESCAPE`                                                              | service catalog: "treats LIKE metacharacters … as literals"                           |

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

### Audit content rules observed

- Amounts are classified `restricted` (`svc.price_rule.recorded`,
  `quo.quotation_revision.issued`), because a price is what the business charges.
- Free text a customer or advisor typed is `internal`, never `public`.
- Evidence **content** and reference notes are never recorded — only the row id.

## Open security items

| Id           | Severity | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-20-A-03` | Low      | `quo.approval_decisions.decided_by` is the STAFF user who recorded the decision, not the customer. The schema has no customer-principal column, so the integrity control is that a claimed `decidingPartyRef` must equal the quotation's `payer_partner_ref`. The recorded fact is truthfully "staff user X recorded that the payer decided Y over channel Z". Stated rather than papered over.                                                     |
| `P1-20-A-04` | Low      | Three service-catalog audit actions (`svc.service.updated`, `svc.branch_availability.changed`, `svc.service_version.published`) are registered but have no producing operation yet: this phase ships the catalog READ surface, and the protected requirements do not mandate public mutations. Registered now so a later phase cannot invent a conflicting code. No operation declares them, so the inventory gate does not report them as missing. |
