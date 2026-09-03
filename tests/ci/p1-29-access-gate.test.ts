/**
 * The red-proof for `check-p1-29-access.mjs` (`PRE-P1-29-BR-08c`).
 *
 * The gate examines ZERO route pages, because P1-29 has no screens yet. A pass
 * over an empty set is worth nothing, so its teeth are proved here instead: pages
 * are PLANTED under a scratch app root in each shape the rule must refuse, and the
 * gate is required to go red on every one.
 *
 * ## Four of these cases exist because the first version failed them
 *
 * An adversarial review took the original gate apart, and every hole was a FALSE
 * NEGATIVE — a page that should have been refused and was not: a negated check
 * that fell through instead of returning; a docblock quoting the rule, which armed
 * the gate for a page that had none; `await Promise.all([...])` and
 * `await api.listX()` reads, invisible to a bare-identifier regex; and seven P1-29
 * resource segments missing from a hand-written list, so ungated pages under them
 * were not violations — they were not even pages.
 *
 * The gate now imports `denyAndReturnGate` and `stripComments` from the P1-28
 * gates, which already knew every one of those shapes. These cases exist so that
 * reuse cannot silently regress.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts', 'ci', 'check-p1-29-access.mjs');

let scratch = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'p129-access-'));
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

/** Plant one page.tsx under a P1-29-owned segment. */
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
  if (!holds(session.permissions, WORK_ORDER_PERMISSIONS.read)) {
    return <PermissionDeniedState />;
  }
  const orders = await listWorkOrders();
  return <Screen orders={orders} />;
}
`;

describe('the armed rule has teeth before any screen exists', () => {
  it('a page that reads BEFORE it denies is refused', () => {
    const app = plant(
      'reads-first',
      'work-orders',
      `
      export default async function Page({ params }) {
        const session = await requireSession(await params);
        const orders = await listWorkOrders();
        if (!holds(session.permissions, WORK_ORDER_PERMISSIONS.read)) {
          return <PermissionDeniedState />;
        }
        return <Screen orders={orders} />;
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
      'technicians',
      `export default async function Page() {
        const queue = await listTechnicianQueue();
        return <Screen queue={queue} />;
      }`
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults no permission at all/);
  });

  it('a page whose only `holds` computes a CONTROL capability is refused', () => {
    const app = plant(
      'capability-only',
      'inspections',
      `export default async function Page({ params }) {
        const session = await requireSession(await params);
        const findings = await listFindings();
        const canEdit = holds(session.permissions, DIA_PERMISSIONS.manage);
        return <Screen findings={findings} canEdit={canEdit} />;
      }`
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults a permission but never denies and RETURNS on one/);
  });

  it('a correctly gated page passes', () => {
    const { code, out } = run(plant('gated', 'work-orders', GATED));
    expect(out).toMatch(/1 route page\(s\) examined/);
    expect(code).toBe(0);
  });

  it('a page outside every P1-29 root is not this gate’s business', () => {
    const app = plant(
      'foreign',
      'receptions',
      'export default async function Page() { await x(); }'
    );
    const { code, out } = run(app);
    expect(code).toBe(0);
    expect(out).toMatch(/0 route page\(s\) examined/);
  });
});

describe('the four holes an adversarial review found in the first version', () => {
  it('a negated check that FALLS THROUGH instead of returning is refused', () => {
    // The original regex matched the condition and never looked at the
    // consequent, so this page passed. `denyAndReturnGate` requires the return.
    const app = plant(
      'falls-through',
      'work-orders',
      `export default async function Page({ params }) {
        const session = await requireSession(await params);
        let canEdit = true;
        if (!holds(session.permissions, WO.manage)) {
          canEdit = false;
        }
        const orders = await listWorkOrders();
        return <Screen orders={orders} canEdit={canEdit} />;
      }`
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/never denies and RETURNS on one/);
  });

  it('a docblock QUOTING the rule does not satisfy it', () => {
    // Prose describing a rule naturally contains the rule. The original searched
    // the raw source, so this page — which has no gate at all — passed.
    const app = plant(
      'comment-only',
      'jobs',
      `/**
        * The shape this page must have is:
        *   if (!holds(session.permissions, X)) return <PermissionDeniedState />;
        */
      export default async function Page() {
        const jobs = await listJobs();
        return <Screen jobs={jobs} />;
      }`
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults no permission at all/);
  });

  it('a read via `await Promise.all([...])` before the gate is seen', () => {
    // Promise.all is the shipped read shape in this repository, and the original
    // read detector required `await` followed by a bare identifier and `(`.
    const app = plant(
      'promise-all',
      'jobs',
      `export default async function Page({ params }) {
        const session = await requireSession(await params);
        const [jobs, techs] = await Promise.all([listJobs(), listTechnicians()]);
        if (!holds(session.permissions, WO.read)) {
          return <PermissionDeniedState />;
        }
        return <Screen jobs={jobs} techs={techs} />;
      }`
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/reads before it denies on a permission/);
  });

  it('a namespaced read `await api.listX()` before the gate is seen', () => {
    const app = plant(
      'namespaced-read',
      'technicians',
      `export default async function Page({ params }) {
        const session = await requireSession(await params);
        const techs = await api.listTechnicians();
        if (!holds(session.permissions, TECH.read)) {
          return <PermissionDeniedState />;
        }
        return <Screen techs={techs} />;
      }`
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/reads before it denies on a permission/);
  });

  it('every P1-29 resource root is derived, including the seven a hand-written list missed', async () => {
    const mod = await import('../../scripts/ci/check-p1-29-access.mjs');
    const roots: string[] = mod.ownedSegments();
    // The five the original list omitted outright and that are resource ROOTS.
    for (const missed of [
      'additional-work',
      'inspection-templates',
      'rework-links',
      'labor-sessions',
      'assignments',
      'template-versions',
    ]) {
      expect(roots, `${missed} must be an owned root`).toContain(missed);
    }
    // `reopen-attempts` and `rework` are NESTED under work-orders, so a page for
    // either matches the `work-orders` root rather than needing its own.
    expect(roots).toContain('work-orders');
    // And the derivation must not reach outside its lane: sub-resource names
    // like `status` would judge other phases' screens.
    for (const notARoot of ['status', 'detail', 'me', 'end', 'items', 'versions']) {
      expect(roots, `${notARoot} must NOT be an owned root`).not.toContain(notARoot);
    }
  });

  it('an ungated page under each newly-covered root is refused', () => {
    for (const segment of [
      'additional-work',
      'inspection-templates',
      'rework-links',
      'labor-sessions',
    ]) {
      const app = plant(
        `ungated-${segment}`,
        segment,
        'export default async function Page() { const x = await listThings(); return <S x={x} />; }'
      );
      const { code, out } = run(app);
      expect(code, `${segment} must be examined`).not.toBe(0);
      expect(out).toMatch(/consults no permission at all/);
    }
  });
});

describe('the empty set is reported, never passed off as proof', () => {
  it('says out loud that a zero-page run proves nothing', () => {
    // An app tree with no P1-29 page in it. This USED to point at the real
    // `apps/web/src/app`, which held none — until W1 landed the work-order
    // board. Repointing it at an empty tree keeps the behaviour it exists to
    // pin (a run that examined nothing must announce its own vacuity) instead
    // of deleting the case because the repository moved past its fixture.
    const empty = join(scratch, 'no-p1-29-pages', '[locale]', '(dashboard)', 'receptions');
    mkdirSync(empty, { recursive: true });
    writeFileSync(join(empty, 'page.tsx'), 'export default async function Page() {}');

    const { code, out } = run(join(scratch, 'no-p1-29-pages'));
    expect(code).toBe(0);
    expect(out).toMatch(/0 route page\(s\) examined/);
    expect(out).toMatch(/ZERO pages exist yet — this run proves nothing about any screen/);
    expect(out).toMatch(/ARMED/);
  });

  it('the REAL tree is no longer one of those runs', () => {
    // The other half, and the stronger statement: this gate now has something
    // to judge. If a future change removed every P1-29 page, the case above
    // would still pass on its fixture while the repository quietly lost its
    // only screen — so the live tree is asserted non-vacuous here, by name.
    const { code, out } = run(join(ROOT, 'apps', 'web', 'src', 'app'));
    expect(code).toBe(0);
    expect(out).not.toMatch(/0 route page\(s\) examined/);
    expect(out).toMatch(/[1-9]\d* route page\(s\) examined/);
    expect(out).not.toMatch(/ZERO pages exist yet/);
  });

  it('an empty segment derivation is itself a violation', async () => {
    const mod = await import('../../scripts/ci/check-p1-29-access.mjs');
    // A gate that owns no segments examines no pages and passes everything.
    expect(mod.ownedSegments(join(scratch, 'no-such-register.json'))).toEqual([]);
  });
});

describe('the P1-28 gates are untouched', () => {
  it('are byte-unchanged against develop, even though this gate imports them', () => {
    const diff = execFileSync(
      'git',
      [
        'diff',
        '--name-only',
        'origin/develop',
        '--',
        'scripts/ci/check-p1-28-access.mjs',
        'scripts/ci/check-p1-28-write-reachability.mjs',
        'scripts/ci/check-p1-28-adapter-reachability.mjs',
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(diff.trim()).toBe('');
  });
});
