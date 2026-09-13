/**
 * The red-proof for `check-p1-31-access.mjs` (P1-31, delivery detail screen).
 *
 * A pass over the pages that exist is not proof that a gate refuses the pages it
 * must. So its teeth are proved here: pages are PLANTED under a scratch app root
 * in each shape the rule has to refuse, and the gate is required to go red on
 * every one.
 *
 * The shapes are the ones an adversarial review took the first P1-29 gate apart
 * with — every hole was a FALSE NEGATIVE — and this gate reuses that gate's
 * judgement (`judgePage`) precisely so those shapes cannot regress here without
 * regressing there. These cases exist so the reuse is checked, not trusted.
 *
 * Two properties are this gate's OWN, and neither sibling has them:
 *
 *  - the scope is an allow-list of operation ids rather than a namespace, so a
 *    stale entry must be a violation rather than a quiet shrink;
 *  - the SINGULAR `delivery` segment is owned, which is the whole reason the
 *    file exists: every delivery operation is addressed under `deliveries`, and
 *    the href committed in navigation is `/delivery`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  P1_31_AREAS,
  P1_31_OPERATION_IDS,
  deferredSegments,
  deriveSegments,
  ownedSegments,
  p1_31PagesUnder,
} from '../../scripts/ci/check-p1-31-access.mjs';
import { p1_29PagesUnder } from '../../scripts/ci/check-p1-29-access.mjs';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts', 'ci', 'check-p1-31-access.mjs');

let scratch = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'p131-access-'));
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

function run(args: readonly string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [GATE, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const runOn = (appRoot: string) => run(['--app-root', appRoot]);

/** Plants ONE page at `<appRoot>/[locale]/(dashboard)/<segment>/page.tsx`. */
function plant(name: string, segment: string, source: string): string {
  const appRoot = join(scratch, name);
  const dir = join(appRoot, '[locale]', '(dashboard)', segment);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'page.tsx'), source);
  return appRoot;
}

const GATED = `
export default async function Page({ params }) {
  const { locale } = await params;
  const session = await requireSession(locale);
  if (!holds(session.permissions, DELIVERY_PERMISSIONS.view)) {
    return <PermissionDeniedState />;
  }
  const record = await readDelivery(deliveryId);
  return <Screen record={record} />;
}
`;

/**
 * What the gate reports over this repository's own application root today.
 *
 * These are PINS, not floors. `> 0` cannot tell a page that was deleted from a
 * page that was never written, and it cannot tell a segment that stopped being
 * derived from one that never was — both read as health. Pinning the exact
 * counts makes either direction a red with a diff that says which number moved.
 *
 * The pin MOVES whenever a P1-31 route page or an owned segment is added or
 * removed. Update both numbers from the gate's own report line — run
 * `node scripts/ci/check-p1-31-access.mjs` and read
 * `N route page(s) examined across M owned segment(s)` — in the same change
 * that adds or removes the page or the segment.
 *
 * It moved from 13 to 15 with the FE-011 … FE-014 report screens: the catalogue
 * page and the per-report page. BOTH numbers are read off the gate’s report line
 * on the merged head rather than carried forward — the report-screens branch was
 * written when the line read 9, and `develop` moved it twice before that merge —
 * so 13 is what `develop` reported and 15 is what that branch reported. The
 * SEGMENT count did not move with that slice: `reports` was already a named
 * dashboard area, and the resource root the three reporting operations derive is
 * also `reports`, so the derived half and the named half agree on it.
 *
 * It moved from 15 to 16 with the FE-010 operational overview at
 * `(dashboard)/reports/overview`, again read off the gate’s report line. The
 * segment count did not move again and no operation was added to the allow-list:
 * the overview consumes the same three reporting operations, four runs of
 * `rpt.report-run` instead of one, so what grew is the number of pages the gate
 * judges and nothing about what it owns.
 *
 * The FE-002 handover form moved the SEGMENT count and not the page count, which
 * is the opposite of both slices before it and is worth stating rather than
 * rounding. It names the employee register read P-17 published and the branch
 * directory read the branch picker consumes, whose shared resource root is `org`
 * — a root no other claimed operation derives and no dashboard area is named for
 * — so the derivation gains one segment, while the form itself lives on the
 * work-order detail page the gate already examined. Withdrawing the unconsumed
 * single-employee read and claiming the branch directory moved NEITHER number,
 * because both share that same root. Both numbers below are read off the gate's
 * own report line on THIS merged head, which carries the overview page and this
 * form together.
 *
 * The DO-001 completeness pass moved the SEGMENT count from 9 to 10 and left the
 * page count at 16. It added the eight operations P1-31 screens consume that this
 * list had never named: the five delivery writes and the company directory, all of
 * which share a resource root the list already derived, and the two
 * checklist-template reads, whose root `delivery-checklist-templates` nothing else
 * derives. So one new segment and no new page — and, as with `warranty` and
 * `reports` before it, a configuration page landing under that segment tomorrow
 * meets this rule already written. Both numbers are read off the gate's own report
 * line on this head.
 *
 * The same pass then moved BOTH numbers, 10 to 12 and 16 to 17, when the audit
 * screen was measured against the rule the list follows: every operation a P1-31
 * screen consumes is named, whether or not P1-31 published it. That screen is one
 * this phase modified and it carries its own committed browser specification, so
 * its two operations are claimed — a new derived root, `audit-events` — and the
 * `audit-log` area is named beside them, because the page lives under
 * `(dashboard)/administration/audit-log` and no derived root matches it. Two new
 * segments, one new page. Both numbers are read off the gate's own report line.
 *
 * Review then found what those numbers were hiding: SEVEN of the seventeen judged
 * pages were `(dashboard)/work-orders/**`, admitted by the resource root of
 * `sal.work-order-delivery-read` — a SUB-resource at `/work-orders/{id}/delivery`
 * — and six of them consume no P1-31 operation at all. They are now DEFERRED to
 * the P1-29 gate, which owns that area and judges them with `judgePage`, the same
 * function this gate imports. So the judged count is 10 and the deferred count 7;
 * the SEGMENT count does not move, because owning the operation root is a separate
 * claim from judging the pages under it.
 */
const PINNED_PAGES = 10;
const PINNED_OWNED_SEGMENTS = 12;
const PINNED_DEFERRED_PAGES = 7;

describe('the derivation is P1-31’s own and is not empty', () => {
  it('derives the delivery and warranty resource roots from the register', () => {
    const segments = ownedSegments();
    // Non-vacuity first: an empty derivation would make every case below
    // meaningless, and the gate itself refuses it.
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.length, segments.join(', ')).toBe(PINNED_OWNED_SEGMENTS);
    for (const expected of [
      'deliveries',
      'warranties',
      'work-orders',
      'org',
      // Derived only by the two checklist-template reads DO-001 added, and by
      // nothing else — which is why the segment count moved with them.
      ['delivery', 'checklist', 'templates'].join('-'),
      // Derived only by the two audit-event reads the same pass added.
      ['audit', 'events'].join('-'),
    ]) {
      expect(segments, `${expected} is a P1-31 resource root`).toContain(expected);
    }
  });

  it('owns the SINGULAR dashboard segment, which is the reason this gate exists', () => {
    // Every delivery operation is addressed under the plural `deliveries`, so a
    // purely derived rule would not match `(dashboard)/delivery/**` — the href
    // already committed in navigation. That gap is what the P1-30 gate has.
    const segments = ownedSegments();
    for (const area of P1_31_AREAS) {
      expect(segments, `${area} is a named P1-31 dashboard segment`).toContain(area);
    }
    expect(segments).toContain('delivery');
  });

  it('names every operation id it claims, and each one exists in the register', () => {
    // The ids are ASSEMBLED rather than written as literals. The P1-24 operation
    // register credits any test file whose raw text contains an operation id as
    // a test OF that operation - comments included - so a literal id here would
    // make this file appear as evidence for an operation it never exercises.
    const id = (domain: string, tail: string) => [domain, tail].join('.');
    expect(P1_31_OPERATION_IDS.length).toBeGreaterThan(5);
    expect(P1_31_OPERATION_IDS).toContain(id('sal', 'delivery-read'));
    expect(P1_31_OPERATION_IDS).toContain(id('wty', 'warranty-list'));
    // FE-008 added the warranty record screen and the issue surface on the handover.
    // Neither widens the segment set — the detail shares the list's resource root and
    // the generation is addressed under the delivery's — so naming them here is the
    // only thing that makes them owned. An allow-list that omits an operation its own
    // phase's screens call is an allow-list that has quietly stopped owning them.
    expect(P1_31_OPERATION_IDS).toContain(id('wty', 'warranty-detail'));
    expect(P1_31_OPERATION_IDS).toContain(id('wty', 'warranty-generate'));
    // The plan administration screens call five WRITES, and every one of them is
    // addressed under a resource root the two policy reads already contributed. So
    // none of them widens the derived segment set, and being named here is the only
    // thing that makes the gate own them. That is exactly the case an allow-list
    // exists to cover and a namespace rule would miss.
    for (const tail of [
      'warranty-policy-create',
      'warranty-policy-rename',
      'warranty-policy-status-set',
      'warranty-coverage-create',
      'warranty-coverage-status-set',
    ]) {
      expect(P1_31_OPERATION_IDS, `${tail} is owned`).toContain(id('wty', tail));
    }
    // The three reporting operations the FE-011 … FE-014 screens consume. Named
    // here in the change that first consumes them, which is what this gate's
    // docblock requires of every operation it claims.
    expect(P1_31_OPERATION_IDS).toContain(id('rpt', 'report-catalogue'));
    expect(P1_31_OPERATION_IDS).toContain(id('rpt', 'report-read'));
    expect(P1_31_OPERATION_IDS).toContain(id('rpt', 'report-run'));
    // The two organisation reads the FE-002 handover form consumes, named in the
    // change that first consumes them: the employee register and the branch
    // directory the form picks a branch from.
    expect(P1_31_OPERATION_IDS).toContain(id('org', 'employee-list'));
    expect(P1_31_OPERATION_IDS).toContain(id('org', 'branch-list'));
    // The company directory the readiness queue and the report scope selector
    // consume. Same root as the two above, so it widens nothing about the segments
    // and everything about the claim.
    expect(P1_31_OPERATION_IDS).toContain(id('org', 'company-list'));
    // The five delivery WRITES the handover screens send. Every one shares the
    // `deliveries` root the reads already contribute, so no segment moved when they
    // landed and nothing said they were unowned — which is the failure mode an
    // allow-list has and a namespace does not.
    for (const tail of [
      'delivery-create',
      'delivery-receiver-verify',
      'delivery-checklist-record',
      'delivery-signature-attach',
      'delivery-complete',
    ]) {
      expect(P1_31_OPERATION_IDS, `${tail} is owned`).toContain(id('sal', tail));
    }
    // The two checklist-template reads the handover assembles its checklist from.
    // Their root is derived by nothing else this list names, so these two are what
    // moved the segment count.
    expect(P1_31_OPERATION_IDS).toContain(id('sal', 'delivery-checklist-template-list'));
    expect(P1_31_OPERATION_IDS).toContain(id('sal', 'delivery-checklist-template-read'));
    // The two audit-event reads the audit screen consumes. P1-31 did not publish
    // them and that is not the test: the rule this list follows is EVERY operation
    // a P1-31 screen consumes, which is why the branch and company directories are
    // here too. The area that makes their page judged is named beside them.
    expect(P1_31_OPERATION_IDS).toContain(id('iam', 'audit-event-list'));
    expect(P1_31_OPERATION_IDS).toContain(id('iam', 'audit-event-detail'));
    expect(P1_31_AREAS).toContain(['audit', 'log'].join('-'));
    // …and the PARENT is deliberately not an area: naming it would pull every
    // administration screen in the product into this gate's subject.
    expect(P1_31_AREAS).not.toContain('administration');
    // Three operations on the same two subjects are deliberately NOT claimed. The
    // two administration commands: no screen of this phase administers a roster.
    // The single-employee read: it was claimed while an adapter with no consumer
    // existed, and both were withdrawn together — an allow-list naming an
    // operation nothing reaches is owning a surface it does not have.
    for (const tail of ['employee-create', 'employee-status-set', 'employee-detail']) {
      expect(P1_31_OPERATION_IDS, `${tail} is not this phase's`).not.toContain(id('org', tail));
    }
    // A stale entry is a VIOLATION rather than a silent shrink, so an honest
    // derivation over the real register reports no problems at all.
    expect(deriveSegments().problems).toEqual([]);
  });

  it('owns the plan resource root the administration screens live under', () => {
    // The five writes are owned WITHOUT widening the segment set, which is the
    // claim above. Asserted from the other side: the root is derived, and it is
    // derived from the reads as well, so removing a write leaves it in place while
    // removing the reads would not.
    expect(ownedSegments()).toContain(['warranty', 'policies'].join('-'));
  });

  it('reports a stale allow-list entry rather than skipping it', () => {
    // The failure mode an allow-list has and a namespace does not: an id that
    // stops existing would quietly shrink this gate's reach with no diff saying
    // so. Proved against a register that carries none of the named ids.
    const registerPath = join(scratch, 'empty-register.json');
    writeFileSync(registerPath, JSON.stringify({ operations: [] }), 'utf8');
    const { problems, segments } = deriveSegments(registerPath);
    expect(problems.length).toBe(P1_31_OPERATION_IDS.length);
    // The named areas survive, so the gate still judges pages while saying the
    // derivation is broken — it refuses, it does not go blind.
    expect(segments).toEqual([...P1_31_AREAS].sort());
  });
});

describe('the rule has teeth', () => {
  it('a page that reads BEFORE it denies is refused', () => {
    const app = plant(
      'reads-first',
      'delivery',
      `
      export default async function Page({ params }) {
        const session = await requireSession(await params);
        const record = await readDelivery(deliveryId);
        if (!holds(session.permissions, DELIVERY_PERMISSIONS.view)) {
          return <PermissionDeniedState />;
        }
        return <Screen record={record} />;
      }
      `
    );
    const { code, out } = runOn(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/reads before it denies on a permission/);
  });

  it('a page that consults no permission at all is refused', () => {
    const app = plant(
      'no-permission',
      'warranty',
      `export default async function Page() {
        const warranties = await listWarranties();
        return <Screen warranties={warranties} />;
      }`
    );
    const { code, out } = runOn(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults no permission at all/);
  });

  it('a page whose only `holds` computes a CONTROL capability is refused', () => {
    const app = plant(
      'capability-only',
      'delivery',
      `export default async function Page({ params }) {
        const session = await requireSession(await params);
        const record = await readDelivery(deliveryId);
        const canComplete = holds(session.permissions, DELIVERY_PERMISSIONS.complete);
        return <Screen record={record} canComplete={canComplete} />;
      }`
    );
    const { code, out } = runOn(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults a permission but never denies and RETURNS on one/);
  });

  it('a negated check that FALLS THROUGH instead of returning is refused', () => {
    const app = plant(
      'falls-through',
      'reports',
      `export default async function Page({ params }) {
        const session = await requireSession(await params);
        let canRead = true;
        if (!holds(session.permissions, REPORT_PERMISSIONS.read)) {
          canRead = false;
        }
        const reports = await listReports();
        return <Screen reports={reports} canRead={canRead} />;
      }`
    );
    const { code, out } = runOn(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/never denies and RETURNS on one/);
  });

  it('a docblock QUOTING the rule does not satisfy it', () => {
    const app = plant(
      'comment-only',
      'delivery',
      `/**
        * The shape this page must have is:
        *   if (!holds(session.permissions, X)) return <PermissionDeniedState />;
        */
      export default async function Page() {
        const record = await readDelivery(deliveryId);
        return <Screen record={record} />;
      }`
    );
    const { code, out } = runOn(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults no permission at all/);
  });

  it('a correctly gated page passes, and the run says it examined one', () => {
    const { code, out } = runOn(plant('gated', 'delivery', GATED));
    expect(out).toMatch(/1 route page\(s\) examined/);
    expect(code).toBe(0);
  });

  it('a page outside every P1-31 segment is not this gate’s business', () => {
    const app = plant(
      'foreign',
      'technicians',
      'export default async function Page() { await x(); }'
    );
    const { code, out } = runOn(app);
    expect(code).toBe(0);
    expect(out).toMatch(/0 route page\(s\) examined/);
  });
});

describe('the repository’s own run is not vacuous', () => {
  it('examines at least one real page and passes', () => {
    // This gate ships BESIDE a screen rather than ahead of one, so a run over
    // the application root that examines nothing means the derivation stopped
    // matching. Both halves are asserted: it passes, and it judged something.
    const { code, out } = run([]);
    expect(code, out).toBe(0);
    const examined = /(\d+) route page\(s\) examined/.exec(out)?.[1] ?? '0';
    expect(Number(examined)).toBeGreaterThan(0);
    // And exactly how many, read from the gate's own report line rather than
    // recounted here, so the assertion cannot drift from what the gate judged.
    // See PINNED_PAGES / PINNED_OWNED_SEGMENTS above: both move whenever a
    // P1-31 page or owned segment is added or removed.
    const owned = /across (\d+) owned segment\(s\)/.exec(out)?.[1] ?? '0';
    const handedOver = /(\d+) deferred to the P1-29 gate/.exec(out)?.[1] ?? '0';
    expect(Number(examined), out).toBe(PINNED_PAGES);
    expect(Number(owned), out).toBe(PINNED_OWNED_SEGMENTS);
    expect(Number(handedOver), out).toBe(PINNED_DEFERRED_PAGES);
  });

  it('defers only pages the P1-29 gate really judges, and says how many', () => {
    /*
     * The deferral is the one thing here that could silently remove coverage, so
     * it is proved from both ends rather than asserted. Every page this gate
     * hands over is in the sibling's own page set — computed by the sibling, not
     * restated — and the gate itself carries the same check and reports a page
     * handed over and not taken as a violation.
     */
    const appRoot = join(ROOT, 'apps', 'web', 'src', 'app');
    const judged = p1_31PagesUnder(appRoot) as string[] & { deferred?: string[] };
    const handedOver = judged.deferred ?? [];
    expect(handedOver.length).toBe(PINNED_DEFERRED_PAGES);
    const sibling = new Set(
      (p1_29PagesUnder(appRoot) as string[]).map((p) => p.replace(/\\/g, '/'))
    );
    for (const page of handedOver) {
      expect(sibling, `${page} is judged by the P1-29 gate`).toContain(page.replace(/\\/g, '/'));
    }
    // …and the deferral is DERIVED from that gate, so it cannot outlive it. Only
    // the work-orders area is in the intersection today, and the P1-30 gate is
    // deliberately not deferred to — doing so would recreate the singular-area
    // hole this file exists to close.
    expect(deferredSegments().has('work-orders')).toBe(true);
    expect(deferredSegments().has('delivery')).toBe(false);
    expect(deferredSegments().has(['warranty', 'policies'].join('-'))).toBe(false);
  });

  it('refuses an application root under the floor, instead of reporting health', () => {
    // The same directory-shaped input its siblings PASS on and announce. They
    // ship ahead of their screens; this one does not, so an examination under
    // the floor is a red. The floor is passed explicitly because that is the
    // only way to prove it rather than assert it: the default over a scratch
    // root is zero, which is what makes the judgement cases above meaningful.
    const appRoot = join(scratch, 'empty-app');
    mkdirSync(appRoot, { recursive: true });
    const { code, out } = run(['--app-root', appRoot, '--min-pages', '1']);
    expect(code).not.toBe(0);
    expect(out).toMatch(/FEWER than 1 P1-31 route page/);
  });
});
