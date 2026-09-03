/**
 * OpenAPI code/spec divergence gate (P1-13-BE-020, P1-13-QA-006).
 *
 * The committed `docs/api/openapi.v1.json` is *generated* from the operation
 * registry. This test regenerates it and compares, so the published contract
 * cannot drift from the code that serves it — the failure mode where a client
 * team builds against a document describing an endpoint that changed months ago.
 *
 * Regenerate deliberately after an intentional contract change:
 *
 *   UPDATE_OPENAPI=1 npx vitest run tests/openapi-contract.test.ts
 *
 * Writing the file is opt-in precisely so a drifting build cannot "fix" itself.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildOpenApiDocument } from '@/server/openapi/document';

// Importing the route module executes its `defineOperation` call, which is what
// puts the operation in the registry. If a route is not imported anywhere the
// authorization-coverage check catches it; here we only need the registry filled.
//
// THIS LIST IS HAND-MAINTAINED, AND THAT IS ITS TRAP. The committed document is
// generated from whatever this list loaded, and the comparison below regenerates
// it the same way — so a route missing here is missing from the published
// contract AND the test still passes, because both sides agree on the same
// incomplete registry. That is exactly how all twelve Phase 1-18 operations came
// to be absent from `docs/api/openapi.v1.json` while every gate read green.
//
// WHAT ACTUALLY CLOSES IT: `scripts/ci/check-route-registry-parity.mjs` (CSA-14).
// It compares this import list against the FILESYSTEM — every `route.ts` under
// `apps/api/src/app/api/v1` — and exits 1 on any drift in either direction, so a
// route added without a line here goes red automatically. It runs in hosted CI
// (`_reusable-node-quality.yml`, the static-quality task) and in the clean room
// (`_reusable-clean-room.yml`), and its own falsifiability proof is
// `tests/ci/policy-and-linters.test.ts` -> "route <-> registry parity", which
// feeds `compare()` a synthetic route set rather than editing the registry the
// generator reads. It has already earned it: the twenty invoice and payment
// imports below were named by that gate before they were added (see line ~323).
//
// This header previously said the catch was external arithmetic between
// `check-authorization-coverage.mjs` and `check-openapi.mjs`. That was written
// before CSA-14 existed and is not how the protection works; no gate compares
// those two counts. Adding a route still means adding a line here — the gate
// tells you when you forgot, it does not add it for you.
import '@/app/api/v1/meta/ping/route';
import '@/app/api/v1/auth/login/route';
import '@/app/api/v1/auth/logout/route';
import '@/app/api/v1/auth/session/route';
import '@/app/api/v1/auth/password-reset/route';
import '@/app/api/v1/auth/password-reset/completion/route';
import '@/app/api/v1/iam/invitations/route';
import '@/app/api/v1/iam/invitations/[userId]/route';
import '@/app/api/v1/iam/invitations/[userId]/activation/route';
import '@/app/api/v1/iam/users/route';
import '@/app/api/v1/iam/users/[userId]/route';
import '@/app/api/v1/iam/users/[userId]/status/route';
import '@/app/api/v1/iam/users/[userId]/sessions/route';
import '@/app/api/v1/iam/permissions/route';
import '@/app/api/v1/iam/roles/route';
import '@/app/api/v1/iam/roles/[roleId]/route';
import '@/app/api/v1/iam/roles/[roleId]/permissions/route';
import '@/app/api/v1/iam/roles/[roleId]/permissions/[mappingId]/route';
import '@/app/api/v1/iam/grants/route';
import '@/app/api/v1/iam/grants/[grantId]/route';
import '@/app/api/v1/iam/grants/[grantId]/scopes/route';
import '@/app/api/v1/iam/grants/[grantId]/scopes/[scopeId]/route';
import '@/app/api/v1/iam/approval-limits/route';
import '@/app/api/v1/iam/approval-limits/[limitId]/route';
import '@/app/api/v1/audit-events/route';
import '@/app/api/v1/audit-events/[recordId]/route';
import '@/app/api/v1/org/tenant/route';
import '@/app/api/v1/org/companies/[companyId]/settings/route';
import '@/app/api/v1/org/branches/[branchId]/settings/route';
// --- Phase 1-15 shared services ------------------------------------------
import '@/app/api/v1/attachments/categories/route';
import '@/app/api/v1/attachments/upload-authorizations/route';
import '@/app/api/v1/attachments/versions/route';
import '@/app/api/v1/attachments/versions/[versionId]/route';
import '@/app/api/v1/attachments/versions/[versionId]/rejection/route';
import '@/app/api/v1/attachments/documents/[documentId]/route';
import '@/app/api/v1/attachments/documents/[documentId]/retention-evaluations/route';
import '@/app/api/v1/attachments/documents/[documentId]/download-authorizations/route';
import '@/app/api/v1/attachments/documents/[documentId]/links/route';
import '@/app/api/v1/attachments/links/[linkId]/route';
import '@/app/api/v1/qc-checks/route';
import '@/app/api/v1/reports/route';
import '@/app/api/v1/reports/[reportCode]/route';
import '@/app/api/v1/notifications/route';
import '@/app/api/v1/notifications/[notificationId]/route';
import '@/app/api/v1/notifications/[notificationId]/deliveries/route';
import '@/app/api/v1/message-templates/route';
import '@/app/api/v1/message-templates/[templateId]/route';
import '@/app/api/v1/message-templates/[templateId]/versions/route';
import '@/app/api/v1/message-templates/[templateId]/active-version/route';
import '@/app/api/v1/template-versions/[versionId]/route';
import '@/app/api/v1/template-versions/[versionId]/approval/route';
import '@/app/api/v1/template-versions/[versionId]/retirement/route';
import '@/app/api/v1/template-versions/[versionId]/preview/route';
import '@/app/api/v1/organization/branches/[branchId]/status/route';
import '@/app/api/v1/exports/authorizations/route';
import '@/app/api/v1/exports/resources/route';
import '@/app/api/v1/health/live/route';
import '@/app/api/v1/health/ready/route';
// --- Phase 1-16 CRM backend ----------------------------------------------
import '@/app/api/v1/customers/route';
import '@/app/api/v1/customers/individuals/route';
import '@/app/api/v1/customers/companies/route';
import '@/app/api/v1/customers/[customerId]/route';
import '@/app/api/v1/customers/[customerId]/contacts/route';
import '@/app/api/v1/customers/[customerId]/addresses/route';
import '@/app/api/v1/customers/[customerId]/preferences/route';
import '@/app/api/v1/customers/[customerId]/consents/route';
import '@/app/api/v1/customers/[customerId]/notes/route';
import '@/app/api/v1/customers/[customerId]/alerts/route';
import '@/app/api/v1/customers/[customerId]/tags/route';
import '@/app/api/v1/customers/[customerId]/status/route';
import '@/app/api/v1/customers/[customerId]/restrictions/route';
import '@/app/api/v1/customer-duplicates/route';
import '@/app/api/v1/customers/[customerId]/duplicate-scans/route';
import '@/app/api/v1/customer-duplicates/[candidateId]/review/route';
import '@/app/api/v1/customers/[customerId]/merge/route';
import '@/app/api/v1/customers/[customerId]/history/route';
import '@/app/api/v1/customers/[customerId]/timeline/route';
import '@/app/api/v1/customers/[customerId]/vehicles/route';
// --- Phase 1-17 vehicle backend ------------------------------------------
// Reference catalogues, added by the P1-17 remediation for `P1-27-INT-007`.
// These five MUST be listed here: the committed document is generated from
// whatever this list loaded, so an unimported route is silently absent from the
// published contract while every gate stays green.
import '@/app/api/v1/vehicle-catalogue/makes/route';
import '@/app/api/v1/vehicle-catalogue/makes/[makeId]/models/route';
import '@/app/api/v1/vehicle-catalogue/models/[modelId]/trims/route';
import '@/app/api/v1/vehicle-catalogue/body-types/route';
import '@/app/api/v1/vehicle-catalogue/powertrain-types/route';
import '@/app/api/v1/vehicles/route';
import '@/app/api/v1/vehicles/[vehicleId]/route';
import '@/app/api/v1/vehicles/[vehicleId]/merge/route';
import '@/app/api/v1/vehicles/[vehicleId]/duplicate-scans/route';
import '@/app/api/v1/vehicle-duplicates/route';
import '@/app/api/v1/vehicle-duplicates/[candidateId]/review/route';
import '@/app/api/v1/vehicles/[vehicleId]/plates/route';
import '@/app/api/v1/vehicles/[vehicleId]/ownerships/route';
import '@/app/api/v1/vehicles/[vehicleId]/relationships/route';
import '@/app/api/v1/vehicles/[vehicleId]/authorized-parties/route';
import '@/app/api/v1/vehicles/[vehicleId]/authorized-parties/[relationshipId]/retirement/route';
import '@/app/api/v1/vehicles/[vehicleId]/odometer-readings/route';
import '@/app/api/v1/vehicles/[vehicleId]/ev-profile/route';
import '@/app/api/v1/vehicles/[vehicleId]/status/route';
import '@/app/api/v1/vehicles/[vehicleId]/history/route';
import '@/app/api/v1/vehicles/[vehicleId]/documents/route';
// --- Phase 1-18 appointment and reception backend -------------------------
import '@/app/api/v1/appointments/route';
import '@/app/api/v1/appointments/[appointmentId]/route';
import '@/app/api/v1/appointments/[appointmentId]/reschedule/route';
import '@/app/api/v1/appointments/[appointmentId]/cancel/route';
import '@/app/api/v1/appointments/[appointmentId]/no-show/route';
// P1-27 read-surface remediation: the intake catalogue reads (INT-018) and the
// read/closure route modules below MUST be listed here — the committed document
// is generated from whatever this list loaded, so an unimported route is
// silently absent from the published contract while every gate stays green.
import '@/app/api/v1/appointment-catalogue/appointment-types/route';
import '@/app/api/v1/appointment-catalogue/source-channels/route';
import '@/app/api/v1/appointment-catalogue/cancellation-reasons/route';
import '@/app/api/v1/reception-catalogue/visit-reasons/route';
import '@/app/api/v1/reception-catalogue/fuel-levels/route';
import '@/app/api/v1/reception-catalogue/warning-light-codes/route';
import '@/app/api/v1/reception-catalogue/refusal-reasons/route';
import '@/app/api/v1/reception-catalogue/receiving-employees/route';
// P1-27-INT-018 management half. The seven creates are POSTs inside the seven
// collection modules already imported above, so they arrive for free — these
// fourteen do NOT, and each is the only place its operation is declared. An
// omission here is invisible in this file by construction (both sides of the
// comparison would load the same short registry); `check-openapi.mjs` counting
// 282 published against `check-authorization-coverage.mjs` counting 282
// registered is what actually catches it.
import '@/app/api/v1/appointment-catalogue/appointment-types/[appointmentTypeId]/route';
import '@/app/api/v1/appointment-catalogue/appointment-types/[appointmentTypeId]/status/route';
import '@/app/api/v1/appointment-catalogue/source-channels/[sourceChannelId]/route';
import '@/app/api/v1/appointment-catalogue/source-channels/[sourceChannelId]/status/route';
import '@/app/api/v1/appointment-catalogue/cancellation-reasons/[cancellationReasonId]/route';
import '@/app/api/v1/appointment-catalogue/cancellation-reasons/[cancellationReasonId]/status/route';
import '@/app/api/v1/reception-catalogue/visit-reasons/[visitReasonId]/route';
import '@/app/api/v1/reception-catalogue/visit-reasons/[visitReasonId]/status/route';
import '@/app/api/v1/reception-catalogue/fuel-levels/[fuelLevelId]/route';
import '@/app/api/v1/reception-catalogue/fuel-levels/[fuelLevelId]/status/route';
import '@/app/api/v1/reception-catalogue/warning-light-codes/[warningLightCodeId]/route';
import '@/app/api/v1/reception-catalogue/warning-light-codes/[warningLightCodeId]/status/route';
import '@/app/api/v1/reception-catalogue/refusal-reasons/[refusalReasonId]/route';
import '@/app/api/v1/reception-catalogue/refusal-reasons/[refusalReasonId]/status/route';
// P1-27-INT-018 administrative reads. The picker lists above cannot serve a
// catalogue-administration screen — they filter to `status = 'active'` and
// project no `recordVersion` — so these seven are the read the management
// commands need, gated on `apt.catalogue.manage` / `rec.catalogue.manage`.
import '@/app/api/v1/appointment-catalogue/management/appointment-types/route';
import '@/app/api/v1/appointment-catalogue/management/source-channels/route';
import '@/app/api/v1/appointment-catalogue/management/cancellation-reasons/route';
import '@/app/api/v1/reception-catalogue/management/visit-reasons/route';
import '@/app/api/v1/reception-catalogue/management/fuel-levels/route';
import '@/app/api/v1/reception-catalogue/management/warning-light-codes/route';
import '@/app/api/v1/reception-catalogue/management/refusal-reasons/route';
import '@/app/api/v1/receptions/route';
import '@/app/api/v1/receptions/[receptionId]/route';
import '@/app/api/v1/receptions/[receptionId]/history/route';
import '@/app/api/v1/receptions/[receptionId]/party-roles/route';
import '@/app/api/v1/receptions/[receptionId]/authorizations/route';
import '@/app/api/v1/receptions/[receptionId]/condition-evidence/route';
import '@/app/api/v1/receptions/[receptionId]/signatures/route';
import '@/app/api/v1/receptions/[receptionId]/signatures/[signatureId]/events/route';
import '@/app/api/v1/receptions/[receptionId]/evidence-bindings/route';
import '@/app/api/v1/receptions/[receptionId]/evidence-bindings/[bindingId]/finalization/route';
import '@/app/api/v1/receptions/[receptionId]/capture-overrides/route';
import '@/app/api/v1/reception-catalogue/damage-map-templates/route';
import '@/app/api/v1/reception-catalogue/damage-map-templates/[templateId]/route';
import '@/app/api/v1/reception-catalogue/damage-map-templates/[templateId]/versions/route';
import '@/app/api/v1/reception-catalogue/damage-map-templates/[templateId]/status/route';
import '@/app/api/v1/reception-catalogue/capture-policies/route';
import '@/app/api/v1/receptions/[receptionId]/refusals/route';
import '@/app/api/v1/receptions/[receptionId]/approve/route';
import '@/app/api/v1/receptions/[receptionId]/convert-to-work-order/route';
import '@/app/api/v1/receptions/[receptionId]/close-without-work/route';
import '@/app/api/v1/receptions/[receptionId]/refuse/route';
// --- Phase 1-19 work order, diagnostics and technician backend -------------
// There is deliberately no `POST /work-orders`: reception's conversion above is
// the only creation path (see the header of `work-orders/route.ts`).
import '@/app/api/v1/work-orders/route';
import '@/app/api/v1/work-orders/[workOrderId]/route';
import '@/app/api/v1/work-orders/[workOrderId]/history/route';
import '@/app/api/v1/work-orders/[workOrderId]/closure-eligibility/route';
import '@/app/api/v1/work-orders/[workOrderId]/transition/route';
import '@/app/api/v1/work-orders/[workOrderId]/closure/route';
import '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import '@/app/api/v1/jobs/route';
import '@/app/api/v1/jobs/[jobId]/route';
import '@/app/api/v1/jobs/[jobId]/work-logs/route';
import '@/app/api/v1/jobs/[jobId]/evidence/route';
import '@/app/api/v1/work-orders/[workOrderId]/evidence/route';
import '@/app/api/v1/work-order-catalogue/route';
import '@/app/api/v1/quality-controls/route';
import '@/app/api/v1/jobs/[jobId]/transition/route';
import '@/app/api/v1/jobs/[jobId]/history/route';
import '@/app/api/v1/jobs/[jobId]/assignments/route';
import '@/app/api/v1/jobs/[jobId]/reassignments/route';
import '@/app/api/v1/assignments/[assignmentId]/end/route';
import '@/app/api/v1/technicians/[technicianProfileId]/queue/route';
import '@/app/api/v1/technicians/available/route';
// BR-01. This list is hand-maintained and is its own documented trap: a route
// missing here is missing from the published contract AND the test still passes,
// because both sides agree on the same incomplete registry.
import '@/app/api/v1/technicians/me/queue/route';
// Technician roster administration (BR-03). This list is hand-maintained, which
// is exactly how P1-27-INT-113 shipped six operations that answered 500 to every
// request: an operation absent from here is absent from every registry-walking
// suite, and nothing else notices.
import '@/app/api/v1/technicians/route';
import '@/app/api/v1/technicians/[technicianProfileId]/route';
import '@/app/api/v1/technicians/[technicianProfileId]/skills/[skillId]/route';
import '@/app/api/v1/technicians/[technicianProfileId]/certifications/route';
import '@/app/api/v1/technicians/[technicianProfileId]/certifications/[certificationId]/route';
import '@/app/api/v1/technicians/[technicianProfileId]/certifications/[certificationId]/detail/route';
import '@/app/api/v1/technicians/[technicianProfileId]/availability/route';
import '@/app/api/v1/technicians/[technicianProfileId]/availability/[availabilityId]/route';
import '@/app/api/v1/jobs/[jobId]/labor-sessions/route';
import '@/app/api/v1/labor-sessions/[sessionId]/stop/route';
import '@/app/api/v1/labor-sessions/[sessionId]/corrections/route';
import '@/app/api/v1/work-orders/[workOrderId]/service-lines/route';
import '@/app/api/v1/work-orders/[workOrderId]/required-parts/route';
import '@/app/api/v1/work-orders/[workOrderId]/additional-work/route';
import '@/app/api/v1/additional-work/[requestId]/detail/route';
import '@/app/api/v1/additional-work/[requestId]/withdrawal/route';
import '@/app/api/v1/additional-work/[requestId]/approval/route';
import '@/app/api/v1/additional-work/[requestId]/fulfillment/route';
// The path vocabulary is `inspections`; the model is `dia.diagnostic_reports`. Both
// are kept deliberately — see the header of `jobs/[jobId]/inspections/route.ts`.
import '@/app/api/v1/jobs/[jobId]/inspections/route';
import '@/app/api/v1/inspections/[inspectionId]/route';
import '@/app/api/v1/inspections/[inspectionId]/history/route';
import '@/app/api/v1/inspections/[inspectionId]/transition/route';
import '@/app/api/v1/inspections/[inspectionId]/completion/route';
import '@/app/api/v1/inspections/[inspectionId]/items/[templateItemId]/route';
import '@/app/api/v1/inspections/[inspectionId]/measurements/route';
import '@/app/api/v1/inspections/[inspectionId]/dtcs/route';
import '@/app/api/v1/inspections/[inspectionId]/findings/route';
import '@/app/api/v1/inspections/[inspectionId]/evidence/route';
import '@/app/api/v1/inspections/[inspectionId]/recommendations/route';
import '@/app/api/v1/inspections/[inspectionId]/reviews/route';
// --- Wave 8: quality control, reopen refusal and rework ---------------------
import '@/app/api/v1/work-orders/[workOrderId]/quality-controls/route';
import '@/app/api/v1/quality-controls/[recordId]/route';
import '@/app/api/v1/quality-controls/[recordId]/checks/[qcCheckId]/route';
import '@/app/api/v1/quality-controls/[recordId]/finalization/route';
import '@/app/api/v1/work-orders/[workOrderId]/reopen-attempts/route';
import '@/app/api/v1/work-orders/[workOrderId]/rework/route';
import '@/app/api/v1/rework-links/[reworkLinkId]/route';
import '@/app/api/v1/rework-links/[reworkLinkId]/sign-off/route';
import '@/app/api/v1/rework-links/[reworkLinkId]/cost/route';
// Phase 1-20 — service catalog, pricing, quotation.
import '@/app/api/v1/services/route';
import '@/app/api/v1/services/[serviceId]/route';
import '@/app/api/v1/services/[serviceId]/branch-availability/route';
import '@/app/api/v1/services/[serviceId]/versions/[versionId]/publication/route';
import '@/app/api/v1/price-lists/route';
import '@/app/api/v1/price-lists/[priceListId]/versions/route';
import '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import '@/app/api/v1/prices/route';
import '@/app/api/v1/quotations/route';
import '@/app/api/v1/quotations/[quotationId]/route';
import '@/app/api/v1/quotations/[quotationId]/revisions/route';
import '@/app/api/v1/quotations/[quotationId]/issue/route';
import '@/app/api/v1/quotation-items/[quotationItemId]/decisions/route';
import '@/app/api/v1/quotation-revisions/[revisionId]/decisions/route';

// Phase 1-21 — inventory.
import '@/app/api/v1/items/route';
import '@/app/api/v1/stock-availability/route';
import '@/app/api/v1/stock-movements/route';
import '@/app/api/v1/inventory-reconciliations/route';
import '@/app/api/v1/opening-inventory-batches/route';
import '@/app/api/v1/opening-inventory-batches/[batchId]/lines/route';
import '@/app/api/v1/opening-inventory-batches/[batchId]/approval/route';
import '@/app/api/v1/stock-reservations/route';
import '@/app/api/v1/stock-reservations/[reservationId]/release/route';
import '@/app/api/v1/stock-issues/route';
import '@/app/api/v1/stock-returns/route';
import '@/app/api/v1/damaged-stock/route';
import '@/app/api/v1/customer-supplied-parts/route';
import '@/app/api/v1/external-purchase-parts/route';

// Phase 1-22 — billing, payment, delivery and warranty.
//
// Twenty imports, and every one of them is load-bearing in the way this file's own
// header warns about: an absent import leaves the operation out of the GENERATED
// document as well as the committed one, so the divergence assertion compares two
// documents that agree with each other and disagree with the code.
// `scripts/ci/check-route-registry-parity.mjs` is what catches that, and it named all
// twenty of these before they were added.
import '@/app/api/v1/work-orders/[workOrderId]/invoice-preview/route';
import '@/app/api/v1/invoices/route';
import '@/app/api/v1/invoices/[invoiceId]/route';
import '@/app/api/v1/invoices/[invoiceId]/issuance/route';
import '@/app/api/v1/invoices/[invoiceId]/outstanding/route';
import '@/app/api/v1/invoices/[invoiceId]/cancellation/route';
import '@/app/api/v1/invoices/[invoiceId]/credit-notes/route';
import '@/app/api/v1/credit-notes/[creditNoteId]/approval/route';
import '@/app/api/v1/payments/route';
import '@/app/api/v1/payments/[paymentId]/route';
import '@/app/api/v1/payments/[paymentId]/allocations/route';
import '@/app/api/v1/payment-methods/route';
import '@/app/api/v1/deliveries/route';
import '@/app/api/v1/deliveries/[deliveryId]/eligibility/route';
import '@/app/api/v1/deliveries/[deliveryId]/authorized-receiver/route';
import '@/app/api/v1/deliveries/[deliveryId]/checklist-results/route';
import '@/app/api/v1/deliveries/[deliveryId]/signatures/route';
import '@/app/api/v1/deliveries/[deliveryId]/completion/route';
import '@/app/api/v1/deliveries/[deliveryId]/warranties/route';
import '@/app/api/v1/warranties/[warrantyId]/route';

// --- PRE-P1-29-BR-04 inspection-template authoring -------------------------
// The authoring surface for `dia.inspection_templates`, `dia.template_versions`
// and `dia.template_items`, which held zero rows and had no write path at all.
// `/jobs/{jobId}/inspection-templates` is the technician's read and is the only
// one of the eight that is branch-scoped — it is reached THROUGH a job, whereas
// the library itself carries no company or branch column.
import '@/app/api/v1/inspection-templates/route';
import '@/app/api/v1/inspection-templates/[templateId]/route';
import '@/app/api/v1/inspection-templates/[templateId]/versions/route';
import '@/app/api/v1/template-versions/[versionId]/status/route';
import '@/app/api/v1/template-versions/[versionId]/items/route';
import '@/app/api/v1/jobs/[jobId]/inspection-templates/route';
import '@/app/api/v1/diagnostic-types/route';
import '@/app/api/v1/jobs/[jobId]/blockers/route';
import '@/app/api/v1/blockers/[blockerId]/resolution/route';
import '@/app/api/v1/work-orders/[workOrderId]/timeline/route';

// PRE-P1-29 Wave B — the control plane. These two modules are the only ones in
// the document whose operations are not inside a tenant; they are imported here
// for the same reason as every line above, which is that the registry is
// populated by import side effect and an unimported route is simply absent from
// the generated document rather than reported as missing.
// PRE-P1-29 Wave C — the Company RBAC Backend. Imported for the same reason as
// every line above: the registry is populated by import side effect, so an
// unimported route is simply ABSENT from the generated document rather than
// reported as missing.
import '@/app/api/v1/org/companies/route';
import '@/app/api/v1/org/companies/[companyId]/route';
import '@/app/api/v1/org/companies/[companyId]/status/route';
import '@/app/api/v1/org/branches/route';
import '@/app/api/v1/org/branches/[branchId]/route';
import '@/app/api/v1/org/departments/route';
import '@/app/api/v1/org/departments/[departmentId]/route';

import '@/app/api/v1/platform/organizations/route';
import '@/app/api/v1/platform/organizations/[tenantId]/status/route';

const DOCUMENT_PATH = join(process.cwd(), 'docs', 'api', 'openapi.v1.json');

describe('OpenAPI contract', () => {
  const generated = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

  it('matches the committed document', () => {
    if (process.env.UPDATE_OPENAPI === '1') {
      mkdirSync(dirname(DOCUMENT_PATH), { recursive: true });
      writeFileSync(DOCUMENT_PATH, generated, 'utf8');
    }
    // Compared as parsed JSON, not as text: whitespace is Prettier's business
    // (it formats the committed file), while the *contract* is the structure.
    // A byte comparison would turn a formatting pass into a false divergence.
    const committed: unknown = JSON.parse(readFileSync(DOCUMENT_PATH, 'utf8'));
    expect(committed).toEqual(JSON.parse(generated));
  });

  it('registers the exemplar operation with its guard metadata', () => {
    const document = JSON.parse(generated) as {
      paths: Record<
        string,
        Record<
          string,
          { operationId: string; 'x-required-permissions': string[]; security: unknown[] }
        >
      >;
    };
    const ping = document.paths['/api/v1/meta/ping']?.['get'];
    expect(ping?.operationId).toBe('meta.ping');
    // `org.tenant.read`, not the unregistered `platform.meta.ping` P1-13
    // declared — see finding PC-1 in the route file.
    expect(ping?.['x-required-permissions']).toEqual(['org.tenant.read']);
    // A secured operation must not advertise itself as public.
    expect(ping?.security).not.toEqual([]);
  });

  it('declares a permission that exists in the seeded catalog for every secured operation', () => {
    // The catalog is the authority for what the platform's permission model
    // defines. A code that is not in it can never evaluate true, so an operation
    // declaring one is permanently unreachable — which is exactly the defect
    // `platform.meta.ping` was (PC-1). The list mirrors
    // `supabase/seeds/04_iam_permission_catalog.sql`; `tests/db/iam-seeds.test.ts`
    // asserts the seed itself, so the two cannot both drift unnoticed.
    // `shared` joined the list with DBCR-P1-15-001, which seeded
    // `shared.document.manage` and `shared.notification.send`. `crm` joins with
    // Phase 1-16 (crm.customer.read, crm.customer.note.write, …), and `apt` and
    // `rec` with Phase 1-18's nine appointment and reception codes. `platform`
    // joins with PRE-P1-29 Wave B, which seeds the three control-plane codes —
    // the first domain whose permissions are resolved by
    // `iam.has_platform_authority` rather than `iam.has_permission`, and so the
    // first whose absence here would have reproduced PC-1 rather than merely
    // resembled it. Omitting a
    // domain does not make this assertion stricter, it makes it vacuous: an
    // operation whose route is missing from the import list above declares
    // nothing, so the loop never sees the code the missing domain would have
    // failed on.
    const SEEDED_DOMAINS = [
      'apt',
      'crm',
      'dia',
      'iam',
      'inv',
      'org',
      'platform',
      'qms',
      'quo',
      'rec',
      'rpt',
      'sal',
      'shared',
      'svc',
      'tech',
      'veh',
      'wo',
      'wty',
    ];
    const document = JSON.parse(generated) as {
      paths: Record<string, Record<string, { 'x-required-permissions'?: string[] }>>;
    };
    for (const item of Object.values(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        for (const code of operation['x-required-permissions'] ?? []) {
          expect(SEEDED_DOMAINS, `permission "${code}" uses an unseeded domain`).toContain(
            code.split('.')[0]
          );
        }
      }
    }
  });

  it('declares every failure response as the shared problem document', () => {
    const document = JSON.parse(generated) as {
      paths: Record<string, Record<string, { responses: Record<string, { $ref?: string }> }>>;
    };
    for (const item of Object.values(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        for (const [status, response] of Object.entries(operation.responses)) {
          if (Number(status) < 400) continue;
          expect(response.$ref).toBe('#/components/responses/Problem');
        }
      }
    }
  });
});
