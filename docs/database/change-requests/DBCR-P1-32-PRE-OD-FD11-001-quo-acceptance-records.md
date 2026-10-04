# DBCR-P1-32-PRE-OD-FD11-001 — an auditable acceptance record for each accepted quotation revision

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner decision D11 of
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md) · **Owner:** Eng. Ezzaldeen
Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements the Owner's decision D11 of 2026-09-30; applying it to any existing database is
a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261005090000_quo_acceptance_records.sql` (the 169th)
- **Seed change:** none. **Permission change:** none — the decision routes keep
  `quo.decision.record` and the read keeps `quo.quotation.read`. **Audit action:** none new — the
  existing `quo.quotation.accepted` record names the acceptance record it wrote.
- **Executable proof:** `tests/db/quo-acceptance-records.test.ts` (RLS enabled and forced with
  exactly a SELECT and an INSERT policy; SELECT and INSERT for `app_runtime`, SELECT for
  `app_readonly`, no UPDATE or DELETE for any role; the recorder and the time stamped from the session
  whatever the statement says; a record only for the accepted current revision; one per revision; no
  customer but the payer; the contact and reference shapes; every UPDATE refused, even by the table
  owner; a tenant-B session neither sees nor writes a tenant-A record),
  `tests/backend/od-quotation-acceptance-record.test.ts` (the two decision routes and the read end to
  end), `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census),
  `tests/db/foundation.test.ts` and `tests/db/p1-10-isolation.test.ts` (inventories).
- **Rollback classification:** **ROLLBACK-SAFE WHILE EMPTY** — the inverse is in the migration
  footer; it refuses to run once a record exists, because dropping the table would destroy the only
  statement of who accepted, through whom, how and on what reference.

---

## 1. Why this change request exists

A customer's acceptance of a quotation was stored only as per-line decisions
(`quo.approval_decisions`: the line, the decision, the channel, the staff user and the time) with
optional per-line evidence. Nothing stated, for the revision as a whole, who accepted on the
customer's side, how they were reached, or on what reference. D11 asks for an auditable record of the
exact revision, the customer or contact, the channel, the time, the employee who recorded it and the
evidence or reference. Recording a telephone call is not required, no evidence is invented, and the
record is not an electronic signature.

## 2. The change

| Object                          | Change                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quo.acceptance_records`        | New append-only table, one row per accepted revision (`uq_acceptance_records_revision`), composite scoped foreign keys to the quotation and the revision, and a foreign key to the evidence document version.                                                  |
| `quo.guard_acceptance_record()` | New SECURITY INVOKER trigger function: stamps `recorded_by`, `created_by`, `accepted_at`, `created_at` from the session; admits a row only for the accepted current revision with every line approved, naming no customer but the payer; refuses every UPDATE. |
| `tg_acceptance_records_guard`   | BEFORE INSERT OR UPDATE on the table.                                                                                                                                                                                                                          |
| Policies and grants             | `sel_acceptance_records_scope` and `ins_acceptance_records_scope` (which also pins `recorded_by` to the signed-in user); SELECT and INSERT to `app_runtime`, SELECT to `app_readonly`.                                                                         |

### Why a table, not columns on the revision

`quo.quotation_revisions` is updated after issue (a rejection or an expiry moves its status), so
acceptance columns there would need their own freeze, and a revision row would mix the document the
customer saw with the fact of their answer. A separate append-only table has no UPDATE or DELETE
grant at all, is written once in the decision's transaction, and is read beside the decisions.

### Why a typed contact

The CRM model records a customer's contact CHANNELS (`crm.contact_points`: telephone, mobile,
email), not the people who speak for a customer. There is no contact person to choose, so the record
keeps the name the employee was told and, optionally, the telephone number that person was reached
on — normalised the way every other number in the platform is. Either may be left empty: a customer
who accepted in person is their own contact.

## 3. What the application does with it

The decision that completes an acceptance — the whole-revision decision, or the line decision that
approves the last open line — writes the record in the same transaction, with the deciding party as
already validated against the payer, the contact, the channel and the evidence kind, reference note
and document version given with that decision. A replay finds the quotation already accepted and
writes nothing; the unique constraint refuses a second row regardless. A rejection writes none, and a
contact sent with a rejection is refused rather than lost. The decisions read publishes the record
with the recorder named through the identity directory (which names nobody to a caller without
`iam.user.read`).

## 4. The limitation this change does not remove

Revisions accepted before this migration have no record. Who spoke for the customer and on what
reference was never captured for them, and inventing it would be the fabrication D11 forbids. Readers
say "not recorded".

## 5. Measured effect

Measured on a database created empty in a throwaway `postgres:17` container on a loopback port of
its own, replayed through all 169 migrations with `npm run db:apply-migrations` and seeded twice with
`npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported, against the 168 baseline, exactly
  the migration count, `tables` 278, `functions` 647, `policies` 805 and `triggers` 640;
  `security_definer` 0 and 134 permissions hold;
- `npm run validate:schema-inventory -- --hash-only` produced the schema hash recorded in
  `.github/ci-baselines/schema-baseline.json`;
- `npm run validate:svc-quo-inv-classification` reconciled the 17 new columns with the registry;
- the database and backend tests named above passed on that disposable database. This is a local
  measurement; the hosted migration-replay, database and backend jobs re-prove it.

The acceptance database was not read or written by this change.

## 6. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 169, `schemaHash`, `structuralTotals`,
the 169 sentence of `migrationCountNote`, `structuralTotalsNote169`), the P1-15 migration census,
the `tests/db/foundation.test.ts` inventories, the P1-10 isolation table count, the
`deleteTenantCascade` order, `docs/database/data-dictionary.md`,
`docs/database/svc-quo-inv-personal-data-classification.json`, and the P1-27 migration-count records.

## 7. Upgrade of an existing database

The migration is forward-only and writes no row. The application change ships in the same pull
request. Applying the migration to the acceptance database happens later, through the established
backup, rehearsal on a restored copy and forward apply — not in this change.
