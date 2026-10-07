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
 *
 * A seeded CODE is translated only while the line still carries the seeded
 * English NAME (P1-32-PRE-OD-FD16B). A name that differs was given to that line's
 * unit by someone, and replacing it with the catalogue's word would show a name
 * the record does not hold; it is shown as stored.
 */
export const SEEDED_UNIT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  each: 'Each',
  piece: 'Piece',
  set: 'Set',
  pair: 'Pair',
  hour: 'Hour',
  litre: 'Litre',
  millilitre: 'Millilitre',
  kilogram: 'Kilogram',
  gram: 'Gram',
  metre: 'Metre',
  centimetre: 'Centimetre',
  square_metre: 'Square metre',
});

/** The codes `supabase/seeds/07_inv_units_of_measure.sql` seeds. */
export const SEEDED_UNIT_CODES: readonly string[] = Object.freeze(Object.keys(SEEDED_UNIT_NAMES));

export function unitName(
  messages: Messages,
  unit: { readonly code: string; readonly name: string }
): string {
  const seeded = Object.prototype.hasOwnProperty.call(SEEDED_UNIT_NAMES, unit.code)
    ? SEEDED_UNIT_NAMES[unit.code]
    : undefined;
  return seeded !== undefined && unit.name === seeded
    ? translateDynamic(messages, `units.name.${unit.code}`)
    : unit.name;
}
