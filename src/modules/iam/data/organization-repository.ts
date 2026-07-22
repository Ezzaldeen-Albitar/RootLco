/**
 * Tenant, company, and branch settings data access (P1-14).
 *
 * Two different shapes, because the protected schema gives them two different
 * shapes and neither can be made to look like the other:
 *
 *  - **`org.tenants` is updated in place.** `app_runtime` holds
 *    `UPDATE (display_name, default_locale, default_timezone)` and nothing else,
 *    so `tenant_code`, `status`, and `record_version` are refused at the
 *    privilege layer. `record_version` is maintained by
 *    `shared.touch_row_metadata()`.
 *  - **`org.company_settings` and `org.branch_settings` are append-only.** Every
 *    column is immutable on UPDATE, and only INSERT is granted. A settings
 *    "change" is therefore a **new version row**, and the current value is the
 *    highest `version` for the key. This is not a workaround for a missing
 *    grant; it is the schema's versioning design, and it is why the DBCR
 *    recorded these two tables as needing nothing.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface TenantRow {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly recordVersion: number;
}

export interface SettingRow {
  readonly id: string;
  readonly settingKey: string;
  readonly settingValue: unknown;
  readonly valueType: 'string' | 'number' | 'boolean' | 'json';
  readonly isSensitive: boolean;
  readonly version: number;
  readonly effectiveFrom: string;
}

export class OrganizationRepository extends Repository {
  protected readonly module = 'iam';

  async readTenant(db: DbHandle): Promise<TenantRow | null> {
    const row = await this.runOne<{
      id: string;
      tenant_code: string;
      display_name: string;
      status: string;
      default_locale: string;
      default_timezone: string;
      record_version: number;
    }>(
      db,
      `SELECT id, tenant_code, display_name, status, default_locale, default_timezone,
              record_version
         FROM org.tenants
        WHERE id = $1`,
      [db.context.principal.tenantId]
    );
    return row
      ? {
          id: row.id,
          tenantCode: row.tenant_code,
          displayName: row.display_name,
          status: row.status,
          defaultLocale: row.default_locale,
          defaultTimezone: row.default_timezone,
          recordVersion: row.record_version,
        }
      : null;
  }

  /** Updates only the three grantable columns, under a version guard. */
  async updateTenant(
    db: DbHandle,
    expectedVersion: number,
    changes: { displayName?: string; defaultLocale?: string; defaultTimezone?: string }
  ): Promise<number> {
    const result = await this.run(
      db,
      `UPDATE org.tenants
          SET display_name     = COALESCE($3, display_name),
              default_locale   = COALESCE($4, default_locale),
              default_timezone = COALESCE($5, default_timezone),
              updated_by       = $6
        WHERE id = $1 AND record_version = $2`,
      [
        db.context.principal.tenantId,
        expectedVersion,
        changes.displayName ?? null,
        changes.defaultLocale ?? null,
        changes.defaultTimezone ?? null,
        db.context.principal.userId,
      ]
    );
    return result.rowCount ?? 0;
  }

  /** True when the company exists inside the caller's tenant and scope. */
  async companyExists(db: DbHandle, companyId: string): Promise<boolean> {
    const row = await this.runOne<{ ok: boolean }>(
      db,
      `SELECT true AS ok FROM org.legal_companies WHERE tenant_id = $1 AND id = $2`,
      [db.context.principal.tenantId, companyId]
    );
    return row?.ok === true;
  }

  /**
   * Resolves a branch to its company, or null when it is not visible.
   *
   * Returning the company rather than a boolean is what lets the service assert
   * "branch belongs to company" without trusting the caller's claim about which
   * company it belongs to.
   */
  async companyOfBranch(db: DbHandle, branchId: string): Promise<string | null> {
    const row = await this.runOne<{ company_id: string }>(
      db,
      `SELECT company_id FROM org.branches WHERE tenant_id = $1 AND id = $2`,
      [db.context.principal.tenantId, branchId]
    );
    return row?.company_id ?? null;
  }

  async currentCompanySettings(db: DbHandle, companyId: string): Promise<readonly SettingRow[]> {
    const result = await this.run<{
      id: string;
      setting_key: string;
      setting_value: unknown;
      value_type: SettingRow['valueType'];
      is_sensitive: boolean;
      version: number;
      effective_from: string;
    }>(
      db,
      `SELECT DISTINCT ON (setting_key)
              id, setting_key, setting_value, value_type, is_sensitive, version, effective_from
         FROM org.company_settings
        WHERE tenant_id = $1 AND company_id = $2
        ORDER BY setting_key, version DESC`,
      [db.context.principal.tenantId, companyId]
    );
    return result.rows.map(toSetting);
  }

  async currentBranchSettings(
    db: DbHandle,
    companyId: string,
    branchId: string
  ): Promise<readonly SettingRow[]> {
    const result = await this.run<{
      id: string;
      setting_key: string;
      setting_value: unknown;
      value_type: SettingRow['valueType'];
      is_sensitive: boolean;
      version: number;
      effective_from: string;
    }>(
      db,
      `SELECT DISTINCT ON (setting_key)
              id, setting_key, setting_value, value_type, is_sensitive, version, effective_from
         FROM org.branch_settings
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
        ORDER BY setting_key, version DESC`,
      [db.context.principal.tenantId, companyId, branchId]
    );
    return result.rows.map(toSetting);
  }

  /**
   * Writes the next version of a company setting.
   *
   * The version is computed inside the statement rather than read-then-written,
   * so two concurrent writers cannot both compute the same next version. The one
   * that loses hits `uq_company_settings_scope_key_version` and is translated
   * into a version conflict by the service — which is the correct answer: its
   * write was based on a value that is no longer current.
   */
  async insertCompanySetting(
    db: DbHandle,
    input: {
      companyId: string;
      settingKey: string;
      settingValue: unknown;
      valueType: SettingRow['valueType'];
      isSensitive: boolean;
    }
  ): Promise<{ id: string; version: number }> {
    const row = await this.runOne<{ id: string; version: number }>(
      db,
      `INSERT INTO org.company_settings
         (tenant_id, company_id, setting_key, setting_value, value_type, is_sensitive,
          version, created_by)
       SELECT $1, $2, $3, $4::jsonb, $5, $6,
              COALESCE(MAX(version), 0) + 1, $7
         FROM org.company_settings
        WHERE tenant_id = $1 AND company_id = $2 AND setting_key = $3
       RETURNING id, version`,
      [
        db.context.principal.tenantId,
        input.companyId,
        input.settingKey,
        JSON.stringify(input.settingValue),
        input.valueType,
        input.isSensitive,
        db.context.principal.userId,
      ]
    );
    return row as { id: string; version: number };
  }

  async insertBranchSetting(
    db: DbHandle,
    input: {
      companyId: string;
      branchId: string;
      settingKey: string;
      settingValue: unknown;
      valueType: SettingRow['valueType'];
      isSensitive: boolean;
    }
  ): Promise<{ id: string; version: number }> {
    const row = await this.runOne<{ id: string; version: number }>(
      db,
      `INSERT INTO org.branch_settings
         (tenant_id, company_id, branch_id, setting_key, setting_value, value_type,
          is_sensitive, version, created_by)
       SELECT $1, $2, $3, $4, $5::jsonb, $6, $7,
              COALESCE(MAX(version), 0) + 1, $8
         FROM org.branch_settings
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND setting_key = $4
       RETURNING id, version`,
      [
        db.context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.settingKey,
        JSON.stringify(input.settingValue),
        input.valueType,
        input.isSensitive,
        db.context.principal.userId,
      ]
    );
    return row as { id: string; version: number };
  }
}

function toSetting(row: {
  id: string;
  setting_key: string;
  setting_value: unknown;
  value_type: SettingRow['valueType'];
  is_sensitive: boolean;
  version: number;
  effective_from: string;
}): SettingRow {
  return {
    id: row.id,
    settingKey: row.setting_key,
    settingValue: row.setting_value,
    valueType: row.value_type,
    isSensitive: row.is_sensitive,
    version: row.version,
    effectiveFrom: row.effective_from,
  };
}
