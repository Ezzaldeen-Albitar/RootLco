/**
 * `quality` module — public surface (Phase 1-19).
 *
 * The ONLY legal import path for this module (ADR-001): the boundary checker and
 * the ESLint rule both reject `@/modules/quality/<anything>`. It exports behaviour
 * (composed services) and types/contract constants — never repositories, pools, or
 * SQL.
 *
 * ## What this module owns
 *
 * The `qms` schema: quality-control records and their check results and status
 * history, reopen attempts, and rework links with their details. No other module
 * reads or writes a `qms.` table.
 *
 * The work-order module's closure blockers B5 and B6 are answered from `qms` rows,
 * so `work-order` asks through this surface rather than querying `qms.` directly.
 *
 * Phase 1-19 delivers this module across waves: Wave 3 establishes the boundary,
 * the vocabulary and the QC/rework reads; Wave 8 adds the QC, reopen-refusal and
 * rework behaviour.
 */
import { composeModule } from '@/server/layering';
import { QualityRepository } from './data/quality-repository';
import { QualityGateService } from './application/quality-gate-service';

export type { QcCheckRow, QualityControlRecordRow, ReworkLinkRow } from './data/quality-repository';
export type { QualityGateStatus } from './application/quality-gate-service';

export {
  MAX_CORRECTIVE_ACTION,
  MAX_QC_NOTE,
  MAX_REOPEN_REASON,
  MAX_ROOT_CAUSE,
  QC_CHECK_RESULTS,
  QC_CHECK_STATUSES,
  QC_OVERALL_RESULTS,
  QualityRuleError,
  assertIndependentSignOff,
  assertNotFinalized,
  assertReason,
  refuseReopen,
  type QcCheckResult,
  type QcCheckStatus,
  type QcOverallResult,
} from './domain/quality';

/** Composition root: constructs the module's services once per process. */
export const qualityModule = composeModule({
  module: 'quality',
  create: () => ({
    gate: new QualityGateService(new QualityRepository()),
  }),
});
