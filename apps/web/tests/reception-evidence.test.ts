import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  EVIDENCE_KIND_COVERAGE,
  EVIDENCE_ROW_FIELDS,
  RESTRICTED_NARRATIVE_KINDS,
  appendSessionEvidence,
  clampCoordinate,
  contentsOptionalFields,
  contentsProblems,
  coverageOf,
  coverageProblems,
  formatCoordinate,
  isRestrictedNarrative,
  parseCoordinate,
  primitiveField,
  rowFieldsFor,
  sessionEvidenceOf,
  type ContentsDraft,
  type EvidenceKindCoverage,
  type SessionEvidence,
} from '@/features/receptions/check-in/evidence';
import { CHECK_IN_STEPS } from '@/features/receptions/check-in/steps';
import {
  EVIDENCE_KINDS,
  LEAK_TYPES,
  MAX_DECLARED_VALUE,
  WARNING_LIGHT_STATES,
  type ConditionEvidenceEntry,
} from '@/features/receptions/receptions-contract';

/**
 * Pre-service condition evidence, held without a DOM (`P1-28-FE-010`…`FE-016`).
 *
 * The centre of this file is the KIND-COVERAGE check. Wave E claims the eight
 * evidence kinds are accounted for; a table saying so proves nothing, so every
 * row is held against the contract's own vocabulary, against the registered
 * steps, and against the owning step's SOURCE — a `wired` or `data_gated` row
 * whose step does not construct that kind fails, and a `blocked` row whose step
 * does construct one fails too. The claim and the code cannot drift apart
 * quietly.
 *
 * ## The `blocked` direction is proved on a PLANTED row, because none is left
 *
 * `damage_map` was the only kind that ever carried `blocked`, and `P1-OD-025`
 * resolving took it to `data_gated`: a branch with no published diagram still
 * has nothing to draw on, which is configuration rather than a missing
 * capability. So the partition is empty, and a loop over it would iterate
 * nothing while reading as though it checked something — the vacuous guard this
 * repository keeps being bitten by. The rule is kept as a function and applied
 * to the whole table, to a planted `blocked` row whose step demonstrably DOES
 * construct its kind, and to a compliant one it must accept.
 */

// The registry import pulls the step COMPONENTS, whose adapter modules reach
// `next/headers` at import time. Nothing here performs a request.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const STEP_DIR = join(process.cwd(), 'src', 'features', 'receptions', 'components', 'steps');

/** The source of the component a registered step renders. */
function stepSource(stepId: string): string {
  const step = CHECK_IN_STEPS.find((candidate) => candidate.id === stepId);
  if (step === undefined) throw new Error(`no registered step: ${stepId}`);
  // The component's own name IS the file name in this tree, so the mapping is
  // derived rather than restated — a renamed file fails here instead of quietly
  // reading a stale one.
  return readFileSync(join(STEP_DIR, `${step.Component.name}.tsx`), 'utf8');
}

/** Source with comments stripped, so a docblock naming a kind is not evidence. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * What is wrong with one row's `blocked` claim, or `null` when nothing is.
 *
 * `blocked` means there is no control at all, because the contract requires a
 * value nothing in this product can produce. A row saying that while its step
 * builds the kind is a label on a control that in fact ships — an operator told
 * a capability is absent while looking straight at it — and it is the direction
 * the positive case cannot see, because that one skips blocked rows.
 *
 * A function rather than a loop body so the rule survives its own partition
 * going empty: it is applied below to every real row, to a planted breach and to
 * a compliant blocked row, neither of which the table currently contains.
 */
function blockedClaimProblem(row: EvidenceKindCoverage): string | null {
  if (row.status !== 'blocked') return null;
  return code(stepSource(row.stepId)).includes(`kind: '${row.kind}'`)
    ? `${row.kind} is called blocked, and ${row.stepId} constructs it`
    : null;
}

function entry(over: Record<string, unknown> = {}): ConditionEvidenceEntry {
  return {
    kind: 'complaint',
    id: 'ev-1',
    recordedAt: '2026-08-13T09:00:00.000Z',
    evidenceDocumentId: null,
    ...over,
  };
}

function draft(over: Partial<ContentsDraft> = {}): ContentsDraft {
  return {
    itemDescription: 'Sunglasses',
    quantity: '',
    location: '',
    declaredValue: '',
    declaredCurrency: '',
    ...over,
  };
}

/* --- kind coverage --------------------------------------------------------- */

describe('evidence kind coverage — the claim, checked against the code', () => {
  it('holds its own table', () => {
    expect(coverageProblems()).toEqual([]);
  });

  it('rejects a malformed table, so the guard is not vacuous', () => {
    // Built by LOOKUP, never by position. These rows have been reordered and
    // reclassified once already, and an index that quietly starts naming a
    // different row changes what a negative test proves without changing a
    // character of it.
    const wired = coverageOf('complaint');
    const gated = EVIDENCE_KIND_COVERAGE.find((row) => row.status !== 'wired');
    expect(wired?.status).toBe('wired');
    expect(gated?.noticeKey, 'no row states a reason, so the third case is empty').toBeTruthy();
    const bad = [
      { ...wired! },
      // A duplicate kind, a wired row carrying an excuse, a gated row that
      // states no reason, and a row naming no canonical task.
      { ...wired!, noticeKey: 'receptions.evidence.readOnly' },
      { ...gated!, noticeKey: null },
      { ...coverageOf('inspection')!, task: 'somewhere' },
    ];
    const problems = coverageProblems(bad);
    expect(problems.some((p) => p.includes('duplicate kind'))).toBe(true);
    expect(problems.some((p) => p.includes('carries an unavailability notice'))).toBe(true);
    expect(problems.some((p) => p.includes('states no reason'))).toBe(true);
    expect(problems.some((p) => p.includes('names no canonical task'))).toBe(true);
    expect(problems.some((p) => p.includes('not covered'))).toBe(true);
  });

  it('covers every contract kind exactly once, and invents none', () => {
    expect([...EVIDENCE_KIND_COVERAGE].map((row) => row.kind).sort()).toEqual(
      [...EVIDENCE_KINDS].sort()
    );
  });

  it('names a REGISTERED step for every kind', () => {
    const ids = new Set(CHECK_IN_STEPS.map((step) => step.id));
    for (const row of EVIDENCE_KIND_COVERAGE) {
      expect(ids.has(row.stepId), `${row.kind} -> ${row.stepId}`).toBe(true);
    }
  });

  it('every reachable kind is genuinely constructed by its own step, and submitted', () => {
    // The assertion the wave's coverage claim actually rests on. Not "a step
    // exists" — the step's source must build `kind: '<kind>'` AND call the
    // condition-evidence adapter, with comments stripped so a docblock naming a
    // kind is not mistaken for a call site (the P1-27 scanner defect, six times).
    let checked = 0;
    for (const row of EVIDENCE_KIND_COVERAGE) {
      if (row.status === 'blocked') continue;
      const source = code(stepSource(row.stepId));
      expect(source, `${row.kind} is not constructed by ${row.stepId}`).toContain(
        `kind: '${row.kind}'`
      );
      expect(source, `${row.stepId} never calls the evidence adapter`).toContain(
        'recordConditionEvidence('
      );
      checked += 1;
    }
    // The guard on the skip. Nothing carries `blocked` any more, so this loop
    // owes the WHOLE contract vocabulary — and `damage_map`, which the skip
    // exempted for as long as it was blocked, is inside its scope for the first
    // time here rather than by anyone's say-so.
    expect(checked, 'a skipped row left part of the vocabulary unchecked').toBe(
      EVIDENCE_KINDS.length
    );
  });

  it('rejects a BLOCKED kind whose step constructs it, on a planted row', () => {
    // Every real row satisfies the rule — trivially today, since none is
    // blocked, which is exactly why the two constructed rows below are what the
    // rule is actually proved by.
    for (const row of EVIDENCE_KIND_COVERAGE) {
      expect(blockedClaimProblem(row), row.kind).toBeNull();
    }

    // The breach: `damage_map` relabelled `blocked` while `DamageMapStep` goes
    // on building it. That the rule REJECTS this is also the proof that the
    // step constructs the kind — the problem is returned on nothing else.
    const relabelled: EvidenceKindCoverage = { ...coverageOf('damage_map')!, status: 'blocked' };
    expect(blockedClaimProblem(relabelled)).toContain('damage_map');
    expect(blockedClaimProblem(relabelled)).toContain('condition-damage');

    // And the compliant shape it must ACCEPT: a blocked row naming a step whose
    // source does not build the kind, which is what a genuinely unproducible
    // kind would look like if one returned.
    const unbuilt: EvidenceKindCoverage = {
      ...coverageOf('contents')!,
      stepId: 'condition-damage',
      status: 'blocked',
    };
    expect(blockedClaimProblem(unbuilt)).toBeNull();

    // Positively, and loudly: nothing in this release is blocked. A commit that
    // re-blocks a kind has to change this line and say which decision reopened.
    expect(
      EVIDENCE_KIND_COVERAGE.filter((row) => row.status === 'blocked').map((row) => row.kind)
    ).toEqual([]);
  });

  it('states every gated or blocked reason in BOTH catalogues', () => {
    for (const row of EVIDENCE_KIND_COVERAGE) {
      if (row.noticeKey === null) continue;
      expect(EN[row.noticeKey], `${row.noticeKey} missing from en`).toBeTruthy();
      expect(AR[row.noticeKey], `${row.noticeKey} missing from ar`).toBeTruthy();
    }
  });

  it('classifies the two kinds a fresh install cannot yet deliver, and says why', () => {
    /*
     * Named explicitly rather than derived, because these two are the wave's
     * honest partials and a silent reclassification is exactly what these rows
     * exist to make loud. `damage_map` is the reclassification: it was `blocked`
     * on `P1-OD-025`, and with the decision resolved a template document CAN be
     * registered — what a fresh install lacks is a published diagram to draw on,
     * which is the same shape as `warning_light`'s empty code catalogue. Both
     * are configuration, and both are stated on screen.
     *
     * The two reach an operator by different routes, so each is asserted where
     * it is: `DamageMapStep` renders its notice as its own empty state, while
     * `WarningLightsStep` passes the kind to `CoverageNotice`, which reads the
     * key back out of this very table. Asserting the key without the render is
     * how `receptions.evidence.damageMapBlocked` survived as copy no screen
     * showed.
     */
    const damageMap = coverageOf('damage_map');
    expect(damageMap).toMatchObject({
      status: 'data_gated',
      noticeKey: 'receptions.damage.templateNone',
    });
    expect(code(stepSource('condition-damage')), 'the damage notice is not rendered').toContain(
      damageMap!.noticeKey!
    );

    expect(coverageOf('warning_light')).toMatchObject({
      status: 'data_gated',
      noticeKey: 'receptions.evidence.warningCatalogueEmpty',
    });
    expect(
      code(stepSource('condition-warning-lights')),
      'the warning-light notice is not rendered'
    ).toContain('kind="warning_light"');

    expect(coverageOf('complaint')?.status).toBe('wired');
    // The retired key is gone from both catalogues, not merely unreferenced:
    // copy that states an open decision is the stale prose this phase keeps
    // finding, and it reads as true for as long as it is translated.
    for (const [catalogue, name] of [
      [EN, 'en'],
      [AR, 'ar'],
    ] as const) {
      expect(catalogue['receptions.evidence.damageMapBlocked'], `${name} still carries it`).toBe(
        undefined
      );
    }
  });
});

/* --- the restricted narratives --------------------------------------------- */

describe('restricted narrative', () => {
  it('names exactly the two kinds whose detail table the read never selects', () => {
    expect([...RESTRICTED_NARRATIVE_KINDS].sort()).toEqual(['complaint', 'contents']);
    expect(isRestrictedNarrative('complaint')).toBe(true);
    expect(isRestrictedNarrative('contents')).toBe(true);
    expect(isRestrictedNarrative('leak')).toBe(false);
  });

  it('publishes no field the read cannot return', () => {
    // The mirror is of the READ, not of the write. A label for `complaintText`
    // or `declaredValue` would render an empty row for a field that is behind
    // `iam.sensitive.view` and never selected.
    const fields = Object.values(EVIDENCE_ROW_FIELDS).flatMap((list) =>
      list.map((field) => field.field)
    );
    for (const withheld of [
      'complaintText',
      'itemDescription',
      'declaredValue',
      'declaredCurrency',
      'declaredByPartnerId',
    ]) {
      expect(fields, `${withheld} is not returned by the list`).not.toContain(withheld);
    }
  });

  it('reads a CLOSED database vocabulary back translated, never as the stored token', () => {
    /*
     * `brake_fluid` or `flashing` printed on a read-back is an internal name
     * reaching an operator — the same defect as a raw message key, and the
     * mirror image of the capture-side defect that let those fields be free
     * text in the first place.
     *
     * Bound to the CONTRACT constants rather than to a list here, so a member
     * added to either vocabulary must be translated in both catalogues before
     * this passes. The assertion beside this one cannot see any of it: it only
     * checks that a `vocabulary` field names SOME prefix, so a field declared
     * `text` — which is what both of these were — is invisible to it.
     */
    const closed = [
      {
        kind: 'leak',
        field: 'leakType',
        prefix: 'receptions.leakType.',
        members: LEAK_TYPES as readonly string[],
      },
      {
        kind: 'warning_light',
        field: 'observedState',
        prefix: 'receptions.warningState.',
        members: WARNING_LIGHT_STATES as readonly string[],
      },
    ] as const;

    for (const entry of closed) {
      const declared = rowFieldsFor(entry.kind).find((field) => field.field === entry.field);
      expect(declared, `${entry.kind}.${entry.field} is not published at all`).toBeDefined();
      expect(
        declared?.kind,
        `${entry.kind}.${entry.field} is read back as a raw stored value`
      ).toBe('vocabulary');
      expect(declared?.vocabularyPrefix).toBe(entry.prefix);
      for (const member of entry.members) {
        const key = `${entry.prefix}${member}`;
        expect(EN[key], `${key} missing from en`).toBeTruthy();
        expect(AR[key], `${key} missing from ar`).toBeTruthy();
      }
    }
  });

  it('labels every published field from both catalogues', () => {
    for (const [kind, fields] of Object.entries(EVIDENCE_ROW_FIELDS)) {
      for (const field of fields) {
        expect(EN[field.labelKey], `${kind}.${field.field} missing from en`).toBeTruthy();
        expect(AR[field.labelKey], `${kind}.${field.field} missing from ar`).toBeTruthy();
        if (field.kind === 'vocabulary') {
          expect(field.vocabularyPrefix, `${kind}.${field.field} has no prefix`).toBeTruthy();
        }
      }
    }
  });
});

/* --- reading a union row ---------------------------------------------------- */

describe('primitiveField — asking the open row shape rather than assuming it', () => {
  it('returns strings, numbers and booleans', () => {
    expect(primitiveField(entry({ category: 'noise' }), 'category')).toBe('noise');
    expect(primitiveField(entry({ quantity: 2 }), 'quantity')).toBe('2');
    expect(primitiveField(entry({ anomaly: false }), 'anomaly')).toBe('false');
  });

  it('refuses absent, null and empty values', () => {
    expect(primitiveField(entry(), 'severity')).toBeNull();
    expect(primitiveField(entry({ severity: null }), 'severity')).toBeNull();
    expect(primitiveField(entry({ note: '' }), 'note')).toBeNull();
  });

  it('refuses anything that is not a primitive', () => {
    // `String({})` is "[object Object]", which renders as a plausible value for
    // a field that carried something else entirely.
    expect(primitiveField(entry({ scope: {} }), 'scope')).toBeNull();
    expect(primitiveField(entry({ list: [1, 2] }), 'list')).toBeNull();
    expect(primitiveField(entry({ bad: Number.NaN }), 'bad')).toBeNull();
  });

  it('renders exact numerics as received, never reformatted', () => {
    // `coordX`/`coordY` arrive `::text` because they are `numeric`; a locale
    // formatter here would be a second authority on an exact value.
    expect(primitiveField(entry({ coordX: '0.3333' }), 'coordX')).toBe('0.3333');
  });

  it('knows the fields of each kind and nothing about an unknown one', () => {
    expect(rowFieldsFor('leak').map((field) => field.field)).toEqual([
      'leakType',
      'vehicleZone',
      'severity',
      'note',
    ]);
    expect(rowFieldsFor('not-a-kind')).toEqual([]);
  });
});

/* --- session capture -------------------------------------------------------- */

describe('session capture — what the write responses said', () => {
  const one: SessionEvidence = { evidenceId: 'ev-1', kind: 'complaint', summary: 'It squeaks' };

  it('appends in order', () => {
    const two: SessionEvidence = { evidenceId: 'ev-2', kind: 'complaint', summary: 'And rattles' };
    expect(appendSessionEvidence(appendSessionEvidence([], one), two)).toEqual([one, two]);
  });

  it('refuses a duplicate id — an idempotent REPLAY returns the stored row', () => {
    // Every evidence write is `idempotent: true`: a replay with the same key
    // answers 200 with the SAME `evidenceId` for ONE stored row. Appending
    // unconditionally would show two items where the platform holds one.
    const captured = appendSessionEvidence([], one);
    expect(appendSessionEvidence(captured, { ...one, summary: 'different text' })).toBe(captured);
  });

  it('filters by kind', () => {
    const leak: SessionEvidence = { evidenceId: 'ev-3', kind: 'leak', summary: 'oil — front' };
    const all = appendSessionEvidence(appendSessionEvidence([], one), leak);
    expect(sessionEvidenceOf(all, 'leak')).toEqual([leak]);
    expect(sessionEvidenceOf(all, 'contents')).toEqual([]);
  });
});

/* --- damage-mark coordinates ------------------------------------------------ */

describe('damage-mark coordinates — fractions of the map, 0..1 inclusive', () => {
  it('accepts both bounds and anything between', () => {
    expect(parseCoordinate('0')).toBe(0);
    expect(parseCoordinate('1')).toBe(1);
    expect(parseCoordinate(' 0.125 ')).toBe(0.125);
  });

  it('refuses anything outside the contract bounds, and anything unreadable', () => {
    for (const value of ['-0.01', '1.01', '2', 'half', '', '   ']) {
      expect(parseCoordinate(value), value).toBeNull();
    }
  });

  it('does NOT round what it accepts', () => {
    // The database column owns the scale. Rounding here would store a mark
    // somewhere the operator did not put it.
    expect(parseCoordinate('0.3333')).toBe(0.3333);
  });

  it('clamps a pointer or keyboard move into range', () => {
    expect(clampCoordinate(-1)).toBe(0);
    expect(clampCoordinate(5)).toBe(1);
    expect(clampCoordinate(0.4)).toBe(0.4);
    expect(clampCoordinate(Number.NaN)).toBe(0);
  });

  it('formats to the keyboard step without bounding what may be submitted', () => {
    expect(formatCoordinate(0.5)).toBe('0.50');
    expect(formatCoordinate(1.4)).toBe('1.00');
    expect(parseCoordinate('0.125')).toBe(0.125);
  });
});

/* --- vehicle contents ------------------------------------------------------- */

describe('contentsProblems — the route schema and the currency CHECK, mirrored', () => {
  it('passes a clean draft', () => {
    expect(contentsProblems(draft())).toEqual({});
    expect(
      contentsProblems(draft({ quantity: '2', declaredValue: '40', declaredCurrency: 'jod' }))
    ).toEqual({});
  });

  it('requires the item description', () => {
    expect(contentsProblems(draft({ itemDescription: '   ' }))).toEqual({
      itemDescription: 'field.required',
    });
  });

  it('refuses a quantity that is not a positive whole number', () => {
    for (const quantity of ['0', '-1', '1.5', 'two']) {
      expect(contentsProblems(draft({ quantity })), quantity).toMatchObject({
        quantity: 'receptions.contents.error.quantity',
      });
    }
  });

  it('refuses a declared value below zero or beyond the contract bound', () => {
    expect(contentsProblems(draft({ declaredValue: '-1' }))).toMatchObject({
      declaredValue: 'receptions.contents.error.declaredValue',
    });
    expect(
      contentsProblems(draft({ declaredValue: String(MAX_DECLARED_VALUE + 1) }))
    ).toMatchObject({ declaredValue: 'receptions.contents.error.declaredValue' });
  });

  it('refuses a currency that is not three letters', () => {
    expect(contentsProblems(draft({ declaredValue: '5', declaredCurrency: 'JO' }))).toMatchObject({
      declaredCurrency: 'receptions.contents.error.currencyFormat',
    });
  });

  it('refuses a currency with no value beside it — ck_vehicle_content_details_currency', () => {
    // Against the CURRENCY control, which is the one an operator can clear if
    // what they meant was an item with no declared value.
    expect(contentsProblems(draft({ declaredCurrency: 'JOD' }))).toEqual({
      declaredCurrency: 'receptions.contents.error.currencyWithoutValue',
    });
    // And an invalid VALUE does not silently make the currency legal.
    expect(contentsProblems(draft({ declaredValue: '-2', declaredCurrency: 'JOD' }))).toMatchObject(
      {
        declaredCurrency: 'receptions.contents.error.currencyWithoutValue',
      }
    );
  });

  it('states every problem it can name in both catalogues', () => {
    const keys = new Set(
      [
        contentsProblems(draft({ itemDescription: '' })),
        contentsProblems(draft({ quantity: '0' })),
        contentsProblems(draft({ declaredValue: '-1' })),
        contentsProblems(draft({ declaredValue: '5', declaredCurrency: 'J' })),
        contentsProblems(draft({ declaredCurrency: 'JOD' })),
      ].flatMap((problems) => Object.values(problems))
    );
    expect(keys.size).toBeGreaterThan(3);
    for (const key of keys) {
      expect(EN[key], `${key} missing from en`).toBeTruthy();
      expect(AR[key], `${key} missing from ar`).toBeTruthy();
    }
  });
});

describe('contentsOptionalFields — omitted, never blanked', () => {
  it('leaves every untouched control off the body', () => {
    // The route schemas are `.strict()` and each of these is `optional()`, not
    // nullable: sending an empty string or a null would be a 422 for a control
    // nobody touched.
    expect(contentsOptionalFields(draft())).toEqual({});
  });

  it('sends what was typed, as numbers, with the currency normalised', () => {
    expect(
      contentsOptionalFields(
        draft({
          quantity: '3',
          location: '  glovebox ',
          declaredValue: '125.5',
          declaredCurrency: 'jod',
        })
      )
    ).toEqual({
      quantity: 3,
      location: 'glovebox',
      declaredValue: 125.5,
      declaredCurrency: 'JOD',
    });
  });
});
