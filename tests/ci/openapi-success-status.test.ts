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
    expect(actual.size).toBe(407);
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
    // P1-30 A2 adds twelve operations and every one is a GET returning 200, so
    // 250 -> 262 while 201 and 202 are unchanged. Asserted as three independent
    // numbers: a slice that shipped a write mislabelled as a read would move the
    // 200 count and leave 201 short, which a single total could not show.
    // The P1-31 warranty policy and coverage seam (P-10) publishes seven
    // operations: the two creates return 201 (108 -> 110) and the other five — the
    // two reads, the rename, the policy status flip and the coverage status flip —
    // return 200.
    // The P1-31 checklist template seam (P-9), merged alongside it, publishes eight
    // more: its two creates return 201 as well (110 -> 112) and the other six — two
    // reads, the rename, the status flip, the item edit and the item withdrawal —
    // return 200.
    // The P1-31 report configuration seam (P-11) publishes seven more again: its two
    // creates — the configuration and the version — return 201 (112 -> 114) and the
    // other five — the two reads, the edit, the status flip and the publication —
    // return 200.
    expect(counts[201]).toBe(114);
    expect(counts[202]).toBe(1);
    // The two P1-30 opening-batch reads (S-17) are GETs returning 200, so
    // 264 -> 266 while 201 and 202 are unchanged.
    // The six P1-31 delivery reads (P-2 … P-5) are GETs returning 200 as well, so
    // 266 -> 272 with 201 and 202 again unchanged. That the 201 count did NOT move
    // is the assertion carrying weight: a read seam that had accidentally shipped
    // a write would show up here and nowhere else in this file.
    // The P1-31 warranty list (P-6) is one more GET returning 200, so 272 -> 273
    // with 201 and 202 unchanged for the third time. P-7 re-points an existing
    // read's PERMISSION and publishes no operation, so it moves nothing here — a
    // slice that had smuggled a write in beside the re-point would.
    // 273 -> 278 with P-10's five 200s, then 278 -> 284 with P-9's six, then
    // 284 -> 289 with P-11's five. The 201 count moving by exactly two per slice —
    // six across the three — is the assertion carrying weight here: a command that
    // had silently shipped as a read, or a read as a create, would show up in this
    // pair and nowhere else.
    // 289 -> 290 with the P1-31 delivery-readiness queue (Owner decision D-3),
    // one more GET returning 200, with 201 and 202 unchanged this time.
    // The delivery list contributes one further 200 response, so 291.
    // 292 with the P1-31 report ENGINE (P-11) merged alongside it: the run is a
    // GET returning 200, with 201 and 202 unchanged again. A run operation that
    // had smuggled a write in beside the read would move the 201 count, and this
    // pair is where it would show.
    expect(counts[200]).toBe(292);
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
