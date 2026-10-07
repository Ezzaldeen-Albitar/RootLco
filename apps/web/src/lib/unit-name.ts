import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';

/**
 * The name a unit of measure is shown by, in the reader's language.
 *
 * A quotation or invoice line carries its unit as a snapshot — `{ code, name }`
 * — and the name is whatever `inv.units_of_measure.name` held. For the platform's
 * own units (`supabase/seeds/07_inv_units_of_measure.sql`) that name was seeded
 * in English, so an Arabic copy printed "Each" and "Litre" beside Arabic
 * everything else. Those codes are known and fixed, so the catalogue words them
 * in both languages (`units.name.<code>`).
 *
 * Any other code is a unit a tenant named itself, in whatever language it chose:
 * its stored name is shown exactly as stored, never translated or guessed at.
 */
export const SEEDED_UNIT_CODES: readonly string[] = Object.freeze([
  'each',
  'piece',
  'set',
  'pair',
  'hour',
  'litre',
  'millilitre',
  'kilogram',
  'gram',
  'metre',
  'centimetre',
  'square_metre',
]);

export function unitName(
  messages: Messages,
  unit: { readonly code: string; readonly name: string }
): string {
  return SEEDED_UNIT_CODES.includes(unit.code)
    ? translateDynamic(messages, `units.name.${unit.code}`)
    : unit.name;
}
