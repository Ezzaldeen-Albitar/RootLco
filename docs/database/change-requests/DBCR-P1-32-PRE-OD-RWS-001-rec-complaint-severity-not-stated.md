# DBCR-P1-32-PRE-OD-RWS-001 — a concern without a severity is stored as "not stated"

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, README question 19 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements the Owner's answer of 2026-10-03 to question 19 of
[the Owner-directive README](../../product/owner-directive-2026-09-16/README.md); applying it to any
existing database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261004090000_rec_complaint_severity_not_stated.sql` (the
  168th)
- **Seed change:** none. **Permission change:** none. **Policy change:** none.
- **Executable proof:** `tests/db/rec-complaint-severity-not-stated.test.ts` (the constraint admits
  exactly `not_stated` and the four stated values and refuses NULL; an INSERT that omits the
  severity stores `not_stated`; the migration's statements write no row, and a rehearsal that puts
  the earlier constraint and default back inside a rolled-back transaction, writes rows under them
  and then runs the migration file shows those rows unchanged; row-level security enabled and
  forced with the same three policies, and a tenant-B session sees no tenant-A row),
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census) and
  `tests/backend/p1-18-reception-evidence.test.ts` (the operation end to end: an omitted severity is
  stored as `not_stated`, a stated one as given, an unknown one refused as a 422 on the field).
- **Rollback classification:** **ROLLBACK-SAFE WHILE UNUSED** — the inverse is in the migration
  footer; it can run only while no complaint holds `not_stated`, because the earlier constraint
  cannot hold such a row and no rule can say which severity the customer would have given.

---

## 1. Why this change request exists

A concern the customer reports at reception (`rec.complaints`) carries an optional severity — how
serious the customer said it was. When the customer gave none, the service stored `'medium'`, and
the column default did the same for any other writer. `'medium'` is a value the customer did not
give. The browser checkpoint raised it, and the Owner answered on 2026-10-03: a concern recorded with
no severity is stored as "not stated", and historical data is not rewritten.

## 2. The change

| Object                                    | Change                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `rec.complaints` `ck_complaints_severity` | Dropped and re-created: `severity IN ('not_stated', 'low', 'medium', 'high', 'critical')`.                 |
| `rec.complaints.severity`                 | Default `'medium'` -> `'not_stated'`; still `NOT NULL`; a column comment states the meaning and the limit. |
| Existing rows                             | Not rewritten. Every stored value is one the new constraint still admits, so adding it changes none.       |

### Why an explicit value rather than NULL

The column stays `NOT NULL` and "not stated" is a fifth member of the same vocabulary, so every
consumer reads an explicit value: the read-back, the web catalogue (`not_stated` has an English and an
Arabic label beside the four others) and any later filter, count or report match
`severity = 'not_stated'` exactly as they match `'high'`. A NULL would have been a second shape every
reader had to remember to test with `IS NULL`, and a reader that forgot would silently drop the rows.

## 3. The limitation this change does not remove

Rows stored before this migration hold `'medium'` both where the customer said "medium" and where no
severity was given and `'medium'` was substituted. Nothing on the row tells the two apart, so neither
is guessed: those rows keep `'medium'`. Only concerns recorded from this migration on can say "not
stated".

## 4. Measured effect

Measured on a database created empty in a throwaway `postgres:17` container on a loopback port of
its own, replayed through all 168 migrations with `npm run db:apply-migrations` and seeded twice
with `npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported `tables` 277, `functions` 646,
  `policies` 803, `triggers` 639, `security_definer` 0 and 134 permissions — no structural total
  moves;
- `npm run validate:schema-inventory -- --hash-only` produced the schema hash recorded in
  `.github/ci-baselines/schema-baseline.json`; the same procedure through the first 167 migrations
  reproduced the previous hash digit for digit;
- `npm run validate:aptrec-classification` reconciled the registry with the live schema (no column
  was added, so the registry entry for `rec.complaints.severity` is unchanged);
- the database and backend tests named above passed on that disposable database. This is a local
  measurement; the hosted migration-replay, database and backend jobs re-prove it.

The acceptance database was not read or written by this change.

## 5. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 168, `schemaHash`, the 168 sentence of
`migrationCountNote`, `structuralTotalsNote168`), the P1-15 migration census,
`docs/database/data-dictionary.md` (the `rec.complaints.severity` default), the concern contract in
`docs/product/workshop/inspection-and-diagnostics.md` §7.3, and the P1-27 migration-count records.

## 6. Upgrade of an existing database

The migration is forward-only and writes no row; complaints already stored keep their severity. The
application change ships in the same pull request: the service stores `not_stated` for an omitted
severity and the web form offers "Not stated" as its blank choice, so the two never disagree. Applying
the migration to the acceptance database happens later, through the established backup, rehearsal on
a restored copy and forward apply — not in this change.
