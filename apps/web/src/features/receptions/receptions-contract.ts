/**
 * The reception contract (P1-28, Wave A) — every `rec.*` operation the backend
 * publishes, typed from the route source that owns each shape.
 *
 * Read out of `apps/api/src/app/api/v1/receptions/**` and
 * `reception-catalogue/**`, the domain rules in
 * `apps/api/src/modules/reception/domain/reception.ts` and
 * `reception-evidence.ts`, and the read repository row shapes in
 * `reception-read-repository.ts`. `tests/receptions-contract.test.ts` holds
 * each row of `RECEPTION_OPERATIONS` against the generated operation manifest
 * and the published OpenAPI document so drift fails a test, not a reviewer.
 *
 * | operation                              | method | path                                            | permission                            |
 * | -------------------------------------- | ------ | ----------------------------------------------- | ------------------------------------- |
 * | `rec.reception-list`                   | GET    | `/receptions`                                   | `rec.reception.read`                  |
 * | `rec.reception-detail`                 | GET    | `/receptions/{receptionId}`                     | `rec.reception.read`                  |
 * | `rec.reception-party-role-list`        | GET    | `/receptions/{receptionId}/party-roles`         | `rec.reception.read`                  |
 * | `rec.reception-authorization-list`     | GET    | `/receptions/{receptionId}/authorizations`      | `rec.reception.read`                  |
 * | `rec.reception-condition-evidence-list`| GET    | `/receptions/{receptionId}/condition-evidence`  | `rec.reception.read`                  |
 * | `rec.reception-history`                | GET    | `/receptions/{receptionId}/history`             | `rec.reception.read`                  |
 * | `rec.reception-create`                 | POST   | `/receptions`                                   | `rec.reception.manage`                |
 * | `rec.reception-party-role`             | POST   | `/receptions/{receptionId}/party-roles`         | `rec.reception.party.manage`          |
 * | `rec.reception-authorization`          | POST   | `/receptions/{receptionId}/authorizations`      | `rec.reception.authorization.verify`  |
 * | `rec.reception-condition-evidence`     | POST   | `/receptions/{receptionId}/condition-evidence`  | `rec.reception.evidence.manage`       |
 * | `rec.reception-signature`              | POST   | `/receptions/{receptionId}/signatures`          | `rec.reception.signature.manage`      |
 * | `rec.reception-refusal`                | POST   | `/receptions/{receptionId}/refusals`            | `rec.reception.signature.manage`      |
 * | `rec.reception-approve`                | POST   | `/receptions/{receptionId}/approve`             | `rec.reception.approve`               |
 * | `rec.reception-convert-to-work-order`  | POST   | `/receptions/{receptionId}/convert-to-work-order`| `rec.reception.convert`              |
 * | `rec.reception-close-without-work`     | POST   | `/receptions/{receptionId}/close-without-work`  | `rec.reception.close`                 |
 * | `rec.reception-refuse`                 | POST   | `/receptions/{receptionId}/refuse`              | `rec.reception.close`                 |
 * | `rec.catalogue-visit-reason-list`      | GET    | `/reception-catalogue/visit-reasons`            | `rec.reception.read`                  |
 * | `rec.catalogue-fuel-level-list`        | GET    | `/reception-catalogue/fuel-levels`              | `rec.reception.read`                  |
 * | `rec.catalogue-warning-light-code-list`| GET    | `/reception-catalogue/warning-light-codes`      | `rec.reception.read`                  |
 * | `rec.catalogue-refusal-reason-list`    | GET    | `/reception-catalogue/refusal-reasons`          | `rec.reception.read`                  |
 *
 * ## `refusal` and `refuse` are two different operations
 *
 * `POST .../refusals` APPENDS a refusal EVIDENCE record — a party declined a
 * step — and never changes `receptionStatus`. `POST .../refuse` ENDS the visit:
 * it moves the status to the terminal `refused` and releases the vehicle from
 * `uq_reception_visits_open_vehicle`. One is a fact about a step; the other is
 * the exit. A screen that conflates them either loses evidence or closes visits
 * by accident.
 *
 * ## The contract facts every write screen must encode
 *
 * - **`Idempotency-Key` mandatory on every POST here** (all eleven register
 *   `idempotent: true`). Replay with the same key returns the STORED body at
 *   **200 — even create, whose first answer was 201 — with NO ETag**; reuse
 *   with a different payload is 409 `ERR-INT-001` (`route-handler.ts:369-401`).
 * - **`If-Match` is mandatory on approve, convert-to-work-order,
 *   close-without-work and refuse** (`versionGuarded: true`); missing is 428
 *   `ERR-CON-002`, stale 409 `ERR-CON-001`. The other seven writes are NOT
 *   guarded and take no version.
 * - **Approve can apply TWO edges in one transaction** (`opened` →
 *   `['inspecting','authorized']`), so the returned `recordVersion` is not
 *   always sent+1 — the response's version is the truth. **Re-running approve
 *   on an authorized visit with a NEW key is 409 `ERR-TRN-001`**, and
 *   re-reading does not cure it: the state itself refuses the command.
 * - **Re-running convert on a converted visit is 200 with
 *   `alreadyConverted: true` — success**, never an error. The convert response
 *   carries NO ETag and its `state` is an opaque catalogue code, not an enum.
 * - Creation: an appointment origin's `companyId`/`branchId`/`vehicleId` MUST
 *   equal the appointment's own (422 `incoherent_reference`); only a
 *   `confirmed` appointment checks in (409 `ERR-TRN-001`); one open visit per
 *   vehicle and one consumption per origin both answer the SAME 409
 *   `ERR-RES-002`.
 * - An `authorization`-type refusal REQUIRES `refusingPartnerId` (422) and the
 *   partner must hold an active authorizing role (409 `ERR-TRN-001`) — it then
 *   stands as that party's decision and blocks approve/convert until the same
 *   party approves later. The role-not-held refusal is the same non-disclosing
 *   409 `ERR-TRN-001` as the authority guard, deliberately (anti-probing).
 *
 * ## The list is a branch board, and the branch is part of the request
 *
 * `companyId` and `branchId` are REQUIRED query parameters on
 * `GET /receptions` — resource selectors carried as the authorization target
 * (`P1-18-A-01`) — so the adapter builds them through `branchTargetQuery`.
 * Ordering is fixed: most recently received first. No sort, no total.
 */

/** One `rec.*` operation row, mirrored by the QA-001 harness. */
export interface ReceptionOperationRow {
  readonly operationId: string;
  /**
   * `PATCH` joined the union with the intake-catalogue management contract
   * (PR #227): a catalogue amend is the first `rec.*` operation that is not a
   * GET or a POST.
   */
  readonly method: 'GET' | 'POST' | 'PATCH';
  /** Path template WITHOUT the `/api/v1` prefix, exactly as published. */
  readonly template: string;
  /** True when the backend refuses the request without an `Idempotency-Key`. */
  readonly idempotent: boolean;
  /** True when the backend refuses the request without `If-Match` (428). */
  readonly versionGuarded: boolean;
  /** The one permission code the operation registers. */
  readonly permission: string;
  /** The published `x-audit-class`. */
  readonly auditClass: string;
}

export const RECEPTION_PERMISSIONS = {
  /** Every read, including the four catalogue pickers. */
  read: 'rec.reception.read',
  /** Opening a visit and taking custody. */
  manage: 'rec.reception.manage',
  /** Who is present, in what role. */
  partyManage: 'rec.reception.party.manage',
  /** Recording an authorizing party's decision — approval audit class. */
  authorizationVerify: 'rec.reception.authorization.verify',
  /** Pre-service condition evidence, all eight kinds. */
  evidenceManage: 'rec.reception.evidence.manage',
  /** Signatures AND refusal evidence — what a person put their name to. */
  signatureManage: 'rec.reception.signature.manage',
  /** The decision that lets work begin. */
  approve: 'rec.reception.approve',
  /** Turning an authorized visit into one minimal work order. */
  convert: 'rec.reception.convert',
  /** Both terminal exits: close-without-work and refuse. */
  close: 'rec.reception.close',
  /**
   * Administering the reception intake catalogues — visit reasons, fuel levels,
   * warning-light codes and refusal reasons.
   *
   * The code is named here because the backend registers it and this layer must
   * know every code its domain can be denied for; it is NOT consulted by any
   * screen, because there is no catalogue-administration screen. No canonical
   * P1-28 task binds one, and who administers the intake catalogues and through
   * which surface is `P1-28-OD-001` (`docs/phase-1/phase-1-28/canonical-plan.md`
   * §7). The sixteen operations behind it are recorded in
   * `docs/phase-1/phase-1-28/write-reachability.json`, the writes among them as
   * DELIBERATELY_ABSENT against that decision.
   */
  catalogueManage: 'rec.catalogue.manage',
  /**
   * Waiving a required intake capture, with an attributable reason.
   *
   * Deliberately NOT implied by `evidenceManage`: taking the photograph and
   * recording that no photograph was needed are different decisions, and folding
   * them together would make the requirement optional for everyone who could
   * satisfy it. Named here because the backend registers it and this layer must
   * know every code its domain can be denied for. `P1-OD-025` (document and
   * media file policy) is RESOLVED — private, versioned evidence, only an
   * ACCEPTED version finalized — and the screen that consults this code has
   * now landed: `components/steps/MediaStep.tsx` withholds the waiver control
   * with its reason stated when the operator does not hold it, rather than
   * greying one out.
   */
  evidenceOverride: 'rec.reception.evidence.override',
} as const;

/**
 * Every `rec.*` operation the platform publishes — the mirror test asserts
 * this set equals the manifest's `rec.` slice in BOTH directions.
 */
export const RECEPTION_OPERATIONS: readonly ReceptionOperationRow[] = Object.freeze([
  {
    operationId: 'rec.reception-list',
    method: 'GET',
    template: '/receptions',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.reception-detail',
    method: 'GET',
    template: '/receptions/{receptionId}',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.reception-party-role-list',
    method: 'GET',
    template: '/receptions/{receptionId}/party-roles',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.reception-authorization-list',
    method: 'GET',
    template: '/receptions/{receptionId}/authorizations',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.reception-condition-evidence-list',
    method: 'GET',
    template: '/receptions/{receptionId}/condition-evidence',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.reception-history',
    method: 'GET',
    template: '/receptions/{receptionId}/history',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.reception-create',
    method: 'POST',
    template: '/receptions',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.manage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-party-role',
    method: 'POST',
    template: '/receptions/{receptionId}/party-roles',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.partyManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-authorization',
    method: 'POST',
    template: '/receptions/{receptionId}/authorizations',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.authorizationVerify,
    auditClass: 'approval',
  },
  {
    operationId: 'rec.reception-condition-evidence',
    method: 'POST',
    template: '/receptions/{receptionId}/condition-evidence',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.evidenceManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-signature',
    method: 'POST',
    template: '/receptions/{receptionId}/signatures',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.signatureManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-refusal',
    method: 'POST',
    template: '/receptions/{receptionId}/refusals',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.signatureManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-approve',
    method: 'POST',
    template: '/receptions/{receptionId}/approve',
    idempotent: true,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.approve,
    auditClass: 'approval',
  },
  {
    operationId: 'rec.reception-convert-to-work-order',
    method: 'POST',
    template: '/receptions/{receptionId}/convert-to-work-order',
    idempotent: true,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.convert,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-close-without-work',
    method: 'POST',
    template: '/receptions/{receptionId}/close-without-work',
    idempotent: true,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.close,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-refuse',
    method: 'POST',
    template: '/receptions/{receptionId}/refuse',
    idempotent: true,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.close,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-evidence-binding-list',
    method: 'GET',
    template: '/receptions/{receptionId}/evidence-bindings',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.reception-signature-list',
    method: 'GET',
    template: '/receptions/{receptionId}/signatures',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.reception-evidence-binding',
    method: 'POST',
    template: '/receptions/{receptionId}/evidence-bindings',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.evidenceManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-evidence-binding-finalize',
    method: 'POST',
    template: '/receptions/{receptionId}/evidence-bindings/{bindingId}/finalization',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.evidenceManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-capture-override',
    method: 'POST',
    template: '/receptions/{receptionId}/capture-overrides',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.evidenceOverride,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.reception-signature-event',
    method: 'POST',
    template: '/receptions/{receptionId}/signatures/{signatureId}/events',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.signatureManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-visit-reason-list',
    method: 'GET',
    template: '/reception-catalogue/visit-reasons',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.catalogue-fuel-level-list',
    method: 'GET',
    template: '/reception-catalogue/fuel-levels',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.catalogue-warning-light-code-list',
    method: 'GET',
    template: '/reception-catalogue/warning-light-codes',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },
  {
    operationId: 'rec.catalogue-refusal-reason-list',
    method: 'GET',
    template: '/reception-catalogue/refusal-reasons',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.read,
    auditClass: 'none',
  },

  /*
   * The intake-catalogue ADMINISTRATION surface (PR #227).
   *
   * These sixteen rows mirror a published contract that NO screen in this
   * product reaches, and that is the point of writing them down: this module's
   * claim is "every rec.* operation the platform publishes", and an operation
   * left out because nothing calls it would make the mirror a description of
   * the screens rather than of the contract.
   *
   * There is no adapter for any of them. No canonical P1-28 task binds a
   * catalogue-administration screen, and who may administer these catalogues
   * and through which surface is `P1-28-OD-001`
   * (`docs/phase-1/phase-1-28/canonical-plan.md` §7). The twelve writes among
   * them are recorded DELIBERATELY_ABSENT against that decision in
   * `docs/phase-1/phase-1-28/write-reachability.json`.
   */
  {
    operationId: 'rec.catalogue-fuel-level-create',
    method: 'POST',
    template: '/reception-catalogue/fuel-levels',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-fuel-level-management-list',
    method: 'GET',
    template: '/reception-catalogue/management/fuel-levels',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'none',
  },
  {
    operationId: 'rec.catalogue-fuel-level-status-set',
    method: 'POST',
    template: '/reception-catalogue/fuel-levels/{fuelLevelId}/status',
    idempotent: true,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-fuel-level-update',
    method: 'PATCH',
    template: '/reception-catalogue/fuel-levels/{fuelLevelId}',
    idempotent: false,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-refusal-reason-create',
    method: 'POST',
    template: '/reception-catalogue/refusal-reasons',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-refusal-reason-management-list',
    method: 'GET',
    template: '/reception-catalogue/management/refusal-reasons',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'none',
  },
  {
    operationId: 'rec.catalogue-refusal-reason-status-set',
    method: 'POST',
    template: '/reception-catalogue/refusal-reasons/{refusalReasonId}/status',
    idempotent: true,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-refusal-reason-update',
    method: 'PATCH',
    template: '/reception-catalogue/refusal-reasons/{refusalReasonId}',
    idempotent: false,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-visit-reason-create',
    method: 'POST',
    template: '/reception-catalogue/visit-reasons',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-visit-reason-management-list',
    method: 'GET',
    template: '/reception-catalogue/management/visit-reasons',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'none',
  },
  {
    operationId: 'rec.catalogue-visit-reason-status-set',
    method: 'POST',
    template: '/reception-catalogue/visit-reasons/{visitReasonId}/status',
    idempotent: true,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-visit-reason-update',
    method: 'PATCH',
    template: '/reception-catalogue/visit-reasons/{visitReasonId}',
    idempotent: false,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-warning-light-code-create',
    method: 'POST',
    template: '/reception-catalogue/warning-light-codes',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-warning-light-code-management-list',
    method: 'GET',
    template: '/reception-catalogue/management/warning-light-codes',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'none',
  },
  {
    operationId: 'rec.catalogue-warning-light-code-status-set',
    method: 'POST',
    template: '/reception-catalogue/warning-light-codes/{warningLightCodeId}/status',
    idempotent: true,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-warning-light-code-update',
    method: 'PATCH',
    template: '/reception-catalogue/warning-light-codes/{warningLightCodeId}',
    idempotent: false,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-capture-policy-list',
    method: 'GET',
    template: '/reception-catalogue/capture-policies',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'none',
  },
  {
    operationId: 'rec.catalogue-capture-policy-set',
    method: 'POST',
    template: '/reception-catalogue/capture-policies',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-damage-map-template-list',
    method: 'GET',
    template: '/reception-catalogue/damage-map-templates',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'none',
  },
  {
    operationId: 'rec.catalogue-damage-map-template-create',
    method: 'POST',
    template: '/reception-catalogue/damage-map-templates',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-damage-map-template-read',
    method: 'GET',
    template: '/reception-catalogue/damage-map-templates/{templateId}',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'none',
  },
  {
    operationId: 'rec.catalogue-damage-map-template-version-create',
    method: 'POST',
    template: '/reception-catalogue/damage-map-templates/{templateId}/versions',
    idempotent: true,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  {
    operationId: 'rec.catalogue-damage-map-template-status-set',
    method: 'POST',
    template: '/reception-catalogue/damage-map-templates/{templateId}/status',
    idempotent: true,
    versionGuarded: true,
    permission: RECEPTION_PERMISSIONS.catalogueManage,
    auditClass: 'privileged',
  },
  /*
   * The receiving-employee picker (Owner decision FE-007).
   *
   * It sits among the catalogues by ROUTE only. It reads `iam.user_accounts`
   * rather than a `rec` catalogue table, so it has no lifecycle and no
   * management pair, and it is gated by `rec.reception.manage` — the authority
   * to take a vehicle in — rather than by `rec.catalogue.manage`, which is the
   * authority to define what the catalogues ARE. Naming who accepted custody is
   * part of checking a vehicle in, not part of configuring the branch.
   */
  {
    operationId: 'rec.receiving-employee-list',
    method: 'GET',
    template: '/reception-catalogue/receiving-employees',
    idempotent: false,
    versionGuarded: false,
    permission: RECEPTION_PERMISSIONS.manage,
    auditClass: 'none',
  },
]);

/* ------------------------------------------------------------------ *
 * Lifecycle — frozen `ck_reception_visits_status` and the
 * `rec.guard_reception_transition` graph, mirrored
 * ------------------------------------------------------------------ */

export const RECEPTION_STATUSES = [
  'opened',
  'inspecting',
  'authorized',
  'converted',
  'closed_without_work',
  'refused',
] as const;
export type ReceptionStatus = (typeof RECEPTION_STATUSES)[number];

export const RECEPTION_TRANSITIONS: Readonly<Record<string, readonly ReceptionStatus[]>> =
  Object.freeze({
    opened: ['inspecting', 'closed_without_work', 'refused'],
    inspecting: ['authorized', 'closed_without_work', 'refused'],
    authorized: ['converted', 'closed_without_work', 'refused'],
    converted: [],
    closed_without_work: [],
    refused: [],
  });

export const TERMINAL_RECEPTION_STATUSES: readonly ReceptionStatus[] = [
  'converted',
  'closed_without_work',
  'refused',
];

/**
 * Approve targets `authorized`, walking through `inspecting` when needed —
 * legal from `opened` (two edges, one transaction) and from `inspecting` (one).
 * From `authorized` itself the answer is 409 `ERR-TRN-001`, which is why this
 * is NOT `!terminal`: re-approving an approved visit is refused, not absorbed.
 */
export function canApprove(status: ReceptionStatus): boolean {
  return status === 'opened' || status === 'inspecting';
}

/** Conversion is legal from `authorized` only. A replay answers 200. */
export function canConvert(status: ReceptionStatus): boolean {
  return (RECEPTION_TRANSITIONS[status] ?? []).includes('converted');
}

/** Both terminal exits are legal from any non-terminal state (frozen graph). */
export function canClose(status: ReceptionStatus): boolean {
  return !TERMINAL_RECEPTION_STATUSES.includes(status);
}

/* ------------------------------------------------------------------ *
 * Vocabularies — every one a mirror of a frozen CHECK, via the module
 * constants the routes themselves parse with
 * ------------------------------------------------------------------ */

/** Frozen `ck_reception_party_roles_role` (7 roles). */
export const RECEPTION_PARTY_ROLES = [
  'service_requester',
  'vehicle_owner',
  'vehicle_user',
  'payer',
  'billing_party',
  'approving_party',
  'authorized_receiver',
] as const;
export type ReceptionPartyRole = (typeof RECEPTION_PARTY_ROLES)[number];

/**
 * Frozen `ck_authorizations_role` — the SUBSET of party roles that may
 * authorize work. `vehicle_user` and `payer` are deliberately absent: driving
 * a vehicle or paying for it is not authority to approve work on it.
 */
export const AUTHORIZING_ROLES = [
  'approving_party',
  'service_requester',
  'vehicle_owner',
  'authorized_receiver',
] as const;
export type AuthorizingRole = (typeof AUTHORIZING_ROLES)[number];

export const AUTHORIZATION_DECISIONS = ['approved', 'declined'] as const;
export type AuthorizationDecision = (typeof AUTHORIZATION_DECISIONS)[number];

export const AUTHORIZATION_CHANNELS = ['in_person', 'phone', 'email', 'portal', 'other'] as const;
export type AuthorizationChannel = (typeof AUTHORIZATION_CHANNELS)[number];

/**
 * The eight kinds one `condition-evidence` POST accepts, as a discriminated
 * union. Signature and refusal are deliberately NOT members — they carry their
 * own permission and must never be reachable with evidence-capture authority.
 */
export const EVIDENCE_KINDS = [
  'complaint',
  'inspection',
  'condition_item',
  'damage_map',
  'damage_mark',
  'contents',
  'warning_light',
  'leak',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const COMPLAINT_CATEGORIES = [
  'mechanical',
  'electrical',
  'body',
  'noise',
  'performance',
  'other',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ComplaintSeverity = (typeof COMPLAINT_SEVERITIES)[number];

export const FINDING_CATEGORIES = [
  'scratch',
  'dent',
  'crack',
  'wear',
  'missing_part',
  'malfunction',
  'other',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const FINDING_SEVERITIES = ['minor', 'moderate', 'major', 'critical'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const DAMAGE_MARK_TYPES = [
  'scratch',
  'dent',
  'crack',
  'chip',
  'rust',
  'missing',
  'other',
] as const;
export type DamageMarkType = (typeof DAMAGE_MARK_TYPES)[number];

/** Leak severity shares the finding vocabulary (frozen CHECK). */
export const LEAK_SEVERITIES = FINDING_SEVERITIES;

/**
 * `map_type` and `perspective` are BOUNDED STRINGS on the wire, not enums: the
 * routes deliberately leave membership to the database CHECK, because a second
 * hand-typed copy could rot without anything failing. This layer does the same —
 * a select rendered from an invented list would offer values the database
 * refuses.
 *
 * `leak_type` used to be carried by this bound too. It is not one of these; see
 * `LEAK_TYPES` below.
 */
export const MAX_MAP_TYPE = 40;

/**
 * `observed_state` USED to be treated as one of those bounded strings, and the
 * treatment was wrong in effect.
 *
 * The reasoning above is sound where the list really is unknown. It is not
 * unknown here: `ck_warning_light_observations_state` admits exactly three
 * values (`20260721102000_rec_warning_lights_leaks.sql:60`), so a free-text box
 * does not avoid offering values the database refuses — it offers NOTHING ELSE.
 * Measured against the running stack: `observedState: 'steady while running'`,
 * which is the sort of phrase the field's own hint invited, answers 422
 * `ERR-VAL-001 / incoherent_reference`, and the operator is told "This value is
 * not accepted here" with no way to learn what would be.
 *
 * So this one IS restated, and the restatement carries its authority in the
 * comment above so a future CHECK change has somewhere to be reconciled with.
 * The rule that governs the choice is not "never restate a database list"; it
 * is "never invent one".
 */
export const WARNING_LIGHT_STATES = ['on', 'flashing', 'intermittent'] as const;
export type WarningLightState = (typeof WARNING_LIGHT_STATES)[number];

/**
 * `leak_type` is the SAME defect as `observed_state`, and worse, because the
 * field is REQUIRED.
 *
 * `ck_leak_observations_type` admits exactly these seven values
 * (`20260721102000_rec_warning_lights_leaks.sql:170`). The field was a required
 * free-text box whose own hint asked the operator for their own words, so every
 * leak recorded in an operator's own words — "engine oil", "power steering",
 * "coolant dripping" — is refused 422 `ERR-VAL-001` and rendered as "This value
 * is not accepted here", with no way to learn what would be accepted. A required
 * field that only accepts values the screen never names is a step no operator
 * can complete.
 *
 * Restated here rather than in the step, carrying its authority in this comment
 * so a future CHECK change has one place to be reconciled with. The rule is not
 * "never restate a database list"; it is "never invent one" — and this list is
 * the database's own, copied from the constraint above.
 */
export const LEAK_TYPES = [
  'oil',
  'coolant',
  'fuel',
  'brake_fluid',
  'transmission',
  'water',
  'other',
] as const;
export type LeakType = (typeof LEAK_TYPES)[number];

export const SIGNER_ROLES = [
  'service_requester',
  'vehicle_owner',
  'authorized_receiver',
  'payer',
  'approving_party',
  'receiving_employee',
  'other',
] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

export const SIGNATURE_CAPTURE_METHODS = ['drawn', 'typed', 'uploaded', 'biometric'] as const;
export type SignatureCaptureMethod = (typeof SIGNATURE_CAPTURE_METHODS)[number];

export const SIGNATURE_PURPOSES = [
  'reception_acknowledgement',
  'custody_acceptance',
  'authorization',
  'refusal_witness',
  'condition_agreement',
  'other',
] as const;
export type SignaturePurpose = (typeof SIGNATURE_PURPOSES)[number];

export const REFUSAL_TYPES = [
  'inspection_item',
  'signature',
  'intake_step',
  'authorization',
  'other',
] as const;
export type RefusalType = (typeof REFUSAL_TYPES)[number];

/**
 * An `authorization` refusal must name the party who refused — it becomes that
 * party's STANDING decision, and only that party can supersede it with a later
 * approval. Mirrored so the form refuses locally with a named field instead of
 * surfacing the module's 422.
 */
export function refusalRequiresPartner(refusalType: RefusalType): boolean {
  return refusalType === 'authorization';
}

/* ------------------------------------------------------------------ *
 * Bounds — each one the route's or the module's, never a stricter guess
 * ------------------------------------------------------------------ */

export const MIN_SOC_PERCENT = 0;
export const MAX_SOC_PERCENT = 100;
export const MAX_WALK_IN_NOTE = 500;
/** The mandatory close/refuse reason: bounded TEXT, deliberately not a catalogue id. */
export const MAX_CLOSURE_REASON = 500;
/** Route-level bound on the provenance label ("front desk", "portal"). */
export const MAX_ASSIGNMENT_SOURCE = 120;
/** Route-level splash guard; the module owns the real 64-hex rule. */
export const MAX_SIGNATURE_HASH_INPUT = 256;
export const MAX_NOTE = 2000;
export const MAX_ZONE = 64;
export const MAX_LOCATION = 120;
export const MAX_ITEM_DESCRIPTION = 500;
export const MAX_COMPLAINT_TEXT = 4000;
/** Damage-mark coordinates are FRACTIONS of the map, so marks survive resizing. */
export const MIN_COORD = 0;
export const MAX_COORD = 1;
export const MAX_CONTENT_QUANTITY = 2_147_483_647;
export const MAX_DECLARED_VALUE = 999_999_999_999.99;

/* ------------------------------------------------------------------ *
 * Requests, exactly as the routes parse them
 * ------------------------------------------------------------------ */

/** Exactly one origin, mirroring `ck_reception_visits_one_origin`'s XOR. */
export type ReceptionOriginInput =
  | { readonly kind: 'appointment'; readonly appointmentId: string }
  | {
      readonly kind: 'walk_in';
      readonly requesterPartnerId?: string | null;
      readonly note?: string | null;
    };

/**
 * What `POST /receptions` accepts (`.strict()`). `companyId`/`branchId` are
 * the authorization target for this branch-scoped create (`P1-18-A-01`); for
 * an appointment origin they MUST equal the appointment's own scope, and the
 * vehicle must be the appointment's vehicle (422 `incoherent_reference`).
 * `evSocPercent` is `numeric(5,2)` — a fractional charge level is meaningful
 * and sent as a NUMBER.
 */
export interface ReceptionCreateInput {
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly receivingEmployeeId: string;
  readonly serviceRequesterPartnerId: string;
  readonly origin: ReceptionOriginInput;
  readonly odometerReadingId?: string | null;
  readonly fuelLevelId?: string | null;
  readonly evSocPercent?: number | null;
}

/**
 * `supersede` closes a prior open interval in the same role first — asked for
 * EXPLICITLY, because doing it implicitly would silently re-date history
 * whenever a caller repeated an assignment by accident.
 */
export interface PartyRoleInput {
  readonly partnerId: string;
  readonly relationshipRole: ReceptionPartyRole;
  readonly assignmentSource?: string | null;
  readonly supersede?: boolean;
}

export interface AuthorizationInput {
  readonly authorizingRole: AuthorizingRole;
  readonly partnerId: string;
  readonly decision: AuthorizationDecision;
  readonly channel?: AuthorizationChannel;
  /** `ck_authorizations_scope_object`: a JSON object or nothing at all. */
  readonly authorizedScope?: Record<string, unknown> | null;
  readonly evidenceDocumentId?: string | null;
}

/** What the customer reported, in their own words. Stored `restricted`. */
export interface ComplaintEvidenceInput {
  readonly kind: 'complaint';
  readonly category: ComplaintCategory;
  readonly severity?: ComplaintSeverity;
  readonly complaintText: string;
  readonly reportedByPartnerId?: string | null;
  readonly evidenceDocumentId?: string | null;
}

/** Opens an inspection header; findings hang off it. */
export interface InspectionEvidenceInput {
  readonly kind: 'inspection';
  readonly inspectorId: string;
}

/** What staff observed — a separate fact from a complaint, never promoted into one. */
export interface ConditionItemEvidenceInput {
  readonly kind: 'condition_item';
  readonly inspectionId: string;
  readonly findingCategory: FindingCategory;
  readonly vehicleZone: string;
  readonly severity?: FindingSeverity;
  readonly findingNote?: string | null;
  readonly evidenceDocumentId?: string | null;
}

/** Binds the visit to a map template and the EXACT version it was drawn on. */
export interface DamageMapEvidenceInput {
  readonly kind: 'damage_map';
  readonly documentId: string;
  readonly documentVersionId: string;
  /**
   * WHICH published revision this map was drawn on.
   *
   * Not optional, and the reason is that the whole FE-012 retirement rule hangs
   * off it. `rec.guard_damage_map_template_binding()` opens with
   * `IF NEW.damage_map_template_version_id IS NULL THEN RETURN NEW`, so a map
   * that omits it is admitted without any check that the slot is still active
   * or the revision still live — measured against the running API, which
   * answered 201 to a NEW visit binding a RETIRED template's pair and 422 to
   * the same request once this field named the revision.
   *
   * Sending the document and version alone is therefore not "the same binding,
   * expressed differently": it is the binding with its guard switched off, and
   * it leaves the map with no record of the revision it used.
   */
  readonly damageMapTemplateVersionId: string;
  /** Bounded string; membership belongs to the database CHECK. */
  readonly mapType: string;
  readonly perspective?: string | null;
}

export interface DamageMarkEvidenceInput {
  readonly kind: 'damage_mark';
  readonly damageMapId: string;
  readonly markType: DamageMarkType;
  readonly vehicleZone: string;
  /** Fractions of the map, `0..1` inclusive. */
  readonly coordX: number;
  readonly coordY: number;
  readonly note?: string | null;
  readonly evidenceDocumentId?: string | null;
}

/**
 * What the customer left in the vehicle. `declaredCurrency` is only meaningful
 * WITH a value — `ck_vehicle_content_details_currency` refuses a currency
 * without one.
 */
export interface ContentsEvidenceInput {
  readonly kind: 'contents';
  readonly itemDescription: string;
  readonly quantity?: number;
  readonly location?: string | null;
  readonly declaredValue?: number | null;
  readonly declaredCurrency?: string | null;
  readonly declaredByPartnerId?: string | null;
  readonly witnessedByEmployeeId?: string | null;
  readonly evidenceDocumentId?: string | null;
}

/** One dashboard lamp. The same code is observed once per visit, not stacked. */
export interface WarningLightEvidenceInput {
  readonly kind: 'warning_light';
  readonly warningLightCodeId: string;
  /** One of the three states `ck_warning_light_observations_state` admits. */
  readonly observedState?: WarningLightState;
  readonly note?: string | null;
  readonly evidenceDocumentId?: string | null;
}

/** One visible leak, as observed. No cause and no fault is asserted. */
export interface LeakEvidenceInput {
  readonly kind: 'leak';
  /** One of the seven types `ck_leak_observations_type` admits. */
  readonly leakType: LeakType;
  readonly vehicleZone: string;
  readonly severity?: FindingSeverity;
  readonly note?: string | null;
  readonly evidenceDocumentId?: string | null;
}

/** The discriminated union `POST .../condition-evidence` parses. */
export type ConditionEvidenceInput =
  | ComplaintEvidenceInput
  | InspectionEvidenceInput
  | ConditionItemEvidenceInput
  | DamageMapEvidenceInput
  | DamageMarkEvidenceInput
  | ContentsEvidenceInput
  | WarningLightEvidenceInput
  | LeakEvidenceInput;

/**
 * Only the document REFERENCE travels — the media contract keeps deciding who
 * may open the signature image, and `rec` stores no drawn bytes.
 */
export interface SignatureInput {
  readonly signerRole: SignerRole;
  readonly signerPartnerId?: string | null;
  readonly signatureDocumentId: string;
  readonly signatureDocumentVersionId: string;
  readonly captureMethod: SignatureCaptureMethod;
  readonly purpose: SignaturePurpose;
  readonly signatureHash?: string | null;
}

export interface RefusalInput {
  readonly refusalType: RefusalType;
  readonly refusalReasonId?: string | null;
  readonly refusingPartnerId?: string | null;
  readonly witnessEmployeeId?: string | null;
  readonly evidenceDocumentId?: string | null;
}

/** Both terminal exits carry one mandatory bounded-text reason. */
export interface CloseReceptionInput {
  readonly reason: string;
}

/** The `.strict()` list query, minus the mandatory branch target. */
export interface ReceptionListCriteria {
  readonly status?: ReceptionStatus;
  readonly vehicleId?: string;
}

/* ------------------------------------------------------------------ *
 * Responses, exactly as the services publish them
 * ------------------------------------------------------------------ */

export interface ReceptionCreated {
  readonly receptionVisitId: string;
  /** `null` when the tenant has not provisioned a reception-number sequence. */
  readonly displayNumber: string | null;
  readonly receptionStatus: ReceptionStatus;
  readonly origin: 'appointment' | 'walk_in';
  readonly recordVersion: number;
}

export interface PartyRoleAssigned {
  readonly receptionVisitId: string;
  readonly partyRoleId: string;
  readonly relationshipRole: ReceptionPartyRole;
  /** True when a prior open interval in the same role was closed first. */
  readonly superseded: boolean;
}

export interface AuthorizationRecorded {
  readonly receptionVisitId: string;
  readonly authorizationId: string;
  readonly decision: AuthorizationDecision;
}

export interface ConditionEvidenceRecorded {
  readonly receptionVisitId: string;
  readonly kind: EvidenceKind;
  readonly evidenceId: string;
}

export interface SignatureRecorded {
  readonly receptionVisitId: string;
  readonly signatureId: string;
  readonly purpose: SignaturePurpose;
}

export interface RefusalRecorded {
  readonly receptionVisitId: string;
  readonly refusalId: string;
  readonly refusalType: RefusalType;
}

export interface ReceptionApproved {
  readonly receptionVisitId: string;
  readonly receptionStatus: 'authorized';
  /** The legal edges this request applied, in order — one or two of them. */
  readonly appliedTransitions: readonly ReceptionStatus[];
  readonly recordVersion: number;
}

/** Conversion's answer. NO ETag accompanies it, first run or replay. */
export interface ReceptionConverted {
  readonly receptionVisitId: string;
  readonly workOrderId: string;
  /** `null` when the tenant has not provisioned a work-order-number sequence. */
  readonly displayNumber: string | null;
  /** An OPAQUE work-order state code from the catalogue, not an enum. */
  readonly state: string;
  /** True when this request found the conversion already done — still success. */
  readonly alreadyConverted: boolean;
}

export interface ReceptionClosed {
  readonly receptionVisitId: string;
  readonly receptionStatus: 'closed_without_work' | 'refused';
  readonly recordVersion: number;
}

/** One row of the branch reception board, most recently received first. */
export interface ReceptionListEntry {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly receptionStatus: ReceptionStatus;
  readonly origin: 'appointment' | 'walk_in';
  readonly vehicleId: string;
  readonly vehicleDisplayNumber: string | null;
  readonly custodyAcceptedAt: string;
  /** `null` means the workshop still holds the vehicle. */
  readonly custodyReleasedAt: string | null;
  readonly recordVersion: number;
}

/** The full detail row. The `recordVersion` is the `If-Match` the guarded commands demand. */
export interface ReceptionDetail {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly receptionStatus: ReceptionStatus;
  readonly origin: 'appointment' | 'walk_in';
  readonly appointmentId: string | null;
  readonly walkInId: string | null;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly vehicleDisplayNumber: string | null;
  readonly odometerReadingId: string | null;
  readonly fuelLevelId: string | null;
  readonly fuelLevelName: string | null;
  /** `numeric(5,2)` — a STRING on the wire, never a JS float. */
  readonly evSocPercent: string | null;
  readonly receivingEmployeeId: string;
  /**
   * The custodian's name AS IT WAS when custody was accepted (Owner decision
   * FE-007, `DBCR-P1-18-002`).
   *
   * A SNAPSHOT, not a join. `rec.stamp_receiving_employee_identity()` writes it
   * at insert from `iam.user_accounts.display_name` and
   * `tg_reception_visits_receiving_employee` refuses to let it be edited
   * afterwards, so a later rename or a disabled account cannot rewrite who a
   * customer was told received their vehicle. That is why the acknowledgement
   * sheet reads THIS field rather than resolving the id: the sheet is evidence
   * of a handover that already happened.
   *
   * `NOT NULL` with a non-blank CHECK, and the id now carries a same-tenant
   * foreign key, so the dangling-identifier state G-EMP described is no longer
   * reachable — see `check-in/receiving-employee.ts` for what that removed.
   */
  readonly receivingEmployeeDisplayName: string;
  readonly custodyAcceptedAt: string;
  readonly custodyReleasedAt: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

export interface PartyRoleEntry {
  readonly id: string;
  readonly partnerId: string;
  readonly partnerDisplayName: string | null;
  readonly partnerDisplayNumber: string | null;
  readonly relationshipRole: string;
  readonly validFrom: string;
  /** `null` = still active — the role the workshop may act on. */
  readonly validTo: string | null;
  readonly assignmentSource: string | null;
  readonly recordVersion: number;
}

/**
 * One row of the two-table authorization UNION. Reading only approvals would
 * report a withdrawn consent as standing — an `authorization`-type refusal is
 * a second, cheaper way to say no, so both tables are one list and
 * `isStanding` marks each partner's CURRENT decision across both.
 */
export interface AuthorizationEntry {
  readonly kind: 'authorization' | 'refusal';
  readonly id: string;
  readonly partnerId: string;
  readonly partnerDisplayName: string | null;
  /** `null` for a refusal row. */
  readonly authorizingRole: string | null;
  /** A refusal projects the literal `'declined'`. */
  readonly decision: AuthorizationDecision;
  /** `null` for a refusal row. */
  readonly channel: string | null;
  readonly authorizedScope: Record<string, unknown> | null;
  readonly evidenceDocumentId: string | null;
  readonly occurredAt: string;
  readonly isStanding: boolean;
}

/**
 * One evidence row: the common envelope plus the per-kind payload FLATTENED
 * into it. The restricted narrative tables (complaint text, contents detail)
 * are never selected by this read.
 */
export interface ConditionEvidenceEntry {
  readonly kind: string;
  readonly id: string;
  readonly recordedAt: string;
  readonly evidenceDocumentId: string | null;
  readonly [field: string]: unknown;
}

/** One row of the status/custody ledger UNION, newest first. */
export interface ReceptionHistoryEntry {
  readonly kind: 'status' | 'custody';
  readonly id: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly reason: string | null;
  readonly actorId: string;
  readonly occurredAt: string;
  /** `bigint` — a STRING, surviving values beyond MAX_SAFE_INTEGER. */
  readonly seq: string;
  readonly correlationId: string | null;
  readonly receivingPartnerId: string | null;
  readonly receivingPartnerDisplayName: string | null;
  readonly releasingPartnerId: string | null;
  readonly releasingPartnerDisplayName: string | null;
  readonly evidenceDocumentId: string | null;
}

/* ------------------------------------------------------------------ *
 * The reception capture contract — Owner decisions FE-012 / FE-017 / FE-018
 * ------------------------------------------------------------------ */

/**
 * The captures a visit can be asked to evidence. Mirrors
 * `ck_reception_evidence_binding_requirement`.
 *
 * `refusal_supporting_evidence` is deliberately ABSENT: it is a policy subject
 * but never a binding, because a refusal carries its own document columns on
 * `rec.refusals`. The database says the same thing in the same place.
 */
export const CAPTURE_REQUIREMENTS = [
  'exterior',
  'dashboard_odometer',
  'ev_soc',
  'warning_lamp',
  'vin',
  'damage',
] as const;
export type CaptureRequirement = (typeof CAPTURE_REQUIREMENTS)[number];

/**
 * Which document category may satisfy which requirement.
 *
 * `satisfies` rather than an annotation, so the keys stay a literal union and a
 * requirement added above without a category here is a compile error rather
 * than a value that silently maps to nothing (`P1-27-INT-113`).
 * `rec.guard_reception_evidence_binding()` is the authority; this copy is what
 * makes a wrong category a named message instead of a CHECK violation.
 */
export const CAPTURE_CATEGORY_BY_REQUIREMENT = {
  exterior: 'reception_exterior',
  dashboard_odometer: 'reception_dashboard',
  ev_soc: 'reception_dashboard',
  warning_lamp: 'reception_dashboard',
  vin: 'reception_vin',
  damage: 'reception_damage',
} as const satisfies Readonly<Record<CaptureRequirement, string>>;

/**
 * Legibility of one captured VIN plate.
 *
 * `unreadable` exists only for `vin`, because a VIN plate that cannot be read
 * is itself the finding. `ck_reception_evidence_binding_quality` enforces it.
 */
export const CAPTURE_QUALITY_STATUSES = ['readable', 'unreadable'] as const;
export type CaptureQualityStatus = (typeof CAPTURE_QUALITY_STATUSES)[number];

/** Where a resolved requirement's numbers came from. */
export const CAPTURE_RULE_SOURCES = ['tenant', 'branch', 'baseline'] as const;

/** One requirement, what it needs, and what it has. */
export interface CaptureRequirementState {
  readonly requirementCode: CaptureRequirement;
  readonly minCount: number;
  readonly deviceCapturedAtRequired: boolean;
  readonly source: 'tenant' | 'branch' | 'baseline';
  /**
   * FINALIZED bindings only, which is why a screen cannot report a visit
   * complete on the strength of versions that are still pending.
   */
  readonly finalizedCount: number;
  readonly recordedCount: number;
  readonly satisfied: boolean;
  readonly overridden: boolean;
}

/** One binding of an exact immutable version to one requirement. */
export interface CaptureBindingEntry {
  readonly id: string;
  readonly requirementCode: CaptureRequirement;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly documentVersionStatus: string;
  /** The version checksum, server-owned. Null until the store records one. */
  readonly integritySha256: string | null;
  readonly deviceCapturedAt: string | null;
  readonly qualityStatus: CaptureQualityStatus;
  readonly finalizedAt: string | null;
  readonly finalizedBy: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

/** One attributable waiver of a required capture. */
export interface CaptureOverrideEntry {
  readonly id: string;
  readonly requirementCode: CaptureRequirement;
  readonly reason: string;
  readonly actorId: string;
  readonly occurredAt: string;
}

/** One damage-map template revision this visit's branch may bind to. */
export interface BindableTemplateEntry {
  readonly id: string;
  readonly scope: 'tenant' | 'branch';
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly mapType: string;
  readonly perspective: string | null;
  readonly status: string;
  readonly recordVersion: number;
  readonly activeVersionId: string | null;
  readonly activeVersionNumber: number | null;
  readonly documentId: string | null;
  readonly documentVersionId: string | null;
}

/**
 * What this visit still owes (`rec.reception-evidence-binding-list`).
 *
 * One read answers four questions a capture screen would otherwise ask
 * separately — the resolved policy, what is bound, what was waived, and which
 * templates are bindable — which is also why it is an `expensive-read`.
 */
export interface CaptureContract {
  readonly receptionVisitId: string;
  readonly requirements: readonly CaptureRequirementState[];
  readonly bindings: readonly CaptureBindingEntry[];
  readonly overrides: readonly CaptureOverrideEntry[];
  readonly bindableTemplates: readonly BindableTemplateEntry[];
}

export interface EvidenceBindingInput {
  readonly requirementCode: CaptureRequirement;
  readonly documentId: string;
  readonly documentVersionId: string;
  /** What the capturing device says. Never trusted as a fact. */
  readonly deviceCapturedAt?: string | null | undefined;
  readonly qualityStatus?: CaptureQualityStatus | undefined;
}

export interface EvidenceBindingRecorded {
  readonly receptionVisitId: string;
  readonly bindingId: string;
  readonly requirementCode: CaptureRequirement;
}

export interface EvidenceBindingFinalized {
  readonly receptionVisitId: string;
  readonly bindingId: string;
  readonly finalized: true;
}

export interface CaptureOverrideInput {
  readonly requirementCode: CaptureRequirement;
  readonly reason: string;
}

export interface CaptureOverrideRecorded {
  readonly receptionVisitId: string;
  readonly overrideId: string;
  readonly requirementCode: CaptureRequirement;
}

/** `rec.capture_requirement_overrides.reason`. */
export const MAX_OVERRIDE_REASON = 500;

/** Signature lifecycle events. Mirrors `ck_signature_event_type`. */
export const SIGNATURE_EVENT_TYPES = ['finalized', 'repudiated'] as const;
export type SignatureEventType = (typeof SIGNATURE_EVENT_TYPES)[number];

/** What a signature read-back reports. Derived by the API, never stored. */
export const SIGNATURE_STATUSES = ['draft', 'finalized', 'repudiated'] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

/**
 * One signature, as `rec.reception-signature-list` answers.
 *
 * EVERY signature is reported, including superseded and repudiated ones. Hiding
 * a superseded signature would be the overwrite the Owner decision forbids,
 * achieved through a read filter instead of an UPDATE.
 */
export interface SignatureEntry {
  readonly id: string;
  readonly signerRole: string;
  readonly signerPartnerId: string | null;
  readonly captureMethod: string;
  readonly purpose: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly documentVersionStatus: string;
  readonly integritySha256: string | null;
  readonly signedAt: string;
  readonly actorId: string;
  readonly replacesSignatureId: string | null;
  readonly replacedBySignatureId: string | null;
  readonly finalizedAt: string | null;
  readonly repudiatedAt: string | null;
  readonly repudiationReason: string | null;
  readonly status: SignatureStatus;
}

export interface SignatureLedger {
  readonly receptionVisitId: string;
  readonly signatures: readonly SignatureEntry[];
}

export interface SignatureEventInput {
  readonly eventType: SignatureEventType;
  /** Required for `repudiated`, refused for `finalized`. */
  readonly reason?: string | null | undefined;
}

export interface SignatureEventRecorded {
  readonly receptionVisitId: string;
  readonly signatureId: string;
  readonly eventId: string;
  readonly eventType: SignatureEventType;
}

/** `rec.signature_events.reason`. */
export const MAX_REPUDIATION_REASON = 500;
