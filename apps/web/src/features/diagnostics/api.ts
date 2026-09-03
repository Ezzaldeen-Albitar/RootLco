'use server';

/**
 * Diagnostics adapters (P1-29 `W7`), one per operation the screens consume.
 *
 * Every id a write needs travels in the PATH, which the screen took from a
 * response it was shown, and every authority comes from the session: the
 * backend answers 403 for a code the caller lacks and 404 for a record another
 * tenant owns, and the adapters report both as they are. No adapter accepts a
 * tenant, company or branch from the caller, and none accepts a record version
 * it did not read — `ifMatch` is the version the screen was rendered from, so a
 * stale screen is refused with a conflict rather than overwriting silently.
 */
import {
  captureDocument,
  createDocumentLink,
  listDocumentCategories,
} from '@/features/attachments/api';
import { authorizedClient } from '@/lib/api/server-client';
import {
  query,
  readOperation,
  type CursorPage,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import { fromFailure, type ActionState } from '@/lib/forms/action-result';
import type {
  DiagnosticCompleteBody,
  DiagnosticCreateBody,
  DiagnosticDtcRecordBody,
  DiagnosticEvidenceRecordBody,
  DiagnosticFindingRecordBody,
  DiagnosticItemResultBody,
  DiagnosticMeasurementRecordBody,
  DiagnosticRecommendationRecordBody,
  DiagnosticReviewBody,
  DiagnosticTransitionBody,
  TemplateCreateBody,
  TemplateItemCreateBody,
  TemplateUpdateBody,
  TemplateVersionCreateBody,
  TemplateVersionStatusSetBody,
} from '@/lib/contracts/diagnostics-contract';
import {
  REPORT_DOCUMENT_ENTITY_TYPE,
  type DiagnosticReport,
  type DiagnosticReportDetail,
  type DiagnosticType,
  type InspectionTemplateListRow,
  type PublishableVersion,
  type ReportHistory,
  type TemplateDetail,
  type TemplateItem,
} from './diagnostics-contract';

const EXPIRED: ActionState = { status: 'expired', correlationId: null, attempt: 1 };

/*
 * Path helpers are FUNCTION declarations, not arrows: `check-p1-28-access`
 * resolves only `function`-declared helpers when it derives an operation's path
 * from a call site, and an arrow would make every route below invisible to its
 * least-privilege rule.
 */
function templatePath(templateId: string, tail = ''): string {
  return `/api/v1/inspection-templates/${templateId}${tail}`;
}
function versionPath(versionId: string, tail = ''): string {
  return `/api/v1/template-versions/${versionId}${tail}`;
}
function jobPath(jobId: string, tail = ''): string {
  return `/api/v1/jobs/${jobId}${tail}`;
}
function reportPath(inspectionId: string, tail = ''): string {
  return `/api/v1/inspections/${inspectionId}${tail}`;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** `dia.diagnostic-type-list` — unpaged; `[]` is the truthful answer today. */
export async function listDiagnosticTypes(): Promise<ReadState<ItemsOnly<DiagnosticType>>> {
  return readOperation<ItemsOnly<DiagnosticType>>('/api/v1/diagnostic-types');
}

/** `dia.template-list` — a real cursor page, each row carrying its own cursor. */
export async function listTemplates(
  filter: { readonly status?: string; readonly diagnosticTypeId?: string },
  cursor: string | null
): Promise<ReadState<CursorPage<InspectionTemplateListRow>>> {
  return readOperation<CursorPage<InspectionTemplateListRow>>(
    '/api/v1/inspection-templates' +
      query({
        status: filter.status,
        diagnosticTypeId: filter.diagnosticTypeId,
        cursor,
        limit: 50,
      })
  );
}

/** `dia.template-detail`. */
export async function readTemplate(templateId: string): Promise<ReadState<TemplateDetail>> {
  return readOperation<TemplateDetail>(templatePath(templateId));
}

/** `dia.template-version-item-list` — the checklist, in order, unpaged. */
export async function listVersionItems(
  versionId: string
): Promise<ReadState<ItemsOnly<TemplateItem>>> {
  return readOperation<ItemsOnly<TemplateItem>>(versionPath(versionId, '/items'));
}

/** `dia.template-version-list-publishable` — exactly what `createReport` accepts. */
export async function listPublishableVersions(
  jobId: string
): Promise<ReadState<ItemsOnly<PublishableVersion>>> {
  return readOperation<ItemsOnly<PublishableVersion>>(jobPath(jobId, '/inspection-templates'));
}

/** `dia.diagnostic-list` — the job's reports, unpaged. */
export async function listJobReports(
  jobId: string
): Promise<ReadState<ItemsOnly<DiagnosticReport>>> {
  return readOperation<ItemsOnly<DiagnosticReport>>(jobPath(jobId, '/inspections'));
}

/** `dia.diagnostic-detail`. */
export async function readReport(inspectionId: string): Promise<ReadState<DiagnosticReportDetail>> {
  return readOperation<DiagnosticReportDetail>(reportPath(inspectionId));
}

/** `dia.diagnostic-history` — the transitions are a real cursor page. */
export async function readReportHistory(
  inspectionId: string,
  cursor: string | null
): Promise<ReadState<ReportHistory>> {
  return readOperation<ReportHistory>(
    reportPath(inspectionId, '/history') + query({ cursor, limit: 50 })
  );
}

/* ------------------------------------------------------------------ *
 * Writes — one shape, so the request each screen builds is the one proved
 * ------------------------------------------------------------------ */

async function send(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  body: unknown,
  ifMatch?: number
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return EXPIRED;
  const result = await client.send<unknown>(
    method,
    path,
    body,
    ifMatch === undefined ? {} : { ifMatch }
  );
  if (!result.ok) return fromFailure(result, 1);
  return { status: 'success', correlationId: result.correlationId, attempt: 1 };
}

/* --- authoring, on dia.catalogue.manage --- */

/** `dia.template-create`. */
export async function createTemplate(body: TemplateCreateBody): Promise<ActionState> {
  return send('POST', '/api/v1/inspection-templates', body);
}

/** `dia.template-update` — version-guarded on the template's `recordVersion`. */
export async function updateTemplate(
  templateId: string,
  body: TemplateUpdateBody,
  ifMatch: number
): Promise<ActionState> {
  return send('PATCH', templatePath(templateId), body, ifMatch);
}

/** `dia.template-version-create`. */
export async function createVersion(
  templateId: string,
  body: TemplateVersionCreateBody
): Promise<ActionState> {
  return send('POST', templatePath(templateId, '/versions'), body);
}

/** `dia.template-item-create` — draft versions only; the backend refuses the rest. */
export async function createItem(
  versionId: string,
  body: TemplateItemCreateBody
): Promise<ActionState> {
  return send('POST', versionPath(versionId, '/items'), body);
}

/**
 * `dia.template-version-status-set` — `published` or `retired`, never back to
 * draft. Version-guarded: the backend requires `If-Match`, and the version is
 * the one the template detail rendered the version row from.
 */
export async function setVersionStatus(
  versionId: string,
  body: TemplateVersionStatusSetBody,
  ifMatch: number
): Promise<ActionState> {
  return send('POST', versionPath(versionId, '/status'), body, ifMatch);
}

/* --- execution, on dia.diagnostic.record --- */

/** `dia.diagnostic-create`. */
export async function createReport(
  jobId: string,
  body: DiagnosticCreateBody
): Promise<ActionState> {
  return send('POST', jobPath(jobId, '/inspections'), body);
}

/** `dia.diagnostic-item-result` — PUT: the item's result, keyed by the item. */
export async function writeItemResult(
  inspectionId: string,
  templateItemId: string,
  body: DiagnosticItemResultBody
): Promise<ActionState> {
  return send('PUT', reportPath(inspectionId, `/items/${templateItemId}`), body);
}

/** `dia.diagnostic-measurement-record`. */
export async function recordMeasurement(
  inspectionId: string,
  body: DiagnosticMeasurementRecordBody
): Promise<ActionState> {
  return send('POST', reportPath(inspectionId, '/measurements'), body);
}

/** `dia.diagnostic-dtc-record`. */
export async function recordDtc(
  inspectionId: string,
  body: DiagnosticDtcRecordBody
): Promise<ActionState> {
  return send('POST', reportPath(inspectionId, '/dtcs'), body);
}

/** `dia.diagnostic-finding-record`. */
export async function recordFinding(
  inspectionId: string,
  body: DiagnosticFindingRecordBody
): Promise<ActionState> {
  return send('POST', reportPath(inspectionId, '/findings'), body);
}

/** `dia.diagnostic-recommendation-record`. */
export async function recordRecommendation(
  inspectionId: string,
  body: DiagnosticRecommendationRecordBody
): Promise<ActionState> {
  return send('POST', reportPath(inspectionId, '/recommendations'), body);
}

/** `dia.diagnostic-transition` — version-guarded on the report's `recordVersion`. */
export async function transitionReport(
  inspectionId: string,
  body: DiagnosticTransitionBody,
  ifMatch: number
): Promise<ActionState> {
  return send('POST', reportPath(inspectionId, '/transition'), body, ifMatch);
}

/** `dia.diagnostic-complete` (`dia.diagnostic.complete`) — version-guarded. */
export async function completeReport(
  inspectionId: string,
  body: DiagnosticCompleteBody,
  ifMatch: number
): Promise<ActionState> {
  return send('POST', reportPath(inspectionId, '/completion'), body, ifMatch);
}

/** `dia.diagnostic-review` (`dia.diagnostic.review`). */
export async function reviewReport(
  inspectionId: string,
  body: DiagnosticReviewBody
): Promise<ActionState> {
  return send('POST', reportPath(inspectionId, '/reviews'), body);
}

/* ------------------------------------------------------------------ *
 * Evidence — the W4 chain against a different entity
 * ------------------------------------------------------------------ */

export interface ReportEvidenceOutcome extends ActionState {
  readonly stage?: 'captured' | 'linked' | 'bound';
  readonly versionId?: string;
  readonly versionStatus?: string;
  readonly scannerAvailable?: boolean;
}

const FILE_FIELD = 'evidenceFile';

/**
 * Capture a file and bind it to a report as diagnostic evidence
 * (`shared.attachment-*` then `dia.diagnostic-evidence-record`).
 *
 * Authorize and store, register, link, bind — in the order the platform
 * requires, in one Server Action, so the ORDER never lives in a component. The
 * link is against `dia.diagnostic_report`, which is what `dia.diagnostic-evidence-record`
 * verifies before it accepts the `documentVersionId`: a version linked to
 * anything else is refused as not visible, and the outcome says which stage was
 * reached so nothing captured is lost silently.
 */
export async function captureReportEvidence(
  inspectionId: string,
  formData: FormData
): Promise<ReportEvidenceOutcome> {
  const file = formData.get(FILE_FIELD);
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: 'invalid',
      fieldErrors: { [FILE_FIELD]: 'attachments.capture.empty' },
      attempt: 1,
    };
  }
  const categoryCode = String(formData.get('categoryCode') ?? '').trim();
  const evidenceType = String(formData.get('evidenceType') ?? '').trim();
  const noteText = String(formData.get('note') ?? '').trim();
  const fieldErrors: Record<string, string> = {};
  if (categoryCode.length === 0) fieldErrors['categoryCode'] = 'field.required';
  if (evidenceType.length === 0) fieldErrors['evidenceType'] = 'field.required';
  if (Object.keys(fieldErrors).length > 0) return { status: 'invalid', fieldErrors, attempt: 1 };

  const categories = await listDocumentCategories();
  if (categories.status !== 'ok') {
    return {
      status: categories.status === 'denied' ? 'denied' : 'error',
      messageKey: 'attachments.capture.categoriesUnavailable',
      correlationId: categories.correlationId,
      attempt: 1,
    };
  }
  const category = categories.data.items.find((entry) => entry.categoryCode === categoryCode);
  if (category === undefined) {
    return {
      status: 'invalid',
      fieldErrors: { categoryCode: 'attachments.capture.categoryMissing' },
      attempt: 1,
    };
  }

  const captured = await captureDocument({
    categoryCode,
    entityType: REPORT_DOCUMENT_ENTITY_TYPE,
    entityId: inspectionId,
    fileName: file.name,
    contentType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    capturedAt: Number.isFinite(file.lastModified)
      ? new Date(file.lastModified).toISOString()
      : null,
  });
  if (captured.status !== 'success' || !captured.registered) return captured;
  const { documentId, versionId, status: versionStatus, scannerAvailable } = captured.registered;

  const linked = await createDocumentLink(documentId, {
    entityType: REPORT_DOCUMENT_ENTITY_TYPE,
    entityId: inspectionId,
    linkPurpose: category.businessLinkPurpose,
  });
  if (linked.status !== 'success') {
    return { ...linked, stage: 'captured', versionId, versionStatus, scannerAvailable };
  }

  const client = await authorizedClient();
  if (!client) return { ...EXPIRED, stage: 'linked', versionId, versionStatus, scannerAvailable };
  const body: DiagnosticEvidenceRecordBody = {
    documentVersionId: versionId,
    evidenceType,
    ...(noteText.length > 0 ? { note: noteText } : {}),
  };
  const bound = await client.send<unknown>('POST', reportPath(inspectionId, '/evidence'), body);
  if (!bound.ok) {
    return {
      ...fromFailure(bound, 1),
      stage: 'linked',
      versionId,
      versionStatus,
      scannerAvailable,
    };
  }
  return {
    status: 'success',
    correlationId: bound.correlationId,
    attempt: 1,
    stage: 'bound',
    versionId,
    versionStatus,
    scannerAvailable,
  };
}
