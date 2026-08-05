/**
 * CRM customer search — contract and adapter (`P1-27-FE-001`, `P1-27-FE-002`).
 *
 * The claims worth holding are the ones a screen gets wrong by being helpful:
 * sending a `sort` the operation does not accept, inventing a total the backend
 * does not publish, offering a phone box the allow-list does not include, and
 * searching on every keystroke against a 30-per-minute budget.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIFECYCLE_STATUSES,
  MAX_CUSTOMER_NUMBER_LENGTH,
  MAX_NAME_LENGTH,
  PARTY_TYPES,
  isEmptyCriteria,
  normalizeCriteria,
} from '@/features/crm/customers/contract';
import { CRM_PERMISSIONS, VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';

const ROOT = join(process.cwd(), '..', '..');

/**
 * Source with comments removed.
 *
 * These assertions are about what the CODE does, and the first version of them
 * failed against this file's own explanatory prose: the screen's docblock says
 * "there is no debounce" and "no phone or email box", so a naive `toContain`
 * matched the sentence that promised the opposite of what it was looking for.
 *
 * Deliberately simple, and its limitation is worth stating: it would also strip
 * a `//` inside a string literal. Nothing here has one, and a scanner that tried
 * to be complete would need a real lexer — the same over-reach that broke import
 * detection once already.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the criteria vocabulary matches the backend', () => {
  it('offers exactly the two party types the column permits', () => {
    expect([...PARTY_TYPES]).toEqual(['individual', 'organization']);
  });

  it('offers exactly the five lifecycle statuses the column permits', () => {
    // `merged` is included deliberately: a merged customer is searchable, and
    // omitting the status would hide the one filter that finds them.
    expect([...LIFECYCLE_STATUSES]).toEqual([
      'prospect',
      'active',
      'inactive',
      'blocked',
      'merged',
    ]);
  });

  it('bounds the free-text fields where the route bounds them', () => {
    expect(MAX_NAME_LENGTH).toBe(80);
    expect(MAX_CUSTOMER_NUMBER_LENGTH).toBe(64);
  });
});

describe('normalizeCriteria', () => {
  it('drops a whitespace-only value rather than filtering on the empty string', () => {
    expect(normalizeCriteria({ name: '   ', customerNumber: '' })).toEqual({});
  });

  it('trims and keeps a real value', () => {
    expect(normalizeCriteria({ name: '  Nadia  ' })).toEqual({ name: 'Nadia' });
  });

  it('truncates rather than sending an over-length payload', () => {
    // The backend answers 422, which is correct of it and useless to an operator
    // who pasted a paragraph.
    const long = 'x'.repeat(500);
    const result = normalizeCriteria({ name: long, customerNumber: long });
    expect(result.name).toHaveLength(MAX_NAME_LENGTH);
    expect(result.customerNumber).toHaveLength(MAX_CUSTOMER_NUMBER_LENGTH);
  });

  it('keeps the discriminators as given', () => {
    expect(normalizeCriteria({ partyType: 'organization', lifecycleStatus: 'blocked' })).toEqual({
      partyType: 'organization',
      lifecycleStatus: 'blocked',
    });
  });
});

describe('isEmptyCriteria', () => {
  it('is true for nothing at all, and for whitespace', () => {
    expect(isEmptyCriteria({})).toBe(true);
    expect(isEmptyCriteria({ name: '  ' })).toBe(true);
  });

  it('is false as soon as any one criterion is real', () => {
    expect(isEmptyCriteria({ name: 'a' })).toBe(false);
    expect(isEmptyCriteria({ customerNumber: 'C-1' })).toBe(false);
    expect(isEmptyCriteria({ partyType: 'individual' })).toBe(false);
    expect(isEmptyCriteria({ lifecycleStatus: 'active' })).toBe(false);
  });
});

describe('what the adapter must never send', () => {
  const adapter = code(
    readFileSync(join(ROOT, 'apps', 'web', 'src', 'features', 'crm', 'customers', 'api.ts'), 'utf8')
  );

  it('the comment stripper left the code, so these are not vacuous', () => {
    expect(adapter).toContain('searchCustomers');
  });

  it('sends no sort parameter, because the operation publishes none', () => {
    // The route schema is `.strict()`. A `sort` is a 422 before the query runs,
    // not a differently-ordered page — so a sortable column header would be a
    // control that breaks the screen.
    const call = adapter.slice(
      adapter.indexOf('query({'),
      adapter.indexOf('});', adapter.indexOf('query({'))
    );
    expect(call).not.toContain('sort');
  });

  it('sends only the six parameters the contract accepts', () => {
    const call = adapter.slice(
      adapter.indexOf('query({'),
      adapter.indexOf('});', adapter.indexOf('query({'))
    );
    for (const allowed of [
      'cursor',
      'limit',
      'name',
      'customerNumber',
      'partyType',
      'lifecycleStatus',
    ]) {
      expect(call, allowed).toContain(allowed);
    }
    // Not in the allow-list, and deliberately so — NFR-PRV-001 keeps raw contact
    // values out of the searchable surface entirely.
    expect(call).not.toContain('phone');
    expect(call).not.toContain('email');
  });

  it('publishes no total, so the table cannot render a range it made up', () => {
    // `total` absent from the returned page is what makes `useServerTable` pass
    // `total: null` to the table, which is what makes the pager show
    // Previous/Next without a range.
    expect(adapter).not.toMatch(/^\s*total:/m);
  });

  it('disables the client retry, because the operation is rate-limited', () => {
    // `expensive-read` is 30 per 60 seconds. The shared client retries a read
    // once by default; here that would spend an operator's budget twice per
    // search without telling them.
    expect(adapter).toContain('retries: 0');
  });
});

describe('the screen searches on intent, not on a keystroke', () => {
  const screen = code(
    readFileSync(
      join(
        ROOT,
        'apps',
        'web',
        'src',
        'features',
        'crm',
        'customers',
        'components',
        'CustomerSearchScreen.tsx'
      ),
      'utf8'
    )
  );

  it('the comment stripper actually removed something, so these are not vacuous', () => {
    // Non-vacuity. If `code()` returned an empty string every assertion below
    // would pass while proving nothing.
    expect(screen).toContain('useServerTable');
    expect(screen.length).toBeGreaterThan(1000);
  });

  it('submits through a form, so Enter works in every field', () => {
    expect(screen).toContain('onSubmit');
    expect(screen).toContain('type="submit"');
  });

  it('has no debounce and no timer', () => {
    // A debounce is still a request per pause. Against 30 per minute, and with
    // no client-side suggestion source to debounce against, it buys nothing and
    // costs the operator a 429 mid-sentence.
    expect(screen).not.toMatch(/setTimeout|debounce|useDeferredValue/);
  });

  it('declares no sortable column', () => {
    expect(screen).not.toContain('sortable');
  });

  it('offers no phone or email input', () => {
    expect(screen.toLowerCase()).not.toContain('phone');
    expect(screen.toLowerCase()).not.toContain('email');
  });

  it('shows a create action only after an empty result, and only with permission', () => {
    expect(screen).toContain('canCreate &&');
    expect(screen).toContain('rows.length === 0');
  });
});

describe('the permission codes exist in the platform catalogue', () => {
  const seed = readFileSync(
    join(ROOT, 'supabase', 'seeds', '04_iam_permission_catalog.sql'),
    'utf8'
  );

  it.each(Object.entries(CRM_PERMISSIONS))('%s -> %s is seeded', (_name, code) => {
    // `P1-26-F-011`: a code in no catalogue is "unknown means denied", which
    // hides a screen from every actor who has ever existed.
    expect(seed).toContain(`'${code}'`);
  });

  it.each(Object.entries(VEHICLE_PERMISSIONS))('%s -> %s is seeded', (_name, code) => {
    expect(seed).toContain(`'${code}'`);
  });
});

describe('holds', () => {
  it('is exact membership, never a prefix', () => {
    // A prefix test lets `crm.customer.read` satisfy a control needing
    // `crm.customer.read.sensitive`, and that mistake always errs toward showing
    // more.
    expect(holds(['crm.customer.read'], 'crm.customer.read')).toBe(true);
    expect(holds(['crm.customer.read'], 'crm.customer.read.sensitive')).toBe(false);
    expect(holds([], 'crm.customer.read')).toBe(false);
  });
});
