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
  deriveSegments,
  ownedSegments,
} from '../../scripts/ci/check-p1-31-access.mjs';

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

describe('the derivation is P1-31’s own and is not empty', () => {
  it('derives the delivery and warranty resource roots from the register', () => {
    const segments = ownedSegments();
    // Non-vacuity first: an empty derivation would make every case below
    // meaningless, and the gate itself refuses it.
    expect(segments.length).toBeGreaterThan(0);
    for (const expected of ['deliveries', 'warranties', 'work-orders']) {
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
    // A stale entry is a VIOLATION rather than a silent shrink, so an honest
    // derivation over the real register reports no problems at all.
    expect(deriveSegments().problems).toEqual([]);
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
