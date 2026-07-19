/**
 * Phase 1-9 — the personal-data classification guard itself is under test. This
 * drives the SAME canonical script CI runs (scripts/check-wo-tech-dia-qms-
 * classification.mjs): once against the committed registry (must pass) and against
 * tampered copies exercising each failure mode (must fail).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-wo-tech-dia-qms-classification.mjs');
const REAL = join(ROOT, 'docs', 'database', 'wo-tech-dia-qms-personal-data-classification.json');

type Registry = {
  allowedClassifications: string[];
  columns: Record<string, { classification: string; searchable: boolean; dataType?: string }>;
};

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wo-class-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runWith(registryPath?: string): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      env: registryPath
        ? { ...process.env, WO_CLASSIFICATION_REGISTRY: registryPath }
        : { ...process.env },
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function tampered(name: string, mutate: (doc: Registry) => void): string {
  const doc = JSON.parse(readFileSync(REAL, 'utf8')) as Registry;
  mutate(doc);
  const p = join(tmp, `${name}.json`);
  writeFileSync(p, JSON.stringify(doc));
  return p;
}

describe('wo/tech/dia/qms classification guard', () => {
  it('passes against the committed registry', () => {
    const r = runWith();
    expect(r.code).toBe(0);
    expect(r.output).toContain('OK');
  });

  it('fails when a restricted column is marked searchable', () => {
    const p = tampered('searchable', (d) => {
      d.columns['tech.technician_certification_details.certificate_number']!.searchable = true;
    });
    const r = runWith(p);
    expect(r.code).toBe(1);
    expect(r.output).toContain('restricted');
  });

  it('fails when a live column has no classification entry', () => {
    const p = tampered('missing', (d) => {
      delete d.columns['wo.work_orders.state'];
    });
    const r = runWith(p);
    expect(r.code).toBe(1);
    expect(r.output).toContain('no classification entry');
  });

  it('fails on a stale entry referencing a non-existent column', () => {
    const p = tampered('stale', (d) => {
      d.columns['wo.work_orders.ghost_column'] = {
        classification: 'internal',
        searchable: false,
        dataType: 'text',
      };
    });
    const r = runWith(p);
    expect(r.code).toBe(1);
    expect(r.output).toContain('non-existent column');
  });

  it('fails on an invalid classification value', () => {
    const p = tampered('badclass', (d) => {
      d.columns['wo.work_orders.state']!.classification = 'ultra-secret';
    });
    const r = runWith(p);
    expect(r.code).toBe(1);
    expect(r.output).toContain('invalid classification');
  });

  it('fails on registry/live data-type drift', () => {
    const p = tampered('drift', (d) => {
      d.columns['wo.work_orders.record_version']!.dataType = 'text';
    });
    const r = runWith(p);
    expect(r.code).toBe(1);
    expect(r.output).toContain('drift');
  });
});
