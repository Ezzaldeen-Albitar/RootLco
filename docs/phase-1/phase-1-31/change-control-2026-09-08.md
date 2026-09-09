# P1-31 — change-control dispositions of 2026-09-08

**Status:** OPEN · **Authority:** prerequisites **P-1** ("Widen the provisioning bundle to carry the
nine P1-31 codes") and, from section 7 onward, **P-2** … **P-5** (the delivery read seam) of
[`a0-preflight.md`](./a0-preflight.md) · **Baseline:** protected `develop` `0cface1c`, `main`
`1262de74`

Sections 1–6 were written by the P-1 slice and are unchanged. Sections 7–11 were added by the
P-2 … P-5 slice on 2026-09-08, and sections 12–16 by the P-6 / P-7 slice on the same day;
sections 17–20 were added by the **D-2 backfill** slice after #349 merged, which is also where
**CC-03** and **CC-08** are answered rather than merely restated; sections 21–23 were added by the
**P-8** slice on 2026-09-09. Identifiers continue in the same P1-31 namespace, so the register now
runs **CC-01 … CC-12**.
Where an identifier from another phase's register is cited it carries its phase prefix — the
**P1-30 CC-08** and **P1-30 CC-12** below are that phase's rows, not this one's.

This register is opened by the P-1 slice so that a permission deliberately WITHHELD from the
provisioning bundle is filed with its consequence rather than granted quietly, and so that the slice
that later needs it can find the reason. It follows the P1-30 register
(`docs/phase-1/phase-1-30/change-control-2026-09-06.md`), whose **P1-30 CC-04** recorded the
identical widening for the commercial codes and whose **P1-30 CC-12** recorded the identical
deliberate exclusion. Identifiers are allocated in the P1-31 namespace; no P1-31 identifier existed
on `develop` when this file was written. Where an identifier from another phase's register is cited
it is written with its phase prefix, because this register now holds a **CC-04** of its own.

## 1. Baseline verified

| fact                                      | value                                                                                    | how                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| protected `develop`                       | `0cface1c` (PR #346 merge, the A0 preflight; second parent `bb8fde7a`)                   | `git rev-parse origin/develop`                                                     |
| protected `main`                          | `1262de74` — untouched by this slice                                                     | `git rev-parse origin/main`                                                        |
| administrator bundle before               | 67 codes                                                                                 | `TENANT_ADMINISTRATOR_ROLE`                                                        |
| administrator bundle after                | 73 codes                                                                                 | six added, none minted, no migration                                               |
| permission catalogue                      | unchanged — all nine codes are already seeded rows                                       | `supabase/seeds/04_iam_permission_catalog.sql`                                     |
| operations declaring each code            | 4 · 4 · 1 · 2 · **0** · 2 · **0** · 2 · 2, in the order of the nine below                | `docs/phase-1/phase-1-24/evidence/operation-register.json`, 375 operations         |
| RLS predicates naming `wty.`/`rpt.` codes | none — the warranty and reporting policies are tenant- and company-scope predicates only | `supabase/migrations/20260724095000_wty_warranty.sql`, `…096000_rpt_reporting.sql` |

## 2. The nine codes, decided

The rule applied is the one the P1-30 A0 read-surface matrix set and #322 followed: **a code is
carried only when a SHIPPED operation declares it**, and every carried code must already exist in the
catalogue. Seven qualify on that rule; two do not.

Declaration is the NECESSARY condition, not the sufficient one. Of the seven that qualify, the Owner
withheld one — `rpt.export` — on 2026-09-08, on least-privilege grounds (**CC-04**). **Six are
carried. Three are recorded below rather than granted**, and the two grounds are different in kind:
CC-01 and CC-02 withhold codes that nothing declares, while CC-04 withholds a code that shipped
operations do declare.

| #   | code                    | decision    | why                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `sal.delivery.manage`   | **include** | declared by `sal.delivery-create`, `sal.delivery-receiver-verify`, `sal.delivery-checklist-record`, `sal.delivery-signature-attach`; the administrator is the principal who opens a delivery and the only one who can build a delivery-officer role                                                                                                                        |
| 2   | `sal.delivery.view`     | **include** | declared by `sal.delivery-eligibility-read` and three writes; A0 measured the eligibility read failing on this ONE code, the bundle already holding its companion `sal.finance.view`. `sal.complete_delivery` is `SECURITY INVOKER` and two of its three gates read tables whose SELECT policy names it, so a holder without it is told a verified receiver does not exist |
| 3   | `sal.delivery.complete` | **include** | declared by `sal.delivery-complete`; the high-risk completion authority and the sole overridable blocker. Held on the same reasoning as `wo.work_order.close` and `qms.quality_control.finalize`, which the bundle already carries                                                                                                                                         |
| 4   | `wty.warranty.issue`    | **include** | declared by `wty.warranty-generate` and `wty.warranty-detail`                                                                                                                                                                                                                                                                                                              |
| 5   | `wty.policy.manage`     | **EXCLUDE** | **CC-01** below                                                                                                                                                                                                                                                                                                                                                            |
| 6   | `rpt.report.read`       | **include** | declared by `rpt.report-catalogue` and `rpt.report-read`                                                                                                                                                                                                                                                                                                                   |
| 7   | `rpt.report.configure`  | **EXCLUDE** | **CC-02** below                                                                                                                                                                                                                                                                                                                                                            |
| 8   | `rpt.export`            | **EXCLUDE** | **CC-04** below — declared by `shared.export-authorize` and `shared.export-catalogue`, so it qualifies on the rule above, and withheld anyway by Owner decision                                                                                                                                                                                                            |
| 9   | `iam.audit.view`        | **include** | declared by `iam.audit-event-list` and `iam.audit-event-detail`, and by four `sel_*_permitted` audit policies; the Audit Log screen already ships                                                                                                                                                                                                                          |

## 3. Dispositions

| id        | finding                                                                                                   | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | owner / slice                                                                                | status |
| --------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------ |
| **CC-01** | `wty.policy.manage` is **excluded** from the tenant administrator bundle                                  | Declared by **zero** of the 375 registered operations and named by **no** row-level-security predicate — a search of `apps/api/src` and `supabase/` finds it only in the catalogue seed. A0 records the surface as absent (**P-10 / PPD-04**: the warranty policy and coverage tables have no writer). `wty.warranty-detail` states in its own docblock that borrowing this code for a read "would be worse: it grants coverage administration"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **accepted residual, deliberate.** Holding it would confer nothing today and would pre-grant coverage administration the contract asks to be granted on purpose. **Consequence:** when P-10 publishes the warranty-policy writer, a freshly provisioned administrator will be refused `ERR-IAM-001` on that write AND unable to delegate it; the slice that publishes the writer owns the widening — the `inv.item.manage` sequence exactly (excluded while no route declared it, added by #322 the day three routes did)                                                                                                                                                                                                                                                                                                                              | Backend `wty` configuration lane, with P-10                                                  | open   |
| **CC-02** | `rpt.report.configure` is **excluded** from the tenant administrator bundle                               | Declared by **zero** registered operations and named by **no** RLS predicate; the `rpt.report_configurations` policies are tenant-scope predicates with no permission term. A0 records the surface as absent (**P-11**: the report configuration and version tables have no writer and no seed, and the definition view's `executable` is the literal `false`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **accepted residual, deliberate.** Same reasoning and same consequence as CC-01, against P-11. Recorded rather than granted so that the reporting slice inherits a decision, not a silent permission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Backend reporting lane, with P-11                                                            | open   |
| **CC-03** | Organisations provisioned **before** this slice keep the 67-code bundle                                   | The bundle is written ONCE, inside `platform.organization-provision`; nothing re-applies it and no route can widen an existing organisation's server-owned role. This is the third instance of the same residual — P1-30 **CC-08** recorded it for the six organisations that predate #321                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **ANSWERED. Owner decision D-2 of 2026-09-08: backfill.** The finding stands as measured, and the disposition it carried — deferred, not closable by engineering — is now closed by that decision. Where it landed: `scripts/platform/backfill-tenant-administrator-bundle.mjs`, an operator act on a privileged connection gated on the EXISTING `platform.organization.provision`, additive only, idempotent, with one audit record per organisation it changed. Applied to the shared acceptance environment on 2026-09-08: **24 administrator roles brought from 44 / 46 / 48 / 65 / 67 codes to 74**, nothing revoked from anyone, and one organisation (`platform_operators`) reported and skipped because it holds no such role. See **CC-11** below and [`tenant-administrator-bundle-backfill.md`](./tenant-administrator-bundle-backfill.md) | Owner decision D-2, answered; delivered by the D-2 backfill slice                            | closed |
| **CC-04** | `rpt.export` is **excluded** from the tenant administrator bundle, although shipped operations declare it | Declared by **two** of the 375 registered operations — `shared.export-authorize` and `shared.export-catalogue` — so it PASSES the rule in section 2 and the slice originally carried it. What that rule does not weigh is reach: `rpt.export` is not a P1-31 code but the platform-wide export switch of P1-15 (`EXPORT_PERMISSION`), required for **every** export, and the bundle already holds the entitlements all three registered resources use (`shared.document.read`, `org.branch.read`) together with the sensitive-field second permission `iam.sensitive.view`. Carrying it would therefore let a freshly provisioned administrator authorize bulk export of documents, outbound messages and branch data, sensitive fields included, on day one. Nothing in this phase is delayed by withholding it: the reporting items that would consume an export are blocked on **P-11** (no report engine) and **P-12** (no `POST /reports/{reportCode}:export` route and no registered report resource) regardless | **Owner decision of 2026-09-08: EXCLUDE for now.** Least privilege — the bundle is the delegation ceiling of the whole tenant, and a capability of this reach is not granted on day one because a rule about declaration happened to admit it. **Different in kind from CC-01 and CC-02:** those withhold codes that NO operation declares, so holding them would confer nothing; this withholds a code that IS declared and would confer a great deal. **Consequence, accepted:** a freshly provisioned administrator is refused `ERR-IAM-001` by `shared.export-catalogue` and `shared.export-authorize` and cannot delegate the code to anyone. **Revisitable:** it may be added deliberately when the export contract exists (P-11, P-12) and the need is demonstrated; the slice that publishes that contract owns the widening                   | Backend reporting and export lane, with P-11 and P-12; re-opening requires an Owner decision | open   |

## 4. What this slice did NOT do

- **No permission was minted.** All nine codes were already rows in
  `supabase/seeds/04_iam_permission_catalog.sql`; the catalogue is byte-identical.
- **No migration was added.** The closure was a property of an application-layer constant, not of the
  schema, so a migration would have been a change with nothing to change.
- **No backfill was attempted.** CC-03 above. (It was performed later, by the D-2 slice of §17–20; this line records what the P-1 slice did, not the current state.)
- **No delegation rule was touched.** `ins_role_permissions_delegable`, `ins_role_grants_delegable`
  and `DelegationPolicy.assertDelegable` are unmodified, and the suite proves held-only delegation
  still refuses three codes outside the bundle.
- **No screen was touched.** This is the `p1-31-backend` lane; `apps/web` is unchanged.
- **No canonical task was closed.** P-1 is an execution prerequisite, not one of the 29.

## 5. Proof

`tests/backend/p1-31-provisioning-bundle.test.ts`, eight cases on real rows in an organisation
created by the shipped `platform.organization-provision` route:

| case       | proves                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P31-B1** | the delta is exactly the six and the bundle is 67 + 6; each added code is declared by at least one registered operation; each of CC-01 and CC-02 by **none**; and `rpt.export` by **`shared.export-authorize` and `shared.export-catalogue`**, named — so the two grounds for exclusion cannot be confused, and the day that set changes the case makes the Owner look at CC-04 again |
| **P31-B2** | the provisioned administrator role's rows carry all six and none of the three exclusions                                                                                                                                                                                                                                                                                              |
| **P31-B3** | the provisioned Owner effectively holds all six and no excluded code, and the role's rows equal the server-owned bundle exactly — so nothing beyond the six became held                                                                                                                                                                                                               |
| **P31-B4** | the Owner can MAP each of the six onto a role it creates: the act `ins_role_permissions_delegable` refused before                                                                                                                                                                                                                                                                     |
| **P31-B5** | each of the **three** excluded codes is refused with the registered refusal — 403 `ERR-IAM-001`, `requiredPermissions` naming the withheld code — and the target role gains nothing                                                                                                                                                                                                   |
| **P31-B6** | delegation is still held-only: `org.settings.manage`, `iam.login.view_all` and `platform.organization.provision` are refused as before                                                                                                                                                                                                                                                |
| **P31-B7** | two shipped reads gated on added codes answer 200 for the provisioned Owner, including `iam.audit-event-list`, which the already-shipped Audit Log screen calls                                                                                                                                                                                                                       |
| **P31-B8** | the CC-04 consequence, measured on the shipped route rather than assumed: `rpt.export` appears in neither the administrator role's rows nor the Owner's effective grants, and `GET /exports/resources` answers that Owner 403 `ERR-IAM-001` with `requiredPermissions` = `["rpt.export"]`                                                                                             |

The two pre-existing bundle pins move with it: `tests/backend/p1-29-w9-owner-bootstrap.test.ts`
(W9-B3, which asserts the provisioned role holds EXACTLY the bundle) and
`tests/backend/p1-30-inventory-master-data.test.ts` (MD-B1), 67 → 73.

## 6. What P-1 does not close

Prerequisites **P-2** … **P-14** and **P-16** of the A0 preflight are untouched. Widening the bundle
makes the P1-31 surface REACHABLE by authorization; it does not create the delivery read seam, the
warranty list, the report engine or the export route those items also need.

---

# P-2 … P-5 — the delivery read seam, of 2026-09-08

**Authority:** prerequisites **P-2**, **P-3**, **P-4** and **P-5** of
[`a0-preflight.md`](./a0-preflight.md) · **Baseline:** protected `develop` `8052841a` (PR #347, the
P-1 provisioning-bundle slice; second parent `0766979f`'s successor on this register's own lane),
`main` `1262de74` — untouched.

Six operations were published over reads that, with one exception, already existed. This section
files the two things that are NOT what the governing precedent describes, so that a later reader
finds the reason rather than inferring one.

## 7. What was published

| operation                            | path                                               | prerequisite | over                                                      |
| ------------------------------------ | -------------------------------------------------- | ------------ | --------------------------------------------------------- |
| `sal.work-order-delivery-read`       | `GET /work-orders/{workOrderId}/delivery`          | **P-2**      | `DeliveryRepository.findLiveDeliveryForWorkOrder`         |
| `sal.delivery-read`                  | `GET /deliveries/{deliveryId}`                     | **P-3**      | `DeliveryRepository.findDelivery`                         |
| `sal.delivery-receiver-read`         | `GET /deliveries/{deliveryId}/authorized-receiver` | **P-4**      | `DeliveryRepository.findReceiver`                         |
| `sal.delivery-checklist-result-list` | `GET /deliveries/{deliveryId}/checklist-results`   | **P-4**      | a NEW set query over `sal.delivery_checklist_results`     |
| `sal.delivery-signature-list`        | `GET /deliveries/{deliveryId}/signatures`          | **P-4**      | a NEW set query over `sal.delivery_signatures`            |
| `sal.delivery-status-history`        | `GET /deliveries/{deliveryId}/status-history`      | **P-5**      | a NEW query and mapper over `sal.delivery_status_history` |

All six declare `sal.delivery.view` and `scope: 'branch'`, and none declares an audit class. The
permission was verified against `supabase/seeds/04_iam_permission_catalog.sql` line 71 before it was
used; **no permission was minted** and the catalogue is byte-identical. **No migration was added** —
every table, index and policy these reads use already existed, and `sal.delivery_status_history`
already carried `ix_delivery_status_history_delivery` on exactly the predicate and ordering used.

## 8. Dispositions

| id        | finding                                                                               | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | owner / slice                      | status |
| --------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------ |
| **CC-05** | three of the six reads are **not pure publications** of an existing repository method | The governing precedent is `sal.work-order-invoice-read`, whose docblock states the rule: "This publishes the existing read; it adds no query and no second mapper." Three of the six meet it exactly. Three do not, for reasons that are properties of the repository rather than of this slice. (a) `findChecklistResult` is addressed by `(delivery, templateItemId)` and answers "was this ONE item already recorded" for the write path — and the checklist TEMPLATE has no HTTP surface at all (**PPD-12** / **P-9**), so no caller can discover a `template_item_id` to put in a path. (b) `findSignature` is a REPLAY PROBE on the exact `(delivery, signerRole, signatureDocumentVersionId)` triple, so a caller must already hold the document-version id — the unrecoverable-identifier problem restated, not a read of the signatures; `hasSignature` is a boolean. (c) `sal.delivery_status_history` was read by **nothing** anywhere in `apps/api/src`, which is the finding P-5 cites, so there was no read to publish at all | **accepted, and recorded rather than presented as a publication.** Each of the three route docblocks says in its own words that it is not a pure publication and why. What the rule protects is preserved: **no second mapper and no second wire contract**. The two list reads reuse `toChecklistResult` and `toDeliverySignature`; the checklist row is WIDENED by two joined template columns (`itemCode`, `label`) rather than given a parallel shape, and `itemCode` is already on the write response so publishing it is contract parity. Only the status-history read adds a row shape, because nothing had ever read that table. The read views are named `…RecordView` and spell every shared field exactly as the write views do, so a screen sees one shape | this slice                         | closed |
| **CC-06** | the checklist-results read does **not** close **P1-27-INT-088**                       | INT-088's three limbs are about the GAP side of the checklist: the eligibility read returns mandatory-and-unsatisfied items only, capped at 20, with `missingCount` computed and then dropped before the wire. A fourth fact recorded by A0 is that the gap scan is **company-scoped rather than template-scoped**, because the delivery record carries no template reference. This slice publishes the RESULTS — the complementary set — and touches none of that                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **open, unchanged, and stated so it cannot be read as closed.** A reader who sees a checklist read published might reasonably assume the finding was addressed; it was not. The gap side stays exactly as recorded, and closing it needs a decision about the missing template reference on the delivery record, which is a schema question and therefore not this lane's                                                                                                                                                                                                                                                                                                                                                                                              | P1-22 under Field 13, with **P-9** | open   |

## 9. What this slice did NOT do

- **No write path was touched.** No eligibility rule, no state machine, no maker-and-checker
  behaviour, and no existing operation's declaration changed. The three GETs appended to existing
  route files are additive exports beside untouched POSTs.
- **No permission was minted, and no migration was added.** See section 7.
- **No screen was touched.** This is the `p1-31-backend` lane; `apps/web` changed only through the
  GENERATED idempotency manifest, which every published operation moves.
- **`sal.delivery.read` was not resolved.** **RES-05** / **P-8** stays open and
  `validate:permission-parity` still reports it as declared open debt owned by the delivery
  Frontend. This slice deliberately did not re-point the navigation gate: that is a Frontend-profile
  edit and would have been a screen change on a backend lane.
- **No canonical task was closed.** P-2 … P-5 are execution prerequisites, not among the 29.

## 10. Proof

`tests/backend/p1-31-delivery-read-seam.test.ts`, 26 cases on real rows arranged through the real
write routes. The claim under test is RECOVERY rather than "these routes answer 200", so every
recovery case resets the authenticator after the writes and re-authenticates before it reads.

| case                       | proves                                                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **the six registrations**  | all six declare `sal.delivery.view`, `scope: 'branch'`, `GET` and `auditClass: 'none'` — so a later edit cannot quietly widen the gate                                                                                                                                                     |
| **recovery by work order** | a delivery created through `POST /deliveries` is found again from the WORK ORDER alone, after the creating session is gone. Nothing from the create response addresses the read                                                                                                            |
| **the record**             | every field reads back, `recordVersion` is published in the body AND as the ETag, and `deliveredAt` / `finalOdometerReadingId` are both NULL on an uncompleted delivery                                                                                                                    |
| **the receiver**           | the row, with its partner and its identity-evidence REFERENCE — not the boolean blocker; and `receiver: null` at 200 before verification                                                                                                                                                   |
| **the checklist results**  | both recorded results, each with the template item's code and label                                                                                                                                                                                                                        |
| **the signatures**         | both signatures, and the serialised response contains no `storageKey`, `contentType`, `sha256`, `bytes` or data URI                                                                                                                                                                        |
| **the status history**     | `ready` → `receiver_verified` → `signed`, newest first, the oldest row already the origin with a NULL `from_status`, and no synthesised `origin` block                                                                                                                                     |
| **the handover**           | `SAL_READER` — which holds `sal.delivery.view` and NOT `sal.delivery.manage`, so it could not have written any of these rows — performs all five reads. This is the case the phase exists for                                                                                              |
| **401 / 403 / 404 / 403**  | unauthenticated; `SAL_NO_DELIVERY_VIEW` refused `ERR-IAM-001` on every read; another tenant answered `ERR-RES-001` and never a 403, so existence is not revealed; and BOTH isolation layers separately — RLS 404, then `authorizeScope` 403                                                |
| **paging**                 | two pages disjoint on all three paged reads, over rows written in one transaction that share their timestamp to the microsecond (`P1-27-INT-006`); a malformed cursor is `ERR-PAG-001`/400, an unknown parameter `ERR-VAL-001`/422, and a cursor minted for one list is refused by another |
| **no money**               | every response is walked for a JSON number under any money-shaped key. There is none, because a delivery record has no amount column and `finalOdometerReadingId` is a reading REFERENCE                                                                                                   |

## 11. What P-2 … P-5 do not close

Prerequisites **P-6** … **P-16** are untouched. The delivery record is now recoverable and readable;
warranty, the report engine, the export route, the checklist-template writer, the warranty-policy
writer, the navigation gate and the documentation corrections all remain as A0 measured them.

---

# The warranty read seam — P-6 and P-7

Sections 12–16 were added by the **P-6 / P-7** slice on 2026-09-08; identifiers continue in the same
P1-31 namespace, so the register now runs **CC-01 … CC-10**. **Baseline:** protected `develop`
`80eb0050` (PR #348, the P-2 … P-5 delivery read seam), `main` `1262de74` — untouched.

This is the phase's **only** shipping insert into `iam.permissions`, so the sections below are
written to be read by the slice that next changes a permission, not only by this slice's reviewer.

## 12. What was published, and what was minted

| operation             | path                           | prerequisite | over                                                   |
| --------------------- | ------------------------------ | ------------ | ------------------------------------------------------ |
| `wty.warranty-list`   | `GET /warranties`              | **P-6**      | a NEW branch-wide query over `wty.warranty_records`    |
| `wty.warranty-detail` | `GET /warranties/{warrantyId}` | **P-7**      | unchanged behaviour; its **permission** was re-pointed |

One permission was minted: **`wty.warranty.read`** — `wty`, risk `low`, description
"Read warranty records, coverage terms and covered items" — added to
`supabase/seeds/04_iam_permission_catalog.sql` in the existing Phase 1-11 `wty` group.
`permissionCount` moves **118 → 119** in `.github/ci-baselines/schema-baseline.json`.
**No migration was added**: the catalogue is a seed, the seed is idempotent and additive, and every
table, index and policy this read uses already existed. `ix_warranty_records_vehicle
(tenant_id, vehicle_id)` already covers the vehicle filter, which is the fact A0 records under P-6.

Both operations declare `wty.warranty.read`, `scope: 'branch'` and `auditClass: 'none'`.
`wty.warranty-generate` is untouched and still declares `wty.warranty.issue` alone.

**The name is derived, not invented.** Every read code in the catalogue is `<domain>.<resource>.read`
— `wo.work_order.read`, `rec.reception.read`, `apt.appointment.read`, `quo.quotation.read`,
`veh.vehicle.read`, `dia.diagnostic.read`, `qms.quality_control.read`, `svc.service.read`,
`inv.item.read`. The `wty` resource nouns are `policy` and `warranty`. The route and the module
surface had both already written the name they lacked, in as many words: "the permission catalogue
contains no `wty.warranty.read`".

## 13. Dispositions

| id        | finding                                                                                     | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | owner / slice                                                     | status |
| --------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------ |
| **CC-07** | `wty.warranty.read` is **included** in the tenant administrator provisioning bundle         | The rule this phase applied is "carry a code only when a shipped operation declares it". Two do: `wty.warranty-list` and the re-pointed `wty.warranty-detail`, so the necessary condition holds where CC-01 and CC-02 have **zero** declarers. The question CC-04 added is REACH, and it answers the other way: `rpt.export` is the platform-wide export switch of P1-15, whereas this code reads warranty records, their coverage terms and their covered jobs and parts in ONE schema — `wty` has 80 columns, all classified `internal`, none `restricted`, and not one monetary. The decisive fact is that **withholding it would REMOVE a capability**: a freshly provisioned administrator can read a warranty today, through `wty.warranty.issue`, which the bundle already holds | **included, deliberately.** Least privilege here means the administrator reads warranties under a READ code instead of an ISSUE code — not that it stops reading them. Re-pointing the route while withholding the code would have been a regression dressed as a restriction. `wty.warranty.issue` is NOT withdrawn: `wty.warranty-generate` still declares it, and an administrator that could not hold it could not delegate a warranty clerk. Bundle **73 → 74**; `tests/backend/p1-31-provisioning-bundle.test.ts` keeps P-1's six and P-7's one as separate constants so neither widening can drift into the other                                                                                                                         | this slice                                                        | closed |
| **CC-08** | organisations provisioned **before** this slice lose the warranty detail read               | The bundle is written ONCE, inside `platform.organization-provision`, and nothing re-applies it. An organisation provisioned on the 48-, 65-, 67- or 73-code bundle holds `wty.warranty.issue` and NOT `wty.warranty.read`, so from this commit its administrator is refused `GET /warranties/{warrantyId}` with `ERR-IAM-001` — a read it could perform yesterday. It also cannot delegate the code, because `ins_role_permissions_delegable` admits a mapping only when the acting administrator already holds it. This is CC-03's residual with a sharper consequence: CC-03 withholds something new, this one **withdraws something old**                                                                                                                                           | **RESOLVED, by the route this row itself named.** It was accepted and filed rather than silently shipped, on the stated understanding that it "resolves the moment A0 decision **D-2** (the backfill) is answered" — and it was answered the same day. Where it landed: the backfill of **CC-11**, which carried `wty.warranty.read` onto all 24 administrator roles on the shared acceptance environment. The withdrawn read is measured back rather than assumed: `tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts` **BF-4** is refused `GET /warranties/{warrantyId}` with `ERR-IAM-001` on a stale role and gets past that gate on the same role after the backfill. `wty.warranty.issue` was not touched, here or anywhere | Owner decision D-2, answered; delivered by the D-2 backfill slice | closed |
| **CC-09** | the warranty list is **not a pure publication** of an existing repository method            | Same class as **CC-05**, and the governing precedent is the same: `sal.work-order-invoice-read` states "This publishes the existing read; it adds no query and no second mapper." Half holds and half does not. Every finder in `WarrantyRepository` is addressed by an identifier the caller must ALREADY possess — a record id, an idempotency key, a delivery id — so there was no branch-wide read to publish and the query is new, as is `findPolicies`, the set form of the existing identity read                                                                                                                                                                                                                                                                                | **accepted, and recorded rather than presented as a publication.** What the rule protects is preserved: **no second mapper and no second wire contract.** Rows come back through the existing `toRecord`, policies through the existing `toPolicy`, and `WarrantyRecordListView` spells every field exactly as `WarrantyView` spells it — the suite asserts key-by-key equality between a list row and the detail body, so the two shapes cannot drift. The policy block is carried rather than a bare `policyId` because no operation lists warranty policies (**PPD-04** / P-10), and publishing an identifier nobody can resolve is the defect this phase keeps finding                                                                       | this slice                                                        | closed |
| **CC-10** | the list does **not** close `wty.warranty_record_status_history`, and P-6 never asked it to | A0 records item 9 ("warranty history") as blocked on two facts: the chapter declares `GET /api/v1/warranties`, which did not exist, and `wty.warranty_record_status_history` "appears nowhere in `apps/api/src`". **P-6 names only the first.** The second is still true after this slice: the append-only warranty status ledger has no reader, exactly as the delivery ledger had none before P-5 published it                                                                                                                                                                                                                                                                                                                                                                        | **open, unchanged, and stated so it cannot be read as closed.** A reader who sees a warranty list published might reasonably assume **VHM-06 / WF-26 / PPD-13** was fully addressed; only its list limb was. Publishing the ledger read would be a second contract this prerequisite does not sanction, and the P-5 precedent shows what it costs: a new query and a new row shape. It needs a prerequisite of its own or an explicit extension of P-6                                                                                                                                                                                                                                                                                           | a later `wty` read slice, with FE-009                             | open   |

## 14. What this slice did NOT do

- **No write path was touched.** No eligibility rule, no coverage arithmetic, no status transition,
  and `wty.warranty-generate` keeps its declaration, its audit class and its outbox event exactly.
  The suite proves it positively: a principal holding `wty.warranty.issue` alone still issues a
  warranty through the real route.
- **No migration was added.** The minted code is a seed row. `migrationCount` stays 138 and
  `schemaHash` is unchanged, because `schema-inventory.mjs` hashes structure and the catalogue is
  data.
- **No index was added.** The branch predicate is served by
  `uq_warranty_records_scope_id (tenant_id, company_id, branch_id, id)` and the vehicle filter by
  `ix_warranty_records_vehicle`; no index leads on `(tenant, company, branch, start_date)`, so the
  ordering is a sort over the narrowed set. Adding one would be a migration and P-6 demonstrates no
  need for a schema change — recorded here rather than left for a reader to discover.
- **No filter was invented.** `vehicleId` is the only one the record names, and the only one offered.
- **No screen was touched.** This is the `p1-31-backend` lane; `apps/web` changed only through the
  GENERATED idempotency manifest, which every published operation moves.
- **`wty.policy.manage` stayed excluded** (CC-01, unchanged) and **no warranty-policy writer was
  built** (PPD-04 / P-10). The suite still seeds policies and coverage by SQL, and says so.
- **No canonical task was closed.** P-6 and P-7 are execution prerequisites, not among the 29.

## 15. Proof

`tests/backend/p1-31-warranty-read-seam.test.ts`, 23 cases on real rows arranged through the real
generation route. Every arrangement is performed by `SAL_FULL` and the authenticator is RESET before
the reading principal authenticates, so no read is credited to the session that wrote the row.

| case                      | proves                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **the minted code**       | exactly one `iam.permissions` row, domain `wty`, risk `low`; both reads declare it and neither declares `wty.warranty.issue` or `wty.policy.manage`; the bundle carries it and still carries the issue code                                                                                                                                                                |
| **the read-only case**    | a principal holding **only** `wty.warranty.read` lists and reads back a warranty it could not have issued — the case P-7 exists for                                                                                                                                                                                                                                        |
| **the counterfactual**    | a principal holding **only** `wty.warranty.issue` — yesterday's caller — is REFUSED both reads, `ERR-IAM-001`, `requiredPermissions` = `["wty.warranty.read"]`, and can still GENERATE a warranty. Collapse the two codes and both cases go red in opposite directions                                                                                                     |
| **the borrowed code**     | a principal holding only `wty.policy.manage` is refused both reads, so the read never borrows coverage administration                                                                                                                                                                                                                                                      |
| **the fixture is real**   | the codes each fixture principal actually holds are read back out of `iam.role_permissions`, so a refusal cannot be a silently unseeded permission                                                                                                                                                                                                                         |
| **the list**              | every field against terms PostgreSQL derives from the fixture rows — never a value the test computed — plus a resolved policy code, name and status                                                                                                                                                                                                                        |
| **one shape**             | key-by-key equality between a list row and the detail body, and `coverage`, `items` and `replayed` absent from the list                                                                                                                                                                                                                                                    |
| **server scope**          | an unfiltered call returns the named branch and nothing else, with a warranty issued in a SECOND company and branch of the SAME tenant absent from it — so what separates the pages is scope and not tenancy                                                                                                                                                               |
| **the filter filters**    | `vehicleId` narrows to one row, the same list unfiltered carries the other, and a vehicle with no warranty is an empty page rather than a 404                                                                                                                                                                                                                              |
| **401 / 403 / 404**       | unauthenticated; the scope target refused before a row is read; another tenant answered `ERR-RES-001` for a real id and for an invented one alike, holding the read code, so existence is not revealed                                                                                                                                                                     |
| **isolation, two layers** | a scoped principal HOLDING the read code gets 404 from RLS; one whose widening grant makes the row visible gets 403 from the in-service `authorizeScope` on the row's own company and branch (P1-18-A-01). Both hold `wty.warranty.read`, or the refusals would be the missing permission                                                                                  |
| **paging**                | the branch is walked one row at a time to exhaustion: no id repeated, none skipped, and the walk equals the branch's live rows read by admin. At least two rows share the `start_date` the cursor sorts on, so the `id` tie-break is load-bearing. A bad cursor is `ERR-PAG-001`/400, an oversized page `ERR-VAL-001`/422, and a cursor minted for another list is refused |
| **no money**              | every response is walked for a JSON number under any money-shaped key. There is none: `wty` has no monetary column at all, and `odometerAtIssue` / `odometerLimit` are exact decimal STRINGS for a distance reading                                                                                                                                                        |

## 16. What P-6 and P-7 do not close

Prerequisites **P-8** … **P-16** are untouched, and **P-10** in particular: there is still no writer
for `wty.warranty_policies` or `wty.warranty_coverage`, so on a freshly provisioned tenant every
generation returns `ERR-RES-001` and nothing this slice publishes changes that. **CC-10** above
records the half of **VHM-06 / WF-26 / PPD-13** that stays open. The report engine, the export route,
the checklist-template writer, the navigation gate and the documentation corrections all remain as A0
measured them.

---

## 17. What the D-2 backfill did

**Authority:** Owner decision **D-2** of [`a0-preflight.md`](./a0-preflight.md) — _"Is the
provisioning bundle widened for the nine codes, and are earlier organisations backfilled?"_ — answered
on 2026-09-08: **backfill**. **Baseline:** protected `develop` `d29e63d2`, the merge of #349.

One file is added to the product: `scripts/platform/backfill-tenant-administrator-bundle.mjs`. It
brings an EXISTING organisation's `tenant_administrator` role up to the current
`TENANT_ADMINISTRATOR_ROLE.permissionCodes`, and nothing else.

| property           | how it is held                                                                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **authority**      | refuses unless the named operator account holds an unrevoked `platform.organization.provision` in `iam.platform_grants` — an EXISTING platform permission, none minted. That is the authority that already writes this exact bundle at provisioning, so it confers nothing new                       |
| **additive**       | the file contains no `DELETE`, no `UPDATE`, no `TRUNCATE` and no `REVOKE`. Its one write to `iam.role_permissions` is an `INSERT … 'allow'` for a code the role does not map at all                                                                                                                  |
| **idempotent**     | the work is the set difference `bundle − mapped`. A second run computes an empty difference, writes no row and appends no audit record                                                                                                                                                               |
| **narrow**         | one role per organisation, the one whose `role_code` is `tenant_administrator`. No other role is read for writing or written. An organisation with no such role is REPORTED and SKIPPED — the role is never created, because creating one would be provisioning                                      |
| **customisation**  | a bundle code the tenant has mapped `effect = 'deny'` on its own administrator role is LEFT ALONE and reported as `blockedByDeny`. `uq_role_permissions_map` makes the mapping identity unique, so "adding" it would mean re-deciding the tenant's own deny by `UPDATE`, which this tool does not do |
| **explicit scope** | `--tenant <uuid\|code>` (repeatable) names the organisations; `--all` sweeps, and REPORTS every organisation it considered with its outcome. There is no silent sweep                                                                                                                                |
| **recorded**       | one `iam.audit_append` record IN EACH CHANGED TENANT — action `platform.tenant_administrator_bundle.backfilled`, actor the operator account, entity the administrator role, details the codes added and the count before and after — plus one evidence JSON naming every organisation considered     |

**Why a script and not an operation, measured rather than preferred.** The only application-layer
policy admitting the platform role to `iam.role_permissions` is
`ins_role_permissions_platform_bootstrap` (`20260831093000`), whose `WITH CHECK` requires
`org.tenants.status = 'provisioning'`. Every organisation this backfill exists for is `active`, and
the table is `FORCE ROW LEVEL SECURITY`. A route would therefore be **refused by the database**, and
publishing one would require a migration widening that policy — permanently opening the bootstrap
insert path to non-provisioning tenants, a standing escalation surface bought to perform a one-off
correction. The repository already has the shape for exactly this case in
`scripts/platform/genesis-platform-operator.mjs`: an operator act on a privileged connection,
deployment infrastructure rather than an application route. This is its sibling, and **no migration
is added**. The claim is falsifiable: **BF-9** reads the policy out of `pg_policies` and the tenant
status out of `org.tenants` rather than asserting either.

## 18. Dispositions

| id        | finding                                                                         | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | owner / slice | status |
| --------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------ |
| **CC-11** | the backfill is an OPERATOR ACT on a privileged connection, not a product route | The brief's own preference was an operation or a script, whichever the repository already patterns. Both were examined against the schema. `ins_role_permissions_platform_bootstrap` admits the platform role only while the tenant is `provisioning`; every target is `active`; `iam.role_permissions` is `FORCE ROW LEVEL SECURITY`, so even the table owner is bound. Only a `BYPASSRLS` connection can write these rows today. Against that, `platform.organization-provision` writes the identical 74 mappings, so the AUTHORITY already exists and only the reachable path does not | **script, deliberately, and no migration.** The alternative was a migration widening the bootstrap insert policy to non-provisioning tenants — a permanent escalation surface, reachable by every future holder of the platform code, bought to perform a correction that runs once per widening. The script leaves no new operation, no new permission, no new policy and no new route in the product. **Consequence, accepted:** the backfill is not self-service — it requires an operator with a privileged connection, exactly as the platform genesis does. That is the same constraint the repository already lives with for `iam.platform_grants`, and it is the reason this row exists rather than a route | this slice    | closed |

## 19. What this slice did NOT do

- **Nothing was revoked, from anyone.** The tool issues no `DELETE`, `UPDATE`, `TRUNCATE` or
  `REVOKE`; **BF-8** reads every SQL statement out of the file and refuses each of those verbs, and
  **BF-1** compares mapping rows BY ID before and after, so a row that vanished would turn it red.
- **No migration was added**, and section 17 states the measurement that shows one is not required.
- **No permission was minted.** The authority gate names `platform.organization.provision`, which is
  already a catalogue row; **BF-6** asserts the catalogue holds exactly one.
- **The bundle was not widened.** The tool widens only TO `TENANT_ADMINISTRATOR_ROLE.permissionCodes`
  and never past it. `bootstrap-roles.ts` is unchanged, so the deliberate exclusions of **CC-01**,
  **CC-02** and **CC-04** are as excluded after the backfill as before it — `rpt.export` was not
  granted to a single organisation.
- **No second copy of the bundle was written.** The list is PARSED out of `bootstrap-roles.ts` with
  the repository's own TypeScript parser (`scripts/lib/typescript-source.mjs`), and **BF-7** asserts
  the parsed list equals the imported constant, so a backfill widening to a stale list is impossible.
- **No role but the tenant administrator was touched**, and no organisation without one was given
  one. **BF-3b** builds a tenant-owned role and asserts its mappings are unchanged.
- **No screen was touched.** This is the `p1-31-backend` lane; `apps/web` is unchanged.
- **No canonical task was closed.** D-2 is an Owner decision, not one of the 29, and prerequisites
  **P-8** … **P-16** are untouched.

## 20. Proof

`tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts`, 12 cases on real rows, against
organisations the suite provisions through the shipped provisioning route and drops afterwards. The
stale state is constructed by removing exactly the seven codes the two P1-31 widenings added, which
reproduces the 67-code bundle the real organisations held.

| case      | proves                                                                                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BF-1**  | a stale organisation gains exactly the seven and no others; the role then equals the bundle; every pre-existing mapping row survives BY ID; the audit record names the codes added                                                                         |
| **BF-2**  | a second run reports `unchanged`, writes no row, and appends no second audit record                                                                                                                                                                        |
| **BF-3**  | a customised role keeps an allow BEYOND the bundle (`rpt.export`) and keeps its own `deny` on a bundle code, which is reported as `blockedByDeny` and still reads `deny` afterwards                                                                        |
| **BF-3b** | a role the tenant built for itself is untouched, row for row                                                                                                                                                                                               |
| **BF-4**  | the Owner of a stale organisation is refused `GET /warranties` and `GET /warranties/{warrantyId}` with `ERR-IAM-001` and `requiredPermissions = ["wty.warranty.read"]`, and after the backfill lists 200 and reads past the gate — **CC-08** measured back |
| **BF-5**  | a second stale organisation is unchanged row for row and gains no audit record when the first two are backfilled                                                                                                                                           |
| **BF-5b** | a sweep names every organisation it considered, including the ones it skipped, and creates no role for a tenant that has none                                                                                                                              |
| **BF-6**  | an account without `platform.organization.provision` is refused (exit 4), an absent account is refused, nothing moves, and the gated code is an existing catalogue row                                                                                     |
| **BF-7**  | the parsed bundle equals `TENANT_ADMINISTRATOR_ROLE.permissionCodes` exactly, contains the seven, and does not contain `rpt.export`                                                                                                                        |
| **BF-8**  | every SQL statement in the file is free of `DELETE`, `UPDATE`, `TRUNCATE` and `REVOKE`, and its only mapping write is an `allow` insert                                                                                                                    |
| **BF-8b** | a dry run leaves the mapping rows and the audit count exactly as it found them                                                                                                                                                                             |
| **BF-9**  | `ins_role_permissions_platform_bootstrap` requires `provisioning`, the target tenant is `active`, and `iam.role_permissions` forces RLS — the measurement behind "script, not route"                                                                       |

### Applied to the shared acceptance environment

Run on 2026-09-08 by `platform.operator@rootlco.local`, `--all`, dry run first and then applied:
**25 organisations considered, 24 widened, 1 skipped** (`platform_operators`, which holds no
`tenant_administrator` role). The six acceptance organisations moved
`acceptance_workshop` 44 → 74, `rootlco_workshop` 46 → 74, `rootlco_final` / `rootlco_w7` /
`rootlco_w7b` 48 → 74 and `p30_acceptance_ac0zif` 65 → 74; the eighteen `p30_journey_*` organisations
moved 67 → 74. A second `--all` run immediately afterwards reported **0 widened, 24 already current**
— idempotency on the real rows rather than only in the suite.

---

# The delivery navigation gate — P-8 (RES-05)

Sections 21–23 were added by the **P-8** slice on 2026-09-09; identifiers continue in the same
P1-31 namespace, so the register now runs **CC-01 … CC-12**. **Baseline:** protected `develop`
`f4309a8e`, `main` `1262de74` — untouched. This slice is Frontend, tooling and documentation only:
it adds no operation, no route, no permission, no seed row and no migration.

## 21. What changed

`apps/web/src/config/navigation.ts` gated `/delivery` on **`sal.delivery.read`**, a code the
catalogue does not contain — the second and last entry of the permission-parity gate's open-debt
register, and the finding A0 carries as **RES-05** / **P-8**. The entry now gates on
**`sal.delivery.view`**, and stays `status: 'planned'` because the screen itself is FE-001.

The rule applied is the one the permission-reuse register states and the billing entry already
follows: where an executable reference names a `.read` code the catalogue never seeded, the
**reference is corrected** and the code is not minted. `sal.delivery.view` is not a substitute
chosen for convenience — it is the code every shipped delivery read declares, and WFP-15's entry
criterion names it. Decision **D-9** is therefore answered for the delivery half by precedent, and
recorded as such in `a0-preflight.md`; its warranty half was already answered by P-7's minted
`wty.warranty.read`.

Two consequences travel in the same commit, because the gate fails closed when a registered entry
stops reproducing:

- `scripts/ci/check-permission-parity.mjs` — `KNOWN_UNCATALOGUED` is now **empty**, with the
  delivery entry's departure recorded in the comment beside the `sal.invoice.read` note that
  preceded it. The mechanism, the floors and every other list are untouched, and a NEW uncatalogued
  reference still fails hard.
- `apps/web/tests/navigation.test.ts` — the catalogue assertion was scoped to the `administration`
  group and compared against a **transcribed** set of seven codes, so it was green over a defect in
  another group. That is the false green A0 records on the P-8 row. It now reads
  `supabase/seeds/04_iam_permission_catalog.sql` itself and asserts every gated entry in every
  group, `planned` ones included. The `it` block was widened rather than duplicated, so the web
  tier's test count does not move.

## 22. Dispositions

| id        | finding                                                              | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | disposition                                                                                                                                                                                                                                                                                                                                                                                       | owner / slice | status |
| --------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------ |
| **CC-12** | two Backend docblocks still say navigation names `sal.delivery.read` | `apps/api/src/app/api/v1/deliveries/[deliveryId]/route.ts:39` and `apps/api/src/app/api/v1/work-orders/[workOrderId]/delivery/route.ts:44` describe the navigation gate as it was before this slice. They are prose in `apps/api`, which the `p1-31-frontend` ownership profile does not admit — the `apiSource` bucket is Backend-owned, and a Frontend branch that edited them would be refused by `check-phase-ownership.mjs` for a reason the tooling is right about: a Frontend lane must not carry API source | **deferred, deliberately, and named rather than left to be discovered.** No behaviour depends on either sentence — both routes declare their permissions in `defineOperation`, and the parity gate reads declarations, not comments. The correction belongs to the documentation lane **P-13 / P-14** already open for stale source prose in `apps/api`, which owns the profile that can carry it | P-13 / P-14   | open   |

## 23. What this slice did NOT do

- **No grant was broadened.** No seed row, no bundle change, no role, no policy. A principal that
  could see the delivery entry before this commit could see it only by holding a code that exists in
  no catalogue — that is, no principal could. After it, the entry is visible to a holder of
  `sal.delivery.view`, which is exactly the audience the delivery reads already answer.
- **No screen was built and no entry became available.** `/delivery` is still `planned`; the
  `planned` assertion in the same test is unchanged, and FE-001 remains ahead.
- **No permission was minted.** P-7 is the phase's only shipping insert into `iam.permissions`, and
  this slice does not join it.
- **The parity gate's mechanism was not touched** — only its data. Emptying the register is a
  measurement of the repository, not a widening of an allowance.

### Proof

| id       | what was shown                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P8-1** | every navigation `permission` in every group — 26 distinct codes — is present in the catalogue seed; before the change exactly one, `sal.delivery.read`, was not |
| **P8-2** | `validate:permission-parity` passes with an EMPTY debt register, which the gate itself would refuse if the removed entry still reproduced                        |
| **P8-3** | the widened assertion reads the seed file itself (119 codes parsed) rather than a transcription of it, so no copied list can drift away from the catalogue       |
| **P8-4** | the unit tier stays at 3264 tests and the web tier at 3552 — the false green was closed by widening an assertion, not by adding one                              |

---

## 29. What P-10 changed — the warranty policy and coverage seam (PPD-04)

**Slice:** `remediation/p1-31-backend-warranty-policy-seam`, ownership profile `p1-31-backend`.
**Baseline:** protected `develop` **99dc6f41**, which is an ancestor of the current tip.

**The numbering here is PROVISIONAL and assumes a merge order.** Two lanes are open ahead of this
one: the documentation-corrections slice (**#354**, section 24, **CC-13**), which is already on
`develop`, and the P-9 checklist-template seam (**#355**, sections 25–28, **CC-14**), which is
not. This section is written as **29** and its dispositions as **CC-15 … CC-18** on the assumption
that both land first, and it is re-checked against `develop` before merge — exactly as #355's own
section was renumbered when #354 took CC-13.

The full record is [`warranty-policy-seam.md`](./warranty-policy-seam.md). In short:

- **PPD-04 is closed by seven operations.** `wty.warranty_policies` and `wty.warranty_coverage`
  carried `INSERT` and `UPDATE` grants and policies from P1-11 and had **no writer anywhere in
  `apps/api/src`**, so `resolvePolicy` refused every company that had no active policy and
  nothing could create one: a tenant provisioned through the product could never issue a warranty
  at all. Two reads declare `wty.warranty.read`; five writes declare `wty.policy.manage`.
- **`wty.policy.manage` is declared for the first time.** It has been a seeded catalogue row since
  P1-08, named by no operation and by no policy predicate. **Nothing was minted**: no seed row, no
  migration, no new code.
- **CC-01 is closed on its own terms, and the bundle moves 74 → 75.** CC-01 withheld the code
  BECAUSE nothing declared it, and stated the rule for lifting it — "the slice that publishes them
  owns the widening", the `inv.item.manage` sequence of #322. Five operations now declare it.
  `rpt.report.configure` stays excluded on CC-02's unchanged grounds and `rpt.export` on CC-04's
  Owner decision, so **TWO** deliberate exclusions remain rather than three.
- **The widening obliges an operator act after merge**, recorded as **CC-16** below.

### 29.1 What was published, and what was minted

| published                                                                           | minted  |
| ----------------------------------------------------------------------------------- | ------- |
| 7 operations, 5 route modules, 5 paths, 5 audit actions, 1 application service      | nothing |
| register 382 → **389** operations, 299 → **304** paths, 216 → **221** audit actions | nothing |
| bundle 74 → **75** codes, all of them pre-existing catalogue rows                   | nothing |

### 29.2 Dispositions

| id        | finding                                                                                                                   | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | owner / slice         | status |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------ |
| **CC-15** | the coverage URL segment is `coverage-windows`, because a directory named `coverage` cannot be tracked                    | `.gitignore:45` carries the root-unanchored rule `coverage/`, which git applies at EVERY depth. A route directory at `apps/api/src/app/api/v1/warranty-policies/[policyId]/coverage/` is therefore skipped by `git add` in silence — measured rather than predicted: the first staging of this slice tracked three of its five route modules, and `check-api-backend-only.mjs` reported 303 handlers where 305 exist. Untracked files are invisible to every gate that enumerates through `git ls-files`, which is the encoding gate, both secret scanners, the scope-exclusion guard and the no-fake-data guard           | **renamed, deliberately, rather than excepted.** The alternative was a negation entry in `.gitignore` for one source directory: a config exception every future reader has to be told about, sitting one edit away from re-ignoring real coverage output. `coverage-windows` is the phrase the module prose already uses for an effective-dated row, so the URL and the docblocks agree and nothing has to be explained. **Consequence, accepted and named:** the published path is `/warranty-policies/{policyId}/coverage-windows`, and FE-008 / FE-009 must be built against it                                                                                                                                        | this slice            | closed |
| **CC-16** | organisations provisioned BEFORE this slice cannot administer warranty policies, and cannot delegate the authority either | The bundle is written ONCE, inside `platform.organization-provision`, and nothing re-applies it. Every organisation provisioned on the 48-, 65-, 67-, 73- or 74-code bundle holds no `wty.policy.manage`, so from this commit its administrator is refused all five new writes with `ERR-IAM-001`, and `ins_role_permissions_delegable` admits a mapping only when the acting administrator already holds the code. This is **CC-03** and **CC-08** restated for a third widening — and unlike CC-08 it WITHHOLDS something new rather than withdrawing something old, because the five operations did not exist yesterday | **accepted, with the remedy named and NOT performed here.** `scripts/platform/backfill-tenant-administrator-bundle.mjs`, built for **CC-11**, parses `bootstrap-roles.ts` at run time and therefore needs no edit to carry this code; `tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts` moved its eight-code list with the reason. It is an OPERATOR ACT on a privileged connection — `iam.role_permissions` is `FORCE ROW LEVEL SECURITY` and `ins_role_permissions_platform_bootstrap` admits the platform role only while the tenant is `provisioning` — so it requires a run against each environment **after this branch merges**. This slice did not run it and does not claim it was run anywhere | operator, after merge | open   |
| **CC-17** | the coverage status command is version-guarded and NOT idempotent, alone among the five writes                            | `ex_warranty_coverage_no_overlap` is PARTIAL on `status = active`, so an archived window sits outside it and its days may be re-covered while it is archived. Reactivating it then raises `23P01`. No status command in the P-9 precedent can fail that way, so that precedent declares BOTH guards on its own status route and this one cannot follow it                                                                                                                                                                                                                                                                  | **accepted, and the divergence from the precedent recorded rather than left to look like an oversight.** An idempotency reservation replays a STORED result: a second submission would be handed a success computed before the replacement row existed, which is the one outcome a caller must not receive here. The version guard already makes a duplicate submission safe — the second one loses on `record_version`. The suite proves the sequence on real rows and asserts the archived row unchanged after a refused reactivation, so a refused reactivation burns no version                                                                                                                                       | this slice            | closed |
| **CC-18** | the coverage CHECK constraints are unreachable through the published routes, so their error mapping is untested           | `ck_warranty_coverage_scope`, `ck_warranty_coverage_duration`, `ck_warranty_coverage_odometer` and `ck_warranty_coverage_effective` are each mirrored by the request schema, so no request that reaches the database can violate one. `WarrantyPolicyService` maps `23514` to `ERR-VAL-001` by reading the violated constraint NAME, on the `INVOICE_UNIQUE_INDEX` pattern, and nothing reachable through the routes can exercise it                                                                                                                                                                                       | **kept, and declared untested rather than removed or claimed.** Removing it would leave a `23514` surfacing as `ERR-SYS-001` — a 500 telling a caller its request broke the server when the server in fact refused it — on the day the boundary and a column disagree, which is exactly when it is needed. The suite asserts the BOUNDARY refusal for each of the four values, and the suite header states in terms that the mapping is NOT claimed to have been exercised. Reaching it would need a test calling the repository beneath the route, which asserts nothing about the published surface                                                                                                                     | this slice            | closed |

### 29.3 What this slice did NOT do

- **No migration and no schema change.** Both tables, both RLS policy sets and every grant are
  exactly as P1-11 left them; the statements use grants that already existed.
- **No permission was minted and no seed changed.** `wty.policy.manage` was already a catalogue
  row, and this slice is the first thing to declare it.
- **No coverage edit was published.** `tg_warranty_coverage_immutable` freezes `policy_id` and
  `effective_from`, and re-closing `effective_to` in place would restate terms a customer is
  already bound to — archive and add is the model, and the alternative needs a decision about
  already-issued warranties that this prerequisite does not sanction.
- **No removal of any kind.** `deleted_at` exists on both tables and this surface never sets it;
  retirement is `status = 'archived'`, the column the issue path already reads.
- **No warranty record was written, read or changed.** `wty.warranty_record_status_history` still
  has no reader (**CC-10**, unchanged), and no claim surface exists (**P1-22-L-01**, unchanged).
- **The backfill was not run**, and no claim is made that any environment carries the new code.
- **`apps/web/src` was not edited** except through `lib/api/idempotent-operations.ts`, which a
  repository script regenerates and which every published operation moves.
- **No allow-list was widened and no gate was suppressed.** `check-p1-30-payload-parity.mjs` does
  not hold `wty` writes to a mirror at all — `P1_30_DOMAINS` is `svc`, `quo`, `inv`, `sal` —
  so no `PENDING` entry was added: declaring one would be a claim about a gate that does not look
  here.

### 29.4 Proof

| id        | what was shown                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P10-1** | `tests/backend/p1-31-warranty-policy-seam.test.ts` — **31 cases**, every policy and coverage row authored THROUGH THE ROUTES, with no admin SQL seeding of either table                                |
| **P10-2** | the closure end to end in `COMPANY_A9`: refused as unconfigured, authored, issued with the very terms authored, archived, refused again — and a named archived policy refused differently, ERR-TRN-001 |
| **P10-3** | company-wide authority from three sides — a branch-scoped holder refused every write while still reading; a company-scoped holder admitted in its company and refused in another                       |
| **P10-4** | the overlap invariant in all three limbs, including a refused reactivation leaving the archived row's version untouched                                                                                |
| **P10-5** | the bundle delta is exactly one code, measured against the generated P1-24 register: zero declarers for what stays excluded, more than zero for every added code                                       |
