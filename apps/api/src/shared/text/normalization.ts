/**
 * Deterministic text folding — the TypeScript mirror of the SQL folding rules.
 *
 * Every function here reproduces a frozen database function character for
 * character:
 *
 *   `foldDigits`          ↔ `shared.fold_digits(text)`
 *   `foldSearchText`      ↔ `shared.fold_search_text(text)`
 *   `normalizePhoneDigits`↔ `crm.normalize_phone(text)`
 *   `normalizeVin`        ↔ `veh.normalize_vin(text)`
 *   `normalizePlate`      ↔ `veh.normalize_plate(text)`
 *
 * They exist so a request can be validated and a lookup fragment prepared
 * without a database round trip. That is only safe while the two agree exactly,
 * so a database-tier suite runs the same fixture corpus through both and
 * compares every pair; a mirror that disagrees is worse than no mirror, because
 * it produces a key that finds nothing while looking correct.
 *
 * ## This file exists twice, byte for byte
 *
 * `apps/web` may never import `apps/api`, and the browser needs the same folding
 * to prepare a query fragment before it is sent. So the same source lives at
 * `apps/api/src/shared/text/normalization.ts` and
 * `apps/web/src/lib/text/normalization.ts`, and a repository-tier test compares
 * the two files as text and fails on any difference. Edit one, copy it to the
 * other, in the same commit. The file is deliberately self-contained — no
 * imports — so that the copy can be exact.
 *
 * ## Why the character classes are spelled out
 *
 * PostgreSQL's `\s` is the POSIX space class; JavaScript's `\s` additionally
 * matches the Unicode space separators. The ASCII members of the POSIX set are
 * therefore written out literally below, and PostgreSQL's space-only `btrim` is
 * mirrored rather than approximated with `String.prototype.trim`. The parity
 * corpus proves agreement for ASCII whitespace; for the non-ASCII separators the
 * database's answer depends on the server locale, so no agreement is claimed for
 * them.
 *
 * ## What is NOT done here
 *
 * No homoglyph or confusable detection: Cyrillic `а` and Latin `a` stay
 * different, and none is claimed. No letter folding is applied to an identifier
 * — see `normalizeVin` and `normalizePlate`, which fold digits only.
 */

/** The POSIX `[[:space:]]` set, spelled out so it cannot drift from the SQL side. */
const POSIX_SPACE = /[ \t\n\r\f\v]+/g;

/** The separators `veh.normalize_plate` strips: POSIX space plus `.`, `_` and `-`. */
const PLATE_SEPARATORS = /[ \t\n\r\f\v._-]/g;

/** Tatweel (U+0640) and the tashkeel range (U+064B–U+0652). */
const ARABIC_MARKS = /[\u0640\u064B-\u0652]/g;

/** The three hamza-seated alef forms that collapse onto bare alef (U+0627). */
const ALEF_FORMS = /[\u0623\u0625\u0622]/g;

/**
 * Arabic-Indic (U+0660–U+0669) and Eastern Arabic-Indic (U+06F0–U+06F9) digits.
 * A single pass, because both blocks are contiguous and ten apart from their
 * ASCII counterparts by a fixed offset.
 */
const FOLDABLE_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/** Leading and trailing ASCII spaces \u2014 what PostgreSQL's one-argument `btrim` removes. */
const EDGE_SPACES = /^ +| +$/g;

/**
 * Mirrors PostgreSQL's one-argument `btrim(text)`, which removes SPACES only.
 *
 * `String.prototype.trim` also removes tabs, newlines and the Unicode space
 * separators, so using it here would make the mirror disagree with the database
 * on an input as ordinary as a pasted value with a leading tab \u2014 the `+` of a
 * phone number would be recognised on one side and not the other.
 */
function btrim(value: string): string {
  return value.replace(EDGE_SPACES, '');
}

/**
 * Folds Arabic-Indic and Eastern Arabic-Indic digits to ASCII `0`–`9`.
 *
 * Nothing else is touched and the length is preserved, exactly as the SQL
 * `translate()` guarantees. A person typing a phone number, a plate or a VIN on
 * an Arabic keyboard produces these code points, and every normalizer in this
 * repository used to DELETE them as if they were punctuation — so the same
 * number entered in two keyboards produced two different lookup keys.
 */
export function foldDigits(value: string): string {
  return value.replace(FOLDABLE_DIGITS, (character) => {
    const code = character.codePointAt(0) ?? 0;
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String.fromCharCode(0x30 + (code - base));
  });
}

/**
 * The NAME rule: strip tatweel and tashkeel, collapse the alef forms, fold
 * digits, lowercase, collapse whitespace, trim. Blank becomes `null`.
 *
 * The step order is fixed and matches `shared.fold_search_text` exactly, because
 * both sides of every comparison must see the same pipeline.
 *
 * Applied to NAMES only. Collapsing two letters into one is right for a name,
 * where two spellings are one name, and wrong for an identifier, where it would
 * merge two different records. Taa marbuta is deliberately not collapsed onto
 * haa: those are distinct letters.
 */
export function foldSearchText(value: string | null | undefined): string | null {
  const stripped = (value ?? '').replace(ARABIC_MARKS, '');
  const folded = foldDigits(stripped).replace(ALEF_FORMS, '\u0627');
  const collapsed = btrim(folded.toLowerCase().replace(POSIX_SPACE, ' '));
  return collapsed === '' ? null : collapsed;
}

/**
 * Mirrors `crm.normalize_phone(text)`: an optional single leading `+` followed
 * by the ASCII digits, with Arabic-Indic digits folded in BEFORE the non-digit
 * strip.
 *
 * Two frozen behaviours are reproduced deliberately, because stored values and
 * the lookup keys built from them depend on them:
 *
 *  - a lone `'+'` normalizes to `'+'`, not `null`;
 *  - the `+` test reads the TRIMMED input while the digits are taken from the
 *    UNTRIMMED input, exactly as the SQL does.
 */
export function normalizePhoneDigits(value: string | null | undefined): string | null {
  const raw = value ?? '';
  const plus = btrim(raw).startsWith('+') ? '+' : '';
  const digits = foldDigits(raw).replace(/[^0-9]/g, '');
  const joined = `${plus}${digits}`;
  return joined === '' ? null : joined;
}

/**
 * Mirrors `veh.normalize_vin(text)`: fold digits, trim, uppercase, keep only
 * `[A-Z0-9]`.
 *
 * `I`, `O` and `Q` are PRESERVED and no length or check-digit rule is applied —
 * the frozen function repairs nothing, and neither does this. Plausibility is
 * reported elsewhere, alongside the value, never applied to it.
 */
export function normalizeVin(value: string | null | undefined): string | null {
  const stripped = btrim(foldDigits(value ?? ''))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return stripped === '' ? null : stripped;
}

/**
 * Mirrors `veh.normalize_plate(text)`: fold digits, trim, strip whitespace and
 * the `.`/`_`/`-` separators, uppercase.
 *
 * Every other character survives, including non-Latin ones: a jurisdiction plate
 * may be written in Arabic letters, and there is no format engine here.
 */
export function normalizePlate(value: string | null | undefined): string | null {
  const stripped = btrim(foldDigits(value ?? ''))
    .replace(PLATE_SEPARATORS, '')
    .toUpperCase();
  return stripped === '' ? null : stripped;
}
