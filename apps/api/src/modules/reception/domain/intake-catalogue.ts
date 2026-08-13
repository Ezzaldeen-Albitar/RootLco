/**
 * Intake configuration-catalogue descriptors (P1-27 remediation, executed by
 * P1-18: `P1-27-INT-018`).
 *
 * Seven dual-scope catalogues the appointment and reception writes reference by
 * uuid. PR #220 published their READS; this table is what the MANAGEMENT
 * commands are derived from, and it exists so the three facts that must agree
 * per catalogue — the relation it administers, the audit codes it records under,
 * and the entity type those codes are about — are stated once instead of three
 * times across a repository, a service and a route.
 *
 * ## Why management had to exist at all
 *
 * The tables ship ZERO rows, permanently, by the no-fake-data policy, and the
 * appointment/reception writes demand their ids:
 *
 *   - `apt.appointment-create` requires `appointmentTypeId` — no appointment
 *     could be booked;
 *   - `apt.appointment-cancel` requires `cancellationReasonId` with no free-text
 *     escape — no appointment could be cancelled;
 *   - check-in offers `fuelLevelId` and `visitReasonId`, and the
 *     `warning_light` evidence kind requires a `rec.warning_light_codes` id
 *     (RMC-11) — each stranded a reception step.
 *
 * The database has permitted the fix since the tables were created: every one of
 * the seven carries `GRANT SELECT, INSERT, UPDATE ... TO app_runtime` with
 * matching `ins_<t>_tenant` / `upd_<t>_tenant` policies. The API published none
 * of it. Seeding rows would violate the no-fake-data policy; publishing the
 * management contract lets the OPERATOR populate the catalogue, which is what
 * the policy has always required.
 *
 * ## Retirement, and why it must be reversible
 *
 * There is no delete. `app_runtime` holds no DELETE grant and no DELETE policy
 * exists on any of the seven relations, so a hard removal is refused by the
 * database however it is asked for — which is the property that keeps a row a
 * live foreign key still references from vanishing.
 *
 * Retirement is therefore `status = 'inactive'`: the picker reads filter to
 * `status = 'active'`, so a retired code stops being offered while every
 * existing reference stays satisfied. It is deliberately a two-way door. The
 * partial unique indexes are
 * `(tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL` — the
 * predicate names `deleted_at`, NOT `status` — so a retired row keeps holding
 * its code and a replacement carrying the same code is refused with a 23505.
 * A one-way retirement would therefore burn that code for the tenant forever,
 * which is why the lifecycle command sets the status in both directions rather
 * than retiring only (the `crm.customer-status-set` / `shared.branch-status-change`
 * precedent).
 */

/** Statuses `ck_<t>_status` allows. Retirement is the second one. */
export const CATALOGUE_STATUSES = Object.freeze(['active', 'inactive'] as const);
export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];

/**
 * `ck_<t>_code_format`: `^[a-z][a-z0-9_]{1,62}$`.
 *
 * Restated here so a bad code is a 422 naming the field rather than a database
 * CHECK violation surfacing as a generic failure. The two must agree; the
 * database remains the authority.
 */
export const CATALOGUE_CODE_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

/** `ck_<t>_name_not_blank` only forbids blank; this is the API's own bound. */
export const MAX_CATALOGUE_NAME = 200;

export interface IntakeCatalogueDescriptor {
  /** Qualified relation, for the reader. The repository owns the SQL. */
  readonly relation: string;
  /** `iam.audit_records.entity_type` for every code below. */
  readonly entityType: string;
  readonly createdAction: string;
  readonly renamedAction: string;
  readonly statusChangedAction: string;
}

/**
 * One descriptor per catalogue, keyed by the repository's catalogue key.
 *
 * Per-catalogue audit codes rather than one shared `apt.catalogue.*` pair: the
 * catalog fixes ONE `entityType` per code, and "somebody added a row to some apt
 * catalogue" is not a queryable fact. The set is closed — seven relations named
 * in code — so unlike `wo.work_order.state_changed`, whose graph is
 * tenant-overridable, a per-entity vocabulary here is one this catalog can close.
 */
export const INTAKE_CATALOGUE_DESCRIPTORS = Object.freeze({
  appointment_types: {
    relation: 'apt.appointment_types',
    entityType: 'apt.appointment_type',
    createdAction: 'apt.appointment_type.created',
    renamedAction: 'apt.appointment_type.renamed',
    statusChangedAction: 'apt.appointment_type.status_changed',
  },
  source_channels: {
    relation: 'apt.source_channels',
    entityType: 'apt.source_channel',
    createdAction: 'apt.source_channel.created',
    renamedAction: 'apt.source_channel.renamed',
    statusChangedAction: 'apt.source_channel.status_changed',
  },
  cancellation_reasons: {
    relation: 'apt.cancellation_reasons',
    entityType: 'apt.cancellation_reason',
    createdAction: 'apt.cancellation_reason.created',
    renamedAction: 'apt.cancellation_reason.renamed',
    statusChangedAction: 'apt.cancellation_reason.status_changed',
  },
  visit_reasons: {
    relation: 'rec.visit_reasons',
    entityType: 'rec.visit_reason',
    createdAction: 'rec.visit_reason.created',
    renamedAction: 'rec.visit_reason.renamed',
    statusChangedAction: 'rec.visit_reason.status_changed',
  },
  fuel_levels: {
    relation: 'rec.fuel_levels',
    entityType: 'rec.fuel_level',
    createdAction: 'rec.fuel_level.created',
    renamedAction: 'rec.fuel_level.renamed',
    statusChangedAction: 'rec.fuel_level.status_changed',
  },
  warning_light_codes: {
    relation: 'rec.warning_light_codes',
    entityType: 'rec.warning_light_code',
    createdAction: 'rec.warning_light_code.created',
    renamedAction: 'rec.warning_light_code.renamed',
    statusChangedAction: 'rec.warning_light_code.status_changed',
  },
  refusal_reasons: {
    relation: 'rec.refusal_reasons',
    entityType: 'rec.refusal_reason',
    createdAction: 'rec.refusal_reason.created',
    renamedAction: 'rec.refusal_reason.renamed',
    statusChangedAction: 'rec.refusal_reason.status_changed',
  },
} as const satisfies Record<string, IntakeCatalogueDescriptor>);
