'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import {
  CAPACITY_LIMIT_CODE,
  ORGANISATION_INACTIVE_CODE,
  UPSTREAM_DEPENDENCY_CODE,
} from '@/lib/api/client';
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
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt };

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
    //
    // A capacity refusal is ALSO a 409, and it is not a duplicate: the seat
    // allowance is spent. It goes through `fromFailure`, which names the
    // ceiling and the numbers instead of blaming an address that is fine.
    const code = result.problem?.code;
    if (
      result.kind === 'conflict' &&
      code !== CAPACITY_LIMIT_CODE &&
      code !== ORGANISATION_INACTIVE_CODE
    ) {
      return {
        status: 'conflict',
        messageKey: 'users.invite.duplicate',
        correlationId: result.correlationId,
        attempt,
      };
    }
    /*
     * The identity provider could not be reached, so the invitation MAIL was
     * never sent — and neither was anything else.
     *
     * Stated that way because that is what the service does. The provider write
     * is the FIRST thing `invite()` attempts after its delegation and duplicate
     * checks, and a `provider-unavailable` failure becomes `ERR-DEP-001` before
     * the account row is inserted: the catalogue entry says in so many words
     * that the request performed no work and may be retried. So the honest
     * sentence is "nothing was saved, send it again" — NOT "the invitation was
     * saved but the email could not be sent", which would leave the
     * administrator looking for an outstanding invitation that does not exist.
     *
     * It says nothing about the address beyond asking the reader to check it.
     * Whether that address already belongs to somebody in another organisation
     * is not disclosed here and is not knowable from this answer.
     */
    if (result.problem?.code === UPSTREAM_DEPENDENCY_CODE) {
      return {
        status: 'unavailable',
        messageKey: 'users.invite.notSent',
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
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt: 1 };

  const result = await client.send(method, path, body, {
    ...(options.ifMatch !== undefined ? { ifMatch: options.ifMatch } : {}),
  });

  if (!result.ok) {
    const state = fromFailure(
      result,
      1,
      result.kind === 'forbidden' ? 'state.denied.title' : undefined
    );
    // The screen's own sentence is a FALLBACK, not an override. Activation is
    // refused for more than one reason, and only one of them is "the invitation
    // has not been accepted": the service also refuses when the account has been
    // switched off, and that refusal states itself. Replacing every validation
    // failure with the fixed sentence told the operator the wrong reason and
    // sent them to chase an acceptance that had already happened.
    if (
      result.kind === 'validation' &&
      options.messageForValidation &&
      !statesItsOwnReason(state)
    ) {
      return {
        status: 'invalid',
        messageKey: options.messageForValidation,
        correlationId: result.correlationId,
        attempt: 1,
      };
    }
    return state;
  }
  return success('admin.saved', 1);
}

/**
 * Whether the refusal arrived carrying a sentence of its own.
 *
 * `fromFailure` promotes the first whole-request violation the catalogue has a
 * sentence for into `messageKey`, and deliberately skips
 * `form.violation.invalid` — the honest generic — so an uncatalogued token
 * cannot downgrade a banner. That is exactly the distinction wanted here, so it
 * is read off the key rather than re-derived from the violations.
 */
function statesItsOwnReason(state: ActionState): boolean {
  const key = state.messageKey;
  return key !== undefined && key.startsWith('form.violation.') && key !== 'form.violation.invalid';
}

// --- role grants and where they apply ----------------------------------------

const scopeSchema = z
  .object({
    scopeType: z.enum(['company', 'branch', 'department']),
    companyId: z.string().regex(UUID),
    branchId: z.string().regex(UUID).optional(),
    departmentId: z.string().regex(UUID).optional(),
  })
  .strict()
  .refine((scope) =>
    scope.scopeType === 'company'
      ? scope.branchId === undefined && scope.departmentId === undefined
      : scope.scopeType === 'branch'
        ? scope.branchId !== undefined && scope.departmentId === undefined
        : scope.branchId !== undefined && scope.departmentId !== undefined
  );

const grantSchema = z.object({
  userId: z.string().regex(UUID),
  roleId: z.string().regex(UUID, 'users.access.roleRequired'),
  scopes: z.array(scopeSchema).max(50),
});

/**
 * `POST /api/v1/iam/grants` — `iam.grant-issue`, `iam.grant.manage`.
 *
 * An EMPTY scope list is a deliberate request for the whole organisation, and
 * the backend treats it exactly so — it takes the unrestricted authority path,
 * which only an organisation-wide administrator passes. So the screen sends an
 * empty list only when the operator chose "whole organisation", and refuses a
 * narrower choice with nothing selected rather than silently widening it.
 */
export async function issueGrantAction(input: {
  readonly userId: string;
  readonly roleId: string;
  readonly wholeOrganisation: boolean;
  readonly scopes: readonly ScopeInput[];
}): Promise<ActionState> {
  if (!input.wholeOrganisation && input.scopes.length === 0) {
    return invalid({ scopes: 'users.access.scope.pickOne' }, 1, 'users.access.scope.pickOne');
  }
  const parsed = grantSchema.safeParse({
    userId: input.userId,
    roleId: input.roleId,
    scopes: input.wholeOrganisation ? [] : input.scopes,
  });
  if (!parsed.success) {
    const keys = issueKeysByField(parsed.error);
    return invalid(keys, 1, keys.roleId ?? 'form.formError');
  }

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt: 1 };

  const result = await client.send('POST', '/api/v1/iam/grants', {
    userId: parsed.data.userId,
    roleId: parsed.data.roleId,
    ...(parsed.data.scopes.length > 0 ? { scopes: parsed.data.scopes } : {}),
  });
  if (!result.ok) {
    return fromFailure(result, 1, result.kind === 'forbidden' ? 'state.denied.title' : undefined);
  }
  return success('users.access.granted', 1);
}

type ScopeInput = {
  readonly scopeType: 'company' | 'branch' | 'department';
  readonly companyId: string;
  readonly branchId?: string;
  readonly departmentId?: string;
};

/**
 * `POST /api/v1/iam/grants/{grantId}/scopes` — `iam.grant-scope-add`.
 *
 * One place per request, as the operation takes it. Several places are added
 * one after another and the first refusal stops the rest, so the operator is
 * told which answer they got instead of a mixture.
 */
export async function addGrantScopesAction(
  grantId: string,
  scopes: readonly ScopeInput[]
): Promise<ActionState> {
  if (scopes.length === 0) {
    return invalid({ scopes: 'users.access.scope.pickOne' }, 1, 'users.access.scope.pickOne');
  }
  const parsed = z.array(scopeSchema).max(50).safeParse(scopes);
  if (!UUID.test(grantId) || !parsed.success) return invalid({}, 1, 'form.formError');

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt: 1 };

  for (const scope of parsed.data) {
    const result = await client.send(
      'POST',
      `/api/v1/iam/grants/${encodeURIComponent(grantId)}/scopes`,
      scope
    );
    if (!result.ok) {
      return fromFailure(result, 1, result.kind === 'forbidden' ? 'state.denied.title' : undefined);
    }
  }
  return success('users.access.scopeAdded', 1);
}

/** `DELETE /api/v1/iam/grants/{grantId}/scopes/{scopeId}` — `iam.grant-scope-remove`. */
export async function removeGrantScopeAction(
  grantId: string,
  scopeId: string
): Promise<ActionState> {
  if (!UUID.test(grantId) || !UUID.test(scopeId)) return invalid({}, 1, 'form.formError');
  return mutate(
    'DELETE',
    `/api/v1/iam/grants/${encodeURIComponent(grantId)}/scopes/${encodeURIComponent(scopeId)}`,
    undefined
  );
}

/**
 * `DELETE /api/v1/iam/grants/{grantId}` — `iam.grant-revoke`, `iam.grant.manage`.
 *
 * Version-guarded and reason-bearing: the operation refuses without `If-Match`,
 * and the reason becomes the audit record of why someone lost a role. The
 * version is the one the screen displayed, so a grant that changed underneath
 * the operator is refused as a conflict rather than revoked blind.
 *
 * The backend refuses two revocations this action does not pre-empt: your own
 * grant, and the last remaining holder of user, role or grant administration.
 * Both are answered by the server, which is the only answer that binds.
 */
export async function revokeGrantAction(
  grantId: string,
  recordVersion: number,
  reasonText: string
): Promise<ActionState> {
  if (!UUID.test(grantId) || !Number.isInteger(recordVersion)) {
    return invalid({}, 1, 'form.formError');
  }
  const result = await mutate(
    'DELETE',
    `/api/v1/iam/grants/${encodeURIComponent(grantId)}`,
    { reason: reasonText },
    { validateReason: reasonText, ifMatch: recordVersion }
  );
  return result.status === 'success' ? success('users.access.revoked', 1) : result;
}
