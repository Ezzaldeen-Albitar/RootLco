/**
 * One free-text box, reduced to the differently-normalised forms each column
 * needs (Owner directive, P1-32-PRE-OD-UX).
 *
 * ## Why this lives in `shared/` rather than in a module
 *
 * The reception board, the appointment calendar, the delivery list and the
 * warranty list all gained the SAME search box, and they live in four different
 * modules that may not import one another's internals. The work-order module
 * already had its own reducer (`toWorkOrderSearchTerms`) and a second, third and
 * fourth copy of it would be four places for the rule "a phone tail is at least
 * seven digits" to drift apart — which is exactly the failure this repository
 * keeps recording. `shared/` is the one tree all four may read and which imports
 * no module, so the rule is written once.
 *
 * `toWorkOrderSearchTerms` is deliberately NOT deleted or re-pointed here. It
 * carries a second, separate concern — an EXACT `number` filter beside the box —
 * and rewriting a shipped operation's search to prove a point about reuse would
 * be a change nobody asked for. The two agree because both call the same
 * `normalization.ts` functions, which is where agreement actually comes from.
 *
 * ## The normalisation is NEVER re-derived in SQL
 *
 * Each fragment below is folded by the same rule the stored column was folded
 * by, and the repository calls the SQL twin on the COLUMN side — `crm.normalize_name`
 * for a display name, `right(normalized_value, 7)` for a phone tail,
 * `plate_normalized` and `vin_normalized` for the vehicle. So the index and the
 * predicate can never diverge on a single row.
 *
 * ## An empty arm is DISABLED, not left to match everything
 *
 * A fragment that reduces to nothing — a caller typing Arabic letters has no VIN
 * form, a caller typing a name has no plate form — is returned as the empty
 * string, and every repository guards its arm with `<> ''`. Appending `LIKE '%%'`
 * instead would make that arm match every row in the branch, which is the
 * opposite of a search.
 */
import {
  foldDigits,
  foldSearchText,
  normalizePhoneDigits,
  normalizePlate,
  normalizeVin,
} from './normalization';

/**
 * The longest fragment accepted at the edge. A longer input is a payload, not a
 * query. Matches `MAX_WORK_ORDER_SEARCH_FRAGMENT` and the CRM search bound.
 */
export const MAX_SEARCH_FRAGMENT = 80;

/**
 * The shortest fragment accepted. One character matches nearly every row, so the
 * page it returns says nothing; it is refused at the edge rather than answered
 * badly. Matches `MIN_SEARCH_FRAGMENT` in the CRM customer search.
 */
export const MIN_SEARCH_FRAGMENT = 2;

/**
 * The shortest phone tail that may be matched as a SUFFIX.
 *
 * Below this a tail is not a lookup: four digits are shared by thousands of
 * numbers, so a shorter fragment would turn the box into an enumeration tool.
 * Seven is also the width of `ix_contact_points_phone_tail`'s key, so the two
 * move together — the same constant, for the same reason, as `MIN_PHONE_SUFFIX`
 * in the CRM customer search.
 */
export const MIN_PHONE_SUFFIX = 7;

/** A free-text box reduced to the forms the five arms compare against. */
export interface EntitySearchTerms {
  /** Whether a box was supplied at all. When false every arm is off. */
  readonly present: boolean;
  /** Folded, LIKE-escaped — compared against `crm.normalize_name(display_name)`. */
  readonly nameFragment: string;
  /** ASCII digits only — compared against the stored `normalized_value`. */
  readonly phoneDigits: string;
  /** Whether `phoneDigits` is long enough to be matched as a suffix. */
  readonly phoneSuffixEligible: boolean;
  /** The plate rule — compared against `veh.plate_history.plate_normalized`. */
  readonly plateFragment: string;
  /** The VIN rule — compared against `veh.vehicles.vin_normalized`. */
  readonly vinFragment: string;
  /** Digits folded and LIKE-escaped — compared against a business reference number. */
  readonly referenceFragment: string;
}

/** The terms of a request that carried no box. Every arm is off. */
export const NO_SEARCH_TERMS: EntitySearchTerms = Object.freeze({
  present: false,
  nameFragment: '',
  phoneDigits: '',
  phoneSuffixEligible: false,
  plateFragment: '',
  vinFragment: '',
  referenceFragment: '',
});

/**
 * Escapes the LIKE metacharacters so a caller can never inject a wildcard: a
 * `%`, `_` or `\` becomes a literal (matched with `ESCAPE '\'` in the
 * repository), and the `%` the repository appends is the ONLY wildcard.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Reduces one box to every form the arms need.
 *
 * `undefined` is NOT the same as an empty box: a request that sent no `q` has no
 * search predicate at all, and `present: false` is what tells the repository to
 * leave the whole disjunction out rather than to run it with nothing in it.
 */
export function toEntitySearchTerms(q: string | undefined): EntitySearchTerms {
  if (q === undefined) return NO_SEARCH_TERMS;
  // The leading `+` of an E.164 value is dropped, because a caller quoting a
  // number rarely types it and a stored `+` is matched by the suffix arm anyway.
  const phoneDigits = (normalizePhoneDigits(q) ?? '').replace(/^\+/, '');
  return {
    present: true,
    nameFragment: escapeLike(foldSearchText(q) ?? ''),
    phoneDigits,
    phoneSuffixEligible: phoneDigits.length >= MIN_PHONE_SUFFIX,
    plateFragment: normalizePlate(q) ?? '',
    vinFragment: normalizeVin(q) ?? '',
    referenceFragment: escapeLike(foldDigits(q.trim())),
  };
}
