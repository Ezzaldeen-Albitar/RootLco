# DBCR-P1-32-PRE-OD-FD8-001 — no self-exemption from discount approval, and the requester's withdrawal

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner decisions D8 and D3 of
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md) · **Owner:** Eng. Ezzaldeen
Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements the Owner's decisions D8 and D3 of 2026-09-30; applying it to any existing
database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261007090000_quo_discount_self_exemption_and_withdrawal.sql`
  (the 172nd)
- **Seed change:** none. **Permission change:** none — the withdrawal route declares the existing
  `quo.quotation.manage`. **Audit action:** one new, `quo.discount_approval.withdrawn` (class
  `approval`).
- **Executable proof:** `tests/db/quo-discount-self-exemption.test.ts` (the columns and their
  shapes; every new function SECURITY INVOKER and the D8 read executable by `app_runtime` only;
  provenance stamped from the session whatever the statement says, moved only by a change to a
  price, and snapshotted on a line so a later change does not move it; the D8 rule at the issue guard
  and on the request; a limit the requester set never counting; the withdrawal by the requester only,
  stamped, terminal, never decided, never issued, and asked again by revising; a tenant-B session
  neither withdraws nor reads), `tests/backend/od-discount-self-exemption.test.ts` (the routes end to
  end), `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census) and
  `tests/db/foundation.test.ts` (inventories).
- **Rollback classification:** **ROLLBACK-SAFE WHILE NO REQUEST IS WITHDRAWN** — the inverse is in
  the migration footer; it refuses to run once a request was withdrawn, because the withdrawn state
  and its stamp are the only record that the requester took the request back.

---

## 1. Why this change request exists

D8: "Changing one's own threshold, role limit or price list never exempts one's own quotation from
approval. Provenance and snapshots are kept. There is no sole-administrator exception." D3: "The
requester may withdraw their own pending request."

Before this migration a quotation was held to the discount threshold version in force when it was
written, and an approver's own limit never counted. But a person could record a higher threshold
and then write a quotation of their own under it; could set a colleague's approval limit (or that of
a role the colleague holds) high enough for the colleague to approve their own discount; and could
change a price rule or an item selling price and discount a line priced at it. Who set a threshold
was only a `created_by` the writer supplied, and a price changed in place kept no trace of who
changed it. A pending discount request could only be decided by somebody else or replaced by
revising the quotation.

## 2. The change

| Object                                                            | Change                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svc.pricing_approval_policies`                                   | `set_by`, `set_at`: who recorded the version, stamped from the session by `svc.stamp_pricing_approval_policy_provenance` (BEFORE INSERT OR UPDATE) and never changed.                                                                                                              |
| `svc.price_rules`                                                 | `price_changed_by`, `price_changed_at`: who last changed what the rule prices, stamped by `svc.stamp_price_rule_provenance` only when a pricing value changes.                                                                                                                     |
| `svc.price_list_versions`                                         | `published_by`, `published_at`: who published the version, stamped by `svc.stamp_price_list_version_publication` when it becomes published.                                                                                                                                        |
| `inv.item_sale_prices`                                            | `price_changed_by`, `price_changed_at`: who last changed the selling price, stamped by `inv.stamp_item_sale_price_provenance` only when a pricing value changes.                                                                                                                   |
| `quo.quotation_items`                                             | Four snapshot columns copied from the line's price rule (and its version) or item selling price by `quo.snapshot_quotation_item_price_provenance`; a writer's value is ignored.                                                                                                    |
| `quo.revision_self_change_basis(revision, person)`                | New SECURITY INVOKER read (EXECUTE to `app_runtime` only): whether the person recorded the policy version the quotation is held to (`own_policy`) or had set a line's price (`own_price`).                                                                                         |
| `quo.revision_discount_needs_approval`                            | Re-issued: also true for any discount when the revision's creator set either.                                                                                                                                                                                                      |
| `quo.discount_approvals`                                          | `requester_set_policy`, `requester_set_price` (computed by the guard, frozen), `approver_limit_id`, `withdrawn_by` (foreign key into `iam.user_accounts`, indexed), `withdrawn_at`; the state `withdrawn`; `ck_discount_approvals_withdrawn` and `ck_discount_approvals_limit_id`. |
| `quo.guard_discount_approval`                                     | Re-issued: computes the D8 reasons on insert; the requester-only withdrawal of a pending request; a withdrawn request terminal; an approver's limit never one the requester created, and the limit relied on recorded.                                                             |
| `tg_discount_approvals_immutable`, `upd_discount_approvals_scope` | Re-created under their own names: the two reasons frozen; a withdrawn row admitted only when the signed-in person withdrew it.                                                                                                                                                     |

### Why columns, not a history table

The rule needs one fact: who put the value in force. A column answers it in one read, beside the row.
The values before a change are already in the audit trail; a threshold version and an approval limit
are immutable rows of their own (an approval limit's `created_by` has been stamped from the
signed-in person since migration 20260925090000 and its amount never changes, so it needs no new
column). A write with nobody signed in — a migration, seed or provisioning role — is unattributed and
attributed to nobody: the application always writes as a signed-in person.

### Why "another person approves" rather than "the earlier version applies"

D8 allows reading the quotation under the version in force before the person's change. A price
changed in place keeps no earlier value, and the earlier policy version may itself be the same
person's, so that reconstruction is not always possible. Requiring an independent approver whenever
the evaluation relied on the requester's own change never grants more than a reconstruction would,
and it is one rule for the threshold and for prices.

## 3. What the application does with it

When a revision is written the service asks `quo.revision_self_change_basis` for the signed-in
person after the lines are in (so the snapshot is what it reads). A revision with any discount whose
requester set the threshold version or a price records a pending request under the quotation's pinned
policy, whatever the threshold says; the request names the reasons and the screen states them. The
approver's limit is read by `callerApprovalCeiling` excluding a limit the requester created, exactly
as the guard does. `quo.discount-approval-withdraw` (`POST
/discount-approvals/{approvalId}/withdrawal`, `quo.quotation.manage`, version-guarded and idempotent)
withdraws the requester's own pending request; every refusal by rule is recorded once (ADR-023 D12).

## 4. The limitations this change does not remove

- Provenance before this migration is the rows' last recorded writer (policies: `created_by`; price
  rules and selling prices: `COALESCE(updated_by, created_by)`), not a verified attribution, and who
  published an existing price-list version was never recorded (NULL). Quotation lines written before
  it carry no snapshot.
- A price the requester set, quoted with no discount at all, needed no second person under this
  migration. That was a self-exemption, closed by fix round 3 (section 10).
- Granting a colleague a role whose limit somebody else set, and deactivating or deleting a
  competing price so that another source prices the line, are not attributed by this change; they
  are open points. Moving a limit's dates is attributed since fix round 1 (section 8), and making
  or changing a price-list assignment (`svc.price_list_assignments`) since fix round 4 (section 11).
- A legacy draft whose creator set what it relies on, and which has no request, cannot be issued until
  it is revised (the issue guard refuses it); no request is backfilled.

## 5. Measured effect

Measured on a database created empty in a throwaway `postgres:17` container on a loopback port of
its own, replayed through all 172 migrations with `npm run db:apply-migrations` and seeded twice with
`npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported, against the 171 baseline, exactly
  the migration count, `functions` 658 and `triggers` 649; `tables` 278, `policies` 805,
  `security_definer` 0 and 134 permissions hold;
- `npm run validate:schema-inventory -- --hash-only` produced the schema hash recorded in
  `.github/ci-baselines/schema-baseline.json`;
- `npm run verify:classifications` reconciled the 17 new columns with the registry;
- the database and backend tests named above passed on a disposable database. This is a local
  measurement; the hosted migration-replay, database and backend jobs re-prove it.

The acceptance database was not read or written by this change.

## 6. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 172, `schemaHash`,
`structuralTotals`, the 172 sentences of `migrationCountNote` and `functionCountDiscrepancyNote`,
`structuralTotalsNote172`), the P1-15 migration census, the `tests/db/foundation.test.ts`
inventories, `docs/database/data-dictionary.md` and
`docs/database/svc-quo-inv-personal-data-classification.json`.

## 7. Upgrade of an existing database

The migration is forward-only. Its backfills write only the new provenance columns, with the
row-metadata trigger (and, for price rules, the published-version freeze) disabled for the length of
the statement, so no `record_version`, `updated_by` or `updated_at` moves. The application change
ships in the same pull request. Applying the migration to the acceptance database happens later,
through the established backup, rehearsal on a restored copy and forward apply — not in this change.

## 8. Fix round 1 — the 173rd migration

Review of the pull request found two ways round the rule this change states, and
`supabase/migrations/20261007100000_quo_discount_limit_window_and_amount_provenance.sql` (the 173rd)
closes both, forward-only and ROLLBACK-SAFE:

- **A limit's dates.** An approval limit's amount is immutable but its `effective_to` is not, so the
  requester could reopen or extend a limit somebody else had set for the approver, or end the
  approver's own smaller limit so that a larger role limit applied. `quo.guard_discount_approval` is
  re-issued: when the requester last changed (`iam.approval_limits.updated_by`, stamped from the
  session by `shared.touch_row_metadata`; `effective_to` is the only column the application may
  change) any discount limit of the approver in the company — on the approver or on a role whose
  grant reaches them, in force or not — none of the approver's limits counts for that request
  (`discount_no_approval_limit`). `callerApprovalCeiling` applies the same rule.
- **Who set a price's amount.** `price_changed_by` named whoever last touched any pricing column, so
  a colleague's later edit to priority, tax class, narrowing or status overwrote the requester's
  attribution. `svc.price_rules` and `inv.item_sale_prices` gain `amount_set_by` /
  `amount_set_at`, stamped only when the row is written and when the amount (and, for a selling
  price, its currency) changes; `quo.quotation_items` snapshots them as `price_amount_set_by` /
  `price_amount_set_at`, and `quo.revision_self_change_basis` counts a line as the requester's own
  price when they set its amount, last changed it, or published it. Existing rows take
  `amount_set_by` from `price_changed_by`, with the row-metadata, provenance and freeze triggers
  disabled for the statement; existing lines keep NULL in the two new columns.

No table, function, trigger, grant, policy, seed or permission code is added. Executable proof:
`tests/db/quo-discount-self-exemption.test.ts` and `tests/backend/od-discount-self-exemption.test.ts`
(both limit paths and the price-rule amount), `tests/backend/od-quotation-part-lines.test.ts` (the
selling-price amount), and the P1-15 census. Records moved: `migrationCount` 173, `schemaHash`,
`migrationCountNote` and `structuralTotalsNote173` in `.github/ci-baselines/schema-baseline.json`
(no structural total moves), the data dictionary and the classification registry (992 columns).

## 9. Fix round 2 — the 174th migration

Review of fix round 1 found that its limit-window rule read only the last writer and only for the
requester. `supabase/migrations/20261007110000_quo_discount_limit_window_history.sql` (the 174th)
closes both, forward-only and ROLLBACK-SAFE:

- **Who moved a window is kept.** `iam.approval_limits.window_changed_by` (`uuid[]`, not null, empty
  by default) holds everyone who ever changed the limit's end date. The new BEFORE INSERT OR UPDATE
  trigger `tg_approval_limits_window_history` (function `iam.record_approval_limit_window_change`,
  SECURITY INVOKER, empty search path, EXECUTE revoked from PUBLIC) empties it on insert whatever the
  writer supplied, carries it over on every update, and appends the signed-in person when
  `effective_to` changes. A save of the same date records nothing and removes nothing, so a later
  save by the approver or a colleague no longer hides the requester's change. The runtime role keeps
  UPDATE on `effective_to` only and cannot write the column.
- **The approver is caught too.** `quo.guard_discount_approval` is re-issued: an approval is refused
  (`discount_no_approval_limit`) when any discount limit of the approver in the company, on the
  approver or on a role whose grant reaches them, has the requester in its history (none of the
  approver's limits counts for that requester's request) or the approver (none counts for any
  request — moving one's own window is raising one's own ceiling, as creating the limit is).
  `callerApprovalCeiling` applies the same two rules.

Existing rows take `window_changed_by` from `updated_by` where they were updated, with the
row-metadata trigger disabled for the statement; earlier changes of the same row are not known.
One function and one trigger are added (`functions` 658 to 659, `triggers` 649 to 650); no table,
grant, policy, seed or permission code. Open point (ADR-023 D8): an approver who moved their own
window has no limit that counts in that company while that limit is theirs, and the limit-ending
route does not refuse the change up front. Executable proof: `tests/db/quo-discount-self-exemption.test.ts`
(approver reopening a limit on themselves, extending one on a role they hold, a same-date save, the
requester's change through later saves, and the history never taken from the writer),
`tests/backend/od-discount-self-exemption.test.ts`, the `foundation` routine and trigger inventories
and the P1-15 census. Records moved: `migrationCount` 174, `schemaHash`, `structuralTotals`,
`migrationCountNote` and `structuralTotalsNote174` in `.github/ci-baselines/schema-baseline.json`,
and the data dictionary.

## 10. Fix round 3 — the 175th migration

Review of fix round 2 showed that leaving a revision with no discount alone was a self-exemption: with
a threshold of 50 and a price of 100, a discount of 90 needed another person; the same writer then
lowered that price to 10 and quoted at 10 with no discount, and the revision issued with nobody's
approval. `supabase/migrations/20261007120000_quo_discount_self_set_price_without_discount.sql` (the
175th) closes it, forward-only and ROLLBACK-SAFE:

- **The issue guard.** `quo.revision_discount_needs_approval` is re-issued under its own name: a
  revision whose writer set a price one of its lines was priced at (`own_price`) needs another
  person's approval whatever its discount, zero included. A threshold the writer recorded
  (`own_policy`) still needs another person for any discount greater than zero.
- **The request.** `ck_discount_approvals_amounts` is replaced under its own name: a request may carry
  a discount total of zero only when `quo.guard_discount_approval` computed `requester_set_price` for
  it, so the approver sees why; every other request still carries a discount greater than zero. The
  application records such a request when the revision is written (`withoutSelfExemption`).

No row is written: every existing request carries a discount greater than zero. A legacy draft with
no discount whose writer set a price it uses, and which has no request, cannot be issued until it is
revised. No table, column, function, trigger, grant, policy, seed or permission code is added, so
no structural total moves. Executable proof: `tests/db/quo-discount-self-exemption.test.ts` (an item
selling price the requester lowered, a price-rule amount the requester set and published, each quoted
with no discount and refused until another person approves; another person's quotation at the same
price issues alone; a zero-discount request refused when the requester set no price),
`tests/backend/od-discount-self-exemption.test.ts`, and the P1-15 census. Suites whose quotations are
written by the person who also set their fixture prices now publish those prices as a separate
fixture principal (`SVC_PRICE_SETTER`), so they keep measuring what they set out to. Records moved:
`migrationCount` 175, `schemaHash`, `migrationCountNote` and `structuralTotalsNote175` in
`.github/ci-baselines/schema-baseline.json`, and the data dictionary.

## 11. Fix round 4 — the 176th migration

Review of fix round 3 showed that a requester could still exempt their own quotation by changing which
price list applies: with a threshold of 50, an administrator's list at 100 assigned company-wide and an
administrator's list at 10, a discount of 90 needed another person; the requester then assigned the
list at 10 to their own branch, `svc.resolve_price` answered 10, and a quotation at 10 with no
discount issued with nobody's approval. Nothing recorded who made an assignment, and the D8 basis
looked only at who set, changed or published the rule's amount.
`supabase/migrations/20261007130000_quo_price_list_assignment_provenance.sql` (the 176th) closes it,
forward-only and ROLLBACK-SAFE:

- **Who made an assignment, and who changed it.** `svc.price_list_assignments` gains `assigned_by`
  and `assigned_at`, stamped from the signed-in person on insert and never moved, and
  `assignment_changed_by` (`uuid[]`, not null, empty by default): everyone who ever changed what the
  assignment selects afterwards — its list, company, branch, customer class, priority, dates, status
  or deletion — appended and never removed. The new BEFORE INSERT OR UPDATE trigger
  `tg_price_list_assignments_provenance` (function `svc.stamp_price_list_assignment_provenance`,
  SECURITY INVOKER, empty search path, EXECUTE revoked from PUBLIC) keeps all three whatever the
  writer supplies; a save that changes none of the selecting columns records nothing.
- **The line snapshot.** `quo.quotation_items` gains `price_customer_class` (the class the
  application asked `svc.resolve_price` for; the repository writes it) and the snapshot of the
  assignment that selected the list of the line's price rule: `price_assignment_ref`,
  `price_assigned_by`, `price_assigned_at` and `price_assignment_changed_by`.
  `quo.snapshot_quotation_item_price_provenance` chooses it with `svc.resolve_price`'s own filter and
  order, on the line's company, branch and class at the transaction's date, among the assignments
  naming the rule's list, and ignores a writer's value.
- **The basis.** `quo.revision_self_change_basis` counts a line as the requester's own price also
  when the requester made, or ever changed, the snapshotted assignment, and when the requester ever
  changed any assignment of the tenant while the revision has a line priced from a price rule
  (ending or re-prioritising a competing assignment changes which list applies without being the one
  that won, and a moved assignment no longer says where it was). Through it the fix round 3 rule
  applies: another person approves whatever the discount, zero included, at the application when the
  revision is written and at the issue guard.

Existing assignments take `assigned_by`/`assigned_at` from `created_by`/`created_at` and
`assignment_changed_by` from `updated_by` where they were updated, with the row-metadata trigger
disabled for the statement; existing lines keep NULL snapshots. No route changes an assignment today
(the application only creates them), so the tenant-wide clause guards direct writers and is wider than
the change itself, which never grants more. One function and one trigger are added (`functions` 659
to 660, `triggers` 650 to 651); no table, grant, policy, seed or permission code. Executable proof:
`tests/db/quo-discount-self-exemption.test.ts` (the columns and trigger; stamps from the session
through a colleague's later change and a writer's claim; the requester pointing their branch at a
cheaper list more specifically, out-prioritising an assignment through a colleague's later edit, and
ending a competing assignment, each refused at issue until another person approves; a third person's
quotation under the requester's assignment issues alone), `tests/backend/od-discount-self-exemption.test.ts`
(the assignment made through `POST /price-list-assignments`), the `foundation` routine and trigger
inventories and the P1-15 census. Records moved: `migrationCount` 176, `schemaHash`,
`structuralTotals`, `migrationCountNote`, `functionCountDiscrepancyNote` and
`structuralTotalsNote176` in `.github/ci-baselines/schema-baseline.json`, the data dictionary and
the classification registry (1000 columns).

## 12. Fix round 5 — the 177th migration

Review of fix round 4 showed that a requester could still get their own discount approved by changing
the approver's role limit through a role grant: the approver held the recorded permission and no
limit that counted, the requester (who may issue grants) gave the approver a role whose limit an
administrator had set, and the refused approval went through on that role's limit.
`quo.guard_discount_approval` read every role an active grant brought to the approver, whoever issued
it, and a scoped grant reached the company through any scope row, whoever added it.
`supabase/migrations/20261007140000_quo_discount_role_grant_provenance.sql` (the 177th) closes it,
forward-only and ROLLBACK-SAFE:

- **Who issued a grant, and who changed it.** `iam.role_grants` gains `issued_by`, stamped from the
  signed-in person on insert and never moved (`granted_by` is the writer's claim: the application
  writes the signed-in person into it, a direct writer may write anybody), and `grant_changed_by`
  (`uuid[]`, not null, empty by default): everyone who ever changed the grant's status, `valid_from`,
  `valid_to` or `revoked_at`, appended and never removed. Kept by the new BEFORE INSERT OR UPDATE
  trigger `tg_role_grants_provenance` (function `iam.record_role_grant_provenance`).
- **Who added a scope.** `iam.grant_scopes` gains `added_by`, stamped from the signed-in person on
  insert and never moved (`created_by` is the writer's claim). Kept by `tg_grant_scopes_adder`
  (function `iam.stamp_grant_scope_adder`).
- **The guard.** A role's discount limit counts toward the approver's ceiling only through a grant
  that counts for the request: active, in force, neither granted nor issued by the requester, never
  changed by the requester, and — unless unrestricted — reaching the request's company through a
  scope the requester neither created nor added. A grant the approver issued, changed or scoped
  themselves does not count either, as a limit the approver created does not. A limit on the approver
  as a person is unaffected, and the window-history rules of fix round 2 still read every role an
  active grant brings. The application's `callerApprovalCeiling` applies the same rule, so the screen
  and the decision route name `discount_no_approval_limit` before the database refuses.
- **A withdrawn selling price.** Re-checking every other way the requester could lower the price they
  are held to found one more: deactivating or deleting the branch's selling price hands the line to a
  cheaper company or tenant-wide price somebody else set, and the line's snapshot named only that row.
  `inv.item_sale_prices` gains `availability_changed_by` (`uuid[]`, not null, empty by default):
  everyone who ever changed the row's status or deletion, appended and never removed, kept by
  `tg_item_sale_prices_availability_history` (function
  `inv.record_item_sale_price_availability_change`). `quo.revision_self_change_basis` counts a part
  line as the requester's own price when the requester ever changed the status or deletion of any
  selling price of the line's item; through it the fix round 3 rule applies.

The other paths were re-checked and are closed by the earlier rounds or by the schema: a limit the
requester created or whose window they moved (rounds 1 and 2; `created_by` is the signed-in person,
refused when it names anybody else); a threshold version (recorded only as the next version, stamped
`set_by`); a price rule (frozen once its version is published); a price-list version (its publisher is
stamped and a closed window cannot reopen); a price-list assignment (round 4); an item selling price's
amount (round 1). Revoking a grant, deleting a scope or ending a limit can only lower a ceiling, except
a person's own limit, which round 1 covers. A role's permission mappings (`iam.role_permissions`)
change who may approve, never any limit; they are recorded as an open point in ADR-023.

Existing grants take `issued_by` from `created_by` and `grant_changed_by` from `updated_by` where
they were updated; existing scopes take `added_by` from `created_by`; inactive or deleted selling
prices take `availability_changed_by` from `deleted_by` and `updated_by` — the closest evidence the
rows hold, not a verified attribution — with the row-metadata triggers disabled for the statements.
Three functions and three triggers are added (`functions` 660 to 663, `triggers` 651 to 654); no
table, grant, policy, seed or permission code. Executable proof:
`tests/db/quo-discount-self-exemption.test.ts` (the columns; stamps from the session through a
colleague's later change and a writer's claim; a grant the requester issued, in their own name or a
colleague's, a company scope the requester added to a colleague's grant, and a colleague's expired
grant the requester reopened, each refused for the requester's request and approved for another
person's; a grant or scope a colleague made approved for it; a grant the approver reopened refused for
anybody's request; a branch selling price the requester withdrew, quoted at the cheaper company price
with no discount, refused at issue while another person's quotation issues alone),
`tests/backend/od-discount-self-exemption.test.ts` (the screen and `POST
/discount-approvals/{id}/decision` refuse an approver given the role by the requester and accept the
same role granted by an administrator), the `foundation` routine and trigger inventories and the P1-15
census. The DB fixtures that gave fixture approvers their roles now issue those grants as an
administrator who requests nothing, so the earlier cases keep measuring what they set out to. Records
moved: `migrationCount` 177, `schemaHash`, `structuralTotals`, `migrationCountNote`,
`functionCountDiscrepancyNote` and `structuralTotalsNote177` in
`.github/ci-baselines/schema-baseline.json`, the data dictionary and the classification registry (1001
columns).
