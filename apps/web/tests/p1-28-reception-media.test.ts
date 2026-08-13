import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  MEDIA_CAPTURE_STATUS,
  MEDIA_DECISION_ID,
  MEDIA_DECISION_KEYS,
  MEDIA_SURFACE_KEYS,
} from '@/features/receptions/media/media-decision';
import { CHECK_IN_STEPS } from '@/features/receptions/check-in/steps';
import { SIGNATURE_CAPTURE_METHODS } from '@/features/receptions/receptions-contract';

/**
 * `P1-28-FE-017` — the media capture BAN, proved over the source
 * (`TC-P1-28-REC-009`).
 *
 * `FE-017` ships no feature. `P1-OD-025` is an open Owner decision that owns the
 * accepted file kinds, the size ceilings and the storage placement, the Owner's
 * own media rows are Blocked, and the attachment chain behind them is
 * dead-ended in two independent places. The deliverable is the notice, and the
 * thing worth testing is therefore the ABSENCE — which a rendered-DOM assertion
 * alone cannot establish, because a control that renders conditionally is
 * invisible to whichever branch the test happened to take.
 *
 * ## The rules are READ from the gate, never restated here
 *
 * `no-upload-path` and `no-invented-media-limit` are the specification
 * (the `RULES` table of `scripts/ci/check-p1-27-frontend.mjs`). Restating them here
 * would produce a test that proves a smaller rule with the same name — the exact
 * defect P1-27 found in its own console case. So the gate module is imported and
 * its rules are applied as they stand.
 *
 * ## …and the gate now reaches this tree too (`O2`)
 *
 * It did not, when this suite was written: the gate's roots were
 * `features/crm`, `features/vehicles` and the dashboard routes, and
 * `features/receptions/**` was collected by none of them — so `no-upload-path`
 * and `no-invented-media-limit` reported clean over a tree they had never
 * opened, and the only thing enforcing them here was this file, which one commit
 * can delete alongside the code it guards.
 *
 * `features/receptions` is now an ADOPTED root (`ADOPTED_ROOTS` in the gate),
 * declared by P1-28's own canonical plan rather than smuggled into P1-27's. That
 * is asserted below rather than assumed, in both directions: the gate collects
 * the tree, and the media rules are among the rules that read it.
 *
 * This file remains the DOM-independent proof of the absence, and it still holds
 * the one thing the gate cannot (below). The two now overlap by design: a gate
 * cannot be deleted with the code, and a test can see what no regex can.
 *
 * ## One gap in the gate, measured rather than asserted away
 *
 * The seven `FILE_ACCESS_CONSTRUCTS` cover file INPUT and drag-drop. None of them
 * covers a camera: `navigator.mediaDevices.getUserMedia`, an `ImageCapture`, a
 * `<video>` preview or the `capture` attribute all pass every gate rule. The gap
 * is pinned as a measurement below, and the camera ban for this tree is enforced
 * here. Widening the gate's rule TABLE is still not this wave's to do — the rule
 * count is a published document marker — so the gap is reported to the
 * coordinator rather than closed by adding a ninth rule.
 */

/** The web workspace root; `process.cwd()` is `apps/web` under Vitest. */
const WEB = process.cwd();
const REPO = join(WEB, '..', '..');

/**
 * The reception surface: the feature tree and the two routes that mount it.
 *
 * Written as real path segments — `[locale]` and `(dashboard)` are directory
 * names on disk, not a character class and a group, and a glob spelling of them
 * matches nothing (the trap `vitest.config.ts` already records).
 */
const SURFACE_ROOTS = [
  join('src', 'features', 'receptions'),
  join('src', 'app', '[locale]', '(dashboard)', 'receptions'),
  join('src', 'app', '[locale]', '(dashboard)', 'reception'),
];

const MEDIA_MODULE = join('src', 'features', 'receptions', 'media');

function walk(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every reception source, keyed by a workspace-relative path for readable pins. */
const SURFACE = SURFACE_ROOTS.flatMap((root) =>
  walk(join(WEB, root)).map((absolute) => ({
    path: absolute
      .slice(WEB.length + 1)
      .split(sep)
      .join('/'),
    source: readFileSync(absolute, 'utf8'),
  }))
);

interface GateRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly what: string;
}

/*
 * Imported at runtime rather than with a static specifier: the web package sets
 * `allowJs: false`, so a static import of a `.mjs` outside `src` is `TS2307` in
 * `typecheck:web` — the check would be bought at the price of a broken build.
 */
const GATE = (await import(
  pathToFileURL(join(REPO, 'scripts', 'ci', 'check-p1-27-frontend.mjs')).href
)) as {
  readonly RULES: readonly GateRule[];
  readonly SCAN_ROOTS: readonly string[];
  readonly ADOPTED_ROOTS: readonly { root: string; authority: string; phase: string }[];
  readonly collects: (path: string) => boolean;
  readonly inRuleScope: (rule: GateRule, path: string) => boolean;
  readonly stripComments: (source: string) => string;
  readonly evaluate: (files: readonly { path: string; source: string }[]) => {
    readonly failures: readonly string[];
  };
};

/** The rules that ARE the `P1-OD-025` specification, plus the download half. */
const MEDIA_RULE_IDS = ['no-upload-path', 'no-invented-media-limit', 'no-export-surface'] as const;

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/** Every media key this wave introduced, derived from the module, not listed twice. */
const MEDIA_KEYS = [
  'receptions.media.heading',
  'receptions.media.blocked',
  'receptions.media.decisionLabel',
  'receptions.media.decideHeading',
  'receptions.media.afterDecision',
  'receptions.media.ceiling',
  'receptions.steps.media.title',
  'receptions.steps.media.description',
  ...Object.values(MEDIA_SURFACE_KEYS),
  ...MEDIA_DECISION_KEYS,
];

/* ------------------------------------------------------------------ *
 * The surface, and what enforces it
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — the surface this suite measures', () => {
  it('collects the whole reception tree, including the media module', () => {
    // Guards the measurement itself: a walk that silently returned nothing would
    // make every absence case below pass while examining no file at all.
    expect(SURFACE.length).toBeGreaterThan(15);
    for (const required of [
      'src/features/receptions/media/media-decision.ts',
      'src/features/receptions/media/MediaDecisionNotice.tsx',
      'src/features/receptions/components/steps/MediaStep.tsx',
      'src/features/receptions/check-in/steps.tsx',
      'src/app/[locale]/(dashboard)/receptions/check-in/[receptionId]/page.tsx',
    ]) {
      expect(
        SURFACE.some((file) => file.path === required),
        required
      ).toBe(true);
    }
  });

  it('is enforced by the GATE as well, now that the reception tree is an adopted root (`O2`)', () => {
    /*
     * Stated as a measurement rather than as a claim. This case used to assert
     * the opposite — that no root collected `features/receptions`, so this file
     * was the only enforcement — and that was true and was the finding.
     *
     * Both halves are pinned: the tree is collected, and the media rules are
     * among the rules that read it. A rule narrowed away from this tree (the
     * gate's `roots`, which `no-client-asserted-scope` carries) would fail the
     * second half by name rather than quietly stop applying.
     */
    expect(
      GATE.collects('apps/web/src/app/[locale]/(dashboard)/receptions/check-in/page.tsx')
    ).toBe(true);
    expect(GATE.collects('apps/web/src/features/receptions/media/MediaDecisionNotice.tsx')).toBe(
      true
    );
    expect(GATE.SCAN_ROOTS.map((root) => root.split(sep).join('/'))).toContain(
      'apps/web/src/features/receptions'
    );
    expect(GATE.ADOPTED_ROOTS.map((entry) => entry.root.split(sep).join('/'))).toContain(
      'apps/web/src/features/receptions'
    );

    for (const id of MEDIA_RULE_IDS) {
      const rule = GATE.RULES.find((candidate) => candidate.id === id);
      expect(rule, `the gate has no ${id} rule`).toBeDefined();
      expect(
        GATE.inRuleScope(rule!, 'apps/web/src/features/receptions/media/MediaDecisionNotice.tsx'),
        `${id} does not read the reception tree`
      ).toBe(true);
    }
  });

  it('applies rules that exist and that fire — a clean sweep of nothing proves nothing', () => {
    for (const id of MEDIA_RULE_IDS) {
      const rule = GATE.RULES.find((candidate) => candidate.id === id);
      expect(rule, `the gate has no ${id} rule`).toBeDefined();
    }
    // Planted violations, one per rule, through the gate's own evaluator.
    const planted = GATE.evaluate([
      { path: 'apps/web/src/features/receptions/x.tsx', source: 'const b = new FormData();' },
      { path: 'apps/web/src/features/receptions/y.tsx', source: 'const MAX_FILE_SIZE_B = n;' },
      {
        path: 'apps/web/src/features/receptions/z.tsx',
        source: 'const u = URL.createObjectURL(b);',
      },
    ]);
    for (const id of MEDIA_RULE_IDS) {
      expect(
        planted.failures.filter((failure) => failure.startsWith(`${id}:`)),
        id
      ).toHaveLength(1);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The ban
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — no capture path anywhere on the reception surface', () => {
  it('has no upload path, no invented media limit and no export or download path', () => {
    const rules = MEDIA_RULE_IDS.map((id) => GATE.RULES.find((rule) => rule.id === id)!);
    for (const { path, source } of SURFACE) {
      const code = GATE.stripComments(source);
      for (const rule of rules) {
        expect(code, `${path} — ${rule.what}`).not.toMatch(rule.pattern);
      }
    }
  });

  it('has no camera construct — the gate does NOT cover these, so this case is the only guard', () => {
    /*
     * Measured, not assumed: the gate's `no-upload-path` is handed a real
     * camera path and does not fire. That is the gap; the second half of this
     * case is what closes it for this tree.
     */
    const uploadRule = GATE.RULES.find((rule) => rule.id === 'no-upload-path')!;
    expect(
      uploadRule.pattern.test('await navigator.mediaDevices.getUserMedia({ video: true });')
    ).toBe(false);

    const CAMERA =
      /getUserMedia|getDisplayMedia|mediaDevices|\bImageCapture\b|\bMediaStream\b|capture=|<video|<canvas/;
    for (const { path, source } of SURFACE) {
      expect(GATE.stripComments(source), `${path} builds a camera path`).not.toMatch(CAMERA);
    }
  });

  it('renders no control of any kind inside the notice — read from its own source', () => {
    /*
     * Not even a disabled one. A greyed-out camera button advertises a
     * capability the product does not have, and a disabled control is the single
     * most likely thing for a later commit to enable. The DOM twin of this case
     * can only see the branch it rendered; this one sees the file.
     */
    const notice = readFileSync(join(WEB, MEDIA_MODULE, 'MediaDecisionNotice.tsx'), 'utf8');
    const code = GATE.stripComments(notice);
    for (const control of [
      '<button',
      '<input',
      '<form',
      '<a ',
      '<video',
      '<canvas',
      'onClick',
      'disabled',
    ]) {
      expect(code, `the notice renders ${control}`).not.toContain(control);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The notice names the decision, and invents nothing
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — the named-open-decision notice', () => {
  it('names the decision as one closed value, not a feature flag', () => {
    expect(MEDIA_DECISION_ID).toBe('P1-OD-025');
    expect(MEDIA_CAPTURE_STATUS).toBe('blocked-on-p1-od-025');
  });

  it('is registered as a wizard step, so the operator meets it where they expect the camera', () => {
    const step = CHECK_IN_STEPS.find((candidate) => candidate.id === 'media-and-photographs');
    expect(step, 'the media step left the registry').toBeDefined();
    expect(step?.titleKey).toBe('receptions.steps.media.title');
    expect(step?.descriptionKey).toBe('receptions.steps.media.description');
  });

  it('carries every media key in BOTH catalogues, with real Arabic', () => {
    for (const key of MEDIA_KEYS) {
      expect(Object.keys(EN), key).toContain(key);
      expect(Object.keys(AR), key).toContain(key);
      expect(AR[key], `${key} was never translated`).not.toBe(EN[key]);
      expect(AR[key], `${key} carries no Arabic script`).toMatch(/[؀-ۿ]/);
    }
  });

  it('says it is blocked, names a decision, and states the pending ceiling', () => {
    const english = MEDIA_KEYS.map((key) => EN[key] ?? '')
      .join(' ')
      .toLowerCase();
    expect(english).toContain('blocked');
    expect(english).toContain('decision');
    expect(english).toContain('pending');
    // The three surfaces each say what specifically cannot be captured there.
    expect(Object.values(MEDIA_SURFACE_KEYS)).toHaveLength(3);
    for (const key of Object.values(MEDIA_SURFACE_KEYS)) {
      expect((EN[key] ?? '').length, key).toBeGreaterThan(40);
    }
  });

  it('is EXACTLY these fifteen strings, in both catalogues — any edit is a deliberate one', () => {
    /*
     * `H-F1`. This case used to be a pattern sweep: no Latin digit, and no
     * English unit word. Both halves were half-blind.
     *
     * A pattern can only refuse what it was taught to recognise, and the copy it
     * guards is bilingual: `٥ ميغابايت` carries no `\d` (Arabic-Indic digits are
     * a different block) and no `MB`, so an invented Arabic ceiling passed the
     * assertion cleanly. Widening the pattern only moves the boundary — the next
     * spelling (`ميجابايت`, `۵`, `ميغا بايت`) is outside it again.
     *
     * So the copy is PINNED instead. Every shipped string is written out here,
     * in both languages, and compared whole. A pattern has to anticipate the
     * invention; a pin cannot be evaded by one, because changing any of these
     * fifteen strings — or adding a sixteenth — turns this case red and has to
     * be answered by editing the expectation deliberately, where the change is
     * visible in the diff. `P1-OD-025` is the only thing that licenses such an
     * edit.
     */
    const shipped = Object.fromEntries(
      MEDIA_KEYS.map((key) => [key, { en: EN[key], ar: AR[key] }])
    );

    expect(shipped).toEqual({
      'receptions.media.heading': {
        en: 'Media capture is not available',
        ar: 'التقاط الوسائط غير متاح',
      },
      'receptions.media.blocked': {
        en: 'Capture is blocked. Nothing on this screen takes, chooses or records a picture or a file, and no control is offered for doing so.',
        ar: 'الالتقاط موقوف. لا شيء في هذه الشاشة يأخذ صورة أو ملفًا أو يختاره أو يسجّله، ولا يُعرض أي زر لذلك.',
      },
      'receptions.media.decisionLabel': {
        en: 'Blocked by an open Owner decision:',
        ar: 'موقوف بقرار مفتوح من المالك:',
      },
      'receptions.media.decideHeading': {
        en: 'What the Owner must decide',
        ar: 'ما الذي يجب أن يقرره المالك',
      },
      'receptions.media.afterDecision': {
        en: 'Once that decision is recorded, this area will register media against the visit and show the state of every item on the list.',
        ar: 'بعد تسجيل ذلك القرار، ستسجّل هذه المنطقة الوسائط على الزيارة وتعرض حالة كل عنصر في القائمة.',
      },
      'receptions.media.ceiling': {
        en: 'Even then, the truthful state of a registered file is pending: there is no storage provider and no file scan yet, so nothing can be retrieved back out.',
        ar: 'وحتى عندئذٍ تبقى الحالة الصادقة لأي ملف مسجَّل هي «قيد الانتظار»: لا يوجد مزوّد تخزين ولا فحص للملفات بعد، فلا يمكن استرجاع أي شيء منها.',
      },
      'receptions.steps.media.title': {
        en: 'Photographs and media',
        ar: 'الصور والوسائط',
      },
      'receptions.steps.media.description': {
        en: 'What would be recorded here, why it is not, and what the Owner must decide.',
        ar: 'ما الذي كان سيُسجَّل هنا، ولماذا لا يُسجَّل، وما الذي يجب أن يقرره المالك.',
      },
      'receptions.media.surface.evidence': {
        en: 'This is where the photographs taken at the desk would be recorded against the visit.',
        ar: 'هنا كانت الصور المأخوذة عند مكتب الاستقبال ستُسجَّل على الزيارة.',
      },
      'receptions.media.surface.damageMap': {
        en: 'A damage map needs a template document and its exact version. Neither can be produced in this release, so marks cannot be placed on one.',
        ar: 'خريطة الأضرار تحتاج إلى مستند نموذج وإلى إصدارٍ محدَّد منه، ولا يمكن إنتاج أيٍّ منهما في هذا الإصدار، فلا يمكن وضع العلامات عليها.',
      },
      'receptions.media.surface.signature': {
        en: 'A signature record needs a signature image and its exact version. Neither can be produced in this release.',
        ar: 'سجل التوقيع يحتاج إلى صورة توقيع وإلى إصدارٍ محدَّد منها، ولا يمكن إنتاج أيٍّ منهما في هذا الإصدار.',
      },
      'receptions.media.decide.set': {
        en: 'Which pictures a reception must carry, and which views make up the exterior set.',
        ar: 'ما الصور التي يجب أن تحملها زيارة الاستقبال، وما الجهات التي تتألف منها المجموعة الخارجية.',
      },
      'receptions.media.decide.formats': {
        en: 'Which file kinds are accepted, and the ceiling on how large a file may be.',
        ar: 'ما أنواع الملفات المقبولة، وما الحد الأقصى لحجم الملف.',
      },
      'receptions.media.decide.storage': {
        en: 'Where the files are held, in which region, and how long they are kept.',
        ar: 'أين تُحفظ الملفات، وفي أي منطقة، وكم تُبقى من مدة.',
      },
      'receptions.media.decide.enforcement': {
        en: 'Whether missing pictures prevent a reception from being approved.',
        ar: 'هل يمنع نقص الصور اعتماد زيارة الاستقبال.',
      },
    });
  });

  it('ships no SIXTEENTH media string that the pin above never saw', () => {
    /*
     * The pin is exhaustive only if `MEDIA_KEYS` is. A new
     * `receptions.media.*` key added to the catalogues and not to that list
     * would be copy nothing above examines — the invented ceiling arriving
     * through the one door the pin does not watch.
     */
    const catalogued = Object.keys(EN)
      .filter(
        (key) =>
          /^receptions\.(media|steps\.media)\./.test(key) || key === 'receptions.media.heading'
      )
      .sort();
    expect(catalogued).toEqual([...MEDIA_KEYS].sort());
  });

  it('invents no size, no file kind and no extension, in EITHER script', () => {
    /*
     * The pattern half, kept and widened. It is now a second net under the pin
     * rather than the only one, and it covers what the original could not see:
     *
     *   - Arabic-Indic (`٠-٩`) and Eastern Arabic-Indic (`۰-۹`) digits, which
     *     are not `\d` in JavaScript;
     *   - Arabic unit words, in both common spellings of each borrowing
     *     (`ميغابايت` / `ميجابايت`, with or without a space);
     *   - the English units and image formats the original already held.
     *
     * The decision identifier is a CONSTANT in the component, deliberately not
     * copy, so the digits in `P1-OD-025` cannot smuggle a ceiling in beside
     * them.
     */
    const ANY_DIGIT = /[0-9٠-٩۰-۹]/;
    const UNIT_OR_FORMAT =
      /jpe?g|png|heic|webp|mp4|\bMB\b|\bKB\b|\bGB\b|\bTB\b|megabytes?|kilobytes?|gigabytes?|ميغا\s?بايت|ميجا\s?بايت|كيلو\s?بايت|جيجا\s?بايت|جيغا\s?بايت|تيرا\s?بايت|ميغابايت|ميجابايت|كيلوبايت|جيجابايت/i;

    for (const key of MEDIA_KEYS) {
      for (const [language, catalogue] of [
        ['en', EN],
        ['ar', AR],
      ] as const) {
        expect(catalogue[key], `${language} ${key}`).not.toMatch(ANY_DIGIT);
        expect(catalogue[key], `${language} ${key}`).not.toMatch(UNIT_OR_FORMAT);
      }
    }
  });

  it('the widened pattern actually catches what the old one let through', () => {
    /*
     * Non-vacuous, and specifically about the blindness `H-F1` named: the
     * refuted assertion passed these strings. If either check ever stops
     * catching them, this case says so before the copy does.
     */
    const ANY_DIGIT = /[0-9٠-٩۰-۹]/;
    const UNIT_OR_FORMAT =
      /jpe?g|png|heic|webp|mp4|\bMB\b|\bKB\b|\bGB\b|\bTB\b|megabytes?|kilobytes?|gigabytes?|ميغا\s?بايت|ميجا\s?بايت|كيلو\s?بايت|جيجا\s?بايت|جيغا\s?بايت|تيرا\s?بايت|ميغابايت|ميجابايت|كيلوبايت|جيجابايت/i;

    // Arabic-Indic and Eastern Arabic-Indic digits: not `\d`, but digits.
    for (const invented of ['الحد الأقصى ٥ ميغابايت', 'حجم ۱۰ ميجابايت']) {
      expect(ANY_DIGIT.test(invented), invented).toBe(true);
      expect(UNIT_OR_FORMAT.test(invented), invented).toBe(true);
    }
    // A unit word with no digit at all — the ceiling stated in words.
    for (const invented of ['بحد أقصى كيلوبايت', 'up to five megabytes']) {
      expect(UNIT_OR_FORMAT.test(invented), invented).toBe(true);
    }
    // And the original Latin-digit case still fails, so nothing was traded away.
    expect(ANY_DIGIT.test('at most 5 MB')).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * The wording sweep — "registered, pending, never downloadable"
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — no reception string claims a file was uploaded or attached', () => {
  it('holds across every `receptions.*` string in both catalogues', () => {
    /*
     * The honest ceiling of the shipped attachment chain is "registered,
     * pending, never downloadable" (`reception-media-checklist.md:208-210`).
     * "Uploaded" and "attached" both assert an arrival that cannot happen: no
     * storage provider is configured, and no version can ever reach `accepted`.
     *
     * The Arabic list is the equivalents that make the same claim. `تحميل` is
     * deliberately NOT among them — `receptions.checkIn.loadAppointments` uses
     * it to mean "load", which is what it means there.
     */
    const ENGLISH_CLAIM = /upload|attach/i;
    const ARABIC_CLAIM = /رفع|مرفق|إرفاق|ارفاق|رُفع|يُرفع/;
    for (const [key, value] of Object.entries(EN)) {
      if (!key.startsWith('receptions.')) continue;
      expect(value, `en ${key}`).not.toMatch(ENGLISH_CLAIM);
    }
    for (const [key, value] of Object.entries(AR)) {
      if (!key.startsWith('receptions.')) continue;
      expect(value, `ar ${key}`).not.toMatch(ARABIC_CLAIM);
    }
  });

  it('leaves exactly one `uploaded` in the source, and it is a backend vocabulary member', () => {
    /*
     * `SIGNATURE_CAPTURE_METHODS` holds `'uploaded'` because
     * `rec.reception-signature` accepts it as a `captureMethod`. A contract
     * vocabulary is not a claim — but it becomes one the moment a component
     * renders it, so the pin is exact and the next case holds the boundary.
     */
    const offenders = SURFACE.filter(({ source }) =>
      /uploaded|attached/i.test(GATE.stripComments(source))
    ).map(({ path }) => path);
    expect(offenders).toEqual(['src/features/receptions/receptions-contract.ts']);
  });

  it('renders no MEMBER of that vocabulary, and translates none of them', () => {
    /*
     * Forward-armed, and it fired. This case asserted that no component
     * referenced `SIGNATURE_CAPTURE_METHODS` at all, which was true only while
     * nothing did. `FE-018`'s signature step now states how many capture methods
     * the operation records — `SIGNATURE_CAPTURE_METHODS.length`, a bound, with
     * the member names deliberately withheld because one of them is the word
     * this phase may not put on screen while `P1-OD-025` is open.
     *
     * A reference is therefore not the thing worth banning; a rendered MEMBER
     * is. The assertion moves onto that: a component may take the array's length
     * and nothing else, no member name may appear in any component source, and
     * no member may be translated. The day a label is rendered, this goes red
     * and the wording has to be decided rather than defaulted to the raw enum.
     */
    const consumers = SURFACE.filter(
      ({ path, source }) =>
        path.endsWith('.tsx') && /SIGNATURE_CAPTURE_METHODS|SignatureCaptureMethod/.test(source)
    );

    for (const { path, source } of consumers) {
      const stripped = GATE.stripComments(source);
      /*
       * Every use of the identifier in a component BODY is `…METHODS.length`.
       * The import list is removed first rather than skipped line by line: it
       * spans several lines here, and a line filter would have called the
       * middle of it a use.
       */
      const body = stripped.replace(/import[\s\S]*?from\s+['"][^'"]+['"];/g, '');
      const uses = body.match(/SIGNATURE_CAPTURE_METHODS(\.\w+)?/g) ?? [];
      for (const use of uses) {
        expect(use, `${path}: ${use}`).toBe('SIGNATURE_CAPTURE_METHODS.length');
      }
      // And the member names themselves appear in no component, in any form.
      for (const member of SIGNATURE_CAPTURE_METHODS) {
        expect(stripped, `${path} renders the member '${member}'`).not.toContain(`'${member}'`);
        expect(stripped, `${path} renders the member '${member}'`).not.toContain(`"${member}"`);
      }
    }

    const translations = Object.keys(EN).filter((key) => /^receptions\.captureMethod\./.test(key));
    expect(translations).toEqual([]);
  });
});
