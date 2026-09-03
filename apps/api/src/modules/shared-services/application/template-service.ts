/**
 * Message-template administration (P1-15).
 *
 * Templates are tenant-scoped configuration with an immutable approved form.
 * The lifecycle is `draft → approved → retired`, enforced by
 * `shared.guard_template_version_lifecycle()`; this service composes it and adds
 * the audit trail, optimistic concurrency, and the deterministic content hash.
 *
 * ## Platform templates are read-only, from every direction
 *
 * A platform template (`scope = 'platform'`, `tenant_id IS NULL`) is a shared
 * default. The INSERT and UPDATE policies pin `scope = 'tenant'` and
 * `tenant_id = iam.current_tenant_id()`, so a tenant cannot mutate one even with
 * `org.settings.manage`. This service refuses before reaching the database so
 * the caller gets an explained denial rather than a zero-row UPDATE.
 *
 * ## Authorization
 *
 * `org.settings.manage` — the same permission the RLS `WITH CHECK` clauses
 * require, so operation-level authorization and database-level authorization
 * agree by construction rather than by coincidence. It is reused rather than
 * invented because template content *is* organization configuration, and the
 * scope tests prove a caller without it changes nothing.
 */
import { createHash } from 'node:crypto';
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { assertVersionMatched } from '@/server/db/concurrency';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { metrics, METRICS } from '@/server/observability/metrics';
import { backendConfig } from '@/server/config/backend-config';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import { TemplateRepository, type TemplateVersionRow } from '../data/template-repository';
import {
  canonicalRenderedForm,
  renderTemplate,
  RENDERABLE_CHANNELS,
  templateVariables,
  TemplateRenderError,
  type RenderableChannel,
} from '../domain/template-rendering';
import { MESSAGE_PURPOSES } from '../domain/notification-policy';

export interface CreateTemplateInput {
  readonly templateCode: string;
  readonly name: string;
  readonly channel: RenderableChannel;
  readonly purpose: (typeof MESSAGE_PURPOSES)[number];
  readonly localeCode: string;
  readonly description?: string | null | undefined;
}

export interface TemplateVersionView {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly status: string;
  readonly recordVersion: number;
  /** Placeholder names the version uses. Metadata, never content. */
  readonly variables: readonly string[];
}

/** Deterministic hash stored in `template_versions.content_hash`. */
export function templateContentHash(subject: string | null, body: string): Buffer {
  return createHash('sha256')
    .update(canonicalRenderedForm({ subject, body, usedVariables: [] }), 'utf8')
    .digest();
}

/** A template version rendered against sample variables, for preview only. */
export interface RenderedPreview {
  readonly subject: string | null;
  readonly body: string;
  readonly variables: readonly string[];
}

/** The identifier of a newly created message template. */
export interface TemplateCreated {
  readonly templateId: string;
}

export class TemplateService extends ApplicationService {
  protected readonly module = 'shared-services';

  constructor(private readonly templates: TemplateRepository) {
    super();
  }

  async createTemplate(db: DbHandle, input: CreateTemplateInput): Promise<TemplateCreated> {
    if (!RENDERABLE_CHANNELS.includes(input.channel)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Channel is not supported by the platform',
        safeDetails: { violations: [{ path: 'body.channel', rule: 'unsupported_channel' }] },
      });
    }

    const templateId = crypto.randomUUID();
    let created: string | null;
    try {
      created = await this.templates.insertTemplate(db, {
        id: templateId,
        templateCode: input.templateCode,
        name: input.name,
        channel: input.channel,
        purpose: input.purpose,
        localeCode: input.localeCode,
        description: input.description ?? null,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        // `uq_message_templates_tenant_identity`: one live template per
        // (tenant, code, channel, locale).
        throw new AppFailure('ERR-RES-002', {
          message: 'A template already exists for this code, channel, and locale',
        });
      }
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'Locale is not a registered platform language',
          safeDetails: { violations: [{ path: 'body.localeCode', rule: 'unknown_reference' }] },
        });
      }
      throw error;
    }
    if (!created) {
      throw new AppFailure('ERR-IAM-001', { message: 'Template creation was refused by policy' });
    }

    await appendAudit(db, {
      action: 'shared.template.created',
      entityType: 'shared.message_template',
      entityId: templateId,
      details: [
        { field: 'template_code', classification: 'public', value: input.templateCode },
        { field: 'channel', classification: 'public', value: input.channel },
        { field: 'purpose', classification: 'public', value: input.purpose },
        { field: 'locale_code', classification: 'public', value: input.localeCode },
      ],
    });

    return { templateId };
  }

  async updateTemplate(
    db: DbHandle,
    templateId: string,
    expectedVersion: number,
    changes: {
      readonly name?: string | undefined;
      readonly description?: string | null | undefined;
      readonly status?: 'active' | 'disabled' | undefined;
    }
  ): Promise<void> {
    const template = await this.requireTenantTemplate(db, templateId);
    assertVersionMatched(
      await this.templates.updateTemplate(db, templateId, expectedVersion, changes)
    );

    await appendAudit(db, {
      action: 'shared.template.updated',
      entityType: 'shared.message_template',
      entityId: templateId,
      details: [
        ...(changes.name !== undefined
          ? [
              {
                field: 'name',
                classification: 'public' as const,
                previousValue: template.name,
                value: changes.name,
              },
            ]
          : []),
        ...(changes.status !== undefined
          ? [
              {
                field: 'status',
                classification: 'public' as const,
                previousValue: template.status,
                value: changes.status,
              },
            ]
          : []),
        ...(changes.description !== undefined
          ? [
              {
                field: 'description',
                classification: 'internal' as const,
                value: changes.description,
              },
            ]
          : []),
      ],
    });
  }

  /** Creates the next draft version. Content is authored, not rendered, here. */
  async createVersion(
    db: DbHandle,
    templateId: string,
    input: { readonly subject: string | null; readonly body: string }
  ): Promise<TemplateVersionView> {
    await this.requireTenantTemplate(db, templateId);
    this.assertContentRenderable(input.subject, input.body);

    const versionNumber = await this.templates.nextVersionNumber(db, templateId);
    const versionId = crypto.randomUUID();
    const created = await this.templates.insertVersion(db, {
      id: versionId,
      templateId,
      versionNumber,
      subject: input.subject,
      body: input.body,
      contentHashHex: templateContentHash(input.subject, input.body).toString('hex'),
    });
    if (!created) {
      throw new AppFailure('ERR-IAM-001', { message: 'Version creation was refused by policy' });
    }

    await this.auditVersion(db, 'shared.template.version_created', versionId, [
      { field: 'template_id', classification: 'internal', value: templateId },
      { field: 'version_number', classification: 'public', value: String(versionNumber) },
    ]);
    await this.publishTemplateChange(db, templateId, versionNumber, 'version_created');

    return {
      versionId,
      versionNumber,
      status: 'draft',
      recordVersion: 1,
      variables: templateVariables({ subject: input.subject, body: input.body }),
    };
  }

  /** Revises a draft. The lifecycle guard refuses once the version is approved. */
  async reviseDraft(
    db: DbHandle,
    versionId: string,
    expectedVersion: number,
    input: { readonly subject: string | null; readonly body: string }
  ): Promise<void> {
    const version = await this.requireTenantVersion(db, versionId);
    if (version.status !== 'draft') {
      throw new AppFailure('ERR-TRN-001', {
        message: 'Only a draft version may be revised; approved content is immutable',
      });
    }
    this.assertContentRenderable(input.subject, input.body);

    assertVersionMatched(
      await this.templates.updateDraftContent(db, versionId, expectedVersion, {
        subject: input.subject,
        body: input.body,
        contentHashHex: templateContentHash(input.subject, input.body).toString('hex'),
      })
    );

    await this.auditVersion(db, 'shared.template.version_created', versionId, [
      { field: 'revision', classification: 'public', value: 'draft_content_changed' },
    ]);
  }

  async approveVersion(db: DbHandle, versionId: string, expectedVersion: number): Promise<void> {
    const version = await this.requireTenantVersion(db, versionId);
    if (version.status !== 'draft') {
      throw new AppFailure('ERR-TRN-001', { message: 'Only a draft version may be approved' });
    }
    assertVersionMatched(await this.templates.approveVersion(db, versionId, expectedVersion));

    await this.auditVersion(db, 'shared.template.version_approved', versionId, [
      { field: 'status', classification: 'public', previousValue: 'draft', value: 'approved' },
      { field: 'version_number', classification: 'public', value: String(version.version_number) },
    ]);
    await this.publishTemplateChange(
      db,
      version.template_id,
      version.version_number,
      'version_approved'
    );
  }

  async retireVersion(db: DbHandle, versionId: string, expectedVersion: number): Promise<void> {
    const version = await this.requireTenantVersion(db, versionId);
    if (version.status !== 'approved') {
      throw new AppFailure('ERR-TRN-001', { message: 'Only an approved version may be retired' });
    }
    try {
      assertVersionMatched(await this.templates.retireVersion(db, versionId, expectedVersion));
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // The lifecycle guard refuses to retire the version a template still
        // points at — deactivate it first.
        throw new AppFailure('ERR-TRN-001', {
          message: 'The active version of a template cannot be retired',
          cause: error,
        });
      }
      throw error;
    }

    await this.auditVersion(db, 'shared.template.version_retired', versionId, [
      { field: 'status', classification: 'public', previousValue: 'approved', value: 'retired' },
    ]);
    await this.publishTemplateChange(
      db,
      version.template_id,
      version.version_number,
      'version_retired'
    );
  }

  /** Points a template at an approved version, or clears the pointer. */
  async setActiveVersion(
    db: DbHandle,
    templateId: string,
    expectedVersion: number,
    versionId: string | null
  ): Promise<void> {
    await this.requireTenantTemplate(db, templateId);
    if (versionId !== null) {
      const version = await this.requireTenantVersion(db, versionId);
      if (version.template_id !== templateId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'Version belongs to a different template',
          safeDetails: { violations: [{ path: 'body.versionId', rule: 'template_mismatch' }] },
        });
      }
    }

    try {
      assertVersionMatched(
        await this.templates.setActiveVersion(db, templateId, expectedVersion, versionId)
      );
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-TRN-001', {
          message: 'Only an approved version may be made active',
          cause: error,
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'shared.template.updated',
      entityType: 'shared.message_template',
      entityId: templateId,
      details: [{ field: 'active_version_id', classification: 'internal', value: versionId }],
    });
    await this.publishTemplateChange(db, templateId, expectedVersion + 1, 'activated');
  }

  /**
   * Renders a version with sample variables, without sending anything.
   *
   * Returns content to a caller who already holds `org.settings.manage` and can
   * read the template body directly, so it discloses nothing new — and it is the
   * only way an administrator can see what escaping does to their markup before
   * approving it.
   */
  async previewVersion(
    db: DbHandle,
    versionId: string,
    variables: Readonly<Record<string, string>>
  ): Promise<RenderedPreview> {
    const version = await this.requireVisibleVersion(db, versionId);
    const config = backendConfig();
    try {
      const rendered = renderTemplate({ subject: version.subject, body: version.body }, variables, {
        channel: version.template_channel as RenderableChannel,
        maxRenderedChars: config.NOTIFICATION_MAX_RENDERED_CHARS,
      });
      metrics().increment(METRICS.templateRenderCount, {
        channel: version.template_channel,
        result: 'success',
      });
      return {
        subject: rendered.subject,
        body: rendered.body,
        variables: rendered.usedVariables,
      };
    } catch (error) {
      metrics().increment(METRICS.templateRenderFailureCount, {
        channel: version.template_channel,
        rule: error instanceof TemplateRenderError ? error.rule : 'unknown',
      });
      if (error instanceof TemplateRenderError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: {
            violations: error.names.length
              ? error.names.map((name) => ({ path: `body.variables.${name}`, rule: error.rule }))
              : [{ path: 'body.variables', rule: error.rule }],
          },
          cause: error,
        });
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------

  private async requireTenantTemplate(db: DbHandle, templateId: string) {
    const template = await this.templates.findTemplate(db, templateId);
    if (!template) {
      throw new AppFailure('ERR-RES-001', { message: 'Template not found in the caller scope' });
    }
    if (template.scope !== 'tenant') {
      throw new AppFailure('ERR-IAM-001', {
        message: 'Platform templates are read-only for a tenant',
      });
    }
    return template;
  }

  private async requireTenantVersion(db: DbHandle, versionId: string): Promise<TemplateVersionRow> {
    const version = await this.requireVisibleVersion(db, versionId);
    if (version.template_scope !== 'tenant' || version.tenant_id === null) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'Platform template versions are read-only for a tenant',
      });
    }
    return version;
  }

  private async requireVisibleVersion(
    db: DbHandle,
    versionId: string
  ): Promise<TemplateVersionRow> {
    const version = await this.templates.findVersion(db, versionId);
    if (!version) {
      throw new AppFailure('ERR-RES-001', {
        message: 'Template version not found in the caller scope',
      });
    }
    return version;
  }

  /** Refuses content that cannot be rendered at all, before it is stored. */
  private assertContentRenderable(subject: string | null, body: string): void {
    const config = backendConfig();
    const names = templateVariables({ subject, body });
    // Rendered with a placeholder value per name: this checks the *template*,
    // not any caller's data, and catches a blank body or a body already over the
    // size ceiling before it can be approved and sent from.
    const probe = Object.fromEntries(names.map((name) => [name, 'x']));
    try {
      renderTemplate({ subject, body }, probe, {
        channel: 'email',
        maxRenderedChars: config.NOTIFICATION_MAX_RENDERED_CHARS,
      });
    } catch (error) {
      if (error instanceof TemplateRenderError) {
        throw new AppFailure('ERR-VAL-001', {
          message: error.message,
          safeDetails: { violations: [{ path: 'body.body', rule: error.rule }] },
          cause: error,
        });
      }
      throw error;
    }
  }

  private async auditVersion(
    db: DbHandle,
    action: string,
    versionId: string,
    details: readonly {
      field: string;
      classification: 'public' | 'internal' | 'restricted' | 'secret';
      previousValue?: string | null;
      value: string | null;
    }[]
  ): Promise<void> {
    await appendAudit(db, {
      action,
      entityType: 'shared.template_version',
      entityId: versionId,
      details,
    });
  }

  private async publishTemplateChange(
    db: DbHandle,
    templateId: string,
    aggregateVersion: number,
    change: string
  ): Promise<void> {
    await publishEvent(db, {
      eventType: 'message-template.version.changed',
      aggregateId: templateId,
      aggregateVersion,
      producer: 'shared.templates',
      // No subject and no body: template content is tenant configuration and an
      // event travels further than the row.
      payload: { change },
      eventKey: `template.change:${templateId}:${change}:${aggregateVersion}`,
    });
  }
}
