/**
 * Identity lifecycle and failed-login rules (P1-14).
 *
 * Pure decisions over values the application service supplies. No database
 * access, not even injected — the module-boundary checker enforces that a
 * `domain/` file cannot import `@/server/db`, so these rules are unit-testable
 * without a harness and cannot quietly acquire a query.
 *
 * The transition graph below **mirrors** `iam.change_user_status`, which is the
 * authority. Mirroring it here is not duplication for its own sake: the database
 * function raises on an illegal transition, which would surface as an unhandled
 * fault after the transaction had already done work. Checking first turns that
 * into a clean, cataloged refusal. If the two ever disagree, the database wins —
 * and a regression test asserts they agree, so the disagreement is caught rather
 * than reasoned about.
 */
import { DomainService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';

export const ACCOUNT_STATES = ['invited', 'active', 'locked', 'archived'] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

/** Exactly the graph `iam.change_user_status` enforces. `archived` is terminal. */
const TRANSITIONS: Readonly<Record<AccountState, readonly AccountState[]>> = Object.freeze({
  invited: ['active', 'archived'],
  active: ['locked', 'archived'],
  locked: ['active', 'archived'],
  archived: [],
});

export interface LockoutFacts {
  /** Failures for this account inside the configured window. */
  readonly recentFailures: number;
  readonly maxAttempts: number;
  readonly currentState: AccountState;
}

export interface LockoutDecision {
  /** True when this failure takes the account over the threshold. */
  readonly shouldLock: boolean;
  readonly reason: string;
}

export class IdentityPolicy extends DomainService {
  protected readonly module = 'iam';

  /** True when `to` is reachable from `from`. */
  canTransition(from: AccountState, to: AccountState): boolean {
    return TRANSITIONS[from].includes(to);
  }

  /**
   * Refuses an illegal transition before any work is done.
   *
   * The message names both states because both are already known to the caller —
   * an administrator reading a user's record. Nothing here is a secret.
   */
  assertTransition(from: AccountState, to: AccountState): void {
    if (from === to) {
      throw new AppFailure('ERR-VAL-001', {
        message: `Account is already ${to}`,
        safeDetails: { violations: [{ path: 'body.status', rule: 'no_state_change' }] },
      });
    }
    if (!this.canTransition(from, to)) {
      throw new AppFailure('ERR-VAL-001', {
        message: `Accounts cannot move from ${from} to ${to}`,
        safeDetails: { violations: [{ path: 'body.status', rule: 'invalid_transition' }] },
      });
    }
  }

  /**
   * Decides whether a failed login locks the account.
   *
   * Two properties matter more than the arithmetic:
   *
   *  - **A manual lock is never overwritten.** An account already `locked` stays
   *    locked with its original reason; re-locking it would replace an
   *    administrator's recorded reason with "too many failures" and lose why it
   *    was actually locked.
   *  - **Only an `active` account can be locked by this path.** Locking an
   *    `invited` or `archived` account on failed credentials would let an
   *    attacker who knows an address deny an onboarding that has not happened.
   */
  assessFailedLogin(facts: LockoutFacts): LockoutDecision {
    if (facts.currentState !== 'active') {
      return { shouldLock: false, reason: 'account is not active' };
    }
    if (facts.recentFailures < facts.maxAttempts) {
      return { shouldLock: false, reason: 'below threshold' };
    }
    return {
      shouldLock: true,
      reason: `Locked automatically after ${facts.maxAttempts} consecutive failed sign-in attempts.`,
    };
  }

  /**
   * Validates a state-change reason.
   *
   * `ck_user_status_history_reason_not_blank` requires a non-blank reason, and
   * the reason is stored in an append-only table an auditor will read. A bounded
   * length keeps a caller from using it as free storage; rejecting control
   * characters keeps it from being used to forge log lines.
   */
  assertReason(reason: string): string {
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > 500) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A reason of 1–500 characters is required',
        safeDetails: { violations: [{ path: 'body.reason', rule: 'invalid_length' }] },
      });
    }
    // Escaped rather than literal: the escaped form is visible in review, and it
    // does not trip `no-control-regex` the way a raw control character would.
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The reason may not contain control characters',
        safeDetails: { violations: [{ path: 'body.reason', rule: 'control_characters' }] },
      });
    }
    return trimmed;
  }
}
