# Corrections to the preparation package

Nine facts found by reading the schema rather than the preparation documents. Each was verified
against the tree at `c081a019`. Two of them change a slice's design; the rest close a question a
prerequisite register left open, or narrow a claim that was true but understated.

**None of these makes a preparation document wrong in its conclusion.** They are recorded here
rather than by editing those documents, because the frozen preparation is cited by SHA elsewhere
and silent overwriting would break that citation.

---

## C-01 — a technician's branch and user are IMMUTABLE, so "transfer" is not an update

**Changes a design.** `BR-03`.

```
CREATE TRIGGER tg_technician_profiles_immutable BEFORE UPDATE ON tech.technician_profiles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'user_id', 'created_at', 'created_by');
```

`supabase/migrations/20260722094000_tech_profiles_skills_certs.sql:74-76`.

Consequences the preparation did not state:

- **`branch_id` cannot be updated.** Moving a technician to another branch is not a `PATCH`. It is
  a deactivate-and-recreate, and the order is forced: `uq_technician_profiles_active_user
(tenant_id, user_id) WHERE deleted_at IS NULL` (`:67-68`) permits exactly one live profile per
  user per tenant, so the old profile must be soft-deleted **before** the new one is inserted or
  the insert raises `23505`.
- **`user_id` cannot be updated.** A profile can never be re-pointed at a different person. This
  is a stronger guarantee than `BR-01` needs and it should be cited there: the identity edge a
  caller resolves through is immutable once written.
- The **writable** surface of a technician profile is therefore exactly three columns —
  `trade`, `is_active`, `employment_ref`. `BE-9`'s "create, update, deactivate a technician
  profile" is accurate but reads much wider than what the schema permits.

## C-02 — `closure_eligible` is a fifth job-state flag, published to a UI and enforced by nothing

**Changes a design.** `BR-06`.

`wo.job_states` carries **five** behavioural flags, not the four
`contract-archaeology.md` §6.2 lists. The seed writes all five
(`supabase/seeds/06_wo_job_state_graph.sql:65`):

```
(scope, code, name, is_terminal, reason_required, assignment_required, labor_allowed,
 closure_eligible, created_by)
```

`closure_eligible` is `true` for `completed` and `cancelled`, `false` for the other four. The
repository selects and projects it — `work-order-catalog-repository.ts:42` (`readonly
closureEligible: boolean`), `:108`, `:113`, `:130`.

**But closure blocker B1 does not read it.** `wo.guard_work_order_closure`
(`supabase/migrations/20260722105000_qms_rework_closure_gate.sql:378-388`) tests `js.is_terminal`:

> `-- B1: no non-terminal job may remain open.` … `AND js.deleted_at IS NULL AND js.is_terminal)`

The two agree on the platform seed and are **not constrained to agree on a tenant row.**
`ck_job_states_tenant_not_terminal` forbids a tenant creating a _terminal_ job state; it says
nothing about `closure_eligible`. So a tenant may create a state with
`is_terminal = false, closure_eligible = true`, and `BR-06`'s published catalogue would then tell
the UI a job is closure-eligible while B1 refuses the closure.

**Binding on `BR-06`:** publish the flag, because the row already carries it and omitting a field
from a catalogue projection is its own defect — but the contract must state that closure
eligibility for a _work order_ comes from `GET /work-orders/{id}/closure-eligibility` and from
nothing else. No UI may derive closure readiness from `closureEligible`.

## C-03 — the customer-of-the-visit is guaranteed by dating, not by good behaviour

`BE-3`'s acceptance criterion is _"a subsequent change of vehicle owner does not alter a closed
work order's recorded customer."_ True — and the mechanism is worth naming, because a projection
written without it would not deliver the outcome.

`rec.reception_party_roles` is a **dated** relation: `valid_from`, `valid_to`, and

```
CREATE TRIGGER tg_reception_party_roles_immutable BEFORE UPDATE ON rec.reception_party_roles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'reception_visit_id', 'partner_id',
    'relationship_role', 'valid_from', 'created_at', 'created_by');
```

`supabase/migrations/20260721098000_rec_party_roles_visit_reasons.sql:92-96`. The table's own
comment says it: _"dated (valid_to) not mutated, so history is preserved."_

So a correction to a party role writes a **new row** and dates the old one out. A projection that
reads `WHERE valid_to IS NULL` returns _today's_ answer; a projection that reads as-at the visit
returns _the visit's_ answer. Only the second satisfies the acceptance criterion.

**Binding on `BR-05`:** the customer projection is dated to the reception visit, not to `now()`.

## C-04 — there are TWO party-role vocabularies, and they are not the same seven

| table                       | vocabulary                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `rec.reception_party_roles` | `service_requester`, `vehicle_owner`, `vehicle_user`, `payer`, `billing_party`, `approving_party`, `authorized_receiver` |
| `veh.vehicle_relationships` | `owner`, `user`, `driver`, `fleet_operator`, `payer`, `authorized_person`, `service_requester`                           |

`20260721098000_rec_party_roles_visit_reasons.sql:71-73` and
`20260720100000_veh_relationships_and_evidence.sql:113-115`. Seven each; **only `payer` and
`service_requester` are common**, and `vehicle_owner` (reception) and `owner` (vehicle) are
different spellings of a similar idea on different tables with different lifetimes.

`BE-3` says the projection "must name the role it is reporting" without recording that there are
two vocabularies to name it from. A projection that reported `vehicle_owner` from one table and
`owner` from the other, or that folded them, would be publishing incomparable values under one
field name.

**Binding on `BR-05`:** the projection reports from `rec.reception_party_roles` only, and names the
vocabulary as well as the value.

## C-05 — template activation is modelled at two levels, meaning two different things

`dia.inspection_templates` carries its own lifecycle:

```
CONSTRAINT ck_inspection_templates_status CHECK (status IN ('active', 'inactive'))
```

`20260722101000_dia_templates_versions_items.sql:49` — separate from, and orthogonal to,
`ck_template_versions_status CHECK (status IN ('draft','published','retired'))` at `:93`.

So "deactivate" is ambiguous until qualified: retiring a _version_ stops new reports citing that
version; deactivating a _template_ stops the template being offered at all while leaving its
published versions valid for reports that already cite them. The directive asks `BR-04` to cover
"activation/deactivation"; the answer is that both already exist and mean different things.

## C-06 — the item freeze covers INSERT, so a published version's item set is closed

```
CREATE TRIGGER tg_template_items_frozen BEFORE INSERT OR UPDATE ON dia.template_items
```

`20260722101000_dia_templates_versions_items.sql:212`. The preparation describes
`dia.guard_template_item_frozen` as _"rejecting any change to an item … once its parent version
leaves `draft`"_ — accurate for UPDATE, and it understates the guard. Because the trigger is also
`BEFORE INSERT`, **an item cannot be appended to a published version either.** The invariant is on
the version's item _set_, not on the mutability of existing rows.

**Consequence for `BR-04`:** "add one more check to the published inspection" is not a supported
operation and must not appear in the API surface. The supported act is a new version.

## C-07 — department archival is already modelled

`org.departments` carries `status IN ('active','inactive')`, `archived_at`, `archived_by`, and

```
CREATE UNIQUE INDEX uq_departments_branch_code_live
  ON org.departments (tenant_id, company_id, branch_id, department_code)
```

with the table comment stating _"Codes unique among live (non-deleted, non-archived) rows per
branch — archive frees the code."_ `20260717104000_org_operational_structure.sql:109-141`.

The directive asks `BR-02` to determine archival/deactivation semantics. They are determined:
two axes (`status` for operational availability, `archived_at` for retirement), and archiving
releases the code for reuse. `BR-02` implements them; it does not design them.

## C-08 — `shared.notes` cannot express this domain's scope guarantee

`shared.notes.company_id` and `shared.notes.branch_id` are **NULLABLE**
(`20260718110000_shared_tags_notes_comments.sql:127-128`), and the row is addressed
polymorphically by `(entity_type, entity_id)`.

Every operational table in `wo`/`dia`/`tech`/`qms` carries
`UNIQUE (tenant_id, company_id, branch_id, id)` with children joining on the full composite and
`ON DELETE RESTRICT`, which is what makes cross-branch parentage _structurally impossible_ in this
domain (`contract-archaeology.md` §10.1).

`BE-8` offers the polymorphic adapter as the "cheaper and weaker" option. This is the specific
sense in which it is weaker, and it is decisive: a job note stored in `shared.notes` can be written
with a NULL branch, so branch containment would have to be enforced by the application on every
read and write, in a domain whose entire integrity story is that it does not have to be.

**Binding on `BR-07`:** the typed form is selected. The polymorphic option is rejected on
containment grounds, not on taste.

## C-09 — the two evidence tables are field-identical, so `BR-07` has a template, not a decision

|            | `dia.diagnostic_evidence`                                                    | `wo.customer_approval_evidence`                                      |
| ---------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| scope key  | `tenant_id, company_id, branch_id` NOT NULL                                  | same                                                                 |
| parent     | `diagnostic_report_id` → `dia.diagnostic_reports` composite, RESTRICT        | `customer_approval_id` → `wo.customer_approvals` composite, RESTRICT |
| binding    | `document_version_id` → `shared.document_versions (tenant_id, id)`, RESTRICT | same                                                                 |
| payload    | `evidence_type text NOT NULL`, `note text NULL`                              | same                                                                 |
| metadata   | `created_at`, `created_by` only                                              | same                                                                 |
| mutability | append-only, SELECT + INSERT                                                 | same                                                                 |
| indexes    | one on parent, one on version                                                | same                                                                 |

`20260722103000_dia_findings_measurements_evidence.sql:266-290` and
`20260722100000_wo_services_parts_approvals.sql:417-441`.

The shape is identical apart from the parent foreign key, and both comments carry the same
sentence: _"Binds an EXACT immutable shared.document_versions row; no substitution. SELECT+INSERT
only."_ A third evidence table for jobs is therefore a **transcription of a twice-repeated
pattern**, which is why `BR-07` proposes new schema with more confidence than a new table normally
warrants.
