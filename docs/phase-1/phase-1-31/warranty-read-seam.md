# P1-31 — the warranty read seam (prerequisites P-6 and P-7)

What this slice published, what it minted, and what it deliberately left open.

|                          |                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Prerequisites closed** | **P-6** (publish `GET /api/v1/warranties`) and **P-7** (mint a warranty READ permission code), from [`a0-preflight.md`](./a0-preflight.md) |
| **Lane**                 | `p1-31-backend` — `remediation/p1-31-backend-warranty-read-seam`                                                                           |
| **Baseline**             | protected `develop` **80eb0050** (PR #348, the P-2 … P-5 delivery read seam); `main` **1262de74**, untouched                               |
| **Change control**       | **CC-07** … **CC-10** in [`change-control-2026-09-08.md`](./change-control-2026-09-08.md), sections 12–16                                  |
| **Canonical tasks**      | **none.** P-6 and P-7 are execution prerequisites, not among the 29                                                                        |

---

## 1. The defect this closes

A0 measured it and this slice reproduced it before changing anything: the `wty` domain shipped with
**two write codes and no read code**. `wty.warranty-detail` — a GET — therefore declared
`wty.warranty.issue`, the authority to CREATE a warranty, and its own docblock recorded why:

> the permission catalogue contains no `wty.warranty.read` … borrowing `wty.policy.manage` would be
> worse: it grants coverage administration to a caller who only needs to look at a record.

Both halves of that sentence were true. Neither made the gate right. A read gated on a write code
over-grants **by omission rather than by decision**, which is the failure the permission catalogue's
own commentary names in the P1-23 group, and it is why the preflight scheduled P-7 as a separate
prerequisite instead of leaving it to a screen.

The second half of the finding is the missing list. The chapter declares `GET /api/v1/warranties`
and only `/warranties/{warrantyId}` existed, so a warranty could be reached only by an identifier the
caller already held — a record id, an idempotency key or a delivery id. A warranty issued through the
product was unfindable once the generation response was gone.

---

## 2. The minted code

**`wty.warranty.read`** — domain `wty`, risk `low`,
_"Read warranty records, coverage terms and covered items"_ — seeded in
`supabase/seeds/04_iam_permission_catalog.sql`, in the existing Phase 1-11 `wty` group beside the two
codes it joins.

**The name is derived from the repository's own convention, not chosen.** Every read code in the
catalogue is `<domain>.<resource>.read`: `wo.work_order.read`, `rec.reception.read`,
`apt.appointment.read`, `quo.quotation.read`, `veh.vehicle.read`, `dia.diagnostic.read`,
`qms.quality_control.read`, `svc.service.read`, `inv.item.read`, `shared.document.read`. The `wty`
resource nouns already in the catalogue are `policy` and `warranty`. The route file and the module
surface had both already written the name, in as many words, as the thing that did not exist.

**Least privilege, stated as what it does not confer.** It authorizes reading warranty records, the
coverage terms they cite and the jobs and parts they cover. It implies no issue, no policy or
coverage administration, and no status change; `wty.warranty.issue` and `wty.policy.manage` keep
every write they gate, and `wty.warranty-generate` still declares the issue code alone.

**Risk `low`, and the reason is a measurement.** `wty` has 80 columns, all classified `internal` and
none `restricted`, and **not one is monetary** — no amount, no currency, no cap in any unit of
account. So the code exposes no money and no restricted identifier, which is what puts it beside
`quo.quotation.read` and `dia.diagnostic.read` rather than beside `svc.price.read`, whose `medium`
is justified in the seed by commercial sensitivity.

**It is a seed, not a migration.** The catalogue is the only shipping insert into `iam.permissions`
and zero migrations write that table. `migrationCount` stays 138 and `schemaHash` is unchanged;
`permissionCount` moves **118 → 119** in `.github/ci-baselines/schema-baseline.json`, with the
reasoning recorded in its note. The seed is idempotent and additive
(`ON CONFLICT (permission_code) DO NOTHING`), so it was applied to the running database without a
reset and destroyed nothing.

---

## 3. The bundle decision — INCLUDE (CC-07)

The rule this phase already applied is: **carry a code only when a shipped operation declares it.**
Applied rather than reflexed:

| test                                           | answer                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Declared by a shipped operation? (CC-01/CC-02) | **Yes, by two** — `wty.warranty-list` and the re-pointed `wty.warranty-detail`. CC-01 and CC-02 withhold codes with **zero** declarers                                                                                                                                            |
| Reach? (CC-04)                                 | **Narrow.** `rpt.export` is the platform-wide export switch of P1-15; this reads warranty records in ONE schema, with no money and no restricted field anywhere in it                                                                                                             |
| Does withholding cost anything today?          | **Yes, and this is decisive.** A freshly provisioned administrator can read a warranty **today**, through `wty.warranty.issue`, which the bundle already holds. Re-pointing the route while withholding the read code would REMOVE that — a regression dressed as least privilege |

Least privilege here means the administrator reads warranties under a READ code instead of an ISSUE
code — not that it stops reading them. None of CC-01, CC-02 or CC-04 withdraws an existing
capability; this exclusion would have. Bundle **73 → 74**.

`tests/backend/p1-31-provisioning-bundle.test.ts` keeps P-1's six codes and P-7's one as **separate
constants**, so neither widening can drift into the other and the register's two arguments stay
distinguishable in the assertion that checks them.

---

## 4. What was published

| operation             | path                           | permission          | scope    | audit  |
| --------------------- | ------------------------------ | ------------------- | -------- | ------ |
| `wty.warranty-list`   | `GET /warranties`              | `wty.warranty.read` | `branch` | `none` |
| `wty.warranty-detail` | `GET /warranties/{warrantyId}` | `wty.warranty.read` | `branch` | `none` |

`wty.warranty-detail` is unchanged except for its declared permission. `wty.warranty-list` is new.

**Scope is server-decided.** `companyId` and `branchId` are required query parameters and are the
`authorizationTarget`; `authorizeScope` decides, before any row is read.
`sel_warranty_records_scope` narrows on `iam.allowed_branch_ids()` — the permission-blind union of
every active grant — so an optional pair would let a caller holding the code in one branch read every
branch it holds any grant in (P1-18-A-01). Authorizing first also stops an empty page from reporting
whether a branch issues warranties at all. Row-level security stays default-deny underneath and
narrows again on the caller's own grants; that policy carries **no permission term of its own**, so
the route declaration is the only permission gate on these rows.

**One filter, because the record names one.** `vehicleId`. A0 records under P-6 that the
warranty-record table carries a NOT NULL vehicle reference, so the filter needs no new column, and
`ix_warranty_records_vehicle (tenant_id, vehicle_id)` already covers it. Nothing else is offered: a
query parameter nobody asked for is a contract to keep for ever. `.strict()` makes an unknown
parameter `ERR-VAL-001` (422) rather than a filter silently dropped, and a malformed cursor stays a
distinct `ERR-PAG-001` (400).

**Ordering.** `(start_date DESC, id DESC)` under `wty.warranty_records:start_date_desc` — the
ordering `listWarrantiesForDelivery` already uses on this table, so a screen that reads a delivery's
warranties and then the branch's sees one ordering rather than two. `start_date` is a `date`, so many
rows legitimately share a sort value and the `id` tie-break is what makes the order total; that is a
different problem from `P1-27-INT-006`, which is a timestamp cursor truncated below the stored
precision, and a `YYYY-MM-DD` rendering loses nothing, so no `cursorTimestamp()` is used here.

**No money, by measurement.** `wty` has no monetary column, so no response carries one.
`odometerAtIssue` and `odometerLimit` are distance readings published as exact decimal strings.

**Not a pure publication, and CC-09 says so.** There was no branch-wide read to publish, so the query
is new — but there is no second mapper and no second wire contract: rows come back through the
existing `toRecord`, policies through the existing `toPolicy`, and `WarrantyRecordListView` spells
every shared field exactly as `WarrantyView` spells it.

---

## 5. Files changed

| file                                                                                               | change                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/seeds/04_iam_permission_catalog.sql`                                                     | mints `wty.warranty.read` in the `wty` group, with the reasoning beside it                                                                                                                                                          |
| `.github/ci-baselines/schema-baseline.json`                                                        | `permissionCount` 118 → 119, with its note                                                                                                                                                                                          |
| `apps/api/src/app/api/v1/warranties/route.ts`                                                      | **new** — `wty.warranty-list`                                                                                                                                                                                                       |
| `apps/api/src/app/api/v1/warranties/[warrantyId]/route.ts`                                         | permission re-pointed to `wty.warranty.read`; the stale "no read code exists" docblock replaced by the record of the re-point                                                                                                       |
| `apps/api/src/modules/warranty/data/warranty-repository.ts`                                        | `WARRANTY_ORDER`, `listWarranties`, `findPolicies`                                                                                                                                                                                  |
| `apps/api/src/modules/warranty/application/warranty-service.ts`                                    | `WarrantyRecordListView`, `listWarranties`                                                                                                                                                                                          |
| `apps/api/src/modules/warranty/index.ts`                                                           | exports the new view and order; the composition-root docblock now records the split                                                                                                                                                 |
| `apps/api/src/modules/iam/domain/bootstrap-roles.ts`                                               | carries `wty.warranty.read` (CC-07), with the argument written out                                                                                                                                                                  |
| `apps/api/src/server/http/route-templates.ts`                                                      | registers `/warranties`                                                                                                                                                                                                             |
| `tests/backend/p1-31-warranty-read-seam.test.ts`                                                   | **new** — 23 cases, section 6                                                                                                                                                                                                       |
| `tests/backend/p1-22-helpers.ts`, `p1-22-warranty.test.ts`                                         | the unrestricted `sal`/`wty` principals hold the read code; the stale comment on the detail denial case replaced                                                                                                                    |
| `tests/backend/p1-31-provisioning-bundle.test.ts`                                                  | P-1's six and P-7's one as separate constants                                                                                                                                                                                       |
| `tests/backend/p1-29-w9-owner-bootstrap.test.ts`, `p1-30-inventory-master-data.test.ts`            | bundle length 73 → 74                                                                                                                                                                                                               |
| `tests/ci/repository-paths.test.ts`, `named-wire-shapes.test.ts`, `openapi-success-status.test.ts` | operation and route-module pins: 381 → 382, 299 → 300, `counts[200]` 272 → 273                                                                                                                                                      |
| `tests/openapi-contract.test.ts`                                                                   | imports the new route, without which it would be absent from the document rather than reported missing                                                                                                                              |
| `scripts/check-operation-test-coverage.mjs`                                                        | the `wty.warranty-list` manifest entry; the `wty.warranty-detail` note rewritten for the re-point                                                                                                                                   |
| generated                                                                                          | `docs/api/openapi.v1.json`, `docs/database/permission-catalog-reference.md`, the P1-14/P1-22 operation-test matrices, the P1-19 and P1-22 endpoint inventories, the P1-24 register, `apps/web/src/lib/api/idempotent-operations.ts` |
| `docs/phase-1/phase-1-27/deliverable-manifest.md`, `risk-register.md`                              | the derived `tests/backend` file-count markers, which one new backend suite moves                                                                                                                                                   |

---

## 6. Proof

`tests/backend/p1-31-warranty-read-seam.test.ts` — 23 cases, on rows arranged through the real
generation route. Section 15 of the change-control register lists them case by case. The two that
carry the claim:

- a principal holding **only** `wty.warranty.read` lists and reads back a warranty it could not have
  issued — the arrangement is `SAL_FULL`'s and the authenticator is reset in between;
- a principal holding **only** `wty.warranty.issue` — the caller the old gate served — is refused
  both reads with `ERR-IAM-001` naming `wty.warranty.read`, and can still generate a warranty.

Collapse the two codes back into one and both go red, in opposite directions. That is a property an
assertion on `operation.permissions` cannot have, and it is why the registration assertions in the
same file are the cheap half of the evidence rather than the whole of it.

---

## 7. What stays open

- **CC-08** — an organisation provisioned before this commit holds `wty.warranty.issue` and not
  `wty.warranty.read`, so its administrator loses the warranty detail read and cannot delegate the
  code. The bundle is written once and no route can widen an existing organisation's server-owned
  role, so this waits on A0 decision **D-2** (the backfill) or on a freshly provisioned organisation.
- **CC-10** — `wty.warranty_record_status_history` still has no reader anywhere in `apps/api/src`.
  P-6 names the list and only the list, so **VHM-06 / WF-26 / PPD-13** is closed in its list limb and
  open in its ledger limb.
- **P-10 / PPD-04** — no writer exists for `wty.warranty_policies` or `wty.warranty_coverage`, so on
  a freshly provisioned tenant every generation still returns `ERR-RES-001`. The suite seeds policies
  by SQL and says so. `wty.policy.manage` stays excluded from the bundle (CC-01).
- **P-8 … P-16 otherwise untouched** — the report engine, the export route, the checklist-template
  writer, the navigation gate (`sal.delivery.read`, RES-05) and the documentation corrections all
  remain as A0 measured them.
