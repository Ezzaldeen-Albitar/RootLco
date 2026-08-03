import { authorizedClient } from '@/lib/api/server-client';
import type { ApiFailureKind } from '@/lib/api/client';

/**
 * The caller's own account record.
 *
 * ## There is no self-service profile operation, and this does not pretend there is
 *
 * `GET /api/v1/iam/users/{userId}` requires `iam.user.read` and
 * `PATCH /api/v1/iam/users/{userId}` requires `iam.user.manage` — both
 * administrative. A user without them can see what
 * `GET /api/v1/auth/session` already told them and nothing more.
 *
 * So this returns `null` on a denial rather than raising: "you may not read your
 * own account record" is an ordinary, expected state for most accounts, and the
 * Profile screen renders the session's own view of itself in that case. Finding
 * `P1-26-F-009` records the constraint; the screen states it in words rather
 * than showing a form that would be refused.
 */

export interface UserAccount {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: 'invited' | 'active' | 'locked' | 'archived';
  readonly mfaRequired: boolean;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface UserGrant {
  readonly id: string;
  readonly roleId: string;
  readonly scopeMode: string;
  readonly status: string;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export interface UserDetail extends UserAccount {
  readonly grants: readonly UserGrant[];
}

export type ReadResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly kind: ApiFailureKind; readonly correlationId: string | null };

export async function readUserDetail(userId: string): Promise<ReadResult<UserDetail>> {
  const client = await authorizedClient();
  if (!client) return { ok: false, kind: 'unauthenticated', correlationId: null };

  const result = await client.get<UserDetail>(`/api/v1/iam/users/${encodeURIComponent(userId)}`);
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, kind: result.kind, correlationId: result.correlationId };
}
