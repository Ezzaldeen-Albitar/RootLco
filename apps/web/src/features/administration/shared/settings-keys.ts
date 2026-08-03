import type { SuggestedKey } from '../organization/components/SettingsEditor';

/**
 * Where a settings-backed screen stores what the operator enters.
 *
 * ## These are slots, not policy
 *
 * Five P1-26 screens exist because the platform publishes no dedicated
 * operation for their subject (`P1-26-F-003` … `P1-26-F-007`). They are built on
 * the organization-settings contracts, which store the key and value the caller
 * supplies and — in the backend's own words — supply "no defaults of their own".
 *
 * A key below says **where a value lives**. It does not say what the value
 * should be, and none of them ships with one. No country is assumed, no tax
 * rate is invented, no base currency is chosen, no numbering format is presumed.
 * A screen opens with these slots empty and stays empty until an operator
 * decides otherwise.
 *
 * The namespace itself is an engineering decision — the equivalent of choosing a
 * column name — and is recorded in `open-decisions.md` for Owner ratification.
 * Changing it later is a data migration, which is why it is written down once
 * here rather than spelled out in six components.
 *
 * Every key matches the contract's own pattern, `^[a-z][a-z0-9_.]{1,126}$`,
 * asserted in `apps/web/tests/administration.test.ts`.
 */

export const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_.]{1,126}$/;

/** Invoice reference numbering. Numbers themselves are always allocated server-side. */
export const NUMBERING_PREFIX = 'numbering.';
export const NUMBERING_KEYS: readonly SuggestedKey[] = Object.freeze([
  { key: 'numbering.invoice.prefix', labelKey: 'numbering.field.prefix', valueType: 'string' },
  { key: 'numbering.invoice.suffix', labelKey: 'numbering.field.suffix', valueType: 'string' },
  { key: 'numbering.invoice.padding', labelKey: 'numbering.field.padding', valueType: 'number' },
  { key: 'numbering.invoice.start_at', labelKey: 'numbering.field.startAt', valueType: 'number' },
  {
    key: 'numbering.invoice.reset_period',
    labelKey: 'numbering.field.resetPeriod',
    valueType: 'string',
  },
]);

/** Tax configuration. No jurisdiction, no rate, and no effective date is presumed. */
export const TAX_PREFIX = 'tax.';
export const TAX_KEYS: readonly SuggestedKey[] = Object.freeze([
  { key: 'tax.code', labelKey: 'taxes.field.code', valueType: 'string' },
  { key: 'tax.name', labelKey: 'taxes.field.name', valueType: 'string' },
  { key: 'tax.rate_percent', labelKey: 'taxes.field.rate', valueType: 'string' },
  { key: 'tax.effective_from', labelKey: 'taxes.field.effectiveFrom', valueType: 'string' },
  { key: 'tax.active', labelKey: 'taxes.field.active', valueType: 'boolean' },
]);

/**
 * Enabled currencies.
 *
 * `tax.rate_percent` and this are both stored as **strings and JSON**, never as
 * `number`. A rate is money-adjacent: `numeric` in the database, exact in the
 * contract, and a JavaScript number would round it on the way through. The rule
 * the platform applies to money applies here for the same reason.
 */
export const CURRENCY_PREFIX = 'currency.';
export const CURRENCY_KEYS: readonly SuggestedKey[] = Object.freeze([
  { key: 'currency.enabled_codes', labelKey: 'currencies.field.enabled', valueType: 'json' },
]);
