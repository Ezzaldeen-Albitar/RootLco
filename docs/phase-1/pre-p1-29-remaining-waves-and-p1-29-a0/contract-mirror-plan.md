# P1-29 contract mirror and payload parity — plan

`docs/api/openapi.v1.json` declares **zero request bodies and zero typed success schemas** across
305 operations, and `apps/web` may not import `apps/api` runtime source. The payload contract must
therefore be **mirrored by hand** and held true by something.

**Do not design P1-29 around a generated OpenAPI client unless that fact changes.** The strategy is
the established RootLco one:

> API TypeScript contract source → frontend contract mirror → parity / contract gate

## The figures, re-measured

The frozen P1-29 preparation recorded 58 operations, 32 request shapes and 46 response shapes. Each
figure was re-derived independently for this document; where a re-measurement disagrees or adds a
qualification, the qualification is recorded below and in the ambiguity register rather than
silently overwriting the frozen figure.

## The ceiling that must be stated, not glossed

The existing adapter-reachability gate's Authority A is **one-directional id-set containment
computed by a regex over source text**. It proves a mirror _row_ exists. It compares no payload,
because neither the operation register nor the OpenAPI document carries payload information at all.

A payload parity gate must therefore find a **different machine-readable source** on the API side.
The five drift classes it has to catch are: field missing, field renamed, optional/required drift,
enum drift, and nested shape drift. For each, this document records whether the mechanisms that
exist could catch it — and where the honest answer is _no_, it says so.

**Operation-id reachability alone is not a payload gate**, and a plan that treats it as one repeats
the defect that reached the P1-28 Owner.

---

## The measurement and the mechanism

### 58 published operations — CUT 1, id prefix

**EXISTS AND LOAD-BEARING.**

HOLDS exactly as frozen. The register carries one `counts` bucket only — `Covered` — so all 305 operations are classified covered; nothing in the four modules is excluded by classification.

_Evidence:_ node over docs/phase-1/phase-1-24/evidence/operation-register.json: all 17 prefixes = {apt:21, crm:29, dia:13, iam:38, inv:14, meta:1, qms:13, quo:6, rec:50, rpt:2, sal:18, shared:28, svc:11, tech:6, veh:27, wo:26, wty:2}. Filter /^(wo|dia|qms|tech)\./ -> 58 (wo=26 dia=13 qms=13 tech=6). register.totals.operations = 305.

### 58 published operations — CUT 2, domain field

**EXISTS AND LOAD-BEARING.**

The two cuts select the IDENTICAL 58-element id set, not merely the same cardinality. Note the domain name is `quality`, not `qms`, and `reception` (71) spans both the `apt.` and `rec.` prefixes — so domain and prefix are not a naive 1:1 mapping platform-wide; they happen to coincide exactly for these four.

_Evidence:_ Same file, grouping by `o.domain`: work-order=26, diagnostics=13, quality=13, technician=6 = 58. All 19 domains enumerated. Symmetric difference against CUT 1 computed both directions: `in cut1 not cut2: []`, `in cut2 not cut1: []`.

### Method split across the 58

**EXISTS AND LOAD-BEARING.**

35 writes and 23 reads. The 35 writes map to 35 DISTINCT route files (no file hosts two write operations); several files host one write plus one GET (e.g. work-orders/[workOrderId]/additional-work/route.ts holds wo.additional-work-request POST and wo.additional-work-list GET).

_Evidence:_ Same cut: POST 30, GET 23, PUT 4, PATCH 1. Non-GET (write) = 35.

### 34 of 35 write operations carry a body

**EXISTS AND LOAD-BEARING.**

HOLDS exactly as frozen — `tech.labor-session-stop` carries no body. Every one of the 34 bodies ends in `.strict()`, without exception, which matters for the gate design: strictness is uniform, so `additionalProperties:false` is derivable for all of them.

_Evidence:_ Scanned all 35 write route files for a top-level `const Body =`. 34 found. The single exception is apps/api/src/app/api/v1/labor-sessions/[sessionId]/stop/route.ts, which declares only `const Params = z.object({ sessionId: schemas.uuid });` at :26 and no Body.

### 30 distinct top-level request bodies

**EXISTS AND LOAD-BEARING.**

HOLDS. The two collapses are structural, not incidental: the three `{reason}` bodies differ only in their max-length constant (MAX_REOPEN_REASON vs MAX_REASON), and the three `{reason?, toState}` bodies are byte-identical apart from surrounding comments. A gate keyed on field-name+optionality would treat these as one shape; a gate keyed on the full JSON Schema would treat the `{reason}` trio as three (different maxLength), which is a design decision the slice must make explicitly.

_Evidence:_ Keyed each of the 34 bodies by its sorted top-level field names with an optionality marker. 30 distinct. Exactly two duplicate groups: `{reason}` shared by qms.reopen-attempt, wo.additional-work-withdraw, wo.job-assignment-end; and `{reason?, toState}` shared by wo.job-transition, wo.work-order-closure, wo.work-order-transition. 34 - 4 = 30.

### 2 nested-only element shapes (the 30 -> 32 step)

**EXISTS AND LOAD-BEARING.**

HOLDS, and the arithmetic reconciles only because of that collision: 3 nested shapes minus the 1 that duplicates a top-level shape = 2 nested-ONLY. 30 + 2 = 32. This is worth recording because the collision is accidental — two modules independently arrived at the same evidence triple — so a future edit to either side silently changes the count.

_Evidence:_ Three distinct nested inline objects exist across 5 occurrences: `Evidence` at additional-work/[requestId]/approval/route.ts:85-91; the requiredSkills element `{skillCode, minimumRank}` at jobs/[jobId]/assignments/route.ts:45 and jobs/[jobId]/reassignments/route.ts:37; and `window` `{from, to}` at assignments/route.ts:57 and reassignments/route.ts:47. `Evidence` is field-identical to the TOP-LEVEL body of dia.diagnostic-evidence-record (inspections/[inspectionId]/evidence/route.ts:34-40): {documentVersionId, evidenceType, note?}.

### Query-string shapes are OUTSIDE the 32

**AMBIGUOUS IN DOCS.**

The frozen figure of 32 counts request BODIES only. Read operations carry non-trivial query contracts — tech.technician-available encodes skills as a comma-joined `code:rank` string (available/route.ts:92-98), which is a wire format a mirror must reproduce byte-for-byte — and none of that is in the 32. Not a contradiction of the doc, but the label 'distinct request shapes' reads wider than what was counted.

_Evidence:_ jobs/[jobId]/labor-sessions/route.ts:35-36 declares `const Query = z.object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })` — a request shape that is neither a body nor counted. technicians/available/route.ts parses a `Query` with skills/certifications/from/to/companyId/branchId/limit, and wo.work-order-list parses companyId/branchId/state/kind/openedFrom/openedTo/cursor/limit.

### Zero route files export their zod schemas

**MISSING CONTRACT.**

This is the single mechanical blocker between the repository and a runtime-introspection payload gate. The schema objects exist, are complete, and are exactly what a gate needs — and no importer can reach them. Making them reachable is a one-word change per file (`export`), not a redesign.

_Evidence:_ `grep -rn "export const Body|export const Params|export const Query|export const Evidence" apps/api/src/app/api/v1/` returns nothing. Every schema is a module-private `const`.

### 4 top-level bodies with a faithful exported API type

**EXISTS AND LOAD-BEARING.**

HOLDS at 4, including the Date-adapter caveat on AssignInput. All four are re-exported from their module index (work-order/index.ts:55, :57; quality/index.ts:38), so they are public API surface, not internals.

_Evidence:_ RaiseRequestInput at work-order/application/additional-work-service.ts:127 — {originatingJobId?, originatingFindingId?, summary, isRequired?}, exactly the wo.additional-work-request body. CreateReworkInput at quality/application/rework-service.ts:82 — exactly the qms.rework-create body. ApprovalEvidenceInput at additional-work-service.ts:135 — exactly the nested Evidence element. AssignInput at work-order/application/job-assignment-service.ts:83 — identical EXCEPT `window: { from: Date; to: Date }` against the route's `z.string().datetime({offset:true})`, bridged in the route at reassignments/route.ts:97 by `new Date(parsed.window.from)`.

### Why DecideInput and TransitionInput are NOT among the 4

**EXISTS BUT NOT USED.**

Confirms the frozen exclusion is correct rather than an oversight. It also names a general rule a payload gate needs: a service input type is a SUPERSET of the wire body by exactly the header-sourced fields, so 'compare the exported input type to the mirror' is wrong unless header-sourced fields are subtracted first.

_Evidence:_ DecideInput at additional-work-service.ts:540-543 carries `readonly expectedVersion: number`; TransitionInput at work-order-service.ts:136-140 carries the same. No route Body declares it — the approval route reads it from the If-Match header instead (approval/route.ts: `async ({ db, expectedVersion, authorizeScope })`, then throws ERR-CON-002 when null).

### 40 named response types — all located

**EXISTS AND LOAD-BEARING.**

HOLDS at 40 — every name in the frozen list resolves to exactly one declaration except TransitionResult (see next item). "Note the spread across four architectural layers: application services (28), data repositories (9), domain (2), and one cross-module import from `inventory` — 28 + 9 + 2 + 1 = 40."

_Evidence:_ All paths below relative to apps/api/src/modules/. work-order/application/work-order-service.ts: ClosureBlocker:40, ClosureEligibility:46, WorkOrderSummary:90, JobView:112, TransitionResult:143, ReachableState:149, WorkOrderDetail:166, WorkOrderHistoryEntry:173, WorkOrderHistoryView:192, JobHistoryView:207. work-order/application/job-assignment-service.ts: AssignmentView:50, QueueEntry:62. work-order/application/additional-work-service.ts: AdditionalWorkRequestView:74, AdditionalWorkDetailView:88, CustomerApprovalView:96, ApprovalEvidenceView:109. work-order/data/work-order-repository.ts: LineRow:168. inventory/application/inventory-read-service.ts: OpenInventoryCommitments:157. diagnostics/application/diagnostic-report-service.ts: DiagnosticReportView:83, DiagnosticReportDetail:103, EvidenceView:116, ReviewView:124, ReportHistoryEntry:132, ReportHistoryView:142. diagnostics/data/diagnostics-repository.ts: ItemResultRow:62, MeasurementRow:80, DtcRow:90, FindingRow:98, RecommendationRow:115. diagnostics/domain/diagnostics.ts: OutstandingItem:174. quality/application/quality-control-service.ts: QcRecordView:38, QcRecordDetail:48. quality/application/rework-service.ts: ReworkLinkView:57, ReopenAttemptView:72. quality/data/quality-repository.ts: QcCheckRow:17, QcCheckResultRow:63, ReworkCostRow:81. technician/application/labor-session-service.ts: LaborSessionView:53. technician/application/technician-eligibility-service.ts: EligibilityVerdict:46. technician/domain/technician.ts: EligibilityFinding:49.

### TransitionResult is declared TWICE

**AMBIGUOUS IN DOCS.**

The frozen list names `TransitionResult` without qualification. A mirror transcribing 'TransitionResult' has two candidate sources; the work-order one (`{state, recordVersion}`) is the one reachable from wo.work-order-transition, but nothing in the doc or the code disambiguates by name alone. A payload gate keyed on TYPE NAME rather than on operation-id would bind to whichever it found first.

_Evidence:_ apps/api/src/modules/work-order/application/work-order-service.ts:143 `export interface TransitionResult` AND apps/api/src/modules/shared-services/application/status-transition-service.ts:52 `export interface TransitionResult`.

### OpenInventoryCommitments is a cross-module response field

**EXISTS AND LOAD-BEARING.**

Concrete confirmation of the frozen §11.4 question 2: a strict module-per-mirror-file split cannot hold, because a work-order response embeds an inventory-owned type.

_Evidence:_ Declared at apps/api/src/modules/inventory/application/inventory-read-service.ts:157 as {activeReservations: number, openIssues: number, blocking: boolean}. Consumed at apps/api/src/modules/work-order/application/work-order-service.ts:20 (import) and :80 (`readonly inventoryCommitments: OpenInventoryCommitments`) — a field of ClosureEligibility, served by wo.work-order-closure-eligibility.

### Anonymous envelope 1 — wo.job-reassignment

**MISSING CONTRACT.**

Literal wire shape: `{ ended: AssignmentView | null, opened: AssignmentView }`. Both members are named; only the envelope is not.

_Evidence:_ apps/api/src/modules/work-order/application/job-assignment-service.ts:267 — `Promise<{ readonly ended: AssignmentView | null; readonly opened: AssignmentView }>`. Route returns it verbatim: jobs/[jobId]/reassignments/route.ts `return { status: 201, body: moved, recordVersion: moved.opened.recordVersion }`.

### Anonymous envelope 2 — wo.additional-work-approval (POST)

**MISSING CONTRACT.**

Literal wire shape: `{ request: AdditionalWorkRequestView, approval: CustomerApprovalView }`. Note the sibling GET on the same path (wo.additional-work-approval-read) returns a bare CustomerApprovalView, so the same URL serves two different shapes by method.

_Evidence:_ apps/api/src/modules/work-order/application/additional-work-service.ts:540-543 — `Promise<{ readonly request: AdditionalWorkRequestView; readonly approval: CustomerApprovalView }>`. Route: additional-work/[requestId]/approval/route.ts `return { status: 201, body: decided, ... }`.

### Anonymous envelope 3 — qms.rework-create

**MISSING CONTRACT.**

Literal wire shape: `{ reworkWorkOrderId: string, link: ReworkLinkView }`. The bare string member has no named type at all.

_Evidence:_ apps/api/src/modules/quality/application/rework-service.ts:229 — `Promise<{ readonly reworkWorkOrderId: string; readonly link: ReworkLinkView }>`. Route: work-orders/[workOrderId]/rework/route.ts `return { status: 201, body: created, recordVersion: created.link.recordVersion }`.

### Anonymous envelope 4 — qms.reopen-attempt

**MISSING CONTRACT.**

Literal wire shape: `{ attempt: ReopenAttemptView, refusal: string }`. The `refusal` member is a server-composed English sentence ('Work order {id} is closed and cannot be reopened (BR-WO-002); create a linked rework work order instead'), i.e. a 201 whose payload states a refusal — a shape no mirror would guess from the status code.

_Evidence:_ apps/api/src/modules/quality/application/rework-service.ts:147 — `Promise<{ readonly attempt: ReopenAttemptView; readonly refusal: string }>`; the `refusal` string is built at :197-199. Route: work-orders/[workOrderId]/reopen-attempts/route.ts:85 `return { status: 201, body: recorded }`.

### Anonymous envelope 5 — tech.technician-available

**MISSING CONTRACT.**

Literal wire shape: `{ items: (EligibilityVerdict & {technicianProfileId: string})[], truncatedAt: number | null }`. This is an INTERSECTION type inside an array inside an unnamed envelope — the hardest of the six to mirror, and it is not `ItemsOnly<T>` because of `truncatedAt`.

_Evidence:_ apps/api/src/modules/technician/application/technician-eligibility-service.ts:185-188 — `Promise<{ readonly items: readonly (EligibilityVerdict & { readonly technicianProfileId: string })[]; readonly truncatedAt: number | null }>`. Route: technicians/available/route.ts:102 returns it directly.

### Anonymous envelope 6 — tech.technician-queue

**MISSING CONTRACT.**

Literal wire shape: `{ technicianProfileId: string, items: QueueEntry[] }`. This is the strongest of the six: the shape has no existence anywhere in the module layer, so even a type-checker pointed at the services would not find it. It is also not `ItemsOnly<QueueEntry>` because of the sibling scalar.

_Evidence:_ The envelope exists ONLY in the route handler: apps/api/src/app/api/v1/technicians/[technicianProfileId]/queue/route.ts:53-61 builds `{ technicianProfileId: params.technicianProfileId, items: await workOrderModule().jobAssignments.queue(...) }`. The service returns a bare array — job-assignment-service.ts:352 `Promise<readonly QueueEntry[]>`.

### Nine further inline {items: T[]} envelopes are covered by ItemsOnly, not counted as anonymous

**EXISTS AND LOAD-BEARING.**

This is the reading under which the frozen count of 6 is consistent: an inline `{items}` is the shared ItemsOnly<T> envelope of §11.3 and needs no new type; tech.technician-queue is anonymous precisely because it is ItemsOnly PLUS a field. The doc does not state this reading explicitly, and it is what makes 6 rather than 14 the right number.

_Evidence:_ Route handlers build `{ items: ... }` inline for dia.diagnostic-list, qms.qc-record-list, qms.reopen-attempt-list, qms.rework-list, wo.additional-work-list, wo.job-assignment-list, wo.required-part-list, wo.service-line-list (8 operations), plus tech.technician-queue which adds a sibling field.

### Shared envelope — CursorPage<T>

**AVAILABLE.**

Cited line is exact. Its API counterpart is `Page<T>` at apps/api/src/server/db/pagination.ts:45-51 — field-identical. CORRECTED: **two** of the 58 return a bare `Page<T>` as the entire response body — `wo.work-order-list` and `tech.labor-session-list`; for those two `CursorPage<T>` IS the response type. The other three do **not**: `wo.work-order-history` returns `WorkOrderHistoryView`, `wo.job-history` returns `JobHistoryView` and `dia.diagnostic-history` returns `ReportHistoryView` — each a **named envelope** whose `transitions` field holds the page alongside a sibling `origin` genesis block (`{openedAt, openedBy, initialState}`, `{initialState}` and `{createdAt, createdBy, initialStatus}` respectively). The mirror must declare those three wrappers and use `CursorPage<T>` only for the inner field.

_Evidence:_ apps/web/src/lib/api/read-operation.ts:69 `export interface CursorPage<T> { readonly items: readonly T[]; readonly nextCursor: string | null; readonly hasMore: boolean; }`. Exactly one declaration in apps/web; imported by 14 feature/lib modules.

### Shared envelope — ItemsOnly<T>

**AVAILABLE.**

Cited line is exact. Covers the eight inline list envelopes above; does NOT cover tech.technician-queue or tech.technician-available.

_Evidence:_ apps/web/src/lib/api/read-operation.ts:76 `export interface ItemsOnly<T> { readonly items: readonly T[]; }`. Single declaration; imported at apps/web/src/features/administration/shared/api.ts:19 among others.

### Shared envelope — ProblemDetails / Violation

**AVAILABLE.**

Both cited lines are exact. Every field is optional by design — the docblock at :88 states presence is a runtime fact. All 58 operations reference `#/components/responses/Problem` for every failure code, so this envelope is the failure contract for the whole set.

_Evidence:_ apps/web/src/lib/api/client.ts:54 `export interface Violation { readonly path: string; readonly rule: string; }` and :90 `export interface ProblemDetails { type?, title?, status?, code?, correlationId?, violations?: readonly Violation[], retryAfterSeconds?, ... }` (violations at :102). Single declaration each in apps/web; no counterpart declaration of either name exists in apps/api/src.

### Authority A carries no payload information — confirmed

**EXISTS AND LOAD-BEARING.**

Re-confirmed verbatim. It is one-directional containment (published ⊆ mirrored) over a regex; it never opens a DTO, never compares a field, and never reads apps/api at all.

_Evidence:_ scripts/ci/check-p1-28-adapter-reachability.mjs — MIRROR_FILES frozen two-entry list at :121-124; register filter `/^(apt|rec)\./` at :241; the mirrored id set built at :254-262 by `[...source.matchAll(/^\s*operationId:\s*'([^']+)'/gm)]` over each mirror file read as TEXT; CONTRACT_MIRROR_MISSING emitted at :267 on set non-membership.

### VACUITY TRAP: the generated manifest already satisfies Authority A's regex for all 58

**MISSING CONTRACT.**

A P1-29 sibling gate that scanned a directory instead of an explicit allow-list, or that added the manifest to MIRROR_FILES, would pass all 58 ids on day one with zero mirror written. The P1-28 gate is safe only because MIRROR_FILES is a hand-frozen two-entry array. Any generalisation must keep the allow-list and must exclude the generated manifest by name.

_Evidence:_ `grep -rn "operationId: '(wo|dia|qms|tech)\." apps/web/src/` returns 58 matches, ALL of them in apps/web/src/lib/api/idempotent-operations.ts (e.g. :57, :64, :71), in exactly the ` operationId: 'wo.…',` form the regex matches.

### One of the 58 ALREADY has a partial payload DTO in apps/web

**EXISTS BUT NOT USED.**

The frozen §11.2 says 'zero have a mirror row anywhere in apps/web/src today' — literally true for ROWS, but the payload-transcription count is one, not zero. Measured drift against the API types: ConvertedWorkOrder.workOrder omits companyId, branchId and partsForwardState from WorkOrderSummary (work-order-service.ts:90-102); the envelope omits `nextStates` from WorkOrderDetail (:166-170); ConvertedWorkOrderJob omits workOrderId, jobType, requiresDiagnostic and recordVersion from JobView (:112-120). All omissions are documented as deliberate. This file is therefore the live proof that a naive equality gate would go red on legitimate code.

_Evidence:_ apps/web/src/features/receptions/work-order-contract.ts declares WORK_ORDER_READ_PERMISSION:43, ConvertedWorkOrderJob:46 and ConvertedWorkOrder:58 — a hand-transcribed, self-declared SUBSET of wo.work-order-detail. It contains no `operationId:` row, so Authority A's regex cannot see it.

### OpenAPI is not a payload source — 0 request bodies, 305 placeholder responses

**MISSING CONTRACT.**

Re-confirms the frozen §11 opening claim by direct measurement. The document cannot be extended by hand either: it is generated and compared by tests/openapi-contract.test.ts, so a hand edit fails that test.

_Evidence:_ Walked docs/api/openapi.v1.json: 305 operations, `requestBody` present on 0, response schemas present on 305 and every single one is byte-identical `{"type":"object"}` under status key '200'. components.schemas holds exactly three entries — ProblemDocument, Money, PageEnvelope — none of which is an operation payload.

### The OpenAPI generator structurally cannot carry a payload

**MISSING CONTRACT.**

So the gap is not an omission at generation time — the registry has nowhere to put a schema. Any OpenAPI-based payload gate requires first extending OperationDeclaration with request/response schema fields, then teaching the generator to emit them. That is a Backend change, not a gate.

_Evidence:_ apps/api/src/server/openapi/document.ts:210-231 emits a literal `responses: { '200': { description: 'Success.', headers: {...}, content: { 'application/json': { schema: { type: 'object' } } } }, ...standardFailureResponses(operation) }`. The token `requestBody` does not appear anywhere in the file. The source it draws from, OperationDeclaration (apps/api/src/server/auth/operation-registry.ts:46-84), has no schema field of any kind.

### 19 of the 58 return an undocumented 201

**MISSING CONTRACT.**

A payload gate that also compares status codes has 19 pre-existing failures to reconcile before it can go green. The frozen doc does not mention this. It is a direct consequence of the hard-coded '200' at document.ts:217 and is invisible to every current gate.

_Evidence:_ Route handlers return `status: 201` for dia.diagnostic-create, -dtc-record, -evidence-record, -finding-record, -measurement-record, -recommendation-record, -review; qms.qc-record-open, .reopen-attempt, .rework-create; tech.labor-session-correct, -start; wo.additional-work-approval, -request, .job-assignment-create, .job-create, .job-reassignment, .required-part-record, .service-line-record. apps/api/src/server/http/route-handler.ts:396 and :434 honour it (`status: result.status ?? 200`). The document publishes only '200' for every one.

### Only machine-readable REQUEST source: the inline zod in route files

**AVAILABLE BUT NEEDS ADAPTER.**

It IS complete — it is what the runtime validates against via parseOrFail(Body, body, 'body') — but it is unexported and lives in a TS module behind an `@/` path alias, so reaching it needs either an `export` keyword plus a TS-capable loader, or static AST extraction.

_Evidence:_ Established by elimination: OpenAPI has 0 requestBody; OperationDeclaration has no schema field; only 4 of 30 bodies have an exported input type, and 2 further candidates (DecideInput, TransitionInput) are supersets. The zod `const Body` in each of the 34 route files is the only complete, authoritative, machine-readable statement of a request payload in the repository.

### z.toJSONSchema CAN derive a shape at build time — proved by execution

**AVAILABLE.**

Decisive and dependency-free: field names, required/optional split, enum members, nesting, array item shapes and strictness are all recovered. Zero new packages needed. This is the mechanism a request-payload parity gate should be built on.

_Evidence:_ package.json:170 and apps/api/package.json:34 pin `zod ^4.3.6`; the resolved install is zod 4.4.3 (C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco/node_modules/zod). Ran a probe: `typeof z.toJSONSchema` -> 'function'. Against a verbatim reconstruction of the dia.diagnostic-transition body it emitted {type:'object', properties:{toStatus:{type:'string',enum:['draft','in_progress','completed','cancelled']}, reason:{type:'string',minLength:1,maxLength:500}}, required:['toStatus'], additionalProperties:false}. Against the wo.job-assignment-create body it emitted the full nested tree including requiredSkills.items.properties.{skillCode,minimumRank}, window.properties.{from,to} with required:['from','to'], and additionalProperties:false at every level.

### What z.toJSONSchema SILENTLY DROPS

**MISSING CONTRACT.**

Two of the 58 depend on a dropped `.refine`: wo.required-part-record and wo.service-line-record both enforce quantity > 0 that way. So a JSON-Schema-derived gate is sound on STRUCTURE and blind to SEMANTIC predicates — it would let a mirror that accepts quantity '0' pass. Good news on the other side: `.nullable().optional()` renders correctly as anyOf[...,{type:'null'}] AND absent from `required`, so wo.job-update's `jobType: string | null | undefined` is faithfully distinguishable from a plain optional.

_Evidence:_ Same probe. `.refine(v => Number(v) > 0, 'must be > 0')` on the required-parts quantity produced {type:'string',pattern:'^\\d{1,9}(\\.\\d{1,3})?$'} with no trace of the predicate — no throw, no marker, and `{unrepresentable:'any'}` changed nothing. `.trim()` likewise vanished: z.string().trim().min(1) emitted only {type:'string',minLength:1}. `z.coerce.number().int().min(1).max(100)` emitted {type:'integer'} under BOTH the default and `{io:'input'}`, hiding that the wire value is a string.

### Runtime introspection is reachable — the openapi test already loads every route

**AVAILABLE BUT NEEDS ADAPTER.**

So a vitest-hosted gate CAN load apps/api route modules with the alias resolved. Two conditions to reuse it: the route must `export` its Body, and the import list must not become the gate's blind spot. The existing external arithmetic (check-authorization-coverage counts registered ops, check-openapi counts published ops, the two must be equal) is the precedent for how to close that hole — a payload gate needs the analogous count: bodies-extracted must equal writes-published (34, with tech.labor-session-stop declared bodyless).

_Evidence:_ tests/openapi-contract.test.ts imports `buildOpenApiDocument` from '@/server/openapi/document' and then side-effect-imports every route module by path (`import '@/app/api/v1/…/route';`) to populate the registry. Its own docblock at :24-32 warns the import list is HAND-MAINTAINED and that this is its trap — all twelve Phase 1-18 operations were once absent from the published contract while both sides agreed on the same incomplete registry.

### Static AST extraction is possible but the existing helper is syntactic only

**AVAILABLE BUT NEEDS ADAPTER.**

So the repository can parse TypeScript but cannot RESOLVE types. A syntactic walker over `const Body = z.object({...})` would recover field names and `.optional()` without any export change — but it would have to re-implement zod semantics by hand and resolve imported identifiers (schemas.uuid, z.enum(REPORT_STATUSES), MAX_SUMMARY) itself. The enum case is tractable: vocabularies are exported `as const` arrays (e.g. diagnostics/domain/diagnostics.ts:19 `export const REPORT_STATUSES = ['draft','in_progress','completed','cancelled'] as const;`) and re-exported from module index files. The `schemas` helper is exported at apps/api/src/server/http/validation.ts:193.

_Evidence:_ scripts/lib/typescript-source.mjs parses with the real compiler (`import ts from 'typescript'`, `ts.createSourceFile(...)` at :71-77, fail-closed on parseDiagnostics) and exports parseModule, declaredFunctionsOf, enclosingFunctionNode, callsToNode, literalPathOf, argumentText. It is already consumed by scripts/ci/check-p1-28-write-reachability.mjs. `grep -rn "createProgram|getTypeChecker|typeToString" scripts/ tests/ apps/*/scripts` returns NOTHING.

### No machine-readable RESPONSE source exists

**MISSING.**

This is the asymmetry that decides the gate's scope. Requests: solvable today. Responses: not solvable with any mechanism currently present. Three candidate routes, none free — (a) add ts.createProgram + getTypeChecker and expand return types; (b) declare response zod schemas alongside the request ones and make the service return type derive from them; (c) capture real responses in the backend test suite and diff key sets, which is the only method that also validates the 19 undocumented 201s.

_Evidence:_ No zod appears on any response path — routes return service values directly (`return { body: detail, recordVersion: detail.report.recordVersion }`). The only statement of a response shape is the TypeScript interface. Deriving it from the route requires resolving a factory chain (`qualityModule().rework.create(...)`), which needs a type-checker, and `ts.createProgram`/`getTypeChecker` exist nowhere in the repo. OpenAPI gives `{"type":"object"}` for all 305.

### A repo-level gate MAY read both sides — the boundary rule does not forbid it

**AVAILABLE.**

The rule constrains the SHIPPED web bundle, not CI tooling. A scripts/ci/check-p1-29-payload-parity.mjs can legitimately read apps/api/src and apps/web/src in the same process. Precedent is exact: generate-idempotent-operations.mjs writes a file INTO apps/web/src from a docs/api source, and its docblock at :30 states the web app 'never imports API source, never reads apps/api' — the generator does the reading, the bundle does not.

_Evidence:_ apps/web/scripts/check-api-boundary.mjs RULES entry id 'api-source-import' at :76-80 — pattern /from\s+['"][^'"]*apps\/api\//, allow: []. But main() at :136-147 walks exactly one root, `['src']`, relative to process.cwd() (apps/web). Nine existing scripts already read both trees (check-api-backend-only.mjs, check-command-coverage.mjs, check-generated-artifacts.mjs, check-phase-ownership.mjs, check-web-topology.mjs, generate-idempotent-operations.mjs and others).

### Nothing in the repository compares any payload between the two sides

**MISSING.**

Confirms the frozen §11.1 claim 'Nothing anywhere compares a payload DTO to apps/api' by exhaustive search rather than by assertion.

_Evidence:_ Enumerated every file under scripts/ and tests/ mentioning both 'apps/api' and 'apps/web': 19 files (check-api-backend-only, check-command-coverage, check-generated-artifacts, check-p1-27-doc-counts, check-phase-ownership, check-product-name-authority, check-web-topology, generate-idempotent-operations, dev/owner-acceptance/full-cycle, lib/repository-paths, plus 9 tests/ci mirrors). Each was checked: ownership, topology, command coverage, generated-artifact freshness, product-name authority, path constants. None reads a type declaration or a field name.

### DRIFT CLASS 1 — field missing from the mirror

**AVAILABLE.**

CATCHABLE for requests. Caveat proved live by apps/web/src/features/receptions/work-order-contract.ts: a legitimate deliberate subset is indistinguishable from a defect by set difference alone. The gate therefore needs the same three-state vocabulary the P1-28 gate already uses (REACHABLE / PENDING / DELIBERATELY_ABSENT) applied at FIELD granularity, with each omission declared and justified, or it will either go red on honest code or go green on a dropped field. For responses: NOT catchable — no machine-readable source; would need the type-checker or a captured live response.

_Evidence:_ z.toJSONSchema emits a complete `properties` map; set difference over property keys detects absence. Proved on the probe output for both reconstructed bodies.

### DRIFT CLASS 2 — field renamed

**AVAILABLE.**

CATCHABLE for requests, but only as 'one missing + one unexpected', not identified AS a rename. That is sufficient to fail the build; a heuristic pairing by identical subschema would name it. Materially worse without the gate than the other classes, because `.strict()` is on all 34 bodies — a renamed field on the mirror produces a 422 at runtime rather than silent truncation, so it is loud in production and silent in CI today. For responses: NOT catchable.

_Evidence:_ A rename appears in the JSON Schema diff as one key removed plus one key added, both detectable from the `properties` map and the `required` array.

### DRIFT CLASS 3 — optional/required drift

**AVAILABLE.**

CATCHABLE for requests, and with better fidelity than a hand review would give — the three-way distinction between optional, nullable, and both is preserved. For responses: NOT catchable. This is the class most likely to bite silently, because a mirror that marks a required field optional produces a 422 only on the path where the caller omits it.

_Evidence:_ The `required` array is emitted explicitly. Probe: dia.diagnostic-transition -> required:['toStatus'] with `reason` absent; job-assignment -> required:['technicianProfileId','window']. Also proved that `.nullable().optional()` yields anyOf[...,null] AND omission from required, so `string|null|undefined` (wo.job-update jobType) is distinguishable from `string|undefined`.

### DRIFT CLASS 4 — enum drift

**AVAILABLE.**

CATCHABLE for requests, and this is where the gate earns most: the P1-28 mirror already hand-transcribes vocabularies (apps/web/src/features/appointments/appointments-contract.ts:339 APPOINTMENT_STATUSES), and a transcribed list rots silently when the Backend adds a member. IMPORTANT EXCLUSION: three of the 58 do NOT use enums where one might expect them — wo.job-transition, wo.work-order-closure and wo.work-order-transition validate `toState` as `z.string().regex(/^[a-z][a-z0-9_]{1,62}$/)` because the state vocabulary is a live tenant-extensible catalogue table, not a CHECK constraint. For those, enum parity is not merely uncatchable, it is meaningless — the correct check is that the mirror does NOT declare an enum. For responses: NOT catchable statically.

_Evidence:_ Probe emitted the full member list: toStatus -> enum:['draft','in_progress','completed','cancelled']; assignmentRole -> enum:['primary','support']. Source vocabularies are exported `as const` (diagnostics/domain/diagnostics.ts:19,31,44,48,52; work-order domain APPROVAL_DECISIONS/APPROVAL_CHANNELS/ASSIGNMENT_ROLES/SETTABLE_FULFILLMENT_STATES; quality QC_CHECK_RESULTS) and re-exported from module index files.

### DRIFT CLASS 5 — nested shape drift

**AVAILABLE.**

CATCHABLE for requests to arbitrary depth, including array element shapes and per-level strictness. Two caveats. (a) The AssignInput Date-vs-ISO adapter is INVISIBLE to this method — the wire schema says {type:'string',format:'date-time'} and the exported AssignInput says Date; comparing the mirror to the wire schema is correct and comparing it to AssignInput is not, so the gate must fix wire-schema as the authority. (b) The hardest response nesting has no counterpart at all: tech.technician-available returns an intersection `EligibilityVerdict & {technicianProfileId: string}` inside an unnamed envelope, which no request-side mechanism reaches. For responses generally: NOT catchable.

_Evidence:_ Probe recursed fully: requiredSkills.items -> {type:'object', properties:{skillCode:{type:'string',minLength:1,maxLength:64}, minimumRank:{type:'integer',minimum:1,maximum:1000}}, required:[both], additionalProperties:false}; window -> {type:'object', properties:{from,to}, required:['from','to'], additionalProperties:false}.

### What a payload parity gate must compare, stated mechanically

**MISSING.**

REQUEST side, buildable today: (1) load each of the 35 write route modules with the alias resolved, as tests/openapi-contract.test.ts already does; (2) read the now-exported `Body` and call z.toJSONSchema, giving 34 schemas plus one declared-bodyless operation; (3) canonicalise — drop $schema, sort properties and required, and decide explicitly whether the length/pattern facets participate (they distinguish the three {reason} bodies that field-name comparison collapses); (4) derive the same canonical form from the mirror, which requires the mirror to carry a machine-readable declaration rather than a bare TS interface, since apps/web has no zod for these and TS interfaces are not readable without a checker; (5) compare with a declared direction plus per-field DELIBERATELY_ABSENT justifications; (6) add an anti-vacuity assertion — extracted bodies must equal 34 and the bodyless set must equal exactly {tech.labor-session-stop} — because the manifest-regex trap shows how easily this family of gate passes over nothing. RESPONSE side, not buildable today: nothing machine-readable exists, and the 6 anonymous envelopes plus the route-only tech.technician-queue envelope would be uncovered even by a type-checker pointed at the service layer. The honest ceiling is a request-payload gate plus a live-response check in the backend suite; the frozen §12 statement 'It does not promise CI coverage of payload drift' remains accurate for responses and is now beatable for requests.

_Evidence:_ Synthesis of the measurements above. No such gate exists; scripts/ci/check-p1-28-adapter-reachability.mjs Authority A (:254-271) is id-set containment only.

---

## Unknowns — what could not be settled, and what would settle it

- Whether the 19 undocumented 201 responses (route returns 201, openapi.v1.json publishes only 200) are a known accepted state or an unreported defect. SETTLED BY: searching the P1-19/P1-09 gate records and blocker registers for an accepted-deviation entry covering the hard-coded '200' at apps/api/src/server/openapi/document.ts:217, or asking whether any Backend phase owns it.
- Whether the 34 route Bodies can be exported without tripping a Next.js route-module constraint. Next route files may export only recognised handlers plus specific config, and an extra named export may be rejected by the App Router build. SETTLED BY: adding `export` to one Body and running the apps/web/apps/api production build plus `npm run typecheck` — I could not run it, this worktree has no node_modules.
- Whether tests/openapi-contract.test.ts's hand-maintained route import list is complete for the 58 today, and therefore whether a vitest-hosted payload gate reusing it would silently skip operations. SETTLED BY: diffing the import list against the 35 write route file paths, and checking whether check-authorization-coverage.mjs's count equality already forces completeness for writes specifically.
- Whether a mirror-side machine-readable payload declaration is acceptable to the web tier at all — a zod schema in apps/web would be a second runtime validator on data the Backend has already validated, and P-4 (frontend visibility is not authorization) argues against the frontend re-deciding anything. SETTLED BY: an Owner or architecture decision on whether the mirror declares shapes as zod (comparable mechanically) or as TS interfaces (comparable only with a type-checker).
- Whether the backend test suite already captures real response bodies in a form a parity check could diff, which is the only mechanism that covers responses AND the 201s. SETTLED BY: reading tests/backend/p1-19-_.test.ts and p1-09-_.test.ts for an existing response-body assertion helper and checking whether it asserts key sets or only individual fields.
- Whether `.refine` predicates matter enough to need a second mechanism. Only two of the 58 depend on one (wo.required-part-record and wo.service-line-record, quantity > 0), and both are also guarded by a database CHECK. SETTLED BY: deciding whether a mirror is expected to reproduce semantic predicates at all, or only structure — which is a scope question for the implementing slice, not a measurement.

---

## Ambiguities recorded from this lane

Recorded, not resolved. The full set is in [ambiguity-register.md](ambiguity-register.md).

- The frozen §11.2 table row reads 'top-level request bodies with a faithful exported API type | 4 — RaiseRequestInput, ApprovalEvidenceInput, CreateReworkInput, and AssignInput'. ApprovalEvidenceInput (additional-work-service.ts:135) mirrors the NESTED Evidence element at approval/route.ts:85-91, not a top-level body. The count of 4 is right under the reading 'request shapes with a faithful exported type'; the row LABEL 'top-level request bodies' is not. Documentation ambiguity, not a measurement error.
- '32 distinct request shapes' counts request BODIES only. Query-string contracts are not counted and are non-trivial: tech.technician-available encodes skills as a comma-joined 'code:rank' string (technicians/available/route.ts:92-98), wo.work-order-list takes eight query fields, and three paged reads take cursor/limit. Whether a P1-29 mirror owes query shapes is unresolved by the frozen set.
- The count of 6 anonymous envelopes is consistent only under the unstated reading that an inline `{items: T[]}` is the shared ItemsOnly<T> of §11.3 rather than a new anonymous shape. Eight further operations build such an envelope inline in the route (dia.diagnostic-list, qms.qc-record-list, qms.reopen-attempt-list, qms.rework-list, wo.additional-work-list, wo.job-assignment-list, wo.required-part-list, wo.service-line-list). Under a literal reading of 'responses with no named type on either side' the number would be 14, not 6. The doc does not state which reading it used.
- The frozen list names 'TransitionResult' without qualification, but two declarations exist: work-order/application/work-order-service.ts:143 and shared-services/application/status-transition-service.ts:52. Which one the mirror transcribes is not stated, and nothing in the code disambiguates by name alone.
- §11.2 states 'zero have a mirror row anywhere in apps/web/src today'. Literally true for `operationId:` ROWS, but apps/web/src/features/receptions/work-order-contract.ts already carries a hand-transcribed payload DTO (ConvertedWorkOrder:58, ConvertedWorkOrderJob:46) for wo.work-order-detail plus WORK_ORDER_READ_PERMISSION:43. Whether 'mirror' means the row layer or the payload layer changes whether the P1-29 mirror starts at zero.
- Whether the three {reason} bodies (differing only in max-length constant) and the three {toState, reason?} bodies count as one shape or three depends on whether the comparison key includes validation facets. The frozen count of 30 implies field-name+optionality keying. A JSON-Schema-based gate would naturally include maxLength and see 32 top-level shapes, not 30. The doc does not fix the keying rule.
