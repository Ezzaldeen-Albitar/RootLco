import type { z } from 'zod';

/**
 * One place that turns a Zod issue into something an operator can read
 * (`P1-27-FE-004`).
 *
 * ## Why this is not in a feature
 *
 * It began inside `features/crm/customers/action-support.ts`, where the customer
 * writes needed it. A sweep then found the same three-line loop — assigning a
 * Zod issue's own message straight into a field-error map — copied into SEVEN
 * adapters across authentication, CRM identity and five vehicle modules. Every
 * one of them stored Zod's default English sentence.
 *
 * (The offending expression is described rather than quoted here: this
 * repository's scanners match source text, and a literal in a comment has been
 * read as code seven times.)
 *
 * A feature may not import another feature, so fixing them one at a time would
 * have produced seven more copies of the fix and the same drift a phase later.
 * `lib/` is the neutral home both trees may reach.
 *
 * ## What the problem actually is
 *
 * `translateDynamic` returns a non-catalogue string unchanged, so any message
 * that is not a key is rendered verbatim — English library prose under an Arabic
 * label, for an Arabic operator. Whether a given bound is REACHABLE depends on
 * whether some form three files away sets a matching `maxLength`, a fact that
 * lives nowhere near the schema and can change without it. So the fallback is
 * unconditional rather than applied where a bound looks reachable: that
 * judgement was made once before, in a comment, and was wrong.
 */

/**
 * True when the schema supplied a translation key rather than leaving Zod's
 * default sentence in place.
 *
 * Structural, not a catalogue lookup: this module cannot import a locale without
 * choosing one, and the choice belongs to the request. Every key in this
 * codebase is dotted lower-camel segments with no whitespace, and every Zod
 * default is a sentence containing spaces — so the two are separable without
 * knowing the catalogue. The tests close the gap by asserting that what survives
 * resolves in BOTH catalogues.
 */
export function isTranslationKey(message: string): boolean {
  return /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/.test(message);
}

/**
 * A catalogue key for an issue whose schema supplied no message.
 *
 * Mapped by issue CODE rather than to one generic apology, because "shorter than
 * the minimum" and "longer than the maximum" tell an operator different things
 * and the catalogue already distinguishes them.
 */
export function keyForIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'too_small':
      return 'field.tooShort';
    case 'too_big':
      return 'field.tooLong';
    case 'invalid_type':
      return 'field.required';
    default:
      return 'field.invalid';
  }
}

/**
 * The first complaint per field, as a catalogue key.
 *
 * First rather than all: a field with two problems has one place to show them,
 * and the earliest issue is the one the operator can act on. `path[0]` because
 * every form here is flat — a nested path would need a different renderer, and
 * none exists.
 */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path[0];
    if (typeof path !== 'string' || errors[path]) continue;
    errors[path] = isTranslationKey(issue.message) ? issue.message : keyForIssue(issue);
  }
  return errors;
}
