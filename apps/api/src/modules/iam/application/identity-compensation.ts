/**
 * Undoing a provider identity this request created, after the database refused
 * the account it was created for.
 *
 * The provider write lives OUTSIDE the transaction, so a rollback cannot reach
 * it. The moment the account INSERT is refused is the only moment the subject is
 * known to belong to this request, which is why the compensation happens there
 * and nowhere else — and why it is written once, here, rather than in each path
 * that creates an identity.
 *
 * Two callers share it: `iam.invitation-create`, where the seat ceiling is the
 * refusal that made it necessary, and the console's administrator bootstrap,
 * where the same ceiling refuses the same INSERT for the same organisation.
 *
 * A failure here is recorded and swallowed: the caller's answer is the
 * database's refusal, and replacing it with a provider fault would report the
 * wrong cause for the wrong decision. No audit row is attempted — the
 * transaction is aborted by the time this runs, so `appendAudit` could only
 * fail; the structured log is the record, and a leftover identity is
 * self-healing anyway, because the next invitation of that address reuses it.
 */
import type { DbHandle } from '@/server/db/transaction';
import { log } from '@/server/observability/logger';
import type { IdentityProvider } from '../provider/identity-provider';
import { providerReasonOf } from '../provider/provider-errors';

export async function removeIdentityCreatedHere(
  provider: IdentityProvider,
  db: DbHandle,
  subject: string,
  operation: string
): Promise<void> {
  const entry = {
    module: 'iam',
    operation,
    correlationId: db.context.correlationId,
    tenantRef: db.context.principal.tenantId,
    actorRef: db.context.principal.userId,
    result: 'failure' as const,
  };
  if (!provider.supportsDelete) {
    log.warn('Provider identity created by a refused invitation cannot be removed', {
      ...entry,
      context: { reason: 'provider-does-not-support-delete' },
    });
    return;
  }
  try {
    // Re-read at the provider immediately before removing. The address lock
    // keeps other invitations and the first-owner bootstrap out, but not every
    // change to the directory passes through this database — an invitee can
    // confirm, and the provider can disable, on its own side. An identity
    // no longer bound to this organisation, or already confirmed or disabled,
    // has been adopted by something other than this request and is kept.
    const current = await provider.findBySubject(subject);
    if (current === null) return;
    if (
      current.tenantId !== db.context.principal.tenantId ||
      current.confirmed ||
      current.disabled
    ) {
      log.warn('Provider identity created by a refused invitation was adopted and is kept', {
        ...entry,
        context: { reason: 'identity-adopted-elsewhere' },
      });
      return;
    }
    await provider.deleteIdentity(subject);
  } catch (error) {
    log.warn('Provider identity created by a refused invitation could not be removed', {
      ...entry,
      context: { reason: providerReasonOf(error) },
    });
  }
}
