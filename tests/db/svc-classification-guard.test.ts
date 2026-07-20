/**
 * Phase 1-10 — the svc/quo/inv classification guard passes on the real registry and
 * FAILS on each tampered fixture (missing / stale / bad-class / restricted-searchable
 * / type-drift / duplicate).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = 'scripts/check-svc-quo-inv-classification.mjs';
const REAL = 'docs/database/svc-quo-inv-personal-data-classification.json';

function run(registryPath: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT], {
      env: { ...process.env, SVC_CLASSIFICATION_REGISTRY: registryPath },
      encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

type Meta = { classification: string; searchable: boolean; dataType: string };
type Registry = { allowedClassifications: string[]; columns: Record<string, Meta> };

const dir = mkdtempSync(join(tmpdir(), 'svc-cls-'));
function tampered(name: string, mutate: (doc: Registry, raw: string) => string | object): string {
  const raw = readFileSync(REAL, 'utf8');
  const doc = JSON.parse(raw) as Registry;
  const result = mutate(doc, raw);
  const path = join(dir, name);
  writeFileSync(path, typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  return path;
}

describe('svc/quo/inv classification guard', () => {
  it('passes on the committed registry', () => {
    expect(run(REAL).code).toBe(0);
  });

  it('fails when a live column is missing an entry', () => {
    const p = tampered('missing.json', (doc) => {
      delete doc.columns['svc.services.name'];
      return doc;
    });
    const r = run(p);
    expect(r.code).toBe(1);
    expect(r.out).toContain('no classification entry');
  });

  it('fails on a stale entry for a non-existent column', () => {
    const p = tampered('stale.json', (doc) => {
      doc.columns['svc.services.ghost_column'] = {
        classification: 'internal',
        searchable: false,
        dataType: 'text',
      };
      return doc;
    });
    expect(run(p).out).toContain('non-existent column');
  });

  it('fails on an invalid classification value', () => {
    const p = tampered('badclass.json', (doc) => {
      const col = doc.columns['svc.services.name'];
      if (col) col.classification = 'ultra-secret';
      return doc;
    });
    expect(run(p).out).toContain('invalid classification');
  });

  it('fails when a restricted column is marked searchable', () => {
    const p = tampered('searchable.json', (doc) => {
      const col = doc.columns['inv.item_cost_details.standard_cost'];
      if (col) col.searchable = true;
      return doc;
    });
    expect(run(p).out).toContain('searchable');
  });

  it('fails on registry/live data-type drift', () => {
    const p = tampered('drift.json', (doc) => {
      const col = doc.columns['svc.services.name'];
      if (col) col.dataType = 'integer';
      return doc;
    });
    expect(run(p).out).toContain('drift');
  });

  it('fails on a duplicate registry key', () => {
    const p = tampered('dup.json', (_doc, raw) =>
      raw.replace(
        '"svc.services.name":',
        '"svc.services.name": { "classification": "internal", "searchable": false, "dataType": "text" },\n    "svc.services.name":'
      )
    );
    expect(run(p).out).toContain('duplicate');
  });
});
