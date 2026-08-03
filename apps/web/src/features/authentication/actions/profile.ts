'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, success, type ActionState } from '@/lib/forms/action-result';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/config';
import { issueKeysByField } from '../schemas/credentials';

/**
 * Updating a display name through the approved administrative contract.
 *
 * ## `If-Match` is mandatory and is never defaulted
 *
 * `PATCH /api/v1/iam/users/{userId}` is version-guarded: without the header the
 * backend answers `ERR-CON-002` outright. Defaulting it — sending `1`, or
 * re-reading the record and using whatever version came back — would convert a
 * lost-update guard into a lost-update. The version comes from the record the
 * form was rendered from, so a change made elsewhere between render and submit
 * produces a conflict the operator is told about.
 *
 * ## The user id is the SESSION's, never the form's
 *
 * The form carries no identifier. If it did, a caller holding `iam.user.manage`
 * could edit any account from the profile screen — a privilege-escalation path
 * created entirely by a hidden field. The action re-reads the session and uses
 * `session.userId`.
 */

const schema = z.object({
  displayName: z.string().trim().min(1, 'field.required').max(200, 'field.required'),
  recordVersion: z.coerce.number().int().min(1),
});

export async function updateOwnProfileAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const locale = localeFrom(form.get('locale'));

  const parsed = schema.safeParse({
    displayName: String(form.get('displayName') ?? ''),
    recordVersion: String(form.get('recordVersion') ?? ''),
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) {
    return { status: 'expired', messageKey: 'state.expired.title', attempt };
  }

  // Re-read the session rather than trusting the form for whose account this is.
  const session = await client.get<{ userId: string }>('/api/v1/auth/session', { retries: 0 });
  if (!session.ok) return fromFailure(session, attempt);

  const result = await client.send(
    'PATCH',
    `/api/v1/iam/users/${encodeURIComponent(session.data.userId)}`,
    { displayName: parsed.data.displayName },
    { ifMatch: parsed.data.recordVersion }
  );

  if (!result.ok) return fromFailure(result, attempt, failureKeyFor(result.kind));

  // The header renders the display name from the session, so the layout has to
  // re-run for the change to be visible anywhere but this form.
  revalidatePath(`/${locale}`, 'layout');
  return success('profile.saved', attempt);
}

function failureKeyFor(kind: string): string | undefined {
  if (kind === 'conflict') return 'state.conflict.title';
  if (kind === 'forbidden') return 'profile.readOnly';
  return undefined;
}

function localeFrom(value: FormDataEntryValue | null): Locale {
  const candidate = typeof value === 'string' ? value : '';
  return isLocale(candidate) ? candidate : DEFAULT_LOCALE;
}
