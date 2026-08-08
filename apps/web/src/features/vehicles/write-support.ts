import type { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';

/**
 * The shape shared by the vehicle write actions.
 *
 * Deliberately a copy of the CRM feature's `action-support.ts` rather than an
 * import of it: a feature may never import another feature
 * (`lib/api/read-operation.ts:12-18`), and the three options recorded there are
 * import across features, copy, or move somewhere neutral. `RecordForm` took the
 * third route because it is a component with real behaviour worth having exactly
 * once. This is forty lines of request plumbing whose only shared property is an
 * ordering rule, and hoisting it would create a `lib/` module that both features
 * must then agree on forever. Copied, with the reasoning stated, is the smaller
 * commitment.
 *
 * Not a `'use server'` module: a Server Action file may export only async
 * functions, and three of these four are not.
 *
 * ## The order is the contract
 *
 * Validate, then check the session, then send, then map the failure. An action
 * that sent before validating would spend a rate-limit slot on a request the
 * operator could have been told about instantly.
 *
 * ## No action sets `Idempotency-Key`
 *
 * The key comes from the contract-derived authority in the client. Adding one
 * here would put a second idempotency authority in the codebase, which is the
 * shape of the defect rather than the fix (`P1-27-INT-003`).
 */

/** `undefined` for an empty optional field, so it is omitted, not sent blank. */
export function optionalField(form: FormData, key: string): string | undefined {
  const value = String(form.get(key) ?? '').trim();
  return value.length > 0 ? value : undefined;
}

export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path[0];
    if (typeof path === 'string' && !errors[path]) errors[path] = issue.message;
  }
  return errors;
}

/** The vehicle id, encoded, so it can never walk to another operation. */
export function vehicleBase(vehicleId: string): string {
  return `/api/v1/vehicles/${encodeURIComponent(vehicleId)}`;
}

export async function writeVehicle<T>(
  previous: ActionState,
  parse: () => { ok: true; body: unknown } | { ok: false; errors: Record<string, string> },
  path: string,
  successKey: string
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const parsed = parse();
  if (!parsed.ok) return invalid(parsed.errors, attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<T>('POST', path, parsed.body);
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    messageKey: successKey,
    correlationId: result.correlationId,
    attempt,
  };
}
