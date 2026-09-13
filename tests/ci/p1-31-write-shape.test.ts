/**
 * The red-proof for `check-p1-31-write-shape.mjs` (P1-31, SEC-004).
 *
 * A gate that passes over the mirror as it stands is not evidence that it would
 * refuse a mirror that had drifted. So its teeth are proved here: the real
 * warranty and reporting contract files are COPIED into a scratch root, mutated
 * one drift class at a time, and the gate is required to go red on every one.
 *
 * The comparison itself is the P1-29 gate's and is pinned there. What this file
 * proves is that THIS gate wires it to P1-31's own scope — it reads the feature
 * trees rather than `lib/contracts/`, it resolves the type ALIASES those mirrors
 * use for a closed vocabulary, and it holds the shared and pending declarations
 * to their stated lifecycle.
 *
 * The schemas are extracted ONCE in `beforeAll` and handed to every case with
 * `--schemas`, so a mutation of the mirror is the only variable.
 *
 * Operation ids are ASSEMBLED rather than written as literals. The P1-24
 * operation register credits any test file whose raw text contains an operation
 * id as a test OF that operation — comments included — so a literal id here
 * would make this file appear as evidence for an operation it never exercises.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import {
  BODYLESS,
  MIRROR_FILES,
  P1_31_WRITE_DOMAINS,
  PENDING_MIRRORS,
  SHARED_MIRRORS,
} from '../../scripts/ci/check-p1-31-write-shape.mjs';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts', 'ci', 'check-p1-31-write-shape.mjs');
const FEATURES = join(ROOT, 'apps', 'web', 'src', 'features');
const WARRANTY = join('features', 'warranty', 'warranty-contract.ts');
const REPORTS = join('features', 'reports', 'reports-contract.ts');

/** `wty` + `warranty-policy-rename` -> the id, without ever spelling it out. */
const id = (domain: string, tail: string): string => [domain, tail].join('.');

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

/** A fresh copy of the two real mirror trees, ready to mutate. */
function mirrorCopy(name: string): string {
  const root = join(scratch, name);
  cpSync(FEATURES, join(root, 'features'), { recursive: true });
  return root;
}

function edit(root: string, file: string, from: string, to: string): void {
  const path = join(root, file);
  const src = readFileSync(path, 'utf8');
  if (!src.includes(from)) throw new Error(`mutation anchor absent in ${file}: ${from}`);
  writeFileSync(path, src.replace(from, to));
}

function append(root: string, file: string, text: string): void {
  appendFileSync(join(root, file), text);
}

const CENSUS = `
import('./scripts/ci/check-p1-31-write-shape.mjs').then((m) => {
  const { bodies } = m.inScopeBodies();
  process.stdout.write(JSON.stringify(bodies));
});
`;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'p131-write-shape-proof-'));
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

describe('the scope is P1-31’s own, and it is pinned by name', () => {
  it('holds exactly the two namespaces no other payload gate covers', () => {
    // `sal` is deliberately absent: every `sal` write is already in the P1-30
    // gate's scope, and two gates comparing one operation would make a deletion
    // in either of them invisible. A change to this line must say why.
    expect([...P1_31_WRITE_DOMAINS]).toEqual(['wty', 'rpt']);
  });

  it('reads the feature trees and nothing under `lib/contracts/`', () => {
    expect([...MIRROR_FILES].map((f) => f.replace(/\\/g, '/'))).toEqual([
      'features/warranty/warranty-contract.ts',
      'features/reports/reports-contract.ts',
    ]);
  });

  it('does not declare every write away', () => {
    // The gate has a runtime clause for a scope that has drifted entirely into
    // `PENDING_MIRRORS`, and no mutation of a MIRROR can produce that state —
    // the pending set is the gate's own data. So the relationship is asserted
    // here instead: something is left to compare.
    const declaredAway = new Set([...Object.keys(PENDING_MIRRORS), ...Object.keys(BODYLESS)]);
    const census = execFileSync(process.execPath, ['-e', CENSUS], { cwd: ROOT, encoding: 'utf8' });
    const bodies = JSON.parse(census) as { id: string }[];
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.filter((b) => !declaredAway.has(b.id)).length).toBeGreaterThan(0);
    // And the two maps are disjoint: a write cannot be both bodyless and owed a
    // mirror for the body it does not have.
    for (const key of Object.keys(BODYLESS)) {
      expect(Object.keys(PENDING_MIRRORS)).not.toContain(key);
    }
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
      /P1-31 write shape \[wty, rpt\]: \d+ operation\(s\) in scope, \d+ write\(s\)/
    );
    // Non-vacuity in both halves: bodies were extracted, and some were actually
    // compared rather than every one being declared away.
    expect(Number(/(\d+) with a body/.exec(out)?.[1] ?? '0')).toBeGreaterThan(0);
    expect(Number(/(\d+) compared against/.exec(out)?.[1] ?? '0')).toBeGreaterThan(0);
    expect(Number(/and (\d+) resolved alias\(es\)/.exec(out)?.[1] ?? '0')).toBeGreaterThan(0);
    expect(code).toBe(0);
  });
});

describe('the drift classes turn this gate red', () => {
  it('a field removed from a mirror body', () => {
    const root = mirrorCopy('field-removed');
    edit(
      root,
      WARRANTY,
      '  readonly coveredScope: CoveredScope;\n  readonly durationMonths: number;\n',
      '  readonly coveredScope: CoveredScope;\n'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toContain(id('wty', 'warranty-coverage-create'));
    expect(out).toMatch(/durationMonths/);
  });

  it('a field renamed: reported as one missing AND one unexpected', () => {
    const root = mirrorCopy('field-renamed');
    edit(
      root,
      WARRANTY,
      '  readonly odometerAllowance?: string;',
      '  readonly distanceAllowance?: string;'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/odometerAllowance/);
    expect(out).toMatch(/distanceAllowance/);
  });

  it('a required field marked optional', () => {
    const root = mirrorCopy('required-made-optional');
    edit(
      root,
      WARRANTY,
      'export interface WarrantyPolicyRenameBody {\n  readonly name: string;\n}',
      'export interface WarrantyPolicyRenameBody {\n  readonly name?: string;\n}'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toContain(id('wty', 'warranty-policy-rename'));
    expect(out).toMatch(/API says REQUIRED, mirror says optional/);
  });

  it('an optional field marked required', () => {
    const root = mirrorCopy('optional-made-required');
    edit(
      root,
      WARRANTY,
      '  readonly odometerAllowance?: string;',
      '  readonly odometerAllowance: string;'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/API says optional, mirror says REQUIRED/);
  });

  it('a primitive type changed', () => {
    const root = mirrorCopy('type-changed');
    edit(
      root,
      WARRANTY,
      '  readonly coveredScope: CoveredScope;\n  readonly durationMonths: number;',
      '  readonly coveredScope: CoveredScope;\n  readonly durationMonths: string;'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/durationMonths: API is number, mirror declares `string`/);
  });

  it('a field the API knows nothing about', () => {
    const root = mirrorCopy('unknown-field');
    edit(
      root,
      WARRANTY,
      'export interface WarrantyPolicyRenameBody {\n  readonly name: string;\n}',
      'export interface WarrantyPolicyRenameBody {\n  readonly name: string;\n  readonly reason?: string;\n}'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/reason: declared by the mirror and UNKNOWN to the API/);
  });

  it('a whole mirror interface renamed away is a missing mirror, not a pass', () => {
    const root = mirrorCopy('interface-missing');
    edit(root, WARRANTY, 'export interface WarrantyPolicyRenameBody {', 'export interface Gone {');
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/the mirror declares no `WarrantyPolicyRenameBody`/);
  });
});

describe('the type aliases are really resolved, and an unresolved one still fails', () => {
  it('a member dropped from the vocabulary a body field stands on', () => {
    const root = mirrorCopy('enum-shrunk');
    edit(
      root,
      WARRANTY,
      "export const WARRANTY_CONFIGURATION_STATUSES = ['active', 'archived'] as const;",
      "export const WARRANTY_CONFIGURATION_STATUSES = ['active'] as const;"
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/enum drift/);
    expect(out).toMatch(/archived/);
  });

  it('an alias this gate cannot resolve is reported, never waved through', () => {
    // The safe direction, and the reason the resolver is deliberately narrow. A
    // vocabulary widened to `string` on the mirror side promises a caller values
    // the API refuses; the resolver then has nothing to substitute, the field
    // stays an unresolved reference, and that is reported as drift rather than
    // passing as an alias the gate happens not to understand.
    const root = mirrorCopy('alias-widened');
    edit(
      root,
      WARRANTY,
      'export type CoveredScope = (typeof COVERED_SCOPES)[number];',
      'export type CoveredScope = string;'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/coveredScope: API is a closed enum, mirror declares `ref`/);
    // And the widening is visible in the count the gate reports about itself,
    // stated as a relationship to the untouched tree rather than as a magic
    // number that a new vocabulary would have to come back and edit.
    const resolved = (text: string): number =>
      Number(/and (\d+) resolved alias\(es\)/.exec(text)?.[1] ?? '0');
    expect(resolved(out)).toBe(resolved(runGate(join(ROOT, 'apps', 'web', 'src')).out) - 1);
  });
});

describe('a declaration cannot outlive its reason', () => {
  it('the SHARED entry goes stale the moment the mirror declares the operation’s own name', () => {
    const root = mirrorCopy('shared-stale');
    append(
      root,
      WARRANTY,
      '\nexport interface WarrantyPolicyStatusSetBody {\n  readonly status: WarrantyConfigurationStatus;\n}\n'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/SHARED_MIRRORS entry is STALE/);
    expect(out).toContain(id('wty', 'warranty-policy-status-set'));
  });

  it('the SHARED entry fails when the interface it points at disappears', () => {
    const root = mirrorCopy('shared-target-gone');
    edit(
      root,
      WARRANTY,
      'export interface WarrantyStatusSetBody {',
      'export interface WarrantyStatusPayload {'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/SHARED_MIRRORS points at `WarrantyStatusSetBody`/);
    // Both sharers report it — the entry is per operation, not per interface.
    expect(out).toContain(id('wty', 'warranty-coverage-status-set'));
    expect(out).toContain(id('wty', 'warranty-policy-status-set'));
  });

  it('a PENDING entry goes stale the moment its mirror is written', () => {
    // The lifecycle the report-configuration writes depend on: they are declared
    // pending because nothing in `apps/web` calls them, and the phase that
    // builds that screen must delete the entry in the same change as the mirror.
    const root = mirrorCopy('pending-stale');
    append(
      root,
      REPORTS,
      '\nexport interface ReportConfigurationCreateBody {\n  readonly reportCode: string;\n}\n'
    );
    const { code, out } = runGate(root);
    expect(code).not.toBe(0);
    expect(out).toMatch(/PENDING_MIRRORS entry is STALE/);
    expect(out).toContain(id('rpt', 'report-configuration-create'));
  });

  it('every SHARED entry names an operation the pending map does not claim', () => {
    for (const key of Object.keys(SHARED_MIRRORS)) {
      expect(Object.keys(PENDING_MIRRORS)).not.toContain(key);
    }
    expect(Object.keys(SHARED_MIRRORS).length).toBeGreaterThan(0);
  });
});
