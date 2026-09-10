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
P1-31 namespace, so the register now runs **CC-01 … CC-20**. **Baseline:** protected `develop`
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

## 24. The documentation-corrections slice — prerequisites P-13 and P-14

Added on 2026-09-09 by `remediation/p1-31-backend-documentation-corrections`, on the
`p1-31-backend` lane. It changes comments and records only: **no behaviour changed, no operation was
declared, widened or withdrawn, no permission code was minted, granted or revoked, and no migration,
seed, policy or grant was touched.**

**P-13 — four rows of [`operation-inventory.md`](../phase-1-22/operation-inventory.md) corrected**
against the `defineOperation(...).permissions` of the routes themselves, each cross-checked against
the generated `docs/phase-1/phase-1-22/evidence/endpoint-inventory.md`:

| operation                       | the inventory said                          | the route declares                                               |
| ------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `sal.delivery-eligibility-read` | `sal.delivery.manage`, `sal.finance.view`   | `sal.delivery.view`, `sal.finance.view`                          |
| `sal.delivery-receiver-verify`  | `sal.delivery.manage`                       | `sal.delivery.manage`, `sal.delivery.view`                       |
| `sal.delivery-signature-attach` | `sal.delivery.manage`                       | `sal.delivery.manage`, `sal.delivery.view`                       |
| `sal.delivery-complete`         | `sal.delivery.complete`, `sal.finance.view` | `sal.delivery.complete`, `sal.delivery.view`, `sal.finance.view` |

The table's other two rows — `sal.delivery-create` and `sal.delivery-checklist-record` — already
agreed with the code and were left alone, and so was the paragraph beneath the table: it says only
that the eligibility read and the completion both require `sal.finance.view` "in addition to their
delivery authority", which is as true after the correction as before it, so there was no stale prose
to rewrite.

**P-14 — the retrievability claim corrected in every LIVE copy.** The `P1-22-L-04` section of
`apps/api/src/app/api/v1/deliveries/[deliveryId]/signatures/route.ts`, the
`sal.delivery.signature_recorded` description in `apps/api/src/server/auth/audit-actions.ts` and the
"No signature retrieval" bullet of the P1-22 operation inventory each asserted that no application
path could move a document version to `accepted`. Each now quotes `AttachmentService.requestDownload`
rather than paraphrasing it, and the measurement behind the correction is
`supabase/migrations/20260815090000_shared_reception_evidence_foundation.sql`, which adds
`ins_file_scan_results_scanner`, `upd_document_versions_lifecycle`, `GRANT INSERT ON
shared.file_scan_results` and `GRANT UPDATE(status) ON shared.document_versions`. A grep afterwards
found eight further live copies of the same claim — the signature-LIST docblock in that route file,
`modules/delivery/{index.ts, data/delivery-repository.ts, application/delivery-read-service.ts,
application/delivery-service.ts (twice)}` and the two `note:` strings for
`sal.delivery-signature-list` and `sal.delivery-signature-attach` in
`scripts/check-operation-test-coverage.mjs` — and all of them were corrected in this same pull
request, to the same framing and with no behaviour change (**CC-13**).
`docs/phase-1/phase-1-22/contract-archaeology.md` and `docs/phase-1/phase-1-22/blocker-treatment.md`
are **deliberately untouched**: they are historical P1-22 records of what was measured then, and
editing them would rewrite a finding rather than correct a claim.

**The P-8 deferral.** The two delivery-read docblocks that explain why they do not declare
`sal.delivery.read` — `deliveries/[deliveryId]/route.ts` and
`work-orders/[workOrderId]/delivery/route.ts` — now record that P1-31 prerequisite P-8 re-points the
navigation entry at `sal.delivery.view` (**RES-05**), with the surrounding rationale kept. This
branch therefore merges AFTER the P-8 pull request.

| id        | finding                                                                                                                | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | owner / slice     | status |
| --------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| **CC-13** | the corrected retrievability claim survived in six further LIVE source docblocks and two gate-register `note:` strings | P-14 was scoped to five copies of `P1-22-L-04`. A grep over the tree returned more: besides the three live copies corrected first and the two historical records left as written, the same "no scanner is provisioned / acceptance is unreachable" assertion appeared in the signature-LIST docblock of the SAME route file, in `modules/delivery/{application/delivery-read-service.ts, application/delivery-service.ts (twice), data/delivery-repository.ts, index.ts}`, and in the `sal.delivery-signature-list` and `sal.delivery-signature-attach` `note:` strings of `scripts/check-operation-test-coverage.mjs` | **closed — all eight were corrected in THIS pull request**, in a follow-up commit, comment-and-string only with no behaviour change, each restating the same corrected framing as the route: a bound version is refused with `ERR-DOC-001` while it is not `accepted`, which is a state check rather than an impossibility, and the module offering no retrieval path is a scope statement. The two `note:` strings keep their coverage purpose and lost only the false factual clause; `validate:operation-coverage` was re-run. The two historical P1-22 records remain untouched for the reason given above | P-14, this branch | closed |

**One further live copy sits in an Owner document, and was left to the Owner.** The same stale
retrievability claim is still asserted in `docs/product/workshop/reception-media-checklist.md` —
the state table at lines ~205–206, which calls the `Accepted` state "Unreachable", the sentence
beneath it describing the best reachable state as "registered, pending, never downloadable", and
§5.3, whose heading states the same thing. It was **not** edited on this branch: product workshop
documents under `docs/product/` are Owner-input, and this lane corrects source docblocks and phase
records only. The Owner is asked either to correct that passage or to authorise the correction on a
later lane.

**Identifier note:** **CC-13** is this slice's id. `develop` now holds **CC-01 … CC-12** in this
register, `CC-12` having been taken by the merged P-8 slice, so this slice continues the sequence
at **CC-13**.

---

---

# P-9 — the delivery checklist template seam, of 2026-09-09

Sections 25-28 were added by the **P-9** slice on 2026-09-09; its identifier is **CC-14**.
`develop` holds **CC-01 … CC-13**, `CC-12` having been taken by the P-8 slice and `CC-13` by the
documentation-corrections slice, so this slice continues the sequence at **CC-14**.
**Baseline:** protected `develop` `f4309a8e` (PR #350, the D-2 bundle backfill), `main` `1262de74` —
untouched.

## 25. What was published

Eight operations under `/api/v1/delivery-checklist-templates`, closing **PPD-12**: the checklist
template and template-item tables carried INSERT and UPDATE grants and policies from P1-11 and **no
code anywhere in `apps/api/src` had ever written either one**, so a tenant provisioned through the
product had an empty handover checklist and no way to fill it.

| operation                                     | method | path                                         | guards                         |
| --------------------------------------------- | ------ | -------------------------------------------- | ------------------------------ |
| `sal.delivery-checklist-template-list`        | GET    | `/delivery-checklist-templates`              | paged                          |
| `sal.delivery-checklist-template-read`        | GET    | `/delivery-checklist-templates/{templateId}` | -                              |
| `sal.delivery-checklist-template-create`      | POST   | `/delivery-checklist-templates`              | `idempotent`, 201              |
| `sal.delivery-checklist-template-rename`      | PATCH  | `/delivery-checklist-templates/{templateId}` | `versionGuarded`               |
| `sal.delivery-checklist-template-status-set`  | POST   | `.../{templateId}/status`                    | `idempotent`, `versionGuarded` |
| `sal.delivery-checklist-template-item-create` | POST   | `.../{templateId}/items`                     | `idempotent`, 201              |
| `sal.delivery-checklist-template-item-update` | PATCH  | `.../{templateId}/items/{itemId}`            | `versionGuarded`               |
| `sal.delivery-checklist-template-item-remove` | DELETE | `.../{templateId}/items/{itemId}`            | soft delete                    |

Reads declare `sal.delivery.view`, commands `sal.delivery.manage` - both already seeded and both
already in the provisioning bundle through P-1. **No permission was minted, no seed changed, no
bundle changed, and no migration was added.** The register moves **382 -> 390** operations,
**299 -> 304** paths, **216 -> 222** audit actions. Full record:
[`delivery-checklist-template-seam.md`](./delivery-checklist-template-seam.md).

## 26. Dispositions

| id        | finding                                                                                   | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | owner / slice                                            | status |
| --------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------ |
| **CC-14** | an **INACTIVE** checklist template still blocks a handover, and this slice did not fix it | `sal.complete_delivery` (`supabase/migrations/20260724094000_sal_delivery.sql`, section 8) counts mandatory items with `ti.company_id = ... AND ti.is_mandatory AND ti.deleted_at IS NULL`. It never joins `sal.delivery_checklist_templates` and reads no template `status`, so deactivating a template leaves its mandatory items gating every delivery in that company. The application mirror in `DeliveryRepository.mandatoryChecklistGaps` reproduces the primitive exactly, including this. Proved on real rows in `COMPANY_A9`: an inactive template's mandatory item produces `checklist_incomplete` naming the item | **open, and deliberately NOT mirrored away.** Filtering inactive templates in the mirror alone would report a delivery ELIGIBLE that the primitive then refuses inside the transaction, which is the failure the repository's own rule about mirrors exists to prevent. Correcting the behaviour means replacing a protected function - a forward migration - which this prerequisite does not sanction and which the shared acceptance database could not receive without a migration run. **The operator remedy that works today is published by this slice:** the item-withdrawal route sets exactly the column the primitive filters on, and the suite proves the blocker clears | a later `sal` migration slice, with P1-22 under Field 13 | open   |

## 27. What this slice did NOT do

- **No permission was minted and no bundle changed.** Both codes are seeded and both are already in
  the tenant administrator bundle; the count stays at 74.
- **No migration, and no schema change of any kind.** Every statement uses a grant and a policy that
  have existed since P1-11.
- **No screen.** `apps/web` is unchanged except through the GENERATED idempotency manifest, which
  every published operation moves. The request-payload mirror for the five body-carrying writes is
  owed by the `p1-31-frontend` lane that builds FE-004; they are declared `PENDING` in
  `scripts/ci/check-p1-30-payload-parity.mjs`, whose lifecycle fails the moment a mirror exists and
  the entry is not deleted.
- **No delivery write path, eligibility rule, state machine or gate behaviour changed.** The
  eligibility mirror is byte-for-byte as it was; CC-14 records why.
- **P1-27-INT-088 is not closed.** The GAP side keeps all three limbs. What changed is that a caller
  can now resolve a `template_item_id` to a code and a label, which is the half of **CC-06** the
  read seam said it could not supply.
- **No canonical task was closed.** P-9 is an execution prerequisite; the 29 remain 29.

## 28. Proof

`tests/backend/p1-31-delivery-checklist-template-seam.test.ts`, **27 cases on real rows**, every one
of which authors what it reads **through the published routes** - unlike every suite before it, this
one seeds neither checklist table by admin SQL, because that seeding is the measurement PPD-12
records.

| case group             | proves                                                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| registrations          | the eight ids, their permissions, `scope`, audit class and each guard flag - and that the withdrawal is deliberately not version-guarded                                                                                                                                      |
| create                 | header and items in one transaction; duplicate template code 409; a body repeating an item code refused with NOTHING written; a company outside the tenant refused by the FK; `status` and `id` unexpressible; replay under one key creates one template and one audit record |
| reads                  | detail in checklist order to `SAL_READER`, which holds no manage code; list paged and the two pages disjoint; a caller without `sal.delivery.view` refused both; another tenant 404                                                                                           |
| company-wide authority | `SAL_SCOPED_A2` (branch-scoped) refused every write and still able to READ; `SAL_COMPANY_SCOPED` admitted in `COMPANY_A1` and refused in `COMPANY_A9`; a reader refused all six commands; a foreign tenant 404 on a write                                                     |
| version guards         | `If-Match` absent 428, stale 409 with the row unchanged, success advancing the version by exactly one; the ITEM version is not the template's; a one-field patch leaves the others untouched                                                                                  |
| withdrawal             | soft delete with the row still present, the item gone from the detail read, the code re-addable, and a second withdrawal answering the uniform 404                                                                                                                            |
| **the gate**           | an inactive template's mandatory item still produces `checklist_incomplete` naming the item, and withdrawing the item clears it - **CC-14**, measured rather than argued                                                                                                      |

---

## 29. What P-10 changed — the warranty policy and coverage seam (PPD-04)

**Slice:** `remediation/p1-31-backend-warranty-policy-seam`, ownership profile `p1-31-backend`.
**Baseline:** protected `develop` **5cd06fbd**, merged into this branch, which carries the
documentation-corrections slice (**#354**, section 24, **CC-13**) and the P-9 checklist-template
seam (**#355**, sections 25–28, **CC-14**).

Both lanes that were open ahead of this one have landed, so the numbering is settled rather than
assumed: `develop` holds sections 1–28 and **CC-01 … CC-14**, and this section continues at **29**
with its dispositions at **CC-15 … CC-18**.

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
| register 390 → **397** operations, 304 → **309** paths, 222 → **227** audit actions | nothing |
| bundle 74 → **75** codes, all of them pre-existing catalogue rows                   | nothing |

### 29.2 Dispositions

| id        | finding                                                                                                                   | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | owner / slice         | status |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------ |
| **CC-15** | the coverage URL segment is `coverage-windows`, because a directory named `coverage` cannot be tracked                    | `.gitignore:45` carries the root-unanchored rule `coverage/`, which git applies at EVERY depth. A route directory at `apps/api/src/app/api/v1/warranty-policies/[policyId]/coverage/` is therefore skipped by `git add` in silence — measured rather than predicted: the first staging of this slice tracked three of its five route modules, and `check-api-backend-only.mjs` reported 303 handlers where 305 then existed. Untracked files are invisible to every gate that enumerates through `git ls-files`, which is the encoding gate, both secret scanners, the scope-exclusion guard and the no-fake-data guard    | **renamed, deliberately, rather than excepted.** The alternative was a negation entry in `.gitignore` for one source directory: a config exception every future reader has to be told about, sitting one edit away from re-ignoring real coverage output. `coverage-windows` is the phrase the module prose already uses for an effective-dated row, so the URL and the docblocks agree and nothing has to be explained. **Consequence, accepted and named:** the published path is `/warranty-policies/{policyId}/coverage-windows`, and FE-008 / FE-009 must be built against it                                                                                                                                        | this slice            | closed |
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

---

# The delivery detail screen and the P-16 gate

Sections 30–33 were added by the **delivery detail screen** slice on 2026-09-09; identifiers
continue in the same P1-31 namespace. **Baseline:** protected `develop` `0272390b`, `main`
`1262de74` — untouched. `develop` now holds sections 1–29 and **CC-01 … CC-18**: sections 25–28
and **CC-14** belong to the P-9 checklist-template seam, and section 29 with **CC-15 … CC-18** to
the P-10 warranty-policy seam, both of which merged after this branch was cut. This slice
therefore continues at section 30 and at **CC-19**. This slice is Frontend, tooling, tests and
documentation only: it adds no operation, no route, no permission, no seed row, no migration, and
**no write of any kind**.

## 30. What was delivered

The first P1-31 screen: `/delivery/{deliveryId}`, a read-only view of one vehicle handover, built on
the six reads the P-2 … P-5 seam published plus the work-order lookup.

| panel                   | read                                 | what it shows                                                                         |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Summary                 | `sal.delivery-read` (on the page)    | stage, handover moment, a link to the work order, and four labelled identifiers       |
| Release checks (FE-002) | `sal.delivery-eligibility-read`      | whether the vehicle may be released, every reason it may not, and every composed fact |
| Receiver (FE-003)       | `sal.delivery-receiver-read`         | the confirmed receiver, or the fact that there is none yet                            |
| Signatures (FE-006)     | `sal.delivery-signature-list`        | role, moment, and the statement that the image is on file                             |
| Checklist results       | `sal.delivery-checklist-result-list` | recorded results only, with a waiver's reason beside its outcome                      |
| History (FE-007)        | `sal.delivery-status-history`        | the append-only transition ledger, read for the first time by any screen              |

A section on the work-order detail screen reads `sal.work-order-delivery-read` and either states
that no handover exists or links to it. It is rendered only when the caller holds
`sal.delivery.view`, so a caller without it issues no request at all.

## 31. The five properties this slice is accountable for

**The page decides before it reads.** `sal.delivery.view` is tested and returned on before
`readDelivery` is called. The proof is mechanical in two places: `check-p1-31-access.mjs` (P-16)
judges the page's source, and `apps/web/tests/delivery.dom.test.tsx` invokes the route with a
session that holds the financial and completion codes but NOT the delivery code, and requires both
that the refusal renders and that every one of the six adapters is untouched.

**The financial rule is respected rather than discovered.** `sal.delivery-eligibility-read` declares
`sal.finance.view` in addition to `sal.delivery.view` and answers 403 without it. The page resolves
that code and passes it down; the release-checks panel renders a scoped refusal and **issues no
request**. Asking and rendering the refusal would put a denial in the backend's log for a decision
the screen could make. The rest of the handover still renders, which is why the refusal is scoped to
the panel rather than to the page.

**"Could not be checked" is not "failed".** Five of the eight blocking reasons exist only because
the application composes them, and each composed fact fails closed — a fact that could not be read
counts as blocking. Rendering that as an observation would send an operator to chase a customer over
a platform outage. Each fact is therefore drawn by its `established` flag, and the unreadable ones
carry the source reference support needs.

**Two references are sensitive and stay references.** The receiver's identity-evidence reference and
each signature's document reference are named as "on file" and never printed, never linked and never
fetched. The rendering test asserts that neither identifier appears anywhere in the rendered
document.

**No money crosses.** Not one delivery read carries an amount: `financial_balance_outstanding` is a
code and `finalOdometerReadingId` is a reference to a reading rather than a reading. This feature
therefore adds **no** area to the server-arithmetic gate; the first money-bearing P1-31 screen adds
one, and that is a condition on that screen rather than a gap in this one.

## 32. Dispositions

| id        | finding                                                                                               | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | owner / slice | status |
| --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------ |
| **CC-19** | the P1-31 read seam had no consumer, and no gate judged a page under the singular `/delivery` segment | Six delivery reads and the work-order lookup were published by P-2 … P-5 and called by nothing, which is the _declared but never wired_ shape this programme's own archaeology names as its dominant defect class. Separately, the P1-30 gate-before-read check derives `deliveries` from the register while the committed navigation href is `/delivery`, so the first P1-31 screen would have been judged by no gate at all (**A0 DO-001**, **D-15**) | **closed by this slice.** FE-002 release checks, FE-003 authorized receiver, FE-006 signatures, the FE-004 **results** list and the FE-007 status ledger are delivered as the delivery detail screen, with an entry section on the work-order detail. **P-16** ships as `scripts/ci/check-p1-31-access.mjs`, a sibling of the P1-29 and P1-30 checks scoped by an explicit allow-list of P1-31 operation ids and by the named dashboard areas `delivery`, `warranty`, `reports`; it is wired into `verify:policies` and the command-coverage registry, and mutation-proved by `tests/ci/p1-31-access-gate.test.ts`. **D-15** is answered by precedent. **No grant changed, and no write shipped** | this slice    | closed |

**Identifier note.** **CC-19** is this slice’s id. This branch was cut at `develop` `0272390b`,
which carried **CC-01 … CC-13**; the P-9 slice then merged and took **CC-14**, and the P-10
warranty-policy slice merged and took **CC-15 … CC-18** in its section 29. The number and the
section range were re-checked against `develop` when this branch was brought up to date, and both
have moved: this slice is **CC-19** at sections 30–33.

## 33. What this slice did NOT do

- **No write.** Creating a delivery, confirming a receiver, recording a checklist result, attaching
  a signature and completing a handover are separate tasks with their own authority. No adapter, no
  form and no button for any of them exists in this slice, and `apps/web/tests/delivery-api.test.ts`
  asserts that the transport's write path is never called.
- **No list screen.** FE-001 waits on **D-3**. The navigation entry stays `status: 'planned'` and
  the planned-list navigation test is untouched: `/delivery` still has no page, and the detail screen
  is reached by address or from the work order.
- **No permission minted, no grant changed, no seed row added.** The screen consults
  `sal.delivery.view`, `sal.finance.view` and `sal.delivery.complete`, all of which the catalogue
  already carries and all of which are declared by the operations it calls.
- **No name invented for an identifier.** The delivering employee, the receiving partner, the
  vehicle and the visit are rendered as labelled references. `OWR-2026-09-06-G-10` — whether the
  delivering employee should resolve to a person at all — is **Undecided**, and a screen that
  invented a lookup would be answering an Owner question by shipping.
- **No arithmetic-gate area.** Nothing here renders a figure, so there is nothing for that gate to
  judge and an area with no money in it would be a rule that passes vacuously.
- **No change to any P1-29 or P1-30 gate.** P-16 is a sibling file with its own derivation; the
  P1-29 and P1-30 checks are byte-identical on this branch.
- **No ancestor breadcrumb, because there is no parent screen.** `apps/web/tests/shell.dom.test.tsx`
  measures — rather than assumes — that no route-less ancestor crumb exists in this product: every
  crumb but the last must carry an `href`. A two-crumb trail here would have to link `/delivery`,
  which has no page. The screen therefore renders one crumb, the page's docblock says why, and the
  list crumb arrives with FE-001.

---

## 34. What P-11 changed — the report configuration seam, writer half

**Slice:** `remediation/p1-31-backend-report-configuration-seam`, ownership profile `p1-31-backend`.
**Baseline:** branched from protected `develop` **5cd06fbd**, brought forward onto **249c6428**,
which carries the P-10 warranty policy and coverage seam (**#356**, section 29, **CC-15 … CC-18**),
and then merged with `develop` **fc58f1c2**, which carries the delivery detail screen and the P-16
gate (**#357**, sections 30–33, **CC-19**).

`develop` holds sections 1–33 and **CC-01 … CC-19**. This section therefore continues at **34**,
and its disposition stays at **CC-20**.

The full record is [`report-configuration-seam.md`](./report-configuration-seam.md). In short:

- **The writer half of P-11 is closed by seven operations.** `rpt.report_configurations` and
  `rpt.report_configuration_versions` carried `INSERT` and `UPDATE` grants and policies from P1-11
  and had **no writer anywhere in `apps/api/src`**, while both P1-23 reads filter on
  `status = 'published'` — so every tenant's report catalogue was empty and permanently so.
- **All seven declare `rpt.report.configure`, reads included.** Drafts, archived definitions and
  versions must stay hidden from a `rpt.report.read` holder, who sees published definitions through
  `/reports`. That is a deliberate departure from the P-9 and P-10 seams, where the read code and
  the write code differ, and it departs because the rows are different rows.
- **`rpt.report.configure` is declared for the first time.** It has been a seeded catalogue row
  since P1-08, named by no operation and by no policy predicate. **Nothing was minted**: no seed
  row, no migration, no new code, no schema change of any kind.
- **CC-02 is closed on its own terms, and the bundle moves 74 → 76 on the merged tree.** CC-02
  withheld the code BECAUSE nothing declared it and stated the rule for lifting it — "the slice
  that publishes them owns the widening", the `inv.item.manage` sequence of #322. Seven operations
  now declare it. With CC-01 closed by P-10 the same day, `rpt.export` is the ONLY deliberate
  exclusion left, on CC-04's Owner decision.
- **The ENGINE is not published, deliberately.** `executable` stays the literal `false`.

### 34.1 What was published, and what was minted

| published                                                                            | minted  |
| ------------------------------------------------------------------------------------ | ------- |
| 7 operations, 5 route modules, 5 paths, 5 audit actions, 1 application service       | nothing |
| register 397 → **404** operations, 309 → **314** paths, 227 → **232** audit actions  | nothing |
| bundle 74 → **76** codes on the merged tree, all of them pre-existing catalogue rows | nothing |

### 34.2 Disposition

| id        | finding                                                                                                                  | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | owner / slice         | status |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ------ |
| **CC-20** | organisations provisioned BEFORE the P-10 and P-11 widenings hold neither new code, and cannot delegate either authority | The bundle is written ONCE, inside `platform.organization-provision`, and nothing re-applies it. Every organisation provisioned on the 48-, 65-, 67-, 73- or 74-code bundle holds no `wty.policy.manage` and no `rpt.report.configure`, so its administrator is refused the new writes with `ERR-IAM-001`, and `ins_role_permissions_delegable` admits a mapping only when the acting administrator already holds the code. This is **CC-03**, **CC-08** and **CC-16** restated for a fourth widening | **accepted, with the remedy named and NOT performed here.** `scripts/platform/backfill-tenant-administrator-bundle.mjs` parses `bootstrap-roles.ts` at run time and needs no edit to carry the code. **ONE run after merge covers BOTH newly approved codes** — it is not one run each, and it is not a repeat of the #350 backfill, which carried the P-1 and P-7 widenings and is complete. The script preserves tenant customizations and denials. It is an OPERATOR ACT on a privileged connection, so it requires a run against each environment after this branch merges; this slice did not run it and does not claim it was run anywhere | operator, after merge | open   |

### 34.3 What this slice did NOT do

- **No migration and no schema change.** Both tables, both RLS policy sets and every grant are
  exactly as P1-11 left them; the statements use grants that already existed. There is a single
  `name` column and no second one was added.
- **No permission was minted and no seed changed.** `rpt.report.configure` was already a catalogue
  row, and this slice is the first thing to declare it.
- **No reporting ENGINE.** `ReportDefinitionView.executable` is untouched and still the literal
  `false`, because the frozen schema binds no data source to a report code. The Owner's D-4
  decision of 2026-09-09 — a baseline of four reports with their field-to-contract mapping to
  follow — is RECORDED in the seam document and implemented nowhere: no seed, no constant, no
  migration and no test names those codes.
- **No rule the schema does not encode.** There is no "a configuration must have a published
  version before it may be published" rule; the two statuses are independent in the schema and are
  independent here.
- **No `parameter_schema` vocabulary.** The shape is bounded; what a key MEANS is deferred to D-4
  and the engine slice.
- **No removal of any kind.** `deleted_at` exists on the configuration table and this surface never
  sets it; retirement is `status = 'archived'`.
- **The backfill was not run**, and no claim is made that any environment carries either code.
- **`apps/web/src` was not edited** except through `lib/api/idempotent-operations.ts`, which a
  repository script regenerates and which every published operation moves.
- **No allow-list was widened and no gate was suppressed.**

### 34.4 Proof

| id        | what was shown                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P11-A** | `tests/backend/p1-31-report-configuration-seam.test.ts` — every configuration and version authored THROUGH THE ROUTES, with no admin SQL seeding       |
| **P11-B** | the closure end to end: a definition created as a draft, versioned, published, and only then visible to `GET /reports` — with `executable: false`      |
| **P11-C** | tenant-wide authority from two sides — a `rpt.report.read`-only caller refused all seven, and a branch-scoped configure holder refused by the re-check |
| **P11-D** | the publication invariants: one published version at a time, a second refused, and a published version immutable through the mapped freeze refusal     |
| **P11-E** | the bundle delta measured against the generated P1-24 register, with the undeclared-exclusion list now empty and asserted empty                        |

---

## 36. What the FE-015 slice changed — the audit report, and the phase records

**Slice:** `feature/p1-31-audit-report-and-phase-records`, ownership profile `p1-31-frontend`.
**Baseline:** protected `develop` **0204f2d1**, merged into this branch. This slice was cut at
**249c6428** (PR #356) when sections 1–29 were backend seams, documentation corrections and CI
ownership and no Frontend slice had landed; the delivery detail screen (PR #357) merged first and
holds sections 30–33, and the report configuration seam (PR #361) merged next and holds section 34.

### 36.1 Identifier allocation — CC-22 settled, the section number ahead of one remaining lane

`develop` at **0204f2d1** carries **CC-01 … CC-20** across sections 1–34. **CC-22 is this slice's
identifier and it is free at that head**, so the id this branch reserved provisionally stands. Of the
two lanes that allocated between this one and the merged register, one has landed and one has not.

| id        | lane                                             | state at 0204f2d1       |
| --------- | ------------------------------------------------ | ----------------------- |
| **CC-19** | the delivery detail screen (PR #357)             | merged, sections 30–33  |
| **CC-20** | the reporting writer (P-11, PR #361)             | merged, section 34      |
| **CC-21** | the checklist-template migration (P-9b, PR #363) | open, claims section 35 |
| **CC-22** | this slice                                       | this branch, section 36 |
| **CC-24** | the readiness seam                               | in preparation          |
| **CC-25** | the delivery write paths (PR #362)               | open, on a stacked base |

So this slice takes **section 36 provisionally** and **CC-22 firmly**. P-9b has not merged, so that
one lane landing out of order moves this heading rather than this identifier. **The section number
must be re-checked against `develop` before this branch merges**, and renumbered if P-9b lands with a
different allocation. A register whose identifiers collide is worse than one that renumbers.

### 36.2 What changed

**D-6 is answered: the shipped Audit Log screen IS "audit report" (FE-015), completed as a report.**
The screen already existed and already refused to offer an export. What it did not do was let an
operator ask a question: it sent the mandatory window and nothing else, so finding one action inside
a quarter meant reading the pages.

The action, record type and actor criteria are surfaced alongside an optional named company/branch pair from the authorized organization directories. They travel under the list operation's published parameter names. Company selection prepares branch choices; it is not a company-only filter.
The window and its 92-day bound are untouched, the permission is untouched, and **no export control
was added**.

The criteria apply on submit rather than on each keystroke. The read is rate-limited as an expensive
one and is itself an audited act, so a criterion typed character by character would record a dozen
reads of the audit trail for one question.

Two records were also written: [`task-matrix.md`](./task-matrix.md), which states where each of the
twenty-nine canonical tasks stands and what proves it, and
[`d4-report-definitions.md`](./d4-report-definitions.md), which maps the Owner's four baseline
reports to the contracts that can serve them and names the prerequisites that do not exist yet.

### 36.3 Dispositions

| id        | finding                                                          | measured                                                                                                                                                                                                                                        | disposition                                                                                                                                                                                                                                                                                                   | owner / slice   | status                     |
| --------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------- |
| **CC-22** | audit company/branch selectors were incorrectly declared blocked | The existing authorized `org.company-list` and `org.branch-list` directories publish names and the branch/company relationship. `branchTargetQuery` already accepts a separate resource pair while refusing scope names among ordinary filters. | Corrected in #360: paired named selectors, server-side directory membership and pair validation, then the existing paired query helper. Default `query()` and `companyFilterQuery` guards remain intact. Directory denial leaves the original audit search available. Company-only filtering is not provided. | Frontend / #360 | implemented, pending merge |

### 36.4 What this slice did NOT do

- **No export, and no step toward one.** No control, no client-side extraction, no new operation. The
  route's own docblock states export is out of scope, and the screen still says so in both languages.
- **No permission changed.** The screen gates on the same code it has always gated on, and the route
  page still decides before it reads.
- **The default window was not changed.** **D-11** — whether the seven-day default is ratified,
  deferred or changed — **stays open**, and the preflight's warning that shipping FE-015 without it
  carries the decision into a second phase is now realised rather than avoided. The window itself is
  proven by test to be seven days and server-computed.
- **No backend source was touched.** A Frontend lane may not, and nothing here needed it: every
  criterion surfaced was already a bound parameter of the existing operation.
- **No canonical task was marked done.** The task matrix records FE-015 as `in open PR`, and its
  rule 2 keeps `end-to-end verified` unreachable until a phase acceptance record exists. None does.
- **No figure appears in the D-4 record.** Every unknown in it is written as a named prerequisite.
- **No report engine, registry or run operation was written.** D-4 is a mapping; P-11's engine half
  has not begun.

### 36.5 Proof

| id        | what was shown                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F15-1** | `apps/web/tests/audit-log.dom.test.tsx` — each criterion reaching the adapter under the published name, alone and together, with the window carried with it                       |
| **F15-2** | a malformed actor identifier refused **before** any request is made, and named on the field rather than returned as a refusal about a parameter the operator never saw            |
| **F15-3** | clearing returns the read to the unfiltered one and empties the controls; applying resets the page, because a cursor from an unfiltered set is meaningless against a filtered one |
| **F15-4** | every criterion and both buttons named in Arabic, rendered right-to-left                                                                                                          |
| **F15-5** | the no-export notice present in both languages, and no control or link that would produce one                                                                                     |
| **F15-6** | the route page refusing without the audit code **and issuing no read**, and reading a seven-day server-computed window with it                                                    |

### 36.7 Integration correction — 2026-09-10

The original CC-22 inference missed the existing scoped directory reads and paired resource-query contract. The current implementation uses those contracts within the Frontend lane and does not require a new Owner business decision. The server adapter rechecks selected company and branch membership and their relationship before issuing an audit read. Organization-directory refusal affects the selectors only. Audited list reads explicitly disable automatic retries.

Targeted local checks and required hosted gates follow the standing verification policy. `verify:workspaces` is not run locally for this integration; production builds and browser smoke remain required hosted evidence. No database operation or database test is part of this frontend verification. Canonical DOCX synchronization remains an administrative post-merge responsibility of the technical authority; this slice changes no architecture.

### 36.8 Technical review — 2026-09-10

Agent-assisted technical self-review under the Solo Developer Review Policy covered source commit `5dcb4d70fdc24cc441c0c3c2fdaa7b439f719e41`: the paired selectors use authorized directory rows, the Server Action rechecks company membership and branch/company membership, the query is an additional filter under the audit operation's unchanged authorization/RLS, and directory refusal leaves unfiltered audit search usable. No export, permission, schema or query-guard change was introduced. A separately assigned agent performed a read-only review of that same source commit and reported no blocking finding; it did not run tests or change files. This is not independent human QA.

Terminal targeted results at that source: `typecheck:web` passed; `lint:web` passed with 13 existing warnings; root and web format checks passed; `style:check:web` passed; `security:all` passed; web boundary, token, theme and brand validators passed. The focused audit/scope tests passed 81 cases across two files. The full web runner recorded 3619 passed, zero failed/skipped, 133 files, exit 0 and no dirty executable paths. The policy sequence passed every preceding validator and initially ended with only stale unit/web records from the earlier source; the final ledger and closing-values check resolve that evidence dependency. The unit runner's result is recorded in the generated ledger, not inferred from the web result.

The first full unit record at that source was **red**: 3269 passed and eight failed across 121 files, with runner exit 1 (the recording wrapper itself returned 0). All eight failures were real-tree scan cases across six existing CI/foundation test files and took 35.7–127.7 seconds against the unchanged 30-second test limit. The JSON reporter preserved only `STACK_TRACE_ERROR`, so the original exception text does not establish a timeout by itself. With the host's heavy-test slot reserved, a diagnostic run of those exact six files using the default reporter passed all 243 tests in 75.66 seconds; the eight affected cases took 1.08–5.68 seconds. No source, expectation or timeout was changed. This supports a contention/timing explanation rather than a reproduced assertion defect. The failed raw report and diagnostic log were retained locally, and a serial full unit record was then taken; its terminal verdict is in the generated ledger. The passing web record was retained without rerunning it.

A second full unit record, run with the exclusive heavy-test slot, recorded 3271 passed and six failed across 121 files (runner exit 1). The eight earlier real-tree timing cases passed. These six failures instead exposed an evidence sequencing error in this integration: the successful web measurement was 3619 while the current prose/classification bindings still said 3612, and the manifest still described the earlier document bytes. The unit record remained red. The authoritative prose and classification bindings were updated from the actual successful web record, then the manifest was regenerated before further unit verification. No generated run result was edited by hand.

There is no fabricated-success bootstrap: the existing live classification test deliberately excludes `RUN_RECORD_*` because its own future verdict cannot be a prerequisite for running it. The focused evidence tests can therefore validate the corrected bindings/digests while the prior unit verdict remains red. After a successful full unit recording, the manifest must be regenerated again for the new ledger bytes and the standalone closing-values gate must pass. The two failed full-run reports remain retained locally as diagnostic evidence.

Final unit recording at `5dcb4d70fdc24cc441c0c3c2fdaa7b439f719e41` completed with **3277 passed, zero failed/skipped, 121 files, runner exit 0 and reporter success true**. The web record remained **3619 passed, zero failed/skipped, 133 files, runner exit 0 and reporter success true**. Both records report no dirty executable paths. The focused evidence suite had passed 113 tests across three files before this final run. All owned test processes were verified absent at terminal, and the heavy-test reservation was released before hosted CI.

After the final run, the evidence manifest was regenerated from the actual ledger bytes. The standalone closing-values gate passed with zero problems, evidence validation passed for all 41 documents, and document-count validation passed all 151 claims across 32 documents.

---

# P-2b — the branch delivery list, of 2026-09-09

Section 37 was added by the **P-2b** slice on 2026-09-09; its identifier is **CC-23**. The slice
was written against `develop` `5cd06fbd`, where it reserved **CC-19**; the delivery detail screen
(#357) took that number while this branch was open, so it is renumbered here — the P-9 and
P-13/P-14 slices both had to renumber for exactly this reason, and both are recorded above. At the current integration baseline, #360 is merged at protected `develop`
`f8958e77cd607b8d9a2ebd62eab08176d4c91cf0`. The report writer occupies section 34
and CC-20; audit records occupy section 36 and CC-22; section 35 and CC-21 remain
reserved for #363. This list retains section 37 and CC-23. `main` is untouched.

## 37. The branch delivery list

### 37.1 What was published

**One operation**, `sal.delivery-list` — `GET /api/v1/deliveries` — the chapter first declared API,
added to the route module `sal.delivery-create` already owned.

The P-2 … P-5 seam made a delivery recoverable from an identifier the caller already held. It left
the SET unreadable: nothing in the product answered _which deliveries does this branch have_, so
scope item 1 and FE-001 still had no read. This is that read. The slice record is
[`delivery-read-seam.md`](./delivery-read-seam.md) §10.

`companyId` and `branchId` are required and are the authorization target, checked before any row is
read; `status`, `workOrderId` and `vehicleId` are optional filters, each a column of the record;
paging is keyset on `sal.delivery_records:created_at_desc`. The response is `Page<DeliveryRecordView>`
— the envelope `wty.warranty-list` returns, over the item `sal.delivery-read` already publishes.

### 37.2 Dispositions

| id        | finding                                                                    | measured                                                                                                                                                                                                                                                                                        | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | owner                                                       | state          |
| --------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------- |
| **CC-23** | **no index was added for the list ordering, and no migration was written** | `sal.delivery_records` carries `uq_delivery_records_scope_id (tenant, company, branch, id)` and three `ix_delivery_records_*` indexes; **none leads on `(tenant, company, branch, created_at)`**, so the newest-first ordering is a sort over the branch-narrowed set rather than an index walk | **accepted, on the `wty.warranty-list` precedent, which declined a migration on the same evidence and said so.** A branch deliveries are bounded by its work orders; this read has not demonstrated a cost that a schema change would buy. Recorded here so a later measurement can reverse it deliberately rather than discover it. **The permission was reused, not minted** — `sal.delivery.view`, the code every read on this seam declares — and no policy changed: `sel_delivery_records_scope` is a tenant/company/branch predicate with no permission term, so the declared code is the only application gate | a later `sal` performance slice, if measurement warrants it | open, recorded |
| **D-3**   | Owner decision settled 2026-09-09                                          | The approved FE-001 surface is the work-order readiness queue, including work orders without a delivery record                                                                                                                                                                                  | This branch lists existing delivery records and remains a separate useful read. FE-001 uses the authoritative readiness seam; this list does not satisfy that contract. See owner-decisions-2026-09-09.md section 2                                                                                                                                                                                                                                                                                                                                                                                                   | Owner decision already recorded                             | settled        |

### 37.3 What this slice did NOT do

- **No permission was minted, no seed changed and no bundle changed.** `sal.delivery.view` is
  seeded, is carried by the tenant administrator bundle, and is the code the other five delivery
  reads already declare.
- **No migration, no policy and no grant.** Every statement runs on grants that have existed since
  P1-11, under the existing `sel_delivery_records_scope`.
- **No second mapper.** Rows come back through `toDeliveryView`, so the listed delivery and the read
  delivery are one wire contract; the suite asserts the two responses are equal rather than similar.
- **No screen.** `apps/web` changes only through the generated idempotency manifest, which every
  published operation moves. FE-001 belongs to the frontend lane.
- **No tenant-wide reading.** The company/branch pair is required, so no caller can read deliveries
  across branches, and none is offered.
- **CC-14 is untouched.** The inactive-template gate finding stands exactly as recorded in §26.

### 37.4 Integration verification, 2026-09-10

The existing clean checkout switched from merged #360 to the preserved #358 branch
at `9accee4dfc9ec9a851330fc903310a21e6723395`. It synced once to the actual
protected develop merge `f8958e77cd607b8d9a2ebd62eab08176d4c91cf0`.
The backend route, service, repository and existing seventeen-case contract suite
merged without application conflicts. Conflicts in generated contracts/registers
were resolved by their existing generators; three discovery assertions now pin
the actual combined tree: 405 operations, 352 named bodies and 53 composed bodies,
with zero anonymous or unresolved bodies. The status census contains 290 responses
with status 200; no route module was added by this list.

At the combined tree, OpenAPI generation/contract verification passed 4/4; the three
discovery suites passed 29/29. Contract validators, root and API typechecks, API lint
and format, and security checks passed. The discovery test title/comment correction
that followed changes no assertion; the final unit run below will include it.
The source commit precedes the final tier measurements. Their results and the
seventeen-case backend rerun will be recorded from terminal evidence, not inferred.

Existing #360 unit/web records and original #358 hosted provenance remain historical
evidence. The repository-wide freshness validator expires both current tier records
when any executable path changes, so both tiers require serial refresh at this
settled source. Value bindings were reconciled and the manifest regenerated before
those runs; only RUN_RECORD_STALE remains at this pre-record checkpoint. The local
`verify:workspaces` aggregate is not run under the standing 2026-09-09 targeted-local
plus required-hosted policy. Hosted builds, browser checks and required gates remain
mandatory. Canonical DOCX synchronization remains the technical authority's
administrative postmerge task; this slice changes no architecture.

The targeted backend rerun at source `6af7fadabf8157d3798313d769d7670d85092159`
passed all 17 cases in one file, actual runner exit 0, reporter success true. It ran
only in newly created `p131_delivery_list_20260910` (OID 36455) on the coordinator's
isolated loopback port 55432, cloned from the retained 138-migration baseline. Before
and after guards verified container/database identity, all 255 retained-source table
contents and all cluster role attributes/memberships unchanged; active source/clone
connections were empty at release. The final connection closed at
2026-09-10T08:39:51.337Z. The clone is retained. This is the selected backend contract
suite, not a full backend tier or phase acceptance. Raw outputs and inventories are
preserved in the coordinator's external delivery-list evidence bundle.

The pre-unit evidence suite initially passed 112/113 and refused four current
backend file-inventory annotations: the added delivery-list suite moves actual
backend test files from 133 to 134 and all backend files from 142 to 143. Those
four annotations in the deliverable manifest and risk register were corrected to
actual discovery and the manifest regenerated. Historical executed-tier figures
and their hosted provenance were not changed. The failed focused output is
preserved externally; the full unit recorder did not run against this discrepancy.

Final serial records at executable source
`6af7fadabf8157d3798313d769d7670d85092159`: web 3619 passed across 133 files and
unit 3277 passed across 121 files; both actual runner exit codes are zero, both
reporters report success, and both records have no dirty executable paths. After
the current inventory correction, the three evidence suites passed 113/113 before
the full unit recorder. Root and API typechecks/lint/format, web typecheck/lint/format/
style, contract validators and security checks passed. Web lint has zero errors and
13 pre-existing unused-argument warnings. The final records and raw outputs are
preserved in the external coordinator evidence bundle; no historical hosted result
was converted into local or current-source proof.

The separate read-only agent-assisted verification at that exact source found no
blocking issue: the route, service, repository and seventeen-case suite are unchanged
through the sync, and authorization-before-query, explicit scope predicates, existing
RLS, mapper and pagination contracts remain intact. This documents technical
self-review under the Solo Developer Review Policy, not independent human QA.

All 19 protected-branch checks passed for the #360 merge
`f8958e77cd607b8d9a2ebd62eab08176d4c91cf0`, including `protected-gate`. The first
GitHub-only observer stopped on a DNS error without a failed gate; after its process
was verified absent, one replacement observed the terminal success and retired.
The dependency push hold is therefore satisfied. #358 still requires its own final
head's hosted gates and coordinator merge review; no phase acceptance is implied.
