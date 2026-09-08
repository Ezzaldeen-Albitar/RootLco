# P1-31 — change-control dispositions of 2026-09-08

**Status:** OPEN · **Authority:** prerequisite **P-1** of
[`a0-preflight.md`](./a0-preflight.md) ("Widen the provisioning bundle to carry the nine P1-31
codes") · **Baseline:** protected `develop` `0cface1c`, `main` `1262de74`

This register is opened by the P-1 slice so that a permission deliberately WITHHELD from the
provisioning bundle is filed with its consequence rather than granted quietly, and so that the slice
that later needs it can find the reason. It follows the P1-30 register
(`docs/phase-1/phase-1-30/change-control-2026-09-06.md`), whose **CC-04** recorded the identical
widening for the commercial codes and whose **CC-12** recorded the identical deliberate exclusion.
Identifiers are allocated in the P1-31 namespace; no P1-31 identifier existed on `develop` when this
file was written.

## 1. Baseline verified

| fact                                      | value                                                                                    | how                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| protected `develop`                       | `0cface1c` (PR #346 merge, the A0 preflight; second parent `bb8fde7a`)                   | `git rev-parse origin/develop`                                                     |
| protected `main`                          | `1262de74` — untouched by this slice                                                     | `git rev-parse origin/main`                                                        |
| administrator bundle before               | 67 codes                                                                                 | `TENANT_ADMINISTRATOR_ROLE`                                                        |
| administrator bundle after                | 74 codes                                                                                 | seven added, none minted, no migration                                             |
| permission catalogue                      | unchanged — all nine codes are already seeded rows                                       | `supabase/seeds/04_iam_permission_catalog.sql`                                     |
| operations declaring each code            | 4 · 4 · 1 · 2 · **0** · 2 · **0** · 2 · 2, in the order of the nine below                | `docs/phase-1/phase-1-24/evidence/operation-register.json`, 375 operations         |
| RLS predicates naming `wty.`/`rpt.` codes | none — the warranty and reporting policies are tenant- and company-scope predicates only | `supabase/migrations/20260724095000_wty_warranty.sql`, `…096000_rpt_reporting.sql` |

## 2. The nine codes, decided

The rule applied is the one the P1-30 A0 read-surface matrix set and #322 followed: **a code is
carried only when a SHIPPED operation declares it**, and every carried code must already exist in the
catalogue. Seven qualify. Two do not, and are recorded below rather than granted.

| #   | code                    | decision    | why                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `sal.delivery.manage`   | **include** | declared by `sal.delivery-create`, `sal.delivery-receiver-verify`, `sal.delivery-checklist-record`, `sal.delivery-signature-attach`; the administrator is the principal who opens a delivery and the only one who can build a delivery-officer role                                                                                                                        |
| 2   | `sal.delivery.view`     | **include** | declared by `sal.delivery-eligibility-read` and three writes; A0 measured the eligibility read failing on this ONE code, the bundle already holding its companion `sal.finance.view`. `sal.complete_delivery` is `SECURITY INVOKER` and two of its three gates read tables whose SELECT policy names it, so a holder without it is told a verified receiver does not exist |
| 3   | `sal.delivery.complete` | **include** | declared by `sal.delivery-complete`; the high-risk completion authority and the sole overridable blocker. Held on the same reasoning as `wo.work_order.close` and `qms.quality_control.finalize`, which the bundle already carries                                                                                                                                         |
| 4   | `wty.warranty.issue`    | **include** | declared by `wty.warranty-generate` and `wty.warranty-detail`                                                                                                                                                                                                                                                                                                              |
| 5   | `wty.policy.manage`     | **EXCLUDE** | **CC-01** below                                                                                                                                                                                                                                                                                                                                                            |
| 6   | `rpt.report.read`       | **include** | declared by `rpt.report-catalogue` and `rpt.report-read`                                                                                                                                                                                                                                                                                                                   |
| 7   | `rpt.report.configure`  | **EXCLUDE** | **CC-02** below                                                                                                                                                                                                                                                                                                                                                            |
| 8   | `rpt.export`            | **include** | declared by `shared.export-authorize` and `shared.export-catalogue`. Its own contract calls it "the platform switch … the resource permission is the specific entitlement" — a central revocation point held alongside an entitlement, NOT a field-level split. The field-level split in that same contract is `iam.sensitive.view`, which the bundle already holds        |
| 9   | `iam.audit.view`        | **include** | declared by `iam.audit-event-list` and `iam.audit-event-detail`, and by four `sel_*_permitted` audit policies; the Audit Log screen already ships                                                                                                                                                                                                                          |

## 3. Dispositions

| id        | finding                                                                     | measured                                                                                                                                                                                                                                                                                                                                                                                                                                        | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | owner / slice                                                 | status |
| --------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| **CC-01** | `wty.policy.manage` is **excluded** from the tenant administrator bundle    | Declared by **zero** of the 375 registered operations and named by **no** row-level-security predicate — a search of `apps/api/src` and `supabase/` finds it only in the catalogue seed. A0 records the surface as absent (**P-10 / PPD-04**: the warranty policy and coverage tables have no writer). `wty.warranty-detail` states in its own docblock that borrowing this code for a read "would be worse: it grants coverage administration" | **accepted residual, deliberate.** Holding it would confer nothing today and would pre-grant coverage administration the contract asks to be granted on purpose. **Consequence:** when P-10 publishes the warranty-policy writer, a freshly provisioned administrator will be refused `ERR-IAM-001` on that write AND unable to delegate it; the slice that publishes the writer owns the widening — the `inv.item.manage` sequence exactly (excluded while no route declared it, added by #322 the day three routes did) | Backend `wty` configuration lane, with P-10                   | open   |
| **CC-02** | `rpt.report.configure` is **excluded** from the tenant administrator bundle | Declared by **zero** registered operations and named by **no** RLS predicate; the `rpt.report_configurations` policies are tenant-scope predicates with no permission term. A0 records the surface as absent (**P-11**: the report configuration and version tables have no writer and no seed, and the definition view's `executable` is the literal `false`)                                                                                  | **accepted residual, deliberate.** Same reasoning and same consequence as CC-01, against P-11. Recorded rather than granted so that the reporting slice inherits a decision, not a silent permission                                                                                                                                                                                                                                                                                                                      | Backend reporting lane, with P-11                             | open   |
| **CC-03** | Organisations provisioned **before** this slice keep the 67-code bundle     | The bundle is written ONCE, inside `platform.organization-provision`; nothing re-applies it and no route can widen an existing organisation's server-owned role. This is the third instance of the same residual — P1-30 **CC-08** recorded it for the six organisations that predate #321                                                                                                                                                      | **deferred to the Owner**, unchanged: this is A0 decision **D-2** ("are earlier organisations backfilled?"), which engineering may not close. **Consequence for acceptance:** if the pilot organisation predates this change, the widening alone does not unblock an acceptance run on it; a freshly provisioned organisation is required                                                                                                                                                                                 | Owner decision D-2; no engineering owner until it is answered | open   |

## 4. What this slice did NOT do

- **No permission was minted.** All nine codes were already rows in
  `supabase/seeds/04_iam_permission_catalog.sql`; the catalogue is byte-identical.
- **No migration was added.** The closure was a property of an application-layer constant, not of the
  schema, so a migration would have been a change with nothing to change.
- **No backfill was attempted.** CC-03 above.
- **No delegation rule was touched.** `ins_role_permissions_delegable`, `ins_role_grants_delegable`
  and `DelegationPolicy.assertDelegable` are unmodified, and the suite proves held-only delegation
  still refuses three codes outside the bundle.
- **No screen was touched.** This is the `p1-31-backend` lane; `apps/web` is unchanged.
- **No canonical task was closed.** P-1 is an execution prerequisite, not one of the 29.

## 5. Proof

`tests/backend/p1-31-provisioning-bundle.test.ts`, seven cases on real rows in an organisation
created by the shipped `platform.organization-provision` route:

| case       | proves                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P31-B1** | the delta is exactly the seven and the bundle is 67 + 7; each added code is declared by at least one registered operation and each excluded code by none, read from the P1-24 operation register |
| **P31-B2** | the provisioned administrator role's rows carry all seven and neither exclusion                                                                                                                  |
| **P31-B3** | the provisioned Owner effectively holds all seven through its active grants, and the role's rows equal the server-owned bundle exactly — so nothing beyond the seven became held                 |
| **P31-B4** | the Owner can MAP each of the seven onto a role it creates: the act `ins_role_permissions_delegable` refused before                                                                              |
| **P31-B5** | each excluded code is refused with the registered refusal — 403 `ERR-IAM-001`, `requiredPermissions` naming the withheld code — and the target role gains nothing                                |
| **P31-B6** | delegation is still held-only: `org.settings.manage`, `iam.login.view_all` and `platform.organization.provision` are refused as before                                                           |
| **P31-B7** | three shipped reads gated on added codes answer 200 for the provisioned Owner, including `iam.audit-event-list`, which the already-shipped Audit Log screen calls                                |

The two pre-existing bundle pins move with it: `tests/backend/p1-29-w9-owner-bootstrap.test.ts`
(W9-B3, which asserts the provisioned role holds EXACTLY the bundle) and
`tests/backend/p1-30-inventory-master-data.test.ts` (MD-B1), 67 → 74.

## 6. What P-1 does not close

Prerequisites **P-2** … **P-14** and **P-16** of the A0 preflight are untouched. Widening the bundle
makes the P1-31 surface REACHABLE by authorization; it does not create the delivery read seam, the
warranty list, the report engine or the export route those items also need.
