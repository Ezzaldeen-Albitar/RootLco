'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, success, type ActionState } from '@/lib/forms/action-result';
import { issueKeysByField } from '@/features/authentication/schemas/credentials';

/**
 * The user-administration mutations.
 *
 * Every one of them:
 *
 *   - goes through an approved operation, named beside it;
 *   - sends a written reason where the contract requires one, because that
 *     reason becomes an audit record and an empty string is not a reason;
 *   - carries `If-Match` where the operation is version-guarded, taken from the
 *     record the operator was looking at;
 *   - maps a conflict to a conflict, a denial to a denial, and never to a
 *     generic failure that invites a retry which will fail identically.
 *
 * None of them re-checks a permission before calling. The backend decides, its
 * denial is the only one that matters, and a client-side pre-check that returned
 * early would produce a *different* answer from the server's in exactly the
 * cases where the difference matters.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reason = z.string().trim().min(1, 'overlay.reasonRequired').max(500);

// --- invitation --------------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().trim().min(3, 'users.invite.email').max(320),
  displayName: z.string().trim().min(1, 'users.invite.displayName').max(200),
  mfaRequired: z.boolean(),
  roleIds: z.array(z.string().regex(UUID)).max(20),
});

/**
 * Invite a user.
 *
 * `redirectTo` is deliberately NOT sent: the backend matches it exactly against
 * a configured allow-list and falls back to the first entry when absent. The web
 * tier does not hold that allow-list, so any value it invented would either be
 * refused or force someone to widen the list to make the form work — and the
 * link being redirected carries a single-use credential.
 */
export async function inviteUserAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const parsed = inviteSchema.safeParse({
    email: String(form.get('email') ?? ''),
    displayName: String(form.get('displayName') ?? ''),
    mfaRequired: form.get('mfaRequired') === 'on',
    roleIds: form.getAll('roleIds').map(String).filter(Boolean),
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send('POST', '/api/v1/iam/invitations', {
    email: parsed.data.email,
    displayName: parsed.data.displayName,
    mfaRequired: parsed.data.mfaRequired,
    ...(parsed.data.roleIds.length > 0 ? { roleIds: parsed.data.roleIds } : {}),
  });

  if (!result.ok) {
    // `ERR-RES-002` — an account already exists for that address in this
    // tenant. It arrives as a 409 and is a deterministic, documented outcome,
    // not a mystery: re-inviting would issue a second live token for the same
    // identity, so the backend refuses rather than silently re-sending.
    if (result.kind === 'conflict') {
      return {
        status: 'conflict',
        messageKey: 'users.invite.duplicate',
        correlationId: result.correlationId,
        attempt,
      };
    }
    return fromFailure(result, attempt);
  }
  return success('users.invite.done', attempt);
}

export async function cancelInvitationAction(
  userId: string,
  reasonText: string
): Promise<ActionState> {
  return mutate(
    'DELETE',
    `/api/v1/iam/invitations/${encodeURIComponent(userId)}`,
    { reason: reasonText },
    { validateReason: reasonText }
  );
}

export async function activateInvitationAction(
  userId: string,
  reasonText: string
): Promise<ActionState> {
  return mutate(
    'POST',
    `/api/v1/iam/invitations/${encodeURIComponent(userId)}/activation`,
    { reason: reasonText },
    {
      validateReason: reasonText,
      // The backend refuses activation until the provider confirms the invitee
      // accepted. That is a precondition, not a fault, so it gets its own
      // sentence rather than the generic "that change was not saved".
      messageForValidation: 'users.notAccepted',
    }
  );
}

// --- lifecycle ---------------------------------------------------------------

export async function changeUserStatusAction(
  userId: string,
  status: 'active' | 'locked' | 'archived',
  reasonText: string
): Promise<ActionState> {
  return mutate(
    'POST',
    `/api/v1/iam/users/${encodeURIComponent(userId)}/status`,
    { status, reason: reasonText },
    { validateReason: reasonText }
  );
}

export async function revokeUserSessionsAction(
  userId: string,
  reasonText: string
): Promise<ActionState> {
  return mutate(
    'DELETE',
    `/api/v1/iam/users/${encodeURIComponent(userId)}/sessions`,
    { reason: reasonText },
    { validateReason: reasonText }
  );
}

// --- one place for the shared shape -----------------------------------------

async function mutate(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  options: {
    readonly validateReason?: string;
    readonly ifMatch?: number;
    readonly messageForValidation?: string;
  } = {}
): Promise<ActionState> {
  if (options.validateReason !== undefined) {
    const checked = reason.safeParse(options.validateReason);
    if (!checked.success) {
      return invalid({ reason: 'overlay.reasonRequired' }, 1, 'overlay.reasonRequired');
    }
  }

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };

  const result = await client.send(method, path, body, {
    ...(options.ifMatch !== undefined ? { ifMatch: options.ifMatch } : {}),
  });

  if (!result.ok) {
    if (result.kind === 'validation' && options.messageForValidation) {
      return {
        status: 'invalid',
        messageKey: options.messageForValidation,
        correlationId: result.correlationId,
        attempt: 1,
      };
    }
    return fromFailure(result, 1, result.kind === 'forbidden' ? 'state.denied.title' : undefined);
  }
  return success('admin.saved', 1);
}
