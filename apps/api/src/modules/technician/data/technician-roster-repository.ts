/**
 * Technician roster writes (BR-03, PRE-P1-29 backend remediation).
 *
 * `technician-catalog-repository.ts` reads the roster; this writes it. They are
 * separate files rather than one because the read side is Phase 1-19's and is
 * consumed by eligibility on every assignment, while these statements exist only
 * for administration — and a reader looking for "what can change a technician"
 * should find one file, not a section.
 *
 * ## Three columns, and the trigger that decides so
 *
 * `tg_technician_profiles_immutable` guards
 * `tenant_id, company_id, branch_id, user_id, created_at, created_by`, so the
 * writable surface of a technician profile is exactly `trade`, `is_active` and
 * `employment_ref`. The UPDATE below names those three and nothing else: a
 * service defect cannot reach a guarded column, because the statement has no
 * word for it. That is the same reason `wo.job-update`'s statement omits `state`.
 *
 * ## A branch transfer is not an UPDATE
 *
 * `branch_id` is immutable and
 * `uq_technician_profiles_active_user (tenant_id, user_id) WHERE deleted_at IS NULL`
 * permits one live profile per user per tenant. So moving a technician is
 * `retire` then `create`, in that order, and the order is forced rather than
 * preferred — creating first raises `23505`. The retired row survives with its
 * `deleted_at`/`deleted_by`, so every labour session and assignment that named it
 * still resolves. A mutable `branch_id` would have silently rewritten the branch
 * attribution of every historical labour record.
 *
 * ## Why a catalogue scope check lives here
 *
 * `fk_technician_skills_skill`, `fk_technician_skills_level` and
 * `fk_technician_certifications_cert` are SINGLE-column foreign keys, because a
 * platform catalogue row carries `tenant_id IS NULL` and cannot participate in
 * the composite. The database therefore cannot prove a tenant is referencing a
 * catalogue row it is entitled to, and it is the only place in this slice where
 * that is true. `catalogueScope` is that proof.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPage,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';

/** Newest profile first, tie-broken by id, so the order is total. */
export const TECHNICIAN_ROSTER_ORDER: OrderingContract = Object.freeze({
  key: 'tech.technician_profiles:created_at_desc',
  direction: 'desc',
});

export interface RosterProfileRow {
  readonly id: string;
  readonly userId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly trade: string | null;
  readonly employmentRef: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly recordVersion: number;
}

export interface HeldSkillDetailRow {
  readonly id: string;
  readonly skillId: string;
  readonly skillLevelId: string;
  readonly recordVersion: number;
}

export interface HeldCertificationDetailRow {
  readonly id: string;
  readonly certificationId: string;
  readonly issuedOn: string;
  readonly expiresOn: string | null;
  readonly certStatus: string;
  readonly recordVersion: number;
}

export interface AvailabilityWindowRow {
  readonly id: string;
  readonly availableFrom: Date;
  readonly availableTo: Date;
  readonly availabilityKind: string;
  readonly reason: string | null;
  readonly recordVersion: number;
}

export interface CertificateNumberRow {
  readonly id: string;
  readonly technicianCertificationId: string;
  readonly certificateNumber: string;
  readonly recordVersion: number;
}

/** Which catalogue a scope check is being asked about. */
export type CatalogueKind = 'skill' | 'skillLevel' | 'certification';

const CATALOGUE_TABLE: Readonly<Record<CatalogueKind, string>> = Object.freeze({
  skill: 'tech.skills',
  skillLevel: 'tech.skill_levels',
  certification: 'tech.certifications',
});

/*
 * `created_at` is rendered at MICROSECOND precision for the cursor. A JS `Date`
 * holds milliseconds and PostgreSQL stores microseconds, so a cursor minted from
 * the decoded value is STRICTLY EARLIER than the stored one and the keyset
 * predicate silently skips every row sharing that millisecond (`P1-27-INT-006`).
 * A roster created by one provisioning transaction shares an instant by
 * construction, so this is a certainty here rather than a race.
 */
const PROFILE_COLUMNS = `id, user_id, company_id, branch_id, trade, employment_ref, is_active,
  ${cursorTimestamp('created_at')} AS created_at_cursor, created_at, record_version`;

interface ProfileColumns {
  id: string;
  user_id: string;
  company_id: string;
  branch_id: string;
  trade: string | null;
  employment_ref: string | null;
  is_active: boolean;
  created_at_cursor: string;
  created_at: Date;
  record_version: number;
}

const toProfile = (row: ProfileColumns): RosterProfileRow => ({
  id: row.id,
  userId: row.user_id,
  companyId: row.company_id,
  branchId: row.branch_id,
  trade: row.trade,
  employmentRef: row.employment_ref,
  isActive: row.is_active,
  createdAt: row.created_at,
  recordVersion: row.record_version,
});

export class TechnicianRosterRepository extends Repository {
  protected readonly module = 'technician';

  // -------------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------------

  /**
   * Inserts a technician profile.
   *
   * `is_active` is not a parameter: a created profile is active. Offering the
   * column here would let an administrator create a roster row that is inert on
   * arrival, which is a state with no stated purpose and one more thing for a
   * reader of `tech.technician-available` to explain.
   */
  async createProfile(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly userId: string;
      readonly trade?: string | undefined;
      readonly employmentRef?: string | undefined;
    }
  ): Promise<RosterProfileRow> {
    const context = this.assertContext(db);
    const result = await this.run<ProfileColumns>(
      db,
      `INSERT INTO tech.technician_profiles
         (tenant_id, company_id, branch_id, user_id, trade, employment_ref, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${PROFILE_COLUMNS}`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.userId,
        input.trade ?? null,
        input.employmentRef ?? null,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('technician profile insert returned no row');
    return toProfile(row);
  }

  /** Locks one live profile, or null when absent or out of scope. */
  async lockProfile(db: DbHandle, technicianProfileId: string): Promise<RosterProfileRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<ProfileColumns>(
      db,
      `SELECT ${PROFILE_COLUMNS}
         FROM tech.technician_profiles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, technicianProfileId]
    );
    const row = result.rows[0];
    return row ? toProfile(row) : null;
  }

  /** Reads one live profile without locking it. */
  async readProfile(db: DbHandle, technicianProfileId: string): Promise<RosterProfileRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<ProfileColumns>(
      db,
      `SELECT ${PROFILE_COLUMNS}
         FROM tech.technician_profiles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, technicianProfileId]
    );
    const row = result.rows[0];
    return row ? toProfile(row) : null;
  }

  /**
   * Updates the three writable columns under optimistic concurrency.
   *
   * `COALESCE($n, column)` leaves an omitted field alone. The statement names no
   * guarded column, so `tg_technician_profiles_immutable` is a backstop here
   * rather than the control — which is the correct order for a guard.
   */
  async updateProfile(
    db: DbHandle,
    technicianProfileId: string,
    input: {
      readonly trade?: string | null | undefined;
      readonly employmentRef?: string | null | undefined;
      readonly isActive?: boolean | undefined;
      readonly clearTrade: boolean;
      readonly clearEmploymentRef: boolean;
      readonly expectedVersion: number;
    }
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE tech.technician_profiles
          SET trade = CASE WHEN $5 THEN NULL ELSE COALESCE($4, trade) END,
              employment_ref = CASE WHEN $7 THEN NULL ELSE COALESCE($6, employment_ref) END,
              is_active = COALESCE($8, is_active),
              updated_by = $3
        WHERE tenant_id = $1 AND id = $2 AND record_version = $9 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        technicianProfileId,
        context.principal.userId,
        input.trade ?? null,
        input.clearTrade,
        input.employmentRef ?? null,
        input.clearEmploymentRef,
        input.isActive ?? null,
        input.expectedVersion,
      ]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * Retires a profile: soft-delete, which frees the
   * `uq_technician_profiles_active_user` slot so the person can be profiled in
   * another branch. Distinct from deactivation, which leaves the row live.
   */
  async retireProfile(
    db: DbHandle,
    technicianProfileId: string,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE tech.technician_profiles
          SET deleted_at = now(), deleted_by = $3, is_active = false, updated_by = $3
        WHERE tenant_id = $1 AND id = $2 AND record_version = $4 AND deleted_at IS NULL`,
      [context.principal.tenantId, technicianProfileId, context.principal.userId, expectedVersion]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** True when the user already holds a live profile in this tenant. */
  async liveProfileIdForUser(db: DbHandle, userId: string): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT id FROM tech.technician_profiles
        WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, userId]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * True when the user account exists in the caller's tenant.
   *
   * Deliberately does NOT check `status`. A roster is an operational record and
   * an administrator may legitimately profile somebody whose account is still
   * `invited`; `iam.has_permission` already refuses that account at request
   * time, so duplicating the check here would refuse a legal administrative act
   * for a reason that is not this table's to hold.
   */
  async userExistsInTenant(db: DbHandle, userId: string): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run<{ one: number }>(
      db,
      `SELECT 1 AS one FROM iam.user_accounts WHERE tenant_id = $1 AND id = $2`,
      [context.principal.tenantId, userId]
    );
    return result.rows.length === 1;
  }

  /** One keyset page of a branch's roster, newest first. */
  async pageProfiles(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly isActive?: boolean | undefined;
    },
    page: PageRequest
  ): Promise<Page<RosterProfileRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.isActive ?? null,
    ];
    const keyset = keysetFragment(
      page,
      { sort: 'created_at', id: 'id' },
      TECHNICIAN_ROSTER_ORDER,
      values.length + 1
    );
    const result = await this.run<ProfileColumns>(
      db,
      `SELECT ${PROFILE_COLUMNS}
         FROM tech.technician_profiles
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND deleted_at IS NULL
          AND ($4::boolean IS NULL OR is_active = $4)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows = result.rows.map((row) => ({ ...toProfile(row), cursor: row.created_at_cursor }));
    return buildPage(rows, page, TECHNICIAN_ROSTER_ORDER, (row) => ({
      sortValue: row.cursor,
      id: row.id,
    }));
  }

  // -------------------------------------------------------------------------
  // Catalogue scope — the check the foreign keys cannot make
  // -------------------------------------------------------------------------

  /**
   * True when the catalogue row is visible to this tenant: a platform row, or a
   * tenant row belonging to the caller. Also refuses an inactive catalogue entry
   * — attaching a retired skill would create an eligibility fact nobody can
   * satisfy on purpose.
   */
  async catalogueVisible(db: DbHandle, kind: CatalogueKind, id: string): Promise<boolean> {
    const context = this.assertContext(db);
    const table = CATALOGUE_TABLE[kind];
    const result = await this.run<{ one: number }>(
      db,
      `SELECT 1 AS one FROM ${table}
        WHERE id = $2
          AND deleted_at IS NULL
          AND status = 'active'
          AND (scope = 'platform' OR tenant_id = $1)`,
      [context.principal.tenantId, id]
    );
    return result.rows.length === 1;
  }

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------

  /** The live skill row for one (profile, skill), or null. */
  async liveSkill(
    db: DbHandle,
    technicianProfileId: string,
    skillId: string
  ): Promise<HeldSkillDetailRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      skill_id: string;
      skill_level_id: string;
      record_version: number;
    }>(
      db,
      `SELECT id, skill_id, skill_level_id, record_version
         FROM tech.technician_skills
        WHERE tenant_id = $1 AND technician_profile_id = $2 AND skill_id = $3
          AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, technicianProfileId, skillId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          skillId: row.skill_id,
          skillLevelId: row.skill_level_id,
          recordVersion: row.record_version,
        }
      : null;
  }

  async insertSkill(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly technicianProfileId: string;
      readonly skillId: string;
      readonly skillLevelId: string;
    }
  ): Promise<HeldSkillDetailRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      skill_id: string;
      skill_level_id: string;
      record_version: number;
    }>(
      db,
      `INSERT INTO tech.technician_skills
         (tenant_id, company_id, branch_id, technician_profile_id, skill_id, skill_level_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, skill_id, skill_level_id, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.technicianProfileId,
        input.skillId,
        input.skillLevelId,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('technician skill insert returned no row');
    return {
      id: row.id,
      skillId: row.skill_id,
      skillLevelId: row.skill_level_id,
      recordVersion: row.record_version,
    };
  }

  /** Moves an existing held skill to a different level. `skill_id` is immutable. */
  async updateSkillLevel(db: DbHandle, skillRowId: string, skillLevelId: string): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE tech.technician_skills
          SET skill_level_id = $3, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, skillRowId, skillLevelId, context.principal.userId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** Withdraws a held skill. Soft delete: the eligibility history stays readable. */
  async withdrawSkill(db: DbHandle, skillRowId: string): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE tech.technician_skills
          SET deleted_at = now(), deleted_by = $3, updated_by = $3
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, skillRowId, context.principal.userId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  // -------------------------------------------------------------------------
  // Certifications
  // -------------------------------------------------------------------------

  async insertCertification(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly technicianProfileId: string;
      readonly certificationId: string;
      readonly issuedOn: string;
      readonly expiresOn?: string | undefined;
    }
  ): Promise<HeldCertificationDetailRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      certification_id: string;
      issued_on: string;
      expires_on: string | null;
      cert_status: string;
      record_version: number;
    }>(
      db,
      `INSERT INTO tech.technician_certifications
         (tenant_id, company_id, branch_id, technician_profile_id, certification_id,
          issued_on, expires_on, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8)
       RETURNING id, certification_id, issued_on::text AS issued_on,
                 expires_on::text AS expires_on, cert_status, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.technicianProfileId,
        input.certificationId,
        input.issuedOn,
        input.expiresOn ?? null,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('technician certification insert returned no row');
    return {
      id: row.id,
      certificationId: row.certification_id,
      issuedOn: row.issued_on,
      expiresOn: row.expires_on,
      certStatus: row.cert_status,
      recordVersion: row.record_version,
    };
  }

  /** Locks one live held certification of a profile, by catalogue id. */
  async lockCertification(
    db: DbHandle,
    technicianProfileId: string,
    certificationId: string
  ): Promise<HeldCertificationDetailRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      certification_id: string;
      issued_on: string;
      expires_on: string | null;
      cert_status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, certification_id, issued_on::text AS issued_on,
              expires_on::text AS expires_on, cert_status, record_version
         FROM tech.technician_certifications
        WHERE tenant_id = $1 AND technician_profile_id = $2 AND certification_id = $3
          AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, technicianProfileId, certificationId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          certificationId: row.certification_id,
          issuedOn: row.issued_on,
          expiresOn: row.expires_on,
          certStatus: row.cert_status,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * Updates the two mutable columns of a held certification.
   *
   * `issued_on` and `certification_id` are named by
   * `tg_technician_certifications_immutable`, so the statement omits them. The
   * `expires_on >= issued_on` CHECK is the database's; the service refuses the
   * same condition first so the caller receives a violation path rather than a
   * `23514`.
   */
  async updateCertification(
    db: DbHandle,
    certificationRowId: string,
    input: {
      readonly certStatus?: string | undefined;
      readonly expiresOn?: string | null | undefined;
      readonly clearExpiry: boolean;
      readonly expectedVersion: number;
    }
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE tech.technician_certifications
          SET cert_status = COALESCE($4, cert_status),
              expires_on = CASE WHEN $6 THEN NULL ELSE COALESCE($5::date, expires_on) END,
              updated_by = $3
        WHERE tenant_id = $1 AND id = $2 AND record_version = $7 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        certificationRowId,
        context.principal.userId,
        input.certStatus ?? null,
        input.expiresOn ?? null,
        input.clearExpiry,
        input.expectedVersion,
      ]
    );
    return (result.rowCount ?? 0) === 1;
  }

  // -------------------------------------------------------------------------
  // The restricted certificate number
  // -------------------------------------------------------------------------

  /**
   * Records or replaces the restricted certificate number.
   *
   * Every statement against this table runs under RLS policies that additionally
   * require `iam.has_permission('iam.sensitive.view')`, so the conjunction on
   * the operation is the intent and the policy is the guarantee — the one place
   * in this domain with defence in depth for a permission.
   */
  async setCertificateNumber(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly technicianCertificationId: string;
      readonly certificateNumber: string;
    }
  ): Promise<CertificateNumberRow> {
    const context = this.assertContext(db);
    const existing = await this.run<{ id: string }>(
      db,
      `SELECT id FROM tech.technician_certification_details
        WHERE tenant_id = $1 AND technician_certification_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, input.technicianCertificationId]
    );
    const found = existing.rows[0];
    const result = found
      ? await this.run<{
          id: string;
          technician_certification_id: string;
          certificate_number: string;
          record_version: number;
        }>(
          db,
          `UPDATE tech.technician_certification_details
              SET certificate_number = $3, updated_by = $4
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
            RETURNING id, technician_certification_id, certificate_number, record_version`,
          [context.principal.tenantId, found.id, input.certificateNumber, context.principal.userId]
        )
      : await this.run<{
          id: string;
          technician_certification_id: string;
          certificate_number: string;
          record_version: number;
        }>(
          db,
          `INSERT INTO tech.technician_certification_details
             (tenant_id, company_id, branch_id, technician_certification_id,
              certificate_number, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, technician_certification_id, certificate_number, record_version`,
          [
            context.principal.tenantId,
            input.companyId,
            input.branchId,
            input.technicianCertificationId,
            input.certificateNumber,
            context.principal.userId,
          ]
        );
    const row = result.rows[0];
    if (row === undefined) throw new Error('certificate number write returned no row');
    return {
      id: row.id,
      technicianCertificationId: row.technician_certification_id,
      certificateNumber: row.certificate_number,
      recordVersion: row.record_version,
    };
  }

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------

  /**
   * Inserts one availability window.
   *
   * Overlap is refused by `ex_technician_availability_overlap`, a gist EXCLUDE
   * raising `23P01`. It is race-safe in a way an application read-then-write
   * check is not, so the service translates the SQLSTATE rather than trying to
   * predict it — a pre-check would still lose to a concurrent insert.
   */
  async insertAvailability(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly technicianProfileId: string;
      readonly availableFrom: Date;
      readonly availableTo: Date;
      readonly availabilityKind: string;
      readonly reason?: string | undefined;
    }
  ): Promise<AvailabilityWindowRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      available_from: Date;
      available_to: Date;
      availability_kind: string;
      reason: string | null;
      record_version: number;
    }>(
      db,
      `INSERT INTO tech.technician_availability
         (tenant_id, company_id, branch_id, technician_profile_id,
          available_from, available_to, availability_kind, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, available_from, available_to, availability_kind, reason, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.technicianProfileId,
        input.availableFrom,
        input.availableTo,
        input.availabilityKind,
        input.reason ?? null,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('technician availability insert returned no row');
    return {
      id: row.id,
      availableFrom: row.available_from,
      availableTo: row.available_to,
      availabilityKind: row.availability_kind,
      reason: row.reason,
      recordVersion: row.record_version,
    };
  }

  /**
   * Current and future availability windows for one profile, bounded.
   *
   * `technician-catalog-repository.availability()` cannot serve this: it takes a
   * window because it answers an eligibility question ("is this technician free
   * between these two instants"). An administrator opening a roster record is
   * asking a different one, and there is no window to give.
   *
   * Bounded to windows that have not yet ended, and capped. A profile's full
   * availability history is unbounded and grows forever; an administrative read
   * that returned all of it would be the unbounded list this repository does not
   * ship anywhere else. What is NOT offered is deliberate: past windows are
   * readable only through the eligibility read that names them.
   */
  async upcomingAvailability(
    db: DbHandle,
    technicianProfileId: string,
    limit: number
  ): Promise<readonly AvailabilityWindowRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      available_from: Date;
      available_to: Date;
      availability_kind: string;
      reason: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, available_from, available_to, availability_kind, reason, record_version
         FROM tech.technician_availability
        WHERE tenant_id = $1 AND technician_profile_id = $2
          AND deleted_at IS NULL AND available_to > now()
        ORDER BY available_from ASC, id ASC
        LIMIT $3`,
      [context.principal.tenantId, technicianProfileId, limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      availableFrom: row.available_from,
      availableTo: row.available_to,
      availabilityKind: row.availability_kind,
      reason: row.reason,
      recordVersion: row.record_version,
    }));
  }

  /** Withdraws one availability window, freeing the interval it excluded. */
  async withdrawAvailability(
    db: DbHandle,
    availabilityId: string,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE tech.technician_availability
          SET deleted_at = now(), deleted_by = $3, updated_by = $3
        WHERE tenant_id = $1 AND id = $2 AND record_version = $4 AND deleted_at IS NULL`,
      [context.principal.tenantId, availabilityId, context.principal.userId, expectedVersion]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** One availability window by id, scoped to a profile. */
  async lockAvailability(
    db: DbHandle,
    technicianProfileId: string,
    availabilityId: string
  ): Promise<AvailabilityWindowRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      available_from: Date;
      available_to: Date;
      availability_kind: string;
      reason: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, available_from, available_to, availability_kind, reason, record_version
         FROM tech.technician_availability
        WHERE tenant_id = $1 AND technician_profile_id = $2 AND id = $3 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, technicianProfileId, availabilityId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          availableFrom: row.available_from,
          availableTo: row.available_to,
          availabilityKind: row.availability_kind,
          reason: row.reason,
          recordVersion: row.record_version,
        }
      : null;
  }
}
