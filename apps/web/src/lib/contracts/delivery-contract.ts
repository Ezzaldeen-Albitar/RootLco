/**
 * Request bodies of the five `sal` delivery writes this application sends
 * (P1-31, FE-002 completion, FE-003 receiver, FE-004 checklist, FE-006
 * signature), mirrored field-for-field from the zod schemas in
 * `apps/api/src/app/api/v1/deliveries/**` so the P1-30 payload-parity gate can
 * hold them against the routes.
 *
 * Every one of the five schemas is `.strict()`. A field this file does not name
 * is a field the route refuses outright rather than ignores, which is why the
 * mirror is the whole body and never a convenient subset.
 *
 * ## Only ONE of the five is version-guarded
 *
 * `sal.delivery-complete` declares `versionGuarded: true` and its handler
 * refuses a request with no `If-Match` before it looks at anything else. The
 * other four declare no guard and no `If-Match` is sent with them — a present
 * but malformed header would be refused (428) by an operation that ignores a
 * valid one.
 *
 * The version a completion must quote is the one the ELIGIBILITY read
 * republishes, not the one a checklist result or a signature answered with.
 * Recording a result and attaching a signature both move the delivery row, so a
 * version taken from either of those responses is stale by construction.
 *
 * ## All five are idempotent, and no caller invents a key
 *
 * Each is registered `idempotent: true`, so the transport attaches the
 * `Idempotency-Key` header from the generated table. A retry under the same key
 * is answered with the STORED body, which means a `replayed` flag inside it is
 * the one first written — a screen must never read a replay from the fact that
 * it reused a key.
 *
 * ## No amount crosses this boundary
 *
 * The one decimal here is an odometer reading, which is a measurement rather
 * than money: `veh.odometer_readings.value` is `numeric(12,1)`. It is carried as
 * a string for the same reason an amount would be — nothing about it may be
 * approximate — and this tier performs no arithmetic on it.
 */

/**
 * `sal.delivery-create` — `POST /deliveries`. Both fields are required.
 *
 * The vehicle and the reception visit are deliberately absent: the service
 * derives both from the work order because `sal.guard_delivery_coherence`
 * requires them to match it, so a mismatch cannot be expressed at all.
 */
export interface DeliveryCreateBody {
  readonly workOrderId: string;
  /**
   * Who is handing the vehicle over.
   *
   * `sal.delivery_records.delivering_employee_id` is `NOT NULL` and the DDL
   * gives it **no foreign key**, so the route validates the shape of a uuid and
   * asserts nothing further about which register the identifier belongs to.
   * Owner requirement OWR-2026-09-06-G-10 leaves that undecided, and this mirror
   * does not decide it either.
   */
  readonly deliveringEmployeeId: string;
}

/**
 * `sal.delivery-receiver-verify` — `POST /deliveries/{deliveryId}/authorized-receiver`.
 *
 * Singular, because one delivery admits exactly one receiver. The partner is not
 * a free choice: `sal.guard_authorized_receiver` requires the partner to hold a
 * reception party role for this delivery's visit that is valid at the moment of
 * verification, so the platform decides authority and the caller only nominates.
 */
export interface DeliveryReceiverVerifyBody {
  readonly receiverPartnerId: string;
  /**
   * A stored document version holding proof of identity. Optional.
   *
   * A reference and only a reference: the route never reads the document, and
   * nothing on this side asks for its bytes.
   */
  readonly identityEvidenceDocumentVersionId?: string;
}

/**
 * `sal.delivery-checklist-record` — `POST /deliveries/{deliveryId}/checklist-results`.
 *
 * `ck_delivery_checklist_results_waiver` makes the waiver rule a biconditional:
 * a waived outcome without a reason and a reason attached to a pass are BOTH
 * refused. The optional marker on `waiverReason` therefore describes the field's
 * presence in the body, never a licence to omit it when the outcome is `waived`.
 */
export interface DeliveryChecklistRecordBody {
  readonly templateItemId: string;
  readonly outcome: 'passed' | 'failed' | 'waived';
  /** Required when — and only when — the outcome is `waived`. 1–2000 characters. */
  readonly waiverReason?: string;
}

/**
 * `sal.delivery-signature-attach` — `POST /deliveries/{deliveryId}/signatures`.
 *
 * A reference, never an image. There is no signature-bytes field on this path
 * and `.strict()` is what makes that a refusal rather than a silent drop. No
 * claim about whose mark the document holds is made by binding it.
 */
export interface DeliverySignatureAttachBody {
  readonly signerRole: 'receiver' | 'delivering_employee' | 'witness';
  readonly signatureDocumentVersionId: string;
}

/**
 * The ONE override the completion accepts, and it must say why.
 *
 * Its own interface because the API declares it as a nested object, and the
 * parity gate compares a nested object against a referenced interface. There is
 * deliberately no `overrideAll`, no `force` and no `skipChecks` — exactly one
 * blocker (`financial_balance_outstanding`) is overridable, and the authority
 * for it is `sal.delivery.complete` rather than `sal.delivery.manage`.
 */
export interface DeliveryCompleteOverride {
  /** 1–2000 characters. Written into the audit record of the completion. */
  readonly reason: string;
}

/**
 * `sal.delivery-complete` — `POST /deliveries/{deliveryId}/completion`.
 *
 * ## The route's pattern is WIDER than the column, and the difference is a 422
 *
 * `finalOdometerValue` is validated at the route by
 * `^\d{1,12}(\.\d{1,2})?$` — two decimals — while
 * `veh.odometer_readings.value` is `numeric(12,1)` and the domain parses the
 * value against that scale. A two-decimal value therefore passes the schema and
 * is refused by the domain with `ERR-VAL-001`. The screen validates to at most
 * ONE decimal before it sends, and says so in the field help, so the operator is
 * told by the control rather than by a rejected submission.
 *
 * ## Eligibility is not a field, and could not be
 *
 * There is no `eligible` here to trust. The service locks the delivery row and
 * recomposes the blocker set inside the transaction from the same code that
 * answers the eligibility read, so what a caller was shown and what is enforced
 * are the same rules over the same tables.
 */
export interface DeliveryCompleteBody {
  /** Unsigned decimal string. The column holds one decimal; see the docblock. */
  readonly finalOdometerValue: string;
  /** `veh.odometer_readings.unit`. The primitive defaults to kilometres. */
  readonly odometerUnit?: 'km' | 'mi';
  readonly overrideFinancialBlocker?: DeliveryCompleteOverride;
}
