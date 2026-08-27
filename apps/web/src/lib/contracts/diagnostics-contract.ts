/**
 * Request-payload mirror for the `dia.` domain — the fifteen diagnostics
 * operations that carry a body (P1-29, `BR-08c`).
 *
 * | operation                             | type                                |
 * | ------------------------------------- | ----------------------------------- |
 * | `dia.diagnostic-complete`             | `DiagnosticCompleteBody`            |
 * | `dia.diagnostic-create`               | `DiagnosticCreateBody`              |
 * | `dia.diagnostic-dtc-record`           | `DiagnosticDtcRecordBody`           |
 * | `dia.diagnostic-evidence-record`      | `DiagnosticEvidenceRecordBody`      |
 * | `dia.diagnostic-finding-record`       | `DiagnosticFindingRecordBody`       |
 * | `dia.diagnostic-item-result`          | `DiagnosticItemResultBody`          |
 * | `dia.diagnostic-measurement-record`   | `DiagnosticMeasurementRecordBody`   |
 * | `dia.diagnostic-recommendation-record`| `DiagnosticRecommendationRecordBody`|
 * | `dia.diagnostic-review`               | `DiagnosticReviewBody`              |
 * | `dia.diagnostic-transition`           | `DiagnosticTransitionBody`          |
 * | `dia.template-create`                 | `TemplateCreateBody`                |
 * | `dia.template-item-create`            | `TemplateItemCreateBody`            |
 * | `dia.template-update`                 | `TemplateUpdateBody`                |
 * | `dia.template-version-create`         | `TemplateVersionCreateBody`         |
 * | `dia.template-version-status-set`     | `TemplateVersionStatusSetBody`      |
 *
 * ## Why this is transcribed by hand
 *
 * `apps/web` may not import `apps/api` source — `check-api-boundary.mjs`
 * refuses it — so these shapes are copied across the boundary rather than
 * shared. A GENERATED copy would gate nothing: it would agree with the backend
 * by construction and could never disagree. This one can drift, which is the
 * entire reason it exists, and the `BR-08c` gate is what catches the drift by
 * comparing each interface against `z.toJSONSchema` of the real zod schema.
 *
 * ## One type per operation, never shared
 *
 * No interface here is reused by a second operation, even where two bodies are
 * byte-identical today. TypeScript cannot express `maxLength`, so a shared type
 * would quietly promise a caller a limit that belongs to the other operation —
 * and nothing in the language or the gate would catch it. Two operations having
 * the same fields is an accident of the present, not a contract.
 *
 * ## What a type cannot carry
 *
 * `minLength`, `maxLength`, `pattern` and `.refine` predicates are absent from
 * every interface below because an interface has nowhere to put them. They are
 * not lost — they are enforced by the API, which will refuse a body this mirror
 * accepts. Where a limit is a genuine trap (the same field name bounded
 * differently in two places) the docblock says so; there are no branded types
 * pretending otherwise.
 *
 * ## Enums are unions, catalogue codes are `string`
 *
 * Every enum in this domain is a closed `ck_` check constraint, so each is
 * written as a union of string literals. Nothing here is a tenant-extensible
 * vocabulary — that is a `wo.` shape, where the state is a row of a live
 * catalogue and the mirror declares `string`. The one field that LOOKS like one
 * is `dia.template-create.code`; see its docblock.
 */

/** The whole body is optional: `{}` completes a diagnostic without a summary. */
export interface DiagnosticCompleteBody {
  readonly summary?: string;
}

export interface DiagnosticCreateBody {
  readonly templateVersionId: string;
}

/**
 * `code` is a fault code in the OBD-II form (letter, then three hex digits) and
 * the type accepts any string — the API rejects anything else. Callers should
 * validate at the input, not on the response.
 */
export interface DiagnosticDtcRecordBody {
  readonly code: string;
  readonly description?: string;
  readonly dtcStatus?: 'active' | 'pending' | 'stored' | 'cleared';
}

/**
 * NOTE the `note` limit: 500 here, but 1000 on `wo.job-evidence-record`, whose
 * body is otherwise identical. The two are indistinguishable as TypeScript and
 * this is the collision that forbids sharing a type — a 900-character note is
 * accepted by the work-order operation and refused by this one.
 */
export interface DiagnosticEvidenceRecordBody {
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note?: string;
}

export interface DiagnosticFindingRecordBody {
  readonly templateItemId?: string;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly disposition: 'monitor' | 'repair_recommended' | 'repair_required' | 'no_action';
  readonly description: string;
}

/**
 * Both fields are optional because both are optional in the schema — but any
 * rule RELATING them (a result value versus a reason for having none) would
 * live in a `.refine` predicate, and `.refine` is the known ceiling of the
 * extraction: it does not survive `z.toJSONSchema`, so it cannot appear here.
 * `{}` will type-check and may still be refused.
 */
export interface DiagnosticItemResultBody {
  readonly resultValue?: string;
  readonly notApplicableReason?: string;
}

export interface DiagnosticMeasurementRecordBody {
  readonly templateItemId?: string;
  readonly label: string;
  /**
   * A DECIMAL STRING, never a JS number. The column is unbounded `numeric`, so
   * a value round-tripped through `number` would lose precision the database
   * keeps; the schema's own annotation says as much.
   */
  readonly measuredValue: string;
  readonly unit: string;
}

export interface DiagnosticRecommendationRecordBody {
  readonly recommendation: string;
  readonly priority?: 'low' | 'medium' | 'high';
}

export interface DiagnosticReviewBody {
  readonly reviewResult: 'approved' | 'rejected' | 'needs_rework';
  readonly notes?: string;
}

/**
 * `toStatus` is a union here, unlike the `toState` of every `wo.` transition.
 * A work order's states are rows of a tenant-owned catalogue; a diagnostic's
 * are a closed check constraint, so the four members are safe to name and a
 * fifth would be a schema change rather than a tenant's configuration.
 */
export interface DiagnosticTransitionBody {
  readonly toStatus: 'draft' | 'in_progress' | 'completed' | 'cancelled';
  readonly reason?: string;
}

/**
 * `code` carries `^[a-z][a-z0-9_]{1,62}$` — the same pattern the tenant-
 * extensible state vocabularies use — but it is not one of them. It is the
 * slug a tenant CHOOSES for a template it is creating, so the set is open by
 * definition and `string` is the only honest declaration. Do not "complete" it
 * into a union.
 */
export interface TemplateCreateBody {
  readonly code: string;
  readonly name: string;
  readonly diagnosticTypeId: string;
}

/**
 * The validation an item's response must satisfy, as an OPAQUE bag. The schema
 * declares an open record with no named properties: what the keys mean depends
 * on the item's `responseType`, and that mapping lives in the API. Naming keys
 * here would be a guess that the gate could not check.
 */
export interface TemplateItemValidationRule {
  readonly [key: string]: unknown;
}

export interface TemplateItemCreateBody {
  readonly itemCode: string;
  readonly prompt: string;
  readonly responseType: 'numeric' | 'text' | 'boolean' | 'select';
  readonly unit?: string;
  readonly isMandatory?: boolean;
  readonly validationRule?: TemplateItemValidationRule;
  /** A positive integer ordering position — `number` cannot say "integer". */
  readonly sequence?: number;
}

/**
 * `status` is the TEMPLATE's lifecycle and has two members of its own. It is
 * not the version lifecycle — see `TemplateVersionStatusSetBody`, where the
 * field is also called a status and shares none of these values.
 */
export interface TemplateUpdateBody {
  readonly name?: string;
  readonly status?: 'active' | 'inactive';
}

export interface TemplateVersionCreateBody {
  readonly copyFromVersionId?: string;
}

/**
 * The VERSION lifecycle: a version is published or retired, never `active` or
 * `inactive`. Two vocabularies one edit apart, which is exactly what a type
 * shared across the two operations would have flattened.
 */
export interface TemplateVersionStatusSetBody {
  readonly toStatus: 'published' | 'retired';
}
