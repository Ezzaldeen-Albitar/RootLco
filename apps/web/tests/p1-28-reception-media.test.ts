import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import * as mediaDecision from '@/features/receptions/media/media-decision';
import {
  MEDIA_DECISION_ID,
  MEDIA_DECISION_RESOLVED,
} from '@/features/receptions/media/media-decision';
import { CHECK_IN_STEPS } from '@/features/receptions/check-in/steps';
import {
  CAPTURE_CATEGORY_BY_REQUIREMENT,
  CAPTURE_REQUIREMENTS,
  RECEPTION_OPERATIONS,
  RECEPTION_PERMISSIONS,
  SIGNATURE_CAPTURE_METHODS,
} from '@/features/receptions/receptions-contract';
import {
  ACCEPTED_VERSION_STATUS,
  DOCUMENT_VERSION_STATUSES,
} from '@/features/attachments/attachments-contract';

/**
 * `P1-28-FE-017`/`FE-018` — the SANCTIONED capture path is the only one, proved
 * over the source (`TC-P1-28-REC-009`).
 *
 * ## What this suite used to be, and why the subject changed rather than the file
 *
 * It was the DOM-independent proof of an ABSENCE. `P1-OD-025` was an open Owner
 * decision that owned the accepted file kinds, the ceilings and the storage
 * placement; no store was configured, no document category existed and no
 * version could ever leave `pending`, so every arrangement of controls on this
 * surface would have been a way to be refused. The deliverable was a notice, and
 * the thing worth testing was that nothing anywhere took a file.
 *
 * The Owner has RESOLVED `P1-OD-025`. Private versioned evidence ships —
 * Document → immutable Version → business link, `pending → scanning → accepted`,
 * only an accepted version is finalized evidence — a real S3-compatible store is
 * configured for the acceptance environment, seven platform `reception_*`
 * categories are seeded, and both reception evidence and the `FE-018` signature
 * are captured through Server Actions.
 *
 * So a suite that still proved the absence would be proving the opposite of the
 * product, and deleting it would leave the capability with no source-level guard
 * at all. It is CONVERTED, and the conversion keeps the shape that made it worth
 * having: it no longer asks whether a capture path exists, it asks whether the
 * one that exists is the only one, in the order the contract requires, with every
 * storage decision on the server.
 *
 * ## The rules are still READ from the gate, never restated here
 *
 * `no-upload-path`, `no-unapproved-file-input`, `no-invented-media-limit` and
 * `no-export-surface` are the specification (the `RULES` table of
 * `scripts/ci/check-p1-27-frontend.mjs`). Restating them would produce a test
 * that proves a smaller rule with the same name — the exact defect P1-27 found in
 * its own console case — so the gate module is imported and its rules are applied
 * as they stand, including its construct tables and its allowances.
 *
 * `features/receptions` is an ADOPTED root of that gate, declared by P1-28's own
 * canonical plan. That is asserted below rather than assumed, in both directions:
 * the gate collects the tree, and the media rules are among the rules that read
 * it.
 *
 * ## Two gaps in the gate, measured rather than asserted away
 *
 * **A camera is covered by nothing.** `navigator.mediaDevices.getUserMedia`, an
 * `ImageCapture`, a `<video>` preview and the `capture` attribute all pass every
 * gate rule. No camera path is sanctioned — the approved surface takes a chosen
 * FILE — so the ban for this tree is enforced here, and the gap is pinned as a
 * measurement rather than closed by adding a rule to a table whose count is a
 * published document marker.
 *
 * **`features/attachments` is collected by no scan root.** The module that
 * performs the object PUT and reads the server's ceiling is outside every tree
 * the gate opens, so `no-invented-media-limit` has never inspected it. That is
 * measured below too, and what the gate cannot say about it — that the ceiling
 * enforced there is the SERVER's, read from the authorization it was just issued
 * — is asserted here instead.
 *
 * ## Non-vacuity, everywhere
 *
 * Every universally quantified rule in this file is also applied to a planted
 * violation it must reject and to a compliant form it must accept, and every file
 * walk is guarded by a count. A sweep that examined nothing satisfies an absence
 * claim perfectly, which is the failure mode this repository keeps catching.
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

/** Workspace-relative paths, for readable pins and for `GATE.collects`. */
const CAPTURE_FIELD = 'src/features/receptions/components/CaptureFileField.tsx';
const MEDIA_STEP = 'src/features/receptions/components/steps/MediaStep.tsx';
const SIGNATURE_STEP = 'src/features/receptions/components/steps/SignatureStep.tsx';
const EVIDENCE_CAPTURE = 'src/features/receptions/evidence-capture.ts';
const SIGNATURE_CAPTURE = 'src/features/receptions/signature-capture.ts';
const ATTACHMENTS_API = 'src/features/attachments/api.ts';
const ATTACHMENTS_CONTRACT = 'src/features/attachments/attachments-contract.ts';

/** The five files a capture is actually built from, and nothing else. */
const CAPTURE_SURFACES = [
  CAPTURE_FIELD,
  MEDIA_STEP,
  SIGNATURE_STEP,
  EVIDENCE_CAPTURE,
  SIGNATURE_CAPTURE,
] as const;

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

function read(relative: string): string {
  return readFileSync(join(WEB, ...relative.split('/')), 'utf8');
}

interface GateRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly what: string;
  readonly allow: readonly string[];
  readonly roots?: readonly string[];
}

interface GateConstruct {
  readonly construct: string;
  readonly pattern: RegExp;
  readonly samples: readonly string[];
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
  readonly FILE_ACCESS_CONSTRUCTS: readonly GateConstruct[];
  readonly FILE_ACCESS_INNOCENT: readonly string[];
  readonly FILE_INPUT_CONSTRUCTS: readonly GateConstruct[];
  readonly FILE_INPUT_ALLOW: readonly string[];
  readonly INVENTED_MEDIA_LIMIT_CONSTRUCTS: readonly GateConstruct[];
  readonly INVENTED_MEDIA_LIMIT_INNOCENT: readonly string[];
  readonly anyOf: (constructs: readonly GateConstruct[]) => RegExp;
  readonly collects: (path: string) => boolean;
  readonly inRuleScope: (rule: GateRule, path: string) => boolean;
  readonly stripComments: (source: string) => string;
  readonly evaluate: (files: readonly { path: string; source: string }[]) => {
    readonly failures: readonly string[];
  };
};

/** The four rules that ARE the media specification, plus the download half. */
const MEDIA_RULE_IDS = [
  'no-upload-path',
  'no-unapproved-file-input',
  'no-invented-media-limit',
  'no-export-surface',
] as const;

function ruleFor(id: string): GateRule {
  const rule = GATE.RULES.find((candidate) => candidate.id === id);
  expect(rule, `the gate has no ${id} rule`).toBeDefined();
  return rule!;
}

/**
 * How many times one rule FIRED over sources handed to the gate directly.
 *
 * The gate's own anti-vacuity complaint — `<id>: inspected 0 files — this rule
 * is measuring nothing` — shares the rule's prefix, and it is the CORRECT answer
 * when the only file handed in is one the rule allow-lists. Counting it as a
 * violation would make the allow-list impossible to test: the exemption would
 * look identical to the breach it exists to permit.
 */
function firesOn(id: string, files: readonly { path: string; source: string }[]): number {
  return GATE.evaluate(files).failures.filter(
    (failure) => failure.startsWith(`${id}:`) && !failure.includes('inspected 0 files')
  ).length;
}

/**
 * Source with comments AND the import block removed.
 *
 * Both halves matter for the order assertions below. Comments name every
 * operation in the sequence while explaining it, and the IMPORT list names them
 * in its own order — which is alphabetical, not chronological, so an assertion
 * taken over the whole file would be measuring the import statement rather than
 * the call sequence. The import list is removed whole rather than line by line
 * because it spans several lines and a line filter would call the middle of it a
 * use.
 */
function body(source: string): string {
  return GATE.stripComments(source).replace(/import[\s\S]*?from\s+['"][^'"]+['"];/g, '');
}

/** Where a construct appears in a body, asserted to be present at all. */
function at(source: string, needle: string, label: string): number {
  const index = source.indexOf(needle);
  expect(index, `${label}: ${needle} is not in the source at all`).toBeGreaterThanOrEqual(0);
  return index;
}

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/* ------------------------------------------------------------------ *
 * Repository-wide sources, loaded once and shared
 * ------------------------------------------------------------------ */

interface PolicySource {
  readonly path: string;
  readonly source: string;
}

function walkAny(dir: string, keep: RegExp): readonly string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkAny(path, keep);
    return keep.test(entry.name) ? [path] : [];
  });
}

function load(root: string, keep: RegExp): readonly PolicySource[] {
  return walkAny(root, keep).map((absolute) => ({
    path: absolute
      .slice(REPO.length + 1)
      .split(sep)
      .join('/'),
    source: readFileSync(absolute, 'utf8'),
  }));
}

const SQL = load(join(REPO, 'supabase'), /\.sql$/);
const WEB_SOURCES = load(join(WEB, 'src'), /\.tsx?$/).filter(
  // Generated from the operation register: it NAMES every operation the
  // platform publishes, which is not the same as a browser reaching one.
  // `check-p1-28-write-reachability.mjs` excludes it for this same reason.
  ({ path }) => !path.endsWith('src/lib/api/idempotent-operations.ts')
);

/* ------------------------------------------------------------------ *
 * The surface, and what enforces it
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — the surface this suite measures', () => {
  it('collects the whole reception tree, including both capture surfaces', () => {
    // Guards the measurement itself: a walk that silently returned nothing would
    // make every sweep below pass while examining no file at all.
    expect(SURFACE.length).toBeGreaterThan(30);
    for (const required of [
      'src/features/receptions/media/media-decision.ts',
      CAPTURE_FIELD,
      MEDIA_STEP,
      SIGNATURE_STEP,
      EVIDENCE_CAPTURE,
      SIGNATURE_CAPTURE,
      'src/features/receptions/check-in/steps.tsx',
      'src/app/[locale]/(dashboard)/receptions/check-in/[receptionId]/page.tsx',
    ]) {
      expect(
        SURFACE.some((file) => file.path === required),
        required
      ).toBe(true);
    }

    // The notice this suite used to read is GONE, not merely emptied. A file
    // that still existed with its controls removed would keep the block alive as
    // something a later commit could restore in one line.
    expect(existsSync(join(WEB, MEDIA_MODULE, 'MediaDecisionNotice.tsx'))).toBe(false);
  });

  it('is enforced by the GATE as well, the reception tree being an adopted root (`O2`)', () => {
    /*
     * Both halves are pinned: the tree is collected, and the media rules are
     * among the rules that read it. A rule narrowed away from this tree (the
     * gate's `roots`, which `no-client-asserted-scope` carries) would fail the
     * second half by name rather than quietly stop applying.
     */
    expect(
      GATE.collects('apps/web/src/app/[locale]/(dashboard)/receptions/check-in/page.tsx')
    ).toBe(true);
    expect(GATE.collects(`apps/web/${CAPTURE_FIELD}`)).toBe(true);
    expect(GATE.SCAN_ROOTS.map((root) => root.split(sep).join('/'))).toContain(
      'apps/web/src/features/receptions'
    );
    expect(GATE.ADOPTED_ROOTS.map((entry) => entry.root.split(sep).join('/'))).toContain(
      'apps/web/src/features/receptions'
    );

    for (const id of MEDIA_RULE_IDS) {
      expect(
        GATE.inRuleScope(ruleFor(id), `apps/web/${MEDIA_STEP}`),
        `${id} does not read the reception tree`
      ).toBe(true);
    }
  });

  it('applies rules that exist and that fire — a clean sweep of nothing proves nothing', () => {
    // Planted violations, one per rule, through the gate's own evaluator.
    const planted = [
      { id: 'no-upload-path', source: 'const b = new FormData();' },
      { id: 'no-unapproved-file-input', source: '<input type="file" name="photo" />' },
      { id: 'no-invented-media-limit', source: 'const MAX_FILE_SIZE_B = n;' },
      { id: 'no-export-surface', source: 'const u = URL.createObjectURL(b);' },
    ] as const;

    for (const { id, source } of planted) {
      const path = `apps/web/src/features/receptions/planted-${id}.tsx`;
      // The path matters as much as the rule: a violation planted where CI never
      // looks proves a fact about a string. `collects` is the gate's own answer.
      expect(GATE.collects(path), path).toBe(true);
      expect(firesOn(id, [{ path, source }]), id).toBe(1);
    }
  });
});

/* ------------------------------------------------------------------ *
 * A — exactly one approved file-input surface
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — there is EXACTLY ONE approved file-input surface', () => {
  it('the allowance names one path, that path exists, and it is CaptureFileField', () => {
    /*
     * One entry, and the number is the rule. `FE-018` needed a second capture
     * screen and the cheap move was a second entry, which would have turned
     * "there is one approved capture surface" into "there are the approved
     * capture surfaces", one screen at a time, with the allow-list as the record
     * of the decay. The INPUT moved into a shared component instead.
     */
    expect(GATE.FILE_INPUT_ALLOW).toHaveLength(1);
    expect(GATE.FILE_INPUT_ALLOW[0]).toBe(`apps/web/${CAPTURE_FIELD}`);
    expect(existsSync(join(WEB, ...CAPTURE_FIELD.split('/')))).toBe(true);
    expect(CAPTURE_FIELD.split('/').at(-1)).toBe('CaptureFileField.tsx');
  });

  it('the allowance is not an allowance for nothing — the approved file really offers the input', () => {
    /*
     * An allow-list entry for a file that no longer contains the construct is
     * the shape this gate lost a rule to once already: it costs nothing today
     * and exempts whatever is put in that file tomorrow. So the exemption is
     * asserted to be LOAD-BEARING — the rule's own pattern fires on this source,
     * and the rule nevertheless reports nothing for this path.
     */
    const rule = ruleFor('no-unapproved-file-input');
    const source = read(CAPTURE_FIELD);
    expect(rule.pattern.test(GATE.stripComments(source))).toBe(true);
    expect(
      firesOn('no-unapproved-file-input', [{ path: `apps/web/${CAPTURE_FIELD}`, source }])
    ).toBe(0);
  });

  it('and the rule FIRES on a file input planted anywhere else', () => {
    const source = '<input type="file" name="photo" />';
    for (const path of [
      'apps/web/src/features/receptions/components/steps/SecondCapture.tsx',
      'apps/web/src/features/receptions/components/CaptureFileFieldCopy.tsx',
      'apps/web/src/app/[locale]/(dashboard)/receptions/check-in/upload.tsx',
      'apps/web/src/features/crm/components/CustomerPhoto.tsx',
    ]) {
      expect(GATE.collects(path), path).toBe(true);
      expect(firesOn('no-unapproved-file-input', [{ path, source }]), path).toBe(1);
    }
  });

  it('both capture steps render the shared field and hold no input of their own', () => {
    const rule = ruleFor('no-unapproved-file-input');
    for (const path of [MEDIA_STEP, SIGNATURE_STEP]) {
      const code = GATE.stripComments(read(path));
      expect(code, `${path} does not render the approved field`).toContain('<CaptureFileField');
      expect(code, `${path} builds a file input of its own`).not.toMatch(rule.pattern);
    }
  });

  it('no other source on the whole reception surface offers one either', () => {
    const rule = ruleFor('no-unapproved-file-input');
    for (const { path, source } of SURFACE) {
      if (path === CAPTURE_FIELD) continue;
      expect(GATE.stripComments(source), `${path} — ${rule.what}`).not.toMatch(rule.pattern);
    }
  });
});

/* ------------------------------------------------------------------ *
 * B — the sanctioned flow, in the order that IS the contract
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017/FE-018 — the sanctioned capture flow, in order', () => {
  const CAPTURE = body(read(EVIDENCE_CAPTURE));
  const SIGNATURE = body(read(SIGNATURE_CAPTURE));
  const ATTACHMENTS = body(read(ATTACHMENTS_API));

  it('both entry points are Server Actions, so the ORDER is never in the browser', () => {
    /*
     * A capture is five operations and finalize is a sixth. Driving them from a
     * component would put the sequence in the browser, where a binding naming a
     * version the store never received, or a finalization of a version that is
     * not accepted, become refusals an operator meets one at a time with no way
     * to tell which step went wrong.
     */
    for (const path of [EVIDENCE_CAPTURE, SIGNATURE_CAPTURE, ATTACHMENTS_API]) {
      expect(read(path).trimStart().startsWith("'use server';"), path).toBe(true);
    }
  });

  it('a component calls the ONE action and never a step of the chain itself', () => {
    const steps = [
      'captureDocument',
      'createDocumentLink',
      'listDocumentCategories',
      'bindEvidence',
      'finalizeEvidenceBinding',
    ];
    const components = SURFACE.filter(({ path }) => path.endsWith('.tsx'));
    expect(components.length).toBeGreaterThan(20);
    for (const { path, source } of components) {
      const code = GATE.stripComments(source);
      for (const step of steps) {
        expect(code, `${path} drives ${step} from the browser`).not.toContain(step);
      }
      // `recordSignature` is the same act one layer down; `recordSignatureEvent`
      // is a DIFFERENT and deliberate second act, so the boundary is a word one.
      expect(code, `${path} records a signature outside the capture action`).not.toMatch(
        /\brecordSignature\b/
      );
    }
  });

  it('the object PUT is server-side and sits between authorize and register', () => {
    /*
     * `contentSecurityPolicy` assembles `connect-src` from `'self'`, the API
     * origin and an optional diagnostics sink — there is no parameter for a
     * storage origin, so a browser PUT to an object store is refused by the
     * policy before anything else refuses it. The bytes therefore cross the same
     * origin once, into a Server Action, and the SERVER performs the PUT.
     */
    const authorize = at(ATTACHMENTS, "'/api/v1/attachments/upload-authorizations'", 'authorize');
    const put = at(ATTACHMENTS, 'putObject(', 'object PUT');
    const register = at(ATTACHMENTS, "'/api/v1/attachments/versions'", 'register');
    expect(authorize).toBeLessThan(put);
    expect(put).toBeLessThan(register);
    // The PUT spends what the API just issued, verbatim, and signs nothing.
    expect(ATTACHMENTS).toContain('fetch(authorization.uploadUrl');
  });

  it('reception evidence runs authorize → register → link → bind → finalize', () => {
    const categories = at(CAPTURE, 'listDocumentCategories()', 'category read');
    const captured = at(CAPTURE, 'captureDocument({', 'authorize/store/register');
    const linked = at(CAPTURE, 'createDocumentLink(', 'business link');
    const bound = at(CAPTURE, 'bindEvidence(', 'evidence binding');
    const finalized = at(CAPTURE, 'finalizeEvidenceBinding(', 'finalization');
    expect(categories).toBeLessThan(captured);
    expect(captured).toBeLessThan(linked);
    expect(linked).toBeLessThan(bound);
    expect(bound).toBeLessThan(finalized);
  });

  it('finalization is attempted ONLY under ACCEPTED_VERSION_STATUS', () => {
    /*
     * The whole point of the lifecycle, expressed as a position in one file: the
     * guard has to come BEFORE the finalize call, and the branch it takes has to
     * be the honest one. A version that stayed `pending` is returned as `bound`,
     * which is what the screen tells the operator instead of showing a tick.
     */
    expect(ACCEPTED_VERSION_STATUS).toBe('accepted');
    expect(DOCUMENT_VERSION_STATUSES).toContain(ACCEPTED_VERSION_STATUS);

    const guard = at(
      CAPTURE,
      'if (versionStatus !== ACCEPTED_VERSION_STATUS)',
      'the acceptance guard'
    );
    const finalize = at(CAPTURE, 'finalizeEvidenceBinding(', 'finalization');
    expect(guard).toBeLessThan(finalize);

    // `finalized` is reported once, after the finalization answered; `bound` is
    // what every earlier stopping point reports.
    const finalizedStage = at(CAPTURE, "stage: 'finalized'", 'the finalized stage');
    expect(finalize).toBeLessThan(finalizedStage);
    expect(CAPTURE.match(/stage: 'finalized'/g) ?? []).toHaveLength(1);
    expect((CAPTURE.match(/stage: 'bound'/g) ?? []).length).toBeGreaterThan(0);

    // The literal is imported from the contract, never spelled locally: a rule
    // written out four times is a rule that can be relaxed in three of them.
    expect(read(EVIDENCE_CAPTURE)).toContain(
      "import { ACCEPTED_VERSION_STATUS } from '@/features/attachments/attachments-contract';"
    );
    expect(CAPTURE).not.toMatch(/versionStatus\s*!==\s*'accepted'/);
  });

  it('the signature chain stops at RECORDED and finalizes nothing', () => {
    /*
     * A signature binds an exact version and may stand as a draft while that
     * evidence is pending; it is never final until the version is accepted.
     * Folding finalization into the capture would make the difference between
     * "signed" and "signed and verified" a matter of how fast the scanner was,
     * and would attribute an act nobody performed.
     */
    const categories = at(SIGNATURE, 'listDocumentCategories()', 'category read');
    const captured = at(SIGNATURE, 'captureDocument({', 'authorize/store/register');
    const linked = at(SIGNATURE, 'createDocumentLink(', 'business link');
    const recorded = at(SIGNATURE, 'recordSignature(', 'the signature write');
    expect(categories).toBeLessThan(captured);
    expect(captured).toBeLessThan(linked);
    expect(linked).toBeLessThan(recorded);

    expect(SIGNATURE).not.toContain('finalizeEvidenceBinding');
    expect(SIGNATURE).not.toContain('recordSignatureEvent');
    expect(SIGNATURE).not.toContain("'finalized'");
    expect(SIGNATURE).toContain("stage: 'recorded'");
  });

  it('the capture METHOD is fixed on the server and offered as no choice', () => {
    /*
     * `SIGNATURE_CAPTURE_METHODS` admits four members and this surface takes a
     * FILE, so exactly one of them is true of it. A select offering the other
     * three would offer three capabilities the product does not have and record
     * a claim about how a signature was taken that nothing checked — so the
     * value is fixed on the server, where a screen cannot disagree with it.
     */
    expect(SIGNATURE).toContain("const FILE_CAPTURE_METHOD = 'uploaded';");
    expect(SIGNATURE_CAPTURE_METHODS).toContain('uploaded');
    expect(SIGNATURE).toContain('captureMethod: FILE_CAPTURE_METHOD,');

    for (const { path, source } of SURFACE) {
      if (!path.endsWith('.tsx')) continue;
      expect(
        GATE.stripComments(source),
        `${path} renders the signature capture-method vocabulary`
      ).not.toMatch(/SIGNATURE_CAPTURE_METHODS|SignatureCaptureMethod/);
    }
    // …and no member is translated, so none can reach a screen as a label.
    expect(Object.keys(EN).filter((key) => key.startsWith('receptions.captureMethod.'))).toEqual(
      []
    );
  });

  it('the document CATEGORY is derived from the requirement, never chosen', () => {
    /*
     * `rec.guard_reception_evidence_binding()` decides which category may satisfy
     * which requirement. An operator photographing a VIN plate does not pick a
     * document category — there is exactly one that can satisfy `vin`, and
     * offering a choice would be offering a way to be refused.
     */
    expect(CAPTURE).toContain('CAPTURE_CATEGORY_BY_REQUIREMENT[requirementCode]');
    expect(Object.keys(CAPTURE_CATEGORY_BY_REQUIREMENT).sort()).toEqual(
      [...CAPTURE_REQUIREMENTS].sort()
    );
    // The link PURPOSE comes from the category the server published, so a
    // purpose invented in this tree could never reach the API.
    expect(CAPTURE).toContain('linkPurpose: category.businessLinkPurpose,');
    expect(SIGNATURE).toContain('linkPurpose: category.businessLinkPurpose,');
    expect(CAPTURE).not.toMatch(/linkPurpose:\s*['"]/);
    expect(SIGNATURE).not.toMatch(/linkPurpose:\s*['"]/);
  });
});

/* ------------------------------------------------------------------ *
 * C — the browser holds no storage authority
 * ------------------------------------------------------------------ */

/** A governed evidence category is never public and always declares retention. */
function categoriesAreGoverned(files: readonly PolicySource[]): readonly string[] {
  const failures: string[] = [];
  for (const { path, source } of files) {
    for (const statement of source.split(';')) {
      if (!/INSERT\s+INTO\s+shared\.document_categories/i.test(statement)) continue;
      if (/'public'/i.test(statement)) {
        failures.push(`${path}: an evidence category declares a public classification`);
      }
      if (!/default_retention_class/i.test(statement)) {
        failures.push(`${path}: an evidence category declares no retention class`);
      }
      if (!/default_classification/i.test(statement)) {
        failures.push(`${path}: an evidence category declares no classification`);
      }
    }
  }
  return failures;
}

/**
 * The browser never holds storage power, and never names a raw object key.
 *
 * Unchanged, and the reason it sweeps the WHOLE web tree rather than the client
 * components alone is that this tier holds no storage authority in either
 * position: the API signs, and this application spends what it was given.
 */
function browserHoldsNoStorageAuthority(files: readonly PolicySource[]): readonly string[] {
  const CREDENTIAL = /@aws-sdk|accessKeyId|secretAccessKey|createPresignedPost|S3Client/;
  const RAW_KEY = /storageKey|storage_key/;
  const failures: string[] = [];
  for (const { path, source } of files) {
    if (CREDENTIAL.test(source)) failures.push(`${path}: browser code carries storage credentials`);
    if (RAW_KEY.test(source)) failures.push(`${path}: browser code names a raw storage key`);
  }
  return failures;
}

/**
 * No storage CONFIGURATION is read in this tier either.
 *
 * A separate rule from the credential one because it fails on a different
 * mistake: not a secret in the bundle, but this application deciding where an
 * object goes. Bucket, region and endpoint are the API's, and a web tier that
 * read them would be a second authority answering the same question.
 */
function browserHoldsNoStorageConfiguration(files: readonly PolicySource[]): readonly string[] {
  const CONFIGURATION =
    /process\.env\.[A-Z_]*(?:STORAGE|BUCKET|S3|MINIO)[A-Z_]*|bucketName|endpointUrl|forcePathStyle/;
  return files
    .filter(({ source }) => CONFIGURATION.test(source))
    .map(({ path }) => `${path}: browser code reads storage configuration`);
}

/**
 * A signed URL is created, spent and discarded inside ONE server module.
 *
 * The rule is not "no signed URL exists" — one must, or nothing could be stored
 * — it is that no second module can hold one. A URL that reached a component
 * would be a storage grant with a lifetime, sitting in a payload, which is
 * exactly what the private model exists to prevent.
 */
function noSignedUrlOutsideTheOneModule(files: readonly PolicySource[]): readonly string[] {
  const HANDLE = /uploadUrl|uploadToken|presigned|signedUrl|signed_url/;
  return files
    .filter(({ path, source }) => path !== `apps/web/${ATTACHMENTS_API}` && HANDLE.test(source))
    .map(({ path }) => `${path}: a storage grant is named outside the one module that spends it`);
}

describe('P1-28 — the browser receives no storage authority of any kind', () => {
  it('measures a real tree — an empty sweep would satisfy every rule below', () => {
    expect(WEB_SOURCES.length).toBeGreaterThan(100);
    expect(WEB_SOURCES.some(({ path }) => path === `apps/web/${ATTACHMENTS_API}`)).toBe(true);
    expect(WEB_SOURCES.some(({ path }) => path === `apps/web/${CAPTURE_FIELD}`)).toBe(true);
  });

  it('carries no credential, no raw object key and no storage configuration', () => {
    expect(browserHoldsNoStorageAuthority(WEB_SOURCES)).toEqual([]);
    expect(browserHoldsNoStorageConfiguration(WEB_SOURCES)).toEqual([]);
  });

  it('names a storage grant in exactly one module, which does not export it', () => {
    expect(noSignedUrlOutsideTheOneModule(WEB_SOURCES)).toEqual([]);
    // Not exported, so the shape cannot cross a module boundary even by type.
    const attachments = read(ATTACHMENTS_API);
    expect(attachments).toContain('interface UploadAuthorization {');
    expect(attachments).not.toContain('export interface UploadAuthorization');
  });

  it('and what DOES cross back to the caller declares no url, key or token', () => {
    /*
     * Derived from the contract rather than asserted about it. `RegisteredVersion`
     * is what a capture returns to its caller and, through the caller, to a
     * screen; if a storage handle were ever added to the private model, it would
     * appear here first.
     */
    const contract = GATE.stripComments(read(ATTACHMENTS_CONTRACT));
    const declaration = /export interface RegisteredVersion \{([\s\S]*?)\n\}/.exec(contract);
    expect(
      declaration,
      'RegisteredVersion is no longer declared where this reads it'
    ).not.toBeNull();
    const fields = [...(declaration?.[1] ?? '').matchAll(/readonly (\w+)\s*:/g)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(3);
    for (const field of fields) {
      expect(field, `RegisteredVersion.${field} is a storage handle`).not.toMatch(
        /url|key|token|secret|bucket|region|credential/i
      );
    }
  });

  it('every one of those rules REJECTS a planted violation, and accepts a compliant form', () => {
    expect(
      browserHoldsNoStorageAuthority([
        { path: 'planted.ts', source: "import { S3Client } from '@aws-sdk/client-s3';" },
      ])
    ).toHaveLength(1);
    expect(
      browserHoldsNoStorageAuthority([
        { path: 'planted.ts', source: 'const key = row.storageKey;' },
      ])
    ).toHaveLength(1);
    expect(
      browserHoldsNoStorageConfiguration([
        { path: 'planted.ts', source: 'const bucket = process.env.STORAGE_BUCKET;' },
      ])
    ).toHaveLength(1);
    expect(
      browserHoldsNoStorageConfiguration([
        { path: 'planted.ts', source: 'const style = { forcePathStyle: true };' },
      ])
    ).toHaveLength(1);
    expect(
      noSignedUrlOutsideTheOneModule([
        {
          path: 'apps/web/src/features/receptions/planted.tsx',
          source: 'const u = props.uploadUrl;',
        },
      ])
    ).toHaveLength(1);

    // …and none of them is simply always red.
    const innocent = [{ path: 'ok.ts', source: 'const a = 1;' }];
    expect(browserHoldsNoStorageAuthority(innocent)).toEqual([]);
    expect(browserHoldsNoStorageConfiguration(innocent)).toEqual([]);
    expect(noSignedUrlOutsideTheOneModule(innocent)).toEqual([]);
    // The one module that legitimately holds a grant is not accused of it.
    expect(
      noSignedUrlOutsideTheOneModule([
        { path: `apps/web/${ATTACHMENTS_API}`, source: 'fetch(authorization.uploadUrl);' },
      ])
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * D — no upload path is built by hand, and no camera path at all
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — no hand-built upload path, and no camera', () => {
  it('no-upload-path allows NOTHING, and still fires on every construct it names', () => {
    /*
     * The file input left this rule for one of its own precisely so that
     * permitting that construct did not permit these. `allow` exempts a FILE
     * from a WHOLE rule, so an allowance here would have traded away
     * `FileReader`, a `DataTransfer`, a drop target, an `input.files` list and a
     * hand-set multipart encoding to admit one `<input type="file">`.
     */
    const rule = ruleFor('no-upload-path');
    expect(rule.allow).toEqual([]);
    expect(rule.roots, 'the rule was narrowed to a subset of the scanned trees').toBeUndefined();

    const constructs = GATE.FILE_ACCESS_CONSTRUCTS;
    expect(constructs.length).toBeGreaterThanOrEqual(6);
    // Every drag-and-drop upload is built from these four and none of them needs
    // a file input, so their presence is a floor rather than a pin.
    for (const required of ['file-reader', 'file-list', 'drop-target', 'data-transfer']) {
      expect(
        constructs.map((construct) => construct.construct),
        `the rule no longer names ${required}`
      ).toContain(required);
    }

    let planted = 0;
    for (const construct of constructs) {
      expect(construct.samples.length, construct.construct).toBeGreaterThan(0);
      for (const source of construct.samples) {
        const path = `apps/web/src/features/receptions/planted-${construct.construct}.tsx`;
        expect(
          firesOn('no-upload-path', [{ path, source }]),
          `${construct.construct}: ${source}`
        ).toBe(1);
        planted += 1;
      }
    }
    expect(planted).toBeGreaterThan(6);

    // …and the adjacent-but-innocent forms do NOT fire, so the rule is not `/./`.
    for (const source of GATE.FILE_ACCESS_INNOCENT) {
      expect(
        firesOn('no-upload-path', [
          { path: 'apps/web/src/features/receptions/innocent.tsx', source },
        ]),
        source
      ).toBe(0);
    }
  });

  it('no reception source builds one — including the two capture surfaces', () => {
    const rule = ruleFor('no-upload-path');
    for (const { path, source } of SURFACE) {
      expect(GATE.stripComments(source), `${path} — ${rule.what}`).not.toMatch(rule.pattern);
    }
    // Stated separately for the file that IS allowed a file input, because that
    // is the one place somebody would reasonably expect the others to follow.
    expect(GATE.stripComments(read(CAPTURE_FIELD))).not.toMatch(rule.pattern);
  });

  it('has no camera construct — the gate does NOT cover these, so this case is the only guard', () => {
    /*
     * Measured, not assumed: the gate's `no-upload-path` is handed a real camera
     * path and does not fire. That is the gap; the second half of this case is
     * what closes it for this tree. No camera path is sanctioned — the approved
     * surface takes a file the operator chose — so a `getUserMedia` preview here
     * would be a capability nobody decided, arriving through the one door every
     * rule leaves open.
     */
    const rule = ruleFor('no-upload-path');
    expect(rule.pattern.test('await navigator.mediaDevices.getUserMedia({ video: true });')).toBe(
      false
    );

    const CAMERA =
      /getUserMedia|getDisplayMedia|mediaDevices|\bImageCapture\b|\bMediaStream\b|capture=|<video|<canvas/;
    // Non-vacuity for a hand-written pattern: it must catch what it is for.
    for (const planted of [
      'const s = await navigator.mediaDevices.getUserMedia({ video: true });',
      '<input type="file" capture="environment" />',
      '<video ref={preview} />',
      'const shot = new ImageCapture(track);',
    ]) {
      expect(CAMERA.test(planted), planted).toBe(true);
    }
    expect(CAMERA.test('<CaptureFileField name="evidenceFile" label={label} />')).toBe(false);

    for (const { path, source } of SURFACE) {
      expect(GATE.stripComments(source), `${path} builds a camera path`).not.toMatch(CAMERA);
    }
  });
});

/* ------------------------------------------------------------------ *
 * E — content types and the ceiling are the SERVER's
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — the media policy is the server category policy', () => {
  it('no-invented-media-limit is UNCHANGED: its published table, no allowance, no narrowing', () => {
    /*
     * "Unchanged" stated as something checkable. The rule is still ASSEMBLED
     * from `INVENTED_MEDIA_LIMIT_CONSTRUCTS` rather than written out, it exempts
     * no file, and it is narrowed to no subset of the scanned trees. Resolving
     * `P1-OD-025` licensed exactly one relaxation — the file input, which got
     * its own rule — and this is the rule that was deliberately not touched.
     */
    const rule = ruleFor('no-invented-media-limit');
    expect(rule.allow).toEqual([]);
    expect(rule.roots).toBeUndefined();
    expect(rule.pattern.source).toBe(GATE.anyOf(GATE.INVENTED_MEDIA_LIMIT_CONSTRUCTS).source);

    const constructs = GATE.INVENTED_MEDIA_LIMIT_CONSTRUCTS;
    expect(constructs.length).toBeGreaterThanOrEqual(5);
    for (const required of [
      'byte-size-limit',
      'byte-arithmetic',
      'accepted-mime-list',
      'extension-allow-list',
      'accept-attribute',
    ]) {
      expect(
        constructs.map((construct) => construct.construct),
        `the rule no longer names ${required}`
      ).toContain(required);
    }

    for (const construct of constructs) {
      for (const source of construct.samples) {
        expect(
          firesOn('no-invented-media-limit', [
            { path: 'apps/web/src/features/receptions/planted.tsx', source },
          ]),
          `${construct.construct}: ${source}`
        ).toBe(1);
      }
    }
    for (const source of GATE.INVENTED_MEDIA_LIMIT_INNOCENT) {
      expect(
        firesOn('no-invented-media-limit', [
          { path: 'apps/web/src/features/receptions/innocent.tsx', source },
        ]),
        source
      ).toBe(0);
    }
  });

  it('and it still reads the reception tree — every capture surface, by name', () => {
    const rule = ruleFor('no-invented-media-limit');
    for (const path of CAPTURE_SURFACES) {
      expect(GATE.collects(`apps/web/${path}`), path).toBe(true);
      expect(GATE.inRuleScope(rule, `apps/web/${path}`), path).toBe(true);
    }
  });

  it('no capture surface states a content type, an extension or a ceiling of its own', () => {
    const rule = ruleFor('no-invented-media-limit');
    for (const path of CAPTURE_SURFACES) {
      expect(GATE.stripComments(read(path)), `${path} — ${rule.what}`).not.toMatch(rule.pattern);
    }

    /*
     * And the one component that COULD carry a list does not default to one.
     * `accept` is optional because "we were not told" and "anything goes" are
     * different facts; a caller that has been told the server's list passes it
     * through, and neither step has been, so neither passes anything.
     */
    const field = GATE.stripComments(read(CAPTURE_FIELD));
    expect(field).toContain('accept.join(');
    expect(field).toMatch(/readonly accept\?: readonly string\[\] \| undefined;/);
    for (const path of [MEDIA_STEP, SIGNATURE_STEP]) {
      expect(GATE.stripComments(read(path)), `${path} passes a media policy`).not.toMatch(
        /accept=\{/
      );
    }
  });

  it('the ceiling that IS enforced is the one the server just published', () => {
    /*
     * Measured gap, closed here rather than reported as covered. `features/
     * attachments` is under no `SCAN_ROOT`, so `no-invented-media-limit` has
     * never opened the module that performs the PUT — and that module is exactly
     * where a "sensible default" would be most tempting, because it is the one
     * place that knows the byte count.
     */
    expect(GATE.collects(`apps/web/${ATTACHMENTS_API}`)).toBe(false);

    const attachments = body(read(ATTACHMENTS_API));
    // The ceiling is READ from the authorization the API had just issued, and
    // the file is refused before its bytes cross a network. No constant is in a
    // position to disagree with the category policy.
    expect(attachments).toContain('if (byteSize > authorized.data.maxBytes)');

    // The category the server publishes owns both halves of the policy.
    const contract = GATE.stripComments(read(ATTACHMENTS_CONTRACT));
    expect(contract).toContain('readonly allowedContentTypes: readonly string[];');
    expect(contract).toContain('readonly maxBytes: number;');
  });

  it('and the one thing the rule WOULD flag there is a file-NAME bound, not a media limit', () => {
    /*
     * Stated as a measurement, because adopting this tree is the obvious next
     * move and it would not be free.
     *
     * `byte-size-limit` matches `MAX_(?:FILE|UPLOAD|IMAGE|MEDIA|ATTACHMENT)_`,
     * and `MAX_FILE_NAME` matches it — a mirror of `shared.documents.file_name`,
     * the column bound the upload-authorization route itself parses with. It
     * governs how long a NAME may be, decides nothing about media, and is
     * exactly the kind of correct line the gate's own docblock warns a wider
     * scan would turn red.
     *
     * So both halves are pinned: that construct matches this file for that
     * reason and no other, and the four constructs that WOULD constitute an
     * invented media policy — a byte arithmetic ceiling, a MIME list, an
     * extension allow-list, an `accept=` attribute — match nothing here.
     */
    const attachments = body(read(ATTACHMENTS_API));
    const byteSizeLimit = GATE.INVENTED_MEDIA_LIMIT_CONSTRUCTS.find(
      (construct) => construct.construct === 'byte-size-limit'
    );
    expect(byteSizeLimit, 'the gate no longer names byte-size-limit').toBeDefined();

    const matches = attachments.match(new RegExp(byteSizeLimit!.pattern.source, 'g')) ?? [];
    expect(matches).toEqual(['MAX_FILE_']);
    expect(attachments).toContain('fileName: z.string().min(1).max(MAX_FILE_NAME),');

    for (const construct of GATE.INVENTED_MEDIA_LIMIT_CONSTRUCTS) {
      if (construct.construct === 'byte-size-limit') continue;
      expect(attachments, `${construct.construct} matches the attachment adapter`).not.toMatch(
        construct.pattern
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * F — a requirement is satisfied only by finalized accepted evidence
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — only finalized accepted evidence satisfies a requirement', () => {
  const STEP = body(read(MEDIA_STEP));

  it('the contract offers three counts, and the screen counts only the finalized one', () => {
    /*
     * `CaptureRequirementState` publishes `recordedCount` as well as
     * `finalizedCount`, so the screen has a CHOICE and the choice is the
     * behaviour worth pinning: a count taken from `recordedCount` would report a
     * visit complete on the strength of files that are merely stored.
     */
    const contract = GATE.stripComments(read('src/features/receptions/receptions-contract.ts'));
    const declaration = /export interface CaptureRequirementState \{([\s\S]*?)\n\}/.exec(contract);
    expect(declaration, 'CaptureRequirementState is no longer declared here').not.toBeNull();
    const fields = [...(declaration?.[1] ?? '').matchAll(/readonly (\w+)\s*:/g)].map((m) => m[1]);
    for (const field of [
      'minCount',
      'finalizedCount',
      'recordedCount',
      'satisfied',
      'overridden',
    ]) {
      expect(fields, field).toContain(field);
    }

    expect(STEP).toContain('{requirement.finalizedCount}/{requirement.minCount}');
    // `recordedCount` reaches the screen for ONE purpose: telling an operator
    // that something is held and does not count yet.
    expect(STEP.match(/requirement\.recordedCount/g) ?? []).toHaveLength(1);
    expect(STEP).toContain('requirement.recordedCount > requirement.finalizedCount');
  });

  it('renders four distinct states, and only one of them is a tick', () => {
    const STATES = {
      satisfied: 'receptions.capture.state.satisfied',
      overridden: 'receptions.capture.state.overridden',
      recordedNotCounted: 'receptions.capture.state.recordedNotCounted',
      outstanding: 'receptions.capture.state.outstanding',
    } as const;

    for (const key of Object.values(STATES)) {
      expect(STEP, `${key} is not rendered`).toContain(key);
      expect(Object.keys(EN), key).toContain(key);
      expect(Object.keys(AR), key).toContain(key);
      expect(AR[key], `${key} was never translated`).not.toBe(EN[key]);
      expect(AR[key], `${key} carries no Arabic script`).toMatch(/[؀-ۿ]/);
    }

    // Four states, four different sentences. A waiver that read the same as a
    // satisfied requirement would be the silent satisfaction `G` forbids.
    expect(new Set(Object.values(STATES).map((key) => EN[key])).size).toBe(4);
    expect(new Set(Object.values(STATES).map((key) => AR[key])).size).toBe(4);
    expect((EN[STATES.recordedNotCounted] ?? '').toLowerCase()).toContain('not counted');
  });

  it('a capture reports `finalized` only where the finalization answered', () => {
    /*
     * The outcome an operator is shown is derived from what the API said, and
     * the two ways a version can fail to count are different facts: no store
     * could be read at all, or the scan has not concluded. Neither is an error
     * and both are shown as themselves rather than as a tick.
     */
    expect(STEP).toContain(
      "if (outcome.stage === 'finalized') return 'receptions.capture.finalized'"
    );
    expect(STEP).toContain(
      "if (outcome.scannerAvailable === false) return 'receptions.capture.boundNoScanner'"
    );
    expect(STEP).toContain("return 'receptions.capture.boundPending'");
    for (const key of [
      'receptions.capture.finalized',
      'receptions.capture.boundNoScanner',
      'receptions.capture.boundPending',
      'receptions.capture.failed',
    ]) {
      expect(Object.keys(EN), key).toContain(key);
      expect(Object.keys(AR), key).toContain(key);
    }
    // The two "not counted" outcomes say so, so an operator is never told a
    // stored file met the requirement.
    expect((EN['receptions.capture.boundPending'] ?? '').toLowerCase()).toContain('not count');
    expect((EN['receptions.capture.boundNoScanner'] ?? '').toLowerCase()).toContain('not count');
  });

  it('is registered as a wizard step, so the operator meets it where they expect the camera', () => {
    const step = CHECK_IN_STEPS.find((candidate) => candidate.id === 'media-and-photographs');
    expect(step, 'the media step left the registry').toBeDefined();
    expect(step?.titleKey).toBe('receptions.steps.media.title');
    expect(step?.descriptionKey).toBe('receptions.steps.media.description');
  });
});

/* ------------------------------------------------------------------ *
 * G — the override is a different authority, and says so
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — the waiver is a separate authority with a recorded reason', () => {
  const STEP = body(read(MEDIA_STEP));

  it('costs `rec.reception.evidence.override`, which is not the capture permission', () => {
    /*
     * Deliberately not implied by `evidenceManage`: taking the photograph and
     * recording that no photograph was needed are different decisions, and
     * folding them together would make the requirement optional for everybody
     * who could satisfy it.
     */
    expect(RECEPTION_PERMISSIONS.evidenceOverride).toBe('rec.reception.evidence.override');
    expect(RECEPTION_PERMISSIONS.evidenceOverride).not.toBe(RECEPTION_PERMISSIONS.evidenceManage);

    const operation = RECEPTION_OPERATIONS.find(
      (row) => row.operationId === 'rec.reception-capture-override'
    );
    expect(operation, 'the override operation left the contract').toBeDefined();
    expect(operation?.permission).toBe(RECEPTION_PERMISSIONS.evidenceOverride);
    expect(operation?.method).toBe('POST');
    expect(operation?.idempotent).toBe(true);
    expect(operation?.auditClass).toBe('privileged');
  });

  it('records a reason, and refuses to send a blank one', () => {
    const api = body(read('src/features/receptions/api.ts'));
    expect(api).toContain('reason: z.string().trim().min(1).max(MAX_OVERRIDE_REASON)');
    expect(STEP).toContain('overrideCaptureRequirement(visitId, {');
    expect(STEP).toContain('reason,');
    // The submit is refused locally while the reason is empty, so the operator
    // is not spending a privileged audited write to learn that.
    expect(STEP).toContain("disabled={reason.trim() === ''}");
    for (const key of [
      'receptions.capture.overrideOpen',
      'receptions.capture.overrideReason',
      'receptions.capture.overrideSubmit',
      'receptions.capture.overrideWithheld',
    ]) {
      expect(Object.keys(EN), key).toContain(key);
      expect(Object.keys(AR), key).toContain(key);
      expect(AR[key], `${key} was never translated`).not.toBe(EN[key]);
    }
  });

  it('is ABSENT for an operator who does not hold it, with the reason stated', () => {
    /*
     * Absent, not greyed out. A disabled control asserts the capability exists
     * and this operator lacks permission, which is a different and — where the
     * screen cannot know why the server would refuse — a false statement. The
     * withheld line says what is missing instead.
     */
    expect(STEP).toContain('canOverride && !requirement.satisfied ? (');
    expect(STEP).toContain('!canOverride && !requirement.satisfied ? (');
    expect(STEP).toContain("translate(messages, 'receptions.capture.overrideWithheld')");
    expect(STEP).toContain('canOverride={capabilities.overrideEvidence && !writesLocked}');

    // The open control carries no `disabled`; the only disables on this screen
    // are the submit-while-pending and the empty-reason guard.
    const openControl = /data-testid=\{`capture-override-open-\$\{code\}`\}[\s\S]{0,200}?>/.exec(
      STEP
    );
    expect(openControl, 'the waiver control is no longer rendered').not.toBeNull();
    expect(openControl?.[0]).not.toContain('disabled');
  });

  it('cannot silently satisfy a requirement — a waiver reads as a waiver', () => {
    /*
     * The override sets `overridden`, and the state line branches on it FIRST,
     * before `satisfied`. So a waived requirement never renders the satisfied
     * sentence, and the recorded reason is printed beside it: a tick alone
     * cannot distinguish "met" from "waived", and an operator reading a handover
     * needs both.
     */
    const overridden = at(STEP, 'receptions.capture.state.overridden', 'the waived state');
    const satisfied = at(STEP, 'receptions.capture.state.satisfied', 'the satisfied state');
    expect(overridden).toBeLessThan(satisfied);
    expect(STEP).toContain('requirement.overridden');
    expect(STEP).toContain('{override.reason}');
    expect(EN['receptions.capture.state.overridden']).not.toBe(
      EN['receptions.capture.state.satisfied']
    );
    expect((EN['receptions.capture.state.overridden'] ?? '').toLowerCase()).toContain('reason');
  });
});

/* ------------------------------------------------------------------ *
 * The decision itself — recorded RESOLVED, and named as open nowhere
 * ------------------------------------------------------------------ */

describe('P1-28 — P1-OD-025 is recorded as RESOLVED, and no copy says otherwise', () => {
  /**
   * Copy that tells an operator a decision is still open, in either script.
   *
   * ONE definition, used by every case below, because two copies of a matcher
   * are two rules that can disagree — and the Arabic one has already had to be
   * widened once. `\b` is ASCII-only in JavaScript and never matches beside
   * Arabic script, so it appears nowhere in `AR_OPEN`; the words are separated by
   * a bounded run of non-terminator characters instead.
   *
   * That bound is what the first spelling got wrong. It read `قرار من المالك` as
   * a fixed phrase, and the copy this wave DELETED said
   * `موقوف بقرار مفتوح من المالك` — an adjective between the two words, so the
   * matcher would have passed the very string it exists to refuse. The gap
   * between "decision" and "the Owner" is now a span, not a comma.
   */
  const EN_OPEN = /pending an owner decision|open owner decision|owner decision|not yet decided/i;
  const AR_OPEN = /قرار[^.،؛\n]{0,20}المالك|بانتظار قرار|قيد القرار/;

  it('names the decision as one closed value', () => {
    /*
     * The identifier is kept rather than deleted so the closure is checkable: a
     * commit that re-blocks this surface has to say which decision re-opened.
     */
    expect(MEDIA_DECISION_ID).toBe('P1-OD-025');
    expect(MEDIA_DECISION_RESOLVED).toBe(true);
  });

  it('and the module exports the two constants and NOTHING of the old block', () => {
    /*
     * This is the assertion that would have caught the collection failure this
     * rewrite answers. The module used to publish a capture status, a decision
     * key list, a blocker table, a document-bound write list, a surface key map
     * and a runtime-state derivation; every one of them described the old world,
     * and one of them — `runtimeStateOf` — described behaviour that could not be
     * called at all, which is this project's dominant defect class arriving in
     * the module that was supposed to be the record.
     */
    expect(Object.keys(mediaDecision).sort()).toEqual([
      'MEDIA_DECISION_ID',
      'MEDIA_DECISION_RESOLVED',
    ]);
  });

  it('is named as an open decision by no shipped reception string, in EITHER script', () => {
    // Both matchers are proved to fire in the next case rather than trusted.
    let inspected = 0;
    for (const [key, value] of Object.entries(EN)) {
      if (!key.startsWith('receptions.')) continue;
      inspected += 1;
      expect(value, `en ${key}`).not.toMatch(EN_OPEN);
      expect(value, `en ${key} names the decision`).not.toContain(MEDIA_DECISION_ID);
    }
    for (const [key, value] of Object.entries(AR)) {
      if (!key.startsWith('receptions.')) continue;
      inspected += 1;
      expect(value, `ar ${key}`).not.toMatch(AR_OPEN);
      expect(value, `ar ${key} names the decision`).not.toContain(MEDIA_DECISION_ID);
    }
    expect(inspected).toBeGreaterThan(200);

    // And no component prints the identifier either — it is a constant in a
    // module, deliberately not copy.
    for (const { path, source } of SURFACE) {
      if (path === 'src/features/receptions/media/media-decision.ts') continue;
      expect(
        GATE.stripComments(source),
        `${path} names ${MEDIA_DECISION_ID} in code`
      ).not.toContain(MEDIA_DECISION_ID);
    }
  });

  it('both matchers CAN fire — including the Arabic one, where `\\b` never matches', () => {
    for (const planted of [
      'Capture is blocked by an open Owner decision.',
      'Accepted file types are pending an Owner decision.',
    ]) {
      expect(EN_OPEN.test(planted), planted).toBe(true);
    }
    /*
     * The first two are the Arabic this wave DELETED, verbatim — the decision
     * label and the ceiling sentence the notice rendered. A matcher that cannot
     * catch the copy that actually shipped is a matcher that would have watched
     * it ship.
     */
    for (const planted of [
      'موقوف بقرار مفتوح من المالك:',
      'أنواع الملفات المقبولة وحدود الحجم بانتظار قرار من المالك.',
      'قواعده بانتظار قرار المالك.',
      'الالتقاط موقوف والقرار قيد القرار.',
    ]) {
      expect(AR_OPEN.test(planted), planted).toBe(true);
    }
    // …and neither fires on the copy this surface actually ships.
    expect(EN_OPEN.test(EN['receptions.capture.intro'] ?? '')).toBe(false);
    expect(AR_OPEN.test(AR['receptions.capture.intro'] ?? '')).toBe(false);
  });

  it('exactly three strings anywhere still defer to an Owner decision — measured, not waved away', () => {
    /*
     * A pin rather than a sweep, because the honest answer is not zero and
     * pretending otherwise would hide the interesting one.
     *
     * The two `mergePendingDecision` strings are about `P1-OD-017` — duplicate
     * and merge rules — which is genuinely still open, and they are correct.
     *
     * `vehicles.media.blocked` is not. It tells an operator that accepted file
     * types, size limits and storage are pending an Owner decision, and that
     * decision has been taken; what actually blocks vehicle media is that the
     * platform publishes no vehicle media operation. It lives in P1-27's tree,
     * which this wave does not own, so it is REPORTED here rather than edited
     * here — and pinned, so a fourth deferral cannot join it unnoticed and this
     * one cannot be forgotten once its tree is opened.
     */
    const deferring = (catalogue: Record<string, string>, matcher: RegExp): string[] =>
      Object.entries(catalogue)
        .filter(([, value]) => matcher.test(value))
        .map(([key]) => key)
        .sort();

    const expected = [
      'crm.duplicates.mergePendingDecision',
      'vehicles.duplicates.mergePendingDecision',
      'vehicles.media.blocked',
    ];
    expect(deferring(EN, EN_OPEN)).toEqual(expected);
    expect(deferring(AR, AR_OPEN)).toEqual(expected);
  });
});

/* ------------------------------------------------------------------ *
 * The approved evidence policy — enforced, not forbidden
 * ------------------------------------------------------------------ */
/**
 * The APPROVED `P1-OD-025` evidence policy, enforced over the repository.
 *
 * ## What this block used to be, and why it changed
 *
 * It proved an ABSENCE: that no SQL anywhere could create a document category,
 * that the default storage provider refused every signing call, and that no
 * version could ever leave `pending`. Those three facts were the reason
 * `FE-012`'s map half and `FE-018` were unreachable, and while the decision was
 * open, asserting them was right.
 *
 * The Owner has RESOLVED `P1-OD-025`. The approved model is a PRIVATE VERSIONED
 * one — Document → immutable Version → business link — with the lifecycle
 * `authorized → pending → scanning → accepted`, exceptionally `rejected` or
 * `quarantined`; only an accepted version is finalized evidence; a scanner
 * failure may never auto-accept; storage is private and server-authorized; and
 * evidence is NEVER authorized by a filename or a storage key.
 *
 * So an absence is no longer the thing worth proving, and a gate that still
 * demanded one would refuse the very foundation the Owner asked for. The gate is
 * therefore CONVERTED, not deleted: it stops forbidding the capability and
 * starts enforcing the policy the capability must obey.
 *
 * ## Why every rule is universally quantified, and why that is not vacuous
 *
 * Each rule below reads "for whatever the repository contains, it must satisfy
 * P". A tree carrying no evidence foundation satisfies all of them having
 * examined nothing — which, on its own, would be exactly the kind of clean sweep
 * this project has repeatedly caught meaning nothing.
 *
 * So every rule is ALSO applied to a PLANTED violation it must reject. That is
 * the same anti-vacuity idiom this file uses for the gate rules above
 * (`GATE.evaluate([...])` with one planted source per rule), and it is what makes
 * a pass here evidence rather than silence: the rule is proved to fire before it
 * is reported as finding nothing.
 *
 * The BROWSER half of this policy — no credential, no raw object key, no storage
 * configuration, no signed URL outside the module that spends it — is asserted
 * further up, in `the browser receives no storage authority of any kind`, where
 * it sits beside the two rules the resolved decision added to it. It is the same
 * `browserHoldsNoStorageAuthority` function with the same planted violation; only
 * its neighbours changed.
 */
describe('P1-28 — the approved P1-OD-025 evidence policy is enforced', () => {
  const API = join(REPO, 'apps', 'api');

  /*
   * The rules. Each is a pure function over sources so the SAME function can be
   * handed a planted violation below — a rule proved only over the repository
   * would be a rule nobody has ever seen fail.
   */

  /**
   * The EFFECTIVE version lifecycle is exactly the approved set.
   *
   * Only the LAST definition counts, and that is the whole subtlety. Migrations
   * apply in filename order and this constraint is legitimately redefined: the
   * migration that first created `shared.document_versions` declared
   * `pending/accepted/quarantined/rejected`, because `scanning` did not exist as
   * a state until the Owner approved the scan step. Judging every historical
   * definition would condemn a migration series for having had a past — the
   * rule would fail on the very history that arrives at the approved answer.
   * What must satisfy the policy is the state the database actually ends in.
   */
  function versionLifecycleIsApproved(files: readonly PolicySource[]): readonly string[] {
    const APPROVED = ['pending', 'scanning', 'accepted', 'quarantined', 'rejected'];
    const definitions = [...files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .flatMap(({ path, source }) => {
        const found = [
          ...source.matchAll(
            /ck_document_versions_status[\s\S]{0,200}?status\s+IN\s*\(([^)]*)\)/gi
          ),
        ];
        return found.map((match) => ({ path, values: match[1] ?? '' }));
      });

    /*
     * `.at(-1)` with an explicit guard rather than `[length - 1]`: the web
     * workspace compiles under `noUncheckedIndexedAccess`, so an index read is
     * `T | undefined` however carefully the length was checked first. The guard
     * is the honest form anyway — it says out loud that a repository with no
     * lifecycle definition satisfies this rule having examined nothing.
     */
    const effective = definitions.at(-1);
    if (!effective) return [];
    const declared = [...effective.values.matchAll(/'([a-z_]+)'/gi)]
      .map((m) => m[1])
      .filter((state): state is string => typeof state === 'string');

    /*
     * The vocabulary is CLOSED, not fixed. A tree that has not yet grown the
     * scan step declares a subset — `pending/accepted/quarantined/rejected` —
     * and that is the honest state of such a tree, not a violation. What the
     * policy forbids is a state the Owner never approved: an `auto_accepted`,
     * a `skipped`, a `trusted`, any spelling of "this one did not have to earn
     * acceptance". Whether acceptance is EARNED is a separate rule, and it is
     * `acceptanceRequiresACleanScan` that holds it.
     */
    const invented = declared.filter((state) => !APPROVED.includes(state));
    if (invented.length > 0) {
      return [
        `${effective.path}: the version lifecycle invents ${invented.join('/')}, which P1-OD-025 does not approve`,
      ];
    }
    return [];
  }

  /** Acceptance is earned by a clean scan; a scanner failure never accepts. */
  function acceptanceRequiresACleanScan(files: readonly PolicySource[]): readonly string[] {
    const failures: string[] = [];
    for (const { path, source } of files) {
      if (!/status\s*(?::=|=)\s*'accepted'/i.test(source)) continue;
      if (!/file_scan_results/i.test(source) || !/'clean'/i.test(source)) {
        failures.push(`${path}: a version reaches 'accepted' without requiring a clean scan`);
      }
    }
    return failures;
  }

  /** A signature becomes final only against an ACCEPTED version. */
  function signatureFinalizationRequiresAcceptance(
    files: readonly PolicySource[]
  ): readonly string[] {
    const failures: string[] = [];
    for (const { path, source } of files) {
      if (!/signature_events/i.test(source) || !/'finalized'/i.test(source)) continue;
      if (!/'accepted'/i.test(source)) {
        failures.push(`${path}: a signature may be finalized without an accepted version`);
      }
    }
    return failures;
  }

  const RULES = [
    ['categories are governed', categoriesAreGoverned],
    ['the version lifecycle is the approved set', versionLifecycleIsApproved],
    ['acceptance requires a clean scan', acceptanceRequiresACleanScan],
    ['signature finalization requires acceptance', signatureFinalizationRequiresAcceptance],
  ] as const;

  it('measures a real repository — an empty sweep would satisfy every rule below', () => {
    // The guard the three deleted cases did not have. A `walkAny` that silently
    // returned nothing would make every policy rule pass having read no file.
    expect(SQL.length).toBeGreaterThan(100);
    expect(SQL.some(({ path }) => path.startsWith('supabase/migrations/'))).toBe(true);
    // The seeded reception categories are the thing the resolved decision added.
    expect(
      SQL.some(({ source }) => /INSERT\s+INTO\s+shared\.document_categories/i.test(source))
    ).toBe(true);
  });

  it.each(RULES.map(([name, rule]) => [name, rule] as const))(
    'holds across every migration and seed: %s',
    (_name, rule) => {
      expect(rule(SQL)).toEqual([]);
    }
  );

  it('every rule REJECTS a planted violation, so finding nothing means something', () => {
    /*
     * Non-vacuity, stated per rule. Each planted source is the smallest thing
     * the approved policy forbids; if a rule ever stops catching its own
     * counter-example, this case says so before a real one ships.
     */
    expect(
      categoriesAreGoverned([
        {
          path: 'planted.sql',
          source:
            'INSERT INTO shared.document_categories (id, category_code, default_classification) ' +
            "VALUES ('x','reception_exterior','public');",
        },
      ])
    ).toHaveLength(2); // public classification, and no retention class

    expect(
      versionLifecycleIsApproved([
        {
          path: 'planted.sql',
          source:
            'ALTER TABLE shared.document_versions ADD CONSTRAINT ck_document_versions_status ' +
            "CHECK (status IN ('pending','scanning','accepted','quarantined','rejected','auto_accepted'));",
        },
      ])
    ).toHaveLength(1); // `auto_accepted` — a state that never has to earn acceptance

    expect(
      acceptanceRequiresACleanScan([
        { path: 'planted.sql', source: "UPDATE shared.document_versions SET status = 'accepted';" },
      ])
    ).toHaveLength(1);

    expect(
      signatureFinalizationRequiresAcceptance([
        {
          path: 'planted.sql',
          source: "INSERT INTO rec.signature_events (event_type) VALUES ('finalized');",
        },
      ])
    ).toHaveLength(1);

    // …and each rule PASSES the compliant form, so it is not simply always red.
    expect(
      versionLifecycleIsApproved([
        {
          path: 'planted.sql',
          source:
            'ALTER TABLE shared.document_versions ADD CONSTRAINT ck_document_versions_status ' +
            "CHECK (status IN ('pending','scanning','accepted','quarantined','rejected'));",
        },
      ])
    ).toEqual([]);
    expect(
      categoriesAreGoverned([
        {
          path: 'planted.sql',
          source:
            'INSERT INTO shared.document_categories (id, category_code, default_classification, ' +
            "default_retention_class) VALUES ('x','reception_exterior','restricted','operational');",
        },
      ])
    ).toEqual([]);
  });

  it('the document-bound signature write still requires BOTH uuids, so it cannot degrade', () => {
    /*
     * Unchanged and still load-bearing, and now for a reachable operation rather
     * than an unreachable one. `signatureDocumentId` and
     * `signatureDocumentVersionId` are not optional fields that could be omitted
     * while the rest of the write proceeds: they are what binds a signature to
     * an EXACT immutable version, and a later relaxation HERE is exactly the
     * change that should be noticed.
     */
    const signature = readFileSync(
      join(API, 'src', 'app', 'api', 'v1', 'receptions', '[receptionId]', 'signatures', 'route.ts'),
      'utf8'
    );
    expect(signature).toMatch(/signatureDocumentId:\s*schemas\.uuid\s*,/);
    expect(signature).toMatch(/signatureDocumentVersionId:\s*schemas\.uuid\s*,/);
    expect(signature).not.toMatch(/signatureDocumentId:[^\n]*(optional|nullable)/);
    expect(signature).not.toMatch(/signatureDocumentVersionId:[^\n]*(optional|nullable)/);

    // And the capture that now produces them sends both, from one registration.
    const capture = body(read(SIGNATURE_CAPTURE));
    expect(capture).toContain('signatureDocumentId: documentId,');
    expect(capture).toContain('signatureDocumentVersionId: versionId,');
  });
});
