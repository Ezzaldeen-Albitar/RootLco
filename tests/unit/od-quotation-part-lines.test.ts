/**
 * P1-32-PRE-OD-FD6 — part lines on quotations at the authorised sales price
 * (ADR-023 D6), without a database.
 *
 * Three rules are held here:
 *
 *  - WHICH price a part line is quoted at. `resolveAuthorisedPartPrice` is handed
 *    every authorised source's answer and returns the price only when they agree:
 *    one source is that price; several that state the same price (amount compared
 *    exactly, `12.5` equal to `12.5000`) are that price; several that disagree —
 *    in amount, currency or tax class — are REFUSED rather than chosen between; and
 *    no answer at all is refused, never read as zero. Only the item selling price
 *    can price an item today, so the product passes one answer; the other cases are
 *    synthetic on purpose, so that adding a second source can never pick silently.
 *  - The SHAPE of a requested line, through the two shipped route schemas: a line
 *    with no kind is the service line it always was; a part line names an item and
 *    no service; neither takes a price, a unit or a tax figure.
 *  - That issuing a WORK-ORDER invoice never posts stock, whatever its lines are,
 *    and a counter sale still does (`issuePostsStock`).
 *  - Which refusals of `quo.guard_quotation_part_line` are a price or tax that
 *    moved while the line was being written (`partPriceRaceRule`): exactly the
 *    price and tax tokens, answered as `part_price_changed`; every other token is
 *    left a fault for the caller to re-throw.
 */
import { describe, expect, it } from 'vitest';
import {
  partPriceRaceRule,
  resolveAuthorisedPartPrice,
  type AuthorisedPartPrice,
} from '@api/modules/quotation/domain/part-price-source';
import { issuePostsStock } from '@api/modules/billing/domain/billing';
import { Body as CreateBody } from '@api/app/api/v1/quotations/route';
import { Body as ReviseBody } from '@api/app/api/v1/quotations/[quotationId]/revisions/route';

const ITEM = '0d600000-0000-4000-8000-0000000000a1';
const SERVICE = '0d600000-0000-4000-8000-0000000000b1';
const WORK_ORDER = '0d600000-0000-4000-8000-0000000000c1';
const REQUIRED_PART = '0d600000-0000-4000-8000-0000000000d1';
const SERVICE_LINE = '0d600000-0000-4000-8000-0000000000e1';

const answer = (over: Partial<AuthorisedPartPrice> = {}): AuthorisedPartPrice => ({
  source: 'item_sale_price',
  priceRef: '0d600000-0000-4000-8000-0000000000f1',
  unitPrice: '12.5000',
  currency: 'JOD',
  taxClassId: null,
  ...over,
});

describe('resolveAuthorisedPartPrice — one authorised price, or a refusal', () => {
  it('one source: that price, with the row that priced it', () => {
    const only = answer();
    expect(resolveAuthorisedPartPrice([only])).toEqual({ status: 'priced', price: only });
  });

  it('two sources that state the same price: that price, compared exactly', () => {
    const first = answer({ unitPrice: '12.5000' });
    const second = answer({ unitPrice: '12.5', priceRef: '0d600000-0000-4000-8000-0000000000f2' });
    expect(resolveAuthorisedPartPrice([first, second])).toEqual({
      status: 'priced',
      price: first,
    });
  });

  it('two sources that disagree: refused, never a silent choice', () => {
    for (const other of [
      answer({ unitPrice: '12.5001' }),
      answer({ unitPrice: '13.0000' }),
      answer({ currency: 'USD' }),
      answer({ taxClassId: '0d600000-0000-4000-8000-0000000000f9' }),
    ]) {
      expect(resolveAuthorisedPartPrice([answer(), other])).toEqual({
        status: 'refused',
        rule: 'conflicting_authorised_sale_prices',
      });
    }
  });

  it('no source answers: refused as no authorised sales price, never a zero', () => {
    expect(resolveAuthorisedPartPrice([])).toEqual({
      status: 'refused',
      rule: 'no_authorised_sale_price',
    });
    expect(resolveAuthorisedPartPrice([null])).toEqual({
      status: 'refused',
      rule: 'no_authorised_sale_price',
    });
  });

  it('a source with no price for the item is ignored, not counted as a disagreement', () => {
    const only = answer();
    expect(resolveAuthorisedPartPrice([null, only])).toEqual({ status: 'priced', price: only });
  });
});

describe('a requested quotation line — service by default, part by name', () => {
  const schemas = [
    ['create', (lines: unknown[]) => CreateBody.safeParse({ workOrderId: WORK_ORDER, lines })],
    ['revise', (lines: unknown[]) => ReviseBody.safeParse({ lines })],
  ] as const;

  const issuesOf = (result: { success: boolean; error?: { issues: unknown[] } }) =>
    (result.error?.issues ?? []).map((issue) => {
      const { path, code } = issue as { path: (string | number)[]; code: string };
      return { path: path.join('.'), code };
    });

  for (const [name, parse] of schemas) {
    it(`${name}: a line with no kind is a service line, exactly as before`, () => {
      expect(parse([{ serviceId: SERVICE, quantity: '1' }]).success).toBe(true);
      expect(
        parse([{ serviceId: SERVICE, quantity: '1', sourceServiceLineRef: SERVICE_LINE }]).success
      ).toBe(true);
      expect(issuesOf(parse([{ quantity: '1' }]))).toEqual([
        { path: 'lines.0.serviceId', code: 'invalid_type' },
      ]);
    });

    it(`${name}: a part line names an item, and may name the required part it quotes`, () => {
      expect(parse([{ kind: 'part', itemId: ITEM, quantity: '2.5' }]).success).toBe(true);
      expect(
        parse([
          {
            kind: 'part',
            itemId: ITEM,
            quantity: '1',
            discount: '0.500',
            description: 'Front pads',
            sourceRequiredPartRef: REQUIRED_PART,
          },
        ]).success
      ).toBe(true);
      expect(issuesOf(parse([{ kind: 'part', quantity: '1' }]))).toEqual([
        { path: 'lines.0.itemId', code: 'invalid_type' },
      ]);
    });

    it(`${name}: each kind refuses the other kind's references, at the field`, () => {
      expect(
        issuesOf(parse([{ kind: 'part', itemId: ITEM, serviceId: SERVICE, quantity: '1' }]))
      ).toEqual([{ path: 'lines.0.serviceId', code: 'custom' }]);
      expect(
        issuesOf(
          parse([{ kind: 'part', itemId: ITEM, sourceServiceLineRef: SERVICE_LINE, quantity: '1' }])
        )
      ).toEqual([{ path: 'lines.0.sourceServiceLineRef', code: 'custom' }]);
      expect(issuesOf(parse([{ serviceId: SERVICE, itemId: ITEM, quantity: '1' }]))).toEqual([
        { path: 'lines.0.itemId', code: 'custom' },
      ]);
      expect(
        issuesOf(
          parse([{ serviceId: SERVICE, sourceRequiredPartRef: REQUIRED_PART, quantity: '1' }])
        )
      ).toEqual([{ path: 'lines.0.sourceRequiredPartRef', code: 'custom' }]);
    });

    it(`${name}: a part line takes no price, unit or tax figure — the server resolves them`, () => {
      for (const extra of [
        { unitPrice: '1.0000' },
        { unit: 'each' },
        { taxRate: '0.16' },
        { cost: '1.0000' },
      ]) {
        const result = parse([{ kind: 'part', itemId: ITEM, quantity: '1', ...extra }]);
        expect(result.success).toBe(false);
        expect(issuesOf(result).map((issue) => issue.code)).toContain('unrecognized_keys');
      }
      expect(parse([{ kind: 'bundle', itemId: ITEM, quantity: '1' }]).success).toBe(false);
    });

    it(`${name}: a malformed quantity is still reported at the quantity`, () => {
      expect(issuesOf(parse([{ kind: 'part', itemId: ITEM, quantity: '1.2345' }]))).toEqual([
        { path: 'lines.0.quantity', code: 'invalid_format' },
      ]);
    });
  }
});

describe('partPriceRaceRule — a price that moved under the write is a refusal of the part', () => {
  it('the price and tax tokens of the guard are part_price_changed', () => {
    expect(partPriceRaceRule('part_line_price')).toBe('part_price_changed');
    expect(partPriceRaceRule('part_line_tax')).toBe('part_price_changed');
  });

  it('every other guard token, and no token, stays a fault', () => {
    for (const token of [
      'part_line_shape',
      'part_line_snapshot',
      'part_line_snapshot_frozen',
      'part_line_item',
      'part_line_required_part',
      'part_line',
      '',
    ]) {
      expect(partPriceRaceRule(token)).toBeNull();
    }
    expect(partPriceRaceRule(null)).toBeNull();
  });
});

describe('issuePostsStock — invoicing never duplicates an inventory movement', () => {
  it('a work-order invoice posts no stock, whatever its lines; a counter sale does', () => {
    expect(issuePostsStock('work_order')).toBe(false);
    expect(issuePostsStock('counter_sale')).toBe(true);
  });

  it('an unknown kind moves nothing: a stock movement is never the default', () => {
    expect(issuePostsStock('')).toBe(false);
    expect(issuePostsStock('part')).toBe(false);
  });
});
