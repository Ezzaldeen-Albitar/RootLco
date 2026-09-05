/**
 * The red-proof for `check-p1-30-payload-parity.mjs` (P1-30, W1).
 *
 * The comparison is the P1-29 gate's and is pinned there (C1–C11). What this
 * file proves is that THIS gate wires it to P1-30's own scope: it reads P1-30's
 * mirror, not P1-29's; it dies when that mirror is empty; and the drift classes
 * that matter most — a field dropped, a field renamed, a required field made
 * optional — turn it red through this gate's own entry point. It also pins the
 * scope list by name, so the wave that widens `P1_30_DOMAINS` has to say so
 * here rather than have a mirror obligation appear silently.
 *
 * The schemas are extracted ONCE in `beforeAll` and handed to every case with
 * `--schemas`, so a mutation of the mirror is the only variable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { MIRROR_FILES, P1_30_DOMAINS } from '../../scripts/ci/check-p1-30-payload-parity.mjs';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts', 'ci', 'check-p1-30-payload-parity.mjs');
const MIRROR_SRC = join(ROOT, 'apps', 'web', 'src', 'lib', 'contracts');
const MIRROR = 'services-contract.ts';

const modules = import.meta.glob('/apps/api/src/app/api/v1/**/route.ts', { eager: true });

let scratch = '';
let schemasPath = '';

function runGate(mirrorRoot: string): { code: number; out: string } {
  try {
    const out = execFileSync(
      process.execPath,
      [GATE, '--schemas', schemasPath, '--mirror-root', mirrorRoot],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** A fresh copy of the real mirror directory, ready to mutate. */
function mirrorCopy(name: string): string {
  const root = join(scratch, name);
  const dest = join(root, 'lib', 'contracts');
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(MIRROR_SRC, dest, { recursive: true });
  return root;
}

function edit(root: string, from: string, to: string): void {
  const path = join(root, 'lib', 'contracts', MIRROR);
  const src = readFileSync(path, 'utf8');
  if (!src.includes(from)) throw new Error(`mutation anchor absent in ${MIRROR}: ${from}`);
  writeFileSync(path, src.replace(from, to));
}

const CENSUS = `
import('./scripts/ci/check-p1-30-payload-parity.mjs').then(async (m) => {
  const { bodies } = m.inScopeBodies();
  process.stdout.write(JSON.stringify(bodies));
});
`;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'p130-parity-proof-'));
  const census = execFileSync(process.execPath, ['-e', CENSUS], { cwd: ROOT, encoding: 'utf8' });
  const rows = JSON.parse(census) as { id: string; schema: string; file: string }[];
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const mod = modules[`/${row.file}`] as Record<string, unknown> | undefined;
    if (!mod) throw new Error(`route module not globbed: ${row.file}`);
    out[row.id] = z.toJSONSchema(mod[row.schema] as never);
  }
  schemasPath = join(scratch, 'schemas.json');
  writeFileSync(schemasPath, JSON.stringify(out, null, 2));
}, 120_000);

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('the scope is P1-30’s own, and it is pinned by name', () => {
  it('holds exactly the domains W1 built screens for', () => {
    // The wave that adds `quo`, `inv`, `sal` or `wty` must change this line
    // too — a mirror obligation must never appear silently.
    expect([...P1_30_DOMAINS]).toEqual(['svc']);
  });

  it('reads the services mirror and nothing of P1-29’s', () => {
    expect([...MIRROR_FILES].map((f) => f.replace(/\\/g, '/'))).toEqual([
      'lib/contracts/services-contract.ts',
    ]);
  });
});

describe('anti-vacuity', () => {
  it('FAILS when pointed at a mirror root holding only the generated manifest', () => {
    const root = join(scratch, 'manifest-only');
    mkdirSync(join(root, 'lib', 'api'), { recursive: true });
    writeFileSync(
      join(root, 'lib', 'api', 'idempotent-operations.ts'),
      'export const PUBLISHED_OPERATIONS = [];\n'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/mirror file absent/);
    expect(out).toMatch(/ZERO interfaces/);
  });

  it('passes on the tree as it stands and names what it examined', () => {
    const { code, out } = runGate(join(ROOT, 'apps', 'web', 'src'));
    expect(out).toMatch(
      /P1-30 payload parity \[svc\]: \d+ operation\(s\) in scope, \d+ write\(s\)/
    );
    // Non-vacuity: the svc scope holds writes with bodies, and they were counted.
    const bodies = Number(/(\d+) with a body/.exec(out)?.[1] ?? '0');
    expect(bodies).toBeGreaterThan(0);
    expect(code).toBe(0);
  });
});

describe('the drift classes turn this gate red through its own entry point', () => {
  it('a field removed from a mirror DTO', () => {
    const root = mirrorCopy('field-removed');
    edit(
      root,
      'readonly serviceCategoryId: string;\n  readonly serviceCode: string;',
      'readonly serviceCode: string;'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/svc\.service-create/);
    expect(out).toMatch(/serviceCategoryId/);
  });

  it('a field renamed: reported as one missing AND one unexpected', () => {
    const root = mirrorCopy('field-renamed');
    edit(root, 'readonly isAvailable: boolean;', 'readonly available: boolean;');
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/isAvailable/);
    expect(out).toMatch(/available/);
  });

  it('a required field marked optional', () => {
    const root = mirrorCopy('required-made-optional');
    edit(root, 'readonly effectiveFrom: string;\n}', 'readonly effectiveFrom?: string;\n}');
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/effectiveFrom/);
  });

  it('a whole mirror interface missing is a missing mirror, not a pass', () => {
    const root = mirrorCopy('interface-missing');
    edit(root, 'export interface ServiceVersionPublishBody {', 'export interface RenamedAway {');
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/svc\.service-version-publish/);
  });
});
