/**
 * Tenant, company, and branch settings administration (P1-14).
 *
 * Two write shapes, because the schema has two:
 *
 *  - the tenant row is **updated in place** under an optimistic-concurrency
 *    guard, and only its three grantable columns can move;
 *  - company and branch settings are **append-only versioned rows**. Writing a
 *    setting inserts the next `version` for that key; the current value is the
 *    highest version. Nothing is ever mutated, so the history is the audit.
 *
 * ## No policy defaults are invented
 *
 * A settings endpoint is where a country default, a tax rule, a currency, or a
 * retention period would quietly acquire a value nobody approved. This service
 * writes exactly the key and value the caller supplies, validated for shape and
 * type, and supplies **no defaults of its own**. `org.validate_setting_value()`
 * checks the value against its declared `value_type` on INSERT, which is the
 * authority for whether a value is well-formed. What a given key *means* is a
 * decision for the phase that owns it.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { assertVersionMatched } from '@/server/db/concurrency';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import {
  OrganizationRepository,
  type SettingRow,
  type TenantRow,
} from '../data/organization-repository';
import { DelegationPolicy } from '../domain/delegation-policy';
import { AuthorizationRepository } from '../data/authorization-repository';

export interface TenantSettingsView {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly recordVersion: number;
}

/**
 * A setting as returned to a caller.
 *
 * `is_sensitive` settings have their **value withheld**, not masked in place:
 * returning a partially-redacted value still discloses its shape and length. The
 * caller is told the key exists and is sensitive, which is what an administrator
 * needs in order to know a value is configured.
 */
export interface SettingView {
  readonly settingKey: string;
  readonly valueType: string;
  readonly isSensitive: boolean;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly settingValue?: unknown;
}

function toSettingView(row: SettingRow, mayReadSensitive: boolean): SettingView {
  const base = {
    settingKey: row.settingKey,
    valueType: row.valueType,
    isSensitive: row.isSensitive,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
  };
  if (row.isSensitive && !mayReadSensitive) return base;
  return { ...base, settingValue: row.settingValue };
}

function toTenantView(row: TenantRow): TenantSettingsView {
  return {
    id: row.id,
    tenantCode: row.tenantCode,
    displayName: row.displayName,
    status: row.status,
    defaultLocale: row.defaultLocale,
    defaultTimezone: row.defaultTimezone,
    recordVersion: row.recordVersion,
  };
}

export class OrganizationSettingsService extends ApplicationService {
  protected readonly module = 'iam';

  constructor(
    private readonly organization: OrganizationRepository,
    private readonly authorization: AuthorizationRepository,
    private readonly delegationPolicy: DelegationPolicy
  ) {
    super();
  }

  async readTenant(db: DbHandle): Promise<TenantSettingsView> {
    const tenant = await this.organization.readTenant(db);
    if (!tenant) {
      // The context resolved but the tenant row is invisible: RLS default-deny.
      throw new AppFailure('ERR-CTX-001', {
        message: 'Resolved tenant is not visible under the session context',
      });
    }
    return toTenantView(tenant);
  }

  /**
   * Updates the tenant's own settings.
   *
   * `tenant_code` and `status` are absent from the parameter type *and* from the
   * grant, so a caller cannot change either by adding a field. Tenant status is
   * an owner/operator capability (ADR-008), not tenant administration.
   */
  async updateTenant(
    db: DbHandle,
    expectedVersion: number,
    changes: {
      displayName?: string | undefined;
      defaultLocale?: string | undefined;
      defaultTimezone?: string | undefined;
    }
  ): Promise<TenantSettingsView> {
    const before = await this.readTenant(db);
    if (
      changes.displayName === undefined &&
      changes.defaultLocale === undefined &&
      changes.defaultTimezone === undefined
    ) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'No updatable field was supplied',
        safeDetails: { violations: [{ path: 'body', rule: 'empty_update' }] },
      });
    }

    let affected: number;
    try {
      affected = await this.organization.updateTenant(db, expectedVersion, {
        ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
        ...(changes.defaultLocale !== undefined ? { defaultLocale: changes.defaultLocale } : {}),
        ...(changes.defaultTimezone !== undefined
          ? { defaultTimezone: changes.defaultTimezone }
          : {}),
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        // `fk_tenants_default_locale` / `fk_tenants_default_timezone`: the value
        // is not a registered language or IANA zone.
        throw new AppFailure('ERR-VAL-001', {
          message: 'Locale or timezone is not a registered platform value',
          safeDetails: { violations: [{ path: 'body', rule: 'unknown_reference' }] },
        });
      }
      throw error;
    }
    assertVersionMatched(affected);

    await appendAudit(db, {
      action: 'org.tenant.settings_updated',
      entityType: 'org.tenant',
      entityId: before.id,
      details: [
        ...(changes.displayName !== undefined
          ? [
              {
                field: 'display_name',
                classification: 'public' as const,
                previousValue: before.displayName,
                value: changes.displayName,
              },
            ]
          : []),
        ...(changes.defaultLocale !== undefined
          ? [
              {
                field: 'default_locale',
                classification: 'public' as const,
                previousValue: before.defaultLocale,
                value: changes.defaultLocale,
              },
            ]
          : []),
        ...(changes.defaultTimezone !== undefined
          ? [
              {
                field: 'default_timezone',
                classification: 'public' as const,
                previousValue: before.defaultTimezone,
                value: changes.defaultTimezone,
              },
            ]
          : []),
      ],
    });

    return this.readTenant(db);
  }

  async listCompanySettings(db: DbHandle, companyId: string): Promise<readonly SettingView[]> {
    await this.requireCompanyInScope(db, companyId);
    const mayReadSensitive = await this.mayReadSensitive(db);
    const rows = await this.organization.currentCompanySettings(db, companyId);
    return rows.map((row) => toSettingView(row, mayReadSensitive));
  }

  async writeCompanySetting(
    db: DbHandle,
    companyId: string,
    input: {
      settingKey: string;
      settingValue: unknown;
      valueType: SettingRow['valueType'];
      isSensitive?: boolean | undefined;
    }
  ): Promise<SettingView> {
    await this.requireCompanyInScope(db, companyId);

    const written = await this.writeSetting(() =>
      this.organization.insertCompanySetting(db, {
        companyId,
        settingKey: input.settingKey,
        settingValue: input.settingValue,
        valueType: input.valueType,
        isSensitive: input.isSensitive ?? false,
      })
    );

    await appendAudit(db, {
      action: 'org.company.settings_updated',
      entityType: 'org.company_setting',
      entityId: written.id,
      details: [
        { field: 'company_id', classification: 'internal', value: companyId },
        { field: 'setting_key', classification: 'public', value: input.settingKey },
        { field: 'version', classification: 'public', value: String(written.version) },
        // A sensitive value is recorded as `secret`, which `iam.audit_mask`
        // collapses to a fixed marker before it is stored. The audit proves the
        // change happened without becoming a copy of the secret.
        {
          field: 'setting_value',
          classification: input.isSensitive ? 'secret' : 'internal',
          value: JSON.stringify(input.settingValue),
        },
      ],
    });

    return {
      settingKey: input.settingKey,
      valueType: input.valueType,
      isSensitive: input.isSensitive ?? false,
      version: written.version,
      effectiveFrom: new Date().toISOString(),
      ...(input.isSensitive ? {} : { settingValue: input.settingValue }),
    };
  }

  async listBranchSettings(db: DbHandle, branchId: string): Promise<readonly SettingView[]> {
    const companyId = await this.requireBranchInScope(db, branchId);
    const mayReadSensitive = await this.mayReadSensitive(db);
    const rows = await this.organization.currentBranchSettings(db, companyId, branchId);
    return rows.map((row) => toSettingView(row, mayReadSensitive));
  }

  async writeBranchSetting(
    db: DbHandle,
    branchId: string,
    input: {
      settingKey: string;
      settingValue: unknown;
      valueType: SettingRow['valueType'];
      isSensitive?: boolean | undefined;
    }
  ): Promise<SettingView> {
    const companyId = await this.requireBranchInScope(db, branchId);

    const written = await this.writeSetting(() =>
      this.organization.insertBranchSetting(db, {
        companyId,
        branchId,
        settingKey: input.settingKey,
        settingValue: input.settingValue,
        valueType: input.valueType,
        isSensitive: input.isSensitive ?? false,
      })
    );

    await appendAudit(db, {
      action: 'org.branch.settings_updated',
      entityType: 'org.branch_setting',
      entityId: written.id,
      details: [
        { field: 'branch_id', classification: 'internal', value: branchId },
        { field: 'setting_key', classification: 'public', value: input.settingKey },
        { field: 'version', classification: 'public', value: String(written.version) },
        {
          field: 'setting_value',
          classification: input.isSensitive ? 'secret' : 'internal',
          value: JSON.stringify(input.settingValue),
        },
      ],
    });

    return {
      settingKey: input.settingKey,
      valueType: input.valueType,
      isSensitive: input.isSensitive ?? false,
      version: written.version,
      effectiveFrom: new Date().toISOString(),
      ...(input.isSensitive ? {} : { settingValue: input.settingValue }),
    };
  }

  /**
   * Runs a settings insert and translates the two failures it can produce.
   *
   * A unique violation on `(scope, key, version)` means a concurrent writer took
   * the version this one computed. That is a genuine conflict — the loser's
   * value was based on a state that is no longer current — so it is reported as
   * one rather than retried silently behind the caller's back.
   */
  private async writeSetting(
    insert: () => Promise<{ id: string; version: number }>
  ): Promise<{ id: string; version: number }> {
    try {
      return await insert();
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-CON-001', {
          message: 'Another writer created this setting version first; re-read and retry',
        });
      }
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // `org.validate_setting_value()` refused the value for its declared type.
        throw new AppFailure('ERR-VAL-001', {
          message: 'The value does not match its declared type',
          safeDetails: { violations: [{ path: 'body.settingValue', rule: 'type_mismatch' }] },
        });
      }
      throw error;
    }
  }

  /** True when the caller may see sensitive setting values. */
  private async mayReadSensitive(db: DbHandle): Promise<boolean> {
    const permissions = await this.authorization.effectivePermissionsOfCaller(db);
    return permissions.has('iam.sensitive.view');
  }

  private async requireCompanyInScope(db: DbHandle, companyId: string): Promise<void> {
    const context = this.contextOf(db);
    this.delegationPolicy.assertScopeWithinAuthority(
      {
        actorUserId: context.principal.userId,
        actorPermissions: new Set<string>(),
        actorUnrestricted: context.companyIds.length === 0,
        actorCompanyIds: new Set(context.companyIds),
        actorBranchIds: new Set(context.branchIds),
      },
      { scopeType: 'company', companyId }
    );
    if (!(await this.organization.companyExists(db, companyId))) {
      throw new AppFailure('ERR-RES-001', { message: 'Company not found in this tenant' });
    }
  }

  /** Resolves the branch's company from the database, never from the request. */
  private async requireBranchInScope(db: DbHandle, branchId: string): Promise<string> {
    const companyId = await this.organization.companyOfBranch(db, branchId);
    if (!companyId) {
      throw new AppFailure('ERR-RES-001', { message: 'Branch not found in this tenant' });
    }
    const context = this.contextOf(db);
    this.delegationPolicy.assertScopeWithinAuthority(
      {
        actorUserId: context.principal.userId,
        actorPermissions: new Set<string>(),
        actorUnrestricted: context.companyIds.length === 0 && context.branchIds.length === 0,
        actorCompanyIds: new Set(context.companyIds),
        actorBranchIds: new Set(context.branchIds),
      },
      { scopeType: 'branch', companyId, branchId }
    );
    return companyId;
  }
}
