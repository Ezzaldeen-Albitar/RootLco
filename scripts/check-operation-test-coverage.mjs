#!/usr/bin/env node
/**
 * Operation-to-test coverage gate (P1-14 remediation — STRICT; P1-15 — DERIVED).
 *
 * ===========================================================================
 * WHAT THIS GATE IS FOR
 * ===========================================================================
 * Blocker 2 of the failed P1-14 gate was that registered operations had NO
 * application-layer test evidence: they were imported for OpenAPI registration
 * and never invoked. The first version made that gap visible but tolerated
 * "pending" and "unit" residuals. The second removed those states.
 *
 * This version closes the remaining hole, which P1-15 exposed: a manifest that
 * DECLARES what evidence an operation owes can always be weakened by editing
 * the manifest. So for the P1-15 (`shared.`) surface the obligations are no
 * longer declared at all — they are **derived from the operation's own
 * `defineOperation({...})` registration**:
 *
 *   every shared operation                     → route · service · success
 *   not `public: true`                         → authorization
 *   `public: true`                             → unauthenticated
 *   a `{param}` in the path                    → cross-tenant
 *   `idempotent: true`                         → idempotency
 *   `versionGuarded: true`                     → stale-version
 *   `auditClass` other than `none`             → audit
 *   `scope` of `company` or `branch`           → isolation
 *
 * Marking an operation idempotent therefore *creates* the obligation to prove
 * replay; declaring an audit class *creates* the obligation to prove the record
 * is written. Neither can be dropped by editing this file, because neither is
 * written in this file. Manifest `required` entries are additive on top
 * (`outbox`, `denial`, `provider` — obligations the registration cannot know
 * about), so the manifest can make the gate stricter and never looser.
 *
 * P1-14's `iam.` entries keep exactly the evidence model they were gated with:
 * the derived floor applies to `shared.` only, so nothing about the existing
 * P1-14 evidence is weakened, relaxed, or re-interpreted here.
 *
 * ===========================================================================
 * FAILURE CONDITIONS
 * ===========================================================================
 *   1. a registered operation is absent from the coverage manifest;
 *   2. a manifest entry names a file that does not reference the operation id
 *      (evidence claimed but the operation is never invoked);
 *   3. an operation's effective requirements (derived ∪ declared) are not all
 *      present in the union of its files' COVERAGE-EVIDENCE declarations;
 *   4. a manifest entry names an operation that is no longer registered;
 *   5. a manifest entry carries `pending` — the state does not exist;
 *   6. a `shared.` operation's evidence is metadata-only (no `route` and no
 *      `service` flag), or unit-only (every evidence file is a pure-unit
 *      suite under `tests/foundation/`);
 *   7. a `shared.` operation declares an empty `required` list — invocation-only
 *      is not an acceptable state for a new public operation.
 *
 * The per-operation evidence a test file provides is declared in a machine-read
 * COVERAGE-EVIDENCE block inside that file, e.g.
 *
 *     COVERAGE-EVIDENCE (...):
 *       shared.template-create: route service authorization success audit
 *
 * The flags are review-anchored: they sit in the file beside the assertions
 * that back them, the gate checks the file also *invokes* the operation, and a
 * reviewer can confirm each claimed flag maps to a real assertion. The negative
 * fixture (tests/foundation/operation-coverage-gate.test.ts) proves the gate
 * returns a failure for every category above.
 *
 * Exit codes: 0 clean · 1 coverage failure · 2 IO error.
 * Usage: node scripts/check-operation-test-coverage.mjs [--json]
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const toPosix = (p) => p.split(sep).join('/');

/** The namespace whose obligations are derived rather than declared. */
export const DERIVED_PREFIX = 'shared.';

/**
 * P1-16 (`crm.`) is gated with the SAME derived evidence model as P1-15
 * (`shared.`): the obligations are derived from the registration, not declared,
 * so editing the manifest cannot weaken the floor. Both namespaces share every
 * derived rule below; only the per-phase count blocks are reported separately.
 */
export const P1_16_PREFIX = 'crm.';
/**
 * P1-17 (`veh.`) joins the same derived-evidence model: obligations are derived
 * from the registration, not declared, so editing the manifest cannot weaken the
 * floor. Only the per-phase count block is reported separately.
 */
export const P1_17_PREFIX = 'veh.';
/**
 * P1-18 spans TWO id namespaces — `apt.` (appointment) and `rec.` (reception) —
 * because the frozen Phase 1-8 database splits them into two schemas with
 * different lifecycles. Both must appear in DERIVED_PREFIXES or the derived floor
 * silently would not apply to half the phase, which is exactly the class of
 * failure P1-17 had to remediate three times.
 */
export const P1_18_PREFIXES = ['apt.', 'rec.'];
/**
 * P1-19 spans FOUR id namespaces — `wo.`, `tech.`, `dia.` and `qms.` — because the
 * frozen Phase 1-9 database splits work orders, technician execution, diagnostics
 * and quality into four schemas. All four are listed for the same reason both
 * P1-18 namespaces are: a namespace absent from this array gets no derived floor at
 * all, silently, and its operations pass on whatever the manifest happens to
 * declare.
 */
export const P1_19_PREFIXES = ['wo.', 'tech.', 'dia.', 'qms.'];
/**
 * P1-20 spans TWO id namespaces — `svc.` (service catalog and pricing, which share
 * the frozen Phase 1-10 `svc` schema) and `quo.` (quotation).
 *
 * Listed here for the reason stated above P1-19, and it was earned again: the first
 * P1-20 commit extended the visible hook — the `parseProvidedFlags` alternation
 * accepts `svc|quo` — but not this array, so `derivedRequirements()` returned `[]`
 * for all thirteen P1-20 operations and the required floor was whatever the manifest
 * volunteered. An independent review measured it from this script's own `--json`
 * output: `route`, `service` and `authorization` were *provided but not required*
 * for every one of the thirteen, and deleting those assertions would have kept the
 * gate green. Extending the alternation without extending the prefixes is the exact
 * shape of a gate that looks stricter than it is.
 */
export const P1_20_PREFIXES = ['svc.', 'quo.'];
const DERIVED_PREFIXES = [
  DERIVED_PREFIX,
  P1_16_PREFIX,
  P1_17_PREFIX,
  ...P1_18_PREFIXES,
  ...P1_19_PREFIXES,
  ...P1_20_PREFIXES,
];
/** True when an operation id belongs to a derived-evidence namespace. */
export const isDerivedId = (id) =>
  typeof id === 'string' && DERIVED_PREFIXES.some((prefix) => id.startsWith(prefix));

/**
 * Evidence-kind vocabulary. A declaration may provide a superset; the gate
 * checks the effective REQUIRED ones are present.
 *
 *   route            the exported HTTP handler is invoked with a real Request
 *                    and its Response is asserted
 *   service          the wired application service runs on the runtime DB role
 *   authorization    a caller lacking the declared permission is refused 403
 *   unauthenticated  a `public: true` route answers with NO authenticator
 *                    installed and discloses nothing a session would protect
 *   success          the happy path is asserted end to end
 *   denial           a validation or state refusal is asserted
 *   cross-tenant     a real row belonging to the other tenant is unreachable
 *   isolation        a caller narrowed by grant scope is refused out of scope
 *   audit            the audit record is read back and counted
 *   outbox           exactly one event row is read back and counted
 *   idempotency      a replay produces one row, not two
 *   stale-version    a wrong If-Match is refused with a conflict
 *   provider         a provider fake is driven and its behaviour asserted
 */
export const EVIDENCE_KINDS = Object.freeze([
  'route',
  'service',
  'authorization',
  'unauthenticated',
  'success',
  'denial',
  'cross-tenant',
  'isolation',
  'audit',
  'outbox',
  'idempotency',
  'stale-version',
  'provider',
]);

// ---------------------------------------------------------------------------
// Coverage manifest. Each registered operation MUST appear exactly once.
//   files:    every test that exercises it (each must reference the id).
//   required: evidence kinds DECLARED on top of the derived floor. For `iam.`
//             operations this is the whole requirement, unchanged from P1-14.
//   note:     why, for the reader.
// ---------------------------------------------------------------------------
export const MANIFEST = {
  // ========================================================================
  // Phase 1-17 (veh.) — Vehicle Backend. Same derived-evidence model as P1-15/16:
  // the floor (route, service, success, authorization) is derived from the
  // registration; `required` below adds the extra obligations this operation owes.
  // ========================================================================
  'veh.vehicle-search': {
    files: ['tests/backend/p1-17-vehicle-search.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'bounded allow-listed read; VIN matches the generated normalized column exactly and a plate matches the active plate via a tenant-scoped subquery; a tenant-B vehicle is unreachable (cross-tenant); an invalid cursor, an oversized query and an unknown parameter are refused (denial); safe master projection only, no restricted identifier',
  },
  'veh.vehicle-create': {
    files: ['tests/backend/p1-17-vehicle-create-update.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox', 'rollback'],
    note: 'draft master + audit + vehicle.created event commit in one transaction; a create that fails (duplicate active VIN) leaves no vehicle, no orphan audit, and no orphan event, and never touches the pre-existing one (rollback/atomicity); an unseen catalog reference is a 422 and an unknown field a 422 (denial); the created vehicle is invisible from tenant B (cross-tenant)',
  },
  'veh.vehicle-update': {
    files: ['tests/backend/p1-17-vehicle-create-update.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'partial descriptive edit under the frozen touch-metadata/merge guards; VIN and catalog refs are settable, lifecycle is not; a merged vehicle is refused (denial), a tenant-B or unknown id answers the same 404 (cross-tenant), and the edit is audited by changed columns only',
  },
  'veh.vehicle-merge': {
    files: ['tests/backend/p1-17-vehicle-merge.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox'],
    note: 'one INSERT into veh.vehicle_merges redirects+freezes the source via the frozen apply trigger — merge record + audit + vehicle.merged event (aggregate=survivor) are one atomic statement; self-merge 422, already-merged source and merged survivor 409, a cross-tenant or unknown survivor the same 404 (denial/cross-tenant); the event carries source/survivor/merge ids only',
  },
  'veh.vehicle-duplicate-scan': {
    files: ['tests/backend/p1-17-vehicle-duplicates.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'conservative deterministic weighted scoring (near-VIN typo/transposition + active-versus-historical plate, corroborated by exact make/model/year); records a candidate only at/above threshold with a strong signal — a lone near-VIN or a make/model/year-only match is NOT recorded (false-positive); a re-scan neither duplicates nor re-scores a frozen candidate and never reopens a dismissal; no cross-tenant vehicle is ever compared; an unknown vehicle is 404 (denial)',
  },
  'veh.vehicle-duplicate-review': {
    files: ['tests/backend/p1-17-vehicle-duplicates.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'records a human dismissal on an open candidate (only dismissed is settable; merged is set by the merge op); an already-reviewed candidate is 409 and an unknown or cross-tenant candidate the same 404 (denial/cross-tenant); the decision is audited with the prior status',
  },
  'veh.vehicle-plate-history': {
    files: ['tests/backend/p1-17-vehicle-registration.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'keyset-paginated newest-first plate history; a tenant-B vehicle yields no tenant-A rows (cross-tenant); a malformed cursor and an oversized page are refused (denial); append-only projection, no raw plate beyond the normalized value',
  },
  'veh.vehicle-plate-assign': {
    files: ['tests/backend/p1-17-vehicle-registration.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'closes the current active plate and opens the new one in one transaction + audit; the temporal EXCLUDE refuses a plate already active on another vehicle (denial 409); a merged vehicle and a cross-tenant vehicle are refused (404); history is append-only (never deleted)',
  },
  'veh.vehicle-ownership-history': {
    files: ['tests/backend/p1-17-vehicle-registration.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'keyset-paginated newest-first ownership history; a tenant-B vehicle yields no tenant-A rows (cross-tenant); malformed cursor and oversized page refused (denial)',
  },
  'veh.vehicle-ownership-transfer': {
    files: ['tests/backend/p1-17-vehicle-registration.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox', 'rollback'],
    note: 'closes the prior owner and opens the new one + audit + vehicle.relationship.changed event in one controlled transaction; an injected failure (a customer that fails the FK after the close) leaves the original ownership active with no new partial ownership (rollback); an unknown/cross-tenant customer is refused (denial/cross-tenant); the event carries no partner id',
  },
  'veh.vehicle-relationship-list': {
    files: ['tests/backend/p1-17-vehicle-relations.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'vehicle-centric keyset read of the single source of truth veh.vehicle_relationships, including a CRM-written link and a veh-written authorized party; a tenant-B vehicle yields no tenant-A rows (cross-tenant); a bad cursor is refused (denial)',
  },
  'veh.vehicle-authorized-party-add': {
    files: ['tests/backend/p1-17-vehicle-relations.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox'],
    note: 'writes one authorized_person relationship with a bounded scope + granted_by + audit + vehicle.relationship.changed event; the overlap EXCLUDE refuses a second active authorization for the same customer (denial 409) and proves veh and CRM writers cannot conflict; an unknown/cross-tenant customer is refused (denial/cross-tenant); an unknown scope action is a 422',
  },
  'veh.vehicle-authorized-party-retire': {
    files: ['tests/backend/p1-17-vehicle-relations.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'closes the open authorization interval + audit (history retained, not deleted); an unknown or already-retired party and a cross-tenant vehicle answer the same 404 (denial/cross-tenant)',
  },
  'veh.vehicle-odometer-history': {
    files: ['tests/backend/p1-17-vehicle-odometer.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'append-only keyset history newest-observed-first; a tenant-B vehicle yields no tenant-A rows (cross-tenant); a bad cursor is refused (denial)',
  },
  'veh.vehicle-odometer-record': {
    files: ['tests/backend/p1-17-vehicle-odometer.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'rollback'],
    note: 'appends a reading + audit atomically; a normal reading below the effective odometer is refused as an anomaly and NOTHING is stored (rollback preserves the original); a correction may lower the value and is always flagged; negative value, bad unit, bad timestamp, and an unknown correction reference are 422; an unknown/cross-tenant vehicle is 404',
  },
  'veh.vehicle-ev-profile-read': {
    files: ['tests/backend/p1-17-vehicle-lifecycle.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'reads the single active EV profile; a vehicle without a profile (or a cross-tenant vehicle hidden by RLS) answers 404 (denial/cross-tenant)',
  },
  'veh.vehicle-ev-profile-set': {
    files: ['tests/backend/p1-17-vehicle-lifecycle.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'set-or-replace of the single EV profile + audit; an EV kind whose required powertrain category does not match the vehicle is refused (denial 422) pre-check and by the frozen guard; an unknown/cross-tenant vehicle is 404; a second call replaces, not duplicates; no battery-health value is derived',
  },
  'veh.vehicle-status-change': {
    files: ['tests/backend/p1-17-vehicle-lifecycle.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'moves lifecycle/workshop along the approved transition graph + audit; the append-only status-history ledger records the transition (no event); merged is never a settable target and a merged vehicle is frozen; a no-op or disallowed transition is 422; an unknown/cross-tenant vehicle is 404',
  },
  'veh.vehicle-history': {
    files: ['tests/backend/p1-17-vehicle-history.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'keyset page of the append-only attribute-change ledger, newest first; a tenant-B vehicle yields no tenant-A rows (cross-tenant); a bad cursor is refused (denial); no restricted identifier can appear (not a master column)',
  },
  'veh.vehicle-document-list': {
    files: ['tests/backend/p1-17-vehicle-history.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'lists document ids reachable from the vehicle via the sanctioned shared.document_ids_for_entity resolver (no storage key, no bytes); an unknown vehicle and a cross-tenant vehicle answer the same 404 (denial/cross-tenant); linking is the shared attachments operation, not this one',
  },

  // ========================================================================
  // Phase 1-18 (apt. / rec.) — Appointment and Reception Backend. Same derived-
  // evidence model; `required` adds what each operation owes beyond the floor.
  // Every one of these operations takes physical or contractual custody of a
  // customer's vehicle, so `rollback` is demanded wherever more than one row is
  // written, and `concurrency` wherever two callers can race for one outcome.
  // ========================================================================
  'apt.appointment-create': {
    files: ['tests/backend/p1-18-appointment-lifecycle.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'outbox', 'rollback'],
    note: 'appointment + audit + outbox commit in one transaction; an injected failure leaves none of the three (rollback); a tenant-B vehicle or requester is unreachable (cross-tenant); a branch outside the caller grant is refused (isolation); a timezone-less window and an inverted window are refused (denial)',
  },
  'apt.appointment-reschedule': {
    files: [
      'tests/backend/p1-18-appointment-lifecycle.test.ts',
      'tests/backend/p1-18-scope-containment.test.ts',
    ],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
      'concurrency',
    ],
    note: 'moves the CONFIRMED window only — the requested window is immutable, proved by reading it back unchanged; a second confirmed appointment overlapping the same vehicle is refused by the frozen EXCLUDE as 409 (denial); a wrong If-Match is refused (stale-version); two concurrent reschedules leave exactly one committed winner (concurrency)',
  },
  'apt.appointment-cancel': {
    files: [
      'tests/backend/p1-18-appointment-lifecycle.test.ts',
      'tests/backend/p1-18-scope-containment.test.ts',
    ],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
    ],
    note: 'terminal and set-once; cancelling an already-cancelled or no-show appointment is refused (denial); cancellation writes reason + time + actor together, so the frozen coherence CHECK can never see a half-cancelled row; distinct from no-show and never a substitute for it',
  },
  'apt.appointment-no-show': {
    files: [
      'tests/backend/p1-18-appointment-lifecycle.test.ts',
      'tests/backend/p1-18-scope-containment.test.ts',
    ],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
    ],
    note: 'reachable ONLY from confirmed — a requested or pending appointment is refused (denial), which is the business rule that you cannot fail to show up for an appointment nobody confirmed; never inferred from elapsed time',
  },
  'rec.reception-create': {
    files: ['tests/backend/p1-18-reception-create.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'rollback',
      'idempotency',
      'concurrency',
    ],
    note: 'both origin modes: a walk-in creates its own origin record (no fabricated appointment) and an appointment origin also moves the appointment to checked_in, all in one transaction; visit + service-requester role + accepted custody + status history are written atomically by rec.accept_check_in and an injected failure leaves none of them (rollback); one origin is consumed at most once and two concurrent check-ins of the same origin leave exactly one visit (concurrency)',
  },
  'rec.reception-party-role': {
    files: [
      'tests/backend/p1-18-reception-parties.test.ts',
      'tests/backend/p1-18-scope-containment.test.ts',
    ],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'roles supersede by date rather than being edited in place — the frozen immutability trigger makes in-place edits impossible, proved by reading the superseded row back unchanged with only valid_to set; a role outside the frozen 7-value vocabulary is refused (denial)',
  },
  'rec.reception-authorization': {
    files: [
      'tests/backend/p1-18-reception-parties.test.ts',
      'tests/backend/p1-18-scope-containment.test.ts',
    ],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'fails closed: a partner holding no ACTIVE authorizing role on the visit is refused by the frozen authority guard (denial) and the refusal message never discloses which roles that partner does hold; vehicle_user and payer are not authorizing roles; the row is append-only and cannot be updated by any application role',
  },
  'rec.reception-condition-evidence': {
    files: [
      'tests/backend/p1-18-reception-evidence.test.ts',
      'tests/backend/p1-18-scope-containment.test.ts',
    ],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'idempotency',
      'rollback',
    ],
    note: 'one command, eight evidence kinds; a damage mark outside the 0..1 coordinate box and a finding on a finalised inspection are refused (denial); a damage map bound to a version that does not belong to its document is refused by the frozen guard; an out-of-scope parent inspection or map answers 404 rather than a foreign-key error (cross-tenant); prior evidence is never overwritten',
  },
  'rec.reception-signature': {
    files: [
      'tests/backend/p1-18-reception-evidence.test.ts',
      'tests/backend/p1-18-scope-containment.test.ts',
    ],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'bound to an exact immutable document version (a version belonging to another document is refused); append-only — no application role holds UPDATE or DELETE on rec.signatures, proved by attempting both; records an acknowledgement, never a certified identity proof',
  },
  'rec.reception-refusal': {
    files: [
      'tests/backend/p1-18-reception-evidence.test.ts',
      'tests/backend/p1-18-scope-containment.test.ts',
    ],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'a refusal is preserved as its own fact and is never readable as consent — proved by showing an approval attempt still fails after a signature refusal is recorded; an archived refusal reason cannot be newly selected (denial); append-only and unerasable',
  },
  'rec.reception-approve': {
    files: [
      'tests/backend/p1-18-reception-approval.test.ts',
      'tests/backend/p1-18-scope-containment.test.ts',
    ],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
      'concurrency',
    ],
    note: 'prerequisites are exactly the frozen activation contract and nothing invented: without an active service requester, or without an approved authorization, the transition is refused (denial); a wrong If-Match is refused (stale-version); two concurrent approvals leave exactly one committed winner and exactly one outbox row (concurrency)',
  },
  'rec.reception-convert-to-work-order': {
    files: [
      'tests/backend/p1-18-reception-conversion.test.ts',
      'tests/backend/p1-18-scope-containment.test.ts',
    ],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'rollback',
      'stale-version',
      'idempotency',
      'concurrency',
    ],
    note: 'exactly-once is guarded twice — the application locks the reception and answers a replay with the existing work order, and uq_work_orders_ordinary_origin (a PARTIAL UNIQUE INDEX, which is why an audit that enumerated pg_constraint alone did not see it) is the database backstop — so the proof is behavioural: two forced-concurrent conversions of one reception produce exactly ONE work-order row (concurrency), a replay returns that same row rather than a second (idempotency), and an unapproved reception is refused (denial); an injected failure leaves no work order, no linkage and no audit (rollback); emits no event, because the approved catalog defines none for this fact',
  },
  // ========================================================================
  // Phase 1-19 (wo. / tech. / dia. / qms.) — Work Order, Diagnostics and
  // Technician Backend. Same derived-evidence model, and the same strict
  // comment-stripping ratchet P1-18 introduced: an operation counts as invoked
  // only if its id appears in executable code, never in prose about a test.
  //
  // Wave 4 (work-order core) below. Waves 5–8 append their own entries.
  // ========================================================================
  'wo.work-order-list': {
    files: ['tests/backend/p1-19-work-order-reads.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'keyset board of ONE branch, newest opened first; company and branch are required query parameters BECAUSE they are the authorizationTarget — the isolation case proves a caller granted only in branch A2 is refused for A1 rather than served it through the permission-blind app.branch_ids union (P1-18-A-01); a tenant-B work order never appears (cross-tenant); a bad cursor, an oversized page, an unknown parameter and a timezone-less date bound are refused (denial); an unknown state code returns an empty page rather than a 422, because wo.work_order_states is tenant-extensible',
  },
  'wo.work-order-detail': {
    files: ['tests/backend/p1-19-work-order-reads.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'work order + live jobs + reachable next states resolved from the live catalog, in a fixed number of round trips; a terminal order reports NO next states because the guard freezes it whatever the graph says (BR-WO-002); the ETag carries the record_version a transition must send back; an unknown id and a tenant-B id answer the same 404 (cross-tenant/denial)',
  },
  'wo.work-order-history': {
    files: ['tests/backend/p1-19-work-order-reads.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'keyset page of the append-only ledger newest-first, plus an origin block; the origin block is the honest answer to "what state did this open in" — wo.emit_work_order_status_history is AFTER UPDATE only so no genesis row exists, and shared.stamp_status_history would stamp a backfilled one with now(); a bad cursor is refused (denial) and a tenant-B work order yields nothing (cross-tenant)',
  },
  'wo.work-order-closure-eligibility': {
    files: ['tests/backend/p1-19-work-order-core.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'reports EVERY unmet blocker rather than the guard’s first: two unmet conditions come back as two, in CLOSURE_BLOCKER_REGISTRY order, and an already-terminal order returns alreadyTerminal with an empty list because the guard evaluates nothing; the Phase 1-21 conditions are reported as deferred rather than omitted, so a snapshot can never read them as checks that ran and passed',
  },
  'wo.work-order-transition': {
    files: ['tests/backend/p1-19-work-order-core.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
      'concurrency',
      'rollback',
    ],
    note: 'state + trigger-emitted history row + one audit record + one outbox event in ONE transaction, and an injected failure leaves none of them (rollback); the reason travels through the app.status_reason GUC, which both the guard and the ledger emitter read — without it every reason-required edge fails as a raw 23514 and every ledger reason is NULL; three refusals stay distinct (ERR-TRN-001 absent edge, ERR-VAL-001 missing reason, ERR-VAL-001 closing state asks for the closure command); a wrong If-Match is refused (stale-version) and two concurrent transitions leave exactly one winner (concurrency)',
  },
  'wo.work-order-closure': {
    files: ['tests/backend/p1-19-work-order-core.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
      'concurrency',
    ],
    note: 'the second permission is real, not documentary: a caller holding wo.work_order.transition but not wo.work_order.close is refused (denial), and the transition endpoint refuses a closing target so the split cannot be bypassed by choosing the other URL; closure runs the SAME eligibility service as the read endpoint and reports every blocker (ERR-WO-001) before the write; emits wo.work_order.closed and work-order.closed exactly once each',
  },
  'wo.job-create': {
    files: ['tests/backend/p1-19-work-order-jobs.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'the initial state is resolved from wo.job_states, never defaulted to a literal, because ck_jobs_state_format checks only the FORMAT and the vocabulary is the catalog table; wo.guard_job_refs is the enforcement point and refuses a terminal parent or one whose allows_jobs is false (denial); a replay under one Idempotency-Key adds one job, not two (idempotency); no event, because the approved catalog reserves none for job creation',
  },
  'wo.service-line-record': {
    files: ['tests/backend/p1-19-work-order-lines.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'quantity crosses as a decimal STRING because the column is numeric(12,3) and IEEE-754 cannot represent every value it holds — the test proves 2.500 survives unrounded; an optional jobId must belong to THIS order, and the test uses a job under a DIFFERENT order in the same branch, which satisfies the composite foreign key and is caught only by the explicit ownership check; a non-positive or over-scaled quantity, a blank description and a terminal work order are each refused with nothing written',
  },
  'wo.service-line-list': {
    files: ['tests/backend/p1-19-work-order-lines.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'oldest-first list of live lines; asserted not to bleed into the required-parts list, because they are different tables and different facts and a caller reading labour must not be shown parts as labour',
  },
  'wo.required-part-record': {
    files: ['tests/backend/p1-19-work-order-lines.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'the NEGATIVE claim is the point and it is asserted, not described: recording demand leaves wo.work_orders.parts_forward_state at its frozen default and leaves every inv table empty, because item_ref is foreign-keyed to the item CATALOG (inv.item_master, via migration 20260723097000 — the Phase 1-9 table comment calling it an unconstrained forward reference is stale) and never to stock, and reservation/issue are Phase 1-21; that is also why the closure-eligibility endpoint reports the two Phase 1-21 conditions as deferred rather than clear',
  },
  'wo.required-part-list': {
    files: ['tests/backend/p1-19-work-order-lines.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'oldest-first list of live demand rows; separate from the service-line list and proved separate',
  },
  'wo.job-assignment-create': {
    files: ['tests/backend/p1-19-job-assignments.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'idempotency',
      'concurrency',
    ],
    note: 'eligibility is complete and pre-write: three failures come back as three reasons in one response (denial), and a window crossing a SPLIT-SHIFT boundary is accepted while the same test proves no single tech.technician_availability row spans it — so the acceptance can only have come from the union check; an inactive profile, an out-of-branch profile and an uncovered window are each refused; uq_job_assignments_active_primary is a PARTIAL unique index so a second live primary is a 409 while assist is unconstrained, and a forced race leaves exactly one primary; assignment is what unblocks planned→assigned, proved by walking the job to completed afterwards',
  },
  'wo.job-assignment-list': {
    files: ['tests/backend/p1-19-job-assignments.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'the append-only history, ended rows included — ending stamps valid_to and the row SURVIVES, which is what makes "who worked this vehicle in March" answerable; requires tech.technician.read rather than wo.work_order.read, because an assignment names a member of staff and a caller who may read the board is not entitled to the roster (denial: the reader principal is refused)',
  },
  'wo.job-assignment-end': {
    files: ['tests/backend/p1-19-job-assignments.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'stale-version'],
    note: 'valid_to is SERVER-stamped and the reason is mandatory in the schema too (ck_job_assignments_end_reason), because removing a technician from work is accountable; a blank reason, a stale version, a missing If-Match and an already-ended assignment are four distinct refusals; ending frees the primary slot, proved by assigning again',
  },
  'wo.job-reassignment': {
    files: ['tests/backend/p1-19-job-assignments.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'idempotency',
      'rollback',
    ],
    note: 'ONE transaction, because two client calls would leave a window with no active assignment during which wo.guard_job_transition refuses every assignment_required state; the rollback case is the sharp one — the end is written BEFORE the incoming technician is evaluated, so an ineligible incoming profile must leave the outgoing assignment open with no reason and no audit row; a handover to the incumbent is refused rather than churning the history, and with no incumbent it degenerates to an assignment and reports ended: null',
  },
  'tech.labor-session-start': {
    files: ['tests/backend/p1-19-labor-sessions.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'idempotency',
      'concurrency',
    ],
    note: 'NO timestamp is accepted — started_at is the column default and the test asserts the recorded start falls inside the request’s own window; a startedAt in the body is a 422; one open session per technician is the partial gist EXCLUDE over tstzrange(started_at, COALESCE(ended_at, infinity)) so a second open session is 23P01 mapped to ERR-TECH-001, proved across two DIFFERENT jobs and shown not to affect another technician; a planned job (labor_allowed false) and an inactive profile are refused; a forced race leaves exactly one open session',
  },
  'tech.labor-session-list': {
    files: ['tests/backend/p1-19-labor-sessions.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'keyset page of a job’s labour log newest-first, corrections included; needs tech.technician.read because a session says who worked and for how long — timesheets are employee-derived and reading the board does not entitle a caller to them (the reader principal is refused); a tenant-B caller gets an EMPTY log rather than a 404, which discloses less than confirming the job exists',
  },
  'tech.labor-session-stop': {
    files: ['tests/backend/p1-19-labor-sessions.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
    ],
    note: 'ended_at is server-stamped and WRITE-ONCE in tech.guard_labor_session, so a second stop is refused here rather than reaching the trigger as a rewrite (denial); stopping frees the technician for another job; the pause/resume cycle is driven end to end — stop plus a job transition into paused, whose reason lands in wo.job_status_history because tech.labor_sessions has no pause column — and the resumed job carries TWO sessions, the first untouched',
  },
  'tech.labor-session-correct': {
    files: ['tests/backend/p1-19-labor-sessions.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
    ],
    note: 'never an edit: tech.correct_labor_session soft-deletes the original and inserts a linked replacement, and the test reads the ORIGINAL back to prove its window survived unchanged; the only path in this phase that accepts caller timestamps, behind tech.labor.correct (high risk) rather than tech.labor.record (low) because it rewrites what a technician was paid for; an inverted window, a blank reason and a timezone-less bound are each refused with nothing written',
  },
  'tech.technician-available': {
    files: ['tests/backend/p1-19-job-assignments.test.ts'],
    required: ['denial', 'isolation'],
    note: 'reports EVERY active candidate with its verdict, not only the eligible ones — an assigner facing an empty list learns nothing — with eligible first; the inactive profile is excluded at the QUERY rather than evaluated and discarded, and another branch’s technician is never a candidate; company and branch are required because they ARE the authorization target, so the scoped principal is refused BRANCH_A1 and served BRANCH_A2 (isolation) rather than handed an empty roster; the candidate cap is REPORTED as truncatedAt, because a silently truncated roster that looked complete would make an assigner conclude nobody is free; no cross-tenant case, because the operation names no resource id — a foreign branch simply fails the scoped permission check',
  },
  'tech.technician-queue': {
    files: ['tests/backend/p1-19-job-assignments.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'the profile is resolved through the technician module BEFORE any wo row is read, so the queue cannot enumerate work by guessing profile ids (cross-tenant: a tenant-B caller gets 404); one query joins job and work order so the queue is not an N+1; the projection is asserted to disclose NO employee-derived detail — no trade, no employment reference, no user id, nothing from the restricted certification details',
  },
  // --- Wave 6: additional work, customer approvals, the execution gate. ----
  'wo.additional-work-request': {
    files: ['tests/backend/p1-19-additional-work.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'outbox', 'idempotency'],
    note: 'provenance is REQUIRED and is this layer’s rule, because both origin columns are nullable and work whose provenance is unrecorded cannot be traced to what discovered it; the job-ownership case uses a job under a DIFFERENT work order in the same branch, which satisfies the composite foreign key and is caught only by the explicit check; originating_finding_id has NO foreign key at all, so an arbitrary uuid would have been stored happily and the refusal comes from a read through the diagnostics module — the only possible check and one the database cannot make, and it is proved POSITIVELY against a real seeded dia.findings row as well as by refusal, because a suite of refusals alone would pass an implementation that rejected every finding; a finding-only request DERIVES its originating job from the finding’s report, so the execution gate applies uniformly — otherwise work found by a diagnostic would let the very job that found it carry on unapproved while the same work found by hand stopped it — and a caller-named job that disagrees with the finding’s own job is refused rather than reconciled; the state check reads allows_additional_work and not just terminality, so qc_pending (non-terminal, flag false) is refused; is_required defaults to true because the safe reading of silence is that a vehicle should not leave with discovered work undone, and the column is immutable after insert, which is what makes B3 non-evadable',
  },
  'wo.additional-work-list': {
    files: ['tests/backend/p1-19-additional-work.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'the SAFE projection, and the test asserts the negative: even read by the principal holding iam.sensitive.view, the response body does not contain the restricted description, because that has its own operation and nothing can reach it by listing',
  },
  'wo.additional-work-detail-record': {
    files: ['tests/backend/p1-19-additional-work.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'the sensitive-data control, tested in BOTH directions with two principals one permission apart — FULL is refused and SENSITIVE is served — because iam.sensitive.view is declared alongside the functional permission and permissions are a conjunction; RLS (ins_additional_work_request_details_gated) is defence in depth behind that and is why folding the description into the request creation would have failed at the second INSERT after the request had already been written; the audit record carries the FACT and the length and never the text, and a query for the text in iam.audit_details proves it, because iam.audit_records is NOT gated by iam.sensitive.view; replacement is legitimate (UPDATE is granted, only the description is unfrozen) and stays 1:1 through the partial unique index',
  },
  'wo.additional-work-detail-read': {
    files: ['tests/backend/p1-19-additional-work.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation', 'audit'],
    note: 'audit class SECURITY rather than none — the only read in this module that is — because who looked at restricted data is itself the fact worth keeping; a 404 here genuinely means "no detail" rather than "hidden from you", precisely because the operation demands iam.sensitive.view so a caller who reaches the service holds it; both narrowed principals hold the sensitive permission scoped to the OTHER branch, so their refusal is the scope check and not a missing permission',
  },
  'wo.additional-work-withdraw': {
    files: ['tests/backend/p1-19-additional-work.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'stale-version',
      'idempotency',
    ],
    note: 'the exit that keeps a mistaken request from becoming permanent: a required pending request blocks BOTH closure (B3) and its originating job’s entry into any labour state, so without this the only escape would be to ask a customer to decide on work that was never needed; sits behind wo.additional_work.request and not the approve permission, because retracting a question is not deciding the answer; withdrawn is terminal so a second withdrawal is ERR-TRN-001, and the reason is mandatory here even though the row has no column for it — it lives in the audit record',
  },
  'wo.additional-work-fulfillment': {
    files: ['tests/backend/p1-19-additional-work.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'stale-version',
      'idempotency',
    ],
    note: 'the ONLY way B3’s second limb can clear: nothing else in the phase writes fulfillment_state, so without this an approved required request would block its work order’s closure permanently; unfulfilled is in the CHECK vocabulary and deliberately not settable, because moving back to it would un-record a completion nobody retracted and no trigger freezes the column; only an approved request may move — fulfilling a pending one would record work the customer has not authorised; a waiver needs a reason because declining agreed work is accountable; a TERMINAL work order is refused like every other command on this aggregate, and the case is reachable only through an OPTIONAL approved-unfulfilled request, because B3 ignores is_required=false so such an order closes — an earlier draft used the non-checking lock helper and left a released vehicle’s record writable, since fulfillment_state is frozen by no trigger and the state guard fires only on UPDATE OF state',
  },
  'wo.additional-work-approval': {
    files: ['tests/backend/p1-19-customer-approvals.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
      'idempotency',
      'rollback',
      'concurrency',
    ],
    note: 'the forgery-resistance control is proved rather than described: wo.guard_additional_work_state refuses state=approved with no approval row, and because no route can express that order the DEPLOYED guard is probed directly — a control nobody can reach through the API still has to be shown to work; the decision and the state change are ONE call because split in two there would be a window in which a decision exists and the request does not reflect it; the deciding party is refused when it belongs to another reception visit (23514 from wo.guard_customer_approval_coherence, mapped) and when it resolves to nothing (23503), and the composite party-role FK is satisfied in the first case so only the coherence guard catches it; evidence binds an exact document VERSION and the route has no storage-key field at all (a strict-schema 422 proves it); a rejected version is refused with ERR-DOC-001 while accepted is NOT required, because P1-15 documented acceptance as unreachable; the rollback is proved by a GENUINE failure at the LAST statement of the transaction — a pre-taken outbox key — after the approval row, the evidence row, the state change and both audit records have all been written, and all six are gone afterwards; reaching that point is why the event is keyed by the REQUEST and not by the approval, whose id the database generates mid-transaction where no test could pre-empt it. An earlier version of this suite credited rollback on the evidence pre-check, which refuses BEFORE any write and therefore proved nothing; that case survives under its own name as the pre-check it is. Two raced decisions leave exactly one',
  },
  'wo.additional-work-approval-read': {
    files: ['tests/backend/p1-19-customer-approvals.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'the decision plus its evidence, which is the only way an append-only wo.customer_approval_evidence row is readable at all; an undecided request is a 404 rather than an empty decision, because "no decision" and "a decision with no content" are different facts',
  },
  'wo.job-transition': {
    files: [
      'tests/backend/p1-19-job-lifecycle.test.ts',
      'tests/backend/p1-19-customer-approvals.test.ts',
    ],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
      'idempotency',
      'concurrency',
    ],
    note: 'the ONLY path a job state changes, so the graph has no bypass; the assignment precondition the assignments migration added to wo.guard_job_transition is invisible in the graph — planned→assigned is a configured, reason-free edge that still fails without an active assignment — and is refused as ERR-TECH-001 rather than a bare 23514 (denial); the reason reaches the ledger through app.status_reason, which is also what the guard reads to decide it was supplied; terminal freeze, absent edge and missing reason stay three distinct refusals; a forced race leaves exactly one winner and exactly one audit row and one event. Wave 6 adds the unapproved-work execution gate INSIDE this operation rather than beside it, so it cannot be bypassed by choosing another URL: it keys on wo.job_states.labor_allowed rather than a state name, blocks entry while a REQUIRED request originating from this job is pending, and deliberately uses only B3’s FIRST limb — including approved-and-unfulfilled would have deadlocked the job, since it could then never enter a labour state, so the approved work could never be done and B3 could never clear. A pause is never gated, an optional request never gates, and a request from a sibling job or another work order never gates',
  },
  'wo.job-history': {
    files: ['tests/backend/p1-19-job-lifecycle.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'keyset page of the append-only job ledger newest-first plus an origin block, because wo.emit_job_status_history is AFTER UPDATE only and a job creation emits no row; the pause REASON lives here rather than on a labour session, since tech.labor_sessions has only started_at/ended_at; a bad cursor is ERR-PAG-001 (denial) and a tenant-B job answers the same 404 as an unknown id',
  },
  // --- Wave 7: diagnostics. --------------------------------------------------
  'dia.diagnostic-create': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'the pin is the point: dia.guard_diagnostic_report_refs refuses anything but a PUBLISHED template version, and the pre-check tells draft from retired from missing where the guard raises one check_violation for all three; the diagnostic TYPE is joined from the template rather than accepted, so a report’s type cannot disagree with what it pins; revision numbers are monotonic per job and are asserted SEQUENTIALLY rather than under a forced race, because revision_number has NO unique index behind it (accepted item P1-19-A-02) and a race would prove nothing a constraint could back',
  },
  'dia.diagnostic-list': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'a job’s revisions newest first, so the current report is the first row rather than something a caller has to compute',
  },
  'dia.diagnostic-detail': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'report plus every entry, plus two derived blocks: the OUTSTANDING mandatory items — the same list the completion refusal returns, computed against the PINNED version so a newer template cannot change what this report owes — and the reachable statuses, taken from the mirrored graph so the reconciliation test pins this projection too; a terminal report reports no reachable status at all',
  },
  'dia.diagnostic-history': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'keyset page of the append-only ledger plus an origin block, because dia.emit_diagnostic_report_status_history is AFTER UPDATE only and creation emits nothing — and a backfilled genesis row would carry now(), since shared.stamp_status_history forces it; a bad cursor is ERR-PAG-001',
  },
  'dia.diagnostic-transition': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'stale-version',
      'idempotency',
    ],
    note: 'this graph is a FIXED PL/pgSQL IF chain with no catalog table and no tenant override, so the module mirrors it — unlike the wo graphs, which are tenant-overridable rows and must be read; tests/db/p1-19-diagnostic-graph-reconciliation.test.ts pins the mirror against the deployed function. Asking THIS endpoint for `completed` is refused, so the dia.diagnostic.complete permission cannot be bypassed by choosing the other URL. Every flag here is backed by a case driving THIS operation and not the completion one: an earlier revision declared cross-tenant, isolation, stale-version and idempotency in the header while asserting them only for completion, which the gate could not catch because it checks that an operation id appears in executable code and not that an assertion backs each claimed flag. The reason reaches the ledger through app.status_reason and is read back from wo-style history, because a service that validated a reason and never published it would leave every ledger row NULL — the Wave 4 defect, one schema over',
  },
  'dia.diagnostic-complete': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
      'idempotency',
      'rollback',
    ],
    note: 'every outstanding mandatory item comes back at once — the guard can only say "not yet", and a technician told that without being told WHICH of forty items is missing has been told nothing; a documented not-applicable reason counts as an answer, so skipping is possible and never silent; completion FREEZES the report against further entries, which the database does not do (none of the five entry tables consults the report’s status) and which is asserted rather than described; rollback is proved by a pre-taken outbox key so publishEvent raises after the status change and the audit record are both written',
  },
  'dia.diagnostic-item-result': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'the item must belong to the report’s PINNED version — fk_report_item_results_item is (tenant_id, template_item_id) and names no version, so an item from ANOTHER version satisfies it and the test uses exactly that, which without the read would let a report be answered with questions it was never asked; the value is checked against the item’s response_type, which the database does not do since result_value is text: a boolean item would accept "maybe" and a select item any string; an ANSWER carries no range verdict at ALL, unlike a measurement: report_item_results.result_value is text, nothing on this path reads validation_rule, and the table has no within_range column to record one in — the asserted asymmetry is the frozen schema’s, and refusing an out-of-range answer would contradict the module’s own rule that an out-of-spec observation is recorded rather than rejected',
  },
  'dia.diagnostic-measurement-record': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'the range comparison happens in the DATABASE as numeric, and the test uses a value a double cannot hold exactly (25.100001) to prove both the round trip and the verdict; bounds are inclusive, asserted at the boundary; within_range is THREE-valued and the null case is asserted, because flattening it to false would claim a check that never ran; an out-of-range reading is RECORDED rather than refused, since a diagnostic exists to record what is wrong; a unit disagreeing with the item and a measurement against a non-numeric item are both refused, and neither is a schema rule',
  },
  'dia.diagnostic-dtc-record': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'ck_dtc_records_code_format is ^[PBCU][0-9][0-9A-F]{3}$ and the shape is exact rather than approximate — the SECOND character is decimal and only the last three are hex, all upper case — so six malformed codes are refused as 422s naming the field, and the valid hex boundary U0FFF is accepted; every dtc_status value is exercised and one outside the vocabulary refused',
  },
  'dia.diagnostic-finding-record': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'severity and disposition answer different questions and nothing ties them, so a critical finding with no_action is accepted deliberately — a fault outside this workshop’s remit is a legitimate record; a finding is the anchor of the phase’s real provenance chain, since wo.additional_work_requests.originating_finding_id points here and Wave 6 resolves it through this module',
  },
  'dia.diagnostic-evidence-record': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'identical contract to wo.customer_approval_evidence: append-only, an exact document VERSION rather than a document, and no storage key — which the strict schema proves by refusing one; accepted is NOT required because P1-15 documented acceptance as unreachable while no application role may write shared.file_scan_results, and a rejected version IS refused',
  },
  'dia.diagnostic-recommendation-record': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'the finding link the phase brief asks for DOES NOT EXIST — dia.recommendations carries only diagnostic_report_id — so naming a finding is refused rather than silently dropped, and the test queries information_schema to prove no finding_id column exists rather than asserting the absence in prose; the chain the schema does support runs the other way and Wave 6 enforces it',
  },
  'dia.diagnostic-review': {
    files: ['tests/backend/p1-19-diagnostics.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'reviewer separation is proved in BOTH directions by two principals one permission apart — FULL creates reports and does NOT hold dia.diagnostic.review, REVIEWER holds it and did not create the report — so a service that refused every review could not pass; attribution is the database’s (dia.stamp_review overwrites reviewer_id from the session on every insert) and the test asserts the stamped id rather than a requested one; only a completed report may be reviewed, which the schema does not enforce; the table is append-only so two reviews both survive, which is what makes needs_rework usable',
  },
  // --- Wave 8: quality control, reopen refusal and rework. -------------------
  'qms.qc-record-open': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'a work order carries a SET of QC records rather than a current one — there is NO unique index on (work_order_id) — because a re-check after a failure must be a new record, and the suite opens a second one to prove it; a pending record has neither checker nor finalization time, which ck_quality_control_records_finalized pins; a terminal work order is refused, which the database does not check since qms.quality_control_records references the order and never reads its state',
  },
  'qms.qc-record-list': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'OLDEST first, so a failure and the passing re-check that cleared it read in the order they happened — the note said newest first for one revision while both the query (ORDER BY created_at, id) and the test that pins items[0] as the failure said otherwise',
  },
  'qms.qc-record-detail': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'reports which MANDATORY checks have no result yet — reported and not enforced, because B5b asks only whether a passed record exists when any mandatory check is configured and never looks at per-check results, so refusing finalization on an unticked one would be inventing a rule the closure gate does not apply',
  },
  'qms.qc-check-result': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'na is a first-class outcome and not a gap (ck_qc_check_results_result is pass|fail|na, never not_applicable); replacement is 1:1 through the partial unique index and STOPS at finalization, which is an application rule because qms.guard_qc_finalize freezes the RECORD and qms.qc_check_results never reads its overall_result; a check belonging to ANOTHER tenant satisfies fk_qc_check_results_check, which names no tenant column, so the catalog read is the only thing that refuses it and the test uses a real tenant-B check',
  },
  'qms.qc-record-finalize': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'stale-version',
      'idempotency',
    ],
    note: 'checker_id and finalized_at are stamped by qms.guard_qc_finalize from the session and are never sent, and the test asserts the STAMPED id; the freeze is proved twice — the service refuses a re-judgement readably, and the deployed guard refuses it when probed directly, because no route can express that request; pending is not a settable target; B5 is walked end to end, a failure blocking closure and a NEW passing record clearing it while the failure stays in the ledger',
  },
  'qms.reopen-attempt': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'returns 201 with the recorded attempt and its refusal, NOT a 409 — and that is load-bearing rather than a softening: an earlier draft threw, which aborts the request’s transaction and rolled the ledger row back with it, so the refusal was real and the record was not. The work order is asserted BYTE-FOR-BYTE unchanged afterwards, because "we refused" and "we refused and changed nothing" are different claims; outcome is CHECK-fixed to rejected so the vocabulary has one value; requested_by is stamped by qms.stamp_reopen_attempt and the test asserts the stamped id; an order that is not closed is ERR-TRN-001, a different fact from "you may not reopen it"',
  },
  'qms.reopen-attempt-list': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'the ledger an auditor reads to answer "did anyone try to reopen this after the vehicle was released"; append-only, SELECT+INSERT only',
  },
  'qms.rework-create': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'outbox',
      'idempotency',
      'rollback',
    ],
    note: 'the SECOND and last path that inserts wo.work_orders, and the reason it had to exist: before this wave nothing could produce kind=rework — reception’s conversion writes seven columns and leaves kind to its default — so qms.rework_links was unreachable and B6 could never fire. Not a contradiction of Wave 4’s boundary: that was the ORDINARY path, which originates from an authorized visit, and uq_work_orders_ordinary_origin is PARTIAL on kind=ordinary precisely so a rework against a converted visit is legal. The test asserts the new order is kind=rework AND shares the original’s reception visit and vehicle. The original must be CLOSED and NOT a cancellation: qms.guard_rework_link_coherence reads is_closed, which is the floor, but the seeded cancelled row carries is_closed=true AND is_cancellation=true — so the database alone would accept a rework against an abandoned order, and the service refuses it because rework corrects work that was DONE badly. An earlier revision asserted the opposite in five places and was wrong about the seed. Rollback is proved by removing the accepted custody event so wo.guard_work_order_refs refuses the INSERT after the display number has been allocated: no order, no link, and the sequence advance rolled back too',
  },
  'qms.rework-list': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'the rework cases raised against an ORIGINAL — the direction a service advisor asks about, since uq_rework_links_rework_wo constrains the other side',
  },
  'qms.rework-detail': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'the case without its restricted cost, which has its own gated surface — folding the cost in would make this read silently return an incomplete case for every caller lacking iam.sensitive.view',
  },
  'qms.rework-sign-off': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'stale-version',
      'idempotency',
    ],
    note: 'BR-QMS-001 is a CHECK here — ck_rework_links_signoff_distinct — unlike diagnostic reviewer separation, which the schema cannot express at all; the test drives the refusal end to end rather than only asserting the readable pre-check, and confirms nothing was signed. B6 is walked whole: the rework order’s own closure is blocked until the sign-off exists and succeeds afterwards. The signer is a technician PROFILE and not a user, sign_off_at is stamped by qms.guard_rework_signoff, and the signature is write-once. FULL creates rework cases and does NOT hold qms.rework.sign_off, so the permission split is proved in both directions',
  },
  'qms.rework-cost-record': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'the same gate as the additional-work description and tested the same way: FULL holds the functional permission and not iam.sensitive.view, SENSITIVE holds both, and they differ by exactly that one permission; the figure crosses as a decimal STRING because numeric(14,4) holds values IEEE-754 cannot, and 1234.5678 survives the round trip; the audit records the classification, the currency and the fact and NEVER the figure, which a query over iam.audit_record_details proves — that table is not gated by iam.sensitive.view',
  },
  'qms.rework-cost-read': {
    files: ['tests/backend/p1-19-quality-rework.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation', 'audit'],
    note: 'audit class SECURITY rather than none, like the additional-work description read: who looked at a cost-of-quality figure is itself worth keeping; both narrowed principals hold iam.sensitive.view scoped to the OTHER branch, so their refusal is the scope check and not a missing permission',
  },
  'wo.job-update': {
    files: ['tests/backend/p1-19-work-order-jobs.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'stale-version'],
    note: 'state is not accepted and cannot be written — the strict schema makes naming it a 422 and the UPDATE does not carry the column, so the graph has no bypass; addressed by job id alone, so the branch scope is re-decided against the LOCKED job’s own company and branch (P1-18-A-01) and a caller granted only in another branch is refused (isolation); a wrong If-Match is refused (stale-version) and the audit records only the columns that moved',
  },

  // ========================================================================
  // Phase 1-16 (crm.) — CRM Backend. Same derived-evidence model as P1-15:
  // the floor (route, service, success, authorization) is derived from the
  // registration; `required` below adds the extra obligations this operation
  // owes beyond that floor.
  // ========================================================================
  'crm.customer-search': {
    files: ['tests/backend/p1-16-customer-search.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'bounded allow-listed read; a tenant-B customer is unreachable (cross-tenant); an invalid cursor and an oversized query are refused (denial); safe projection only, no sensitive identifier',
  },
  'crm.individual-create': {
    files: ['tests/backend/p1-16-customer-creation.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox', 'rollback'],
    note: 'partner + individual profile + audit + outbox commit in one transaction; an injected failure leaves none of the four (rollback); the created customer is invisible from tenant B (cross-tenant)',
  },
  'crm.company-create': {
    files: ['tests/backend/p1-16-customer-creation.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox'],
    note: 'organization counterpart; proves the party-type discriminator comes from the path, so a company profile can never attach to an individual partner',
  },
  // --- Profile components: the re-parenting and IDOR surface. --------------
  'crm.contact-add': {
    files: ['tests/backend/p1-16-customer-profile.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'parent comes from the path; a cross-tenant customer id answers the same 404 as an unknown one, so the route is not an existence oracle',
  },
  'crm.address-add': {
    files: ['tests/backend/p1-16-customer-profile.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'same nesting guarantee as contacts; country code is format-validated only while the country reference decision is open',
  },
  'crm.preference-set': {
    files: ['tests/backend/p1-16-customer-profile.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'upsert keyed by (customer, channel, purpose); proves a preference never writes consent history',
  },
  'crm.consent-record': {
    files: ['tests/backend/p1-16-customer-profile.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox', 'rollback'],
    note: 'append-only; server-stamped actor and effective_at; a contact point owned by another customer is refused; an injected failure leaves no consent row, audit row, or event',
  },
  // --- Governance: the records that constrain how staff treat a customer. ---
  'crm.note-add': {
    files: ['tests/backend/p1-16-customer-governance.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'consumes DBCR-P1-16-001; the policies pin author and entity type, so an author cannot be forged and a note cannot attach to a non-CRM entity; the body never reaches the audit trail',
  },
  'crm.alert-raise': {
    files: ['tests/backend/p1-16-customer-governance.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'advisory only; proves an alert changes no lifecycle state',
  },
  'crm.tag-assign': {
    files: ['tests/backend/p1-16-customer-governance.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'segment plus assignment; re-tagging is a no-op, not a conflict',
  },
  'crm.customer-status-set': {
    files: ['tests/backend/p1-16-customer-governance.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'concurrency'],
    note: 'transition graph refuses no-ops and illegal moves; record_version makes a simultaneous change fail closed rather than overwrite; the append-only history is unwritable by UPDATE',
  },
  'crm.restriction-impose': {
    files: ['tests/backend/p1-16-customer-governance.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'rollback'],
    note: 'no_service blocks the customer in the same transaction with a status transition and block-history entry; a short reason is refused before anything is written',
  },
  // --- Identity: duplicates, merge, history, timeline, vehicle linkage. ----
  'crm.duplicate-scan': {
    files: ['tests/backend/p1-16-customer-identity.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'deterministic weighted scoring over tenant data; a dismissed pair is not re-raised by a re-scan; no cross-tenant customer is ever compared',
  },
  'crm.duplicate-review': {
    files: ['tests/backend/p1-16-customer-identity.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'concurrency'],
    note: 'only dismissed is recordable, so a reviewer cannot mark a pair merged without a merge; a second review of the same candidate is refused',
  },
  'crm.customer-merge': {
    files: ['tests/backend/p1-16-customer-identity.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox', 'rollback', 'concurrency'],
    note: 'same-record, cross-tenant, already-merged, and merge-into-merged are all refused; merge record plus redirect plus audit plus event commit together or not at all',
  },
  'crm.customer-history': {
    files: ['tests/backend/p1-16-customer-identity.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'projection over four append-only sources; server-fixed ordering; bounded',
  },
  'crm.customer-timeline': {
    files: ['tests/backend/p1-16-customer-identity.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'keyset page with an id tie-break, so equal occurred_at values cannot skip or repeat a row across a page boundary',
  },
  'crm.vehicle-link': {
    files: ['tests/backend/p1-16-customer-identity.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'both sides resolved under the tenant first; a duplicate open role for the same pair is refused; creates no vehicle schema',
  },
  // --- Grant / scope / approval administration — the confirmed-High surface.
  'iam.grant-issue': {
    files: ['tests/backend/iam-access-administration.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox'],
    note: 'issued within/at/beyond authority; audit + event once; rollback leaves nothing',
  },
  'iam.grant-revoke': {
    files: ['tests/backend/iam-access-administration.test.ts'],
    required: ['success', 'stale-version'],
    note: 'revocation immediate effect + stale-version conflict',
  },
  'iam.grant-scope-add': {
    files: ['tests/backend/iam-access-administration.test.ts'],
    required: ['success', 'isolation'],
    note: 'within-authority scope added; foreign-company widening refused',
  },
  'iam.grant-scope-remove': {
    files: ['tests/backend/iam-access-administration.test.ts'],
    required: ['success'],
    note: 'scope removed; DB backstop also proves last-scope removal cannot widen',
  },
  'iam.grant-scope-list': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'lists the scopes of a scoped grant',
  },
  'iam.approval-limit-create': {
    files: ['tests/backend/iam-access-administration.test.ts'],
    required: ['success', 'denial'],
    note: 'no self-limit; malformed money rejected',
  },
  'iam.approval-limit-end': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'denial', 'audit', 'stale-version'],
    note: 'window ended; permission-denied; wrong version refused',
  },
  'iam.approval-limit-list': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'listed and tenant-scoped',
  },
  // --- Role / permission administration.
  'iam.role-create': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'created and found in the list',
  },
  'iam.role-update': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'stale-version'],
    note: 'renamed; permission-denied; tenant-B refused; wrong version refused',
  },
  'iam.role-list': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'listed, tenant-scoped',
  },
  'iam.role-permission-add': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'denial', 'audit'],
    note: 'delegable allow added; permission-denied under RLS',
  },
  'iam.role-permission-update': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'denial', 'audit', 'stale-version'],
    note: 'effect changed; permission-denied; wrong version refused',
  },
  'iam.role-permission-remove': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'denial', 'audit'],
    note: 'mapping removed; DELETE policy refuses the unprivileged caller',
  },
  'iam.role-permission-list': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'listed',
  },
  'iam.permission-list': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'catalogue listed',
  },
  // --- User administration.
  'iam.user-list': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'cursor paginated, tenant-isolated',
  },
  'iam.user-detail': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'detail; cross-tenant not found',
  },
  'iam.user-update': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'stale-version'],
    note: 'profile updated; permission-denied; tenant-B refused; wrong version refused',
  },
  'iam.user-status-change': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'denial', 'audit', 'outbox'],
    note: 'lock revokes sessions + audits + one event; permission-denied; self refused',
  },
  'iam.user-session-list': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'listed for a user',
  },
  'iam.user-session-revoke-all': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'denial', 'audit', 'outbox', 'idempotency'],
    note: 'all revoked + audit + event; unprivileged revokes nothing; second call revokes zero',
  },
  // --- Organization settings.
  'iam.tenant-settings-read': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'read',
  },
  'iam.tenant-settings-update': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'denial', 'audit', 'stale-version'],
    note: 'updated + audit; permission-denied; wrong version refused',
  },
  'iam.company-settings-read': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'read in scope',
  },
  'iam.company-settings-write': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'audit', 'isolation'],
    note: 'append-only version written + audit; out-of-scope company refused',
  },
  'iam.branch-settings-read': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'read in scope',
  },
  'iam.branch-settings-write': {
    files: ['tests/backend/iam-admin-writes.test.ts'],
    required: ['success', 'audit', 'isolation'],
    note: 'version written + audit; out-of-scope branch invisible and refused',
  },
  // --- Audit viewing.
  'iam.audit-event-list': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'bounded range; privileged read is itself audited',
  },
  'iam.audit-event-detail': {
    files: ['tests/backend/iam-operations.test.ts'],
    required: [],
    note: 'cross-tenant record not found',
  },
  // --- Invitation / activation (provider-fake harness).
  'iam.invitation-create': {
    files: ['tests/backend/iam-auth-provider.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox'],
    note: 'invited account + audit + event; duplicate conflict; unprivileged refused; tenant-bound',
  },
  'iam.invitation-cancel': {
    files: ['tests/backend/iam-auth-provider.test.ts'],
    required: ['success', 'denial', 'audit', 'outbox'],
    note: 'invited → archived + audit + event; non-invitation refused',
  },
  'iam.invitation-activate': {
    files: ['tests/backend/iam-auth-provider.test.ts'],
    required: ['success', 'denial', 'audit', 'outbox'],
    note: 'accepted invitation activated + audit + event; unconfirmed refused',
  },
  // --- Authentication (provider-fake harness).
  'iam.auth-login': {
    files: ['tests/backend/iam-auth-provider.test.ts'],
    required: ['success', 'denial', 'audit'],
    note: 'token + session + success audit; every failure generic; failure audited',
  },
  'iam.auth-logout': {
    files: ['tests/backend/iam-auth-provider.test.ts'],
    required: ['success', 'audit', 'idempotency'],
    note: 'session revoked + logout audit; double logout is a no-op',
  },
  'iam.auth-session': {
    files: ['tests/backend/iam-auth-provider.test.ts'],
    required: ['success'],
    note: 'describeSession resolves identity, scope, permissions',
  },
  'iam.auth-password-reset': {
    files: ['tests/backend/iam-auth-provider.test.ts'],
    required: ['success', 'denial'],
    note: 'known → delivery; unknown → silent; non-allow-listed redirect refused',
  },
  'iam.auth-password-reset-completion': {
    files: ['tests/backend/iam-auth-provider.test.ts'],
    required: ['success', 'denial', 'idempotency'],
    note: 'completes + invalidates prior sessions; replay refused; bounds enforced',
  },
  // --- Reference exemplar.
  'meta.ping': {
    files: ['tests/backend/api-ping.test.ts'],
    required: [],
    note: 'end-to-end reference endpoint',
  },

  // -------------------------------------------------------------------------
  // P1-15 shared services.
  //
  // Every entry below names TWO files, and the split is the point:
  //
  //   `p1-15-operation-routes.test.ts`  drives the exported HTTP handler, so it
  //     carries `route`, the authorization verdict, and the status codes;
  //   the service suites drive the wired service directly, so they carry the
  //     deeper repository, provider and rollback properties.
  //
  // The union is what the operation owes. `required` here lists only what the
  // registration cannot derive — `outbox`, `denial`, `provider`.
  // -------------------------------------------------------------------------
  'shared.attachment-upload-authorize': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-attachments-notifications.test.ts',
    ],
    required: ['denial'],
    note: 'document created + signed upload URL issued; unpermissioned refused; tenant-B category invisible',
  },
  'shared.attachment-version-register': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-attachments-notifications.test.ts',
    ],
    required: ['denial', 'outbox'],
    note: 'pending version + audit + one event; a genuine tenant-B token is refused',
  },
  'shared.attachment-version-reject': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-attachments-notifications.test.ts',
    ],
    required: ['denial'],
    note: 'pending → rejected is the only runtime transition; a non-pending version is refused',
  },
  'shared.attachment-download-authorize': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-attachments-notifications.test.ts',
    ],
    required: ['denial', 'provider'],
    note: 'accepted version signs and the signature verifies; a pending version is ERR-DOC-001',
  },
  'shared.attachment-link-create': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-attachments-notifications.test.ts',
    ],
    required: ['denial', 'outbox'],
    note: 'reachability established + audit + event; unregistered entity type refused',
  },
  'shared.attachment-link-withdraw': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-attachments-notifications.test.ts',
    ],
    required: ['denial', 'outbox'],
    note: 'soft withdrawal; the row survives because the attachment fact is evidence',
  },
  'shared.notification-enqueue': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-attachments-notifications.test.ts',
    ],
    required: ['denial', 'outbox', 'provider'],
    note: 'pending row + audit + one event; consent refusal; dedupe; no provider call in the transaction',
  },
  'shared.template-create': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: ['denial', 'cross-tenant'],
    note: 'tenant template created; platform scope refused; duplicate identity conflicts',
  },
  'shared.template-update': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: ['denial'],
    note: 'grantable columns only; wrong version refused; missing If-Match is 428',
  },
  'shared.template-version-create': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: ['denial', 'outbox'],
    note: 'draft created + audit + event; a version is always born a draft',
  },
  'shared.template-version-revise': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: ['denial'],
    note: 'draft content revised; approved content is immutable',
  },
  'shared.template-version-approve': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: ['denial', 'outbox'],
    note: 'approver taken from the session; approved content can no longer be revised',
  },
  'shared.template-version-retire': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: ['denial', 'outbox'],
    note: 'refused while active; permitted after deactivation',
  },
  'shared.template-activation-set': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: ['denial'],
    note: 'only an approved version may become active',
  },
  'shared.template-version-preview': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: ['denial'],
    note: 'renders with sample values and sends nothing; a missing variable is 422, never 500',
  },
  'shared.branch-status-change': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: ['denial', 'outbox'],
    note: 'state + module-owned history + audit + one event; repeat is ERR-TRN-001',
  },
  'shared.branch-status-read': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: [],
    note: 'current state and reachable next states; out-of-scope branch refused',
  },
  'shared.export-authorize': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: ['denial'],
    note: 'both permissions required; sensitive field refused; export-class audit record written',
  },
  'shared.export-catalogue': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-templates-transitions-export.test.ts',
    ],
    required: [],
    note: 'registry metadata; identical for every caller holding rpt.export',
  },
  'shared.health-live': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-dispatch-and-health.test.ts',
    ],
    required: [],
    note: 'exact two-key payload; answers with no authenticator installed; touches nothing',
  },
  'shared.health-ready': {
    files: [
      'tests/backend/p1-15-operation-routes.test.ts',
      'tests/backend/p1-15-dispatch-and-health.test.ts',
    ],
    required: [],
    note: 'bounded probe; names and booleans only, no role or driver detail',
  },

  // ---- Phase 1-20 — service catalog, pricing, quotation --------------------
  'svc.service-list': {
    files: ['tests/backend/p1-20-service-catalog.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'keyset page of the catalog ordered by (service_code, id), a total order backed by uq_services_code so a page is stable when two services share a name; returns NO price, because resolution depends on company/branch/class/date and is gated on svc.price.read — bolting one on would leak the price book to every catalog reader; availableAtBranchId is a scope TARGET, authorized before it is used, so the difference between an empty and a non-empty page cannot be used to probe which branches stock a service (isolation) — without that the declared branch scope would be inert (P1-18-A-01); a tenant-B service never appears (cross-tenant); an unknown parameter, a bad cursor, an oversized page and a timezone-carrying effectiveOn are refused (denial)',
  },
  'svc.price-list-list': {
    files: ['tests/backend/p1-20-pricing.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'bounded tenant read; svc.price_lists carries no company_id or branch_id so a list is tenant-wide reference data and there is no branch to target — what makes it privileged is svc.price.read, which is medium risk because a price list exposes what the business charges every segment; a holder of svc.service.read alone is refused (denial) and a tenant-B list never appears (cross-tenant)',
  },
  'svc.price-list-create': {
    files: ['tests/backend/p1-20-pricing.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'currency_code is frozen by tg_price_lists_immutable from this moment, so the code supplied here denominates every amount ever attached and the audit record captures it; validated as an ISO-4217 SHAPE only, because the platform ships no currency table and no jurisdiction default — no currency is hard-coded; svc.price.read is not sufficient (denial); a duplicate price_list_code collides on uq_price_lists_code',
  },
  'svc.price-list-version-create': {
    files: ['tests/backend/p1-20-pricing.test.ts'],
    required: ['success', 'denial', 'stale-version', 'audit'],
    note: 'version_no is MAX+1 computed under the price list’s FOR UPDATE lock with uq_price_list_versions_no as the backstop; effectiveFrom here is PROVISIONAL and svc.publish_price_list_version overwrites it, which is why forward-only succession is the database’s decision and not a value a caller can pre-set; If-Match is required and a stale record_version is ERR-CON-001',
  },
  'svc.price-rule-record': {
    files: ['tests/backend/p1-20-pricing.test.ts'],
    required: ['success', 'denial', 'audit'],
    note: 'the amount crosses as a decimal STRING and is bound with a ::numeric(18,4) cast, so the stored figure is exactly what the caller sent and never a value that passed through a double — an over-scale amount, a negative one and exponential notation are all refused (denial); svc.guard_price_rule_parent_frozen refuses a rule on a published parent, which is what makes published prices immutable, so there is deliberately no update or delete route; a tax class on a rule that is not company-scoped is refused, mirroring ck_price_rules_tax_needs_company',
  },
  'svc.price-list-version-publish': {
    files: ['tests/backend/p1-20-pricing.test.ts'],
    required: ['success', 'denial', 'audit', 'outbox', 'stale-version', 'concurrency'],
    note: 'a SECOND permission (svc.price.publish) because drafting a price is not making it real, and publication is effectively irreversible — the freeze guard allows only published→archived; svc.publish_price_list_version closes the currently open published version at the new effective_from and refuses a date at or before its start, so succession is the database’s; the one precondition the function does NOT enforce is asserted here — a version with no active rules must not be published, or every later quotation line fails far away with what looks like missing data; a forced concurrent publication leaves exactly one published version and one event',
  },
  'quo.quotation-create': {
    files: ['tests/backend/p1-20-quotation.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'outbox', 'idempotency'],
    note: 'quo.quotations.work_order_id is NOT NULL, so the WORK ORDER is the scope authority — requireWorkOrder defers the scoped check to the row’s own company and branch, and nothing reads a company or branch from the request, because a client-supplied branch would be an authorization bypass; the client says WHAT to quote and never what it costs, and .strict() REJECTS unitPrice/lineTotal rather than ignoring them so a caller cannot believe it set a price; every amount is computed by PostgreSQL in the same expression shape the CHECK constraints validate, and the currency comes from the first line’s resolved price list with a later mismatch a hard failure and never a conversion',
  },
  'quo.quotation-detail': {
    files: ['tests/backend/p1-20-quotation.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'the path names no branch, so the scope is re-decided against the row’s own company and branch after it is read — otherwise the declared branch scope is inert and the permission-blind app.branch_ids union is the only narrowing (P1-18-A-01); every money field crosses as a decimal STRING; the ETag carries the record_version an issue or revise must send back',
  },
  'quo.quotation-revision-create': {
    files: ['tests/backend/p1-20-quotation.test.ts'],
    required: ['success', 'denial', 'stale-version', 'audit', 'concurrency'],
    note: 'a new revision is how a commercial change reaches a customer, because quo.guard_quotation_item refuses item writes on a non-draft parent and that is what makes an issued revision an immutable snapshot — the test republishes the price list and proves the ISSUED revision’s captured amounts do not move; revision_number is MAX+1 under the quotation’s FOR UPDATE lock with uq_quotation_revisions_number as the backstop, and a forced concurrent pair yields distinct numbers',
  },
  'quo.quotation-issue': {
    files: ['tests/backend/p1-20-quotation.test.ts'],
    required: ['success', 'denial', 'audit', 'outbox', 'stale-version', 'concurrency', 'rollback'],
    note: 'quo.issue_revision recomputes all four totals by SUM, refuses zero items, supersedes the prior issued revision and repoints current_revision_id, with uq_quotation_revisions_one_issued as the backstop so two issued revisions cannot coexist; the totals are frozen afterwards by quo.guard_quotation_revision_freeze; NO irreversible delivery happens in the transaction — the event goes to shared.event_outbox, so a rolled-back issue cannot leave a customer holding a quotation the database never issued, and a duplicate issue publishes exactly one event',
  },
  'quo.quotation-item-decide': {
    files: ['tests/backend/p1-20-quotation.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox', 'concurrency'],
    note: 'the ITEM is the resource because that is what the schema stores — quo.record_item_decision is item-keyed and uq_approval_decisions_item makes the first decision on a line final, so a conflicting second decision is refused rather than overwriting a recorded customer choice; presentedRevisionId is REQUIRED and is the control that stops approval of revision N approving revision N+1; a claimed decidingPartyRef must match the quotation’s own payer_partner_ref (forged party); evidence is a document_versions id — a storage key is unexpressible — and must be linked to THIS quotation, or any visible document could be attached as evidence for any quotation',
  },
  'quo.quotation-revision-decide': {
    files: ['tests/backend/p1-20-quotation.test.ts'],
    required: ['success', 'denial', 'audit', 'outbox', 'rollback'],
    note: 'an ORCHESTRATION over the per-item function, not a second store — there is no revision-level decision row in quo and this creates none; all-or-nothing in one transaction, so a line already carrying the OPPOSITE decision aborts the whole command rather than discarding a recorded choice; the quotation-level outcome is recomputed from the item rows every time, and any rejected line means rejected because treating a partial rejection as acceptance would authorize work the customer declined',
  },
  'svc.price-resolve': {
    files: ['tests/backend/p1-20-pricing.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'companyId and branchId are REQUIRED and are the authorizationTarget, so scope:branch is real rather than inert — a caller granted svc.price.read only in A2 is refused A1 even though an unrelated A1 grant puts A1 in its permission-blind app.branch_ids union (isolation, P1-18-A-01); three answers are refusals rather than defaults, each with its own message: no configured price is not zero, a tax class with no effective rate is not an untaxed line, and a rule-level specificity+priority tie is structurally IMPOSSIBLE while uq_price_rules_signature exists (NULLS NOT DISTINCT, and a specificity score determines which columns are non-null, so a tie implies an identical signature) - the test asserts that structural guarantee directly rather than pretending the defensive ERR-CON-001 branch has a positive case',
  },
};

// ---------------------------------------------------------------------------
// Registry scanning
// ---------------------------------------------------------------------------

const literalString = (source, key) => {
  const m = new RegExp(`\\b${key}\\s*:\\s*['"\`]([^'"\`]*)['"\`]`).exec(source);
  return m ? m[1] : null;
};
const literalTrue = (source, key) => new RegExp(`\\b${key}\\s*:\\s*true\\b`).test(source);

/**
 * Extracts one `defineOperation({...})` literal, starting at its opening brace,
 * by balancing braces. Returns null when the literal is unterminated.
 */
function literalAt(source, braceStart) {
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

/**
 * Scans every `defineOperation({...})` in `src`, returning a Map of
 * id -> facts. `surface` is derived from WHERE the registration lives: an
 * operation registered inside an App Router `route.ts` is reachable over HTTP
 * and is therefore public API surface; anything else is internal.
 */
export function scanRegisteredOperations(root) {
  const src = join(root, 'src');
  const operations = new Map();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry === '.next') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const rel = toPosix(relative(root, full));
      if (rel.endsWith('server/auth/operation-registry.ts')) continue;
      const source = readFileSync(full, 'utf8');
      let index = source.indexOf('defineOperation(');
      while (index >= 0) {
        const braceStart = source.indexOf('{', index);
        const literal = braceStart >= 0 ? literalAt(source, braceStart) : null;
        if (literal) {
          const id = literalString(literal, 'id');
          if (id) {
            operations.set(id, {
              id,
              module: literalString(literal, 'module'),
              method: literalString(literal, 'method'),
              path: literalString(literal, 'path'),
              scope: literalString(literal, 'scope'),
              auditClass: literalString(literal, 'auditClass'),
              public: literalTrue(literal, 'public'),
              idempotent: literalTrue(literal, 'idempotent'),
              versionGuarded: literalTrue(literal, 'versionGuarded'),
              surface: /^src\/app\/api\/.*\/route\.tsx?$/.test(rel) ? 'public-api' : 'internal',
              source: rel,
            });
          }
        }
        index = source.indexOf('defineOperation(', braceStart + 1);
      }
    }
  };
  walk(src);
  return operations;
}

/** Back-compatible id-only view. */
export function scanRegisteredOperationIds(root) {
  return new Set(scanRegisteredOperations(root).keys());
}

/**
 * The evidence an operation owes purely because of how it registered itself.
 *
 * Applies to the `shared.` namespace only: P1-14's evidence model is the one it
 * was gated with and is not re-interpreted here.
 */
export function derivedRequirements(operation) {
  if (!operation || typeof operation.id !== 'string') return [];
  if (!isDerivedId(operation.id)) return [];

  const required = ['route', 'service', 'success'];
  required.push(operation.public ? 'unauthenticated' : 'authorization');
  // A caller-supplied resource identifier in the path IS the cross-tenant risk.
  if (!operation.public && typeof operation.path === 'string' && operation.path.includes('{')) {
    required.push('cross-tenant');
  }
  if (operation.idempotent) required.push('idempotency');
  if (operation.versionGuarded) required.push('stale-version');
  if (operation.auditClass && operation.auditClass !== 'none') required.push('audit');
  if (operation.scope === 'company' || operation.scope === 'branch') required.push('isolation');
  return [...new Set(required)];
}

/**
 * Parses the COVERAGE-EVIDENCE block of a test file into a map of
 * operationId -> Set(flags). Lines are only read between a line containing the
 * `COVERAGE-EVIDENCE` marker and the next line that closes the block comment, so
 * a stray "id: word" elsewhere in the file cannot be mistaken for a declaration.
 */
export function parseProvidedFlags(source) {
  const provided = new Map();
  const lines = source.split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    if (line.includes('COVERAGE-EVIDENCE')) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (line.includes(COMMENT_CLOSE)) {
      inBlock = false;
      continue;
    }
    // `shared` joined `iam` and `meta` with P1-15; `crm` joins with P1-16, `veh`
    // with P1-17, `apt`/`rec` with P1-18, `wo`/`tech`/`dia`/`qms` with P1-19, and
    // `svc`/`quo` with P1-20. The prefix list is explicit rather
    // than a wildcard so a typo in a declaration is a missing flag — which fails
    // the gate — instead of a silently accepted new namespace. Forgetting to add a
    // namespace here makes EVERY declaration for it invisible, so a new phase must
    // extend this alternation in the same commit that registers its operations.
    const m =
      /^\s*\*?\s*((?:iam|meta|shared|crm|veh|apt|rec|wo|tech|dia|qms|svc|quo)\.[a-z0-9-]+)\s*:\s*([a-z0-9 \-]+?)\s*$/.exec(
        line
      );
    if (m) {
      const flags = new Set(m[2].split(/\s+/).filter(Boolean));
      const existing = provided.get(m[1]);
      if (existing) for (const flag of flags) existing.add(flag);
      else provided.set(m[1], flags);
    }
  }
  return provided;
}

/** The JSDoc close marker, assembled so this source can mention it safely. */
const COMMENT_CLOSE = '*' + '/';

/**
 * Removes EVERY block comment from a file's text, so the "is this operation
 * actually invoked?" check can only be satisfied by executable code.
 *
 * This used to strip the COVERAGE-EVIDENCE block alone, which was not enough and
 * quietly weakened the strictest gate in the repository. A suite's header JSDoc
 * also carries a prose line — `Operations exercised here: <id>` — and it lives in
 * the SAME comment as the evidence block but ABOVE it, so it survived the strip
 * and satisfied the check on its own. Five P1-18 operations were referenced
 * nowhere else in their files: every `describe` and every `it` could have been
 * deleted and the gate would still have reported them at operation depth. That
 * is the same class of hole that credited eight P1-17 operations on evidence
 * which did not exist, and the reason this gate exists at all.
 *
 * Stripping all block comments is the honest rule: prose about a test is not a
 * test. An operation counts as referenced only if its id appears in real code —
 * a `describe`/`it` title or a call site.
 *
 * This is applied as a RATCHET, not retroactively, and the reason is recorded
 * rather than hidden. Turning it on for every operation fails 41 of them across
 * FOUR namespaces — `veh` 20, `crm` 18, `iam` 2, `meta` 1. (An earlier revision
 * of this comment said 39 across three and omitted `meta` entirely; the figure
 * is now pinned by `tests/foundation/operation-coverage-gate.test.ts` so it
 * cannot drift silently again.) Those suites do genuinely drive their operations — they
 * import the route module and call the handler — they simply never write the id
 * as a string outside their header. Rewriting three earlier phases' suites
 * inside a P1-18 remediation would put unvalidated breadth into protected
 * history for a cosmetic reason. So the strict form governs P1-18, the previous
 * form governs everything that predates it, and the gap is an open cross-phase
 * follow-up (P1-18-R-02) rather than a silent exemption.
 */
export function stripCoverageBlock(source) {
  const out = [];
  let inBlock = false;
  for (const line of source.split(/\r?\n/)) {
    if (line.includes('COVERAGE-EVIDENCE')) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.includes(COMMENT_CLOSE)) inBlock = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * The strict form: removes every comment, leaving only executable code.
 *
 * This is a single-pass lexical scanner rather than a line filter, because the
 * line filter it replaces was wrong in a way that mattered. It handled block
 * comments only, so a `//` banner survived — and three P1-18 suites had exactly
 * that
 * (`// rec.reception-signature` and two siblings), which meant the ratchet's own
 * promise, that prose cannot stand in for a test, was false for those operations.
 *
 * A naive `//`-to-end-of-line regex would be worse than the bug: these suites are
 * full of `'http://localhost/api/v1/…'`, and truncating there would silently
 * delete real code and produce false FAILURES. So the scanner tracks the four
 * contexts where `/` and `*` are not comment openers — single quotes, double
 * quotes, template literals, and regex literals — honours backslash escapes in
 * each, and only treats `//` and `/*` as comments in code position. Strings are
 * kept (an operation id inside a real string literal is executable code); their
 * contents simply cannot open a comment.
 *
 * Regex-versus-division is decided the way a lexer does it: a `/` starts a regex
 * only when the previous significant character cannot end an expression.
 */
export function stripComments(source) {
  let out = '';
  let i = 0;
  // The last non-whitespace character of emitted code, for the regex/division test.
  let prev = '';
  const n = source.length;
  const canPrecedeRegex = (c) => c === '' || '([{,;:=!?&|+-*%~^<>'.includes(c) || c === '\n';

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      // A block comment is whitespace, so keep tokens on either side apart.
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      prev = quote;
      continue;
    }
    if (c === '/' && canPrecedeRegex(prev)) {
      out += c;
      i += 1;
      let inClass = false;
      while (i < n) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        out += source[i];
        if (source[i] === '/' && !inClass) {
          i += 1;
          break;
        }
        if (source[i] === '\n') {
          // Not a regex after all; bail rather than swallow the rest of the file.
          i += 1;
          break;
        }
        i += 1;
      }
      prev = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    else if (c === '\n') prev = '\n';
    i += 1;
  }
  return out;
}

/** A pure-unit suite. Evidence for a public operation may not live only here. */
const isPureUnitFile = (file) => file.startsWith('tests/foundation/');

/** Normalises `registered` to a Map of id -> facts (facts may be minimal). */
function asOperationMap(registered) {
  if (registered instanceof Map) return registered;
  const map = new Map();
  for (const id of registered) map.set(id, { id });
  return map;
}

/** Normalises a manifest entry's file list. */
const filesOf = (entry) => {
  if (Array.isArray(entry.files)) return entry.files;
  if (typeof entry.file === 'string') return [entry.file];
  return [];
};

/**
 * Pure evaluator, so the negative fixture can drive it with a synthetic manifest
 * and an in-memory reader. `readFile(path)` returns the file's text, or null when
 * it does not exist. `registered` may be a Set of ids (no derived obligations
 * are computed) or a Map of id -> registration facts (they are).
 *
 * Returns `{ failures, matrix, counts }`. A clean run has `failures.length === 0`.
 */
export function evaluateCoverage({ registered, manifest, readFile }) {
  const failures = [];
  const matrix = [];
  const operations = asOperationMap(registered);
  const providedCache = new Map();
  const providedFor = (file) => {
    if (!providedCache.has(file)) {
      const text = readFile(file);
      providedCache.set(file, text == null ? new Map() : parseProvidedFlags(text));
    }
    return providedCache.get(file);
  };

  for (const id of [...operations.keys()].sort()) {
    const operation = operations.get(id);
    const entry = manifest[id];
    if (!entry) {
      failures.push(`${id}: registered operation missing from the coverage manifest`);
      matrix.push({
        id,
        files: [],
        referenced: false,
        required: [],
        provided: [],
        missing: ['<undeclared>'],
      });
      continue;
    }
    if (entry.pending) {
      failures.push(`${id}: coverage manifest carries "pending", which is not a permitted state`);
    }

    const derived = derivedRequirements(operation);
    const declared = entry.required ?? [];
    const required = [...new Set([...derived, ...declared])];

    const files = filesOf(entry);
    if (files.length === 0) {
      failures.push(`${id}: coverage manifest names no test file`);
    }

    const provided = new Set();
    let referenced = files.length > 0;
    for (const file of files) {
      const source = readFile(file);
      // The operation must be referenced OUTSIDE its own COVERAGE-EVIDENCE
      // block — the declaration cannot vouch for the invocation it declares.
      // For P1-18 the bar is higher: outside EVERY comment, so a prose line in
      // the header cannot stand in for a test either.
      const strict = [...P1_18_PREFIXES, ...P1_19_PREFIXES, ...P1_20_PREFIXES].some((prefix) =>
        id.startsWith(prefix)
      );
      const visible =
        source == null ? null : strict ? stripComments(source) : stripCoverageBlock(source);
      const inThisFile = visible != null && visible.includes(id);
      if (!inThisFile) {
        referenced = false;
        failures.push(
          `${id}: manifest names ${file}, but that file does not reference the operation id (not invoked)`
        );
        continue;
      }
      for (const flag of providedFor(file).get(id) ?? []) provided.add(flag);
    }

    const missing = required.filter((flag) => !provided.has(flag));
    if (referenced && missing.length > 0) {
      failures.push(
        `${id}: [${files.join(', ')}] is missing required evidence [${missing.join(', ')}] in its COVERAGE-EVIDENCE block`
      );
    }

    // The four structural checks below (metadata-only, unit-only, invocation-only,
    // internal-without-reason) originally applied to `shared.` alone. P1-18 opts
    // `apt.`/`rec.` in as well, because the P1-17 remediations showed the derived
    // floor is necessary but not sufficient: an operation can satisfy every
    // required flag and still be evidenced only by metadata. The already-closed
    // `crm.`/`veh.` namespaces are deliberately NOT opted in here — tightening a
    // gate over a merged phase belongs in that phase's own remediation, not in a
    // later phase's feature branch.
    const isDerived =
      id.startsWith(DERIVED_PREFIX) ||
      [...P1_18_PREFIXES, ...P1_19_PREFIXES, ...P1_20_PREFIXES].some((p) => id.startsWith(p));
    const metadataOnly = isDerived && !provided.has('route') && !provided.has('service');
    const unitOnly = files.length > 0 && files.every(isPureUnitFile);
    if (isDerived && metadataOnly) {
      failures.push(
        `${id}: evidence is metadata-only — no route and no service invocation is declared`
      );
    }
    if (isDerived && unitOnly) {
      failures.push(
        `${id}: evidence is unit-only — every named file is a pure-unit suite under tests/foundation/`
      );
    }
    // Invocation-only is structurally impossible for a `shared.` operation: the
    // derived floor always contains route, service, success and one of
    // authorization / unauthenticated. This check fires only if that floor is
    // ever edited away, which is exactly when it matters.
    if (isDerived && required.length === 0) {
      failures.push(`${id}: invocation-only is not a permitted state for a public operation`);
    }
    // An operation registered outside an App Router `route.ts` is not reachable
    // over HTTP. Reclassifying one is allowed, but only in the open: the
    // manifest must say why, so "internal" can never become a way to escape
    // acceptance evidence quietly.
    if (isDerived && operation.surface === 'internal' && !entry.internalReason) {
      failures.push(
        `${id}: registered outside src/app/api/**/route.ts but carries no manifest internalReason`
      );
    }

    matrix.push({
      id,
      surface: operation.surface ?? 'unknown',
      method: operation.method ?? null,
      path: operation.path ?? null,
      public: operation.public === true,
      files,
      referenced,
      derived,
      declared,
      required,
      provided: [...provided].sort(),
      missing,
      metadataOnly,
      unitOnly,
    });
  }

  // Manifest entries for operations that no longer exist are stale.
  for (const id of Object.keys(manifest)) {
    if (!operations.has(id)) {
      failures.push(`${id}: coverage manifest names an operation that is not registered`);
    }
  }

  const phaseRows = (prefix) => matrix.filter((m) => m.id.startsWith(prefix));
  const derivedRows = phaseRows(DERIVED_PREFIX);
  const crmRows = phaseRows(P1_16_PREFIX);
  const vehRows = phaseRows(P1_17_PREFIX);
  // P1-18 spans two namespaces, so its phase row set is their union.
  const aptRecRows = matrix.filter((m) => P1_18_PREFIXES.some((p) => m.id.startsWith(p)));
  // P1-19 spans four namespaces, so its phase row set is their union.
  const p1_19Rows = matrix.filter((m) => P1_19_PREFIXES.some((p) => m.id.startsWith(p)));
  // P1-20 spans two namespaces, so its phase row set is their union.
  const p1_20Rows = matrix.filter((m) => P1_20_PREFIXES.some((p) => m.id.startsWith(p)));
  const atOperationDepth = (m) =>
    m.referenced &&
    m.missing.length === 0 &&
    m.provided.includes('route') &&
    m.provided.includes('service') &&
    (m.provided.includes('authorization') || m.provided.includes('unauthenticated'));

  const phaseCounts = (rows) => ({
    registered: rows.length,
    publicApi: rows.filter((m) => m.surface === 'public-api').length,
    operationDepth: rows.filter(atOperationDepth).length,
    invocationOnly: rows.filter((m) => m.required.length === 0).length,
    pending: 0,
    unitOnly: rows.filter((m) => m.unitOnly).length,
    unreferenced: rows.filter((m) => !m.referenced).length,
    metadataOnly: rows.filter((m) => m.metadataOnly).length,
  });

  const counts = {
    registered: operations.size,
    publicApi: matrix.filter((m) => m.surface === 'public-api').length,
    internal: matrix.filter((m) => m.surface === 'internal').length,
    withRequiredEvidence: matrix.filter((m) => m.required.length > 0).length,
    invocationOnly: matrix.filter((m) => m.required.length === 0).length,
    p1_15: phaseCounts(derivedRows),
    p1_16: phaseCounts(crmRows),
    p1_17: phaseCounts(vehRows),
    p1_18: phaseCounts(aptRecRows),
    p1_19: phaseCounts(p1_19Rows),
    p1_20: phaseCounts(p1_20Rows),
  };
  return { failures, matrix, counts };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
/**
 * Writes one evidence matrix in **Prettier's** JSON shape.
 *
 * `JSON.stringify(x, null, 2)` always expands an array over multiple lines;
 * Prettier collapses a short one onto a single line. That difference is
 * invisible until CI runs this gate (which rewrites the file) *before*
 * `format:check` (which then fails on the file the gate just produced) — a
 * failure that cannot be reproduced by formatting the committed artifact,
 * because the committed artifact is fine. Formatting here makes the generator's
 * output and the formatter's expectation the same thing by construction.
 *
 * Prettier is resolved lazily so the gate still runs (unformatted) in a
 * checkout without dev dependencies; the surrounding try/catch keeps a missing
 * evidence directory non-fatal, as before.
 */
async function writeMatrix(path, payload) {
  const json = JSON.stringify(payload, null, 2) + '\n';
  let formatted = json;
  try {
    const prettier = await import('prettier');
    // The repo's own .prettierrc must be resolved explicitly: a programmatic
    // `format()` does not read it, so without this the output is formatted at
    // Prettier's default print width and `format:check` disagrees with us
    // about where an array fits on one line.
    const config = (await prettier.resolveConfig(path)) ?? {};
    formatted = await prettier.format(json, { ...config, parser: 'json', filepath: path });
  } catch {
    /* no prettier available: fall back to the raw shape rather than failing */
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, formatted);
  } catch {
    /* evidence dir may be absent in some checkouts; not fatal to the gate */
  }
}

async function runCli() {
  const ROOT = process.cwd();
  const jsonOutput = process.argv.includes('--json');
  const readFile = (rel) => {
    const abs = join(ROOT, rel);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };

  let registered;
  try {
    registered = scanRegisteredOperations(ROOT);
  } catch (error) {
    console.error(`IO error scanning operations: ${error.message}`);
    process.exit(2);
  }

  const { failures, matrix, counts } = evaluateCoverage({
    registered,
    manifest: MANIFEST,
    readFile,
  });

  const generatedFrom = 'scripts/check-operation-test-coverage.mjs';
  await writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-14', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts,
      operations: matrix,
    }
  );
  await writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-15', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts: counts.p1_15,
      operations: matrix.filter((m) => m.id.startsWith(DERIVED_PREFIX)),
    }
  );
  await writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-16', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts: counts.p1_16,
      operations: matrix.filter((m) => m.id.startsWith(P1_16_PREFIX)),
    }
  );
  await writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-17', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts: counts.p1_17,
      operations: matrix.filter((m) => m.id.startsWith(P1_17_PREFIX)),
    }
  );
  await writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-18', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts: counts.p1_18,
      operations: matrix.filter((m) => P1_18_PREFIXES.some((p) => m.id.startsWith(p))),
    }
  );

  await writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-19', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts: counts.p1_19,
      operations: matrix.filter((m) => P1_19_PREFIXES.some((p) => m.id.startsWith(p))),
    }
  );

  await writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-20', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts: counts.p1_20,
      operations: matrix.filter((m) => P1_20_PREFIXES.some((p) => m.id.startsWith(p))),
    }
  );

  if (jsonOutput) {
    console.log(JSON.stringify({ counts, operations: matrix, failures }, null, 2));
  } else {
    console.log(
      `Operation-to-test coverage (STRICT): ${counts.registered} registered operation(s)`
    );
    console.log(`  public API surface: ${counts.publicApi} · internal: ${counts.internal}`);
    console.log(
      `  with required evidence: ${counts.withRequiredEvidence} · invocation-only (read/catalogue): ${counts.invocationOnly}`
    );
    for (const m of matrix) {
      const ok = m.referenced && m.missing.length === 0;
      console.log(
        `  [${ok ? 'OK ' : 'FAIL'}] ${m.id.padEnd(36)} ${m.files.join(' + ') || '(none)'}`
      );
    }
    const p = counts.p1_15;
    console.log('');
    console.log(`P1-15 registered public operations: ${p.registered}`);
    console.log(`P1-15 operation-depth: ${p.operationDepth}`);
    console.log(`P1-15 invocation-only: ${p.invocationOnly}`);
    console.log(`P1-15 pending: ${p.pending}`);
    console.log(`P1-15 unit-only: ${p.unitOnly}`);
    console.log(`P1-15 unreferenced: ${p.unreferenced}`);
    console.log(`P1-15 metadata-only: ${p.metadataOnly}`);
    const q = counts.p1_16;
    console.log('');
    console.log(`P1-16 registered public operations: ${q.registered}`);
    console.log(`P1-16 operation-depth: ${q.operationDepth}`);
    console.log(`P1-16 invocation-only: ${q.invocationOnly}`);
    console.log(`P1-16 pending: ${q.pending}`);
    console.log(`P1-16 unit-only: ${q.unitOnly}`);
    console.log(`P1-16 unreferenced: ${q.unreferenced}`);
    console.log(`P1-16 metadata-only: ${q.metadataOnly}`);
    const r = counts.p1_17;
    console.log('');
    console.log(`P1-17 registered public operations: ${r.registered}`);
    console.log(`P1-17 operation-depth: ${r.operationDepth}`);
    console.log(`P1-17 invocation-only: ${r.invocationOnly}`);
    console.log(`P1-17 pending: ${r.pending}`);
    console.log(`P1-17 unit-only: ${r.unitOnly}`);
    console.log(`P1-17 unreferenced: ${r.unreferenced}`);
    console.log(`P1-17 metadata-only: ${r.metadataOnly}`);
    const s = counts.p1_18;
    console.log('');
    console.log(`P1-18 registered public operations: ${s.registered}`);
    console.log(`P1-18 operation-depth: ${s.operationDepth}`);
    console.log(`P1-18 invocation-only: ${s.invocationOnly}`);
    console.log(`P1-18 pending: ${s.pending}`);
    console.log(`P1-18 unit-only: ${s.unitOnly}`);
    console.log(`P1-18 unreferenced: ${s.unreferenced}`);
    console.log(`P1-18 metadata-only: ${s.metadataOnly}`);
    const t = counts.p1_19;
    console.log('');
    console.log(`P1-19 registered public operations: ${t.registered}`);
    console.log(`P1-19 operation-depth: ${t.operationDepth}`);
    console.log(`P1-19 invocation-only: ${t.invocationOnly}`);
    console.log(`P1-19 pending: ${t.pending}`);
    console.log(`P1-19 unit-only: ${t.unitOnly}`);
    console.log(`P1-19 unreferenced: ${t.unreferenced}`);
    console.log(`P1-19 metadata-only: ${t.metadataOnly}`);
    const u = counts.p1_20;
    console.log('');
    console.log(`P1-20 registered public operations: ${u.registered}`);
    console.log(`P1-20 operation-depth: ${u.operationDepth}`);
    console.log(`P1-20 invocation-only: ${u.invocationOnly}`);
    console.log(`P1-20 pending: ${u.pending}`);
    console.log(`P1-20 unit-only: ${u.unitOnly}`);
    console.log(`P1-20 unreferenced: ${u.unreferenced}`);
    console.log(`P1-20 metadata-only: ${u.metadataOnly}`);
    if (failures.length === 0) {
      console.log(
        `\nOK: every registered operation is invoked in a referencing test and provides its required evidence.`
      );
      console.log(
        `Matrix written to docs/phase-1/phase-1-14|15/evidence/operation-test-matrix.json`
      );
    } else {
      console.error(`\n${failures.length} coverage failure(s):`);
      for (const f of failures) console.error(`  - ${f}`);
    }
  }

  process.exit(failures.length === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((error) => {
    console.error(`Operation-coverage gate failed: ${error.message}`);
    process.exit(2);
  });
}
