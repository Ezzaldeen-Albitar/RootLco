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
  TechnicianProfileRow,
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

/**
 * The wire shape of `tech.technician-available` (PRE-P1-29-BR-08b).
 *
 * `truncatedAt` is part of the contract rather than an implementation detail: the
 * candidate set is capped, and a silently truncated list is a wrong answer that
 * looks like a complete one. Naming the envelope keeps that field visible to any
 * consumer generated from this type.
 */
export interface TechnicianCandidateResult {
  readonly items: readonly (EligibilityVerdict & { readonly technicianProfileId: string })[];
  readonly truncatedAt: number | null;
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
   * One technician profile, or null when absent or out of the caller's scope.
   *
   * Exposed because a `wo` caller needs the profile's OWN company and branch to
   * authorize against — reading `tech.technician_profiles` itself would be the
   * cross-module table access ADR-001 rule 3 prohibits.
   */
  async profile(db: DbHandle, technicianProfileId: string): Promise<TechnicianProfileRow | null> {
    return this.repository.profile(db, technicianProfileId);
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

  /**
   * The branch's active technicians, each with a verdict for the same requirement.
   *
   * Returns EVERY candidate with its findings rather than only the eligible ones, and
   * that is the useful shape: an assigner looking at an empty list learns nothing,
   * while a list saying "these four are free, and this one lacks the certification"
   * is what lets them act. `eligible` sorts first so the common case reads top-down.
   *
   * Bounded by construction. The candidate set is capped and each candidate costs a
   * fixed number of queries, so the request cannot fan out with branch size — the
   * cap is reported back rather than applied silently, because a truncated candidate
   * list that looked complete would be worse than no list.
   */
  async candidates(
    db: DbHandle,
    requirement: EligibilityRequirement,
    at: Date,
    limit: number
  ): Promise<TechnicianCandidateResult> {
    const profiles = await this.repository.activeProfilesInBranch(
      db,
      requirement.companyId,
      requirement.branchId,
      limit + 1
    );
    const considered = profiles.slice(0, limit);
    const items: (EligibilityVerdict & { technicianProfileId: string })[] = [];
    for (const profile of considered) {
      const verdict = await this.evaluate(db, profile.id, requirement, at);
      items.push({ technicianProfileId: profile.id, ...verdict });
    }
    items.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return a.technicianProfileId.localeCompare(b.technicianProfileId);
    });
    return { items, truncatedAt: profiles.length > limit ? limit : null };
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
