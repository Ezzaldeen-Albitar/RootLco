/**
 * The diagnostics experience contract (P1-29, `W7`).
 *
 * | operation                                | method | path                                          | permission                |
 * | ---------------------------------------- | ------ | --------------------------------------------- | ------------------------- |
 * | `dia.diagnostic-type-list`               | GET    | `/diagnostic-types`                           | `dia.diagnostic.read`     |
 * | `dia.template-list`                      | GET    | `/inspection-templates`                       | `dia.diagnostic.read`     |
 * | `dia.template-create`                    | POST   | `/inspection-templates`                       | `dia.catalogue.manage`    |
 * | `dia.template-detail`                    | GET    | `/inspection-templates/{templateId}`          | `dia.diagnostic.read`     |
 * | `dia.template-update`                    | PATCH  | `/inspection-templates/{templateId}`          | `dia.catalogue.manage`    |
 * | `dia.template-version-create`            | POST   | `/inspection-templates/{templateId}/versions` | `dia.catalogue.manage`    |
 * | `dia.template-version-item-list`         | GET    | `/template-versions/{versionId}/items`        | `dia.diagnostic.read`     |
 * | `dia.template-item-create`               | POST   | `/template-versions/{versionId}/items`        | `dia.catalogue.manage`    |
 * | `dia.template-version-status-set`        | POST   | `/template-versions/{versionId}/status`       | `dia.catalogue.manage`    |
 * | `dia.template-version-list-publishable`  | GET    | `/jobs/{jobId}/inspection-templates`          | `dia.diagnostic.record`   |
 * | `dia.diagnostic-list`                    | GET    | `/jobs/{jobId}/inspections`                   | `dia.diagnostic.read`     |
 * | `dia.diagnostic-create`                  | POST   | `/jobs/{jobId}/inspections`                   | `dia.diagnostic.record`   |
 * | `dia.diagnostic-detail`                  | GET    | `/inspections/{inspectionId}`                 | `dia.diagnostic.read`     |
 * | `dia.diagnostic-history`                 | GET    | `/inspections/{inspectionId}/history`         | `dia.diagnostic.read`     |
 * | `dia.diagnostic-item-result`             | PUT    | `/inspections/{id}/items/{templateItemId}`    | `dia.diagnostic.record`   |
 * | `dia.diagnostic-measurement-record`      | POST   | `/inspections/{id}/measurements`              | `dia.diagnostic.record`   |
 * | `dia.diagnostic-dtc-record`              | POST   | `/inspections/{id}/dtcs`                      | `dia.diagnostic.record`   |
 * | `dia.diagnostic-finding-record`          | POST   | `/inspections/{id}/findings`                  | `dia.diagnostic.record`   |
 * | `dia.diagnostic-recommendation-record`   | POST   | `/inspections/{id}/recommendations`           | `dia.diagnostic.record`   |
 * | `dia.diagnostic-evidence-record`         | POST   | `/inspections/{id}/evidence`                  | `dia.diagnostic.record`   |
 * | `dia.diagnostic-transition`              | POST   | `/inspections/{id}/transition`                | `dia.diagnostic.record`   |
 * | `dia.diagnostic-complete`                | POST   | `/inspections/{id}/completion`                | `dia.diagnostic.complete` |
 * | `dia.diagnostic-review`                  | POST   | `/inspections/{id}/reviews`                   | `dia.diagnostic.review`   |
 *
 * Typed from the views the routes return — `DiagnosticTypeView`
 * (`diagnostic-catalog-service.ts`), `TemplateRow`, `TemplateVersionRow`,
 * `TemplateItemRow` and `PublishableVersionRow` (`template-authoring-repository.ts`),
 * `DiagnosticReportView`, `DiagnosticReportDetail` and `ReportHistoryView`
 * (`diagnostic-report-service.ts`). Nothing here is invented; every field below
 * exists on the published response, and `tests/backend/p1-29-w7-diagnostics-experience`
 * holds each interface against the row that actually came back.
 *
 * ## What this module deliberately does NOT model
 *
 * - **A vocabulary of diagnostic types.** `dia.diagnostic_types` is seeded with
 *   nothing; approved vocabulary is an Owner input. The catalogue screen reads
 *   whatever W5 answers and renders an honest empty state when that is `[]`.
 * - **Editing or deleting an item, a result, a finding, a measurement, a DTC or
 *   a recommendation.** No such operation exists. A version is frozen once
 *   published; a correction to a report is a new entry, or a new revision.
 * - **Paging of items, reports per job, or publishable versions.** Those reads
 *   are unpaged on the wire — the items ARE the checklist — so no cursor type is
 *   offered where none exists. Templates and history ARE paged, and are typed so.
 * - **Reviewer identity.** `reviewerId` is a user id; the screen renders it as
 *   the opaque reference it is and never invents a name.
 */

/** The permissions the experience consults, each the code its operation declares. */
export const DIAGNOSTICS_PERMISSIONS = {
  read: 'dia.diagnostic.read',
  manage: 'dia.catalogue.manage',
  record: 'dia.diagnostic.record',
  complete: 'dia.diagnostic.complete',
  review: 'dia.diagnostic.review',
  workRead: 'wo.work_order.read',
  documentManage: 'shared.document.manage',
} as const;

/** The document link entity a report's evidence is captured against. */
export const REPORT_DOCUMENT_ENTITY_TYPE = 'dia.diagnostic_report';

/** `DiagnosticTypeView`. */
export interface DiagnosticType {
  readonly id: string;
  readonly scope: 'platform' | 'tenant';
  readonly code: string;
  readonly name: string;
  readonly status: 'active' | 'inactive';
  readonly recordVersion: number;
}

/** `TemplateRow`, `createdAt` serialised. */
export interface InspectionTemplate {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly diagnosticTypeId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly recordVersion: number;
}

/**
 * The row `dia.template-list` returns: the template plus the keyset `cursor`
 * of that row, which `dia.template-detail` does not carry. Two shapes, kept
 * apart, because a screen that pasted a list row into the detail would carry a
 * field the detail never answers.
 */
export interface InspectionTemplateListRow extends InspectionTemplate {
  readonly cursor: string;
}

/** `TemplateVersionRow`. */
export interface TemplateVersion {
  readonly id: string;
  readonly templateId: string;
  readonly versionNumber: number;
  readonly status: string;
  readonly publishedAt: string | null;
  readonly itemCount: number;
  readonly recordVersion: number;
}

/** `TemplateItemRow`, the row both the item write and the W7 item read return. */
export interface TemplateItem {
  readonly id: string;
  readonly itemCode: string;
  readonly prompt: string;
  readonly responseType: string;
  readonly unit: string | null;
  readonly isMandatory: boolean;
  readonly validationRule: unknown;
  readonly sequence: number;
  readonly recordVersion: number;
}

/** `InspectionTemplateDetail`. */
export interface TemplateDetail {
  readonly template: InspectionTemplate;
  readonly versions: readonly TemplateVersion[];
}

/** `PublishableVersionRow` — exactly the set `dia.diagnostic-create` accepts. */
export interface PublishableVersion {
  readonly versionId: string;
  readonly templateId: string;
  readonly templateCode: string;
  readonly templateName: string;
  readonly diagnosticTypeId: string;
  readonly versionNumber: number;
  readonly itemCount: number;
}

/** `DiagnosticReportView`. */
export interface DiagnosticReport {
  readonly id: string;
  readonly workOrderId: string;
  readonly jobId: string;
  readonly templateVersionId: string;
  readonly diagnosticTypeId: string;
  readonly status: string;
  readonly revisionNumber: number;
  readonly summary: string | null;
  readonly createdAt: string;
  readonly recordVersion: number;
}

/** `ItemResultRow` — a RESULT, keyed to its item; the prompt lives on the item. */
export interface ItemResult {
  readonly id: string;
  readonly templateItemId: string;
  readonly itemCode: string;
  readonly resultValue: string | null;
  readonly notApplicableReason: string | null;
  readonly recordVersion: number;
}

export interface Measurement {
  readonly id: string;
  readonly templateItemId: string | null;
  readonly label: string;
  readonly measuredValue: string;
  readonly unit: string;
  readonly withinRange: boolean | null;
  readonly recordVersion: number;
}

export interface DtcRecord {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
  readonly dtcStatus: string;
  readonly recordVersion: number;
}

export interface Finding {
  readonly id: string;
  readonly templateItemId: string | null;
  readonly severity: string;
  readonly disposition: string;
  readonly description: string;
  readonly recordVersion: number;
}

export interface Recommendation {
  readonly id: string;
  readonly recommendation: string;
  readonly priority: string;
  readonly recordVersion: number;
}

/** `EvidenceView` — the document is resolved through its link, never by raw id. */
export interface ReportEvidence {
  readonly id: string;
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note: string | null;
  readonly createdAt: string;
}

/** `ReviewView`. */
export interface ReportReview {
  readonly id: string;
  readonly reviewResult: string;
  readonly notes: string | null;
  readonly reviewerId: string;
  readonly reviewedAt: string;
}

/** `OutstandingItem` — what completion still refuses over, by code and prompt. */
export interface OutstandingItem {
  readonly itemCode: string;
  readonly prompt: string;
  readonly responseType: string;
}

/** `DiagnosticReportDetail`. */
export interface DiagnosticReportDetail {
  readonly report: DiagnosticReport;
  readonly items: readonly ItemResult[];
  readonly measurements: readonly Measurement[];
  readonly dtcs: readonly DtcRecord[];
  readonly findings: readonly Finding[];
  readonly recommendations: readonly Recommendation[];
  readonly evidence: readonly ReportEvidence[];
  readonly reviews: readonly ReportReview[];
  readonly outstandingMandatory: readonly OutstandingItem[];
  readonly nextStatuses: readonly string[];
}

/** `ReportHistoryEntry`. */
export interface ReportHistoryEntry {
  readonly id: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly reason: string | null;
  readonly occurredAt: string;
  readonly actorId: string | null;
}

/** `ReportHistoryView` — the transitions page is a real cursor page. */
export interface ReportHistory {
  readonly diagnosticReportId: string;
  readonly origin: {
    readonly createdAt: string;
    readonly createdBy: string;
    readonly initialStatus: string;
  };
  readonly transitions: {
    readonly items: readonly ReportHistoryEntry[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}
