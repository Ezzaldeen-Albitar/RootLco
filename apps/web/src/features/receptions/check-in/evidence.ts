import {
  EVIDENCE_KINDS,
  MAX_COORD,
  MAX_DECLARED_VALUE,
  MIN_COORD,
  type ConditionEvidenceEntry,
  type EvidenceKind,
} from '../receptions-contract';

/**
 * Pre-service condition evidence — the rules, without a DOM (P1-28, Wave E;
 * `FE-010`…`FE-016`).
 *
 * Pure module: no fetch, no React, no side effects. Everything the evidence
 * steps decide that can be decided without a browser lives here so
 * `tests/reception-evidence.test.ts` can hold it directly, the same shape
 * `check-in/wizard.ts` established for the wizard's own state machine.
 *
 * ## The read-back does NOT return what the operator typed
 *
 * `rec.reception-condition-evidence-list` unions the eight evidence relations
 * and deliberately EXCLUDES the two restricted narrative tables —
 * `rec.complaint_details` and `rec.vehicle_content_details` — because both sit
 * behind `iam.sensitive.view` (`reception-read-repository.ts:26-27,551-553`).
 * So a complaint reads back as its category, severity and reporter, never as
 * the customer's words; a content item reads back as a quantity and a location,
 * never as its description or declared value.
 *
 * That is not a gap to paper over. Two things are therefore rendered, and they
 * are labelled as two different things:
 *
 *   - **What this session captured** — held in memory from each write's own
 *     response, so an operator can see that the thing they just typed was
 *     stored. It does not survive a reload and must never claim to.
 *   - **What reads back** — the published union rows, with the statement that
 *     the narrative itself is not re-readable without `iam.sensitive.view`.
 *
 * `EVIDENCE_ROW_FIELDS` mirrors the payload that union publishes, field for
 * field. It is a mirror of the read, not a guess about the write: the two
 * differ, and inventing a field the read does not publish would render an empty
 * label beside every row.
 */

/* ------------------------------------------------------------------ *
 * Kind coverage — which step owns which kind, and which cannot work
 * ------------------------------------------------------------------ */

/**
 * How completely a kind is reachable from the product.
 *
 * Three states rather than two, because "there is a control" and "an operator
 * can use it today" are different claims and this phase keeps finding the
 * difference the hard way (INT-113).
 *
 *   - `wired` — the step builds the input and submits it, unconditionally.
 *   - `data_gated` — the step builds the input and submits it, but the control
 *     appears only when the reference data it needs exists. The absence is
 *     STATED on screen; no disabled control, no invented rows.
 *   - `blocked` — no control at all, because the contract requires a value no
 *     operation in this product can produce. The named open decision is stated
 *     where an operator would look for the control.
 */
export type EvidenceCoverageStatus = 'wired' | 'data_gated' | 'blocked';

export interface EvidenceKindCoverage {
  readonly kind: EvidenceKind;
  /** The registered step that captures the kind — or states why it cannot. */
  readonly stepId: string;
  readonly status: EvidenceCoverageStatus;
  /** The canonical plan task that owns the kind. */
  readonly task: string;
  /** The on-screen statement for a gated or blocked kind; `null` when wired. */
  readonly noticeKey: string | null;
}

/**
 * Every one of the eight kinds the POST accepts, and what this wave actually
 * did with it.
 *
 * `tests/reception-evidence.test.ts` holds this table against the CONTRACT's
 * `EVIDENCE_KINDS` in both directions, against the step registry, and against
 * each step's own source — a `wired` or `data_gated` row whose step does not
 * construct that kind fails, and a `blocked` row whose step DOES construct it
 * fails too. A coverage claim nobody can check is the thing this table exists
 * to stop being possible.
 */
export const EVIDENCE_KIND_COVERAGE: readonly EvidenceKindCoverage[] = Object.freeze([
  {
    kind: 'complaint',
    stepId: 'condition-complaints',
    status: 'wired',
    task: 'P1-28-FE-010',
    noticeKey: null,
  },
  {
    kind: 'inspection',
    stepId: 'condition-inspection',
    status: 'wired',
    task: 'P1-28-FE-011',
    noticeKey: null,
  },
  {
    kind: 'condition_item',
    stepId: 'condition-inspection',
    status: 'data_gated',
    task: 'P1-28-FE-011',
    // A finding hangs off an inspection header. The same step opens one, so the
    // gate is reachable from inside the step rather than from somewhere else.
    noticeKey: 'receptions.evidence.inspectionRequired',
  },
  {
    kind: 'leak',
    stepId: 'condition-inspection',
    status: 'wired',
    task: 'P1-28-FE-011',
    noticeKey: null,
  },
  {
    kind: 'damage_map',
    stepId: 'condition-damage',
    status: 'blocked',
    task: 'P1-28-FE-012',
    // `documentId` AND `documentVersionId` are both required uuids naming a
    // registered map-template document and the exact version it was drawn on.
    // The published surface DOES have an operation that creates a document row;
    // what it does not have is a chain that can complete — see
    // `DOCUMENT_CHAIN_BLOCKERS` in `../media/media-decision.ts`, three
    // independent facts a test re-derives from the repository. So no operator in
    // any tenant can produce either value — P1-OD-025.
    noticeKey: 'receptions.evidence.damageMapBlocked',
  },
  {
    kind: 'damage_mark',
    stepId: 'condition-damage',
    status: 'data_gated',
    task: 'P1-28-FE-012',
    noticeKey: 'receptions.evidence.damageMapRequired',
  },
  {
    kind: 'contents',
    stepId: 'condition-contents',
    status: 'wired',
    task: 'P1-28-FE-016',
    noticeKey: null,
  },
  {
    kind: 'warning_light',
    stepId: 'condition-warning-lights',
    status: 'data_gated',
    task: 'P1-28-FE-015',
    noticeKey: 'receptions.evidence.warningCatalogueEmpty',
  },
]);

/** The coverage row for one kind, or `null` when the table does not carry it. */
export function coverageOf(kind: EvidenceKind): EvidenceKindCoverage | null {
  return EVIDENCE_KIND_COVERAGE.find((row) => row.kind === kind) ?? null;
}

/* ------------------------------------------------------------------ *
 * The restricted narratives
 * ------------------------------------------------------------------ */

/**
 * The two kinds whose narrative table the read deliberately never selects.
 *
 * `rec.complaint_details` holds the customer's own words; `rec.vehicle_content_details`
 * holds the item description, the declared value and its currency. Both carry a
 * SELECT policy of their own (`iam.sensitive.view`), so this caller gets the
 * envelope and nothing else — which the steps SAY rather than presenting a row
 * that merely looks thin.
 */
export const RESTRICTED_NARRATIVE_KINDS: readonly EvidenceKind[] = Object.freeze([
  'complaint',
  'contents',
]);

export function isRestrictedNarrative(kind: EvidenceKind): boolean {
  return RESTRICTED_NARRATIVE_KINDS.includes(kind);
}

/* ------------------------------------------------------------------ *
 * The published union payload, mirrored field for field
 * ------------------------------------------------------------------ */

export type EvidenceFieldKind = 'text' | 'vocabulary' | 'datetime' | 'identifier';

export interface EvidenceRowField {
  /** The key the union publishes, camelCase, exactly as flattened into the row. */
  readonly field: string;
  readonly labelKey: string;
  readonly kind: EvidenceFieldKind;
  /** `vocabulary` only — the catalogue prefix the value's label lives under. */
  readonly vocabularyPrefix?: string;
}

/**
 * What each kind's row actually carries, mirroring
 * `reception-read-repository.ts:576-668`.
 *
 * Read off the `jsonb_build_object` of each arm of the union rather than off the
 * write schema beside it, because the two are NOT the same shape and the
 * differences are the point: `complaint` publishes `category`/`severity` and the
 * reporter's resolved name but not `complaintText`; `contents` publishes only
 * `quantity` and `location`; `warning_light` publishes the catalogue's `code`
 * and `name` joined for it; `damage_mark` publishes its coordinates `::text`
 * because they are `numeric` and must not become JS floats.
 */
export const EVIDENCE_ROW_FIELDS: Readonly<Record<EvidenceKind, readonly EvidenceRowField[]>> = {
  complaint: [
    {
      field: 'category',
      labelKey: 'receptions.complaint.category',
      kind: 'vocabulary',
      vocabularyPrefix: 'receptions.complaintCategory.',
    },
    {
      field: 'severity',
      labelKey: 'receptions.complaint.severity',
      kind: 'vocabulary',
      vocabularyPrefix: 'receptions.complaintSeverity.',
    },
    {
      field: 'reportedByPartnerDisplayName',
      labelKey: 'receptions.complaint.reportedBy',
      kind: 'text',
    },
  ],
  inspection: [
    {
      field: 'inspectionStatus',
      labelKey: 'receptions.inspection.status',
      kind: 'vocabulary',
      vocabularyPrefix: 'receptions.inspectionStatus.',
    },
    { field: 'inspectorId', labelKey: 'receptions.inspection.inspector', kind: 'identifier' },
    { field: 'startedAt', labelKey: 'receptions.inspection.startedAt', kind: 'datetime' },
    { field: 'completedAt', labelKey: 'receptions.inspection.completedAt', kind: 'datetime' },
  ],
  condition_item: [
    {
      field: 'findingCategory',
      labelKey: 'receptions.finding.category',
      kind: 'vocabulary',
      vocabularyPrefix: 'receptions.findingCategory.',
    },
    { field: 'vehicleZone', labelKey: 'receptions.finding.zone', kind: 'text' },
    {
      field: 'severity',
      labelKey: 'receptions.finding.severity',
      kind: 'vocabulary',
      vocabularyPrefix: 'receptions.findingSeverity.',
    },
    { field: 'findingNote', labelKey: 'receptions.finding.note', kind: 'text' },
  ],
  damage_map: [
    { field: 'mapType', labelKey: 'receptions.damage.mapType', kind: 'text' },
    { field: 'perspective', labelKey: 'receptions.damage.perspective', kind: 'text' },
  ],
  damage_mark: [
    {
      field: 'markType',
      labelKey: 'receptions.damage.markType',
      kind: 'vocabulary',
      vocabularyPrefix: 'receptions.markType.',
    },
    { field: 'vehicleZone', labelKey: 'receptions.finding.zone', kind: 'text' },
    { field: 'coordX', labelKey: 'receptions.damage.coordX', kind: 'identifier' },
    { field: 'coordY', labelKey: 'receptions.damage.coordY', kind: 'identifier' },
    { field: 'note', labelKey: 'receptions.finding.note', kind: 'text' },
  ],
  contents: [
    { field: 'quantity', labelKey: 'receptions.contents.quantity', kind: 'text' },
    { field: 'location', labelKey: 'receptions.contents.location', kind: 'text' },
  ],
  warning_light: [
    { field: 'warningLightCode', labelKey: 'receptions.warning.code', kind: 'identifier' },
    { field: 'warningLightName', labelKey: 'receptions.warning.name', kind: 'text' },
    {
      // A closed database vocabulary, so it is read back TRANSLATED rather than
      // as the stored token. `flashing` on a screen is a raw value reaching an
      // operator, which is the same defect as a raw message key.
      field: 'observedState',
      labelKey: 'receptions.warning.observedState',
      kind: 'vocabulary',
      vocabularyPrefix: 'receptions.warningState.',
    },
    { field: 'note', labelKey: 'receptions.finding.note', kind: 'text' },
  ],
  leak: [
    { field: 'leakType', labelKey: 'receptions.leak.type', kind: 'text' },
    { field: 'vehicleZone', labelKey: 'receptions.finding.zone', kind: 'text' },
    {
      field: 'severity',
      labelKey: 'receptions.finding.severity',
      kind: 'vocabulary',
      vocabularyPrefix: 'receptions.findingSeverity.',
    },
    { field: 'note', labelKey: 'receptions.finding.note', kind: 'text' },
  ],
};

/**
 * One published field of a union row, as a string — or `null`.
 *
 * `ConditionEvidenceEntry` is an open index type (`[field: string]: unknown`)
 * because eight different payloads are flattened into one row shape. So a
 * renderer must ask rather than assume, and it must refuse anything that is not
 * a primitive: `String({})` is `"[object Object]"`, which renders as a plausible
 * value for a field that carried something else entirely.
 *
 * Numbers are stringified rather than formatted. Every numeric this union
 * publishes already arrives `::text` for exactness (`coordX`, `coordY`), and
 * `quantity` is an integer count — formatting either through a locale would put
 * a second authority in the product for a value the database rendered once.
 */
export function primitiveField(row: ConditionEvidenceEntry, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length === 0 ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return null;
}

/** The fields to render for a row, given the kind it declares. */
export function rowFieldsFor(kind: string): readonly EvidenceRowField[] {
  return (EVIDENCE_ROW_FIELDS as Record<string, readonly EvidenceRowField[]>)[kind] ?? [];
}

/* ------------------------------------------------------------------ *
 * Session capture — what the write responses said, held in memory
 * ------------------------------------------------------------------ */

/**
 * One thing this session recorded.
 *
 * `summary` is the operator's own input, kept ONLY in the browser tab that
 * typed it. It is not a read-back and the steps never label it as one.
 */
export interface SessionEvidence {
  readonly evidenceId: string;
  readonly kind: EvidenceKind;
  readonly summary: string;
}

/**
 * Appends a capture, refusing a duplicate id.
 *
 * The duplicate is not hypothetical: every one of these writes is
 * `idempotent: true`, and a REPLAY with the same key returns the STORED body at
 * 200 — the same `evidenceId`, for one stored row. A list that appended
 * unconditionally would show the operator two items where the platform holds
 * one, which is exactly the shape of "the interface disagrees with the record".
 */
export function appendSessionEvidence(
  captured: readonly SessionEvidence[],
  entry: SessionEvidence
): readonly SessionEvidence[] {
  if (captured.some((existing) => existing.evidenceId === entry.evidenceId)) return captured;
  return [...captured, entry];
}

/** The captures of one kind, in the order they were recorded. */
export function sessionEvidenceOf(
  captured: readonly SessionEvidence[],
  kind: EvidenceKind
): readonly SessionEvidence[] {
  return captured.filter((entry) => entry.kind === kind);
}

/* ------------------------------------------------------------------ *
 * Damage-mark coordinates — fractions of the map, `0..1` inclusive
 * ------------------------------------------------------------------ */

/**
 * A coordinate the contract will accept, or `null`.
 *
 * `MIN_COORD`/`MAX_COORD` are the contract's own bounds and the reason they
 * exist is stated there: a mark is stored as a FRACTION of the map so it
 * survives the map being resized. Nothing here rounds — a mark placed at
 * `0.3333` is stored at `0.3333`; the database column decides its own scale.
 */
export function parseCoordinate(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_COORD || value > MAX_COORD) return null;
  return value;
}

/** Holds a value inside the contract's bounds. Used by the pointer and the keyboard. */
export function clampCoordinate(value: number): number {
  if (!Number.isFinite(value)) return MIN_COORD;
  return Math.min(MAX_COORD, Math.max(MIN_COORD, value));
}

/**
 * A coordinate string with a fixed, keyboard-friendly precision.
 *
 * Two decimals is the PRECISION the diagram writes at — the pointer and the
 * arrow keys both round to hundredths here — and the precision of the read-out
 * beside it. It is NOT a bound on what may be submitted, and it is not the
 * keyboard's step either: `DamageMapStep.KEYBOARD_STEP` is `0.05`, and it is
 * expressible at this precision rather than defined by it.
 * `parseCoordinate` accepts any value in range and `DamageMapStep` sends the
 * operator's own text, so a mark typed as `0.125` travels as `0.125`.
 *
 * Assembled from an integer rather than with `.toFixed(2)`, which the P1-26
 * `float-money` gate rule refuses across `apps/web/src`. The rule's subject is
 * money and a map coordinate is not money — but the answer to a rule whose
 * premise does not apply is not an exemption, which blinds it to this file
 * forever. There is nothing `.toFixed` was doing here that integer arithmetic
 * cannot: round to hundredths once, then print the two halves.
 */
export function formatCoordinate(value: number): string {
  const hundredths = Math.round(clampCoordinate(value) * 100);
  const whole = Math.floor(hundredths / 100);
  const rest = String(hundredths % 100).padStart(2, '0');
  return `${whole}.${rest}`;
}

/* ------------------------------------------------------------------ *
 * Vehicle contents — the pair rule the database states as a CHECK
 * ------------------------------------------------------------------ */

/** The contents form's raw strings, before anything is sent. */
export interface ContentsDraft {
  readonly itemDescription: string;
  readonly quantity: string;
  readonly location: string;
  readonly declaredValue: string;
  readonly declaredCurrency: string;
}

/**
 * What is wrong with a contents draft, by field name, as translation keys.
 *
 * A mirror of the route schema and of `ck_vehicle_content_details_currency` —
 * "a currency is only meaningful WITH a value" — restated locally so the
 * refusal lands on the control that produced it instead of arriving as an
 * opaque 422 after a request was spent.
 *
 * It is a MIRROR, not a tightening: the upper bounds are the contract's own
 * (`MAX_DECLARED_VALUE`, and `quantity` a positive integer), and nothing here
 * decides anything the server would decide against rows this process cannot
 * see.
 */
export function contentsProblems(draft: ContentsDraft): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {};

  if (draft.itemDescription.trim() === '') {
    problems['itemDescription'] = 'field.required';
  }

  const quantity = draft.quantity.trim();
  if (quantity !== '') {
    const parsed = Number(quantity);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      problems['quantity'] = 'receptions.contents.error.quantity';
    }
  }

  const rawValue = draft.declaredValue.trim();
  let hasValue = false;
  if (rawValue !== '') {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_DECLARED_VALUE) {
      problems['declaredValue'] = 'receptions.contents.error.declaredValue';
    } else {
      hasValue = true;
    }
  }

  const currency = draft.declaredCurrency.trim();
  if (currency !== '') {
    if (!/^[A-Za-z]{3}$/.test(currency)) {
      problems['declaredCurrency'] = 'receptions.contents.error.currencyFormat';
    } else if (!hasValue) {
      // `ck_vehicle_content_details_currency`. Against the CURRENCY control,
      // because that is the one the operator can clear if what they meant was
      // an item with no declared value.
      problems['declaredCurrency'] = 'receptions.contents.error.currencyWithoutValue';
    }
  }

  return problems;
}

/** The contract-shaped optional fields of a valid contents draft. */
export function contentsOptionalFields(draft: ContentsDraft): {
  readonly quantity?: number;
  readonly location?: string;
  readonly declaredValue?: number;
  readonly declaredCurrency?: string;
} {
  const quantity = draft.quantity.trim();
  const location = draft.location.trim();
  const declaredValue = draft.declaredValue.trim();
  const declaredCurrency = draft.declaredCurrency.trim();

  return {
    // Omitted, never blanked: the route schemas are `.strict()` and every one of
    // these is `optional()` rather than nullable, so an untouched control must
    // leave the key off the body entirely.
    ...(quantity === '' ? {} : { quantity: Number(quantity) }),
    ...(location === '' ? {} : { location }),
    ...(declaredValue === '' ? {} : { declaredValue: Number(declaredValue) }),
    ...(declaredCurrency === '' ? {} : { declaredCurrency: declaredCurrency.toUpperCase() }),
  };
}

/* ------------------------------------------------------------------ *
 * Guards over this module's own tables
 * ------------------------------------------------------------------ */

/**
 * Problems with the coverage table itself — asserted by the test, not trusted.
 *
 * Every contract kind exactly once, in both directions, and a `blocked` or
 * `data_gated` row must carry the statement it promises to put on screen.
 */
export function coverageProblems(
  coverage: readonly EvidenceKindCoverage[] = EVIDENCE_KIND_COVERAGE
): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const row of coverage) {
    if (seen.has(row.kind)) problems.push(`duplicate kind: ${row.kind}`);
    seen.add(row.kind);
    if (!EVIDENCE_KINDS.includes(row.kind)) {
      problems.push(`kind not in the contract: ${row.kind}`);
    }
    if (row.status === 'wired') {
      if (row.noticeKey !== null) {
        problems.push(`wired kind ${row.kind} carries an unavailability notice`);
      }
    } else if (row.noticeKey === null) {
      problems.push(`${row.status} kind ${row.kind} states no reason`);
    }
    if (!row.task.startsWith('P1-28-FE-')) {
      problems.push(`kind ${row.kind} names no canonical task: ${row.task}`);
    }
  }

  for (const kind of EVIDENCE_KINDS) {
    if (!seen.has(kind)) problems.push(`contract kind not covered: ${kind}`);
  }

  return problems;
}
