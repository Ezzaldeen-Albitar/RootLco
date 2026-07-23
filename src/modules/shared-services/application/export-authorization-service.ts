/**
 * Export authorization (P1-15).
 *
 * Answers one question — *may this caller export this resource, with these
 * fields, under these filters, at this size?* — and records the answer in the
 * audit trail. It does **not** produce a file. That boundary is stated in the
 * response itself (`generated: false`) so no consumer can mistake an
 * authorization for a download.
 *
 * ## Why authorization is separated from generation
 *
 * A generator needs an object store to write to (none provisioned), a retention
 * decision for the artefact (none approved), and a delivery channel (none
 * exists). Shipping the authorization now means the *decision* is auditable and
 * enforced from the first export, and the generator inherits a settled contract
 * instead of re-deciding it under deadline.
 *
 * ## Time-of-check / time-of-use
 *
 * The permission set is read inside the same transaction as the estimate and the
 * audit record, so an authorization cannot be granted against a permission that
 * was revoked earlier in the same instant. It is still a decision about *now*:
 * `expiresAt` bounds how long it may be presented, and a generator must re-check
 * at use time — which is why the response carries the expiry rather than an
 * open-ended grant.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { metrics, METRICS } from '@/server/observability/metrics';
import { backendConfig } from '@/server/config/backend-config';
import { ExportRepository } from '../data/export-repository';
import {
  EXPORT_PERMISSION,
  EXPORT_RESOURCES,
  findExportResource,
  formulaRiskyFields,
  resolveExportFields,
} from '../domain/export-policy';
import { buildFilterPredicate, type FilterInput } from '../domain/query-primitives';

export interface AuthorizeExportInput {
  readonly resource: string;
  /** Empty means "every field the caller may read". */
  readonly fields: readonly string[];
  readonly filters: readonly FilterInput[];
  /** Why the export is being taken. Required: an export is a disclosure. */
  readonly reason: string;
}

export interface ExportAuthorization {
  readonly resource: string;
  readonly fields: readonly string[];
  readonly estimatedRows: number;
  readonly maxRows: number;
  readonly expiresAt: string;
  /** Always false in P1-15. No file is produced by this phase. */
  readonly generated: false;
  /**
   * Fields whose values a CSV writer must neutralise against formula injection.
   * Advisory metadata for the generator, not a claim that anything was written.
   */
  readonly formulaRiskyFields: readonly string[];
}

/** How long an authorization may be presented before it must be re-taken. */
const AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
const MAX_REASON = 500;

export class ExportAuthorizationService extends ApplicationService {
  protected readonly module = 'shared-services';

  constructor(private readonly exports: ExportRepository) {
    super();
  }

  /** Resources this deployment can export, for a caller-facing catalogue. */
  catalogue(): readonly { code: string; description: string; fields: readonly string[] }[] {
    return EXPORT_RESOURCES.map((resource) => ({
      code: resource.code,
      description: resource.description,
      fields: resource.fields.map((entry) => entry.name),
    }));
  }

  async authorize(db: DbHandle, input: AuthorizeExportInput): Promise<ExportAuthorization> {
    const config = backendConfig();
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > MAX_REASON) {
      throw new AppFailure('ERR-VAL-001', {
        message: `An export reason of 1–${MAX_REASON} characters is required`,
        safeDetails: { violations: [{ path: 'body.reason', rule: 'required' }] },
      });
    }

    const resource = findExportResource(input.resource);
    if (!resource) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Resource is not exportable',
        safeDetails: { violations: [{ path: 'body.resource', rule: 'unknown_resource' }] },
      });
    }

    // Both permissions, read in this transaction. `rpt.export` is the platform
    // switch; the resource permission is the specific entitlement.
    const [mayExport, mayReadResource, maySeeSensitive] = await Promise.all([
      this.exports.holdsPermission(db, EXPORT_PERMISSION),
      this.exports.holdsPermission(db, resource.permission),
      this.exports.holdsPermission(db, 'iam.sensitive.view'),
    ]);
    if (!mayExport || !mayReadResource) {
      metrics().increment(METRICS.exportAuthorizationCount, {
        resource: resource.code,
        result: 'denied',
      });
      // Uniform denial: which of the two permissions was missing is not disclosed.
      throw new AppFailure('ERR-IAM-001', {
        message: 'Export is not permitted for this caller',
        safeDetails: { requiredPermissions: [EXPORT_PERMISSION, resource.permission] },
      });
    }

    const permissions = new Set<string>([EXPORT_PERMISSION, resource.permission]);
    if (maySeeSensitive) permissions.add('iam.sensitive.view');

    const decision = resolveExportFields(resource, input.fields, permissions);
    if (decision.unknown.length > 0) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Requested fields are not exportable for this resource',
        safeDetails: {
          violations: decision.unknown.map((name) => ({
            path: `body.fields.${name}`,
            rule: 'unknown_field',
          })),
        },
      });
    }
    if (decision.denied.length > 0) {
      metrics().increment(METRICS.exportAuthorizationCount, {
        resource: resource.code,
        result: 'denied-field',
      });
      throw new AppFailure('ERR-IAM-001', {
        message: 'Requested fields require additional permission',
        safeDetails: { requiredPermissions: ['iam.sensitive.view'] },
      });
    }
    if (decision.resolved.length === 0) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'No exportable field remains after applying permissions',
        safeDetails: { violations: [{ path: 'body.fields', rule: 'empty_selection' }] },
      });
    }

    // $1 is the tenant predicate in `ExportRepository.estimate`, so filter
    // parameters start at $2.
    const filter = buildFilterPredicate(
      { key: `export.${resource.code}`, filterable: resource.filterable, sortable: [], defaultSort: { field: '', direction: 'asc' }, idColumn: 'id' },
      input.filters,
      2,
      { mayReadSensitive: maySeeSensitive }
    );

    const estimate = await this.exports.estimate(
      db,
      resource.table,
      resource.tenantColumn,
      filter.predicate,
      filter.values,
      config.EXPORT_MAX_ROWS
    );
    if (estimate.exceeded) {
      metrics().increment(METRICS.exportAuthorizationCount, {
        resource: resource.code,
        result: 'too-large',
      });
      throw new AppFailure('ERR-EXP-001', {
        message: `The export would exceed ${config.EXPORT_MAX_ROWS} rows; narrow the filters`,
      });
    }

    await appendAudit(db, {
      action: 'shared.export.authorized',
      entityType: 'shared.export_request',
      // No export-request table exists in the frozen schema, so there is no id to
      // record. The audit record IS the artefact, and saying so is more honest
      // than minting an identifier that references nothing.
      entityId: null,
      details: [
        { field: 'resource', classification: 'public', value: resource.code },
        {
          field: 'fields',
          classification: 'public',
          value: decision.resolved.map((entry) => entry.name).join(','),
        },
        { field: 'filter_count', classification: 'public', value: String(input.filters.length) },
        { field: 'estimated_rows', classification: 'internal', value: String(estimate.rows) },
        // The reason is operator-authored free text and may name a person or a
        // legal matter.
        { field: 'reason', classification: 'restricted', value: reason },
        { field: 'sensitive_fields_included', classification: 'internal', value: String(maySeeSensitive) },
      ],
    });

    metrics().increment(METRICS.exportAuthorizationCount, {
      resource: resource.code,
      result: 'authorized',
    });

    return {
      resource: resource.code,
      fields: decision.resolved.map((entry) => entry.name),
      estimatedRows: estimate.rows,
      maxRows: config.EXPORT_MAX_ROWS,
      expiresAt: new Date(Date.now() + AUTHORIZATION_TTL_MS).toISOString(),
      generated: false,
      formulaRiskyFields: formulaRiskyFields(resource).filter((name) =>
        decision.resolved.some((entry) => entry.name === name)
      ),
    };
  }
}
