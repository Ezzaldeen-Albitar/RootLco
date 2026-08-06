# Reception Media Capture Checklist

**Status:** Planning — not implemented · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Recorded:** 2026-08-06 · **Phase authority:** P1-27 Owner-acceptance remediation

---

## 0. Planning and traceability only — read this before anything else

**Nothing in this document is implemented by Phase 1-27.** This is a planning and
traceability record. It states what the business wants captured when a vehicle is
received, and it states — separately and honestly — what the platform can and
cannot do about that today.

Four rules govern how this document must be read:

| rule                                                                                       | why it matters                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A checklist item described here is a business intention, not a delivered feature.**      | No screen, no field and no upload behaviour described here exists. P1-27 delivers CRM and Vehicle Frontend work only.                                                                              |
| **Nothing here authorises file upload.**                                                   | `P1-OD-025` — vehicle document and media file policy — is an **open Owner decision**. Accepted file types, size limits and retention are not decided. This document must not be read as closing it. |
| **Every contract named below was read out of the repository on the branch shown.**         | Where a contract does not exist, this document says so and records a numbered integration finding rather than inventing an endpoint, a permission code or a column.                                 |
| **Counts that are not established are written as "not established", never as an estimate.** | There is no service-level target, no vendor price and no capture-time budget in this document, because none has been set.                                                                           |

Source of truth read for this document: branch
`remediation/p1-27-owner-acceptance-ux`, files under `apps/api/src/app/api/v1/**`,
`apps/api/src/modules/**`, `supabase/migrations/**` and
`supabase/seeds/04_iam_permission_catalog.sql`.

Related canonical records: `docs/phase-1/phase-1-27/canonical-plan.md` §7 (open
decisions), `docs/phase-1/phase-1-17/read-contract-remediation.md` §4 (why media
is blocked), `docs/phase-1/phase-1-8/p1-18-p1-28-boundaries.md` (the Reception
Frontend phase is **P1-28**, not P1-27).

---

## 1. Who this document is for, and what it is trying to protect

The reception desk accepts a customer's vehicle into the workshop's custody. From
that moment until hand-back, the workshop is answerable for the vehicle's
condition. The purpose of a capture checklist is to make that answerability
evidenced rather than remembered.

Three failures this checklist exists to prevent:

| failure                                                                    | how a checklist prevents it                                                                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A customer reports damage after collection that nobody can date.           | Pre-service exterior photographs, timestamped and attributed, establish the condition at the moment custody changed hands.      |
| A mileage or charge dispute at invoicing.                                  | A dashboard photograph taken at intake is the evidence behind the recorded odometer value and state of charge.                  |
| Work performed on the wrong vehicle, or a vehicle whose identity is unclear. | A vehicle identity photograph taken on the first visit ties the physical car to the record it was booked against.               |

The checklist is not a legal instrument, and this document makes no claim about
its evidentiary weight in any jurisdiction. Whether the captured set is
sufficient for insurance or dispute purposes is an Owner and legal question that
is **not established**.

---

## 2. Vocabulary

These words are used precisely throughout. Two of them are platform terms with
exact meanings in the database, and confusing them causes the most common
mistakes in this area.

| term                      | meaning here                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capture item**          | One line of the checklist — for example "front three-quarter photograph". A capture item is a business requirement.                                                                                  |
| **Document**              | The governed record of a file in `shared.documents`. It holds title, category, classification, retention class and legal-hold flag. **It holds no file bytes.**                                      |
| **Document version**      | One immutable revision of that file in `shared.document_versions` — content type, size, SHA-256 checksum, storage key and lifecycle status. **It also holds no bytes**; the bytes live in a store.   |
| **Link**                  | A row in `shared.document_links` tying a document to a business record. A link is what makes a document *reachable*. Knowing a document identifier is not reachability, and neither is a storage key. |
| **Storage key**           | The opaque locator of the stored object. Server-built from the environment, tenant, document and version identifiers. It is not a permission and never grants access.                                |
| **Capture point**         | The business moment a capture item is taken — at intake, at inspection, or during diagnosis.                                                                                                        |
| **Required / optional**   | Whether the business insists on the item before the reception may proceed. **No such concept exists in the platform today**; see finding `RMC-14`.                                                   |

---

## 3. The checklist

Fifteen capture items in five groups. The identifiers `EXT-*`, `DSH-*`, `IDN-*`,
`DIA-*` and `INS-*` are introduced by this document so later phases can reference
a line unambiguously. They are documentation identifiers, not database values.

### 3.1 At a glance

| id      | capture item                                       | group               | required or optional                        | capture point            |
| ------- | -------------------------------------------------- | ------------------- | ------------------------------------------- | ------------------------ |
| `EXT-1` | Front elevation                                    | Exterior body       | Required                                    | Intake, before movement  |
| `EXT-2` | Front near-side three-quarter                      | Exterior body       | Required                                    | Intake, before movement  |
| `EXT-3` | Near side (full flank)                             | Exterior body       | Required                                    | Intake, before movement  |
| `EXT-4` | Rear near-side three-quarter                       | Exterior body       | Required                                    | Intake, before movement  |
| `EXT-5` | Rear elevation                                     | Exterior body       | Required                                    | Intake, before movement  |
| `EXT-6` | Off side (full flank)                              | Exterior body       | Required                                    | Intake, before movement  |
| `EXT-7` | Roof and upper surfaces                            | Exterior body       | Required                                    | Intake, before movement  |
| `DSH-1` | Dashboard showing the odometer                     | Dashboard           | Required                                    | Intake, ignition on      |
| `DSH-2` | State of charge                                    | Dashboard           | Required for electric and plug-in hybrid; not applicable otherwise | Intake, ignition on      |
| `DSH-3` | Illuminated warning lights                         | Dashboard           | Required when any lamp is visibly lit; otherwise not applicable    | Intake, ignition on      |
| `IDN-1` | Vehicle identification number or chassis plate     | Vehicle identity    | Required on first visit; conditional afterwards | Intake                   |
| `DIA-1` | Diagnostic fault evidence                          | Diagnostic evidence | Required when a diagnostic session produces a fault; otherwise not applicable | Diagnosis                |
| `INS-1` | Road-test evidence and notes                       | Inspection evidence | Required when a road test is performed      | Inspection               |
| `INS-2` | Lift-inspection evidence and notes                 | Inspection evidence | Required when a lift inspection is performed | Inspection               |
| `INS-3` | Damage or defect photographs                       | Inspection evidence | Required for every damage or defect recorded | Intake and inspection    |

The seven exterior angles above are a **proposal**. The Owner brief fixes the
**count** at seven; which seven angles constitute the set is a business decision
that is **not established** and must be confirmed alongside `P1-OD-025`. Naming
them here gives the decision something concrete to accept or amend.

### 3.2 Exterior body — `EXT-1` … `EXT-7`

| aspect                     | statement                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**                | Establish the vehicle's external condition at the moment custody transfers.                                                                                                                                          |
| **Count**                  | Seven, one per angle. A single angle satisfied by two photographs is acceptable; an angle with none is not.                                                                                                          |
| **Sequence**               | All seven before the vehicle is moved from the reception bay, so that any subsequent movement damage falls outside the recorded baseline.                                                                             |
| **Business association**   | The reception visit (`rec.reception_visits`). The vehicle is reachable from the visit, so a vehicle-level association is derivable and should not be captured twice.                                                  |
| **Nearest existing contract** | `POST /receptions/{receptionId}/condition-evidence` with `kind: "damage_map"` binds a document and its **exact version** to the visit; `kind: "condition_item"` and `kind: "damage_mark"` each accept an `evidenceDocumentId`. |
| **What is missing**        | Nothing accepts a plain "walk-around photograph" that is not a finding. There is no capture item without an accompanying defect. Recorded as `RMC-16`.                                                                |

### 3.3 Dashboard — `DSH-1`, `DSH-2`, `DSH-3`

| aspect                        | statement                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`DSH-1` purpose**           | Evidence the odometer value recorded against the visit.                                                                                                                                                                            |
| **`DSH-1` recorded value**    | `POST /vehicles/{vehicleId}/odometer-readings` (`veh.vehicle-odometer-record`, permission `veh.vehicle.odometer.record`). The reading carries `value`, `unit` (`km` or `mi`), `observedAt` and `captureMethod` — for intake, `reception`. |
| **`DSH-1` gap**               | `veh.odometer_readings` has **no evidence column**, and the create body accepts no document. The photograph cannot be bound to the reading it evidences. Recorded as `RMC-09`.                                                      |
| **`DSH-2` purpose**           | Evidence the state of charge of an electric or plug-in hybrid vehicle.                                                                                                                                                             |
| **`DSH-2` recorded value**    | `rec.reception_visits.ev_soc_percent`, `numeric(5, 2)`, constrained to 0–100 by `ck_reception_visits_soc`. Supplied on `POST /receptions` as `evSocPercent`, and **nullable** — the column comment states it is not required for internal-combustion vehicles. |
| **`DSH-2` gap**               | The same absence of an evidence reference, and the column is **immutable** — `tg_reception_visits_immutable` freezes `ev_soc_percent`, `odometer_reading_id` and `fuel_level_id` after insert. A mis-keyed charge level cannot be corrected on the visit. Recorded as `RMC-10`. |
| **`DSH-3` purpose**           | Record which warning lamps were already lit before any work began.                                                                                                                                                                 |
| **`DSH-3` recorded value**    | `POST /receptions/{receptionId}/condition-evidence` with `kind: "warning_light"`, which requires `warningLightCodeId` and accepts `observedState` and an optional `evidenceDocumentId`. The observed states are `on`, `flashing`, `intermittent`. |
| **`DSH-3` blocking gap**      | `warningLightCodeId` must name a row in `rec.warning_light_codes`. That table's own comment reads that zero rows ship, no seed populates it, and **no route creates one**. A warning-light observation therefore cannot be recorded at all today. Recorded as `RMC-11`. |

A deliberate boundary, taken from `apps/api/src/modules/reception/domain/reception-evidence.ts`:
a lamp is recorded **as observed** and nothing is inferred from it. Which fault a
lamp indicates is diagnosis, and diagnosis belongs to a technician and to the
diagnostics domain — not to intake. The checklist must not tempt a receptionist
into diagnosing.

### 3.4 Vehicle identity — `IDN-1`

| aspect                  | statement                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Purpose**             | Tie the physical vehicle to the record, once, durably.                                                                                                                                                                                        |
| **First visit**         | Required. The photograph is taken of the manufacturer's plate or the visible chassis number.                                                                                                                                                   |
| **Repeat visits**       | Not required by default. Required again only where the stored image is missing, illegible, or where an operational reason applies — for example a plate change, an ownership transfer, or a duplicate-candidate review.                        |
| **Recorded value**      | The VIN itself is supplied to `POST /vehicles` as `vin`, raw form only; `veh.vehicles` generates the normalised value and decides active-VIN uniqueness on it. `GET /vehicles` matches an **exact** normalised VIN, never a leading wildcard.  |
| **Verification**        | `veh.vin_verifications` exists as a table that **no code reads or writes**, confirmed by `docs/phase-1/phase-1-17/read-contract-remediation.md` §4. There is no check-digit routine, no override policy and no permission code for VIN verification. |
| **Consequence**         | "Verify the VIN against the photograph" cannot be a system step. It is a human step whose outcome the system does not record. Recorded as `RMC-17`.                                                                                            |

### 3.5 Diagnostic evidence — `DIA-1`

| aspect                | statement                                                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | Preserve the fault codes and diagnostic screens a scan tool produced, exactly as produced.                                                                                                                                                          |
| **Existing contract** | `POST /inspections/{inspectionId}/evidence` (`dia.diagnostic-evidence-record`, permission `dia.diagnostic.record`, branch scope). The body is `documentVersionId`, `evidenceType` and an optional `note`.                                            |
| **Why a version**     | The route takes a document **version**, never a document and never a storage key. The docblock is explicit about why: a document reference would let the underlying bytes change under a recorded photograph of a worn brake disc.                    |
| **Acceptance**        | `accepted` is deliberately **not** required, because acceptance is unreachable while no role may write scan results — demanding it would make diagnostic evidence impossible for every caller. A `rejected` or `quarantined` version is refused.     |
| **Boundary**          | Diagnostics operate on a **job**, and a job exists only on a work order. A work order is created only by `POST /receptions/{receptionId}/convert-to-work-order`. So `DIA-1` is not a reception-desk capture item; it is a downstream one that this checklist references so the media chain is complete. |
| **Naming trap**       | The diagnostics resource is `/inspections`. The routes under `/template-versions/*` belong to **message templates** in shared services and have nothing to do with inspection templates.                                                             |

### 3.6 Inspection evidence — `INS-1`, `INS-2`, `INS-3`

| aspect                       | statement                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Inspection header**        | `POST /receptions/{receptionId}/condition-evidence` with `kind: "inspection"` opens a `rec.visual_inspections` row, which starts `in_progress`.                                                                                                                       |
| **Findings**                 | `kind: "condition_item"` hangs a finding off that header: `findingCategory` from `scratch`, `dent`, `crack`, `chip`, `wear`, `malfunction`, `other`; `vehicleZone`; optional `severity` from `minor`, `moderate`, `major`, `critical`; optional note and `evidenceDocumentId`. |
| **Damage placement**         | `kind: "damage_map"` binds the visit to a map template and its exact version (`documentId` **and** `documentVersionId`) with `mapType` from `exterior`, `interior`, `undercarriage`, `other`. `kind: "damage_mark"` then places a mark at fractional coordinates so it survives any rendering size. |
| **Leaks**                    | `kind: "leak"` records `leakType` from `oil`, `coolant`, `fuel`, `brake_fluid`, `transmission`, `water`, `other`, as observed. No cause and no fault is asserted.                                                                                                     |
| **`INS-1` road test**        | There is **no road-test concept** in the `rec` schema — no table, no column, no route, no vocabulary member. A road-test observation can only be filed as a generic condition item, which loses the fact that it came from a road test. Recorded as `RMC-18`.          |
| **`INS-2` lift inspection**  | The same. There is no lift-inspection concept; `rec.visual_inspections` carries an inspector and a status and no method. Recorded as `RMC-18`.                                                                                                                        |
| **`INS-2` further gap**      | `rec.visual_inspections.inspection_status` is never written by any code in `apps/api/src/modules/reception`. An inspection can be **opened and never completed or cancelled**. Recorded as `RMC-12`.                                                                  |
| **`INS-3` damage photos**    | Covered by `evidenceDocumentId` on a condition item or a damage mark. This is the one capture item whose association contract genuinely exists.                                                                                                                       |

---

## 4. The six attributes every capture item must carry

The Owner brief requires each item to define six things. Each is treated below as
a contract question: what would carry it, and does that carrier exist.

### 4.1 Required or optional state

| question                                     | answer                                                                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where would the requirement be defined?      | A checklist-definition table, scoped to tenant and branch, listing capture items with a required flag and an applicability condition.                                                                                            |
| Does one exist?                              | **No.** None of the twenty-three `rec` tables is a checklist definition. The nearest analogue is `sal.delivery_checklist_templates` and `sal.delivery_checklist_template_items`, which serve **delivery**, not reception.        |
| Is the requirement enforced anywhere?        | **No.** `rec.guard_reception_transition` enforces only the status graph (`opened → inspecting → authorized → converted`, plus the closure and refusal edges). `POST /receptions/{receptionId}/approve` states its preconditions as an active service requester and an approved authorization. No media precondition exists. |
| Finding                                      | `RMC-14`.                                                                                                                                                                                                                       |

Two consequences the Owner should weigh before deciding:

- Enforcement that blocks approval is a strong control and a strong operational
  risk. A vehicle already in the workshop cannot be un-received because a
  photograph failed to upload.
- Enforcement that only warns is weaker but never traps a receptionist. Which is
  correct is a business decision and is **not established**.

### 4.2 Uploaded or captured state

| state                | what it would mean                                                                | what carries it today                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Not started          | The item is on the list and nothing has been taken.                               | Nothing. There is no checklist row to be "not started".                                                                     |
| Authorised           | The platform has minted an upload authorisation and reserved a storage key.       | `POST /attachments/upload-authorizations` returns `documentId`, `uploadToken`, `uploadUrl`, `method`, `contentType`, `maxBytes`, `expiresAt`. |
| Registered / pending | The object was placed in the store and its version was registered.                | `POST /attachments/versions` — a version is created `pending` and **cannot be created in any other state**.                  |
| Accepted             | The file passed scanning and may be downloaded.                                   | **Unreachable.** See §5.3.                                                                                                  |
| Rejected             | A reviewer refused the pending version.                                           | `POST /attachments/versions/{versionId}/rejection`, terminal.                                                               |
| Quarantined          | A scanner found a threat.                                                         | A valid column value that no application path can produce, for the same reason acceptance cannot.                           |

The honest description of the best reachable state today is **"registered,
pending, never downloadable"**. A screen must not present that as "uploaded", and
must never present it as "complete".

### 4.3 Timestamp

| timestamp                    | source                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| When the file was registered | `shared.document_versions.uploaded_at`, defaulted `now()` and immutable thereafter.                                |
| When the document was raised | `shared.documents.created_at`, immutable.                                                                          |
| When custody transferred     | `rec.reception_visits.custody_accepted_at`, immutable.                                                             |
| When an odometer value was observed | `veh.odometer_readings.observed_at`, supplied by the caller as `observedAt`.                                   |
| When the photograph was taken | **Not established.** No column records device capture time. `uploaded_at` is a server clock, not a camera clock. |

The gap in the last row is worth stating plainly to a business reader: the
platform can say when a photograph reached it, not when it was taken. For a
dispute about the condition at intake, the two are usually close enough; for a
photograph uploaded the following day they are not. Whether device capture time
must be recorded is an Owner decision within `P1-OD-025`.

### 4.4 Capturing employee

| question              | answer                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who registered a file | `shared.document_versions.uploaded_by` and `created_by`, both `NOT NULL`, both immutable.                                                                                           |
| Who received the vehicle | `rec.reception_visits.receiving_employee_id`, `NOT NULL` and immutable.                                                                                                          |
| Who inspected         | `rec.visual_inspections.inspector_id`, `NOT NULL`.                                                                                                                                 |
| Audit trail           | Every write above emits an audit record. Upload authorisation and download authorisation are class `security`; version registration, linking and unlinking are class `privileged`.  |
| Who physically held the camera | **Not established**, and not knowable. The platform records the authenticated principal who registered the version. A shared tablet at the reception desk records whoever is signed in. |

### 4.5 Visit and work-order association

The association chain that exists today:

| from                | to                       | mechanism                                                                                                                        |
| ------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Document → business record | any allow-listed entity | `POST /attachments/documents/{documentId}/links`, with `entityType`, `entityId` and `linkPurpose`.                              |
| Reception visit → vehicle | vehicle             | `rec.reception_visits.vehicle_id`, immutable.                                                                                    |
| Reception visit → work order | work order       | `POST /receptions/{receptionId}/convert-to-work-order` (`rec.reception-convert`). This is the **only** way a work order is created. |

The link allow-list is fixed in
`apps/api/src/modules/shared-services/domain/attachment-policy.ts` and every entry
names a real table:

`apt.appointments` · `crm.business_partners` · `org.legal_companies` ·
`quo.quotations` · `rec.reception_visits` · `sal.invoices` · `veh.vehicles` ·
`wo.work_orders`

The seven registered link purposes are:

`attachment` · `evidence` · `identity_document` · `inspection_media` ·
`issued_document` · `signature` · `supporting_report`

For this checklist, `inspection_media` is the purpose that fits `EXT-*`, `DSH-*`
and `INS-*`; `identity_document` fits `IDN-1`; `evidence` fits `DIA-1`. Those are
proposals, not settled mappings — the mapping is part of what `P1-OD-025` should
confirm.

**A defect sits exactly here.** The vehicle module resolves its document list with
the entity token `veh.vehicle`, singular
(`apps/api/src/modules/vehicle/domain/vehicle-history.ts`), while the only
link-creating operation accepts `veh.vehicles`, plural. Recorded as `RMC-04` and
expanded in §5.5.

### 4.6 Secure access

Access to a stored file is a chain, and every element of the chain is required.
Read the chain as an "and", never an "or".

| # | element                | rule                                                                                                                                                                      |
| - | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Tenant isolation       | `shared.documents`, `shared.document_versions`, `shared.document_links` and `shared.file_scan_results` all have row-level security **enabled and forced**, tenant-scoped. |
| 2 | Reachability           | A document is reachable through a **live link** to an entity the principal may see. Knowing a document identifier is not access, and neither is knowing a storage key.     |
| 3 | Permission             | `shared.document.manage` for every document read and write today. There is no `shared.document.read` code. See `RMC-07`.                                                   |
| 4 | Scope                  | Every attachment operation is `scope: 'tenant'`. Reception operations are `scope: 'branch'`.                                                                               |
| 5 | Version state          | A download is issued only for an `accepted` version — `DOWNLOADABLE_STATES` contains exactly `accepted`. Anything else is refused with `ERR-DOC-001`.                       |
| 6 | Short-lived signed URL | `POST /attachments/documents/{documentId}/download-authorizations` mints a URL bounded by `STORAGE_DOWNLOAD_URL_TTL_SECONDS`. There is no way to express "no expiry".      |

---

## 5. What the platform actually provides today

### 5.1 The nine document-domain operations

Every row below was read from its own `route.ts`. Permissions are the exact codes
in the operation definition.

| operation id                          | method | path                                                             | permission                | scope  |
| ------------------------------------- | ------ | ---------------------------------------------------------------- | ------------------------- | ------ |
| `shared.attachment-upload-authorize`  | POST   | `/attachments/upload-authorizations`                             | `shared.document.manage`  | tenant |
| `shared.attachment-version-register`  | POST   | `/attachments/versions`                                          | `shared.document.manage`  | tenant |
| `shared.attachment-version-reject`    | POST   | `/attachments/versions/{versionId}/rejection`                    | `shared.document.manage`  | tenant |
| `shared.document-read`                | GET    | `/attachments/documents/{documentId}`                            | `shared.document.manage`  | tenant |
| `shared.attachment-download-authorize`| POST   | `/attachments/documents/{documentId}/download-authorizations`    | `shared.document.manage`  | tenant |
| `shared.attachment-link-create`       | POST   | `/attachments/documents/{documentId}/links`                      | `shared.document.manage`  | tenant |
| `shared.attachment-link-withdraw`     | DELETE | `/attachments/links/{linkId}`                                    | `shared.document.manage`  | tenant |
| `shared.document-retention-evaluate`  | POST   | `/attachments/documents/{documentId}/retention-evaluations`      | `shared.document.archive` | tenant |
| `veh.vehicle-document-list`           | GET    | `/vehicles/{vehicleId}/documents`                                | `shared.document.manage`  | tenant |

Two facts a reader will otherwise assume wrongly:

- **The vehicle documents endpoint is read-only.** The file
  `apps/api/src/app/api/v1/vehicles/[vehicleId]/documents/route.ts` exports `GET`
  and nothing else. There is no create, update or delete operation on it. The
  P1-27 observation is **confirmed**.
- **Both document reads are gated on a write code.** `shared.document.manage` is
  described in the catalogue as "Create document metadata, pre-acceptance versions
  and links". A member of staff who should only *view* reception photographs
  cannot be granted viewing alone.

### 5.2 Upload is authorisation-only — no route accepts a file

There is no endpoint anywhere in the published surface that accepts a file body.
The intended sequence is:

| step | actor    | action                                                                                                    |
| ---- | -------- | --------------------------------------------------------------------------------------------------------- |
| 1    | Client   | `POST /attachments/upload-authorizations` with `categoryCode`, `entityType`, `entityId`, `fileName`, `contentType`, `byteSize`. |
| 2    | Platform | Creates the document row, builds the storage key, signs a `PUT` URL, returns an upload token.             |
| 3    | Client   | Sends the bytes **directly to the storage provider** at the signed URL. The platform never sees them.     |
| 4    | Client   | `POST /attachments/versions` with the upload token, the SHA-256 checksum and the byte size.               |
| 5    | Platform | Re-derives the storage key from server-resolved values, re-checks content type and size against the category, and records a **pending** version. |

Step 3 has no provider. `STORAGE_PROVIDER` defaults to `unconfigured`, which
refuses every call; the only implemented adapter is `local_fake`, which signs
against `https://object-storage.invalid` — a host in the RFC 2606 reserved
`.invalid` top-level domain that by definition can never resolve. Its own header
states the design intent: the URLs it issues are verifiable, so security tests can
prove a download URL cannot be replayed as an upload, and **useless**, so the
adapter cannot silently become production.

Selecting and provisioning a real object store is an Owner decision that is
**open**. This document recommends an **evaluation** of candidate providers
against the security properties in §5.6; it does not recommend, request or
authorise a purchase or a contract, which is reserved to the Product Owner.

### 5.3 Acceptance is unreachable, and that is deliberate

The chain, read from the migrations:

1. `shared.guard_document_version_transition()` permits `pending → accepted` only
   when a `clean` row exists in `shared.file_scan_results` for that version, and
   refuses outright if any `infected` row exists.
2. `supabase/migrations/20260728090000_shared_services_runtime_write_capabilities.sql`
   states in its own header that `shared.file_scan_results` is "NOT granted to any
   role, in any form", and records the consequence honestly: no scanner exists in
   this phase, so a document version cannot reach `accepted`.
3. The only status update the request runtime holds is `pending → rejected`,
   through the policy `upd_document_versions_reject`.
4. A download is issued only for an `accepted` version.

**Therefore no file registered through this API can be downloaded today.** A media
screen that offers a "view photograph" action would be offering an action that
always fails. Recorded as `RMC-03`.

The withholding is correct engineering, not an oversight: if the runtime could
write scan verdicts, an `infected` verdict could be quietly rewritten inside a
tenant, and the table has no triggers to prevent it.

### 5.4 No document category exists, so no upload can even be authorised

`authorizeUploadDetailed` resolves the caller's `categoryCode` against
`shared.document_categories` and fails with `ERR-RES-001` if there is no active
row. That table:

- is **not seeded** — no file under `supabase/seeds/` inserts into it, and no
  migration does either;
- has **no management route** — there is no `/document-categories` path segment in
  the API;
- carries the platform's per-category `allowed_content_types` and
  `max_size_bytes`, which are exactly the values `P1-OD-025` must decide.

So the very first step of the upload sequence cannot succeed. Recorded as
`RMC-05`. This is the cleanest possible demonstration that upload is not
implemented: it is not merely unfinished, it is not reachable.

For completeness, the platform ceiling that would sit above any category limit is
`STORAGE_MAX_UPLOAD_BYTES`, a bounded configuration value, and the service applies
`min(category ceiling, platform ceiling)`. **No approved limit exists**, and this
document deliberately states no number as a policy value.

### 5.5 The vehicle document list can never return a row

| element                            | value                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| What the read asks for             | `VEHICLE_DOCUMENT_ENTITY_TYPE = 'veh.vehicle'` — singular.                                                |
| What the only write accepts        | `LINKABLE_ENTITY_TYPES` contains `'veh.vehicles'` — plural. `isLinkableEntityType` refuses anything else. |
| How the read matches               | `shared.document_ids_for_entity(entity_type, entity_id)` matches `entity_type` exactly.                  |
| Any other write path?              | No. Only `AttachmentService.link()` inserts into `shared.document_links`, confirmed by search.            |
| Net effect                         | A link the vehicle read can see cannot be created through the API. `GET /vehicles/{vehicleId}/documents` returns an empty `documentIds` array for every vehicle, permanently. |

The route's own docblock instructs a caller to link with `entityType` `veh.vehicle`
— which the link operation would reject. The documentation and the allow-list
disagree, and the read agrees with the documentation. Recorded as `RMC-04`.

A second, smaller defect in the same response: `listDocuments` returns
`{ vehicleId, documentIds }`, a bare array. Every other list in the platform
returns `{ items, nextCursor, hasMore }` — there is no `total` anywhere, by design
— and this one returns neither a cursor nor a bound. Recorded as `RMC-08`.

### 5.6 Security statements that are not negotiable

These are stated plainly because a media feature is where they are most often
quietly broken.

| statement                                   | what it means, and what makes it true today                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **No public bucket is assumed or permitted.** | No design in this document depends on an object being readable without authorisation. Reachability is the live link plus the permission plus the version state plus a signed, expiring URL. A publicly readable store would bypass all four.  |
| **No raw storage credential is ever exposed.** | The storage port's contract states that nothing in its result is a credential: an adapter returns a URL and an expiry. Access keys, tokens and bucket policies never cross that boundary and must never reach a browser.                     |
| **An object key is not authorisation.**     | The column comment on `shared.document_versions.storage_key` says it in as many words: possessing it grants no access. The key is server-built from the environment, tenant, document and version identifiers; a caller supplies no segment, which is what makes traversal and cross-tenant collision structurally impossible rather than filtered. |
| **A key carries no business data.**          | The storage-key convention forbids an email, phone number, name, VIN or registration number in a key, and `assertKeyIsWellFormed` re-checks the built key. Keys travel into storage inventories, backups and replication logs, where row-level security does not follow them. |
| **A signed URL is a bearer credential.**     | It is never logged, never audited and never returned in an error. The application logs the *fact* of an issuance with its purpose and time-to-live, and nothing else.                                                                        |
| **The upload token carries convenience, not authority.** | It is unsigned base64url JSON and can be forged. Forging it achieves nothing: the document is re-loaded under row-level security, the storage key is re-derived server-side, the content type is re-checked against the category, and the expiry is re-checked. |
| **Nothing here claims malware scanning.**    | No scanner is configured, `scanState` reports `scannerAvailable: false` as a hard-coded literal, and no code path fabricates a verdict.                                                                                                       |
| **This document does not claim upload completion.** | `P1-OD-025` remains authoritative for accepted file types, size limits and retention. Until it is decided, the correct statement about media is "the foundation exists; acceptance is blocked".                                          |

---

## 6. The open Owner decisions, and exactly where they bind

### 6.1 `P1-OD-025` — vehicle document and media file policy · **OPEN**

The P1-27 disposition is a **decision-neutral foundation**: implement the safe UI
foundation, keep upload acceptance blocked, do not invent limits. This document
holds to that without exception.

What `P1-OD-025` must decide before any capture item in §3 can be delivered:

| # | decision                              | why it cannot be assumed                                                                                                                   |
| - | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Accepted file types per category      | `shared.document_categories.allowed_content_types` is `NOT NULL` with at least one entry. No category exists to hold a default.             |
| 2 | Maximum size per category             | `max_size_bytes` is `NOT NULL` and must be positive. Any number written today would be an invention.                                        |
| 3 | The category set itself               | At minimum: reception media, vehicle identity, diagnostic evidence, signature. Each needs a code, a default classification and a retention class. |
| 4 | Default classification per category   | The permitted values are `public`, `internal`, `restricted`, `secret`. A vehicle interior photograph may show personal property.            |
| 5 | Retention class per category          | The five seeded classes are `operational`, `evidence-audit`, `personal-data`, `temporary`, `immutable-financial-history`. Four of the five define **no** minimum period — the seed records that periods are owner- and jurisdiction-defined. |
| 6 | Retention period                      | Consequently `policyDecided` is `false` for most documents today. A retention duration is a legal and Owner matter, not a technical default. |
| 7 | Whether device capture time is required | See §4.3.                                                                                                                                  |
| 8 | Whether a link purpose per capture group is fixed | The seven purposes exist; the mapping in §4.5 is a proposal.                                                                     |
| 9 | The object store, and the scanner     | Both are prerequisites for a working upload. Both are **commercial decisions reserved to the Product Owner**; this document recommends an evaluation and recommends no purchase. |

### 6.2 `P1-OD-017` — duplicate and merge rules · **OPEN**

`P1-OD-017` binds this checklist at one point only, and it is worth naming so
nobody assumes otherwise.

When two vehicle records turn out to be the same car, the media captured against
each must end up somewhere defined. Merge rules decide whether evidence follows
the survivor, is preserved against both, or is left where it was. Until
`P1-OD-017` is decided, no capture item may be described as "surviving a merge",
and the media screens must not offer a merge affordance. The P1-27 rule is that
the affordance is **absent**, not disabled with a tooltip — a disabled button
implies the capability exists and the user lacks permission, which is a different
and false statement.

The duplicate-review reads themselves are not blocked; `crm.duplicate-list`,
`crm.duplicate-review` and the vehicle equivalents exist.

---

## 7. Integration findings

Eighteen findings. Each was verified against the repository; none is inferred from
another document. The identifiers `RMC-01` … `RMC-18` are introduced by this
document. They are **not** entries in the `P1-27-INT-###` register — that series
already holds `001`–`006` — and whoever maintains that register must decide which
of these to promote into it and under what numbers.

`P1-28` is the Reception and Appointment Frontend phase, recorded in
`docs/phase-1/phase-1-8/p1-18-p1-28-boundaries.md`. It has no plan, no branch and
no scope document in this repository, so every reference to it below is a
placement, not a commitment.

| finding  | what is missing                                                                                                                                                                                                                   | owning Backend phase | owning Frontend phase                                | required action                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RMC-01` | No read surface for Reception or Appointment. All twelve operations are writes; the permission catalogue records the omission as deliberate, and no `rec.*.read` or `apt.*.read` code exists.                                     | P1-18                | P1-28                                                | Add read operations for a visit, its evidence and its appointments, plus the read permission codes to gate them.                             |
| `RMC-02` | No route accepts file bytes, and `STORAGE_PROVIDER` defaults to `unconfigured`. The only adapter signs against a non-resolvable host.                                                                                             | P1-15                | P1-28 (and P1-27 `FE-027` for the vehicle surface)   | Owner decides `P1-OD-025` and the hosting question; then evaluate and provision a provider. No purchase is recommended here.                  |
| `RMC-03` | Version acceptance is unreachable: it requires a `clean` row in `shared.file_scan_results`, which is granted to no role. No registered file can ever be downloaded.                                                               | P1-15                | P1-28                                                | Introduce a scanning component with its own role and grant, or record an Owner-accepted exception. Provider selection is an evaluation.       |
| `RMC-04` | Entity-token mismatch: the vehicle read asks for `veh.vehicle`, the only link write accepts `veh.vehicles`. `GET /vehicles/{vehicleId}/documents` can never return a row.                                                          | P1-17 with P1-15     | P1-27 (`FE-026` consumes the endpoint)               | Reconcile the token in one place and add a test that asserts the read token is a member of the write allow-list.                             |
| `RMC-05` | No document category exists. `shared.document_categories` is unseeded and has no management route, so `POST /attachments/upload-authorizations` fails with `ERR-RES-001` for every caller.                                          | P1-15                | P1-28                                                | Owner decides the category set, types and ceilings under `P1-OD-025`; then add a configuration path that does not violate the no-fake-data policy. |
| `RMC-06` | No document list or search. The only reads are one document by identifier and the vehicle-scoped identifier list. A reception's media cannot be enumerated.                                                                        | P1-15 with P1-18     | P1-28                                                | Add a reachability list per entity returning `{ items, nextCursor, hasMore }`.                                                                |
| `RMC-07` | No `shared.document.read` permission. Both document reads are gated on `shared.document.manage`, a write code that also authorises upload, linking and download authorisation.                                                     | P1-14 with P1-15     | P1-28                                                | Split the code, re-gate the two reads, and re-run the catalogue check.                                                                       |
| `RMC-08` | `veh.vehicle-document-list` returns `{ vehicleId, documentIds }` — a bare, unbounded array with no cursor.                                                                                                                         | P1-17                | P1-27 (`FE-026`)                                     | Convert to the platform keyset page shape.                                                                                                   |
| `RMC-09` | `veh.odometer_readings` has no evidence column and the create body accepts no document, so a dashboard photograph cannot be bound to the reading it evidences.                                                                     | P1-17                | P1-27 (`FE-027` context) and P1-28                   | Either add an evidence reference to the reading, or rule explicitly that the photograph binds to the visit and record that rule.              |
| `RMC-10` | `rec.reception_visits.ev_soc_percent` carries no evidence reference and is immutable after insert, so a mis-keyed charge level cannot be corrected on the visit.                                                                   | P1-18                | P1-28                                                | Decide whether a correction path is needed; if so it must be a new evidenced record, never an in-place edit of an immutable column.           |
| `RMC-11` | `rec.warning_light_codes` ships zero rows by the no-fake-data policy and has no management route, while `kind: "warning_light"` requires a `warningLightCodeId`. The observation cannot be recorded at all.                        | P1-18                | P1-28                                                | Add catalogue management with a permission code, or change the contract to accept an uncoded observation. Catalogue content is an Owner input. |
| `RMC-12` | `rec.visual_inspections.inspection_status` is written by no code in the reception module. An inspection can be opened and never completed or cancelled.                                                                            | P1-18                | P1-28                                                | Add a completion and cancellation contract, honouring the existing finalisation lock.                                                         |
| `RMC-13` | Evidence binding is inconsistent. Six evidence kinds bind a **document** (`evidenceDocumentId`, foreign key to `shared.documents`); damage maps and signatures bind a **document and its exact version**. A document-level binding lets a later version change what a record points at. | P1-18 with P1-05     | P1-28                                                | Decide one rule for pre-service evidence and apply it. Version binding is the stronger of the two and matches diagnostics.                    |
| `RMC-14` | No checklist definition exists anywhere: no table, column, contract or gate expresses that a capture item is required, and reception approval has no media precondition.                                                          | P1-18                | P1-28                                                | Owner decides enforcement strength; then model checklist definition and per-visit completion, taking `sal.delivery_checklist_templates` as the shape precedent. |
| `RMC-15` | No count constraint. "Seven exterior photographs" cannot be expressed, counted or verified by anything in the schema.                                                                                                             | P1-18                | P1-28                                                | Fold into the `RMC-14` definition model as a minimum count per capture item.                                                                  |
| `RMC-16` | No contract accepts a walk-around photograph that records **no** defect. Every reception media path hangs off a complaint, a finding, a mark, a leak, a lamp or a signature.                                                       | P1-18                | P1-28                                                | Add a neutral condition-evidence kind, or rule that a plain photograph is a document linked to the visit with purpose `inspection_media`.     |
| `RMC-17` | No VIN verification contract. `veh.vin_verifications` is read and written by nothing; there is no check-digit routine, no override policy and no permission code.                                                                 | P1-17                | P1-27 (`FE-020` scope boundary) and P1-28            | Backend feature work: define the algorithm, the override authority and the permission before any screen claims to verify a VIN.               |
| `RMC-18` | No road-test and no lift-inspection concept. Neither has a table, column, route or vocabulary member; both would have to be filed as generic condition items, losing the method that produced them.                               | P1-18                | P1-28                                                | Decide whether inspection method is a first-class attribute; if so, extend the inspection header rather than overloading finding categories.  |

---

## 8. What a P1-28 planner should take from this

Stated as obligations, not as design:

| # | obligation                                                                                                                                                                     |
| - | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Do not begin Reception Frontend work before `RMC-01` closes. A phase with zero read operations cannot render, resume or verify a checklist.                                     |
| 2 | Do not present a registered file as "uploaded" or "complete". The truthful state is registered and pending, and it is not downloadable.                                         |
| 3 | Do not build a "view photograph" action while `RMC-03` is open. An action that always fails is worse than an absent one.                                                        |
| 4 | Do not display an upload control that asserts a file type or a size limit. `P1-OD-025` owns both, and inventing either is the precise failure the decision-neutral rule forbids. |
| 5 | Do not offer a merge affordance on any media surface while `P1-OD-017` is open. Absent, not disabled.                                                                           |
| 6 | Do not accept, display or construct a storage key anywhere in a client. The API accepts a document or a version identifier and nothing else.                                    |
| 7 | Compose the P1-25 and P1-26 foundations. A media gallery is feature composition; a second upload authority, notification authority or table system is not permitted.            |
| 8 | Every list must be keyset-paginated: `{ items, nextCursor, hasMore }`. There is no `total` anywhere in this platform.                                                           |

---

## 9. What is not established

Recorded so that no later reader mistakes silence for a decision.

| subject                                            | status                                                                                             | what would establish it                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Which seven exterior angles                        | Not established                                                                                    | Owner confirmation alongside `P1-OD-025`.                                                  |
| Accepted file types and size ceilings              | Not established                                                                                    | `P1-OD-025`.                                                                               |
| Retention period for reception media               | Not established — four of the five seeded retention classes define no minimum period               | Owner and legal determination per jurisdiction.                                            |
| Whether missing media blocks reception approval    | Not established                                                                                    | Owner decision, then `RMC-14`.                                                             |
| Time to complete the checklist at the desk         | Not established                                                                                    | Timed observation at the pilot branch. No target is asserted here.                         |
| Storage cost, provider and region                  | Not established                                                                                    | An Owner-commissioned evaluation. This document recommends evaluation and no purchase.     |
| Malware scanning provider                          | Not established                                                                                    | The same. `scannerAvailable` is a hard-coded `false` until one exists.                     |
| Device capture time capture                        | Not established                                                                                    | `P1-OD-025`.                                                                               |
| Evidentiary sufficiency of the captured set        | Not established                                                                                    | Legal review. Nothing in this document asserts it.                                         |
| Whether reception media is restricted data         | Not established — `shared.documents.classification` admits `public`, `internal`, `restricted`, `secret`, and the `P1-8` boundary note expects restricted narratives to require `iam.sensitive.view`, which no reception read exists to enforce | `P1-OD-025` category defaults, then `RMC-01`. |

---

## 10. Traceability

| claim in this document                                        | read from                                                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The nine document-domain operations and their permissions     | `apps/api/src/app/api/v1/attachments/**/route.ts`, `apps/api/src/app/api/v1/vehicles/[vehicleId]/documents/route.ts`             |
| Vehicle documents endpoint is read-only                       | the same file — it exports `GET` only                                                                                           |
| Link allow-list and link purposes                             | `apps/api/src/modules/shared-services/domain/attachment-policy.ts`                                                              |
| Vehicle entity token `veh.vehicle`                            | `apps/api/src/modules/vehicle/domain/vehicle-history.ts`                                                                        |
| Storage key is server-built and opaque                        | `apps/api/src/modules/shared-services/domain/storage-key.ts`; `supabase/migrations/20260718101000_…` column comment              |
| No production object store                                    | `apps/api/src/modules/shared-services/provider/storage-provider.ts`, `provider/local-storage-provider.ts`                        |
| Upload flow, ceilings and token re-checks                     | `apps/api/src/modules/shared-services/application/attachment-service.ts`                                                        |
| Acceptance requires a clean scan; the table is granted to no role | `supabase/migrations/20260718101000_shared_document_versions_and_scan_results.sql`; `supabase/migrations/20260728090000_shared_services_runtime_write_capabilities.sql` |
| Document category columns and constraints                     | `supabase/migrations/20260718100000_shared_document_categories_and_documents.sql`                                                |
| Retention classes and their undefined periods                 | `supabase/seeds/05_shared_reference.sql`                                                                                        |
| Reception visit columns, immutability and status graph        | `supabase/migrations/20260721097000_rec_reception_visits.sql`                                                                    |
| Condition-evidence kinds and vocabularies                     | `apps/api/src/app/api/v1/receptions/[receptionId]/condition-evidence/route.ts`; `apps/api/src/modules/reception/domain/reception-evidence.ts` |
| Warning-light catalogue ships zero rows                       | `supabase/migrations/20260721095000_rec_configuration_catalogs.sql` table comment                                                |
| Odometer reading columns and capture methods                  | `supabase/migrations/20260720101000_veh_odometer_readings.sql`; `apps/api/src/app/api/v1/vehicles/[vehicleId]/odometer-readings/route.ts` |
| Diagnostic evidence binds a version                           | `apps/api/src/app/api/v1/inspections/[inspectionId]/evidence/route.ts`                                                           |
| Reception approval preconditions                              | `apps/api/src/app/api/v1/receptions/[receptionId]/approve/route.ts`; `rec.guard_reception_transition`                            |
| Permission codes and their descriptions                       | `supabase/seeds/04_iam_permission_catalog.sql`                                                                                  |
| `P1-OD-017` and `P1-OD-025` dispositions                      | `docs/phase-1/phase-1-27/canonical-plan.md` §7                                                                                  |
| VIN verification is unimplemented                             | `docs/phase-1/phase-1-17/read-contract-remediation.md` §4                                                                       |
| P1-28 owns the Reception Frontend                             | `docs/phase-1/phase-1-8/p1-18-p1-28-boundaries.md`                                                                              |
