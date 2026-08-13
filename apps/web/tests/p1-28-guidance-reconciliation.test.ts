import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APPOINTMENT_PERMISSIONS } from '@/features/appointments/appointments-contract';
import { RECEPTION_PERMISSIONS } from '@/features/receptions/receptions-contract';
import { EVIDENCE_KIND_COVERAGE } from '@/features/receptions/check-in/evidence';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * `P1-28-DOC-002` — the guidance half, pinned to the executable thing.
 *
 * ## Why an existence check would be the wrong proof
 *
 * The dominant defect class across P1-27 and P1-28 is *a document stating a rule
 * the code does not implement*. A test that asserts `operator-guide.md` exists
 * passes against a guide describing a product nobody built — and this guide is
 * read by a receptionist who cannot check it and by the P1-29 developer who will
 * believe it.
 *
 * So every case below pins a guide SENTENCE to the executable fact it describes,
 * and the executable side is imported or read from source, never quoted. Change
 * the product and the guide becomes false and this file fails, naming the
 * sentence.
 *
 * ## What it is not
 *
 * It is not a spell-checker and it is not a word count. Where the guide states a
 * number ("four of the eight kinds record unconditionally"), the number is
 * re-derived here from `EVIDENCE_KIND_COVERAGE` rather than read out of the
 * sentence — a hand-written figure in a document is the exact thing thirteen
 * stale P1-27 counts were.
 */

const REPO = join(process.cwd(), '..', '..');
const PHASE = join(REPO, 'docs', 'phase-1', 'phase-1-28');
const WEB_SRC = join(process.cwd(), 'src');

const OPERATOR = readFileSync(join(PHASE, 'operator-guide.md'), 'utf8');
const DEVELOPER = readFileSync(join(PHASE, 'developer-guide.md'), 'utf8');
const CHANGE_LOG = readFileSync(join(PHASE, 'evidence', 'change-log.md'), 'utf8');

/*
 * The gates, imported rather than described.
 *
 * `import … from '../../../scripts/ci/*.mjs'` is `TS2307` in this workspace —
 * the P1-27 security suite records the same thing — so the gate modules are
 * loaded by URL. They are loaded at all because `DOC-002`'s developer half is
 * only worth anything if the page is held to what the gates ACTUALLY enforce:
 * writing this page from the access gate's own docblock would have described
 * six rules where seven exist.
 */
const gateModule = async (name: string) =>
  (await import(pathToFileURL(join(REPO, 'scripts', 'ci', name)).href)) as Record<string, never>;

const TRACEABILITY = (await gateModule('check-p1-28-traceability.mjs')) as unknown as {
  accessRuleIds: () => string[];
  deriveCounts: () => { gates: Record<string, number> };
  TABLE_KINDS: readonly string[];
};
const REACHABILITY = (await gateModule('check-p1-28-write-reachability.mjs')) as unknown as {
  CLASSIFICATIONS: readonly string[];
};
const VERSION_SOURCING = (await gateModule('check-p1-28-version-sourcing.mjs')) as unknown as {
  classifyVersionExpression: (
    expression: string,
    context: { cached: Set<string>; declarations: Map<string, string>; parameters: Set<string> }
  ) => { ok: boolean; reason?: string };
};

const read = (...parts: string[]) => readFileSync(join(WEB_SRC, ...parts), 'utf8');

describe('the guide really was read, and really describes this phase', () => {
  it('is a document, not a stub', () => {
    expect(OPERATOR.length, 'the operator guide is too short to say anything').toBeGreaterThan(
      4000
    );
    expect(OPERATOR).toContain('# Phase 1-28 — operator guide');
    // Both domains, or it is half a guide for a two-domain phase.
    expect(OPERATOR).toContain('## Appointments');
    expect(OPERATOR).toContain('## Reception');
  });
});

describe('the appointment sentences', () => {
  it('"there is no Confirm button" — the control really says what it calls', () => {
    /*
     * The riskiest fact in the phase: confirmation is a SIDE EFFECT of
     * `apt.appointment-reschedule` and no confirm operation exists. If a future
     * wave adds a control labelled plainly "Confirm", this fails.
     */
    expect(OPERATOR).toContain('There is no Confirm button');
    expect(en['appointments.reschedule.submit']).toBe('Confirm by rescheduling');
    expect(en['appointments.status.pendingNote']).toContain('no separate confirm button');
    // And the Arabic carries the same statement rather than an English string.
    expect(ar['appointments.reschedule.submit']).toBeTruthy();
    expect(ar['appointments.reschedule.submit']).not.toBe(en['appointments.reschedule.submit']);
    expect(/[؀-ۿ]/.test(ar['appointments.reschedule.submit'] as string)).toBe(true);
  });

  it('"a different permission from booking" — the two codes really differ', () => {
    expect(OPERATOR).toContain('**different permission** from booking');
    expect(APPOINTMENT_PERMISSIONS.lifecycleManage).not.toBe(APPOINTMENT_PERMISSIONS.manage);
    // The pages enforce the split rather than merely declaring it.
    const detail = readFileSync(
      join(
        WEB_SRC,
        'app',
        '[locale]',
        '(dashboard)',
        'appointments',
        '[appointmentId]',
        'page.tsx'
      ),
      'utf8'
    );
    expect(detail).toContain('APPOINTMENT_PERMISSIONS.lifecycleManage');
    expect(detail).toContain('APPOINTMENT_PERMISSIONS.read');
  });

  it('"there is no edit screen" — no appointment edit route exists', () => {
    expect(OPERATOR).toContain('there is no edit screen');
    // Derived: the appointment route tree holds exactly the three pages the
    // guide describes. An `edit` route appearing here fails.
    const routes = join(WEB_SRC, 'app', '[locale]', '(dashboard)', 'appointments');
    const entries = readdirSync(routes, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort();
    expect(entries).toEqual(['[appointmentId]', 'new', 'page.tsx']);
  });
});

describe('the reception sentences', () => {
  it('"you cannot search for a customer by telephone number" — and the screen says so', () => {
    expect(OPERATOR).toContain('cannot search for a customer by telephone number');
    expect(en['receptions.intake.phone.title']).toContain('phone number is not available');
    // The statement is rendered, not merely translated.
    expect(
      read('features', 'receptions', 'intake', 'components', 'WalkInIntakeScreen.tsx')
    ).toMatch(/receptions\.intake\.phone\./);
  });

  it('"you can still resume a visit" — read-only really keeps the resume path', () => {
    expect(OPERATOR).toContain('**resume** a visit that is already open');
    expect(en['receptions.checkIn.createDenied']).toContain('resume an open visit');
    expect(RECEPTION_PERMISSIONS.read).not.toBe(RECEPTION_PERMISSIONS.manage);
  });

  it('"recorded as an identifier, not as an employee" — G-EMP is stated on screen', () => {
    expect(OPERATOR).toContain('recorded as an identifier, not as an employee');
    expect(en['receptions.wizard.receivingEmployeeNote']).toContain('G-EMP');
    expect(en['receptions.checkIn.employeeHint']).toContain('G-EMP');
  });

  it('"it never shows you a raw identifier in place of a name" — and neither surface does', () => {
    /*
     * The guide said this while both read-back surfaces rendered
     * `detail.receivingEmployeeId` in a `<code>` element, and the assertion
     * beside this one pinned only the note's wording, which stayed true while
     * the sentence above it did not. `canonical-plan.md` §7 states the same rule
     * as a disposition: "The UI shows names, never UUIDs."
     *
     * Held against the SOURCE of both surfaces rather than against the note,
     * because the note is not what was wrong.
     */
    expect(OPERATOR).toContain('never shows you a raw identifier');
    for (const file of ['CheckInWizardShell.tsx', 'AcknowledgementDocument.tsx']) {
      const source = read('features', 'receptions', 'components', file);
      expect(source, `${file} does not render the receiving employee at all`).toContain(
        'receivingEmployee'
      );
      /*
       * The identifier must not be READ here at all, not merely not rendered in
       * the one spelling it was rendered in. A first draft of this matched
       * `{detail.receivingEmployeeId}` exactly and passed over the same value
       * put back as a JSX ternary arm — a guard that could only catch the
       * defect it had already seen. Neither surface has any use for the value:
       * the route resolves it and hands down the outcome.
       */
      expect(source, `${file} reads the raw receiving-employee identifier`).not.toMatch(
        /detail\.receivingEmployeeId/
      );
    }
  });

  it('"no submit control on that step" — the signature write really is uncalled', () => {
    expect(OPERATOR).toContain('There is no submit control on that step');
    const step = read('features', 'receptions', 'components', 'steps', 'SignatureStep.tsx');
    expect(step, 'the signature step now calls a write').not.toMatch(/recordSignature\s*\(/);
    // And the phase's own reachability manifest agrees, so the guide, the code
    // and the SEC-004 record cannot drift apart in pairs.
    const manifest = JSON.parse(readFileSync(join(PHASE, 'write-reachability.json'), 'utf8')) as {
      operations: Record<string, { classification: string }>;
    };
    expect(manifest.operations['rec.reception-signature']?.classification).toBe('NOT_YET_WIRED');
  });

  it('"a refusal does not end the visit" — the exit is a different operation', () => {
    expect(OPERATOR).toContain('**It does not end the visit.**');
    const manifest = JSON.parse(readFileSync(join(PHASE, 'write-reachability.json'), 'utf8')) as {
      operations: Record<string, { classification: string }>;
    };
    // Two operations, one English word. Both exist; they are not the same one.
    expect(Object.keys(manifest.operations)).toContain('rec.reception-refusal');
    expect(Object.keys(manifest.operations)).toContain('rec.reception-refuse');
    expect(RECEPTION_PERMISSIONS.close).not.toBe(RECEPTION_PERMISSIONS.signatureManage);
  });

  it('"a third permission again" — approve, close and evidence are three codes', () => {
    expect(OPERATOR).toContain('needs a third permission again');
    const codes = [
      RECEPTION_PERMISSIONS.evidenceManage,
      RECEPTION_PERMISSIONS.approve,
      RECEPTION_PERMISSIONS.close,
    ];
    expect(new Set(codes).size, 'two of the three authorities are the same code').toBe(3);
  });

  it('"conversion is the only way a work order comes to exist"', () => {
    expect(OPERATOR).toContain('**only** way a work order comes to exist');
    expect(en['receptions.steps.convert.description']).toContain(
      'only way a work order comes to exist'
    );
  });
});

describe('the media and coverage sentences, with their numbers re-derived', () => {
  it('"nothing takes, chooses or records a picture" — and the screen says it', () => {
    expect(OPERATOR).toContain('Media capture is not available');
    expect(en['receptions.media.blocked']).toContain('Nothing on this screen takes');
  });

  it('never says "uploaded" where the product says "registered, pending"', () => {
    /*
     * A truthful-labelling obligation from `canonical-plan.md` §10. The guide
     * is the easiest place for the wrong word to survive, because nothing
     * renders it.
     */
    expect(OPERATOR).toContain('registered, pending');
    /*
     * The word may appear exactly once, and only where the guide is naming it
     * as the word the product does not use. A flat ban would forbid the guide
     * from stating its own rule; a flat allowance would let the wrong word back
     * in beside a screenshot of a file that is not stored anywhere.
     */
    const uses = OPERATOR.match(/\buploaded\b/gi) ?? [];
    expect(uses.length, 'the guide uses "uploaded" more than once').toBeLessThanOrEqual(1);
    if (uses.length === 1) {
      expect(OPERATOR, 'the one use is not the statement of the rule').toContain(
        'never "uploaded"'
      );
    }
    expect(en['receptions.summary.mediaRegistered']).toBe('Media registered, pending');
  });

  it('states the coverage split as the table actually holds it', () => {
    const count = (status: string) =>
      EVIDENCE_KIND_COVERAGE.filter((row) => row.status === status).length;
    expect(EVIDENCE_KIND_COVERAGE.length, 'the union is eight kinds').toBe(8);
    // Derived, then matched against the sentence — not read out of it.
    const sentence = `**${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][count('wired')]} of the eight`;
    expect(OPERATOR, `the guide misstates the wired count (${count('wired')})`).toContain(sentence);
    expect(OPERATOR).toContain(
      `${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][count('data_gated')]} wait on data`
    );
    expect(count('blocked'), 'exactly one kind is blocked outright').toBe(1);
    expect(OPERATOR).toContain('one is blocked');
  });

  it('"road test is not part of this release" — nothing is labelled as one', () => {
    expect(OPERATOR).toContain('Road test is not part of this release');
    expect(en['receptions.inspection.roadTestAbsent']).toContain(
      'nothing here is offered as a road test'
    );
  });
});

describe('the failure-message table matches the platform convention', () => {
  it('states the reference rule in both directions, and the code agrees', () => {
    expect(OPERATOR).toContain('It does **not** appear on a permission the screen decided');
    // `DataTable` is where the convention is implemented for every list in the
    // product: denied/unavailable/error carry it, expired and not-found do not.
    const table = read('components', 'data-table', 'DataTable.tsx');
    const carries = /<SessionExpiredState messages=\{messages\} \/>/.test(table);
    expect(carries, 'the expired state started carrying a reference').toBe(true);
    expect(table).toMatch(/<NotFoundState messages=\{messages\} \/>/);
    expect(table).toMatch(/<ErrorState messages=\{messages\} correlationId=\{correlationId\}/);
  });
});

describe('the change-log half of DOC-002', () => {
  it('follows the sibling convention rather than inventing a path', () => {
    // `phase-1-19`, `-20`, `-21` and `-27` each carry `evidence/change-log.md`.
    // P1-27's own change log records that the phase shipped nothing there for a
    // while and that no document recorded a decision to drop it.
    expect(CHANGE_LOG.length).toBeGreaterThan(2000);
    expect(CHANGE_LOG).toContain('# P1-28 — change log');
    for (const sibling of ['phase-1-19', 'phase-1-21', 'phase-1-27']) {
      const path = join(REPO, 'docs', 'phase-1', sibling, 'evidence', 'change-log.md');
      expect(readFileSync(path, 'utf8').length, `${sibling} lost its change log`).toBeGreaterThan(
        100
      );
    }
  });

  it('names every canonical task category, so no category goes unlogged', () => {
    for (const prefix of ['FE-', 'SEC-', 'QA-', 'DO-', 'DOC-']) {
      expect(CHANGE_LOG, `the change log mentions no ${prefix} task`).toContain(`P1-28-${prefix}`);
    }
  });

  it('records the Backend remediations, the decision and the browser tier by name', () => {
    /*
     * A change log is only a record if a later reader can find the events that
     * shaped the product in it. These are the ones this phase turned on: the
     * three pull requests that changed what the Frontend could consume, the
     * open decision that explains every empty catalogue, the tier that is not a
     * mock, and the launcher without which an acceptance session reports
     * defects that do not exist.
     */
    for (const anchor of ['#220', '#221', '#227', 'P1-28-OD-001', 'acceptance:serve']) {
      expect(CHANGE_LOG, `the change log never names ${anchor}`).toContain(anchor);
    }
    expect(CHANGE_LOG, 'the browser tier is unlogged').toMatch(
      /authenticated browser tier|browser tier/i
    );
    expect(CHANGE_LOG, 'the production-build acceptance rule is unlogged').toMatch(
      /next dev|production build/i
    );
  });

  it('records the integration fixes that changed the product, not only the record', () => {
    // Each of these was a real defect a green tier did not see. A change log
    // that lists only features is a release note.
    expect(CHANGE_LOG, 'the walk-in seam is unlogged').toContain('/receptions/check-in');
    expect(CHANGE_LOG, 'the silent coordinate rounding is unlogged').toContain('toFixed(2)');
  });

  it('states the phase is open, because no Owner acceptance has been returned', () => {
    /*
     * The permanent Frontend rule from P1-26 onward: silence is not Pass, and a
     * phase closes only on an explicit `OWNER ACCEPTANCE: PASS` against the
     * running application. A change log that reads as a closure record is how
     * P1-26 was closed once on five unproven claims.
     */
    expect(CHANGE_LOG).toContain('OWNER ACCEPTANCE');
    expect(CHANGE_LOG).toMatch(/not been (asked|returned|given)|NOT closed|remains open/i);
  });
});

/* ================================================================== *
 * The DEVELOPER half of `DOC-002`
 * ================================================================== */

/**
 * `DOC-002` is a conjunction — operator **and** developer guidance, **and** the
 * change-log update — and this phase shipped two thirds of it. P1-27 paid a
 * whole adversarial round for exactly this: a conjunction counted as resolved
 * when only part of it was proven.
 *
 * P1-27's precedent is a developer guide held to **list exactly the rules its
 * gate enforces**, so that is the standard applied here. Nothing below reads the
 * gates' docblocks: writing this page from the access gate's own prose would
 * have described six rules where the executable source enforces seven.
 */
describe('the developer guide describes the gates that actually exist', () => {
  it('is a document, not a stub, and names every gate a change must satisfy', () => {
    expect(DEVELOPER.length, 'the developer guide is too short to say anything').toBeGreaterThan(
      4000
    );
    expect(DEVELOPER).toContain('# Phase 1-28 — developer guide');
    for (const command of [
      'validate:p1-28-access',
      'validate:p1-28-write-reachability',
      'validate:p1-28-version-sourcing',
      'validate:p1-28-matrix',
      'validate:p1-28-traceability',
    ]) {
      expect(DEVELOPER, `the guide never names ${command}`).toContain(command);
    }
  });

  it('lists exactly the rules the access gate enforces — no more, no fewer', () => {
    const ids = TRACEABILITY.accessRuleIds();
    expect(ids.length, 'no rule id was derived — this case would be vacuous').toBeGreaterThan(5);

    const listed = [...DEVELOPER.matchAll(/^- `([a-z][a-z0-9-]+)` — /gm)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]]
    );
    const missing = ids.filter((id) => !listed.includes(id));
    const invented = listed.filter((id) => !ids.includes(id));
    // Named individually: "one missing" is not something a reader can act on.
    expect(missing, 'gate rules the guide does not describe').toEqual([]);
    expect(invented, 'rules the guide describes and the gate does not carry').toEqual([]);
  });

  it('names the three write classifications the reachability gate allows', () => {
    const classifications = REACHABILITY.CLASSIFICATIONS;
    expect(classifications.length, 'the vocabulary is three').toBe(3);
    for (const name of classifications) {
      expect(DEVELOPER, `the guide never mentions ${name}`).toContain(name);
    }
    // And the property that makes the allow-list a ratchet rather than a list.
    expect(DEVELOPER).toContain('only SHRINKS');
  });

  it('states the version-sourcing rule the classifier really implements', () => {
    /*
     * Driven, not quoted. The guide says a server-stated `.recordVersion` and a
     * supplied parameter pass, and that arithmetic and component state fail —
     * so each of those four sentences is run through the gate's own classifier.
     */
    const context = {
      cached: new Set(['cachedVersion']),
      declarations: new Map<string, string>(),
      parameters: new Set(['ifMatch']),
    };
    const classify = VERSION_SOURCING.classifyVersionExpression;
    expect(classify('detail.recordVersion', context).ok, 'a server-stated version').toBe(true);
    expect(classify('ifMatch', context).ok, 'a supplied parameter').toBe(true);
    expect(classify('version + 1', context).ok, 'arithmetic must fail closed').toBe(false);
    expect(classify('cachedVersion', context).ok, 'component state must fail closed').toBe(false);

    for (const phrase of ['`COMPUTED`', '`CACHED`', '`UNTRACEABLE`', 'wrong half the time']) {
      expect(DEVELOPER, `the guide does not state ${phrase}`).toContain(phrase);
    }
  });

  it('carries the derived counts rather than hand-written ones', () => {
    const gates = TRACEABILITY.deriveCounts().gates;
    expect(TRACEABILITY.TABLE_KINDS.length, 'the marker vocabulary is empty').toBeGreaterThan(3);
    for (const [name, value] of Object.entries(gates)) {
      expect(DEVELOPER, `the guide states no derived marker for gates ${name}`).toContain(
        `derived: gates ${name} = ${value}`
      );
    }
  });

  it('warns about the traps that cost this phase real time', () => {
    // Each of these was a defect a green battery did not see, and each is the
    // kind a new developer repeats within a week of arriving.
    for (const trap of [
      'typecheck:web',
      'lint:web',
      'verify:contracts',
      'acceptance:serve',
      'P1-28-OD-001',
      'G-EMP',
    ]) {
      expect(DEVELOPER, `the guide never warns about ${trap}`).toContain(trap);
    }
    expect(DEVELOPER, 'the mock rule is the one sentence that must not be dropped').toContain(
      'Mocks are not production-integration evidence'
    );
  });
});

describe('the operator guide covers what an operator meets on day one', () => {
  it('explains party roles and authority as two different records', () => {
    expect(OPERATOR).toContain('### Parties and authority');
    expect(OPERATOR).toContain('different permissions');
    // Recording a role and recording a decision are different authorities, and
    // the contract really carries two codes rather than one.
    expect(RECEPTION_PERMISSIONS.partyManage).not.toBe(RECEPTION_PERMISSIONS.authorizationVerify);
  });

  it('names the decision behind every empty catalogue, rather than a setting', () => {
    /*
     * The single most likely support call in this release. `P1-28-OD-001` is a
     * decision recorded in `canonical-plan.md` §7, and the gate that classifies
     * the twenty-one catalogue writes resolves that reference — so if the
     * decision heading is ever removed, the reference in this guide stops being
     * true and `validate:p1-28-write-reachability` fails first.
     */
    expect(OPERATOR).toContain('P1-28-OD-001');
    expect(OPERATOR).toContain('No appointment can be booked');
    const plan = readFileSync(join(PHASE, 'canonical-plan.md'), 'utf8');
    expect(plan, 'the guide cites a decision the plan does not record').toContain(
      '### `P1-28-OD-001`'
    );
  });

  it('says acceptance runs on the production build, and why dev must not be used', async () => {
    expect(OPERATOR).toContain('npm run acceptance:serve');
    expect(OPERATOR).toContain('Not `npm run dev:all`');
    expect(DEVELOPER).toContain('npm run acceptance:serve');

    /*
     * Driven rather than quoted. The guide's claim is that the two commands
     * serve DIFFERENT modes and that the acceptance one is the production
     * build — so the launcher's own vocabulary is asked, and the registered
     * command is asked to parse to the mode the guide names.
     */
    const launch = (await import(
      pathToFileURL(join(REPO, 'scripts', 'dev', 'launch-mode.mjs')).href
    )) as unknown as {
      MODES: readonly string[];
      DEFAULT_MODE: string;
      PRODUCTION: string;
      parseModeArgv: (argv: string[]) => { mode: string; errors: string[] };
    };
    expect(launch.MODES).toContain(launch.PRODUCTION);
    expect(launch.DEFAULT_MODE, '`dev:all` must stay the development mode').not.toBe(
      launch.PRODUCTION
    );

    const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const argvOf = (name: string) => {
      const command = root.scripts[name];
      if (command === undefined) throw new Error(`no \`${name}\` command is registered`);
      return command.split(/\s+/).slice(2);
    };
    const parsed = launch.parseModeArgv(argvOf('acceptance:serve'));
    expect(parsed.errors).toEqual([]);
    expect(parsed.mode, '`acceptance:serve` no longer asks for the production mode').toBe(
      launch.PRODUCTION
    );
    expect(launch.parseModeArgv(argvOf('dev:all')).mode).toBe(launch.DEFAULT_MODE);
  });
});
