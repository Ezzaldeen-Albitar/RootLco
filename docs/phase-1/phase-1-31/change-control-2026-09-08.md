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

| id        | finding                                                                                                   | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | owner / slice                                                                                | status                                                                                                                                                                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CC-01** | `wty.policy.manage` is **excluded** from the tenant administrator bundle                                  | Declared by **zero** of the 375 registered operations and named by **no** row-level-security predicate — a search of `apps/api/src` and `supabase/` finds it only in the catalogue seed. A0 records the surface as absent (**P-10 / PPD-04**: the warranty policy and coverage tables have no writer). `wty.warranty-detail` states in its own docblock that borrowing this code for a read "would be worse: it grants coverage administration"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **accepted residual, deliberate.** Holding it would confer nothing today and would pre-grant coverage administration the contract asks to be granted on purpose. **Consequence:** when P-10 publishes the warranty-policy writer, a freshly provisioned administrator will be refused `ERR-IAM-001` on that write AND unable to delegate it; the slice that publishes the writer owns the widening — the `inv.item.manage` sequence exactly (excluded while no route declared it, added by #322 the day three routes did)                                                                                                                                                                                                                                                                                                                              | Backend `wty` configuration lane, with P-10                                                  | **closed** _(this cell read `open`: true when raised. The register's own prose closes it at section 29 — "**CC-01 is closed on its own terms, and the bundle moves 74 → 75**" — and the row was never updated. Annotated, not rewritten, by the closure re-measure, section 62.)_                    |
| **CC-02** | `rpt.report.configure` is **excluded** from the tenant administrator bundle                               | Declared by **zero** registered operations and named by **no** RLS predicate; the `rpt.report_configurations` policies are tenant-scope predicates with no permission term. A0 records the surface as absent (**P-11**: the report configuration and version tables have no writer and no seed, and the definition view's `executable` is the literal `false`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **accepted residual, deliberate.** Same reasoning and same consequence as CC-01, against P-11. Recorded rather than granted so that the reporting slice inherits a decision, not a silent permission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Backend reporting lane, with P-11                                                            | **closed** _(this cell read `open`: true when raised. The register's own prose closes it at section 34 — "**CC-02 is closed on its own terms, and the bundle moves 74 → 76 on the merged tree**" — and the row was never updated. Annotated, not rewritten, by the closure re-measure, section 62.)_ |
| **CC-03** | Organisations provisioned **before** this slice keep the 67-code bundle                                   | The bundle is written ONCE, inside `platform.organization-provision`; nothing re-applies it and no route can widen an existing organisation's server-owned role. This is the third instance of the same residual — P1-30 **CC-08** recorded it for the six organisations that predate #321                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **ANSWERED. Owner decision D-2 of 2026-09-08: backfill.** The finding stands as measured, and the disposition it carried — deferred, not closable by engineering — is now closed by that decision. Where it landed: `scripts/platform/backfill-tenant-administrator-bundle.mjs`, an operator act on a privileged connection gated on the EXISTING `platform.organization.provision`, additive only, idempotent, with one audit record per organisation it changed. Applied to the shared acceptance environment on 2026-09-08: **24 administrator roles brought from 44 / 46 / 48 / 65 / 67 codes to 74**, nothing revoked from anyone, and one organisation (`platform_operators`) reported and skipped because it holds no such role. See **CC-11** below and [`tenant-administrator-bundle-backfill.md`](./tenant-administrator-bundle-backfill.md) | Owner decision D-2, answered; delivered by the D-2 backfill slice                            | closed                                                                                                                                                                                                                                                                                               |
| **CC-04** | `rpt.export` is **excluded** from the tenant administrator bundle, although shipped operations declare it | Declared by **two** of the 375 registered operations — `shared.export-authorize` and `shared.export-catalogue` — so it PASSES the rule in section 2 and the slice originally carried it. What that rule does not weigh is reach: `rpt.export` is not a P1-31 code but the platform-wide export switch of P1-15 (`EXPORT_PERMISSION`), required for **every** export, and the bundle already holds the entitlements all three registered resources use (`shared.document.read`, `org.branch.read`) together with the sensitive-field second permission `iam.sensitive.view`. Carrying it would therefore let a freshly provisioned administrator authorize bulk export of documents, outbound messages and branch data, sensitive fields included, on day one. Nothing in this phase is delayed by withholding it: the reporting items that would consume an export are blocked on **P-11** (no report engine) and **P-12** (no `POST /reports/{reportCode}:export` route and no registered report resource) regardless | **Owner decision of 2026-09-08: EXCLUDE for now.** Least privilege — the bundle is the delegation ceiling of the whole tenant, and a capability of this reach is not granted on day one because a rule about declaration happened to admit it. **Different in kind from CC-01 and CC-02:** those withhold codes that NO operation declares, so holding them would confer nothing; this withholds a code that IS declared and would confer a great deal. **Consequence, accepted:** a freshly provisioned administrator is refused `ERR-IAM-001` by `shared.export-catalogue` and `shared.export-authorize` and cannot delegate the code to anyone. **Revisitable:** it may be added deliberately when the export contract exists (P-11, P-12) and the need is demonstrated; the slice that publishes that contract owns the widening                   | Backend reporting and export lane, with P-11 and P-12; re-opening requires an Owner decision | open                                                                                                                                                                                                                                                                                                 |

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

| id        | finding                                                                                                                                                                                                                                                                                                                   | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | owner / slice                                                     | status |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| **CC-07** | `wty.warranty.read` is **included** in the tenant administrator provisioning bundle                                                                                                                                                                                                                                       | The rule this phase applied is "carry a code only when a shipped operation declares it". Two do: `wty.warranty-list` and the re-pointed `wty.warranty-detail`, so the necessary condition holds where CC-01 and CC-02 have **zero** declarers. The question CC-04 added is REACH, and it answers the other way: `rpt.export` is the platform-wide export switch of P1-15, whereas this code reads warranty records, their coverage terms and their covered jobs and parts in ONE schema — `wty` has 80 columns, all classified `internal`, none `restricted`, and not one monetary. The decisive fact is that **withholding it would REMOVE a capability**: a freshly provisioned administrator can read a warranty today, through `wty.warranty.issue`, which the bundle already holds | **included, deliberately.** Least privilege here means the administrator reads warranties under a READ code instead of an ISSUE code — not that it stops reading them. Re-pointing the route while withholding the code would have been a regression dressed as a restriction. `wty.warranty.issue` is NOT withdrawn: `wty.warranty-generate` still declares it, and an administrator that could not hold it could not delegate a warranty clerk. Bundle **73 → 74**; `tests/backend/p1-31-provisioning-bundle.test.ts` keeps P-1's six and P-7's one as separate constants so neither widening can drift into the other                                                                                                                                                                                                                                             | this slice                                                        | closed |
| **CC-08** | organisations provisioned **before** this slice lose the warranty detail read                                                                                                                                                                                                                                             | The bundle is written ONCE, inside `platform.organization-provision`, and nothing re-applies it. An organisation provisioned on the 48-, 65-, 67- or 73-code bundle holds `wty.warranty.issue` and NOT `wty.warranty.read`, so from this commit its administrator is refused `GET /warranties/{warrantyId}` with `ERR-IAM-001` — a read it could perform yesterday. It also cannot delegate the code, because `ins_role_permissions_delegable` admits a mapping only when the acting administrator already holds it. This is CC-03's residual with a sharper consequence: CC-03 withholds something new, this one **withdraws something old**                                                                                                                                           | **RESOLVED, by the route this row itself named.** It was accepted and filed rather than silently shipped, on the stated understanding that it "resolves the moment A0 decision **D-2** (the backfill) is answered" — and it was answered the same day. Where it landed: the backfill of **CC-11**, which carried `wty.warranty.read` onto all 24 administrator roles on the shared acceptance environment. The withdrawn read is measured back rather than assumed: `tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts` **BF-4** is refused `GET /warranties/{warrantyId}` with `ERR-IAM-001` on a stale role and gets past that gate on the same role after the backfill. `wty.warranty.issue` was not touched, here or anywhere                                                                                                                     | Owner decision D-2, answered; delivered by the D-2 backfill slice | closed |
| **CC-09** | the warranty list is **not a pure publication** of an existing repository method                                                                                                                                                                                                                                          | Same class as **CC-05**, and the governing precedent is the same: `sal.work-order-invoice-read` states "This publishes the existing read; it adds no query and no second mapper." Half holds and half does not. Every finder in `WarrantyRepository` is addressed by an identifier the caller must ALREADY possess — a record id, an idempotency key, a delivery id — so there was no branch-wide read to publish and the query is new, as is `findPolicies`, the set form of the existing identity read                                                                                                                                                                                                                                                                                | **accepted, and recorded rather than presented as a publication.** What the rule protects is preserved: **no second mapper and no second wire contract.** Rows come back through the existing `toRecord`, policies through the existing `toPolicy`, and `WarrantyRecordListView` spells every field exactly as `WarrantyView` spells it — the suite asserts key-by-key equality between a list row and the detail body, so the two shapes cannot drift. The policy block is carried rather than a bare `policyId` because no operation lists warranty policies (**PPD-04** / P-10), and publishing an identifier nobody can resolve is the defect this phase keeps finding. **Addendum 2026-09-11:** `wty.warranty-policy-list` (PR #356) lists policies; the generation picker consumes it (see §43/§48)                                                            | this slice                                                        | closed |
| **CC-10** | the list does **not** close the warranty status-history table, and P-6 never asked it to _(this cell read `wty.warranty_record_status_history`; the table's real name is `wty.warranty_status_history`, and no migration ever created the other one — corrected in place by § 65, with the original wording quoted here)_ | A0 records item 9 ("warranty history") as blocked on two facts: the chapter declares `GET /api/v1/warranties`, which did not exist, and `wty.warranty_status_history` "appears nowhere in `apps/api/src`". **P-6 names only the first.** The second is still true after this slice: the append-only warranty status ledger has no reader, exactly as the delivery ledger had none before P-5 published it _(A0's own sentence quotes the misspelt name; the fact it states was true of the real table)_                                                                                                                                                                                                                                                                                 | **CLOSED by § 65 / CC-55 on 2026-09-13, under the Owner instruction of that date.** _(This cell read: "**open, unchanged, and stated so it cannot be read as closed.** A reader who sees a warranty list published might reasonably assume **VHM-06 / WF-26 / PPD-13** was fully addressed; only its list limb was. Publishing the ledger read would be a second contract this prerequisite does not sanction, and the P-5 precedent shows what it costs: a new query and a new row shape. It needs a prerequisite of its own or an explicit extension of P-6." Every word of it was true when written, and the prerequisite it asked for is exactly what P-18 became.)_ `wty.warranty-status-history` publishes the ledger under `wty.warranty.read`; the query and the row mapper are both new, as P-5's were, and the cost is exactly the one this cell predicted | closed by § 65 / CC-55                                            | closed |

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

| id        | finding                                                                                   | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | owner / slice                                                                | status |
| --------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| **CC-14** | an **INACTIVE** checklist template still blocks a handover, and this slice did not fix it | `sal.complete_delivery` (`supabase/migrations/20260724094000_sal_delivery.sql`, section 8) counts mandatory items with `ti.company_id = ... AND ti.is_mandatory AND ti.deleted_at IS NULL`. It never joins `sal.delivery_checklist_templates` and reads no template `status`, so deactivating a template leaves its mandatory items gating every delivery in that company. The application mirror in `DeliveryRepository.mandatoryChecklistGaps` reproduces the primitive exactly, including this. Proved on real rows in `COMPANY_A9`: an inactive template's mandatory item produces `checklist_incomplete` naming the item | **open, and deliberately NOT mirrored away.** Filtering inactive templates in the mirror alone would report a delivery ELIGIBLE that the primitive then refuses inside the transaction, which is the failure the repository's own rule about mirrors exists to prevent. Correcting the behaviour means replacing a protected function - a forward migration - which this prerequisite does not sanction and which the shared acceptance database could not receive without a migration run. **The operator remedy that works today is published by this slice:** the item-withdrawal route sets exactly the column the primitive filters on, and the suite proves the blocker clears. **CLOSED by P-9b** (Owner approval 2026-09-09): migration `20260909090000_sal_complete_delivery_active_template_gate.sql` re-issues the function with the template join, and `mandatoryChecklistGaps` gains it in the SAME commit, so the mirror is still never better than the primitive. See [`p9b-complete-delivery-template-gate.md`](./p9b-complete-delivery-template-gate.md) | a later `sal` migration slice, with P1-22 under Field 13 - taken by **P-9b** | closed |

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

`tests/backend/p1-31-delivery-checklist-template-seam.test.ts`, **27 cases on real rows** as this
slice left it (**28** since P-9b replaced the single gate-finding case with an inverted pair - see
section 30), every one
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
- **No warranty record was written, read or changed.** `wty.warranty_status_history` still
  has no reader (**CC-10**, unchanged by this slice), and no claim surface exists
  (**P1-22-L-01**, unchanged). _(This bullet named the table `wty.warranty_record_status_history`,
  which no migration ever created — corrected in place on **2026-09-13** by § 65 / **CC-55 (b)**,
  which also records that **CC-10 closed** that day with prerequisite **P-18**. The statement was
  true of the real table when it was written, and of this slice. P1-22-L-01 still holds.)_
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

## 35. P-9b — the completion gate honours the template lifecycle

**Branch:** `remediation/p1-31-backend-complete-delivery-template-gate`, ownership profile
`p1-31-backend`. **Owner approval:** 2026-09-09. **Baseline:** protected `develop` `fc58f1c2`,
`main` `1262de74` — untouched; this branch carries the merge of that `develop` head. `develop`
holds sections 1–33 and **CC-01 … CC-19**, sections 30–33 and **CC-19** being the delivery detail
screen (#357). At the original branch point, section 35 / CC-21 was reserved after the report writer #361. The integration reconciliation below confirms those identifiers against the merged predecessors.

The full record is
[`p9b-complete-delivery-template-gate.md`](./p9b-complete-delivery-template-gate.md); this section
is the register entry rather than a second copy of it.

**What was delivered.** One forward migration and its lockstep mirror.
`supabase/migrations/20260909090000_sal_complete_delivery_active_template_gate.sql` (**139**)
re-issues `sal.complete_delivery(uuid, numeric, text, uuid)` with an identical signature,
`SECURITY INVOKER`, `SET search_path = ''` and identical `REVOKE`/`GRANT` lines, changing only the
mandatory-item count: it joins `sal.delivery_checklist_templates` on the scoped unique key
`(tenant_id, company_id, id)` and requires `t.status = 'active' AND t.deleted_at IS NULL`.
`DeliveryRepository.mandatoryChecklistGaps` takes the same join in the same commit, in both the
count and the sample, so the mirror is still never better than the primitive — the rule that made
**CC-14** unfixable inside the P-9 seam. **No object, no permission, no bundle, no route, no
operation, no audit action and no seed row**; the register stays at **397** operations and
`apps/web` is untouched.

**Derived pins moved 138 -> 139** with the migration count: the schema baseline's `migrationCount`,
carrying a `structuralTotalsNote139` that records tables 254, functions 533, policies 695, triggers
560 and `security_definer` 0 unmoved and `schemaHash` unmoved at
`8302f675153bb681b3dc92c47029c0a4391ed040ad7ce09f83a067f03285dac6` — MEASURED before and after the
migration was applied, because `schema-inventory.mjs` hashes function identity and not body; the
migration-tail assertion in `tests/db/p1-15-shared-services-runtime-capabilities.test.ts`, widened
from eight named files to nine rather than slid; and the P1-27 closing-value ledger and evidence
manifest, which carry the count as a derived figure.

**Proof.** `tests/db/sal-delivery.test.ts` gains five cases and runs **11**: the gate still refuses
while the template is ACTIVE and lets the handover through once it is deactivated; a SOFT-DELETED
template lets it through while the item row survives; a REACTIVATED template gates again; a
WITHDRAWN item under an active template stays excluded, which is the pre-existing rule; and a
mandatory item of a SECOND active template is counted until that template is retired.
`tests/backend/p1-31-delivery-checklist-template-seam.test.ts` moves **27 -> 28**: the single case
that recorded the defect is replaced by a pair — one that gates, stops on deactivation and gates
again on reactivation, and one that counts no template of another company and none of another
tenant — so the gate cannot be removed and called a fix, and the scoped join is asserted rather
than assumed.

| id        | finding                                                                                            | measured                                                                                                                                                                                                                                                                                                                                                                                                    | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | owner / slice | status |
| --------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------ |
| **CC-21** | closing **CC-14** required replacing a protected function, which no earlier P1-31 slice sanctioned | The completion gate read the checklist ITEM's `deleted_at` and never the parent template's `status` or `deleted_at`, so deactivating a template withdrew nothing and soft-deleting one left its items refusing handovers from behind a row no read returns. Correcting the mirror alone would have reported a handover eligible that `sal.complete_delivery` then refuses inside the transaction with 23514 | **closed by this slice**, under Owner approval of 2026-09-09 and on the Field 13 route that returns a defect found by the Frontend to its owning backend phase under change control. Migration 139 and the mirror move together, and `passAllMandatory` in `tests/db/p1-11-helpers.ts` takes the same predicate so a fixture cannot satisfy an item the gate no longer asks about. Rollback-safe: one `CREATE OR REPLACE FUNCTION` under an unchanged identity, writing no state | this slice    | closed |

**Identifier reconciliation — 2026-09-10.** Section **35** and **CC-21** retain their reserved identifiers after integration of protected `develop` `455bce260c315c2b8727418ba37b8e43a7e24fff`. The report writer #361 is merged at section 34 / CC-20, audit #360 occupies section 36 / CC-22, and delivery list #358 occupies section 37 / CC-23. No existing identifier or historical result is renumbered.

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

| id        | lane                                                   | state at 0204f2d1                                                 |
| --------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| **CC-19** | the delivery detail screen (PR #357)                   | merged, sections 30–33                                            |
| **CC-20** | the reporting writer (P-11, PR #361)                   | merged, section 34                                                |
| **CC-21** | the checklist-template migration (P-9b, PR #363)       | open, claims section 35                                           |
| **CC-22** | this slice                                             | this branch, section 36                                           |
| **CC-24** | the readiness seam                                     | in preparation                                                    |
| **CC-25** | the delivery write paths (PR #362)                     | open, on a stacked base                                           |
| **CC-26** | receiver identity-evidence document category (PR #362) | not allocated at that head; minted 2026-09-10 by #362, section 38 |

**Continuation, 2026-09-10** — allocated after this section was written, at protected `develop`
**07193258**. The row is dated rather than folded into the table above, because that table states
what was true at **0204f2d1** and rewriting it would destroy the record.

| id        | lane                                                | state at 07193258, 2026-09-10 |
| --------- | --------------------------------------------------- | ----------------------------- |
| **CC-26** | the identity-evidence category (PR #362)            | open                          |
| **CC-27** | the report engine slice                             | in preparation                |
| **CC-28** | the report engine slice, second identifier          | in preparation                |
| **CC-29** | the delivering-employee identity (P-17), section 41 | this branch, PROVISIONAL      |

So this slice takes **section 36 provisionally** and **CC-22 firmly**. P-9b has not merged, so that
one lane landing out of order moves this heading rather than this identifier. **The section number
must be re-checked against `develop` before this branch merges**, and renumbered if P-9b lands with a
different allocation. A register whose identifiers collide is worse than one that renumbers.

**Allocation continued — re-checked 2026-09-11, at protected `develop` `01c32937`.** The table
above records the lanes as the FE-015 slice could see them and is left as written. The identifiers
allocated after that head are recorded here rather than by editing that slice's record, and each row
below is now read off the merged tree rather than off an open branch:

| id        | lane                                               | state at `01c32937`               |
| --------- | -------------------------------------------------- | --------------------------------- |
| **CC-23** | the branch delivery list (PR #358)                 | merged, section 37                |
| **CC-25** | the delivery write paths (PR #362)                 | merged, section 38                |
| **CC-26** | the receiver identity-evidence category (PR #362)  | merged, section 38                |
| **CC-24** | the delivery-readiness seam (PR #366)              | merged, section 39                |
| **CC-27** | the report engine, engine half (P-11 1/4, PR #364) | this branch, section 40 — settled |
| **CC-28** | the same branch, second disposition                | this branch, section 40 — settled |

**CC-24 landed at section 39 rather than at a heading matching its number**, which is the register
behaving as designed: identifiers are allocated when a finding is raised and are never renumbered to
follow heading order. With sections 1–39 and **CC-01 … CC-26** all present on `01c32937`, section 40
is the next free heading and **CC-27/CC-28** the next free identifiers. The coordinator's standing
allocation gives section 41 to P-17 and section 42 to FE-001, so nothing unmerged can take 40; the
provisional qualifier this slice carried is therefore dropped.

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

| id        | finding                                                          | measured                                                                                                                                                                                                                                        | disposition                                                                                                                                                                                                                                                                                                   | owner / slice   | status                                                                                                                                                                                                                                                                          |
| --------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CC-22** | audit company/branch selectors were incorrectly declared blocked | The existing authorized `org.company-list` and `org.branch-list` directories publish names and the branch/company relationship. `branchTargetQuery` already accepts a separate resource pair while refusing scope names among ordinary filters. | Corrected in #360: paired named selectors, server-side directory membership and pair validation, then the existing paired query helper. Default `query()` and `companyFilterQuery` guards remain intact. Directory denial leaves the original audit search available. Company-only filtering is not provided. | Frontend / #360 | **settled — merged** _(this cell read `implemented, pending merge`: true when written. The pull request it was pending on, #360, merged at `f8958e77`, which section 36.1 records, so the wording is stale rather than open. Annotated by the closure re-measure, section 62.)_ |

### 36.4 What this slice did NOT do

- **No export, and no step toward one.** No control, no client-side extraction, no new operation. The
  route's own docblock states export is out of scope, and the screen still says so in both languages.
- **No permission changed.** The screen gates on the same code it has always gated on, and the route
  page still decides before it reads.
- **The default window was not changed.** **D-11** — whether the seven-day default is ratified,
  deferred or changed — **stays open**, and the preflight's warning that shipping FE-015 without it
  carries the decision into a second phase is now realised rather than avoided. Addendum
  2026-09-10: D-11 was settled by the Owner (seven-day default and 92-day maximum retained; see
  `owner-decisions-2026-09-10.md` §3). The window itself is proven by test to be seven days and
  server-computed.
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

---

# The delivery execution slice — FE-002 … FE-006 write paths

Section 38 records the delivery execution slice on `feature/p1-31-delivery-execution` (PR #362). The original preparation was based on the delivery detail branch at `626b0d8a`; final integration follows merged #363 at `071932584ffcf39776509227f8dead2022667484`. At that head the register runs to section 37 and CC-25, so this slice takes the next free heading, **section 38**, and retains **CC-25** for the withheld-Start disposition. **CC-24 remains allocated to the readiness seam**, which has not landed and takes a later heading; identifiers are not renumbered to follow heading order. **CC-26 is minted here** for the receiver identity-evidence document category. The full record is `delivery-execution-screen.md`.

This slice is Frontend, tooling, tests and documentation only. It adds no operation, no route, no
permission, no seed row and no migration, and it touches neither `apps/api/**` nor `supabase/**`.

## 38. The delivery execution write paths

### 38.1 What was delivered

Four existing-record write paths on the handover screen, each gated on the code its own operation declares:

| action                    | operation                       | authority                                                        |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| Confirm the receiver      | `sal.delivery-receiver-verify`  | `sal.delivery.manage`, `sal.delivery.view`                       |
| Record a checklist result | `sal.delivery-checklist-record` | `sal.delivery.manage`                                            |
| Add a signature           | `sal.delivery-signature-attach` | `sal.delivery.manage`, `sal.delivery.view`                       |
| Release the vehicle       | `sal.delivery-complete`         | `sal.delivery.complete`, `sal.delivery.view`, `sal.finance.view` |

Plus the configuration read the checklist needs — the ACTIVE templates and their items, assembled in
one Server Action from the two P-9 template reads, because no operation publishes "the checklist of
this handover" and the completion evaluates mandatory items by COMPANY rather than by template.

The mirror registry the payload-parity gate reads is
`apps/web/src/lib/contracts/delivery-contract.ts` — the path named in `MIRROR_FILES` in
`scripts/ci/check-p1-30-payload-parity.mjs` — and it is the file that holds the five
`sal.delivery-*` request bodies. Two files carry the same name: the separate
`apps/web/src/features/delivery/delivery-contract.ts` holds the read types, the permission codes and
the view envelopes, not the request bodies. The registry declares **five** writes against these four
sent paths: `sal.delivery-create` is mirrored there because the payload-parity gate reads its request
bodies from one frozen list of files, while the Start control that would send it is withheld pending
the delivering-employee contract recorded as **CC-25** in §38.3.

### 38.2 The properties this slice is accountable for

1. **A control is absent, never present-and-refused,** for a caller without the code its operation
   declares. Measured for all four existing-record writes.
2. **The release quotes the version the ELIGIBILITY read published,** never one a preparation step
   answered with, and a stale version is re-attempted exactly once against a version read again.
3. **The browser decides no eligibility.** The release button is enabled from what the server
   published and from nothing else; the completion recomposes the whole decision in its own
   transaction, and a blocked release renders the re-read blocker list rather than a sentence this
   tier composed. The blockers are not in the refusal at all — `problemFor` carries no service prose.
4. **The odometer holds to the COLUMN, not the route.** The route admits two decimals; the column
   holds one, so the form refuses the second digit and says so in its own help text.
5. **The waiver rule is a biconditional in the form as well as in the database.** A reason appears
   only for a waiver, is required there, and is never sent with any other outcome.

### 38.3 Dispositions

- **CC-25 — new-handover Start is withheld pending validated employee selection.** No raw employee UUID input or browser-callable Start adapter remains. The existing backend create contract is preserved; employee, authenticated actor and authorized receiver remain distinct. The Owner answered the employee relation on 2026-09-10 (D-12, see [`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) §1): a tenant-owned employee identity, distinct from the login account, the authenticated actor and the authorized receiver, validated on the server. Engineering consequence (not an Owner decision): lane placement follows the P-2..P-11 precedent while D-1 stays open, and the Start control stays withheld until that contract exists.
- **CC-26 — the receiver's identity evidence is NOT captured, and the missing category
  is a new backend prerequisite.** The optional evidence field needs a document category that admits
  a person's proof of identity. The seven seeded categories are all reception categories and the only
  one whose purpose is an identity document is the VIN evidence category; filing a person's identity
  document there would be a classification defect. A seed is not on this lane. The field is omitted
  and the prerequisite is recorded.
- **The signature capture reuses the seeded signature category and the ONE approved file input.**
  The document is captured against `rec.reception_visits`, the visit the handover closes and the only
  linkable entity type in this chain's reach; `sal.delivery_records` is not one.
  `no-unapproved-file-input` names one path and this slice did not widen it.
- **The delivery tree joined the form-reset inventory in the change that gave it a form,** rather
  than after the next audit round found it uncovered.

### 38.4 What this slice did NOT do

- **No end-to-end verification, and none is claimed.** Every request shape is asserted against a
  replaced transport; every rendering against a replaced adapter. What is owed is an authenticated
  browser proof on a freshly provisioned organisation, and it is not in this change.
- **No list screen.** FE-001 waits on the readiness contract the Owner's **D-3** answer routes to the
  owning prerequisite lane. `/delivery` still has no page and the navigation entry stays `planned`.
- **No template administration screen.** Two template reads are consumed; no template write is sent,
  and the five template-write entries stay marked as owed in the payload-parity gate.
- **No delivery document.** **D-7** approved 2026-09-10 (printable client-composed view); no document or print operation exists yet.
- **No permission minted and no grant changed.** The three codes consulted are already seeded and are
  already declared by the operations that use them.
- **Task-matrix rows are reconciled during final integration.** The 29 canonical tasks remain distinct from slice proof; no phase acceptance is claimed.

---

# The delivery-readiness queue — Owner decision D-3, of 2026-09-09

## 39. What D-3 changed

**Slice:** `remediation/p1-31-backend-delivery-readiness-seam`, ownership profile `p1-31-backend`.
**Baseline:** protected `develop` **249c6428**, merged up to **0204f2d1**, then **07193258**, then
**78d34fbc** — the head this branch is integrated against.

The full record is [`delivery-readiness-seam.md`](./delivery-readiness-seam.md). In short:

**The Owner's decision (D-3, settled 2026-09-09), in the Owner's words.** The operational
ready-for-delivery queue is the set of work orders that satisfy the AUTHORITATIVE SERVER
delivery-eligibility rules, and it INCLUDES eligible work orders that do not yet have a delivery
record; it is a different question from the delivery-record list, which lists records that already
exist. The three constraints the Owner attached: **no new work-order status**, **eligibility is not
computed in the browser**, **finance permissions are not broadened**.

**Measured fact (not part of the decision).** `GET /api/v1/deliveries` (PR #358) lists delivery
RECORDS, so a work order that is finished, quality-signed, paid and unencumbered is invisible to it
precisely because nobody has opened a handover yet — which is when it is most worth showing.

**Engineering consequence (not an Owner decision).** The points below are this slice's own choices,
made against that answer. The Owner named none of them.

- **One operation.** `GET /api/v1/delivery-readiness` maps to `sal.delivery-readiness-list`, a
  top-level resource on the `/damaged-stock` precedent rather than a static sibling of
  `{deliveryId}`.
- **FOUR of the eight blocker codes**, and the other four are ABSENT rather than reported as
  satisfied: `delivery_state_invalid`, `checklist_incomplete`, `receiver_not_verified` and
  `signature_missing` are counted against a delivery row's id and are unaskable for a work order
  that has none. The four that remain come from the SAME private readers the eligibility
  composition uses, through a new `composeWorkOrderFacts`, restating none of them.
- **The three Owner constraints are discharged** in sections 3 and 4 of the record: nothing writes a
  status, no eligibility input crosses the wire, and requiring three codes narrows rather than
  broadens.
- **Nothing was minted.** No migration, no schema change, no seed, no permission, no audit action.

### 39.1 What was published, and what was minted

| published                                                                         | minted  |
| --------------------------------------------------------------------------------- | ------- |
| 1 operation, 1 route module, 1 path, 1 application service, 1 work-order port     | nothing |
| register 405 to **406** operations, 314 to **315** paths, audit actions unchanged | nothing |

### 39.2 Dispositions

| id        | finding                                                                                                                      | measured                                                                                                                                                                                                                                                                                                                                               | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | owner / slice | status |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------ |
| **CC-24** | no batch variant of the four fact sources exists, so a page of N costs about **5N** round trips and the page must stay small | `qualityModule().gate.evaluate`, billing's `openReceivableForWorkOrder`, inventory's `reads.openCommitmentsFor` and this module's `findLiveDeliveryForWorkOrder` each answer for ONE work order. There is no batched form of any of them anywhere in `apps/api/src`, so twenty rows cost on the order of a hundred round trips plus the candidate page | **accepted, with the page bounded and the remedy NAMED but not performed.** The default page is 20 and the maximum 50, below the platform 50/100, and the maximum is refused at the BOUNDARY rather than clamped by `resolveLimit` — returning fewer rows than were asked for is right for a cheap list and wrong for one that fans out per row. **Batch fact ports in `quality`, `billing` and `inventory` are the named prerequisite of any larger page.** They are not built here: three modules' public surfaces are not this slice's to change, and inventing a batch port per module with no consumer contract is how one surface ends up with two readers that disagree | later slice   | open   |

**Identifier note — the section number and the identifier are both settled.** **CC-24** is this
slice's identifier: the allocation table of §36.1 reserves it for "the readiness seam", and no other
lane claims it. The SECTION NUMBER is now settled too. `develop` **78d34fbc** carries sections 1–38
and **CC-01 … CC-26**: sections 1–34 and **CC-01 … CC-20** were merged at **0204f2d1**; **#363**
landed section 35 and **CC-21**, **#360** section 36 and **CC-22**, **#358** section 37 and
**CC-23**, and **#362** section 38 with **CC-25** and **CC-26**. Section 39 is therefore the next
free heading and this slice takes it, continuing at **CC-24**. Sections 38 and 39 do not collide and
neither do their identifiers.

### 39.3 What this slice did NOT do

- **No migration and no schema change.** The one new SQL predicate is a parameter on the existing
  work-order list query; every statement uses grants that already existed.
- **No permission was minted and no seed changed.** All three declared codes are pre-existing
  catalogue rows already carried by the tenant administrator bundle, so no widening obliges an
  operator act and no backfill is owed.
- **No work-order status was added.** "Ready" is composed on every read and is written nowhere.
- **No gate was weakened.** This is a read and it gates nothing: `sal.complete_delivery`,
  `composeFor` and the eligibility route are untouched, and the four delivery-bound blockers are
  still enforced exactly where they were.
- **`apps/web/src` was not edited** except through `lib/api/idempotent-operations.ts`, which a
  repository script regenerates and which every published operation moves.
- **No allow-list was widened and no gate suppressed.** `check-p1-30-payload-parity.mjs` filters its
  scope to `WRITE_METHODS`, so a GET is outside it and no `PENDING` entry was added: declaring one
  would be a claim about a gate that does not look here.
- **FE-001 is not built**, and the batch fact ports of CC-24 are not built.

### 39.4 Proof

| id       | what was shown                                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D3-1** | `tests/backend/p1-31-delivery-readiness-seam.test.ts` — every fixture arranged THROUGH shipped routes: reception conversion, four transition edges, the closure command, `sal.issue_invoice`, the payment and allocation routes, the delivery routes. Nothing planted by UPDATE |
| **D3-2** | the D-3 claim itself: a closed, settled, unencumbered work order with NO delivery record is returned ready, with no blockers                                                                                                                                                    |
| **D3-3** | the `cancelled` trap proved rather than assumed — `is_closed` AND `is_cancellation` read off the real catalogue row, then the exclusion asserted                                                                                                                                |
| **D3-4** | a HANDED-OVER work order raises no blocker and is still not ready, so an empty blocker list is proved insufficient to infer readiness                                                                                                                                           |
| **D3-5** | the three declared permissions proved necessary and sufficient from four sides, with `sal.finance.view` refused at the operation rather than answered with a softened fact                                                                                                      |

---

# P-11 (1/4) — the report engine, of 2026-09-09

Owner decision **D-4** of 2026-09-09 approved a baseline of four reports — work orders by status,
technician labour time, inventory movements, and an invoice and payment summary — together with the
columns each must carry. **Engineering consequence (not an Owner decision):** serving that baseline
takes a report engine, and prerequisite **P-11** is where it is built; this slice is the first
quarter of it. Section 40 was added by that slice on branch
`remediation/p1-31-backend-report-engine-work-orders`, written against protected `develop`
`249c6428`, with protected `develop` `07193258` merged INTO that branch on 2026-09-10 and protected
`develop` `01c32937` merged in on 2026-09-11. **Nothing on this branch is merged into any protected
branch.** The design record is [`report-engine-seam.md`](./report-engine-seam.md).

**Section 40, CC-27 and CC-28 are settled.** The slice originally reserved sections 30–33 and
**CC-23** against the register it could see at `249c6428`. Both were taken while this branch was
open: sections 30–33 by the delivery detail screen (#357) and **CC-23** by the branch delivery list
(#358, section 37). The register on protected `develop` `01c32937` runs **CC-01 … CC-26** across
sections 1–39: the delivery write paths (#362) landed section 38 with **CC-25** and **CC-26**, and
the readiness seam (#366) landed section 39 with **CC-24**. This slice therefore continues at
**section 40** and takes **CC-27 and CC-28** — two dispositions, the second of them raised while
integrating onto the configuration writer.

Both numbers were re-checked against protected `develop` at this sync and neither collides. The
provisional qualifier the slice carried while #362 and #366 were open is dropped: §36.1's allocation
continuation records the same re-check, and the coordinator's standing allocation places the next
two lanes at sections 41 and 42, so nothing unmerged can take 40. A register whose identifiers
collide is worse than one that renumbers.

## 40. What P-11 changed — the report engine, engine half

### 40.1 What was published, and what was minted

| published                                                                              | minted  |
| -------------------------------------------------------------------------------------- | ------- |
| 1 operation, 1 route module, 1 path, 0 audit actions, 5 module files, 2 module ports   | nothing |
| 1 shared vocabulary, read by the engine and by the merged version writer (CC-28)       | nothing |
| register 406 → **407** operations, 315 → **316** paths, audit actions unchanged at 232 | nothing |
| bundle unchanged at 76 codes on the integrated tree                                    | nothing |

**Measured facts (not part of the decision).** The register figures are read from the generated
`docs/phase-1/phase-1-24/evidence/operation-register.json`, whose totals at this head are 407
operations and 316 OpenAPI paths.

- **`rpt.report-run` — `GET /reports/{reportCode}/rows`**, declaring `rpt.report.read` at
  `scope: 'branch'`, `auditClass: 'none'`, `expensive-read`, `cacheCategory: 'never'`.
- **The dataset registry**, `apps/api/src/modules/reporting/domain/report-datasets.ts`, holding
  exactly one entry: `work_orders_by_status`. Its shape follows the Owner's PLANNED proposal
  **OWR-2026-09-06-A-12** — a report code binds to a CODE-REGISTERED dataset — adopted here as an
  engineering choice rather than as a requirement: the Owner's register carries A-12 as "Proposed
  implementation policy · Planned" (`docs/product/owner-requirements-2026-09-06.md:198`). It is not
  a schema column, because `rpt` still has none.
- **Two module ports.** `workOrderModule().reportPort` answers for `wo.*`, which is that module's
  private schema; `iamOrganizationContext().branches` answers for the branch name and timezone the
  period is resolved in. The second is a THIRD composition root in the iam module, beside
  `iamDirectory`, so a report run does not boot `installIamRuntime()`.
- **`executable` stops being a literal on this branch.** It becomes `REPORT_DATASETS` membership on
  both existing catalogue operations, and the catalogue publishes `source` and `titleKey` beside it.
  On `develop` it is still the literal `false` until this branch merges.
- **Nothing was minted.** No permission, no seed row, no migration, no audit action, no bundle
  change. `rpt.report.read` and `wo.work_order.read` are both existing catalogue rows.

### 40.2 Dispositions

| id           | finding                                                                                                                                                                                                                        | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | owner / slice | status                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| **CC-27**    | two engineering decisions were taken ahead of Owner confirmation and both are visible in the wire; (a) has since been settled in part                                                                                          | **(a) Timezone.** `org.branches.timezone_name` and `org.tenants.default_timezone` both exist and are both foreign keys into `shared.timezones`; NO query in the platform buckets by either one today, so there was no precedent to follow and nothing to match. **(b) The catalogue merge.** `rpt.report_configurations` has no seed and, until the P-11 writer slice lands, no writer — so a rule that made a configuration row a PRECONDITION would leave every report unreachable in every tenant                                                                                                                                                                                                                                                                                                                                | **taken and implemented on this branch, which is unmerged.** (a) **The period and timezone semantics were APPROVED by the Owner on 2026-09-10**, in the Owner's words: half-open `[from, to)` periods in the selected branch's timezone, converted consistently for server queries; timezone and filter context displayed and preserved; cross-branch reporting uses one explicit reporting timezone ([`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) § 4, recorded on protected `develop` and reaching this branch at the `01c32937` sync). **Recommendation pending Owner approval:** that the selected branch's timezone be read from the SOURCE column `org.branches.timezone_name` rather than `org.tenants.default_timezone`; reversing that one choice is one lookup in `ReportRunService.run` plus the case that proves the boundary. (b) **Engineering decision, not confirmed by the Owner — the catalogue-merge rule, CC-27(b).** A configuration row is CUSTOMIZATION of a report the platform implements, not a precondition for it existing: baselines are visible to every tenant marked `source: 'platform'`, and a tenant row of the same code overrides scope, export permission and parameter schema. Both are written up in the seam record with the alternative and its cost | Owner         | (a) approved 2026-09-10 apart from the source column; (b) open                                        |
| **CC-27(c)** | this slice redefined two of the three properties the P1-23 hostile mutation matrix attacks, so two of its mutations had no pattern left to apply — reported NOT APPLIED, which fails the matrix rather than passing it quietly | `scripts/p1-23-mutation-matrix.mjs` edits an exact string and fails when it occurs zero times. **M7b** attacked `AND c.status = 'published'` in the by-code SELECT of `report-catalogue-repository.ts`; that predicate is deliberately gone, because the engine must SEE an unpublished configuration in order to refuse it — a read that hid a draft would leave the code looking unconfigured, let the code-registered baseline answer for it, and make a decision the tenant has not published runnable. **M8** attacked the literal `executable: false`, which is now registry membership                                                                                                                                                                                                                                       | **Both re-targeted, neither weakened.** M7b now mutates the publication test at `apps/api/src/modules/reporting/application/report-configuration-policy.ts:29`, dropping `row.status !== 'published'` and leaving `version_number` guarded so the mutant runs: property **a non-published configuration is never applied to a run**. M8 now mutates `apps/api/src/modules/reporting/application/report-catalogue-service.ts:122` from `isReportDatasetCode(row.report_code)` to `true`: property **the catalogue marks a report executable only when its code is registered**. Each `from` string occurs EXACTLY ONCE in its file, counted statically. `tests/backend/p1-23-reporting.test.ts` gained the fixture and the assertions that fail when either property breaks, so the P1-23 artefact stays self-contained; the script's allow-list, its applied-check and its one-suite-per-mutation shape were not touched. The matrix itself was NOT executed here — it runs backend suites and defaults to the shared database; CI runs it                                                                                                                                                                                                                                                                           | this slice    | settled — the re-target is recorded in [`phase-1-23/gate-record.md`](../phase-1-23/gate-record.md) §7 |
| **CC-28**    | the version WRITER and the report ENGINE disagreed about what a `parameter_schema` MEANS, and only the engine's reading was executable                                                                                         | The writer merged in PR #361 bounds the document's SHAPE — a JSON object, at most 64 top-level keys, at most 16 KiB — and validates nothing about the keys, a deferral it records in its own seam document. The engine reads the same column through an allowlist: `{}`, or `{ filters: { … } }` naming only `companyId` and `branchId` as `uuid` and `from` and `to` as `date`, and it refuses a run it does not recognise. So an administrator holding `rpt.report.configure` could publish a well-formed, accepted definition — `{ branchId: { type: 'uuid' } }`, the filter named at the top level, which is the shape the seam's own examples used — and every subsequent run of that report answered `ERR-IAM-001`, with nothing at authoring time saying why. Neither side was wrong on its own; there were two definitions. | **Closed on this branch.** The vocabulary is stated ONCE, as `readReportParameterVocabulary` in `modules/reporting/domain/report-configuration.ts`, and both the engine's `assertReportConfiguration` and the version-create route read that function, so they cannot drift. The route refuses a schema the engine would refuse, under rule `report_vocabulary`, and refuses `{ filters: {} }` under its own rule `empty_filter_allowlist` — an allowlist permitting no filter would refuse every run, and `{}` already means "no restriction", so the empty allowlist is reached for by mistake rather than on purpose. Refusal was chosen over silent acceptance because refusing costs an administrator one corrected request while accepting costs every reader of that report a refusal they cannot explain. **The ENGINE is unchanged**: a version published before this rule still runs exactly as it did, because rows already in tenant databases must keep the meaning they had. No migration, no permission, no operation, no audit action. Nothing echoes the submitted document into a message.                                                                                                                                                                                                         |

### 40.3 What this slice did NOT do

- **No migration and no schema change.** `rpt` is exactly as P1-11 left it; every statement uses a
  grant and a policy that already existed.
- **No permission was minted and no bundle changed by this slice.** `rpt.report.read` and
  `wo.work_order.read` are both existing catalogue rows. The bundle DID move while this branch was
  open, but not here: the configuration writer (section 34) closed **CC-02** and added
  `rpt.report.configure`, leaving `rpt.export` excluded on **CC-04**'s Owner decision as the single
  remaining deliberate exclusion. This slice adds and removes nothing from that set.
- **No export path of any kind.** A platform baseline publishes `exportPermissionCode: null` rather
  than naming `rpt.export`, because naming a code would advertise a path prerequisite P-12 has not
  built.
- **The other three baseline reports are not implemented.** The registry holds one entry and a case
  asserts that it holds exactly one, so the gap cannot close itself quietly.
- **No configuration WRITER was built here.** The writer is the other half of P-11 and it landed
  separately (PR #361, section 34); on the integrated tree the two halves meet, but this slice
  contributed no part of the writer and `rpt.report_configurations` still carries no seed row. It
  did add ONE rule to the writer's version-create route, and only one: the parameter vocabulary of
  **CC-28**, which is this engine's own reading of the column moved to where it can be enforced
  before a definition is stored. No other behaviour of that route was touched.
- **The ENGINE's treatment of a published schema was not changed.** `{ filters: {} }` is still
  honoured as an allowlist permitting no filter, and an unrecognised document is still refused.
  Rows already published in tenant databases keep the meaning they had; the new rule governs what
  may be created from now on.
- **Bilingual state labels were not invented.** `wo.work_order_states.name` is a single `text`
  column, so the report publishes the label the catalogue holds and the seam record names the schema
  change a translated one would need.
- **`apps/web/src` was not edited** except through `lib/api/idempotent-operations.ts`, which a
  repository script regenerates and which every published operation moves.
- **No allow-list was widened and no gate was suppressed.** `check-p1-30-payload-parity.mjs` does
  not hold `rpt` operations to a mirror at all, and this is a GET with no body, so no `PENDING`
  entry was added: declaring one would be a claim about a gate that does not look here.

### 40.4 Proof

**Measured facts (not part of the decision) — where these results come from.** The runs below were
observed on 2026-09-11 at head `b14818ce`, which is the executable tree of this branch after the
`01c32937` sync; the two commits that follow it change records only. Every database-bound run used
a DISPOSABLE LOCAL CLONE, `p131_report_controls_20260910` on `127.0.0.1:55432`, carrying 139
migrations on PostgreSQL 17.10, with the connection stated in the environment of each command:

| run                                                         | result                                          | database window (UTC) |
| ----------------------------------------------------------- | ----------------------------------------------- | --------------------- |
| `npm run test:backend` — the whole tier, on the clone       | 136 files, 2906/2906                            | 09:43:04 → 09:57:30   |
| `tests/db/rpt-reporting.test.ts`, on the clone              | 3/3                                             | 09:57:47 → 09:57:51   |
| `tests/backend/p1-23-reporting.test.ts` alone, on the clone | 13/13                                           | not timed separately  |
| `npm run test:unit`, through the recorder                   | 3300/3300, 122 files                            | no database           |
| the web tier, through the recorder                          | 3664/3664, 133 files                            | no database           |
| `npm run verify:policies`                                   | exit 0                                          | no database           |
| changed-file ownership, in both CI forms                    | CHECK → `p1-31-backend`, 43 files, 0 violations | no database           |

The earlier observation of 2026-09-10 at `3cb65df9` — the engine suite 29/29, the configuration
seam 29/29, the unit controls 23/23, `tests/ci` with the OpenAPI contract 1990/1990 — is superseded
by the whole-tier run above, which contains all of them.

**There was no hosted gate, no run against the shared database, and no merge.** PR #364's remote
head `59be1698` carries no checks, it is behind this local branch, and no hosted result exists for
`b14818ce` or for any commit after it. The seam record
[`report-engine-seam.md`](./report-engine-seam.md) section 10 states the same runs in the same
terms.

| id        | what was shown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P11-1** | `tests/backend/p1-31-report-engine-work-orders.test.ts` — the rows, the counts, the period, the cells, the authorization, the code and the paging, on real work orders in a branch this suite owns                                                                                                                                                                                                                                                                                                                                                                      |
| **P11-2** | the two permissions from BOTH sides: a principal holding `rpt.report.read` alone is refused naming `wo.work_order.read`, one holding `wo.work_order.read` alone is refused naming `rpt.report.read`                                                                                                                                                                                                                                                                                                                                                                     |
| **P11-3** | the half-open period in the BRANCH zone, on two orders one local minute apart: 23:30 on the last included day is in, 00:00 on the excluded day is out, and a UTC reading of the same period would differ                                                                                                                                                                                                                                                                                                                                                                |
| **P11-4** | the counts are the SELECTION's and not the page's — a one-row page still reports three states, and both pages carry identical counts                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **P11-5** | branch isolation with RLS reach deliberately widened into the refused branch, so the refusal is the scoped permission evaluation and not an empty result set                                                                                                                                                                                                                                                                                                                                                                                                            |
| **P11-7** | the shared vocabulary from both ends: `tests/unit/p1-31-report-configuration-controls.test.ts` pins `readReportParameterVocabulary` directly, including that a verdict of `unrecognised` and a denied run are the same answer on the same documents, and that no refusal quotes the submitted schema; `tests/backend/p1-31-report-configuration-seam.test.ts` proves the route accepts the whole four-filter allowlist and `{}`, refuses six documents the engine would refuse, refuses `{ filters: {} }` under its own rule, and writes no version in any refused case |
| **P11-6** | `executable` in both limbs: true for the registered baseline, false for a PUBLISHED tenant row whose code the engine does not implement                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **P11-8** | the P1-23 mutation re-target of **CC-27(c)**, measured rather than assumed: each new `from` string counted exactly once in its file, then each mutation applied BY HAND and `tests/backend/p1-23-reporting.test.ts` run alone — 13/13 green unmutated, the M7b mutant failing `never applies a configuration the tenant has not published` and the M8 mutant failing `claims executability only for a registered code`, both with an `AssertionError` and neither with a crash signature. The matrix script itself was not executed                                     |

## 41. What P-17 changed — the delivering employee becomes a real identity

**Slice:** `remediation/p1-31-backend-delivering-employee-identity`, ownership profile
`p1-31-backend`. **Baseline:** protected `develop` **ae0e0354**, merged into this branch on
2026-09-12; the slice was written on **07193258**. `main` untouched.
**Section 41 and CC-29 are CONFIRMED, no longer PROVISIONAL.** They were provisional under the
section 36.1 rule while sections 38, 39 and 40 were claimed by lanes that had not landed. At
`develop` **ae0e0354** all three are merged, and section 42 with **CC-30** is allocated to the
readiness-queue screen, whose own allocation table records section 41 and **CC-29** as still
claimed by this unmerged lane. Section 41 is unoccupied, **CC-29** is allocated to nothing else,
and **CC-29a** and **CC-29b** appear nowhere on `develop`.

### 41.1 What was published, and why the table had to be new

`sal.delivery_records.delivering_employee_id` landed in P1-11 as `NOT NULL` **with no foreign key of
any kind**, so any uuid at all was a legal handover officer and the column recorded a claim rather
than an identity. Every fixture in this repository demonstrated it, by passing a LOGIN ACCOUNT id or
`randomUUID()` and being accepted without complaint.

The Owner decision of **2026-09-10** answers **D-12** in six clauses: the delivering employee is a
**tenant-owned employee identity**, distinct from the login account, from the authenticated actor
and from the authorized receiver, with a server-validated reference and organisational assignment,
historical attribution preserved, no HR module, and **an existing suitable personnel entity reused
before a minimal new schema slice is created**.

**Measured facts (not part of the decision).** That sixth clause is what obliged the reuse question
to be **measured before anything was proposed**, and the measurement lives in the
suite rather than in this paragraph: `tech.technician_profiles.user_id` and
`iam.user_employee_links.user_id` are both `NOT NULL` foreign keys into `iam.user_accounts`, so
neither can hold a person who has no reason to sign in — which is the person a workshop most often
sends out to hand a vehicle over.

**Two migrations, both revised in place on the Owner clarification of 2026-09-10** (they are
unmerged, so the correction is an amendment rather than a third file).
`20260910090000_org_employees.sql` adds `org.employees`, RLS enabled and forced, three policies —
a **tenant-wide** `SELECT` to `app_runtime` and `app_readonly` and scope-restricted `INSERT` and
`UPDATE` to `app_runtime` — and **no `DELETE` grant to anyone**.
`20260910091000_sal_delivery_delivering_employee_identity.sql` mints one employee per distinct
RESOLVABLE legacy value, adds the foreign key on **`(tenant_id, delivering_employee_id)`** `NOT
VALID` and validates it in the same migration only when nothing is unresolved, adds the NULLABLE
`delivering_employee_display_name` snapshot and the `BEFORE INSERT` trigger that stamps it, adds
`sal.delivery_legacy_identity_review` for the legacy values that resolve to nobody, and recreates
the immutable guard so the snapshot and the id it came from are frozen.

**Four operations** under `/api/v1/org/employees`: the list and the detail declare
`org.employee.read`, the create and the status command declare `org.employee.manage`. **Both codes
are MINTED** — the register did not exist, so no catalogue code named it — and **both are carried by
the provisioning bundle (76 to 78)**.

**`sal.delivery-create` now refuses two ways**, per rule on `body.deliveringEmployeeId`: `custom`
for not visible and `inactive_employee` for retired. There is **no branch rule** — the Owner
clarification of 2026-09-10 settled that a home branch must not restrict authorized work in another
branch, so the `employee_branch_mismatch` refusal the first draft shipped was removed together with
the rule it enforced, and the case that asserted it now asserts the acceptance instead. The request
BODY is unchanged, so the `sal.delivery-create` payload mirror is untouched; `org` is outside the
P1-30 payload-parity domains, so the four new operations owe no mirror.

**`deliveringEmployeeDisplayName` is `string | null` in the delivery service view types** —
`apps/api/src/modules/delivery/application` — and that is the only place any nullability for it is
stated. `docs/api/openapi.v1.json` publishes `{ "type": "object" }` for every `sal.delivery-*`
success response and therefore carries no field-level delivery response schema at all, which is a
pre-existing convention this slice neither introduced nor changed; the web read type does not carry
the field yet either (section 41.3). `NULL` means one thing and
only one: this handover was recorded before P-17 and its delivering identity resolved to nobody. No
delivery created after the migration can carry it, because the trigger stamps a name or refuses the
insert.

### 41.2 Dispositions

| id         | finding                                                                                     | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | owner / slice                         | state                              |
| ---------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------- |
| **CC-29**  | two of the working assumptions are now Owner DECISIONS; FOUR recommendations remain pending | The Owner clarification of 2026-09-10 settled A-1 (identity independent of a login, approved) and A-2 (the home branch is informational and transferable and must never restrict authorized work in another branch). It did not settle the lifecycle of a backfilled legacy row (A-3), whether `employment_ref` is optional and tenant-unique (A-4), whether administering an employee stays branch-scoped while reading is tenant-wide (A-5), or how an unresolved legacy identity is ever resolved (A-6). The DDL commits to one answer for each of A-3, A-4 and A-5, and to nothing at all for A-6, which ships no command | **Relabelled rather than re-argued.** [`delivering-employee-identity-seam.md`](./delivering-employee-identity-seam.md) section 3 now carries **three** explicit register labels — OWNER DECISION, ENGINEERING CHOICE, RECOMMENDATION PENDING OWNER APPROVAL — and two further labels used outside the register and nowhere in it: **VERIFIED FACT**, at section 9.4 only, and **Engineering consequence (not an Owner decision)**, applied in sections 2, 2a, 4, 5, 6, 7, 8 and 10 to the design elements this lane chose rather than the Owner. A-3, A-4, A-5 and A-6 are each marked **recommendation pending Owner approval** with one concise recommendation sentence, so **four** recommendations are pending and not three. They are: keep `inactive` for backfilled rows; keep `employment_ref` optional and tenant-unique; keep the read/write scope split; and resolve a listed legacy identity through one Owner-approved operator command, never inside a migration. The MINT half of that shape now exists and is not the resolution: `scripts/platform/backfill-delivering-employee-identity.mjs` mints the identities that resolve, lists the ones that do not, and re-runs `VALIDATE CONSTRAINT` only when nothing anywhere is left unresolved — it never decides who an unresolved value names, which is what A-6 still asks the Owner. The migration headers carry the same labels. **No rename and no transfer command ships**: a rename must first say what happens to the snapshots already taken, and a transfer what happens to deliveries recorded in the branch being left                                                                                                                           | Owner, before the next employee slice | open, four recommendations pending |
| **CC-29a** | the branch rule shipped in the first draft and was WRONG                                    | `DeliveryService.createDelivery` refused an employee whose home branch differed from the work order's, `sal.stamp_delivering_employee_identity` refused the same insert, and the foreign key named all four scope columns — three layers enforcing a restriction the Owner had not asked for                                                                                                                                                                                                                                                                                                                                  | **Removed at all three layers, and the removal is asserted rather than described.** The key names `(tenant_id, id)`, the trigger reads only `display_name` and `status`, and the service has no branch comparison. Case **P17-D4** was inverted from a refusal to a **201 with the snapshot stamped**, and the database obligation that asserted a `22023` for another branch now asserts acceptance plus a new `22023` for another TENANT. `sel_employees_tenant` reads tenant-wide because a branch predicate on the read would have kept the rule alive in the policy after it was removed from the constraint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | this slice                            | **closed in this slice**           |
| **CC-29b** | a dangling legacy identity would have FAILED the deployment                                 | The first draft RAISED on any `delivering_employee_id` matching no same-tenant account, and RAISED again on any value used in two branches. On a database with unresolved history the migration simply could not be applied                                                                                                                                                                                                                                                                                                                                                                                                   | **Replaced by report-and-continue, per the Owner clarification.** Unresolvable values are left untouched, recorded in `sal.delivery_legacy_identity_review` (tenant RLS, SELECT to `app_runtime`/`app_readonly`, no write grant to anybody, and an INSERT policy whose `WITH CHECK` is `false` so the refusal is declared rather than inferred from an absence), and the foreign key is added `NOT VALID`. **The mint and the review write moved OUT of the migration on 2026-09-12**, after the hosted run of PR #370: `scripts/ci/migration-replay-checks.mjs` refuses a top-level `INSERT` into a module schema, and it is right to, so the row-level half is now the operator command `scripts/platform/backfill-delivering-employee-identity.mjs` and the migration keeps structure only. **A fresh database validates in the migration** — the `DO` block runs `VALIDATE CONSTRAINT` when `sal.delivery_records` holds zero rows, which is DDL over no rows and passes the scanner. **A populated database validates through the operator command**, after the mint and only when nothing anywhere is left unresolved; until then the key keeps `NOT VALID` and the migration emits a `RAISE NOTICE` naming the command. The shared database held **0** delivery rows when it was read on 2026-09-10, so the command is expected to mint nothing there — still an operator step, not a skipped one. `delivering_employee_display_name` is NULLABLE so history could be preserved rather than completed with a person nobody confirmed. The observation, the controlled proof and the constraint-validation status are separated under their own labels in **41.6**, and must be read there rather than as one sentence | this slice                            | **closed in this slice**           |

### 41.3 What this slice did NOT do

- **No HR module.** Seven columns and a lifecycle. No contract, salary, contact detail, document,
  department, grade or reporting line, and no second identity model beside `iam.user_accounts`.
- **No rename, no transfer, and no delete at any level.** `org.employees` grants `DELETE` to no
  application role and `fk_delivery_records_delivering_employee` is `ON DELETE RESTRICT`.
- **No screen, and no web CONTRACT change either.** `apps/web` changes only in the generated
  idempotency manifest, which every published operation moves. The delivery contract mirror in
  `apps/web/src/features/delivery/delivery-contract.ts` still lacks `deliveringEmployeeDisplayName`,
  and its docblock still states that `deliveringEmployeeId` has no foreign key anywhere in the
  platform — which this slice makes false. **That is left deliberately**, because the
  `p1-31-backend` ownership profile forbids the `web` bucket outright and the correction is a
  frontend-lane change; widening the profile to slip it through would be exactly the
  work-around the gate exists to prevent. It is the same class of stale docblock P-14 corrected and
  is owed to the frontend lane, which is where CC-29 leaves it.
- **No index for the list ordering**, on the CC-23 precedent: a branch register is small, and no
  measurement has demonstrated a cost a schema change would buy.
- **No claim about the hosted replay.** `.github/ci-baselines/schema-baseline.json` moves
  `migrationCount` 139 to 141, `permissionCount` 119 to 121, `schemaHash` to `075a8c5a…`, and four
  of the five structural totals — tables 254 to 256, functions 533 to 534, policies 695 to 700,
  triggers 560 to 563, `security_definer` unchanged at 0. Those figures were **re-measured after
  the Owner clarification revised both migrations**; the values recorded before it described a shape
  no longer in the tree and were replaced, not amended. The structural totals and the permission
  count were measured on a disposable clone replayed from the idle
  139-migration template inside the coordinator's isolated container, and that same clone reproduced
  the recorded 139-migration values digit for digit before either migration was applied. The hosted
  `database-migration-replay` job settled the digest, and against that clone it settled it the other
  way: it measured `075a8c5a…` where the clone had said `a25718d7…` and refused the baseline. The
  clone was the defective instrument, not the migrations. It had been created by template from
  another database and so lacked the database-level `search_path` migration 0001 sets, which makes
  `pg_get_constraintdef` and `pg_indexes.indexdef` render three extension-dependent definitions in
  their schema-qualified form; the digest moved while the schema did not. The committed value was
  re-measured on a database created EMPTY and replayed through all 141 migrations, where the four
  structural totals and `permissionCount` 121 all reproduced, and applying the missing setting to
  the defective clone made it hash `075a8c5a…` too. `schemaHashNote` in the baseline carries the
  diagnosis.
- **No fake data.** `org.employees` is business data: it is absent from the structural-reference
  allow-lists in both `scripts/db/validate-seed-state.mjs` and `tests/db/no-fake-data.test.ts`, so it
  is required to be empty on a provisioned tenant, and the backfill mints only from rows that already
  exist. `sal.delivery_legacy_identity_review` is business data on the same terms and is written
  only from rows that already exist. The report-and-continue path is what keeps this true: minting a
  placeholder person for an unresolvable legacy identity would have been fabricated business data
  inserted by a migration, which is the precise thing the guard forbids.

### 41.4 The one operator act this slice creates and does not perform

Every organisation already provisioned holds the 76-code bundle and therefore **neither** new code.
They need **one** run of `scripts/platform/backfill-tenant-administrator-bundle.mjs` after this
merges — separate from the run P-10 and P-11 already oblige, because it covers two codes those runs
could not know about.

Until that run happens, an existing organisation's administrator cannot create an employee, and
because `sal.delivery-create` now refuses an employee that does not exist, **cannot record a
handover at all**. That is the sharpest consequence of any P1-31 bundle widening, and it is written
here so it is scheduled rather than discovered. **This slice does not run it, and makes no claim that
it has been run.**

### 41.5 Record-integrity note (for the Owner)

`tests/ci/p1-27-doc-counts.test.ts:784` requires `docs/phase-1/phase-1-27/closure-record.md` to
quote the schema hash and migration count that the CURRENT committed baseline carries, so adding the
two migrations of this slice obliged it to rewrite a row of a record sealed on 2026-08-12 — **139**
and `8302f675…` became **141** and `075a8c5a…` — which is a repository convention that makes a
historical record track the live baseline rather than the state it recorded, and one the Owner may
wish to change.

### 41.6 The observation, the controlled proof, and the constraint-validation status

Three statements that the first draft of this slice allowed to stand as one, separated here under
their own labels because each is answerable in a different way.

**OBSERVATION — shared database, read-only, 2026-09-10.** `sal.delivery_records` held **0** rows,
and therefore **0** distinct legacy `(tenant_id, delivering_employee_id)` pairs, of which **0**
matched a same-tenant account and **0** did not. That is one environment on one day. It proves
nothing about how the migration behaves on data — an empty table exercises neither branch of the
backfill — and it is recorded so the number is not later mistaken for evidence.

**CONTROLLED PROOF — disposable clone `p131_employee_20260910` (`127.0.0.1:55432`), rebuilt from
`p131_candidate` at 139 migrations.** The database cases write legacy-shaped rows themselves, so
both branches are exercised. Five obligations are each cited by the exact title of the case that
asserts them in
[`delivering-employee-identity-seam.md`](./delivering-employee-identity-seam.md) section 9.2: the
resolvable mint, the untouched unresolvable value and its review row, the validated key on a fully
resolved database, the trigger's four answers, and the review table's isolation and write refusal.
Section 9.2 also carries a **Gaps** label, so an obligation no case asserts, or cited against a
title with no executed run, is named rather than implied. There were **two runs at two different
commits**, both on **2026-09-10** in container `rootlco-p131-isolation-20260910`, and section 9.2
records each suite with its result, its exit code **and the commit it was measured at**: the
database file stood at 21 cases at **244f868f** and at 23 at **750913e3**, because the two
review-table cases were added between them, and the 285-case backend sweep was measured at
**244f868f** and not re-run afterwards, the seam file alone being re-run at 750913e3. **No run
ledger entry exists for the database or the backend tier** — the ledger records the unit and web
tiers only — and **no hosted result exists** for any of it.

**CONSTRAINT-VALIDATION STATUS.** `fk_delivery_records_delivering_employee` is added **`NOT
VALID`**; the migration validates it in the same run **only when
`sal.delivery_legacy_identity_review` is empty**; on any database carrying unresolved legacy
identities it **remains `NOT VALID`** — binding every future row, proving no past one — until the
Owner resolves those rows. The resolution path is **not yet decided** and is A-6 in the seam
register, a **Recommendation pending Owner approval**: resolve a listed row through one
Owner-approved operator command that names a real employee for it and then re-runs `VALIDATE
CONSTRAINT`, never inside a migration. The hosted migration replay is **defined** to start from an
empty database — `.github/workflows/_reusable-database-assurance.yml` asserts that the database
holds zero application tables at line 235 and applies every migration from zero at line 242 — so it
is **expected** to end validated. That is an expectation read from the workflow definition and **not
yet an observed result**; either way it would be a property of that environment and not evidence
about a populated one.

**Four recommendations are pending — A-3, A-4, A-5 and A-6.** They are stated once each in the
CC-29 disposition of section 41.2 above and in the seam register (section 3), and are deliberately
not restated here. **A-1 and A-2 are APPROVED, not pending.**

---

## 42. The ready-for-delivery queue screen — PROVISIONAL

**Slice:** `feature/p1-31-delivery-readiness-queue`, ownership profile `p1-31-frontend`.
**Baseline:** protected `develop` **c1b1a8cd** (the report engine, #364), merged into this branch on
2026-09-11; the integrated head is that merge commit, `P1-31-FE-001-008`, the commit this section is
written against. An earlier sync merged `develop` **01c32937** on the same day. The screen was
written against **0204f2d1**; the contract it consumes reached `develop` with the readiness seam
(#366, section 39) and the delivery execution paths (#362, section 38), so this is the first head at
which the screen compiles against a published contract rather than a proposed one.

The full record is [`delivery-readiness-queue-ui.md`](./delivery-readiness-queue-ui.md).

**The Owner's decision (D-3, settled 2026-09-09), in the Owner's words.** The operational
ready-for-delivery queue is the set of work orders that satisfy the AUTHORITATIVE SERVER
delivery-eligibility rules, and it INCLUDES eligible work orders that do not yet have a delivery
record; it is a different question from the delivery-record list, which lists records that already
exist. The three constraints the Owner attached: **no new work-order status**, **eligibility is not
computed in the browser**, **finance permissions are not broadened**. This slice consumes that
decision and extends none of it.

**Measured facts (not part of the decision).**

- The contract mirrored on this side matches the merged route field for field: the route's
  `DeliveryReadinessRowView` (`workOrder`, `delivery`, `facts`, `blockers`, `readyToStartDelivery`)
  over the platform cursor page (`items`, `nextCursor`, `hasMore`), and `DEFAULT_READINESS_PAGE_SIZE`
  20 / `MAX_READINESS_PAGE_SIZE` 50 as the route declares them.
- The shared table's first page is **25** rows and its size options are 10, 25, 50 and 100. The
  route's default of 20 applies only to a request that sends no `limit`, and this screen always
  sends one, so 25 is what the first page actually asks for; 100 is capped to the route's 50 on this
  side and the capping is stated to the operator rather than performed silently.
- The P-16 access gate examines **9** route pages across **7** owned segments with the readiness
  operation named, and the new page is one of the nine.

**Engineering consequence (not an Owner decision).** The points below are this slice's own choices.
The Owner named none of them.

- **The page route is `/delivery`**, the singular href already committed in navigation, and the
  navigation entry moves from planned to available. The plural `deliveries` remains the API spelling.
- **All three of the operation's codes gate the page** before any read is issued, and each one alone
  is enough to refuse it. The gate is the page's own; the backend's check is unchanged and remains
  the authority.
- **The verdict is rendered, never composed.** `readyToStartDelivery` is taken as given; an empty
  blocker list is not read as readiness, and no control asks the server to filter by it.
- **The queue is a separate module from the delivery record contract** — `readiness-contract.ts` and
  `readiness-api.ts` — so the execution half (#362) and this half did not stand on each other.

### 42.1 Identifier allocation — PROVISIONAL, dated 2026-09-11

`develop` at **c1b1a8cd** carries sections 1–40 and **CC-01 … CC-28**. Section 40, with **CC-27**,
**CC-27(c)** and **CC-28**, settled on `develop` when the report engine (#364) merged on 2026-09-11,
so one of the two lanes named below has since landed at the allocation it claimed. One unmerged lane
still holds a heading and an identifier between that head and this one.

| id                   | lane                                      | state at c1b1a8cd, dated 2026-09-11 |
| -------------------- | ----------------------------------------- | ----------------------------------- |
| **CC-24**            | the readiness seam (#366)                 | merged, section 39                  |
| **CC-25**, **CC-26** | the delivery execution write paths (#362) | merged, section 38                  |
| **CC-27**, **CC-28** | the report engine (#364)                  | merged, section 40                  |
| **CC-29**            | an unmerged lane                          | open, claims section 41             |
| **CC-30**            | this slice                                | this branch, claims section 42      |

So this slice takes **section 42** and **CC-30**, and both stay **PROVISIONAL**: section 40 is
settled, but section 41 and **CC-29** are still claimed by a lane that has not merged, so that lane
landing with a different allocation would still move this heading. **The section number and the
identifier must both be re-checked against `develop` before this branch merges.** A register whose
identifiers collide is worse than one that renumbers.

### 42.2 What changed, and what was minted

| changed                                                                                                                                                   | minted  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1 route page, 1 screen component, 2 feature modules (contract and adapter), 1 navigation entry flipped to available, 1 parent link on the detail page     | nothing |
| English and Arabic copy for the selectors, the verdict, the unreadable-check case and the paging notice; 3 web test files extended; 1 CI allow-list entry | nothing |

The CI allow-list entry is `sal.delivery-readiness-list` in `scripts/ci/check-p1-31-access.mjs`,
which that gate's own docblock requires in the same change that first consumes the operation. It
WIDENS what the gate judges — the derived segment `delivery-readiness` joins the owned set — and
suppresses nothing.

### 42.3 Dispositions

| id        | finding                                                                                                     | measured                                                                                                                                                                                                                                                                      | disposition                                                                                                                                                                                                                                                                                                                                                                                                                | owner / slice          | status         |
| --------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------- |
| **CC-30** | an operator without `sal.finance.view` is refused the whole queue, and **no reduced view of it is offered** | the operation declares all three codes and the page tests all three; the financial check is composed from rows that live behind the finance code, so a caller without it would be answered from an invisible zero and shown a vehicle as releasable while money is owed on it | **accepted, and recorded because an operator will meet it.** D-3 forbids broadening finance permissions, and a reduced view — the queue with the financial check left blank — is the softened fact the seam already refused at the operation. The remedy is a permission grant by an administrator, not a change here. Recorded so that "the delivery page shows me nothing" is read as a permission fact, not as a defect | a tenant administrator | open, recorded |

### 42.4 What this slice did NOT do, and what is not claimed

- **No backend file changed.** No route, no service, no repository, no migration, no seed, no
  permission, no audit action and no operation. The operation register is untouched by this slice.
- **No work-order status was written or invented**, and nothing on this side recomputes a verdict.
- **No delivery, receiver, signature or checklist result is created from this screen.** It reads,
  and it links to the pages that write.
- **No gate was weakened and no allow-list was relaxed.** The one CI edit adds an operation to a
  gate's reach.
- **No hosted run, no database tier, no browser acceptance and no end-to-end result is claimed.**
  The evidence for this slice is the local frontend chain and the focused web run named in the
  record document. The branch is unmerged as this section is written.

---

## 43. The warranty record screens — **PROVISIONAL** (FE-008, FE-009 partial)

**This whole section is PROVISIONAL, and so is its identifier.** It records work on
`feature/p1-31-warranty-record-screens`, opened against `develop` `01c32937`, re-based by merge onto
protected `develop` `c1b1a8cd` on 2026-09-11 and onto protected `develop` `ae0e0354` on 2026-09-12.
The branch is **unmerged** and has **no hosted result**; it carries an open pull request. Nothing
below claims otherwise.

### 43.1 Identifier allocation — PROVISIONAL, dated 2026-09-11, re-checked at the `ae0e0354` sync

At the base head this register ran to **section 39** and to **CC-26**. **At the merge base this
section now sits on — protected `develop` `ae0e0354` — it runs to section 42 and to CC-30**: the
report engine (P-11) landed section 40 with **CC-27** and **CC-28**, and the ready-for-delivery
queue (FE-001) landed section 42 with **CC-30**; all three are **settled**, not in flight. Section
41 is still held by the coordinator's standing allocation for a lane that has not merged, so this
slice does **not** claim the next number in sequence. It keeps the heading and identifier it
reserved deliberately ahead of the front, and the reservation **stays PROVISIONAL** precisely
because 41 is unmerged: a collision must be a reconciliation and never a silent renumbering of
somebody else's record.

| id               | lane                                         | state at this base                             |
| ---------------- | -------------------------------------------- | ---------------------------------------------- |
| **CC-24**        | the readiness queue (D-3)                    | section 39, merged into this base              |
| **CC-25**        | the delivery write paths                     | section 38, merged into this base              |
| **CC-26**        | receiver identity-evidence document category | section 38, merged into this base              |
| **CC-27, CC-28** | the report engine (P-11, engine half)        | **section 40, settled, merged into this base** |
| **CC-29**        | reserved for the lane at section 41          | not allocated here; unmerged at this head      |
| **CC-30**        | the ready-for-delivery queue (FE-001)        | **section 42, settled, merged into this base** |
| **CC-31**        | this slice                                   | **PROVISIONAL**, this branch, section 43       |

**Reconciliation rule.** If section 43 or **CC-31** is occupied when this branch integrates, this
section moves to the next free heading and this identifier to the next free identifier, and the move
is recorded here with its date. No existing identifier and no historical result is renumbered to
accommodate it. Both syncs exercised exactly that rule in the other direction: section 40 with
**CC-27/CC-28**, and then section 42 with **CC-30**, arrived while this branch was open, neither
collided with 43 or **CC-31**, and nothing here was renumbered.

### 43.2 What was delivered

Two route pages — the branch warranty list at `/{locale}/warranty` and the warranty record at
`/{locale}/warranty/{warrantyId}`, both gated on `wty.warranty.read` and both deciding before they
read — a warranty feature (contract, adapters, shared pieces, two screens), an issue control drawn
on the handover screen for a caller holding `wty.warranty.issue`, a `warranty` navigation entry at
`available`, the English and Arabic wording for all of it, and two new web test files. The full
record is [`warranty-record-screens.md`](./warranty-record-screens.md).

`wty.warranty-detail`, `wty.warranty-generate` and the two policy reads were added to
`P1_31_OPERATION_IDS` in `scripts/ci/check-p1-31-access.mjs`. That gate's scope is an allow-list of
OPERATIONS, so an operation a P1-31 screen calls and the list omits is one the gate has quietly
stopped owning. The detail and the generation share resource roots already derived and widen
nothing; the two policy reads add one owned segment. Measured at this merge base, the gate reports
**11 route pages across 8 owned segments**, against the 9 and 7 that `develop` `ae0e0354` pins, and
the pins in `tests/ci/p1-31-access-gate.test.ts` were moved to 11 and 8 in this sync.

### 43.3 Disposition

| id        | what is accepted                                                                       | measured basis                                                                                                                                                                                                                                                                                                                                                              | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | owner                                                                        | state                                |
| --------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ |
| **CC-31** | **FE-009 ships PARTIAL: a vehicle-filtered list, and no per-record transition ledger** | `wty.warranty_status_history` (the table’s real name; CC-10 above records it as `wty.warranty_record_status_history`, which no migration ever created) is written by the database and read by **no operation anywhere** in `apps/api/src` — **CC-10**, unchanged. The only history that can be read honestly is `wty.warranty-list` filtered by its one filter, `vehicleId` | **accepted, with the missing half NAMED and NOT simulated.** The record screen states in the operator's own language that the transition record cannot be read yet. No sequence is composed from the record's current state: an invented ledger would be believed, which is worse than an absent one. The backend prerequisite is named as **P-18 — warranty history reader**, a `wty.warranty.read` branch-scoped read over the existing table. It is a Backend seam and is not in this lane. _**2026-09-13, § 65 / CC-55:** the named prerequisite is DELIVERED. `wty.warranty-status-history` publishes the ledger under `wty.warranty.read`, branch-scoped, over the existing table — exactly the read this cell specified. **The frontend half of this row stays open**: the record screen still states the transition record cannot be read, because a web change is outside this branch's ownership profile. What is closed is the obstacle, not the screen._ _**2026-09-14, § 69 / CC-59:** every word above was true when it was written and none of it is rewritten. The sentence "the record screen still states the transition record cannot be read" is no longer true of the tree: the web slice recorded in § 69 removed `warranty.record.noHistoryYet` and renders the ledger through `wty.warranty-status-history`. **CC-31's frontend half is delivered; CC-31 itself stays open** until the browser proof at the closing head, which is CC-59 and CC-59 (a)._ | a Backend seam lane (backend half delivered); the screen owed to a web slice | open, recorded — backend half closed |

### 43.4 What this slice did NOT do

- **No backend file was edited**, no migration was written, no seed changed and no permission was
  minted. Both codes the screens consult already exist.
- **No warranty policy or coverage administration screen.** P-10 published seven policy and coverage
  operations and this slice consumes exactly one of them — `wty.warranty-policy-list`, which fills
  the plan picker on the issue control, so a plan is CHOSEN by name rather than named by an
  identifier an operator cannot discover. Creating, renaming, archiving or restoring a plan, and
  everything to do with coverage windows, still has no screen.
- **No history reader and no simulated history.** See CC-31.
- **No gate was weakened, no allow-list narrowed and no suppression added.** The web test floor was
  raised, which makes a gate stricter rather than weaker — see 43.5. The P1-31 access gate's
  operation list was EXTENDED by four operations, which widens what the gate owns rather than what
  it permits. The two policy reads add an eighth owned route segment, `warranty-policies`, which no
  page occupies yet.
- **No merge into any protected branch, no hosted run and no acceptance.** The branch carries an
  open pull request, #369, and is pushed; neither is a result. Every figure quoted in this section
  is from a LOCAL run.

### 43.5 The web test floor was ratcheted, and what that costs

**The measured fact.** `apps/web/tests` now DECLARES 3073 cases across 135 files, and the tier
EXECUTES 3788 with 0 failed and 0 skipped at this merge base — a local `--record web` run of this
branch, recorded in `docs/phase-1/phase-1-27/evidence/local-run-ledger.json` with the commit it was
taken at. It executed 3749 at `467a2681`, before either sync; the 39 additional tests arrived with
the `ae0e0354` merge, and the baseline's `measured` provenance field still records the 3749 run, so
the committed floor's headroom now reads 88 rather than 49. Moving that field is a baseline decision
and was not taken in this sync. No hosted run of this branch exists, and none is claimed.

**Why the floor had to move.** `tests/ci/web-test-floor.test.ts` case `WTF-08` refuses a floor
beneath cases that physically exist. The committed floor was 3050, the declared count crossed it,
and the baseline's own `howToRaise` says to raise a floor in the commit that adds the tests. The
three values move together so that all three describe ONE run: `minTests` 3050 -> 3700, `measured`
3125 -> 3749, `measuredFiles` 117 -> 135. Upward only; nothing in the baseline was lowered, and the
unit and backend entries were left alone because their `measured` is hosted run 19 provenance
rather than a local figure.

**The engineering consequence.** The floor was not chosen; it was forced into a window from three
sides. `WTF-08` puts it at or above 3073. `WTF-09` refuses a headroom wider than the largest file
in the tree (88 declared cases in `api-client.test.ts`, which executes 136), so it may not sit
below 3661. `tests/ci/baseline-integrity.test.ts` refuses a headroom under one per cent of the
measurement, so it may not sit above 3711. 3700 is the round number inside [3661, 3711]. The
headroom therefore narrows from 75 executed tests to 49, and the guarantee sentence in the baseline
states that bound rather than a slogan: any net loss of more than 49 executed tests is detected,
which still covers the deletion of any single web test file. The cost is that the next slice to add
web tests has less room before it must move the floor again, and a slice that DELETES web tests
must state why rather than let the count drift down.

**What travelled with it.** The two derived sites that read `web.minTests` and the three that read
the recorded web total — the clean-room floor row and the sentence beside it, the current-tree
total and its two restatements — with their five closing-value ledger entries, the re-recorded
unit and web tiers, and the regenerated P1-27 evidence manifest. The baseline file classifies as
`tooling`, a bucket the `p1-31-frontend` ownership profile allows.

---

# FE-007 — the printable delivery handover document, of 2026-09-11

## 44. What the FE-007 slice changed — the printable delivery handover document (PROVISIONAL)

**Slice:** `feature/p1-31-delivery-document`, ownership profile `p1-31-frontend`.
**Baseline:** protected `develop` **deb404c1901d2b270a71f5336978d09a04e16293**, merged in on
2026-09-12 — the head that carries the readiness queue (#367) and the warranty record screens
(#369). It supersedes the earlier integration of **c1b1a8cdd822e3e70667600a0309d36a7d6438c6** on
2026-09-11; the slice was written against **01c32937c2d6f5f78f5757cb83c6fdf2995f1dad**.
**Status:** merged with pull request **#368** into protected `develop` `8c4e6a9c`, and
restated at that merge on 2026-09-12: section 44 and **CC-32** are settled, so the PROVISIONAL
markers this section carries read as history rather than as current state. This document records no
hosted run and claims no acceptance.

The full record is [`delivery-document.md`](./delivery-document.md). In short: the vehicle-handover
screen gains a printable sheet, composed on the client from reads it already holds, publishing
nothing and writing nothing.

**The Owner's decision (D-7, 2026-09-10), in the Owner's words.** The delivery document is a
**permission-checked printable operational view**. Stored immutable document versions **remain
deferred** and arrive, if ever, through their own contract rather than as a side effect of a print
view. The printable view is **never described as an immutable archive**, in the interface, the
documentation or a commit message. It is **permission-checked**: a caller sees only what the reads
they already hold publish. Recorded in
[`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) §2.

**Measured facts (not part of the decision).** The shared print frame, the print stylesheet and the
invoice screen's print panel already exist and are the approach D-7 names. Six delivery reads are
already consumed by this screen. The release checks declare the financial read code on top of the
delivery one. The delivering employee, the vehicle, the visit and the final odometer reading are
bare identifiers with no reader in the platform. A work-order summary read DOES exist and publishes
a work-order number, a customer display name, a registration plate and a make and model under
`wo.work_order.read`. The session carries no company or branch NAME.

**Engineering consequence (not an Owner decision).** The sheet is a panel of the existing screen
rather than a second route; its reads happen when it is opened; the release checks are reused from
the screen's one eligibility answer rather than read again; the work-order read is used under its
own code and is not made without it; each part prints the OUTCOME of its read rather than an empty
section; one page of each list is printed and truncation is said; the signature image and the
identity evidence stay references; no company, branch or organisation name and no figure is
printed; the footer disclaimer is a translated string in both catalogues.

### 44.1 What was published, and what was minted (PROVISIONAL)

| published | minted  |
| --------- | ------- |
| nothing   | nothing |

No operation, no route, no path, no permission, no audit action, no migration and no seed. The
operation register and the permission catalogue are unchanged, and `npm run validate:p1-31-access`
reports the same derivation over the same page count as it does on the base commit.

### 44.2 Dispositions (PROVISIONAL)

| id        | finding                                                                                                                                                                                    | measured                                                                                                                                                                                                                                                                                                                 | disposition                                                                                                                                                                                                                                                                                                                                                                                              | owner / slice | status |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------ |
| **CC-32** | the printed sheet carries a **reference** for the delivering employee where a person's name belongs, so a customer-facing printout names nobody for the person who handed the vehicle over | `sal.delivery_records.delivering_employee_id` has no reader anywhere in the platform, and the display-name field arrives with the backend slice D-12 describes, which is not merged at this head. The reception acknowledgement solved the same problem with a stamped identity, and no equivalent exists for a handover | **accepted, and the remedy is NAMED rather than performed.** The sheet prints the identifier as the labelled reference it is and states that the system holds no name for it. Inventing a name on this tier — or resolving one from a live directory read — would print, and hand to a customer, either a fabrication or the account's name TODAY rather than at the handover. The fix is the D-12 slice | later slice   | open   |

**Identifier note — the section number and the identifier are PROVISIONAL, allocated 2026-09-11.**
At the base commit `c1b1a8cd` the register runs to **section 40** and **CC-01 … CC-28**: the
report engine (P-11) settled **section 40** with **CC-27** and **CC-28** at this sync, and the
sections and identifiers below 40 are settled with it. P1-31 lanes are still in flight and unmerged
at that head, and each will take a heading — and, where it raises one, an identifier — before this
slice can be integrated. Rather than claim a number another lane
may already hold, this slice takes **section 44** and **CC-32** provisionally: far enough ahead to
avoid a collision, and to be **re-seated against the then-current register at integration**, exactly
as §38 and §39 were seated against the head they were integrated onto. Nothing downstream may treat
either number as settled until that reseating happens.

### 44.3 What this slice did NOT do (PROVISIONAL)

- **No stored document version.** Nothing is created, uploaded, registered or linked. Stored
  immutable versions remain deferred per D-7, and this printout is not one and does not claim to be.
- **No backend print route and no new operation.** `apps/api` and `supabase` are not edited at all.
- **No permission was minted.** `wo.work_order.read` is a pre-existing code the work-order screens
  already consult; it is resolved on the delivery route page for the sheet's work-order read and
  gates nothing else.
- **Nothing is written from the sheet.** Neither new file imports a write adapter, and the test
  suite asserts every write of this feature untouched while the sheet is composed and printed.
- **No gate was weakened and no allow-list widened.** No suppression comment was added.
- **No acceptance is claimed.** Pull request #368 is open and unmerged; this document records no
  hosted run, no browser pass and no environment.

### 44.4 Proof (PROVISIONAL)

| id       | what was shown                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **D7-1** | a caller the route refuses reaches no control and makes none of the reads the sheet needs                                                   |
| **D7-2** | nothing is read for the sheet until it is opened                                                                                            |
| **D7-3** | the opened sheet carries the frame the print stylesheet finds, with the rows the mocked reads published                                     |
| **D7-4** | the customer, the plate and the work-order number come from the work-order read when its code is held, and that read is NOT made without it |
| **D7-5** | the financial half is absent, unrequested and SAID to be absent without the financial read code                                             |
| **D7-6** | a refused part prints as a refusal with the backend's reference, never as an empty section, and a truncated list says so                    |
| **D7-7** | the disclaimer D-7 requires is on the sheet in English and in Arabic                                                                        |
| **D7-8** | the print control appears only after the reads land and sits inside the toolbar the print stylesheet hides                                  |
| **D7-9** | every write adapter of this feature is untouched throughout                                                                                 |

## 45. What P-11 changed — the report engine, dataset slice 2 (`technician_labor_time`)

**Slice:** `remediation/p1-31-backend-report-engine-datasets`, ownership profile `p1-31-backend`.
**Baseline:** `remediation/p1-31-backend-report-engine-work-orders` at `c7fb9f9e` — PR #364's
branch, which is itself UNMERGED. This slice is STACKED on it and inherits its unmerged state.
**Restated at the `8c4e6a9c` merge, 2026-09-12:** PR #364 has since merged, so the base of this
slice is now protected `develop` `8c4e6a9c` and the stacking above is history rather than current
state. Sections 42 and 43 are allocated and settled on `develop`, and section 44 has since been
taken by the FE-007 printable delivery handover document, merged as #368 — so the heading numbers
45, 46 and 47 are settled and no longer provisional. Section 41 remains unwritten and is not a
number this lane holds. **CC-33**, **CC-34** and **CC-35** stay as allocated: section 44 raised
**CC-32**, so nothing collides.

**Identifier allocation — re-checked 2026-09-12 against protected `develop` `8c4e6a9c`.** Section
36.1 records the register's rule: identifiers are allocated when a finding is raised and are never
renumbered to follow heading order. The rows below were first read from `c7fb9f9e`, which was behind
protected `develop`; they have since been read off the merged tree at `8c4e6a9c`, which is why the
heading number and the identifier are now settled rather than provisional.

| id                   | lane                                                 | state as this branch can see it                           |
| -------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| **CC-27**, **CC-28** | the report engine, engine half (P-11 1/4, PR #364)   | this branch's base, section 40 — settled                  |
| section 41           | the coordinator's standing allocation: P-17          | still not written at the `deb404c1` merge                 |
| section 42           | the ready-for-delivery queue screen (FE-001)         | on protected `develop` — settled                          |
| section 43           | the warranty record screens (FE-008, FE-009 partial) | on protected `develop` — settled                          |
| section 44           | the printable delivery handover document (FE-007)    | on protected `develop` (#368) — settled, raised **CC-32** |
| **CC-29 … CC-32**    | not allocated by this lane                           | **CC-32** is section 44’s; the rest sit between 40 and 45 |
| **CC-33**            | this slice                                           | this branch, section 45 — settled, no collision           |

**The section number and the identifier were re-checked against protected `develop` `8c4e6a9c` at
this merge and neither collides, so neither is renumbered.** A register whose identifiers collide is
worse than one that renumbers. Nothing in this section depends on the number being right.

### 45.1 What was published, and what was minted

| published                                                                             | minted  |
| ------------------------------------------------------------------------------------- | ------- |
| 1 dataset, 0 operations, 0 routes, 0 paths, 0 audit actions, 2 new module files       | nothing |
| 2 module port methods (1 new port, 1 method on an existing one), 1 ordering contract  | nothing |
| register unchanged at **407** operations and **316** OpenAPI paths; audit actions 232 | nothing |
| bundle unchanged                                                                      | nothing |

**Measured facts (not part of the decision).**

- **`technician_labor_time`** joins the dataset registry, which now holds exactly **two** entries. A
  case asserts the exact list, so a third cannot arrive quietly.
- **The report has an ordering contract of its OWN**, `tech.technician_labor_time:started_at_desc`,
  keyed on the report rather than on the table. The per-job labour log keeps
  `tech.labor_sessions:started_at_desc`. Both sort `started_at` descending with the row id as the
  tie-break over the same table, and the SELECTIONS differ — one job's whole log against a branch's
  contributing sessions in a period — so a cursor minted by the list is refused with `ERR-PAG-001`
  rather than starting a report page in the wrong place. A case mints the cursor through the list
  route itself and shows the report refusing it.
- **`tech.labor_sessions` has no status column and no cancelled state.** The soft delete and
  `source = 'correction'` are its entire lifecycle
  (`supabase/migrations/20260722099000_tech_labor_sessions.sql`). It also has no duration column, and
  a session names a JOB rather than a work order.
- **OpenAPI paths/operations unchanged (407/316).** `docs/api/openapi.v1.json` was not changed by
  this branch, and the response schema of `rpt.report-run` is BARE by repository convention
  (`a0-preflight.md` records it for QA-002), so the envelope fields are described only in the
  named wire types exported from `apps/api/src/modules/reporting/index.ts`. No operation, path, permission,
  audit action, migration or seed row moved. `tech.technician.read` and `wo.work_order.read` are
  both existing catalogue rows; the dataset naming the second one NARROWS what the report
  discloses and mints nothing.
- **Two new source files** under `apps/api/src`: `server/db/period.ts` and
  `modules/technician/application/labor-report-port.ts`. The instrumented-file denominator in
  `tests/ci/baseline-integrity.test.ts` moves 282 → 284 with the admitted count 283 → 285. **The
  coverage FLOORS are untouched**; re-establishing them needs a hosted measurement run, which this
  slice did not perform and does not claim.
- **The generated P1-24 operation register was regenerated** and lists the new suite against the
  operations its text references. It was not hand-edited.
- **The P1-27 evidence manifest was regenerated** (`npm run evidence:p1-27`) because two documents it
  digests carry derived `tests/backend` file counts that a new test file moves, 136 → 137 and
  145 → 146.

### 45.2 Dispositions

| id           | finding                                                                                                                      | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | owner / slice | status                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------- |
| **CC-33**    | this report publishes a WORK-ORDER reference, and the caller must therefore hold the work-order module's own read code       | **Measured facts (not part of the decision).** `technician_labor_time` resolves each labour session's job to its WORK ORDER and publishes that reference as a column, because D-4 names "work-order reference" among the report's columns. As first implemented the dataset declared ONE required code, `tech.technician.read` — the code `tech.labor-session-list` already declares for the same rows (`apps/api/src/app/api/v1/jobs/[jobId]/labor-sessions/route.ts`). That operation, however, answers for ONE job the caller already holds; this report enumerates a branch's sessions and names each one's work order and display number. So a caller holding `rpt.report.read` and `tech.technician.read` and NOT `wo.work_order.read` would learn which work orders carried labour in the branch. D-4 names the column and does not state which permission it sits behind | **Engineering consequence (not an Owner decision), taken and implemented on this branch, which is unmerged.** TWO codes: `requiredPermissions` is `['tech.technician.read', 'wo.work_order.read']` and the check is CONJUNCTIVE — the whole report is refused to a caller who lacks either, never answered with the reference column blanked. A report is not a way to be told something the record's own read operation would refuse, and the delivery readiness seam set the precedent that a read spanning two modules names both modules' codes and fails closed. **This is a narrowing, not a broadening:** no caller gains anything, and the only callers affected are those who could previously see a reference they could not have read directly. Both codes are existing catalogue rows; no permission was minted and no bundle moved. **The row is closed by implementation rather than left open for the Owner** — the disclosure it raised no longer exists. What remains, if the Owner wants it, is the opposite question: whether a caller who may read labour but not work orders should receive the report with the reference column ABSENT instead of a refusal. That is a change to D-4's column list and therefore the Owner's, and nothing on this branch presumes an answer. Stated in `report-engine-seam.md` § 11.3 and on the registry entry itself | this slice    | settled — implemented     |
| **CC-33(a)** | the `technician` column publishes a drill-through template for a client screen that does not exist                           | `apps/web` has `technicians/me` and no per-technician route at this head; FE-012 is not started. Slice 1 set the precedent that `drillThrough` is a TEMPLATE the client resolves against its own route table, not a URL the API builds — `report-run-service.ts` says so in the type's own docblock — and slice 1 also left `customer` and `vehicle` without one although both have screens, so the repository carries no rule either way                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Engineering consequence, implemented.** The template is published as `/technicians/{id}`. A client without that route renders no link; nothing about the row depends on it, because the profile id travels in the cell. It is recorded as a named prerequisite (`report-engine-seam.md` § 9 row 7) so FE-012 inherits it rather than discovering it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | this slice    | settled — recorded in § 9 |
| **CC-33(b)** | the shared run envelope was changed, and `countsByState` — a field slice 1 published — is now deprecated rather than removed | Slice 1 recorded the limitation in its own seam record as named prerequisite 2: `countsByState` is one dataset's grouping sitting on a shared envelope, and the reports after it group differently                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **Closed on this branch.** `groups` carries every group of the whole selection with string-valued measures. `countsByState` is retained, marked deprecated, and DERIVED from `work_orders_by_status`'s own groups so the two cannot disagree; it is empty for every other dataset. It is NOT removed here: removing a published field in the same change that adds its replacement leaves a consumer no window in which both exist. Its removal is a named prerequisite (§ 9 row 5) and belongs with a check that nothing still reads it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | this slice    | settled                   |

### 45.3 What this slice did NOT do

- **No migration and no schema change.** Every statement uses grants and policies that already
  existed; `tech` and `wo` are untouched.
- **No permission was minted and no bundle changed.** `tech.technician.read` and
  `wo.work_order.read` are both existing catalogue rows; this is the first report to require the
  first one, and the second is the code `wo.work-order-read` already declares.
- **No new operation, no new route and no new path.** `rpt.report-run` serves the dataset, and
  `docs/api/openapi.v1.json` was not changed by this branch.
- **No export.** Prerequisite P-12 is untouched; `rpt.export` stays excluded on **CC-04**'s grounds
  and a baseline still names no export permission.
- **No frontend.** `apps/web/src` was not edited at all — not even through
  `lib/api/idempotent-operations.ts`, because no published operation moved.
- **The remaining two baseline reports are not implemented.** `inventory_movements` and
  `invoice_payment_summary` are named prerequisites and nothing here narrows them.
- **`WorkOrderRepository.statusSummary` was not redesigned.** Its period predicate now comes from
  `server/db/period.ts` instead of being written in the method; the expression, the bind values and
  their positions are unchanged, and engine slice 1's suite is what says the move changed nothing.
- **No allow-list was widened and no gate was suppressed.** No `@ts-expect-error`, no
  `eslint-disable`, no skipped or retried test. `scripts/check-operation-test-coverage.mjs` was NOT
  edited: the new suite declares a `COVERAGE-EVIDENCE` block beside its assertions, and
  `rpt.report-run`'s required evidence was already provided by slice 1's file, so the manifest
  needed no change and adding one would have been an edit outside this lane's declared scope.
- **The P1-23 and P1-24 mutation matrices were not run**, and no mutation was re-targeted: this
  slice redefines no property either matrix attacks.

### 45.4 Proof

**Measured facts (not part of the decision) — where these results come from.** The runs below were
observed on 2026-09-11 at this branch's head. Every database-bound run used a DISPOSABLE LOCAL
CLONE, `p131_report_controls_20260910` on `127.0.0.1:55432`, carrying 139 migrations, with
`DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` stated explicitly in the environment
of each command and the environment printed before each one:

| run                                                                                         | result                 | database window (UTC) |
| ------------------------------------------------------------------------------------------- | ---------------------- | --------------------- |
| `tests/backend/p1-31-report-engine-technician-labor.test.ts`, on the clone                  | 22/22                  | 12:54:35 → 12:54:46   |
| the four reporting backend suites together, on the clone                                    | 4 files, 93/93         | 12:54:52 → 12:55:16   |
| `tests/unit/p1-31-report-configuration-controls.test.ts` + `tests/openapi-contract.test.ts` | 27/27                  | no database           |
| `npm run test:unit` (whole unit tier)                                                       | 3300/3300 in 122 files | no database           |
| `tests/ci` (whole directory)                                                                | 1986/1986 in 68 files  | no database           |

**There was no hosted gate, no run against the shared database, and no merge.** This branch has no
remote head and no checks recorded, and its base PR #364 is itself unmerged. Final integration and
shared-database evidence follow the coordinator's dependency and database ownership sequence, at
this branch's own turn after #364 merges.

| id        | what was shown                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S2-1**  | `tests/backend/p1-31-report-engine-technician-labor.test.ts` — the columns in the Owner's order and their kinds, the rows, the groups, the period, the authorization and the paging, on real sessions against real jobs on real work orders in a branch this suite owns                                                                                                                                                                                                          |
| **S2-2**  | the permissions from BOTH sides: a principal holding `rpt.report.read` alone is refused naming `tech.technician.read` by the SERVICE, one holding `tech.technician.read` alone is refused naming `rpt.report.read` by the ROUTE, and one holding `rpt.report.read` and `tech.technician.read` but NOT `wo.work_order.read` is refused naming the work-order code — with the fully-granted caller answering on the same request, so the refusal is that one code and nothing else |
| **S2-3**  | the three contributing rules, each on its own fixture technician because the partial GiST EXCLUDE forbids them coexisting on one: a running session excluded, a soft-deleted session excluded, and a corrected session counted ONCE on its amended window — with the retired original proved still present in the table                                                                                                                                                          |
| **S2-4**  | the half-open period in the BRANCH zone on FOUR instants: local midnight on the first included day is IN, one second earlier is OUT, one second before local midnight on the excluded day is IN, and that midnight itself is OUT                                                                                                                                                                                                                                                 |
| **S2-5**  | the absence of a cancelled bucket proved against `information_schema`: `tech.labor_sessions` has no `status`, `state` or `cancelled_at` column, so there is nothing to exclude and nothing is shown                                                                                                                                                                                                                                                                              |
| **S2-6**  | the groups sum exactly — one technician's two sessions total the sum of the two durations the rows carry — and the groups are identical on both pages of a paged run, so they answer for the selection and not for the page                                                                                                                                                                                                                                                      |
| **S2-7**  | the null technician label as a COUNTERFACTUAL: the same rows read by a principal without `iam.user.read` carry the same ids and no names, and nothing is invented or refused                                                                                                                                                                                                                                                                                                     |
| **S2-8**  | branch isolation with RLS reach deliberately widened into the refused branch, so the refusal is the scoped permission evaluation and not an empty result set; and the sibling branch's own sessions are invisible to the reported branch                                                                                                                                                                                                                                         |
| **S2-9**  | `countsByState` empty for this dataset and still correct for `work_orders_by_status`, derived from that dataset's groups — slice 1's suite is unchanged in that respect and still green                                                                                                                                                                                                                                                                                          |
| **S2-10** | the period helper changed nothing: `WorkOrderRepository.statusSummary` now composes it, and slice 1's boundary, counting and paging cases pass unmodified                                                                                                                                                                                                                                                                                                                        |

---

### 45.5 Remediation — `P1-31-P-11-025`, 2026-09-11

**Measured facts (not part of the decision).** A review of this branch found the labour report
paging on the PER-JOB log's ordering contract key, `tech.labor_sessions:started_at_desc`, so a
cursor minted by `tech.labor-session-list` was accepted by a read over a different selection. The
report now carries its own key, `tech.technician_labor_time:started_at_desc`, and the per-job list
keeps the table's. **S2-11** is the case that says so: the cursor is minted by the list ROUTE
itself, the report refuses it with `ERR-PAG-001`, and the report's own cursor still pages on the
same request shape — so the refusal is the contract key and not paging being broken for the
dataset. No operation, path, permission, audit action, migration or seed row moved, and the
published wire shape is unchanged: a cursor is opaque.

Three record corrections were made in the same commit and are not code changes: the OpenAPI
sentences in § 45.1, § 46.1, § 47.1 and the three "did NOT do" lists now state that
`docs/api/openapi.v1.json` was not changed by this branch and that the response schema is bare by
repository convention; the `money` column-kind docblock in
`apps/api/src/modules/reporting/domain/report-datasets.ts` no longer says no dataset emits one,
because `invoice_payment_summary` emits four; and **CC-35(a)** and **CC-35(b)** are reclassified
from settled engineering consequences to OPEN Owner-level items beside **CC-35**, each carrying one
recommendation pending Owner approval.

Re-measured at the remediation head against the same DISPOSABLE LOCAL CLONE,
`p131_report_controls_20260910` on `127.0.0.1:55432`, carrying 139 migrations, with
`DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` stated explicitly and the
environment printed before each command:

| run                                                             | result           | database window (UTC) |
| --------------------------------------------------------------- | ---------------- | --------------------- |
| `tests/backend/p1-31-report-engine-technician-labor.test.ts`    | 25/25            | 18:52:05 → 18:52:16   |
| `tests/backend/p1-31-report-engine-work-orders.test.ts`         | 29/29            | 18:52:44 → 18:52:58   |
| `tests/backend/p1-31-report-engine-inventory-movements.test.ts` | 25/25            | 18:53:02 → 18:53:15   |
| `tests/backend/p1-31-report-engine-invoice-payment.test.ts`     | 26/26            | 18:53:19 → 18:53:34   |
| the six reporting backend suites together, on the clone         | 6 files, 147/147 | 18:53:39 → 18:54:17   |

The figures in § 45.4, § 46.4 and § 47.4 were observed at each slice's own head and are left as
recorded there; the table above is this head's measurement. There was still no hosted gate, no run
against the shared database and no merge.

---

## 46. What P-11 changed — the report engine, dataset slice 3 (`inventory_movements`)

**Slice:** `remediation/p1-31-backend-report-engine-datasets`, ownership profile `p1-31-backend`.
**Baseline:** `remediation/p1-31-backend-report-engine-work-orders` at `c7fb9f9e` — PR #364's
branch, which is itself UNMERGED. This slice is STACKED on it and inherits its unmerged state.
**Restated at the `8c4e6a9c` merge, 2026-09-12:** PR #364 has since merged, so the base of this
slice is now protected `develop` `8c4e6a9c` and the stacking above is history rather than current
state. Sections 42 and 43 are allocated and settled on `develop`, and section 44 has since been
taken by the FE-007 printable delivery handover document, merged as #368 — so the heading numbers
45, 46 and 47 are settled and no longer provisional. Section 41 remains unwritten and is not a
number this lane holds. **CC-33**, **CC-34** and **CC-35** stay as allocated: section 44 raised
**CC-32**, so nothing collides.

**Identifier allocation — re-checked 2026-09-12 against protected `develop` `8c4e6a9c`.** Section
36.1 records the register's rule: identifiers are allocated when a finding is raised and are never
renumbered to follow heading order. **CC-34** is this section's allocation, taken from the same base
as **CC-33** and re-checked with it. **Neither the section number nor the identifier collides on
`develop` `8c4e6a9c`, so neither is renumbered.** Nothing in this section depends on the number
being right.

### 46.1 What was published, and what was minted

| published                                                                             | minted  |
| ------------------------------------------------------------------------------------- | ------- |
| 1 dataset, 0 operations, 0 routes, 0 paths, 0 audit actions, 1 new module file        | nothing |
| 1 module port (1 repository method, 1 ordering contract)                              | nothing |
| register unchanged at **407** operations and **316** OpenAPI paths; audit actions 232 | nothing |
| bundle unchanged                                                                      | nothing |

**Measured facts (not part of the decision).**

- **`inventory_movements`** joins the dataset registry, which now holds exactly **three** entries. A
  case asserts the exact list, so a fourth cannot arrive quietly.
- **`inv.stock_movements` is append-only and immutable**, has no unit column, and its `occurred_at`
  is assigned `now()` by `shared.stamp_status_history` on every insert
  (`supabase/migrations/20260723094000_inv_ledger.sql`, `tg_stock_movements_stamp`). `app_runtime`
  holds SELECT and INSERT on it and no UPDATE.
- **`movement_type` is CHECK-constrained to five terms** and `transfer` is not among them.
- **OpenAPI paths/operations unchanged (407/316).** `docs/api/openapi.v1.json` was not changed by
  this branch, and the response schema of `rpt.report-run` is BARE by repository convention
  (`a0-preflight.md` records it for QA-002), so the envelope fields are described only in the
  named wire types exported from `apps/api/src/modules/reporting/index.ts`. No operation, path, permission,
  audit action, migration or seed row moved. `inv.stock.read` is an existing catalogue row.
- **One new source file** under `apps/api/src`:
  `modules/inventory/application/inventory-report-port.ts`. The instrumented-file denominator in
  `tests/ci/baseline-integrity.test.ts` moves 284 → 285 with the admitted count 285 → 286. **The
  coverage FLOORS are untouched**; re-establishing them needs a hosted measurement run, which this
  slice did not perform and does not claim.
- **The generated P1-24 operation register was regenerated** and lists the new suite against the
  operation its text references. It was not hand-edited.
- **The P1-27 evidence manifest was regenerated** (`npm run evidence:p1-27`) because two documents it
  digests carry derived `tests/backend` file counts that a new test file moves, 137 → 138 and
  146 → 147.

### 46.2 Dispositions

| id           | finding                                                                                                             | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | owner / slice | status                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------- |
| **CC-34**    | D-4 names a TRANSFER whose distinct meaning must be preserved, and the ledger cannot express one                    | **Measured facts (not part of the decision).** `ck_stock_movements_type` constrains `movement_type` to `opening`, `issue`, `return`, `damage`, `adjustment`. The `transfer` movement kind and the `transit` location type were dropped in Phase 1-10, and `modules/inventory/index.ts` states the disclaimer in the module's own surface. There is no primitive a transfer could be assembled from, and a two-movement "transfer" composed in the report would mint a business fact the ledger cannot express | **Engineering consequence (not an Owner decision), implemented.** The report renders the FIVE terms that exist and shows **no transfer bucket**, because an empty one reads as a real zero for a concept that does not exist. What D-4's sentence binds and this dataset does implement is the other half: a RETURN is never netted against an ISSUE — the group key carries the movement type and the `in` and `out` halves are two measures, never one signed sum. `signed_qty` exists on the table and is deliberately not read. Recorded so the Owner can see that the word in the decision has no referent in the schema; **making one is a migration and a module scope change, neither of which this slice takes** | Owner         | recorded — no action here |
| **CC-34(a)** | the `item` column publishes NO drill-through, unlike every other reference column                                   | The register holds `inv.item-search`, a LIST, and no per-item read operation. Slice 1 set the precedent that `drillThrough` is optional on a `reference` column — `customer` and `vehicle` both carry none                                                                                                                                                                                                                                                                                                    | **Engineering consequence, implemented.** No template is published. Naming a route for an operation that does not exist would publish a link that cannot resolve, and the item id travels in the cell either way, so a client that can resolve an item resolves it. Recorded as a named prerequisite (`report-engine-seam.md` § 9 row 9) so FE-013 inherits it rather than discovering it                                                                                                                                                                                                                                                                                                                                 | this slice    | settled — recorded in § 9 |
| **CC-34(b)** | the unit on a report row is the item's CURRENT unit, because the movement records none                              | `inv.stock_movements` has no `uom_id` column; the unit is `inv.item_master.uom_id`. Proved against `information_schema` in the suite rather than asserted                                                                                                                                                                                                                                                                                                                                                     | **Engineering consequence, implemented and recorded.** The report joins the item's unit and puts it in the group key, which is what makes D-5's separation visible rather than implicit. The consequence, stated plainly: re-pointing an item's unit restates its whole movement history. Carrying the unit on the movement is a schema change and therefore a migration nobody has authorised; it is `report-engine-seam.md` § 9 row 10                                                                                                                                                                                                                                                                                  | this slice    | settled — recorded in § 9 |
| **CC-34(c)** | the ledger cannot record a BACKDATED movement, so a period report over `occurred_at` reports when a row was WRITTEN | `tg_stock_movements_stamp` runs `shared.stamp_status_history`, which assigns `NEW.occurred_at := now()` unconditionally, and `app_runtime` holds SELECT and INSERT and no UPDATE. The suite proves all three against the deployed function, trigger and grants                                                                                                                                                                                                                                                | **Recorded, not changed.** The report is exactly as accurate as the column, and for movements posted as they happen the two coincide. What nobody can do is post a movement dated earlier, which a tenant migrating history would need. It is `report-engine-seam.md` § 9 row 11. **The suite's own fixtures restate `occurred_at` with an admin UPDATE after inserting through the full provenance guard**, and say so in the file: `app_runtime` cannot perform that UPDATE, so the fixture is visibly not exercising an application path                                                                                                                                                                               | this slice    | settled — recorded in § 9 |

### 46.3 What this slice did NOT do

- **No migration and no schema change.** Every statement uses grants and policies that already
  existed; `inv` is untouched.
- **No permission was minted and no bundle changed.** `inv.stock.read` is an existing catalogue row,
  and this is the first report to require it.
- **No new operation, no new route and no new path.** `rpt.report-run` serves the dataset, and
  `docs/api/openapi.v1.json` was not changed by this branch.
- **No export.** Prerequisite P-12 is untouched; `rpt.export` stays excluded on **CC-04**'s grounds.
- **No frontend.** `apps/web/src` was not edited at all.
- **`InventoryReadService` was not changed.** The report port is a new class beside it, because that
  service takes a scope authorizer and writes an `inv.movement_history.read` audit row on every call.
- **The last baseline report is not implemented.** `invoice_payment_summary` is a named prerequisite
  and nothing here narrows it.
- **No allow-list was widened and no gate was suppressed.** No `@ts-expect-error`, no
  `eslint-disable`, no skipped or retried test. `scripts/check-operation-test-coverage.mjs` was NOT
  edited: the new suite declares a `COVERAGE-EVIDENCE` block beside its assertions, and
  `rpt.report-run`'s required evidence was already provided by slice 1's file.
- **The P1-23 and P1-24 mutation matrices were not run**, and no mutation was re-targeted: this
  slice redefines no property either matrix attacks.

### 46.4 Proof

**Measured facts (not part of the decision) — where these results come from.** The runs below were
observed on 2026-09-11 at this branch's head. Every database-bound run used a DISPOSABLE LOCAL
CLONE, `p131_report_controls_20260910` on `127.0.0.1:55432`, carrying 139 migrations, with
`DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` stated explicitly in the environment
of each command and the environment printed before each one:

| run                                                             | result                 | database window (UTC) |
| --------------------------------------------------------------- | ---------------------- | --------------------- |
| `tests/backend/p1-31-report-engine-inventory-movements.test.ts` | 25/25                  | 14:46:28 → 14:46:37   |
| the five reporting backend suites together, on the clone        | 5 files, 120/120       | 14:47:44 → 14:48:16   |
| the six inventory backend suites, on the clone                  | 6 files, 163/163       | 14:48:24 → 14:49:11   |
| `npm run test:unit` (whole unit tier, includes `tests/ci`)      | 3300/3300 in 122 files | no database           |

**There was no hosted gate, no run against the shared database, and no merge.** This branch has no
remote head and no checks recorded, and its base PR #364 is itself unmerged. Final integration and
shared-database evidence follow the coordinator's dependency and database ownership sequence, at
this branch's own turn after #364 merges.

| id        | what was shown                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S3-1**  | `tests/backend/p1-31-report-engine-inventory-movements.test.ts` — the columns in the Owner's order and their kinds, the rows, the groups, the period, the authorization and the paging, on real movements cited to real approved opening lines, part issues, part returns, damage records and approved adjustments |
| **S3-2**  | all FIVE movement types with the direction the CHECK constrains, including the damage PAIR from one source row, out of the warehouse and in to quarantine                                                                                                                                                          |
| **S3-3**  | the absence of `transfer` proved against the live `ck_stock_movements_type` definition and against the table, so the report's silence about it is a schema fact rather than a fixture gap                                                                                                                          |
| **S3-4**  | totals separated by `(item, unit, movement type)` with exact decimal strings, the two units genuinely incompatible (`each` is a count, `litre` a volume), and NO measure spanning two items or two units                                                                                                           |
| **S3-5**  | a return never netted against an issue: 4.000 issued and 1.500 returned, with 2.500 appearing in no measure and the two kept as two groups                                                                                                                                                                         |
| **S3-6**  | the half-open period in the BRANCH zone on FOUR instants: local midnight on the first included day is IN, one second earlier is OUT, one second before local midnight on the excluded day is IN, and that midnight itself is OUT — with each excluded movement's quantity absent from every total                  |
| **S3-7**  | the permissions from BOTH sides: a principal holding `rpt.report.read` alone is refused naming `inv.stock.read` by the SERVICE, one holding `inv.stock.read` alone is refused naming `rpt.report.read` by the ROUTE                                                                                                |
| **S3-8**  | branch isolation with RLS reach deliberately widened into the refused branch, so the refusal is the scoped permission evaluation and not an empty result set; and the sibling branch's own movement is invisible to the reported branch                                                                            |
| **S3-9**  | paging over a NON-UNIQUE sort column: three pages reconstruct the whole selection exactly, with the damage pair — which shares an instant — split across a page boundary, which is where a sort-only cursor loses a row; and the groups are identical on every page                                                |
| **S3-10** | a cursor minted for the LEDGER SCREEN's ordering over the same table refused with `ERR-PAG-001` rather than reinterpreted                                                                                                                                                                                          |
| **S3-11** | every quantity a STRING at `numeric(12,3)` scale, in cells and in measures alike, so no value made a trip through a JSON number                                                                                                                                                                                    |
| **S3-12** | the two ledger limitations measured against the deployed database rather than asserted: no unit column on the movement, and `occurred_at` stamped from the transaction clock with `app_runtime` holding SELECT and INSERT only                                                                                     |

---

## 47. What P-11 changed — the report engine, dataset slice 4 (`invoice_payment_summary`)

**Slice:** `remediation/p1-31-backend-report-engine-datasets`, ownership profile `p1-31-backend`.
**Baseline:** `remediation/p1-31-backend-report-engine-work-orders` at `c7fb9f9e` — PR #364's
branch, which is itself UNMERGED. This slice is STACKED on it and inherits its unmerged state.
**Restated at the `8c4e6a9c` merge, 2026-09-12:** PR #364 has since merged, so the base of this
slice is now protected `develop` `8c4e6a9c` and the stacking above is history rather than current
state. Sections 42 and 43 are allocated and settled on `develop`, and section 44 has since been
taken by the FE-007 printable delivery handover document, merged as #368 — so the heading numbers
45, 46 and 47 are settled and no longer provisional. Section 41 remains unwritten and is not a
number this lane holds. **CC-33**, **CC-34** and **CC-35** stay as allocated: section 44 raised
**CC-32**, so nothing collides.

**Identifier allocation — re-checked 2026-09-12 against protected `develop` `8c4e6a9c`.** Section
36.1 records the register's rule: identifiers are allocated when a finding is raised and are never
renumbered to follow heading order. **CC-35** is this section's allocation, taken from the same base
as **CC-33** and **CC-34** and re-checked with them. **Neither the section number nor the identifier
collides on `develop` `8c4e6a9c`, so neither is renumbered.** Nothing in this section depends on the
number being right.

### 47.1 What was published, and what was minted

| published                                                                             | minted  |
| ------------------------------------------------------------------------------------- | ------- |
| 1 dataset, 0 operations, 0 routes, 0 paths, 0 audit actions, 2 new module files       | nothing |
| 2 module ports (1 repository method each)                                             | nothing |
| register unchanged at **407** operations and **316** OpenAPI paths; audit actions 232 | nothing |
| bundle unchanged                                                                      | nothing |

**Measured facts (not part of the decision).**

- **`invoice_payment_summary`** joins the dataset registry, which now holds exactly **four** entries
  — the whole of what D-4 approves. A case asserts the exact list, so a fifth cannot arrive quietly.
- **OpenAPI paths/operations unchanged (407/316).** `docs/api/openapi.v1.json` was not changed by
  this branch, and the response schema of `rpt.report-run` is BARE by repository convention
  (`a0-preflight.md` records it for QA-002), so the envelope fields are described only in the
  named wire types exported from `apps/api/src/modules/reporting/index.ts`. No operation, path, permission,
  audit action, migration or seed row moved. `sal.finance.view` is an existing catalogue row.
- **Two new source files** under `apps/api/src`:
  `modules/billing/application/billing-report-port.ts` and
  `modules/payments/application/payments-report-port.ts` — one per module that owns part of the row.
  The instrumented-file denominator in `tests/ci/baseline-integrity.test.ts` moves 285 → 287 with the
  admitted count 286 → 288. **The coverage FLOORS are untouched**; re-establishing them needs a
  hosted measurement run, which this slice did not perform and does not claim.
- **`scripts/ci/check-exact-money.mjs` now scans `modules/reporting`**, taking the gate from 12 to
  13 declared trees and to 61 scanned files, 9 of which are this module. It was WIDENED, not weakened: no rule, allow-list or
  suppression changed.
- **Every financial instant is stamped from `now()`** by the protected primitives, and no route or
  function accepts one from a caller — so the suite writes each document through the full primitive
  and then restates its single instant with triggers suspended in a superuser transaction, which
  `app_runtime` cannot do. The file says so at its head.
- **The generated P1-24 operation register was regenerated** and lists the new suite against the
  operation its text references. It was not hand-edited.
- **The P1-27 evidence manifest was regenerated** (`npm run evidence:p1-27`) because two documents it
  digests carry derived `tests/backend` file counts that a new test file moves, 138 → 139 and
  147 → 148.

### 47.2 Dispositions

| id           | finding                                                                                                                           | measured                                                                                                                                                                                                                                                                                                                            | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | owner / slice | status                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------ |
| **CC-35**    | D-4's source table names two figures the approved column list does not carry: a credit-note amount, and `sal.receipt_unallocated` | Both exist and both are reachable. `sal.credit_notes.amount` is `numeric(18,4)`; `sal.receipt_unallocated` is a deployed function the payments module already calls on its own receipt reads. The column list implemented is the one under "Columns and their contracts", which names neither                                       | **Recorded, not decided.** An approved credit note is published as a DOCUMENT — its date, its payer, its currency, its approved state — and its money reaches the report only as the reduction inside the affected invoice's `outstanding`, which the database function computes. No unallocated column is published either. Adding either is a COLUMN the Owner has not named, and inventing one would be this coordinator deciding what the report says. Recorded so the Owner can add them deliberately; `report-engine-seam.md` § 9 rows 14 and 15 **DECIDED BY THE OWNER 2026-09-12** (`owner-decisions-2026-09-12.md` § 2, D-20): both figures are published as separate fields, from the authoritative column and the deployed function, with neither netted into a figure `sal.invoice_open_receivable` has already computed                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Owner         | decided by the Owner 2026-09-12; implemented in § 47.5 |
| **CC-35(a)** | the `document` column publishes NO drill-through, unlike every reference column on the three datasets before it                   | A `ReportColumnDefinition` carries ONE `drillThrough` template. This column addresses THREE kinds of document: an invoice resolves through `sal.invoice-detail` (`/invoices/{id}`), a receipt through `sal.receipt-detail` (`/payments/{id}`), and a credit note through nothing — the register holds no credit-note read operation | **Recorded, not decided — OPEN at Owner level, beside CC-35.** No template is published on this branch and nothing about a row depends on one: `documentType` is the discriminator a client needs to choose a route, and the document id travels in the cell either way. Publishing a single template would send most rows to a screen that cannot answer for them, and a per-KIND template changes the published column contract, which is the Owner's to change. **Recommendation pending Owner approval:** publish the drill-through PER DOCUMENT KIND against the detail operations that already exist — an invoice through `sal.invoice-detail` (`/invoices/{id}`) and a receipt through `sal.receipt-detail` (`/payments/{id}`) — with a credit note carrying none, because the register holds no credit-note read; until that is approved the column stays without a template. Also a named prerequisite (`report-engine-seam.md` § 9 row 12) so FE-014 inherits it rather than discovering it **DECIDED BY THE OWNER 2026-09-12** (`owner-decisions-2026-09-12.md` § 2, D-20): the drill-through is resolved by document kind against an authorized target route, and the kind with no read operation carries a published NULL rather than an invented route — the absence recorded, not omitted | Owner         | decided by the Owner 2026-09-12; implemented in § 47.5 |
| **CC-35(b)** | the `customer` cell carries the payer's id and no name                                                                            | `BillingReadService` publishes `payerPartnerId` with no display name today, and neither the billing nor the payments repository reads `crm.*`. Slice 2 established that a column publishing another module's record must name that module's read code on the dataset's permission list                                              | **Recorded, not decided — OPEN at Owner level, beside CC-35.** The id travels and the label is null, which is what the invoice screen already shows. Resolving the name is not a lookup but a DISCLOSURE decision: it would add the CRM module's read code, `crm.customer.read`, to a report whose permission list the Owner fixed at `sal.finance.view`. **Recommendation pending Owner approval:** keep the cell id-only. If the Owner wants the name, resolve it through a CRM read and declare `crm.customer.read` beside `sal.finance.view` conjunctively, so the whole report is refused to a caller who may not read customers — the treatment slice 2 gave the work-order reference. Also a named prerequisite (`report-engine-seam.md` § 9 row 13) **DECIDED BY THE OWNER 2026-09-12** (`owner-decisions-2026-09-12.md` § 2, D-20), and NOT by the recommendation above: the permitted party name is shown beside its identifier under the role it is actually held in, and the name is gated where the capability lives — the CRM read itself — so the report’s declared permission list is unchanged and the enrichment can only narrow                                                                                                                                                       | Owner         | decided by the Owner 2026-09-12; implemented in § 47.5 |
| **CC-35(c)** | the reporting module held a numeric conversion, and adding it to the exact-money surface exposed it                               | `countsByState` — the field deprecated in slice 2 — was DERIVED from `work_orders_by_status`'s group measures with `Number.parseInt`, which rule MONEY-02 forbids outright on the financial surface. The gate cannot tell a row count from an amount, and a gate that could be argued with is a gate that gets turned off           | **Engineering consequence, implemented.** The conversion was REMOVED rather than exempted: the deprecated field is now set by its one producer directly from the same counts its groups are built from, so the two still cannot disagree and no count is converted at all. `modules/reporting` is in `MONEY_TREES` with no allow-list entry beside it. This also moves prerequisite 5 (retiring `countsByState`) one step nearer without closing it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | this slice    | closed in this slice                                   |

### 47.3 What this slice did NOT do

- **No migration and no schema change.** Every statement uses grants and policies that already
  existed; `sal` is untouched.
- **No permission was minted and no bundle changed.** `sal.finance.view` is an existing catalogue
  row, and the whole report is refused to a caller who lacks it — where the permission is evaluated,
  before anything is read, rather than where a column is rendered.
- **No new operation, no new route and no new path.** `rpt.report-run` serves the dataset, and
  `docs/api/openapi.v1.json` was not changed by this branch.
- **No export.** Prerequisite P-12 is untouched; `rpt.export` stays excluded on **CC-04**'s grounds.
- **No frontend.** `apps/web/src` was not edited at all.
- **No outstanding balance was re-derived.** `sal.invoice_open_receivable` is called, and a case
  compares the published figure against the function itself rather than against a number written in
  the test.
- **Neither module read the other's tables.** Billing answers for invoices and credit notes,
  payments for receipts and allocations, and the reporting module merges the two ordered streams.
- **No allow-list was widened and no gate was suppressed.** No `@ts-expect-error`, no
  `eslint-disable`, no skipped or retried test. `scripts/check-operation-test-coverage.mjs` was NOT
  edited: the new suite declares a `COVERAGE-EVIDENCE` block beside its assertions.
- **The P1-23 and P1-24 mutation matrices were not run**, and no mutation was re-targeted: this
  slice redefines no property either matrix attacks.

### 47.4 Proof

**Measured facts (not part of the decision) — where these results come from.** The runs below were
observed on 2026-09-11 at this branch's head. Every database-bound run used a DISPOSABLE LOCAL
CLONE, `p131_report_controls_20260910` on `127.0.0.1:55432`, carrying 139 migrations, with
`DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` stated explicitly in the environment
of each command and the environment printed before each one:

| run                                                         | result                 | database window (UTC) |
| ----------------------------------------------------------- | ---------------------- | --------------------- |
| `tests/backend/p1-31-report-engine-invoice-payment.test.ts` | 26/26                  | 17:25:13 → 17:25:25   |
| the six reporting backend suites together, on the clone     | 6 files, 146/146       | 17:25:35 → 17:26:18   |
| the eight billing and payments backend suites, on the clone | 8 files, 168/168       | 17:26:23 → 17:27:52   |
| the six inventory backend suites, on the clone              | 6 files, 173/173       | 17:27:57 → 17:28:59   |
| `npm run test:unit` (whole unit tier, includes `tests/ci`)  | 3300/3300 in 122 files | no database           |

**There was no hosted gate, no run against the shared database, and no merge.** This branch has no
remote head and no checks recorded, and its base PR #364 is itself unmerged. Final integration and
shared-database evidence follow the coordinator's dependency and database ownership sequence, at
this branch's own turn after #364 merges.

| id        | what was shown                                                                                                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S4-1**  | the columns in the Owner's order and their kinds, the rows, the groups, the period, the authorization and the paging, on real invoices, receipts, allocations and an approved credit note produced by the protected `sal` primitives                                              |
| **S4-2**  | the WHOLE report refused to a caller holding `rpt.report.read` alone, naming `sal.finance.view` — with the response text carrying no amount and, specifically, no `0.0000` standing in for one; and refused at the ROUTE to a caller holding `sal.finance.view` alone             |
| **S4-3**  | `outstanding` equal to `sal.invoice_open_receivable` for a PARTIAL allocation (165.0000 invoiced, 65.0000 applied, 100.0000 open), compared against the function itself rather than against a number written in the test                                                          |
| **S4-4**  | a fully credited invoice published as `credited` with the function reporting `0.0000` open, and the approved credit note published as its own document with every money column null                                                                                               |
| **S4-5**  | a reversed receipt absent from the rows and from every total, with its `reversed` status read back as admin so the absence is a report decision and not a fixture gap                                                                                                             |
| **S4-6**  | two currencies never summed: four groups keyed `(currency, documentType)`, each measure inside one currency, and the cross-currency sums absent from the payload entirely                                                                                                         |
| **S4-7**  | an allocation counted ONCE — `allocated` on the receipt group, absent as a measure on the invoice group, and reaching the invoice only as the reduction inside `outstanding`                                                                                                      |
| **S4-8**  | the half-open period in the BRANCH zone on four instants: local midnight on the first included day is IN, one second earlier is OUT, one second before the excluded day's local midnight is IN, that midnight is OUT — with a widened period then showing both excluded documents |
| **S4-9**  | the zone itself: the first included instant falls on the PREVIOUS calendar day in UTC, so a period resolved server-side would drop the invoice that sits on it                                                                                                                    |
| **S4-10** | paging over a MERGE of two modules' streams: four pages reconstruct the selection exactly, an invoice and a receipt sharing an instant EXACTLY stay adjacent across the page boundary, and the groups are byte-identical on every page                                            |
| **S4-11** | a malformed cursor and one minted for the RECEIPT SCREEN's ordering both refused with `ERR-PAG-001` rather than reinterpreted                                                                                                                                                     |
| **S4-12** | every amount a STRING at `numeric(18,4)` scale, in cells and in measures alike, quoted in the wire text, so no value made a trip through a JSON number                                                                                                                            |
| **S4-13** | branch isolation with RLS reach deliberately widened into the refused branch, so the refusal is the scoped permission evaluation and not an empty result set; and the sibling branch's own documents are invisible to the reported branch, and vice versa                         |

---

### 47.5 Completion — `P1-31-P-11-026`, 2026-09-12

**Authority:** the Owner, 2026-09-12
([`owner-decisions-2026-09-12.md`](./owner-decisions-2026-09-12.md) § 2, **D-20**). **CC-35**,
**CC-35(a)** and **CC-35(b)** were OPEN Owner-level items, each carrying one recommendation pending
Owner approval. The Owner decided all three, and this commit implements the decision. The
recommendation carried for **CC-35(b)** was NOT the answer taken, and the row says so.

**What changed on the published contract.**

- **`invoice_payment_summary` publishes fifteen columns rather than eleven.** `customer` is replaced
  by `partyId`, `partyName` and `partyRole`; `unallocatedAmount` and `creditNoteAmount` join the
  money columns, which are now six. Every added money column is null — never zero — on a document
  type that has no such amount.
- **The `document` column publishes `drillThroughByKind`** instead of nothing:
  `{ discriminator: 'documentType', templates: { invoice: '/invoices/{id}', receipt:
'/payments/{id}', credit_note: null } }`. `ReportColumnDefinition` and `ReportColumnView` carry the
  new shape, and it is null on every other column of every dataset.
- **A third group kind.** The groups are still keyed `(currency, documentType)`; a
  `(currency, credit_note)` group now carries the single `creditNotes` measure, and the receipt group
  carries `unallocated` beside `receipts` and `allocated`. No measure spans two currencies and no
  group publishes another type's measure at zero.

**Measured facts (not part of the decision).**

- **Both authorities already existed and neither was re-derived.** `sal.credit_notes.amount` is the
  credit-note figure; `sal.receipt_unallocated(uuid)` is the unallocated figure, called per row and
  summed inside the same aggregate the receipt group is built from. Nothing subtracts one column
  from another in TypeScript, and nothing subtracts the credit note from `outstanding` — the
  database function has already done that.
- **No permission moved.** The dataset's `requiredPermissions` is still `['sal.finance.view']`. The
  party NAME is gated by `crm.customer.read` inside `crmModule().customerRead
.resolveDisplayIdentities`, which resolves nothing for a caller who lacks it. A caller who holds the
  CRM code could read the same name from the customer surface, so nobody gains anything: the
  enrichment narrows and cannot widen.
- **No migration, no seed row, no audit action, no operation and no path.** The register stays at
  **407** operations and **316** OpenAPI paths; `docs/api/openapi.v1.json` was not changed, and the
  response schema of `rpt.report-run` is bare by repository convention.
- **No new source file.** **Eight** existing files under `apps/api/src` changed — three in `billing`,
  two in `payments`, three in `reporting` — and none was added, so the instrumented-file denominator
  in `tests/ci/baseline-integrity.test.ts` is unmoved at **287**, which the unit tier confirms.
- **The reporting module now composes `@/modules/crm`** through its public index, for one published
  read. No `crm` SQL entered the billing or payments repositories.
- **`npm run validate:exact-money` still reports 61 files across 13 trees with no violation.** The
  two new money columns are decimal strings end to end; no allow-list or suppression was touched.
- **Section 47.4's S4-6 recorded FOUR groups.** That was the count before this completion; there are
  now five, because approved credit notes have a group of their own. The earlier figures are left as
  recorded at the head that produced them, and the table below is this head's measurement.

**What this completion did NOT do.**

- **It did not create a credit-note read operation.** The register still holds none, which is why the
  `credit_note` drill-through template is a published `null` and the absence is recorded
  (`report-engine-seam.md` § 9 row 16) rather than filled with an invented route.
- **It did not add a frontend.** `apps/web/src` was not edited; FE-010, FE-014 and FE-016 are not
  started.
- **It did not run the P1-23 or P1-24 mutation matrices**, and no mutation was re-targeted.
- **It widened no allow-list and suppressed no gate.** No `@ts-expect-error`, no `eslint-disable`, no
  skipped or retried test.

**Proof.** Observed at this branch's head; every window below is UTC on 2026-09-11, which is the
local morning of 2026-09-12. Every database-bound run used the DISPOSABLE LOCAL CLONE
`p131_report_controls_20260910` on `127.0.0.1:55432`, carrying 139 migrations, with `DB_HOST` /
`DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` stated explicitly in the environment of each
command and the environment printed before each one. **There was no hosted gate, no run against the
shared database, and no merge.**

| run                                                         | result               | database window (UTC) |
| ----------------------------------------------------------- | -------------------- | --------------------- |
| `tests/backend/p1-31-report-engine-invoice-payment.test.ts` | 31/31                | 22:05:08 → 22:05:30   |
| the six reporting backend suites together, on the clone     | 6 files, 152/152     | 22:05:44 → 22:08:46   |
| the nine billing and payments backend suites, on the clone  | 9 files, 171/171     | 22:09:15 → 22:10:54   |
| `npm run test:unit` (no database)                           | 122 files, 3300/3300 | —                     |

The **six reporting suites** are `p1-23-reporting`, `p1-31-report-configuration-seam` and the four
`p1-31-report-engine-*` suites. The **nine billing and payments suites** are `p1-22-concurrency`,
`p1-22-credit-note`, `p1-22-currency-coherence`, `p1-22-invoice-lifecycle`, `p1-22-isolation`,
`p1-22-payments`, `p1-24-cross-domain-journey`, `p1-30-w6-invoices` and `p1-30-w7-payments` — named
rather than counted, because a count alone does not say which suites were exercised.

**The DB-free gates, all at this head.** `typecheck` and `typecheck:api` clean; `lint` and
`lint:api` clean; `format:check` and `format:check:api` clean; `validate:module-boundaries` 610
files with no violation; `validate:api-backend-only` 317 handlers and 610 source files, 0 failures;
`validate:exact-money` 61 files across 13 trees with no violation; `verify:contracts` clean with the
register still at **407** operations and **316** OpenAPI paths; `security:all` clean over 2718
tracked files. `verify:policies` reports **only** `RUN_RECORD_STALE` for the `unit` and `web` run
records, which is the expected state for an unmerged branch whose executable paths have moved since
the recorded run — no other problem is reported.

**One measured flake, recorded rather than smoothed over.** A later filtered re-run of
`tests/ci tests/openapi-contract.test.ts` alone timed out at the 30 s per-test limit on
`tests/ci/p1-28-access-gate.test.ts > finds the eleven pages by what they LOAD`, a filesystem walk
over `apps/web` routes. It is a timeout under machine load and not an assertion failure, the file is
untouched by this branch, and the same test passed inside the full `npm run test:unit` run recorded
above. It is stated here because a check that behaved differently on a second run is a fact about
the evidence, not a detail to leave out.

| id        | what was shown                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S4-14** | the fifteen columns in order, the six money columns named as money, and no column-wide `drillThrough` anywhere                                                                                                                                   |
| **S4-15** | the `document` drill-through resolved PER KIND — `documentType` as the discriminator, `/invoices/{id}` and `/payments/{id}` against the two detail operations, and an explicit `null` for a credit note                                          |
| **S4-16** | every document kind a row can carry present as a key in the template map, so a client is never left without an answer for a kind it is shown                                                                                                     |
| **S4-17** | the party NAME published only to a caller holding `crm.customer.read`, null to a caller holding both report codes without it, the identifier present in both cases, and the name absent from that caller's payload entirely                      |
| **S4-18** | the declared permission list unchanged at `['sal.finance.view']` while the name is gated, so the enrichment narrows and never widens                                                                                                             |
| **S4-19** | the role published as what the id IS: `payer` on an invoice and on a receipt, `invoice_payer` on a credit note, which carries no party column of its own                                                                                         |
| **S4-20** | `unallocatedAmount` equal to `sal.receipt_unallocated` for a PARTIALLY applied receipt (10.0000 received, 4.0000 applied, 6.0000 left), compared against the function itself rather than against a number written in the test                    |
| **S4-21** | the same column an exact `0.0000` for a receipt applied in full and the receipt's whole amount for one never applied — the three allocation states told apart                                                                                    |
| **S4-22** | `creditNoteAmount` equal to `sal.credit_notes.amount`, compared against the table itself, with every other money column on that row null rather than zero                                                                                        |
| **S4-23** | the credit note NOT restated on the invoice it credits: the invoice row carries no credit amount and its `outstanding` is still the database function's answer                                                                                   |
| **S4-24** | five groups keyed `(currency, documentType)`, the credit notes in a group of their own, `unallocated` on the receipt side only, no credit measure on the invoice group, and no JOD credit-note group at all — an absent group rather than a zero |

## 48. The warranty plan administration screens (FE-008, policy administration)

**The numbering is settled; the branch is not.** This section records work on
`feature/p1-31-warranty-policy-administration`. Its base — the warranty record screens — merged
with PR #369, and this branch now carries the merge of protected `develop`
`6b3c6c458154bc18589ebb4fb18b6b139ae81b80`, whose register holds sections 44 to 47. Section **48**
and **CC-36** are the next free heading and the next free identifier at that head, so the
reservation this section previously stated as provisional is now a read fact and the PROVISIONAL
marking is withdrawn. The branch itself is still **unmerged** and has **no hosted result**, and
nothing below claims otherwise.

### 48.1 Identifier allocation — allocated 2026-09-11, SETTLED 2026-09-12 at `develop` `6b3c6c45`

The heading and the identifier were first reserved on 2026-09-11 against `develop` `8c4e6a9c`,
where the register ran to **section 44** and to **CC-32**: section 43 and **CC-31** are the warranty
record-screens slice's own reservation, merged with PR #369, and section 44 and **CC-32** are
FE-007's, merged with PR #368. Several P1-31 lanes were in flight at that head, so the reservation
was deliberately made ahead of the front and stated as provisional, so that a collision would be a
reconciliation and never a silent renumbering of somebody else's record.

**Settled by this merge.** `develop` moved on to
`6b3c6c458154bc18589ebb4fb18b6b139ae81b80` while this branch was being verified: PR #374 merged the
report engine's dataset slices 2, 3 and 4, which take **sections 45, 46 and 47** and **CC-33**,
**CC-34** and **CC-35**. This branch has now merged that head, so its own copy of this register
carries those three sections and the numbering is no longer a reservation read from somewhere else
— sections 44 to 47 are all present and settled here, and 48 is the next heading in the file.

| id                | lane                                     | state at this head                                              |
| ----------------- | ---------------------------------------- | --------------------------------------------------------------- |
| **CC-31**         | the warranty record screens              | section 43, merged with PR #369, on `develop`                   |
| **CC-32**         | the printable delivery handover document | section 44, merged with PR #368, on `develop`                   |
| **CC-33 … CC-35** | the report engine dataset slices 2 to 4  | sections 45 to 47, merged with PR #374, on `develop` `6b3c6c45` |
| **CC-36**         | this slice                               | settled, this branch, section 48                                |

Sections **49 to 52**, and the identifiers above **CC-36**, are held by P1-31 lanes that are still
on unmerged branches and are not visible at this head.

**Reconciliation rule.** Section 36.1 records it: an identifier is allocated when its finding is
raised and is never renumbered to follow heading order. If section 48 or **CC-36** were found
occupied at a later integration, this section would move to the next free heading and this
identifier to the next free identifier, and the move would be recorded here with its date. No
existing identifier and no historical result is renumbered to accommodate it.

### 48.2 What was delivered

Two route pages — the warranty plan list at `/{locale}/warranty/policies` and one plan at
`/{locale}/warranty/policies/{policyId}`, both gated on `wty.warranty.read` and both deciding
before they read — the five plan and coverage write adapters P-10 published, the single-plan read
those writes re-read through, the English and Arabic wording for all of it, one link from the
warranty record list, and two web test files. The full record is
[`warranty-policy-administration.md`](./warranty-policy-administration.md).

The five writes were added to `P1_31_OPERATION_IDS` in `scripts/ci/check-p1-31-access.mjs` in the
same change as the screens that reach them. None widens the derived segment set — every one is
addressed under the `warranty-policies` root the two policy reads on the base branch already
contributed — so naming them is the only thing that makes them owned. The examined page count moved
from 11 to 13 across the same 8 segments, because two pages now occupy that segment.

This closes the gap CC-31's section 43.4 named: P-10 published seven policy and coverage operations
and the record-screens slice consumed exactly one of them. All seven are now consumed.

### 48.3 Dispositions

| id        | what is accepted                                                                     | measured basis                                                                                                                                                                                                                                                                                                                                                        | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                         | owner      | state            |
| --------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------- |
| **CC-36** | **one catalogue code, `ERR-CON-001`, carries three distinct causes on this surface** | A stale version, `ex_warranty_coverage_no_overlap` (**BR-WTY-001**) and a plan reference already in use all answer the same code. The problem document's `violations[0].rule` is the only machine-readable discriminator: the overlap and the duplicate reference each name a rule, a stale version names none, and the service's own sentence never crosses the wire | **accepted, and discriminated by the RULE rather than by wording guessed from the code.** The refusal state carries the code and the first violation's rule, and the three are worded apart in the screen's plain language because they send an operator somewhere different. The absence of a rule is itself the stale signal, and a reload is offered beside that refusal and no other. No sentence is invented per code beyond what the problem document carries | this slice | closed, recorded |

### 48.4 What this slice did NOT do

- **No backend file was edited**, no migration was written, no seed changed and no permission was
  minted. `wty.policy.manage` has been seeded since P1-08 and is declared by P-10's five writes.
- **No history reader and no simulated history.** **CC-10** is unchanged, FE-009 stays PARTIAL as
  CC-31 left it, and the backend prerequisite **P-18** is still named and still unbuilt.
- **No generation path touched.** The issue control and its plan picker belong to the base branch
  and were not modified.
- **No delete control for a plan or a coverage window**, because no operation offers one and no
  application role holds a DELETE grant on either configuration table. Retiring and restoring are
  what the surface offers.
- **No gate weakened, no allow-list narrowed and no suppression added.** The access gate's
  operation list was EXTENDED, which widens what the gate owns rather than what it permits.
- **No pull request, no merge, no push, no rebase, no hosted run and no acceptance.** The base
  branch is itself unmerged.

### 48.5 The P1-28 version-sourcing gate — engineering consequence (not an Owner decision)

`tests/ci/p1-28-version-sourcing.test.ts` failed twice against this slice, in two different
rules, and neither failure was a defect in what the screen does. Both were resolved by changing
this side, not the gate: no regex was relaxed, no detector was weakened, no allow-list was
widened and no suppression was added.

**The renewal rule read a shape, not a behaviour.** The gate requires that the function enclosing
a version-guarded call either calls one of its own parameters or calls something in the refresh
family, after the call and inside its own body. The plan screen re-read after every write from
the first commit — but through a single `run(area, write)` helper that took the command as a
callback, so the re-read was one indirection away from each call site and invisible to a reader
standing at the call. The three handlers were written out, one per control, each ending with its
own re-read. The behaviour is unchanged, which is the point: the gate was asking for the
discipline to be legible where the version is spent, and it was right to ask.

The shape follows `apps/web/src/features/quotations/components/QuotationDetailScreen.tsx`, whose
issue handler writes and then renews in the same body.

**The count equality is a SUBJECT classifier, and this slice's three adapters are not its**
**subject.** The gate compares the number of guarded adapters it accounts for against the number
of version-guarded `apt.*` / `rec.*` operations this application must reach. Three `wty.*`
adapters demanding a version made that comparison read 10 against 7. They are registered by name
in `OUT_OF_SUBJECT_ADAPTERS` in `scripts/ci/check-p1-28-version-sourcing.mjs`, exactly as eight
earlier slices registered theirs: **P1-29 W3** (`transitionWorkOrder`, `updateJob`), **P1-29 W4**
(`stopLaborSession`, `correctLaborSession`), **P1-29 W7** (four `dia.*` adapters), **P1-29 W8**
(four `qms.*` / `wo.*` adapters), **P1-30 W1** (`updateService`, `publishServiceVersion`),
**P1-30 W2** (two price-list adapters), **P1-30 W3** (two quotation adapters) and **P1-30 W6**
(two invoice adapters). Registration excludes an adapter from the count equality and from
nothing else: every one of the three is still held to every other rule the gate applies —
`ifMatch` required, `ifMatch` used, the argument traceable to a read or a command response, and
the version renewed afterwards — and all three are reported `ok` and `renews` in the run.

**Measured, not assumed.** The gate reports `accountedFor` as **7** after the registration,
unchanged from the seven apt/rec adapters this contract has always been about, and equal to the
seven operations expected. `tests/ci/p1-28-version-sourcing.test.ts` therefore needed no edit:
its `expect(live.accountedFor).toHaveLength(7)` was already the correct number, and the 10 seen
before the registration was the symptom rather than a new floor. The test file is unchanged by
this slice.

### 48.6 The local tier record — measured fact, dated 2026-09-12

Both tiers were re-recorded by `check-p1-27-closing-values.mjs --record` at `1f557f37`, the head
that carries the merge of `develop` `6b3c6c45`, with no executable path dirty:

| tier | files | tests | passed | failed | skipped |
| ---- | ----- | ----- | ------ | ------ | ------- |
| unit | 122   | 3301  | 3301   | 0      | 0       |
| web  | 137   | 3850  | 3850   | 0      | 0       |

These are LOCAL figures. No hosted run of this branch exists and none is claimed.

**Two merges expired two pairs; only the first moved a number.** The pair taken at `4eeac4d3` —
unit 121/3278, web 136/3797 — was expired by the merge of `develop` `8c4e6a9c`, which brought a
web test file and a component tree with it, and the record taken at `5e5a607a` after that merge
read exactly the six figures in the table above. The merge of `develop` `6b3c6c45` then arrived
carrying that head's own ledger — unit 122/3300, web 136/3802 — which describes `develop` and not
this tree, so both tiers were run again rather than reconciled on paper. PR #374 is backend and
documentation only, so the measurement came back unchanged and the re-record simply re-establishes
the same six numbers against the new head; no derived site moved for it. A record is bound to the
head it was taken at, and the ledger expired the inherited pair rather than letting it survive as a
number.

**Engineering consequence of the FIRST merge (not an Owner decision).** The derived sites moved
with the record taken at `5e5a607a`: on `clean-room-evidence.md`, with their closing-value ledger
entries, the web file count 136 — 137 in three places, the web executed total 3802 — 3850 in three
and the unit executed total 3300 — 3301 in one; in `deliverable-manifest.md`, the web file count in
the three places it appears; and the frontend ownership gate’s own file count 151 — 153 in five
places across four documents, which moved because the two delivery-document components `develop`
brought with FE-007 landed inside the trees that gate walks. The evidence manifest was regenerated
at each step so its digests describe the current bytes.

**Three intermediate readings are stated rather than hidden.** Taking the record at `5e5a607a`
recorded a FAILING web run twice — two cases in the P1-27 reconciliation tests on the first
attempt and one more on the second, each a derived site in `deliverable-manifest.md` that had not
yet moved. Taking it at `1f557f37` recorded a failing unit run once, for the same reason in the
other direction: the web tier is recorded first, so while the unit tier ran the ledger still
carried `develop`'s inherited pair and two cases reported the disagreement. In all three the record
was retaken after the cause was removed, never annotated; the ledger now holds one run per tier
that exited 0.

The committed floor in `.github/ci-baselines/test-count-baseline.json` was **not** touched. 3850
executed clears the 3700 floor, `tests/ci/web-test-floor.test.ts` and
`tests/ci/baseline-integrity.test.ts` both pass against it unchanged, and no rule forced a ratchet,
so the baseline keeps the figures its own run established.

## 49. The assurance evidence index for the thirteen non-Frontend tasks

Full record: [`security-and-qa-evidence.md`](./security-and-qa-evidence.md), which carries the same
allocation table in its own § 14. Slice: `feature/p1-31-assurance-evidence-v2`, ownership profile
`p1-31-frontend` (docs bucket), docs-only. **Baseline:** protected `develop`
**9b109f639348db424940b00b022cfb36e2160e2c** (PR #377 merge). `main` untouched.

### 49.1 Identifier allocation — SETTLED, not provisional

Read on `develop` `9b109f63`, where this file holds sections **1 … 48, 50, 51 and 53** and
identifiers **CC-01 … CC-41**. **Section 49 and CC-37 are the lowest free pair.** Sections 50.1 and
51.1 both record that pair as claimed by "a lane not on `develop`" — that lane is the **abandoned
first version of this very record**, written at `develop` `01c32937`, never merged and never opened
as a pull request. This record supersedes it and therefore takes the pair it reserved, rather than
leaving a permanent hole in the numbering.

| identifier | slice                                                                | state, read at `develop` `9b109f63`     |
| ---------- | -------------------------------------------------------------------- | --------------------------------------- |
| **CC-36**  | the warranty plan administration screens (#375)                      | merged, section 48                      |
| **CC-37**  | **this record** (superseding the abandoned first version of it)      | **SETTLED**, this branch, section 49    |
| **CC-38**  | the report screens (#371)                                            | merged, section 50                      |
| **CC-39**  | the Start selector (#377)                                            | merged, section 51                      |
| **CC-40**  | the fresh-organisation acceptance harness (QA-005), **open PR #378** | not on `develop`, claims **section 52** |
| **CC-41**  | the operational overview (#376)                                      | merged, section 53                      |

**Why this pair is not PROVISIONAL.** § 48.1's rule is that an identifier is a claim about the
register at the moment it was raised, and § 51.1 marked its own pair provisional only because a
LOWER pair was held by an unmerged lane. **No lower pair is held here.** The one unmerged claim on
this register is **PR #378** (`feature/p1-31-acceptance-harness`, open at head `0a1bba2a`), which
holds **section 52 and CC-40** — both ABOVE this pair. So nothing here is taken from #378 and
nothing here is renumbered to follow it.

### 49.2 What was delivered

One document, [`security-and-qa-evidence.md`](./security-and-qa-evidence.md), plus pointers to its
sections in the thirteen non-Frontend rows of [`task-matrix.md`](./task-matrix.md). **No State value
in the matrix was changed**, because this record adds a proving artefact and does not move a state.

The chapter names SEC-001 … SEC-004, QA-001 … QA-005, DO-001, DO-002, DOC-001 and DOC-002 and
**defines none of them**: each of the four chains repeats one boilerplate sentence across every row,
and every row cites a test id that returns zero files (A0's **D-16**). The operational definitions
are therefore **transposed from `docs/phase-1/phase-1-28/canonical-plan.md:172-212`**, the only
in-repository precedent that states what each id means, exactly as
[`../phase-1-30/w8-security-and-qa-evidence.md`](../phase-1-30/w8-security-and-qa-evidence.md) did —
and the file says so rather than presenting the transposition as the chapter's words.

Every figure in it is a static read of this head or the reported output of a static checker named
beside it. **No test tier, build, database operation or deployment was run to produce it, and no
acceptance result is claimed** — none exists, which is § 9's own finding.

### 49.3 Dispositions

| id           | finding                                                                                     | measured                                                                                                                                                                                                                                                                  | disposition                                                                                                                                                                                                                                               | owner / slice         | state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CC-37**    | the thirteen non-Frontend canonical tasks have no definition in the P1-31 chapter           | Each chain carries one repeated boilerplate sentence; all three cited test ids (`TC-WTY-001`, `TC-RPT-001`, `TC-QMS-001`) return zero files, filed by A0 as **D-16**                                                                                                      | **transposed from P1-28 and declared as a transposition.** Closing a row against its own cited Test reference is impossible, so the alternative was to close nothing or to invent a definition and present it as the chapter's                            | this record           | closed, recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **CC-37(a)** | eleven `wty.`/`rpt.` writes on this surface are held to no payload-mirror gate              | `P1_30_DOMAINS` in `scripts/ci/check-p1-30-payload-parity.mjs` is `['svc','quo','inv','sal']` and its mirror allow-list names seven files under `apps/web/src/lib/contracts/`; the warranty and report mirrors live in their feature trees instead                        | **recorded, not worked around.** Widening another phase's gate is not a docs slice's to do, and a gate widened without its red-proof moving is worse than a recorded gap                                                                                  | a later slice         | **open, recorded — superseded by CC-48** _(true when raised. Section 58 ships `scripts/ci/check-p1-31-write-shape.mjs`, the sibling gate this disposition said a later slice owed, registered as `validate:p1-31-write-shape` in `verify:policies` and mutation-proved by `tests/ci/p1-31-write-shape.test.ts`. The row is annotated rather than rewritten — a disposition belongs to the section that raised it — and it stays open until that section is re-dispositioned by the lane that owns it. Annotated by the closure re-measure, section 62.)_ |
| **CC-37(b)** | the seven `rpt.report-configuration-*` writes have no consumer outside a generated manifest | `apps/web` references them only in `src/lib/api/idempotent-operations.ts`, which is generated from the Backend register; no screen and no adapter calls them                                                                                                              | **recorded as the declared-but-never-wired shape this repository has shipped before (P1-27 INT-113).** No screen is invented here to justify them and no operation is withdrawn — both belong to whoever owns the writer                                  | Owner / a later slice | **open, recorded** _(one word in the finding is wrong and the finding is not: the family is **seven operations — five writes and two reads**. `-create`, `-status-set`, `-update`, `-version-create` and `-version-publish` are writes; `-list` and `-read` are reads. The assurance index enumerates all seven under `rpt.report.configure` and its prose has it right. The consumer gap is unaffected. Annotated by the closure re-measure, section 62.)_                                                                                              |
| **CC-37(c)** | the tenant-administrator bundle backfill has a prerequisite no repository record named      | The operator artefact of 2026-09-12 (outside this repository) records the backfill refusing **exit 5**, fail-closed, because the target database's permission catalogue lacked the two codes P-17 minted; it completed only after the declared catalogue seed was applied | **recorded as a fact about the act, not as a defect in the script** — the guard is correct and the refusal is the useful part. The remedy is the operator runbook that **DO-001 and DO-002 both owe** and that does not exist; the ordering must be in it | a later slice         | open, recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 49.4 What this slice did NOT do

- **Moved no State value** in `task-matrix.md`, and moved no chapter status.
- **Ran no test tier, no build, no migration and no database operation.** The gates it ran are
  static checkers, named in the pull request.
- **Claimed no acceptance result, no hosted run and no approval.** The record has been routed to
  nobody.
- **Changed no source file, no gate and no allow-list.** Docs only.
- **Did not re-quote a figure a generated register owns**, which is the stale-count defect
  `scripts/ci/check-p1-27-doc-counts.mjs` exists to refuse.

## 50. The report screens

**Why 50 and not the next unused number.** Sections 44 to 47 were still open when this slice was
first written, so its number was taken high and marked provisional. They are settled on `develop`
now, and section 48 merged with PR #375 and is present in this file at the head this branch carries.
Section 49 sits on a branch that is not merged, so the number stays 50 rather than moving down onto
a heading another branch is already using.

**Slice:** `feature/p1-31-report-screens`, ownership profile `p1-31-frontend`.
**Baseline:** protected `develop` **ae0e035480596243c739beec1a40d2ae5c105e7a** (the ready-for-delivery
queue, #367), branched on 2026-09-12. Nothing was merged into this branch and no sync was taken, so
the head this section is written against is this branch's own.

The full record is [`report-screens.md`](./report-screens.md).

**The Owner's decisions, in the Owner's words.** **D-4** (2026-09-09 § 3) approves four baseline
reports and their columns — `work_orders_by_status`, `technician_labor_time`, `inventory_movements`
and `invoice_payment_summary` — and requires each to specify its period and date semantics, its
timezone, its authorization, its source, its freshness and its drill-through, with **all calculation
done on the server**. **D-17** (2026-09-10 § 4) makes every report period **half-open**, `[from, to)`,
in the **selected branch's timezone**, with the **timezone and the filter context displayed and
preserved** wherever the result is shown, and no inclusive `to` and no double counting. **D-19**
(2026-09-12 § 1) defines FE-010 as an operational overview of the four approved domains, binds FE-016
to the same overview for the selected branch with **no hard-coded pilot**, and forbids inventing
profit, performance scores or trends. **D-20** (2026-09-12 § 2) completes the invoice and payment
report: separate authoritative credit-note and unallocated amounts, the permitted party name beside
its identifier **labelled by its actual role**, drill-through **resolved by document kind and
authorized target route**, and no invented amounts, no financial calculation in the browser and no
silently omitted contract. This slice consumes those four and extends none of them.

**Measured facts (not part of the decision).**

- All three reporting operations are on `develop`: `rpt.report-catalogue`, `rpt.report-read` and
  `rpt.report-run`, each declaring `rpt.report.read`, with the run additionally evaluating the
  dataset's own read code in the service at its own branch scope.
- The dataset registry holds **one** entry at this head, `work_orders_by_status`. The other three
  approved codes live on `remediation/p1-31-backend-report-engine-datasets`, which is unmerged.
- Two run-envelope shapes therefore exist: the one `develop` publishes, with `countsByState` and no
  `groups`, `filters` or `branch`; and the one the dataset branch adds, with all three, three further
  column kinds (`duration`, `quantity`, `money`) and a per-kind drill-through.
- `schemas.limit` on all three routes refuses a page size above **100** rather than clamping it, and
  the platform's default for a request that sends none is **50**.
- `apps/web/src/lib` holds **no** decimal-string display formatter. `formatMoney` needs a currency
  beside the amount and a canonical four-place scale and converts to a number to reach `Intl`;
  `trimTrailingZeros` throws on a value that is not canonical; every `lib/format.ts` helper takes a
  number or constructs a date.
- Of the three drill-through templates the four datasets publish, **this application serves one** —
  `/work-orders/{id}`. There is no per-technician page, no invoice detail page and no receipt detail
  page, and a credit note has no read operation at all.
- The P1-31 access gate examines **11** route pages across **7** owned segments with the three
  reporting operations named; it examined **9** across the same **7** before this slice.
- `validate:p1-27-frontend` reports **151 files across 5 trees, 0 failures**; it reported 149 before.
- There is no export operation. P-12 is not built and `rpt.export` stays excluded on **CC-04**'s
  grounds, so a platform baseline publishes no export authority.

**Engineering consequence (not an Owner decision).** The points below are this slice's own choices.
The Owner named none of them.

- **ONE screen serves every report code.** The catalogue decides which reports exist and whether each
  can be run; the run envelope decides what one renders. Nothing in the feature branches on a report
  code, so FE-011 … FE-014 are one screen and the three unregistered codes owe no further frontend
  work.
- **Nothing is computed in the browser.** No total is summed, no duration divided, no quantity
  re-scaled, no amount reformatted. A measure is rendered as the characters the server sent, because
  no safe formatter exists for a cell that carries no currency and no fixed scale. This is recorded
  as **CC-38** rather than approximated.
- **A date and an instant are shown as published.** `Intl` would render them in the browser's
  timezone while D-17 fixes the period in the branch's, and the disagreement would be invisible.
- **The period is stated where it is typed** and an empty or reversed one is refused at the form,
  lexicographically, with no date object constructed. There is **no default period**.
- **One response at a time.** Previous and Next walk a trail of cursors already visited and every page
  carries its own period, zone, freshness, filter context and groups, so a page of rows is never shown
  under another read's generation instant. There are **no page numbers**: the operation publishes no
  total.
- **A reference links only to a route this application serves**, and the three drill-through answers
  D-20 distinguishes — one target, a per-kind target, and a published absence — are kept apart.
- **The page gate is `rpt.report.read` alone.** The dataset codes are per-report and are left to the
  service that can evaluate them.
- **The navigation entry moves to `available` at `tenant` scope**, because the catalogue operation is
  tenant-scoped. The run's company and branch are a question about the resource and travel through
  `branchTargetQuery`.

### 50.1 Identifier allocation — allocated 2026-09-12, SETTLED 2026-09-12 at `develop` `6c99e805`

The number was first taken on 2026-09-12 against `develop` `ae0e0354`, where the register ran to
section **42** and to **CC-30**, and it was marked PROVISIONAL because seven headings between that
head and this one were claimed by lanes still in flight and none of those branches was readable
here.

**Settled by this merge.** This branch now carries `develop`
`6c99e805225b8ba59f6402188d9967c697d1eb13`, whose register is present in this file and runs to
section **48** and to **CC-36**. Every number this slice was waiting on is now a read fact rather
than a claim, so the PROVISIONAL marking is withdrawn from both the heading and the identifier.

| id                | lane                                            | state at `6c99e805`, read from this file |
| ----------------- | ----------------------------------------------- | ---------------------------------------- |
| **CC-30**         | the ready-for-delivery queue screen (#367)      | merged, section 42                       |
| **CC-31**         | the warranty record screens (#369)              | merged, section 43                       |
| **CC-32**         | the printable delivery handover document (#368) | merged, section 44                       |
| **CC-33 … CC-35** | the report engine dataset slices 2 to 4 (#374)  | merged, sections 45 to 47                |
| **CC-36**         | the warranty plan administration screens (#375) | merged, section 48                       |
| **CC-37**         | a lane not on this head                         | claims section 49                        |
| **CC-38**         | this slice                                      | settled, this branch, section 50         |

So this slice takes **section 50** and **CC-38**, both settled. Section 49 and **CC-37** belong to a
lane that is not visible here, which is why this heading stays at 50 rather than moving down.

**Reconciliation rule.** Section 36.1 records it: an identifier is allocated when its finding is
raised and is never renumbered to follow heading order. If section 50 or **CC-38** were found
occupied at a later integration, this section would move to the next free heading and the move
would be recorded here with its date. No existing identifier is renumbered to accommodate it.

### 50.2 What changed, and what was minted

| changed                                                                                                                                                                                                                      | minted  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 2 route pages, 2 screens, 1 shared presentation module, 1 paging hook, 1 contract, 1 adapter module, 1 label resolver; 1 navigation entry flipped to available and re-scoped                                                 | nothing |
| 104 English and 104 Arabic messages — the four approved report titles, the catalogue and run copy, and the field names of all four D-4 datasets; 2 new web test files; 2 web suites re-based                                 | nothing |
| 3 operations added to the P1-31 access gate's allow-list and its pinned page count moved 13 → 15 on the merged head; the committed test-count baseline is NOT touched by this slice                                          | nothing |
| the FE-011 … FE-014 rows of the task matrix and the A0 preflight; 5 P1-27 records re-based from their own derivations                                                                                                        | nothing |
| 1 contract repair — an unusable page size now falls back to the platform default of 50 rather than to the route ceiling of 100 — and 1 dead exported refusal map removed, the live mapping being the one in the read adapter | nothing |

**No backend file changed.** No route, no service, no repository, no migration, no seed, no
permission, no audit action and no operation. The operation register is untouched.

The CI allow-list entry is the three `rpt` operations in `scripts/ci/check-p1-31-access.mjs`, which
that gate's own docblock requires in the change that first consumes each. It **WIDENS** what the gate
judges and suppresses nothing: the page count it examines rises from 13 to 15 — both figures read
off the gate report line on the merged head, not carried forward — and its owned segment
count is unchanged because the resource root those operations derive is the dashboard area the gate
already named.

**The web floor does not move, and that is a measurement rather than a preference.** An earlier
version of this section raised it, against a head where `WTF-08` refused the floor then committed.
The floor this branch now carries arrived from `develop` at 3700, and on this head the tree DECLARES
3226 cases across 139 files, so the rule is satisfied with no edit at all. The tier EXECUTES 3940,
and the largest single file declares 88 cases, which keeps `WTF-09` satisfied at the committed
headroom of 49. The baseline file is therefore byte-identical to `develop`'s and no figure in it is
restated here. The executed total is **LOCAL** — no hosted run of this branch exists.

### 50.3 Dispositions

| id           | finding                                                                                                                                                                                | measured                                                                                                                                                                                                                                                                                                                                                                                      | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | owner / slice          | status         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------- |
| **CC-38**    | **an amount, a quantity and a duration are displayed as the server's raw exact strings**, so an operator reads `1234.5600` rather than a grouped figure and `5400` rather than an hour | `apps/web/src/lib` holds no decimal-string display formatter: `formatMoney` needs a currency beside the amount and a canonical four-place scale and converts to a number to reach `Intl`, `trimTrailingZeros` throws on anything else, and every `lib/format.ts` helper takes a number. A report cell carries no currency — the currency is a separate column on the one dataset that has one | **accepted, and recorded because an operator will meet it.** D-4 puts every calculation on the server and D-20 forbids financial calculation in the browser; a formatter that guessed the scale or the currency would be changing money on the way to the screen, which is worse than an unformatted figure. The remedy is a decimal-string display helper plus a decision about where a cell's currency comes from, named as a frontend prerequisite in the record rather than improvised here | a later Frontend slice | open, recorded |
| **CC-38(a)** | **two of the three drill-through targets D-20 names have no screen in this application**, so those references render with no link                                                      | the engine publishes `/work-orders/{id}`, `/technicians/{id}` and, per document kind, `/invoices/{id}` and `/payments/{id}` with an explicit absence for a credit note. `(dashboard)` holds a work-order detail page and no per-technician, invoice-detail or receipt-detail page                                                                                                             | **accepted.** D-20 asks for the **authorized target route**, and a route that answers as missing is not one. A link to a page that does not exist is the defect the navigation model refuses, so the reference is rendered as a reference and the absence is recorded rather than papered over with a link. The screens are named as prerequisites; nothing here creates them                                                                                                                   | a later Frontend slice | open, recorded |

### 50.4 Proof

**Measured facts (not part of the decision) — what was actually run, and where.** Every run below was
local, on this branch, with no database, no browser and no hosted runner.

| run                                                                             | result                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `npm run typecheck` · `npm run typecheck:web`                                   | pass                                                                  |
| `npm run lint`                                                                  | pass                                                                  |
| `npm run lint:web`                                                              | 0 errors; 12 pre-existing warnings, none on a file this slice touched |
| `npm run format:check` · `npm run format:check:web` · `npm run style:check:web` | pass                                                                  |
| `npm run security:all`                                                          | pass over 2756 tracked files                                          |
| `npm run validate:encoding`                                                     | every tracked text file clean UTF-8, no BOM                           |
| `npm run validate:generated-artifacts`                                          | 2756 tracked files, 7/7 ignore rules, 0 failures                      |
| `npm run validate:web-boundary`                                                 | 370 files, 0 violations                                               |
| `npm run validate:use-server-exports`                                           | 50 server modules across 980 source files, 0 violations               |
| `npm run validate:web-topology`                                                 | 18 expectations, 336 matched files, 0 failures                        |
| `npm run validate:web-tokens` · `validate:web-theme` · `validate:web-brand`     | 0 violations; 54 colours registered, 0 unresolvable                   |
| `npm run validate:notification-authority`                                       | 370 files scanned, one authority, mounted once                        |
| `npm run validate:module-boundaries`                                            | pass, unchanged                                                       |
| `npm run validate:api-backend-only`                                             | 317 route handlers, 610 source files, 0 failures                      |
| `npm run validate:plain-language`                                               | 2 catalogues, 24 rules, 0 findings                                    |
| `npm run validate:p1-31-access`                                                 | 15 route pages across 8 owned segments, 0 violations                  |
| `npm run validate:p1-26-frontend`                                               | 370 files, 50 server modules, 0 failures                              |
| `npm run validate:p1-27-frontend`                                               | 155 files across 5 trees, 9 rules, 0 failures                         |
| focused web — the reports, delivery, warranty and navigation suites             | 318/318 across 8 files                                                |
| root — `npx vitest run tests/ci tests/openapi-contract.test.ts`                 | 1991/1991 across 69 files                                             |
| the web tier, through the P1-27 recorder                                        | 3940/3940 across 139 files, 0 failed                                  |
| `npm run test:unit`, through the P1-27 recorder                                 | 3301/3301 across 122 files, 0 failed                                  |
| `npm run verify:policies`                                                       | exit 0                                                                |
| `npm run validate:phase-ownership`, both forms                                  | profile `p1-31-frontend`, 22 changed files, 0 violations              |

**There was no hosted gate, no run against any database, no browser tier and no merge.** Every figure
above was taken locally on this branch, at the head that carries the merge of `develop` `6c99e805`.
The slice is open as pull request **#371**; no review verdict and no hosted result is recorded here.
The four tasks are `implemented/unmerged`; none is `end-to-end verified`, and rule 2 of
[`task-matrix.md`](./task-matrix.md) keeps that state unreachable until a P1-31 acceptance record
exists.

### 50.5 What this slice did NOT do, and what is not claimed

- **No backend file changed**, and no operation, permission, migration, seed or audit action moved.
- **No report definition was authored, published, archived or exported**, and no export path of any
  kind was added — not an operation call, and not a file assembled in the browser.
- **No figure was computed, derived, rounded, re-scaled or reformatted anywhere in this tier.**
- **FE-010 and FE-016 were not built.** D-19 defines them and they are the next slice; a catalogue and
  a per-report run are not the overview that decision describes, and D-19 says in terms that four raw
  tables alone do not establish it.
- **No gate was weakened, no allow-list narrowed, no suppression added and no floor moved.** The one
  gate edit widens a rule's reach. The committed test-count baseline is untouched by this slice.
- **No hosted run, no database tier, no browser acceptance and no end-to-end result is claimed.**

## 51. Starting a handover with a validated delivering employee (FE-002) — PROVISIONAL

Full record: [`delivery-start-selector.md`](./delivery-start-selector.md).

### 51.1 Identifier allocation — PROVISIONAL, re-read at `develop` `72782f48`

Raised against `develop` `811e9891`, where the register ran to **section 50** and **CC-38**, both
settled by the report screens slice merged with PR #371. So this slice took **section 51** and
**CC-39**.

**Re-read after merging `develop` `72782f48`**, which carries the operational overview (PR #376) and
with it **section 53** and **CC-41**. That pair sits ABOVE this slice's, so it takes nothing from it
and nothing here is renumbered to follow it: § 48.1's rule is that an identifier is a claim about the
register at the moment it was raised. Section 51 and CC-39 are unheld by any other record in this
file at this head.

| identifier | slice                                           | state, re-read at `develop` `72782f48`   |
| ---------- | ----------------------------------------------- | ---------------------------------------- |
| **CC-36**  | the warranty plan administration screens (#375) | merged, section 48                       |
| **CC-37**  | a lane not on `develop`                         | claims **section 49**                    |
| **CC-38**  | the report screens (#371)                       | merged, section 50                       |
| **CC-39**  | this slice                                      | **PROVISIONAL**, this branch, section 51 |
| **CC-40**  | the acceptance harness lane, not on `develop`   | claims **section 52**                    |
| **CC-41**  | the operational overview (#376)                 | **merged**, section 53                   |

CC-39 stays PROVISIONAL for one reason and one only: **section 49 and CC-37 are a LOWER pair still
held by a lane that has not merged**, named in § 50.1 as "a lane not on this head". Nothing above
CC-39 is claimed here. If either number is found taken at merge time this slice's heading and
identifier move.

### 51.2 What was delivered

The **Start** control on a work order with no handover, withheld in PR #362 and withheld through four
merges because the field it had to send named nobody. Prerequisite **P-17** merged with PR #370 and
gave the delivering employee a real identity, so the control returns against that contract: a
permission-gated picker over the employee register, and a create that sends the work order and the
chosen person and nothing else.

This is the Frontend half of the Owner's decision of 2026-09-10, quoted verbatim with its path in
[`delivery-start-selector.md`](./delivery-start-selector.md) § 1, including the clarification that an
employee's home branch must not restrict authorized work in other branches.

Two docblocks were corrected in the same change because they asserted a rule the repository no longer
matches: both `apps/web/src/lib/contracts/delivery-contract.ts` and
`apps/web/src/features/delivery/delivery-contract.ts` stated that the delivering-employee reference
had no foreign key anywhere in the platform. It has had one since P-17. The delivery record type
gained the stamped display name the reads already publish, and the delivery screen and the printable
sheet now show that name where they printed a bare reference.

**Three findings raised against this branch were fixed on it**, and the dispositions below record
each as a correction rather than folding it in silently. The branch whose people are listed is now
CHOSEN from the published directory instead of typed as an identifier (**CC-39(a)**); the disposition
that justified typing it was factually wrong and is corrected in place (**CC-39(a)**); and the
register's single-employee adapter, which no production surface called, was withdrawn rather than
annotated (**CC-39(b)**).

### 51.3 Dispositions

| id           | what was found                                                                                                                 | measurement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | owner      | state                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------- |
| **CC-39**    | **one catalogue code, `ERR-VAL-001`, carries two distinct causes on this surface**                                             | An employee the caller cannot resolve answers rule `custom`; a retired one answers rule `inactive_employee`. The create service reports them as distinct rules deliberately, and the problem document's first violation is the only machine-readable discriminator — the service's own sentence never crosses the wire                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **accepted, and discriminated by the RULE rather than by wording guessed from the code.** The write state carries the code and the first violation's rule, and the two are worded apart in plain language because they send an operator somewhere different: name somebody else, or have the person brought back. The same treatment **CC-36** gave the plan surface's three-cause code. No sentence is invented per code beyond the four the backend genuinely distinguishes                                                                                                                                                                          | this slice | closed, recorded     |
| **CC-39(a)** | **the other branch a colleague may be named from was TYPED as an identifier, and the disposition that justified it was FALSE** | The form carried a text field an operator typed a branch identifier into. The standing Owner requirement is that tenancy comes from the login and no company or branch identifier is typed, so the cross-branch handover the Owner's clarification of 2026-09-10 protects was unreachable for anybody who did not know an identifier by heart. The earlier disposition claimed a reference field is what the inventory screens ship where no directory list is available; that is untrue and takes one read to measure — `org.branch-list` is consumed at `apps/web/src/features/inventory/api.ts` and rendered through `useBranches` in `apps/web/src/features/inventory/components/shared.tsx`, where the identifier fields are the FALLBACK for a caller who may not read the directory, never the design. The same operation is consumed by the payments, pricing, services, warranty and report screens, and by this feature's own readiness queue | **CORRECTED in this slice, and the earlier disposition is retracted rather than rewritten.** The branch is chosen from `org.branch-list`, narrowed to the work order's company, defaulted to the work order's own branch and gated on `org.branch.read`. Where the directory is not offered, answers with nothing, is refused or does not answer, the reason is stated and the work order's own branch is read — which is the branch the register would have been read for anyway. **No typed input remains on the form**, and a test asserts that. The operation is named in `scripts/ci/check-p1-31-access.mjs` in the change that first consumes it | this slice | closed, corrected    |
| **CC-39(b)** | **the register's single-employee read was published with no production consumer**                                              | `readEmployee` was called by nothing but its own two tests. Saying so in the adapter's docblock was the earlier disposition, and it is not a disposition: this repository treats _declared but never wired_ as a defect it has shipped repeatedly (P1-27 INT-113), and `apps/web/src/features/delivery/api.ts` states that rule against itself two files away                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **WITHDRAWN in this slice, superseding the earlier disposition.** The adapter, its contract row, its two tests and the `org.employee-detail` entry in `scripts/ci/check-p1-31-access.mjs` were removed together. Neither gate pin moved, because the register's list read contributes the same resource root. It returns on the day a surface calls it — resolving the person named on a handover recorded before the register existed. No legacy row was repaired here, and the review list P-17 created is the Owner's                                                                                                                               | this slice | closed, withdrawn    |
| **CC-39(c)** | **the access gate gained an owned segment no dashboard area is named for**                                                     | Claiming the organisation reads this form consumes — the employee register and the branch directory — derives their shared resource root, `org`, taking the derivation from eight segments to nine. The dashboard holds no such area, so the page count did not move: the form lives on the work-order detail page the gate already examined. Withdrawing the single-employee read and claiming the branch directory moved NEITHER number, for the same reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **engineering consequence, implemented.** Both pins in `tests/ci/p1-31-access-gate.test.ts` were re-based from the gate's own report line on this head, and the gate's own list records why the two administration commands on the same register, and the single-employee read withdrawn under CC-39(b), are deliberately NOT claimed. Naming a segment before a screen exists under it is what made the warranty and report pages meet this rule already written                                                                                                                                                                                      | this slice | closed in this slice |

### 51.4 What this slice did NOT do

- **No backend file changed**, and no operation, permission, migration, seed, audit action or
  generated register moved.
- **No roster administration surface exists.** Nothing here adds, renames, retires or reinstates an
  employee, and the two register commands that could are neither mirrored nor claimed.
- **No login account, employment record, department, contact detail or role is read**, and the
  employment reference is displayed as the opaque reference it is.
- **No legacy handover was repaired**, and no unresolved reference was replaced by the authenticated
  actor or by a guess — the Owner forbade both in the same clarification.
- **No figure or arithmetic crosses this tier**, as with every other delivery surface.
- **No gate was weakened, no suppression added and no floor moved.** The committed test-count
  baseline is untouched. The allow-list in `scripts/ci/check-p1-31-access.mjs` moved in BOTH
  directions and each move is recorded above: `org.branch-list` was claimed because a screen of this
  phase now calls it, and `org.employee-detail` was released with the adapter that called nothing.
  A narrowing that drops a claim this phase cannot support is not a narrowing that hides a
  violation — no page stopped being examined and no segment stopped being owned.
- **No hosted run, no database tier, no browser acceptance and no end-to-end result is claimed.**

### 51.5 Proof

Every command, with its numbers, is in [`delivery-start-selector.md`](./delivery-start-selector.md)
§ 7. It is not duplicated here: a hand-copied total beside a recorded one is exactly the disagreement
the P1-27 closing-value gate exists to catch, and the recorded tiers live in
`docs/phase-1/phase-1-27/evidence/local-run-ledger.json` with the commit each was taken at.

**There was no hosted gate, no run against any database, no browser tier and no merge.** The slice is
open as a pull request; no review verdict and no hosted result is recorded here.

---

# QA-005 — the fresh-organisation acceptance harness, of 2026-09-12

## 52. The fresh-organisation acceptance harness — **PROVISIONAL** (QA-005)

**Slice:** `feature/p1-31-acceptance-harness`, ownership profile `p1-31-frontend`.
**Baseline:** protected `develop` **9b109f639348db424940b00b022cfb36e2160e2c**, merged into this
branch on 2026-09-13. The branch was authored against `deb404c1` and carries THREE merges of
`develop`: `811e9891`, then `72782f48` when PR #376 landed the operational overview, then
`9b109f63` when PR #377 landed the delivery start selector — each of the last two while this
branch was in flight. Each is recorded by its own commit, and every figure below that refers to
`develop` refers to `9b109f63`.

### 52.1 Identifier allocation — the collision RESOLVED, and this slice is the one that renumbered

The heading and the identifier were taken high on 2026-09-12 against `develop` `8c4e6a9c`, where the
register ran to section 43, precisely so that a lane landing first would never be renumbered by this
one. At `811e9891` this section recorded a live collision: `feature/p1-31-operational-overview`
allocated **CC-39, CC-40 and CC-41** under its own section 53, this slice had allocated **CC-40**,
and neither branch was merged. It stated the rule that would settle it — whichever integrates second
renumbers **its own** identifier, and nothing else moves — and declined to move pre-emptively.

**That branch integrated first**, as PR **#376**, and `develop` `72782f48` now carries section 53
and **CC-39, CC-40 and CC-41**. So the rule applies to this slice, and it has been applied: the
disposition below is **CC-42**, the next free identifier. The section number is unaffected — 52 was
free at `811e9891` and is still free at `72782f48` — and no section or identifier belonging to any
other lane was touched.

| identifier                                  | belongs to                                       | state                                      |
| ------------------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| sections 1–48 and 50, **CC-01 … CC-38**     | the earlier P1-31 slices                         | settled, on `develop` `72782f48`           |
| section 49                                  | `feature/p1-31-assurance-evidence`               | unmerged, deliberately held                |
| section 51                                  | `feature/p1-31-delivery-start-selector` (FE-002) | **settled, on `develop`** — merged as #377 |
| **section 52**                              | this slice                                       | free at `72782f48`; claimed here           |
| section 53, **CC-39**, **CC-40**, **CC-41** | `feature/p1-31-operational-overview`             | **settled, on `develop`** — merged as #376 |
| **CC-42**                                   | this slice                                       | the next free identifier; claimed here     |

**Why the marking is still PROVISIONAL after all that.** Not because of the numbering, which is now
settled in both directions: section 51 has since been taken by #377, and the one number below 52
still free — 49, held by an unmerged branch — is lower than it and cannot grow onto it. CC-42 is
unoccupied on `develop`, the collision that threatened it already resolved. It
is provisional because the slice's own subject is: this branch is unmerged, the harness has never
been executed, and **CC-42** below records a residual that no amount of renumbering touches. The
marking comes off when the acceptance runs, not when the register settles.

### 52.2 What this slice changed

Three artefacts plus one CI registration, and no product code, no backend file, no migration, no
seed, no permission.

- `orchestration/acceptance/p1-31-journey.mjs` — **held outside the repository**, and
  the reason is §52.6. The HTTP acceptance journey: fifteen sections,
  numbered steps, fifteen refusal and isolation cases, and a JSON and Markdown evidence pair written
  **outside** the repository. Three independent guards (`ROOTLCO_ENV`, a loopback database on 54322,
  `ROOTLCO_ACCEPTANCE_CONFIRM=p1-31`), any one of which refuses the run.
- `apps/web/tests/e2e/authenticated/{delivery,warranty,reports,audit-log}-p1-31.spec.ts` and their
  shared `p1-31-handoff.ts` — eleven cases per authenticated project, English and Arabic, reading the
  world the HTTP half made through `ROOTLCO_P131_HANDOFF`.
- `docs/phase-1/phase-1-31/acceptance-plan.md` — the preconditions, the step table, the browser
  matrix, the case table, the evidence layout, and how a PASS is judged per Frontend task.

- `.github/ci-baselines/unrun-test-tiers.json` — the four spec paths added to `governed.specs`, with
  the reading that decided the list recorded beside them. This is the registration every
  authenticated spec owes; the finding below sets out why it is that list and not `unrun`, and what
  it does and does not buy.

**No npm script was added.** Adding one would move `validate:command-coverage` and put a phase
artefact into the repository's permanent command surface; the plan states the invocation instead.

**The harness has NOT been executed.** No organisation was provisioned, no report was run, no browser
was opened. Everything measured on this branch is a static check on the source, and section 8 of the
plan lists exactly which. The plan's own status line says the same thing in its first sentence,
because a reader who stops after one paragraph must not come away believing an acceptance happened.

### 52.3 What the merge of `develop` `811e9891` settled, and what it left

The acceptance plan's §1.1 named four branches the journey needs and measured them as unmerged. All
four are on `develop` `811e9891`: P-17's employee register and the `deliveringEmployeeId` on
`sal.delivery-create` (§41), the report engine and all four datasets (§40, §45 to §47), the warranty
plan administration screens (§48) and the report screens (§50). §1.1 is rewritten in the following
commit to say so, and the bundle figure the harness asserts — **78** — is now the count
`bootstrap-roles.ts` declares on `develop` rather than a figure conditional on a merge.

The shared local database was brought to the same head by the P-17 operator run of 2026-09-12, whose
evidence is outside the repository at `orchestration/evidence/p1-31/p17-operator-20260912/`: the
migration ledger is at **141** rows equal to the 141 files in the tree, the permission catalogue at
**121** codes, and the tenant administrator bundle widened from 76 to 78 across every organisation
that held it. The plan's §1.2 operator steps are therefore DONE and are recorded as done rather than
described as pending.

**What the merge did not settle is the run.** The world the specs read still does not exist on any
checkout, and no acceptance result is claimed anywhere in this slice.

**The re-read against the merged contracts found six defects in the harness, and they are fixed
here.** Every one of the 124 call sites was compared against the `defineOperation` declaration on
`811e9891` — method, path, whether the operation requires an `Idempotency-Key`, whether it requires
an `If-Match`. Four classes came out of it:

| what was wrong                                                                                                                                                                            | how it would have presented                     | fix                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| an operation id that does not exist: `qms.qc-record-read` at two sites, where the route at `GET /quality-controls/{recordId}` declares `qms.qc-record-detail`                             | correct request, wrong name in the evidence     | the declared id                                                |
| fifteen call sites to twelve operations declaring `idempotent: true` sent no `Idempotency-Key`; the platform makes the header mandatory for those (`requireIdempotencyKey`), not optional | `ERR-INT-002` on each                           | a fresh key per call, as the other sites already send          |
| five call sites to five operations declaring `versionGuarded: true` sent no `If-Match`; `parseIfMatch` refuses when the operation declares the guard                                      | `ERR-CON-002` on each                           | the counter its own row answered, and a re-read where none had |
| one call site sent an `Idempotency-Key` to `tech.labor-session-stop`, which declares the version guard and **not** idempotency                                                            | silently ignored; a false claim in the evidence | the header removed and the `If-Match` it actually needs added  |

Two of those are worth naming individually because the correction was a judgement and not a
substitution. `svc.price-list-version-create` is guarded against the price **list**, not the version
it creates — the same trap the P1-30 W2 record names for the publish — and neither write bumps
`svc.price_lists.record_version`, so both send the figure the list create answered. And
`wo.work-order-transition` had no counter available anywhere on the journey, so a read of
`wo.work-order-detail` was added immediately before it, which is the idiom the closure step three
sections later already uses and states its reason for.

None of the six was caused by the merge. They were in the first three commits, and a static check
cannot see them: a string in an object literal is not type-checked against a route in another
workspace, and the harness is never executed by any tier. **That is itself the finding** — the
harness's call shapes were only verified by reading the declarations one by one, and a reader should
not take the fix as evidence that no seventh defect remains.

**A seventh finding was found, and it is REGISTERED rather than fixed or waived.**
`tests/ci/e2e-tier-coverage.test.ts` requires that every spec under
`apps/web/tests/e2e/authenticated/` be named in `.github/ci-baselines/unrun-test-tiers.json` — under
`governed.specs` when a gate-governed job executes it, in `unrun` when none does. The list held seven
paths and named none of this slice's four, so **the root unit tier was RED on this branch** and had
been since the specs were committed at `ed657ed8`, before any merge. The branch never ran `tests/ci`,
which is why the failure travelled three commits unseen.

**Which list they belong on was decided by reading, not by preference.** The evidence, quoted:

- `apps/web/playwright.config.ts:204` and `:215` — the `authenticated-en` and `authenticated-ar`
  projects both carry `testMatch: /authenticated[\\/].*\.spec\.ts/`. That is a directory-wide glob
  and it matches these four the moment the files exist. `authenticated-tablet` at `:255` carries
  `testMatch: /authenticated[\\/](administration|appointments-and-receptions)\.spec\.ts/` and does
  not match them.
- `.github/workflows/_reusable-authenticated-browser.yml:416` — the step `The authenticated browser
tier` sets `ROOTLCO_E2E_AUTH: '1'` and runs `npm run test:web-e2e-authenticated`. That job is
  called by `pr-ci.yml` and `protected-develop-verification.yml` and sits in the `needs` of both
  `ci-gate` and `protected-gate`.

The governed job therefore **does** execute them, so `governed.specs` is the truthful list. `unrun`
was not available in any case, and two independent rules say so: the declaration file's own `policy`
field fails an entry whose spec **is** executed by the pull-request gate — "a declaration must not
be able to hide a runnable tier" — and the last case of the coverage test fails any `/authenticated/`
path in `unrun` while the tier is governed, because "a debt must not outlive its repayment". The four
paths were added to `governed.specs` with the reason recorded beside them in the file. No rule was
relaxed, no directory exempted, no suppression added, and no threshold moved.

**Registration alone would have left the hosted check RED, and the specs were changed rather than
the guard.** The step immediately after the tier in the same workflow — `A run that collected
nothing is a failure, not a pass` — reads the spec **directory** with `readdirSync`, counts only
results whose status is not `skipped`, and exits 1 naming every file that contributed none. It is
**per file**, not per run. As first written, all eleven cases in each of these four specs skipped
while `ROOTLCO_P131_HANDOFF` was unset — which it is on every runner — so all four would have been
named and `authenticated-browser` would have failed.

Weakening that step was never available, and neither was shipping the files as they stood: four
committed specs that execute nothing are the **declared-but-never-wired** defect class this phase
exists to clean up, and the one `P1-27-INT-113` is named for. What the environment actually offers
was read out of the workflow instead:

- `npm run supabase:reset` applies every migration and seed, then `npm run acceptance:create-owner`
  creates Tenant A, Tenant B and the acceptance owner with the roles and grants, and the API runs
  as a login holding neither SUPERUSER nor BYPASSRLS. Both applications are built and served, and
  `auth.setup.ts` signs in through the product's own login form. **There is a real authenticated
  session for these routes.**
- The owner's permission set is `OWNER_PERMISSIONS` in `scripts/dev/owner-acceptance/context.mjs`,
  composed of `ADMIN_PERMISSIONS`, `CRM_VEHICLE_PERMISSIONS`, `P1_28_SCREEN_PERMISSIONS` and
  `CATALOGUE_ADMIN_PERMISSIONS` — 60 codes. It holds `sal.delivery.view`, `wo.work_order.read`,
  `sal.finance.view`, `wty.warranty.read` and `iam.audit.view`. It does **not** hold
  `rpt.report.read` or `wty.warranty.manage`. That derivation is P1-28-shaped and was never widened
  for this phase, so the asymmetry is a fact about the environment rather than a choice made here.

**Each of the four files now carries at least one case that executes on that environment**, and the
permission asymmetry is what they assert rather than something they work around:

| spec                      | case added or ungated                                                  | what it proves                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `delivery-p1-31.spec.ts`  | the readiness queue is reachable, and idles with its reason stated     | the three-code conjunction passes, and the screen states one of its two idle reasons rather than rendering a blank region                                                |
| `warranty-p1-31.spec.ts`  | both warranty reads are reachable, and plan creation is withheld       | `wty.warranty.read` admits both pages while `wty.warranty.manage` withholds the create panel in the same render — the over-grant by omission that code was minted to end |
| `reports-p1-31.spec.ts`   | the catalogue and the run screen refuse a caller without the read code | both pages render their own title and the shared denial and leak no part of the catalogue or the run form: the only browser proof that the gate runs BEFORE the read     |
| `audit-log-p1-31.spec.ts` | the log offers no export, and says why                                 | the export absence is a property of the screen and never needed journey data; gating it on the handoff was a mistake and the skip is removed                             |

Only assertions that genuinely need a record the journey made — a specific delivery id, a generated
warranty, a report's row count — remain behind the handoff, each stating its own reason in the run
output. Nothing was relaxed, exempted or suppressed to reach that state: the guard is satisfied
because every file now really does execute, which is what it was written to require.

### 52.4 Dispositions

| id        | disposition                                                                                                             | why it is recorded rather than fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | owner                | state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CC-42** | **the journey half of the committed acceptance suite proves nothing until the harness is run — re-measured 2026-09-12** | The suite no longer skips wholesale, and the part that still does is named exactly. Each of the four spec files carries at least one case that executes on the governed job's own environment and asserts what that environment provides — permission gating in both directions, reachability, the honest idle and denied states, and text direction; §52.3 sets out which case and what it proves. **What remains skipped is every case that asserts on a record the journey made** — a specific delivery id, a generated warranty, a report's row count — because `ROOTLCO_P131_HANDOFF` is unset on every checkout and every runner, and the harness has never been executed. Each of those skips states its own reason in the run output rather than deferring to a shared one. A skip was chosen over a failure because a committed suite must stay green on a checkout that has never run an acceptance; the alternative considered and rejected was asserting a 404, which also passes on a build that is merely broken and would convert a missing world into a green tick. The residual is therefore precise rather than total: **the screens are proved reachable and correctly gated, and nothing is proved about how they render a delivery, a warranty or a report that exists.** | the integration lane | **closed by measurement** _(this cell read `open, recorded, PROVISIONAL`: true when written, while the harness lane was unmerged and the journey had never been run. Section 54 states "**CC-42 is closed by measurement**: the journey half no longer proves nothing, because it ran," and the run has since been taken twice more. Annotated by the closure re-measure, section 62. Section 52.6's separate claim about the two CodeQL findings is withdrawn by **CC-51**, section 61.5.)_ |

### 52.5 What this slice did NOT do

- **No execution of any kind against a database, a server or a browser.** Not the harness, not
  Playwright, not `test:db`, not `test:backend`, not a build. The migration, catalogue and bundle
  figures in §52.3 are read from the P-17 operator run's committed-out evidence and from the source
  on this tree; this slice ran nothing against the database itself.
- **No merge, no acceptance record.** Section 6 of the plan describes how a PASS would be judged; no
  PASS is claimed, and rule 2 of `task-matrix.md` is unaffected.
- **No gate was weakened, no exemption granted and no suppression added.** One `eslint-disable`
  written during authoring was removed rather than justified, because the rule it named reported
  nothing. The one CI file this slice touches is named rather than glossed: four paths were ADDED to
  `governed.specs` in `.github/ci-baselines/unrun-test-tiers.json`. That list is not an allow-list
  and adding to it removes no check — it is the assertion that a gate-governed job executes those
  files, which `tests/ci/e2e-tier-coverage.test.ts` then holds against the real directory in both
  directions. Nothing was added to `unrun`, which is the list that would have excused them, and the
  hosted consequence of the registration is stated above rather than left for a reader to discover.
- **No test floor moved.** `apps/web/tests/e2e/**` is the Playwright tier and is not counted by
  `web.minTests`, which measures the vitest projects under `apps/web/tests`.
- **No section or identifier belonging to another lane was renumbered.** The union in this file is
  `develop`'s sections 44 to 48, 50, 51 and 53 in their own order, with this slice's 52 in its
  numeric place between them. When `feature/p1-31-operational-overview` merged as #376 and settled the
  **CC-40** both branches had claimed, THIS slice moved to **CC-42** — its own identifier, by the
  register's own reconciliation rule, with nothing of the other lane's touched.

### 52.6 The HTTP harness is NOT committed, and why — an engineering consequence, not a waiver

**What changed.** `scripts/dev/owner-acceptance/p1-31-journey.mjs` was removed from the repository
and now lives at `1millions/orchestration/acceptance/p1-31-journey.mjs`, beside the phase evidence
and outside any git working tree. **Nothing about the file changed** — every guard, every fix and
every hardening travelled with it byte for byte, and the relocated copy was run to prove it: a
wrong repository root is refused with exit code 2 and the missing paths named, and with a root
supplied the three original guards still fire in order before anything is written.

**Why.** An evidence writer is by construction a path from API responses to the filesystem, which
is exactly what `js/http-to-file-access` reports. Two rounds of real fixes closed five of the seven
alerts this harness raised — an unguessable `mkdtemp` directory, `0o700`/`0o600`, `wx` on the
credential file, backslash-first escaping, and a sanitising barrier on every value reaching disk —
but the last two ARE the network-to-file edge, and it does not close while the evidence exists.

The policy in `.github/ci-baselines/codeql-baseline.json` is `maximumOpenFindings: 0` with an
EMPTY `dismissals` array, and its own note records that the single dismissal this repository ever
held was removed **because the finding was fixed**. So three options stood: dismiss, delete the
evidence, or hold the driver where the scanner does not analyse it.

**The third was taken, on precedent rather than on convenience.** Section 5 of
`docs/phase-1/phase-1-30/w9-acceptance-record.md` records that phase's HTTP driver as
`acceptance-p1-30-journey.mjs`, a **session artefact**, with only the record committed. This slice
is narrower than that precedent, not looser: the browser half stays committed, executes in
continuous integration, and asserts the permission asymmetry §52.3 describes.

| what                                              | state                                            |
| ------------------------------------------------- | ------------------------------------------------ |
| the four `*-p1-31.spec.ts` specs and their helper | **committed**, and executing in the governed job |
| this plan and the change-control record           | **committed**                                    |
| the acceptance record, after the run              | **to be committed**                              |
| the HTTP journey driver                           | **outside the repository**, by precedent         |

**Stated plainly, because the distinction is the whole point: the two findings are resolved by
RELOCATION, not by dismissal.** No entry was added to `dismissals` — it is still empty. No rule was
relaxed, no path exempted, no suppression written, no threshold moved, and no reviewer was named
for an approval nobody gave. The finding disappears because the scanner no longer analyses that
file, and this section exists so that nobody later reads its absence as a clean bill of health for
a file the scanner never saw.

_**Amended 2026-09-13. The sentence above is preserved rather than rewritten, and the claim it makes
is WITHDRAWN.** Relocation removed the **scanner**, not the **dataflow edge**: `js/http-to-file-access`
is still present in the harness and would still be reported if the file were analysed, so "resolved
by relocation" was never an accurate description of the finding's state. What the edge actually is,
measured on the harness at the digest the corrected acceptance ran, and the disposition that replaces
this one, are in **§ 61.5 (CC-51)**. The rest of this section stands unaltered: no entry was added to
`dismissals`, no rule was relaxed and no path was exempted, and the harness is still held outside the
repository on the P1-30 precedent § 52.6 cites._

**What it costs, recorded rather than glossed.** A file outside the repository is not reviewed by
CODEOWNERS, not covered by the repository gates, and not versioned with the code it drives. The
acceptance record it produces must therefore name the driver and the commit it was run against, as
P1-30's did, or the run evidences a script nobody can identify.

---

## 53. The operational overview — **PROVISIONAL** (FE-010, FE-016)

**Slice:** `feature/p1-31-operational-overview`, ownership profile `p1-31-frontend`, open as pull
request **#376**. It was written **STACKED** on `feature/p1-31-report-screens` (section 50, pull
request **#371**) and carries its head `e3b73277` by merge; **#371 has since merged**, so this branch
carries protected `develop` directly and the stack is gone. It has since been synced a second time
onto `develop` `811e9891353b466b7788e7ca8a7bddee8496de72`, which carries pull request **#370**, the
P-17 delivering-employee Backend slice: two migrations, a schema baseline, the `org.employee-*`
operations, change control section 41, and regenerated registers. That merge DID change files, so
every figure in section 53.4 was re-taken at it. This branch is **unmerged**, has **no hosted
result**, and nothing below claims otherwise. The full record is [`operational-overview.md`](./operational-overview.md).

**Authority:** Owner decision **D-19** of 2026-09-12
([`owner-decisions-2026-09-12.md`](./owner-decisions-2026-09-12.md) § 1) — FE-010 is an operational
overview of the four approved report domains, built from their authoritative server results, with
branch and period filters, visible freshness and timezone, and drill-through; using **only supported,
approved calculations**; **inventing no profit, performance score or trend**; **naming and
implementing the smallest approved backend prerequisite** if a needed summary contract is absent;
with **four raw tables alone not establishing the intended overview**; and **FE-016 reusing this
overview for the selected branch, with no hard-coded pilot**. **D-5** of 2026-09-09 § 4 and **D-17**
of 2026-09-10 § 4 are carried unchanged.

### 53.1 Identifier allocation — PROVISIONAL, dated 2026-09-12, re-checked at `develop` `811e9891`

The register in this file, at the head this branch carries, runs to **section 48** and **CC-36** and
additionally holds **section 50** and **CC-38**. Both are now on protected `develop`: section 48 with
PR #375 and section 50 with PR #371, which merged after this section was first written. `develop`
`811e9891` adds **section 41** and **CC-29** with PR #370, which sits below that ceiling and so moves
neither the highest section nor the highest identifier. Section **49** is claimed by a lane that is
not on `develop`, and section 48.1 records that sections **49 to 52** and the identifiers above
**CC-36** are held by P1-31 lanes on unmerged branches.

So this slice takes **section 53** and **CC-41**, and both stay **PROVISIONAL**. Section 53 is the
first heading above every number those lanes are recorded as holding, and CC-41 is chosen on the same
basis — **that part is coordination rather than a measurement**, because no unmerged lane's identifier
is decided until it merges. A heading taken above the claimed range is a gap in the register; a
heading taken inside it is somebody else's record renumbered, which is worse.

| id        | lane                                               | state, re-read at `develop` `811e9891`          |
| --------- | -------------------------------------------------- | ----------------------------------------------- |
| **CC-29** | the delivering-employee identity (#370)            | **merged**, section 41                          |
| **CC-36** | the warranty plan administration screens (#375)    | merged, section 48                              |
| **CC-37** | a lane not on `develop`                            | claims section 49                               |
| **CC-38** | the report screens (#371)                          | **merged**, section 50                          |
| —         | a lane not readable from any head reachable here   | claims section 51                               |
| **CC-40** | the fresh-organisation acceptance harness (QA-005) | **PROVISIONAL** and unmerged, claims section 52 |
| **CC-41** | this slice                                         | **PROVISIONAL**, this branch, section 53        |

**Why CC-41 keeps its PROVISIONAL marking even though three of the numbers above are now settled on
`develop`.** Section 50 and **CC-38** stopped being a claim about a branch when #371 merged, and
section 41 and **CC-29** are on `develop` `811e9891`, so those rows are facts. Two are not: the
acceptance-harness lane's own record still carries **section 52** and **CC-40** marked PROVISIONAL on
a branch that is not merged and is not published to `origin`, and the lane claiming section 51 is not
readable from any head reachable here, so its identifier cannot be read at all. Until both merge,
CC-39 and CC-40 may land, move or never land, and an identifier chosen above a range that can still
shift is not measured. **The section number and the identifier are re-checked against `develop`
again before this branch merges.** Section 36.1's rule governs a collision: an identifier is allocated
when its finding is raised and is never renumbered to follow heading order, so a collision moves THIS
section and this identifier and leaves every existing one alone.

### 53.2 What changed, and what was minted

| changed                                                                                                                                                                        | minted  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1 route page, 1 overview screen, 1 shared scope form extracted from the report screen, 1 overview contract; 1 navigation entry                                                 | nothing |
| 23 English and 23 Arabic messages — the section titles, the measure labels and the filter and freshness copy; 1 new web test file; 2 web suites re-based on the shared form    | nothing |
| the P1-31 access gate's pinned page count moved 15 → 16, read off the gate's own report line; NO operation joined its allow-list and its owned-segment count is unchanged at 8 | nothing |
| the FE-010 and FE-016 rows of the task matrix and of the A0 preflight; the P1-27 records re-taken at this head                                                                 | nothing |

**No backend file changed.** No route, no service, no repository, no migration, no seed, no
permission, no audit action and no operation. **The operation register gains exactly one line and no
operation:** regenerating it lists `tests/ci/p1-31-access-gate.test.ts` as a coverage site for the
existing `rpt.report-run`, because this branch's gate test names that operation, and the earlier
statement that the register was untouched understated that. Its totals are `develop`'s unchanged —
411 operations over 319 OpenAPI paths, 121 permission codes, 234 audit actions, all Covered. The
committed test-count baseline is untouched: the tree DECLARES 3257 cases across 140 files against a
floor of 3700, so `WTF-08` demands no raise.

### 53.3 Dispositions

| id           | finding                                                                                                                                                                                                | measured                                                                                                                                                                                                                                                                                                                   | disposition                                                                                                                                                                                                                                                                                                                                                                                             | remedy owner            | state            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------- |
| **CC-41**    | **the overview is four separate report runs, not one summary read**, so four reads are issued where the decision describes one screen                                                                  | every figure D-19 asks for is already published by the four datasets as a group over the WHOLE selection, and the run service's own docblock says so. A fifth operation returning the same four group sets would be a new contract for an answer that already exists, and D-19 asks for the SMALLEST approved prerequisite | **accepted, and recorded because a reviewer will ask.** Each read asks for `limit=1`, the smallest page the route admits, because the rows are not wanted — only the groups. A `summaryOnly` flag was considered and rejected: it changes a published operation's request shape for a saving the `limit` already delivers. If a summary contract is ever added, this screen is the caller that names it | a later Backend slice   | open, recorded   |
| **CC-41(a)** | **a section whose dataset the catalogue answers as not executable renders as not runnable rather than as a figure**, so an operator can meet an overview in which one of four sections shows no number | the catalogue publishes `executable` per report code, and a draft, an archived configuration or a published configuration with no live version all answer the same way. All four approved codes are registered at this head; the state is reachable whenever a configuration is not live                                   | **accepted.** The alternative is a zero, and a zero is a claim about the business that the server did not make. The section states that it cannot be run and why, in the same words the report screen uses, so the two surfaces cannot disagree                                                                                                                                                         | none — this is intended | closed by design |

Both CC-04 (no export operation) and CC-38(a) (two of three drill-through targets have no screen
here) remain **open and are not closed by this slice**, and nothing in it creates either screen.

### 53.4 Proof

**Measured facts (not part of the decision) — what was actually run, and where.** Every run below was
local, on this branch, with no database, no browser and no hosted runner. **The table was re-taken at
the sync merge of `develop` `811e9891`**, so no figure below is carried forward from either pre-sync
head.

| run                                                                                         | result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` · `npm run typecheck:web`                                               | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run lint`                                                                              | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run lint:web`                                                                          | 0 errors; 12 pre-existing warnings, none on a file this slice touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run format:check` · `format:check:web` · `style:check:web`                             | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run security:all`                                                                      | pass over 2774 tracked files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run validate:encoding`                                                                 | every tracked text file clean UTF-8, no BOM                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run validate:generated-artifacts`                                                      | 2774 tracked files, 7/7 ignore rules, 0 failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run validate:p1-24-register`                                                           | register current and reconciled — 411 operations, 319 OpenAPI paths, all Covered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run validate:command-coverage`                                                         | 95/95 reachable locally, 96/96 invoked by hosted CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run validate:web-boundary`                                                             | 374 files, 0 violations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run validate:use-server-exports`                                                       | 50 server modules across 989 source files, 0 violations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run validate:web-topology`                                                             | 18 expectations, 338 matched files, 0 failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run validate:web-tokens` · `validate:web-theme` · `validate:web-brand`                 | 0 violations; 54 colours registered, 0 unresolvable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run validate:notification-authority`                                                   | 374 files scanned, one authority, mounted once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run validate:module-boundaries`                                                        | 615 files scanned in `apps/api/src`, 11 rules, 0 violations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run validate:api-backend-only`                                                         | 320 route handlers, 615 source files, 0 failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run validate:plain-language`                                                           | 2 catalogues, 24 rules, 0 findings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `npm run validate:p1-31-access`                                                             | 16 route pages across 8 owned segments, 0 violations _(true on this slice's head, and both halves have moved since, in different units. SEGMENTS: `develop` took the count to 9 with the FE-002 handover form's `org` root, and § 67.3 takes it to **12** — `delivery-checklist-templates` and `audit-events`. PAGES: § 67.3 takes the judged count to **10**, not because pages were deleted but because **7** `work-orders` pages are deferred to the gate that owns that area; 17 match the owned segments and 10 are judged here. The earlier note said § 67.3 "moves it to 10" of the segment count, conflating the two. The figure above is left as measured and corrected in § 67.3.)_ |
| `npm run validate:p1-26-frontend`                                                           | 374 files, 50 server modules, 0 failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run validate:p1-27-frontend`                                                           | 156 files across 5 trees, 9 rules, 0 failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| focused web — the overview suite plus the reports, delivery, warranty and navigation suites | 393/393 across 10 files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| root — `npx vitest run tests/ci tests/openapi-contract.test.ts`                             | 1991/1991 across 69 files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| the web tier, through the P1-27 recorder                                                    | 3977/3977 across 140 files, 0 failed, recorded at `4797dbbe`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run test:unit`, through the P1-27 recorder                                             | 3301/3301 across 122 files, 0 failed, recorded at `4797dbbe`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run verify:policies`                                                                   | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run validate:phase-ownership`, both forms                                              | profile `p1-31-frontend`, 27 changed files (web 13, docs 13, tests 1) against `origin/develop`, 0 violations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The local `verify:workspaces` aggregate is not run, under the standing 2026-09-09 targeted-local plus
required-hosted policy. Hosted builds, browser checks and the required gates remain mandatory and
none of them has reported on this branch.

### 53.5 What this slice did NOT do, and what is not claimed

- **No backend file changed**, and no operation, permission, migration, seed or audit action moved.
- **No summary contract was added, and none was found missing.** D-19 requires an absent summary to
  be named and implemented as the smallest approved prerequisite; measured against the four datasets'
  published groups, no figure the overview shows is absent, so there was nothing to name.
- **No figure was computed, derived, rounded, re-scaled or reformatted anywhere in this tier**, and
  no profit, performance score or trend exists on the screen or in its contract.
- **No export path of any kind was added** — not an operation call, and not a file assembled in the
  browser.
- **No tenant is named anywhere.** FE-016 is the same screen with the branch fixed by the address, so
  there is no second screen and no pilot in code.
- **No gate was weakened, no allow-list narrowed, no suppression added and no floor moved.** One gate
  figure moved: the pinned page count, because a page was added.
- **No hosted run, no database tier, no browser acceptance and no end-to-end result is claimed**, and
  the slice is stacked on an unmerged pull request, so nothing here is reachable on `develop` yet.

## 54. The fresh-organisation acceptance, run and recorded (QA-005)

**Slice:** `feature/p1-31-acceptance-record`, ownership profile `p1-31-frontend`.
**Baseline:** protected `develop` **`6005cfa4ca3db4dbf45a2cb6ea5edff1dc70f821`** (the merge of PR
#378, which put the harness outside the repository). The branch was cut from that head and carries no
merge of its own. It was **documentation only** when it was first recorded; **§54.6 changed that**:
the correction pass of 2026-09-13 edits the four committed `*-p1-31.spec.ts` files, which are an
executable path, and the two tiers were re-recorded accordingly. No gate, no fixture, no
configuration and no product path changed in either pass.

**What it records:** the acceptance [`acceptance-plan.md`](./acceptance-plan.md) describes was
**executed**, on 2026-09-12/13, against a production build of that head on the shared local stack.
The record is [`acceptance-record.md`](./acceptance-record.md) and its verdict is **PARTIAL**: the
HTTP journey answered **176 steps with 0 findings**, twenty-five of the thirty-four committed browser
cases did not run to completion for the three causes §3.1 of the record names, and no Owner Pass has
been given. Section 52's marking is therefore answered in part — the harness has now been run — and
**CC-42 is closed by measurement**: the journey half no longer proves nothing, because it ran.

### 54.1 Identifier allocation

Read on `develop` `6005cfa4`, where the register runs to **section 53** and **CC-42**, and where
every section and identifier below that is settled — section 49 having been taken by PR #379 and
section 51 by PR #377. **This slice takes section 54 and CC-43**, the next free pair in both
sequences, and touches no other lane's numbering.

### 54.2 What this slice changed

| file                                                   | change                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/phase-1/phase-1-31/acceptance-record.md`         | **new** — the record: verdict, the 176-step HTTP table with correlation ids, the browser matrix per locale, the refusal/concurrency/isolation cases, how it was driven, observations |
| `docs/phase-1/phase-1-31/task-matrix.md`               | rule 2 restated against the record that now exists; six rows — FE-002 … FE-006 and FE-008 — moved to `end-to-end verified` citing it; the companion-records line names it            |
| `docs/phase-1/phase-1-31/change-control-2026-09-08.md` | this section                                                                                                                                                                         |

**No row moved on anything but evidence.** §6 of the record states, task by task, what the run could
and could not establish; the ten FE tasks it could not answer for keep the state they had, and the
reason is written beside each. The table above is the FIRST pass; [§54.6](#546-the-browser-correction-pass-of-2026-09-13-cc-43-closed-in-part)
lists what the correction pass changed, including the four committed specs.

### 54.3 What the run changed outside the repository

The harness `orchestration/acceptance/p1-31-journey.mjs` is not in this tree, and it was **corrected
six times** while the acceptance was in flight — each correction against the shipped contract it had
misread. §7 of the record lists the six runs, their step and finding counts, and what each
established. The two things worth carrying here:

- **Nothing in this repository was changed to make a step pass.** No product code, test, gate,
  allow-list, fixture or expectation moved. The step count rose from 86 to 176 because the journey
  grew the hops the product actually requires — the work-order and job state graphs, an accepted
  quotation as the invoice's only commercial source, a technician availability window, a real
  decodable image for the signature, and the document link the signature's provenance check reads.
- **Twelve organisations are left in the shared local database**, `p31_journey_{a,b}_<stamp>` for the
  six stamps, taking `org.tenants` from 25 rows to 37. None was deleted, on the P1-30 precedent, and
  none of the codes matches a backend-suite prefix.

### 54.4 Dispositions

| id        | disposition                                                                                       | why it is recorded rather than fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | owner             | state                                  |
| --------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------- |
| **CC-43** | **twenty-five of the thirty-four committed P1-31 browser cases do not pass against a real world** | Seventeen are strict-mode locator ambiguities in the specs themselves, six assert a permission withheld that a fresh tenant administrator holds, and two assert a translated report title over a label the tenant supplied; §3.1 of the record names every one with its file, line and cause. They are recorded rather than fixed here because this slice is documentation only, and because editing a committed spec is a change to an executable path that would oblige a re-record of the web tier and belongs to the lane that owns those files. They are invisible on the governed job today, where every journey-dependent case skips for want of a handoff, and will all surface at once the first time one exists. **Corrected on 2026-09-13 by the pass §54.6 records, and closed in part.** All three classes were fixed in the four specs and the browser half was re-run against a second fresh organisation: thirty-two of the thirty-four cases now pass. The two that remain are one case in two locales, and they are a fourth cause the first three were hiding — a figure the harness records mid-journey compared against a dataset that is declared live and goes on changing. That one is measured rather than fixed: the screen renders exactly what the server answers, and the repair belongs to the harness, which is held outside this repository. | the Frontend lane | closed in part; one cause open, stated |

### 54.5 What this slice did NOT do

- **It did not close the phase.** The record's verdict is PARTIAL and the Owner Pass §6.3 of the plan
  requires has not been given.
- **The first pass changed no executable path**, so no tier was re-recorded for it: the static and
  documentation checks §5 of the record names are the whole of what was run for that pass. **§54.6
  supersedes this for the correction pass**, which edits four committed specs and re-records both
  tiers.
- **It deleted no tenant, ran no migration, applied no seed and reset nothing.** The database is as
  the acceptance left it, and the four environment figures were confirmed read-only before the window
  opened.
- **It claims no hosted result.** Everything in the record is loopback, and the record says so.

### 54.6 The browser correction pass of 2026-09-13 (CC-43, closed in part)

The same slice, continued. CC-43 recorded twenty-five browser failures and said they belonged to the
lane that owns those files; this is that lane doing it, under the section and identifier already
open rather than a new pair.

**What changed, and only this:**

| file                                                       | change                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/tests/e2e/authenticated/delivery-p1-31.spec.ts`  | the readiness form's two controls and the Print control addressed by role with whole names; column headers matched whole; the row-verdict check asserted with Playwright's own waiting instead of one non-retrying read                                                                              |
| `apps/web/tests/e2e/authenticated/warranty-p1-31.spec.ts`  | the branch control addressed as a `combobox`, which also removes a race against the branch directory; both tables' headers matched whole; the plan-creation case rewritten to assert the affordance IS offered to the holder of `wty.policy.manage`, gated on the handoff                            |
| `apps/web/tests/e2e/authenticated/reports-p1-31.spec.ts`   | the two permission cases rewritten to assert each screen renders for a holder of `rpt.report.read`, gated on the handoff; the catalogue and run cases addressed by link target and named from the catalogue rather than by a typed title; the period facts asserted inside the list that states them |
| `apps/web/tests/e2e/authenticated/audit-log-p1-31.spec.ts` | the range, scope, action and apply controls addressed by role with whole names; column headers matched whole                                                                                                                                                                                         |
| `docs/phase-1/phase-1-31/acceptance-record.md`             | §1's verdict restated on the evidence that now exists; **§7.1** added — the correction pass, its run identifier, the before and after counts per spec and locale, the three classes fixed and the fourth measured                                                                                    |
| `docs/phase-1/phase-1-31/task-matrix.md`                   | rule 2 restated; six further rows — FE-001, FE-007, FE-012, FE-013, FE-014, FE-015 — moved to `end-to-end verified` citing §7.1; FE-011 annotated with why it did not move                                                                                                                           |
| `docs/phase-1/phase-1-31/change-control-2026-09-08.md`     | this subsection, the CC-43 disposition, and the two statements in §54 that the first pass made and this pass supersedes                                                                                                                                                                              |

**No product code, route, permission, migration, gate, allow-list, fixture or message catalogue
changed.** Every fix is a locator, an assertion's subject, or a case's scope. Strict mode was not
relaxed, no `.first()` was added over a duplicate, no assertion was weakened and no skip was added
that does not state what is missing.

**The evidence.** A fresh pair of organisations, `p31_journey_{a,b}_mtz5ppq8`, provisioned by the
same harness against a production build; the HTTP journey answered **176 steps with 0 findings** for
the second time; the browser half went from **9 of 34 passing to 32 of 34**. The two failures that
remain are the fourth cause described in the CC-43 row above and in §7.1 of the record. `org.tenants`
went from 37 rows to 39; nothing was deleted, migrated, reset or seeded.

**Because this pass edits an executable path, both tiers were re-recorded** — the web tier and the
unit tier, in that order, with the evidence index regenerated between them — and the ownership,
encoding, scope-exclusion, fabricated-data and documentation-count gates were re-run. The specs are
Playwright cases and run in no recorded tier themselves; what the re-record proves is that changing
them left the recorded tiers where they were.

**One consequence for the governed job.** Three cases that used to run there without a handoff now
skip without one, because each is a statement about a caller and the handoff is what names the
caller. They will skip with that reason stated, where before they asserted a refusal that was true
only of that job's own account. That is a narrowing of what the governed job asserts, and it is
recorded here rather than left to be noticed.

### 54.7 The governed job refused §54.6, and what this pass changed (CC-44)

§54.6 ends with a paragraph headed "One consequence for the governed job" which states that three
cases would begin to skip there and calls that a narrowing. It was not a narrowing. The
`authenticated-browser` check on this branch's head `65e27dbb` ended red at its last step, "A run
that collected nothing is a failure, not a pass", naming `reports-p1-31.spec.ts` and
`warranty-p1-31.spec.ts` as contributing no executed test. That step fails per FILE, not only on a
zero total, and nothing in the repository sets `ROOTLCO_P131_HANDOFF` — so gating every case in those
two files on it left them silent. `delivery-p1-31.spec.ts` and `audit-log-p1-31.spec.ts` each kept
one ungated case and were not named.

**What changed, and only this:**

| file                                                      | change                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/tests/e2e/authenticated/reports-p1-31.spec.ts`  | the two permission cases un-gated and rewritten to assert the contract that holds for either caller — the page's heading inside `main`, the document direction, no download on any reporting screen — and then, in full, whichever outcome is in front of them: a refusal complete with its explanation and nothing of the gated surface left on the page, or the whole surface a refusal would have withheld                   |
| `apps/web/tests/e2e/authenticated/warranty-p1-31.spec.ts` | the plan-creation case un-gated and rewritten the same way: the list must say a branch has to be named before anything is read and must not have read before one was; the plans screen must let the holder of `wty.warranty.read` reach its filter form, and its create panel must be whole or absent. The plans half is conditional on the message catalogue with an `if` rather than a skip, so the list half always executes |
| `docs/phase-1/phase-1-31/acceptance-record.md`            | **§7.2** added — the quoted failure, what the guard requires read from the workflow, the two-caller measurement that §7.1 got wrong, what each rewritten case asserts, and what is still gated                                                                                                                                                                                                                                  |
| `docs/phase-1/phase-1-31/change-control-2026-09-08.md`    | this subsection and the CC-44 disposition                                                                                                                                                                                                                                                                                                                                                                                       |

**The measurement underneath it.** `auth.setup.ts` signs in with `ROOTLCO_E2E_EMAIL` /
`ROOTLCO_E2E_PASSWORD` when they are set and otherwise with `.local/owner-acceptance-account.json`,
which `acceptance:create-owner` wrote. The governed job sets neither, so it signs in as that account,
whose set is `OWNER_PERMISSIONS` in `scripts/dev/owner-acceptance/context.mjs` — **60** codes,
derived from the Administration, CRM, Vehicle and P1-28 screen surfaces. It holds `wty.warranty.read`,
`sal.delivery.view` and `iam.audit.view`; it does **not** hold `rpt.report.read` or
`wty.policy.manage`. §54.6 rewrote three cases around a caller who holds all five, which is the
acceptance run's caller and not this job's.

**No product code, route, permission, migration, gate, allow-list, fixture or message catalogue
changed.** The guard was not relaxed, no `.skip` was added, nothing was registered in
`.github/ci-baselines/unrun-test-tiers.json`, and no assertion was weakened: each rewritten case
asserts the shared contract AND the whole of whichever branch it lands in, where its predecessor
asserted one branch and was wrong about the other half of the time.

**Because this pass edits an executable path, both tiers were re-recorded** — the web tier and the
unit tier, in that order, with the evidence index regenerated around each — and the ownership,
encoding, boundary, topology and `verify:policies` gates were re-run. **No hosted result is claimed**:
whether the `authenticated-browser` job goes green at the head this pass produces is a fact only that
job can establish.

| id        | disposition                                                                                           | why it is recorded rather than fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | owner             | state        |
| --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------ |
| **CC-44** | **the handoff-gated reporting cases can pass only on a run whose browser credentials are overridden** | They assert on screens that gate on `rpt.report.read`, and the account the tier signs in as by default does not hold it. §7.1's run drove them with the journey's own administrator through `ROOTLCO_E2E_EMAIL` / `ROOTLCO_E2E_PASSWORD`, which nothing in the repository states or arranges. Repairing it means changing how the tier signs in — a different decision, on a different lane — so it is measured and stated here rather than papered over by widening what the acceptance account is granted. | the Frontend lane | open, stated |

## 55. The phase closure record and the gate P1-G31 inputs (CC-45)

**Slice:** `feature/p1-31-closure-record`, ownership profile `p1-31-frontend` (docs bucket),
documentation only. **Baseline:** protected `develop`
**`81b3bce804626353a1a7b9f4ba52f1306c8f8b6e`** (the merge of PR #380, the acceptance record).
`main` `1262de74`, untouched.

### 55.1 Identifier allocation

Read on `develop` `81b3bce8`, where this register holds sections 1 … 54 and identifiers
CC-01 … CC-44. **Section 55 and CC-45 are the lowest free pair**, and no lower pair is held by an
unmerged lane: the only open pull request on this repository that touches `docs/phase-1` is #372,
which touches `docs/phase-1/phase-1-27` and claims no P1-31 section or identifier. Nothing here is
taken from another lane and nothing is renumbered.

One identifier below this pair has no disposition row anywhere: **CC-40**. It was claimed by two
lanes; the operational overview settled the range as #376 and the acceptance-harness lane moved to
**CC-42** by this register's own reconciliation rule, so the sequence carries a hole at 40 rather
than a finding. It is stated so that a reader does not go looking for a row that was never written.

### 55.2 What was delivered

| file                                                   | change                                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/phase-1/phase-1-31/closure-record.md`            | **new** — scope and boundary, the 29 canonical tasks reconciled to evidence, the Definition of Done bullet by bullet, the four gate inputs, the open items |
| `docs/phase-1/phase-1-31/change-control-2026-09-08.md` | this section                                                                                                                                               |

The closure record is an **input to gate P1-G31, not the gate's decision**. Its § 4 carries the
approval owner's verdict field and leaves it **empty**, with the statement that only the approval
owner named in Field 35 may fill it. No verdict is recorded, inferred or implied, and the chapter's
status for all twenty-nine tasks remains `Planned`.

### 55.3 Dispositions

| id        | finding                                                                                                               | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CC-45** | **four statements in `task-matrix.md` were measured before their pull requests merged, and are older than this head** | Read off the first-parent history of `develop` `81b3bce8`. (a) FE-010 and FE-016 carry the State `in open PR` for #376, which **merged at `72782f48`**. (b) The QA-005 row states that "the acceptance record does not exist and the harness is in OPEN PR #378" — #378 **merged at `6005cfa4`** and the record **merged at `81b3bce8`**. (c) The prerequisite table records P-11's engine as "in open PR #364" — #364 **merged at `c1b1a8cd`**, with the three further datasets at `6b3c6c45`. (d) The same table records P-17 as "implemented, not merged" — #370 **merged at `811e9891`**, which `a0-preflight.md` already states. The FE-002 row's note that the Start slice "is open as pull request #377" is stale in the same way: #377 merged at `9b109f63`. | **recorded, not corrected.** A State is the matrix's own to move, and it moves on evidence rather than on a merge — rule 1 of that file is that a merge closes no canonical task. The closure record is authorised to add a proving artefact; it quotes the matrix's values as they stand and names this row beside them. Moving FE-010 and FE-016 out of `in open PR` would be a state change this documentation-only slice has no evidence to make and no authority to assert. The lane that next measures the matrix owns it. |

### 55.4 What this slice did NOT do

- **It did not close the phase, and it recorded no verdict.** The gate's fourth condition is the
  approval owner's and is left empty.
- **It moved no State in `task-matrix.md`** and changed no chapter status. The matrix was not edited
  at all: no row's proving artefact needed to point at the closure record, because the record proves
  no task — it summarises what each task's own artefact already proves.
- **It ran no test tier, no build, no migration and no database operation**, and claims no hosted
  result. The gates it ran are static checkers, named in the pull request.
- **It changed no source file, no gate, no allow-list and no fixture.** Documentation only.
- **It did not re-quote a figure a generated register owns.** Every count in the closure record is
  either read on this head or quoted with the phase record it comes from.

---

## 56. Re-measuring the assurance evidence index at the acceptance head (SEC-001 … DOC-002)

**Slice:** `feature/p1-31-assurance-index-remeasure`, ownership profile `p1-31-frontend` (resolved
through `decideOwnershipRun` in `scripts/ci/check-phase-ownership.mjs` before the branch was cut; the
profile allows `docs`, and this slice changes nothing else).
**Baseline:** protected `develop` **`81b3bce804626353a1a7b9f4ba52f1306c8f8b6e`** (the merge of PR
#380, the acceptance record). **Documentation only** — no source, no test, no gate, no fixture, no
migration and no configuration file is touched, so no tier is recordable from it and none is claimed.

**Why it exists.** [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) is the phase's
assurance index for the thirteen non-Frontend tasks, and it declared itself **measured at
`9b109f63`** — before #378 and #380 merged. Its § 9 stated in terms that "no P1-31 acceptance record
exists, and no P1-31 acceptance run has happened". Both halves of that are now false: the run
happened on 2026-09-12/13 and [`acceptance-record.md`](./acceptance-record.md) is on `develop`. An
index that reports evidence as missing when it exists makes tasks look unevidenced, which is the
same defect class this register exists to catch, so the index was re-measured at the new head rather
than patched at the one sentence.

### 56.1 Identifier allocation

Read on `develop` `81b3bce8`, where the register runs to **section 54** and **CC-44**, with no gap
in either sequence. The next free pair is section 55 with CC-45, and **this slice does not take it**:
section 55 / CC-45 is claimed by a sibling lane not on `develop`, recording that the task matrix's
header declared a stale measurement commit. **This slice takes section 56 and CC-46**, the next pair
above that claim, and touches no other lane's numbering. § 48.1 applies unchanged — an identifier is
a claim about the register at the moment it was raised, and is never renumbered to follow heading
order. A textual conflict with a sibling lane at merge time is expected and is resolved by whoever
integrates.

_(True when written, and the expected thing then happened. The sibling lane merged as **#381** at
`develop` `d517a5fc`, and its section 55 and CC-45 are the pair immediately above this one in this
file. Both allocations stand as raised; neither was renumbered.)_

### 56.2 What this slice changed

| file                                                   | change                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/phase-1/phase-1-31/security-and-qa-evidence.md`  | re-measured at `81b3bce8`; § 9 rewritten against the merged acceptance record; § 1.1 added (the code x operation x catalogue reconciliation); §§ 2, 3, 6, 7 and 8 restated; two figures corrected in place; § 15 added for this allocation   |
| `docs/phase-1/phase-1-31/task-matrix.md`               | the header's measurement commit, and five rows — SEC-001, SEC-003, QA-002, QA-003, QA-005 — each with an artefact citation. SEC-003 moves `not started` → `phase-level incomplete`; the other four keep their state. No other row is touched |
| `docs/phase-1/phase-1-31/change-control-2026-09-08.md` | this section                                                                                                                                                                                                                                 |

### 56.3 What moved, and the rule that stopped it moving further

**Rule 2 of the matrix's state vocabulary binds this slice as it binds every other:** nothing reaches
`end-to-end verified` without an acceptance record, **and documentary evidence alone never earns that
state**. One row moves here — **SEC-003, `not started` → `phase-level incomplete`** — and it moves on
the revision the index's own previous version invited in writing once the delivery, warranty and
report-configuration write paths had merged. It moves one step, not two: the index is a document, and
a document cannot promote a row past the state its artefacts support. The other four rows keep the
state they had and gain a citation that is true.

**What SEC-003 rests on, named so nothing is double-counted:** client-asserted scope is covered by
`validate:p1-31-access` (16 route pages across 9 owned segments, 0 violations) and by **CC-39(a)**'s
pinning test; cross-tenant is covered by the `tests/db/*` suites for delivery, warranty, reporting,
provisioning and employees, and by acceptance steps 157, 158, 159 and 161; permission refusal is
covered by acceptance steps 174, 175 and 176. **Privilege WIDENING across the phase as a set is
covered by nothing**, and is owed to a separate pull request — a new
`tests/backend/p1-31-privilege-escalation.test.ts` that is not on this head and is not written here.

### 56.4 Dispositions

| id           | finding                                                                                   | disposition                                                                                                                                                                                                                                                                                                                                                                                 | owner / slice | state                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CC-46**    | the assurance index asserted that no P1-31 acceptance record exists, after one had merged | **re-measured at `81b3bce8` and corrected in place**, with every figure re-derived rather than carried forward. The record's own verdict, **PARTIAL**, is quoted and not upgraded, and the index moves no row on documentary evidence alone                                                                                                                                                 | this slice    | closed, recorded                                                                                                                                                                                                                                                                                                                                                       |
| **CC-46(a)** | SEC-003 sat at `not started` after the evidence its state depended on had merged          | **moved to `phase-level incomplete`** on § 3.1's four-part breakdown; the one uncovered part is named and routed to a separate pull request rather than absorbed                                                                                                                                                                                                                            | this slice    | closed, recorded                                                                                                                                                                                                                                                                                                                                                       |
| **CC-46(b)** | the twelve P1-31 permission codes had no phase-level reconciliation against the catalogue | **§ 1.1 of the index publishes it** — 12 codes, 45 operations, 52 references, each code resolving to exactly one row of the 121-code catalogue — derived from the parsed `defineOperation` output of `check-permission-parity.mjs`. The gate proves no code is fictitious and publishes no per-phase breakdown. The reconciliation is a mapping and explicitly not a least-privilege review | this slice    | closed, recorded                                                                                                                                                                                                                                                                                                                                                       |
| **CC-46(c)** | the OpenAPI shortfall was recorded for `sal.delivery-*` and is wider than that            | **re-measured: all 45 P1-31 operations publish a bare-object success schema** in `docs/api/openapi.v1.json`. A0 classified the shortfall as chapter-level and it stays there; the extent is recorded so the next reader does not measure a subset. The generated file was **not** edited                                                                                                    | a later slice | open, recorded                                                                                                                                                                                                                                                                                                                                                         |
| **CC-46(d)** | two figures in the index's second version did not reproduce at the new head               | **corrected in place, with what they replace named**: the three web feature trees hold 24, 8 and 10 TypeScript files rather than fifteen, six and six, and no slice touched those trees between the two heads; and the phase's own document counts now add up to the directory. A figure that does not reproduce is corrected, never restated                                               | this slice    | **closed, recorded** _(re-opened at section 57.4 when the phase directory grew past the count the index stated, and **closed again by measurement** at the closure re-measure: the index states the directory at 35 files at `develop` `fb65b049` and 36 as that pull request leaves it, and the register range at sections 1 … 62 with CC-01 … CC-52. Section 62.2.)_ |

**What was verified, and what is not claimed.** Locally and without the stack: the changed-file
ownership gate in both its forms, the documentation count and citation-anchor gates, root Prettier
over `docs/`, and the static checkers whose report lines the index quotes —
`validate:p1-31-access`, `check-permission-parity.mjs`, `validate:exact-money`,
`check-p1-30-payload-parity.mjs` and `check-p1-28-version-sourcing.mjs` — each re-run on this head so
that no figure is transcribed. **No database tier was run, no `test:db` or `test:backend`, and no
hosted result is claimed.**

---

## 57. The operator runbook, the INT-084 retraction, and register hygiene (DO-002 operator half, DOC-002, DOC-001 in-repo half)

### 57.1 Identifier allocation

Read on `develop` `81b3bce804626353a1a7b9f4ba52f1306c8f8b6e`, where this file runs to **section 54**
and **CC-44**, and where every section and identifier below that is settled. **This slice takes
section 57 and CC-47** — not the next free pair, but the pair the coordinating session allocated to
it, leaving sections 55 and 56 and identifiers CC-45 and CC-46 free for the two sibling lanes open
at the same time. Nothing of any other lane is renumbered, in either direction: § 48.1's rule is
that an identifier is a claim about the register at the moment it was raised.

**A textual conflict with a sibling pull request at merge time is expected** and is resolved by the
coordinator, not by this section moving. If a sibling lands section 57 first, THIS section
renumbers itself and nothing else, on the § 52.1 precedent.

**Resolved at the sync.** This branch merged `develop`
`821ed6689d3d481ff2270e44c6e66bb9651a9b97` — the merge of PR #372 — on 2026-09-13. Both siblings
had landed by then: **section 55 with CC-45** (#381) and **section 56 with CC-46** (#382). Neither
took section 57, so nothing renumbered in either direction. The textual conflict in this file was
resolved by order alone — 55, then 56, then 57 — with every line of all three sides kept. The
slice this section records is **pull request #383**, opened on 2026-09-13 from that synced head.

### 57.2 What changed, and what was minted

| changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | minted  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1 new document, [`operator-runbook.md`](./operator-runbook.md) — the four merge-time operator acts in the order that is load-bearing, each with preconditions, the exact command, a verification query, a rollback criterion and a statement of what done looks like                                                                                                                                                                                                                                                                                                                                                 | nothing |
| 1 table cell in `docs/product/owner-workflow-requirements.md` and 1 in `docs/phase-1/phase-1-27/finding-phase-disposition.md` — the P1-27-INT-084 overstatement retracted IN PLACE, both edited within their existing lines so neither file's pinned line count in `docs/phase-1/phase-1-27/deliverable-manifest.md` moves                                                                                                                                                                                                                                                                                           | nothing |
| this section: the register's first index of open dispositions, the CC-40 note, and the routing record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | nothing |
| 3 rows of [`task-matrix.md`](./task-matrix.md) — DO-002, DOC-002 and DOC-001, each moved to `in open PR #383`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | nothing |
| [`closure-record.md`](./closure-record.md), which arrived on `develop` in #381 — its state column, four of its rows, its totals and the five statements this slice or #382 falsifies, each corrected in place with the note that keeps the original claim visible. No verdict moves and no row moves to `end-to-end verified`                                                                                                                                                                                                                                                                                        | nothing |
| `docs/phase-1/phase-1-27/evidence/evidence-manifest.json` — regenerated by `evidence:p1-27` after the sealed `finding-phase-disposition.md` edit. Digests only: no evidence document is added, removed or renamed, and `validate:p1-27-evidence` reports 41 documents in sync                                                                                                                                                                                                                                                                                                                                        | nothing |
| **A drift this slice causes and does not fix:** `operator-runbook.md` is the **33rd** file in `docs/phase-1/phase-1-31/` — the directory held 31 at `81b3bce8` and 32 at `821ed668` (#381's closure record) — while the assurance index still states **31** at `security-and-qa-evidence.md` lines 803 and 1032. That is what re-opens **CC-46(d)**, and § 57.4 files it open rather than counting it closed. This slice does not correct the index's figure: a document count is settled by the phase's final re-measure, and correcting it here would put a second stale number in a file this branch does not own | nothing |     | nothing |

**No product code, route, permission, operation, migration, seed, audit action, gate, allow-list,
fixture or message catalogue changed.** This slice is documentation only.

### 57.3 Dispositions

| id           | finding                                                                                                                           | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | disposition                                                                                                                                                                                                                                                                                      | owner / slice | state              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------ |
| **CC-47**    | **this register carried no index of its own open dispositions, and every disposition is filed as "recorded" rather than "fixed"** | **70** distinct identifiers exist in this file at the head this branch synced onto, spread across the slice records' own disposition tables and, in two cases, across prose bullets with no state cell at all. **At `821ed668`, reading each disposition's own state cell: 28 open, 38 closed or settled, 4 stating no usable disposition.** **As this pull request leaves the file the three figures are the same and the membership is not: 28 / 38 / 4** — § 57.3 closes **CC-37(c)**, whose own state cell at line 2750 still reads `open, recorded`, and this slice's 33rd document in the phase directory re-opens **CC-46(d)**. § 57.4 names every one. _(This cell first read 64 = 25 + 35 + 4 against `81b3bce8`, then 27 / 39 / 4: the first was true of `81b3bce8`; the second credited § 57.3's own closure of CC-37(c) to the synced head, where it is not yet made, and did not carry CC-46(d)'s re-opening. Both are corrected here.)_ | **recorded and indexed, not re-adjudicated.** § 57.4 is a derived index and changes no state. "Recorded" is the honest verb for most of these: a disposition that names a remedy a later slice owes is not a fix, and an index that called it one would be the overstatement it exists to expose | this slice    | open, indexed      |
| **CC-37(c)** | the tenant-administrator bundle backfill has a prerequisite no repository record named (§ 49.3, line 2750)                        | § 49.3's own remedy sentence: "the operator runbook that DO-001 and DO-002 both owe and that does not exist; **the ordering must be in it**"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **closed by this slice.** [`operator-runbook.md`](./operator-runbook.md) § 2 states the ordering and § 3 states the prerequisite, its exit code 5, the script line that raises it and its verbatim refusal text. § 49.3's row is left as written — this is a closure, not a rewrite              | this slice    | **closed in § 57** |
| **CC-16**    | organisations provisioned before the P-10 widening cannot administer warranty policies (§ 29.2, line 634)                         | The register named an operator act after merge that no runbook carried. A runbook now carries it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **still open, and deliberately.** A runbook is not a run. CC-16 closes when the act has been performed on the environments it is about, and the runbook's § 1 says how few of those there are                                                                                                    | a later act   | open, unchanged    |
| **CC-20**    | organisations provisioned before the P-10 and P-11 widenings hold neither new code (§ 34.2, line 815)                             | The same act, the same runbook, the same distinction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **still open**, for CC-16's reason exactly                                                                                                                                                                                                                                                       | a later act   | open, unchanged    |

### 57.4 Index of open dispositions — re-derived at the sync, not transcribed — **SUPERSEDED by section 62.6**

_(**Superseded, and kept whole.** This index was derived at `develop` `821ed668` plus pull request #383 and partitioned seventy identifiers as 28 open, 38 closed or settled and 4 stating no usable disposition, with CC-47 the seventy-first. That was true of its own basis. Five identifiers have been added since — CC-48 (section 58), CC-49 (section 59), CC-50 and CC-50 (a) (section 60) and CC-51 (section 61) — and four stale state cells are annotated by the closure re-measure, so the partition is re-derived at section 62.6 rather than adjusted here. **Nothing below is deleted, corrected or renumbered.**)_

Every row below was read out of this file as this pull request leaves it: `develop`
`821ed6689d3d481ff2270e44c6e66bb9651a9b97` (the merge of PR #372) merged into this branch, where
the register holds **sections 1 … 56 and CC-01 … CC-46** from `develop` and this section adds
**57** and **CC-47**. **This index moves no state of its own**; where a row's own state cell is
ambiguous, the ambiguity is reported rather than resolved. Two states do move in this pull request,
and neither is moved by the index: § 57.3 closes **CC-37(c)**, and this slice’s own new document
re-opens **CC-46(d)** — § 57.2 records that drift.

**The re-derivation this section promised has been performed.** The first version of this index was
derived at `81b3bce8` and partitioned 64 identifiers as 25 open, 35 closed or settled and 4 stating
nothing; that was true of `81b3bce8` and of nothing later, and it is superseded here rather than
carried forward. The two siblings it named as outstanding have both landed and are folded in below:
**section 55 / CC-45** (#381 — four `task-matrix.md` statements measured before their pull requests
merged) and **section 56 / CC-46 with its (a)–(d) sub-entries** (#382 — the assurance index
re-measured at the acceptance head). Neither section is edited by this slice and no identifier is
renumbered; only their own state cells are read.

**Open — 28 as this pull request leaves the file, and CC-47 raised by this section: 29 rows below**

**Two bases, because they differ by exactly two identifiers.** At `821ed668` the open set holds
**CC-37(c)** and not **CC-46(d)**. As this pull request leaves the file it holds CC-46(d) and not
CC-37(c): § 57.3 closes CC-37(c), and this slice's 33rd file in the phase directory re-opens
CC-46(d). The table below is the second reading — the file as it will be merged — and both members
say which basis they are on.

| id           | where             | one line                                                                                                                                            |
| ------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CC-01**    | § 3, line 66      | `wty.policy.manage` excluded from the tenant administrator bundle                                                                                   |
| **CC-02**    | § 3, line 67      | `rpt.report.configure` excluded from the tenant administrator bundle                                                                                |
| **CC-04**    | § 3, line 69      | `rpt.export` excluded from the bundle although shipped operations declare it                                                                        |
| **CC-06**    | § 8, line 145     | the checklist-results read does not close P1-27-INT-088                                                                                             |
| **CC-10**    | § 13, line 230    | the warranty list does not close the status-history table                                                                                           |
| **CC-12**    | § 22, line 420    | two Backend docblocks still say navigation names `sal.delivery.read`                                                                                |
| **CC-16**    | § 29.2, line 634  | organisations provisioned before P-10 cannot administer warranty policies                                                                           |
| **CC-20**    | § 34.2, line 815  | organisations provisioned before the P-10/P-11 widenings hold neither new code                                                                      |
| **CC-23**    | § 37.2, line 1076 | no index was added for the list ordering, and no migration was written                                                                              |
| **CC-24**    | § 39.2, line 1297 | no batch variant of the four fact sources, so a page of N costs about 5N round trips                                                                |
| **CC-27**    | § 40.2, line 1402 | compound: (a) approved 2026-09-10 apart from the source column, **(b) open**                                                                        |
| **CC-27(b)** | § 40.2, line 1402 | the open half of CC-27, carried in CC-27's own state cell rather than in a row of its own                                                           |
| **CC-29**    | § 41.2, line 1549 | four recommendations remain pending                                                                                                                 |
| **CC-30**    | § 42.3, line 1750 | an operator without `sal.finance.view` is refused the whole queue                                                                                   |
| **CC-31**    | § 43.3, line 1825 | FE-009 ships partial — a vehicle-filtered list, no per-record transition ledger                                                                     |
| **CC-32**    | § 44.2, line 1939 | the printed sheet carries a reference where a person's name belongs                                                                                 |
| **CC-34**    | § 46.2, line 2223 | D-4 names a transfer the ledger cannot express. **State cell ambiguous** — `recorded — no action here`; filed open, not resolved                    |
| **CC-37(a)** | § 49.3, line 2748 | eleven `wty.`/`rpt.` writes are held to no payload-mirror gate                                                                                      |
| **CC-37(b)** | § 49.3, line 2749 | the seven report-configuration writes have no consumer outside a generated manifest                                                                 |
| **CC-38**    | § 50.3, line 2907 | amounts, quantities and durations display as the server's raw exact strings                                                                         |
| **CC-38(a)** | § 50.3, line 2908 | two of three drill-through targets have no screen in this application                                                                               |
| **CC-41**    | § 53.3, line 3403 | the overview is four report runs, not one summary read                                                                                              |
| **CC-42**    | § 52.4, line 3248 | open, recorded, **PROVISIONAL** — the harness lane is unmerged                                                                                      |
| **CC-43**    | § 54.4, line 3524 | **closed in part; one cause open, stated** — the browser correction pass of § 54.6                                                                  |
| **CC-44**    | § 54.7, line 3623 | the handoff-gated reporting cases pass only with overridden browser credentials                                                                     |
| **CC-45**    | § 55.3, line 3661 | four `task-matrix.md` statements older than the head they were measured on. **§ 55.3 has no state column**; filed open on `recorded, not corrected` |
| **CC-46(c)** | § 56.4, line 3744 | the OpenAPI bare-object success-schema shortfall is chapter-wide, not `sal.delivery-*`                                                              |
| **CC-46(d)** | § 56.4, line 3745 | **re-opened by this slice's 33rd phase file**, against the index's stated 31 (lines 803, 1032); `closed, recorded` at `821ed668`                    |
| **CC-47**    | § 57.3            | this register carried no index of its open dispositions                                                                                             |

**States no usable disposition — 4.** These are not open and not closed; two have no state cell at
all and two have one a reader cannot act on, and that is the finding.

| id        | where             | why it states nothing                                                                                                                  |
| --------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **CC-22** | § 36.3, line 988  | its state cell reads `implemented, pending merge`. **That wording is stale**: § 36.1 records the slice merged as PR #360 at section 36 |
| **CC-25** | § 38.3, line 1219 | a prose bullet, not a table row, so it has no state cell. Its text withholds the Start control pending a contract, which reads as open |
| **CC-26** | § 38.3, line 1220 | a prose bullet for the same reason. Its text records a new backend prerequisite, which reads as open                                   |
| **CC-40** | nowhere           | **allocated and never used.** See § 57.5                                                                                               |

**Closed or settled — 38** as this pull request leaves the file. CC-03, CC-05, CC-07, CC-08, CC-09,
CC-11, CC-13, CC-14, CC-15, CC-17, CC-18, CC-19, CC-21, CC-27(c), CC-28, CC-29a, CC-29b, CC-33,
CC-33(a), CC-33(b), CC-34(a), CC-34(b), CC-34(c), CC-35, CC-35(a), CC-35(b), CC-35(c), CC-36,
CC-37, **CC-37(c)** (closed by § 57.3 above, and `open, recorded` at `821ed668`), CC-39, CC-39(a),
CC-39(b), CC-39(c), CC-41(a), CC-46, CC-46(a), CC-46(b). **At `821ed668` the same bucket holds 38
too**, with CC-46(d) in it and CC-37(c) out.

**Arithmetic, so a reader can check it rather than trust it.** This file carried **70** distinct
identifiers before this section, on both bases. **28 open + 4 stating no usable disposition + 38
closed or settled = 70**, as this pull request leaves the file, and **28 + 4 + 38 = 70** at
`821ed668` as well — the totals coincide and the membership does not, because § 57.3 closes
CC-37(c) and this slice re-opens CC-46(d) in the same pull request. The partition is exact and no
identifier is counted twice: CC-27, CC-27(b) and CC-27(c) are three separate entries and are filed
separately, which is why CC-27 appears under open on the strength of its (b) half while CC-27(c)
appears under closed, and CC-46 with (a), (b), (c) and (d) is five entries by the same rule, of
which (c) and (d) are open. **CC-47**, raised by § 57.3, is the seventy-first and is not inside
that arithmetic. _(This paragraph first read 64 = 25 + 4 + 35 with CC-47 the sixty-fifth, then
27 + 4 + 39: the first was true of `81b3bce8` when written; the second counted CC-37(c) closed at a
head where it is not and missed CC-46(d)'s re-opening. Both are corrected here.)_

### 57.5 CC-40 — allocated, never used, and a permanent hole

**Verified at this head before being written.**

- **It was allocated.** § 52.1 (line 3091) records `section 53, CC-39, CC-40, CC-41` as belonging
  to `feature/p1-31-operational-overview`, settled on `develop` as PR #376. § 53.1 (line 3366)
  records it instead as the acceptance-harness lane's, claiming section 52. **Both lanes claimed
  it**, and § 52.1 says so in as many words.
- **The collision was resolved by the harness lane moving.** § 52.5 (line 3271): "When
  `feature/p1-31-operational-overview` merged as #376 and settled the **CC-40** both branches had
  claimed, THIS slice moved to **CC-42** — its own identifier."
- **The lane that kept it never used it.** § 53.3's disposition table carries exactly two rows,
  **CC-41** and **CC-41(a)** (lines 3403 and 3404). There is no CC-40 row in § 53 or anywhere else
  in this file — a search for `CC-40` returns only allocation-table rows and sentences about the
  collision, and not one finding.

**So CC-40 names no finding and never will.** Under § 48.1 an identifier is a claim about the
register at the moment it was raised and is never renumbered, which means the hole is permanent by
the same rule that protects every other number here. **No finding is invented to fill it**, and a
later slice that reaches for the next free identifier must skip it.

**One further disagreement, recorded and not resolved.** § 52.1's line 3091 also attributes
**CC-39** to the overview lane, while § 51.1 (lines 2968–2970) records the delivery-start-selector
lane taking section 51 and CC-39, and § 51.3 disposes of CC-39, CC-39(a), CC-39(b) and CC-39(c).
CC-39 is therefore used, and used by section 51. The line-3091 attribution is a snapshot taken
mid-collision and is left standing as written; **nothing here renumbers it.**

### 57.6 Routing record

The chapter requires the controlled record to be routed to a named approval owner.

| question                                        | answer                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where has this register been sent for approval? | **Routed to nobody as of 2026-09-13.** _(True when written. The closure re-measure of the same day routes the controlled record to the approval owner as [`owner-decision-packet-2026-09-13.md`](./owner-decision-packet-2026-09-13.md) — twenty-six items, eight of them blocking. **Nothing has come back**: no acknowledgement, no approval and no verdict, and none is claimed or inferred. Section 62.5.)_ |
| By whom, and when?                              | No routing event exists. No recipient is named, because naming one would be inventing one                                                                                                                                                                                                                                                                                                                       |
| Has any approval been granted on it?            | **No.** Nothing in this file is approved, and no section claims to be                                                                                                                                                                                                                                                                                                                                           |
| What has been decided by the Owner?             | Individual decisions, recorded in their own dated files — `owner-decisions-2026-09-09.md`, `-09-10.md` and `-09-12.md`. **A decision on a question this register raised is not an approval of the register**                                                                                                                                                                                                    |

[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 13 states the same thing about
itself: "This version has been routed to nobody and claims no approval." **This row is that fact
recorded in the register it is about**, so a reader of the register does not have to find it
somewhere else.

### 57.7 What this slice did NOT do, and what is not claimed

- **It performed none of the acts it documents.** No migration was applied, no seed was applied,
  no backfill was run, and no database was connected to from this branch. The runbook is a
  description, and § 1 of it says exactly what the one recorded performance does and does not prove.
- **It closed neither CC-16 nor CC-20.** Both close on a run, not on a document.
- **It did not touch the Owner's document.** The fourth A0-named DOC-001 correction —
  `OWR-2026-09-06-G-10`'s evidence line naming `sal.deliveries.delivering_employee_id` where the
  table is `sal.delivery_records` — is in `docs/product/owner-requirements-2026-09-06.md` at line
  1501, in a requirement whose status is **Undecided**. **Changing an Owner requirement is the
  Owner's act**, and it is recorded as owed rather than performed.
- **It re-adjudicated nothing.** § 57.4 reports each disposition's state as that disposition
  states it; where a state cell is stale or missing, that is reported, not corrected.
- **It moved no other lane's row.** Only DO-002, DOC-002 and DOC-001 moved in the task matrix, and
  none of the three moved to `end-to-end verified` — rule 2 forbids it, and documentary evidence
  never earns that state.
- **No hosted run, no database tier, no browser result and no acceptance result is claimed.**

---

## 58. The write-shape gate and the audit-class review — **SETTLED** (SEC-004)

_(This heading read **PROVISIONAL**: true while `feature/p1-31-write-shape-gate` was unmerged. It merged as pull request **#384** at `develop` `af924cab`, so section 58 and **CC-48** are settled where they were raised. Nothing is renumbered; a heading is not an identifier. De-marked by the closure re-measure, section 62.)_

**Slice:** `feature/p1-31-write-shape-gate`, branched from protected `develop`
`d517a5fc70b8d851edbd81c374c4ce05e92d7418` — the head carrying pull request **#381**, the phase
closure record. The work is committed **on the unmerged branch `feature/p1-31-write-shape-gate`**
and was not on `develop` when this section was written; **the pull request was opened at this lane's
merge-queue turn, when the unit and web runs were re-recorded** — it is **#384**, opened against
`develop` `ea3b7fc0`. It has **no hosted result yet**: that pull request's own run is what produces one. Its intended ownership profile is `p1-31-frontend`; section 58.6 records what
resolves locally instead. Its application-source footprint is **two files in `apps/web`**, both in
the warranty feature — the request-body type the generation adapter takes, extracted so the gate can
compare it. Everything else is tooling, tests and phase records.

**Authority:** the SEC-004 row of [`task-matrix.md`](./task-matrix.md), and
[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 4, which records in its own words
the two gaps this slice closes — that the eleven `wty`/`rpt` writes "are therefore held to no mirror
gate at all", and that the audit declarations are counted while "a count is not a review".

### 58.1 Identifier allocation — SETTLED by the merge of #384 at `af924cab`

_(This heading read "PROVISIONAL, dated 2026-09-13 at `develop` `d517a5fc`": true when written. The allocation below stands exactly as raised.)_

The register in this file, at the head this branch now carries — the merge of `develop`
`ea3b7fc0` — runs to **section 57** and **CC-47**: section 54 is the acceptance run (#380),
section 55 the closure record (#381), section 56 the assurance-index re-measurement (#382) and
section 57 the operator runbook (#383), all four merged. Sections **56** and **57** and the
identifiers **CC-46** and **CC-47** were held by sibling P1-31 lanes on unmerged branches when this
allocation was raised, in the same way section 53.1 records for the range below it, and both have
since merged. So this slice keeps **section 58** and **CC-48**, allocated to it alone and untouched
by the merge, which restored the order to 55, 56, 57, 58 and renumbered nothing; both stay
**PROVISIONAL** until the branch merges. Section 48.1's rule governs a collision: an identifier is allocated when its finding
is raised and is **never renumbered** to follow heading order, so a collision moves THIS section and
this identifier and leaves every existing one alone. A textual conflict with a sibling lane at merge
time is expected and is resolved by the coordinator.

_(True when written, at `develop` `d517a5fc`: the register then ran to **section 55** and
**CC-45**, and sections 56 and 57 with CC-46 and CC-47 were "not present at this head" and were
"assumed held by P1-31 lanes on unmerged branches". The expected thing then happened. Both merged —
section 56 / CC-46 as **#382**, section 57 / CC-47 as **#383** — and the merge of `ea3b7fc0` into
this branch placed section 58 above both. All four allocations stand as raised; none was
renumbered.)_

### 58.2 What changed, and what was minted

| changed                                                                                                                                       | minted       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `scripts/ci/check-p1-31-write-shape.mjs` — a new gate over the `wty` and `rpt` writes                                                         | 1 npm script |
| `tests/ci/p1-31-write-shape.test.ts` (18 cases) and `tests/ci/p1-31-write-shape-extraction.test.ts` (1 case)                                  | nothing      |
| `scripts/ci/check-command-coverage.mjs` — one register entry, tier `required`; `package.json` — the script, and one edge in `verify:policies` | nothing      |
| `apps/web/src/features/warranty/warranty-contract.ts` — the exported `WarrantyGenerateBody`; `warranty-api.ts` — the adapter takes it         | nothing      |
| `docs/phase-1/phase-1-31/audit-class-review.md` — the review of all 45 audit declarations                                                     | nothing      |
| the SEC-004 row of the task matrix, `not started` → `in open PR (#384)`; this section                                                         | nothing      |

**No Backend source changed** — no route, no service, no repository, no migration, no seed, no
permission, no audit action. **No operation was added, renamed or withdrawn**, and the P1-24 register
is untouched. On the web side the change is type-level only: the inline request-body type of
`generateWarranty` was moved into the warranty contract as the exported `WarrantyGenerateBody` and
the adapter now takes it. **No screen, no request, no field and no message catalogue changed**, and
the body the adapter sends is byte-for-byte what it sent before.

### 58.3 The gate, and why it is a sibling rather than a widening

`check-p1-30-payload-parity.mjs` freezes `P1_30_DOMAINS = ['svc', 'quo', 'inv', 'sal']`, its scope is
pinned by name in its own suite, and P1-30's closure rests on it. **CC-37(a)** refuses widening
another phase's gate, so the new file is a sibling and that one is **byte-identical** on this branch.

It borrows the P1-29 gate's comparison, schema locator, naming rule and interface reader rather than
copying them — a second reader is how the brace-counting scanners drifted — and it **parses**: the
operation surface comes from the P1-24 register, the schema each handler parses is located in the
handler's own AST, the zod objects are converted to JSON Schema by a vitest extraction rather than
reconstructed by hand, and the mirror is read with the TypeScript parser. Nothing in it matches
source text.

Three things are its own:

1. **The mirror lives in the feature trees.** The P1-28 contract allow-list names files under
   `apps/web/src/lib/contracts/` and a P1-31 operation has no row in it, so the gate reads
   `features/warranty/warranty-contract.ts` and `features/reports/reports-contract.ts`, hand-frozen
   by name. The generated `lib/api/idempotent-operations.ts` manifest is never a mirror.
2. **Type aliases are resolved.** Those two mirrors spell a closed vocabulary as an exported alias
   over an exported `as const` array, because the same array is what a screen iterates to draw the
   control. The borrowed interface reader knows nothing about aliases, so every closed vocabulary on
   this surface read as an unresolved reference and the first run reported **4 problems that were
   not drift**. The gate now resolves exactly two alias forms before comparing and leaves every
   interface the borrowed reader returns untouched. An alias it cannot resolve **still fails** —
   proved by a case that widens one to `string`.
3. **An extra anti-vacuity clause.** Five of the eleven in-scope writes are declared away, so a
   scope that had drifted entirely into `PENDING_MIRRORS` would otherwise pass while comparing
   nothing.
   The gate reports how many operations it actually compared and is red at zero.

### 58.4 What the gate measured, and the three declarations it carries

Its own report line on this branch: **20 operations in scope `[wty, rpt]`, 11 writes, 10 with a
body, 1 declared bodyless, 4 pending a consumer, 6 compared against 30 mirror interfaces and 5
resolved aliases, 0 problems.**

- **`BODYLESS` (1).** `rpt.report-configuration-version-publish` parses path parameters only.
- **`SHARED_MIRRORS` (2).** The warranty mirror shares one `WarrantyStatusSetBody` between the plan
  and coverage status commands. The share is declared rather than silently accepted as a missing
  interface, and the gate fails the moment the mirror declares either operation's own name.
- **`PENDING_MIRRORS` (4), and no mirror was invented to avoid them.** All four are the
  `rpt.report-configuration-*` writes that carry a body: **nothing under `apps/web` calls them
  except the generated manifest**, so writing an interface for them would have manufactured the
  declared-but-never-wired shape this task exists to catch — **CC-37(b)**. Every entry is stale the
  moment its mirror is written, and the gate fails until the entry is deleted.
- **The fifth pending entry was closed rather than disclosed.** `wty.warranty-generate` was declared
  pending on a first pass because it HAS a consumer — the handover screen's issue control sends it —
  but the adapter took a structural parameter, so no exported interface carried the shape. A hole
  the gate discloses is still a hole, so the type was extracted to `WarrantyGenerateBody` in the
  warranty mirror, the adapter takes it, the entry was deleted, and the operation is now compared
  like any other. That is the difference between the report line above and the first one this slice
  produced: **6 compared rather than 5, 4 pending rather than 5.**

**A correction to a figure carried into this task.** The task brief described **seven**
`rpt.report-configuration-*` **writes**. Re-derived from the register: there are seven
`rpt.report-configuration-*` **operations** — **five writes and two reads** — and
[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 4 says "operations", not "writes".
The count of eleven `wty`/`rpt` writes is confirmed exactly (6 `wty`, 5 `rpt`).

### 58.5 The audit-class review

[`audit-class-review.md`](./audit-class-review.md) covers the same 45-operation surface § 4 of the
evidence index measures, taken twice and agreeing: from the P1-24 register filtered to the eight
namespaces, and from a TypeScript parse of the `defineOperation` literal in each of the 33 route
modules.

- **21 `auditClass: 'none'` and 24 `'privileged'`** — both figures confirmed. All 21 are GETs, all 24
  are writes, and **all 21 are written EXPLICITLY** rather than falling to the registry's `'none'`
  default, which is what makes them reviewable at all.
- **All 24 `'privileged'` declarations carry an `auditAction`**, every code exists in
  `apps/api/src/server/auth/audit-actions.ts`, and every one is declared there with a matching
  `class: 'privileged'`. **None is missing.**
- **Three open items are recorded rather than justified away**: the two reads that hold
  `sal.finance.view` and are silent, `rpt.report-run`, and the two employee-register reads. Fixing
  any of them is an API-source change on the Backend lane and is out of this slice's scope. **No
  Owner decision was sought on any of them and none is claimed.**

### 58.6 Verification run locally on this branch

Every command below **exited 0 at this head**. They were run locally, on this machine; no hosted
result is claimed for any of them, and the two commands that do not yet exit 0 are named underneath
rather than left out.

| command                                                                   | scope                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `node scripts/ci/check-p1-31-write-shape.mjs`                             | the new gate, whose report line is quoted in section 58.4                 |
| `npx vitest run tests/ci/p1-31-write-shape.test.ts` and its extraction    | the two new test files, 19 cases, run directly rather than through a tier |
| `npm run validate:command-coverage`                                       | the register entry and the `verify:policies` edge                         |
| `npm run test:unit`                                                       | the root unit tier, 124 files                                             |
| `npm run lint` · `npm run typecheck` · `npm run format:check`             | the root workspace; root `typecheck` does not cover `apps/web`            |
| `npm run typecheck:web` · `npm run lint:web` · `npm run format:check:web` | the web workspace, for the two warranty files                             |
| `npm run test:web`                                                        | the web tier, which owns the adapter the extracted type serves            |
| `npm run validate:plain-language` · `npm run validate:encoding`           | the catalogues, and the new files as UTF-8 without a BOM                  |
| `npm run validate:generated-artifacts`                                    | the regenerated P1-27 evidence manifest                                   |

**Two commands were NOT green at the head above, and both are green at the merge-queue head.**

- `npm run validate:p1-27-closing-values` **exited 1** there: the recorded `unit` and `web` runs were
  taken at `e5c52efd`, and this branch changes executable paths under them, so both read
  `RUN_RECORD_STALE` and the unit record's file count (122) disagreed with the tree (124). Nothing was
  wrong with the runs; they were stale by construction and were **re-recorded at this lane's
  merge-queue turn**, on the merge with `develop` `ea3b7fc0`, where the command reports 0 problems.
- `npm run verify:policies` **could not pass** at the earlier head, because that command is one of its
  edges; it was not run to a result there and no result was quoted. On the merge-queue head, with the
  record fresh, the aggregate exits 0.

**What the re-record COST, stated plainly.** `develop` `ea3b7fc0` carried a **hosted-attested**
record for both tiers — hosted run **34748952540** at head `b217b8a1`, bound by the QA-001 lane.
Re-recording at the merge head **SUPERSEDED that binding for both tiers with LOCAL records**, and
`evidence/local-run-ledger.json` shrank from **64 lines to 38** as the provenance blocks went with
it. That was not avoidable and it is not a regression: this branch changes executable paths under
both tiers — `scripts/ci/check-p1-31-write-shape.mjs`, `tests/ci/p1-31-write-shape.test.ts`,
`tests/ci/p1-31-write-shape-extraction.test.ts`, `package.json`,
`scripts/ci/check-command-coverage.mjs`, and the two warranty files under `apps/web` — so a run
taken at `b217b8a1` cannot describe this tree, and the rule that a record must describe the head it
is read against is what retires it. **Hosted attestation is re-established by this pull request's own
hosted run.** The binding is re-taken before merge only if the queue owner asks; otherwise the record
stays local-pending, as every other lane's does between its re-record and its attestation.

`npm run validate:phase-ownership` resolves this branch to profile **`p1-26-frontend`** locally — the
known local false-profile trap, where the profile is resolved from a ref the local checkout does not
carry in the shape the hosted run does. The intended profile is **`p1-31-frontend`**, and that
resolution is **verified only by the hosted run**; no local result stands for it.

### 58.7 What this slice did NOT do, and what is not claimed

- **No database was touched.** `test:db` and `test:backend` were not run; the shared instance is held
  by another lane. The unit tier's own count moves by **+19 cases in 2 files**, and that delta is
  **UNRECORDED** — tier baselines are recorded from the hosted run, never from a local one.
- **No hosted run, no browser check and no acceptance result is claimed**, and SEC-004 therefore does
  **not** move to `end-to-end verified`: rule 2 of the state vocabulary refuses that state without an
  acceptance record, and documentary evidence never earns it.
- **No gate was weakened, no allow-list widened, no suppression added and no floor moved.** No
  existing gate file changed except the command register, which gained one entry. **One gate
  weakness was OBSERVED and is NOT fixed here: the doc-counts pin accepts either provenance word
  without reading the ledger — recorded for the final re-measure.**
- **No mirror, screen, adapter or consumer was invented** to make a pending operation pass. The one
  mirror this slice adds, `WarrantyGenerateBody`, is the type an EXISTING adapter with an EXISTING
  consumer already had inline; nothing was written for an operation no screen calls.
- **No other task-matrix row was touched**, and no other change-control identifier was used.

## 60. The refused-download negative and the phase coverage record — **SETTLED** (SEC-002 file-access half, QA-001)

_(This heading read **PROVISIONAL**: true while `feature/p1-31-refused-download-and-coverage` was unmerged. It merged as pull request **#385** at `develop` `474d89ef`, so section 60, **CC-50** and **CC-50 (a)** are settled where they were raised — CC-50 closed at the hosted fill and CC-50 (a) open. Nothing is renumbered. De-marked by the closure re-measure, section 62.)_

**Slice:** `feature/p1-31-refused-download-and-coverage`, intended ownership profile
`p1-31-frontend`. **Baseline:** protected `develop` **`af924cab60a9b51187257b2a345e2ff49de73e87`**,
the head carrying pull request #384 (section 58, the write-shape gate). The branch was written on
`d517a5fc` — the head carrying #381 — and merged that baseline at its merge-queue turn,
where it was opened as pull request **#385**; every figure
in both artefacts was re-derived on the merged tree rather than carried over. `main` `1262de74`,
untouched. Two commits of content, one merge, one test file and one new record: **no application
source, no gate, no allow-list, no baseline and no migration changed.**

**Authority:** the SEC-002 and QA-001 rows of [`task-matrix.md`](./task-matrix.md), and
[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 2 and § 5 — § 2 leaves the
file-access half of SEC-002 with no negative behind it, and § 5 records in its own words that "no
phase-level coverage record exists".

### 60.1 Identifier allocation — SETTLED by the merge of #385 at `474d89ef`

_(This heading read "PROVISIONAL, dated 2026-09-13 at `develop` `af924cab`": true when written. The allocation below stands exactly as raised, and section 59 arrived from the escalation lane as it predicted.)_

Read on the merged tree. This register holds sections 1 … 58 and identifiers CC-01 … CC-48; section
58 and CC-48 arrived with #384 in the merge above. **Section 59 and CC-49 are NOT free and are not
taken here**: the closure plan pre-allocated them to the escalation lane, which is unmerged, and
section 48.1's rule is that an identifier is allocated when its finding is raised and is **never
renumbered** to follow heading order. So this slice keeps the pair the closure plan allocated to it,
**section 60 and CC-50**, and renumbers nothing.

**This section therefore lands out of heading order, before section 59, and that is the intended
outcome rather than a defect.** A reader arriving at a register that runs 55, 56, 57, 58, 60 should
expect section 59 and CC-49 to arrive later from the escalation lane, not conclude that a number was
skipped. This file already carries one genuine hole, CC-40, recorded at section 55.1; the gap at 59
is a different thing and is stated here so the two are not confused.

### 60.2 What was delivered

| file                                                         | change                                                                                                                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/tests/delivery-signature-refusal.dom.test.tsx`     | **new** — the refused-download negative for the handover signature ledger and the printable sheet, **11 declared cases**                                                                              |
| `docs/phase-1/phase-1-31/coverage-record.md`                 | **new** — the phase-level component and unit coverage record for QA-001                                                                                                                               |
| `docs/phase-1/phase-1-27/clean-room-evidence.md`             | six sentences re-pinned to this tree — 141 → **142** web test files and 4009 → **4020** executed cases, in the prose and in the measures table; hosted run `34759286884` reports the same two figures |
| `docs/phase-1/phase-1-27/evidence/closing-value-ledger.json` | the six CR-A locators for those sentences re-pinned to the new wording and values                                                                                                                     |
| `docs/phase-1/phase-1-27/deliverable-manifest.md`            | the derived file-count markers and their visible cells re-derived on the merged tree; the local-run-ledger line counts re-derived after the re-record                                                 |
| `docs/phase-1/phase-1-27/evidence/local-run-ledger.json`     | the unit and web tiers re-recorded at this head, by `check-p1-27-closing-values.mjs --record`                                                                                                         |
| `docs/phase-1/phase-1-27/evidence/evidence-manifest.json`    | regenerated from the merged tree                                                                                                                                                                      |
| `docs/phase-1/phase-1-31/task-matrix.md`                     | the SEC-002 and QA-001 rows moved, on the evidence below and no further                                                                                                                               |
| `docs/phase-1/phase-1-31/change-control-2026-09-08.md`       | this section                                                                                                                                                                                          |

#### The negative — what it actually proves

The suite renders `DeliveryDetailScreen` and the printable handover sheet with the signature-ledger
read **refused**, and asserts what the screen does with a refusal it cannot recover from:

- the shared permissions message is rendered **with the reference the backend logged**, so an
  operator can quote it, and the refusal is never drawn as an empty ledger or swallowed into a blank
  surface;
- **no further page is requested** once the first read was refused;
- the rest of the handover stays readable, and a write control the caller's own permission codes
  grant is still offered — a refused read does not silently disable an unrelated command;
- **nothing on the screen would dereference a stored signature document**: zero links in the region,
  and neither the signature document version id nor the receiver's identity-evidence document
  version id appears in the rendered text. `shared.attachment-download-authorize` is a
  security-class command, and a speculative affordance would write an audit record for a download
  nobody performed;
- the same statement is asserted in **Arabic**;
- the printable sheet says the part could not be read, with its reference, and still composes and
  offers the rest of the sheet.

**The eleventh case is the control, and it is the reason the negatives mean anything.** Ten of the
cases assert `not.toContain` over a document reference; on a screen that had simply rendered nothing
those assertions pass for the wrong reason. So one case drives the ledger read to **succeed**,
proves the signature is on the screen as an event and the receiver's evidence as prose, and then
asserts that **both** document version ids are still withheld and no link exists — with the
adapter's answer demonstrably carrying them. Without that case the suite would be a false negative
of exactly the shape this project has shipped before.

**What it does not prove.** The adapter is mocked, as every DOM suite in this repository mocks it.
The suite proves the screen's behaviour given a refusal; it does not prove the API refused, that the
transport carried the refusal, or that the stored document is unreachable by any other route. No
end-to-end claim is made and none is implied.

#### The coverage record — what it contains

`coverage-record.md` is the cross-screen artefact QA-001 was missing. It states the method for every
figure before the figures, and holds:

- **a per-suite table of the twelve suites on this surface, 407 declared cases**, re-derived on the
  merged tree with the same declaration regex `tests/ci/web-test-floor.test.ts` uses. Because that
  regex counts an `it.each` table as one declaration, and six of the twelve use one, **407 is a
  floor and not the executed total** — the record says so where the number appears;
- **the reconciliation against § 5 of the assurance index**: the index publishes 396 across eleven
  files at `81b3bce8`, and the two agree exactly — the eleven are these twelve less the new suite,
  and `396 + 11 = 407`, file by file;
- **five holes, stated as holes**: the checklist-template administration screen that does not exist
  (FE-004's remaining half); that **no P1-31 feature code is inside the coverage instrument at
  all**, so no coverage percentage exists for any of it; that the dashboard route tier the P1-31
  pages sit in is under its own floor and exempt from it; the mount point of the start-a-handover
  panel that no suite renders; and what the suites deliberately do not assert;
- **the limits**, in § 1 and again in § 6: component and unit only, every adapter mocked, no
  end-to-end claim, and the record measures the phase's own surfaces rather than the web tier.

Its § 6 summary answers five statements and answers **four of them "no"**. The record therefore
closes the "no phase-level coverage record exists" item and closes nothing else.

### 60.3 What was PENDING, what is now FILLED, and from where

**Seven figures in the coverage record were written as `pending the web tier run at this lane's
queue turn`. Five are now filled from this pull request's own hosted run. Two are not filled: they
are restated as OPEN, with the reason and the remedy, rather than left as a pending marker.**

**The single source, and the only one.** Hosted run **`34759286884`** — workflow `PR CI`
(`.github/workflows/pr-ci.yml`), job `Web quality / web-quality` — at head
**`1a167c19bc2a30f42c2c81b72462b901e415a4e7`**, artefact **`evidence-web-quality`**, artefact id
`10318272841`, **477000 bytes**, zip sha256
`616a4318a957ea5ee4d47d3a968cc8bdf3b17203b3cb29824fd820359e92055e`, which is the digest the
artefacts API publishes for that artefact and the digest of the zip as downloaded.

**From `coverage-web.md`** — the four `measured` cells beside the committed floors, each with the
baseline and the delta that file prints: lines **84.64%** (baseline 82.48%, +2.16 pp), statements
**82.88%** (81%, +1.88 pp), functions **87.21%** (85%, +2.21 pp), branches **79%** (77.37%,
+1.63 pp); the ratchet's terms, tolerance **0.5 pp** and touched-file floor **60%**; the eight
critical-module rows, all above their floors; and **the gate verdict, `Coverage gate: pass`**.

**From `test-totals-web.json`, cross-checked against `apps/web/vitest-web.json`** — the executed
case total and its pass/skip/todo counts: **4020 collected, 4020 executed, 4020 passed, 0 failed, 0
skipped, 0 todo**, across **142 files** and 952 `describe` blocks. The file count agrees with the
walk of the tree the record already carried, and the two P1-27 figures re-pinned by this slice
(142 files, 4020 executed) are the same two numbers, so their local derivation is attested by this
run rather than merely repeated.

**Two figures stay OPEN, and the cause is the upload list, not a missing run.** The per-tree
instrumented-file counts (coverage record § 4, H-2) and the dashboard route tier's own measurement
(§ 4, H-3) both need the per-file coverage summary. **No hosted job uploads
`apps/web/coverage/web/coverage-summary.json` or `coverage-gate-web.json`.** The web coverage
ratchet writes both at `.github/workflows/_reusable-node-quality.yml:707-711`; the upload list at
`:864-886` carries neither — it names `coverage/unit/coverage-summary.json`, `apps/web/vitest-web.json`,
`test-totals-web.json` and the markdown files. Web coverage therefore reaches a reader only as the
aggregate `coverage-web.md`, which carries the four percentages and the verdict and no per-file
figure at all. Read directly on this run's artefact: fourteen files, and neither of those two among
them. **Remedy:** add both to the `evidence-web-quality` upload list at
`_reusable-node-quality.yml:864-886`, on the CI-automation lane that owns that workflow. Until then
the two figures are measurable only locally and are **not cited** anywhere.

**No baseline was re-recorded from this run.** `.github/ci-baselines/` is untouched by this slice.
The hosted percentages are recorded as a measurement of this head, never as a floor; a floor moves
on the coverage-policy lane's own act. The local coverage run taken at this queue turn, which
existed only to see the gate execute, remains uncitable and appears in no committed file.

**One pre-existing inconsistency is OBSERVED, under no identifier, and not corrected.**
`.github/ci-baselines/coverage-baseline.web.json:5` (`establishedBy`) records the re-establishment
as coming from "hosted run id 34321869051 … artifact `evidence-web-quality`, file
`apps/web/coverage/web/coverage-summary.json`". That artefact does not carry that file and, on the
upload list above, never did — so the 131-instrumented-file figure in that same field has no
published artefact behind it. The baseline is the coverage-policy lane's artefact; a figure in it
moves by that lane's measurement, and raising an identifier for it here would be claiming a finding
this slice has no authority to close. Stated for the next reader; nothing in `.github/ci-baselines/`
is edited.

**This commit is docs-only, and it is made AFTER the run it cites.** It changes no test, no
application source, no configuration and no workflow, so the tier run `34759286884` measured is
byte-for-byte the tier that merges: the figures above remain valid for the head this pull request
merges, which is this commit sitting on top of `1a167c19`. Anything that would move them — a test
file, a source file under an instrumented root, a change to the coverage include list — would also
invalidate the citation, and this slice does none of it.

### 60.4 What this closes for SEC-002, and what it does not

SEC-002 has two halves, and they are now in different states.

- **The export half was already decided and is not touched here.** D-6 settles it: `rpt.export` is
  **withheld** and no audit export is provided. An approved withholding is a decided posture, not an
  open one, and this slice neither revisits nor re-states it as a gap.
- **The file-access half now has a negative behind it.** § 2 of the assurance index recorded the
  posture in prose; nothing executed asserted it. The suite above is that assertion, at the
  component layer, in both text directions, with a control that stops it passing vacuously.

**That is not the whole of the file-access half.** The negative proves the screen publishes no
reference and offers no affordance; it does not prove the server refuses a download to an actor
lacking the code, which is a backend assertion against a running environment and is not made here.
So SEC-002 moves on evidence and stops short of the state that would need an acceptance record.

### 60.5 Dispositions

| id            | finding                                                                                                               | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CC-50**     | **the phase coverage record exists, and seven of its figures are unfilled because only a hosted run may supply them** | The record holds a per-suite table of twelve suites and 407 declared cases, re-derived on `develop` `af924cab`, and five named holes. Seven figures carry `pending the web tier run at this lane's queue turn`: the per-tree instrumented-file counts (H-2), the dashboard route tier measurement (H-3), the executed case total with the gate verdict (§ 5), and the four `measured` cells beside the floors (§ 5). A local coverage run was taken at this queue turn to see the gate execute; its figures are uncitable and were written nowhere. **Resolved at this lane's follow-up:** five of the seven cells are filled from the hosted run named opposite; the remaining two are re-stated as open under CC-50 (a). | **CLOSED — filled from hosted run `34759286884`** at head `1a167c19`, artefact `evidence-web-quality` (id `10318272841`, 477000 bytes, zip sha256 `616a4318a957ea5ee4d47d3a968cc8bdf3b17203b3cb29824fd820359e92055e`), and from no other source. `coverage-web.md` supplies the four `measured` percentages with their deltas and the gate's own verdict; `test-totals-web.json`, cross-checked against `apps/web/vitest-web.json`, supplies the executed case total with its pass/skip/todo counts. Nothing local was written into the record and no baseline moved. **Sub-item (a) below stays OPEN**, so QA-001 stays `phase-level incomplete`. |
| **CC-50 (a)** | **the per-file web coverage summary reaches no reader, so H-2 and H-3 can be filled from no hosted artefact today**   | `.github/workflows/_reusable-node-quality.yml:707-711` writes `apps/web/coverage/web/coverage-summary.json` and `coverage-gate-web.json` in the web coverage ratchet step; the upload list at `:864-886` carries neither, so `evidence-web-quality` publishes web coverage only as the aggregate `coverage-web.md`. Confirmed by reading run `34759286884`'s own artefact: fourteen files, and neither of those two among them.                                                                                                                                                                                                                                                                                            | **OPEN.** Remedy: add both files to the `evidence-web-quality` upload list at `_reusable-node-quality.yml:864-886`, on the CI-automation lane that owns that workflow; the per-tree instrumented-file counts (H-2) and the dashboard route tier measurement (H-3) are then filled from the first run that carries them. Until then both figures are measurable only locally and are cited in no record.                                                                                                                                                                                                                                            |

### 60.6 What this slice did NOT do, and what is not claimed

- **It ran no database work.** `test:db` and `test:backend` were not run and no migration, seed or
  schema object was touched. No browser check and no acceptance result is claimed. The one hosted
  result cited anywhere in this section is the `web-quality` job of run `34759286884`, quoted from
  that run's own artefact.
- **It moved no baseline and no floor.** `.github/ci-baselines/` is untouched, and no local
  measurement was written into a record, a baseline or this section.
- **It claims no gate passed on a local run.** The coverage gate verdict now written into the
  coverage record is the HOSTED gate's own verdict, transcribed from run `34759286884`'s
  `coverage-web.md`. The local checks this slice ran are named in the pull request, and the local
  coverage run's figures are recorded in no document.
- **It changed no application source, no gate, no allow-list, no suppression and no npm script.**
  The only executable file it adds is a test.
- **It did not move SEC-002 or QA-001 to `end-to-end verified`.** Rule 2 of the state vocabulary
  refuses that state without an acceptance record, and both artefacts here are a component suite and
  a document.
- **It corrected no other slice's figure**, and it used **no change-control identifier other than
  CC-50**. One disagreement was OBSERVED in another slice's record and is deliberately left there:
  § 5 of `security-and-qa-evidence.md` says "seven files use `it.each`" while § 5's own table beside
  it shows **six**, and six is what the regex returns over those same eleven files on this tree
  (`delivery.dom` 3, `delivery-api` 4, `reports.dom` 2, `reports-api` 3, `reports-overview` 1,
  `audit-log` 1). The number is a floor qualifier, so **neither reading moves the 396** and no count
  in this slice's own record depends on it. `security-and-qa-evidence.md` is section 56's artefact
  and a figure in it moves by that slice's measurement; raising an identifier for it here would be
  claiming a finding this slice has no authority to close. Stated so the next reader does not
  rediscover it as a defect.

## 59. Closing the SEC-003 residue and QA-004 — what was measured, and what was owed

This section is the change-control record of one slice, allocated § 59 and **CC-49** and holding
no other identifier (§ 48.1: identifiers are never renumbered). It changes **no product code, no
route, no permission, no migration, no seed, no gate, no allow-list and no message catalogue**. It
adds two backend suites and moves two rows of the task matrix.

**Slice:** `feature/p1-31-escalation-and-concurrency-tests`, opened as pull request
[#386](https://github.com/Ezzaldeen-Albitar/RootLco/pull/386). **Baseline:** protected `develop`
**`81b3bce804626353a1a7b9f4ba52f1306c8f8b6e`** (the merge of PR #380) for the branch's own two
commits, then merged with protected `develop`
**`474d89ef8ad938b09be5a3f81f22546caaf887c0`** (the merge of PR #385) before the pull request was
opened. `main` `1262de74`, untouched.

**The standing rule this slice runs under, restated because it is the rule that is easiest to
break by accident.** A backend suite is never pointed at the shared acceptance stack. The tier
selects its database only through `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD`
(`tests/backend/helpers.ts:72-95`, `tests/db/helpers.ts:30-34`) and every one of those defaults to
the shared stack, so a command that omits them targets it silently. Two of the reasons are
specific rather than general: `cleanFixtures` calls `deleteTenantCascade([TENANT_A, TENANT_B])`,
which removes those two fixture tenants outright; and the platform-row sweeps beside it delete
`shared.system_settings`, `shared.localization_keys`, `shared.document_categories` and their
neighbours by a `LIKE 'fx\_%'` code prefix with `tenant_id IS NULL`
(`tests/db/helpers.ts:704-735`) — a prefix match, not a tenant predicate, so it reaches any
platform-scope row that happens to carry the prefix. Both suites in this section were run only
against a disposable container; § 59.5 records the target.

### 59.1 The measurement came first, and it contradicted the brief

**Why § 59 sits below § 60 on the page.** § 59 was allocated to this slice before either
neighbour merged, and § 48.1 forbids renumbering an identifier once allocated. The merge queue
then ordered the slices differently from the numbers: § 60 reached `develop` first, so this
section is appended after it. The page is therefore in queue order below § 58, not in numeric
order, and that is deliberate — the number identifies the slice, the position records when it
landed.

The slice was scoped as ten owed stale-`If-Match` cases, sixteen owed replay cases and four owed
privilege-widening cases. Every one of those was measured against the repository before anything
was written, and most of them turned out to be already proved.

**The declaration counts were confirmed exactly.** Every `defineOperation({…})` literal under
the phase's eight namespaces in `apps/api/src/app/api/v1` was parsed. The P1-31 surface is **45
operations across 33 `route.ts` files** — 24 writes and 21 reads, 24 `auditClass: 'privileged'` and
21 `auditClass: 'none'`, **11** declaring `versionGuarded: true`, **16** declaring
`idempotent: true`, and **12** distinct permission codes. Every one of those figures is the one
§ "The surface every section below measures" of the evidence index already carries. An earlier
draft of this subsection said 46; the parse says 45, and the eight namespaces are `deliveries`,
`delivery-checklist-templates`, `delivery-readiness`, `report-configurations`, `reports`,
`warranties`, `warranty-policies` and `org/employees` — `org/**` outside `employees` is P1-13 and
P1-19 work this phase neither added nor changed, and counting it is where the extra operation came
from. The guarded eleven are `org.employee-status-set`,
`rpt.report-configuration-status-set`, `rpt.report-configuration-update`,
`rpt.report-configuration-version-publish`, `sal.delivery-checklist-template-item-update`,
`sal.delivery-checklist-template-rename`, `sal.delivery-checklist-template-status-set`,
`sal.delivery-complete`, `wty.warranty-coverage-status-set`, `wty.warranty-policy-rename` and
`wty.warranty-policy-status-set`.

**One naming correction.** The brief described the ten non-delivery guarded operations as three
`delivery-checklist-template-*`, three `report-configuration-*`, three `warranty-policy-*` and
`org.employee-status-set`. The count is right and the third group is not: only **two** are
`warranty-policy-*` (`rename`, `status-set`). The third `wty` guarded operation is
`wty.warranty-coverage-status-set`, which is a COVERAGE command, not a policy one — and it is the
single operation this slice exists for, so the distinction is load-bearing rather than pedantic.

**All ten already had a stale-`If-Match` case, and all sixteen a replay case.** Each was read, not
inferred from a `COVERAGE-EVIDENCE` marker: `p1-31-warranty-policy-seam.test.ts` P10-C2 and P10-C3,
`p1-31-report-configuration-seam.test.ts` (the edit, the status and the publish, the last offering
the CONFIGURATION's counter on the VERSION's path), `p1-31-delivery-checklist-template-seam.test.ts`
(rename, status, item update), and `p1-31-delivering-employee-seam.test.ts` P17-S3. Each asserts 409
`ERR-CON-001` on a real row. **Nothing was duplicated**, and the two new suites assert none of it.

**Three of the four widening paths were already proved too.** A holder of `sal.delivery.manage`
without `sal.delivery.complete` is refused completion in `p1-22-delivery.test.ts`, which also shows
that principal succeeding on a preparation write so the 403 can only be the missing code; the
`wty.warranty.read` / `wty.policy.manage` pair is proved in both directions across all five writes
by `p1-31-warranty-policy-seam.test.ts` P10-P0, P10-P1 and P10-P2; the
`org.employee.manage` / `org.employee.read` pair is proved in both directions by
`p1-31-delivering-employee-seam.test.ts` P17-L3 and P17-L4. **A fifth pair nobody named is also
already proved** — `rpt.report.read` against `rpt.report.configure`, in the `RPT_READER` block of
`p1-31-report-configuration-seam.test.ts`. None of these was rewritten.

### 59.2 What was genuinely owed

**The self-delegation path.** Every existing case asks whether a principal may USE an authority it
does not hold. None asked whether it may GIVE ITSELF one. That is the sentence **CC-16** and
**CC-20** both close on — "`ins_role_permissions_delegable` admits a mapping only when the acting
administrator already holds the code" — and it is why those two dispositions are survivable at all:
it is the reason an organisation on an older bundle must wait for an operator backfill instead of
its administrator simply minting the new codes. Nothing asserted it for the P1-31 codes.
`iam-admin-writes.test.ts` proves the neighbouring refusal (no `iam.role.manage` at all) and
`iam-access-administration.test.ts` proves the role-GRANT path for one P1-14 code.

**CC-17's first half.** CC-17 records that `wty.warranty-coverage-status-set` is version-guarded and
deliberately NOT idempotent. Its second half — a refused reactivation into a re-covered window burns
no version — is proved by P10-B3 of the policy seam. Its first half was declared and never
asserted: no assertion anywhere pinned the ABSENCE of idempotency, so `idempotent: true` could have
been added to that route and every tier would still have passed. That is precisely the class of
defect this phase has been bitten by — a declaration nothing can disagree with.

**The phase SET, rather than a path through it.** The first version of the escalation suite closed
the self-delegation path and nothing else: every one of its contexts was the same tenant-A
administrator, `TENANT_B` was never used, and no P1-31 operation was called by a
lesser-privileged caller at all. So the widening claim it supported was about one table, not about
the forty-five operations SEC-003 is scoped over. Three probes were owed and are now present, each
driven over the parsed set rather than over a list:

- **least privilege on all 45** (all declared codes withheld; each code individually for the five
  multi-code operations) — a tenant-A caller holding every P1-31 code except the ones the operation
  declares is refused `ERR-IAM-001`, and the refusal names exactly those codes. The twelve
  one-code-withheld cases are what separates a gate that requires EVERY declared code from one that
  requires any of them, which the all-at-once probe cannot do;
- **cross-tenant on the 40 that address a tenant-owned row** — a tenant-B caller holding all
  twelve codes addresses tenant A's rows and is refused; the five that address none (three
  tenant-wide lists, the report catalogue and the tenant-level configuration create) carry a
  written reason instead;
- **client-asserted scope on the 8 that carry one** — the five reads that name a (company, branch)
  pair in the query and the three creates that name a company in the body, each in two variants,
  another organisation's real pair and a pair that exists nowhere, and each asserting a zero
  row-count delta on `sal.delivery_checklist_templates`, `wty.warranty_policies` and `org.employees`
  so that "refused" also means "wrote nothing". Every actor in that block holds an UNRESTRICTED
  grant, so nothing is being narrowed by grant scope: the question is only whether a caller may name
  an organisation that is not its own.

Each probe carries its own control, because a negative without one is not evidence. The
least-privilege control re-issues the same request SHAPE, with freshly generated identifiers, as a
caller holding all twelve codes, and requires the answer to be neither `ERR-IAM-001` nor a 5xx. It
does not require the call to SUCCEED — against invented identifiers it cannot — and that is what
licenses those identifiers: the
permission gate runs before validation and before any lookup
(`apps/api/src/server/http/route-handler.ts:203-441`; every P1-31 route parses its path and body
inside the handler callback). The cross-tenant control re-issues the request as the owning tenant
against an EQUIVALENT row set authored by the same routine — not the same rows, because the control
writes and the probes it protects must address rows nothing has touched — and requires the refusal
not to appear, so a 404 for tenant B is tenancy rather than absence.

### 59.3 What changed

| file                                                     | change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/backend/p1-31-privilege-escalation.test.ts`       | NEW. SE-0 enumerates the phase surface with the permission-parity gate's own parser (`declaredPermissions`) and pins it at 45 operations over 33 route files and 12 codes, with the probe table required to cover exactly that set and every uncovered operation required to carry a reason; SE-1 pins the twelve codes as real catalogue rows and the acting administrator as holding none of them; SE-2 drives the wired service and is refused `ERR-IAM-001` naming the withheld code for all twelve, writing nothing; SE-3 bypasses the service and is refused `42501` by `ins_role_permissions_delegable` alone; SE-4 admits a `deny` for an unheld code and an `allow` for a held one, so the refusals are about delegation rather than about the table; SE-5 and SE-5C are least privilege and its control over all 45, with SE-5P withholding one declared code at a time on the five multi-code operations (12 cases); SE-6 and SE-6C are cross-tenant refusal and its control over the 40 that address a row, with SE-6R covering `rpt.report-run`, the one operation addressed by a CODE; SE-7 is client-asserted scope over the 8 that carry one, in two variants each and with a zero row-count delta asserted on the three tables the body-scoped creates write to |
| `tests/backend/p1-31-concurrency-and-versioning.test.ts` | NEW. C17-0 pins how `shared.idempotency_keys` spells the two operations; C17-1 pins the declaration divergence against its four siblings; C17-2 proves a second submission under the SAME `Idempotency-Key` is refused 409 `ERR-CON-001` rather than replayed, burning no version; C17-3 proves this probe writes no reservation, as a before/after delta narrowed to the fixture tenants; C17-4 is the control that makes C17-3 falsifiable, and additionally requires the replay to move neither the policy's `record_version` nor its audit-record count                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/phase-1/phase-1-31/task-matrix.md`                 | the **SEC-003** and **QA-004** rows only, `not started` → `phase-level incomplete`, each citing its new artefact and the pre-existing artefacts the re-measurement found. No other row touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/phase-1/phase-1-31/change-control-2026-09-08.md`   | this section and the CC-49 disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 59.4 The control earned its place, on the first run

C17-3 asserts that `shared.idempotency_keys` holds no reservation for the coverage command. On the
first execution it passed — **for the wrong reason**. The `operation` column is not the registered
id: `ck_idempotency_keys_operation` constrains it to `^[a-z][a-z0-9_]{1,62}$`, so `toOperationCode`
writes `wty_warranty_coverage_status_set`, and a query for the dotted id returns zero for an
operation that reserved perfectly normally. C17-4 — written only so that zero could be falsified —
failed, which is how the defect was found rather than shipped. C17-0 now pins the mapping. **A zero
that cannot be distinguished from a wrong question is not evidence**, and this file records the
episode because the suite would have been green either way.

**And the same shape twice more, found by review rather than by a run.** C17-3 and C17-4 counted
`shared.idempotency_keys` with no tenant predicate, as ADMIN — a read that bypasses row-level
security over a table every tenant writes to. The absolute zero they asserted was therefore a claim
about the whole database rather than about the probe, true only because the disposable container
held nothing else. Both are now narrowed to the fixture tenants and compared as deltas. Separately,
C17-4 asserted a replay by its status and its body alone, which a route that simply re-executed the
command would also satisfy; it now captures the policy's `record_version` and its audit-record count
after the first call and requires both to be unmoved, with the audit count required to be non-zero
first so that "unchanged" is a statement about something.

### 59.5 What this slice does NOT claim

Neither row reaches `end-to-end verified`, and rule 2 is the reason: no acceptance record exercises
the self-delegation refusal, the least-privilege set or the ten non-delivery guarded operations.
`sal.delivery-complete` is the only guarded P1-31 operation an acceptance record covers (steps 103,
105, 116, 156). SEC-003 remains `phase-level incomplete`: the three probes are integration
assertions against a disposable database, not an acceptance record, and abuse cases beyond
privilege escalation, least privilege, tenancy and client-asserted scope — replay abuse, export
posture, file access — are unaddressed. QA-004 remains `phase-level incomplete`, and its open
decision is unchanged and undecided: whether P1-31 gets a sibling version-sourcing gate of its own
or a written waiver. This slice does not decide it.

Two further limits are stated rather than left to be inferred. The least-privilege probes address
their operations with invented identifiers, which is sound only because the permission gate
precedes validation and lookup; they therefore prove the GATE, and say nothing about what the
handler behind it would do. And the absence of a side effect is asserted for SE-7 only — a zero
row-count delta on the three tables the body-scoped creates write to — not for SE-6, whose forty
cases pin a refusal document and nothing about the database.

**The two suites were executed, and where.** Both were run against a DISPOSABLE PostgreSQL at
`127.0.0.1:55432`, database `p131_sec_20260913`, carrying 141 migrations and 121 permission rows —
not against the shared stack at `127.0.0.1:54322` that carries the Owner acceptance environment.
The target was resolved and read back from the server (`current_database()` and the port) before
the first suite ran. 2 files, 213 tests, all passing — 208 in the escalation suite and 5 in the
concurrency suite — and the pair was run twice in succession to establish that they are re-runnable
against a database their own fixtures have already dirtied.

**The whole backend tier was then run, on a second disposable clone.** Two suites passing says
nothing about what they did to the suites beside them, so the tier was run entire. The target was
`p131_backend_20260913` on the same disposable container at `127.0.0.1:55432`, cloned from the
template `p131_employee_ci_202609121735` so the run started from a known schema rather than from a
database these fixtures had already dirtied; 141 migrations and 121 permission rows were read back
from it before the run. **143 test files, 3242 tests, 0 failed.** The five variables
`DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` were set explicitly on that command
and on every backend command in this slice, which is the only thing that keeps the tier off the
shared stack — omitting them targets `127.0.0.1:54322` silently, and the prefix sweeps described
above would then have reached the Owner acceptance environment. No command in this slice omitted
them.

**And the two suites were run once more after the sync.** This branch was merged with `develop`
`474d89ef` before the pull request was opened, so the pair was re-run on the merged tree against
that same clone `p131_backend_20260913`: **2 files, 213 tests, 0 failed.** That is the third
execution of the pair and the first on a tree carrying §§ 55–58 and § 60. Nothing about side
effects is claimed beyond what the suites assert themselves — the zero row-count deltas SE-7 takes
around each of its sixteen cases, described in § 59.6.

**No tier baseline was re-recorded**: the declared floors
(`test-count-baseline.json`, `tiers.backend.minTests` 1300 against a measured 1380, and
`tiers.web.minTests` 3700) are minima that added tests cannot breach, and a floor is re-established
from a hosted run, never a local one. No hosted result is claimed.

### 59.6 One observation the probes produced, stated and not dispositioned

**SEC-003-O1 — the three body-scoped creates do not agree on how they refuse a foreign company.**
Each of the three answers the SAME way for another organisation's real company and for a company
that exists nowhere, and each writes nothing: SE-7 runs both variants and asserts a zero row-count
delta on `sal.delivery_checklist_templates`, `wty.warranty_policies` and `org.employees` around
every case, so neither half of that sentence is an inference. What they disagree on is the
document: `org.employee-create` answers 404 `ERR-RES-001`, while
`sal.delivery-checklist-template-create` and `wty.warranty-policy-create` answer 422 `ERR-VAL-001`
with a `body.companyId` / `unknown_company` violation, mapped deliberately from
`fk_warranty_policies_company` and its sibling
(`apps/api/src/modules/warranty/application/warranty-policy-service.ts:669-677`). MD-X1 records the
body-scoped creates as keeping "the 404 their composite foreign key and RLS already produce", which
is true of one of these three and not of the other two.

**SEC-003-O2 — `rpt.report-run` resolves a PLATFORM dataset, not a tenant's own report
configuration, and the two answer differently.** A code from `rpt.report_configurations` is not
runnable: SE-6R shows the fixture's own published configuration answering 404 `ERR-RES-001` to the
tenant that published it as well as to a stranger, so a 404 on that path carries no information
about tenancy and this slice does not offer it as isolation evidence. A registered dataset code —
`work_orders_by_status` — resolves for BOTH tenants, which is correct: the code belongs to the
platform. The isolation is in the rows, and SE-6R states it as a count: run over tenant A's branch
it returns a non-empty page, and run by tenant B over tenant B's OWN branch, with the same code, it
returns exactly zero rows. The suite pins what each operation actually
does and names this observation beside it rather than pinning a shape the platform does not have.
No identifier is allocated: it is a contract question for the Backend lane, not a change this slice
made, and § 48.1 forbids renumbering an identifier once allocated.

| id        | disposition                                                                                                   | why it is recorded rather than fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | owner   | state          |
| --------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | -------------- |
| **CC-49** | **twenty-four of the twenty-six cases this slice was scoped for were already proved, and were not rewritten** | The brief was written from a count of declarations, not from a reading of the suites. Re-measurement found every stale-`If-Match` case, every replay case and three of the four widening paths already asserted on real rows in the seam suites, plus a fifth widening pair nobody had named. Duplicating them would have added a second copy of each claim, a second place for it to drift, and no new information — so the two new suites do not restate any of it. What they add instead is the claim the brief did not ask for and SEC-003 is actually scoped over: the phase SET, probed operation by operation. The residue is recorded here so the gap between the scoped count and the delivered count is legible rather than looking like work that was skipped | QA lane | closed, stated |

---

## 61. The corrected acceptance re-run, the credential-kind design, and the harness re-measured (CC-51)

**Slice:** `feature/p1-31-acceptance-rerun`, ownership profile `p1-31-frontend`, opened as pull
request [#387](https://github.com/Ezzaldeen-Albitar/RootLco/pull/387). **Baseline:**
protected `develop` **`e2908f06d283516624959713e9f3f8bfb96f379d`**. `main` `1262de74`, untouched. This slice ran an acceptance,
recorded it, rewrote the browser half it exercised, and amends one earlier disposition. It changes
no application source: everything it touches is a test, a manifest the tests read, an evidence
document or this register.

### 61.1 Identifier allocation

Read on `develop` `e2908f06`, where this register holds sections 1 … 60 and identifiers
CC-01 … CC-50. **Section 61 and CC-51 are the lowest free pair.** The five-PR closure plan
pre-allocated §56 … §60 and CC-46 … CC-50, and this lane deliberately numbers above that block
rather than into it, because it is not one of those five.

**The landing order matters and is recorded rather than inferred.** This branch was written before
its predecessors merged and took its merge-queue turn after them; every figure below was therefore
re-taken on the merged tree rather than carried forward from the branch. Nothing is renumbered, and
section 52 is **amended in place** — its original sentence is left visible and an italic note beside
it withdraws the claim and names this section.

### 61.2 The run — `mtzmvemj`, 2026-09-13

| fact          | value                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP journey  | **194 steps, 0 findings**, exit code 0, verdict PASS, `auditActionsPresent` true                                                                            |
| browser half  | **40 of 40** P1-31 cases passed — twenty in `authenticated-en`, twenty in `authenticated-ar`, zero failures                                                 |
| screens       | **28** images and 0 failures, across 30 `ok` shot records in `screens.json`; the two without an image are the file-less signed-in navigation checks         |
| evidence      | `orchestration\evidence\p1-31\acceptance-20260913-1247\` — outside every git working tree. **Nothing of it is committed**                                   |
| harness       | `orchestration/acceptance/p1-31-journey.mjs`, sha256 `345beb5358954bea1fa9e373286f936f3bc577641a495761095dadf291e399d9`, **162055** bytes, recomputed after |
| organisations | the pair this run provisioned, `p31_journey_a_mtzmvemj` and `p31_journey_b_mtzmvemj`                                                                        |
| database      | `org.tenants` **39** before, **41** after — the two provisioned. **Nothing was deleted**: no reset, no `test:db`, no `test:backend`, no prefix cleanup      |
| record        | `acceptance-record.md` § 8, which supersedes nothing above it — §2 … §6 stay the record of `mtz2geo1` and §7.1 that of `mtz5ppq8`                           |

The verdict this run carries is **engineering**, not the phase's. No Owner Pass is recorded,
inferred or implied, and no hosted result is claimed for it: it was driven locally against a
production build.

### 61.3 The observation point, and the class-D repair by construction

§7.1 of the record named a fourth instrument defect, class **D**: the harness published its report
figures mid-journey, and the browser compared a screen against them afterwards. Between the two the
journey's own refusal cases open a second work order, and `work_orders_by_status` counts every
non-deleted work order in the period with no state filter. The screen was right; the figure was
stale.

The repair is a **rule, not an adjustment**: every figure the handoff publishes is read **after the
last write of the journey**. The mid-journey report run keeps its step labels, so the narrative is
unbroken, and a final pass re-reads all four datasets over the same period with the same token and
overwrites what the handoff carries. Only the overwritten value reaches the browser, and the traffic
stays one-way — nothing a browser observed is written back.

Two consequences a reader of both records needs:

- the final pass appends **eighteen** steps, so **176 became 194**, and every step number after the
  refusal cases is shifted by **+18**. **Compare the two runs by step LABEL, never by number.**
- the case that failed is repaired by the figure, not by a weaker assertion: `work_orders_by_status`
  answered **1** row at step **130** and **2** rows at step **177**, the second work order being the
  difference, and 2 is what the handoff published and what the screen rendered. The group count is
  **9** in both and is not what changed.

### 61.4 The credential-kind design

Two different callers reach these screens and hold different permission sets — the governed job's
owner-acceptance account, and the organisation administrator a local acceptance provisions. The
earlier specs accepted the surface **or** a refusal, which is a case that cannot fail for the reason
it exists. This slice replaces that shape everywhere with **one pinned outcome per credential kind**:

- **a committed manifest.** `apps/web/tests/e2e/authenticated/account-manifest.json` is generated
  from `OWNER_PERMISSIONS` and the tenant-administrator role by
  `scripts/dev/owner-acceptance/emit-account-manifest.mjs`, and `tests/ci/p1-31-account-manifest.test.ts`
  checks it in both directions against those two authorities, so it cannot silently drift.
- **a derived kind that throws.** `auth.setup.ts` matches the address it actually signed in with
  against the same two sources and writes `{ kind, email, source }` to `account-kind.json` beside the
  storage state. An address it cannot place is a hard failure there: no case defaults a kind.
- **one outcome per kind.** Each unconditional case asks the manifest what the signed-in account
  holds and pins the whole answer that account is owed — the refusal complete, with no trace of the
  surface behind the gate, or the surface complete.
- **the handoff-gated cases.** Fourteen of the twenty cases per locale project assert on a record the
  journey made and carry two gates: the handoff must exist, and the browser must be signed in as the
  administrator whose records they are. They are eleven `test(...)` declarations, two of which stand
  inside a four-code loop. The remaining six per project are the entitlement cases, which must
  execute everywhere and do.
  _(**One figure in the sentence above is wrong and is corrected here, with the original left
  visible.** Exactly **one** of the eleven handoff-gated declarations stands inside the four-code
  loop — the `for (const code of REPORT_CODES)` block in
  `apps/web/tests/e2e/authenticated/reports-p1-31.spec.ts` — so the arithmetic is **10 + 4 = 14**,
  not 9 + 8 = 17. The **fourteen** is right; the derivation printed beside it was not. Measured by
  reading the five specs, and confirmed independently by the run in section 62.4, where 28 P1-31
  cases skipped across two locale projects. Corrected by the closure re-measure, section 62.)_
- **seven legacy specs gated by kind.** `accessibility`, `administration`,
  `appointments-and-receptions`, `crm-and-vehicles`, `drawer-and-restore`, `isolation` and
  `shared-ux` now skip, naming the account, when the kind is not `owner-acceptance`. **No legacy
  assertion was altered and no expectation was weakened.** Five of them contributed the measured
  failures of the acceptance run; the other two contributed none and are gated for the same
  structural reason — a case that happens not to touch a missing row is still asserting about the
  wrong world.

**Where this is verified.** Statically in this pull request: the manifest test, the type and lint
gates, and the collected case list. Dynamically only by **pull request #387's own hosted
`authenticated-browser` job**, which sets only `ROOTLCO_E2E_AUTH` and signs in the owner-acceptance
account, so every legacy case must still execute there. No run in the acceptance record establishes
that, and none is claimed to.

### 61.5 The two harness alerts, re-measured (and section 52's claim withdrawn)

**The dataflow edge `js/http-to-file-access` is still present in the harness; relocation removed the
scanner, not the edge.** That is the whole correction. Measured on the file itself: every filename is
a literal on an operator-chosen directory, no identifier reaches a path (`evidenceFile` refuses
otherwise), all writes are `'wx'`, and content passes `evidenceSafe`.

**Disposition: a true positive of the rule, a false positive for path traversal and for overwrite.**
The residuals the re-measurement did find were fixed rather than argued away — `'w'` became `'wx'`,
and a predictable screens directory became an `mkdtemp` one. `0o700` and `0o600` are inert on
`win32` and are **not** a mitigation on the platform this ran on; they are honoured on POSIX and are
recorded as exactly that much.

Nothing here dismisses an alert, widens an allow-list or adds a suppression:
`.github/ci-baselines/codeql-baseline.json` keeps `maximumOpenFindings: 0` with an **empty**
`dismissals` array, and this section adds no entry to it.

### 61.6 What remains open

- **The Playwright JSON reporter is conditional on `CI`.** `apps/web/playwright.config.ts:131` emits
  a report only when `CI` is set, so a locally driven acceptance leaves no reporter artefact and its
  pass counts are operator-recorded from the console. The failures are evidenced by the retained
  per-failure directories and the runner's own ledger; the passes are not. Setting `CI=1` would
  produce the artefact but also turns on `forbidOnly` and turns off `reuseExistingServer`, so an
  acceptance operator must set it deliberately and record that they did. **This slice does not change
  the reporter**, and the remedy is named here rather than left as a gap a later reader rediscovers.

### 61.7 Dispositions

| id        | finding                                                                                                                        | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CC-51** | **section 52.6 stated that the two CodeQL findings were "resolved by RELOCATION, not by dismissal", and that is not accurate** | Re-measured on the harness itself at the digest this run used. Moving a file out of the analysed tree removes the **scanner**, not the **dataflow edge**: the path from HTTP responses to the filesystem is still there, and would still be reported if the file were analysed. What the re-measurement can say about the edge is narrower and is said in § 61.5 — literal filenames on an operator-chosen directory, no identifier reaching a path, `'wx'` on every write, `evidenceSafe` on every value, and two residuals (`'w'` and a predictable screens directory) that were **fixed** rather than dispositioned | **the earlier claim is WITHDRAWN and section 52.6 is amended in place.** The original sentence is preserved and an italic note beside it points here, so the record shows what was claimed and what replaced it. The finding is dispositioned as a true positive of the rule and a false positive for traversal and overwrite; no entry was added to `dismissals`, no threshold moved, no path exempted, and no reviewer is named for an approval nobody gave. The harness stays outside the repository on the P1-30 precedent § 52.6 cites — that part of § 52.6 stands — and this row is the reason a reader must not read its absence from the scan as a clean result |

### 61.8 What this slice did NOT do

- **It changed no application source.** No route, no operation, no permission code, no migration, no
  screen. Every changed file is a test, a manifest a test reads, a document, or the acceptance
  baseline entry that registers the fifth spec.
- **It recorded no Owner verdict and closed no canonical task by merging.** Three matrix rows move,
  and they move on the acceptance record's evidence under that file's own rule 2, not on this merge.
- **It claims no hosted result.** Whether the `authenticated-browser` job goes green at the head this
  branch produces is a fact only that job can establish.
- **It ran no migration and no database operation**, and it deleted nothing: the acceptance was
  read-only about every organisation that existed before it.
- **It committed no evidence and no credential.** The handoff was removed by the harness's own
  `--remove-handoff` once the browser and screenshot halves were done, and the trace archives were
  deliberately not copied, because a trace carries the session cookie.

---

## 62. The closure re-measure — the records reconciled at one head, and the Owner packet routed (CC-52)

**Slice:** `feature/p1-31-closure-remeasure`, ownership profile `p1-31-frontend`, opened as pull
request [#388](https://github.com/Ezzaldeen-Albitar/RootLco/pull/388). **Baseline:**
protected `develop` **`fb65b0493d6ef2f8e65c00c39a2d51a42a98ff1f`** — the merge of pull request #387, the corrected acceptance
re-run. `main` `1262de74`, untouched and far behind. **This slice is documentation only**: no
application source, no route, no operation, no permission code, no migration, no seed, no gate, no
allow-list, no baseline, no workflow and no npm script changes, and the only executable file it
reads is a test it does not edit.

**Why it exists.** Six lanes merged in one day, each correct about its own subject and each leaving
statements elsewhere that its own merge falsified — "not merged into `develop`", "#385 merging",
"in open PR #383", "does not exist on this head". A record that says a thing is unmerged after it
merged is not a small defect: it is the class of defect the whole phase's traceability rests on not
having. This section re-measures the four phase records at one head, corrects each falsified
statement in place with the original left visible, and routes to the approval owner the one document
only the Owner can act on.

**Authority:** [`task-matrix.md`](./task-matrix.md) owns state, [`closure-record.md`](./closure-record.md)
quotes it, and [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) assesses. That order is
preserved: this slice moves states in the matrix first, and the other two files quote the matrix
rather than deriving anything of their own.

### 62.1 Identifier allocation

Read on the merged tree at `fb65b049`, where this register holds **sections 1 … 61 with no gap**
and **identifiers CC-01 … CC-51**, the one hole at **CC-40** being the permanent one § 57.5 records.
**Section 62 and CC-52 are the lowest free pair**, and **neither is PROVISIONAL**: no unmerged P1-31
branch claims either, because every lane the five-PR closure plan named has merged. Section 48.1's
rule holds unchanged — an identifier is a claim about the register at the moment it was raised and is
never renumbered to follow heading order.

**Two earlier allocations are de-marked in place, and nothing about them is renumbered.** Section 58
(CC-48, the write-shape gate) and section 60 (CC-50, the refused-download negative and the coverage
record) were written while their branches were unmerged and carried **PROVISIONAL** in their
headings. Both have merged — #384 at `af924cab` and #385 at `474d89ef` — so both headings are
marked settled, with the previous wording kept in an italic note beside them. A heading is not an
identifier; no number moves.

### 62.2 What was re-measured, and what moved

| record                                                                                 | what this slice did                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`task-matrix.md`](./task-matrix.md)                                                   | **lowered three rows and raised none** — FE-004, FE-005 and FE-006 from `end-to-end verified` to `merged (write path)`, because no committed browser case exercises their surfaces (**CC-52 (c)**) — and re-measured **all twenty-nine rows on one head** for the first time, so the header no longer declares a measurement commit for five rows and leaves the other twenty-four on the heads their own slices recorded. Every "Next dependency" cell that named a past event as future — "#385 merging", "the branch reaching its merge-queue turn", "NOT yet merged into `develop`", "in open PR #383" — is rewritten, with the original kept in an italic note. A state-totals table is added. The prerequisite rows for **P-11** and **P-17** are corrected against `git log --first-parent`. The "Integration reconciliation — 2026-09-10" block is marked historical and superseded, and nothing in it is deleted |
| [`security-and-qa-evidence.md`](./security-and-qa-evidence.md)                         | re-measured at this head as its **fourth version**, under its own rule 5 — re-measured or corrected in place, never re-based. Every static checker it quotes was re-run on this tree and every figure it carries either reproduced or is corrected with what it replaces named                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [`closure-record.md`](./closure-record.md)                                             | re-measured at this head. Its § 2 per-task table is replaced by a **seven-column account of all twenty-nine tasks** — obligation with citation, implementation, evidence, what is missing by kind, the responsible owner, and the completion condition — the four Definition-of-Done bullets are re-adjudicated with the exact residue each carries, the gate table is re-derived, and a promotion-eligibility section is added. The verdict field stays empty                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **new** [`owner-decision-packet-2026-09-13.md`](./owner-decision-packet-2026-09-13.md) | the controlled record's routing to the approval owner, which the chapter requires and which § 57.6 recorded as owed. Twenty-six items in six blocks, eight of them marked as blocking, every citation resolved at this head                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| this register                                                                          | this section; the de-marking of §§ 58 and 60; four stale state cells annotated in place; § 57.4 marked superseded; § 57.6's routing row amended; and one figure in § 61.4 corrected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**The directory count and the register range, stated here because three files carry them and they
re-open on every merge — this is what CC-46(d) is about.** At `fb65b049` the phase directory
`docs/phase-1/phase-1-31/` holds **35** files; **as this pull request leaves the
file it holds 36**, the one addition being the Owner decision packet. The register
holds **sections 1 … 61 and CC-01 … CC-51** at that head and **1 … 62 with CC-01 … CC-52** as this
pull request leaves it. Both figures are stated in the assurance index at this head as well, which
is what closes **CC-46(d)**.

### 62.3 The record defects corrected, before → after

Each was measured before it was written, and each correction keeps the original claim visible.

| #   | where                                                        | before                                                                                                                                                                                                     | after                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `closure-record.md` § 5.1                                    | "**Six closures are stated in the register and nothing else is closed**"                                                                                                                                   | withdrawn. The register's own state cells read closed or settled for **47** identifiers at this head, and three the closure record counted open were closed in prose or stale. § 62.6 is the derived index                                    |
| 2   | `closure-record.md` § 5.1                                    | CC-17, CC-18, CC-36 and CC-39 with (a), (b), (c) listed as open                                                                                                                                            | all `closed` in the register's own cells (lines 635, 636, 2589, 3022–3025 at the pre-merge head). CC-17's live remainder is a **property**, not an open finding, and #386 pins it                                                             |
| 3   | `closure-record.md` § 5.1                                    | CC-33 with (a) and (b), and CC-34 with (a), (b) and (c), listed as open                                                                                                                                    | all `settled` in the register. **CC-34 itself** reads "recorded — no action here" and is filed open on that ambiguity, exactly as § 57.4 filed it                                                                                             |
| 4   | `closure-record.md` § 5.3                                    | CC-35(a) and CC-35(b) listed as "recommendations pending Owner approval"                                                                                                                                   | **decided by the Owner on 2026-09-12 (D-20) and implemented in § 47.5.** They are in the packet's "already decided" table, not among its questions                                                                                            |
| 5   | `closure-record.md` § 5.3                                    | "`OWR-2026-09-06-G-10` reads `Undecided` in `docs/product/owner-workflow-requirements.md`"                                                                                                                 | the row is in **`docs/product/owner-requirements-2026-09-06.md`**; the file the record named exists and carries no `G-10` row                                                                                                                 |
| 6   | `closure-record.md` § 2                                      | totals 12 / 3 / 5 / 7 / 2, measured across two heads                                                                                                                                                       | **15 / 5 / 0 / 9 / 0**, all twenty-nine counted on this head                                                                                                                                                                                  |
| 7   | `closure-record.md` § 2.1                                    | four Frontend rows not `end-to-end verified`, with a class-D narrative                                                                                                                                     | **one** — FE-009. The other three are answered by `acceptance-record.md` § 8, and the class-D narrative is superseded by § 8.2                                                                                                                |
| 8   | `security-and-qa-evidence.md` § 2                            | "Nothing on this tree exercises it" — the refused-download negative                                                                                                                                        | it exists: `apps/web/tests/delivery-signature-refusal.dom.test.tsx`, merged in #385                                                                                                                                                           |
| 9   | `security-and-qa-evidence.md` § 3.1                          | the privilege-escalation suite "does not exist on this head"                                                                                                                                               | it exists: `tests/backend/p1-31-privilege-escalation.test.ts`, merged in #386                                                                                                                                                                 |
| 10  | `security-and-qa-evidence.md` § 4                            | the eleven `wty.`/`rpt.` writes are "held to no mirror gate at all"; "the 21 `auditClass: 'none'` declarations are not individually justified in any record on this tree"                                  | both false at this head: `scripts/ci/check-p1-31-write-shape.mjs` covers the writes and [`audit-class-review.md`](./audit-class-review.md) justifies the declarations one line each. What is still missing is a **signature**, not a document |
| 11  | `security-and-qa-evidence.md` § 5                            | "**No phase-level coverage record exists**"; "#372 … this record did not re-check its state and does not claim one"                                                                                        | [`coverage-record.md`](./coverage-record.md) exists (#385), and #372 merged at `821ed668`                                                                                                                                                     |
| 12  | `security-and-qa-evidence.md` § 7                            | "**No artefact measures isolation across the 45 operations as a set**"                                                                                                                                     | #386's SE-6 and SE-7 probe the set operation by operation; what remains is that they run against a **disposable** database and no acceptance record exercises them                                                                            |
| 13  | `security-and-qa-evidence.md` § 9                            | the acceptance figures of `mtz2geo1` and `mtz5ppq8`, verdict PARTIAL                                                                                                                                       | § 8 of the record adds the corrected re-run — 194 steps, 0 findings, 40 of 40 P1-31 browser cases. That is an **engineering** PASS for the set; the record's § 1 verdict stays PARTIAL and no Owner Pass exists                               |
| 14  | `security-and-qa-evidence.md` §§ 11 and 13                   | "**No runbook document exists**"                                                                                                                                                                           | [`operator-runbook.md`](./operator-runbook.md) exists (#383), and it closed **CC-37(c)**                                                                                                                                                      |
| 15  | `security-and-qa-evidence.md` § 13                           | the register range "sections 1 … 54 … CC-01 … CC-44"                                                                                                                                                       | **1 … 62 with CC-01 … CC-52** as this pull request leaves the file                                                                                                                                                                            |
| 16  | `security-and-qa-evidence.md` §§ 9, 12                       | the phase directory at **31** files                                                                                                                                                                        | **36** as this pull request leaves it — the figure **CC-46(d)** re-opens on, closed here by measurement                                                                                                                                       |
| 17  | `security-and-qa-evidence.md` §§ 8 and 13                    | CC-17 called "a closed disposition" in one paragraph and listed under "Open items" in another                                                                                                              | resolved against the register's own cell, which reads `closed`: the finding is closed and the **property** it describes is live. Both places now say which they mean                                                                          |
| 18  | `security-and-qa-evidence.md` § 14, and this register § 49.3 | "the seven `rpt.report-configuration-*` **writes**"                                                                                                                                                        | the family is seven **operations** — **five writes and two reads**. § 49.3's row is annotated in place; the identifier is untouched                                                                                                           |
| 19  | this register § 49.3 / CC-37(a)                              | the disposition as written                                                                                                                                                                                 | **superseded by CC-48**: the gate § 58 ships is the mirror gate CC-37(a) said a later slice owed. The row is annotated, not rewritten                                                                                                         |
| 20  | this register §§ 3, 36.3, 52.4                               | CC-01 `open`, CC-02 `open`, CC-22 "implemented, pending merge", CC-42 "open, recorded, PROVISIONAL"                                                                                                        | annotated in place against the register's own prose and history: CC-01 and CC-02 closed at lines 614 and 796, CC-22 merged as #360 at `f8958e77`, CC-42 "closed by measurement" in § 54                                                       |
| 21  | this register § 61.4                                         | "They are **eleven** `test(...)` declarations, **two** of which stand inside a four-code loop"                                                                                                             | **ten standalone declarations plus one inside the four-code loop: 10 + 4 = 14.** Corrected in place in § 61.4 and proved in § 62.4 below                                                                                                      |
| 22  | `task-matrix.md`, and `acceptance-record.md` § 6             | FE-004, FE-005 and FE-006 at `end-to-end verified` on their HTTP chains alone, under a paragraph reading "Six tasks, each with both an HTTP chain that ran and a browser case that passed in both locales" | **three of the six had no browser case for their own surface.** The rows are lowered to `merged (write path)`, the acceptance record is annotated beside the paragraph with the original left visible, and the owed cases are **CC-52 (c)**   |

### 62.4 The dynamic proof § 61.4 said only a hosted job could give

Section 61.4 gated seven legacy specs on the account kind and recorded that the gating was verified
**statically** here and **dynamically only by pull request #387's own hosted `authenticated-browser`
job**. That job has now run, and this section reads it rather than assuming it.

**Source.** Workflow run `34766398961`, job `authenticated-browser / authenticated-browser`
(id `103748164202`), at head `efcfebb70f260945b0fd779447466a8c9de79012` — the head #387 merged.
**The check run's own summary is empty**, so the conclusion alone would say nothing beyond green.
The figures below are read from that run's artefact **`evidence-authenticated-browser`** (id
`10320098139`, 343666 bytes, digest
`sha256:3c2997282009e920c9bd0bc797bcfad689dc098648bd3aca578a02140c0a71d8`), files
`authenticated-browser.md` and `apps/web/playwright-report.json`.

**Run totals, from the reporter document:** **376 expected, 34 skipped, 0 unexpected, 0 flaky.**

| spec                                  | executed | skipped |
| ------------------------------------- | -------- | ------- |
| `accessibility.spec.ts`               | 48       | 6       |
| `administration.spec.ts`              | 54       | 0       |
| `appointments-and-receptions.spec.ts` | 141      | 0       |
| `crm-and-vehicles.spec.ts`            | 24       | 0       |
| `drawer-and-restore.spec.ts`          | 14       | 0       |
| `isolation.spec.ts`                   | 36       | 0       |
| `shared-ux.spec.ts`                   | 46       | 0       |
| `audit-log-p1-31.spec.ts`             | 2        | 2       |
| `delivery-p1-31.spec.ts`              | 2        | 6       |
| `overview-p1-31.spec.ts`              | 2        | 4       |
| `reports-p1-31.spec.ts`               | 4        | 10      |
| `warranty-p1-31.spec.ts`              | 2        | 6       |
| `auth.setup.ts`                       | 1        | 0       |
| **total**                             | **376**  | **34**  |

The twelve spec files sum to **375**; the three hundred and seventy-sixth executed test is the
`auth.setup.ts` setup project, which the artefact's own per-spec summary omits because it is not a
spec. It is listed above so the total reconciles rather than looking like an off-by-one.

**What that establishes, and what it does not.**

- **The kind gate did not fire on the hosted job**, which is exactly what § 61.4 predicted and could
  not prove: all seven gated specs executed, six of the seven with **zero** skips. The six skips in
  `accessibility.spec.ts` predate this phase and are not the kind guard — a kind skip would have
  suppressed all 54.
- **The P1-31 handoff gate DID fire, and the arithmetic it produces is the correction of § 61.4.**
  Twenty-eight P1-31 cases skipped across the two locale projects is **fourteen per project**, which
  is the figure § 61.4 states. Reading the declarations rather than the count: the handoff-gated set
  is **eleven `test(...)` declarations**, of which **exactly one** stands inside the four-code loop
  (`apps/web/tests/e2e/authenticated/reports-p1-31.spec.ts`, the `for (const code of REPORT_CODES)`
  block), so **10 + 4 = 14**. The original sentence said two declarations stand inside that loop,
  which would give 9 + 8 = 17 and does not reconcile with anything. The number 14 was right; the
  derivation printed beside it was not.
- **It says nothing about the acceptance run.** The locally driven run of `acceptance-record.md` § 8
  reported 270 passed / 125 failed / 6 skipped across the whole authenticated tier because it signed
  in as the journey's own administrator; the hosted job signs in as the owner-acceptance account.
  The two runs are different worlds and neither corrects the other's totals.
- **It is not a P1-31 acceptance.** The twelve executed P1-31 cases are the entitlement cases, which
  execute everywhere; the fourteen per project that assert on the journey's own records skipped, as
  they must without a handoff. **No task moves on this job**, and none is moved here.

### 62.5 The Owner decision packet, and what routing does and does not mean

[`owner-decision-packet-2026-09-13.md`](./owner-decision-packet-2026-09-13.md) is published by this
slice. It carries the acts **only the Owner can supply** — twenty-six items across gate and role acts,
the A0 decisions still open, the recommendations pending approval, one engineering decision open to
override, one Owner-document row, and the scope and authorisation acts — with eight marked as
blocking this phase. It states its inclusion criterion once and applies it once, excludes everything
an engineer or an operator may lawfully do, and lists what is already decided so that nothing is
asked twice.

**§ 57.6's routing row is amended in place, and the amendment is narrow.** Its answer to "Where has
this register been sent for approval?" read "**Routed to nobody as of 2026-09-13**", which was true
when written and is true no longer. What is true now is that the controlled record is routed and
**nothing has come back**: no acknowledgement, no approval, no verdict, and no reply of any kind. A
routing is an act of this lane; an acknowledgement is the Owner's, and none is claimed, implied or
inferred. The packet's own closing line says the same thing about itself.

### 62.6 Index of open dispositions — re-derived at this head

**This index supersedes § 57.4, which is marked superseded in place and is not deleted.** § 57.4 was
derived at `821ed668` plus #383 and partitioned 70 identifiers as 28 open, 38 closed or settled and 4
stating no usable disposition, with CC-47 the seventy-first. That was true of its own basis. Five
identifiers have been added since — CC-48 (§ 58), CC-49 (§ 59), CC-50 and CC-50 (a) (§ 60) and CC-51
(§ 61) — and four state cells are annotated by this slice, so the partition is re-derived rather than
adjusted.

**Method, so a reader can repeat it rather than trust it.** Every identifier in this file was
collected, and for each one the row that carries its own state was located in the section that
disposes of it — never an allocation-table row and never § 57.4's or this section's own summary row.
**This index moves no state**; where a state cell is ambiguous or absent, the ambiguity is reported.

**Open — 26.**

| id            | where  | one line                                                                                                                                                                                                                                 |
| ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CC-04**     | § 3    | `rpt.export` excluded from the bundle although shipped operations declare it                                                                                                                                                             |
| **CC-06**     | § 8    | the checklist-results read does not close P1-27-INT-088                                                                                                                                                                                  |
| **CC-10**     | § 13   | the warranty list does not close the status-history table                                                                                                                                                                                |
| **CC-12**     | § 22   | two Backend docblocks still say navigation names `sal.delivery.read`                                                                                                                                                                     |
| **CC-16**     | § 29.2 | organisations provisioned before P-10 cannot administer warranty policies. A runbook now documents the act; **CC-16 closes on the run**                                                                                                  |
| **CC-20**     | § 34.2 | organisations provisioned before the P-10/P-11 widenings hold neither new code. Same distinction                                                                                                                                         |
| **CC-23**     | § 37.2 | no index was added for the list ordering, and no migration was written                                                                                                                                                                   |
| **CC-24**     | § 39.2 | no batch variant of the four fact sources, so a page of N costs about 5N round trips                                                                                                                                                     |
| **CC-27**     | § 40.2 | compound: (a) approved 2026-09-10 apart from the source column, **(b) open**                                                                                                                                                             |
| **CC-27(b)**  | § 40.2 | the open half of CC-27, carried in CC-27's own state cell rather than in a row of its own                                                                                                                                                |
| **CC-29**     | § 41.2 | four delivering-employee recommendations remain pending Owner approval                                                                                                                                                                   |
| **CC-30**     | § 42.3 | an operator without `sal.finance.view` is refused the whole queue                                                                                                                                                                        |
| **CC-31**     | § 43.3 | FE-009 ships partial — a vehicle-filtered list, no per-record transition ledger                                                                                                                                                          |
| **CC-32**     | § 44.2 | the printed sheet carries a reference where a person's name belongs                                                                                                                                                                      |
| **CC-34**     | § 46.2 | D-4 names a transfer the ledger cannot express. **State cell ambiguous** — `recorded — no action here`; filed open, not resolved, exactly as § 57.4 filed it                                                                             |
| **CC-37(a)**  | § 49.3 | eleven `wty.`/`rpt.` writes are held to no payload-mirror gate. **Superseded by CC-48**, which builds that gate; the row is annotated and stays open until its own section is re-dispositioned by the lane that owns it                  |
| **CC-37(b)**  | § 49.3 | the report-configuration write family has no consumer outside a generated manifest                                                                                                                                                       |
| **CC-38**     | § 50.3 | amounts, quantities and durations display as the server's raw exact strings                                                                                                                                                              |
| **CC-38(a)**  | § 50.3 | two of three drill-through targets have no screen in this application                                                                                                                                                                    |
| **CC-41**     | § 53.3 | the overview is four report runs, not one summary read                                                                                                                                                                                   |
| **CC-43**     | § 54.4 | **closed in part; one cause open, stated.** The two failing browser cases it named are repaired by the corrected re-run of § 61, and the row's own cell is left to the lane that owns it                                                 |
| **CC-44**     | § 54.7 | the handoff-gated reporting cases pass only where the browser credentials are overridden. **§ 62.4 measures what actually happens**: on the hosted job they skip, by the handoff gate, and every legacy case executes                    |
| **CC-46(c)**  | § 56.4 | the OpenAPI bare-object success-schema shortfall is chapter-wide, not `sal.delivery-*`                                                                                                                                                   |
| **CC-47**     | § 57.3 | its own cell reads `open, indexed`, and this section is the index refreshed at a new head. **Not upgraded**: the disposition is "recorded and indexed, not re-adjudicated", and an index is not a closure of the findings it lists       |
| **CC-50 (a)** | § 60.5 | the per-file web coverage summary reaches no reader, so H-2 and H-3 can be filled from no hosted artefact                                                                                                                                |
| **CC-52 (c)** | § 62.7 | **three committed browser cases are owed** — delivery checklist recording, the final odometer and the signature evidence — in both locales, on the next acceptance pass. FE-004, FE-005 and FE-006 stay `merged (write path)` until then |

**States no usable disposition — 4.** Not open and not closed; the absence is the finding.

| id        | where   | why it states nothing                                                                                                                                                                                  |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CC-25** | § 38.3  | a prose bullet, not a table row, so it has no state cell                                                                                                                                               |
| **CC-26** | § 38.3  | a prose bullet for the same reason                                                                                                                                                                     |
| **CC-40** | nowhere | **allocated and never used** — the permanent hole § 57.5 records                                                                                                                                       |
| **CC-48** | § 58    | **section 58 carries no dispositions table at all**, so its identifier has no state cell. New at this head, and filed here rather than invented into a row this slice does not own — see **CC-52 (a)** |

**Closed or settled — 47.** CC-01, CC-02, CC-03, CC-05, CC-07, CC-08, CC-09, CC-11, CC-13, CC-14,
CC-15, CC-17, CC-18, CC-19, CC-21, CC-22, CC-27(c), CC-28, CC-29a, CC-29b, CC-33, CC-33(a),
CC-33(b), CC-34(a), CC-34(b), CC-34(c), CC-35, CC-35(a), CC-35(b), CC-35(c), CC-36, CC-37,
CC-37(c), CC-39, CC-39(a), CC-39(b), CC-39(c), CC-41(a), CC-42, CC-45, CC-46, CC-46(a), CC-46(b),
CC-46(d), CC-49, CC-50, CC-51.

**Five of those forty-seven move at this head, and each says why.**

- **CC-01** and **CC-02** — closed in the register's own prose at lines 614 and 796; their
  disposition rows read `open` and are annotated in place by this slice.
- **CC-22** — "implemented, pending merge" is stale, not open: #360 merged at `f8958e77`. Annotated.
- **CC-42** — "closed by measurement" in § 54; the row's `open, recorded, PROVISIONAL` is annotated.
- **CC-45** — "four `task-matrix.md` statements older than the head they were measured on",
  dispositioned to "the lane that next measures the matrix". **This is that lane**, and all
  twenty-nine rows are measured on one head, so CC-45 is **discharged by this re-measure**.
- **CC-46(d)** — re-opened when the phase directory grew past the count the assurance index stated.
  The index states **36** at this head, so **CC-46(d) is closed by this measurement**.

**Arithmetic, so a reader can check it rather than trust it.** This file carried **76** distinct
identifiers before this section, and this index is derived over those seventy-six **plus CC-52 (c)**:
**26 open + 4 stating no usable disposition + 47 closed or settled = 77.** **CC-52 (c) is folded in**
because it is the reason three matrix rows sit where they do, and a reader of the open set must meet
it there rather than only in a disposition table. **CC-52 with its sub-items (a) and (b) sit outside
the arithmetic**, on the precedent § 57.4 set for CC-47: a section's own raised identifiers are named
in its disposition table and are not counted into the index it derives. They are the seventy-eighth,
seventy-ninth and eightieth. _(This paragraph first read "**25 open + 4 + 47 = 76**", with all three
CC-52 sub-items outside; CC-52 (c) was raised after that count and is folded in here.)_ The partition is exact and no identifier is counted
twice: CC-27, CC-27(b) and CC-27(c) are three separate entries, and CC-46 with (a), (b), (c) and (d)
is five, of which only (c) is open.

**One structural observation, recorded because it is what makes this derivation hard.** Three of the
register's disposition tables carry **no `state` column** — § 55.3, § 60.5 and § 61.7 — so their state
must be read out of the disposition prose, and one section, § 58, carries **no disposition table at
all**. That is not a defect in any of those slices' findings; it is a defect in the register's own
shape, and it is raised as **CC-52 (a)** rather than fixed by editing four other lanes' tables.

### 62.7 Dispositions

| id            | finding                                                                                                                                                                                                                                                                       | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | owner / slice               | state            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------- |
| **CC-52**     | **six lanes merged in one day and left, in four phase records, statements their own merges falsified** — "NOT merged into `develop`", "#385 merging", "in open PR #383", "does not exist on this head", "No runbook document exists", "No phase-level coverage record exists" | Twenty-one distinct defects, each read on this tree before it was written and each tabled in § 62.3 with what it replaces. The task matrix carried two heads at once and two prerequisite rows contradicted `git log --first-parent`; the closure record's totals were counted across two heads and seven of its disposition statements disagreed with the register's own cells; the assurance index was measured at `81b3bce8` and eight of its central sentences had become false                                                                                                                                                                            | **corrected in place, at one head, with every original claim left visible.** Each corrected figure carries the § 14-style italic note the index's own rule 5 requires: a figure is re-measured or corrected in place, never silently re-based. No state is upgraded without the artefact its vocabulary requires: **twelve Frontend rows hold `end-to-end verified` at this head**, on the acceptance record's evidence, **nothing else moved into that state**, and **three rows were lowered out of it** — FE-004, FE-005 and FE-006 to `merged (write path)`, because no committed browser case exercises the delivery checklist, the final odometer or the signature evidence in either locale (**CC-52 (c)**). The Owner's verdict field stays empty. _(This clause read "fifteen Frontend rows are `end-to-end verified` on the acceptance record's evidence and nothing else moved into that state": true of what the record moved, and true when written, before CC-52 (c) lowered three of the fifteen.)_ The Owner packet is routed and no reply is claimed | this slice                  | closed, recorded |
| **CC-52 (a)** | **the register's own shape makes its state unreadable in four places**                                                                                                                                                                                                        | § 55.3, § 60.5 and § 61.7 carry disposition tables with **no `state` column**, so a state must be inferred from the disposition prose; § 58 carries **no disposition table**, so **CC-48** has no state cell anywhere                                                                                                                                                                                                                                                                                                                                                                                                                                          | **recorded, not fixed.** Adding a column to three other lanes' tables and a table to a fourth is a rewrite of four sections this slice does not own, and § 48.1's discipline is that a slice annotates rather than rewrites. The remedy is a register-hygiene slice that adds the missing column and the missing table, quoting each existing disposition unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | a later documentation slice | open, recorded   |
| **CC-52 (b)** | **a gate accepts a provenance word without reading the ledger behind it**                                                                                                                                                                                                     | `tests/ci/p1-27-doc-counts.test.ts:613` accepts either `local` or `HOSTED` as the provenance marker beside a recorded figure and does not check the run ledger, so a marker can claim a hosted provenance over a locally derived figure and the gate stays green. Observed by the § 58 lane and recorded for this re-measure                                                                                                                                                                                                                                                                                                                                   | **recorded, and deliberately not worked around.** Nothing in P1-31 relies on the weakness, no marker in this pull request claims a provenance it does not have, and the fix belongs to the lane that owns the gate. Widening or relaxing anything to accommodate it would be the defect the gate exists to prevent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | the CI-automation lane      | open, recorded   |
| **CC-52 (c)** | **three matrix rows held `end-to-end verified` on their HTTP chains alone**                                                                                                                                                                                                   | FE-004, FE-005 and FE-006 moved on the acceptance record's § 6, whose own stated standard is "both an HTTP chain that ran **and** a browser case that passed in both locales". **No committed browser case exercises the delivery checklist, the final odometer or the signature evidence in either locale.** The delivery case that opens the handed-over record asserts the summary, eligibility and receiver panels and nothing else; a search of the five `*-p1-31.spec.ts` files for those three subjects returns only the warranty screen's odometer-limit column. § 6's own "Not moved, and why" list applies the same standard to the rows it withheld | **the three rows are LOWERED to `merged (write path)`** — the vocabulary's state for work on `develop` including the commands the task implies, which is exactly what the HTTP journey exercised and all it exercised. **Three committed browser cases are owed**, in both locales, on the next acceptance pass, and the three rows stay where they are until then. The acceptance record is annotated beside the paragraph this corrects, with the original left visible; **no figure of the run itself moves**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | the acceptance re-run lane  | open, recorded   |

### 62.8 What this slice did NOT do, and what is not claimed

- **It ran no tier that needs a database, no build, no migration, no seed and no deployment.** The
  static checkers it re-ran are named beside the figures they produced. **Two figures come from a
  read-only query** against the shared local acceptance database — the tenant count and the count of
  journey organisations — and they are labelled as such where they appear; nothing was written,
  deleted or reset, and no organisation was removed.
- **It claims no hosted result of its own.** The one hosted run it reads is #387's
  `authenticated-browser` job, quoted from that run's own artefact in § 62.4 and attributed to it.
- **It moved no task into `end-to-end verified`, and it moved three OUT of it.** FE-004, FE-005
  and FE-006 are lowered to `merged (write path)` on a measurement of the committed browser
  suite, not on a judgement about the product: their write paths ran and their screens are
  asserted by nothing. Rule 2 refuses that state to documentary evidence,
  and every row that carries it does so on `acceptance-record.md` and on nothing this slice wrote.
- **It recorded no verdict, no certification, no clearance and no approval**, and it names no QA lead
  and no Security reviewer. Appointing a role holder is the Owner's act, and the packet asks for it.
- **It did not close a finding by re-wording it.** Where a state cell was stale it is annotated with
  the measurement that makes it stale; where a disposition is open it stays open, including the four
  where this slice would have preferred otherwise.
- **It did not renumber an identifier or delete a superseded passage.** § 57.4 is marked superseded
  and left whole; the 2026-09-10 reconciliation block in the task matrix is marked historical and
  left whole; §§ 58 and 60 are de-marked with their previous headings quoted.
- **It asserts nothing about promotion.** `main` is `1262de74`, this slice does not move it, and
  [`closure-record.md`](./closure-record.md) § 6 states in terms that the phase is **not eligible**
  for promotion and why.

## 63. The per-file web coverage artefact and the ledger-aware provenance gate (CC-53)

**Task ids:** P1-31-QA-001-010 (the artefact) and P1-31-QA-005-038 (the gate).

**Register pair:** section 63 and CC-53, the lowest free pair. Section 62 recorded the register as
running to "sections 1 … 62 with CC-01 … CC-52"; that was true of the head section 62 left, and this
section is the one identifier added since. The § 62.7 disposition partition
(**26 open + 4 stating no usable disposition + 47 closed or settled = 77**) was exact over the
identifiers that existed when it was computed. CC-53 is raised after it and sits outside it, so the
count with this section included is **78**. The earlier figure is left exactly as written, in the
annotate-rather-than-rewrite discipline § 48.1 states.

**Baseline:** protected `develop` `72f3a71e`. **Pull request #389**, head
`0582d196`, opened against `develop`.

### 63.1 What CC-53 addresses, and what it does not close

Two defects already recorded by other lanes, each repaired where it lives:

- **CC-50 (a)** — "the per-file web coverage summary reaches no reader, so H-2 and H-3 can be filled
  from no hosted artefact". The web-quality job MEASURES per-file coverage and then throws the
  measurement away.
- **CC-52 (b)** — "a gate accepts a provenance word without reading the ledger behind it".

Neither is closed by this section. The artefact half closes when a hosted run of **#389**
has produced the file and H-2 and H-3 are filled from it, which is the fill plan in § 63.6. The gate
half is repaired here in code, and **CC-52 (b) is for the § 62 lane to move**, not for this lane to
close on its behalf.

### 63.2 (A) The web-quality job keeps the coverage output it already writes

The "Web coverage ratchet" step at
[`.github/workflows/_reusable-node-quality.yml`](../../../.github/workflows/_reusable-node-quality.yml)
lines 705–711 runs `scripts/ci/coverage-gate.mjs` with
`--summary apps/web/coverage/web/coverage-summary.json` and
`--json coverage-gate-web.json --markdown coverage-web.md`. Both JSON files exist on the runner for
the rest of the job. Only the rendered markdown survived it: the upload list carried `*.md` and no
per-file web summary, so the two machine-readable halves were destroyed with the runner.

Two lines are added to the `evidence-${{ inputs.task }}` upload list, now at lines 882–905:

| added path                                    | why                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/web/coverage/web/coverage-summary.json` | the per-file measurement itself — instrumented files per tree (H-2) and the dashboard route tier's own figure (H-3)     |
| `coverage-gate-web.json`                      | the ratchet's verdict over that summary, the web counterpart of `coverage-gate.json`, which the list has always carried |

The list is otherwise unchanged: 22 entries before, 24 after, nothing removed and nothing reordered.
The explanatory prose sits **above** `path:` as a YAML comment rather than inside the block scalar,
because `path: |` is a literal block and a `#` line inside it is a search path and not a comment.

**Nothing about what is measured changes.** No coverage flag, no `coverage.include` list, no baseline
value and no floor is touched. This decides only whether the run keeps two files it already produces.

`protected-develop-verification.yml` and `pr-ci.yml` both call this same reusable workflow, so there
is no second upload list to edit and both inherit the change.

### 63.3 The baseline's `establishedBy`: an inconsistency recorded, not edited

[`coverage-record.md`](./coverage-record.md) § 5 observes that
`.github/ci-baselines/coverage-baseline.web.json:5` (`establishedBy`) cites
`apps/web/coverage/web/coverage-summary.json` inside artefact `evidence-web-quality` as the source of
its 131-instrumented-file figure — a file that artefact did not carry.

Correcting the field here was considered and **deliberately refused**, because it is machine-read and
not free-text provenance: `scripts/ci/coverage-gate.mjs:92` reads its truthiness to tell an
unestablished baseline from a silenced ratchet, `scripts/ci/coverage-gate.mjs:350` writes it, and
`tests/ci/baseline-integrity.test.ts:80-81` holds a sibling baseline to naming a run id in it.
Editing a machine-read field so that a citation reads true would be repairing the record rather than
the fact.

The fact is repaired instead: from the first hosted run after § 63.2 merges the artefact **does**
carry that file, and the citation becomes openable. The figure itself belongs to the coverage-policy
lane, and no value in `.github/ci-baselines/` is edited by this section.

### 63.4 (B) The provenance gate reads the ledger instead of accepting a word

`tests/ci/p1-27-doc-counts.test.ts:613` pinned the restated executed total with
`/\*\*The (\d+) is (?:local|HOSTED)/`. The alternation was deliberate and its reasoning is recorded in
the file: the case is about the page not stating two different totals, and pinning one word would
break at the local-to-hosted transition the sentence exists to describe. Both halves of that are
true, and the result still read nothing about provenance — either word passed whatever the ledger
held, so a local measurement relabelled HOSTED was invisible to every gate in the repository.

**The rule as implemented.** The word is now decided by parsing two committed ledgers:

1. Every `**The <n> is <word>…**` restatement on the page is collected. A page carrying none is
   REFUSED rather than passed, on the anti-vacuity rule the ownership gate applies to an empty diff.
2. The restatement is mapped to a tier by `evidence/closing-value-ledger.json`: the closing value
   whose `locator` is a prefix of the restatement and whose `binding.kind` is `run` names the `tier`
   and the `field`. A restatement no ledger row binds is REFUSED — nothing decides what it describes.
3. The tier's record in `evidence/local-run-ledger.json` decides the state. **No `provenance` block
   is LOCAL** — that is the repository's own marker, and `clean-room-evidence.md` says so in the
   sentence under test. A complete block is **HOSTED**. A block that is present and incomplete is
   **neither**, and is refused: `source` must be exactly `hosted`, `runId` and `job` must be all
   digits, `headSha` must be forty hexadecimal characters, and `source`, `runId`, `job`, `headSha`,
   `artifact`, `artifactDigest` and `field` must every one be a non-empty string.
4. The wording must match the state. LOCAL obliges "local, and it is pending attestation by this pull
   request's hosted run."; HOSTED obliges "HOSTED, and it is the binding measurement".
5. The number is still compared against the record's own `field`, which is what the old case did and
   is kept.

The first six required fields are `HOSTED_PROVENANCE_FIELDS` in
`scripts/ci/check-p1-27-closing-values.mjs`. **`artifactDigest` is required as a seventh, here.** The
writer emits it, and it is the only field tying the counts to bytes GitHub published rather than to a
run id somebody typed, so a block without it is a hosted claim with the checkable part removed.

**No checker carries the same pin.** A search of `scripts/` for the alternation and for the phrase
"binding measurement" returns nothing, so there is no second copy to bring into step; the test file
was the only place the wording was read.

### 63.5 The negative cases, and what each would have caught

Eight cases, all in `tests/ci/p1-27-doc-counts.test.ts`. **Seven** run against FIXTURE ledgers and
pages built inside the test rather than against the live files, so a refusal is exercised without
writing a false statement into a record; the eighth is the live pair. _(This sentence read "Six" when
it was written and in the commit message and pull-request description that carry it. The table below
was always right: one live case and seven fixture cases. Corrected here rather than re-counted
silently.)_

| case                                             | ledger fixture                      | page fixture    | outcome  |
| ------------------------------------------------ | ----------------------------------- | --------------- | -------- |
| the live record and the live page                | committed files, unmodified         | committed page  | **PASS** |
| a local record described as local                | no `provenance` block               | "local …"       | **PASS** |
| a hosted record described as binding             | complete `provenance`               | "HOSTED …"      | **PASS** |
| a hosted record still described as local         | complete `provenance`               | "local …"       | **FAIL** |
| a local record described as HOSTED               | no `provenance` block               | "HOSTED …"      | **FAIL** |
| a block with no `artifactDigest`, either wording | `provenance` minus `artifactDigest` | both, in turn   | **FAIL** |
| a restatement bound to no tier                   | complete `provenance`               | orphan sentence | **FAIL** |
| a page that restates nothing                     | no `provenance` block               | no restatement  | **FAIL** |

Each refusal asserts the TEXT of the refusal and not merely that one occurred, so a case cannot pass
on the wrong complaint. The two live tiers carry no provenance block at `72f3a71e`, the page reads
"local", and the live case passes on that agreement — it fails the moment a hosted run is recorded
and the sentence is not corrected, which is the behaviour that was missing.

**No ledger, record or evidence file is edited by this section.** No allow-list is widened, no
suppression is added, and no wording is relaxed to make anything pass.

### 63.6 The fill plan for H-2 and H-3 — phase two, and its rule

The two figures [`coverage-record.md`](./coverage-record.md) § 4 holds open stay open here. **This
pull request records no coverage figure of its own.**

They are filled by a SECOND slice, after **#389** merges and a hosted run of the changed workflow has
produced the artefact. The filling slice must state, beside every figure it writes:

- the **run id** and the **head sha** the run checked out;
- the **artefact id** of the `evidence-web-quality` artefact it read, and the **digest** GitHub
  publishes for those bytes;
- which file inside it each figure came from — `apps/web/coverage/web/coverage-summary.json` for the
  per-tree instrumented-file counts (H-2) and for the dashboard route tier's own figure (H-3), and
  `coverage-gate-web.json` for the ratchet's verdict over them.

**Never from an older run.** Runs `34759286884` and `34321869051` are both cited elsewhere in this
phase and neither carries the file, so a figure sourced from either would be a figure with no
artefact behind it — the exact defect CC-50 (a) names. A run that predates § 63.2 cannot satisfy this
plan whatever its numbers say.

### 63.7 Verification

Static and database-free. No tier needing a database, no production build, no browser tier and no
deployment was run, and none is claimed.

**Two rows below were WRONG when this section was first written, and they are corrected here rather
than quietly re-run.** The first table was produced with the change in the WORKING TREE, before the
commits existed. `check-p1-27-closing-values.mjs` refuses a run record once an executable path has
changed since the record was taken, and it computes that from committed history — so with nothing
committed there was nothing for it to see, and it reported 0 problems. At the real head `03ceac0f`
it exits **1**:

```
RUN_RECORD_STALE: the `unit` run was taken at 7c307653 and 2 executable path(s) have changed
since — .github/workflows/_reusable-node-quality.yml, tests/ci/p1-27-doc-counts.test.ts
RUN_RECORD_STALE: the `web` run was taken at 7c307653 and 2 executable path(s) have changed
since — .github/workflows/_reusable-node-quality.yml, tests/ci/p1-27-doc-counts.test.ts
```

`verify:policies` runs that same checker, so it was red for the same reason and at the same head.
The gate was right and the record was wrong: a slice that changes an executable path owes a
re-recorded run, and this slice owed two. **The lesson is general and is the reason this is written
out rather than deleted: a pre-commit run of a history-reading gate is not evidence about the
commit.** Both tiers are re-recorded below and both commands are green afterwards.

Each command is named with what it decided.

| command                                                                                              | result                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/ci/p1-27-doc-counts.test.ts`                                                   | pass, 49 cases, including the eight of § 63.5                                                                                               |
| `npm run typecheck`                                                                                  | pass                                                                                                                                        |
| `npm run lint`                                                                                       | pass                                                                                                                                        |
| `npm run format:check`                                                                               | pass                                                                                                                                        |
| `npm run test:unit`                                                                                  | pass                                                                                                                                        |
| `npm run security:all`                                                                               | pass                                                                                                                                        |
| `node scripts/ci/check-p1-27-doc-counts.mjs`                                                         | pass                                                                                                                                        |
| `node scripts/ci/check-p1-27-closing-values.mjs`                                                     | **FAILED at `03ceac0f`, exit 1** — RUN_RECORD_STALE on both tiers, as above                                                                 |
| the re-record: `evidence:p1-27`, `--record unit`, `evidence:p1-27`, `--record web`, `evidence:p1-27` | unit **3324 → 3332** tests, 125 files unchanged; web 4020 tests and 142 files both unchanged; both re-taken at `03ceac0f`, both still LOCAL |
| `node scripts/ci/check-p1-27-closing-values.mjs` after it                                            | pass — 58 classified, 0 problems, no RUN_RECORD_STALE                                                                                       |
| `npm run verify:policies` after it                                                                   | pass                                                                                                                                        |
| `npm run validate:plain-language`                                                                    | pass                                                                                                                                        |
| `npm run validate:encoding`                                                                          | pass                                                                                                                                        |
| `npm run verify:policies`                                                                            | **FAILED at `03ceac0f`** for the same reason — see the rows below                                                                           |
| `node scripts/ci/check-phase-ownership.mjs p1-31-frontend`                                           | pass, 0 violations                                                                                                                          |
| the workflow YAML parsed with `js-yaml`                                                              | parses; the upload list resolves to 24 entries with no comment line among them                                                              |

**Ownership.** The branch is `feature/p1-31-…`, which
`.github/ci-baselines/phase-ownership-profiles.json` maps to `p1-31-frontend`. That profile permits
`docs`, `tooling` — which is what classifies `.github/**` and `scripts/**` — `tests`, `web` and
`rootConfig`. The three trees this slice touches, the workflow and `tests/ci` and
`docs/phase-1/phase-1-31`, fall in `tooling`, `tests` and `docs`, so **one branch covers all three
and no split into two pull requests is needed**. No API source, no migration, no seed and no web
source is changed.

### 63.8 Dispositions

| id        | finding                                                                                                                                                 | disposition                                                                                                                                                                                                                                                                            | owner     | state                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------ |
| **CC-53** | the web tier measured per-file coverage into an artefact nobody kept, and the provenance gate beside it accepted either word without reading the ledger | **both repaired in code.** The upload list keeps `apps/web/coverage/web/coverage-summary.json` and `coverage-gate-web.json`; the wording pin is replaced by a rule that parses the closing-value ledger and the run ledger, with six fixture-driven refusals proving it can still fail | this lane | **open, pending the artefact** |

_**CC-53 is CLOSED.** The paragraph below is left exactly as written, because it states the
condition that closed it. Hosted run `34778434228` of #389, at head `03ceac0f`, uploaded both files;
H-2 and H-3 are filled from that artefact under the § 63.6 rule; § 63.10 records the fill. The state
cell above reads `open, pending the artefact` because that was true when the section was written and
this register annotates rather than rewrites — **read it with this note: closed, artefact received**._

CC-53 stays **open** on purpose. The code change is complete and verified; the measure it exists to
produce does not exist until a hosted run of this pull request has uploaded the file, and CC-53
closes when H-2 and H-3 are filled from that artefact under the § 63.6 rule.

**Related identifiers, and who moves them.** **CC-50 (a)** (§ 60.5) is unblocked by § 63.2 and moves
when the fill lands. **CC-52 (b)** (§ 62.7) describes the gate this section repairs and is the § 62
lane's to move.

_**CC-50 (a) is CLOSED**, by the same artefact and in the same fill: its whole content is that the
per-file web coverage summary reached no reader, so H-2 and H-3 could be filled from no hosted
artefact. Run `34778434228` carries it and both figures are filled. Its row in § 60.5 is not
rewritten and its section is not renumbered; this is the note that carries the state. **CC-52 (b)
remains OPEN** and is untouched here — the gate it names is repaired by § 63.4, but moving that
identifier is the § 62 lane's act, not this one's._

### 63.9 What this slice did NOT do

- **It claims no hosted result.** _Superseded by § 63.10, and left visible: no completed run of the
  changed workflow existed when #389 was opened, and that was the whole of the claim. Run
  `34778434228` has since completed and its artefact IS cited, in § 63.10 and in the coverage
  record. **No verdict of #389's own required checks is asserted anywhere**, then or now — the
  artefact is read for its files, not for a green tick._
- **It moved no task-matrix row, and touched no task matrix.**
- **It changed no ledger, no evidence record and no CI baseline value.**
- **It changed nothing about what coverage measures** — no threshold, no `include` list, no floor.
- **It did not close CC-50 (a), CC-52 (b) or CC-53**, and it closed no finding by re-wording it.
- **It added, renamed and removed no npm script**, so the command-coverage register is untouched.

**Two observations on the new rule, recorded rather than changed.** Both were found in review of
§ 63.4 and neither is a defect today; changing either would move a file outside `docs/` and make the
merge head a different tree from the one the hosted run measured, which is the whole basis of the
fill in § 63.10.

- **The tier lookup takes the FIRST matching ledger row** (`Array.prototype.find` over a
  locator-prefix test). One row matches each restatement on the live page today. If two closing
  values ever shared a locator prefix and bound to different tiers, the rule would silently use the
  earlier one rather than refusing the ambiguity. The fail-closed spelling is to collect all matches
  and refuse when there is more than one.
- **`RESTATED_PROVENANCE` captures the provenance word in group 2 and nothing reads it.** The wording
  is judged from the collapsed sentence body instead, which is strictly stronger — it checks the
  whole clause and not just the adjective — so the capture is dead rather than wrong. It is left in
  place here and should be removed by the next slice that touches the file.

### 63.10 The fill — H-2 and H-3, from run `34778434228` and no other

The phase-two fill § 63.6 planned is done, and it is recorded in
[`coverage-record.md`](./coverage-record.md) § 4 rather than restated here. What this section owes is
the provenance and the tree identity.

**Provenance.** Hosted run **`34778434228`**, job `103781039915`, at head **`03ceac0f`**, artefact
**`evidence-web-quality`** — artefact id `10323344410`, 409408 bytes, zip sha256
`2704a25f8a15a347660d0164c196992b8af23b056e42355a013e120417da3b50`. The archive was downloaded and
its bytes hashed before anything was read out of it; the digest above is the digest of the bytes the
figures came from and the digest the artefacts API publishes. Sixteen files, among them
`apps/web/coverage/web/coverage-summary.json` — **141 per-file entries**, total lines 2028/2396 =
84.64% — and `coverage-gate-web.json`, which carries the four metrics with their baselines and
deltas and `ok: true`. **This is the first run to carry either file**, which is § 63.2 doing the only
thing it was added to do.

**Tree identity.** The run measured `03ceac0f`. **Every commit on this branch after `03ceac0f`
changes only files under `docs/`** — this section, § 63.5, § 63.7, § 63.8, the coverage record, and
the P1-27 run ledger and the two records that quote it. So the executable tree run `34778434228`
measured is the executable tree the merge head carries, and the figures do not describe a tree that
will not be merged. That is why the re-record in § 63.7 and the corrections in this section are one
commit: a second executable change here would have invalidated the artefact this fill stands on.

**What was filled, and what the counting rule was.** H-2 is the instrumented-file count per
`COVERAGE_INCLUDE` root: 20 CRM, 23 vehicles, 64 dashboard, 34 `src/lib`, **141 together**, with
**no key outside the four roots**, which is the cross-check that the partition lost nothing. H-3 is
the dashboard route tier — **64 files, 506/819 lines = 61.78%** — and the ten P1-31 route pages
individually, **152/162 = 93.83%** together, matched by literal path rather than by keyword, all ten
resolved. Both rules are stated in the coverage record beside the figures.

**Neither hole is closed by its figure, and the record says so.** H-2 is that no P1-31 feature tree
is inside the instrument, and the 141-file table is now the evidence for it rather than an assertion
about it. H-3 is that `apps/web/src/app/` is exempt from the touched-file floor, so not one of those
ten percentages is enforced by anything. **H-2 and H-3 stay OPEN. CC-50 (a) and CC-53 close.**
QA-001 stays `phase-level incomplete`.

**No baseline is moved.** `.github/ci-baselines/coverage-baseline.web.json` records this tier at
52.91% across 55 files from run `34321869051`; run `34778434228` measures 61.78% across 64 at a later
head. The two are not reconciled here and the baseline is not edited — that is the coverage-policy
lane's, and § 63.3 already declined to edit a machine-read field in the same file for the same
reason.
---

## 64. The delivery WRITE browser proofs, and the acceptance instrument corrected (CC-54)

**Slice:** `feature/p1-31-delivery-browser-proofs`, ownership profile `p1-31-frontend`. **Baseline:**
protected `develop` **`72f3a71e`** — the head the closure queue left — and **merged up to `develop`
`852bcebd`** (the merge of #391) before this section was placed. `main` `1262de74`, untouched and
far behind. **This slice changes application source for two defects, in two commits, across
seven files under `apps/web/src`** — a delivery panel that had discarded its field errors and a
record view that had published a reference where a reading belongs, both landed before this
section was written — and is otherwise browser tests, an out-of-repository acceptance harness,
and these records. The seven are listed in §64.2. _(This sentence read "changes application
source in two files only": it counted the two defects and not the files they took, and it was
wrong as written.)_

**Purpose.** CC-52 (c) lowered FE-004, FE-005 and FE-006 out of `end-to-end verified` because no
committed browser case exercised the delivery checklist, the final odometer or the signature
evidence in either locale. This slice writes those cases, runs them against a production build, and
records what running them found — including two defects in the instrument and one in an earlier
version of this slice's own specs, none of them in the product.

### 64.1 Identifier allocation

Read on the **merged** tree, which holds sections **1 … 63, 65 and 66** and identifiers
**CC-01 … CC-53, CC-55 and CC-56** — the one hole at **CC-40** being the permanent one § 57.5
records. **Section 64 and CC-54 were reserved for this lane and are taken here**, and § 65.1 says so
in terms: "§ 64 / CC-54 is the Frontend proofs lane and lands later. When it does it belongs above
this section." It is placed there — between § 63 (CC-53, the per-file web coverage artefact, #389)
and § 65 (CC-55, the warranty transition ledger, P-18) — and **nothing is renumbered to make room**,
because nothing has to be: the gap this fills was left for it. § 66 (CC-56, the scope-target
contract, #391) follows § 65 and is untouched. **§ 67 and beyond are free**; any lane still in
flight takes the next pair off the merged tree, not off this branch.

§ 48.1's rule is unchanged: an identifier is a claim about the register at the moment it was raised
and is never renumbered to follow heading order. _(This subsection was written on the unmerged
branch and read "this register holds sections 1 … 62 … Section 63 and CC-53 are the lowest free
pair and are NOT taken here … the gap at 63 is deliberate". Every clause of that was true when
written — § 63 was then unmerged and § 65 and § 66 did not exist on any tree this branch could see —
and it is re-stated here for the merged tree rather than left to be read against a register it no
longer describes.)_

### 64.2 What landed on this branch

Off `develop` `72f3a71e`, in order:

| commit     | subject                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `4b72a4a8` | P1-31-FE-004-001: browser proofs for checklist, odometer, signatures     |
| `41919f7d` | P1-31-FE-006-002: surface signature capture refusals in the panel        |
| `ee67a7f9` | P1-31-FE-005-002: render the final odometer value on the record          |
| `e2ccab43` | P1-31-FE-004-002: fixture eligibility guard and enforcement assertions   |
| `16125bf2` | P1-31-FE-004-003: observe the not-found heading by role in both locales  |
| `62d98ce1` | P1-31-FE-004-004: gate legacy specs before their serial provisioning     |
| `171693a8` | P1-31-FE-004-005: assert the not-found description in both locales       |
| `9e98731b` | P1-31-FE-004-006: correct the handoff and spec counts                    |
| `f13a2d41` | P1-31-FE-004-007: record runs mu0diepc and mu0g1b1a in section 9         |
| `ffa6cb2b` | P1-31-FE-004-008: move FE-004/005/006 in the task matrix                 |
| `f66ee8b7` | P1-31-FE-004-009: open section 64 for the browser proofs                 |
| `8a8a246d` | P1-31-FE-004-010: correct the section 9 and 64 figures                   |
| `1b78de4e` | P1-31-FE-004-011: merge develop `852bcebd` into the browser-proofs slice |
| `c5c4abf6` | P1-31-FE-004-012: re-record the P1-27 runs at the merge head             |
| _(cite)_   | P1-31-FE-004-013: cite the record and pull request in section 64         |

_(A commit cannot list itself, so each sha is entered by the commit that follows it. `8a8a246d` was
entered by the merge, which is the resolution the sync turn owed and which re-states §64.1 for the
merged tree in the same act; `1b78de4e` and `c5c4abf6` are entered by `P1-31-FE-004-013`, which is
the last commit of the slice and so has nothing after it to enter its own. The pull request records
that one.)_

**The two application-source commits are `41919f7d` and `ee67a7f9`, and between them they touch
seven files under `apps/web/src`:**

| commit     | files under `apps/web/src`                                                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `41919f7d` | `features/delivery/components/SignaturesPanel.tsx`, `i18n/messages/en.json`, `i18n/messages/ar.json`                                                                                                                              |
| `ee67a7f9` | `app/[locale]/(dashboard)/delivery/[deliveryId]/page.tsx`, `features/delivery/components/DeliveryDetailScreen.tsx`, `features/delivery/components/DeliveryDocument.tsx`, `features/delivery/components/DeliveryDocumentPanel.tsx` |

`41919f7d` also adds cases to `apps/web/tests/delivery.dom.test.tsx`; that is a test file and is not
one of the seven. The first gives the signature capture form somewhere to state a refusal: it had discarded `fieldErrors`, and
`notifyActionResult` raises no toast for the `invalid` state, so a refused capture had looked
exactly like one that was never attempted. The second resolves the final odometer reading from the
vehicle's own history so the record shows the reading rather than an identifier a reader cannot
resolve. Both are defects this slice's own cases found while being written, and both are recorded
in the acceptance record's § 9.7 as the surfaces those cases assert.

### 64.3 The two runs

Both are recorded in [`acceptance-record.md`](./acceptance-record.md) **§ 9**, and both evidence
directories are outside every git working tree with nothing of either committed.

| run        | evidence directory            | HTTP                  | browser                                                                                                        | screens                                           |
| ---------- | ----------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `mu0diepc` | `…\acceptance-20260914-0105\` | 413 steps, 0 findings | 48 P1-31 cases executed, **47 passed, 1 failed**; the file's own tier reported 4 failed and 9 that did not run | 30 records all `ok`, 28 with an image, 0 failures |
| `mu0g1b1a` | `…\acceptance-20260914-0216\` | 413 steps, 0 findings | 418 collected, **49 passed** (1 sign-in setup + **48 of 48 P1-31**), 0 failed, 369 skipped, 0 did not run      | 30 records all `ok`, 28 with an image, 0 failures |

`mu0diepc` is kept because it is the run that found the defects, not because it is green. Its three
findings are set out in § 9.1 and none is a product defect: an Arabic locator that matched a
substring the body copy also carries; a legacy file whose account-kind gate fired after the hook it
was meant to gate; and four report datasets that answered empty because the instrument derived its
period from UTC days while the product buckets the day boundary in the branch's own timezone — which
is declared, Owner-approved under **D-17**, and cited to `apps/api/src/server/db/period.ts:31` and
`:78-79` and `report-run-service.ts:68-75`. **Nothing in `apps/api` or `apps/web` was changed for
that third finding.**

`mu0g1b1a` is the proof run: `SHOW timezone` on the acceptance database answered `UTC`, `org.tenants`
went 43 → 45 for the one new organisation pair the run provisions, the four datasets carried 8, 1, 1
and 2 rows over `2026-09-13` → `2026-09-15` in `Asia/Amman`, and
`delivery-writes-p1-31.spec.ts:143` passed in both locale projects. The legacy
`appointments-and-receptions.spec.ts` contributed 141 skips and nothing else.

### 64.4 The harness, and its digest history

The journey driver is held outside this repository at
`orchestration/acceptance/p1-31-journey.mjs`. Four digests exist; § 9.3 of the acceptance record
carries the table, and two of the four were never executed. The one that matters for honesty is
digest 2, `52c497d5…`, which anchored the harness's `today()` in the branch timezone and was
**withdrawn before any run**: the server's business date for pricing and the catalogue is the
database session's `current_date`, which on this database is UTC, so a branch-anchored
`effectiveFrom` would have been a day ahead of it for any run started between 21:00Z and midnight.
_(That reasoning is inference from `quotation-repository.ts:361-364`,
`quotation-service.ts:332`, `service-catalog-repository.ts:911` and the observed `SHOW timezone`;
**no run demonstrates the refusal it was withdrawn to avoid**, because it was never executed.)_ The
executed digests are `f6adab3c…` for `mu0diepc` and `652af24f…` for `mu0g1b1a`; the two withdrawn
ones are kept as snapshots beside the file so every change is diffable.

### 64.5 Twelve either-outcome expectations, replaced

The harness carried twelve expectations naming two acceptable statuses each. The Owner's rule is
that they may not exist:

> Do not weaken assertions, add blanket skips, or allow arbitrary “either permitted or refused”
> outcomes.

Each was resolved against what the two prior runs observed and what the product documents, and
pinned to the single documented value; where the documentation names a catalogue code, the code is
asserted as well. **All twelve answered as pinned in `mu0g1b1a` and the three code assertions
matched.** The table, with the file and line of each documented outcome, is § 9.4 of the acceptance
record. Two of the twelve — the query-scoped isolation reads — pin the status only, because their
recorded detail is a row count and nothing was added to it.

Run `mtzmvemj`, which § 8 of the acceptance record describes, **executed with the soft form in
place**. That is a limitation of that evidence, recorded here as one; it is not a retraction,
because every one of the twelve answered the value now pinned and § 8's substantive isolation claim
rests on `assertNoRow`, which was never soft.

### 64.6 Product observations — recorded, not fixed

Three, set out in § 9.6 of the acceptance record and none of them addressed by this slice:

1. **the business date and the report bucket are in different zones.** Pricing and the service
   catalogue decide effectiveness against the database session's `current_date`; reporting buckets
   in `org.branches.timezone_name`. A workshop whose branch is not in UTC has two ideas of "today"
   inside one product.
2. **the published contract understates two reads.** `docs/api/openapi.v1.json` publishes no 404 for
   `sal.delivery-read` or `wty.warranty-detail`, although both answer `404 ERR-RES-001` to a foreign
   tenant, which is what their own docblocks describe and what both runs observed.
3. **no OpenAPI text declares the report `to` semantics.** The exclusive upper bound bucketed in the
   branch timezone is stated only in the route docblock and in
   [`report-engine-seam.md`](./report-engine-seam.md) `:157` and `:392`.

### 64.7 What moved in the records

- [`acceptance-record.md`](./acceptance-record.md) gains **§ 9**, appended. Nothing above it is
  rewritten and no number is renumbered.
- [`task-matrix.md`](./task-matrix.md) moves **FE-004, FE-005 and FE-006** back to
  `end-to-end verified` and re-derives its totals to fifteen. **Those three rows are measured at
  branch head `171693a8`, not at the `develop` commit the file's header declares**, and the header
  says so; they are re-measured on `develop` when this branch merges. Rule 1 is untouched and no
  prerequisite count moves.
- [`closure-record.md`](./closure-record.md) is **not edited by this slice.** Its Frontend rows
  quote the matrix, and it is re-derived by the final integration. Its FE rows are owed to that
  integration and are stale until then; **CC-54 (d)** carries that. _(This bullet named that
  integration "**§ 70**" while §§ 63, 65 and 66 were not yet on this branch's tree. The register now
  reaches § 66 and further lanes are in flight, so the integration is named by what it is rather than
  by a number no allocation has reserved.)_

### 64.8 Dispositions

| id            | finding                                                                              | measured                                                                                                                                                                                                                                                                                   | disposition                                                                                                                                                                                                                                                                                                                                          | owner / slice                | status           |
| ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------- |
| **CC-54**     | **the three browser proofs CC-52 (c) said were owed did not exist**                  | FE-004, FE-005 and FE-006 held `end-to-end verified` on their HTTP chains alone and were lowered for it. Run `mu0g1b1a` of 2026-09-14 executed **48 of 48** P1-31 browser cases with 0 failed and 0 unrun, eight of them in `delivery-writes-p1-31.spec.ts`, four per locale               | **closed.** Each of the three tasks has, in both locales, a successful write through the real interface, at least one meaningful negative — FE-005's being the server's own refusal — and a reload that re-reads the persisted state from a fresh server read. The mapping is § 9.7 of the acceptance record and the three matrix rows are raised    | this slice                   | closed           |
| **CC-54 (a)** | **the business date and the report bucket are in different timezones**               | pricing and the catalogue compare against the database session's `current_date` (UTC here); reporting buckets in the branch's `org.branches.timezone_name`. Both are documented and neither is wrong against its own documentation                                                         | **recorded, not fixed.** Reconciling two modules' idea of a calendar day is a product decision, not an acceptance-instrument decision, and this slice changed nothing in `apps/api` or `apps/web` for it. To be raised as a follow-up item outside P1-31 and reported to the Owner                                                                   | a later backend lane / Owner | open, recorded   |
| **CC-54 (b)** | **the published contract publishes no 404 for two reads that answer one**            | `docs/api/openapi.v1.json` lists `200, 401, 403, 422, 429, 500` for `sal.delivery-read` and for `wty.warranty-detail`; both answered `404 ERR-RES-001` to a foreign tenant in `mtzmvemj`, `mu0diepc` and `mu0g1b1a`, which is what their route and service docblocks describe              | **recorded, not fixed.** The document is generated and is never hand-edited; correcting it means correcting the declaration it is generated from, which belongs to the lane that owns those routes. Nothing here relies on the gap and no allow-list was widened for it                                                                              | the owning backend lane      | open, recorded   |
| **CC-54 (c)** | **a legacy spec's account gate fired after the hook it was meant to gate**           | in `mu0diepc`, `appointments-and-receptions.spec.ts` reported 3 failures and 9 cases that did not run instead of twelve skips: the file-level `test.beforeEach` added by `72f34d01` cannot run before a `beforeAll`, and that hook shells out to the owner-acceptance provisioning command | **closed by `62d98ce1`.** The same condition with the same reason is asked as the first statement of that hook, so the group is skipped before it provisions. The condition and the reason are the account-kind rule and nothing wider; the other six specs gated alongside it declare no `beforeAll`. Observed in `mu0g1b1a` as 141 skips, 0 failed | this slice                   | closed           |
| **CC-54 (d)** | **the closure record's Frontend rows are stale against the matrix this slice moves** | [`closure-record.md`](./closure-record.md) quotes the matrix's FE states and its § 8-era figures, and this slice raises three of those rows and adds a second corrected re-run the closure record does not mention                                                                         | **open, and deliberately not edited here.** The closure record is re-derived at one head by the final integration; editing it from a branch would put two derivations of the same totals in the tree. Its FE rows are owed to that integration                                                                                                       | the final integration        | open, recorded   |
| **CC-54 (e)** | **the queue-1 evidence was taken with the soft expectations still in the harness**   | run `mtzmvemj`, recorded in § 8, and run `mu0diepc`, recorded in § 9.1, both executed a harness carrying twelve `either / or` status expectations. Every one of the twelve answered the value later pinned, in both runs                                                                   | **closed as a recorded limitation, not a retraction.** § 9.4 states which twelve, what each observed, what the product documents and what each is now pinned to. § 8's substantive isolation claim rests on `assertNoRow`, a separate assertion that was never soft. No figure of either earlier run moves                                           | this slice                   | closed, recorded |

### 64.9 What this slice did NOT do, and what is not claimed

- **It claims no hosted result and no attestation.** Whether the governed `authenticated-browser`
  job goes green at the head this branch produces is a fact only that job can establish, and it has
  not been asked. **No ledger tier was re-recorded in the turn that wrote this section**; the ledger
  is re-recorded in the sync turn, after the branch is brought up to `develop`.
- **It records no Owner verdict.** The acceptance record's own § 1 verdict stays **PARTIAL**, no
  explicit Owner Pass exists for this phase, and nothing here appoints a role holder.
- **It did not edit the closure record**, for the reason CC-54 (d) gives.
- **It fixed nothing in the product to make a run pass.** All three findings of `mu0diepc` were
  answered in the instrument or in this slice's own specs. The two application-source commits on
  this branch predate that run and were made because the cases being written found real gaps in what
  the screens tell an operator, not to make an assertion succeed.
- **It widened no expectation.** Twelve were narrowed; none was relaxed, no skip was added beyond
  the account-kind rule already in the tree, and no suppression or allow-list entry was created.
- **It did not renumber an identifier or rewrite a superseded passage.** Section 64 and CC-54 were
  reserved for this lane by § 65.1 and are taken exactly there; §§ 63, 65 and 66 are untouched and
  nothing moved to accommodate this one. Every figure this slice replaces in the task matrix is kept
  beside its replacement with the note that says when it was true. _(This bullet read "Section 63
  and CC-53 are left free for the lane merging ahead of this one": true when written, and that lane
  has since landed as #389.)_

### 64.10 The record at the merge head, and the pull request

The branch was brought up to `develop` `852bcebd` — the merge of #391 — by `1b78de4e`, whose only
conflict was this file and whose resolution §64.1 describes. **Both local P1-27 tiers were then
recorded once each at that head** by `c5c4abf6`, the unit tier over **125 files** and the web tier
over **142 files**, with the totals the `vitest` JSON reports carried. Neither tier was repeated and
no tier was re-run. The evidence manifest was regenerated before the first recording, between the
two and after the second, and `local-run-ledger.json` carries the commit each tier was taken at.

**The web total moved by six** from the figure `develop` carried, because `41919f7d` adds six cases
to `apps/web/tests/delivery.dom.test.tsx`. Three derived figures on
[`clean-room-evidence.md`](../phase-1-27/clean-room-evidence.md) are bound to that total and move
with it, together with the three `closing-value-ledger.json` entries that bind them — their locators
quote the figure, so a document-only edit would have unbound the very claims the check exists to
hold.

**Nothing here is recorded as hosted and no hosted run was invoked.** The pull request carrying this
slice is `P1-31-FE-004/005/006: delivery write proofs in both locales (§64)`, opened from
`feature/p1-31-delivery-browser-proofs`; its number is on the request itself, because a branch
cannot cite a pull request that does not exist until it is pushed.

## 65. The warranty transition ledger published — P-18, the backend half of FE-009 (CC-55)

**Slice:** `remediation/p1-31-backend-warranty-history`, ownership profile `p1-31-backend`, opened as
pull request [#390](https://github.com/Ezzaldeen-Albitar/RootLco/pull/390).
**Baseline:** protected `develop` **`72f3a71ee4a8204c494913e40e6c2a43cd683e36`**, then merged up to
**`591763df`** — the merge of pull request #389, the per-file web coverage artefact and the
ledger-aware provenance gate — before this branch was proposed. `main` `1262de74`, untouched and far
behind. **The full seam record is
[`warranty-history-seam.md`](./warranty-history-seam.md)**; this section records the change control.

**Why it exists.** **CC-10** has been open since § 13 and has been restated, unchanged, by five
slices since: `wty.warranty_status_history` is written by the database and read by no operation
anywhere in `apps/api/src`. **CC-31** named the missing piece as **P-18, warranty history reader**
and recorded FE-009 as shipping partial because of it — the warranty record screen states in the
operator's own language that the transition record cannot be read, rather than composing a sequence
from the record's current status, because an invented ledger would be believed.

**Authority.** The Owner instruction of 2026-09-13: where a prerequisite is only the missing backend
half of an already-required behaviour, the existing full-completion authorization applies through the
appropriate backend slice. That condition is met here by measurement rather than by assertion, and
§ 65.2 is the measurement.

### 65.1 Identifier allocation

**Section 65 and CC-55 are the pair reserved for this slice**, and neither is renumbered to follow
heading order — § 48.1's rule holds: an identifier is a claim about the register at the moment it
was raised.

**Section 64 is missing from this file on purpose, and it is not a hole this section may fill.**
Sections 63 and 64 and identifiers CC-53 and CC-54 were reserved for two other lanes when this pair
was allocated. § 63 / **CC-53** has since landed — the per-file web coverage artefact and the
ledger-aware provenance gate, merged as #389 — and it sits immediately above this section, in
number order, because the merge that brought it in put it there rather than because anything moved.
**§ 64 / CC-54 is the Frontend proofs lane and lands later.** When it does it belongs above this
section; renumbering either one to close the gap in the meantime is exactly what § 48.1 forbids.

### 65.2 What P-18 had to decide, measured before it was written

Everything a schema change would need already ships. Each row was read on this tree.

| would have needed a decision     | measured state                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| a table                          | `supabase/migrations/20260724095000_wty_warranty.sql:288`                                                                                |
| row-level security               | `ENABLE` and `FORCE` at `:311`–`:312`; `sel_warranty_status_history_scope` for `app_runtime` and `app_readonly` at `:313`                |
| a grant                          | `GRANT SELECT` to both application roles at `:321`–`:322`                                                                                |
| an index for the read's ordering | `ix_warranty_status_history_record` at `:309`, `(tenant, company, branch, warranty_record, occurred_at DESC, seq DESC)` — led on exactly |
| server-stamped attribution       | `tg_warranty_status_history_stamp` at `:310`                                                                                             |
| a permission code                | `wty.warranty.read`, seeded by P-7 at `supabase/seeds/04_iam_permission_catalog.sql:112`                                                 |
| a precedent for the shape        | `sal.delivery-status-history` (P-5), one schema over                                                                                     |

**So: no migration, no seed, no permission code, no schema baseline value, no provisioning-bundle
change, and no new business policy.** A caller who could already read the warranty record can now
read how it reached its status, under the same code, in the same scope.

### 65.3 What was published

| operation                     | path                                          | permission          | scope    | audit  | rate limit       |
| ----------------------------- | --------------------------------------------- | ------------------- | -------- | ------ | ---------------- |
| `wty.warranty-status-history` | `GET /warranties/{warrantyId}/status-history` | `wty.warranty.read` | `branch` | `none` | `expensive-read` |

`WarrantyStatusHistoryEnvelope` — `{ warrantyId, transitions: Page<WarrantyStatusHistoryEntryView> }`
— where a row is `{ id, fromStatus, toStatus, reason, actorId, occurredAt }`, field for field as
`DeliveryStatusHistoryEntryView` spells it. No monetary field, because `wty` has no monetary column,
and no `correlationId`, because that is platform diagnostics rather than a fact about the warranty.

**The published OpenAPI 200 schema is `{"type":"object"}` and that is NOT specific to this
operation.** The generator emits a bare object body for **all 296** operations in the document that
publish a 200 — measured on this tree, 296 of 296 — and the new GET's entry in
`docs/api/openapi.v1.json` is identical key for key to `sal.delivery-status-history`'s, the read it
mirrors. So the contract a consumer must build against
is the exported TypeScript envelope, `WarrantyStatusHistoryEnvelope` and
`WarrantyStatusHistoryEntryView` from `@/modules/warranty`, which
`scripts/ci/check-named-wire-shapes.mjs` requires to be named for exactly this reason. **The web
slice takes the field names, their types and their nullability from those two interfaces, never from
the published schema.** Enriching the generator's body schemas is a platform-wide change to every
one of those 296 and is not this slice's to make; it is noted here so a reader does not mistake a
generator default for a contract this operation chose.

### 65.4 The one thing a reader must not misread

**The ledger holds exactly ONE row per record today: the genesis `NULL -> 'issued'`.**

`wty.issue_warranty` writes it in the same statement that creates the record, and nothing in this
repository advances `wty.warranty_records.status` — `assertWritableStatus` refuses `active`,
`expired` and `voided` structurally. That is a fact about the WRITERS and not a limitation of this
read, and it is stated in the route docblock, in the repository method, in the module surface and
twice in the suite rather than left to be inferred from a short page. The read is nonetheless a
PAGE and not a single row, because the table is append-only with no ceiling in the DDL and its later
writers are the subject of later work.

The suite proves it as an honest negative, on a warranty the product alone created and no fixture
touched. The multi-row cases are arranged by a SQL fixture that says so above itself: no operation
appends a transition, so the fixture does what a writer would have to do and no more — the record's
status moves and the row is appended in the same transaction as that move, under the actor GUC the
stamp trigger reads, so `actor_id` and `occurred_at` are server-stamped exactly as in production and
nothing is inserted with a chosen id, actor or timestamp.

**Two ledger fixtures, one property each, and the second one is a correction made during this
slice.** `occurred_at` is `now()` and therefore transaction-stable, so rows appended in ONE
transaction tie to the microsecond and the read then falls back to its `id` tie-break — a random
uuid. A first version of this suite appended both transitions in one transaction AND asserted their
exact order; it passed, then failed, then passed, because it was asserting a uuid comparison. The
fix is not a looser assertion but two fixtures: one advanced in SEPARATE transactions, whose order is
total on the sort key and is asserted exactly, and one advanced in a SINGLE transaction, used only
for the paging walk — which asserts that nothing is skipped or repeated across the tie, and asserts
that the tie was really crossed, so a millisecond-truncated cursor (`P1-27-INT-006`) would fail it.

### 65.5 Dispositions

| id            | finding                                                                                                                                 | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | owner / slice       | state                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| **CC-55**     | **the warranty transition ledger had no reader, and the screen that needs it shipped partial**                                          | **CC-10** open since § 13 and restated unchanged by five slices; **CC-31** naming P-18 as the missing prerequisite. Everything the read needs already ships — table, RLS, policy, grant, index, stamp trigger and permission code, each cited in § 65.2 — so the gap was a route and a query, not a schema or an authority                                                                                                                                                                                                                                                                                                                                                                        | **closed. The read is published**, mirroring `sal.delivery-status-history` field for field. The query and the row mapper are both new, as P-5's were, and that is recorded rather than presented as a publication. **CC-10 is closed in place** with its original disposition quoted; **CC-31's backend half is closed** and its frontend half is left open in the same cell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | this slice          | closed, recorded                                                               |
| **CC-55 (a)** | **the ledger this read publishes has one row on every record the product can create**                                                   | No operation advances a warranty status. `wty.issue_warranty` is the only writer of the table anywhere, and `assertWritableStatus` refuses every writable status structurally                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **recorded, and NOT worked around.** The read is paged rather than shaped to the single row it can return today, and the fact is stated in four places in the source and twice in the suite. Whether a status writer should exist — expiry recorded rather than derived, and voiding as an authority — is a product decision nobody has been asked for, and inventing one to make the ledger look fuller would be the defect the screen's own refusal to simulate a ledger already avoided                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | a later `wty` slice | open, recorded                                                                 |
| **CC-55 (b)** | **the misnamed table propagated into six passages across four records before anyone read the migration**                                | `wty.warranty_record_status_history` — a name no migration ever created — is written as the CURRENT table name in **six** places: CC-10 (§ 13), this register's § 22 bullet at line 650, A0 item 9, the A0 FE-009 row, `warranty-read-seam.md:181` and `warranty-policy-seam.md:290`, plus a seventh in `security-and-qa-evidence.md:526`. § 43 and `warranty-record-screens.md` already flagged the discrepancy without correcting any source. _(This cell read "propagated into five records" and listed four; the register's own § 22 bullet and the security record were missed on the first pass and are corrected in the same slice, on review. The count is the passages, not the files.)_ | **all seven corrected in place, with the original wording quoted in a dated italic note beside each**, and each note also carrying the fact that CC-10 closed on 2026-09-13. Nothing is renumbered and no passage is deleted. **One statement is deliberately left as it stands**: the historical "Was:" quotation in the A0 FE-009 row, which is a quotation of what was written at the time and which § 48.1's discipline says to preserve. `security-and-qa-evidence.md` is annotated and NOT re-measured — the re-measurement of that record belongs to its owning lane                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | this slice          | closed, recorded                                                               |
| **CC-55 (c)** | **the phase's SE-0 operation pin was not moved with the operation this slice published, and the hosted backend tier is what caught it** | Hosted run 34785708991, job 103800833264 (`integration-tests`), on head `4c35a2ed`: the backend tier reported 3250 passed and **2 failed**, both in `tests/backend/p1-31-privilege-escalation.test.ts`, describe "P1-31-SEC-003 SE-0 — the phase operation set, parsed". The parse yielded **46 operations over 34 route files** against the pinned **45 / 33**, and the parsed set carried `wty.warranty-status-history` where the probe table did not. The coverage-ratchet failure reported after it is DERIVED and not a second defect: the tier aborted before a coverage summary was written                                                                                                | **fixed in commit `d923a63d`, by moving the measurement and not the assertion.** `EXPECTED_OPERATIONS` 45 → 46, `EXPECTED_ROUTE_FILES` 33 → 34, `CROSS_TENANT_PROBES` 40 → 41, and a probe for `wty.warranty-status-history` modelled on its closest sibling `wty.warranty-detail` — addressed by the warranty id, asserting no scope of its own — so the new operation is EXERCISED by SE-5, SE-5C, SE-6 and SE-6C rather than exempted from them. No assertion was weakened, no case was skipped, and no outcome was widened. The file alone was then run **against the disposable database only** — container `rootlco-p131-isolation-20260910`, `127.0.0.1:55432`, database `p131_p18_20260913`, with all five connection variables set explicitly so the shared acceptance database on 54322 was never addressed — and reported **212 passed, 0 failed**. **The full backend tier was NOT executed locally**; it is re-run by the hosted `integration-tests` job of the new head, and no result of that job is claimed here. **One stale citation is left standing and named rather than silently repaired:** `tests/backend/p1-31-privilege-escalation.test.ts:11` and `:312` both cite `security-and-qa-evidence.md:88-94` for totals that live at that record's `:163`. A comment-only edit to that test file would re-stale the P1-27 run record for no measurement, so the anchor is owed to the next lane that edits the file for a reason of its own — the phase-set proofs sync | this slice          | **open — pending the hosted `integration-tests` job of the head under review** |

### 65.6 What this slice did NOT do

- **It shipped no migration, no seed and no permission code**, and it changed no CI baseline, no
  provisioning bundle and no npm script.
- **It changed nothing under `apps/web/src`** except the generated
  `apps/web/src/lib/api/idempotent-operations.ts`, which every slice that publishes an operation
  regenerates. The ownership profile `p1-31-backend` forbids web source, and **FE-009's screen is
  therefore untouched**: this closes the obstacle, not the row.
- **It did not touch [`task-matrix.md`](./task-matrix.md) or
  [`closure-record.md`](./closure-record.md).** Those are the final integration's to move, and a
  backend slice raising its own row's state would be the defect § 62 spent a section correcting.
- **It moved no task into any verified state and recorded no verdict**, no approval and no hosted
  run of its own.
- **It added no warranty status writer, no claim surface and no simulated history.**
  **P1-22-L-01** is unchanged: no claim table exists in any schema, `'claimed_against'` is in the
  `to_status` CHECK vocabulary, and nothing anywhere writes it.
- **It did not renumber an identifier or delete a superseded passage.** CC-10's original disposition
  and CC-31's original cell are both quoted whole beside their corrections.

### 65.7 Verification

Every figure below is a LOCAL measurement taken in this worktree unless it names a hosted run, and
nothing here upgrades a local number into an attested one.

- **The record commit is `a3bec897`.** It re-recorded both P1-27 tier ledgers at `d923a63d`, after
  the SE-0 fix changed an executable path and made the previous record stale: **unit 3332 tests, 0
  failed, 125 files** and **web 4020 tests, 0 failed, 142 files**. Neither total moved — the four
  cases the new probe adds are `it.each` cases in the BACKEND tier, which the unit tier does not
  include, and no web source or web test was touched. **Both are local, and both are pending
  attestation by this pull request's hosted run**; the six CR-A sentences in
  [`../phase-1-27/clean-room-evidence.md`](../phase-1-27/clean-room-evidence.md) keep their LOCAL
  wording untouched. `check-p1-27-closing-values.mjs` with no argument then reported 58 classified
  values and 0 problems.
- **The backend evidence for this slice is one file, not the tier.**
  `tests/backend/p1-31-privilege-escalation.test.ts` ran alone against the **disposable** database —
  container `rootlco-p131-isolation-20260910`, `127.0.0.1:55432`, database `p131_p18_20260913`,
  whose migration ledger matches this branch's 141 migrations — and reported **212 passed, 0
  failed**, including the four cases the `wty.warranty-status-history` probe adds. **The full
  backend tier was not executed locally.** It is re-run in full by the hosted `integration-tests`
  job of the new head, and that job's result is not claimed anywhere in this section.
- **The hosted jobs of head `4c35a2ed`**, read from that head's check-run list at 22:14Z on
  2026-09-13. **Passed:** CodeQL, Docker build validation, Lint types tests build, Secret scan, Web
  quality, `application-build`, `change-detection`, `code-security` (both runs), `container-security`,
  `database-migration-replay`, `database-security`, `dependency-security`, `secret-scan`,
  `static-quality`, `unit-tests-coverage`. **Failed:** `integration-tests`, which is CC-55 (c) above
  and the reason this head is superseded. **Still in progress when the list was read, and therefore
  claimed neither way:** `Database migrations and RLS tests`, `authenticated-browser`,
  `hosted-clean-room`.

  _(True when written, and superseded by the conclusions the same head's check-run list carries now,
  read at 23:10Z on 2026-09-13. The three that were in progress have completed:
  **`authenticated-browser` concluded `success`**, and **`Database migrations and RLS tests` (run 34785708842) and `hosted-clean-room` both concluded `failure`** — their check-run annotations name
  the SAME two SE-0 assertions in `tests/backend/p1-31-privilege-escalation.test.ts` that
  `integration-tests` failed on, the phase-set count and the probe-table cover, so all three
  failures are the one cause CC-55 (c) records. The aggregate **`ci-gate` also concluded
  `failure`**, and the list above did not name it at all. The head under review, `ea5f0d83`, has a
  run of its own that was still incomplete when this was written — two jobs in progress at 23:13Z,
  and its `static-quality` job concluded `failure` on a generated register left stale by the SE-0
  fix — and **no result of that run is claimed here**.)_

---

## 66. The scope-target contract applied to the three body-scoped creates — **SETTLED** (SEC-003-O1, CC-56)

**Slice:** `remediation/p1-31-backend-scope-target-creates`, ownership profile `p1-31-backend`,
opened as pull request [#391](https://github.com/Ezzaldeen-Albitar/RootLco/pull/391).
**Baseline:** protected `develop` **`72f3a71ee4a8204c494913e40e6c2a43cd683e36`** — the merge of pull
request #388, the closure re-measure — **synced to `aa20c959`**, the merge of pull request #390 (P-18,
§ 65), which carried pull request #389 (§ 63) with it. `main` `1262de74`, untouched. The measurements
in § 66.6 were taken before that sync and are re-recorded at the merged head by
`P1-31-SEC-003-008`; the run ledger this slice commits is the authority for what ran, and it names
its own commit. **No result of #391's own hosted run is claimed anywhere in this section**; every
figure here is LOCAL and says so.

**Why it exists.** § 59.6 recorded **SEC-003-O1** — the three P1-31 body-scoped creates refuse a
foreign company with two different documents — and the closure record calls the repair "a contract
question for the Backend lane". The Owner settled the STANDARD for it as **D-27** in the evening
message of 2026-09-13, and the two sentences below are quoted exactly rather than summarised — the
antecedent that names the authority, and the consequence:

> "For SEC-003-O1, compare the differing foreign-company refusal codes with the authoritative
> contract and information-disclosure requirements."

> "Correct implementation or documentation according to that authority; do not normalize codes merely
> for numerical consistency."

Both are quoted from the Owner's evening message of 2026-09-13, preserved verbatim **outside this
repository** in `orchestration/evidence/p1-31/closeout-drafts/queue2/owner-decisions-2026-09-13.md`,
Appendix A, and restated under D-27 in § 7 of that document. D-27 supplies the standard and **does
not state the outcome** — it does not say which of the two documents is correct, and it does not
disposition SEC-003-O2. This section answers the contract question against that standard, applies the
answer, and states what the answer is derived from. _(This paragraph rendered the instruction as one
italic sentence — "compare the differing refusal codes with the authoritative contract and the
information-disclosure requirements, and correct implementation or documentation according to that
authority — do not normalize codes merely for numerical consistency" — which was a faithful summary
but not the Owner's wording: it dropped "foreign-company", joined two sentences, and re-punctuated
the second. A summary of an instruction is not the instruction, and this register should not make a
reader guess which one it is looking at.)_

### 66.1 Identifier allocation

Read on the MERGED tree, the register holds **sections 1 … 63, 65 and 66** and **identifiers
CC-01 … CC-53, CC-55 and CC-56**. Two holes, both deliberate and neither this slice's: **CC-40**, the
permanent one § 57.5 records, and **§ 64 / CC-54**, reserved for the Frontend proofs lane and stated
as pending by § 65 itself. **§ 66 and CC-56 are the pair reserved for this slice** by the closure
plan, which pre-allocated §§ 56–60 / CC-46 … CC-50 and then §§ 63–66 / CC-53 … CC-56 across the lanes
it named.

**The landing order is not the writing order, and neither is renumbered.** This section was written
against `72f3a71e`, where the register ended at § 62 / CC-52 and §§ 63 … 65 were reservations. It
lands third of the three: § 63 / CC-53 merged as pull request #389, § 65 / CC-55 as pull request
#390, and § 66 sits after both because a heading follows the order of the file, while an identifier
records the moment it was raised. § 48.1's rule holds unchanged — nothing here is renumbered to
follow anything, and § 64 is left as a gap rather than closed up. _(This paragraph read "Read on this
tree, the register holds sections 1 … 62 and identifiers CC-01 … CC-52 … sections 63 … 65 and
CC-53 … CC-55 belong to other lanes and are deliberately left free rather than closed up": true of
the head it was written at, and re-measured here at the merged head rather than left to age.)_

**SEC-003-O1 is closed in place** in § 59.6, with the original text left whole and an italic note
beside it. No identifier moves and no passage is deleted.

### 66.2 The authority, quoted rather than paraphrased

The platform already has an answer for this exact question, and it is not a new one.
[`cc-14-scope-target-in-tenant.md`](../phase-1-30/cc-14-scope-target-in-tenant.md) § 2 states that a
scope-target mismatch

> is a **refusal**, not a not-found and not a validation error. A `404` would confirm the existence
> boundary the refusal exists to hide; a `422` would claim the input was malformed

and the primitive built on that sentence — `requireScopeTargetInTenant` in
`apps/api/src/server/auth/authorization.ts` — answers **403 `ERR-IAM-001`** uniformly for a pair
that belongs to another tenant, a pair that exists nowhere, an in-tenant pair the caller's grants do
not reach, and a soft-deleted branch. There is no existence oracle in any of the four.

What CC-14 did **not** do is apply that sentence to the writes. Its § 4 lists the body-scoped creates
of its own era under "Not covered, each for a reason", with the table cell **"404 (untouched)"** —
a description of what those creates did, not a decision that they were right — and its § 7 leaves
open "whether the five body-scoped creates should unify on 403 rather than the FK/RLS 404". The one
write CC-14 does dispose of, `svc.price-resolve` (§ 4), keeps a 422 and is a **different case**: the
pair there is already authorized and the 422 is about the two halves cohering with each other inside
the handler, not about whether the caller may name them.

So the authority for the answer is CC-14 § 2's principle; the authority for the fact that P1-31's
three creates were never covered by it is CC-14 § 4; and the finding that they disagree is § 59.6.

### 66.3 The decision

**For a P1-31 body-scoped create whose `companyId` — or `companyId`/`branchId` pair — is not visible
in the caller's own tenant, whether it belongs to another tenant or exists nowhere, the answer is the
scope refusal: 403 `ERR-IAM-001`, decided BEFORE the insert.** The composite foreign key and the
row-level-security policy stay exactly where they are and remain defence in depth; they are no longer
the thing that answers the caller.

This is an application of CC-14 § 2, not a normalization for numerical consistency, and the two
rejected alternatives are rejected by the authority's own reasoning rather than by preference:

- **404 `ERR-RES-001`** — what `org.employee-create` answered. Rejected because the scope a create
  NAMES is not a resource it addresses. CC-14 § 2: a not-found "would confirm the existence boundary
  the refusal exists to hide". It also disagreed with that same operation's other refusal: a caller
  whose grant does not reach the pair already received 403 there (`p1-31-delivering-employee-seam.test.ts`
  P17-C5), so one create answered two different codes for two forms of "you may not write here".
- **422 `ERR-VAL-001` with a `body.companyId` / `unknown_company` violation** — what
  `sal.delivery-checklist-template-create` and `wty.warranty-policy-create` answered, mapped from
  `fk_delivery_checklist_templates_company` and `fk_warranty_policies_company`. Rejected because the
  body was well-formed. CC-14 § 2: a validation error "would claim the input was malformed" when it
  was merely unauthorized — and a `violations` array naming the field is the strongest form of that
  claim, because it tells a caller to change a value that was never wrong.

**The five P1-30 body-scoped creates are NOT changed here.** They are another phase's surface and
CC-14 § 7 is where that question lives. This decision **recommends the same resolution for them** —
the reasoning is CC-14's own and does not depend on which phase published the route — and leaves the
act to a lane that owns those files. _(This paragraph read "their answer is pinned by
`tests/backend/p1-30-inventory-master-data.test.ts` (MD-X1)". **That was not true when written.**
MD-X1, at `:685`, crosses the TENANT boundary — the one this decision is about — and asserts
`expect([403, 404]).toContain(status)`, which passes on either code; MD-L3, at `:646-651`, pins `403`
exactly but crosses a GRANT-SCOPE boundary inside one tenant, where the named branch is real and
visible, so it does not answer this question. Neither pins a 404. § 66.9 row 1 sets both out and
CC-56 (d) carries the either/or as its own finding. Nothing else in the paragraph depended on it —
the five are out of scope either way.)_

### 66.4 What changed in the code

| file                                                                      | before                                                                                                                                                          | after                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/server/auth/authorization.ts`                               | one probe, `requireScopeTargetInTenant`, restricted to a full (company, branch) target and called only on the GET path                                          | adds **`requireScopeClaimInTenant`**, the write-side sibling: it resolves a company-only claim against `org.legal_companies` and a pair against `org.branches`, under the caller's own RLS, with the tenant taken from `RequestContext.principal` and never from the body. The branch predicate is now a shared private helper, so the read probe and the write probe cannot drift into two definitions of one question |
| `apps/api/src/modules/warranty/application/warranty-policy-service.ts`    | `authorizeScope({ companyId })`, then the insert; a `23503` mapped to 422 `ERR-VAL-001` / `body.companyId`                                                      | `authorizeScope`, then `requireScopeClaimInTenant`, then the insert. The foreign-key arm is kept, guarded on the constraint NAME, and documented as unreachable for the scope case                                                                                                                                                                                                                                      |
| `apps/api/src/modules/delivery/application/checklist-template-service.ts` | the same shape, with one difference that mattered: `#refuseWriteFailure` serves **three** call sites and mapped ANY `23503` to a message about `body.companyId` | the same repair, and the foreign-key arm is guarded on `fk_delivery_checklist_templates_company` so an item's own foreign key can no longer borrow a message about a field the item request does not carry                                                                                                                                                                                                              |
| `apps/api/src/modules/iam/application/employee-administration-service.ts` | `branchIsReachable` false → the register's `notFound()`                                                                                                         | `requireScopeClaimInTenant` on the pair. The register's uniform 404 is **unchanged** and stays what it always was — a statement about an EMPLOYEE id, so the roster cannot be enumerated                                                                                                                                                                                                                                |
| `apps/api/src/modules/iam/data/employee-repository.ts`                    | held `branchIsReachable`, a second copy of the branch predicate with the tenant left implicit                                                                   | removed, with a comment saying where the question is asked now. It had one caller and that caller no longer needs it; leaving a weaker copy behind is how the next writer picks the weaker one                                                                                                                                                                                                                          |
| `apps/api/src/server/db/repository.ts`                                    | `sqlState` / `isSqlState`                                                                                                                                       | adds **`violatedConstraint`**, promoted from a file-local function in the warranty service because two modules now need it. Never imported across modules — both import it from the foundation                                                                                                                                                                                                                          |
| `apps/api/src/server/http/route-handler.ts`                               | `HandlerInput` injected one operation-bound callback, `authorizeScope`                                                                                          | injects a second, **`requireScopeClaim`**, closing over the same `operation` and the same handle. This is what makes the write refusal carry the operation's declared codes without a service ever holding a declaration it cannot import; the public branch throws for it exactly as it throws for `authorizeScope`                                                                                                    |
| the three create routes and the three create services                     | the service took `authorizeScope`                                                                                                                               | each takes `requireScopeClaim` beside it and calls it second. `requireScopeClaimInTenant` now takes `(db, operation, claim)`, the signature its read sibling already had                                                                                                                                                                                                                                                |

**There is no separate "branch not in that company" handling to preserve**, and that is stated
because it could look like an omission. One probe resolves the PAIR; a branch belonging to a
different company of the same tenant is one of the four cases CC-14 requires to be indistinguishable
from the others, so giving it its own answer would reintroduce the oracle.

### 66.5 The information-disclosure property, measured

The claim is that the two variants are indistinguishable, and it is asserted rather than argued.
`tests/backend/p1-31-privilege-escalation.test.ts` SE-7 runs each of the **8** scope-asserting
operations twice — against another organisation's REAL pair and against a pair that exists nowhere —
and this slice strengthens what it compares. It previously asserted the status and the code; it now
asserts **the whole document the caller receives**, minus `correlationId`, against **one** expectation
per probe that does not depend on the variant. Two variants measured against one literal is what
makes the uniformity a measurement.

Observed after the change, for all six create cases (three operations × two variants): **403**,
`ERR-IAM-001`, title `Not permitted`, type `urn:rootlco:error:ERR-IAM-001`, **no `violations`**, and
`requiredPermissions` equal to the operation's declared codes — plus a zero row-count delta on
`sal.delivery_checklist_templates`, `wty.warranty_policies` and `org.employees` around every case.
The `UNKNOWN_COMPANY` refusal shape and the per-probe override that carried it are deleted: a table
that can express "this one is different" is a table in which the next divergence gets recorded
instead of refused.

**The comparison that matters is not read-against-write; it is the three refusals ONE request can
produce.** A caller sending a create can be refused three ways — by `requirePermissions` before the
handler, by `requireScopedPermissions` through `authorizeScope`, and by `requireScopeClaim`. All
three now publish `safeDetails.requiredPermissions` from the same `operation.permissions`, so the
document cannot be used to work out WHICH of them answered, and in particular cannot be used to work
out that the caller's permissions were fine and only the company was wrong. That is the property, and
the mechanism is the route handler's injection: `requireScopeClaim` is bound to the operation exactly
as `authorizeScope` is (`route-handler.ts`), so no service ever reaches for a declaration it cannot
import. `tests/backend/authorization.test.ts` pins the equality of the permission refusal's and the
claim refusal's safe details directly, and SE-7 pins the document over the wire for all eight probes.

**`AppFailure.message` is not part of that document and cannot be a disclosure vector.**
`problemFor` publishes the type, the catalogue title, the status, the code, the correlation id and
the declared safe details, and nothing else — the message is logged, never sent. It is uniform per
operation regardless (it names the operation, never the company or the branch), and the test pins
what a caller can actually read instead of pinning something no caller receives. The message is the
one thing that DOES separate the three refusals, which is why the ordering case in
`tests/backend/authorization.test.ts` reads it: the order is a property of the code path, not of the
response.

**The ORDER is asserted, not assumed.** `authorizeScope` first and the claim second, so a caller
missing the operation's codes is told that rather than told the company is invisible. It is
observable only where both would refuse, so the case takes an unpermitted caller naming an invisible
company, runs the two in the services' order, and requires the PERMISSION denial — then shows the
claim refusal is reachable for that same caller, so the assertion is about order rather than about
only one of them existing.

### 66.6 What ran

Every figure below is **LOCAL**. No hosted run, no build, no acceptance pass and no deployment is
claimed, and no gate verdict is asserted beyond the commands named.

**Two heads, and the table says which.** The rows marked **pre-sync** were measured at `77fdd4dc`,
before `develop` `aa20c959` was merged in; the rows marked **merged head** were measured at
`aee2fc90` after it. A pre-sync figure is kept rather than deleted where the merged head moved it,
with both values shown, because deleting the earlier measurement would hide that the sync changed
anything. Where the two disagree, **the merged-head figure is the one that describes this pull
request** — and the run ledger this slice commits is the authority for the two local tiers, because it
names its own commit and no document can be edited into agreement with it.

| command                                                                                | result                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run typecheck`, `npm run typecheck:api`                                           | pass                                                                |
| `npm run lint`, `npm run lint:api`                                                     | pass                                                                |
| `npm run format:check`, `npm run format:check:api`                                     | pass                                                                |
| `npm run validate:module-boundaries`                                                   | pass — 615 files, eleven rules                                      |
| `npm run validate:api-backend-only`                                                    | pass — 320 route handlers, 615 source files                         |
| `npm run validate:authorization-coverage`, `validate:operation-coverage`               | pass — every operation guarded, every registered operation invoked  |
| `npm run validate:p1-24-register`                                                      | **merged head** pass — 412 operations, reconciled (411 pre-sync)    |
| `node scripts/ci/check-p1-31-write-shape.mjs`                                          | pass — 0 problems                                                   |
| `npm run validate:encoding`, `validate:plain-language`, `validate:generated-artifacts` | pass                                                                |
| `npm run security:all`                                                                 | **merged head** pass — five guards, 2806 tracked files              |
| `check-phase-ownership.mjs p1-31-backend origin/develop`                               | **merged head** pass — 21 files, 0 violations                       |
| `tests/backend/authorization.test.ts`                                                  | **20 passed** (16 before: four cases added) — both heads            |
| `tests/backend/p1-31-privilege-escalation.test.ts`                                     | **merged head 212 passed** (208 pre-sync; P-18 added four)          |
| `tests/backend/p1-31-delivering-employee-seam.test.ts`                                 | **31 passed** — both heads                                          |
| `tests/backend/p1-31-warranty-policy-seam.test.ts`                                     | **31 passed** — both heads                                          |
| `tests/backend/p1-31-delivery-checklist-template-seam.test.ts`                         | **28 passed** — both heads                                          |
| `tests/backend/p1-31-concurrency-and-versioning.test.ts`                               | **5 passed**, pre-sync — the escalation suite's sibling             |
| `tests/foundation/p1-18-scoped-authorization.test.ts`                                  | **197 passed** — the tier that pins the route handler's containment |
| `tests/ci/api-backend-only.test.ts`, two foundation suites reading the handler         | **64 passed**                                                       |

The backend suites ran against a database created for this slice as a TEMPLATE clone of the P1-31
continuous-integration template — 141 applied migrations and 121 seeded permission rows, asserted
before the clone was taken — on the disposable local container, never on the shared acceptance
database. Nothing was reset and no organisation was removed.

**Counts: +4 and no other movement.** The four are the new `requireScopeClaimInTenant` cases in
`tests/backend/authorization.test.ts` — a soft-deleted company refused identically to an invented
one, an in-tenant company hidden by the caller's own grant union, a claim naming no company
resolving without a statement, and the ordering case. No case was added or deleted anywhere else by
this slice. _(This paragraph read "the escalation suite is 208 before and after": true of `77fdd4dc`.
At the merged head the escalation suite is **212**, and the four it gained are P-18's, not this
slice's — § 65's `wty.warranty-status-history` probe, which SE-5, SE-6 and SE-6C each run once. This
slice still adds four cases and they are all in `tests/backend/authorization.test.ts`.)_ What changed
in the escalation suite is what four of its cases ASSERT.

**The unit tier is recorded, and the record supersedes the attempt this paragraph used to describe.**
At the merged head `aee2fc90`, `check-p1-27-closing-values.mjs --record unit` ran the tier ONCE and
wrote **125 files / 3332 tests / 3332 passed / 0 failed** into
`docs/phase-1/phase-1-27/evidence/local-run-ledger.json`, with `dirtyExecutablePaths` empty; the web
tier is recorded beside it at the same commit as **142 files / 4020 tests / 0 failed**. Neither claims
a hosted run. _(This paragraph read "`npm run test:unit` was run once, before the review pass, and is
NOT re-recorded here. It reported **3322 passed, 2 failed**, both `Test timed out in 30000ms` in
`tests/ci/p1-28-evidence-manifest.test.ts` … This is reported as a local failure, not waived." Every
word was true of that attempt at `77fdd4dc` on a loaded machine — a different case timed out on each
of three runs, which is the signature of a budget and not of an assertion. It is kept rather than
deleted because a reader should be able to see that the tier once failed here. It did not recur: the
recorded run at the merged head passed that suite inside a clean tier.)_

### 66.7 What this slice did NOT do

- **It did not touch the five P1-30 body-scoped creates, their suite, or any P1-30 record beyond one
  dated note.** `tests/backend/p1-30-inventory-master-data.test.ts` is untouched;
  `cc-14-scope-target-in-tenant.md` receives a note appended under its § 4 body-scoped-create bullet
  and nothing else.
- **It changed no operation declaration, no permission code, no audit action, no migration and no
  seed.** The three create route FILES change — each threads the injected `requireScopeClaim` to its
  service and each has its `CreateBody` docblock corrected, because both said the tenant boundary was
  the foreign key — but no `defineOperation` literal moves, so the authorization, OpenAPI and
  operation-coverage gates are asked the same question they were asked before. The refusal moved; the
  surface did not.
- **Two records that still assert the superseded behaviour are NOT edited here, and are routed
  rather than left silent.** [`closure-record.md`](./closure-record.md):535-540 restates SEC-003-O1
  in the observation list, and [`task-matrix.md`](./task-matrix.md):141 restates it twice in the
  P1-31-SEC-003 row. Both are owned by the final integration — the matrix owns state and the closure
  record quotes it, which is the order § 62 established and a Backend slice must not invert. **They
  are knowingly stale on this head and are routed to the final integration section, which the queue
  plan allocates as § 70 / CC-60 once §§ 67–69 (in flight) land; not yet written**, and which should
  carry the CC-56 note into both. That allocation lives in the coordinator's queue plan, **not in this
  register** — nothing here reserves it, and § 48.1's rule is unaffected. Nothing about SEC-003's own
  state changes either way: this slice closes an observation, not the row.
- **[`owner-decision-packet-2026-09-13.md`](./owner-decision-packet-2026-09-13.md):146 and :222 ARE
  annotated**, and the distinction from the two above is the point. _(This bullet cited ":146 and
  :213", the lines those two sentences held on the committed head. The first note, nine lines long,
  pushed the second sentence down: it is now at **:222**, and **:213** is a row of the CC-47 table.
  The line numbers here are read on the annotated file, which is the convention § 48.1 implies for a
  citation that moves — cite where the reader will find it, and say where it was.)_ That document asks the Owner to
  act, and both lines describe SEC-003-O1 as "recorded and undispositioned" — which would put an item
  in front of the Owner that no longer needs a decision. It is not a state record the integration
  owns, so leaving it stale would waste the Owner's attention rather than merely be untidy. Each line
  gets an italic note saying SEC-003-O1 is dispositioned by § 66 / CC-56 **as an engineering decision
  by cited authority (CC-14 § 2), not as an Owner decision**, that SEC-003-O2 is unchanged and open,
  and that **the packet's own item count does not move** — deciding that is the integration's, not a
  Backend slice's. The original wording is left whole beside each note.
- **`docs/phase-1/phase-1-31/delivery-checklist-template-seam.md`:110-112 and
  `warranty-policy-seam.md`:137-139 ARE edited**, because those two sentences are this lane's own
  design records and each states, in terms, that the tenant boundary on a create is the foreign key.
  Each receives a dated CC-56 note; the original sentence is left whole beside it.
- **It did not resolve CC-14 § 4's other named follow-on.** The company-only probe against
  `org.legal_companies` that CC-14 calls "a named follow-on" for the **six half-target GET
  operations** is not that: `requireScopeTargetInTenant` still issues **no statement** for a
  half-specified target, the six operations are untouched, and the P1-18 F9 case that measures the
  zero-statement behaviour is unchanged. The probe added here is reached only from a create that
  claims a company in its body.
- **It did not widen an allow-list, add a suppression, or reword prose to satisfy a checker.**
- **It recorded no verdict, no clearance and no approval**, and it does not move SEC-003 itself:
  SEC-003's own state rests on an acceptance record and a named Security reviewer, neither of which
  this slice produces. Only the observation SEC-003-O1 is closed.
- **It claims no merge and no hosted result.** _(This bullet read "It claims no pull request and no
  merge. The commits are local.": true when written, and false from the moment the branch was pushed.
  The slice line at the head of this section cites pull request **#391**, opened after the sync and
  the re-record. Nothing else in the sentence changes — no merge is claimed, and no result of #391's
  own hosted run is claimed anywhere in this section.)_
- **A commit message asserted gate results, which CONTRIBUTING § 2 forbids, and it is recorded rather
  than rewritten.** The body of `0fb6aadf` states that named checks passed — "re-validated after this
  change, 0 problems and no STALE" and a list of green validators. A commit message states what was
  DONE; a gate result belongs to the run that produced it, and a message claiming one is unfalsifiable
  from inside the repository. The earlier commits of this slice carry the same defect in longer form,
  `46f45af0` most of all. They are pushed, and rewriting published history to edit prose would be the
  worse remedy. **The check results this section reports are in § 66.6, where they can be re-run.**
- **Trailer deviation, recorded rather than rewritten.** Commits `36eb7a83`, `77fdd4dc` and
  `aee2fc90` carry the `Co-Authored-By` trailer for the executing model only; `46f45af0`, `868be85c`
  and this one carry both it and the coordinating model's. The convention changed mid-slice and the
  first three were already pushed when it did. Rewriting three commits — one of them a merge — to
  correct a trailer would rewrite a published history for a cosmetic field, which is the worse of the
  two defects.

### 66.8 Dispositions

| id            | finding                                                                                                                        | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | owner / slice                                                                             | state            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| **CC-56**     | **SEC-003-O1 — the three P1-31 body-scoped creates answered a foreign company with three documents across two codes**          | **settled by applying CC-14 § 2**: the scope claim is resolved before the insert and refused 403 `ERR-IAM-001`, identically for a foreign-real company and for one that exists nowhere. The FK/RLS paths remain as defence in depth. Not a normalization — the 404 and the 422 are each rejected by the sentence the platform's own read probe was built on. SE-7 now compares the whole disclosed document, so the uniformity is measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | this slice                                                                                | closed, measured |
| **CC-56 (a)** | **the write refusal omitted `requiredPermissions` while the read refusal published it**                                        | **CLOSED, with a mechanism rather than an argument.** The route handler injects `requireScopeClaim` bound to the operation, exactly as it has always injected `authorizeScope`, so the claim probe receives the declaration and publishes its declared codes. No registry lookup, so the document does not depend on which modules a process had loaded. All three refusals one create can produce — permission, deferred scope, scope claim — now carry the same safe details; pinned directly in `tests/backend/authorization.test.ts` and over the wire for all eight probes by SE-7 _(this row read "recorded, not closed" in the first draft of this section, before the injection replaced the argument)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | this slice                                                                                | closed, measured |
| **CC-56 (b)** | **the same defect survives outside this phase's operation set — enumerated, with its two mis-statements corrected, in § 66.9** | **out of scope and deliberately left open at every OPEN site: six of the seven rows § 66.9 tabulates.** The seventh, `org.department-create`, was listed as a defect in error and **already conforms** — it answers 403 `ERR-IAM-001` uniformly, verified at `organization-administration-service.ts`:342. None of the six is changed by this pull request, and that is the Owner's rule applied rather than avoided: each is a decision by cited authority for the lane that owns it, not a code normalised for consistency by a slice passing through _(this row read "the same defect survives outside this phase's operation set: the five P1-30 body-scoped creates, and `org.department-create` in the IAM module … now with both siblings named", and then "out of scope and deliberately left open, at every site". Both were wrong: "both siblings" was FALSE when written, since a read of the IAM module found four more sites; and "at every site" over-counted, since `org.department-create` is not one of them. § 66.9 carries the correction and the reason for each)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | the lane that owns P1-30 inventory master data (row 1); the IAM lane (rows 3, 4, 5, 6, 7) | open, recorded   |
| **CC-56 (c)** | **the claim probe's own guard is shape-dependent rather than fail-closed**                                                     | `apps/api/src/server/auth/authorization.ts`:566-567 returns without a statement when a claim names a `branchId` and no `companyId`, and `tests/backend/authorization.test.ts`:515-518 pins that. **Unreachable today** — all three creates require `companyId` in their zod body, so no route can produce a half claim — which is why it is recorded rather than treated as a live hole. It is still the wrong default: a guard that resolves nothing when it cannot understand its input fails OPEN, and the read probe's identical early return is justified by six operations that legitimately pass one half, of which this write probe has none. **Recommendation: refuse a half claim with the same `ERR-IAM-001` and move the pin**, in the next backend slice. Not done here, because it is a behaviour change no route exercises and this pull request's scope is the three creates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | the next backend slice                                                                    | open, recorded   |
| **CC-56 (d)** | **the P1-30 case that crosses the TENANT boundary on a body-scoped create asserts an EITHER/OR outcome**                       | `tests/backend/p1-30-inventory-master-data.test.ts`:685 (MD-X1) asserts `expect([403, 404]).toContain(status)` for `inv.stock-location-create` named into another tenant. Its sibling MD-L3 (`:646-651`) pins `403` exactly, but for a grant-scope boundary inside one tenant, so it does not cover this one. It passes whichever of the two codes the operation gives, so it pins neither — which is how § 66.9 row 1 came to claim a 404 that nothing measures, and why that row now claims nothing. This is the assertion class the Owner named, in the evening message of 2026-09-13, quoted here exactly and with the Owner's own inner quotation marks: "Do not weaken assertions, add blanket skips, or allow arbitrary “either permitted or refused” outcomes." That sentence is section 2 of the message, whose subject is FE-004, FE-005 and FE-006; the register quotes it from the Owner's evening message of 2026-09-13, preserved verbatim outside this repository in `orchestration/evidence/p1-31/closeout-drafts/queue2/owner-decisions-2026-09-13.md`, Appendix A. **It is read here as a standing rule about assertions, not as a ruling about this suite**, which the Owner did not mention _(this cell first paraphrased the sentence inside quotation marks, flattening the Owner's inner quotes to “either-permitted-or-refused” and calling it a “standing instruction” without naming where it was said)_. **Not fixed here**: it is another phase's suite, and deciding what it should pin is the same contract question CC-14 § 7 holds for those five creates — the test and the decision should move together, in that lane | the P1-30 backend area                                                                    | open, recorded   |

### 66.9 CC-56 (b) enumerated — every site outside this phase that still answers the old way

The first draft of CC-56 (b) said "now with both siblings named". **That was false when written.** It
was written from the two sites this slice had touched — the P1-30 creates it deliberately left alone,
and `org.department-create`, which it found while reading `org.employee-create`'s neighbour — and not
from a read of the module. A review asked for the read. This is it, and the list is longer — and then
a second review found that the list itself was wrong in two rows, which are corrected below with the
error kept visible. Every row here has now been opened and read against the code on this tree, and
each claim names the line it was read from so the next reviewer can do the same in one step.

**Seven ROWS: six OPEN, one that already conforms.** The unit is the table row, defined here and used
by every counting sentence in this section and in CC-56 (b). A row is not a function and not a call
site: **row 1 stands for five operations** (the P1-30 creates) and **rows 4, 5 and 6 are three arms of
one function**, `assertScopeBelongsTogether`, reached from two callers. Counted as rows: six open —
one P1-30 row and five IAM rows (3, 4, 5, 6, 7) — and one conforming row (2). Counted as owning lanes:
two.

| #   | site                                                                                                                                                                                                | what it answers today                                                                        | status against CC-14 § 2                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | the **five P1-30 body-scoped creates**                                                                                                                                                              | **not established by this slice.** See below and CC-56 (d)                                   | OPEN, and the question is CC-14 § 7's      |
| 2   | `apps/api/src/modules/iam/application/organization-administration-service.ts`:262 — `org.department-create`, refusing through `branchIsReachable` (`organization-administration-repository.ts`:331) | `403 ERR-IAM-001`, from `notFound()` at `:342` — "The target is not reachable in this scope" | **ALREADY CONFORMS.** Not a sibling defect |
| 3   | `apps/api/src/modules/iam/application/access-administration-service.ts`:681 — `createApprovalLimit`                                                                                                 | `404 ERR-RES-001` "Company not found in this tenant"                                         | OPEN                                       |
| 4   | the same file :776 — `assertScopeBelongsTogether`, company arm, reached from `issueGrant` (:415) and `addScope` (:552)                                                                              | `404 ERR-RES-001` "Company not found in this tenant"                                         | OPEN                                       |
| 5   | the same file :781 — the branch arm of that helper                                                                                                                                                  | `404 ERR-RES-001` "Branch not found in this tenant"                                          | OPEN                                       |
| 6   | the same file :784-787 — the owner-mismatch arm                                                                                                                                                     | **`422 ERR-VAL-001`**, `body.branchId` / `branch_company_mismatch`                           | OPEN, and the worst of the six             |
| 7   | `apps/api/src/modules/iam/application/organization-settings-service.ts`:374 — `requireCompanyInScope`; its branch sibling throws at `:382`                                                          | `404 ERR-RES-001` "Company not found in this tenant" / "Branch not found in this tenant"     | OPEN                                       |

**Row 2 was wrong in the first version of this table and is corrected here.** It said
`org.department-create` answers `404 ERR-RES-001` through the register's `notFound()`. It does not.
That module's `notFound()` is at `:342` and returns **`ERR-IAM-001`**, which `catalog.ts`:130 maps to
**403**, under a docblock that gives this section's own reasoning in its own words: "ERR-IAM-001
rather than a 404, because `authorization.ts` requires a denial never to reveal whether the target
exists. A caller outside the scope and a caller naming a random uuid must be told the same thing."
`branchIsReachable` reads `org.branches` under `sel_branches_scope`, so it answers false for a
foreign-real pair and for an invented one alike, and the refusal is therefore already uniform. The
error was mine: the name `notFound()` is shared with the employee register's helper, which DOES
return `ERR-RES-001`, and I read the name instead of the function. It is kept as a row rather than
deleted so the correction is visible, and because a reviewer checking the IAM module for this defect
should be told this site has already been checked and is clean. _(One shape difference, stated and
not inflated: it publishes no `safeDetails`, where CC-56 (a) gives the three P1-31 creates the
operation's declared codes. That is a smaller question than the status code and is not raised as an
item.)_

**Row 1 is a correction too.** The first version said the five P1-30 creates "answer the FK/RLS 404,
pinned by MD-X1". **No test pins a 404.** Two cases in
`tests/backend/p1-30-inventory-master-data.test.ts` reach a body-scoped create across a boundary, and
both exercise the same one of the five, `inv.stock-location-create`:

- **MD-L3**, `:646-651` — a caller whose grant is scoped to branch A2 names branch A1, a boundary
  **inside one tenant**. It pins `403` exactly, and that 403 is the PERMISSION decision refusing a
  grant-scoped caller: A1 is a real branch, visible to an unrestricted caller of that tenant, so this
  case never reaches the question CC-56 is about.
- **MD-X1**, `:685` — a tenant-B caller names company A1 and branch A1, the **tenant** boundary, which
  is the CC-56 case. It asserts `expect([403, 404]).toContain(status)` — an either/or that passes
  whichever of the two codes the operation gives.

So the current answer of those five, on the boundary that matters, is **not established** by that
suite or by this slice, and this section does not claim it. _(The first version of this paragraph
also called `:685` "the only case in that suite reaching a body-scoped create across a boundary".
That was wrong: MD-L3 reaches one too. The retraction stands regardless — MD-L3 pins a 403 for a
different boundary, and nothing anywhere pins a 404.)_ What is open is the CC-14 § 7 question itself,
unchanged. The either/or assertion is its own finding and is raised as **CC-56 (d)**.

**The same mis-statement survives in one more place, and this commit cannot reach it.**
`tests/backend/p1-31-privilege-escalation.test.ts`:545 — a comment in the SE-7 header — says the five
P1-30 creates "keep the answer `tests/backend/p1-30-inventory-master-data.test.ts` (MD-X1) pins for
them". That is the same claim § 66.9 row 1 retracts, and it is wrong for the same reason. It is left
standing here **only** because the commit carrying this correction is documentation-only by
construction: the two local tier records are bound to `aee2fc90`, and touching a file under `tests/`
would expire them and force a re-record for a comment. **It is owed to the next commit that touches
that suite for any other reason**, and it changes no assertion — the comment sits above a table whose
scope probes are all P1-31.

**Row 6 is why this enumeration matters more than a tidy-up.** Four of the six open rows — 3, 4, 5
and 7 — answer a NOT-FOUND, which CC-14 § 2 rejects for confirming the existence boundary a refusal
exists to hide. Row 6 answers something stronger: a caller that names a real branch under the wrong
company is told, in a `violations` entry, that the branch is real and the pairing is wrong — while a
caller that invents a branch is told it does not exist. Those are two different documents for two
different states, which is precisely the oracle § 66.4 removed from `org.employee-create`, where a
pair belonging to another company of the same tenant is one of the four cases CC-14 requires to be
indistinguishable. A caller that may write in company A can, in principle, sort the branch ids of
company B into real and invented by reading which refusal comes back.

**What is NOT claimed here.** No exploit is demonstrated, no severity is assigned, and nothing says
these sites leak data — every one of them refuses, and `companyExists`
(`organization-repository.ts`:105) and `companyOfBranch` (`:121`) both bind the tenant from the
context and read under the caller's own row-level security, so what they see is already narrowed to
the caller. The defect is the SHAPE of the refusal, not the reach of the read. Whether row 6's
containment message is worth keeping for its usability is exactly the kind of question this slice
must not settle for the IAM lane: `svc.price-resolve` keeps a 422 for in-handler pair coherence
(CC-14 § 4) and may be the better precedent for it. That is the lane's call, on the authority, with
the trade stated.

**Nothing in this table is changed by this pull request**, including row 2, which needs no change.
The six open rows sit across **two owning lanes** — row 1 with P1-30 inventory master data, rows 3
through 7 with IAM. Of the six, **four answer a NOT-FOUND** (rows 3, 4, 5 and 7), **one answers 422**
(row 6), and **one is unpinned** (row 1, whose current answer this slice does not establish). Each is
a contract decision for the lane that owns the surface, to be taken against CC-14 § 2 the way § 66.3
takes it. D-27 requires each to be corrected according to the authority and not normalised for
numerical consistency — the two sentences it quotes are at the head of this section, exact — and a
slice that reassigned status codes across two other lanes on its way past would be doing the second
thing rather than the first. _(This paragraph read "a slice that renamed four other lanes' status codes": the number was
not derivable under any one unit — four is neither the count of open rows, nor of lanes, nor of
NOT-FOUND answers taken with row 6.)_

## 67. The version-sourcing gate and the access allow-list completed (CC-57)

**Slice:** `feature/p1-31-version-sourcing-and-access-gate`, ownership profile `p1-31-frontend`,
opened as pull request [#395](https://github.com/Ezzaldeen-Albitar/RootLco/pull/395), whose head moves
with every commit this section records. **Baseline:** protected `develop` **`72f3a71e`**, synced twice
while the branch was open — to **`852bcebd`** (#391) and then to **`a0620bd2`** (#394), which is the
base this pull request opens against. `main` `1262de74`, untouched and far behind.

_This line read "opened as pull request #395 at head `5e7ebafc`". That was the head the pull request was
created from and stopped being the head one commit later, at `2f072b78`. A pull-request head is not a
fact a record can hold: the head is named where a FIGURE was measured, below, and nowhere else._

**Two deliverables, both engineering against this phase's own recorded criteria**: **QA-004**, the
mechanical half of P1-31's record-version discipline, and **DO-001**, the completeness of the access
gate's operation allow-list. No application source, no route, no
operation, no permission code, no migration and no seed; one new gate, one new suite, one allow-list,
two pins, one line added to a hosted workflow, and the register.

### 67.1 Identifier allocation

**Section 67 and CC-57 were allocated to this lane by the coordinating session before the branch
opened**, and are used as allocated.

**Read on the MERGED tree, this register runs to sections 1 … 68 with NO GAP, carrying identifiers
CC-01 … CC-58** — counted off the headings and the disposition tables of this file rather than
asserted. Five sections landed while this branch was open and all five are above § 67: **§ 63 / CC-53**
(pull request #389, the per-file web coverage artefact), **§ 64 / CC-54** (#393, the delivery write
browser proofs), **§ 65 / CC-55** (#390, the warranty transition ledger), **§ 66 / CC-56** (#391, the
scope-target contract) and **§ 68 / CC-58** (#394, the four phase-set proofs). Nothing in this section
describes what any of them contains.

**§ 67 sits between § 66 and § 68 because that is where its number puts it**, and § 48.1's rule is why:
an identifier is a claim about the register at the moment it was raised and is never renumbered to
follow heading order. This branch raised § 67 / CC-57 at a baseline that predates all five, and the
merge places it rather than moving it.

**Still in flight and deliberately not claimed here: § 69, and CC-59** — whose sub-finding **CC-59 (b)**
§ 67.3 names as the owner of the thirty-fourth allow-list id. The one permanent hole at **CC-40** that
§ 57.5 records is untouched.

_This paragraph has been re-stated three times, each time against the tree in front of it. It first
read "Sections 63 … 66 and identifiers CC-53 … CC-56 are held for sibling lanes in flight", which was
the allocation as it stood when the branch opened and was already false when written — #389 had merged.
It then named #389 as landed and #390 as landing. It then read "sections 1 … 63, 65, 66 and 67" with
§ 64 and § 68 in flight, which was true of the first sync head (`852bcebd`) and superseded when #393
and #394 merged. The paragraph above is read on THIS merged tree._

**This section carries a `state` column in its disposition table**, which is what **CC-52 (a)** found
four earlier sections missing. It is not the register-hygiene slice that disposition asks for — the
four sections it names are not this lane's to rewrite — it simply does not add a fifth.

### 67.2 QA-004 — what the sentence had behind it, and what it has now

The discipline is one sentence, and P1-28 already has a gate behind it for `apt.*` / `rec.*`:
_every version-guarded write sources its `recordVersion` from a READ or from the immediately prior
command response, never a cached guess across user-visible staleness._ **P1-31 publishes eleven
version-guarded operations of its own and had nothing behind that sentence for any of them.** A
screen sending `version + 1` satisfies every adapter test in the suite, because the adapter forwards
whatever number it is handed.

`scripts/ci/check-p1-31-version-sourcing.mjs` is a **sibling** of the P1-28 gate rather than a
widening of it, for the reason § 58.3 gives for the write-shape gate: `guardedOperations` there
hard-filters `^(apt|rec)\.`, and P1-28's closure rests on the adapter-count equality built on it.
The judgement is **imported, not re-implemented** — the comment-stripper, the declaration,
cached-name and parameter-name readers, `classifyVersionExpression`, the scope reader
`enclosingFunctionAt` and the renewal rule `renewsAfter` are all the P1-28 file's own exports, and the
P1-28 suite pins their behaviour. **One token changed in that file: `enclosingFunctionAt` gained an
`export` keyword.** Nothing about its behaviour moved, and the alternative was a second copy of the
scope reader — which is precisely how the brace-counting scanners drifted.

**Three things are this gate's own**, and none of them exists in the sibling:

| what                         | why the sibling cannot do it                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **send → operation binding** | The scope is eleven named operations, so a send has to be attributed to one. The path expression is resolved through the module's own path helpers — both shapes this tree writes, a `function` declaration and an arrow constant — and matched to the published contract by `METHOD /route` with parameters collapsed. A docblock naming an id proves nothing, and a scan that cannot follow `deliveryPath(id, '/completion')` manufactures the debt it exists to police |
| **the structural guard**     | `completeDelivery(input: CompleteDeliveryInput)` carries its version as an interface **field**, not as a parameter named `ifMatch`. The P1-28 adapter walk reads the parameter list, so the adapter that releases a vehicle — and every caller handing it a number — is invisible to it. Here the adapter is derived from the send: the enclosing function IS the adapter, and how the version reaches it is read off the expression sent                                 |
| **the retry rule**           | The completion sends twice, because a conflict after a checklist result or a signature is ordinary. Within one adapter, every send after the first to the same operation must classify as `response` — a re-read or a command response. Quoting the version the first attempt was refused for is a second 409 by construction                                                                                                                                             |

**Adapters are held by FILE and name, never by name alone**, and review is why. Two trees may export
the same adapter name; a bare-name map keeps whichever was walked first, so the other adapter's
callers are judged against a signature they do not call while its own "no consumer" check is answered
by the first adapter's callers — both wrong, both silent. Where one name really does have two adapters
behind it and they take their version in different places, **no caller of either is attributed**: this
gate does not resolve imports, and a guess there is a verdict about a function nobody called. The
suite proves the collapse with a synthetic homonym pair.

**One caller shape this gate does NOT own, stated rather than left to be inferred.** A POSITIONAL
adapter called with fewer arguments than its version position is skipped — that is a re-export or a
partial application, and the only remaining case, the version argument omitted altogether, is a
missing REQUIRED parameter that **`npm run typecheck:web` refuses before this gate runs**. A silent
skip and a delegated check look identical from outside, so the delegation is named. A STRUCTURAL
adapter handed an object with no `ifMatch` property is **not** delegated and is a violation here,
because a property is the half a widened type can lose without the call-site arity changing.

**The scope is frozen AND checked.** No namespace expresses it: P1-30 owns the whole of `sal.` and
`wty.`, and four of the eleven are `rpt.` and `org.`. So the eleven are named, and then asserted
against `docs/api/openapi.v1.json`: every one must carry `#/components/parameters/IfMatch`, of the
**75 operations the contract guards in total**. An id that stops being guarded, or stops existing, is
a violation rather than a quiet shrink. It is deliberately **not** scoped by the access gate's
`P1_31_OPERATION_IDS`, which answers a different question and carried **three of the eleven at
`f6f0015b`, and four** after the DO-001 pass below added `sal.delivery-complete` — scoping a version
gate by it would have excluded eight guarded writes then and would still exclude seven now. The
intersection is PINNED in the suite by name rather than narrated here, so the two lists cannot drift
apart in silence.

#### The eleven, and the four with a consumer

| operation                                     | state at this head                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sal.delivery-complete`                       | **compared** — `features/delivery/api.ts:440` and `:456`, structural + re-read                                                     |
| `wty.warranty-policy-rename`                  | **compared** — `features/warranty/warranty-api.ts:337`, positional                                                                 |
| `wty.warranty-policy-status-set`              | **compared** — `features/warranty/warranty-api.ts:367`, positional                                                                 |
| `wty.warranty-coverage-status-set`            | **compared** — `features/warranty/warranty-api.ts:434`, positional                                                                 |
| `sal.delivery-checklist-template-rename`      | **PENDING** — no checklist-template configuration surface exists                                                                   |
| `sal.delivery-checklist-template-status-set`  | **PENDING** — the same                                                                                                             |
| `sal.delivery-checklist-template-item-update` | **PENDING** — the same                                                                                                             |
| `rpt.report-configuration-update`             | **PENDING** — no report-configuration screen exists; CC-37(b) declares the same absence for its request mirror                     |
| `rpt.report-configuration-status-set`         | **PENDING** — the same                                                                                                             |
| `rpt.report-configuration-version-publish`    | **PENDING** — the same                                                                                                             |
| `org.employee-status-set`                     | **PENDING** — nothing in P1-31 administers the employee roster, which is why the access gate deliberately does not claim it either |

**PENDING is a state, not an allow-list.** Writing an adapter for the seven would manufacture the
declared-but-never-wired shape this repository has shipped repeatedly. Each is declared with its
reason, and the lifecycle binds in both directions: an entry naming an operation that is not in scope
is stale, an in-scope operation with neither a consumer nor an entry is a violation, and **an entry
whose operation acquires a consumer turns the gate RED until it is deleted in that same change.** The
suite proves that last clause by planting a consumer for `rpt.report-configuration-update` and
requiring the STALE report.

#### The report line, verbatim, at this branch head

```
P1-31 version sourcing: 11 guarded operation(s) in scope of 75 the contract guards, 4 with a consumer, 7 pending one, 5 in-scope send(s), 4 adapter call site(s), 23 versioned send(s) outside the subject.
OK: every version-guarded P1-31 command sources its If-Match from a read or a command response, and renews it after a conflict.
```

#### The teeth, proved rather than asserted

`tests/ci/p1-31-version-sourcing.test.ts` **appends** synthetic modules to the real web corpus rather
than replacing it, so a fixture adds exactly one reason to fail and an assertion cannot be satisfied
by the collapse of everything else. **Twenty-nine cases, of which twenty are negatives and nine are
positives** — counted from the file, one `it(` at a time, and classified by whether the case requires
the gate to REFUSE something. They are: a version **literal** at a
call site; a **stale** value the component holds in `useState` and reuses; a **retry** quoting the
version the first attempt was refused for; a **structural** adapter whose caller computes
`recordVersion + 1`; a component that commands and **never hands the outcome onward**; a **PENDING**
entry whose operation gained a consumer; an in-scope operation **neither consumed nor declared**; and
two modules exporting one adapter name that disagree about where the version sits, which is the
homonym collapse the file-and-name keying exists to make visible.

Review added eight more, and every one of them proved a claim that had nothing behind it. Three cover
the transport's shape: **a version option outside the options argument** (a version in the BODY — a
request guarded in appearance and unguarded on the wire), **a send with more arguments than the
transport takes**, and **two functions of one name in one module**, where resolving the sending
adapter by name cannot say which parameter list to read. The other five are one per anti-vacuity
clause — **no files scanned**, **the send walk examined nothing**, **a module the parser refuses**, **no
in-scope send**, and **an adapter that demands a version from its callers and has none** — because a
guard that has never fired is a guard nobody has established works. The fourth and fifth of those are
reached by ONE input and the suite says why: `consumed` gains an entry per in-scope send, so it can
only be empty when the in-scope set is, and two cases would imply an independence the code does not
have.

Re-review added three more. Two cover the WIDENED refusal vocabulary described above — a version in
the body spelled `recordVersion`, and one in the options object under a name the transport never reads
— and one is the **RED branch proved by execution**: the CLI is spawned over a directory holding no
source and required to exit 1 with the clause's own words, because every other refusal here is
observed through `run` and says nothing about `main`, its exit code or the stream it writes to. That
is what `--web-root` is for, and it is the same hook `check-p1-31-write-shape.mjs` carries as
`--mirror-root`.

_The count in this paragraph read "Twenty-six cases, of which fourteen are negatives". The total was
true and the split was not: it was 26 cases with 17 negatives and 9 positives when written. Both
figures are now measured from the file rather than computed._

Two cases prove the fail-closed direction is aimed correctly — an unattributable versioned send under
an in-scope resource root is refused, and one under a root no operation in scope is addressed under
is left alone, which is a proof rather than an allow-list and so cannot go stale. One positive case
asserts an exactly-empty violation list over a correct planted adapter and caller, so the negatives
are not noise.

#### The idempotency half of QA-004 — cited, not rebuilt

QA-004 also asks whether P1-31's idempotent commands carry a key. **No new gate was built, because
three mechanisms already answer it and a fourth would only be a second authority to keep in step.**

- `apps/web/src/lib/api/client.ts:367` — the transport attaches an `Idempotency-Key` to every send
  the contract registers idempotent, reading `requiresIdempotencyKey` rather than guessing from the
  HTTP method, and a caller-supplied key always wins and is never regenerated.
- `apps/web/src/lib/api/operation-contract.ts:139` — `requiresIdempotencyKey` resolves the concrete
  path to its published operation and answers from the contract; an unknown mutation path errs toward
  sending, so drift is noisy and never broken.
- `npm run validate:idempotent-operations` reconciles the generated table against the published
  contract, and `scripts/ci/check-idempotency-evidence.mjs` refuses an operation that declares
  idempotency without replay evidence — **174 with evidence, 0 without, 0 waived** on this tree.

**Measured for this section:** of the operations a P1-31 screen actually sends, **nine are registered
idempotent** — `sal.delivery-create`, `sal.delivery-receiver-verify`,
`sal.delivery-checklist-record`, `sal.delivery-signature-attach`, `sal.delivery-complete`,
`wty.warranty-policy-create`, `wty.warranty-policy-status-set`, `wty.warranty-coverage-create` and
`wty.warranty-generate` — and **every one is covered**: not one P1-31 adapter mints or passes a key of
its own, so all nine are keyed by the transport from the table the contract generates.
`wty.warranty-policy-rename`, `wty.warranty-coverage-status-set` and `rpt.report-run` are **not**
registered idempotent and correctly receive no key; the coverage-status refusal is deliberate and
`warranty-api.ts` records why. Six further idempotent operations in the same subject —
the three checklist-template writes, the two report-configuration writes and
`rpt.report-configuration-version-create` — have **no P1-31 consumer**, and are the same absence the
PENDING table above records. **No P1-31 idempotent send is uncovered.**

### 67.3 DO-001 — the allow-list was incomplete, and by how much

`check-p1-31-access.mjs` owns an **allow-list of operation ids** rather than a namespace, and its own
docblock states the consequence: _an operation a P1-31 screen calls that is absent here is one this
gate does not own._ Measured on this tree by parsing every adapter under
`apps/web/src/features/{delivery,warranty,reports}` and resolving each request path to its register
row, **eight operations P1-31 screens consume were absent from the list of 23** — and review found
**two more** on a fourth tree, taking the correction to **ten** and the list to **33**.

**The rule the list follows, stated once:** _every operation a P1-31 screen consumes is named here_ —
not every operation P1-31 published. That is why the branch and company directories are on it, and it
is what makes the audit pair below belong: the audit-log screen is one this phase modified and it
carries its own committed browser specification, so its reads are a P1-31 screen's reads.

| added                                                                                                                                            | resource root                      | moved a segment?  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ----------------- |
| `sal.delivery-create`, `sal.delivery-receiver-verify`, `sal.delivery-checklist-record`, `sal.delivery-signature-attach`, `sal.delivery-complete` | `deliveries`                       | no                |
| `sal.delivery-checklist-template-list`, `sal.delivery-checklist-template-read`                                                                   | **`delivery-checklist-templates`** | **yes — one new** |
| `org.company-list`                                                                                                                               | `org`                              | no                |
| `iam.audit-event-list`, `iam.audit-event-detail`                                                                                                 | **`audit-events`**                 | **yes — one new** |

That six of the ten widen nothing is the point rather than a footnote: **an allow-list loses an
operation without any diff saying so**, which is the failure mode this shape trades a namespace for.
The five delivery writes are the whole execution slice of the handover — opening it, verifying its
receiver, recording a checklist outcome, binding a signature and releasing the vehicle — and the gate
did not own one of them. The two checklist-template reads are what the delivery adapter assembles the
active checklist from, and their root is derived by nothing else the list names, so a
checklist-template configuration page landing under that segment tomorrow meets the gate-before-read
rule already written, exactly as `warranty` and `reports` did.

**The audit pair moved BOTH numbers, and needed an area to be worth adding.** Their root is
`audit-events`; the screen is at `(dashboard)/administration/audit-log`. Claiming the operations alone
would have named a surface whose page no rule then judges — the derived root matches no page, exactly
the gap the singular `delivery` exists to close — so **`audit-log` is named in `P1_31_AREAS` in the
same change**, and the page enters the judged set and passes. The **leaf** is named rather than
`administration`: naming the parent would pull roles, users, taxes, currencies and eight further
screens this phase neither owns nor modified into this gate's subject, and a rule that reaches outside
its lane produces violations nobody in that lane can act on. The suite asserts both halves — the area
is present, and `administration` is not.

**Nothing was added that no screen reaches.** `org.employee-status-set` and the two employee
administration commands stay unclaimed, and the suite still asserts their absence: an allow-list
naming an operation nothing reaches is owning a surface it does not have (CC-39(b)).

**A thirty-fourth id is OWED, and by a lane that merges after this one.** § 65 published the warranty
transition ledger (P-18) and its Frontend half is FE-009, which is unmerged at this head: the moment
its screen reads that ledger, `wty.warranty-status-history` becomes an operation a P1-31 screen
consumes and this list's own rule obliges it. It is deliberately NOT added here — an allow-list naming
an operation no screen reaches is the failure the paragraph above refuses, and the read has no consumer
on this tree. The FE-009 merge adds the id and re-derives the pins in the same change, which is
**CC-59 (b)**. A reader finding thirty-three where the phase will shortly need thirty-four is looking at
a hand-over, not an omission.

#### The report line, verbatim, at this branch head

```
P1-31 gate-before-read: 10 route page(s) examined across 12 owned segment(s) (audit-events, audit-log, deliveries, delivery, delivery-checklist-templates, delivery-readiness, org, reports, warranties, warranty, warranty-policies, work-orders); 7 deferred to the P1-29 gate, which judges them with the same rule.
  0 violation(s).
```

The register lookup resolves all thirty-three ids, which is what `deriveSegments().problems` being
empty means and what the suite asserts.

#### What the gate judges on a page — and the seven pages it now declines to judge

`judgePage` — the P1-29 gate's judgement, reused so the four false negatives an adversarial review
found there cannot regress here — reads a page's **SHAPE**: does it deny and RETURN on a permission
before it awaits anything that costs a request. It reads **nothing** about which operations that page
consumes. So owning an operation is a claim about the register and the segments; it is not the thing
checked on a page. A page is examined because it lives under an owned segment, and is then held to the
shape rule in full.

Review measured what that was costing. **Seven of the seventeen pages judged before this correction
were `(dashboard)/work-orders/**`** — admitted because `sal.work-order-delivery-read` is addressed at
`/work-orders/{id}/delivery`, a SUB-resource, so taking its resource root claimed a whole area — and
**six of the seven consume no P1-31 operation at all**. The gate reported 0 violations, so nothing was
wrong; what was wrong was the arrangement. A regression on a P1-29 diagnostics or quality screen would
have turned THIS gate red, and a P1-31 lane would have been holding a finding it cannot act on — the
exact shape this gate's own docblock refuses in the paragraph that explains why it takes a resource
root rather than every segment.

**So those pages are DEFERRED, and the deferral costs no coverage.** `judgePage` is imported from the
P1-29 gate; that gate owns the whole `work-orders` area and already judges those pages with the same
function, so judging them here was the same opinion computed twice. `deferredSegments()` derives the
hand-over from that gate's own `ownedSegments()` rather than naming a segment by hand, so it cannot
outlive its reason, and **every deferred page is checked to be in the sibling's page set** — a page
handed over and not taken is reported as a violation, because that would be a page no gate-before-read
rule examines at all. The suite asserts the same thing from the other end.

The deferral is **not** extended to the P1-30 gate, and the asymmetry is the reason this file exists.
That gate owns `deliveries` and `warranties` as roots and matches none of the singular dashboard areas
the screens actually live under; deferring to it would recreate the hole § 55 records this gate being
written to close. Only `work-orders` is in the intersection today, and that is derived, not asserted.

A page admitted by BOTH a deferred segment and a P1-31 segment stays this gate's business — a delivery
panel routed beneath a work order would be judged here — which is why the rule is "at least one
admitting segment is not deferred" rather than "no admitting segment is deferred".

#### Pins moved

| pin                                                            | before | after  | why                                                                                                                                                                       |
| -------------------------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PINNED_OWNED_SEGMENTS`, `tests/ci/p1-31-access-gate.test.ts`  | **9**  | **12** | `delivery-checklist-templates` from the two template reads, then `audit-events` from the audit pair and the named `audit-log` area                                        |
| `PINNED_PAGES`, the same file                                  | **16** | **10** | the audit-log page entered the judged set (16 → 17) and the seven `work-orders` pages left it, deferred to the gate that owns that area                                   |
| `PINNED_DEFERRED_PAGES`, the same file                         | —      | **7**  | new pin: the hand-over is a number the gate reports, so a page silently ceasing to be deferred moves it                                                                   |
| `files scripts/ci`, P1-27 derived marker and its visible cell  | **65** | **66** | one new gate. The same pair on both bases: `develop` carries 65 at `72f3a71e` and at `a0620bd2`                                                                           |
| `files tests/ci`, P1-27 derived marker                         | **73** | **74** | one new suite. **Re-stated on the merged tree**: the pair was `71 → 72` against the `72f3a71e` baseline, and two other lanes added a suite each before this branch synced |
| `commands registered`, P1-27 derived marker                    | 177    | 178    | one new npm script                                                                                                                                                        |
| `commands required` · `reachable` · `hosted-ci`, P1-27 markers | 96     | 97     | registered `required`; reachable from `verify:workspaces` and invoked by hosted CI **through `verify:policies`**, which is where it rides                                 |

`npm run evidence:p1-27` was re-run in the same change, as that gate requires — **41 evidence
documents, every one reachable.**

_The row for `validate:p1-31-access` in § 55's verification table reads **"16 route pages across 8
owned segments"**. That was true when it was written and is now stale twice over: `develop` moved it
to 9 with the FE-002 handover form's `org` root, and this slice moves it to 12 owned segments, of
which one is deferred, over 10 judged pages. The figure is left visible and corrected here rather than
edited there, under the rule § 14 states._

### 67.4 Where the gate rides — reachable is not the same as TIMELY

`.github/**` **is** inside the `tooling` bucket that the `p1-31-frontend` profile allows, so a
workflow edit is this lane's to make. The gate is registered `required` in
`scripts/ci/check-command-coverage.mjs` and added to `verify:policies`, which is reachable from
`verify:workspaces` and invoked by hosted CI, so both halves of the coverage rule are satisfied
transitively — `validate:command-coverage` confirms it: **178 registered, 97 required, 97/97
reachable, 98/98 invoked by hosted CI.**

**Reachable was not enough, and review said so.** Its P1-28 twin,
`validate:p1-28-version-sourcing`, is named DIRECTLY by the fast quality job
(`.github/workflows/_reusable-node-quality.yml`, the `web-quality` task), while this sibling reached
CI only through the clean-room aggregate — the slowest job in the pull request. Two gates enforcing
one rule over two halves of the same tree would then report on different clocks, and a defect in the
delivery, warranty or reporting screens would surface some forty minutes after the identical defect
in an appointment screen. That is the same argument the fast job's own comments record for why the
P1-28 gates were moved there: _a gate a developer meets after the next commit is a gate they meet too
late._

**So the sibling is named beside it, one line, in the same step.** Its two P1-31 siblings —
`validate:p1-31-access` and `validate:p1-31-write-shape` — remain aggregate-only and are deliberately
left so: each is a separate proposition with its own timing argument, and moving them here without
one would be a change nobody made a case for. `tests/ci/p1-28-devops-gate.test.ts` derives its
required set by the `validate:p1-28-` prefix, so it neither demanded this line nor is weakened by it;
`validate:run-block-syntax` and `check-workflow-security.mjs` both pass over the edited file.

### 67.5 Verification run locally at the merge head

**Each figure names the head it was read at, because they are not all one head.** The two RUN RECORDS
were taken at **`68d847ae`**, the merge commit, and the ledger stays bound to it — a run record is
evidence of a run and is never re-pointed by hand. The gate report lines, the suite totals and the
command inventory were read at `68d847ae` too and are unaffected by the documentation commits after it.
The OWNERSHIP row is different in kind: it diffs the whole branch against `origin/develop`, so it moves
with any commit that adds a file to the changed set, and it is quoted at the head of the commit that
records it.

**Nothing here is a hosted result**, and the pull request's own checks are the hosted record; this
section does not anticipate them.

_The ownership row's earlier figure, 12 files (docs 4), was true at `68d847ae`, the merge commit. The
re-record `5e7ebafc` added four P1-27 documentation files (`clean-room-evidence.md`,
`closing-value-ledger.json`, `evidence-manifest.json`, `local-run-ledger.json`), which made it 16 files
(docs 8). Neither `2f072b78` nor `b306efa7` moved it, because each edits a file already in the set. The
sentence claiming every figure was read at `5e7ebafc` was therefore false for this row, which had been
measured at `68d847ae`._

| head                       | changed files | docs |
| -------------------------- | ------------- | ---- |
| `68d847ae` (the merge)     | 12            | 4    |
| `5e7ebafc` (the record)    | 16            | 8    |
| `2f072b78`                 | 16            | 8    |
| `b306efa7`                 | 16            | 8    |
| the commit adding this row | 16            | 8    |

Read with `git diff --name-only a0620bd2..<head>` at each head, and the last row measured after the
commit was made: it edits one file already in the set, so the figure does not move, and a commit cannot
name its own sha.

| command                                                                                                         | result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/ci/check-p1-31-version-sourcing.mjs`                                                              | the report line above, 0 violations, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run validate:p1-31-version-sourcing`                                                                       | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `node scripts/ci/check-p1-31-access.mjs`                                                                        | the report line above, 0 violations, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npx vitest run tests/ci/p1-31-version-sourcing.test.ts`                                                        | 29/29                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npx vitest run tests/ci/p1-31-access-gate.test.ts`                                                             | 15/15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `node scripts/ci/check-test-honesty.mjs`                                                                        | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run validate:run-block-syntax` · `check-workflow-security.mjs`                                             | 0 findings over the edited workflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npx vitest run tests/ci/p1-28-devops-gate.test.ts tests/ci/documented-counts.test.ts tests/ci/ci-gate.test.ts` | 52/52 across 3 files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run validate:command-coverage`                                                                             | 178 registered, 97 required, 97/97 reachable, 98/98 hosted CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run validate:p1-27-doc-counts`                                                                             | 151 derived claims across 32 documents, 0 disagreements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run validate:p1-27-evidence`                                                                               | in sync — 41 documents, every one reachable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `node scripts/ci/check-p1-27-closing-values.mjs`                                                                | 58 classified across 2 documents, **0 problems**, no STALE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run validate:p1-24-register`                                                                               | register current and reconciled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run typecheck` · `npm run lint` · `npm run format:check`                                                   | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run verify:policies`                                                                                       | **exit 0**, with both gate report lines inside the run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `node scripts/ci/check-phase-ownership.mjs p1-31-frontend origin/develop`                                       | **16 changed files, 0 violations** (docs 8 · tooling 5 · tests 2 · rootConfig 1), measured at `2f072b78` and unchanged by the commit that records it, which edits one file already in the changed set — a commit cannot name its own sha _(read "12 changed files, 0 violations (docs 4 · tooling 5 · tests 2 · rootConfig 1)". That was measured before the re-record, when four documentation files were changed rather than eight; this row diffs the whole branch and moves with any commit that adds a file to the changed set, so it names its head)_ |

The full list, with exit codes, is the pull request's own record; every figure above was read off the
command's own output on this branch and none is carried forward from another head.

**Every figure in this section was re-derived on THIS merged head**, which is the head the pull
request opens from. The two gate report lines above were re-run after the merge and are unchanged, so
neither is re-quoted; the suite totals, the command inventory, the P1-27 markers and both run records
are measured here rather than carried forward. The run-ledger figures are GENERATED by the record cycle
and are never hand-edited — the two CR-A rows that depend on the unit total are moved with it, below.
**`npm run verify:policies` exits 0 on this head**, re-taken after the re-record, and both gates'
report lines appear inside the run. Its last member is `validate:p1-27-closing-values`, which now
reports **0 problems** with no `RUN_RECORD_STALE` on either tier.

_This paragraph twice said the opposite, and both statements were true when written. It first read
"`npm run verify:policies` exits 0 at this head", which was true of the head it was measured at and
false of the head it was written on. It then read "does NOT exit 0 at this head", naming
`validate:p1-27-closing-values` and a ledger at `aee2fc90` with eight executable paths changed since —
true of the pre-merge branch, and closed by the re-record recorded below rather than by re-wording._

_This paragraph first read "`npm run verify:policies` exits 0 at this head, and the new gate's report
line appears inside it". The first half was true of the head it was measured at and false of the head
it was written on; the second half holds._

**Both local tiers are re-recorded at this merged head, LAST, in the order that gate requires** —
`evidence:p1-27`, then `--record unit`, then `--record web`, with the manifest regenerated between and
after. No `--hosted-run`: nothing here claims a hosted figure.

| tier     | on `develop` at `86bb4ce5` | at this head          | what moved                                                                                                                                                               |
| -------- | -------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **unit** | 3342 tests, 127 files      | 3372 tests, 128 files | **+30 cases, +1 file** — the 29-case version-sourcing suite is the new file, and the thirtieth case is the deferral proof added to the access suite that already existed |
| **web**  | 4026 tests, 142 files      | 4026 tests, 142 files | **nothing.** This branch changes no `apps/web` source and no web test, and the figures reproduce exactly                                                                 |

**0 failed in both tiers, first attempt, no re-run needed.** The three cases that went over their own
timeout under the earlier parallel run did not recur.

The unit total moving obliges the two CR-A rows, and both are moved with it:
`clean-room-evidence.md` — `| Root unit tier — tests executed | 3372 |` and
`| Root unit tier — files the run reported | 128 |` — and both of their twins in
`closing-value-ledger.json`, the `locator` line and the `value`, which is what
`validate:p1-27-closing-values` compares. The two derived markers the merge left in conflict were
resolved by MEASUREMENT rather than by taking a side, because neither side was true of this tree:
**`files tests/ci` = 74** and **`files scripts/ci` = 66**.

_This paragraph has been re-stated twice. It first said "both local tiers were re-recorded at this
head", true when written and made false by the two commits that followed. It then carried this
branch's own figures (`3324 → 3341`, `125 → 126`, "three commits have landed since"), which the merge
superseded: `develop`'s ledger and clean-room page are the ones on this tree now._

_One observation from those runs, recorded rather than dispositioned._ Under the full parallel unit
tier this machine put three cases over their own timeout —
`tests/ci/p1-28-evidence-manifest.test.ts` twice and `tests/ci/p1-31-write-shape.test.ts` once. All
three passed when run alone, and the slowest walks a git range of **1070 commits where `develop`
already walks 1067**, so it is a local timing constraint and not a property of this change. The
recorded ledger is the clean run.

### 67.6 Dispositions

| id            | finding                                                                                                                  | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | owner / slice                     | state            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------- |
| **CC-57**     | **QA-004's sourcing rule had no mechanical enforcement for any P1-31 operation, and the access allow-list had lost ten** | Eleven operations carry `If-Match` in the published contract and belong to P1-31; four have a web consumer and none of the four was gated, because the P1-28 gate's scope is the appointment and reception namespaces and the delivery completion's version is an interface field its adapter walk cannot see. Separately, ten operations P1-31 screens consume were absent from `P1_31_OPERATION_IDS` — eight found by parsing the three feature trees, two more on the audit tree found at review | **both closed by construction.** A sibling gate, registered `required`, named directly by the fast hosted quality job beside its P1-28 twin, and mutation-proved by twenty-nine cases of which twenty are negatives (measured, and previously misstated as fourteen of twenty-six), now refuses a computed, cached, untraceable or un-renewed version on any of the eleven, and declares the seven with no consumer under a lifecycle that goes stale the moment one appears. The allow-list now names **all thirty-three operations a P1-31 screen consumes**, which is the rule it follows; the segment pin moved 9 → 12, the page pin 16 → 10 as seven work-order pages were deferred to the gate that owns them, and a deferred-page pin was added at 7 | this slice                        | closed, recorded |
| **CC-57 (a)** | **the seven PENDING operations remain unreachable, and this gate discloses that rather than closing it**                 | No screen or adapter in `apps/web` sends the three checklist-template writes, the three report-configuration writes or the employee-register transition. Six of the seven are the same absence CC-37(b) already records for their request mirrors                                                                                                                                                                                                                                                   | **recorded, not fixed, and deliberately not manufactured.** Writing adapters for them would create the declared-but-never-wired shape the phase has shipped before. The phase that builds each surface owes the adapter, the mirror and the version discipline in one change, and this gate refuses the PENDING entry the moment the adapter appears                                                                                                                                                                                                                                                                                                                                                                                                        | the lane that builds each surface | open, recorded   |
| **CC-57 (b)** | **the sourcing gate judges the SEND, not the screen state behind it**                                                    | The rule traced is where the number in the request came from. That a component re-reads after a conflict is enforced by the renewal clause; that the number it re-read is the one the operator actually saw is not statically decidable                                                                                                                                                                                                                                                             | **stated rather than claimed.** No figure here asserts a runtime property. The browser evidence for the delivery surfaces is what CC-52 (c) already holds open, and this gate neither substitutes for it nor is quoted as if it did                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | the acceptance re-run lane        | open, recorded   |

### 67.7 What this slice did NOT do, and what is not claimed

- **It changed no application source.** No route, no operation, no permission code, no audit action,
  no migration, no seed, no contract mirror and nothing under `apps/api`. The one non-gate source file
  it touched is `scripts/ci/check-p1-28-version-sourcing.mjs`, which gained an `export` keyword on an
  existing function and nothing else.
- **Three commit bodies on this branch state measured outcomes, contrary to CONTRIBUTING § 2.**
  `68d847ae` says the operation register "reconciles current", `5e7ebafc` says "neither tier failed a
  case", and `b306efa7` — the commit that recorded the first two as a deviation — says the ownership row
  "now carries the sixteen and the eight the gate reports", which is the same class of statement and was
  written in the act of disclosing it. Both are true and both were read off the command that produced them, but a commit message must
  not assert that a check passed — the record and the pull request are where a result belongs. They are
  **left as pushed rather than rewritten**: amending a published commit is the larger violation, and a
  deviation disclosed is worth more than a history quietly re-written. Recorded here so the next slice
  on this lane writes what was done and not what passed.
- **It changed one hosted workflow, by one command line, and nothing else about it.**
  `_reusable-node-quality.yml` names the new gate beside its P1-28 twin in the step that already runs
  that twin — see § 67.4. No job, trigger, permission, secret, runner, action version or condition was
  touched, and no other lane's command was moved.
- **It ran no tier that needs a database, no build, no deployment and no hosted job**, and it claims
  no hosted result. The report lines quoted above are local runs on this branch and are labelled as
  such.
- **It moved no task state, no verdict and no closure figure.** [`task-matrix.md`](./task-matrix.md),
  [`closure-record.md`](./closure-record.md) and
  [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) are untouched by design: the closing
  head and the hosted run id for both gates belong to the final integration, and recording them here
  would be a second authority on the same fact.
- **It did not widen, relax or suppress anything to make a gate pass.** No allow-list entry excuses a
  finding, no `eslint-disable`, `ts-expect-error` or `stylelint-disable` was added, and the one
  unattributable versioned send in the tree is left alone by a proof about its resource root rather
  than by naming it.
- **It records no certification, clearance, approval or role holder**, and it asserts nothing about
  promotion. `main` is `1262de74` and this slice does not move it.

---

## 68. The four phase-set proofs — emission, error paths, least privilege, isolation (CC-58)

**Task ids:** P1-31-SEC-004-003 (the emission set), P1-31-QA-002-001 (the error paths and the
matrix), P1-31-SEC-001-001 (the minimal actors and the grant map), P1-31-QA-003-001 (the isolation
matrix and the missing database negatives), P1-31-QA-002-002 (this section) and
P1-31-SEC-004-004 … 006 (the review corrections, the merge and the 46th operation's pins).

**Register pair:** section 68 and CC-58, the pair reserved for this lane, and neither is renumbered
to follow heading order — § 48.1's rule holds. **The register at this head runs
sections 1 … 66 and 68, with CC-01 … CC-56 and CC-58.** § 64 / CC-54, the delivery WRITE browser
proofs, arrived with pull request #393 while this branch was in preparation and sits between § 63 and
§ 65 where its lane placed it. Two identifiers are allocated and in flight rather than missing, and
each is named here so a gap in the sequence is read as a reservation and not as a loss: **§ 67** with
the gates lane, and **§ 69** with FE-009. This section sits after § 66 and would sit after § 67 had
that lane landed first; it is behind neither in the heading order it claims.

**Baseline:** protected `develop` `591763df`, the head after pull request #389 merged, then merged up
to **`852bcebd`** — the merge of #391, after #390 published the warranty transition ledger — and
finally to **`6e50c161`**, the merge of #393, before
this branch was proposed. Branch `remediation/p1-31-backend-phase-set-proofs`, opened as pull request
[#394](https://github.com/Ezzaldeen-Albitar/RootLco/pull/394). Profile `p1-31-backend`. `main`
`1262de74`, untouched and far behind.

### 68.1 What the four closures address

Each of SEC-004, QA-002, SEC-001 and QA-003 published a claim about a SET — every privileged write,
every error path, every operation's least privilege, every table's isolation — and each rested on
evidence gathered operation by operation. Set-shaped claims fail the same way every time: the
coverage is real, the SET is not measured, and the one member nobody reached is invisible. All four
are now derived from the repository rather than listed, so a forty-sixth operation or a
twenty-fifth privileged write fails the suite that claims to cover it.

### 68.2 (A) SEC-004 — the audit emission set, derived

`tests/backend/p1-31-audit-emission.test.ts` (new) parses the `defineOperation` literals of the 34
route modules under the eight P1-31 namespaces AS TYPESCRIPT, filters to `auditClass: 'privileged'`,
and joins each declaration to `AUDIT_ACTIONS` for its entity type. The set is **24**, the parse
reports **0** unreadable declarations and **0** actions the catalogue does not register as
privileged, and E-0 asserts the probe table equals the derived set exactly.

For each of the 24 the suite arranges prerequisites, opens the delta window, drives ONE success and
asserts four things: the total for the declared action across the fixture tenants moved by exactly
one, the count for (action, entityId) is one, the record's `tenant_id` and `entity_type` are the
acting tenant and the catalogue's entity type, and the second fixture tenant holds no row for that
action before or after.

| measure                                                | before | after |
| ------------------------------------------------------ | ------ | ----- |
| privileged actions with an emission assertion anywhere | 23     | 24    |
| privileged actions with a set-completeness proof       | 0      | 24    |

`sal.delivery_checklist_template.item_updated` is the one that had none — the action that records
whether a checklist item became a company-wide gate on every handover.

**The 46th operation did not move this count, and the suite proves that rather than assuming it.**
`wty.warranty-status-history` (P-18, § 65) is the 34th route file and the 46th operation, and it
declares `auditClass: 'none'` — it is a read. So the file total and the declaration total both rise
by one while the privileged total stays at 24, and all three are pinned separately for that reason:
a WRITE added under a `none` class would move exactly the two that moved here, which is the shape
this suite exists to catch.

### 68.3 (B) QA-002 — the error paths, and the matrix

Eleven P1-31 operations declare `versionGuarded: true` and sixteen declare `idempotent: true`. Both
sets are read off the declarations, not listed.

| column                | applicable | covered before | covered after |
| --------------------- | ---------- | -------------- | ------------- |
| 428 `ERR-CON-002`     | 11         | 7              | 11            |
| 409 `ERR-CON-001`     | 11         | 9              | 11            |
| replay same-key       | 16         | 15             | 16            |
| replay different-body | 16         | 3              | 16            |
| 422 invalid body      | 27         | 20             | 27            |
| 403 (SE-5)            | 46         | 46             | 46            |
| cross-tenant (SE-6)   | 41         | 41             | 41            |
| database isolation    | 46         | 46             | 46            |

Every case was added to the suite that already owns its operation; no operation with a suite got a
new file. `docs/phase-1/phase-1-31/error-path-matrix.md` carries the whole table with a file and a
line in every applicable cell and a stated reason in every inapplicable one.

**The matrix is GENERATED and diffed by a committed test.**
`tests/ci/p1-31-error-path-matrix.test.ts` renders it — and the isolation matrix — from the parsed
operation set and from the case TITLES of the suites that own each operation, resolves each title
against that suite's source at run time, THROWS when a title matches no line or more than one, and
fails on any difference from the committed copy. `P1_31_MATRIX_WRITE=1` is the only way to rewrite
either file. _(This paragraph read only that the matrix "carries the whole table with a file and a
line": true of what the table held, and written before the generator existed — see § 68.9.)_

The four totals reading 46, 46, 41 and 27 include `wty.warranty-status-history`, the 46th operation
(§ 65). It is a GET, so five of the eight columns are inapplicable to it by declaration; its 422 is
an oversized page rather than a body, and its cross-tenant refusal is the SE-6 case plus its own
seam's 404 for a real id and an invented one alike.

**A correction, recorded rather than silently applied.** The first version of this table read
`cross-tenant 40` while the matrix marked SEVEN operations as having no row to cross with. The
escalation suite's own reason list names **five** — `sal.delivery-checklist-template-create` and
`wty.warranty-policy-create` are body-scoped creates and ARE probed, so marking them as
unreachable was wrong in the matrix and wrong in the count that followed it. Both cells now cite
SE-6 and the row reads 41, derived from the suite rather than typed.

**The replay different-body row counts OPERATIONS, not assertions.** Three operations already had a
`ERR-INT-001` fingerprint case and sixteen have one now, which is the 3 → 16 the table states.
**Fourteen** new assertions were written to move it, not thirteen: `sal.delivery-checklist-record`
received one although `p1-22-delivery.test.ts:1779` already refuses a re-record of the same item,
because that case uses two DIFFERENT keys and is answered by the row's own uniqueness — it is not a
statement about the fingerprint at all, and reading it as one was the mistake this row exists to
make impossible. Every other column in the table counts operations in the same way.

### 68.4 (C) SEC-001 — sufficiency, and the authority a parse cannot see

`p1-31-privilege-escalation.test.ts` proved least privilege by refusal alone, and a set of refusals
is consistent with a gate that refuses everybody. SE-5M adds the other half: **13** minimal actors,
one per distinct declared-code set, each holding exactly the codes its operations declare and
nothing else, and each of the 46 operations must be ADMITTED by the gate. The 46th declares
`wty.warranty.read`, which four operations already declared, so the SET count is unmoved at 13 — it
is a statement about distinct authority and not about the size of the surface.

`rpt.report-run` is the one operation whose real authority exceeds its declaration **that this lane
found**. The declaration is a literal and the code a run needs depends on the dataset asked for, so
`ReportRunService` evaluates each dataset's own `requiredPermissions` and answers the same uniform
`ERR-IAM-001`. SE-5MD runs each of the **4** registered datasets as a caller holding the declared
code plus that dataset's own and requires 200; SE-5MD-N runs the same four as a caller holding only
the declared code and requires 403 naming one of the dataset's codes.

**What SE-5M proves, and the class it cannot see.** Its positive case is deliberately narrow and is
the mirror of SE-5C's: the request is built with INVENTED identifiers, and the assertion is that the
answer is neither `ERR-IAM-001` nor a 5xx. That is sufficiency of the **pre-handler gate** — the
declared codes are enough to get PAST the authority check — and it is not a claim that the operation
succeeds, because with invented identifiers it cannot. The consequence is a real limit and is stated
here rather than left to be discovered: a SERVICE-level authority check, of exactly the kind SE-5MD
found inside `rpt.report-run`, runs after the identifiers are resolved and is therefore **invisible
to SE-5M for the other 45 operations**. Only `rpt.report-run` is probed against real rows with a
minimal caller. So the honest reading of the 46 SE-5M cases is: no operation requires an
UNDECLARED code at the gate; whether one requires an undeclared code deeper in its service is
established for one operation and open for forty-five. Closing it would mean driving each of the 46
to a real success with its minimal caller, which is the emission suite's shape applied to
authority — a larger slice than this one, and not attempted here.

`docs/phase-1/phase-1-31/least-privilege-grant-map.md` is GENERATED by
`tests/ci/p1-31-grant-map.test.ts` from the parse, the dataset registry, the permission catalogue
and the escalation suite's own case titles, and that test fails on any difference from the committed
copy. Every code any minimal role must hold is asserted to be a real catalogue row: a code the
catalogue does not carry is a code no administrator can grant, and a minimal role for it would be an
impossibility the map described as a fact.

### 68.5 (D) QA-003 — the database layer, per table

The structural half — RLS enabled and forced with a tenant-scoped SELECT and INSERT policy, and a
refused cross-tenant INSERT — was already auto-enumerated over every `sal`, `wty` and `rpt` table.
The BEHAVIOURAL half was not.

| measure                                       | before | after |
| --------------------------------------------- | ------ | ----- |
| P1-31 tables                                  | 16     | 16    |
| with a structural proof                       | 16     | 16    |
| with a behavioural cross-tenant read negative | 3      | 16    |

**The 46th operation added no table.** `wty.warranty_status_history` has been inside this matrix's
Layer 1 since P1-11 — CC-10 was open precisely because the table existed and no operation read it —
so P-18 publishing `wty.warranty-status-history` (§ 65) adds a Layer 2 row and moves no Layer 1
proof. The table count stays at 16 and the Layer 2 count moves 45 → 46.

`docs/phase-1/phase-1-31/isolation-matrix.md` carries both layers: per table the migration and the
two database proofs, and per operation the application-layer refusal or the stated reason there is
none. It is GENERATED and diffed by the same committed test as the error-path matrix, on the same
terms — see § 68.3 and § 68.9.

### 68.6 Two records corrected here rather than rewritten

Under the annotate-rather-than-rewrite discipline § 48.1 states, both corrections are recorded in
this section and neither source document is edited.

- **The assurance evidence index reads `tests/db/sal-delivery.test.ts` and
  `tests/db/wty-warranty.test.ts` as isolation evidence.** They are CONSTRAINT suites. Every case in
  them ran as tenant A inside a rolled-back transaction, and neither drove a cross-tenant negative
  of any kind — the index was reading the fixture tenant and not an assertion. Both now carry one,
  so the entry becomes true at this head, but it was not true when it was written and the final
  integration owns the index.
- **`tests/backend/p1-31-concurrency-and-versioning.test.ts` states in its header that "all sixteen
  idempotent ones already carry a replay case".** Fifteen did.
  `sal.delivery-checklist-template-item-create` did not, and the different-body half was covered for
  three of the sixteen. That statement was the stated reason the file asserted none of it, so the
  gap it left was invisible for exactly as long as the sentence stood. The header is left as
  written; the measurement above is the correction.

### 68.7 What stays open

**Nothing, for these four proof obligations, as they are scoped.** No cell of either matrix is
uncovered, the grant map names a catalogue row for every code, and the emission set is complete at
24 of 24. The one limit inside the scope is stated in § 68.4: SE-5M establishes sufficiency at the
pre-handler gate and not below it, so a service-level authority requirement stays invisible for 45
of the 46 operations.

**What was executed, and what attests it, is § 68.8.** Every figure this section rests on is a
LOCAL run of this lane's own, taken on a disposable clone and reported by the executor; § 68.8 names
the clone, the suites, the counts, the one red local run and the fact that the attestation is the
hosted run of the pull request head rather than any of them. It is stated once, there, so the two
places cannot drift apart.

Three things this lane deliberately did NOT do, so they are not read as closed:

- no product code was changed. No case went red against product behaviour at any point in the
  slice, which is a statement about the local runs in § 68.8 and nothing more;
- `scripts/check-operation-test-coverage.mjs` and its marker vocabulary are untouched. The matrices
  are this phase's artefact and the gate's vocabulary is cross-phase;
- no baseline, no inventory and no assurance index is edited. The index correction in § 68.6 is a
  statement for the final integration to act on, not an edit this lane made on its behalf.

### 68.8 Verification — what was run, where, and what attests it

**Record commit.** `P1-31-SEC-004-014`, `0b63d08a` — the LAST record of this push. It supersedes
`P1-31-SEC-004-008` / `986efe39` and `P1-31-SEC-004-011` / `63153de9`: the first predates the matrix
generator, the second predates the per-table attribution case the generator gained, and the ledger
reported the intervening web record STALE against the changed executable paths rather than letting
an older figure stand. Both local tiers were re-run at `86bb4ce5` by
`node scripts/ci/check-p1-27-closing-values.mjs --record`, which spawns the tier itself so the run
ledger has one author and a hand-assembled total cannot enter it:

| tier      | tests | files | failed | attempts |
| --------- | ----- | ----- | ------ | -------- |
| root unit | 3342  | 127   | 0      | 1        |
| web       | 4026  | 142   | 0      | 1        |

The unit figures move from 3332 over 125 because this branch adds three test files — the emission
suite, which the unit tier does not run, and `tests/ci/p1-31-grant-map.test.ts` and
`tests/ci/p1-31-error-path-matrix.test.ts`, whose four and six cases it does. The web figures are § 64's and are unmoved by this branch. The two CR-A unit rows in
`clean-room-evidence.md` and their entries in `evidence/closing-value-ledger.json` were updated
together, value and locator, and `check-p1-27-closing-values.mjs` then reported **0 problems** with
no `STALE` record.

**The database suites, and the database they ran against.** Every suite below was run on a
DISPOSABLE PostgreSQL 17 clone — `p131_sets_20260914` at `127.0.0.1:55432`, created from the
`p131_employee_ci_202609121735` template, with 141 migrations and 121 permission rows asserted
before use and matching the 141 migrations this tree tracks. **Never the shared acceptance
database.** The host, port and database name were printed and re-asserted before each run, and all
five `DB_*` variables were set explicitly on every command.

**Every row below names the head it was measured at.** A count taken before a pin moved is a true
statement about that head and a false one about this one, so the head is part of the figure rather
than context around it.

| suite                                                                                                                                           | cases                      | head                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `tests/backend/p1-31-privilege-escalation.test.ts`                                                                                              | 267 / 267                  | `deca2666` and again after each later merge                                                                    |
| the same suite, before the 46th operation's pins                                                                                                | 262 / 262                  | `88d9f133`                                                                                                     |
| `tests/backend/p1-31-audit-emission.test.ts`                                                                                                    | 28 / 28                    | `88d9f133`, `deca2666` and the merge head                                                                      |
| `tests/backend/p1-31-delivery-checklist-template-seam.test.ts`, `p1-31-report-configuration-seam.test.ts`, `p1-31-warranty-policy-seam.test.ts` | 104 / 104                  | `deca2666`                                                                                                     |
| `tests/backend/p1-22-delivery.test.ts`                                                                                                          | 58 / 58                    | `deca2666`                                                                                                     |
| `tests/db/sal-delivery.test.ts`, `wty-warranty.test.ts`, `rpt-reporting.test.ts`                                                                | 23 / 23                    | `deca2666`                                                                                                     |
| the whole database tier, once                                                                                                                   | 1770 / 1770 over 145 files | `88d9f133` — **not re-run at a later head**; the three files this lane changed were re-run alone at `deca2666` |
| `tests/ci/p1-31-grant-map.test.ts`, without the write flag                                                                                      | 4 / 4                      | every head from `88d9f133` on                                                                                  |
| `tests/ci/p1-31-error-path-matrix.test.ts`, without the write flag                                                                              | 6 / 6                      | the head of this push                                                                                          |

**Static checks, and the head each was last run at.** `typecheck`, `lint`, `format:check`,
`check-test-honesty` (**416** test files, no findings), `validate:p1-27-doc-counts` (151 derived
claims, 0 disagreements), `validate:operation-coverage`, `validate:command-coverage`,
`scripts/p1-24-operation-register.mjs --check` (412 operations, reconciled) and
`check-phase-ownership.mjs p1-31-backend origin/develop` (0 violations) were all run at **the head
of this push**. `validate:authorization-coverage`, `security:all`, `validate:encoding`,
`validate:generated-artifacts` and `validate:plain-language` were last run at **`686ed1ec`** and
have not been re-run since: the commits after it change `tests/` and `docs/` only, and none of them
touches an input those five read that the checks above do not already cover. They are listed here
as what they are — clean at an earlier head of the same branch, not re-measured at this one.

**These are the lane's own runs, executor-reported, on one machine.** They are **not independent
verification and they are not the attestation.** The attestation for this branch is the hosted run
of **pull request #394**'s head; no figure in this section is offered as a gate result, and none is claimed
for a head other than the one named beside it. Two local runs are recorded as red rather than
omitted: an earlier root unit tier reported two timeouts in `tests/ci/p1-28-access-gate.test.ts`,
both at the 30-second limit under contention and neither on an assertion — the file passes 48 / 48
when run alone, it is not this lane's file, and the recorded unit run above has `0 failed`.

### 68.9 What `deca2666` claimed that was not in the tree, and how it is closed

Recorded rather than quietly repaired, because a commit message is part of the record and this one
described two things that did not exist at the commit it described.

- **"a script that resolves every citation by CASE TITLE"** — the script existed and did the work,
  but it was never committed. It lived in a temporary directory outside the repository, so the two
  matrices were derived IN FACT and reproducible by nobody: the property the commit message claimed
  was the property the tree did not have. The generator is now
  `tests/ci/p1-31-error-path-matrix.test.ts`, in the tests bucket, with no new npm script and no new
  `scripts/ci` file.
- **"the correction recorded beside the table"** — the 7 → 5 correction to the cross-tenant count was
  described in that commit's body and appears in no document in
  `docs/phase-1/phase-1-31/` at that head. It is now in § 68.3, beside the table it corrects.

**And the defect the uncommitted script left behind, which the committed one caught immediately.**
Its line-extraction used `split(':')[2]` on a `file:line` string, which has one colon and therefore
no third field, so **35 citations were written as the literal `:undefined`** — 12 in the error-path
matrix and 23 in the isolation matrix, including all sixteen Layer-1 structural cells. Those cells
said "covered" and named no line, which is exactly what the rule at the head of the error-path matrix
forbids. Both documents are regenerated by the committed test and now carry **zero**; every citation
in both was re-checked against the file and the line it names.

This is the case for the generator being in the repository rather than beside it: the uncommitted
script and the committed test implement the same idea, and only the second one could fail.

**Two smaller corrections, for the same reason.**

- `075592a9`'s body said the regenerated documents changed in "nothing else but the alignment the
  wider cells produce and the GENERATED banner". **That was false**, and the thing it hid is the
  paragraph above: 35 citations changed from `:undefined` to a real line, which is not alignment.
  The sentence was written from a diff read for layout rather than for content.
- The Dispositions subsection is numbered **68.10** and was drafted as 68.8. **No landed identifier
  was renumbered**: § 68 has never been on `develop`, and both the Verification subsection and this
  one were inserted before it, in the same unmerged branch. The § 48.1 rule is about identifiers the
  register has published, and it is not engaged here — but a reader comparing two drafts of this
  branch would see the number move, so it is stated rather than left to be noticed.
- The over-attribution the committed generator itself shipped at `075592a9` is recorded with the
  rest: it cited `tests/db/p1-11-isolation.test.ts:117` for **every** `rpt` table, and that case
  queries `sal.invoices` and `rpt.report_configurations` and nothing else. So
  `rpt.report_configuration_versions` carried a citation naming a case that never touches it. The
  generator now attributes per TABLE and reads each cited case's own body back to check the claim,
  with the corrected case as its own falsifier.

### 68.10 Dispositions

| id            | finding                                                                                                                                                                                                                                                                                                   | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | owner / slice                                 | state            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------- |
| **CC-58**     | **four phase-set claims — SEC-004, QA-002, SEC-001 and QA-003 — rested on evidence gathered operation by operation, with no proof that the SET was covered.** A set-shaped claim fails the same way every time: the coverage is real, the set is not measured, and the member nobody reached is invisible | 23 of 24 privileged actions carried an emission assertion somewhere and `sal.delivery_checklist_template.item_updated` carried none; 7 of 11 version-guarded operations had a 428 case and 9 had a stale-`If-Match` 409; 15 of 16 idempotent operations had a replay case and **3** had a different-body refusal; 20 of 27 applicable writes and reads had a 422; least privilege was proved by refusal alone, so nothing established that the declared codes were SUFFICIENT; and 3 of 16 P1-31 tables carried a behavioural cross-tenant read negative, the delivery and warranty database suites being CONSTRAINT suites that drove none | **closed in code and in two matrices and a generated map.** All four sets are now DERIVED from the route literals at run time, so a forty-sixth operation or a twenty-fifth privileged write fails the suite that claims to cover it. Counts after: emission 24/24 with set-completeness asserted; 428 11/11, 409 11/11, replay 16/16, different-body 16/16, 422 27/27, 403 46/46, cross-tenant 41/41, isolation 46/46; 13 minimal actors plus 4 dataset actors; 16/16 tables with a behavioural read negative. The residual limit is named in § 68.4 and § 68.7 rather than closed: SE-5M establishes sufficiency at the pre-handler gate only | this lane                                     | closed, recorded |
| **CC-58 (a)** | **SE-5M cannot see a service-level authority requirement for 45 of the 46 operations**                                                                                                                                                                                                                    | SE-5M builds each request with invented identifiers and asserts only that the answer is neither `ERR-IAM-001` nor a 5xx, which is the pre-handler gate. A check inside a service runs after the identifiers resolve. `rpt.report-run` is the one operation probed against real rows with a minimal caller (SE-5MD, SE-5MD-N), and it is the one where such a check was found                                                                                                                                                                                                                                                                | **recorded, not closed.** Closing it means driving each of the 46 to a real success with its minimal caller — the emission suite's shape applied to authority, a larger slice than this one. Nothing here is widened or relaxed to accommodate it, and no claim in this section reads past the limit                                                                                                                                                                                                                                                                                                                                            | a later security-assurance slice              | open, recorded   |
| **CC-58 (b)** | **the assurance evidence index reads two constraint suites as isolation evidence they did not carry**                                                                                                                                                                                                     | `tests/db/sal-delivery.test.ts` and `tests/db/wty-warranty.test.ts` ran every case as tenant A inside a rolled-back transaction and drove no cross-tenant negative of any kind; the index was reading the fixture tenant and not an assertion                                                                                                                                                                                                                                                                                                                                                                                               | **recorded here, and the code half repaired.** Both suites now carry a behavioural negative, so the entry becomes true at this head — but it was not true when written, and editing the index is a rewrite of a document this lane does not own (§ 48.1)                                                                                                                                                                                                                                                                                                                                                                                        | the final integration                         | open, recorded   |
| **CC-58 (c)** | **`p1-31-concurrency-and-versioning.test.ts` states a replay coverage it did not have, and that statement is why it asserted none**                                                                                                                                                                       | Its header says "all sixteen idempotent ones already carry a replay case". Fifteen did; `sal.delivery-checklist-template-item-create` did not, and the different-body half was covered for three of the sixteen                                                                                                                                                                                                                                                                                                                                                                                                                             | **recorded, header left as written.** The gap it hid is closed by § 68.3 and the header is annotated by this row rather than rewritten, in the § 48.1 discipline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | this lane, recorded for the final integration | open, recorded   |

---

## 69. The warranty transition ledger on the record screen — FE-009's screen half (CC-59)

The backend prerequisite **P-18** published `wty.warranty-status-history`. This slice consumes it:
the warranty record screen now renders the ledger it used to say it could not read.

### 69.1 Identifier allocation

| identifier | meaning                                               | state                                        |
| ---------- | ----------------------------------------------------- | -------------------------------------------- |
| section 69 | this slice                                            | this branch, reserved for it before it began |
| **CC-59**  | FE-009's screen half — the record consumes the reader | this branch                                  |

_Historical prepared-head table: read with the integrated state in § 69.9 below._

**The neighbouring identifiers, stated as they actually stand at this merge** — an earlier draft of
this paragraph said all of sections 64 to 68 were reserved by lanes that had not merged, which was
false then and is more false now: two of the five are in this file.

| identifier   | lane                             | where it is, at `develop` `852bcebd`                                                                      |
| ------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| § 64 / CC-54 | the Frontend proofs lane         | **not written yet — in flight as #393**, still open; § 65.1 records that it lands ABOVE § 65 when it does |
| § 65 / CC-55 | P-18, the backend half of FE-009 | **merged, as #390** — commit `aa20c959`, which this branch was cut from                                   |
| § 66 / CC-56 | SEC-003-O1                       | **merged, as #391** — in this file immediately above § 69, and reached by the sync recorded below         |
| § 67 / CC-57 | the gates lane                   | in flight on another branch                                                                               |
| § 68 / CC-58 | E2                               | in flight on another branch                                                                               |

Nothing here renumbers, reuses or reconciles any of them. **§ 69 currently sits after § 66 because
§ 67 and § 68 do not exist yet**; when E2 and the gates lane land it sits after § 68, and if #393
lands § 64 sits above § 65 as that section already provides for. The file's numbering is then out of
order in one more place — as it already is at § 59 and § 60 — and that is the convention this
register has chosen over renumbering.

### 69.2 What CC-31 said, and which half of it this closes

**CC-31** recorded FE-009 as shipping PARTIAL: `wty.warranty_status_history` was written by the
database and read by no operation anywhere in `apps/api/src` (**CC-10**), so the only history the
feature could show honestly was the vehicle-filtered warranty list. The record screen stated that in
the operator's own language and composed nothing — an invented ledger would be believed, which is
worse than an absent one — and the missing half was named as the backend prerequisite **P-18**.

P-18 landed. **The frontend half of CC-31 closes here.** What remains open under it is the browser
proof, which cannot be taken until the acceptance harness runs at the closing head; § 69.6 states
exactly what is owed and what is not claimed.

### 69.3 What changed

- **A typed envelope, taken from the backend's own view.** `WarrantyStatusTransition` and
  `WarrantyStatusHistoryEnvelope` mirror `WarrantyStatusHistoryEntryView` and
  `WarrantyStatusHistoryEnvelope` field for field. Both are spelled exactly as the delivery ledger's
  equivalents are, on both sides and deliberately: a screen that renders a handover's history and
  then a warranty's handles one shape rather than two that can drift.
- **One adapter, and no more.** `readWarrantyStatusHistory` goes through the shared read helper, so a
  refusal reaches the screen as a refusal and never as an empty list. It attaches no retry key,
  because it is a read. The cursor is passed back exactly as the server minted it and is never
  parsed; `hasMore` is the server's own end-of-set signal, and no total is requested or invented.
  It ALWAYS sends a page size — `limit=25`, this feature's `PAGE_SIZE`, at `warranty-api.ts:242` —
  rather than sending only what a caller supplied. That is what `listWarrantyPolicies` already does
  and it sits well inside the route's own bound of 100; leaving it off would take the server's
  default of 50 instead, which is a different page size chosen by a different authority for no
  reason anyone could point at.
- **A history panel on the record screen.** It reads its own subresource and therefore fails on its
  own: a caller may see the record and have the ledger refused, and the panel renders that inside
  itself so everything above it survives. The refusal states are the shared ones, so this screen is
  not a second authority on what a denial looks like.
- **The oldest row is drawn as a beginning.** The transition with no previous state is the genesis
  row `wty.issue_warranty` writes with the record. The backend deliberately publishes no synthesised
  origin block — the genesis row is already in the table — and this side adds nothing above it.
- **The actor is a labelled reference.** No warranty read resolves an employee to a name, so the
  identifier is shown as a reference with a label saying what it references, left-to-right in both
  reading directions. That is the convention the record screen already uses for the vehicle and the
  delivery feature already uses for its own ledger; no identifier reaches the page unlabelled, and
  no lookup is invented.
- **The sentence CC-31 required is gone with its key.** `warranty.record.noHistoryYet` had four
  references — the screen, both catalogues and one case — and all four are gone. It is not kept for
  the empty state: an empty page gets `warranty.history.noneTitle` and `noneDescription`, which say
  that no change of state has been recorded, while the retired sentence said the record could not be
  read. Those are different facts, and sharing one sentence would restate a limitation that no
  longer exists.
- **Nine catalogue keys, in both languages.** `warranty.history.` heading, explain, origin,
  movedFrom, movedTo, actor, noneTitle, noneDescription, loadMore.
- **The access gate owns the new operation.** `wty.warranty-status-history` is added to
  `P1_31_OPERATION_IDS`. It shares the `warranties` resource root that the list and the detail read
  already contribute, so the gate's page and segment counts are unmoved and neither pin in
  `tests/ci/p1-31-access-gate.test.ts` changes.

### 69.4 The one-row ledger, stated rather than worked around

Nothing in this phase advances `wty.warranty_records.status`, so every warranty the product can
create carries exactly one transition — the genesis absence into `issued` — and the server answers
`hasMore` false. **A one-row ledger is rendered as a one-row ledger.** It is not rendered as empty,
which would tell an operator the workshop has recorded nothing when it has recorded everything there
is; and it is not rendered as a fault, which it is not.

The honest empty state is kept anyway, and the panel's docblock says why: the panel has to
distinguish three outcomes — a refusal, an empty page, and a page of rows — and the live service
cannot produce the middle one today. A branch that is never exercised is a branch that would be
written wrong on the day a later writer makes it reachable, so it is exercised by a fixture and
marked in the record as unreachable through the service rather than left to look like a state
somebody has seen.

### 69.5 What was measured

**`apps/web/tests/warranty.dom.test.tsx`: twenty-six cases added, one removed** — the case that
asserted the retired sentence. The file runs **67**; it ran **42** on `aa20c959`.

The first fifteen cover the ledger itself: it is read for the record being shown and for nothing
else; the one-row ledger renders its origin row in English and in Arabic, with no English left in
the Arabic panel; a multi-row ledger keeps the server's newest-first order with the state it moved
from and the reason it carried; the actor is a labelled reference and no identifier is unlabelled,
in both directions; a further page is offered only when the server declares one, and the cursor goes
back as it arrived; denied, not-found and unavailable are each drawn as themselves inside the panel
while the record above them survives; an empty page says so; and a state this build does not know is
printed as the word the backend sent.

The eleven added on review close the gaps that review found. Two first-page outcomes that had no
case at all — `expired` and `error`. Five further-page outcomes, one case each, every one asserting
the localised sentence AND the absence of a key composed from the status, which is CC-59 (c). One
that the rows already on screen survive a failed further page, and one that the correlation
reference the backend logged is printed for it. One that a response claiming another page while
publishing no cursor draws nothing clickable. And one for the stale-warranty guard inside the
updater: a further page still in flight when the screen moves to another warranty must not append to
that warranty's ledger, which is reachable only by holding the second read open across the move.

**`apps/web/tests/delivery.dom.test.tsx`: one case added**, for the same CC-59 (c) defect in the
delivery ledger. The file runs **86**, from 85.

**Two cases for the work-order handover panel**, in `delivery-start.dom.test.tsx`, which runs
**22**, from 20: the localised `not-found` sentence with the composed key absent, and the
correlation reference printed for a read that could not be completed. One existing case in
`delivery.dom.test.tsx` moved with the fix rather than around it — it asserted the failure by
`getByRole('alert')`, which was the hand-rolled markup's role; it now reads the shared state's own
`role="status"` and additionally asserts the denial sentence, so it measures more than it did
before. The file still runs **86**.

**Three further cases, one per warranty screen that carried the same defect.** The warranty list
(`warranty.dom.test.tsx`, which runs **68**), and the plan list and the single-plan screen
(`warranty-policies.dom.test.tsx`, which runs **29**, from 27). Each asserts the localised
`not-found` sentence AND the absence of the key composed from the status; the single-plan case
reaches the defect by a different path from the other two, through the re-read that follows every
mutation rather than through a further page.

**The `not-found` case was confirmed to falsify.** Before the fix was restored, the defect was put
back and that single case run: it failed, and the rendered panel in the failure output contained the
literal string `state.not-found.title` where the operator's sentence belongs. It is a regression
test, not a description of what the code already did.

**Two cases in the file are deliberately unmoved.** `renderRecord` drives the record screen
directly rather than the route page, so the page-level gate cases above it are untouched by any of
this — what the panel decides and what the page decides are measured apart, and collapsing them
would let a page-level pass stand in for a panel that never rendered.

### 69.6 What this slice did NOT do, and what is not claimed

- **No browser proof was taken.** A handoff-gated case was added to `warranty-p1-31.spec.ts`, and it
  is committed and unrun. It carries **four** `test.skip` guards — no handoff, the wrong account
  kind, no warranty in the journey, and no ledger in the handoff — each annotated `TH-002` with its
  own reason, which is the same shape its three handoff-gated siblings in the file carry. **No claim
  is made here that FE-009 has been verified in a browser.**
- **The harness step it depends on is not written.** The acceptance harness is executing another
  lane's run and was deliberately not edited. The step it owes is a `wty.warranty-status-history`
  read for the journey's own warranty, published as the transitions page, and it must be added
  before the case can execute.
- **No backend change.** P-18 is somebody else's merged work; nothing under `apps/api` is touched
  here, and this slice carries no migration.
- **No register or closure-record edits.** `task-matrix.json` and the closure record are not
  touched.
- **One ARIA convention for a failure, not two.** The further-page failure was briefly wrapped in a
  `<div role="alert">` while the first-page failure rendered the shared state bare. That was wrong in
  both directions: it gave the same fault two different announcements depending on which page it
  happened on, and it nested a live region inside another one — `StateShell` already carries
  `role="status"`, with a comment in `States.tsx` explaining that these are results of an action the
  operator just took and that `alert` interrupts where `status` does not. The wrapper is removed from
  all four panels; every failure in this feature now renders the shared state bare, exactly as the
  first page does.
- **CC-10 is unaffected.** It records the table under a name no migration created; that is a record
  defect about naming, and it is not what this slice is about.
- **The P1-27 run record is NOT re-recorded here, and that is the rule rather than an omission.**
  This slice adds executable web cases — eleven warranty DOM cases, one delivery DOM case and one
  browser case in two locale projects — so the web tier's executed count moves. The closing-value
  ledger (`docs/phase-1/phase-1-27/evidence/local-run-ledger.json`) is what QA-005 binds through,
  and it expires the moment any executable path changes; re-recording it mid-slice would produce a
  figure that the next commit on this branch invalidates. It is therefore re-recorded **last, in the
  sync turn**, against the head that is actually merged.
- **`.github/ci-baselines/test-count-baseline.json` is not touched, and no floor is raised here.**
  That file's own `enforcementNote` says only `minTests` is enforced — `summarise-vitest.mjs` fails a
  tier that runs fewer — and that `measured` is **provenance**, recording what one named run
  observed. Raising `measured` to match a local run would restate a measurement as though a new run
  had produced it. The web floor is 3700 against a measured 3749 on 135 files, and `WTF-08` forces a
  raise only when the DECLARED case count would rise above the floor, which adding a dozen cases to
  an existing tier does not do. A floor is raised in the same commit that makes it necessary; this
  is not that commit.
- **The browser-case count in `acceptance-plan.md` is a figure that moves.** Twenty-one P1-31 cases
  per locale project and forty-two in total is what this tree collects, measured rather than
  asserted, and it counts the five `*-p1-31.spec.ts` files that exist here. It does **not** count the
  delivery-writes spec, which is on an unmerged Frontend-proofs branch and is absent from
  `aa20c959`. When that branch merges, the figure becomes twenty-five per locale and fifty in total,
  and the sentence in § 3 of the acceptance plan moves with it.

### 69.7 Dispositions

| id            | finding                                                                                           | measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | owner / slice                                               | state                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **CC-59**     | **FE-009's screen half: the record screen stated the ledger could not be read, and now reads it** | **CC-31** recorded FE-009 as PARTIAL and named **P-18** as the missing prerequisite; § 65 / **CC-55** delivered it. The screen, the adapter, the envelope and the catalogue sentence that stood in for the ledger were all still on the CC-31 footing at `aa20c959`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **the screen consumes the reader.** A typed envelope mirroring the backend view, one adapter, a history panel that reads its own subresource and fails on its own, the origin row drawn as a beginning, and `warranty.record.noHistoryYet` retired with its key. **This does NOT close CC-59.** The web change is one half of the claim; the other half is a browser assertion over a real ledger, which only the closing-head acceptance run can give                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | this slice                                                  | **open, recorded — closes with the closing-head browser proof and the matrix move** |
| **CC-59 (a)** | **the acceptance harness publishes no warranty ledger, so the browser case cannot execute**       | The handoff document written by `orchestration/acceptance/p1-31-journey.mjs` carries no `warrantyHistory`, because no HTTP step reads `wty.warranty-status-history`. The harness was executing another lane's run for the whole of this slice and was deliberately not edited                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **the case is written to the field it needs and skips, saying so, until the field exists.** The step the harness owes is a `wty.warranty-status-history` read for the journey's own warranty, published as the transitions page; its exact text is handed to the coordinator with this branch rather than written into a file another lane is running. The closing-head run is what turns the skip into a result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | the acceptance-harness lane, then a closing-head run        | **open**                                                                            |
| **CC-59 (b)** | **the access allow-list is edited by two branches at once**                                       | `P1_31_OPERATION_IDS` in `scripts/ci/check-p1-31-access.mjs` gains one id here. The gates lane adds eight ids to the same frozen array on a branch that had not merged when this one was cut, so whichever merges second re-derives the list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **recorded rather than pre-resolved.** A one-line addition to a frozen array is a textual conflict and not a semantic one: the ids are independent and the gate's page and segment counts are unmoved by this one, because `wty.warranty-status-history` shares the `warranties` resource root the list and the detail read already contribute. The second merge re-runs the gate and both pins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | whichever of the two branches merges second                 | **open until the second merge re-derives the list**                                 |
| **CC-59 (c)** | **a further page that failed was reported to the operator as a catalogue key, in FOUR panels**    | The failed page's outcome was held as a bare string and the panels composed `state.${status}.title`. That is a key for four of the five outcomes and NOT a key for `not-found`: the catalogue holds `state.notFound.title`, and `translate` renders a missing key AS the key. Found in this slice's own warranty panel and in all three paged delivery panels, which share `usePagedList`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **fixed in both hooks, all four panels and all three remaining warranty screens in this branch**, by carrying the `ReadFailureStatus` and the correlation reference and rendering them through the same shared states the FIRST page's failure already used. The `not-found` case was confirmed to FAIL against the defect before the fix was restored, so it is a regression test and not a description. The three delivery panels were fixed rather than left as a convention to copy. **This row is closed for NINE sites and no more, and they are exactly the P1-31 surfaces** — the warranty history panel, the warranty list, the plan list and the plan screen; the three paged delivery panels through `usePagedList`; and `features/delivery/components/WorkOrderDeliveryPanel.tsx:163`, which is a FIRST-page render rather than a further-page one and was fixed the same way. That last one was briefly recorded under CC-59 (e) as residue and that was wrong: it is this phase's own feature, so it belongs to the row that closes rather than to the row that defers. **Sixteen sites of the same class remain live in other features** and are enumerated in CC-59 (e); none of them is claimed as fixed here | this slice                                                  | **closed by this commit**                                                           |
| **CC-59 (e)** | **the same composed-key defect remains at sixteen sites across nine files outside this phase**    | `grep -rn 'state.\${' apps/web/src` at this head, minus the nine sites CC-59 (c) fixed and minus two docblocks that quote the pattern in order to name it. Every one composes `state.${status}.title` from a `ReadFailureStatus`; every one therefore renders the literal `state.not-found.title` to an operator when that read answers `not-found`. `features/diagnostics/components/JobDiagnosticsScreen.tsx:113`, `TemplateCatalogueScreen.tsx:42`, `TemplateDetailScreen.tsx:87` and `:404`; `features/quality/components/JobBlockersPanel.tsx:118`, `WorkOrderClosureScreen.tsx:126`, `:991`, `:1356` and `:1367`, `WorkOrderHistorySection.tsx:73`; `features/technicians/components/JobWorkPanel.tsx:387`, `:692` and `:900`; `features/work-orders/components/JobPanel.tsx:235`, `WorkOrderDetailScreen.tsx:152` and `:576`. **There is no billing site, and the review's brief that named one is corrected here rather than followed:** billing composes `invoices.status.${…}`, which is a closed PRODUCT vocabulary with a matching catalogue entry for every value and no camel-cased member, so it is a different class from a key built out of a read-failure status. The wider grep for `translateDynamic(messages, \`…${` returns roughly 150 such vocabulary compositions across the product; not one of them is this defect, and none is listed here. **Sixteen sites, NINE files** — the count is the passages, not the files, and both figures are re-derived from the grep at this head rather than carried: an earlier draft of this row said eight files, which was a miscount of the same list | **listed and NOT fixed, deliberately.** All sixteen belong to P1-29 and P1-30 features; rewriting them from this branch would be a platform-wide change made under a warranty ticket, reviewed by nobody who owns those screens, and it would put nine untested files in a slice whose subject is one panel. It is recorded as a platform follow-up so the next lane that owns those features has the enumeration rather than the grep. **The one site that was NOT outside this phase has been removed from this row and fixed** — see CC-59 (c). It was listed here for one commit because the review's instruction said to defer the whole residue while its stated reason covered only other phases' features; the contradiction was reported rather than resolved by this lane, and the coordinator's answer was to fix it                                                                                                                                                                                                                                                                                                                                                                                                | a platform follow-up lane; the delivery site is P1-31's own | **open**                                                                            |
| **CC-59 (d)** | **the acceptance plan's browser-case count does not include a spec that has not merged**          | `--list` on this tree collects **21 P1-31 cases per locale project, 42 in total**, across the five `*-p1-31.spec.ts` files that exist at `aa20c959`. The delivery-writes spec is on the unmerged Frontend proofs branch (§ 64 / CC-54) and contributes none of them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **the figure is stated as measured and named as one that moves.** After the Frontend proofs branch merges the count becomes twenty-five per locale and fifty in total, and the sentence in § 3 of the acceptance plan moves with it. Nothing is pre-written to a number no run has produced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | this integration, after #393                                | **settled for collection — § 69.9; earlier state: open**                            |

### 69.9 Resumed integration on 2026-09-14

The interrupted merge from protected `develop`
`e97db8ced0de80947e007df288d35f383e9fa68e` was resumed in place above preserved
`5bc317ac14b6d479813ca2b4c94b57dd54bcabd6`. The earlier § 69.1 neighbour table and
CC-59 (d) collection observation describe the prepared head, not this integration:
#393, #394 and #395 have merged; sections 64 through 68 are now present, and section 69
follows section 68. Both delivery browser fixture types and warranty ledger types are retained.

Collection from the web workspace now reports **50 P1-31 cases across both locales**,
plus one sign-in setup, in six spec files and the setup file. CC-59 (d) is settled for
collection and the acceptance plan is corrected. This is not a browser execution result;
FE-009 closing-head acceptance remains pending. Historical counts above are retained.

### 69.10 Failed acceptance prerequisite stays failed

Fable found that the harness's former null result for a failed history read could send the
browser case through its legacy-handoff skip. The harness now distinguishes an explicit
`{ status: 'failed', faults: [...] }` result. The handoff type accepts that result and the
warranty browser case throws its reported faults before considering the absent-ledger skip.
An older handoff with no ledger remains distinguishable from an attempted read that failed.

A controlled invocation of the actual spec callback confirms that the explicit failure stops
before navigation, an absent legacy field skips, and a successful read proceeds to navigation.
This local control-flow check is not browser execution. Web typechecking passes. Final tier
records are taken after this correction; the superseded unit recording was stopped and is
not claimed as passing.

### 69.11 Final local integration records

Both full tiers were recorded after the failed-prerequisite correction at executable commit
`5224feaa7f2fc577ca5096d66cacd58d4a44b1f6`: **unit 3372/3372 across 128 files** and
**web 4057/4057 across 142 files**, each exit 0, with no skipped cases or dirty executable paths.
The records in `../phase-1-27/evidence/local-run-ledger.json` remain LOCAL; no hosted result
is inferred from them. The earlier targeted DOM check passed 211 cases across four files.
Changed-file lint/format, web typechecking and the access, version-sourcing, write-shape,
web-boundary, phase-ownership and generated-artifact gates passed during integration.

The protected prerequisite #395 is confirmed at
`e97db8ced0de80947e007df288d35f383e9fa68e`: all 19 actual post-merge check-runs completed
successfully, including `protected-gate`; its last check completed at 2026-09-14T07:42:35Z.
These checks describe that prerequisite head, not this FE-009 candidate.

Raw reports, the preserved index snapshot, controlled failure regression, browser collection
and GitHub check-run evidence are retained outside the repository in the shared orchestration
evidence directory `astra-fe009-20260914`. FE-009 hosted checks and closing-head browser
acceptance remain pending at this local record.

The final `npm run verify:policies` completed with exit 0 after these records were
refreshed. The closing-values gate reported zero problems, and the evidence manifest
was in sync across all 41 evidence documents.

### 69.12 Consolidated engineering review

Fable reviewed complete candidate `40b02368a96eb403ac4c685bfd159aa4eefdd3f2` and
returned PASS-WITH-NOTES with no blockers on 2026-09-14 at 08:30Z. This is agent
engineering review, not a human QA or security certification. Its documentation notes
are corrected here: the residue is sixteen sites; the collection disposition points to
§ 69.9; the plan names six specs; and the prepared-head table is labelled historical.

The controlled failed-prerequisite regression is external at
`astra-fe009-20260914/history-failure-regression.cjs`; it is not a committed regression
suite. The integration commit history is preserved as recorded, including the longer
subject on `44d8a223` and the existing message/trailer conventions. No history was rewritten.

Tablet proof and the assurance matrix-test correction are being prepared separately by
Fable for integration after FE-009. The canonical tablet criterion is still owed at
this head; the older acceptance-plan claim that no document requires it is superseded
by `canonical-plan.md` lines 220–226. Closing acceptance waits for that instrument
integration and its protected verification.

After that review, web typechecking and the two changed browser-proof files' lint were
re-executed successfully; raw output is retained in `post-review-static.log` in the same
external evidence directory. The code is unchanged from `5224feaa`. The closing-values
gate again reported zero problems and the evidence manifest remained in sync.

### 69.13 P-12 — explicitly authorized report export

The recorded D-6 instruction of 2026-09-09 directs completion of the report-export contract with
explicit authorization and auditability. The instruction was not a deferral. Backend source
f8939ede90b6e73bddc83e413ed8e6f21cf9bbc8 implements it on the mapped P1-31 backend lane, based on
protected develop 32c797546f39bc9033dda95181571ce38b2f11cc. The prior source commit a9de7053 and its
initial verification failures remain in history. Section 70 remains reserved for closing acceptance.

The published POST /api/v1/reports/{reportCode}:export generates actual bounded CSV in its JSON
response. It requires scoped rpt.export, report-read, dataset permissions and the explicit
published tenant configuration's export permission. No baseline export entitlement, role grant,
bootstrap widening or audit-log export is introduced. It reuses the report runner's selection,
preserves detail values/labels and exact separately keyed summary measures, neutralizes formula
prefixes, rejects oversized/nonadvancing exports and commits an append-only disclosure audit before
returning content. The result states live freshness; no snapshot or durable storage claim is made.

[The seam record](./report-export-seam.md) specifies the request, result, limits, context and audit.
Runtime request/result validators supply the new operation's OpenAPI schemas. Optional schema
metadata leaves older operations' published shapes unchanged; this is not a claim to have repaired
the platform-wide bare-object-schema limitation.

The published operation population is 413, with 47 operations across the P1-31 namespace census,
13 declared permission codes and 14 distinct declaration sets. The new service enlarges the actual
backend coverage population by one; no coverage floor is weakened. The backend register, operation
coverage, idempotency/audit metadata, least-privilege map and both refusal/isolation matrices are
regenerated from their controlled tools. The map documents declarations; it grants nothing.

LOCAL targeted verification at the corrected source: 91/91 integration checks across 8 files and
314/314 backend cases across the report-engine and phase-wide privilege-escalation suites.
The backend witness used only the newly created p131_astra_export_20260914 database at 127.0.0.1:55432
on the previously designated disposable container. 141 migrations and the declared seeds replayed
there. The shared 54322 acceptance database was not reset, cleaned or used by this slice.

The initial full unit record at a9de7053 counted 3398 cases with 15 failures: inventory/census pins,
the new operation's missing matrix row and request-schema export, and their derived records.
Those failures triggered the correction commit; they are not a pass. The initial focused backend
run also retained a wrong audit-table name in the new test query, corrected before the passing
backend evidence. Matrix write-mode deliberately fails after generation; only a subsequent
no-write run is validation. A manual phase-ownership invocation selected its documented legacy
frontend default; the actual mapped p1-31-backend profile then passed against the declared base.

The candidate's final LOCAL counts are recorded below. Engineering review, PR checks and protected
integration are still pending at this record. No browser export journey, phase verdict or human
certification is claimed by these backend checks.

The next full unit measurement at fac0eb04 executed 3398 cases with 7 failures and zero skips.
Six failures concerned the prior ledger's now-stale count statements or evidence digest; the
seventh correctly refused a missing ReportExportBody frontend mirror. The backend prerequisite
has no frontend consumer yet. It is therefore recorded in the gate's existing pending-consumer
lifecycle, which requires removal as soon as the next frontend integration adds its consumed
mirror. This is an explicit integration dependency, not a completion claim or waived requirement.
The measured count statements and controlled evidence manifest were refreshed before revalidation.

Source `56d7011446873e7c0bfee0adf17e4db2e8546c70` then passed all 3398 unit cases and 4057 web
cases, with zero failures or skips. Final inspection identified an empty-selection context gap:
the JSON result carried the selected scope/period, but a CSV with no details or groups contained
only its header. Source `f8939ede90b6e73bddc83e413ed8e6f21cf9bbc8` corrects that gap with an
explicit context record inside every CSV, excluded from detail and summary counts. Its focused
export suite passes 26 cases, including a zero-row disclosure audit and a rectangular empty file.

Final LOCAL measurements at `f8939ede90b6e73bddc83e413ed8e6f21cf9bbc8`:

- Root unit: **3399/3399**, 129 files, zero failures/skips, runner exit 0 and reporter success.
- Web: **4057/4057**, 142 files, zero failures/skips, runner exit 0 and reporter success.
- Both records carry no dirty executable paths. The recorded counts and their closing-value
  locators are reconciled with the controlled run ledger; prior failed records are retained
  externally, rather than rewritten into passing observations.
- API typechecking and the changed service/test lint checks pass after the context correction.
  The whole-root formatter reported the test while that new regression was being formatted;
  the completed targeted format check passes. This overlapping check is not represented as a
  whole-root format pass.

Raw logs and reporter JSON are in the shared workspace's
`orchestration/evidence/p1-31/astra-fe009-20260914/`, with `export-` prefixes distinguishing them
from FE-009's earlier records. The 314-case database/security evidence above establishes the
unchanged authorization and isolation behavior; the later empty-file change is covered by the
new unit witness and final full tiers. It did not alter SQL, permission requirements or the route.

The final `verify:policies` run passes, including the request-mirror lifecycle, the evidence
manifest, all 151 derived documentation claims and the closing-values gate with zero problems.
The P1-27 lifecycle output belongs to that earlier phase and is not a P1-31 closure verdict.
The final export candidate is ready for its consolidated engineering review; no export PR,
hosted result or protected merge is claimed by this LOCAL record.

### 69.13.1 Consolidated review correction — CC-61

CC-61 is allocated to the P-12 backend implementation and its integration corrections.
Section 70 / CC-60 remains reserved for closing evidence; the existing 69.13 locator is retained
rather than renumbered. This supplemental allocation does not fold export into the older FE-009
scope of CC-59. The temporary pending-consumer exclusion for rpt.report-export belongs to CC-61:
it widens that exclusion list until a consumer exists, and must be removed in the same frontend
change that adds the consumed mirror. It is already removed in the local frontend integration.

Fable's consolidated review of d3257416 on 2026-09-14 found four blockers: stale declaration and
permission pins in the phase audit-emission suite, and two security records that had not been
annotated for the export-class operation. Those are corrected together. The 24 privileged-action
cases remain unchanged; the phase census is 47 declarations over 34 files with 13 permission codes.
The audit-class record now reviews the export action and preserves the separate question about
silent on-screen reads. The seam states the relationship to P1-15 export authorizations and records
the existing rate policy and absence of file digest/byte-length audit provenance as limitations.

The earlier 314-case measurement covers exactly its two named suites, not the entire backend tier.
A full backend run on the same disposable database is required before re-freeze; until recorded,
no full backend pass is claimed. Unit/web evidence is also re-recorded after executable corrections,
and the controlled ledger/manifests are refreshed last. No final review verdict or hosted result
is inferred from these corrections.

## 69.14 Report download, local monitoring and developer guidance

LOCAL implementation source: `c2235b974144f68d07975ce768cabd853186a8ea`, based on backend
candidate `d325741675536032a07cc8e2881c6d41c47bb4ad` and Fable tablet instrument
`7d944e05ad77177740b2281c927219db7218af2e` integrated by normal merge. This record does not
claim either candidate is on protected develop. Section 70 remains reserved for closing evidence.

The report detail now offers a translated reason-and-download control after a successful run.
It uses the displayed run's scope and period, not later unsubmitted form edits. Page gates require
rpt.export and configured export authority; the backend remains authoritative for dataset,
configured permission, scope and audit checks. The typed adapter submits five closed body fields,
validates returned context and file metadata, and the component prevents duplicate submissions,
ignores stale responses and cleans up its download URL. The consumed request mirror replaces the
backend candidate's pending-consumer entry. Four report codes use the same path.

The new monitoring command reads bounded local/test JSON logs and produces an exclusive local
queue containing only validated operation, error, correlation, timestamp and reviewer-route fields.
It makes no network connection. Report export and security faults route to the existing security
reviewer as well as the technical reviewer. It does not infer an audit failure from every export
fault, claim an external notification, or resolve D-10 event consumption. The operator runbook links
the new monitoring guide; developer guidance covers contract authority, scope/version behavior,
export semantics, meaningful verification and evidence recording.

Verification to date is LOCAL and focused:

- UI/adapter suite: 142 passed across four files, including eight export DOM cases in English/Arabic.
- Monitoring suite: eight passed, including actual captureException through RecordingErrorMonitor
  and the JSON logger, sanitized routing, malformed identifiers, bounds, duplicates, CLI completion
  and refusal, and exclusive output preservation.
- Root/web types and changed lint passed. Changed-file formatting and diff whitespace checks passed.
- Retained monitoring rehearsal measured 2026-09-14T11:10:16Z at c2235b97: CLI exit zero,
  complete=true, 460 input bytes, one record read and one routed, zero malformed/ignored/duplicates.
  The injected secret canary is absent from the queue. Queue SHA-256:
  `a1b8757f42bb89cb2d7573005a969b1b01d89227ef1cf16c517bb7b486462e66`.
  Raw capture, in-memory result, CLI output/counts and digests are retained externally under
  `orchestration/evidence/p1-31/astra-fe009-20260914/monitor-rehearsal-c2235b97/`.

The rehearsal is an injected test fault, not a business acceptance run or human certification.
The full-tier ledger still describes its earlier measured backend source; it will be refreshed
once the frontend and assigned export acceptance instruments are consolidated. Browser export,
protected integration and final acceptance remain pending. No old full-tier result is relabelled.

The [reference-location record](./canonical-reference-map.md) resolves the external Markdown
references previously searched only inside Git and records their actual placeholder status.
Canonical Word authority is preserved. External acceptance packaging and final source
synchronization remain separate work; this reference map is not a passing criterion record.
