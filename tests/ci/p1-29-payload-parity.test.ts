/**
 * The red-proofs for `check-p1-29-payload-parity.mjs` (`PRE-P1-29-BR-08c`, `C1`–`C11`).
 *
 * A gate whose failure has never been demonstrated is a gate that has never been
 * shown to work, and this repository has shipped a false green more than once. So
 * every drift class the contract enumerates is MUTATED into a copy of the mirror
 * and the gate is required to go red on it — the pass on the real tree proves
 * nothing on its own.
 *
 * ## Why the schemas are extracted here rather than by the gate
 *
 * The gate shells out to `vitest` to read the zod schemas as values. Doing that
 * once per case would mean eleven nested `vitest` runs. This file is already
 * inside `vitest`, so it imports the route modules directly, extracts once in
 * `beforeAll`, and hands every case the same `--schemas` file. The mutation under
 * test is always the MIRROR, never the schema, so one extraction is the honest
 * input for all of them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts', 'ci', 'check-p1-29-payload-parity.mjs');
const MIRROR_SRC = join(ROOT, 'apps', 'web', 'src', 'lib', 'contracts');

// The call site stays written out in full: `import.meta.glob` is a Vite
// COMPILE-TIME transform, not a function value, so assigning it to a variable
// type-checks and then fails at runtime. Its type lives in
// tests/ci/vite-import-meta.d.ts, which records why it has to be ambient.
const modules = import.meta.glob('/apps/api/src/app/api/v1/**/route.ts', { eager: true });

let scratch = '';
let schemasPath = '';

/** Run the gate against a mirror root. Returns {code, out}. */
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

/** A fresh copy of the real mirror, at `<dir>/lib/contracts`, ready to mutate. */
function mirrorCopy(name: string): string {
  const root = join(scratch, name);
  const dest = join(root, 'lib', 'contracts');
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(MIRROR_SRC, dest, { recursive: true });
  return root;
}

function edit(root: string, file: string, from: string, to: string): void {
  const path = join(root, 'lib', 'contracts', file);
  const src = readFileSync(path, 'utf8');
  if (!src.includes(from)) throw new Error(`mutation anchor absent in ${file}: ${from}`);
  writeFileSync(path, src.replace(from, to));
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'p129-parity-proof-'));

  // The gate's own operation census, reused so the extraction matches exactly.
  const census = execFileSync(process.execPath, ['-e', CENSUS], { cwd: ROOT, encoding: 'utf8' });
  const rows = JSON.parse(census) as { id: string; schema: string; file: string }[];

  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const mod = modules[`/${row.file}`];
    if (!mod) throw new Error(`route module not globbed: ${row.file}`);
    out[row.id] = z.toJSONSchema(mod[row.schema] as never);
  }
  schemasPath = join(scratch, 'schemas.json');
  writeFileSync(schemasPath, JSON.stringify(out, null, 2));
}, 120_000);

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const CENSUS = `
import('./scripts/ci/check-p1-29-payload-parity.mjs').then(async (m) => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const reg = JSON.parse(readFileSync(join(m.ROOT, 'docs/phase-1/phase-1-24/evidence/operation-register.json'), 'utf8'));
  const ops = Array.isArray(reg) ? reg : reg.operations;
  const rows = [];
  for (const op of ops) {
    if (!/^(wo|dia|qms|tech)\\./.test(op.id)) continue;
    if (!['POST','PATCH','PUT','DELETE'].includes(op.method)) continue;
    const p = join(m.ROOT, op.file);
    if (!existsSync(p)) continue;
    const s = m.bodySchemaOf(readFileSync(p, 'utf8'), op.method);
    if (s) rows.push({ id: op.id, schema: s, file: op.file });
  }
  process.stdout.write(JSON.stringify(rows));
});
`;

describe('C1 — anti-vacuity', () => {
  it('FAILS when pointed at a directory holding only the generated manifest', () => {
    const root = join(scratch, 'vacuous');
    const dir = join(root, 'lib', 'contracts');
    mkdirSync(dir, { recursive: true });
    // The trap: the real generated file names all 87 operation ids in the exact
    // form a scanner would match, so a directory-scanning gate would pass every
    // one of them with no mirror written.
    //
    // The ids here are DELIBERATELY not real ones. `scripts/p1-24-operation-register.mjs`
    // scans `tests/**` for operation ids and credits the file it finds them in as
    // a test of that operation — so writing `wo.job-create` here made the register
    // list this file as covering an operation it never exercises. An anti-vacuity
    // fixture that manufactures vacuous coverage is a good joke and a bad test.
    // What the case actually needs is the FILENAME and the shape, not real ids.
    writeFileSync(
      join(dir, 'idempotent-operations.ts'),
      `export const IDEMPOTENT = [{ operationId: 'wo.gate-fixture-alpha' }, { operationId: 'wo.gate-fixture-beta' }];\n`
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/mirror file absent|ZERO interfaces/);
  });

  it('never reads the generated manifest as a mirror, even if it is named one', async () => {
    const mod = await import('../../scripts/ci/check-p1-29-payload-parity.mjs');
    expect(mod.NEVER_A_MIRROR).toContain('idempotent-operations.ts');
    expect(mod.MIRROR_FILES.some((f: string) => f.includes('idempotent-operations'))).toBe(false);
  });
});

describe('C2 — the surface is counted, and the counts are computed not pinned', () => {
  it('passes on the tree as it stands and names what it examined', () => {
    const { code, out } = runGate(join(ROOT, 'apps', 'web', 'src'));
    expect(out).toMatch(/operation\(s\) in scope/);
    expect(code).toBe(0);
  });

  it('every P1-29 write either carries a body or is declared bodyless with a reason', async () => {
    const mod = await import('../../scripts/ci/check-p1-29-payload-parity.mjs');
    for (const [id, reason] of Object.entries(mod.BODYLESS as Record<string, string>)) {
      expect(String(reason).trim().length, `${id} has no reason`).toBeGreaterThan(0);
    }
  });
});

describe('C3–C7 — the five drift classes each turn the gate red', () => {
  it('C3 — a field removed from a mirror DTO', () => {
    const root = mirrorCopy('c3');
    edit(root, 'work-order-contract.ts', 'readonly requiresDiagnostic?: boolean;', '');
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/requiresDiagnostic[^]*absent from the mirror/);
  });

  it('C4 — a field renamed: reported as one missing AND one unexpected', () => {
    const root = mirrorCopy('c4');
    edit(
      root,
      'work-order-contract.ts',
      'readonly requiresDiagnostic?: boolean;',
      'readonly needsDiagnostic?: boolean;'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/requiresDiagnostic[^]*absent from the mirror/);
    expect(out).toMatch(/needsDiagnostic[^]*UNKNOWN to the API/);
  });

  it('C5 — a required field marked optional', () => {
    const root = mirrorCopy('c5');
    edit(root, 'work-order-contract.ts', 'readonly title: string;', 'readonly title?: string;');
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/title: API says REQUIRED, mirror says optional/);
  });

  it('C6 — an enum member the backend does not have', () => {
    const root = mirrorCopy('c6');
    edit(
      root,
      'work-order-contract.ts',
      "readonly assignmentRole?: 'primary' | 'assist';",
      "readonly assignmentRole?: 'primary' | 'assist' | 'observer';"
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/enum drift[^]*unexpected observer/);
  });

  it('C7 — a nested array element shape changed', () => {
    const root = mirrorCopy('c7');
    edit(
      root,
      'work-order-contract.ts',
      'readonly evidenceType: string;',
      'readonly evidenceKind: string;'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/evidence\[\]/);
  });
});

describe('C8/C9 — the three-state vocabulary works at FIELD granularity', () => {
  /**
   * These two cases vary the DISPOSITION POLICY, not the tree, so they call the
   * comparison directly instead of spawning the gate.
   *
   * The first version copied the gate to `scripts/ci/zz-c8-gate.mjs` with a
   * different `DISPOSITIONS` literal and deleted it afterwards. That raced
   * `tests/ci/dependency-path-proof.test.ts`, which enumerates
   * `scripts/ci/*.mjs` and reads each one: it listed the copy, read it after the
   * delete, failed to COLLECT, and contributed zero assertions — so vitest
   * reported `numFailedTests: 0` and the run ledger recorded a GREEN tier over a
   * file that never ran. Writing a scratch file into a directory other tests walk
   * is the whole defect, and not writing one is the whole fix.
   */
  const OMITTED = 'wo.job-create.jobType';

  async function compare(dispositions: Record<string, unknown>) {
    const mod = await import('../../scripts/ci/check-p1-29-payload-parity.mjs');
    const root = mirrorCopy(`disp-${Object.keys(dispositions).length}`);
    edit(root, 'work-order-contract.ts', 'readonly jobType?: string;', '');
    const interfaces = mod.readMirror(root);
    const schemas = JSON.parse(readFileSync(schemasPath, 'utf8')) as Record<string, unknown>;
    return mod.compareOperation({
      operationId: 'wo.job-create',
      schema: schemas['wo.job-create'],
      interfaces,
      dispositions,
    }) as string[];
  }

  it('C9 — an undeclared omission fails', async () => {
    const problems = await compare({});
    expect(problems.join(' ')).toMatch(/NOT declared in DISPOSITIONS/);
  });

  it('C8 — the SAME omission passes once it is declared with a reason', async () => {
    const problems = await compare({
      [OMITTED]: { state: 'DELIBERATELY_ABSENT', reason: 'the screen does not offer a job type' },
    });
    expect(problems).toEqual([]);
  });

  it('a declared omission with NO reason is still refused', async () => {
    const problems = await compare({ [OMITTED]: { state: 'DELIBERATELY_ABSENT', reason: '  ' } });
    expect(problems.join(' ')).toMatch(/carries no reason/);
  });

  it('a disposition state outside the vocabulary is refused', async () => {
    const problems = await compare({ [OMITTED]: { state: 'PROBABLY_FINE', reason: 'because' } });
    expect(problems.join(' ')).toMatch(/is not one of PENDING\/DELIBERATELY_ABSENT/);
  });

  it('the vocabulary is exactly the two states the contract names', async () => {
    const mod = await import('../../scripts/ci/check-p1-29-payload-parity.mjs');
    expect(mod.DISPOSITION_STATES).toEqual(['PENDING', 'DELIBERATELY_ABSENT']);
  });
});

describe('two holes an adversarial review found, both of which printed 0 problems', () => {
  /**
   * The pattern branch used to `return` unconditionally after checking only for an
   * enum, which disabled the PRIMITIVE-TYPE comparison for every field carrying a
   * pattern — 50 of the surface's 140 fields, to protect the 4 state vocabularies
   * it was written for. Every one of these mutations passed green.
   */
  it.each([
    ['number', 'readonly toState: number;'],
    ['boolean', 'readonly toState: boolean;'],
    ['an array', 'readonly toState: string[];'],
    ['an undeclared interface', 'readonly toState: NoSuchInterface;'],
  ])('a pattern-constrained string declared as %s is refused', (_label, replacement) => {
    const root = mirrorCopy(`pattern-${replacement.length}`);
    edit(root, 'work-order-contract.ts', 'readonly toState: string;', replacement);
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/API is a pattern-constrained string, mirror declares/);
  });

  it('a uuid field declared as a number is refused', () => {
    // 27 of the 50 exempted fields were uuids. The branch was never about them.
    const root = mirrorCopy('uuid-number');
    edit(
      root,
      'work-order-contract.ts',
      'readonly technicianProfileId: string;',
      'readonly technicianProfileId: number;'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/pattern-constrained string, mirror declares `number`/);
  });

  it('C10 still holds: the enum direction is reported as the vocabulary message', () => {
    const root = mirrorCopy('pattern-enum');
    edit(
      root,
      'work-order-contract.ts',
      'readonly toState: string;',
      "readonly toState: 'a' | 'b';"
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/tenant-extensible, so the mirror must declare `string`, never a union/);
  });

  /**
   * `describeType` computed a `nullable` flag and nothing ever compared it, so a
   * dropped `| null` and an invented one both passed.
   */
  it('dropping `| null` is refused — it makes CLEARING the field unreachable', () => {
    const root = mirrorCopy('null-dropped');
    edit(
      root,
      'work-order-contract.ts',
      'readonly jobType?: string | null;',
      'readonly jobType?: string;'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/API accepts null, mirror does not/);
  });

  it('inventing `| null` the API does not accept is refused', () => {
    const root = mirrorCopy('null-invented');
    edit(
      root,
      'work-order-contract.ts',
      'readonly title: string;',
      'readonly title: string | null;'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/mirror accepts null, API does not/);
  });
});

describe('C10 — a tenant-extensible vocabulary must never be an enum', () => {
  it('fails when the mirror declares a union for a regex-constrained state', () => {
    const root = mirrorCopy('c10');
    edit(
      root,
      'work-order-contract.ts',
      'readonly toState: string;',
      "readonly toState: 'open' | 'closed';"
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/tenant-extensible, so the mirror must declare `string`, never a union/);
  });
});

describe('C11 — the output names what it examined', () => {
  it('reports scope, writes, bodies, mirror size, and its own ceiling', () => {
    const { out } = runGate(join(ROOT, 'apps', 'web', 'src'));
    expect(out).toMatch(/\d+ operation\(s\) in scope/);
    expect(out).toMatch(/\d+ write\(s\)/);
    expect(out).toMatch(/\d+ with a body/);
    expect(out).toMatch(/frozen file\(s\)/);
    expect(out).toMatch(/exported interface\(s\)/);
    // The ceiling, stated rather than implied.
    expect(out).toMatch(/Responses are NOT statically gated/);
    expect(out).toMatch(/facets are NOT compared/i);
  });
});

describe('the P1-28 gate is untouched', () => {
  it('check-p1-28-adapter-reachability.mjs is a different file and stays byte-unchanged', () => {
    const p28 = execFileSync(
      'git',
      [
        'diff',
        '--name-only',
        'origin/develop',
        '--',
        'scripts/ci/check-p1-28-adapter-reachability.mjs',
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
      }
    );
    expect(p28.trim()).toBe('');
  });
});
