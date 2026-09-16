/**
 * Text folding — the TypeScript mirrors, the two copies, and the search rules
 * built on them (P1-32-PRE-050..053).
 *
 * Three things are proved here without a database:
 *
 *  1. every mirror in `@api/shared/text/normalization` produces the hand-written
 *     expected value for every row of the shared fixture table (the database tier
 *     runs the same table through the SQL functions);
 *  2. the API copy and the web copy of that file are byte-identical, because the
 *     web may never import the API and the only honest guarantee that two copies
 *     agree is to compare them;
 *  3. the domain rules that consume the mirrors — the phone mask, the phone suffix
 *     threshold, the customer, vehicle and work-order filter reductions — do what
 *     their contracts say, including the "blank is impossible, not absent" cases.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import {
  foldDigits,
  foldSearchText,
  normalizePhoneDigits,
  normalizePlate,
  normalizeVin,
} from '@api/shared/text/normalization';
import {
  MIN_PHONE_SUFFIX,
  PHONE_VISIBLE_DIGITS,
  maskPhone,
  toCustomerSearchFilter,
} from '@api/modules/crm/domain/customer-search';
import { toVehicleSearchFilter } from '@api/modules/vehicle/domain/vehicle-search';
import { toWorkOrderSearchTerms } from '@api/modules/work-order/domain/work-order';
import { TEXT_FOLDING_CASES } from './text-folding-fixtures';

const API_COPY = join(REPOSITORY_ROOT, 'apps', 'api', 'src', 'shared', 'text', 'normalization.ts');
const WEB_COPY = join(REPOSITORY_ROOT, 'apps', 'web', 'src', 'lib', 'text', 'normalization.ts');

describe('text folding mirrors against the hand-written fixture table', () => {
  it('the fixture table is not vacuous', () => {
    // A table that silently emptied would make every loop below pass.
    expect(TEXT_FOLDING_CASES.length).toBeGreaterThanOrEqual(20);
  });

  for (const row of TEXT_FOLDING_CASES) {
    it(`folds "${row.label}" exactly as written`, () => {
      expect(foldDigits(row.input), 'foldDigits').toBe(row.foldDigits);
      expect(foldSearchText(row.input), 'foldSearchText').toBe(row.foldSearchText);
      expect(normalizePhoneDigits(row.input), 'normalizePhoneDigits').toBe(row.phone);
      expect(normalizeVin(row.input), 'normalizeVin').toBe(row.vin);
      expect(normalizePlate(row.input), 'normalizePlate').toBe(row.plate);
    });
  }

  it('digit folding preserves length, so it can never merge or split characters', () => {
    for (const row of TEXT_FOLDING_CASES) {
      expect(foldDigits(row.input)).toHaveLength(row.input.length);
    }
  });

  it('a name and its diacritised, hamza-seated spelling fold to one key', () => {
    // The whole point of the name rule: the same person typed two ways.
    const plain = '\u0627\u062D\u0645\u062F \u0645\u062D\u0645\u062F';
    const decorated = '\u0623\u062D\u0645\u062F  \u0645\u064F\u062D\u064E\u0645\u0651\u064E\u062F';
    expect(foldSearchText(decorated)).toBe(foldSearchText(plain));
  });

  it('letter folding never reaches an identifier', () => {
    // Two plates one hamza apart are two plates.
    expect(normalizePlate('\u0623 123')).not.toBe(normalizePlate('\u0627 123'));
  });
});

describe('the API and web copies of the folding source', () => {
  it('are byte-identical', () => {
    const api = readFileSync(API_COPY);
    const web = readFileSync(WEB_COPY);
    // Compared as bytes, not as decoded text, so a byte-order mark or a line-ending
    // difference is a failure too.
    expect(
      web.equals(api),
      'apps/web/src/lib/text/normalization.ts drifted from the API copy'
    ).toBe(true);
  });

  it('are self-contained, which is what lets the copy be exact', () => {
    const source = readFileSync(API_COPY, 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

describe('customer search — phone masking', () => {
  it('keeps the last four digits and masks every earlier character', () => {
    expect(PHONE_VISIBLE_DIGITS).toBe(4);
    expect(maskPhone('+962790123456')).toBe('*********3456');
    expect(maskPhone('0790123456')).toBe('******3456');
  });

  it('masks a value no longer than the visible width ENTIRELY rather than publishing it', () => {
    expect(maskPhone('3456')).toBe('****');
    expect(maskPhone('12')).toBe('**');
  });

  it('preserves length, so the shape of the number is still recognisable', () => {
    expect(maskPhone('0790123456')).toHaveLength('0790123456'.length);
  });
});

describe('customer search — filter reduction', () => {
  it('folds a phone typed in Arabic-Indic digits and drops the leading plus', () => {
    const filter = toCustomerSearchFilter({
      phone: '+\u0669\u0666\u0662 \u0667\u0669 \u0660\u0661\u0662 \u0663\u0664\u0665\u0666',
    });
    expect(filter.phoneDigits).toBe('962790123456');
    expect(filter.phoneSuffixEligible).toBe(true);
  });

  it('allows a suffix match only from the minimum tail length up', () => {
    expect(MIN_PHONE_SUFFIX).toBe(7);
    expect(toCustomerSearchFilter({ phone: '123456' }).phoneSuffixEligible).toBe(false);
    expect(toCustomerSearchFilter({ phone: '1234567' }).phoneSuffixEligible).toBe(true);
  });

  it('keeps a phone holding no digits as an impossible empty fragment, never as no filter', () => {
    const filter = toCustomerSearchFilter({ phone: 'abc' });
    expect(filter.phoneDigits).toBe('');
    expect(filter.phoneSuffixEligible).toBe(false);
  });

  it('folds and LIKE-escapes a name fragment, and collapses a blank one to no filter', () => {
    expect(toCustomerSearchFilter({ name: '\u0623\u062D\u0645\u062F' }).nameFragment).toBe(
      '\u0627\u062D\u0645\u062F'
    );
    expect(toCustomerSearchFilter({ name: '50%_off' }).nameFragment).toBe('50\\%\\_off');
    expect(toCustomerSearchFilter({ name: '   ' }).nameFragment).toBeNull();
  });

  it('reduces the free-text box three ways at once', () => {
    const filter = toCustomerSearchFilter({ q: ' C-\u0661\u0662\u0663\u0664\u0665\u0666\u0667 ' });
    expect(filter.freeText).toBe('c-1234567');
    expect(filter.freeTextRaw).toBe('C-\u0661\u0662\u0663\u0664\u0665\u0666\u0667');
    expect(filter.freeTextDigits).toBe('1234567');
    expect(filter.freeTextPhoneEligible).toBe(true);
  });
});

describe('vehicle search — filter reduction', () => {
  it('folds make and model fragments and leaves the exact VIN arm untouched', () => {
    const filter = toVehicleSearchFilter({ make: '  TOYO ', model: 'Cor%', vin: 'x' }, 'X');
    expect(filter.makeFragment).toBe('toyo');
    expect(filter.modelFragment).toBe('cor\\%');
    expect(filter.hasVin).toBe(true);
    expect(filter.vinNormalized).toBe('X');
  });

  it('reduces the free-text box by the name, VIN and plate rules separately', () => {
    const filter = toVehicleSearchFilter({ q: '\u0661\u0662\u0663-ab' }, null);
    expect(filter.freeText).toBe('123-ab');
    expect(filter.freeTextVin).toBe('123AB');
    expect(filter.freeTextPlate).toBe('123AB');
  });

  it('collapses a blank text fragment to no filter', () => {
    const filter = toVehicleSearchFilter({ make: '   ', q: '   ' }, null);
    expect(filter.makeFragment).toBeNull();
    expect(filter.freeText).toBeNull();
  });
});

describe('work-order search — term reduction', () => {
  it('folds the digits of an exact number and nothing else', () => {
    const terms = toWorkOrderSearchTerms({ number: ' WO-\u0660\u0660\u0664\u0662 ' });
    expect(terms.number).toBe('WO-0042');
    expect(terms.hasFreeText).toBe(false);
  });

  it('reduces the free-text box once per column rule', () => {
    const terms = toWorkOrderSearchTerms({ q: '\u0623\u062D\u0645\u062F_1' });
    expect(terms.hasFreeText).toBe(true);
    expect(terms.numberFragment).toBe('\u0623\u062D\u0645\u062F\\_1');
    expect(terms.nameFragment).toBe('\u0627\u062D\u0645\u062F\\_1');
    expect(terms.plateFragment).toBe('\u0623\u062D\u0645\u062F1');
    expect(terms.vinFragment).toBe('1');
  });

  it('disables an identifier arm whose fragment reduced to nothing', () => {
    const terms = toWorkOrderSearchTerms({ q: '--' });
    expect(terms.plateFragment).toBe('');
    expect(terms.vinFragment).toBe('');
  });
});
