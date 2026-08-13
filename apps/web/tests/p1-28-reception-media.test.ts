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
 * (`scripts/ci/check-p1-27-frontend.mjs:558-711`). Restating their patterns here
 * would produce a test that proves a smaller rule with the same name — the exact
 * defect P1-27 found in its own console case. So the gate module is imported and
 * its rules are applied as they stand.
 *
 * ## …and this suite is the only place they reach the reception tree
 *
 * The gate's `SCAN_ROOTS` are `features/crm`, `features/vehicles` and the
 * dashboard routes. `features/receptions/**` is collected by NONE of them, which
 * is asserted below rather than assumed, so nobody reads the sentence "the gate
 * enforces it" as covering a tree the gate never opens. The routes ARE collected;
 * the feature tree is held by this file.
 *
 * ## One gap in the gate, measured rather than asserted away
 *
 * The seven `FILE_ACCESS_CONSTRUCTS` cover file INPUT and drag-drop. None of them
 * covers a camera: `navigator.mediaDevices.getUserMedia`, an `ImageCapture`, a
 * `<video>` preview or the `capture` attribute all pass every gate rule. The gap
 * is pinned as a measurement below, and the camera ban for this tree is enforced
 * here. Widening the gate itself is not this wave's to do — it is P1-27's sealed
 * artefact and its rule count is a published document marker — so the gap is
 * reported to the coordinator instead.
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
  readonly collects: (path: string) => boolean;
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

  it('is enforced HERE, because no gate SCAN_ROOT collects the reception feature tree', () => {
    /*
     * Stated as a measurement so the coverage claim cannot be overread. The
     * routes are inside `app/[locale]/(dashboard)` and the gate does open those;
     * `features/receptions` is in no root, so for that tree this file is the
     * enforcement and the day it is deleted the rules stop applying there.
     */
    expect(
      GATE.collects('apps/web/src/app/[locale]/(dashboard)/receptions/check-in/page.tsx')
    ).toBe(true);
    expect(GATE.collects('apps/web/src/features/receptions/media/MediaDecisionNotice.tsx')).toBe(
      false
    );
    expect(GATE.SCAN_ROOTS.map((root) => root.split(sep).join('/'))).not.toContain(
      'apps/web/src/features/receptions'
    );
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

  it('invents no size, no file kind and no extension, in either catalogue', () => {
    /*
     * A number or a format name in this copy IS the invented limit — there is no
     * decision to derive one from, and the invention arrives through diligence
     * rather than carelessness. The decision identifier is a CONSTANT in the
     * component, deliberately not copy, so the digits in `P1-OD-025` cannot
     * smuggle a ceiling in beside them.
     */
    for (const key of MEDIA_KEYS) {
      for (const [language, catalogue] of [
        ['en', EN],
        ['ar', AR],
      ] as const) {
        expect(catalogue[key], `${language} ${key}`).not.toMatch(/\d/);
        expect(catalogue[key], `${language} ${key}`).not.toMatch(
          /jpe?g|png|heic|webp|mp4|\bMB\b|\bKB\b|\bGB\b/i
        );
      }
    }
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

  it('renders that vocabulary nowhere, and translates it nowhere', () => {
    /*
     * Non-vacuous and forward-armed: the day `FE-018` renders a capture-method
     * label, this case goes red and the wording has to be decided rather than
     * defaulted to the raw enum value.
     */
    const consumers = SURFACE.filter(
      ({ path, source }) =>
        path.endsWith('.tsx') && /SIGNATURE_CAPTURE_METHODS|SignatureCaptureMethod/.test(source)
    ).map(({ path }) => path);
    expect(consumers).toEqual([]);

    const translations = Object.keys(EN).filter((key) => /^receptions\.captureMethod\./.test(key));
    expect(translations).toEqual([]);
  });
});
