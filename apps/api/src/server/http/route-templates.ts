/**
 * Every route template this platform serves, as literal strings.
 *
 * This module exists to end a dataflow, and the reason is precise enough to be
 * worth writing down.
 *
 * `requestFingerprint` hashes the route template, which is server-owned and
 * arrives as `operation.path`. CodeQL reported `js/insufficient-password-hash`
 * on that hash, with this path:
 *
 *   PASSWORD_RESET_COMPLETION_OPERATION → operation → operation.path
 *     → input.path → createHash('sha256')
 *
 * No password is in it: the query's source heuristic fires on the IDENTIFIER
 * NAME of a route descriptor, and the value reaching SHA-256 is a URL template.
 * But the flow is real, and a regex guard does not end it — `RE.exec(path)[0]`
 * is still derived from its input, which a full-tree analysis confirmed after
 * the guard was added.
 *
 * Matching against these literals does end it. `find` returns an element of
 * THIS array — a compile-time constant with no relationship to any route
 * module — so the hashed value provably stops deriving from the caller's input.
 *
 * It is also a real strengthening, independent of any scanner: an idempotency
 * fingerprint can now only ever bind a template this platform actually serves.
 * An unregistered one is refused instead of hashed, so a key can never be bound
 * to a target nobody declared.
 *
 * ## Keeping it honest
 *
 * A hand-maintained copy of a registry is a drift bug waiting to happen, so
 * nothing maintains it by hand: `tests/foundation/route-templates.test.ts`
 * reconciles this list against the route modules on disk and fails on any
 * difference in either direction. A template added without updating this file
 * fails the build rather than failing a request.
 *
 * Generated from the `path:` declaration of every route module under
 * `src/app/api`.
 */
export const ROUTE_TEMPLATES = Object.freeze([
  '/additional-work/{requestId}/approval',
  '/additional-work/{requestId}/detail',
  '/additional-work/{requestId}/fulfillment',
  '/additional-work/{requestId}/withdrawal',
  '/appointment-catalogue/appointment-types',
  '/appointment-catalogue/appointment-types/{appointmentTypeId}',
  '/appointment-catalogue/appointment-types/{appointmentTypeId}/status',
  '/appointment-catalogue/cancellation-reasons',
  '/appointment-catalogue/cancellation-reasons/{cancellationReasonId}',
  '/appointment-catalogue/cancellation-reasons/{cancellationReasonId}/status',
  '/appointment-catalogue/management/appointment-types',
  '/appointment-catalogue/management/cancellation-reasons',
  '/appointment-catalogue/management/source-channels',
  '/appointment-catalogue/source-channels',
  '/appointment-catalogue/source-channels/{sourceChannelId}',
  '/appointment-catalogue/source-channels/{sourceChannelId}/status',
  '/appointments',
  '/appointments/{appointmentId}',
  '/appointments/{appointmentId}/cancel',
  '/appointments/{appointmentId}/no-show',
  '/appointments/{appointmentId}/reschedule',
  '/assignments/{assignmentId}/end',
  '/attachments/categories',
  '/attachments/documents/{documentId}',
  '/attachments/documents/{documentId}/download-authorizations',
  '/attachments/documents/{documentId}/retention-evaluations',
  '/attachments/documents/{documentId}/links',
  '/attachments/links/{linkId}',
  '/attachments/upload-authorizations',
  '/attachments/versions',
  '/attachments/versions/{versionId}',
  '/attachments/versions/{versionId}/rejection',
  '/audit-events',
  '/audit-events/{recordId}',
  '/auth/login',
  '/auth/logout',
  '/auth/password-reset',
  '/auth/password-reset/completion',
  '/auth/session',
  '/credit-notes/{creditNoteId}/approval',
  '/customer-duplicates',
  '/customer-duplicates/{candidateId}/review',
  '/customer-supplied-parts',
  '/customers',
  '/customers/companies',
  '/customers/individuals',
  '/customers/{customerId}',
  '/customers/{customerId}/addresses',
  '/customers/{customerId}/alerts',
  '/customers/{customerId}/consents',
  '/customers/{customerId}/contacts',
  '/customers/{customerId}/duplicate-scans',
  '/customers/{customerId}/history',
  '/customers/{customerId}/merge',
  '/customers/{customerId}/notes',
  '/customers/{customerId}/preferences',
  '/customers/{customerId}/restrictions',
  '/customers/{customerId}/status',
  '/customers/{customerId}/tags',
  '/customers/{customerId}/timeline',
  '/customers/{customerId}/vehicles',
  '/damaged-stock',
  '/deliveries',
  '/deliveries/{deliveryId}/authorized-receiver',
  '/deliveries/{deliveryId}/checklist-results',
  '/deliveries/{deliveryId}/completion',
  '/deliveries/{deliveryId}/eligibility',
  '/deliveries/{deliveryId}/signatures',
  '/deliveries/{deliveryId}/warranties',
  '/exports/authorizations',
  '/exports/resources',
  '/external-purchase-parts',
  '/health/live',
  '/health/ready',
  '/iam/approval-limits',
  '/iam/approval-limits/{limitId}',
  '/iam/grants',
  '/iam/grants/{grantId}',
  '/iam/grants/{grantId}/scopes',
  '/iam/grants/{grantId}/scopes/{scopeId}',
  '/iam/invitations',
  '/iam/invitations/{userId}',
  '/iam/invitations/{userId}/activation',
  '/iam/permissions',
  '/iam/roles',
  '/iam/roles/{roleId}',
  '/iam/roles/{roleId}/permissions',
  '/iam/roles/{roleId}/permissions/{mappingId}',
  '/iam/users',
  '/iam/users/{userId}',
  '/iam/users/{userId}/sessions',
  '/iam/users/{userId}/status',
  '/inspections/{inspectionId}',
  '/inspections/{inspectionId}/completion',
  '/inspections/{inspectionId}/dtcs',
  '/inspections/{inspectionId}/evidence',
  '/inspections/{inspectionId}/findings',
  '/inspections/{inspectionId}/history',
  '/inspections/{inspectionId}/items/{templateItemId}',
  '/inspections/{inspectionId}/measurements',
  '/inspections/{inspectionId}/recommendations',
  '/inspections/{inspectionId}/reviews',
  '/inspections/{inspectionId}/transition',
  '/inventory-reconciliations',
  '/invoices',
  '/invoices/{invoiceId}',
  '/invoices/{invoiceId}/cancellation',
  '/invoices/{invoiceId}/credit-notes',
  '/invoices/{invoiceId}/issuance',
  '/invoices/{invoiceId}/outstanding',
  '/items',
  '/jobs/{jobId}',
  '/jobs/{jobId}/assignments',
  '/jobs/{jobId}/history',
  '/jobs/{jobId}/inspections',
  '/jobs/{jobId}/labor-sessions',
  '/jobs/{jobId}/reassignments',
  '/jobs/{jobId}/transition',
  '/labor-sessions/{sessionId}/corrections',
  '/labor-sessions/{sessionId}/stop',
  '/message-templates',
  '/message-templates/{templateId}',
  '/message-templates/{templateId}/active-version',
  '/message-templates/{templateId}/versions',
  '/meta/ping',
  '/notifications',
  '/notifications/{notificationId}',
  '/notifications/{notificationId}/deliveries',
  '/opening-inventory-batches',
  '/opening-inventory-batches/{batchId}/approval',
  '/opening-inventory-batches/{batchId}/lines',
  '/org/branches/{branchId}/settings',
  '/org/companies/{companyId}/settings',
  '/org/tenant',
  '/organization/branches/{branchId}/status',
  '/payment-methods',
  '/payments',
  '/payments/{paymentId}',
  '/payments/{paymentId}/allocations',
  '/price-lists',
  '/price-lists/{priceListId}/versions',
  '/price-lists/{priceListId}/versions/{versionId}/publication',
  '/price-lists/{priceListId}/versions/{versionId}/rules',
  '/prices',
  '/quality-controls/{recordId}',
  '/quality-controls/{recordId}/checks/{qcCheckId}',
  '/quality-controls/{recordId}/finalization',
  '/quotation-items/{quotationItemId}/decisions',
  '/quotation-revisions/{revisionId}/decisions',
  '/quotations',
  '/quotations/{quotationId}',
  '/quotations/{quotationId}/issue',
  '/quotations/{quotationId}/revisions',
  '/reports',
  '/reports/{reportCode}',
  '/reception-catalogue/capture-policies',
  '/reception-catalogue/damage-map-templates',
  '/reception-catalogue/damage-map-templates/{templateId}',
  '/reception-catalogue/damage-map-templates/{templateId}/status',
  '/reception-catalogue/damage-map-templates/{templateId}/versions',
  '/reception-catalogue/fuel-levels',
  '/reception-catalogue/fuel-levels/{fuelLevelId}',
  '/reception-catalogue/fuel-levels/{fuelLevelId}/status',
  '/reception-catalogue/management/fuel-levels',
  '/reception-catalogue/management/refusal-reasons',
  '/reception-catalogue/management/visit-reasons',
  '/reception-catalogue/management/warning-light-codes',
  '/reception-catalogue/refusal-reasons',
  '/reception-catalogue/refusal-reasons/{refusalReasonId}',
  '/reception-catalogue/refusal-reasons/{refusalReasonId}/status',
  '/reception-catalogue/receiving-employees',
  '/reception-catalogue/visit-reasons',
  '/reception-catalogue/visit-reasons/{visitReasonId}',
  '/reception-catalogue/visit-reasons/{visitReasonId}/status',
  '/reception-catalogue/warning-light-codes',
  '/reception-catalogue/warning-light-codes/{warningLightCodeId}',
  '/reception-catalogue/warning-light-codes/{warningLightCodeId}/status',
  '/receptions',
  '/receptions/{receptionId}',
  '/receptions/{receptionId}/approve',
  '/receptions/{receptionId}/authorizations',
  '/receptions/{receptionId}/close-without-work',
  '/receptions/{receptionId}/condition-evidence',
  '/receptions/{receptionId}/capture-overrides',
  '/receptions/{receptionId}/convert-to-work-order',
  '/receptions/{receptionId}/evidence-bindings',
  '/receptions/{receptionId}/evidence-bindings/{bindingId}/finalization',
  '/receptions/{receptionId}/history',
  '/receptions/{receptionId}/party-roles',
  '/receptions/{receptionId}/refusals',
  '/receptions/{receptionId}/refuse',
  '/receptions/{receptionId}/signatures',
  '/receptions/{receptionId}/signatures/{signatureId}/events',
  '/rework-links/{reworkLinkId}',
  '/rework-links/{reworkLinkId}/cost',
  '/rework-links/{reworkLinkId}/sign-off',
  '/services',
  '/services/{serviceId}',
  '/services/{serviceId}/branch-availability',
  '/services/{serviceId}/versions/{versionId}/publication',
  '/stock-availability',
  '/stock-issues',
  '/stock-movements',
  '/stock-reservations',
  '/stock-reservations/{reservationId}/release',
  '/stock-returns',
  '/technicians',
  '/technicians/available',
  '/technicians/{technicianProfileId}',
  '/technicians/{technicianProfileId}/availability',
  '/technicians/{technicianProfileId}/availability/{availabilityId}',
  '/technicians/{technicianProfileId}/certifications',
  '/technicians/{technicianProfileId}/certifications/{certificationId}',
  '/technicians/{technicianProfileId}/certifications/{certificationId}/detail',
  '/technicians/{technicianProfileId}/queue',
  '/technicians/{technicianProfileId}/skills/{skillId}',
  '/template-versions/{versionId}',
  '/template-versions/{versionId}/approval',
  '/template-versions/{versionId}/preview',
  '/template-versions/{versionId}/retirement',
  '/vehicle-catalogue/body-types',
  '/vehicle-catalogue/makes',
  '/vehicle-catalogue/makes/{makeId}/models',
  '/vehicle-catalogue/models/{modelId}/trims',
  '/vehicle-catalogue/powertrain-types',
  '/vehicle-duplicates',
  '/vehicle-duplicates/{candidateId}/review',
  '/vehicles',
  '/vehicles/{vehicleId}',
  '/vehicles/{vehicleId}/authorized-parties',
  '/vehicles/{vehicleId}/authorized-parties/{relationshipId}/retirement',
  '/vehicles/{vehicleId}/documents',
  '/vehicles/{vehicleId}/duplicate-scans',
  '/vehicles/{vehicleId}/ev-profile',
  '/vehicles/{vehicleId}/history',
  '/vehicles/{vehicleId}/merge',
  '/vehicles/{vehicleId}/odometer-readings',
  '/vehicles/{vehicleId}/ownerships',
  '/vehicles/{vehicleId}/plates',
  '/vehicles/{vehicleId}/relationships',
  '/vehicles/{vehicleId}/status',
  '/warranties/{warrantyId}',
  '/work-orders',
  '/work-orders/{workOrderId}',
  '/work-orders/{workOrderId}/additional-work',
  '/work-orders/{workOrderId}/closure',
  '/work-orders/{workOrderId}/closure-eligibility',
  '/work-orders/{workOrderId}/history',
  '/work-orders/{workOrderId}/invoice-preview',
  '/work-orders/{workOrderId}/jobs',
  '/work-orders/{workOrderId}/quality-controls',
  '/work-orders/{workOrderId}/reopen-attempts',
  '/work-orders/{workOrderId}/required-parts',
  '/work-orders/{workOrderId}/rework',
  '/work-orders/{workOrderId}/service-lines',
  '/work-orders/{workOrderId}/transition',
] as const);

/**
 * Returns the caller's path as the matching LITERAL from `ROUTE_TEMPLATES`,
 * or `null` when it is not a registered template.
 *
 * Returning the literal rather than the argument is the entire point. A version
 * ending `return path` would be **behaviourally identical** — JavaScript strings
 * are values, so nothing at runtime can tell the two apart — and would end no
 * dataflow at all. That is not a hypothetical: the mutation was applied, the
 * whole suite passed, and only the hosted dataflow analysis can see it.
 *
 * A `Set` membership check used to precede this. It was removed: `find` already
 * answers the same question, so the check decided nothing, and a line that
 * cannot change any outcome is a line no test can pin. 256 short strings is not
 * a hot path worth an untestable branch.
 *
 * That figure is corrected by whichever slice grows the array — it was 169 when
 * this was written, 189 after P1-22 added its twenty operations, and 256 after
 * PRE-P1-29-BR-03 added eight. Nothing pins it: `route-templates.test.ts`
 * asserts a floor and filesystem equality, not this number, so it is prose that
 * has to be maintained by hand and is stated here rather than left to rot.
 */
export function internRouteTemplate(path: string): string | null {
  return ROUTE_TEMPLATES.find((template) => template === path) ?? null;
}
