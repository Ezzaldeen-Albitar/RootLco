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
  /**
   * The plate rule, LIKE-escaped — compared against
   * `veh.plate_history.plate_normalized`.
   *
   * ESCAPED, and that is not decoration. `normalizePlate` folds digits, strips
   * the separators and uppercases, and deliberately KEEPS every other character
   * so a jurisdiction plate written in Arabic letters survives — which means it
   * also keeps `%` and `_`. Unescaped, a box of `%%` would reduce to `%%` and the
   * arm would become `LIKE '%%%%'`: every row in the branch, returned by the one
   * arm whose whole design is that an empty fragment disables it.
   */
  readonly plateFragment: string;
  /**
   * The VIN rule, LIKE-escaped — compared against `veh.vehicles.vin_normalized`.
   *
   * `normalizeVin` strips everything outside `[A-Z0-9]`, so no metacharacter can
   * survive it and the escape is inert today. It is applied anyway: the five arms
   * are read together, and one that is safe only because of a rule written in
   * another file is a defect waiting for that rule to be relaxed.
   */
  readonly vinFragment: string;
  /** Digits folded and LIKE-escaped — compared against a business reference number. */
  readonly referenceFragment: string;
}

/**
 * The permission a caller needs before the box may match CUSTOMER data.
 *
 * The name and phone arms read `crm.business_partners` and `crm.contact_points`.
 * An operation declaring only `rec.reception.read` must not become a way of
 * probing the customer register, so those two arms are switched off for a caller
 * who does not work with customers at all. The other three arms — plate, VIN and
 * the paperwork number — are about the vehicle and the job, which the caller is
 * already reading.
 */
export const CUSTOMER_SEARCH_PERMISSION = 'crm.customer.read';

/**
 * Switches off the two arms that read customer data.
 *
 * The bound this leaves is worth stating plainly, because it is what makes the
 * arms safe rather than merely narrow even for a caller who DOES hold the code:
 * the phone arm matches an exact stored value or a suffix of at least
 * `MIN_PHONE_SUFFIX` digits and never a shorter tail, so it is a lookup and not
 * an enumeration; and NEITHER arm ever puts customer data in the response — the
 * page carries the reception, appointment, delivery or warranty row, and no name,
 * number or contact point crosses the wire from these lists at all. The arms
 * answer "is this row connected to the person I typed", never "who is this".
 */
export function withoutCustomerArms(terms: EntitySearchTerms): EntitySearchTerms {
  if (!terms.present) return terms;
  return { ...terms, nameFragment: '', phoneDigits: '', phoneSuffixEligible: false };
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
    plateFragment: escapeLike(normalizePlate(q) ?? ''),
    vinFragment: escapeLike(normalizeVin(q) ?? ''),
    referenceFragment: escapeLike(foldDigits(q.trim())),
  };
}
