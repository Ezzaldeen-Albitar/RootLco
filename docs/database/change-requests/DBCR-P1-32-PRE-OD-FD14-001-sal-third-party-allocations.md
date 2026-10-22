# DBCR-P1-32-PRE-OD-FD14-001 — third-party payer allocations, refused by default

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, finance decision D14 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements Owner decision D14 of 2026-09-30 as recorded in
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md); applying it to any existing
database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261002100000_sal_third_party_allocations.sql` (the 167th)
- **Seed change:** `supabase/seeds/04_iam_permission_catalog.sql` gains ONE row,
  `sal.payment.third_party` (risk high). **Permission change:** that minted code; the standard tenant
  administrator bundle carries it (application code,
  `apps/api/src/modules/iam/domain/bootstrap-roles.ts`). **Policy change:** none.
- **Executable proof:** `tests/db/sal-third-party-allocations.test.ts` (the same payer unchanged and
  no third-party detail on it, nor a forged authoriser; another customer's invoice refused through
  the primitive and through a raw INSERT on the runtime login; a third-party allocation booked for a
  holder of the code, the authoriser stamped from the session, payer and customer unchanged, the
  remainder left on the receipt; the code alone required — `sal.payment.allocate` alone and the code
  held in another branch only refused; each field rule by its own token; a raw INSERT in another
  currency refused; another tenant refused; a repeated key answered and a key reused with other
  detail refused; INSERT-only guard, the eight-argument grant, the catalogue row),
  `tests/db/foundation.test.ts` (routine and trigger inventory),
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census), and
  `tests/backend/od-finance-third-party.test.ts` (the operation end to end).
- **Rollback classification:** **ROLLBACK-SAFE WITH DATA NOTE** — the inverse is in the migration
  footer; it can run only while no allocation carries a third-party relationship, because dropping
  the columns would lose that record.

---

## 1. Why this change request exists

`sal.allocate_receipt` never compared the receipt's payer with the invoice's customer, and nothing
else did (finance critique M-03): cash taken from one customer could settle another customer's
invoice, silently, and the allocation table takes no correction short of reversing the whole
receipt. The Owner's decision D14: allocation to an unrelated customer's invoice is refused by
default; an insurer's or an employer's payment is accepted only through explicit, authorised,
audited third-party handling; the payer stays distinct from the invoice customer; the relationship,
authorisation and reason are recorded; nothing changes hands; scope and currency are enforced.

## 2. The change

| Object                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.payment_allocations`      | NEW nullable `third_party_relationship`, `third_party_authorisation_reference`, `third_party_reason`, `third_party_authorised_by`; NEW CHECKs `ck_payment_allocations_third_party_relationship` (insurer, employer, other) and `ck_payment_allocations_third_party_shape` (all four or none; the reference and the reason not blank and bounded).                                                                                                                                                                                                                            |
| `sal.guard_allocation_payer()` | NEW BEFORE INSERT guard (`tg_payment_allocations_payer`): the allocation's currency is the receipt's and the invoice's; a same-payer allocation carries no third-party detail; another customer's invoice is refused unless the row is a third-party allocation by a holder of `sal.payment.third_party` in the receipt's company and branch with a valid relationship, reference and reason; the authorising user stamped from the session. A row whose receipt or invoice is not visible is left to the foreign keys and the INSERT policy, so their refusal is unchanged. |
| `sal.allocate_receipt(...)`    | Dropped and re-created with three trailing arguments (relationship, authorisation reference, reason); a repeated key is refused when the stored allocation differs in any of them. `EXECUTE` to `app_runtime` only.                                                                                                                                                                                                                                                                                                                                                          |
| Existing rows                  | Not re-checked and not rewritten; a read-only NOTICE reports how many allocations cross payers, as the migrating role sees them.                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 3. Measured effect

Measured on a database created empty (`CREATE DATABASE ... TEMPLATE template0`) in a throwaway
`postgres:17-alpine` container on a loopback port of its own, replayed through all 167 migrations
and seeded twice with `npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported `functions` 646 (was 645),
  `triggers` 639 (was 638) and 134 permissions (was 133); `tables` 277, `policies` 803 and
  `security_definer` 0 did not move;
- `npm run validate:schema-inventory` reported `functions` 344 (was 343) over the seventeen RootLco
  schemas, the companion figure `functionCountDiscrepancyNote` records;
- `npm run validate:schema-inventory -- --hash-only` produced the schema hash recorded in
  `.github/ci-baselines/schema-baseline.json`;
- the database tests named above passed on a disposable database. This is a local measurement; the
  hosted migration-replay and database jobs re-prove it.

The acceptance database was not read or written by this change.

## 4. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 167, `schemaHash`, `permissionCount`
134, `structuralTotals.functions` 646 and `triggers` 639, `structuralTotalsNote167`, and the
645/343 -> 646/344 step in `functionCountDiscrepancyNote`), the routine and trigger inventory in
`tests/db/foundation.test.ts`, the P1-15 migration census, the classification registry
`docs/database/sal-wty-rpt-personal-data-classification.json` (four new columns),
`docs/database/data-dictionary.md`, `docs/database/role-and-grant-standard.md` §5.12, the
permission catalogue reference, and the P1-27 migration-count records.
`tests/db/shared-hardening.test.ts` does not move: its approved surface covers the `iam` and
`shared` schemas, and the new function is in `sal`.

## 5. Upgrade of an existing database

The migration is forward-only on an existing database and writes no row; allocations already stored
keep their rows. Because the code is a new catalogue row, the permission seed
(`04_iam_permission_catalog.sql`, idempotent) is re-run BEFORE granting it; granting it to an
existing organisation's standard administrator is the operator backfill
(`scripts/platform/backfill-tenant-administrator-bundle.mjs`), dry run first, for the named QA
organisations only (ADR-023 D14; change-control CC-OD-54). From the migration on, an allocation to
another customer's invoice that worked before is refused in every organisation unless it is an
authorised third-party allocation.
