'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';
import { fieldErrorsFrom } from './action-support';
import {
  CREATABLE_LIFECYCLE_STATUSES,
  MAX_COMPANY_NAME,
  MAX_PERSON_NAME,
  type CreatedCustomer,
} from './creation-contract';
import { MAX_PREFERRED_LOCALE, MIN_PREFERRED_LOCALE } from './governance-contract';

/**
 * Customer creation (`P1-27-FE-004`, `P1-27-FE-005`) and the duplicate warning
 * it produces (`P1-27-FE-003`).
 *
 * Both operations are `idempotent: true`, so both refuse a request with no
 * `Idempotency-Key`. The shared client now derives that from the published
 * contract rather than from the HTTP method (`P1-27-INT-003`) — before that fix
 * these two would have worked, being POSTs, while `PUT …/preferences` next door
 * would not. The rule is the contract's, not the method's.
 *
 * Neither action re-checks a permission before calling. The backend decides, its
 * denial is the only one that matters, and a client-side pre-check would produce
 * a *different* answer from the server's in exactly the cases where the
 * difference matters.
 */

/**
 * A creation outcome.
 *
 * `ActionState` plus the created customer, because the response carries two
 * things a form must show and a generic action state has nowhere to put: the id
 * to navigate to, and `possibleDuplicates`.
 *
 * The duplicates are **not** a failure. The customer was created; these are live
 * customers that already share the normalised name, and an operator needs to see
 * them precisely because the record now exists.
 */
export interface CreationState extends ActionState {
  readonly created?: CreatedCustomer;
}

const lifecycle = z.enum(CREATABLE_LIFECYCLE_STATUSES);

/*
 * Every bound carries a translation key (`P1-27-FE-004`).
 *
 * `preferredLocale` was `.min(2)` with no key, and `.min(2)` is the one bound an
 * operator can actually reach: the input's `maxLength` stops them exceeding the
 * ceiling, and nothing at all stops them typing a single character. So a locale
 * of one character produced Zod's own English sentence, which
 * `fieldErrorsFrom` stores verbatim and `translateDynamic` returns unchanged
 * because it is not a catalogue key — printing English library prose under an
 * Arabic label.
 *
 * The keys are supplied unconditionally rather than only where a bound looks
 * reachable. "This one cannot be hit" is a claim about a form that can change,
 * made in a file that would not change with it, and it was already wrong once.
 */
const individualSchema = z.object({
  givenName: z.string().trim().min(1, 'field.required').max(MAX_PERSON_NAME, 'field.tooLong'),
  familyName: z.string().trim().min(1, 'field.required').max(MAX_PERSON_NAME, 'field.tooLong'),
  preferredLocale: z
    .string()
    .trim()
    .min(MIN_PREFERRED_LOCALE, 'field.tooShort')
    .max(MAX_PREFERRED_LOCALE, 'field.tooLong')
    .nullable(),
  lifecycleStatus: lifecycle,
});

const companySchema = z.object({
  legalName: z.string().trim().min(1, 'field.required').max(MAX_COMPANY_NAME, 'field.tooLong'),
  tradeName: z
    .string()
    .trim()
    .min(1, 'field.required')
    .max(MAX_COMPANY_NAME, 'field.tooLong')
    .nullable(),
  lifecycleStatus: lifecycle,
});

/** `null` for an empty optional field, so it is omitted rather than sent blank. */
function optional(form: FormData, key: string): string | null {
  const value = String(form.get(key) ?? '').trim();
  return value.length > 0 ? value : null;
}

/*
 * `fieldErrorsFrom` comes from `action-support.ts`; this file used to carry its
 * own copy.
 *
 * The two copies were identical and then were not. The shared one gained the
 * fallback that turns an unkeyed Zod message into a catalogue key, and this one
 * did not — so the customer CREATE form was the one place that still rendered
 * English library prose to an Arabic operator (`P1-27-FE-004`), which is
 * precisely the drift the note in `governance-actions.ts` warned a second copy
 * would produce.
 */

export async function createIndividualAction(
  previous: CreationState,
  form: FormData
): Promise<CreationState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const parsed = individualSchema.safeParse({
    givenName: String(form.get('givenName') ?? ''),
    familyName: String(form.get('familyName') ?? ''),
    preferredLocale: optional(form, 'preferredLocale'),
    lifecycleStatus: String(form.get('lifecycleStatus') ?? 'prospect'),
  });
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<CreatedCustomer>('POST', '/api/v1/customers/individuals', {
    givenName: parsed.data.givenName,
    familyName: parsed.data.familyName,
    // Omitted rather than sent null: the route's schema accepts null, but an
    // absent optional and an explicit null are different requests and there is
    // no reason to make the backend decide which this meant.
    ...(parsed.data.preferredLocale ? { preferredLocale: parsed.data.preferredLocale } : {}),
    lifecycleStatus: parsed.data.lifecycleStatus,
  });

  if (!result.ok) return fromFailure(result, attempt);
  return {
    status: 'success',
    messageKey: 'crm.customers.create.created',
    correlationId: result.correlationId,
    attempt,
    created: result.data,
  };
}

export async function createCompanyAction(
  previous: CreationState,
  form: FormData
): Promise<CreationState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const parsed = companySchema.safeParse({
    legalName: String(form.get('legalName') ?? ''),
    tradeName: optional(form, 'tradeName'),
    lifecycleStatus: String(form.get('lifecycleStatus') ?? 'prospect'),
  });
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<CreatedCustomer>('POST', '/api/v1/customers/companies', {
    legalName: parsed.data.legalName,
    ...(parsed.data.tradeName ? { tradeName: parsed.data.tradeName } : {}),
    lifecycleStatus: parsed.data.lifecycleStatus,
  });

  if (!result.ok) return fromFailure(result, attempt);
  return {
    status: 'success',
    messageKey: 'crm.customers.create.created',
    correlationId: result.correlationId,
    attempt,
    created: result.data,
  };
}
