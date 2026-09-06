/**
 * The numbering half of tenant provisioning (P1-30 corrective slice).
 *
 * A new organisation must be able to issue documents on the day it is created.
 * Every human-facing document number on this platform comes from
 * `shared.next_display_number`, which refuses `no_data_found` when no row is
 * configured for `(tenant, company, branch, code)` — and `app_runtime` holds no
 * INSERT on `shared.number_sequences`, so the refusal is one no caller can fix
 * by changing the request. Three of the runs are UNGUARDED at their call sites:
 * invoice issue, receipt record and quotation create fail outright without a
 * row. Measured at develop `029fc20d`: zero rows for every tenant on the stack,
 * so no organisation created through the shipped operation could issue an
 * invoice, record a payment or quote a job.
 *
 * Like the payment-method bootstrap beside it, this service:
 *
 *  - owns no vocabulary — the runs and their scopes are `SEQUENCE_DEFINITIONS`;
 *  - takes no input beyond the company and branch the same transaction created;
 *  - re-implements no policy — `ins_number_sequences_platform` is the authority,
 *    and it needed no change;
 *  - makes one decision: whether the statement wrote a row for every registered
 *    run, and refuses the provisioning if it did not.
 *
 * Refusing is the point. A tenant committed with a partial numbering
 * configuration is one whose failures appear later, one document type at a time,
 * as `ERR-RES-001` from a route the operator will read as a bug.
 */
import { AppFailure } from '@/server/errors/app-failure';
import type { PlatformTargetHandle } from '@/server/db/transaction';
import type {
  NumberSequenceBootstrapRepository,
  SequenceBootstrapScope,
} from '../data/number-sequence-bootstrap-repository';
import { SEQUENCE_DEFINITIONS } from '../domain/sequence-registry';

export class NumberSequenceBootstrapService {
  constructor(private readonly repository: NumberSequenceBootstrapRepository) {}

  /**
   * Gives the tenant being provisioned one sequence per registered run.
   *
   * @returns how many were written — for the provisioning audit record.
   */
  async provisionRegisteredSequences(
    db: PlatformTargetHandle,
    scope: SequenceBootstrapScope
  ): Promise<number> {
    const written = await this.repository.provisionRegisteredSequences(db, scope);
    const required = SEQUENCE_DEFINITIONS.length;
    if (written !== required) {
      throw new AppFailure('ERR-SYS-001', {
        message:
          `Tenant provisioning wrote ${written} of the ${required} registered number sequences. ` +
          'Every document this platform issues takes its number from one of them, and three of ' +
          'the runs refuse rather than degrade when unprovisioned, so the provisioning is ' +
          'refused rather than completed.',
      });
    }
    return written;
  }
}
