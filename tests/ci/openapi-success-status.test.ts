/**
 * The published success status must be the one the handler returns.
 *
 * ## What was wrong
 *
 * `document.ts` hard-coded `'200'` as the sole success response for all 334
 * operations. 98 of them return `201` and one returns `202`, so the published
 * contract told every generated client and the frontend mirror the wrong success
 * code for 99 operations — and nothing could catch it, because the document was
 * generated from a declaration that had no field capable of disagreeing with the
 * handler.
 *
 * `BR-08-OPEN-01` recorded this as "the 19 operations returning an undocumented
 * `201`". The figure is not reproducible from the protected tree and the real
 * number is 99; the contract that scoped the smaller one never landed on develop.
 *
 * ## Why a declared field is not enough on its own
 *
 * `successStatus` could drift from the handler exactly as a hard-coded literal
 * did. So the gate does not read the declaration and stop: it derives the status
 * from each `handleOperation(...)` call and compares. These cases prove the
 * derivation is real and that it refuses rather than guesses.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  actualSuccessStatuses,
  declaredOperations,
  routeFiles,
  successStatuses,
} from '../../scripts/ci/check-openapi-success-status.mjs';

const SPEC = JSON.parse(readFileSync('docs/api/openapi.v1.json', 'utf8')) as {
  paths: Record<
    string,
    Record<string, { operationId?: string; responses?: Record<string, unknown> }>
  >;
};

function publishedSuccess(): Map<string, number> {
  const out = new Map<string, number>();
  for (const methods of Object.values(SPEC.paths)) {
    for (const op of Object.values(methods)) {
      if (!op || typeof op !== 'object' || !op.responses || !op.operationId) continue;
      const success = Object.keys(op.responses).find((code) => code.startsWith('2'));
      if (success) out.set(op.operationId, Number(success));
    }
  }
  return out;
}

describe('every operation publishes the success status it returns', () => {
  const { actual, unresolved } = actualSuccessStatuses();
  const published = publishedSuccess();

  it('resolves every route without guessing', () => {
    // An unresolved operation is the case where a silent default would republish
    // the original defect, so the scanner reports rather than assumes — and this
    // asserts it had nothing to report.
    expect(unresolved).toEqual([]);
    expect(actual.size).toBe(345);
  });

  it('agrees with the committed contract for every operation', () => {
    const disagreements: string[] = [];
    for (const [id, status] of actual) {
      const advertised = published.get(id);
      if (advertised !== undefined && advertised !== status) {
        disagreements.push(`${id}: returns ${status}, published ${advertised}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('still finds the population that made this necessary', () => {
    // Not a vacuous pass: if the scanner silently stopped matching, these counts
    // would collapse toward "everything returns 200" — the state being fixed —
    // and this case would fail before the agreement case above went green.
    const counts = [...actual.values()].reduce<Record<number, number>>(
      (acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }),
      {}
    );
    expect(counts[201]).toBe(100);
    expect(counts[202]).toBe(1);
    expect(counts[200]).toBe(244);
  });

  it('reads the handler, not the declaration', () => {
    // The decisive property. A file whose declaration SAYS 201 while its handler
    // returns 200 must resolve to 200, or the gate is just reading the field it
    // is supposed to be checking.
    const source = `
      export const X_OPERATION = defineOperation({
        id: 'fx.probe',
        successStatus: 201,
      });
      export async function POST(): Promise<Response> {
        return handleOperation(X_OPERATION, request, async () => {
          return { status: 200, body: {} };
        });
      }`;
    const found = successStatuses(source, 'fixture');
    expect(found.unresolved).toEqual([]);
    expect(found.resolved.get('fx.probe')).toBe(200);
  });

  it('refuses a handler it cannot resolve instead of defaulting', () => {
    const orphan = `
      export async function POST(): Promise<Response> {
        return handleOperation(NOT_DECLARED_HERE, request, async () => ({ status: 201 }));
      }`;
    const found = successStatuses(orphan, 'fixture');
    expect(found.resolved.size).toBe(0);
    expect(found.unresolved).toHaveLength(1);
    expect(found.unresolved[0]).toContain('names no defineOperation');
  });

  it('refuses a handler with two different literal statuses', () => {
    const ambiguous = `
      export const Y_OPERATION = defineOperation({ id: 'fx.ambiguous' });
      export async function POST(): Promise<Response> {
        return handleOperation(Y_OPERATION, request, async () => {
          if (x) return { status: 200, body: {} };
          return { status: 201, body: {} };
        });
      }`;
    const found = successStatuses(ambiguous, 'fixture');
    expect(found.resolved.has('fx.ambiguous')).toBe(false);
    expect(found.unresolved[0]).toContain('more than one literal status');
  });

  it('scans every versioned route file', () => {
    const files = routeFiles();
    expect(files.length).toBeGreaterThan(250);
    expect(files.every((f) => f.endsWith('/route.ts'))).toBe(true);
  });

  it('maps a declaration constant to its operation id', () => {
    const map = declaredOperations(
      `const A_OPERATION = defineOperation({ id: 'fx.a', module: 'x' });`
    );
    expect(map.get('A_OPERATION')).toBe('fx.a');
  });
});
