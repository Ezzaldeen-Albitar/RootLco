import type { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';

/**
 * The shape shared by every customer write action, extracted so there is one copy.
 *
 * It began inside `governance-actions.ts`, whose six writes (`FE-009`…`FE-014`)
 * were the only consumers. `FE-007` (contacts) and `FE-008` (addresses) then
 * turned out to have no write path at all, and they belong to the profile rather
 * than to governance — so they live in `profile-actions.ts` and share this.
 *
 * Deliberately NOT a `'use server'` module: a Server Action file may export only
 * async functions, and three of the four helpers here are not.
 *
 * ## The order is the contract
 *
 * Validate, then check the session, then send, then map the failure. An action
 * that sent before validating would spend a rate-limit slot on a request the
 * operator could have been told about instantly.
 *
 * ## No action sets `Idempotency-Key`
 *
 * The key comes from the contract-derived authority in `operation-contract.ts`.
 * Reaching into the client to add one here would put a second idempotency
 * authority in the codebase, which is the shape of the defect rather than the fix
 * (`P1-27-INT-003`).
 *
 * ## No action re-checks a permission
 *
 * The Backend decides. A client-side pre-check would return a *different* answer
 * from the server's in exactly the cases where the difference matters. Screens
 * hide controls the caller is known to lack as a courtesy; that is presentation,
 * and nothing here relies on it.
 */

/** `undefined` for an empty optional field, so it is omitted, not sent blank. */
export function optional(form: FormData, key: string): string | undefined {
  const value = String(form.get(key) ?? '').trim();
  return value.length > 0 ? value : undefined;
}

/**
 * A catalogue key for an issue whose schema supplied no message (`P1-27-FE-004`).
 *
 * Zod's default message is an English sentence. `translateDynamic` returns a
 * non-key unchanged, so any such message is rendered verbatim — English library
 * prose under an Arabic label, for an Arabic operator.
 *
 * This was reported as one field (`preferredLocale`, `.min(2)`, reachable by
 * typing a single character), and the defect is the class rather than the field:
 * across the customer and vehicle write schemas most bounds carry no key, and
 * whether any given one is reachable depends on whether some form three files
 * away happens to set a matching `maxLength`. Keys are being added at the
 * schemas as well, but a fallback here is what makes "untranslated text cannot
 * reach an operator" true of schemas nobody has revisited yet.
 *
 * Mapped by issue CODE rather than to one generic apology, because "shorter than
 * the minimum" and "longer than the maximum" tell an operator different things
 * and the catalogue already distinguishes them.
 */
function keyForIssue(issue: z.core.$ZodIssue): string {
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
 * True when the schema supplied a translation key rather than leaving Zod's
 * default sentence in place.
 *
 * Structural, not a catalogue lookup: this module cannot import a locale without
 * choosing one, and the choice belongs to the request. Every key in this
 * codebase is dotted lower-camel segments with no whitespace, and every Zod
 * default is a sentence containing spaces — so the two are separable without
 * knowing the catalogue. `crm-customer-create.dom.test.tsx` closes the gap by
 * asserting that what survives resolves in BOTH catalogues.
 */
function isTranslationKey(message: string): boolean {
  return /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/.test(message);
}

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path[0];
    if (typeof path !== 'string' || errors[path]) continue;
    errors[path] = isTranslationKey(issue.message) ? issue.message : keyForIssue(issue);
  }
  return errors;
}

/** The customer id, encoded, so it can never walk to another operation. */
export function base(customerId: string): string {
  return `/api/v1/customers/${encodeURIComponent(customerId)}`;
}

export async function write<T>(
  previous: ActionState,
  parse: () => { ok: true; body: unknown } | { ok: false; errors: Record<string, string> },
  method: 'POST' | 'PUT',
  path: string,
  successKey: string
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const parsed = parse();
  if (!parsed.ok) return invalid(parsed.errors, attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<T>(method, path, parsed.body);
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    messageKey: successKey,
    correlationId: result.correlationId,
    attempt,
  };
}
