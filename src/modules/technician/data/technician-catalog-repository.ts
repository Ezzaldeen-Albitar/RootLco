/**
 * Technician catalog and eligibility reads (Phase 1-19, P1-19-BE-001).
 *
 * The only place `tech` catalog SQL is written. Wave 5 adds the assignment and
 * labor-session writes on top of these reads; nothing outside this module touches
 * a `tech.` table.
 *
 * Skills, skill levels and certifications carry the same `scope`/`tenant_id`
 * override shape as the work-order state catalogs, so the platform/tenant
 * precedence is resolved identically — a tenant row shadows the platform row of
 * the same code.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface SkillRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly discipline: string | null;
}

export interface SkillLevelRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly rank: number;
}

export interface CertificationRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly authority: string | null;
  readonly validityMonths: number | null;
  readonly isSafetyCritical: boolean;
}

export interface HeldSkillRow {
  readonly skillId: string;
  readonly skillCode: string;
  readonly skillLevelId: string;
  readonly rank: number;
}

export interface HeldCertificationRow {
  readonly certificationId: string;
  readonly certificationCode: string;
  readonly issuedOn: Date;
  readonly expiresOn: Date | null;
  readonly certStatus: string;
  readonly isSafetyCritical: boolean;
}

export interface AvailabilityRow {
  readonly availableFrom: Date;
  readonly availableTo: Date;
  readonly availabilityKind: string;
  readonly reason: string | null;
}

export interface TechnicianProfileRow {
  readonly id: string;
  readonly userId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly trade: string | null;
  readonly isActive: boolean;
}

export class TechnicianCatalogRepository extends Repository {
  protected readonly module = 'technician';

  /** Active skills visible to the caller's tenant, tenant rows shadowing platform. */
  async skills(db: DbHandle): Promise<readonly SkillRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      code: string;
      name: string;
      discipline: string | null;
    }>(
      db,
      `SELECT DISTINCT ON (code) id, code, name, discipline
         FROM tech.skills
        WHERE (scope = 'platform' OR tenant_id = $1)
          AND status = 'active' AND deleted_at IS NULL
        ORDER BY code, (scope = 'tenant') DESC`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      discipline: row.discipline,
    }));
  }

  /** Active skill levels with their ranks. */
  async skillLevels(db: DbHandle): Promise<readonly SkillLevelRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string; code: string; name: string; rank: number }>(
      db,
      `SELECT DISTINCT ON (code) id, code, name, rank
         FROM tech.skill_levels
        WHERE (scope = 'platform' OR tenant_id = $1)
          AND status = 'active' AND deleted_at IS NULL
        ORDER BY code, (scope = 'tenant') DESC`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      rank: row.rank,
    }));
  }

  /** Active certifications, including whether each gates safety-critical work. */
  async certifications(db: DbHandle): Promise<readonly CertificationRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      code: string;
      name: string;
      authority: string | null;
      validity_months: number | null;
      is_safety_critical: boolean;
    }>(
      db,
      `SELECT DISTINCT ON (code) id, code, name, authority, validity_months, is_safety_critical
         FROM tech.certifications
        WHERE (scope = 'platform' OR tenant_id = $1)
          AND status = 'active' AND deleted_at IS NULL
        ORDER BY code, (scope = 'tenant') DESC`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      authority: row.authority,
      validityMonths: row.validity_months,
      isSafetyCritical: row.is_safety_critical,
    }));
  }

  /**
   * The technician profile, or null when it does not exist or is out of the
   * caller's RLS-visible scope. Null is deliberately indistinguishable between
   * those two cases at this layer — the service decides what to disclose.
   */
  async profile(db: DbHandle, technicianProfileId: string): Promise<TechnicianProfileRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      user_id: string;
      company_id: string;
      branch_id: string;
      trade: string | null;
      is_active: boolean;
    }>(
      db,
      `SELECT id, user_id, company_id, branch_id, trade, is_active
         FROM tech.technician_profiles
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, technicianProfileId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          companyId: row.company_id,
          branchId: row.branch_id,
          trade: row.trade,
          isActive: row.is_active,
        }
      : null;
  }

  /** Skills held by one technician, with the rank of each held level. */
  async heldSkills(db: DbHandle, technicianProfileId: string): Promise<readonly HeldSkillRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      skill_id: string;
      skill_code: string;
      skill_level_id: string;
      rank: number;
    }>(
      db,
      `SELECT ts.skill_id, s.code AS skill_code, ts.skill_level_id, sl.rank
         FROM tech.technician_skills ts
         JOIN tech.skills s ON s.id = ts.skill_id AND s.deleted_at IS NULL
         JOIN tech.skill_levels sl ON sl.id = ts.skill_level_id AND sl.deleted_at IS NULL
        WHERE ts.tenant_id = $1 AND ts.technician_profile_id = $2 AND ts.deleted_at IS NULL`,
      [context.principal.tenantId, technicianProfileId]
    );
    return result.rows.map((row) => ({
      skillId: row.skill_id,
      skillCode: row.skill_code,
      skillLevelId: row.skill_level_id,
      rank: row.rank,
    }));
  }

  /**
   * Certifications held by one technician.
   *
   * `cert_status` is returned as stored rather than recomputed here. Expiry is
   * decided by `certificationIsValidOn` against the work instant, because a row
   * may still read `active` on the day it lapses — the status column records an
   * administrative fact, the date decides validity.
   */
  async heldCertifications(
    db: DbHandle,
    technicianProfileId: string
  ): Promise<readonly HeldCertificationRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      certification_id: string;
      certification_code: string;
      issued_on: Date;
      expires_on: Date | null;
      cert_status: string;
      is_safety_critical: boolean;
    }>(
      db,
      `SELECT tc.certification_id, c.code AS certification_code, tc.issued_on,
              tc.expires_on, tc.cert_status, c.is_safety_critical
         FROM tech.technician_certifications tc
         JOIN tech.certifications c ON c.id = tc.certification_id AND c.deleted_at IS NULL
        WHERE tc.tenant_id = $1 AND tc.technician_profile_id = $2 AND tc.deleted_at IS NULL`,
      [context.principal.tenantId, technicianProfileId]
    );
    return result.rows.map((row) => ({
      certificationId: row.certification_id,
      certificationCode: row.certification_code,
      issuedOn: row.issued_on,
      expiresOn: row.expires_on,
      certStatus: row.cert_status,
      isSafetyCritical: row.is_safety_critical,
    }));
  }

  /** Availability rows intersecting a window, both `available` and `unavailable`. */
  async availability(
    db: DbHandle,
    technicianProfileId: string,
    windowFrom: Date,
    windowTo: Date
  ): Promise<readonly AvailabilityRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      available_from: Date;
      available_to: Date;
      availability_kind: string;
      reason: string | null;
    }>(
      db,
      `SELECT available_from, available_to, availability_kind, reason
         FROM tech.technician_availability
        WHERE tenant_id = $1 AND technician_profile_id = $2 AND deleted_at IS NULL
          AND available_from < $4 AND $3 < available_to
        ORDER BY available_from`,
      [context.principal.tenantId, technicianProfileId, windowFrom, windowTo]
    );
    return result.rows.map((row) => ({
      availableFrom: row.available_from,
      availableTo: row.available_to,
      availabilityKind: row.availability_kind,
      reason: row.reason,
    }));
  }
}
