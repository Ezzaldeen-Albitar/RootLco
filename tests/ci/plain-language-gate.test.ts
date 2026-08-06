import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- the gate is plain ESM JavaScript, deliberately: it runs
// from a hosted runner with no build step, exactly as every other gate does.
import { RULES, inspect, selfTest } from '../../scripts/ci/check-plain-language.mjs';

/**
 * The plain-language gate, tested against the real catalogues and against
 * deliberate violations.
 *
 * Owner-acceptance defect 9 was "user-facing wording across the application
 * still assumes technical knowledge". A gate is the only durable answer,
 * because the person who writes `match_basis` into a message is the person for
 * whom it reads as ordinary English — and so is the person reviewing it.
 *
 * Two obligations, and the second is the one that matters:
 *
 *   1. the shipped catalogues are clean;
 *   2. the gate would say so *only* because they are clean.
 *
 * A sweep that has quietly stopped matching reports a clean tree exactly like a
 * sweep that is working. This phase has now shipped four of those.
 */

const ROOT = join(__dirname, '..', '..');
const CATALOGUES = ['en', 'ar'].map((locale) => ({
  locale,
  catalogue: JSON.parse(
    readFileSync(join(ROOT, 'apps', 'web', 'src', 'i18n', 'messages', `${locale}.json`), 'utf8')
  ) as Record<string, string>,
}));

describe('the shipped vocabulary', () => {
  it('is not empty, so the assertion below is not vacuous', () => {
    for (const { locale, catalogue } of CATALOGUES) {
      expect(Object.keys(catalogue).length, locale).toBeGreaterThan(900);
    }
  });

  it('contains no message that assumes technical knowledge', () => {
    for (const { locale, catalogue } of CATALOGUES) {
      const findings = inspect(locale, catalogue) as { key: string; rule: string }[];
      expect(
        findings.map((f) => `${f.key} (${f.rule})`),
        `${locale} messages a workshop employee would not understand`
      ).toEqual([]);
    }
  });
});

describe('the gate can still fail', () => {
  it('passes its own positive control', () => {
    expect(selfTest()).toBeNull();
  });

  it.each([
    ['internal-identifier', 'The match_basis could not be read.'],
    ['camel-identifier', 'This record has a stale recordVersion.'],
    ['permission-code', 'You need crm.customer.duplicate.review for this.'],
    ['operation-id', 'The crm.duplicate-review call did not complete.'],
    ['null', 'The value is null.'],
    ['json', 'The JSON could not be parsed.'],
    ['uuid', 'Copy the UUID from the address bar.'],
    ['payload', 'The payload was rejected.'],
    ['schema', 'The schema does not allow that.'],
    ['api', 'The API is not responding.'],
    ['raw-key', 'crm.customers.title'],
  ])('catches %s', (rule, value) => {
    const findings = inspect('test', { 'a.b': value }) as { rule: string }[];
    expect(findings.map((f) => f.rule)).toContain(rule);
  });

  it.each([
    'No matching customer was found.',
    'The same telephone number or email address is used on both records.',
    'The two chassis numbers differ by only one character, which usually means someone mistyped one of them.',
    'Another user updated this record. Review the latest information and try again.',
    'Review duplicate vehicles',
    'Show password',
  ])('accepts ordinary business English: %s', (value) => {
    // Non-vacuity in the other direction. A gate that rejects everything would
    // pass every case above for the wrong reason.
    expect(inspect('test', { 'a.b': value })).toEqual([]);
  });

  it('declares a rule for every category the Product Owner named', () => {
    const ids = new Set((RULES as { id: string }[]).map((rule) => rule.id));
    for (const required of [
      'json',
      'uuid',
      'enum',
      'payload',
      'null',
      'boolean',
      'object-type',
      'permission-code',
      'operation-id',
      'internal-identifier',
      'raw-key',
    ]) {
      expect(ids, required).toContain(required);
    }
  });
});
