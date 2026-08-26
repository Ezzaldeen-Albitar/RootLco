/**
 * The branch QC queue — application service (PRE-P1-29-BR-06, `INS-13`, `DEP-B4`).
 *
 * Thin by design: the read carries no rule beyond its scope, and the scope is
 * authorized at the route because this is a COLLECTION read whose
 * `scope: 'branch'` would otherwise be inert (`T-02`, `P1-18-A-01`).
 *
 * It lives in `quality` rather than `work-order` because `qms` is this module's
 * schema. Reading it from the work-order board repository is exactly what the
 * module-boundary gate refuses, and rightly: the gate's allow-list is capped at
 * the two closure predicates the database guard itself joins across, and a branch
 * queue is not one of those.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import {
  QC_BRANCH_ORDER,
  type QcRecordRow,
  type QualityRepository,
} from '../data/quality-repository';

export interface QcQueuePageInput {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export class QcQueueService extends ApplicationService {
  protected readonly module = 'quality';

  constructor(private readonly repository: QualityRepository) {
    super();
  }

  async listForBranch(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly overallResult?: string | undefined;
    },
    page: QcQueuePageInput
  ): Promise<Page<QcRecordRow>> {
    return this.repository.pageQcRecords(db, filter, pageRequest(QC_BRANCH_ORDER, page));
  }
}
