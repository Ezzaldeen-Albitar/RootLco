/**
 * Technician roster and capability administration (BR-03).
 *
 * ## Why this slice exists
 *
 * Before it, a production tenant had zero technicians and no supported means of
 * acquiring any: six `tech` operations shipped and all six were reads or
 * labour-session state changes. The availability picker returned candidates from
 * a roster nothing could populate, and `BR-01` — resolving a signed-in user to
 * *their* technician profile — had no subject to resolve.
 *
 * ## Scope is decided from the ROW, never from the request
 *
 * Every operation addressed by `technicianProfileId` resolves the profile first
 * and calls `authorizeScope` with the profile's own `companyId`/`branchId`. A
 * caller cannot widen their own authority by naming a different pair, because
 * the pair they name is not consulted. `create` is the single exception and it
 * has to be: there is no row yet, so the body names the target and the
 * permission is evaluated against exactly that pair before the insert.
 *
 * ## What this service will NOT do
 *
 * There is no self-service path. A technician does not edit their own roster
 * record, set their own skill level, or record their own certification — a
 * technician who could would be able to make themselves eligible for work
 * `ERR-TECH-001` should refuse them. Eligibility is administered.
 *
 * And nothing here resolves `iam.current_user_id()` to a technician profile.
 * That is `BR-01`, deliberately not anticipated: a half-built identity path is
 * worse than none, because the next screen would trust it.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import { pageRequest, type Page } from '@/server/db/pagination';
import { appendAudit } from '@/server/audit/audit';
import {
  TECHNICIAN_ROSTER_ORDER,
  type AvailabilityWindowRow,
  type CatalogueKind,
  type HeldCertificationDetailRow,
  type HeldSkillDetailRow,
  type RosterProfileRow,
  type TechnicianRosterRepository,
} from '../data/technician-roster-repository';
import type { TechnicianCatalogRepository } from '../data/technician-catalog-repository';
import type { HeldCertificationRow, HeldSkillRow } from '../data/technician-catalog-repository';
import type { AvailabilityKind, CertificationStatus } from '../domain/technician';

export interface TechnicianProfileView {
  readonly id: string;
  readonly userId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly trade: string | null;
  readonly employmentRef: string | null;
  readonly isActive: boolean;
  readonly recordVersion: number;
}

export interface TechnicianProfileDetail {
  readonly profile: TechnicianProfileView;
  readonly skills: readonly HeldSkillRow[];
  readonly certifications: readonly HeldCertificationRow[];
  readonly availability: readonly AvailabilityWindowView[];
}

export interface HeldSkillView {
  readonly id: string;
  readonly skillId: string;
  readonly skillLevelId: string;
  readonly recordVersion: number;
}

export interface HeldCertificationView {
  readonly id: string;
  readonly certificationId: string;
  readonly issuedOn: string;
  readonly expiresOn: string | null;
  readonly certStatus: string;
  readonly recordVersion: number;
}

export interface AvailabilityWindowView {
  readonly id: string;
  readonly availableFrom: string;
  readonly availableTo: string;
  readonly availabilityKind: string;
  readonly reason: string | null;
  readonly recordVersion: number;
}

export interface CertificateNumberView {
  readonly id: string;
  readonly technicianCertificationId: string;
  readonly certificateNumber: string;
  readonly recordVersion: number;
}

/** Detail shows current and upcoming windows; the full history is unbounded. */
const MAX_DETAIL_AVAILABILITY = 100;

const view = (row: RosterProfileRow): TechnicianProfileView => ({
  id: row.id,
  userId: row.userId,
  companyId: row.companyId,
  branchId: row.branchId,
  trade: row.trade,
  employmentRef: row.employmentRef,
  isActive: row.isActive,
  recordVersion: row.recordVersion,
});

const invalid = (path: string, rule: string, message: string): AppFailure =>
  new AppFailure('ERR-VAL-001', {
    message,
    safeDetails: { violations: [{ path, rule }] },
  });

export class TechnicianRosterService extends ApplicationService {
  protected readonly module = 'technician';

  constructor(
    private readonly roster: TechnicianRosterRepository,
    private readonly catalog: TechnicianCatalogRepository
  ) {
    super();
  }

  // -------------------------------------------------------------------------
  // Shared resolution
  // -------------------------------------------------------------------------

  /**
   * Resolves a profile and re-decides the permission against the profile's own
   * scope.
   *
   * A profile that is absent, retired, or invisible under RLS is `ERR-RES-001`
   * — the same answer for all three, because distinguishing them would disclose
   * that a technician exists somewhere the caller cannot read.
   *
   * A profile the caller CAN see but has no technician authority over is
   * `ERR-IAM-001` from `authorizeScope`, not a second 404. That is the shipped
   * `bil.invoice-read` shape — load, then re-decide against the row's own
   * company and branch — and pretending otherwise here would mean catching a
   * denial and reporting it as absence, which hides a real authorization
   * failure from the caller and from the logs.
   *
   * Which of the two a caller gets is a property of their GRANT UNION rather
   * than of the branch: `app.branch_ids` is the permission-blind union of every
   * active grant (P1-18-A-01), so a principal holding some unrelated permission
   * in a branch sees its rows and is refused at this line, while one holding
   * nothing there never sees them at all. That is precisely why the scope
   * decision cannot be left to RLS.
   */
  private async requireProfile(
    db: DbHandle,
    technicianProfileId: string,
    authorizeScope: ScopeAuthorizer | undefined,
    lock: boolean
  ): Promise<RosterProfileRow> {
    const profile = lock
      ? await this.roster.lockProfile(db, technicianProfileId)
      : await this.roster.readProfile(db, technicianProfileId);
    if (profile === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Technician ${technicianProfileId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: profile.companyId, branchId: profile.branchId });
    }
    return profile;
  }

  /** Refuses a catalogue id the caller's tenant may not reference. */
  private async requireCatalogue(
    db: DbHandle,
    kind: CatalogueKind,
    id: string,
    path: string
  ): Promise<void> {
    if (!(await this.roster.catalogueVisible(db, kind, id))) {
      throw invalid(path, 'catalogue-not-visible', `${kind} ${id} is not available to this tenant`);
    }
  }

  // -------------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------------

  async createProfile(
    db: DbHandle,
    input: {
      readonly userId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly trade?: string | undefined;
      readonly employmentRef?: string | undefined;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<TechnicianProfileView> {
    // The one operation whose target comes from the body: there is no row yet.
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: input.companyId, branchId: input.branchId });
    }
    if (!(await this.roster.userExistsInTenant(db, input.userId))) {
      throw invalid('body.userId', 'unknown-user', 'No such user account in this tenant');
    }
    const existing = await this.roster.liveProfileIdForUser(db, input.userId);
    if (existing !== null) {
      throw new AppFailure('ERR-RES-002', {
        message: `User ${input.userId} already holds technician profile ${existing}`,
        safeDetails: { violations: [{ path: 'body.userId', rule: 'duplicate-active-profile' }] },
      });
    }
    try {
      const created = await this.roster.createProfile(db, input);
      await appendAudit(db, {
        action: 'tech.technician.profile_created',
        entityType: 'tech.technician_profile',
        entityId: created.id,
        companyId: created.companyId,
        branchId: created.branchId,
        details: [{ field: 'user_id', classification: 'internal', value: created.userId }],
      });
      return view(created);
    } catch (error) {
      // The read-then-insert above loses to a concurrent create; the partial
      // unique index does not. Translated so the caller sees the same 409 either
      // way rather than a transaction-aborting SQLSTATE.
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-RES-002', {
          message: `User ${input.userId} already holds a technician profile`,
          safeDetails: { violations: [{ path: 'body.userId', rule: 'duplicate-active-profile' }] },
        });
      }
      throw error;
    }
  }

  async updateProfile(
    db: DbHandle,
    technicianProfileId: string,
    input: {
      readonly trade?: string | null | undefined;
      readonly employmentRef?: string | null | undefined;
      readonly isActive?: boolean | undefined;
      readonly retire?: true | undefined;
      readonly expectedVersion: number;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<TechnicianProfileView> {
    const profile = await this.requireProfile(db, technicianProfileId, authorizeScope, true);

    if (input.retire === true) {
      const retired = await this.roster.retireProfile(db, profile.id, input.expectedVersion);
      if (!retired) {
        throw new AppFailure('ERR-CON-001', {
          message: `Technician ${technicianProfileId} was modified by another request`,
        });
      }
      await appendAudit(db, {
        action: 'tech.technician.profile_retired',
        entityType: 'tech.technician_profile',
        entityId: profile.id,
        companyId: profile.companyId,
        branchId: profile.branchId,
        details: [{ field: 'user_id', classification: 'internal', value: profile.userId }],
      });
      const after = await this.roster.readProfile(db, profile.id);
      return view(after ?? { ...profile, isActive: false });
    }

    const changed = await this.roster.updateProfile(db, profile.id, {
      trade: input.trade ?? undefined,
      employmentRef: input.employmentRef ?? undefined,
      isActive: input.isActive,
      clearTrade: input.trade === null,
      clearEmploymentRef: input.employmentRef === null,
      expectedVersion: input.expectedVersion,
    });
    if (!changed) {
      throw new AppFailure('ERR-CON-001', {
        message: `Technician ${technicianProfileId} was modified by another request`,
      });
    }
    await appendAudit(db, {
      action: 'tech.technician.profile_updated',
      entityType: 'tech.technician_profile',
      entityId: profile.id,
      companyId: profile.companyId,
      branchId: profile.branchId,
      details: [{ field: 'user_id', classification: 'internal', value: profile.userId }],
    });
    const after = await this.roster.readProfile(db, profile.id);
    if (after === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Technician ${technicianProfileId} is not visible`,
      });
    }
    return view(after);
  }

  async listProfiles(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly isActive?: boolean | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    }
  ): Promise<Page<TechnicianProfileView>> {
    const page = await this.roster.pageProfiles(
      db,
      { companyId: filter.companyId, branchId: filter.branchId, isActive: filter.isActive },
      pageRequest(TECHNICIAN_ROSTER_ORDER, { limit: filter.limit, cursor: filter.cursor })
    );
    return { ...page, items: page.items.map(view) };
  }

  /**
   * The aggregate read `INS-24` needs: one call, one screen.
   *
   * It carries no certificate NUMBER. That lives in
   * `tech.technician_certification_details`, whose every policy additionally
   * requires `iam.sensitive.view`; folding it in here would publish restricted
   * data to a caller holding only `tech.technician.read`.
   *
   * It also carries no human name. `tech.technician_profiles` holds none by
   * design — its own comment forbids duplicating personal data — so this returns
   * `userId` and the operational attributes. Resolving that id to a name has no
   * contract in this platform, and inventing one here would be a second identity
   * model beside `iam.user_accounts`.
   */
  async profileDetail(
    db: DbHandle,
    technicianProfileId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<TechnicianProfileDetail> {
    const profile = await this.requireProfile(db, technicianProfileId, authorizeScope, false);
    const [skills, certifications, availability] = await Promise.all([
      this.catalog.heldSkills(db, profile.id),
      this.catalog.heldCertifications(db, profile.id),
      this.roster.upcomingAvailability(db, profile.id, MAX_DETAIL_AVAILABILITY),
    ]);
    return {
      profile: view(profile),
      skills,
      certifications,
      availability: availability.map((row) => this.availabilityView(row)),
    };
  }

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------

  /**
   * Records or replaces a technician's level in one skill.
   *
   * `PUT` because `uq_technician_skills_profile_skill` permits one live row per
   * (profile, skill): re-sending sets, it does not accumulate. `skill_id` is
   * named by the immutability guard, so the replacement path updates the LEVEL
   * of the existing row rather than inserting a second one.
   */
  async setSkill(
    db: DbHandle,
    technicianProfileId: string,
    skillId: string,
    skillLevelId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<HeldSkillView> {
    const profile = await this.requireProfile(db, technicianProfileId, authorizeScope, false);
    await this.requireCatalogue(db, 'skill', skillId, 'path.skillId');
    await this.requireCatalogue(db, 'skillLevel', skillLevelId, 'body.skillLevelId');

    const existing = await this.roster.liveSkill(db, profile.id, skillId);
    let row: HeldSkillDetailRow;
    if (existing === null) {
      row = await this.roster.insertSkill(db, {
        companyId: profile.companyId,
        branchId: profile.branchId,
        technicianProfileId: profile.id,
        skillId,
        skillLevelId,
      });
    } else {
      const moved = await this.roster.updateSkillLevel(db, existing.id, skillLevelId);
      if (!moved) {
        throw new AppFailure('ERR-CON-001', {
          message: `Skill ${skillId} was modified by another request`,
        });
      }
      row = { ...existing, skillLevelId };
    }
    await appendAudit(db, {
      action: 'tech.technician.skill_set',
      entityType: 'tech.technician_skill',
      entityId: row.id,
      companyId: profile.companyId,
      branchId: profile.branchId,
      details: [{ field: 'skill_level_id', classification: 'internal', value: skillLevelId }],
    });
    return row;
  }

  /** Withdraws a held skill. Soft delete: eligibility history stays readable. */
  async withdrawSkill(
    db: DbHandle,
    technicianProfileId: string,
    skillId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<{ readonly withdrawn: true }> {
    const profile = await this.requireProfile(db, technicianProfileId, authorizeScope, false);
    const existing = await this.roster.liveSkill(db, profile.id, skillId);
    if (existing === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Technician ${technicianProfileId} does not hold skill ${skillId}`,
      });
    }
    const done = await this.roster.withdrawSkill(db, existing.id);
    if (!done) {
      throw new AppFailure('ERR-CON-001', {
        message: `Skill ${skillId} was modified by another request`,
      });
    }
    await appendAudit(db, {
      action: 'tech.technician.skill_withdrawn',
      entityType: 'tech.technician_skill',
      entityId: existing.id,
      companyId: profile.companyId,
      branchId: profile.branchId,
      details: [{ field: 'skill_id', classification: 'internal', value: skillId }],
    });
    return { withdrawn: true };
  }

  // -------------------------------------------------------------------------
  // Certifications
  // -------------------------------------------------------------------------

  async recordCertification(
    db: DbHandle,
    technicianProfileId: string,
    input: {
      readonly certificationId: string;
      readonly issuedOn: string;
      readonly expiresOn?: string | undefined;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<HeldCertificationView> {
    const profile = await this.requireProfile(db, technicianProfileId, authorizeScope, false);
    await this.requireCatalogue(db, 'certification', input.certificationId, 'body.certificationId');
    // `ck_technician_certifications_expiry` is `expires_on >= issued_on`. The
    // same condition is refused here first so the caller receives a violation
    // path rather than a transaction-aborting 23514.
    if (input.expiresOn !== undefined && input.expiresOn < input.issuedOn) {
      throw invalid('body.expiresOn', 'before-issued', 'Expiry cannot precede the issue date');
    }
    try {
      const created = await this.roster.insertCertification(db, {
        companyId: profile.companyId,
        branchId: profile.branchId,
        technicianProfileId: profile.id,
        certificationId: input.certificationId,
        issuedOn: input.issuedOn,
        expiresOn: input.expiresOn,
      });
      await appendAudit(db, {
        action: 'tech.technician.certification_recorded',
        entityType: 'tech.technician_certification',
        entityId: created.id,
        companyId: profile.companyId,
        branchId: profile.branchId,
        details: [
          { field: 'certification_id', classification: 'internal', value: input.certificationId },
        ],
      });
      return created;
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-RES-002', {
          message: `Technician already holds certification ${input.certificationId}`,
          safeDetails: {
            violations: [{ path: 'body.certificationId', rule: 'duplicate-certification' }],
          },
        });
      }
      throw error;
    }
  }

  /**
   * Updates the two mutable columns of a held certification.
   *
   * Not in the original BR-03 contract, and added on proof: `cert_status` is
   * `CHECK (cert_status IN ('active','expired','revoked'))` and
   * `technician-eligibility-service.ts:127` refuses a `revoked` credential
   * outright, so without a write path two of the three states are unreachable
   * and that refusal can never fire in production. `certification_id` and
   * `issued_on` are named by the immutability guard and are absent here.
   */
  async updateCertification(
    db: DbHandle,
    technicianProfileId: string,
    certificationId: string,
    input: {
      readonly certStatus?: CertificationStatus | undefined;
      readonly expiresOn?: string | null | undefined;
      readonly expectedVersion: number;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<HeldCertificationView> {
    const profile = await this.requireProfile(db, technicianProfileId, authorizeScope, false);
    const held = await this.requireHeldCertification(db, profile.id, certificationId);
    if (
      input.expiresOn !== undefined &&
      input.expiresOn !== null &&
      input.expiresOn < held.issuedOn
    ) {
      throw invalid('body.expiresOn', 'before-issued', 'Expiry cannot precede the issue date');
    }
    const changed = await this.roster.updateCertification(db, held.id, {
      certStatus: input.certStatus,
      expiresOn: input.expiresOn ?? undefined,
      clearExpiry: input.expiresOn === null,
      expectedVersion: input.expectedVersion,
    });
    if (!changed) {
      throw new AppFailure('ERR-CON-001', {
        message: `Certification ${certificationId} was modified by another request`,
      });
    }
    await appendAudit(db, {
      action: 'tech.technician.certification_updated',
      entityType: 'tech.technician_certification',
      entityId: held.id,
      companyId: profile.companyId,
      branchId: profile.branchId,
      details: [
        {
          field: 'cert_status',
          classification: 'internal',
          value: input.certStatus ?? 'unchanged',
        },
      ],
    });
    const after = await this.roster.lockCertification(db, profile.id, certificationId);
    return after ?? held;
  }

  private async requireHeldCertification(
    db: DbHandle,
    technicianProfileId: string,
    certificationId: string
  ): Promise<HeldCertificationDetailRow> {
    const held = await this.roster.lockCertification(db, technicianProfileId, certificationId);
    if (held === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Technician does not hold certification ${certificationId}`,
      });
    }
    return held;
  }

  /**
   * Records the RESTRICTED certificate number.
   *
   * The operation declares `tech.technician.manage` AND `iam.sensitive.view`,
   * and every policy on the table requires the second independently — the one
   * place in this domain with defence in depth for a permission. The audit row
   * records that a number was set and never the number itself: `iam.audit_records`
   * is not gated by `iam.sensitive.view`, so copying it there would publish it to
   * every auditor. That is the `qms.rework.cost_recorded` precedent.
   */
  async setCertificateNumber(
    db: DbHandle,
    technicianProfileId: string,
    certificationId: string,
    certificateNumber: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<CertificateNumberView> {
    const profile = await this.requireProfile(db, technicianProfileId, authorizeScope, false);
    const held = await this.requireHeldCertification(db, profile.id, certificationId);
    const row = await this.roster.setCertificateNumber(db, {
      companyId: profile.companyId,
      branchId: profile.branchId,
      technicianCertificationId: held.id,
      certificateNumber,
    });
    await appendAudit(db, {
      action: 'tech.technician.certificate_number_recorded',
      entityType: 'tech.technician_certification',
      entityId: held.id,
      details: [{ field: 'classification', classification: 'internal', value: 'restricted' }],
      companyId: profile.companyId,
      branchId: profile.branchId,
    });
    return row;
  }

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------

  /**
   * Records one availability or unavailability window.
   *
   * Overlap is refused by `ex_technician_availability_overlap`, a gist EXCLUDE.
   * It is translated rather than predicted: a read-then-write pre-check would
   * still lose to a concurrent insert, and the constraint is race-safe where the
   * check is not.
   */
  async recordAvailability(
    db: DbHandle,
    technicianProfileId: string,
    input: {
      readonly availableFrom: Date;
      readonly availableTo: Date;
      readonly availabilityKind: AvailabilityKind;
      readonly reason?: string | undefined;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<AvailabilityWindowView> {
    const profile = await this.requireProfile(db, technicianProfileId, authorizeScope, false);
    if (input.availableTo <= input.availableFrom) {
      throw invalid('body.to', 'window-not-positive', 'The window must end after it starts');
    }
    try {
      const created = await this.roster.insertAvailability(db, {
        companyId: profile.companyId,
        branchId: profile.branchId,
        technicianProfileId: profile.id,
        availableFrom: input.availableFrom,
        availableTo: input.availableTo,
        availabilityKind: input.availabilityKind,
        reason: input.reason,
      });
      await appendAudit(db, {
        action: 'tech.technician.availability_recorded',
        entityType: 'tech.technician_availability',
        entityId: created.id,
        companyId: profile.companyId,
        branchId: profile.branchId,
        details: [
          {
            field: 'availability_kind',
            classification: 'internal',
            value: input.availabilityKind,
          },
        ],
      });
      return this.availabilityView(created);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.exclusionViolation)) {
        throw new AppFailure('ERR-RES-002', {
          message: 'The window overlaps an existing availability window for this technician',
          safeDetails: { violations: [{ path: 'body.from', rule: 'overlapping-window' }] },
        });
      }
      throw error;
    }
  }

  /**
   * Withdraws one window, freeing the interval the EXCLUDE constraint holds.
   *
   * Without it a mistyped window would block that interval permanently, because
   * the constraint has no notion of "the wrong one".
   */
  async withdrawAvailability(
    db: DbHandle,
    technicianProfileId: string,
    availabilityId: string,
    expectedVersion: number,
    authorizeScope?: ScopeAuthorizer
  ): Promise<{ readonly withdrawn: true }> {
    const profile = await this.requireProfile(db, technicianProfileId, authorizeScope, false);
    const window = await this.roster.lockAvailability(db, profile.id, availabilityId);
    if (window === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Availability ${availabilityId} is not visible`,
      });
    }
    const done = await this.roster.withdrawAvailability(db, window.id, expectedVersion);
    if (!done) {
      throw new AppFailure('ERR-CON-001', {
        message: `Availability ${availabilityId} was modified by another request`,
      });
    }
    await appendAudit(db, {
      action: 'tech.technician.availability_withdrawn',
      entityType: 'tech.technician_availability',
      entityId: window.id,
      companyId: profile.companyId,
      branchId: profile.branchId,
      details: [
        { field: 'availability_kind', classification: 'internal', value: window.availabilityKind },
      ],
    });
    return { withdrawn: true };
  }

  private availabilityView(row: AvailabilityWindowRow): AvailabilityWindowView {
    return {
      id: row.id,
      availableFrom: row.availableFrom.toISOString(),
      availableTo: row.availableTo.toISOString(),
      availabilityKind: row.availabilityKind,
      reason: row.reason,
      recordVersion: row.recordVersion,
    };
  }
}
