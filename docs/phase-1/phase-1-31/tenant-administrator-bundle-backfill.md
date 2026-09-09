# P1-31 — the tenant administrator bundle backfill (Owner decision D-2)

What this slice built, why it took the shape it did, which organisations it changed, and what it
deliberately did not touch.

|                     |                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Authority**       | A0 decision **D-2** of [`a0-preflight.md`](./a0-preflight.md), answered by the Owner on 2026-09-08: **backfill existing organisations with the newly added codes** |
| **Lane**            | `p1-31-backend` — `remediation/p1-31-backend-tenant-administrator-bundle-backfill`                                                                                 |
| **Baseline**        | protected `develop` **d29e63d2** (the merge of #349, the P-6 / P-7 warranty read seam); `main` **1262de74**, untouched                                             |
| **Change control**  | **CC-11** in [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) §18; **CC-03** and **CC-08** are closed there by this slice                          |
| **Canonical tasks** | **none.** D-2 is an Owner decision, not one of the 29                                                                                                              |
| **Migrations**      | **none**, and §3 states the measurement that shows one is not required                                                                                             |

---

## 1. The closure this repairs

`TENANT_ADMINISTRATOR_ROLE.permissionCodes` is written **once**, by
`platform.organization-provision`, at the instant an organisation is created. Nothing re-applies it.
Every organisation provisioned before a widening keeps the set it was handed.

That is not merely a stale default, because of one rule in the database:
`ins_role_permissions_delegable` (`20260726090000`) admits a mapping only when the acting
administrator **already holds** the code being mapped. So an administrator on an old bundle cannot
grant itself a newer code, cannot delegate one to anyone else, and no one else in the tenant can
either. The organisation is closed to those codes permanently, from the inside.

Measured on the shared acceptance stack immediately before this slice, on 2026-09-08:

| bundle held | organisations                                                    |
| ----------- | ---------------------------------------------------------------- |
| 44          | `acceptance_workshop`                                            |
| 46          | `rootlco_workshop`                                               |
| 48          | `rootlco_final`, `rootlco_w7`, `rootlco_w7b`                     |
| 65          | `p30_acceptance_ac0zif`                                          |
| 67          | eighteen `p30_journey_*` organisations                           |
| —           | `platform_operators` holds no `tenant_administrator` role at all |

against a current bundle of **74**. This is the third instance of one residual —
P1-30 **CC-08** recorded it for the organisations that predate #321, P1-31 **CC-03** for those that
predate #322 — and #349 sharpened it into a regression: re-pointing `wty.warranty-detail` off
`wty.warranty.issue` onto the newly minted `wty.warranty.read` **withdrew a read** those
administrators could perform the day before. That is P1-31 **CC-08**, and both rows named D-2 as the
only thing that could close them.

---

## 2. What was built

One file in the product:
[`scripts/platform/backfill-tenant-administrator-bundle.mjs`](../../../scripts/platform/backfill-tenant-administrator-bundle.mjs).

```
node scripts/platform/backfill-tenant-administrator-bundle.mjs \
  --confirm <operator-email> (--all | --tenant <uuid|code> ...) [--dry-run]
```

It reads the bundle from `bootstrap-roles.ts`, resolves the named organisations, and for each one
inserts the codes its `tenant_administrator` role does not map. Nothing else.

| property           | how it is held                                                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **authority**      | refused unless the named operator account holds an unrevoked `platform.organization.provision` in `iam.platform_grants`. An **existing** platform permission; none is minted                                                                                             |
| **additive only**  | no `DELETE`, no `UPDATE`, no `TRUNCATE`, no `REVOKE` anywhere in the file. The one mapping write is `INSERT … effect = 'allow'` for a code the role does not map at all                                                                                                  |
| **idempotent**     | the work is the set difference `bundle − mapped`; an empty difference writes no row and appends no audit record                                                                                                                                                          |
| **narrow**         | one role per organisation, the one whose `role_code` is `tenant_administrator`. An organisation without one is reported and skipped — never given one, because that would be provisioning                                                                                |
| **customisations** | a bundle code the tenant has mapped `deny` on its own administrator role is left alone and reported as `blockedByDeny`. Codes mapped beyond the bundle are simply not in the difference, so they survive by construction                                                 |
| **explicit scope** | `--tenant` names organisations; `--all` sweeps and reports every organisation it considered with its outcome. There is no silent sweep                                                                                                                                   |
| **recorded**       | one `iam.audit_append` in each changed tenant — `platform.tenant_administrator_bundle.backfilled`, actor the operator, entity the role, details the codes added and the counts — plus an evidence JSON listing every organisation. Identifiers and permission codes only |
| **fail closed**    | one transaction; any refusal rolls all of it back and exits non-zero. `--dry-run` rolls back deliberately and reports what it would have done                                                                                                                            |

### The bundle has one definition, and it is parsed

A second hand-written copy of 74 codes would drift from the constant the provisioning path writes,
and a backfill widening to a stale list is the very defect it exists to repair. So the script reads
`bootstrap-roles.ts` through the repository's own TypeScript parser
(`scripts/lib/typescript-source.mjs`) rather than by pattern — the standing rule after this project
recorded a scanner reading prose as code — and fails closed on anything that is not a plain string
literal. **BF-7** asserts the parsed list equals the imported constant, so the two cannot drift.

---

## 3. Why a script, and why no migration

This was decided by measurement, not preference.

The only application-layer policy admitting the platform role to `iam.role_permissions` is
`ins_role_permissions_platform_bootstrap` (`20260831093000`):

```sql
WITH CHECK (
  tenant_id = iam.current_tenant_id()
  AND EXISTS (SELECT 1 FROM org.tenants t
               WHERE t.id = iam.current_tenant_id() AND t.status = 'provisioning')
  AND iam.has_platform_authority('platform.organization.provision')
)
```

Every organisation this backfill is for is **`active`**, never `provisioning`, and
`iam.role_permissions` carries `FORCE ROW LEVEL SECURITY`, so even the table owner is bound by that
policy. A route gated on a platform permission would therefore be **refused by the database**.

Publishing one anyway would require a migration widening that `WITH CHECK` to non-provisioning
tenants. That is a permanent, reachable escalation surface — every future holder of
`platform.organization.provision` could rewrite any tenant's administrator role through an HTTP
route — bought to perform a correction that runs once per widening. The repository already has the
right shape for that trade in `scripts/platform/genesis-platform-operator.mjs`, whose own docblock
states the principle: _"It is deployment infrastructure, not an application route, and it must never
become one."_ This is its sibling. It leaves behind no operation, no permission, no policy and no
route.

The claim is falsifiable rather than asserted: **BF-9** reads the policy out of `pg_policies`, the
tenant status out of `org.tenants`, and `relforcerowsecurity` out of `pg_class`.

**Accepted consequence, stated rather than hidden.** The backfill is not self-service: it needs an
operator with a privileged connection, exactly as the platform genesis does. That is the constraint
this repository already lives with for `iam.platform_grants`, and it is why **CC-11** is a row
rather than a footnote.

---

## 4. Which organisations it changed

Run on the shared acceptance environment on 2026-09-08 by `platform.operator@rootlco.local`, `--all`,
dry run first and then applied. **25 considered, 24 widened, 1 skipped.**

| organisation                       | before | after | codes added                                   |
| ---------------------------------- | ------ | ----- | --------------------------------------------- |
| `acceptance_workshop`              | 44     | 74    | 30                                            |
| `rootlco_workshop`                 | 46     | 74    | 28                                            |
| `rootlco_final`                    | 48     | 74    | 26                                            |
| `rootlco_w7`                       | 48     | 74    | 26                                            |
| `rootlco_w7b`                      | 48     | 74    | 26                                            |
| `p30_acceptance_ac0zif`            | 65     | 74    | 9                                             |
| eighteen `p30_journey_*` (a and b) | 67     | 74    | 7                                             |
| `platform_operators`               | —      | —     | skipped: holds no `tenant_administrator` role |

Every one of the twenty-four gained `wty.warranty.read` — the read #349 had taken away — together
with `sal.delivery.manage`, `sal.delivery.view`, `sal.delivery.complete`, `wty.warranty.issue`,
`rpt.report.read` and `iam.audit.view`. The organisations further behind also recovered the P1-30
commercial chain they never held.

A second `--all` run immediately afterwards reported **0 widened, 24 already current** — idempotency
on the real rows, not only in the suite.

**Nothing was revoked.** No administrator role lost a code, and no role other than the twenty-four
administrator roles was written at all. `rpt.export` — withheld by **CC-04** — was granted to no
organisation, because the tool never widens past the bundle.

---

## 5. Proof

`tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts`, 12 cases on real rows against
organisations the suite provisions through the shipped provisioning route and drops afterwards. The
stale state is constructed by removing exactly the seven codes the two P1-31 widenings added, which
reproduces the 67-code bundle the real organisations held.

| obligation                                    | case     | how it is demonstrated                                                                                                                                                                                                     |
| --------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gains exactly the missing codes and no others | **BF-1** | the delta is computed on the ROWS, not read from the report; the role then equals the bundle; every pre-existing mapping row survives BY ID; the audit record names the codes added                                        |
| running it again changes nothing              | **BF-2** | `unchanged`, mapping fingerprints identical, and the audit count does not move                                                                                                                                             |
| a customised role keeps its customisations    | **BF-3** | an allow beyond the bundle (`rpt.export`) survives, and the tenant's own `deny` on `sal.delivery.complete` is reported as `blockedByDeny` and still reads `deny` afterwards. **BF-3b** adds a tenant-built role, unchanged |
| a read the stale bundle refused now succeeds  | **BF-4** | 403 `ERR-IAM-001` with `requiredPermissions = ["wty.warranty.read"]` on both `GET /warranties` and `GET /warranties/{warrantyId}` before; 200 and a past-the-gate 404 after. This is **CC-08** measured back               |
| no other tenant is touched                    | **BF-5** | a second stale organisation is identical row for row, id for id, effect for effect, and gains no audit record                                                                                                              |

and four that hold the mechanism honest: **BF-6** the authority gate refuses an account without the
platform code and an absent account, and nothing moves; **BF-7** the parsed bundle equals the
imported constant; **BF-8** every SQL statement in the file is free of `DELETE`, `UPDATE`, `TRUNCATE`
and `REVOKE` and its only mapping write is an `allow` insert, with **BF-8b** showing a dry run leaves
the database as it found it; **BF-9** the policy measurement behind "script, not route".

---

## 6. What this does not close

Prerequisites **P-8** … **P-16** are untouched. The deliberate exclusions stand exactly as recorded:
**CC-01** (`wty.policy.manage`), **CC-02** (`rpt.report.configure`) and **CC-04** (`rpt.export`) are
as excluded after the backfill as before it, because the tool widens only to the bundle. **CC-10**
(the warranty status ledger has no reader) and **CC-06** (the checklist gap side) are unchanged.

The residual the backfill leaves behind is its own shape: an organisation provisioned before the NEXT
widening will need this run again. That is not a defect of the tool but the reason it is repeatable
and idempotent — the bundle is still written once at provisioning, and this is the sanctioned way to
re-apply it.
