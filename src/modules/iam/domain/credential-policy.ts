/**
 * Credential-flow rules (P1-14): redirect destinations, password bounds, and
 * approval-limit amounts.
 *
 * All three are boundary rules that must hold before anything reaches the
 * provider or the database, and none of them needs state — so they live here,
 * unit-testable and with no I/O.
 */
import { DomainService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';

/**
 * Passwords are bounded but not scored.
 *
 * Strength is the provider's job (ADR-019) and duplicating a policy it already
 * enforces would create two answers to "is this password acceptable". The bounds
 * here exist for a different reason: an unbounded password is an unbounded input
 * to the provider's hashing routine, which is a cheap denial-of-service.
 */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

export class CredentialPolicy extends DomainService {
  protected readonly module = 'iam';

  /**
   * Resolves the redirect a reset or invitation link returns to.
   *
   * **Exact match against a configured allow-list, and an empty allow-list
   * permits nothing.** Prefix matching is not used: `https://rootlco.example`
   * as a prefix also matches `https://rootlco.example.attacker.test`, and the
   * link being redirected carries a single-use credential. A caller that
   * supplies no destination gets the first allow-listed entry, so the common
   * case needs no client input at all.
   */
  resolveRedirect(requested: string | undefined, allowList: readonly string[]): string {
    if (allowList.length === 0) {
      throw new AppFailure('ERR-SYS-001', {
        message:
          'No redirect destination is allow-listed; AUTH_REDIRECT_ALLOWLIST must be configured ' +
          'before invitation or password-reset links can be issued.',
      });
    }
    if (requested === undefined) return allowList[0] as string;
    if (!allowList.includes(requested)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Requested redirect destination is not allow-listed',
        safeDetails: { violations: [{ path: 'body.redirectTo', rule: 'not_allow_listed' }] },
      });
    }
    return requested;
  }

  /** Bounds a password. Strength is the provider's decision, not ours. */
  assertPasswordBounds(password: string): void {
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new AppFailure('ERR-VAL-001', {
        message: `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters`,
        // The rule code carries no information about the submitted value, and
        // the value itself is never echoed — a password in a validation error is
        // a password in a log index.
        safeDetails: { violations: [{ path: 'body.password', rule: 'invalid_length' }] },
      });
    }
  }

  /**
   * Validates an approval-limit amount against `iam.approval_limits`.
   *
   * The column is `numeric(18,4)`, so at most 4 decimal places and at most 14
   * integer digits fit. Money crosses the API as a decimal **string**
   * (`schemas.money`) and stays a string all the way to the bound parameter:
   * parsing it into a JavaScript number would silently round 0.1 and turn an
   * exact contract into an approximate one.
   */
  assertApprovalAmount(amount: string, currency: string): void {
    const violation = (path: string, rule: string): never => {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Approval limit amount or currency is not valid',
        safeDetails: { violations: [{ path, rule }] },
      });
    };

    // Up to 14 integer digits and 4 decimals: exactly what `numeric(18,4)` holds.
    if (!/^\d{1,14}(?:\.\d{1,4})?$/.test(amount)) {
      // A negative amount lands here rather than in a separate branch: the
      // pattern admits no sign at all, and `ck_approval_limits_amount` requires
      // `amount >= 0`.
      violation('body.amount', 'invalid_decimal_or_negative');
    }
    if (!/^[A-Z]{3}$/.test(currency)) violation('body.currency', 'invalid_currency_code');
  }

  /**
   * Validates an effective window.
   *
   * `ck_approval_limits_dates` requires `effective_to > effective_from`, and the
   * two EXCLUDE constraints refuse overlapping windows for the same subject —
   * which surfaces as SQLSTATE 23P01 and is translated by the service.
   */
  assertEffectiveWindow(from: string, to: string | null | undefined): void {
    if (!to) return;
    if (to <= from) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The end of an effective window must be after its start',
        safeDetails: { violations: [{ path: 'body.effectiveTo', rule: 'not_after_start' }] },
      });
    }
  }
}
