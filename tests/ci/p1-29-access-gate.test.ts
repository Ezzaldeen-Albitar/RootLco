/**
 * The red-proof for `check-p1-29-access.mjs` (`PRE-P1-29-BR-08c`).
 *
 * The gate currently examines ZERO route pages, because P1-29 has no screens yet.
 * A pass over an empty set is worth nothing, so its teeth are proved here instead:
 * pages are PLANTED under a scratch app root in each shape the rule is meant to
 * refuse, and the gate is required to go red on every one of them.
 *
 * This is the whole reason the rule is armed before the screens exist. A gate
 * written afterwards is tuned to whatever was already built; this one has to be
 * satisfied by code that does not exist yet.
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
import { holds } from '@/lib/auth';
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
        const { locale } = await params;
        const session = await requireSession(locale);
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
      `
      export default async function Page() {
        const queue = await listTechnicianQueue();
        return <Screen queue={queue} />;
      }
      `
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults no permission at all/);
  });

  it('a page whose only `holds` computes a CONTROL capability is refused', () => {
    // The defect the P1-28 gate records: a route page is full of `holds` calls
    // that enable a button and deny nothing. Keying on the first `holds` of any
    // kind would read this page as gated.
    const app = plant(
      'capability-only',
      'inspections',
      `
      export default async function Page({ params }) {
        const session = await requireSession(await params);
        const findings = await listFindings();
        const canEdit = holds(session.permissions, DIA_PERMISSIONS.manage);
        return <Screen findings={findings} canEdit={canEdit} />;
      }
      `
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/consults a permission but never denies and returns on one/);
  });

  it('a correctly gated page passes', () => {
    const { code, out } = run(plant('gated', 'work-orders', GATED));
    expect(out).toMatch(/1 route page\(s\) examined/);
    expect(code).toBe(0);
  });

  it('a page outside P1-29 segments is not this gate’s business', () => {
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

describe('the empty set is reported, never passed off as proof', () => {
  it('says out loud that a zero-page run proves nothing', () => {
    const { code, out } = run(join(ROOT, 'apps', 'web', 'src', 'app'));
    expect(code).toBe(0);
    expect(out).toMatch(/0 route page\(s\) examined/);
    expect(out).toMatch(/ZERO pages exist yet — this run proves nothing about any screen/);
    expect(out).toMatch(/ARMED/);
  });
});

describe('the P1-28 access gate is untouched', () => {
  it('check-p1-28-access.mjs is byte-unchanged against develop', () => {
    const diff = execFileSync(
      'git',
      ['diff', '--name-only', 'origin/develop', '--', 'scripts/ci/check-p1-28-access.mjs'],
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(diff.trim()).toBe('');
  });
});
