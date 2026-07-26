/**
 * Technician eligibility evaluation (Phase 1-19, P1-19-BE-001).
 *
 * Wave 5 calls `evaluate` before writing a `wo.job_assignments` row. The
 * evaluation is deliberately *complete* — it collects every reason a technician
 * fails rather than short-circuiting on the first — because an assigner who
 * discovers one blocker per request has been made to do the work the server
 * already did.
 *
 * Nothing here enforces. The database still owns the assignment constraints; this
 * turns a would-be `23514`/`23503` into a precise 422 with the reasons named.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import type {
  CertificationRow,
  SkillLevelRow,
  SkillRow,
  TechnicianCatalogRepository,
} from '../data/technician-catalog-repository';
import {
  assertEligible,
  certificationIsValidOn,
  coveredByUnion,
  intervalsOverlap,
  skillLevelSatisfies,
  type CertificationStatus,
  type EligibilityFinding,
} from '../domain/technician';

/** What a job demands of whoever works it. Assembled by Wave 5 from the job row. */
export interface EligibilityRequirement {
  /** Skill catalog codes the job requires, each with a minimum level rank. */
  readonly skills: readonly { readonly skillCode: string; readonly minimumRank: number }[];
  /** Certification catalog codes the job requires. */
  readonly certificationCodes: readonly string[];
  /** The window the work is expected to occupy. */
  readonly from: Date;
  readonly to: Date;
  /** The scope the job lives in; a technician outside it is never eligible. */
  readonly companyId: string;
  readonly branchId: string;
}

export interface EligibilityVerdict {
  readonly eligible: boolean;
  readonly findings: readonly EligibilityFinding[];
}

export class TechnicianEligibilityService extends ApplicationService {
  protected readonly module = 'technician';

  constructor(private readonly repository: TechnicianCatalogRepository) {
    super();
  }

  /** Active skill catalog for the caller's tenant. */
  async skills(db: DbHandle): Promise<readonly SkillRow[]> {
    return this.repository.skills(db);
  }

  /** Active skill-level catalog, ranks included. */
  async skillLevels(db: DbHandle): Promise<readonly SkillLevelRow[]> {
    return this.repository.skillLevels(db);
  }

  /** Active certification catalog. */
  async certifications(db: DbHandle): Promise<readonly CertificationRow[]> {
    return this.repository.certifications(db);
  }

  /**
   * Evaluates one technician against one requirement, reporting every failure.
   *
   * Returns a verdict rather than throwing so a *query* endpoint
   * (`GET /technicians:available`) can rank candidates without catching
   * exceptions. `assertOrThrow` is the write-path wrapper.
   */
  async evaluate(
    db: DbHandle,
    technicianProfileId: string,
    requirement: EligibilityRequirement,
    at: Date
  ): Promise<EligibilityVerdict> {
    const findings: EligibilityFinding[] = [];

    const profile = await this.repository.profile(db, technicianProfileId);
    if (profile === null) {
      // Out of scope and non-existent are one answer here. The caller learns only
      // that this id is not a technician they may assign.
      return { eligible: false, findings: [{ reason: 'profile-out-of-scope' }] };
    }
    if (!profile.isActive) findings.push({ reason: 'profile-inactive' });
    if (profile.companyId !== requirement.companyId || profile.branchId !== requirement.branchId) {
      findings.push({ reason: 'profile-out-of-scope' });
    }

    const held = await this.repository.heldSkills(db, technicianProfileId);
    for (const required of requirement.skills) {
      const match = held.find((row) => row.skillCode === required.skillCode);
      if (match === undefined) {
        findings.push({ reason: 'skill-missing', subject: required.skillCode });
      } else if (!skillLevelSatisfies(match.rank, required.minimumRank)) {
        findings.push({ reason: 'skill-level-insufficient', subject: required.skillCode });
      }
    }

    const certs = await this.repository.heldCertifications(db, technicianProfileId);
    for (const code of requirement.certificationCodes) {
      const match = certs.find((row) => row.certificationCode === code);
      if (match === undefined) {
        findings.push({ reason: 'certification-missing', subject: code });
        continue;
      }
      if (match.certStatus === 'revoked') {
        findings.push({ reason: 'certification-revoked', subject: code });
        continue;
      }
      if (!certificationIsValidOn(match.expiresOn, match.certStatus as CertificationStatus, at)) {
        findings.push({ reason: 'certification-expired', subject: code });
      }
    }

    const windows = await this.repository.availability(
      db,
      technicianProfileId,
      requirement.from,
      requirement.to
    );
    const blocked = windows.filter(
      (row) =>
        row.availabilityKind === 'unavailable' &&
        intervalsOverlap(row.availableFrom, row.availableTo, requirement.from, requirement.to)
    );
    if (blocked.length > 0) {
      findings.push({ reason: 'availability-blocked' });
    } else {
      // An `unavailable` row that overlaps beats any `available` row, which is why
      // the block check runs first. Coverage is only asked once nothing blocks.
      // The UNION of the available rows must cover the window, not any single row:
      // a split shift is two legal non-overlapping rows and neither spans it alone.
      const covered = coveredByUnion(
        windows
          .filter((row) => row.availabilityKind === 'available')
          .map((row) => ({ from: row.availableFrom, to: row.availableTo })),
        requirement.from,
        requirement.to
      );
      if (!covered) findings.push({ reason: 'availability-missing' });
    }

    return { eligible: findings.length === 0, findings };
  }

  /** Write-path wrapper: evaluates, then refuses with `ERR-TECH-001` if ineligible. */
  async assertOrThrow(
    db: DbHandle,
    technicianProfileId: string,
    requirement: EligibilityRequirement,
    at: Date
  ): Promise<void> {
    const verdict = await this.evaluate(db, technicianProfileId, requirement, at);
    assertEligible(verdict.findings);
  }
}
