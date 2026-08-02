/**
 * Reference domain service (P1-13-BE-002).
 *
 * This is the exemplar's *rules* layer, and it is intentionally trivial: the
 * ping endpoint has no business meaning, and pretending otherwise would make a
 * copyable reference that teaches the wrong thing.
 *
 * What it does demonstrate is the shape every later domain service must follow:
 *
 *  - no database access, not even injected — it receives values and returns a
 *    decision;
 *  - no I/O, no clock reading of its own (the instant is passed in), so it is
 *    deterministic and unit-testable without a harness;
 *  - it returns data, never a `Response` and never an HTTP status.
 */
import { DomainService } from '@/server/layering';

export interface PingFacts {
  readonly tenantId: string;
  readonly userId: string;
  readonly companyCount: number;
  readonly branchCount: number;
  readonly observedAt: Date;
}

export interface PingAssessment {
  /** Narrowest scope the caller is operating in. */
  readonly effectiveScope: 'tenant' | 'company' | 'branch';
  readonly observedAt: string;
}

export class PingPolicy extends DomainService {
  protected readonly module = 'meta';

  /**
   * Derives the effective scope from the resolved narrowing. Branch narrowing
   * implies company narrowing in the data model, so branch wins when present.
   */
  assess(facts: PingFacts): PingAssessment {
    const effectiveScope =
      facts.branchCount > 0 ? 'branch' : facts.companyCount > 0 ? 'company' : 'tenant';
    return { effectiveScope, observedAt: facts.observedAt.toISOString() };
  }
}
