'use server';

import { z } from 'zod';
import type { ActionState } from '@/lib/forms/action-result';
import { base, fieldErrorsFrom, optional, write } from './action-support';
import {
  ADDRESS_TYPES,
  CONTACT_CHANNELS,
  MAX_ADDRESS_LINE,
  MAX_CONTACT_VALUE,
  MAX_LABEL,
} from './profile-contract';

/**
 * The two profile component writes: `FE-007` contacts and `FE-008` addresses.
 *
 * ## Why these arrived late
 *
 * Both read operations shipped with the phase and both write operations were
 * registered, permission-covered and reachable by no screen — so a customer's
 * contacts and addresses could be listed and never added. The phase's own
 * `evidence/task-traceability.md` recorded them as "Not called"; nothing was asked
 * to act on it, and no gate could see it, because a registered operation with no
 * call site is invisible to a check that asks only whether a route exists for a
 * registration and a registration for a route.
 *
 * Both were confirmed to be oversights rather than deliberate omissions: the
 * repository records its deliberate absences explicitly — `crm.customer-merge`
 * and `veh.vehicle-merge` are marked "Deliberately absent — P1-OD-017" in the same
 * table — and neither of these is among them.
 *
 * ## Every field is trimmed before it is measured
 *
 * The Backend carries `btrim(...) <> ''` CHECK constraints, so a value of spaces
 * is empty there however long it is here.
 */

const contactSchema = z
  .object({
    channel: z.enum(CONTACT_CHANNELS),
    value: z.string().trim().min(1, 'field.required').max(MAX_CONTACT_VALUE),
    label: z.string().trim().min(1).max(MAX_LABEL).optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

/** `FE-007` — add a contact channel. `crm.customer.profile.write`. */
export async function addContactAction(
  customerId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  return write(
    previous,
    () => {
      const parsed = contactSchema.safeParse({
        channel: String(form.get('channel') ?? ''),
        value: String(form.get('value') ?? ''),
        // Omitted when blank rather than sent as `null`. The route accepts either,
        // but an omitted optional lets the ROUTE's own default stand — sending a
        // value explicitly looks identical today and diverges the moment the
        // backend default changes.
        ...(optional(form, 'label') ? { label: optional(form, 'label') } : {}),
        // A checkbox is ABSENT from FormData when unchecked, so presence is the
        // signal. `"false"` would fail a strict boolean field as a 422.
        ...(form.get('isPrimary') === null ? {} : { isPrimary: true }),
      });
      return parsed.success
        ? { ok: true as const, body: parsed.data }
        : { ok: false as const, errors: fieldErrorsFrom(parsed.error) };
    },
    'POST',
    `${base(customerId)}/contacts`,
    'crm.customers.contacts.added'
  );
}

const addressSchema = z
  .object({
    addressType: z.enum(ADDRESS_TYPES),
    line1: z.string().trim().min(1, 'field.required').max(MAX_ADDRESS_LINE),
    line2: z.string().trim().min(1).max(MAX_ADDRESS_LINE).optional(),
    city: z.string().trim().min(1).max(MAX_ADDRESS_LINE).optional(),
    region: z.string().trim().min(1).max(MAX_ADDRESS_LINE).optional(),
    postalCode: z.string().trim().min(1).max(20).optional(),
    // Exactly two characters, matching the route. Uppercased ONLY when present —
    // `String(null).toUpperCase()` is the "NULL" that a naive normalisation
    // produces, and it would be stored as a country.
    countryCode: z
      .string()
      .trim()
      .length(2, 'crm.customers.addresses.error.country')
      .transform((value) => value.toUpperCase())
      .optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

/**
 * `FE-008` — add an address. `crm.customer.profile.write`.
 *
 * No country is defaulted. An address with no country recorded is a real state
 * the contract permits (`countryCode` is nullable), and guessing one from the
 * tenant's own country would silently attribute a foreign address to it.
 */
export async function addAddressAction(
  customerId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  return write(
    previous,
    () => {
      const optionalKeys = ['line2', 'city', 'region', 'postalCode', 'countryCode'] as const;
      const parsed = addressSchema.safeParse({
        addressType: String(form.get('addressType') ?? ''),
        line1: String(form.get('line1') ?? ''),
        ...Object.fromEntries(
          optionalKeys
            .map((key) => [key, optional(form, key)] as const)
            .filter(([, value]) => value !== undefined)
        ),
        ...(form.get('isPrimary') === null ? {} : { isPrimary: true }),
      });
      return parsed.success
        ? { ok: true as const, body: parsed.data }
        : { ok: false as const, errors: fieldErrorsFrom(parsed.error) };
    },
    'POST',
    `${base(customerId)}/addresses`,
    'crm.customers.addresses.added'
  );
}
