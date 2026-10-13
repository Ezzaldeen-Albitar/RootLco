/**
 * The shared fixture table for text folding (P1-32).
 *
 * ONE table, read by two tiers:
 *
 *  - `tests/foundation/text-normalization.test.ts` runs every row through the
 *    TypeScript mirrors in `@api/shared/text/normalization` and compares each
 *    against the expected value written here;
 *  - `tests/db/p1-32-text-folding-parity.test.ts` runs the SAME rows through the
 *    SQL functions and compares each against the same expected value AND against
 *    the TypeScript result.
 *
 * The expected values are written by hand rather than captured from either
 * implementation. Captured values would make both tiers agree with whatever the
 * code already does, which proves consistency and nothing else; a hand-written
 * oracle is what lets a test say the code is WRONG.
 *
 * Arabic input is written with `\u` escapes on purpose. Tashkeel and tatweel are
 * combining or near-invisible marks, and a fixture whose meaning depends on a
 * character a reviewer cannot see is not a fixture anyone can review.
 */
export interface TextFoldingCase {
  /** What the row exercises, in words. */
  readonly label: string;
  readonly input: string;
  /** `foldDigits` / `shared.fold_digits`. */
  readonly foldDigits: string;
  /** `foldSearchText` / `shared.fold_search_text` (and therefore `crm.normalize_name`). */
  readonly foldSearchText: string | null;
  /** `normalizePhoneDigits` / `crm.normalize_phone`. */
  readonly phone: string | null;
  /** `normalizeVin` / `veh.normalize_vin`. */
  readonly vin: string | null;
  /** `normalizePlate` / `veh.normalize_plate`. */
  readonly plate: string | null;
}

export const TEXT_FOLDING_CASES: readonly TextFoldingCase[] = [
  {
    label: 'empty input',
    input: '',
    foldDigits: '',
    foldSearchText: null,
    phone: null,
    vin: null,
    plate: null,
  },
  {
    label: 'spaces only',
    input: '   ',
    foldDigits: '   ',
    foldSearchText: null,
    phone: null,
    vin: null,
    plate: null,
  },
  {
    label: 'every Arabic-Indic digit',
    input: '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669',
    foldDigits: '0123456789',
    foldSearchText: '0123456789',
    phone: '0123456789',
    vin: '0123456789',
    plate: '0123456789',
  },
  {
    label: 'every Eastern Arabic-Indic digit',
    input: '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9',
    foldDigits: '0123456789',
    foldSearchText: '0123456789',
    phone: '0123456789',
    vin: '0123456789',
    plate: '0123456789',
  },
  {
    label: 'an international number typed in Arabic-Indic digits',
    input: '+\u0669\u0666\u0662 \u0667\u0669 \u0660\u0661\u0662 \u0663\u0664\u0665\u0666',
    foldDigits: '+962 79 012 3456',
    foldSearchText: '+962 79 012 3456',
    phone: '+962790123456',
    vin: '962790123456',
    plate: '+962790123456',
  },
  {
    label: 'a national number with punctuation',
    input: '(079) 012-3456',
    foldDigits: '(079) 012-3456',
    foldSearchText: '(079) 012-3456',
    phone: '0790123456',
    vin: '0790123456',
    plate: '(079)0123456',
  },
  {
    label: 'a name carrying damma, shadda and fatha',
    input: '\u0645\u064F\u062D\u064E\u0645\u0651\u064E\u062F',
    foldDigits: '\u0645\u064F\u062D\u064E\u0645\u0651\u064E\u062F',
    foldSearchText: '\u0645\u062D\u0645\u062F',
    phone: null,
    vin: null,
    // A plate is an identifier: marks are NOT stripped from it.
    plate: '\u0645\u064F\u062D\u064E\u0645\u0651\u064E\u062F',
  },
  {
    label: 'alef with hamza above collapses onto bare alef in a name only',
    input: '\u0623\u062D\u0645\u062F',
    foldDigits: '\u0623\u062D\u0645\u062F',
    foldSearchText: '\u0627\u062D\u0645\u062F',
    phone: null,
    vin: null,
    plate: '\u0623\u062D\u0645\u062F',
  },
  {
    label: 'alef with hamza below collapses onto bare alef in a name only',
    input: '\u0625\u0628\u0631\u0627\u0647\u064A\u0645',
    foldDigits: '\u0625\u0628\u0631\u0627\u0647\u064A\u0645',
    foldSearchText: '\u0627\u0628\u0631\u0627\u0647\u064A\u0645',
    phone: null,
    vin: null,
    plate: '\u0625\u0628\u0631\u0627\u0647\u064A\u0645',
  },
  {
    label: 'alef with madda collapses, and taa marbuta is NOT turned into haa',
    input: '\u0622\u0645\u0646\u0629',
    foldDigits: '\u0622\u0645\u0646\u0629',
    foldSearchText: '\u0627\u0645\u0646\u0629',
    phone: null,
    vin: null,
    plate: '\u0622\u0645\u0646\u0629',
  },
  {
    label: 'tatweel is removed from a name',
    input: '\u0639\u0640\u0640\u0640\u0644\u064A',
    foldDigits: '\u0639\u0640\u0640\u0640\u0644\u064A',
    foldSearchText: '\u0639\u0644\u064A',
    phone: null,
    vin: null,
    plate: '\u0639\u0640\u0640\u0640\u0644\u064A',
  },
  {
    label: 'a Latin name with extra spaces and mixed case',
    input: '  Ali   AL-Bitar  ',
    foldDigits: '  Ali   AL-Bitar  ',
    foldSearchText: 'ali al-bitar',
    phone: null,
    vin: 'ALIALBITAR',
    plate: 'ALIALBITAR',
  },
  {
    label: 'a VIN with separators',
    input: 'wp0-zzz9/8s1k303',
    foldDigits: 'wp0-zzz9/8s1k303',
    foldSearchText: 'wp0-zzz9/8s1k303',
    phone: '0981303',
    vin: 'WP0ZZZ98S1K303',
    // The plate rule strips only whitespace, '.', '_' and '-' — a '/' survives.
    plate: 'WP0ZZZ9/8S1K303',
  },
  {
    label: 'a VIN typed with Arabic-Indic digits keeps its digits',
    input: 'wp\u0660zzz\u0669\u0668s\u0661k\u0663\u0660\u0663',
    foldDigits: 'wp0zzz98s1k303',
    foldSearchText: 'wp0zzz98s1k303',
    phone: '0981303',
    vin: 'WP0ZZZ98S1K303',
    plate: 'WP0ZZZ98S1K303',
  },
  {
    label: 'a plate with Arabic letters and Arabic-Indic digits',
    input: '\u0661\u0662\u0663 \u0623 \u0628 \u062C',
    foldDigits: '123 \u0623 \u0628 \u062C',
    foldSearchText: '123 \u0627 \u0628 \u062C',
    phone: '123',
    vin: '123',
    // Letters survive the plate rule untouched; only the digits and spaces change.
    plate: '123\u0623\u0628\u062C',
  },
  {
    label: 'a plate with Latin separators',
    input: 'AB.12_34-CD',
    foldDigits: 'AB.12_34-CD',
    foldSearchText: 'ab.12_34-cd',
    phone: '1234',
    vin: 'AB1234CD',
    plate: 'AB1234CD',
  },
  {
    label: 'a lone plus survives phone normalization',
    input: '+',
    foldDigits: '+',
    foldSearchText: '+',
    phone: '+',
    vin: null,
    plate: '+',
  },
  {
    label: 'tab and newline are whitespace',
    input: 'tab\tseparated\nline',
    foldDigits: 'tab\tseparated\nline',
    foldSearchText: 'tab separated line',
    phone: null,
    vin: 'TABSEPARATEDLINE',
    plate: 'TABSEPARATEDLINE',
  },
  {
    // PostgreSQL's one-argument btrim removes SPACES only, so a leading tab hides
    // the plus from the phone rule. The mirror must reproduce that, not repair it.
    label: 'a leading tab before a plus',
    input: '\t+962',
    foldDigits: '\t+962',
    foldSearchText: '+962',
    phone: '962',
    vin: '962',
    plate: '+962',
  },
  {
    label: 'mixed scripts with Arabic-Indic digits',
    input: 'Layla \u0644\u064A\u0644\u0649 \u0664\u0662',
    foldDigits: 'Layla \u0644\u064A\u0644\u0649 42',
    foldSearchText: 'layla \u0644\u064A\u0644\u0649 42',
    phone: '42',
    vin: 'LAYLA42',
    plate: 'LAYLA\u0644\u064A\u0644\u064942',
  },
];
