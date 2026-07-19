/**
 * Phase 1-7 classification-guard negative fixtures (P1-07-DO-001 / SEC-003).
 *
 * Spawns the ONE canonical validator (scripts/check-veh-classification.mjs —
 * the same implementation CI runs) and proves it actually fails on each
 * tampered registry: a restricted column flipped searchable, a missing live
 * column, a stale entry, an unknown classification, and a data-type drift. The
 * untampered committed registry must pass (exit 0).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-veh-classification.mjs');
const REAL = join(ROOT, 'docs', 'database', 'veh-personal-data-classification.json');

const tmp = mkdtempSync(join(tmpdir(), 'veh-class-'));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

type Registry = {
  allowedClassifications: string[];
  columns: Record<string, { classification: string; searchable: boolean; dataType?: string }>;
};

function runWith(registryPath?: string): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      env: registryPath
        ? { ...process.env, VEH_CLASSIFICATION_REGISTRY: registryPath }
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

describe('veh classification guard — negative fixtures (canonical script)', () => {
  it('passes on the committed registry (exit 0)', () => {
    const r = runWith();
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain('OK');
  });

  it('fails when a restricted column is flipped searchable', () => {
    const p = tampered('restricted-searchable', (d) => {
      const col = d.columns['vehicle_identifiers.raw_value'];
      if (!col) throw new Error('fixture column missing');
      col.searchable = true;
    });
    const r = runWith(p);
    expect(r.code).toBe(1);
    expect(r.output).toContain('restricted');
  });

  it('fails when a live column has no entry (missing coverage)', () => {
    const p = tampered('missing-column', (d) => {
      delete d.columns['vehicles.vin_normalized'];
    });
    const r = runWith(p);
    expect(r.code).toBe(1);
    expect(r.output).toContain('no classification entry');
  });

  it('fails on a stale entry for a non-existent column', () => {
    const p = tampered('stale-entry', (d) => {
      d.columns['vehicles.ghost_column'] = { classification: 'internal', searchable: false };
    });
    const r = runWith(p);
    expect(r.code).toBe(1);
    expect(r.output).toContain('non-existent column');
  });

  it('fails on an unknown classification value', () => {
    const p = tampered('bad-class', (d) => {
      const col = d.columns['vehicles.color'];
      if (!col) throw new Error('fixture column missing');
      col.classification = 'ultra-secret';
    });
    const r = runWith(p);
    expect(r.code).toBe(1);
    expect(r.output).toContain('invalid classification');
  });

  it('fails on registry/live data-type drift', () => {
    const p = tampered('type-drift', (d) => {
      const col = d.columns['vehicles.model_year'];
      if (!col) throw new Error('fixture column missing');
      col.dataType = 'text';
    });
    const r = runWith(p);
    expect(r.code).toBe(1);
    expect(r.output).toContain('drift');
  });
});
