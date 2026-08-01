/**
 * Reference application service (P1-13-BE-002, P1-13-BE-021).
 *
 * The copyable shape for every later use case:
 *
 *   handler → application service → domain service → repository
 *
 * The service receives the transaction handle (already authorized by the
 * pipeline), calls the repository for state, hands values to the domain service
 * for the decision, and returns data. It performs no HTTP work, sets no status
 * code, and builds no response.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { MetaRepository } from '../data/meta-repository';
import { PingPolicy } from '../domain/ping-policy';

export interface PingResult {
  readonly status: 'ok';
  /** Opaque tenant reference. Safe: the caller already belongs to this tenant. */
  readonly tenantRef: string;
  readonly effectiveScope: 'tenant' | 'company' | 'branch';
  readonly observedAt: string;
  readonly correlationId: string;
}

export class PingService extends ApplicationService {
  protected readonly module = 'meta';

  constructor(
    private readonly repository: MetaRepository,
    private readonly policy: PingPolicy
  ) {
    super();
  }

  async ping(db: DbHandle): Promise<PingResult> {
    const context = this.contextOf(db);
    const scope = await this.repository.readScope(db);

    if (!scope) {
      // The session context resolved in the application but returned no tenant
      // row: RLS default-deny in action. Fail closed rather than answering "ok"
      // for a tenant the database will not confirm.
      throw new AppFailure('ERR-CTX-001', {
        message: 'Resolved tenant is not visible under the session context',
      });
    }

    const assessment = this.policy.assess({
      tenantId: scope.tenantId,
      userId: context.principal.userId,
      companyCount: scope.companyCount,
      branchCount: scope.branchCount,
      observedAt: context.startedAt,
    });

    return {
      status: 'ok',
      tenantRef: scope.tenantId,
      effectiveScope: assessment.effectiveScope,
      observedAt: assessment.observedAt,
      correlationId: context.correlationId,
    };
  }
}
