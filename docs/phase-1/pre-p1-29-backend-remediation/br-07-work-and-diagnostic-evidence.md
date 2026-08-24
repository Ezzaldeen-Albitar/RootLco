# BR-07 — Work and Diagnostic Evidence

|                      |                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Closes               | `BE-8` (evidence half) · findings `INS-28`, `INS-15` · Owner requirement 12 (`INT-093`…`095`) |
| Depends on           | **nothing**                                                                                   |
| Database change      | **one table**                                                                                 |
| New permission codes | **none**                                                                                      |
| Complexity           | **M**                                                                                         |

---

## 1. Problem statement

**A technician cannot attach a photograph to the work they did.** Evidence binding exists for
exactly two subjects — a diagnostic **report** and a customer **approval** — and for nothing else.
There is no job-level, assignment-level or work-order-level evidence anywhere.

Owner requirement 12 ("work evidence") is Blocked, and the technician workspace's honest content
limit includes _"attach a photo to my work — **no** at job level"_.

Separately, `INS-15`: diagnostic evidence is **report-level only** — `dia.diagnostic_evidence` has
no `template_item_id`, `finding_id` or `measurement_id`, so a photograph cannot be tied to the item
it evidences.

## 2. Existing repository evidence

### 2.1 A complete evidence chain already ships — do not build a second one

`apps/web/src/features/attachments/api.ts` documents the published chain:

| operation                            | path                                 | permission               |
| ------------------------------------ | ------------------------------------ | ------------------------ |
| `shared.document-category-list`      | `/attachments/categories`            | `shared.document.read`   |
| `shared.attachment-upload-authorize` | `/attachments/upload-authorizations` | `shared.document.manage` |
| `shared.attachment-version-register` | `/attachments/versions`              | `shared.document.manage` |
| `shared.attachment-link-create`      | `/attachments/documents/{id}/links`  | `shared.document.manage` |

Backed by a real object store — `apps/api/src/modules/shared-services/provider/s3-storage-provider.ts`,
`domain/storage-key.ts`, configured in `server/config/backend-config.ts`.

**The browser never PUTs to storage, and that is structural, not a preference.** The module's own
docblock records it: `contentSecurityPolicy` in `lib/security/csp.ts` is the only place
`connect-src` is assembled and admits `'self'`, the API origin, and optionally a diagnostics sink.
There is no parameter for a storage origin, so a browser upload to an object store is refused by
policy. **Admitting a third origin is a change to this product's security posture and is not this
slice's to make.**

### 2.2 The two existing evidence tables are field-identical

See [C-09](repository-corrections.md#c-09--the-two-evidence-tables-are-field-identical-so-br-07-has-a-template-not-a-decision).

|            | `dia.diagnostic_evidence` `20260722103000…:266-290`                       | `wo.customer_approval_evidence` `20260722100000…:417-441` |
| ---------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| scope key  | `tenant_id, company_id, branch_id` NOT NULL                               | same                                                      |
| parent     | composite FK, RESTRICT                                                    | same                                                      |
| binding    | `document_version_id → shared.document_versions (tenant_id, id)` RESTRICT | same                                                      |
| payload    | `evidence_type text NOT NULL`, `note text NULL`                           | same                                                      |
| metadata   | `created_at`, `created_by` **only**                                       | same                                                      |
| mutability | append-only, `SELECT` + `INSERT`                                          | same                                                      |
| indexes    | one on parent, one on version                                             | same                                                      |

Both `COMMENT`s carry the same sentence: _"Binds an EXACT immutable `shared.document_versions` row;
no substitution. SELECT+INSERT only."_

### 2.3 The scan lifecycle, and the rule both services already implement

`shared.document_versions` carries
`ck_document_versions_status CHECK (status IN ('pending','accepted','quarantined','rejected'))`
(`20260718101000…:81-82`) with terminal timestamps guarded per status (`:84+`).

**Both existing evidence writers refuse the same two states**, and the constant is identical in
both modules:

```ts
const EVIDENCE_REFUSED_STATES: readonly string[] = Object.freeze(['rejected', 'quarantined']);
```

`diagnostics/application/diagnostic-report-service.ts:153` and
`work-order/application/additional-work-service.ts:179`, each raising `ERR-DOC-001`
(`:828` and `:1057`).

**`pending` is permitted at bind time.** A version whose scan has not finished may be bound;
**download** is what `ERR-DOC-001` refuses (`attachment-service.ts:25`, `:706`). That asymmetry is
deliberate and this slice must reproduce it rather than tighten it — tightening would make evidence
capture fail intermittently on scan latency.

### 2.4 What is absent

- No evidence table parented on `wo.jobs`, `wo.job_assignments`, or `wo.work_orders`.
- No `template_item_id` / `finding_id` / `measurement_id` on `dia.diagnostic_evidence` (`INS-15`).
- `evidenceType` is **free text, 1..64, no vocabulary and no CHECK** on both existing tables.

## 3. Gap

| gap                                                                                | class                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| no job-level evidence table                                                        | **DB**                                                  |
| no operation binds evidence to a job                                               | **API**                                                 |
| diagnostic evidence cannot be tied to the item it evidences                        | **Domain model** — _not closed by this slice, see §4.4_ |
| `evidenceType` has no vocabulary, so whatever a UI offers becomes the de-facto one | **Validation**                                          |
| no read lists a work order's evidence across its jobs                              | **Contract**                                            |
| retention and deletion semantics for job evidence are undefined                    | **Audit**                                               |

## 4. Proposed architecture

### 4.1 One new table, transcribed from the twice-repeated pattern

`wo.job_evidence`, parented on `wo.jobs`, identical in shape to the two existing evidence tables.
This is a transcription, not a design — which is why a new table is proposed here with more
confidence than a new table normally warrants.

**Parented on the job, not the work order or the assignment:**

| candidate            | verdict                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`wo.jobs`**        | **selected** — Owner requirement 12 is about the work done, and work is done on a job. A job inherits its work order by parentage, so a work-order-level read is a join, not a second table. |
| `wo.work_orders`     | rejected — evidence would lose which piece of work it evidences, which is the whole point                                                                                                    |
| `wo.job_assignments` | rejected — evidence would vanish when an assignment ends, and work done by two successive technicians would split across two parents                                                         |

### 4.2 Binding is two steps and the UI owns the partial failure

Capture the document version through the existing chain, **then** bind it. Same discipline as the
composed actions in [`BR-06`](br-06-work-execution-controls.md) §4.2: a captured-but-unbound
document is an orphan the user cannot see, so the UI must either bind immediately or make the
orphan recoverable — and the recoverable state must be derivable from a re-read, so it survives a
page refresh.

**This slice does not collapse the two steps into one operation.** A single upload-and-bind would
have to hold `shared.document.manage` and the job's own authority in one declaration, widening one
of them, and it would put file bytes through a work-order route — duplicating a subsystem §2.1 says
must not be duplicated.

### 4.3 Reuse `EVIDENCE_REFUSED_STATES`, do not re-declare it

The constant is already duplicated across two modules. A third copy is the drift shape this
platform has been bitten by repeatedly. **Extract it to a shared location and have all three
consume it**, or — if extraction is out of scope for the slice — import it from
`shared-services` rather than re-typing the array. Either is acceptable; a third literal is not.

### 4.4 `INS-15` is explicitly NOT closed here, and the reason matters

Adding `template_item_id` / `finding_id` to `dia.diagnostic_evidence` would let a photograph be tied
to the item it evidences. It is not in this slice because:

- `dia.diagnostic_evidence` is **append-only** and already carries rows in tenants that have used
  diagnostics. Adding a nullable column is safe; **backfilling it is not possible**, so historical
  evidence would be permanently unattributed, and a UI showing per-item evidence would show it
  inconsistently.
- The diagnostics slice (P1-29-E) is blocked on [`BR-04`](br-04-inspection-diagnostic-template-authoring.md)
  anyway, so the requirement is not yet exercised by a real screen.

**Binding on P1-29's frontend, from the preparation and preserved here:** do **not** render evidence
inside an item row as though it were bound to that item. One report-level gallery. Rendering
otherwise is a false claim about the data.

Recorded as `BR-07-OPEN-01`, deferred with justification.

### 4.5 The `evidenceType` vocabulary is a decision this slice must force

Free text, 1..64, no CHECK, on both existing tables. **Whatever the UI offers becomes the de-facto
vocabulary**, and if nothing decides it the column fills with unqueryable prose in two languages.

This slice does **not** add a CHECK constraint — that would break the two shipped tables' contract
and is a schema change to append-only data. It instead:

- specifies a **recommended** vocabulary in the contract for the new table;
- requires the frontend to offer a translated picker with an "other" escape;
- records that the column remains free text and the vocabulary is a convention, not an invariant.

Claiming otherwise would be claiming a control that does not exist.

## 5. Database impact

```sql
CREATE TABLE wo.job_evidence (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  job_id              uuid    NOT NULL,
  document_version_id uuid    NOT NULL,
  evidence_type       text    NOT NULL,
  note                text    NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,

  CONSTRAINT pk_job_evidence PRIMARY KEY (id),
  CONSTRAINT uq_job_evidence_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_job_evidence_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_job_evidence_version
    FOREIGN KEY (tenant_id, document_version_id)
    REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_evidence_type_not_blank CHECK (btrim(evidence_type) <> ''),
  CONSTRAINT ck_job_evidence_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);
CREATE INDEX ix_job_evidence_job     ON wo.job_evidence (tenant_id, company_id, branch_id, job_id);
CREATE INDEX ix_job_evidence_version ON wo.job_evidence (tenant_id, document_version_id);
ALTER TABLE wo.job_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.job_evidence FORCE  ROW LEVEL SECURITY;
-- three scope policies matching wo.jobs
GRANT SELECT, INSERT ON wo.job_evidence TO app_runtime;   -- append-only: no UPDATE, no DELETE
GRANT SELECT          ON wo.job_evidence TO app_readonly;
```

| property             | value and why                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| append-only          | `SELECT` + `INSERT` only. No `record_version`, no `updated_*`, no `deleted_*` — matching both existing evidence tables exactly.                                                                                |
| **no soft delete**   | deliberate, and a consequence to state: **evidence cannot be unbound.** A mis-attached photograph is permanent. That is the same property the two shipped tables have, and the UI must warn before submitting. |
| RESTRICT on both FKs | matching the domain                                                                                                                                                                                            |
| two indexes          | one per FK; zero unindexed FKs is a measured property of these schemas                                                                                                                                         |
| RLS                  | enabled **and forced**                                                                                                                                                                                         |
| `COMMENT`            | must carry the same sentence as its two siblings: binds an exact immutable version, no substitution                                                                                                            |

**Rollback.** `DROP TABLE`, safe until the first row. After that the bound document versions
survive (they are `shared` rows), but the binding is lost and cannot be reconstructed. State the
closing window in the migration header.

`structuralTotals` moves; take the figure from CI.

## 6. API impact

Three operations.

| #   | id                            | method | route                                 | permission           |
| --- | ----------------------------- | ------ | ------------------------------------- | -------------------- |
| 1   | `wo.job-evidence-record`      | `POST` | `/jobs/{jobId}/evidence`              | `tech.labor.record`  |
| 2   | `wo.job-evidence-list`        | `GET`  | `/jobs/{jobId}/evidence`              | `wo.work_order.read` |
| 3   | `wo.work-order-evidence-list` | `GET`  | `/work-orders/{workOrderId}/evidence` | `wo.work_order.read` |

### 1 · `wo.job-evidence-record`

| field         | value                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------- |
| body          | `{documentVersionId: uuid, evidenceType: string(1..64), note?: string(1..1000)}` `.strict()` |
| success       | `201` · `JobEvidenceView`                                                                    |
| idempotency   | **yes** — a retry must not bind the same version twice                                       |
| version guard | no                                                                                           |
| scope         | `branch`, resolved from the job                                                              |

**The body is field-identical to `dia.diagnostic-evidence-record`'s**
(`{documentVersionId, evidenceType, note?}`), which the contract-mirror measurement already records
as colliding with the nested `Evidence` element in the approval route. That collision is now
three-way. A payload gate keyed on field-name+optionality will treat all three as one shape; a gate
keyed on full JSON Schema may not. `BR-08` must fix the keying rule explicitly.

### 2 · `wo.job-evidence-list`

`200` · `{items: JobEvidenceView[]}` — `ItemsOnly<T>`, unpaged, matching
`dia.diagnostic-evidence` list behaviour.

`JobEvidenceView` = `{id, jobId, documentVersionId, evidenceType, note, createdAt, createdBy}`.

**No storage key, no URL, no content.** A `documentVersionId` is a reference the attachments module
resolves under its own authorization; constructing a storage URL from it would make evidence
readable by reference (`T-09`).

### 3 · `wo.work-order-evidence-list`

`200` · `{items: (JobEvidenceView & {jobTitle: string})[]}`.

The join across a work order's jobs, so the work-order detail can show a gallery without one call
per job. **Not paged** — a work order's evidence is bounded by its job count in practice; if that
proves wrong it becomes a paged read in a later slice rather than a silently truncated one.

### Error cases

| condition                           | status | code                                                     |
| ----------------------------------- | ------ | -------------------------------------------------------- |
| version `rejected` or `quarantined` | 409    | `ERR-DOC-001`                                            |
| version belongs to another tenant   | 404    | `ERR-RES-001` — the FK would raise `23503`; refuse first |
| job not found or out of scope       | 404    | `ERR-RES-001`                                            |
| blank `evidenceType`                | 422    | `ERR-VAL-001`                                            |
| `Idempotency-Key` absent            | 400    | `ERR-INT-002`                                            |

## 7. Permission model

**Mint nothing.**

| operation         | code                 | justification                                                                                                                                                               |
| ----------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record            | `tech.labor.record`  | the technician evidences the labour they performed, in the same act, as the same person. Requiring `wo.job.manage` would mean a technician cannot photograph their own work |
| list (job)        | `wo.work_order.read` | evidence describes work, not a person — unlike an assignment or a labour session, which is why those need `tech.technician.read` (`T-05`)                                   |
| list (work order) | `wo.work_order.read` | as above                                                                                                                                                                    |

**Why not `shared.document.manage`.** That code governs the _document_ — uploading, versioning,
linking. Binding an existing version to a job is a work-order-domain act about a work-order-domain
subject. The precedent is exact: `dia.diagnostic-evidence-record` carries `dia.diagnostic.record`,
not `shared.document.manage`, and `wo.additional-work-approval` carries
`wo.additional_work.approve`. The document chain's authority is required to _create_ the version —
which the caller must already have done, in a separate call.

**The two-permission consequence, stated because a UI will hit it:** attaching evidence needs
`shared.document.manage` (to capture) **and** `tech.labor.record` (to bind). A caller holding one
and not the other gets a partial flow, and the screen must check both before offering the control —
the same rule `permission-matrix.md` §5 states for every composed action.

| actor               | capture                                 | bind                               | read    |
| ------------------- | --------------------------------------- | ---------------------------------- | ------- |
| technician          | yes if granted `shared.document.manage` | yes                                | yes     |
| workshop supervisor | typically yes                           | yes if granted `tech.labor.record` | yes     |
| service advisor     | maybe                                   | typically no                       | yes     |
| cross-tenant        | refused                                 | refused by the FK and by RLS       | refused |

## 8. Security requirements

| abuse case                                       | required behaviour                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **cross-tenant binding**                         | structurally impossible — `fk_job_evidence_version` is `(tenant_id, document_version_id)`; a cross-tenant pair does not exist. Same guarantee both shipped evidence tables have.                                                                                                        |
| **cross-branch**                                 | `fk_job_evidence_job` on the full composite; a branch-Y job cannot receive branch-X evidence                                                                                                                                                                                            |
| **evidence readable by reference (`T-09`)**      | the response carries `documentVersionId` and **no** storage key, URL, or bytes. Documents are fetched only through the attachments API. Never construct a storage URL; never cache a document body beyond the view that needs it.                                                       |
| **binding an unscanned malicious file**          | `rejected` and `quarantined` are refused with `ERR-DOC-001`, reusing `EVIDENCE_REFUSED_STATES`. `pending` is permitted at bind time and refused at **download** — reproduce this asymmetry, do not tighten it                                                                           |
| **IDOR**                                         | `jobId` and `documentVersionId` both resolve under RLS; out of scope is 404                                                                                                                                                                                                             |
| **forged foreign id**                            | a `documentVersionId` that exists in another tenant is 404, never 500 and never a raw `23503`                                                                                                                                                                                           |
| **mass assignment**                              | `.strict()`; `createdBy` is stamped from `iam.current_user_id()` and rejected if sent                                                                                                                                                                                                   |
| **free-text `evidenceType` and `note` (`T-08`)** | React escapes by default; `dangerouslySetInnerHTML` is forbidden tree-wide by the `unsafe-html` rule, which has **no `scope` field** and therefore covers the whole scanned tree. Never render either into a `title`/`aria-label` unescaped. Length capped server-side.                 |
| **PII in a note**                                | treat notes as operational text; the UI must not invite a customer's phone number into an evidence note                                                                                                                                                                                 |
| **race**                                         | two callers binding the same version to the same job — both succeed and produce two rows. **Not prevented**, and it should not be: the same photograph may legitimately evidence two things. The idempotency key prevents an accidental double-submit; it does not prevent two intents. |
| **irreversibility**                              | evidence cannot be unbound. The UI must confirm before submitting and must say the record is permanent.                                                                                                                                                                                 |

## 9. Validation

| concern                 | rule                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ids                     | `schemas.uuid`                                                                                                                                    |
| enums                   | none — `evidenceType` is free text by schema (§4.5)                                                                                               |
| lengths                 | `evidenceType` 1..64 mirroring the shipped columns; `note` 1..1000, non-blank when present                                                        |
| **version state**       | must not be in `EVIDENCE_REFUSED_STATES`; **imported, not re-declared** (§4.3)                                                                    |
| timestamps              | none in the body — `created_at` is server-set                                                                                                     |
| state compatibility     | evidence may be bound in **any** job state, including terminal. A technician evidencing finished work is normal; refusing it would lose evidence. |
| duplicate prevention    | idempotency key only; deliberate duplicates are permitted (§8)                                                                                    |
| relationship validation | the job's `(tenant, company, branch)` is resolved from the job row; the version's tenant from the version row. Neither from the request.          |
| empty / partial         | not applicable — no update                                                                                                                        |
| unknown parameter       | `.strict()`                                                                                                                                       |

Export `Body` and `Params`.

## 10. Error contract

**No new error codes.**

| condition                           | HTTP | code          | frontend behaviour                                                                             |
| ----------------------------------- | ---- | ------------- | ---------------------------------------------------------------------------------------------- |
| version rejected / quarantined      | 409  | `ERR-DOC-001` | _"this file failed a security scan and cannot be attached"_ — a remedy, not a generic conflict |
| version or job out of scope         | 404  | `ERR-RES-001` | existence not disclosed                                                                        |
| blank type, oversized note          | 422  | `ERR-VAL-001` | field errors as keys                                                                           |
| not permitted                       | 403  | `ERR-IAM-001` | denial + correlation id; **never** name the missing code                                       |
| key absent                          | 400  | `ERR-INT-002` | one key per intent                                                                             |
| key reused with a different payload | 409  | `ERR-INT-001` |                                                                                                |

## 11. Audit and history behaviour

`auditClass: privileged` on the write; `none` on the two reads.

| permanent requirement                | how this slice serves it                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **evidence**                         | closed for jobs — the limb that had no owner                                                                                                                                                         |
| **work-order transactional history** | evidence is attributed (`created_by`) and timestamped (`created_at`), append-only, and joined to the work order through the job                                                                      |
| **vehicle history is complete**      | evidence reaches the vehicle by `job → work_order → vehicle_id`. **This slice does not build a vehicle-side evidence read**; that is a `veh` surface and not P1-29's. Recorded so it is not assumed. |
| **customer aggregate history**       | unaffected                                                                                                                                                                                           |
| diagnostics evidence                 | unchanged, report-level, `INS-15` deferred as `BR-07-OPEN-01`                                                                                                                                        |

**Append-only is the audit property.** There is no update, no delete, and no soft delete, so the
record of what was attached and by whom cannot be revised. That is stronger than an audit log and it
is why the table carries `created_at`/`created_by` and nothing else.

## 12. Tests

### Positive

| #   | case                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------- |
| P1  | **the full chain**: authorize upload → register version → bind to a job → read it back on the job and on the work order |
| P2  | a `pending` (unscanned) version binds successfully                                                                      |
| P3  | evidence on two jobs of one work order both appear in `wo.work-order-evidence-list` with their `jobTitle`               |
| P4  | evidence binds to a job in a terminal state                                                                             |
| P5  | two different versions bind to one job and both are returned                                                            |

### Negative

| #   | case                                           | expected           |
| --- | ---------------------------------------------- | ------------------ |
| N1  | no auth                                        | 401                |
| N2  | caller lacks `tech.labor.record`               | 403                |
| N3  | version is `quarantined`                       | 409 `ERR-DOC-001`  |
| N4  | version is `rejected`                          | 409 `ERR-DOC-001`  |
| N5  | blank `evidenceType`                           | 422                |
| N6  | `note` over 1000 chars                         | 422                |
| N7  | unknown body key                               | 422                |
| N8  | body carries `createdBy`                       | 422                |
| N9  | no `Idempotency-Key`                           | 400                |
| N10 | job out of scope                               | 404                |
| N11 | `UPDATE wo.job_evidence` as `app_runtime`      | refused — no grant |
| N12 | `DELETE FROM wo.job_evidence` as `app_runtime` | refused — no grant |

### Security

| #   | case                                                                                                                 | expected                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| S1  | **cross-tenant version**: bind a tenant-B version to a tenant-A job                                                  | 404; and with the service check removed, `23503` from the FK — assert **both** layers |
| S2  | **cross-branch job**: bind to a job in an unheld branch                                                              | 404                                                                                   |
| S3  | **no storage leakage**: the response type contains no `storageKey`, URL, `sha256` or bytes                           | asserted on the type **and** a live response                                          |
| S4  | **download still gated**: a `pending` version that was bound cannot be downloaded until accepted                     | `ERR-DOC-001` from the attachments module                                             |
| S5  | **`EVIDENCE_REFUSED_STATES` is shared**: `grep` finds at most one literal declaration of the array in `apps/api/src` | prevents the third copy                                                               |
| S6  | **cross-tenant read**: a tenant-B caller sees no tenant-A evidence                                                   | restricted user                                                                       |

S1, S2 and S6 as restricted users.

### Regression — must remain green

- `dia.diagnostic-evidence-record` and `wo.additional-work-approval` evidence paths — unchanged behaviour, and both must still refuse the same two states after any extraction of the shared constant.
- The attachments chain — four operations, unchanged.
- Zero unindexed FKs across the four schemas — two new FKs, two new indexes.
- `check-authorization-coverage` / `check-openapi`: **+3**.
- `structuralTotals` — from CI.

## 13. Definition of Done

- [ ] Three operations registered, published, in the operation register.
- [ ] Exactly **one** migration: `wo.job_evidence`, append-only, RLS enabled and forced, two composite FKs, two covering indexes, `SELECT`+`INSERT` grants only.
- [ ] The table `COMMENT` carries the same binding sentence as its two siblings.
- [ ] **Zero** permission codes added.
- [ ] N11 and N12 pass — append-only at the grant layer, not by convention.
- [ ] S1 passes at **both** layers.
- [ ] S3 passes — no storage key, URL or bytes in any response shape.
- [ ] S5 passes — `EVIDENCE_REFUSED_STATES` has at most one literal declaration.
- [ ] P2 passes — `pending` binds; S4 passes — `pending` does not download.
- [ ] **No second media subsystem**: `grep` confirms this slice adds no upload route, no storage call, and no `connect-src` change.
- [ ] `BR-07-OPEN-01` (`INS-15`, per-item diagnostic evidence) is recorded as deferred with the backfill justification, and no UI renders evidence inside an item row.
- [ ] The `evidenceType` vocabulary is documented as a **convention, not an invariant**, with the recommended list and an "other" escape.
- [ ] The migration header states that evidence cannot be unbound and the rollback window closes at the first row.
- [ ] No file under `apps/web` is changed by this slice.
- [ ] No unresolved Critical or High finding open against this slice.
