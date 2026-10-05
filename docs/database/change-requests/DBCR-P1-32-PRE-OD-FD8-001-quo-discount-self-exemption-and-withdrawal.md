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
- A price the requester set, quoted with no discount at all, needs no second person: nothing is given
  away, so there is no discount approval to be exempted from. Whether such a price should need one is
  an open point for the Owner.
- Granting a colleague a role whose limit somebody else set, assigning a price list
  (`svc.price_list_assignments`), and deactivating or deleting a competing price so that another
  source prices the line are not attributed by this change; they are open points. Moving a limit's
  dates is attributed since fix round 1 (section 8).
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
