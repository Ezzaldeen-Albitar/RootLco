/**
 * Turning stored match evidence into sentences a workshop employee can act on.
 *
 * ## The defect this closes
 *
 * The Product Owner rejected both duplicate-review screens at Owner acceptance:
 * "Duplicate-customer and duplicate-vehicle areas use technical or unclear
 * language", and "Duplicate-review screens do not explain, in normal business
 * language, why records may be duplicates."
 *
 * Both screens printed the stored evidence as formatted JSON:
 *
 *     [{ "basis": "vin_collision", "classification": "restricted", "weight": 0.7 }]
 *
 * The previous revision's own comment defended that — "printed as data rather
 * than interpreted, because inventing a sentence from it would be this screen
 * claiming to know what the detector meant". The reasoning was wrong, and it is
 * worth being precise about why: the detector is not a black box whose meaning
 * has to be guessed. Every signal is a FIXED comparison written in this
 * repository, each one is documented in the domain module that produced it, and
 * there are exactly six of them across both domains. Naming what each comparison
 * did is not interpretation; it is translation, and refusing to translate left a
 * receptionist reading a JSON array.
 *
 * ## The rules this file keeps
 *
 *   - **Message KEYS, never sentences.** Both languages come from the catalogue,
 *     so Arabic is natural business Arabic rather than a literal translation of
 *     an English string embedded in code.
 *   - **An unrecognised signal never reaches the screen.** It maps to a generic
 *     "compare the two records" sentence. Falling back to the raw signal name
 *     would put `make_model_year_similarity` in front of an operator the first
 *     time the backend added a comparison — which is exactly the failure being
 *     fixed.
 *   - **No identifier values.** `crm.jsonb_no_raw_value_keys` and
 *     `veh.valid_match_basis` already forbid raw VINs, plates and identity
 *     numbers from being STORED in the evidence, so there is nothing sensitive
 *     to leak — but this file also never echoes any part of the stored object
 *     into the interface, so the guarantee does not depend on that constraint
 *     staying correct.
 *   - **Order is stable.** Strongest signal first, so the reason a reviewer needs
 *     most is the one they read first.
 */

/** One reason, as a catalogue key. */
export type ReasonKey = string;

const UNKNOWN_REASON: ReasonKey = 'duplicates.reason.unrecognised';

/**
 * Reads an array of evidence entries out of whatever the API returned.
 *
 * `matchBasis` is typed `unknown` on purpose in both contracts: it is `jsonb`,
 * and a screen that assumed a shape would throw on the day the shape changed.
 * Anything that is not an array of objects yields no reasons at all, and the
 * caller shows the generic sentence.
 */
function entriesOf(basis: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(basis)) return [];
  return basis.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
  );
}

/**
 * The CRM comparisons, from `apps/api/src/modules/crm/domain/customer-identity.ts`.
 *
 * Weights are 0.5 / 0.35 / 0.15 and sum to 1; the recording threshold is 0.5.
 * The name comparison is EXACT after normalisation — `crm.normalize_name` on
 * both sides — not fuzzy, which is why the sentence says "once spacing and
 * capitalisation are ignored" rather than "similar".
 */
const CRM_REASONS: Readonly<Record<string, ReasonKey>> = Object.freeze({
  normalized_name: 'crm.duplicates.reason.name',
  contact_value: 'crm.duplicates.reason.contact',
  address_line: 'crm.duplicates.reason.address',
});

/** Strongest first, matching the weights the scorer applies. */
const CRM_ORDER = ['normalized_name', 'contact_value', 'address_line'];

export function customerMatchReasons(basis: unknown): readonly ReasonKey[] {
  const entries = entriesOf(basis);
  if (entries.length === 0) return [];

  const signals = new Set(
    entries.map((entry) => (typeof entry.signal === 'string' ? entry.signal : ''))
  );
  signals.delete('');

  const known = CRM_ORDER.filter((signal) => signals.has(signal)).map(
    (signal) => CRM_REASONS[signal] as ReasonKey
  );
  const unrecognised = [...signals].some((signal) => !(signal in CRM_REASONS));

  return unrecognised ? [...known, UNKNOWN_REASON] : known;
}

/**
 * The vehicle comparisons, from
 * `apps/api/src/modules/vehicle/domain/vehicle-identity.ts`.
 *
 * Weights are 70 / 60 / 20 on a 0–100 scale, the threshold is 80, and at least
 * one STRONG signal (near-VIN or plate movement) must have fired — make, model
 * and year alone can never record a candidate, because thousands of legitimate
 * vehicles share them. That is why the make/model/year sentence begins with
 * "also": it is corroboration, never the reason on its own.
 *
 * The near-VIN comparison is "differ by exactly one character substitution or one
 * adjacent transposition". The sentence says so in business terms — a typing
 * mistake at the reception desk — and never shows either chassis number.
 */
const VEHICLE_REASONS: Readonly<Record<string, ReasonKey>> = Object.freeze({
  vin_collision: 'vehicles.duplicates.reason.vin',
  plate_collision: 'vehicles.duplicates.reason.plate',
  make_model_year_similarity: 'vehicles.duplicates.reason.makeModelYear',
});

const VEHICLE_ORDER = ['vin_collision', 'plate_collision', 'make_model_year_similarity'];

export function vehicleMatchReasons(basis: unknown): readonly ReasonKey[] {
  const entries = entriesOf(basis);
  if (entries.length === 0) return [];

  const signals = new Set(
    entries.map((entry) => (typeof entry.basis === 'string' ? entry.basis : ''))
  );
  signals.delete('');

  const known = VEHICLE_ORDER.filter((signal) => signals.has(signal)).map(
    (signal) => VEHICLE_REASONS[signal] as ReasonKey
  );
  const unrecognised = [...signals].some((signal) => !(signal in VEHICLE_REASONS));

  return unrecognised ? [...known, UNKNOWN_REASON] : known;
}

/** Every reason key this module can ever emit. Used by the catalogue test. */
export const ALL_REASON_KEYS: readonly ReasonKey[] = Object.freeze([
  ...Object.values(CRM_REASONS),
  ...Object.values(VEHICLE_REASONS),
  UNKNOWN_REASON,
]);
