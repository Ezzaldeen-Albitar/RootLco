'use server';

import { z } from 'zod';
import type { ActionState } from '@/lib/forms/action-result';
// `write`, `base`, `optional` and `fieldErrorsFrom` moved to a plain module so
// `profile-actions.ts` (FE-007, FE-008) shares one copy. A `'use server'` file
// may export only async functions, which is why they cannot live here.
import { base, fieldErrorsFrom, optional, write } from './action-support';
import {
  ALERT_SEVERITIES,
  ALERT_TYPES,
  COMMUNICATION_PURPOSES,
  CONSENT_KINDS,
  MAX_ALERT_MESSAGE,
  MAX_APPROVAL_REF,
  MAX_CONSENT_SOURCE,
  MAX_NOTE_BODY,
  MAX_PREFERRED_LOCALE,
  MAX_REASON,
  MAX_SEGMENT_CODE,
  MAX_SEGMENT_NAME,
  MIN_PREFERRED_LOCALE,
  MIN_REASON,
  MIN_SEGMENT_CODE,
  NOTE_CLASSIFICATIONS,
  NOTE_VISIBILITIES,
  RECORDABLE_CONSENT_STATUSES,
  RESTRICTION_TYPES,
} from './governance-contract';
import { CONTACT_CHANNELS } from './profile-contract';

/**
 * The six customer component writes (`FE-009`…`FE-014`).
 *
 * ## Every one of these is `idempotent: true`
 *
 * Including `setPreferenceAction`, which is a **PUT**. Before `P1-27-INT-003`
 * the client derived the `Idempotency-Key` from the HTTP method, so that one
 * would have answered `400 ERR-INT-002` before authorization on every single
 * attempt while its five POST neighbours worked. The key now comes from the
 * contract-derived authority in `operation-contract.ts`, and these writes are
 * the first place in the product where the difference is load-bearing.
 *
 * No action here sets the header itself. Reaching into the client to add one
 * would put a second idempotency authority in the codebase, which is the shape
 * of the defect rather than the fix.
 *
 * ## No action re-checks a permission
 *
 * The six writes need six different permissions, and the Backend decides all of
 * them. A client-side pre-check would return a *different* answer from the
 * server's in exactly the cases where the difference matters. The screens hide
 * controls the caller is known to lack as a courtesy; that is presentation, and
 * this file does not rely on it.
 *
 * ## Every field is trimmed before it is measured
 *
 * The Backend carries `btrim(...) <> ''` CHECK constraints, so a value of
 * spaces is empty there however long it is here. Measuring the untrimmed length
 * would let `"          "` through as a ten-character restriction reason.
 */

const channel = z.enum(CONTACT_CHANNELS);
const purpose = z.enum(COMMUNICATION_PURPOSES);

const noteSchema = z
  .object({
    body: z.string().trim().min(1, 'field.required').max(MAX_NOTE_BODY),
    classification: z.enum(NOTE_CLASSIFICATIONS).optional(),
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
  })
  .strict();

/** `FE-011` — author a note. `crm.customer.note.write`. */
export async function addNoteAction(
  customerId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  return write(
    previous,
    () => {
      const parsed = noteSchema.safeParse({
        body: String(form.get('body') ?? ''),
        // Omitted when unset so the ROUTE's defaults apply. Sending `internal`
        // explicitly would look identical today and silently diverge the moment
        // the backend's default changes.
        ...(optional(form, 'classification')
          ? { classification: optional(form, 'classification') }
          : {}),
        ...(optional(form, 'visibility') ? { visibility: optional(form, 'visibility') } : {}),
      });
      return parsed.success
        ? { ok: true as const, body: parsed.data }
        : { ok: false as const, errors: fieldErrorsFrom(parsed.error) };
    },
    'POST',
    `${base(customerId)}/notes`,
    'crm.customers.notes.added'
  );
}

const alertSchema = z
  .object({
    alertType: z.enum(ALERT_TYPES),
    severity: z.enum(ALERT_SEVERITIES),
    message: z.string().trim().min(1, 'field.required').max(MAX_ALERT_MESSAGE),
  })
  .strict();

/** `FE-012` — raise an alert. `crm.customer.governance.manage`. */
export async function raiseAlertAction(
  customerId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  return write(
    previous,
    () => {
      const parsed = alertSchema.safeParse({
        alertType: String(form.get('alertType') ?? ''),
        severity: String(form.get('severity') ?? ''),
        message: String(form.get('message') ?? ''),
      });
      return parsed.success
        ? { ok: true as const, body: parsed.data }
        : { ok: false as const, errors: fieldErrorsFrom(parsed.error) };
    },
    'POST',
    `${base(customerId)}/alerts`,
    'crm.customers.alerts.raised'
  );
}

const restrictionSchema = z
  .object({
    restrictionType: z.enum(RESTRICTION_TYPES),
    // Ten characters minimum, from the route. A restriction stops work being
    // done for a real customer; "no" is not a reason anyone can act on later.
    reason: z.string().trim().min(MIN_REASON, 'field.tooShort').max(MAX_REASON),
    approvalRef: z.string().trim().min(1).max(MAX_APPROVAL_REF).optional(),
  })
  .strict();

/** `FE-014` — impose a restriction. `crm.customer.restriction.manage`. */
export async function imposeRestrictionAction(
  customerId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  return write(
    previous,
    () => {
      const parsed = restrictionSchema.safeParse({
        restrictionType: String(form.get('restrictionType') ?? ''),
        reason: String(form.get('reason') ?? ''),
        ...(optional(form, 'approvalRef') ? { approvalRef: optional(form, 'approvalRef') } : {}),
      });
      return parsed.success
        ? { ok: true as const, body: parsed.data }
        : { ok: false as const, errors: fieldErrorsFrom(parsed.error) };
    },
    'POST',
    `${base(customerId)}/restrictions`,
    'crm.customers.restrictions.imposed'
  );
}

const tagSchema = z
  .object({
    segmentCode: z.string().trim().min(MIN_SEGMENT_CODE, 'field.required').max(MAX_SEGMENT_CODE),
    name: z.string().trim().min(1).max(MAX_SEGMENT_NAME).optional(),
  })
  .strict();

/** `FE-013` — assign a segment tag. `crm.customer.governance.manage`. */
export async function assignTagAction(
  customerId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  return write(
    previous,
    () => {
      const parsed = tagSchema.safeParse({
        segmentCode: String(form.get('segmentCode') ?? ''),
        ...(optional(form, 'name') ? { name: optional(form, 'name') } : {}),
      });
      return parsed.success
        ? { ok: true as const, body: parsed.data }
        : { ok: false as const, errors: fieldErrorsFrom(parsed.error) };
    },
    'POST',
    `${base(customerId)}/tags`,
    'crm.customers.tags.assigned'
  );
}

const preferenceSchema = z
  .object({
    channel,
    purpose,
    preferred: z.boolean(),
    preferredLocale: z
      .string()
      .trim()
      .min(MIN_PREFERRED_LOCALE)
      .max(MAX_PREFERRED_LOCALE)
      .optional(),
  })
  .strict();

/**
 * `FE-009` — set a communication preference. `crm.customer.profile.write`.
 *
 * **A PUT, and idempotent.** This is the operation `P1-27-INT-003` was really
 * about: before that fix the client sent no `Idempotency-Key` on anything that
 * was not a POST, so this call answered `400 ERR-INT-002` before authorization,
 * every time, while its POST neighbours in this same file worked.
 */
export async function setPreferenceAction(
  customerId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  return write(
    previous,
    () => {
      const parsed = preferenceSchema.safeParse({
        channel: String(form.get('channel') ?? ''),
        purpose: String(form.get('purpose') ?? ''),
        // A checkbox is absent from the FormData when unchecked, and `preferred`
        // is a REQUIRED boolean. Reading it as a string would send `"false"`,
        // which a `.strict()` boolean field rejects as a 422.
        preferred: form.get('preferred') !== null,
        ...(optional(form, 'preferredLocale')
          ? { preferredLocale: optional(form, 'preferredLocale') }
          : {}),
      });
      return parsed.success
        ? { ok: true as const, body: parsed.data }
        : { ok: false as const, errors: fieldErrorsFrom(parsed.error) };
    },
    'PUT',
    `${base(customerId)}/preferences`,
    'crm.customers.preferences.saved'
  );
}

const consentSchema = z
  .object({
    consentKind: z.enum(CONSENT_KINDS),
    channel,
    purpose,
    // Two statuses, not the three a consent row can hold. `expired` is a system
    // transition; offering it would let an operator retire a consent by
    // declaring it expired, without the evidence a real expiry carries.
    status: z.enum(RECORDABLE_CONSENT_STATUSES),
    source: z.string().trim().min(1).max(MAX_CONSENT_SOURCE).optional(),
    contactPointId: z.string().uuid().optional(),
  })
  .strict();

/** `FE-010` — record a consent decision. `crm.customer.consent.write`. */
export async function recordConsentAction(
  customerId: string,
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  return write(
    previous,
    () => {
      const parsed = consentSchema.safeParse({
        consentKind: String(form.get('consentKind') ?? ''),
        channel: String(form.get('channel') ?? ''),
        purpose: String(form.get('purpose') ?? ''),
        status: String(form.get('status') ?? ''),
        ...(optional(form, 'source') ? { source: optional(form, 'source') } : {}),
        ...(optional(form, 'contactPointId')
          ? { contactPointId: optional(form, 'contactPointId') }
          : {}),
      });
      return parsed.success
        ? { ok: true as const, body: parsed.data }
        : { ok: false as const, errors: fieldErrorsFrom(parsed.error) };
    },
    'POST',
    `${base(customerId)}/consents`,
    'crm.customers.consents.recorded'
  );
}
