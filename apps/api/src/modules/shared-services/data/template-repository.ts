/**
 * Message-template data access (P1-15).
 *
 * Privilege surface read from the live catalog:
 *
 * | Relation                    | `app_runtime` may                                        |
 * | --------------------------- | -------------------------------------------------------- |
 * | `shared.message_templates`  | SELECT (platform **or** own tenant) · INSERT (tenant scope only) · UPDATE(active_version_id, deleted_at, description, name, status) |
 * | `shared.template_versions`  | SELECT (platform **or** own tenant) · INSERT (tenant only) · UPDATE(approved_by, body, content_hash, status, subject) |
 *
 * Both write policies additionally require `iam.has_permission('org.settings.manage')`
 * inside the RLS `WITH CHECK`, so authorization is enforced by the database as
 * well as by the operation registry — a caller without the permission gets zero
 * rows or `42501`, not a partially applied change.
 *
 * **Platform templates are readable and unwritable.** The INSERT policies pin
 * `scope = 'tenant'` and `tenant_id = iam.current_tenant_id()`, so no tenant can
 * create or mutate a platform template. `lck_template_versions_reference`
 * (`WITH CHECK (false)`) exists only so a *locking read* of a platform version
 * is possible — `guard_outbound_message_scope()` takes `FOR SHARE` on it during
 * enqueue, and under RLS a locking read needs an UPDATE policy even though it
 * writes nothing.
 *
 * `record_version` is not in either UPDATE grant, and does not need to be:
 * `shared.touch_row_metadata()` advances it in a BEFORE trigger, and column
 * privileges are checked against the statement's SET list, not against what a
 * trigger writes.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface TemplateRow {
  readonly id: string;
  readonly scope: string;
  readonly tenant_id: string | null;
  readonly template_code: string;
  readonly name: string;
  readonly channel: string;
  readonly purpose: string;
  readonly locale_code: string;
  readonly description: string | null;
  readonly active_version_id: string | null;
  readonly status: string;
  readonly record_version: number;
}

export interface TemplateVersionRow {
  readonly id: string;
  readonly template_id: string;
  readonly tenant_id: string | null;
  readonly version_number: number;
  readonly subject: string | null;
  readonly body: string;
  readonly status: string;
  readonly record_version: number;
  /** Joined from the template — the authority for channel/locale/purpose. */
  readonly template_scope: string;
  readonly template_tenant_id: string | null;
  readonly template_channel: string;
  readonly template_locale: string;
  readonly template_purpose: string;
  /**
   * The TEMPLATE's status, not the version's.
   *
   * Selected because `shared.template-update` offers `status: 'disabled'` and,
   * until P1-15-SR-007, nothing read it back: a template an administrator had
   * deliberately disabled still produced messages, because enqueue only ever
   * looked at the *version's* approval state.
   */
  readonly template_status: string;
}

export class TemplateRepository extends Repository {
  protected readonly module = 'shared-services';

  /**
   * Resolves a template by its natural key.
   *
   * A tenant override wins over the platform default: the `ORDER BY` puts
   * `scope = 'tenant'` first, which is the whole point of dual scope. Without
   * the ordering, which row you got would depend on physical order.
   */
  async findTemplateByCode(
    db: DbHandle,
    key: { readonly templateCode: string; readonly channel: string; readonly localeCode: string }
  ): Promise<TemplateRow | null> {
    const context = this.assertContext(db);
    return this.runOne<TemplateRow>(
      db,
      `SELECT id, scope, tenant_id, template_code, name, channel, purpose, locale_code,
              description, active_version_id, status, record_version
         FROM shared.message_templates
        WHERE template_code = $1 AND channel = $2 AND locale_code = $3
          AND deleted_at IS NULL
          AND (scope = 'platform' OR tenant_id = $4)
        ORDER BY scope = 'tenant' DESC
        LIMIT 1`,
      [key.templateCode, key.channel, key.localeCode, context.principal.tenantId]
    );
  }

  async findTemplate(db: DbHandle, templateId: string): Promise<TemplateRow | null> {
    const context = this.assertContext(db);
    return this.runOne<TemplateRow>(
      db,
      `SELECT id, scope, tenant_id, template_code, name, channel, purpose, locale_code,
              description, active_version_id, status, record_version
         FROM shared.message_templates
        WHERE id = $1 AND deleted_at IS NULL AND (scope = 'platform' OR tenant_id = $2)`,
      [templateId, context.principal.tenantId]
    );
  }

  async insertTemplate(
    db: DbHandle,
    input: {
      readonly id: string;
      readonly templateCode: string;
      readonly name: string;
      readonly channel: string;
      readonly purpose: string;
      readonly localeCode: string;
      readonly description: string | null;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO shared.message_templates
         (id, scope, tenant_id, template_code, name, channel, purpose, locale_code,
          description, status, created_by)
       VALUES ($1, 'tenant', $2, $3, $4, $5, $6, $7, $8, 'active', $9)
       RETURNING id`,
      [
        input.id,
        context.principal.tenantId,
        input.templateCode,
        input.name,
        input.channel,
        input.purpose,
        input.localeCode,
        input.description,
        context.principal.userId,
      ]
    );
    return row?.id ?? null;
  }

  /** Updates the grantable template columns under an optimistic-concurrency guard. */
  async updateTemplate(
    db: DbHandle,
    templateId: string,
    expectedVersion: number,
    changes: {
      readonly name?: string | undefined;
      readonly description?: string | null | undefined;
      readonly status?: string | undefined;
    }
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE shared.message_templates
          SET name        = COALESCE($4, name),
              description = CASE WHEN $5::boolean THEN $6 ELSE description END,
              status      = COALESCE($7, status)
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        templateId,
        expectedVersion,
        changes.name ?? null,
        changes.description !== undefined,
        changes.description ?? null,
        changes.status ?? null,
      ]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Points a template at an approved version.
   *
   * `guard_template_active_version()` re-reads the version `FOR UPDATE` and
   * refuses anything that is not `approved`, which also fixes the lock order
   * (version row first) that keeps activation and retirement from deadlocking.
   */
  async setActiveVersion(
    db: DbHandle,
    templateId: string,
    expectedVersion: number,
    versionId: string | null
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE shared.message_templates
          SET active_version_id = $4::uuid
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND deleted_at IS NULL`,
      [context.principal.tenantId, templateId, expectedVersion, versionId]
    );
    return result.rowCount ?? 0;
  }

  /** Next version number for a template, serialised by a lock on the template row. */
  async nextVersionNumber(db: DbHandle, templateId: string): Promise<number> {
    const context = this.assertContext(db);
    await this.run(
      db,
      `SELECT id FROM shared.message_templates WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [context.principal.tenantId, templateId]
    );
    const row = await this.runOne<{ next: string }>(
      db,
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
         FROM shared.template_versions WHERE template_id = $1`,
      [templateId]
    );
    return Number(row?.next ?? 1);
  }

  async insertVersion(
    db: DbHandle,
    input: {
      readonly id: string;
      readonly templateId: string;
      readonly versionNumber: number;
      readonly subject: string | null;
      readonly body: string;
      readonly contentHashHex: string;
    }
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO shared.template_versions
         (id, tenant_id, template_id, version_number, subject, body, content_hash, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, decode($7, 'hex'), 'draft', $8)
       RETURNING id`,
      [
        input.id,
        context.principal.tenantId,
        input.templateId,
        input.versionNumber,
        input.subject,
        input.body,
        input.contentHashHex,
        context.principal.userId,
      ]
    );
    return row?.id ?? null;
  }

  async findVersion(db: DbHandle, versionId: string): Promise<TemplateVersionRow | null> {
    const context = this.assertContext(db);
    return this.runOne<TemplateVersionRow>(
      db,
      `SELECT v.id, v.template_id, v.tenant_id, v.version_number, v.subject, v.body,
              v.status, v.record_version,
              t.scope       AS template_scope,
              t.tenant_id   AS template_tenant_id,
              t.channel     AS template_channel,
              t.locale_code AS template_locale,
              t.purpose     AS template_purpose,
              t.status      AS template_status
         FROM shared.template_versions v
         JOIN shared.message_templates t ON t.id = v.template_id
        WHERE v.id = $1
          AND (v.tenant_id IS NULL OR v.tenant_id = $2)
          AND t.deleted_at IS NULL`,
      [versionId, context.principal.tenantId]
    );
  }

  /**
   * The ACTIVE version of a template code, across a channel preference order.
   *
   * Exists because a caller that knows only WHAT to say cannot supply the natural
   * key: that key is `(template_code, channel, locale_code)`, so `findTemplateByCode`
   * requires the caller to have already chosen a channel AND a locale. A publisher
   * resolving a notification knows neither — the channel is whatever the tenant
   * authored content for, and the locale is a property of the row rather than an
   * input, since `shared.outbound_messages` has no locale column.
   *
   * `array_position` over the caller's own channel list makes the preference
   * ORDER data rather than a hard-coded `ORDER BY channel = 'email' DESC`, and a
   * tenant row shadows a platform row of the same channel — the override
   * precedence every catalogue in this platform uses.
   *
   * Joins `active_version_id`, so a template whose administrator never approved a
   * version simply does not match. Usability is still asserted by the caller:
   * this returns the row, it does not judge it.
   */
  async findActiveVersionByCode(
    db: DbHandle,
    templateCode: string,
    channels: readonly string[]
  ): Promise<TemplateVersionRow | null> {
    const context = this.assertContext(db);
    return this.runOne<TemplateVersionRow>(
      db,
      `SELECT v.id, v.template_id, v.tenant_id, v.version_number, v.subject, v.body,
              v.status, v.record_version,
              t.scope       AS template_scope,
              t.tenant_id   AS template_tenant_id,
              t.channel     AS template_channel,
              t.locale_code AS template_locale,
              t.purpose     AS template_purpose,
              t.status      AS template_status
         FROM shared.message_templates t
         JOIN shared.template_versions v ON v.id = t.active_version_id
        WHERE t.template_code = $1
          AND t.channel = ANY($2::text[])
          AND t.deleted_at IS NULL
          AND (t.scope = 'platform' OR t.tenant_id = $3)
        ORDER BY array_position($2::text[], t.channel), (t.scope = 'tenant') DESC
        LIMIT 1`,
      [templateCode, [...channels], context.principal.tenantId]
    );
  }

  /** Revises draft content. The lifecycle guard refuses this once approved. */
  async updateDraftContent(
    db: DbHandle,
    versionId: string,
    expectedVersion: number,
    input: {
      readonly subject: string | null;
      readonly body: string;
      readonly contentHashHex: string;
    }
  ): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE shared.template_versions
          SET subject = $4, body = $5, content_hash = decode($6, 'hex')
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND status = 'draft'`,
      [
        context.principal.tenantId,
        versionId,
        expectedVersion,
        input.subject,
        input.body,
        input.contentHashHex,
      ]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Approves a draft.
   *
   * `approved_by` is written from the session context, never from the request:
   * `ck_template_versions_approval_pairing` requires it, and letting a caller
   * name the approver would make the approval record unfalsifiable in the wrong
   * direction. `approved_at` is stamped by the lifecycle guard.
   */
  async approveVersion(db: DbHandle, versionId: string, expectedVersion: number): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE shared.template_versions
          SET status = 'approved', approved_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND status = 'draft'`,
      [context.principal.tenantId, versionId, expectedVersion, context.principal.userId]
    );
    return result.rowCount ?? 0;
  }

  /** Retires an approved version. The guard refuses while it is still active. */
  async retireVersion(db: DbHandle, versionId: string, expectedVersion: number): Promise<number> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE shared.template_versions
          SET status = 'retired'
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND status = 'approved'`,
      [context.principal.tenantId, versionId, expectedVersion]
    );
    return result.rowCount ?? 0;
  }
}
