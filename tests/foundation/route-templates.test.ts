/**
 * `ROUTE_TEMPLATES` must equal the templates the route modules actually declare.
 *
 * The list exists to end a CodeQL dataflow: `internRouteTemplate` returns an
 * element of that array rather than its argument, so the hashed value stops
 * being derived from the input. That only works because the values are literals
 * in their own module — which means they are a hand-held copy of the operation
 * registry, and a copy of a registry drifts.
 *
 * Drift here is not cosmetic. A template missing from the list makes every
 * idempotent request to that route fail with `ERR-INT-002`, and the failure
 * would appear in production rather than in CI. So the reconciliation fails the
 * build in BOTH directions, and it reads the route modules on disk rather than
 * any intermediate artefact.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTE_TEMPLATES, internRouteTemplate } from '@/server/http/route-templates';
import { API_ROUTES_ROOT } from '../../scripts/lib/repository-paths.mjs';

const API_ROOT = API_ROUTES_ROOT;

/** Every `path:` declared by a route module, read from disk. */
function declaredTemplates(): string[] {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'route.ts') continue;
      const source = readFileSync(full, 'utf8');
      for (const match of source.matchAll(/^\s*path: '([^']+)',/gm)) {
        found.add(match[1] as string);
      }
    }
  };
  walk(API_ROOT);
  return [...found].sort();
}

describe('the route-template list is the registry, not a snapshot of it', () => {
  it('contains exactly the templates the route modules declare', () => {
    const declared = declaredTemplates();
    const listed = [...(ROUTE_TEMPLATES as readonly string[])].sort();

    const missing = declared.filter((template) => !listed.includes(template));
    const extra = listed.filter((template) => !declared.includes(template));

    expect(
      missing,
      'a declared route is absent from ROUTE_TEMPLATES — every idempotent request to it would fail with ERR-INT-002'
    ).toEqual([]);
    expect(
      extra,
      'ROUTE_TEMPLATES names a route that no longer exists — the list has outlived its source'
    ).toEqual([]);
    expect(listed).toEqual(declared);
  });

  it('is not trivially empty, so the reconciliation above can fail', () => {
    // Both arrays being empty would satisfy every assertion in the test above.
    expect(ROUTE_TEMPLATES.length).toBeGreaterThan(100);
    expect(declaredTemplates().length).toBe(ROUTE_TEMPLATES.length);
  });

  // NOT TESTED HERE: that the returned string is the array's element rather than
  // the argument.
  //
  // That is the property the whole module exists for, and **no runtime test can
  // establish it**. JavaScript strings are values, not references: for any
  // freshly built `rebuilt` with the same characters, `Object.is(rebuilt, first)`
  // is `true`. A `return path` implementation is behaviourally identical to
  // `return ROUTE_TEMPLATES.find(...)` in every observable respect.
  //
  // A first draft of this file asserted it anyway, with a comment calling
  // identity "the property under test". The assertion could not fail. It was
  // caught by mutating the source to `return path` and watching the suite pass —
  // the fourth vacuous assertion this initiative has found in its own work, and
  // the first one written into the very file whose purpose is that property.
  //
  // Only the dataflow analyser can see the difference, so the evidence is the
  // hosted full-tree CodeQL run, recorded in the remediation documents. Claiming
  // a unit test covers it would be exactly the vacuous-evidence problem this
  // initiative was chartered to fix.

  it('refuses anything that is not a registered template', () => {
    for (const hostile of [
      '/not-a-route',
      '',
      '/appointments/../admin',
      '/appointments\n',
      '/APPOINTMENTS',
      '/api/v1/appointments',
    ]) {
      expect(internRouteTemplate(hostile), hostile).toBeNull();
    }
  });

  it('refuses a prototype-shaped lookup rather than answering from the prototype', () => {
    // A plain-object lookup table would answer `__proto__`, `constructor` and
    // `toString` from Object.prototype and hand back something truthy. Array
    // `find` has no such surface, and this pins that it stays that way.
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(internRouteTemplate(key), key).toBeNull();
    }
  });
});
