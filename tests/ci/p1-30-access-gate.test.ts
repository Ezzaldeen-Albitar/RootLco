/**
 * The red-proof for `check-p1-30-access.mjs` (P1-30, W1).
 *
 * The gate ships beside the FIRST P1-30 screen, and a pass over the pages that
 * exist is not the same as proof that it refuses the pages it must. So its
 * teeth are proved here: pages are PLANTED under a scratch app root in each
 * shape the rule must refuse, and the gate is required to go red on every one.
 *
 * The shapes are the ones an adversarial review took the first P1-29 gate apart
 * with — every hole was a FALSE NEGATIVE — and this gate reuses that gate's
 * judgement (`judgePage`) precisely so those shapes cannot regress here without
 * regressing there. These cases exist so that the reuse is checked, not trusted.
 *
 * The segments are P1-30's own, derived from the register: `services`,
 * `price-lists`, `quotations`, `stock-locations`, `payments` and the rest. A
 * page under a segment P1-30 does not own is not this gate's business, and one
 * case pins that too — a gate that judged other phases' pages would produce
 * violations nobody on this lane can act on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownedSegments, P1_30_ID } from '../../scripts/ci/check-p1-30-access.mjs';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts', 'ci', 'check-p1-30-access.mjs');

let scratch = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'p130-access-'));
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

function run(appRoot: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [GATE, '--app-root', appRoot], {
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
  if (!holds(session.permissions, SERVICE_PERMISSIONS.read)) {
    return <PermissionDeniedState />;
  }
  const services = await listServices();
  return <Screen services={services} />;
}
`;

describe('the derivation is P1-30’s own and is not empty', () => {
  it('derives the service-catalogue root and the other P1-30 roots from the register', () => {
    const segments = ownedSegments();
    // Non-vacuity first: an empty derivation would make every case below
    // meaningless, and the gate itself refuses it.
    expect(segments.length).toBeGreaterThan(0);
    for (const expected of ['services', 'service-categories', 'price-lists', 'quotations']) {
      expect(segments, `${expected} is a P1-30 resource root`).toContain(expected);
    }
    // A P1-29-only root is NOT derived from P1-30 ids — `technicians` has no
    // svc/quo/inv/sal/wty operation under it.
    expect(segments).not.toContain('technicians');
  });

  it('derives the dashboard segments the arithmetic gate pre-names, so /pricing is examined', () => {
    // `/pricing` renders `price-lists` and `prices`; no operation has `pricing`
    // as its first path part, so without this union the W2 pages would sit
    // outside the gate-before-read check.
    const segments = ownedSegments();
    for (const expected of ['pricing', 'quotations', 'inventory', 'invoices', 'payments']) {
      expect(segments, `${expected} is a pre-named P1-30 dashboard segment`).toContain(expected);
    }
  });

  it('the id namespaces are exactly the five P1-30 domains', () => {
    // The ids are ASSEMBLED rather than written as literals. The P1-24 operation
    // register credits any test file whose raw text contains an operation id as
    // a test OF that operation - comments included - so a literal id from another
    // phase's namespace here would make this file appear as evidence for an
    // operation it never exercises.
    const id = (domain: string, tail: string) => [domain, tail].join('.');
    for (const domain of ['svc', 'quo', 'inv', 'sal', 'wty']) {
      expect(P1_30_ID.test(id(domain, 'anything-list')), domain).toBe(true);
    }
    for (const domain of ['wo', 'apt', 'rec', 'iam', 'crm', 'veh', 'dia', 'qms', 'tech']) {
      expect(P1_30_ID.test(id(domain, 'anything-list')), domain).toBe(false);
    }
  });
});

describe('the armed rule has teeth', () => {
  it('a page that reads BEFORE it denies is refused', () => {
    const app = plant(
      'reads-first',
      'services',
      `
      export default async function Page({ params }) {
        const session = await requireSession(await params);
        const services = await listServices();
        if (!holds(session.permissions, SERVICE_PERMISSIONS.read)) {
          return <PermissionDeniedState />;
        }
        return <Screen services={services} />;
      }
      `
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/reads before it denies on a permission/);
  });

  it('a page that consults no permission at all is refused', () => {
    const app = plant(
      'no-permission',
      'price-lists',
      `export default async function Page() {
        const lists = await listPriceLists();
        return <Screen lists={lists} />;
      }`
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults no permission at all/);
  });

  it('a page whose only `holds` computes a CONTROL capability is refused', () => {
    const app = plant(
      'capability-only',
      'quotations',
      `export default async function Page({ params }) {
        const session = await requireSession(await params);
        const quotation = await readQuotation();
        const canIssue = holds(session.permissions, QUOTATION_PERMISSIONS.manage);
        return <Screen quotation={quotation} canIssue={canIssue} />;
      }`
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults a permission but never denies and RETURNS on one/);
  });

  it('a negated check that FALLS THROUGH instead of returning is refused', () => {
    const app = plant(
      'falls-through',
      'services',
      `export default async function Page({ params }) {
        const session = await requireSession(await params);
        let canManage = true;
        if (!holds(session.permissions, SERVICE_PERMISSIONS.manage)) {
          canManage = false;
        }
        const services = await listServices();
        return <Screen services={services} canManage={canManage} />;
      }`
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/never denies and RETURNS on one/);
  });

  it('a docblock QUOTING the rule does not satisfy it', () => {
    const app = plant(
      'comment-only',
      'stock-locations',
      `/**
        * The shape this page must have is:
        *   if (!holds(session.permissions, X)) return <PermissionDeniedState />;
        */
      export default async function Page() {
        const locations = await listLocations();
        return <Screen locations={locations} />;
      }`
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults no permission at all/);
  });

  it('a correctly gated page passes, and the run says it examined one', () => {
    const { code, out } = run(plant('gated', 'services', GATED));
    expect(out).toMatch(/1 route page\(s\) examined/);
    expect(code).toBe(0);
  });

  it('a page outside every P1-30 root is not this gate’s business', () => {
    const app = plant(
      'foreign',
      'technicians',
      'export default async function Page() { await x(); }'
    );
    const { code, out } = run(app);
    expect(code).toBe(0);
    expect(out).toMatch(/0 route page\(s\) examined/);
  });

  it('an empty app root says out loud that it proved nothing', () => {
    const appRoot = join(scratch, 'empty');
    mkdirSync(appRoot, { recursive: true });
    const { code, out } = run(appRoot);
    expect(code).toBe(0);
    expect(out).toMatch(/ZERO pages exist yet/);
  });
});
