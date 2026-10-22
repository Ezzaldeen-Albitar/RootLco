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
import type { DbHandle, PlatformTargetHandle } from '@/server/db/transaction';
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

  /**
   * Gives a branch created AFTER provisioning the numbering runs it owes.
   *
   * Three of the eight registered runs are configured per branch — invoice,
   * quotation and receipt — and `shared.next_display_number` refuses rather than
   * degrading when a row is missing. A branch without them is a branch that
   * cannot issue an invoice, quote a job or receipt a payment, and the failure
   * would arrive later, one document type at a time, as an error the operator
   * would read as a bug.
   *
   * The verification reads the configured SET back rather than trusting the
   * affected-row count, because the write is `ON CONFLICT DO NOTHING` and a
   * replay legitimately writes nothing while leaving the branch correct.
   */
  async provisionBranchSequences(db: DbHandle, scope: SequenceBootstrapScope): Promise<void> {
    await this.repository.provisionBranchSequences(db, scope);
    const configured = new Set(await this.repository.branchSequenceCodes(db, scope));
    const missing = SEQUENCE_DEFINITIONS.filter(
      (definition) => definition.provisioningScope === 'branch'
    )
      .map((definition) => definition.code)
      .filter((code) => !configured.has(code));
    if (missing.length > 0) {
      throw new AppFailure('ERR-SYS-001', {
        message:
          `The new branch is missing ${missing.length} of its registered number sequences ` +
          `(${missing.join(', ')}). Every document issued in a branch takes its number from ` +
          'one of them and they refuse rather than degrade, so the branch is refused rather ' +
          'than committed half configured.',
      });
    }
  }
}
