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
  publishedSuccessStatuses,
  routeFiles,
  successStatuses,
} from '../../scripts/ci/check-openapi-success-status.mjs';

const SPEC = JSON.parse(readFileSync('docs/api/openapi.v1.json', 'utf8')) as {
  paths: Record<
    string,
    Record<string, { operationId?: string; responses?: Record<string, unknown> }>
  >;
};

/** The published success status of each operation, the replay status set apart. */
function publishedSuccess(): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, published] of publishedSuccessStatuses(SPEC) as Map<
    string,
    { success: number; replay: number | null; codes: number[] }
  >) {
    out.set(id, published.success);
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
    // 412 with the P1-31 warranty status-history read (P-18), one further route
    // module whose single literal status the scanner resolves from the handler.
    // P1-31 P-12 adds one 200 export response.
    // 426 with the P1-32 Platform Owner Console backend (thirteen operations).
    // 429 with the Owner directive organisation administration: the company and
    // branch creates co-locate a POST on two existing route modules, and the
    // capacity read is one new module.
    // 432 with the P1-32-PRE-151 organisation growth: three operations over three
    // new route modules under the organisation the console is administering.
    // 431 with the P1-32 preparatory inventory slice: eighteen more route
    // handlers, each resolved from its own literal status or its absence.
    // 437 with P1-32 preparatory slice 2: six identifier operations.
    // 444 with the rest of that slice: two item-price operations, two counter-sale
    // operations and three return operations.
    // 459 with P1-32 preparatory slice 3b: six material-requirement operations,
    // three unit-conversion operations, four specification operations and the two
    // transfer discrepancy acts.
    // 463 with slice 3c: the requirement re-check and cancellation and the request
    // closure and cancellation.
    // 465 with P1-32-PRE-141: the transfer settlement list and read.
    // 468 with the Owner directive organisation administration merged in: the
    // company and branch creates co-locate a POST on two existing route modules,
    // and the capacity read is one new module.
    // 484 at the integration of the two lines: 416 in the shared base, 52 more
    // operations from this branch and 16 from the console.
    // 492 with the Owner directive operational stock alerts: eight operations over
    // seven new route modules, the reorder-level collection carrying both verbs.
    // 493 with the Owner directive console account and security: one operation
    // over one new route module.
    // 495 with the Owner directive credit-note reads (DEF-T-07): the credit-note
    // list and the credit-note detail, two reads that both answer 200.
    // 496 with the Owner directive tenant dashboard: one operation over one new
    // route module, the overview summary.
    // 497 with the Owner directive working-context read: one operation over one
    // new route module.
    expect(actual.size).toBe(497);
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
    // The P1-31 employee register (P-17) publishes four operations: the create
    // returns 201 (114 -> 115) and the other three — the list, the detail and the
    // status command — return 200.
    // The P1-32 Platform Owner Console publishes thirteen operations: the plan,
    // subscription, charge and receipt creates return 201 (115 -> 119) and the
    // other nine return 200.
    // The Owner directive organisation administration publishes three: the
    // company and branch creates return 201 (119 -> 121) and the capacity read
    // returns 200.
    // The three growth operations all return 201: each of them either writes a
    // row or issues an invitation, and a re-invitation is still an act.
    // The P1-32 preparatory inventory slice publishes eighteen operations and
    // exactly ONE literal 201: the adjustment request. The three creates that can
    // replay — transfer dispatch, goods receipt, count open — return
    // `replayed ? 200 : 201`, which the scanner cannot read as a literal and so
    // publishes as 200, exactly as `inv.stock-reservation-create` already does.
    // P1-32 preparatory slice 2 adds ONE literal 201, the identifier add; the
    // internal-barcode allocation returns `replayed ? 200 : 201` and publishes 200.
    // P1-32 preparatory slice 3b adds FOUR literal 201s — the requirement create,
    // the exception create, the conversion set and the specification record — and
    // the discrepancy resolution returns `replayed ? 200 : 201` and publishes 200.
    // 121 -> 129 when slice 3c taught the scanner the replay ternary: the EIGHT
    // creates written `x.replayed ? 200 : 201` — reservation, transfer dispatch,
    // goods receipt, count open, barcode allocation, counter sale, sales return and
    // discrepancy resolution — now resolve to the 201 they return on a create, and
    // publish their replay 200 beside it (`x-replay-status`). None of slice 3c's own
    // four operations creates anything, so none of them moves this count.
    // 129 -> 131 with the Owner directive organisation administration merged in:
    // the company and branch creates each return a literal 201; its capacity read
    // returns 200 and moves the count below instead.
    // 131 + 124 - 117 = 138 at the integration of the two lines: the console's
    // seven 201s and this branch's fourteen land on disjoint route modules.
    expect(counts[201]).toBe(138);
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
    // 292 -> 295 with P-17's three 200s. The 201 count moving by exactly one is
    // the assertion carrying weight: a command that had silently shipped as a read,
    // or a read as a create, would show up in this pair and nowhere else.
    // 295 -> 296 with the P1-31 warranty status-history read (P-18), one further
    // GET returning 200 with the 201 and 202 counts unchanged. That pair not
    // moving is the assertion carrying weight: a ledger read that had shipped an
    // append beside it would show up here and nowhere else in this file.
    // 297 -> 306 with the P1-32 console's nine 200s.
    // 306 -> 307 with the Owner directive capacity read, a GET returning 200;
    // its two sibling creates move the 201 count above instead.
    // 297 -> 314 with the P1-32 preparatory inventory slice: seventeen of its
    // eighteen operations publish 200 — the seven reads, the seven state changes,
    // and the three replayable creates whose status is not a literal — and the
    // adjustment request is the one 201 counted above.
    // 314 -> 319 with P1-32 preparatory slice 2: the list, the retirement, the
    // barcode allocation, the resolver and the label read.
    // 319 -> 326 with the rest of that slice: the two item-price operations (the
    // set REVISES a row and returns 200), the two counter-sale operations and the
    // three return operations — the counter-sale create and the return receipt
    // resolve to 200 because their status is a replay ternary rather than a literal.
    // 326 -> 337 with P1-32 preparatory slice 3b: eleven of its fifteen operations —
    // the four reads, the four decisions and retirements of rows that already exist,
    // the confirmation, and the discrepancy resolution whose status is a replay
    // ternary — publish 200.
    // 337 -> 333 with slice 3c: minus the eight replayable creates now resolved to
    // 201 (see above), plus its four operations — the re-check, the requirement
    // cancellation, the request closure and the request cancellation — all of which
    // change a row that already exists and return 200.
    // 333 -> 335 with P1-32-PRE-141: the transfer settlement list and read.
    // 335 -> 336 with the Owner directive capacity read, a GET returning 200;
    // its two sibling creates move the 201 count above instead.
    // 336 + 307 - 298 = 345 at the integration of the two lines: the console's
    // nine 200s and this branch's thirty-eight land on disjoint route modules.
    // 345 -> 353 with the Owner directive operational stock alerts. All eight
    // publish 200: six are reads, and the two writes change or create a row whose
    // identity the caller already named by its signature, so neither handler sets
    // 201 and neither declares it.
    // 354 -> 356 with the Owner directive credit-note reads (DEF-T-07). Both are
    // GETs, so both publish 200 and neither moves the 201 count.
    // 356 -> 357 with the Owner directive tenant dashboard, and 357 -> 358 with
    // the Owner directive working-context read. Both are GETs, so each
    // publishes 200 and does not move the 201 count.
    expect(counts[200]).toBe(358);
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

  it('reads a replayable create as its create status, with the replay status beside it', () => {
    const replayable = `
      export const R_OPERATION = defineOperation({ id: 'fx.replayable' });
      export async function POST(): Promise<Response> {
        return handleOperation(R_OPERATION, request, async () => {
          const created = await create();
          return { status: created.replayed ? 200 : 201, body: created };
        });
      }`;
    const found = successStatuses(replayable, 'fixture');
    expect(found.unresolved).toEqual([]);
    expect(found.resolved.get('fx.replayable')).toBe(201);
    expect(found.replays.get('fx.replayable')).toBe(200);

    // Any OTHER computed status is still not a literal and publishes nothing new.
    const other = `
      export const O_OPERATION = defineOperation({ id: 'fx.other' });
      export async function POST(): Promise<Response> {
        return handleOperation(O_OPERATION, request, async () => {
          return { status: result.created ? 201 : 200, body: result };
        });
      }`;
    const otherFound = successStatuses(other, 'fixture');
    expect(otherFound.replays.has('fx.other')).toBe(false);
  });

  it('publishes both statuses of every replayable create, and names the replay one', () => {
    const { replays } = actualSuccessStatuses();
    const published = publishedSuccessStatuses(SPEC) as Map<
      string,
      { success: number; replay: number | null; codes: number[] }
    >;
    expect([...replays.keys()].sort()).toEqual([
      'inv.goods-receipt-create',
      'inv.item-barcode-assign',
      'inv.sales-return-create',
      'inv.stock-count-open',
      'inv.stock-reservation-create',
      'inv.stock-transfer-create',
      'inv.stock-transfer-discrepancy-resolve',
      'sal.counter-sale-create',
    ]);
    for (const [id, replay] of replays) {
      expect(published.get(id), id).toEqual({ success: 201, replay, codes: [200, 201] });
    }
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
