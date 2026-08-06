# Inspection and Diagnostics

**Status:** Planning — not implemented · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Recorded:** 2026-08-06 · **Phase authority:** P1-27 Owner-acceptance remediation

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 0. What this document is, and what it is not

### 0.1 Planning and traceability only

**Nothing described in this document is implemented by Phase 1-27.** P1-27 is a
CRM and Vehicle Frontend phase. It builds customer and vehicle screens and it
builds no inspection screen, no diagnostic screen, no road-test screen and no
reception review screen. No sentence below may be read as a statement that a
feature exists, that a screen has been built, or that a workflow is available to
a workshop today.

What this document does is narrower and, for planning purposes, more useful:

| this document does                                                                        | this document does not                                                       |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Describe the four initial-inspection stages as a business workflow                        | Claim any of the four is available in the product                            |
| Name the exact backend contracts that already exist and could carry part of a stage        | Claim those contracts are wired to any screen                                |
| Record, by number, every contract a stage needs that **does not exist**                   | Invent an endpoint, permission code, table, column or status value to fill a gap |
| Fix the rules that any future implementation must obey                                     | Authorise, schedule or estimate that implementation                          |

Every backend fact below was read out of this repository on the branch
`remediation/p1-27-owner-acceptance-ux` — from `apps/api/src/app/api/v1/**/route.ts`,
`apps/api/src/modules/*/`, `supabase/migrations/*.sql` and
`supabase/seeds/04_iam_permission_catalog.sql`. Where a contract was looked for
and not found, that is stated as a finding in §11 rather than filled in by
assumption.

### 0.2 How to read the tables

Three labels are used, and they mean exactly three different things:

| label                    | meaning                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Contract exists**      | The named operation, table or column is present in the repository today. It is not connected to any screen.    |
| **Contract absent**      | It was searched for and is not present. A numbered finding in §11 records it.                                  |
| **Not established**      | The value is a business quantity nobody has decided or measured. The text says what would establish it.        |

There are no estimates in this document. There are no service-level commitments,
no throughput figures, no vendor prices and no counts that were not read out of
the repository.

---

## 1. Vocabulary, and one naming trap

An **inspection** in workshop language is a person looking at a vehicle. In this
platform the record that holds an inspection is called a **diagnostic report**,
and the backend address for it is `/inspections`. That is an API path, not a
screen: nothing in the product opens at it, and every path in the table below is
a backend contract read out of the operation registry.

| workshop word         | API path                                | database table                                     |
| --------------------- | --------------------------------------- | -------------------------------------------------- |
| inspection record     | `/inspections/{inspectionId}`           | `dia.diagnostic_reports`                           |
| inspection sheet      | (no path — see finding `INS-09`)        | `dia.inspection_templates` / `dia.template_versions` |
| checklist question    | (no path — see finding `INS-09`)        | `dia.template_items`                               |
| answer to a question  | `/inspections/{id}/items/{templateItemId}` | `dia.report_item_results`                       |
| a fault the staff found | `/inspections/{id}/findings`          | `dia.findings`                                     |
| a reading taken        | `/inspections/{id}/measurements`        | `dia.measurements`                                 |
| a fault code from the vehicle | `/inspections/{id}/dtcs`          | `dia.dtc_records`                                  |
| a photograph or file   | `/inspections/{id}/evidence`            | `dia.diagnostic_evidence`                          |
| advice to the customer | `/inspections/{id}/recommendations`     | `dia.recommendations`                              |
| a second pair of eyes  | `/inspections/{id}/reviews`             | `dia.diagnostic_reviews`                           |

The trap: `/template-versions/**` in this platform belongs to **message
templates** (SMS and e-mail wording, in the shared-services module), not to
inspection sheets. Anyone planning against these paths must not confuse the two.

A separate word is needed for the intake stage. What the receptionist records
when the vehicle arrives lives under **reception** (`rec.`), not under
diagnostics, and reception observations are a different kind of record from
diagnostic observations. §7 explains why that separation is deliberate and must
be preserved.

---

## 2. Where the four stages would sit

The platform already has a chain of records that a vehicle passes along. The
four inspection stages do not sit outside that chain; each of them would attach
to a point on it.

| step                     | record                | how it is created today                                          | contract |
| ------------------------ | --------------------- | ----------------------------------------------------------------- | -------- |
| The vehicle arrives      | reception visit       | `POST /receptions` (`rec.reception.manage`)                       | exists   |
| Intake evidence recorded | complaints, condition items, damage marks, warning lights, leaks, contents | `POST /receptions/{receptionId}/condition-evidence` (`rec.reception.evidence.manage`) | exists |
| The customer authorises work | authorisation     | `POST /receptions/{receptionId}/authorizations` (`rec.reception.authorization.verify`) | exists |
| The visit is approved    | approval              | `POST /receptions/{receptionId}/approve` (`rec.reception.approve`) | exists   |
| Work is opened           | work order            | `POST /receptions/{receptionId}/convert-to-work-order` (`rec.reception.convert`) | exists |
| A task is created        | job                   | `POST /work-orders/{workOrderId}/jobs` (`wo.job.manage`)          | exists   |
| An inspection is opened  | diagnostic report     | `POST /jobs/{jobId}/inspections` (`dia.diagnostic.record`)        | exists   |

Two structural facts follow, and both matter to planning:

1. **A diagnostic report always hangs off a job, which hangs off a work order,
   which hangs off a reception visit.** `wo.work_orders.reception_visit_id` is
   `NOT NULL`, so the chain from an inspection back to the arrival record is
   never broken.
2. **A work order cannot be created directly.** There is no `POST /work-orders`.
   The only route into a work order is conversion from an approved reception,
   gated on `rec.reception.convert`. The seeded permission `wo.work_order.create`
   is used by no route.

Against that chain, the four stages map as follows.

| stage                       | attaches to        | record it would produce                              |
| --------------------------- | ------------------ | ---------------------------------------------------- |
| **A. Computer diagnostic scan** | a job          | a diagnostic report whose entries are fault codes, readings and findings |
| **B. Road test**            | a job              | a diagnostic report; plus a labour session for the time; plus an odometer reading |
| **C. Lift inspection**      | a job              | a diagnostic report whose entries are findings with severity and disposition |
| **D. Reception final review** | the reception visit and the work order | **no record type exists** — see `INS-10` and `INS-17` |

---

## 3. Stage A — computer diagnostic scan

### 3.1 What the stage is, in business terms

A technician connects diagnostic equipment to the vehicle and reads what the
vehicle's own computers report. The output is a list of fault codes, sometimes
with live readings alongside them. The stage does not repair anything and does
not commit the customer to anything.

### 3.2 The fault-code contract, exactly

`POST /inspections/{inspectionId}/dtcs`, permission `dia.diagnostic.record`,
scope `branch`.

| field         | rule                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `code`        | Must match `^[PBCU][0-9][0-9A-F]{3}$` — `ck_dtc_records_code_format`. Upper case only. The **second** character is decimal and only the **last three** are hexadecimal, so `P0300` is accepted and `p0300`, `PA300` and `P0G00` are refused. |
| `description` | Free text, optional, at most 500 characters (`MAX_DTC_DESCRIPTION`). Nothing validates it against anything.               |
| `dtcStatus`   | One of `active`, `pending`, `stored`, `cleared` — `ck_dtc_records_status`. Defaults to `active`.                          |

### 3.3 Active, stored and historical — what the contract actually supports

The brief for this stage asks for a separation between active, stored and
historical codes. **Only part of that separation has a contract.**

| requested separation | contract                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Active               | Exists. `dtc_status = 'active'`, and it is the column default.                                                        |
| Pending              | Exists, though it was not asked for. `dtc_status = 'pending'`.                                                        |
| Stored               | Exists. `dtc_status = 'stored'`.                                                                                      |
| Cleared              | Exists, though it was not asked for. `dtc_status = 'cleared'`.                                                        |
| **Historical**       | **Contract absent.** There is no `historical` value in `ck_dtc_records_status`, and no other column expresses it. See `INS-02`. |

The nearest honest reading available today is that "historical" means *a code
recorded on an earlier diagnostic report for the same vehicle*. That reading is
not free either: there is no operation that lists inspections for a vehicle
(finding `INS-13`), so assembling a vehicle's diagnostic history would require a
read contract that does not exist.

**A screen must not label a stored code "historical".** The two words are not
synonyms in workshop practice, and using one where the vehicle reported the other
would be the screen inventing a fact about the vehicle.

### 3.4 What the equipment used cannot be recorded

**Contract absent.** No table, column or route in this repository records:

- which diagnostic device or scan tool was connected;
- its software or database version;
- which test or procedure was run;
- when the scan session started and finished, as distinct from when each row was
  written;
- any grouping of several codes into one read event.

Searching the repository for device, scan-tool, tool or OBD identifiers returns
nothing. This is recorded as `INS-01`. It matters commercially as well as
technically: a workshop that cannot say which tool produced a reading cannot
defend that reading later.

### 3.5 Raw machine output is never shown to ordinary users

**This is a product rule, and it is stated here as a rule rather than described
as a behaviour.**

A normal user — receptionist, service advisor, customer-facing staff — must never
be shown raw machine output: unformatted controller dumps, freeze-frame binary,
manufacturer-proprietary payloads, or a hexadecimal blob of any kind.

The current contracts make this rule easy to keep, and a future implementation
must not make it hard:

| fact                                                                                              | consequence                                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| No operation in the platform accepts a raw machine payload. `dtcs`, `measurements` and `items` all accept typed fields. | There is nothing to leak today.                                                  |
| `description` on a fault code is free text with no catalogue behind it.                          | Whatever is typed there is what a user sees. It is a human sentence, not a dump.  |
| A measurement is a label, a decimal string and a unit.                                            | It renders as "Brake pad thickness — 3.2 mm", never as a controller frame.        |
| Evidence is a document version, not an inline blob.                                               | A raw log, if a workshop ever attaches one, is a file behind a download authorisation, not screen content. |

The rule for any future work: if a raw payload ever has to be stored, it is
stored as an **attachment** behind the document contracts of §8, and it is
reachable only by a caller who deliberately downloads it. It is never rendered
inline on an operational screen.

### 3.6 Safe evidence for a scan

`POST /inspections/{inspectionId}/evidence`, permission `dia.diagnostic.record`.

| rule                                                                                                                        | source                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Evidence binds an exact document **version**, never a document and never a storage key.                                     | `dia.diagnostic_evidence`, `DiagnosticReportService.recordEvidence`        |
| A version whose scan state is `rejected` or `quarantined` is refused with `ERR-DOC-001`.                                     | `EVIDENCE_REFUSED_STATES` in the diagnostics service                       |
| Evidence is append-only. There is no substitution and no delete.                                                            | migration `20260722103000_dia_findings_measurements_evidence.sql`          |
| Evidence may only be added while the report still accepts entries (`draft` or `in_progress`).                               | `assertRecordable`                                                         |

The upload path itself is described in §8, and **P1-OD-025 (media upload policy)
is an open Owner decision that binds it**.

**One correction that must not be glossed over.** The evidence *route* exists,
but a photograph cannot in fact be attached today, and no planning may assume it
can. Two separate things stop it, and both are in this repository:

| what stops it                                                                                  | where                                                                              |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| No document category is seeded. `AttachmentService` refuses with `ERR-RES-001` — "Document category not found or disabled" — for every caller, so an upload authorisation never gets past its first check. | `shared.document_categories` is created by migration and by no seed in `supabase/seeds/`; `attachment-service.ts` |
| No object store is configured. `STORAGE_PROVIDER` defaults to `unconfigured`, and `UnconfiguredStorageProvider` refuses to sign anything with `ERR-SYS-001`. | `backend-config.ts`, `provider/storage-provider.ts`                                 |

So the honest statement everywhere below is: **the evidence contract exists; the
file path behind it does not work yet.** This is recorded as `INS-18`, and it is
bound by `P1-OD-025`, which owns the category set, the accepted types and the
size ceilings that a seed would have to carry.

### 3.7 Summary of Stage A against the contracts

| the stage needs                        | contract                                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| Open an inspection on a job            | Exists — `POST /jobs/{jobId}/inspections`                       |
| Record a fault code                    | Exists — `POST /inspections/{id}/dtcs`                          |
| Record a live reading                  | Exists — `POST /inspections/{id}/measurements`                  |
| Record what the technician concluded   | Exists — `POST /inspections/{id}/findings`                      |
| Attach a photograph or printout        | Route exists — `POST /inspections/{id}/evidence` — but no file can reach it: **`INS-18`**, bound by P1-OD-025 |
| Record the device and test used        | **Contract absent — `INS-01`**                                  |
| Separate historical codes              | **Contract absent — `INS-02`**                                  |
| Explain a code in plain language       | **Contract absent — `INS-03`**                                  |

---

## 4. Stage B — road test

### 4.1 What the stage is, and its precondition

A member of staff drives the vehicle in order to reproduce or rule out a
reported symptom. **The stage is conditional on the vehicle being safe to
drive.** A vehicle with no brakes, a seized component, a critical leak or no
valid road licence is not road-tested, and the reason it was not road-tested is
itself part of the record.

Judging roadworthiness is a human decision made by qualified staff. No contract
in this platform makes it, and none should be invented that appears to make it
automatically.

### 4.2 Duration

The Owner brief describes a typical road test as lasting roughly **five minutes
to one hour**. That range is a planning expectation about how staff work. It is
**not** a service-level commitment, it is not enforced anywhere, and no contract
measures it.

| question                                              | answer                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Does any contract cap a road test's length?           | No.                                                                                              |
| Does any contract warn when one runs long?            | No.                                                                                              |
| What is the platform's typical measured road-test duration? | **Not established.** Establishing it requires road tests to be recorded as their own record (`INS-04`) and a period of real operation to measure. |

### 4.3 Recording the employee and the start and end time

The nearest existing contract is the **labour session**, and its limits must be
understood before it is planned against.

| operation                                        | permission          | what it does                                                        |
| ------------------------------------------------ | ------------------- | -------------------------------------------------------------------- |
| `POST /jobs/{jobId}/labor-sessions`              | `tech.labor.record` | Starts a session for one technician profile on one job.             |
| `POST /labor-sessions/{sessionId}/stop`          | `tech.labor.record` | Ends it.                                                            |
| `POST /labor-sessions/{sessionId}/corrections`   | `tech.labor.correct` | Records a linked correction. Never rewrites the original.           |
| `GET /jobs/{jobId}/labor-sessions`               | `tech.technician.read` | Reads the job's labour log, corrections included.                |

The rules that a road-test design must respect:

| rule                                                                                                                | source                                          |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Starting and stopping accept no time from the caller.** There is no `startedAt` in the start body; `started_at` is the column default — the server clock — and `tech.guard_labor_session` enforces a backdating window. | `tech/labor-sessions` route header, `tech.guard_labor_session` |
| **A correction is the one place an explicit window is legal**, and it is a separate operation behind the separate `tech.labor.correct` permission. Its body requires `startedAt`, `endedAt` and a reason, all three. | `labor-sessions/{sessionId}/corrections` route body |
| `ended_at` is write-once. Once set it may never change; a mistake is fixed by a linked correction, not an edit.      | `tech.guard_labor_session`                      |
| At most one open session per technician, and no overlapping sessions, enforced by a `gist EXCLUDE`.                  | `ex_labor_sessions_overlap`                     |
| A labour session belongs to a **job**, not to a road test. There is no session type and no road-test flag.           | `tech.labor_sessions` columns                   |
| Pause and resume are not operations. A pause is: stop the session, then transition the job.                          | `tech/labor-sessions` route header              |

The consequence is direct and must not be glossed over: **starting a labour
session records that a technician worked on a job for a period. It does not
record that a road test happened.** The two are different facts, and today only
the first has a contract. See `INS-04`.

### 4.4 Observations from a road test

Observations have the same contracts as any other inspection entry.

| observation                                    | contract                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A checklist answer ("road test performed: yes") | `PUT /inspections/{id}/items/{templateItemId}` — `boolean` items accept only `true` or `false` |
| A measured value taken while driving           | `POST /inspections/{id}/measurements` — decimal **string**, unit required                    |
| A conclusion with severity                     | `POST /inspections/{id}/findings`                                                            |
| A photograph or a video                        | `POST /inspections/{id}/evidence`                                                            |

Two measurement rules bind every screen that would show a road-test reading:

- **The value crosses as a decimal string and stays a string.**
  `dia.measurements.measured_value` is bare `numeric` — no precision, no scale —
  and is compared inside the database. It is never a JavaScript number.
- **An out-of-range reading is recorded, never refused.** `within_range` is a
  three-valued flag: `true` in specification, `false` out of specification,
  `null` **no range was configured**. It is never flattened to `false`, because
  `false` would assert a check that never ran. A diagnostic exists to record what
  is wrong with a vehicle, so refusing the observation would make the worst cases
  unreportable.

### 4.5 The unsafe-to-test outcome

**Contract absent.** A diagnostic report's status vocabulary is exactly `draft`,
`in_progress`, `completed`, `cancelled` (`ck_diagnostic_reports_status`). There
is no "not performed", no "unsafe", and no reason code for either.

The nearest honest contract that exists is the **documented not-applicable
reason** on a checklist item:

- `PUT /inspections/{id}/items/{templateItemId}` accepts either a value or a
  `notApplicableReason`.
- `ck_report_item_results_answered` demands one of the two — never neither.
- `assertNotApplicableReason` refuses a blank reason and caps it at 500
  characters (`MAX_NOT_APPLICABLE_REASON`).
- The completion gate counts a documented reason as an answer and an absent row
  as nothing, so **skipping is always on the record**.

That is a workable mechanism for "the road test was not carried out because the
vehicle is not safe to drive", and it has one real weakness that planning must
acknowledge: the reason is free text on one checklist item. It is not a coded
outcome, it cannot be counted, and it cannot be reported on. See `INS-05`.

### 4.6 Odometer readings around a road test

`POST /vehicles/{vehicleId}/odometer-readings`, permission
`veh.vehicle.odometer.record`, scope `tenant`.

| field            | rule                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `value`          | The column is `numeric(12, 1)` and must be `>= 0`. It is **read back** as a decimal string (the query casts `value::text`), but it is **written as a JSON number** — the request body declares `value` as a number and the domain normalises it as one. That divergence is real and is recorded as `INS-19`. |
| `unit`           | `km` or `mi` only (`ck_odometer_readings_unit`). Units are stored verbatim and never converted. |
| `value_km`       | Generated by the database from value and unit. Not supplied by a caller. Returned as a string. |
| `capture_method` | The column admits `reception`, `delivery`, `manual`, `correction` (`ck_odometer_readings_capture`). The write contract offers only the first three; `correction` is derived from the presence of a corrected reading, never chosen. |
| `correction_of`  | A correction references the reading it corrects and carries a reason from a closed list — `lower_than_prior`, `possible_rollover`, `meter_replacement`, `data_entry_correction`, `unknown`. Originals are not edited. |
| `anomaly_flag`   | Not a free flag the platform sets at its discretion. `ck_odometer_readings_correction_meta` forces it `true` on a correction and `false` on every normal reading. |

**A backwards reading is refused, not flagged.** `veh.guard_odometer_reading()`
rejects a normal reading that falls below the vehicle's current effective
odometer; lowering a reading is only possible as an explicit, reasoned
correction. Any screen that treats a low reading as "recorded with a warning"
would be describing behaviour the platform does not have.

**There is no `road_test` capture method.** A reading taken before or after a
road test would have to be recorded as `manual`, which loses the reason it was
taken. See `INS-06`.

### 4.7 Summary of Stage B against the contracts

| the stage needs                              | contract                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| Record who drove                             | Partially — `tech.labor_sessions.technician_profile_id`, but on a job, not a test |
| Record start and end                         | Partially — server-stamped, on a job, not a test                            |
| Record observations                          | Exists — items, measurements, findings                                      |
| Attach evidence                              | Route exists; no file can reach it — **`INS-18`**, bound by P1-OD-025       |
| Record a road test as its own event          | **Contract absent — `INS-04`**                                              |
| Record an unsafe-to-test outcome as a coded value | **Contract absent — `INS-05`**                                          |
| Mark an odometer reading as taken for a road test | **Contract absent — `INS-06`**                                          |

---

## 5. Stage C — lift inspection

### 5.1 What the stage is

The vehicle is raised so that staff can see the underside, the suspension, the
exhaust, the brake components and anything that cannot be seen from the ground.
The output is a set of visual and mechanical observations, each with a severity,
and — where the workshop's rules allow it — a recommendation.

### 5.2 There is no concept of a lift

**Contract absent.** Nothing in the schema or the API models a lift, a hoist, a
bay, a ramp or a workshop position. Searching the migrations for those terms
returns only unrelated matches in the CRM schema.

The practical consequence: a lift inspection is distinguishable from any other
inspection **only by the inspection sheet the workshop chose to open**. That is
workable, but it depends entirely on template management, which itself has no
HTTP surface (finding `INS-09`). See `INS-07`.

### 5.3 Observations and severity

`POST /inspections/{inspectionId}/findings`, permission `dia.diagnostic.record`.

| field              | vocabulary                                                                             | source                          |
| ------------------ | --------------------------------------------------------------------------------------- | ------------------------------- |
| `severity`         | `info`, `low`, `medium`, `high`, `critical` — least to most severe                     | `ck_findings_severity`          |
| `disposition`      | `monitor`, `repair_recommended`, `repair_required`, `no_action`                        | `ck_findings_disposition`       |
| `description`      | Required, not blank, at most 2000 characters (`MAX_FINDING_DESCRIPTION`)               | `ck_findings_description_not_blank` |
| `templateItemId`   | Optional. When supplied, the item must belong to this report's **pinned** version.     | `DiagnosticReportService.recordFinding` |

**`disposition` is not an approval.** `repair_required` is a technician's
professional judgement about the vehicle. It authorises nothing, charges nothing
and commits the customer to nothing. §9 sets out what an approval actually is and
what it costs to obtain one.

### 5.4 Recommendations

`POST /inspections/{inspectionId}/recommendations`, permission
`dia.diagnostic.record`. Priority is `low`, `medium` or `high`
(`ck_recommendations_priority`), and defaults to `medium`.

One structural limitation must be planned around rather than designed away:
**a recommendation cannot be linked to the finding that prompted it.**
`dia.recommendations` carries only `diagnostic_report_id`. There is no
`finding_id` column anywhere in the schema. A screen can show a report's findings
and a report's recommendations side by side; it cannot truthfully draw a line
between one and the other. See `INS-08`.

The provenance chain that *does* exist runs the other way, and §9 uses it:
`wo.additional_work_requests.originating_finding_id` links a request for extra
work back to the finding that discovered it.

### 5.5 Evidence and severity thresholds

Evidence is identical to §3.6. A severity comparison helper exists in the
diagnostics domain (`severityAtLeast`), so a rule such as "every finding at
`high` or above requires a photograph" is expressible — but **no such rule is
configured anywhere today**, and no column stores a threshold. Any threshold a
workshop wants is a decision that has to be taken, not a setting that exists.

### 5.6 Summary of Stage C against the contracts

| the stage needs                          | contract                                              |
| ---------------------------------------- | ------------------------------------------------------ |
| Record a visual or mechanical observation | Exists — `POST /inspections/{id}/findings`            |
| Grade it                                 | Exists — five severities, four dispositions           |
| Attach evidence                          | Route exists; no file can reach it — **`INS-18`**     |
| Record advice to the customer            | Exists — `POST /inspections/{id}/recommendations`     |
| Link the advice to the observation       | **Contract absent — `INS-08`**                        |
| Record which lift or bay was used        | **Contract absent — `INS-07`**                        |
| Require evidence above a severity        | **Not established** — no threshold is configured anywhere |

---

## 6. Stage D — reception final review

### 6.1 What the stage is

Before the vehicle is committed to work, a senior member of reception staff
consolidates everything known about it into one view and confirms that the
picture is coherent. Six inputs:

1. what the customer said was wrong;
2. what the diagnostic scan found;
3. what the road test showed;
4. what the lift inspection showed;
5. visible damage recorded at arrival;
6. reception's own notes.

### 6.2 Where each input lives today

| input                     | record                                                                        | write contract                                                | read contract                                          |
| ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| Customer concerns         | `rec.complaints` + `rec.complaint_details`                                    | `POST /receptions/{id}/condition-evidence` with `kind: complaint` | **None**                                              |
| Scan findings             | `dia.dtc_records`, `dia.findings`, `dia.measurements`                         | the Stage A routes                                             | `GET /inspections/{inspectionId}`                      |
| Road-test observations    | the same diagnostic tables                                                    | the Stage B routes                                             | `GET /inspections/{inspectionId}`                      |
| Lift observations         | the same diagnostic tables                                                    | the Stage C routes                                             | `GET /inspections/{inspectionId}`                      |
| Visible damage at arrival | `rec.visual_inspections`, `rec.condition_items`, `rec.damage_maps`, `rec.damage_marks` | `POST /receptions/{id}/condition-evidence`             | **None**                                              |
| Warning lights and leaks  | `rec.warning_light_observations`, `rec.leak_observations`                     | `POST /receptions/{id}/condition-evidence`                     | **None**                                              |
| Customer property left in the vehicle | `rec.vehicle_contents`, `rec.vehicle_content_details`             | `POST /receptions/{id}/condition-evidence`                     | **None**                                              |
| Reception notes           | `shared.notes` — polymorphic on `(entity_type, entity_id)`                    | `POST /customers/{customerId}/notes` writes a note **against the customer**, not against a visit | **None for a visit.** `GET /customers/{customerId}/notes` pins `entity_type` to the customer record, so it cannot return a note recorded against a reception visit. See `INS-10`. |

### 6.3 The blocking problem

**Reception publishes twelve operations and none of them is a read.** Eight
`rec.*` operations and four `apt.*` operations, all of them `POST`. There is no
`apt.*.read` and no `rec.*.read` permission code in the catalogue. Against the
appointment block the catalogue seed records the omission as deliberate — no read
code is registered because no read operation is exposed, and an unused permission
is configuration that cannot be tested. The reception block carries no such note;
its read codes are simply absent.

The consequence for this stage is total, and it is the single most important
planning fact in this document:

> **A reception final review cannot be built today. Only its diagnostic inputs
> can be read back. Everything the reception side holds — the customer's
> concerns, the arrival damage record, the warning lights and leaks, the
> customer's property, and reception's own notes on the visit — has no published
> read operation at all.**

This is recorded as `INS-10`. It is a backend gap owned by Phase 1-18, not a
Frontend gap, and no Frontend phase can work around it. Building the screen
against writes alone would produce a review that consolidates nothing.

### 6.4 What a review record would need, and does not have

Even with reads in place, the review itself has no home:

| the review needs                                   | contract                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| A record that a review took place                  | **Contract absent — `INS-17`.** `dia.diagnostic_reviews` reviews one diagnostic report, not a visit. |
| A reviewer, stamped not claimed                    | The pattern exists for diagnostics (`dia.stamp_review()` overwrites the reviewer with the authenticated user) and would have to be repeated. |
| A link from a verified finding to the customer concern it answers | **Contract absent — `INS-16`.** No column joins `dia.findings` to `rec.complaints`. |
| Separation of duties                               | Partially. `assertReviewerSeparation` refuses a review by the report's **creator** only — not by everyone who recorded an entry, because the schema records no per-entry authorship the review could be checked against. That limit is documented in the module and must not be overstated. |

### 6.5 Summary of Stage D against the contracts

| the stage needs                     | contract                                          |
| ----------------------------------- | -------------------------------------------------- |
| Read the diagnostic side            | Exists — `GET /inspections/{inspectionId}`         |
| Read the customer's concerns        | **Contract absent — `INS-10`**                     |
| Read the arrival damage record      | **Contract absent — `INS-10`**                     |
| Read reception's own notes on the visit | **Contract absent — `INS-10`.** The customer note read is keyed to the customer record, not to a visit. |
| Record the review itself            | **Contract absent — `INS-17`**                     |
| Tie a verified finding to a concern | **Contract absent — `INS-16`**                     |

---

## 7. Customer-reported concerns are captured separately

This section is the reason the document exists. Everything in it is a rule, and
the rules survive any change of design.

### 7.1 The rule

**What the customer reports and what the workshop verifies are two different
kinds of fact, and they are recorded in two different places. Neither is ever
converted into the other.**

Two labels are mandatory wherever a customer-reported concern appears:

| label                            | meaning                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Customer-reported concern**    | This is what the customer said. It is their account, recorded faithfully.                      |
| **Not yet technically verified** | No member of staff has confirmed this by inspection, measurement or test.                      |

The second label is removed only when a technical record exists that verifies the
concern — and even then the customer's original words remain on file, unaltered,
alongside the verification.

### 7.2 The separation already exists in the contracts

This is not a new idea being proposed. The backend was built this way and says
so:

> "A complaint is what the customer reported. An inspection finding is what staff
> observed. They are separate tables for that reason and this module never
> promotes one into the other."
> — `apps/api/src/modules/reception/domain/reception-evidence.ts`

| what the customer said                             | what staff observed                                          |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `rec.complaints` (safe metadata)                    | `rec.condition_items` (arrival) / `dia.findings` (workshop)   |
| `rec.complaint_details` (the words, restricted)     | `dia.measurements`, `dia.dtc_records`                         |
| Category from a closed list, severity from a closed list | Severity and disposition from their own closed lists      |
| `reported_by_partner_id` — a customer or their agent | `created_by` — a member of staff                             |

The reception module also states what it deliberately does not model: **who
caused a damage mark, when it happened, any insurance or liability judgement, any
repair cost, and any diagnosis.** A concern is not a diagnosis, and the platform
does not let it become one by accident.

### 7.3 The concern contract, exactly

`POST /receptions/{receptionId}/condition-evidence` with `kind: 'complaint'`,
permission `rec.reception.evidence.manage`, scope `branch`.

| field                    | rule                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `category`               | `mechanical`, `electrical`, `body`, `noise`, `performance`, `other` — `ck_complaints_category`          |
| `severity`               | `low`, `medium`, `high`, `critical` — `ck_complaints_severity`, defaults to `medium`                    |
| `complaintText`          | Required, 1 to 4000 characters (`MAX_COMPLAINT_TEXT`). Stored in `rec.complaint_details`, **restricted**. |
| `reportedByPartnerId`    | Optional. Names the customer or agent who reported it.                                                  |
| `evidenceDocumentId`     | Optional. A document, not a payload.                                                                    |

Three properties of that contract are load-bearing:

1. **The customer's own words are protected.** `rec.complaint_details` requires
   `iam.has_permission('iam.sensitive.view')` on select, insert **and** update.
   For a caller without it the row does not exist. The classification column is
   fixed to `restricted` and is immutable. A plain read of the complaint table
   never exposes what the customer said, because a customer's account of a
   problem can carry personal circumstances that are none of the workshop's
   business.
2. **Corrections are linked, never silent.** `rec.complaints.correction_of`
   references the complaint being corrected, and
   `ck_complaints_not_self_correction` refuses a row from correcting itself. The
   original text stays. A record of what the customer said cannot be quietly
   rewritten later.
3. **The reception visit, category and severity of a written row are frozen.**
   `tg_complaints_immutable` guards `tenant_id`, `company_id`, `branch_id`,
   `reception_visit_id`, `created_at` and `created_by`.

### 7.4 Why the separation matters — four reasons

**Legal.** A concern is the customer's statement. A finding is the workshop's
professional assertion about a vehicle. If the two are merged, the workshop has
put its name to a technical claim it never made, and it will be held to that
claim in any dispute, warranty argument or insurance matter. The platform's
restricted-narrative design exists precisely so that the customer's statement
stays the customer's statement.

**Technical.** A concern is frequently wrong about the cause and right about the
symptom. "The gearbox is slipping" is very often a worn clutch, a fluid level or
an engine misfire. If the concern is filed as a finding, the diagnostic process
starts from a conclusion instead of from an observation — which is the fastest
way to fit the wrong part.

**Auditability.** Every write in these tables is stamped with `created_by` and
`created_at`, and the audit trail records what was written. The value of that
trail collapses if a row cannot be traced to a person who is authorised to make
that kind of statement. Merging the two would produce a trail in which the
workshop appears to have found things it was merely told.

**Customer communication.** A customer who is told "you reported a noise; we
have not yet been able to reproduce it" is being dealt with honestly. A customer
who is told "there is a fault with your suspension" when nobody has looked has
been misled, and the workshop has created an expectation it may not be able to
meet. The distinction also protects the workshop when the concern turns out to be
unreproducible, which is a normal and frequent outcome.

### 7.5 Four worked examples

| the customer says                              | concern category | recorded as                                       | verification would produce                                                  | must never be recorded as                                    |
| ----------------------------------------------- | ---------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| "There is a knocking noise over bumps."        | `noise`          | A concern, labelled *not yet technically verified* | A lift inspection finding with a severity and a described component            | A suspension fault, before anyone has raised the vehicle     |
| "The engine warning light is on."              | `electrical`     | A concern; the lamp itself may also be recorded at arrival as a warning-light observation | A fault code recorded from the vehicle, with a status of `active`, `pending`, `stored` or `cleared` | A named fault. The reception module states explicitly that which fault a lamp indicates is diagnosis, and diagnosis belongs to a technician, not to intake |
| "It has lost power on hills."                  | `performance`    | A concern, labelled *not yet technically verified* | A road-test observation, a measurement, or a finding — or a documented failure to reproduce | A confirmed engine defect on the strength of the description |
| "The air conditioning is not cold."            | `mechanical` or `electrical` — chosen by the person recording it, from the closed list | A concern | A measurement with a unit, or a finding                                       | A refrigerant or compressor fault before anything was measured |

Note the honest awkwardness in the fourth row: the closed category list has no
climate or comfort value. The person recording it must pick from
`mechanical`, `electrical`, `body`, `noise`, `performance` or `other`, and
different staff will pick differently. That is a real limitation of the frozen
vocabulary, and it is written down here rather than papered over.

### 7.6 A warning light observed at arrival is not a fault code

These two records look similar and are not:

| arrival observation                                                     | diagnostic fault code                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `rec.warning_light_observations`                                        | `dia.dtc_records`                                            |
| A governed lamp code from `rec.warning_light_codes`; archived codes cannot be newly selected | An OBD-II code matching `^[PBCU][0-9][0-9A-F]{3}$`      |
| State is `on`, `flashing` or `intermittent`                             | Status is `active`, `pending`, `stored` or `cleared`         |
| Recorded by reception, at the vehicle, without equipment                 | Read from the vehicle's own computers with equipment         |
| One observation per visit per lamp (`uq_warning_light_observations_active`) | Many codes per report                                     |

A screen must never present the first as though it were the second.

### 7.7 The labels have nowhere to appear yet

The separation is enforced in the database and honoured by the write API. It is
**invisible**, because no read operation returns a concern (§6.3). A screen
cannot display a label on data it cannot fetch.

There is a second, subtler gap. `rec.complaints` carries no flag saying whether a
restricted narrative exists. So a service advisor without `iam.sensitive.view`
would see a category and a severity, with no way to know whether there is text
behind it. The additional-work module faced the same question and answered it
deliberately — a flag computed from what the caller may see would read `false`
because of the reader's permissions rather than because of the data, which is
worse than no flag. The same reasoning applies here, and it means any future
screen must be explicit that it is showing a summary, not a complete record. See
`INS-12`.

---

## 8. Evidence, photographs and files

Every stage above can attach evidence, and every stage attaches it the same way.

| rule                                                                                                                | consequence for a screen                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **The API never accepts file bytes.** `POST /attachments/upload-authorizations` mints an authorisation and the bytes go to a storage provider. | Upload is a two-step flow, not a form post.                                       |
| A version is registered afterwards — `POST /attachments/versions`.                                                  | A file is not evidence until its version exists.                                   |
| A `rejected` or `quarantined` version is refused as evidence.                                                        | A refusal here is a safety outcome, not an error to retry.                          |
| Reading a document uses `shared.document.manage` — a **write** code. There is no `shared.document.read`.             | A caller who may only look at photographs must be granted a permission that also lets them create document metadata. This is a real over-grant and should be raised. |
| Download is itself authorised — `POST /attachments/documents/{documentId}/download-authorizations`.                  | Nothing is served inline by accident.                                              |
| There is no document list or search. The only reads are one document by id and the vehicle-scoped list.             | A gallery of a visit's photographs cannot be assembled today.                       |

**P1-OD-025 (media upload policy) is an open Owner decision and binds every one
of these rows.** Until it is decided, no phase may settle file-size limits,
accepted formats, retention periods, virus-scanning expectations or who may
download evidence. Nothing in this document assumes any of those values, and
none of them is established.

---

## 9. An observation is never silently approved repair work

### 9.1 The rule

**Recording an observation must never, by itself, create chargeable work,
schedule a repair, reserve a part or commit a customer to anything.** A finding
of `repair_required` is a technician's judgement. Turning that judgement into
work the customer will pay for is a separate act, performed by a different
person, under a different permission, with the customer's decision recorded.

### 9.2 The chain that exists

| step                          | operation                                                | permission                                             |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| A finding is recorded         | `POST /inspections/{id}/findings`                        | `dia.diagnostic.record`                                |
| Extra work is **requested**   | `POST /work-orders/{workOrderId}/additional-work`        | `wo.additional_work.request`                           |
| The customer-facing wording is written | `PUT /additional-work/{requestId}/detail`       | `wo.additional_work.request` **and** `iam.sensitive.view` |
| The customer's decision is **recorded** | `POST /additional-work/{requestId}/approval`    | `wo.additional_work.approve`                           |
| The work is marked done or waived | `POST /additional-work/{requestId}/fulfillment`      | `wo.additional_work.request`                           |
| The request is withdrawn      | `POST /additional-work/{requestId}/withdrawal`           | `wo.additional_work.request`                           |

### 9.3 The controls that make it real

| control                                                                                                                     | source                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **A request cannot be marked approved unless an approval row already exists.** `wo.guard_additional_work_state` refuses `state = 'approved'` otherwise. This is the forgery-resistance control. | `wo.guard_additional_work_state`                          |
| Both writes happen in one transaction, or neither happens.                                                                  | `AdditionalWorkService.decide`                            |
| The decision vocabulary is exactly `approved` and `rejected`. There is no "pending decision" — the absence of a row **is** the absence of a decision. | `ck_customer_approvals_decision`                   |
| The channel is recorded: `in_person`, `phone`, `email`, `sms`, `portal`, `other`.                                            | `ck_customer_approvals_channel`                           |
| `presentedScope` is a verbatim record of what the customer was actually shown, up to 4000 characters.                        | `MAX_PRESENTED_SCOPE`                                     |
| A decision is bound to the request **version** the advisor was looking at. A decision recorded against a request that has since changed is refused as a conflict. | `DecideInput.expectedVersion`                     |
| The decision time is stamped by the server and then frozen. A caller cannot supply it.                                       | `tg_customer_approvals_immutable`                         |
| The customer-facing description lives behind `iam.sensitive.view` at row level, for reading and for writing.                 | `wo.additional_work_request_details` policies             |
| Provenance is required: a request must name the job it arose on, the finding that discovered it, or both.                    | `RaiseRequestInput`, and the service's own rule           |
| A work order cannot close while a **required** request is pending or approved-but-unfulfilled.                              | closure blocker **B3**                                    |
| A work order cannot close while a job marked `requires_diagnostic` has no **completed** diagnostic report.                   | closure blocker **B4**                                    |

Requests move `pending → approved | rejected | withdrawn`, and all three targets
are terminal — `approved`, `rejected` and `withdrawn` have no outbound edge at
all.

### 9.4 What must never be built

| forbidden                                                                                  | why                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A control that converts a finding into approved work in one action                          | It would bypass `wo.additional_work.approve` and the approval row that `wo.guard_additional_work_state` demands |
| A default that pre-selects "approved"                                                       | A decision the customer did not make would be recorded as one they did                                |
| Treating `disposition = 'repair_required'` as an approval                                   | It is a technical judgement, in a different table, under a different permission                       |
| Recording an approval without `presentedScope`                                              | The record would not show what the customer agreed to                                                 |
| Pricing anything from an inspection screen                                                  | The additional-work service calculates no price, creates no quotation and touches no stock            |

On the last row: money is decimal strings with ISO 4217 currency codes
throughout, and the platform ships **no currency table and no jurisdiction
defaults**. A tenant's currency comes from `svc.price_lists.currency_code` and is
immutable once set. No inspection screen may introduce a price.

---

## 10. Rules that bind every screen in this area

| rule                                                                                                                       | detail                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Money is a decimal string plus an ISO currency code.** Never a JavaScript number.                                        | `Money.of(amount: string, currency: string)`                                                    |
| **`numeric` and `bigint` arrive as strings and stay strings.**                                                             | `dia.measurements.measured_value`, `veh.odometer_readings.value`                                 |
| **Lists are keyset paginated: `{ items, nextCursor, hasMore }`. There is no `total`.**                                     | `apps/api/src/server/db/pagination.ts`. An extra row is fetched to detect `hasMore` without a second COUNT. |
| Therefore there is no page count and no "page 4 of 37".                                                                    | Previous and Next only.                                                                          |
| `GET /jobs/{jobId}/inspections` returns `{ items }` with **no cursor at all** — it is not paginated.                       | `dia.diagnostic-list` route                                                                      |
| A status change on a report requires `If-Match`.                                                                            | `dia.diagnostic-transition` and `dia.diagnostic-complete` are `versionGuarded`                   |
| A completed report accepts no further entries. This is an **application** rule; the database does not enforce it.          | `assertRecordable` — the child tables reference the report and never consult its status          |
| A report may not be created, changed or completed once its work order has reached a terminal state.                        | `assertParentAcceptsWork`                                                                        |
| A report may only be opened from a **published** template version. Draft and retired are both refused, distinguishably.    | `assertVersionInstantiable`, `dia.guard_diagnostic_report_refs`                                  |
| A published version's questions are frozen for ever, including against soft-delete.                                        | `dia.guard_template_item_frozen`                                                                 |
| A report cannot be completed while a mandatory question is unanswered, and the refusal names **every** outstanding item, not the first. | `assertCompletable`, error `ERR-DIA-001`                                              |
| A report cannot be reviewed by the person who created it — but the check compares the report's **creator** only, not everyone who recorded an entry. | `assertReviewerSeparation`                                             |
| A review may only be recorded on a **completed** report.                                                                    | `DiagnosticReportService.review`                                                                 |
| The reviewer's identity is stamped by the database, not claimed by the request.                                             | `dia.stamp_review()`                                                                             |
| Every diagnostic operation is `scope: 'branch'`. Every vehicle and document operation is `scope: 'tenant'`.                 | the operation registry                                                                           |

---

## 11. Integration findings

These are contracts this document needed and could not find. Each is a real gap,
not a design preference. Identifiers are local to this document; a finding that
is taken up for work should be issued a `P1-27-INT-###` number by
`docs/phase-1/phase-1-27/findings.md` at that time, so that this document never
invents a number that register has already used.

**None of these is P1-27 work.** P1-27 is a CRM and Vehicle Frontend phase and
owns no inspection or diagnostics scope.

| finding      | what is missing                                                                                                                                                          | owning Backend phase                          | owning Frontend phase                                     | required action                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **`INS-01`** | No record of the diagnostic device, tool, software version or test procedure used for a scan. No column, no route.                                                        | P1-09 (schema), P1-19 (application)           | A Diagnostics Frontend phase — **not yet scheduled**       | Owner decides whether device provenance is required. If yes, a migration adds it; no Phase 1 phase currently owns that scope.        |
| **`INS-02`** | No `historical` fault-code status. `ck_dtc_records_status` is exactly `active`, `pending`, `stored`, `cleared`.                                                          | P1-09 (schema)                                | A Diagnostics Frontend phase                               | Decide whether "historical" means a prior report's code or a fifth status. Only the second needs a migration; the first needs `INS-13`. |
| **`INS-03`** | No fault-code catalogue. `description` is free text and nullable, so a code cannot be explained in plain language from platform data.                                     | P1-09 (schema)                                | A Diagnostics Frontend phase                               | **Recommend an evaluation** of licensed fault-code data sources. Purchasing or contracting one is a commercial decision reserved to the Product Owner. |
| **`INS-04`** | No road-test record. Nothing models a road test, its driver, its route, its duration or its outcome. `tech.labor_sessions` records time on a **job**.                     | P1-09 (schema), P1-19 (application)           | A Diagnostics Frontend phase                               | Decide whether a road test is a first-class record or a checklist item on an inspection sheet. The first needs a migration.          |
| **`INS-05`** | No coded "not performed — unsafe to test" outcome. The report vocabulary offers only `cancelled`, which means something else.                                             | P1-09 (schema)                                | A Diagnostics Frontend phase                               | Decide whether an uncarried-out test needs a countable outcome. Until then the only honest mechanism is a documented not-applicable reason. |
| **`INS-06`** | `veh.odometer_readings.capture_method` has no road-test value: `reception`, `delivery`, `manual`, `correction`.                                                          | P1-07 (schema), P1-17 (application)           | A Vehicle or Diagnostics Frontend phase                    | Decide whether readings taken for a test must be distinguishable. If yes, the CHECK must be extended by migration.                   |
| **`INS-07`** | No lift, hoist, bay or ramp concept anywhere in the platform.                                                                                                            | P1-09 (schema)                                | A Diagnostics Frontend phase                               | Decide whether workshop position is required. If not, record that a lift inspection is identified only by its inspection sheet.      |
| **`INS-08`** | A recommendation cannot be linked to the finding that prompted it. `dia.recommendations` carries only `diagnostic_report_id`; no `finding_id` exists anywhere.            | P1-09 (schema)                                | A Diagnostics Frontend phase                               | Decide whether the link is required. It needs a migration. Already recorded as a reconciliation in the diagnostics service.          |
| **`INS-09`** | Inspection templates have **no HTTP surface and no permission code**. `dia.inspection_templates`, `dia.template_versions` and `dia.template_items` cannot be created, published or read over the API. | P1-19                    | A Diagnostics Frontend phase                               | Add template operations and a permission code. **Without this no workshop can create the Stage A, B, C sheets at all**, because a report may only pin a published version and nothing publishes one. |
| **`INS-10`** | Reception and Appointment publish **zero** read operations of twelve, and no `rec.*.read` or `apt.*.read` permission exists. Customer concerns, condition items, damage marks, warning lights, leaks and contents cannot be read back. | P1-18                  | A Reception Frontend phase — **not yet scheduled**        | Add read operations and read permission codes. Stage D is unbuildable until this is closed.                                          |
| **`INS-11`** | `rec.visit_reason_links` has no write surface. `POST /receptions` accepts a vehicle, an employee, a requester, an origin, an odometer reading, a fuel level and a state of charge — and no visit reason. | P1-18                | A Reception Frontend phase                                 | Decide whether the visit-reason catalogue is used. If yes, the create or evidence command must accept it.                           |
| **`INS-12`** | No flag says whether a restricted complaint narrative exists. A caller without `iam.sensitive.view` cannot tell a concern with no text from one they may not read.        | P1-18                                         | A Reception Frontend phase                                 | Decide whether an existence flag is acceptable. Note the additional-work module rejected a reader-dependent flag for good reasons.  |
| **`INS-13`** | No operation lists inspections for a vehicle or for a work order. `GET /jobs/{jobId}/inspections` is the only list, keyed by job, and it is unpaginated.                 | P1-19                                         | A Diagnostics Frontend phase                               | Add a vehicle-scoped or work-order-scoped inspection read, keyset paginated.                                                        |
| **`INS-14`** | Reviewer separation compares the report's **creator** only. A reviewer who recorded some of the results but did not create the report is not caught.                     | P1-09 (schema), P1-19 (application)           | A Diagnostics Frontend phase                               | Decide whether stronger separation is required. It needs per-entry authorship the schema does not currently record.                 |
| **`INS-15`** | Document reads are gated on `shared.document.manage`, a write code. There is no `shared.document.read`, and there is no document list or search.                          | P1-15                                         | Any phase showing evidence                                 | Add a read permission code and a scoped list. Until then, showing evidence over-grants document authority. **P1-OD-025 binds.**     |
| **`INS-16`** | No column links a verified finding to the customer concern it answers. `dia.findings` references its report; `rec.complaints` references its visit; nothing joins them.  | P1-09 / P1-08 (schema)                        | A Reception or Diagnostics Frontend phase                  | Decide whether concern-to-finding traceability is required. It needs a migration and touches two frozen schemas.                    |
| **`INS-17`** | No record type for a reception final review. `dia.diagnostic_reviews` reviews one diagnostic report, not a visit.                                                        | P1-08 / P1-09 (schema), P1-18 / P1-19 (application) | A Reception Frontend phase                            | Decide whether the review is a record or a procedure. If a record, it needs a table, a permission code and operations.              |

---

## 12. Open Owner decisions that bind this document

| decision       | subject                    | where it binds                                                                                                                                                     |
| -------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-OD-025**  | Media upload policy        | §3.6, §5.5, §8 and finding `INS-15`. Nothing about file sizes, formats, retention, scanning expectations or who may download evidence may be settled until it is decided. |
| **P1-OD-017**  | Duplicate and merge rules  | Indirectly but really. An inspection is attached to a vehicle through its work order, and merging two vehicle records moves that history. Until the merge rules are decided, no statement can be made about what happens to a completed inspection when its vehicle is merged into a survivor. |

Neither decision is worked around anywhere in this document, and neither has been
assumed to have any particular outcome.

---

## 13. What is not established, and what would establish it

| unknown                                                        | why it is unknown                                                         | what would establish it                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Typical road-test duration                                     | No road-test record exists (`INS-04`), so nothing has ever been measured  | Close `INS-04`, then measure over a period of real operation                                  |
| How many inspection sheets a workshop needs                    | Template management has no surface (`INS-09`) and no tenant has created one | Close `INS-09`, then observe pilot use                                                        |
| Whether a severity threshold should require photographic evidence | No threshold is configured anywhere and no column stores one            | An Owner decision, followed by a schema change                                                |
| The cost of licensed fault-code data                           | No provider has been evaluated and no quotation has been sought           | An evaluation, commissioned by the Product Owner. Any purchase is the Product Owner's decision alone. |
| How long inspection evidence must be retained                  | P1-OD-025 is open                                                          | The Owner's media-upload and retention decision                                               |
| What happens to inspections when two vehicles are merged       | P1-OD-017 is open                                                          | The Owner's duplicate and merge decision                                                      |

---

## 14. Sources

Every claim above traces to one of these, read on branch
`remediation/p1-27-owner-acceptance-ux`.

| area                                | files                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagnostic domain rules             | `apps/api/src/modules/diagnostics/domain/diagnostics.ts`                                                                                                       |
| Diagnostic behaviour                | `apps/api/src/modules/diagnostics/application/diagnostic-report-service.ts`, `.../diagnostics-completion-service.ts`                                            |
| Diagnostic routes                   | `apps/api/src/app/api/v1/jobs/[jobId]/inspections/route.ts`, `apps/api/src/app/api/v1/inspections/**/route.ts`                                                  |
| Reception evidence rules            | `apps/api/src/modules/reception/domain/reception-evidence.ts`                                                                                                  |
| Reception routes                    | `apps/api/src/app/api/v1/receptions/route.ts`, `.../[receptionId]/condition-evidence/route.ts`                                                                  |
| Additional work and approvals       | `apps/api/src/modules/work-order/application/additional-work-service.ts`, `apps/api/src/modules/work-order/domain/work-order.ts`                                |
| Labour sessions                     | `apps/api/src/app/api/v1/jobs/[jobId]/labor-sessions/route.ts`, `supabase/migrations/20260722099000_tech_labor_sessions.sql`                                    |
| Diagnostic schema                   | `supabase/migrations/20260722093000_dia_qms_catalogs.sql`, `...101000_dia_templates_versions_items.sql`, `...102000_dia_reports.sql`, `...103000_dia_findings_measurements_evidence.sql` |
| Reception schema                    | `supabase/migrations/20260721095000_rec_configuration_catalogs.sql`, `...099000_rec_complaints.sql`, `...100000_rec_inspections_conditions.sql`, `...102000_rec_warning_lights_leaks.sql` |
| Work-order schema and closure gate  | `supabase/migrations/20260722095000_wo_work_orders.sql`, `...097000_wo_jobs.sql`, `...105000_qms_rework_closure_gate.sql`                                       |
| Odometer schema                     | `supabase/migrations/20260720101000_veh_odometer_readings.sql`                                                                                                  |
| Permissions                         | `supabase/seeds/04_iam_permission_catalog.sql`                                                                                                                 |
| Pagination and money                | `apps/api/src/server/db/pagination.ts`, `apps/api/src/modules/pricing/domain/money.ts`                                                                          |
| Shared-UX contracts                 | `docs/adr/ADR-021-application-scroll-ownership-and-notification-authority.md`                                                                                   |
| Phase authority                     | `docs/phase-1/phase-1-27/canonical-plan.md`, `docs/phase-1/phase-1-27/findings.md`                                                                              |
