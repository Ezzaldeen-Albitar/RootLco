/**
 * `technician` module — public surface (Phase 1-19).
 *
 * The ONLY legal import path for this module (ADR-001): the boundary checker and
 * the ESLint rule both reject `@/modules/technician/<anything>`. It exports
 * behaviour (composed services) and types/contract constants — never repositories,
 * pools, or SQL.
 *
 * ## What this module owns
 *
 * The `tech` schema: technician profiles, the skill / skill-level / certification
 * catalogs, held skills and certifications, availability intervals, and labor
 * sessions. No other module reads or writes a `tech.` table.
 *
 * ## Why eligibility is its own module rather than part of `work-order`
 *
 * A job assignment is a `wo` row, so it would be easy to argue eligibility belongs
 * with work orders. It does not: eligibility is decided entirely from `tech` rows,
 * and putting the decision in `work-order` would mean `work-order` reading `tech`
 * tables directly — the exact cross-module access ADR-001 rule 3 prohibits. Wave 5
 * composes the two through this public surface instead.
 *
 * Phase 1-19 delivers this module across waves: Wave 3 establishes the boundary,
 * the eligibility arithmetic and the catalog reads; Wave 5 adds assignment and
 * labor-session behaviour.
 */
import { composeModule } from '@/server/layering';
import { TechnicianCatalogRepository } from './data/technician-catalog-repository';
import { TechnicianEligibilityService } from './application/technician-eligibility-service';
import { LaborSessionRepository } from './data/labor-session-repository';
import { LaborSessionService } from './application/labor-session-service';

export type {
  AvailabilityRow,
  CertificationRow,
  HeldCertificationRow,
  HeldSkillRow,
  SkillLevelRow,
  SkillRow,
  TechnicianProfileRow,
} from './data/technician-catalog-repository';
export type {
  EligibilityRequirement,
  EligibilityVerdict,
} from './application/technician-eligibility-service';
export type { LaborSessionView, SessionPageInput } from './application/labor-session-service';
export type { LaborSessionRow } from './data/labor-session-repository';

export {
  AVAILABILITY_KINDS,
  CATALOG_STATUSES,
  CERTIFICATION_STATUSES,
  INELIGIBILITY_REASONS,
  LABOR_SOURCES,
  MAX_UNAVAILABILITY_REASON,
  TechnicianRuleError,
  assertEligible,
  assertLaborWindow,
  certificationIsValidOn,
  coveredByUnion,
  intervalCovers,
  intervalsOverlap,
  skillLevelSatisfies,
  utcCalendarDay,
  type AvailabilityKind,
  type CatalogStatus,
  type CertificationStatus,
  type EligibilityFinding,
  type IneligibilityReason,
  type Interval,
  type LaborSource,
} from './domain/technician';

/** Composition root: constructs the module's services once per process. */
export const technicianModule = composeModule({
  module: 'technician',
  create: () => {
    const profiles = new TechnicianCatalogRepository();
    return {
      eligibility: new TechnicianEligibilityService(profiles),
      laborSessions: new LaborSessionService(new LaborSessionRepository(), profiles),
    };
  },
});
