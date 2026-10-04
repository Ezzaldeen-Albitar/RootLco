'use server';

import { readOperation } from '@/lib/api/read-operation';
import type { PersonName } from './person-name';

/**
 * The name behind one account reference (`iam.user-detail`, `iam.user.read`),
 * for administration screens that list a person by account — today the
 * approval-limits list (finance checkpoint, DF-B6).
 *
 * Administration's own read rather than an import of the receptions read-back
 * hook: a feature does not import another feature, and the P1-28 access gate
 * works out its route set from what each page LOADS, so reaching into
 * `features/receptions` silently made `/administration/approval-limits` a P1-28
 * screen. The answer is mapped here to one of the four outcomes in
 * `person-name.ts`, so the account reference never travels back to be shown.
 */
export async function readPersonName(userId: string): Promise<PersonName> {
  const read = await readOperation<{ readonly displayName: string }>(
    `/api/v1/iam/users/${encodeURIComponent(userId)}`
  );
  switch (read.status) {
    case 'ok':
      // A blank name is not a name, and is said as "no such person" rather than
      // rendered as empty space.
      return read.data.displayName.trim() === ''
        ? { status: 'unresolved' }
        : { status: 'named', displayName: read.data.displayName };
    case 'denied':
      return { status: 'denied' };
    case 'not-found':
      return { status: 'unresolved' };
    default:
      // An expired session or a failed read says nothing about the permission
      // or the person, so it is `unavailable`, never a denial.
      return { status: 'unavailable' };
  }
}
