/**
 * Deterministic normalization primitives (P1-15).
 *
 * Every function here is a **mirror of a frozen database function**, not a new
 * opinion about how a value should look. The database already normalizes VIN,
 * phone, and email, and several tables carry generated columns derived from those
 * functions — so a TypeScript implementation that "improves" on them would
 * silently disagree with stored data and with the lookup keys built from it.
 *
 * The rule this file follows, in both directions:
 *
 *  - **normalize exactly like SQL.** `normalizeVin`, `normalizePhoneDigits` and
 *    `normalizeEmail` reproduce `veh.normalize_vin`, `crm.normalize_phone` and
 *    `crm.normalize_email` character for character, including the edge cases that
 *    look like bugs (a lone `'+'` survives; Arabic-Indic digits normalize away to
 *    `null`). `tests/db/p1-15-normalization-parity.test.ts` proves the mirrors
 *    agree with the live functions over a shared corpus — a database suite, not
 *    a unit one, because the only honest way to prove parity is to run both
 *    implementations over the same corpus and compare.
 *  - **never silently repair.** Validation is reported *alongside* the normalized
 *    value, never applied to it. A VIN containing `I`, `O` or `Q` normalizes
 *    unchanged and is reported as implausible; the caller decides. Silent repair
 *    is how a typo becomes a different vehicle.
 *
 * Search normalization is the one genuinely new primitive. It is bounded,
 * locale-neutral, and produces a value for *matching* only — the display value is
 * always preserved separately by the caller.
 */

/** Longest input any normalizer will consider. Longer input is rejected, never truncated. */
export const MAX_NORMALIZATION_INPUT = 512;

/** Longest normalized search value, matching `ck_search_metadata_value` (2048). */
export const MAX_SEARCH_VALUE = 2048;

/** A normalized value plus everything the caller needs to judge it. */
export interface NormalizationResult {
  /** The original input, unchanged. Callers persist this as the display value. */
  readonly original: string;
  /** The normalized form, or `null` when normalization yields nothing. */
  readonly normalized: string | null;
  /**
   * Whether the normalized value is plausible for its kind. `false` never changes
   * `normalized` — it is advice, not a mutation.
   */
  readonly plausible: boolean;
  /** Stable machine-readable reasons the value is implausible. Empty when plausible. */
  readonly reasons: readonly string[];
}

function tooLong(value: string): boolean {
  return value.length > MAX_NORMALIZATION_INPUT;
}

/**
 * Mirrors `veh.normalize_vin(text)`:
 *
 * ```sql
 * NULLIF(regexp_replace(upper(btrim(COALESCE(p_value,''))), '[^A-Z0-9]', '', 'g'), '')
 * ```
 *
 * `I`, `O` and `Q` are **preserved**. The frozen function performs no length
 * check, no character rejection, and no check-digit validation, so neither does
 * this. Plausibility is reported separately.
 */
export function normalizeVin(input: string | null | undefined): NormalizationResult {
  const original = input ?? '';
  if (tooLong(original)) {
    return { original, normalized: null, plausible: false, reasons: ['input-too-long'] };
  }
  const stripped = original
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const normalized = stripped === '' ? null : stripped;

  const reasons: string[] = [];
  if (normalized === null) {
    reasons.push('empty');
  } else {
    // ISO 3779 describes a 17-character VIN that excludes I, O and Q. The frozen
    // function does not enforce either rule, so both are reported, never applied.
    if (normalized.length !== 17) reasons.push('length-not-17');
    if (/[IOQ]/.test(normalized)) reasons.push('contains-i-o-q');
  }
  return { original, normalized, plausible: reasons.length === 0, reasons };
}

/**
 * Mirrors `crm.normalize_phone(text)`:
 *
 * ```sql
 * NULLIF((CASE WHEN btrim(coalesce(p,'')) LIKE '+%' THEN '+' ELSE '' END)
 *        || regexp_replace(coalesce(p,''), '[^0-9]', '', 'g'), '')
 * ```
 *
 * Two frozen behaviours are reproduced deliberately, because the database and the
 * generated lookup keys depend on them:
 *
 *  - a lone `'+'` normalizes to `'+'`, **not** `null`;
 *  - only ASCII `[0-9]` counts as a digit, so Arabic-Indic numerals are stripped
 *    entirely and a wholly Arabic-Indic number normalizes to `null`.
 *
 * The `+` test reads the *trimmed* input while digits are taken from the
 * *untrimmed* input, exactly as the SQL does.
 */
export function normalizePhoneDigits(input: string | null | undefined): string | null {
  const raw = input ?? '';
  const plus = raw.trim().startsWith('+') ? '+' : '';
  const digits = raw.replace(/[^0-9]/g, '');
  const joined = `${plus}${digits}`;
  return joined === '' ? null : joined;
}

/** Mirrors `crm.normalize_email(text)` — trim + lowercase only. Dots and `+tags` survive. */
export function normalizeEmail(input: string | null | undefined): string | null {
  const lowered = (input ?? '').trim().toLowerCase();
  return lowered === '' ? null : lowered;
}

/**
 * Phone normalization with an explicit region contract.
 *
 * The frozen normalizer has no concept of a country, and **no default country is
 * assumed anywhere in this phase** — the country/jurisdiction decision is open
 * (P1-OD-027 and the open commercial decisions in ADR-003/ADR-012). So a national
 * number with no region is reported implausible rather than guessed at: guessing
 * would merge two different people's numbers under one lookup key.
 *
 * An E.164 value (leading `+`) is self-describing and needs no region.
 */
export function normalizePhone(
  input: string | null | undefined,
  options: { readonly regionCallingCode?: string | null } = {}
): NormalizationResult {
  const original = input ?? '';
  if (tooLong(original)) {
    return { original, normalized: null, plausible: false, reasons: ['input-too-long'] };
  }
  if (/[A-Za-z]/.test(original)) {
    return { original, normalized: null, plausible: false, reasons: ['contains-letters'] };
  }

  const normalized = normalizePhoneDigits(original);
  const reasons: string[] = [];

  if (normalized === null) {
    reasons.push('empty');
  } else if (normalized === '+') {
    // The frozen function really does return '+' here. It is preserved so the
    // mirror stays faithful, and reported as implausible so no caller stores it.
    reasons.push('no-digits');
  } else if (normalized.startsWith('+')) {
    const digits = normalized.slice(1);
    if (digits.length < 8 || digits.length > 15) reasons.push('e164-length-out-of-range');
  } else {
    const code = options.regionCallingCode?.trim() ?? '';
    if (code === '') {
      // National format with no region: ambiguous by construction.
      reasons.push('ambiguous-without-region');
    } else if (!/^\+?[0-9]{1,4}$/.test(code)) {
      reasons.push('invalid-region-calling-code');
    } else if (normalized.length < 4) {
      reasons.push('too-few-digits');
    }
  }

  return { original, normalized, plausible: reasons.length === 0, reasons };
}

/**
 * Deterministic search normalization.
 *
 * Unlike VIN/phone/email this has no frozen SQL counterpart, so it is defined
 * here and used consistently on both the indexing and the querying side — a
 * normalizer applied to only one of the two silently stops matching.
 *
 * The steps, in order, and why each is safe:
 *
 *  1. **NFKC** — canonical + compatibility composition, so `ﬁ` and `fi`, and the
 *     Arabic presentation forms, converge on one representation.
 *  2. **strip combining marks** — Arabic diacritics (harakat) and Latin accents
 *     are removed so `مُحَمَّد` and `محمد` match. This is why the display value is
 *     kept separately: the normalized form is deliberately lossy.
 *  3. **remove control characters** — including bidirectional overrides, which are
 *     invisible and would otherwise let two visually identical values differ.
 *  4. **lowercase** — locale-neutral (`toLowerCase`, never `toLocaleLowerCase`),
 *     so behaviour cannot change with the server's locale.
 *  5. **collapse whitespace** — every run of whitespace becomes one space, and the
 *     result is trimmed.
 *
 * There is no regular expression here that can backtrack catastrophically: every
 * pattern is a bounded character class over an input already length-checked.
 *
 * **Honest limitation:** this does not detect homoglyphs. `а` (Cyrillic) and `a`
 * (Latin) remain different, and mixed-script confusables are not collapsed. No
 * confusable detection is implemented and none is claimed.
 */
export function normalizeSearchValue(input: string | null | undefined): string | null {
  const raw = input ?? '';
  if (raw.length > MAX_SEARCH_VALUE) return null;

  const normalized = raw
    .normalize('NFKC')
    .replace(/\p{M}/gu, '')
    // Strips C0/C1 controls, zero-width and bidirectional overrides. Escaped rather
    // than written literally so the source itself stays free of invisible bytes.
    .replace(
      /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/gu,
      ''
    )
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  return normalized === '' ? null : normalized;
}

/**
 * Splits a normalized search value into tokens.
 *
 * Tokens are whitespace-delimited only. Punctuation is retained inside a token so
 * identifiers such as `wp0zzz98s1k303` or `inv-2026-000042` survive intact; a
 * caller that wants punctuation gone normalizes it away before calling.
 */
export function searchTokens(input: string | null | undefined): readonly string[] {
  const normalized = normalizeSearchValue(input);
  return normalized === null ? [] : normalized.split(' ').filter((t) => t.length > 0);
}
