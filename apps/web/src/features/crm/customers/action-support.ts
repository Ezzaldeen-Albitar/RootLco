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

/*
 * `fieldErrorsFrom` now lives in `lib/forms/field-errors.ts` and is re-exported
 * here so the eight customer write actions keep importing one module.
 *
 * It moved because the same three lines were copied into SEVEN adapters across
 * authentication, CRM identity and five vehicle modules, every one of them
 * storing Zod's own English sentence. A feature may not import another feature,
 * so fixing them where they sat would have produced seven copies of the fix.
 */
export { fieldErrorsFrom } from '@/lib/forms/field-errors';

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
