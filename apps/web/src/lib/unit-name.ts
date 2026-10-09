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

/** A unit as `inv.uom-list` publishes it: enough to find it and to name it. */
export interface NamedUnit {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * A unit a record names by its CODE alone — a stock line's unit, a refusal's
 * figures, a conversion row — named through the unit list the screen holds
 * (P1-32-PRE-OD-INVF, UNIT-names).
 *
 * The code alone cannot say whether the unit kept its standard name, so the
 * name comes from the list and `unitName` decides from it exactly as it does for
 * a snapshot. While no list is held — not read yet, or refused — and when the
 * code names no unit in it, or two units with different names, the code is shown
 * as it was sent: the screen does not guess which unit was meant.
 */
export function unitNameByCode(
  messages: Messages,
  code: string,
  units: readonly NamedUnit[] | null
): string {
  if (units === null) return code;
  const names = new Set(
    units.filter((unit) => unit.code === code).map((unit) => unitName(messages, unit))
  );
  if (names.size !== 1) return code;
  const [only] = names;
  return only ?? code;
}

/** The same, for a record that names its unit by IDENTIFIER: null when the list does not hold it. */
export function unitNameById(
  messages: Messages,
  id: string,
  units: readonly NamedUnit[] | null
): string | null {
  const unit = units?.find((candidate) => candidate.id === id);
  return unit === undefined ? null : unitName(messages, unit);
}

/**
 * The units as the options of a unit picker, each by its name in the reader's
 * language. A code is added only where two units would otherwise read the same,
 * so the operator can still tell them apart.
 */
export function unitOptions(
  messages: Messages,
  units: readonly NamedUnit[]
): { readonly value: string; readonly label: string }[] {
  const named = units.map((unit) => ({ unit, name: unitName(messages, unit) }));
  const seen = new Map<string, number>();
  for (const { name } of named) seen.set(name, (seen.get(name) ?? 0) + 1);
  return named.map(({ unit, name }) => ({
    value: unit.id,
    label: (seen.get(name) ?? 0) > 1 ? `${name} (${unit.code})` : name,
  }));
}
