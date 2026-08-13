import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const CHANGE_LOG = readFileSync(join(PHASE, 'evidence', 'change-log.md'), 'utf8');

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
    expect(en['receptions.wizard.receivingEmployeeNote']).toContain('no name can be shown');
    expect(en['receptions.checkIn.employeeHint']).toContain('G-EMP');
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
