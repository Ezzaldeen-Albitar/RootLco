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
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY_ROOT, API_SRC_PATH, API_ROUTES_PATH } from './lib/repository-paths.mjs';

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
/**
 * P1-21 spans ONE id namespace — `inv.` — because the frozen Phase 1-10 `inv`
 * schema holds the item catalog, the ledger, and every operation table together.
 *
 * Listed here *and* in the `parseProvidedFlags` alternation below, because P1-20
 * proved that extending only one of the two produces a gate that looks stricter
 * than it is: the operations parse their declarations, provide `route`, `service`
 * and `authorization`, and none of it is REQUIRED, so deleting those assertions
 * keeps the gate green. Both hooks or neither.
 */
export const P1_21_PREFIXES = ['inv.'];
/**
 * P1-22 spans TWO id namespaces — `sal.` (billing, payment and delivery, which
 * share the frozen Phase 1-11 `sal` schema) and `wty.` (warranty).
 *
 * The P1-22 archaeology measured what this array's absence costs, and the answer
 * was worse than P1-20's: with neither hook extended, `derivedRequirements()`
 * returned `[]` for a `wty.` read — no route, no service, no authorization, no
 * isolation — so an operation could be credited at depth on evidence that was
 * never required, exactly the P1-20 defect. And because the
 * `parseProvidedFlags` alternation was blind too, a `sal.`/`wty.` declaration
 * parsed to NOTHING, so the one namespace-agnostic obligation that did derive
 * (`idempotency`, from CSA-22) could not be satisfied by any declaration a test
 * could write. One hook alone is not half a gate — the two failures compound in
 * opposite directions, and only extending both is coherent.
 *
 * `rpt.` is deliberately absent: Phase 1-11 also froze a `rpt` schema, but P1-22
 * registers no `rpt.` operation. A prefix listed here with no operations behind
 * it would report a vacuous 0/0 phase block that looks like passing coverage.
 */
export const P1_22_PREFIXES = ['sal.', 'wty.'];
/**
 * P1-23 spans ONE *new* id namespace — `rpt.` — and reuses one existing one.
 *
 * The document, file, template and notification operations of P1-23 live in
 * `shared.`, which `DERIVED_PREFIX` has covered since P1-14. They need no new
 * hook, and adding one would double-count the namespace. What is new is
 * reporting: Phase 1-11 froze the `rpt` schema
 * (`rpt.report_configurations`, `report_configuration_versions`,
 * `saved_filters`) and, as the P1-22 note above records, `rpt.` was left out
 * *precisely because no operation existed behind it* — a prefix with no
 * operations reports a vacuous 0/0 block that reads like passing coverage.
 *
 * P1-23 registers the first `rpt.` operations, so the prefix is added now and
 * not before. Listed here **and** in the `parseProvidedFlags` alternation
 * below, because P1-20 and P1-22 both proved that extending one hook without
 * the other produces a gate that looks stricter than it is, and that the two
 * failures compound in opposite directions: an unlisted prefix makes
 * `derivedRequirements()` return `[]` so nothing is required, while an
 * unlisted alternation makes every declaration parse to nothing so the one
 * namespace-agnostic obligation cannot be satisfied by any declaration a test
 * could write. Both hooks or neither.
 */
export const P1_23_PREFIXES = ['rpt.'];
/**
 * P1-24 adds NO namespace. It adds the two that were left behind (P1-24-F-001).
 *
 * `iam.` and `meta.` are the ORIGINAL namespaces — P1-13 and P1-14 — and every
 * namespace delivered after them joined the derived floor while these two stayed
 * on the declared model the floor was invented to replace. Thirty-nine
 * operations, 17% of the public surface, and the seventeen percent that decides
 * who may do anything at all. The comment above `derivedRequirements` states the
 * old position honestly ("the rest of the derived floor deliberately stays
 * namespace-scoped… this is not a general re-interpretation of P1-14's evidence
 * model") and that position was right for a feature phase. P1-24 is the
 * integration and release gate, which is the phase whose job is exactly this.
 *
 * Measured against the floor at the P1-24 baseline `1c74454d`, all 39 failed it
 * and fourteen carried no evidence flags at all. Nothing anywhere asserted that
 * a caller lacking `iam.user.read` is refused `GET /iam/users`, or that
 * `GET /iam/users/{userId}` with another tenant's real user id does not return
 * that user. `tests/backend/p1-24-iam-route-depth.test.ts` supplies the missing
 * evidence; this line is what stops it being deleted again.
 *
 * Both hooks, as the P1-23 note insists: the prefixes are listed here AND in the
 * `parseProvidedFlags` alternation below — where, as it happens, `iam` and
 * `meta` have been present since P1-15. That asymmetry is precisely how the gap
 * stayed invisible: declarations for these namespaces PARSED fine, so a reader
 * checking the alternation would conclude they were covered. Only
 * `derivedRequirements` returning `[]` gave it away.
 */
export const P1_24_PREFIXES = ['iam.', 'meta.'];

/**
 * PRE-P1-29 Wave B — the control plane.
 *
 * Both hooks, as the P1-23 note insists: the prefix is listed HERE and in the
 * `parseProvidedFlags` alternation below. Extending one without the other is
 * exactly how the P1-24 gap stayed invisible — declarations PARSED fine, so a
 * reader checking the alternation would conclude the namespace was covered,
 * and only `derivedRequirements` returning `[]` gave it away.
 *
 * `platform.` operations are not inside a tenant, so their derived floor is
 * not the tenant-isolation one every other namespace gets; what they owe is
 * proof that the platform-authority branch is load-bearing, which is a
 * FUNCTIONAL obligation their COVERAGE-EVIDENCE blocks carry.
 */
export const PRE_P1_29_PREFIXES = ['platform.', 'org.'];

/*
 * `org.` joins in Wave C (the Company RBAC Backend), and it is the FIRST
 * namespace to have been missing from BOTH hooks at once. That combination is
 * worse than the P1-24 asymmetry the note above describes, and it fails silently
 * in a different way:
 *
 *   not in the alternation  -> a COVERAGE-EVIDENCE line for the namespace does
 *                              not parse, so PROVIDED evidence is empty;
 *   not in DERIVED_PREFIXES -> `derivedRequirements` returns [], so REQUIRED
 *                              evidence is empty too.
 *
 * Empty required against empty provided is a PASS. So an `org.` operation could
 * have shipped owing nothing and proving nothing, and neither hook read on its
 * own would have shown it — the P1-24 tell (`derivedRequirements` returning [])
 * is only a tell when the alternation parses. Both move here, in one commit,
 * and `tests/foundation/operation-coverage-gate.test.ts` asserts both halves
 * behaviourally rather than by reading this list.
 */
const DERIVED_PREFIXES = [
  DERIVED_PREFIX,
  P1_16_PREFIX,
  P1_17_PREFIX,
  ...P1_18_PREFIXES,
  ...P1_19_PREFIXES,
  ...P1_20_PREFIXES,
  ...P1_21_PREFIXES,
  ...P1_22_PREFIXES,
  ...P1_23_PREFIXES,
  ...P1_24_PREFIXES,
  ...PRE_P1_29_PREFIXES,
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
 *   retired-visible  an entry retired through the API is present in this
 *                    administrative read and absent from the picker read
 */
/**
 * The replay-evidence kind. Named once because `derivedRequirements` applies it
 * across every namespace and `scripts/ci/check-idempotency-evidence.mjs` joins on
 * the same string — a literal in two places is a typo away from a silent pass.
 */
export const EVIDENCE_KEY_IDEMPOTENCY = 'idempotency';

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
  'retired-visible',
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
  'veh.vehicle-read': {
    files: ['tests/backend/p1-17-vehicle-read.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'the only operation that returns one vehicle; the route module exported PATCH and nothing else, so a profile screen could reach a vehicle’s plates and never learn its make (P1-27-INT-002). The projection is asserted as a KEY SET in both directions, because NFR-PRV-001 forbids projecting a restricted identifier and a field-by-field assertion cannot catch an addition. A merged vehicle is RETURNED with mergedIntoId, deliberately unlike the CRM customer read: the PATCH treats it as existing-but-frozen (409), so a 404 here would report a vehicle live work orders reference as missing. Publishes record_version and an ETag, which the PATCH has always demanded via If-Match and nothing ever supplied',
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
  'veh.catalogue-make-list': {
    files: ['tests/backend/p1-27-vehicle-catalogue-and-cursors.test.ts'],
    required: ['success', 'denial'],
    note: 'P1-27-INT-007. veh.makes had no read of any kind, so a creation form could not offer a make and a vehicle could only be created with make_id null. Tenant scoping is RLS’s alone (scope = platform OR tenant_id = current) — the repository adds no tenant predicate, because one would hide every platform row from every tenant',
  },
  'veh.catalogue-model-list': {
    files: ['tests/backend/p1-27-vehicle-catalogue-and-cursors.test.ts'],
    required: ['success', 'denial'],
    note: 'nested under the make because uq_models_platform_code is unique on (make_id, code), so a model code only means something relative to a make. An unknown or invisible make answers an EMPTY PAGE rather than 404, which is what stops it being an existence oracle for another tenant’s catalogue additions. Sorted by name, and the suite proves it by inserting five models out of alphabetical order at one shared instant',
  },
  'veh.catalogue-trim-list': {
    files: ['tests/backend/p1-27-vehicle-catalogue-and-cursors.test.ts'],
    required: ['success', 'denial'],
    note: 'same shape and same reasoning as the model list, one level down',
  },
  'veh.catalogue-body-type-list': {
    files: ['tests/backend/p1-27-vehicle-catalogue-and-cursors.test.ts'],
    required: ['success', 'denial'],
    note: 'the flat sibling of the make list; asserted to publish {items, nextCursor, hasMore} and no total',
  },
  'veh.catalogue-powertrain-type-list': {
    files: ['tests/backend/p1-27-vehicle-catalogue-and-cursors.test.ts'],
    required: ['success', 'denial'],
    note: 'NOT powertrain_category, which is a five-value enum on the vehicle itself and needs no lookup. powertrain_type_id references a tenant-extensible catalogue relation, and a form offering the enum where the uuid belongs sends a value the FK rejects',
  },
  'veh.vehicle-duplicate-list': {
    files: ['tests/backend/p1-16-17-duplicate-candidate-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'the vehicle mirror of crm.duplicate-list, missing for the same reason (P1-27-INT-005). The pair is labelled by display_number, never by VIN, and match_basis publishes WHICH signal fired (vin_collision) and never the value — guaranteed by veh.valid_match_basis, which the suite proves still bites by attempting a raw-value insert and asserting the write is refused rather than only asserting the projection is clean',
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
  'rec.receiving-employee-list': {
    files: ['tests/backend/p1-18-reception-create.test.ts'],
    required: ['success', 'denial', 'isolation'],
    note: 'FE-007. The picker the check-in form selects a custodian from. It exists to answer exactly the question the authoritative insert guard asks, so the evidence is the two halves together: what the list offers, and what a create does with an id the list did not offer. Declared in the create suite for that reason — a list proven in isolation from the write it feeds proves only that a query runs.',
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
  // ---------------------------------------------------------------------------
  // Reception evidence contracts — Owner decisions FE-012, FE-018, FE-019.
  // ---------------------------------------------------------------------------
  'rec.reception-evidence-binding': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'FE-018 applied to capture. Binds one exact immutable document version to one capture requirement, unfinalized. A rejected or quarantined version is refused outright, a version of the wrong category is refused, and a document with no live link to this visit is refused - all three by rec.guard_reception_evidence_binding, not by a predicate in the module.',
  },
  'rec.reception-evidence-binding-list': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'The capture contract of one visit: what it owes, what it has, and which damage-map templates it may still bind. satisfied counts FINALIZED bindings only, so a screen cannot report a visit complete on versions that are still pending.',
  },
  'rec.reception-evidence-binding-finalize': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'The only act that makes captured media count. Refused while the bound version is pending; a second finalization is a 409 rather than a silent success.',
  },
  'rec.reception-capture-override': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'Waiving a required capture costs rec.reception.evidence.override, which capture authority does not imply - the denial case runs on a caller holding rec.reception.evidence.manage and nothing else. Recorded once per requirement per visit, never editable.',
  },
  'rec.reception-signature-list': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'FE-018 read-back. Every signature including superseded and repudiated ones, with the exact version bound, its state, and the SERVER-owned version checksum rather than the caller-supplied hash.',
  },
  'rec.reception-signature-event': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'FE-018 lifecycle. Finalizing is refused while the bound version is pending; repudiation is a second row and rewrites nothing, proved by reading both rows back after it.',
  },
  'rec.catalogue-damage-map-template-list': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial'],
    note: 'FE-012 administration read. Gated on rec.catalogue.manage, not on the reception read code: the receptionist picker is the visit capture contract, a different path.',
  },
  'rec.catalogue-damage-map-template-create': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'audit', 'idempotency'],
    note: 'FE-012. A slot has no bindable geometry until a revision is published against it. Zero rows ship.',
  },
  'rec.catalogue-damage-map-template-read': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'FE-012 historical read: a retired slot and every retired revision stay readable, and this read supplies the recordVersion the status command needs as If-Match.',
  },
  'rec.catalogue-damage-map-template-version-create': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'idempotency'],
    note: 'FE-012. Retires the previous revision and publishes the next in one transaction; a visit already bound keeps its revision, proved by reading the damage map back after the revision.',
  },
  'rec.catalogue-damage-map-template-status-set': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'stale-version', 'audit', 'idempotency'],
    note: 'FE-012. Retiring withdraws the slot from NEW visits only, proved by the bindable list of a later visit; bidirectional, because a slot owns its revision history and a one-way retirement would fork a diagram into two identities.',
  },
  'rec.catalogue-capture-policy-list': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial'],
    note: 'FE-019. The live rules of the tenant. Zero rows is the DEFAULT and not an error: the absence of a rule is what makes refusal supporting media optional.',
  },
  'rec.catalogue-capture-policy-set': {
    files: ['tests/backend/p1-18-reception-evidence-contracts.test.ts'],
    required: ['success', 'denial', 'audit', 'idempotency'],
    note: 'FE-019. Retire-then-insert in one transaction, so the rule that applied at the time of a visit stays readable. The suite proves the default (a refusal with no media is accepted), the raised floor (the same refusal type is then refused), that a type the rule does not name is unaffected, and that lowering it restores the default.',
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
  // P1-27 read-surface remediation, executed by P1-18. Reads fold into this
  // block for the same reason the P1-27 vehicle reads folded into the veh/P1-17
  // rows: a prefix with no operations behind it would report a vacuous 0/0
  // block, and these ARE apt./rec. operations.
  'rec.reception-detail': {
    files: ['tests/backend/p1-27-reception-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-27-INT-010. The reception had no read of any kind: rec.reception-approve and rec.reception-convert-to-work-order both demand If-Match and the only source of recordVersion was the response of a write the caller had just performed, so a visit was reachable in one unbroken session and in no other circumstance. This publishes recordVersion as an ETag, proven by round-tripping the published header into a guarded write.',
  },
  'rec.reception-list': {
    files: ['tests/backend/p1-27-reception-reads.test.ts'],
    required: ['success', 'denial', 'isolation'],
    note: 'P1-27-INT-011. No branch board and no per-vehicle visit list existed. Company and branch are required and travel as the authorization target so the scope-blind pre-handler evaluation never decides alone (P1-18-A-01); recordVersion travels per row because the guarded writes are addressed from the list.',
  },
  'rec.reception-party-role-list': {
    files: ['tests/backend/p1-27-reception-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-27-INT-015. No read of a visit party roles existed, so a resumed visit could not tell whose instruction the workshop may act on. valid_to IS NULL marks the active interval; cursor precision proven against same-microsecond fixtures (P1-27-INT-006).',
  },
  'rec.reception-authorization-list': {
    files: ['tests/backend/p1-27-reception-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-27-INT-016. Standing authorization state was discoverable only by attempting approve and reading the 409. The two-table UNION with rec.refusals (refusal_type = authorization) is mandatory and isStanding is computed over the whole union, so a withdrawn approval is visible as withdrawn — refusal is never read as consent.',
  },
  'rec.reception-condition-evidence-list': {
    files: ['tests/backend/p1-27-reception-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-27-INT-017. All eight evidence kinds were write-only. One paginated union with an optional kind filter; the restricted narrative tables (rec.complaint_details, rec.vehicle_content_details) are never selected, proven by a forbidden-substring scan of the raw response text.',
  },
  'rec.reception-history': {
    files: ['tests/backend/p1-27-reception-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-27-INT-021. First read path rec.custody_history has ever had, and custody is load-bearing for the INT-013 fix. seq travels as a string (bigint); the cursor tie-break is the uuid id per P1-15-SR-013.',
  },
  'apt.appointment-list': {
    files: ['tests/backend/p1-18-appointment-reads.test.ts'],
    required: ['success', 'denial', 'isolation'],
    note: 'P1-27-INT-019. All four apt. operations were writes; no calendar existed. The date filter and ordering run over the CONFIRMED window falling back to requested (COALESCE), per the P1-8 boundary record; recordVersion travels per row for the three guarded lifecycle commands.',
  },
  'apt.appointment-detail': {
    files: ['tests/backend/p1-18-appointment-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-27-INT-019. An operator arriving by URL could load nothing; the If-Match the guarded lifecycle commands demand existed only in a prior write response. Publishes recordVersion as an ETag, proven by round-tripping the published header into apt.appointment-reschedule.',
  },
  'apt.catalogue-appointment-type-list': {
    files: ['tests/backend/p1-18-intake-catalogues.test.ts'],
    required: ['success', 'denial'],
    note: 'P1-27-INT-018. apt.appointment-create requires appointmentTypeId and nothing published the types, so a booking form could not populate its own mandatory picker. Active rows only; RLS owns the platform-or-tenant union; empty is the no-fake-data policy working.',
  },
  'apt.catalogue-source-channel-list': {
    files: ['tests/backend/p1-18-intake-catalogues.test.ts'],
    required: ['success', 'denial'],
    note: 'P1-27-INT-018. The optional sourceChannelId on booking had no published options. Same catalogue contract as the appointment types.',
  },
  'apt.catalogue-cancellation-reason-list': {
    files: ['tests/backend/p1-18-intake-catalogues.test.ts'],
    required: ['success', 'denial'],
    note: 'P1-27-INT-018. apt.appointment-cancel demands a mandatory catalogued cancellationReasonId and no read existed, which made the cancel dialog unbuildable absolutely. Same catalogue contract.',
  },
  'rec.catalogue-visit-reason-list': {
    files: ['tests/backend/p1-18-intake-catalogues.test.ts'],
    required: ['success', 'denial'],
    note: 'P1-27-INT-018. rec.visit_reasons existed with zero operations. Same catalogue contract.',
  },
  'rec.catalogue-fuel-level-list': {
    files: ['tests/backend/p1-18-intake-catalogues.test.ts'],
    required: ['success', 'denial'],
    note: 'P1-27-INT-018. Check-in accepts fuelLevelId and the picker had nothing to show. Same catalogue contract.',
  },
  'rec.catalogue-warning-light-code-list': {
    files: ['tests/backend/p1-18-intake-catalogues.test.ts'],
    required: ['success', 'denial'],
    note: 'P1-27-INT-018 / RMC-11. The warning_light evidence kind demands a code id and the catalogue had no read, no rows and no management operation; this ships the read — population remains a separately recorded provisioning decision.',
  },
  'rec.catalogue-refusal-reason-list': {
    files: ['tests/backend/p1-18-intake-catalogues.test.ts'],
    required: ['success', 'denial'],
    note: 'P1-27-INT-018. The refusal record could not offer its optional catalogued reason. Same catalogue contract.',
  },
  // P1-27-INT-018, ADMINISTRATIVE reads. The seven picker lists above answer
  // "what may I offer"; these seven answer "what does my catalogue contain",
  // which is a different question with a different permission. The picker
  // projection made the catalogue unadministrable: a retired entry appeared in
  // no read, so nothing could restore it, and no read published the
  // recordVersion the rename and lifecycle commands demand as If-Match. Each
  // entry owes `retired-visible` on top of the usual pair — the evidence that
  // the retired row this suite retires through the API is then present here and
  // absent from the picker, which is the whole reason the operation exists.
  'apt.catalogue-appointment-type-management-list': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'retired-visible'],
    note: 'P1-27-INT-018. Retired entries included and recordVersion projected, gated on apt.catalogue.manage rather than apt.appointment.read — a booking caller keeps seeing only what it may offer. The projected version is proven by round-tripping it as the If-Match of a rename and of a retirement.',
  },
  'apt.catalogue-source-channel-management-list': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'retired-visible'],
    note: 'P1-27-INT-018. Same administrative contract; two relations reference a channel, so a withdrawn one is retired and stays visible only here.',
  },
  'apt.catalogue-cancellation-reason-management-list': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'retired-visible'],
    note: 'P1-27-INT-018. Same administrative contract; the cancellation vocabulary is a policy an operator revises, which means seeing what they have already withdrawn.',
  },
  'rec.catalogue-visit-reason-management-list': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'retired-visible'],
    note: 'P1-27-INT-018. Same administrative contract; rec.visit_reason_links describes every past visit in this vocabulary, so entries leave it by status only.',
  },
  'rec.catalogue-fuel-level-management-list': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'retired-visible'],
    note: 'P1-27-INT-018. Same administrative contract; a live visit keeps resolving a level after the operator stops offering it, which is the case the picker structurally cannot show.',
  },
  'rec.catalogue-warning-light-code-management-list': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'retired-visible'],
    note: 'P1-27-INT-018 / RMC-11. Same administrative contract; the code set grows model by model, so this catalogue is edited most after first population.',
  },
  'rec.catalogue-refusal-reason-management-list': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'retired-visible'],
    note: 'P1-27-INT-018. Same administrative contract; a recorded refusal keeps naming its reason, so the list only ever changes by status.',
  },
  // P1-27-INT-018, management half. The reads above made the catalogues
  // READABLE; these make them POPULATABLE, which is what the screens actually
  // needed — every one of the seven tables ships zero rows by the no-fake-data
  // policy and no operation could add one, so a required appointmentTypeId
  // could never be satisfied. One suite covers all twenty-one because the seven
  // relations are structurally identical; it is table-driven over the REAL
  // handlers, so each catalogue is exercised in full rather than by analogy.
  'apt.catalogue-appointment-type-create': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'audit'],
    note: 'P1-27-INT-018. apt.appointment-create REQUIRES appointmentTypeId and nothing could add a type, so no appointment could be booked at all. scope and tenant_id come from the principal (proven by reading the stored row back), never the request; a duplicate code is 409 and a RETIRED entry still holds its code, because uq_appointment_types_tenant_code names deleted_at and not status.',
  },
  'apt.catalogue-appointment-type-update': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Renames only: code is frozen by tg_appointment_types_immutable and offering it is a 422 under the strict schema, because every appointment already booked means the code. A platform default answers an explained 403 rather than the zero-row UPDATE the RLS policy would otherwise produce.',
  },
  'apt.catalogue-appointment-type-status-set': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. The only removal affordance there is: app_runtime holds no DELETE grant and fk_appointments_type is ON DELETE RESTRICT. Bidirectional on purpose — a retired row keeps its code, so retire-only would burn it for the tenant permanently.',
  },
  'apt.catalogue-source-channel-create': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'audit'],
    note: 'P1-27-INT-018. The optional sourceChannelId on booking had no options to offer. Same management contract as the appointment types.',
  },
  'apt.catalogue-source-channel-update': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same rename contract; the code is frozen because appointments and walk-in references both record the channel they arrived through.',
  },
  'apt.catalogue-source-channel-status-set': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same lifecycle contract; two referencing FKs (apt.appointments, rec.walk_in_references), both ON DELETE RESTRICT.',
  },
  'apt.catalogue-cancellation-reason-create': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'audit'],
    note: 'P1-27-INT-018. apt.appointment-cancel demands a mandatory catalogued cancellationReasonId with no free-text escape and nothing could add one, so no appointment could be cancelled at all. Same management contract.',
  },
  'apt.catalogue-cancellation-reason-update': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same rename contract; the code is frozen because every cancelled appointment names the reason it was cancelled under.',
  },
  'apt.catalogue-cancellation-reason-status-set': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same lifecycle contract; cancelled appointments reference the row permanently, so withdrawal can only ever be a status.',
  },
  'rec.catalogue-visit-reason-create': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'audit'],
    note: 'P1-27-INT-018. rec.visit_reasons existed with zero rows and zero operations of any kind. Same management contract.',
  },
  'rec.catalogue-visit-reason-update': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same rename contract; rec.visit_reason_links records why the vehicle came in and means the code.',
  },
  'rec.catalogue-visit-reason-status-set': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same lifecycle contract; fk_visit_reason_links_reason is ON DELETE RESTRICT.',
  },
  'rec.catalogue-fuel-level-create': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'audit'],
    note: 'P1-27-INT-018. Check-in accepts fuelLevelId and the picker had nothing to show. This is also the catalogue the end-to-end proof runs on: a level created through the API is then referenced by a REAL reception visit opened through rec.reception-create.',
  },
  'rec.catalogue-fuel-level-update': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same rename contract; the level recorded at intake is part of the condition the vehicle arrived in and means the code.',
  },
  'rec.catalogue-fuel-level-status-set': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Where the no-hard-delete claim is proven behaviourally rather than asserted: a DELETE from the runtime role is 42501, a DELETE of a row a live visit references is 23503 even as admin, and retiring leaves the visit still resolving it.',
  },
  'rec.catalogue-warning-light-code-create': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'audit'],
    note: 'P1-27-INT-018 / RMC-11. The warning_light evidence kind requires a code id; PR #220 shipped the read and recorded that population remained a separately provisioned decision — this is the operation that makes it one an operator can actually take.',
  },
  'rec.catalogue-warning-light-code-update': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same rename contract; pre-service condition evidence is permanent and names the code it observed.',
  },
  'rec.catalogue-warning-light-code-status-set': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same lifecycle contract; fk_warning_light_observations_code is ON DELETE RESTRICT, so recorded evidence keeps resolving its code forever.',
  },
  'rec.catalogue-refusal-reason-create': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'audit'],
    note: 'P1-27-INT-018. The refusal record could not offer its optional catalogued reason. rec.reception-close-without-work states the same gap from the other side — it takes bounded free text precisely BECAUSE this catalogue had no management operation.',
  },
  'rec.catalogue-refusal-reason-update': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same rename contract; every recorded refusal means the code it was recorded under.',
  },
  'rec.catalogue-refusal-reason-status-set': {
    files: ['tests/backend/p1-18-intake-catalogue-management.test.ts'],
    required: ['success', 'denial', 'idempotency', 'stale-version', 'audit'],
    note: 'P1-27-INT-018. Same lifecycle contract; a refusal is preserved as its own fact and keeps naming its reason.',
  },
  'rec.reception-close-without-work': {
    files: ['tests/backend/p1-18-reception-closure.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'stale-version',
      'idempotency',
    ],
    note: 'P1-27-INT-014, the INT-013 sibling. closed_without_work was unreachable (only approve and convert called setStatus), so an abandoned visit occupied its vehicle forever through uq_reception_visits_open_vehicle. The suite proves the release: after closing, a second check-in of the SAME vehicle succeeds, because the partial index predicate names only opened/inspecting/authorized/converted. The mandatory reason lands in the append-only status ledger via the app.status_reason GUC.',
  },
  'rec.reception-refuse': {
    files: ['tests/backend/p1-18-reception-closure.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'stale-version',
      'idempotency',
    ],
    note: 'P1-27-INT-014. The refused terminal state had no route. Distinct from rec.reception-refusal, which appends a refusal evidence record and never changes receptionStatus; this ends the visit and releases the one-open-visit index, proven by re-receiving the same vehicle. Legal from any non-terminal state, exactly as the frozen graph says; terminal states are refused with the state named.',
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
  'tech.technician-me-queue': {
    files: ['tests/backend/br-01-technician-identity.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'PRE-P1-29-BR-01, closing INS-04 (CRITICAL) and T-11. The subject is the SESSION: the schema has no field naming a technician, so there is nothing to forge, and .strict() REFUSES a client-supplied technicianProfileId rather than ignoring it — a caller who believes they selected a subject must be told they did not, never quietly served their own queue. The response is asserted as the KEY SET {items} and proved not to contain the resolved id anywhere, because the existing path carries it only since the caller supplied it. Three "no" answers — no profile, an inactive or soft-deleted profile, and a profile in a branch the caller did not name — are proved BYTE-IDENTICAL 200 {items:[]}, since a 404 or a distinct code would tell a prober that somebody else IS a technician: the same oracle moved rather than closed. The scope pair is proved EVALUATED and not merely accepted, by a principal holding the read in A2 and an unrelated grant in A1 so that A1 sits inside its permission-blind allowed-branch union (P1-18-A-01) — without that grant RLS would have hidden the row and the assertion would pass against a scope-blind implementation. Equivalence with the supervisor path is asserted row-for-row and order-for-order, so this slice is proved to add a safe path rather than a second answer',
  },
  'tech.technician-queue': {
    files: ['tests/backend/p1-19-job-assignments.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'the profile is resolved through the technician module BEFORE any wo row is read, so the queue cannot enumerate work by guessing profile ids (cross-tenant: a tenant-B caller gets 404); one query joins job and work order so the queue is not an N+1; the projection is asserted to disclose NO employee-derived detail — no trade, no employment reference, no user id, nothing from the restricted certification details',
  },
  // ========================================================================
  // BR-03 (PRE-P1-29 backend remediation) — technician roster and capability
  // administration. Same derived-evidence model as the rest of `tech.`: the
  // floor comes from the registration, and `required` below only adds to it.
  // ========================================================================
  'tech.technician-list': {
    files: ['tests/backend/br-03-technician-roster.test.ts'],
    required: ['success', 'denial', 'isolation'],
    note: 'keyset page of ONE branch roster, newest first; company and branch are required because they ARE the authorization target, so the A2-scoped principal is refused A1 and served A2 (isolation) rather than handed an empty list — an empty roster and a forbidden one read the same to a screen. No cross-tenant flag: the operation names no resource id, and the measured behaviour for a tenant-B caller naming a tenant-A pair is 200-and-EMPTY rather than 403, because iam.has_permission_in_scope returns true for any pair on an unrestricted grant and the tenant boundary is the query predicate with RLS behind it. The page walk uses eight rows created back to back, which is the P1-27-INT-006 condition a millisecond-truncating cursor silently drops',
  },
  'tech.technician-create': {
    files: ['tests/backend/br-03-technician-roster.test.ts'],
    required: ['success', 'denial', 'audit', 'idempotency', 'isolation'],
    note: 'the ONLY roster operation whose authorization target comes from the body, because there is no row yet to resolve one from — scopeTargetOption narrows the pre-handler check and the service re-decides the same pair before the insert. isActive is deliberately absent from the schema and .strict() makes sending it a 422 rather than a silent drop, which is the exact shape a mass assignment would take. A user account in ANOTHER tenant is refused by naming a real foreign account, not a random uuid, so the check is proved tenant-scoped rather than existence-scoped. Replay is counted as DELTAS on the roster and on the audit trail (CSA-22), and no key at all is ERR-INT-002',
  },
  'tech.technician-detail': {
    files: ['tests/backend/br-03-technician-roster.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'the aggregate read that closes INS-24 — an assignment names a technicianProfileId and until this slice nothing resolved it. Asserts the projection as a KEY SET in both directions, because NFR-PRV-001 forbids personal data here and a field-by-field assertion cannot catch an ADDITION; the certificate number is proved absent even for the principal holding iam.sensitive.view. A tenant-B caller gets 404; an out-of-scope caller whose grant union CONTAINS the branch gets 403 rather than a second 404, which is the shipped bil.invoice-read shape and is recorded in the test as measured rather than assumed',
  },
  'tech.technician-update': {
    files: ['tests/backend/br-03-technician-roster.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'stale-version'],
    note: 'branch_id and user_id are named by tg_technician_profiles_immutable, so the schema has no word for either and sending one is a 422 — never a silent drop, because a caller who believed a branch transfer happened would act on a roster that never changed, and the test asserts the STORED branch is unchanged. The documented transfer path is driven end to end: the create in the target branch is refused while the first profile is live, retiring frees the uq_technician_profiles_active_user slot, and both halves survive. Retirement is a soft delete and deactivation is not retirement',
  },
  'tech.technician-skill-set': {
    files: ['tests/backend/br-03-technician-capabilities.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit'],
    note: 'PUT because uq_technician_skills_profile_skill permits one live level per skill and skill_id is immutable, so re-sending MOVES the existing row rather than adding one — asserted on the row id, not on the response. The catalogue check is the one the foreign keys cannot make: fk_technician_skills_skill is single-column because a platform row carries tenant_id IS NULL, so all three answers are proved — a platform row accepted, another tenant’s refused, and an INACTIVE one refused, the last because a retired skill would record an eligibility requirement nobody can satisfy',
  },
  'tech.technician-skill-withdraw': {
    files: ['tests/backend/br-03-technician-capabilities.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit'],
    note: 'soft delete, asserted on BOTH counts: the live row is gone and the row itself survives, because an assignment made while the skill stood keeps its evidence. Withdrawing frees the partial unique index so the skill can be recorded again at a different level, and the test proves the second row is a NEW one rather than a resurrection',
  },
  'tech.technician-certification-record': {
    files: ['tests/backend/br-03-technician-capabilities.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'calendar dates, not instants: certificationIsValidOn compares YYYY-MM-DD, and ck_technician_certifications_expiry is INCLUSIVE (expires_on >= issued_on) so a credential issued and expiring on the same day is accepted — the API uses the database’s rule rather than a stricter one invented at the boundary, and refuses the inverted case here so the caller gets a violation path instead of a transaction-aborting 23514. certStatus is absent from the body because a recorded credential is active. A repeated key replays; a DIFFERENT key with the same content is a real second attempt and uq_technician_certifications_active refuses it',
  },
  'tech.technician-certification-update': {
    files: ['tests/backend/br-03-technician-capabilities.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'stale-version'],
    note: 'NOT in the original BR-03 contract and added on proof: technician-eligibility-service refuses a revoked credential outright and certificationIsValidOn refuses any non-active status, so without this path two of the three states are unreachable and that refusal could never fire in production. The test moves a credential to revoked and back. certification_id and issued_on are named by the immutability guard and are absent from the schema, so re-pointing or back-dating is a 422',
  },
  'tech.technician-certification-detail-record': {
    files: ['tests/backend/br-03-technician-capabilities.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit'],
    note: 'the only BR-03 operation that touches restricted data, and the only place in this domain with real defence in depth for a permission: the declaration is tech.technician.manage AND iam.sensitive.view, and every policy on tech.technician_certification_details requires the second independently. Proved in both directions one permission apart — ROSTER_ADMIN is refused, ROSTER_SENSITIVE is served — and the number is asserted ABSENT from the aggregate read and from iam.audit_record_details, because the audit trail is not gated by iam.sensitive.view and copying it there would defeat the policy protecting the column',
  },
  'tech.technician-availability-record': {
    files: ['tests/backend/br-03-technician-capabilities.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'the rows GET /technicians/available already read and assertEligible already consumes, which until this slice could only arrive by seed or by hand. Overlap is ex_technician_availability_overlap translated rather than predicted, because a read-then-check would still lose to a concurrent insert; two TOUCHING windows are accepted, which is what makes a split shift expressible at all. The kind is required and has no default because available and unavailable mean opposite things to eligibility, and { offset: true } is mandatory because a zoneless instant would be read in the server’s zone and shift the shift',
  },
  'tech.technician-availability-withdraw': {
    files: ['tests/backend/br-03-technician-capabilities.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'stale-version'],
    note: 'required rather than convenient: the EXCLUDE constraint has no notion of “the wrong window”, so without this a mistyped interval would block that technician for its whole span permanently — the test withdraws one and then records a replacement over the same interval to prove it. The window is addressed UNDER a technician, so naming another technician’s window is a 404 rather than a deletion of a row the caller did not name',
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
  'wo.work-order-catalogue': {
    files: ['tests/backend/br-06-work-execution-controls.test.ts'],
    required: ['success', 'denial'],
  },
  'wo.job-blocker-raise': {
    files: ['tests/backend/p1-29-w6-history-and-blockers.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'idempotency'],
    note: 'P1-29 W6 — the blocker record (Owner requirement 13, VHM-16): an append-only raise event under tech.labor.record that moves no state',
  },
  'wo.job-blocker-resolve': {
    files: ['tests/backend/p1-29-w6-history-and-blockers.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'idempotency'],
    note: 'P1-29 W6 — a resolution event referencing the raise; a second resolution is a conflict from the partial unique index, and the raise is never edited',
  },
  'wo.job-blocker-list': {
    files: ['tests/backend/p1-29-w6-history-and-blockers.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'P1-29 W6 — raises folded with their resolution and a DERIVED status, under wo.work_order.read',
  },
  'wo.work-order-timeline': {
    files: ['tests/backend/p1-29-w6-history-and-blockers.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-29 W6 — INT-043: the unified history as a keyset page merged from four modules through their ports; kinds the caller may not see are omitted and named',
  },
  'dia.template-version-item-list': {
    files: ['tests/backend/p1-29-w7-template-version-item-list.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'P1-29 W7 (Backend seam) — the items of one template version in checklist order, on dia.diagnostic.read and not gated by version status; the suite first proves on real responses that neither dia.template-detail nor dia.diagnostic-detail carries them, which is why the read exists',
  },
  'qms.qc-check-list': {
    files: ['tests/backend/p1-29-w8-qc-check-list.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'P1-29 W8 (Backend seam) — the QC check vocabulary the caller tenant resolves, tenant shadowing platform by code as the gate resolves it, both statuses published each row saying which; the suite first proves on the real record detail that only unresolved mandatory checks are ever named, which is why the read exists',
  },
  'dia.diagnostic-type-list': {
    files: ['tests/backend/p1-29-w5-diagnostic-type-list.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'P1-29 W5 — the diagnostic-type vocabulary the caller tenant resolves, tenant shadowing platform by code with the predicate diagnosticTypeByCode has used since P1-19; both statuses published, each row saying which; the empty set is the truthful answer while no vocabulary is seeded',
  },
  'wo.job-list': {
    files: ['tests/backend/br-06-work-execution-controls.test.ts'],
    required: ['success', 'denial', 'isolation'],
  },
  'wo.job-detail': {
    files: ['tests/backend/br-06-work-execution-controls.test.ts'],
    required: ['success', 'denial', 'isolation'],
  },
  'qms.qc-record-branch-list': {
    files: ['tests/backend/br-06-work-execution-controls.test.ts'],
    required: ['success', 'denial'],
  },
  'wo.job-work-log-record': {
    files: ['tests/backend/br-06-work-execution-controls.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
  },
  'wo.job-work-log-list': {
    files: ['tests/backend/br-06-work-execution-controls.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
  },
  'wo.job-evidence-record': {
    files: ['tests/backend/br-07-work-and-diagnostic-evidence.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
  },
  'wo.job-evidence-list': {
    files: ['tests/backend/br-07-work-and-diagnostic-evidence.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
  },
  'wo.work-order-evidence-list': {
    files: ['tests/backend/br-07-work-and-diagnostic-evidence.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
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
  // ========================================================================
  // PRE-P1-29-BR-04 (dia.) — inspection-template authoring. The write layer the
  // three dia template tables never had: they held ZERO rows, no INSERT existed
  // anywhere in apps/api, and POST /jobs/{jobId}/inspections required a
  // templateVersionId nothing could produce. Enforcement is route-layer ONLY —
  // the three tables carry no company_id/branch_id, so a scoped RLS predicate is
  // impossible and the declaration is the whole control. That is exactly why
  // every entry here owes `denial` and `cross-tenant`.
  // ========================================================================
  'dia.template-create': {
    files: ['tests/backend/br-04-template-authoring.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'the first INSERT into dia.inspection_templates that has ever existed. The diagnostic-type check is the one the foreign key cannot make: fk_inspection_templates_diagnostic_type is single-column because a platform row carries tenant_id IS NULL, so all three answers are proved — a PLATFORM row accepted, another tenant’s refused, and an INACTIVE one refused. Creating a template creates NO version, and the list renders that intermediate state. code is 422 on the same regex the CHECK uses, so the caller gets a violation path instead of a 23514',
  },
  'dia.template-list': {
    files: ['tests/backend/br-04-template-authoring.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'keyset-paged because a tenant’s template library is unbounded. The paging test reads two pages and reconciles the union against the whole set, which is what catches a cursor that drops or repeats a row at the boundary — the P1-16 customer-search defect in a new place. Costs dia.diagnostic.read rather than dia.catalogue.manage: reading the library is not administering it, and a service advisor needs the former',
  },
  'dia.template-detail': {
    files: ['tests/backend/br-04-template-authoring.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'versions are NOT paged — a template has few — and each carries itemCount so a caller can tell an empty draft from an authored one without a second read, which is the fact that decides whether publishing will be refused. A template the caller cannot see and one that does not exist are the same 404, so the endpoint is not an existence oracle for another tenant’s library',
  },
  'dia.template-update': {
    files: ['tests/backend/br-04-template-authoring.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'stale-version'],
    note: 'code is absent from the schema and sending one is a 422, because a template code is an identifier tenants build on and changing it after versions exist would silently re-label published history. An empty body is 422 rather than a no-op. The active/inactive status is ORTHOGONAL to the version graph (C-05) and the test proves it: deactivating a template withdraws its published versions from the technician read while the versions themselves stay published and every report against them stays readable',
  },
  'dia.template-version-create': {
    files: ['tests/backend/br-04-template-authoring.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'version_number is SERVER-assigned as max+1; ck_template_versions_number guards the value and says nothing about the sequence, so a client-supplied one is refused by .strict(). copyFromVersionId exists because the item freeze covers INSERT (C-06), so superseding a published version means re-authoring it — and re-typing forty items to change one is what makes people edit in place instead. The copy must name a version of the SAME template or 422, and the test proves the copy is independently editable while the source stays frozen',
  },
  'dia.template-version-status-set': {
    files: ['tests/backend/br-04-template-authoring.test.ts'],
    required: [
      'success',
      'denial',
      'cross-tenant',
      'isolation',
      'audit',
      'stale-version',
      'idempotency',
    ],
    note: 'one command for publish and retire because dia.guard_template_version_publish is one BEFORE UPDATE OF status trigger; two verbs for one guarded transition would let the two drift. toStatus is a CLOSED enum, unlike wo.work-order-transition’s toState whose vocabulary is a live tenant catalogue — getting either backwards is the defect execution-decision.md §5 binding 4 names. published_at is asserted to be the GUARD’s stamp and never the service’s. ERR-TRN-001 and ERR-CON-001 are proved DISTINCT and in the contract’s order: a stale caller is told to re-read first, and only then that the move is impossible. The empty-version refusal is the one rule with no database counterpart, so it is tested directly',
  },
  'dia.template-item-create': {
    files: ['tests/backend/br-04-template-authoring.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'audit', 'idempotency'],
    note: 'draft-only, and the authority is tg_template_items_frozen rather than the service — it is BEFORE INSERT OR UPDATE, so a published version cannot even be APPENDED to. Proved TWICE: the service refuses with a named ERR-TRN-001, and the same write made directly as app_runtime is refused by the trigger with the service out of the path entirely. The direct UPDATE cases set the tenant GUCs first, because without them RLS narrows to nothing and a zero-row no-op would RESOLVE — an assertion that passed while the trigger never ran. unit is required for a numeric item, mirroring ck_template_items_unit so the caller gets body.unit instead of a SQLSTATE',
  },
  'dia.template-version-list-publishable': {
    files: ['tests/backend/br-04-template-authoring.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'the operation that makes the technician’s screen possible: it returns exactly the set POST /jobs/{jobId}/inspections accepts, and without it a technician must be handed a templateVersionId from somewhere — INS-04 in a different costume. Costs dia.diagnostic.record rather than dia.diagnostic.read because its only consumer is the act of opening an inspection. The ONLY branch-scoped operation of the eight, because it is reached THROUGH a job while the library itself carries no branch column; authorized against the job’s own branch exactly as dia.diagnostic-create is',
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
    files: [
      'tests/backend/p1-16-customer-creation.test.ts',
      'tests/backend/p1-30-tenant-bootstrap-reachability.test.ts',
    ],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox', 'rollback'],
    note: 'partner + individual profile + audit + outbox commit in one transaction; an injected failure leaves none of the four (rollback); the created customer is invisible from tenant B (cross-tenant)',
  },
  'crm.company-create': {
    files: ['tests/backend/p1-16-customer-creation.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox'],
    note: 'organization counterpart; proves the party-type discriminator comes from the path, so a company profile can never attach to an individual partner',
  },
  // --- Reads: the nine operations the P1-16 remediation added. -------------
  // Every customer sub-resource was write-only over HTTP and there was no route
  // module for a customer at all, so nothing in the platform could return a
  // customer or anything attached to one (`P1-27-INT-001`). The obligations
  // below are what a read can get wrong invisibly: a tombstone resurrected, a
  // stopped alert still shouting, a `date` shifted by a timezone, and a
  // policy-shortened list presented as complete.
  'crm.customer-read': {
    files: ['tests/backend/p1-16-customer-read.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'the only operation that returns a customer; publishes record_version and an ETag, which is the half of optimistic concurrency the write routes always demanded and nothing ever supplied; a merged customer answers the same 404 as an unknown id, which a plain tenant+id lookup would not (the row is redirected, not deleted)',
  },
  'crm.contact-list': {
    files: ['tests/backend/p1-16-customer-read.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'excludes soft-deleted contact points — a resurrected phone number is a call to the wrong person; keyset page walked across a boundary with no gap and no repeat, and a cursor from another list is refused ERR-PAG-001',
  },
  'crm.address-list': {
    files: ['tests/backend/p1-16-customer-read.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'excludes soft-deleted addresses; publishes line3, which the column carries and the POST cannot set (P1-16-A-01)',
  },
  'crm.preference-list': {
    files: ['tests/backend/p1-16-customer-read.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'publishes record_version per row, which is what a client puts in If-Match on the preferences PUT; before this read no operation published it, so every preference write was an undetectable last-writer-wins race',
  },
  'crm.consent-list': {
    files: ['tests/backend/p1-16-customer-read.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'the whole append-only history, not a collapsed current answer; seq stays a string because it is bigint and is the only field that orders two decisions sharing effective_at to the microsecond',
  },
  'crm.note-list': {
    files: ['tests/backend/p1-16-customer-read.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'reads shared.notes under the same (entity_type, entity_id) discriminator the write policy pins, so a note filed against another entity type never surfaces; sel_notes_tenant hides restricted notes SILENTLY, so the response carries includesRestricted — proven both ways, with and without iam.sensitive.view',
  },
  'crm.alert-list': {
    files: ['tests/backend/p1-16-customer-read.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'both stop conditions, because active and effective_to are independent and reading one shows a caution already turned off; effective_from is read as ::text and asserted under TZ=Asia/Riyadh, so a Date-based implementation fails instead of passing on a UTC agent',
  },
  'crm.tag-list': {
    files: ['tests/backend/p1-16-customer-read.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'joined to the segment for its label; excludes assignments to a soft-deleted segment and assignments whose validity has ended',
  },
  'crm.restriction-list': {
    files: ['tests/backend/p1-16-customer-read.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'requires only crm.customer.read, not the manage permission the POST carries: imposing a refusal to serve and knowing about one are different authorities, and a restriction nobody at the counter can see does not restrict anything',
  },
  // P1-27 read-surface remediation executed by P1-16, the tenth CRM read.
  'crm.customer-vehicle-list': {
    files: ['tests/backend/p1-16-customer-vehicle-list.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'P1-27-INT-012. The Customer→Vehicle direction was write-only: crm.vehicle-link inserted into veh.vehicle_relationships and no read listed a customer’s vehicles (the vehicle-centric veh.vehicle-relationship-list has existed since P1-17). Partner-centric keyset page over the same single source of truth, joined to veh.vehicles under v.deleted_at IS NULL so a tombstoned vehicle yields the bare vehicleId and never a resurrected identity; its ordering key differs from the vehicle-centric list’s so the two lists refuse each other’s cursors (ERR-PAG-001) instead of producing a plausible wrong page; reads reuse crm.customer.read like the nine sibling reads, and the write-only principal proves reads are not implied by writes',
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
  'crm.duplicate-list': {
    files: ['tests/backend/p1-16-17-duplicate-candidate-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'the review queue had no read at all (P1-27-INT-005) — a screen could only see its candidates by POSTing a scan, a privileged write that emits an audit record, so opening the queue wrote to the audit trail. Tenant-wide rather than nested under one of the pair’s two members; both partners joined for display names; no status filter returns dismissed candidates too, because a reviewer auditing past decisions needs them. That listing writes NO audit record is asserted as a DELTA across the call',
  },
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
    files: [
      'tests/backend/iam-access-administration.test.ts',
      'tests/backend/p1-14-idempotency-replay.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox'],
    note: 'issued within/at/beyond authority; audit + event once; rollback leaves nothing',
  },
  'iam.grant-revoke': {
    files: [
      'tests/backend/iam-access-administration.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'stale-version'],
    note: 'revocation immediate effect + stale-version conflict',
  },
  'iam.grant-scope-add': {
    files: [
      'tests/backend/iam-access-administration.test.ts',
      'tests/backend/p1-14-idempotency-replay.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'isolation'],
    note: 'within-authority scope added; foreign-company widening refused',
  },
  'iam.grant-scope-remove': {
    files: [
      'tests/backend/iam-access-administration.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success'],
    note: 'scope removed; DB backstop also proves last-scope removal cannot widen',
  },
  'iam.grant-scope-list': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'lists the scopes of a scoped grant',
  },
  'iam.approval-limit-create': {
    files: [
      'tests/backend/iam-access-administration.test.ts',
      'tests/backend/p1-14-idempotency-replay.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial'],
    note: 'no self-limit; malformed money rejected',
  },
  'iam.approval-limit-end': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'audit', 'stale-version'],
    note: 'window ended; permission-denied; wrong version refused',
  },
  'iam.approval-limit-list': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'listed and tenant-scoped',
  },
  // --- Role / permission administration.
  'iam.role-create': {
    files: [
      'tests/backend/iam-operations.test.ts',
      'tests/backend/p1-14-idempotency-replay.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
      'tests/backend/p1-29-w9-owner-bootstrap.test.ts',
      'tests/backend/p1-30-tenant-bootstrap-reachability.test.ts',
    ],
    required: [],
    note: 'created and found in the list',
  },
  'iam.role-update': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'stale-version'],
    note: 'renamed; permission-denied; tenant-B refused; wrong version refused',
  },
  'iam.role-list': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'listed, tenant-scoped',
  },
  'iam.role-permission-add': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-14-idempotency-replay.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
      'tests/backend/p1-29-w9-owner-bootstrap.test.ts',
      'tests/backend/p1-30-tenant-bootstrap-reachability.test.ts',
    ],
    required: ['success', 'denial', 'audit'],
    note: 'delegable allow added; permission-denied under RLS',
  },
  'iam.role-permission-update': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'audit', 'stale-version'],
    note: 'effect changed; permission-denied; wrong version refused',
  },
  'iam.role-permission-remove': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'audit'],
    note: 'mapping removed; DELETE policy refuses the unprivileged caller',
  },
  'iam.role-permission-list': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'listed',
  },
  'iam.permission-list': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'catalogue listed',
  },
  // --- User administration.
  'iam.user-list': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'cursor paginated, tenant-isolated',
  },
  'iam.user-detail': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'detail; cross-tenant not found',
  },
  'iam.user-update': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'stale-version'],
    note: 'profile updated; permission-denied; tenant-B refused; wrong version refused',
  },
  'iam.user-status-change': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-14-idempotency-replay.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'audit', 'outbox'],
    note: 'lock revokes sessions + audits + one event; permission-denied; self refused',
  },
  'iam.user-session-list': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'listed for a user',
  },
  'iam.user-session-revoke-all': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'audit', 'outbox', 'idempotency'],
    note: 'all revoked + audit + event; unprivileged revokes nothing; second call revokes zero',
  },
  // --- Organization settings.
  'iam.tenant-settings-read': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'read',
  },
  'iam.tenant-settings-update': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'audit', 'stale-version'],
    note: 'updated + audit; permission-denied; wrong version refused',
  },
  'iam.company-settings-read': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'read in scope',
  },
  'iam.company-settings-write': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-14-idempotency-replay.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'audit', 'isolation'],
    note: 'append-only version written + audit; out-of-scope company refused',
  },
  'iam.branch-settings-read': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'read in scope',
  },
  'iam.branch-settings-write': {
    files: [
      'tests/backend/iam-admin-writes.test.ts',
      'tests/backend/p1-14-idempotency-replay.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'audit', 'isolation'],
    note: 'version written + audit; out-of-scope branch invisible and refused',
  },
  // --- Audit viewing.
  'iam.audit-event-list': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'bounded range; privileged read is itself audited',
  },
  'iam.audit-event-detail': {
    files: ['tests/backend/iam-operations.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
    required: [],
    note: 'cross-tenant record not found',
  },
  // --- Invitation / activation (provider-fake harness).
  'iam.invitation-create': {
    files: [
      'tests/backend/iam-auth-provider.test.ts',
      'tests/backend/p1-14-idempotency-replay.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
      'tests/backend/p1-29-w9-owner-bootstrap.test.ts',
    ],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox'],
    note: 'invited account + audit + event; duplicate conflict; unprivileged refused; tenant-bound',
  },
  'iam.invitation-cancel': {
    files: [
      'tests/backend/iam-auth-provider.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'audit', 'outbox'],
    note: 'invited → archived + audit + event; non-invitation refused',
  },
  'iam.invitation-activate': {
    files: [
      'tests/backend/iam-auth-provider.test.ts',
      'tests/backend/p1-14-idempotency-replay.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'audit', 'outbox'],
    note: 'accepted invitation activated + audit + event; unconfirmed refused',
  },
  // --- Authentication (provider-fake harness).
  'iam.auth-login': {
    files: [
      'tests/backend/iam-auth-provider.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
      'tests/backend/p1-29-w9-owner-bootstrap.test.ts',
    ],
    required: ['success', 'denial', 'audit'],
    note: 'token + session + success audit; every failure generic; failure audited',
  },
  'iam.auth-logout': {
    files: [
      'tests/backend/iam-auth-provider.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'audit', 'idempotency'],
    note: 'session revoked + logout audit; double logout is a no-op',
  },
  'iam.auth-session': {
    files: [
      'tests/backend/iam-auth-provider.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
      'tests/backend/p1-29-w9-owner-bootstrap.test.ts',
    ],
    required: ['success'],
    note: 'describeSession resolves identity, scope, permissions',
  },
  'iam.auth-password-reset': {
    files: [
      'tests/backend/iam-auth-provider.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial'],
    note: 'known → delivery; unknown → silent; non-allow-listed redirect refused',
  },
  'iam.auth-password-reset-completion': {
    files: [
      'tests/backend/iam-auth-provider.test.ts',
      'tests/backend/p1-24-iam-route-depth.test.ts',
    ],
    required: ['success', 'denial', 'idempotency'],
    note: 'completes + invalidates prior sessions; replay refused; bounds enforced',
  },
  // --- Reference exemplar.
  'meta.ping': {
    files: ['tests/backend/api-ping.test.ts', 'tests/backend/p1-24-iam-route-depth.test.ts'],
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
  // ---- P1-OD-025 evidence foundation ---------------------------------------
  //
  // Two READ operations minted with `shared.document.read`, the permission that
  // did not exist before this decision: every document read demanded
  // `shared.document.manage`, so looking at evidence required the authority to
  // create it.
  'shared.document-category-list': {
    files: ['tests/backend/p1-15-evidence-foundation.test.ts'],
    required: ['denial'],
    note: 'the governed policy envelope a client must obey, including device_capture_timestamp_required — projected so a client can obey it, and enforced server-side so it cannot choose not to; another tenant’s category is proven invisible, and a caller without the read permission is refused',
  },
  'shared.document-version-read': {
    files: ['tests/backend/p1-15-evidence-foundation.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'the immutable version and its scan lifecycle; the projection is asserted as a KEY SET in both directions because the addition that matters is storage_key — a locator that travels outside RLS — and a field-by-field assertion cannot catch an addition. A tenant-B version and a version that never existed answer identically',
  },
  // ---- P1-23 reporting catalogue -------------------------------------------
  //
  // The first operations ever registered against the `rpt.` namespace, which is
  // why the namespace joined DERIVED_PREFIXES in this phase and not earlier: a
  // prefix with nothing behind it reports a vacuous 0/0 block.
  'rpt.report-catalogue': {
    files: [
      'tests/backend/p1-23-reporting.test.ts',
      'tests/backend/p1-31-report-engine-work-orders.test.ts',
    ],
    required: ['cross-tenant'],
    note: "published definitions only; a draft and an archived report are proven invisible, and another tenant's catalogue is proven unreachable. P1-31 P-11 added the second file and the MERGE it proves: the page carries the code-registered baselines first, marked source platform, then the tenant's own published rows by code, marked source tenant; a tenant row whose code is registered suppresses its baseline and keeps its own scope, export permission and parameter schema, because a configuration row is customization of a report the platform implements and not a precondition for it existing. executable is no longer the literal false but REPORT_DATASETS membership, and the suite asserts both limbs on real rows - true for work_orders_by_status, false for a published tenant row whose code the engine does not implement",
  },
  'rpt.report-read': {
    files: [
      'tests/backend/p1-23-reporting.test.ts',
      'tests/backend/p1-31-report-engine-work-orders.test.ts',
    ],
    required: ['denial', 'cross-tenant'],
    note: "a draft, an archived report, a foreign tenant's report and a code that never existed all answer ERR-RPT-001 identically, so the catalogue cannot be used to enumerate configured report codes; the per-report export permission is projected rather than reinvented. P1-31 P-11: a REGISTERED code with no configuration row now answers the baseline definition rather than ERR-RES-001 - the same customization rule the list applies - and the four indistinguishable refusals above are unchanged because none of those codes is registered; the baseline projects a null exportPermissionCode rather than naming rpt.export, which P-12 has not built",
  },
  'rpt.report-run': {
    files: ['tests/backend/p1-31-report-engine-work-orders.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: "P1-31 prerequisite P-11, engine slice 1 of 4. The first operation in the platform that RUNS a report: P1-23 published executable: false because the frozen rpt schema binds no data source to a report code, and the binding comes from OWR-2026-09-06-A-12 - a report code binds to a CODE-REGISTERED dataset - rather than from a column. TWO permission checks and they are different questions: the route declares rpt.report.read at scope branch, and the service then evaluates the dataset's own read code, wo.work_order.read, against the SAME company and branch through callerHoldsPermission, answering the uniform ERR-IAM-001. The suite proves both sides with two principals that are each other's counterfactual - one holds rpt.report.read alone and is refused, one holds wo.work_order.read alone and is refused - so collapsing the two codes into one turns both cases red in opposite directions. scope branch is not a preference: requiresScopedEvaluation returns false for a tenant-scoped operation whatever target it is given, so a tenant-scoped run would be decided scope-blind and app.branch_ids is the permission-blind union of every grant (P1-18-A-01); the isolation case is a caller granted only in a second branch whose RLS reach still covers the first. The period is HALF-OPEN [from, to) resolved in the BRANCH timezone rather than the server's - listWorkOrders' own openedTo is CLOSED and was deliberately not reused - and the suite proves it on two rows a single second apart in local time, one at 23:30 on the last included day and one at 00:00 on the excluded day. The counts are computed in SQL over the WHOLE selection and never over the page, on the P1-28 round-two rule that a paged read must not answer for a set; states with no rows appear at zero, from the tenant's own state catalogue. The cursor is the work-order list contract, so a foreign cursor is ERR-PAG-001 and not a page of something else. auditClass none, so no audit evidence is declared; it is a GET, so neither idempotency nor stale-version is",
  },
  // ---- P1-31 prerequisite P-11 - the report CONFIGURATION surface -----------
  //
  // Both rpt tables landed in P1-11 with INSERT and UPDATE grants and policies and
  // NOTHING in apps/api/src had ever written either one, while rpt.report.configure
  // sat in the permission catalogue declared by no operation and named by no policy
  // predicate. The two P1-23 reads above filter on published status, so the only
  // rows they could ever return were rows nothing could create: every tenant's
  // report catalogue was empty and permanently so. Every row this suite reads was
  // authored through the published routes, because that is the claim under test.
  //
  // The ENGINE is deliberately absent and is NOT claimed by any of these entries:
  // executable stays the literal false, because the frozen schema binds no data
  // source to a report code and choosing report definitions is an Owner decision.
  'rpt.report-configuration-list': {
    files: ['tests/backend/p1-31-report-configuration-seam.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'P1-31 prerequisite P-11. Paged keyset on rpt.report_configurations:created_at_desc with the cursor minted by cursorTimestamp at MICROSECOND precision (P1-27-INT-006), sorting on a column the response does not carry; the two pages are asserted disjoint, which matters here because a tenant initial report set is authored in one sitting. Ordered on created_at and NOT on report_code, which is what the P1-23 catalogue orders on: that read is a lookup where the code is the only order a caller can predict, and this one is an authoring list a person scrolls. ONE filter is offered, status, and it is OPTIONAL - the unfiltered list shows drafts AND archived rows, or the restore command would be unreachable, which is the trap apt.catalogue-source-channel-status-set records. THE PERMISSION IS THE CONFIGURE CODE ON A READ, which is the substantive access decision of this seam and is the opposite shape from P-9 and P-10: the rows carry drafts and withdrawn definitions that a rpt.report.read holder must not see, and that holder reads published definitions through rpt.report-catalogue. Denial is declared because a caller holding ONLY rpt.report.read is refused with ERR-IAM-001 naming rpt.report.configure, and a caller holding the configure code through a BRANCH-scoped grant is refused too - the table has no company and no branch, so the pre-handler check is scope-blind without the explicit tenant-wide re-check (P1-18-A-01)',
  },
  'rpt.report-configuration-read': {
    files: ['tests/backend/p1-31-report-configuration-seam.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'P1-31 prerequisite P-11. Returns the configuration WITH its whole version history, deliberately UNPAGED on the dia.template-version-item-list precedent: a version exists because a person wrote one, so the set is bounded by authoring rather than by growth, and the history of a definition is read as one thing. Ordered by version_number ASCENDING, which uq_report_configuration_versions_number makes a total order on its own so no tie-break is offered; ascending because a history is read forwards, where the catalogue lateral orders descending because it is picking one row. Absent and out-of-scope answer ONE ERR-RES-001 decided before any authorization decision, so a foreign tenant learns nothing about existence. recordVersion is published in the body AND as the ETag, and the ETag is the CONFIGURATION version while each version row carries its own - the publish command wants the version one, and the suite proves the two are not interchangeable',
  },
  'rpt.report-configuration-create': {
    files: ['tests/backend/p1-31-report-configuration-seam.test.ts'],
    required: ['denial', 'cross-tenant', 'idempotency'],
    note: 'P1-31 prerequisite P-11. Creates a DRAFT and deliberately does not create a version with it, which is where this seam departs from the P-9 and P-10 create-the-whole-thing-in-one-transaction shape: there the child rows are terms the parent is useless without, here an unversioned draft is the normal first step and ReportDefinitionView already publishes versionNumber null for it. The body refuses id, status and ownerUserId - the owner is the SESSION user, because a caller that could set it could author on someone else behalf. exportPermissionCode is REQUIRED because the column is NOT NULL with no default, and a code outside the platform permission catalogue is refused by fk_report_configurations_permission as ERR-VAL-001 naming the field rather than as a bare 23503. A duplicate report code is ERR-CON-001 with rule duplicate_code on the tenant-wide partial unique index. THE AUTHORITY IS TENANT-WIDE and it is measured, not chosen: the table has a tenant_id and NO company_id and NO branch_id, sel_report_configurations_scope is the tenant alone, so there is no scope target and requiresScopedEvaluation returns false whatever the declaration says - the suite proves a BRANCH-scoped holder of rpt.report.configure is refused every operation of the seam while RLS still shows it nothing it should not see. NOTHING WAS MINTED: rpt.report.configure has been a catalogue row since P1-08 and this seam is the first in the repository to declare it',
  },
  'rpt.report-configuration-update': {
    files: ['tests/backend/p1-31-report-configuration-seam.test.ts'],
    required: ['denial', 'stale-version'],
    note: 'P1-31 prerequisite P-11. The name and the scope level, and nothing else. reportCode is absent because tg_report_configurations_immutable freezes it - the database rule, not this surface preference - and exportPermissionCode is absent for a sharper reason: it decides who may EXPORT the report contents, so re-pointing it is a privilege change wearing the clothes of an edit. status is absent because publishing a definition is its own command. Both fields are optional and at least one is required, because a body that changed nothing would still consume a record_version and write an audit record claiming an edit that did not happen; the field the caller omits is written back as it was read, which the suite proves by patching one and asserting the other unmoved. If-Match is REQUIRED and absent is ERR-CON-002; a stale version is ERR-CON-001 with the row asserted unchanged, and the new version is the DATABASE row rather than expectedVersion + 1',
  },
  'rpt.report-configuration-status-set': {
    files: ['tests/backend/p1-31-report-configuration-seam.test.ts'],
    required: ['denial', 'idempotency', 'stale-version'],
    note: 'P1-31 prerequisite P-11. THIS IS THE COMMAND THAT MAKES A DEFINITION VISIBLE AT ALL: rpt.report-catalogue and rpt.report-read both filter on published status and nothing could set it before this seam existed, so every tenant report catalogue was empty whatever had been configured. Bidirectional across all three values of ck_report_configurations_status, on the apt.catalogue-source-channel-status-set precedent: uq_report_configurations_code names deleted_at and says nothing about status, so an archived configuration still holds its report code and an archive-only command would burn that code for the tenant permanently. IT ADDS NO RULE THE SCHEMA DOES NOT CARRY - in particular it does NOT require a published version before a configuration may be published, because nothing in the frozen schema says so and ReportDefinitionView already answers versionNumber null for exactly that state. The catalogue interplay is proved end to end on real rows: a configuration published with a published version appears in GET /reports carrying executable false, a draft one does not, and archiving removes it again',
  },
  'rpt.report-configuration-version-create': {
    files: ['tests/backend/p1-31-report-configuration-seam.test.ts'],
    required: ['denial', 'idempotency'],
    note: 'P1-31 prerequisite P-11. Deliberately NOT version-guarded, on the svc.service-version-create and dia.template-version-create precedent: creating a draft does not mutate the configuration and there is no prior version of the thing being created to guard, so an If-Match would be a token about a row the request does not change. The write still takes FOR UPDATE on the configuration because version_number is unique per configuration and two concurrent creates must not compute the same next number - a lock for the correctness of the insert, not an optimistic guard. The suite proves the numbers are 1 then 2 on real rows. parameterSchema is bounded in SHAPE and undecided in VOCABULARY: a JSON object, at most 64 top-level keys, at most 16 KiB in the UTF-8 encoding of the serialized document, and NOTHING validated about what a key means - what a filter key means is part of the report definition the Owner has not approved, and validating a vocabulary here would be inventing the report. An omitted schema is the empty object the column already defaults to',
  },
  'rpt.report-configuration-version-publish': {
    files: ['tests/backend/p1-31-report-configuration-seam.test.ts'],
    required: ['denial', 'stale-version'],
    note: 'P1-31 prerequisite P-11. The act the catalogue reads: its lateral picks the newest version whose OWN status is published. If-Match is the VERSION counter and not the configuration one - the opposite choice from svc.service-version-publish, whose guard is the parent because the protected function it calls locks the parent first, and there is no protected function here. TWO REFUSALS COME FROM THE DATABASE AND BOTH ARE MAPPED RATHER THAN LEFT AS A BARE SQLSTATE: a SECOND version published while one is live violates uq_report_configuration_versions_published and is reported as version_already_published, and REPUBLISHING the same version is an update of a published row, which rpt.guard_report_version_freeze raises as a check_violation and which is reported as version_immutable. The repository writes published_at = now() explicitly for exactly that reason - letting the trigger stamp the column would make a repeat publication a silent no-op that advanced record_version and told the caller nothing - and the suite proves the refusal on real rows with a CURRENT If-Match, so the freeze guard and not the version guard is what refuses it. Publishing a version does NOT publish its configuration and does NOT make the report runnable: executable stays the literal false',
  },
  // ---- P1-23 document surface ----------------------------------------------
  'shared.document-read': {
    files: ['tests/backend/p1-23-document-retention.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'metadata only; the storage key is proven unprojected because it is a locator that travels outside RLS into every downstream system that touches it',
  },
  'shared.document-retention-evaluate': {
    files: ['tests/backend/p1-23-document-retention.test.ts'],
    required: ['denial', 'cross-tenant', 'audit'],
    note: 'EVALUATION ONLY — no destructive path exists in this phase; the decision-neutral outcomes (class_undefined, retention_indefinite) are proven distinguishable from a refusal, and a legal hold is proven to win over an elapsed retention',
  },
  // ---- P1-23 notification reads ------------------------------------------
  //
  // The obligations below are DECLARED on top of the derived floor, not instead
  // of it: `shared.` derives route/service/success/authorization/isolation, and
  // these add what is specific to a read surface the database cannot guard.
  //
  // `cross-tenant` is the weaker of the two isolation proofs here and is listed
  // because the floor requires it. The stronger one is `same-tenant-recipient`:
  // RLS proves a row belongs to the tenant and says NOTHING about which user
  // inside it may see the row, so an inbox that leaked every message in the
  // tenant would pass every cross-tenant assertion ever written.
  'shared.notification-list': {
    files: ['tests/backend/p1-23-notification-reads.test.ts'],
    required: ['cross-tenant'],
    note: 'recipient-scoped inbox; a same-tenant neighbour message is proven invisible, which the cross-tenant proof alone cannot establish; digest and body columns proven unprojected; page size clamped',
  },
  'shared.notification-read': {
    files: ['tests/backend/p1-23-notification-reads.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: "another user's message answers ERR-NTF-001 identically to a non-existent id, so the endpoint cannot be used to probe which ids are real; the failure carries no identifier because SafeDetails is a closed shape",
  },
  'shared.notification-delivery-list': {
    files: ['tests/backend/p1-23-notification-reads.test.ts'],
    required: ['denial', 'cross-tenant', 'audit'],
    note: 'deliberately wider than the inbox so an operator can inspect a message they did not receive, which is why it takes a different permission and is audited with a DELTA assertion; provider payload proven unprojected while the normalized classification survives; accepted is never reported as delivered',
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
  'svc.service-create': {
    files: ['tests/backend/p1-20-service-catalog.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'the mutation surface the protected contract requires and the phase originally shipped without (P1-20-G-01); service_code is frozen by tg_services_immutable from this moment, so the code chosen here identifies the service for life and a duplicate collides on uq_services_code; a service is created active and lifecycleStatus is not a settable field, because ck_services_archived_at ties archived to an archived_at only svc.guard_service_lifecycle writes; svc.services carries NO company_id or branch_id, so creating one is a tenant-wide act and the handler demands svc.service.manage granted tenant-wide — a declared tenant scope alone degrades to the scope-blind iam.has_permission (P1-18-A-01) and a branch-scoped holder could seed the catalog of every branch; cross-tenant is proved with a tenant-B principal holding svc.service.manage unrestricted, so its refusal is the tenant boundary and not a missing permission',
  },
  'svc.service-update': {
    files: ['tests/backend/p1-20-service-catalog.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'stale-version'],
    note: 'service_code is IMMUTABLE and the body schema is .strict(), so naming it is a 422 rather than a silently discarded field — a permissive schema would let a caller believe the code changed; archived is TERMINAL and the service refuses every write to an archived row, which is strictly stronger than svc.guard_service_lifecycle (that trigger refuses only the transition out of archived, so a rename of an archived service would pass it); reactivation is expressible at the boundary on purpose, so the ERR-TRN-001 refusal is the applications and not an enum error; description distinguishes absent from null because ck_services_desc_not_blank accepts NULL and refuses the empty string; If-Match is required and a stale record_version is ERR-CON-001',
  },
  'svc.service-category-list': {
    files: ['tests/backend/p1-30-a1-service-catalogue-head.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'P1-30 A1 seam S-02, read half. The taxonomy had a projection (findCategory) and no list wrapper, so a picker could not be built and svc.service-create could not be offered a category that exists; status is projected deliberately, because svc.service-create refuses an inactive category and a picker blind to it offers choices the next call rejects; ordering is the QUALIFIED contract svc.service_categories:code_asc on code, the only column that is both unique per tenant and immutable, so a keyset page cannot repeat or skip a row because someone renamed a category mid-listing; no filters are offered and an unknown query parameter is refused (denial); a tenant-B principal sees none of tenant A taxonomy (cross-tenant) — note the falsifiability result recorded in the suite header: neutralising the query-level tenant predicate leaves that case GREEN because sel_service_categories_tenant absorbs it, so this proves isolation HOLDS without proving which layer holds it',
  },
  'svc.service-category-create': {
    files: ['tests/backend/p1-30-a1-service-catalogue-head.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'P1-30 A1 seam S-02, write half — the head of the commercial chain. A0 measured zero INSERT INTO svc.service_categories across apps/api, supabase/seeds and supabase/migrations, so on a tenant created through the product the taxonomy was empty and permanently so and svc.service-create could not be called at all; code is the LOWER-snake internal form and is frozen by tg_service_categories_immutable, so a duplicate collides on uq_service_categories_code and no later edit repairs it; status is not a settable field, because a category created inactive is one nothing may be filed under; the row carries no company_id and no branch_id, so creating one is a tenant-wide act and the handler demands svc.service.manage granted tenant-wide — SVC_CATALOG_SCOPED_A2 holds that permission IN FULL through a branch-scoped grant and is refused on the identical request SVC_CATALOG_MANAGER succeeds on; cross-tenant is proved with a tenant-B principal holding the permission unrestricted whose category never appears in tenant A',
  },
  'svc.service-version-create': {
    files: ['tests/backend/p1-30-a1-service-catalogue-head.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit'],
    note: 'P1-30 A1 seam S-03. svc.service-version-publish needs a draft and nothing could create one — every INSERT INTO svc.service_versions in the tree is a fixture writing through an RLS-bypassing admin pool — so no API-created service was ever sellable and every quotation line was refused; deliberately NOT versionGuarded, because creating a draft does not mutate the service and there is no prior version of the created thing to guard, following dia.template-version-create and shared.template-version-create rather than the single price-list precedent, and the no-If-Match case goes red if that flag is restored; version_no is computed inside the INSERT under FOR UPDATE on the service, so two concurrent creates cannot both claim the same number on uq_service_versions_no; drafts may overlap each other and the live version freely, because ex_service_versions_no_published_overlap is WHERE status = published; an archived service is refused ERR-TRN-001 and a tenant-B service is not visible',
  },
  'svc.price-list-assignment-create': {
    files: ['tests/backend/p1-30-a1-service-catalogue-head.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'isolation'],
    note: 'P1-30 A1 seam S-04, the last link. svc.resolve_price requires an ACTIVE assignment row covering the context and nothing wrote that table, so GET /prices answered no price configured for every input on every API-created tenant; the route is TOP-LEVEL because uq_price_list_assignments_signature keys on (tenant, company, branch, customer_class, priority) and NOT on price_list_id — a nested path would misdescribe the invariant, since a create can be refused by an active row belonging to a price list the caller cannot see, and the test proves that refusal ACROSS two books; the caller-visible signal is the violation context_already_assigned, not a message, because problemFor never sends an AppFailure message over the wire, and the response names no price-list id at all; svc.price.manage and not svc.price.publish, because this is assignment management rather than publication; scope is branch and the selector is authorized before it is stored, while a wildcard — which sets the tenant default book — demands the permission tenant-wide, which is deliberately stronger than svc.price-rule-record and is proved by a branch-scoped holder succeeding within its scope and refused on a wildcard (isolation)',
  },
  'svc.service-version-publish': {
    files: ['tests/backend/p1-20-service-catalog.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox', 'stale-version'],
    note: 'svc.publish_service_version is CALLED, never reimplemented: it locks the service, refuses a version belonging to another service, refuses a non-draft version, refuses an effective_from at or before the currently open published version’s start, and closes that version’s effective_to — so forward-only succession and the ex_service_versions_no_published_overlap gist backstop are the database’s and a second definition cannot drift from them; If-Match guards the SERVICE, which is the row a concurrent editor moves and the row the function locks first; publication emits service.published, whose catalog entry said implementedIn: null for most of the phase on the false premise that the protected contract mandated no public publication',
  },
  'svc.branch-availability-set': {
    files: ['tests/backend/p1-20-service-catalog.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'isolation'],
    note: 'the ONE catalog write with real scope columns — svc.branch_service_availability carries company_id and branch_id, so scope:branch is genuine here and the pair from the body is the concrete authorizeScope target; the isolation case uses a principal holding svc.service.manage IN FULL scoped to branch A2 plus a widening grant that puts A1 in its permission-blind iam.allowed_branch_ids() union, so the A1 row is readable and only the scoped permission check can refuse it (P1-18-A-01); the company/branch pair is also checked for coherence, because iam.has_permission_in_scope is disjunctive across grant rows and a caller pairing their own branch with another company’s id passes on the branch row alone; exactly one live row per (company, branch, service) means this is a state change and the transition survives only in the audit detail’s previousValue',
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

  // ---- Phase 1-21 — inventory ---------------------------------------------
  'inv.item-search': {
    files: ['tests/backend/p1-21-inventory-reads.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'inv.item_master carries NO company_id and NO branch_id, so an item is tenant-wide reference data and the operation is scope:tenant with no branch filter at all — a branch filter here would narrow nothing, and declaring scope:branch would 403 every unfiltered listing because requireScopedPermissions fails closed on an empty target; the keyset order is (sku, id), a total order backed by uq_item_master_sku; archived items are excluded by default because inv.guard_item_lifecycle makes archived terminal; NO cost is returned, because inv.item_cost_details is gated by inv.cost.view inside its own RLS policy; a tenant-B item never appears (cross-tenant); a LIKE metacharacter in the search term is escaped, so a search for % returns the items whose sku literally contains % rather than the whole catalog (denial)',
  },
  // P1-30 corrective slice — the inventory master data a fresh tenant needs
  // before any stock can exist. The F-02 remeasurement at develop 6f6236c3 found
  // inv.item_categories, inv.item_master and inv.stock_locations with RLS, grants
  // and a permission code and NO writer; inv.opening-batch-line-create needs an
  // item and a location, so nothing could ever be counted in.
  'inv.item-category-list': {
    files: ['tests/backend/p1-30-inventory-master-data.test.ts'],
    required: ['cross-tenant'],
    note: 'the picker read: inv.item-search filters by categoryId and inv.item-create requires one, and nothing published them; tenant-wide like the item search beside it, ordered (code, id) under uq_item_categories_code; a tenant-B category never appears (cross-tenant)',
  },
  'inv.item-category-create': {
    files: ['tests/backend/p1-30-inventory-master-data.test.ts'],
    required: ['denial', 'cross-tenant', 'audit', 'idempotency'],
    note: 'inv.item_categories has no company or branch column, so the row is tenant-wide reference data and the write requires inv.item.manage held TENANT-WIDE — a branch-scoped holder of the same code is 403 (P1-18-A-01, the same control svc.service-category-create applies); an unknown or inactive parent is a 422 naming the field; a duplicate code is a 409 (denial); one audit record per create and a same-key replay writes nothing twice (idempotency); tenant B writes land in B (cross-tenant)',
  },
  'inv.uom-list': {
    files: ['tests/backend/p1-30-inventory-master-data.test.ts'],
    required: [],
    note: 'inv.item_master.uom_id is NOT NULL and nothing published the units; returns the twelve platform rows plus the tenant own, active only, under sel_units_of_measure_visible; not paged because it is a closed reference list, exactly as sal.payment-method-list treats its own; parses no input, so — as for that operation — there is no unbacked denial flag to declare',
  },
  'inv.item-create': {
    files: ['tests/backend/p1-30-inventory-master-data.test.ts'],
    required: ['denial', 'cross-tenant', 'audit', 'idempotency'],
    note: 'creates the catalogue row only — NO cost (inv.item_cost_details is the restricted 1:1 cost table and valuation is an Owner decision) and NO stock (the opening batch stays the sole path by which stock appears); category and unit are validated before the insert so the refusal names the field rather than surfacing as 23503; tenant-wide authority like the category; the echo is read back through the same UoM join inv.item-search uses, so a created item reads exactly as a listed one; a duplicate SKU is a 409 (denial)',
  },
  'inv.stock-location-create': {
    files: ['tests/backend/p1-30-inventory-master-data.test.ts'],
    required: ['denial', 'cross-tenant', 'audit', 'idempotency', 'isolation'],
    note: 'a location is BRANCH infrastructure: the body names the company and branch, which are the scope target authorized before the write and re-enforced by ins_stock_locations_scope; a holder scoped to A2 is refused A1 and admitted A2 (isolation); the hierarchy inv.guard_stock_location_hierarchy enforces is stated by the field before the insert — a warehouse takes no parent, storage and quarantine name a warehouse in the SAME branch — so each refusal is a 422 naming parentLocationId rather than a check violation (denial); a duplicate code in the branch is a 409; permission is inv.item.manage because the 118-code catalogue names no location authority and this slice mints none (RES-05), recorded as a residual',
  },
  'inv.stock-availability-read': {
    files: ['tests/backend/p1-21-inventory-reads.test.ts'],
    required: ['denial', 'cross-tenant', 'isolation'],
    note: 'returns exactly the four concepts the schema stores — on_hand, reserved, the GENERATED available, and the location type — and invents no damagedQty or customerSuppliedQty field, because no column holds them; quarantine is excluded by default, which is what keeps available honest, since damage moves units to a quarantine LOCATION rather than setting a flag; branchId and locationId are scope TARGETS authorized before use, so the difference between an empty and a non-empty page cannot probe which branches stock an item (isolation) — a caller holding inv.stock.read only in A2 is refused A1 even though an unrelated A1 grant puts A1 in its permission-blind app.branch_ids union (P1-18-A-01); a locationId whose branch contradicts an explicit branchId is refused rather than silently preferring one (denial)',
  },
  'inv.stock-movement-list': {
    files: ['tests/backend/p1-21-inventory-reads.test.ts'],
    required: ['denial', 'cross-tenant', 'audit'],
    note: 'read-only by construction: inv.stock_movements grants SELECT + INSERT only, so there is no update or delete route to write and a correction is a new movement; ordered by seq DESC because seq is GENERATED ALWAYS AS IDENTITY and occurred_at is NOT a total order — damage posts two rows in one transaction sharing now() to the microsecond, so a timestamp cursor would skip or repeat across a page boundary; the workOrderId filter resolves THROUGH the reference because the ledger has no work_order_id column, joining part_issues for an issue and part_returns to its issue for a return; reading is audited (audit) because the ledger is the complete record of what a branch holds and an unlogged bulk read is reconnaissance, and the audit row names the filter and the row COUNT, never the rows themselves',
  },
  'inv.inventory-reconciliation-read': {
    files: ['tests/backend/p1-21-inventory-reads.test.ts'],
    required: ['denial', 'cross-tenant', 'audit'],
    note: 're-derives every stored balance from the ledger rather than trusting the cache being audited, so a coherent=false row would mean inv.guard_stock_balance_coherence had been bypassed — a security finding, not routine drift, which is why the result is reported and never silently repaired; checkedAt comes from the DATABASE clock, not the process clock, because the reconciliation is a statement about a transaction snapshot and a host with a skewed clock must not be able to misdate the evidence; uses the existing iam.audit_records append path and creates no second audit subsystem; a caller without inv.audit.read is refused even when it holds inv.stock.read, so the reconciliation is not reachable by the ordinary stock reader',
  },
  'inv.opening-batch-create': {
    files: ['tests/backend/p1-21-inventory-intake.test.ts'],
    required: ['success', 'denial', 'audit', 'isolation'],
    note: 'creates a DRAFT and no parameter offers anything else, so this operation cannot create a balance — it creates a counted intention that a second person must approve; that shape is why the API has no set-stock-level endpoint at all: app_runtime does hold UPDATE on inv.stock_balances, but inv.guard_stock_balance_coherence requires on_hand to equal the movement sum, so stock without a movement behind it is unrepresentable; companyId and branchId are in the body and are the authorizationTarget, so scope:branch is real rather than inert (isolation, P1-18-A-01)',
  },
  'inv.opening-batch-line-create': {
    files: ['tests/backend/p1-21-inventory-intake.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'the line location is checked against the BATCH branch, because inv.approve_opening_batch posts each movement from the LINE location and not the batch — so a batch opened for B1 carrying a line in B2 would mint stock in B2 while only B1 was ever authorized, and the batch scope check alone cannot catch it; a quarantine destination is refused, because an opening count is a statement about sellable stock and counting straight into quarantine would create damaged stock that was never damaged; an approved batch is frozen and refuses a new line with a stated reason rather than letting inv.guard_opening_batch_approval raise (denial); the path names a batch and not a branch, so the service loads the batch company/branch and re-authorizes inside the transaction (isolation)',
  },
  'inv.opening-batch-list': {
    files: ['tests/backend/p1-30-opening-batch-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-30 seam S-17, class C, and the read that makes the maker-checker rule usable through the product. The opening batch was write-only on the wire — three POSTs and no GET — so a count survived only as state in the tab that created it and the SECOND PERSON, the one ck_opening_inventory_batches_maker requires, had no path to a draft at all; the rule was satisfiable only by swapping sessions inside one un-reloaded tab, which is a harness. companyId and branchId are REQUIRED and are the authorizationTarget, the inv.stock-location-list precedent, and the service re-authorizes the same pair so the check does not rest on the route option alone. cross-tenant is DECLARED rather than derived: the path carries no caller-supplied identifier, so the derivation does not add it, and a tenant-B batch never appearing is exactly the proof a list of what a branch is counting owes. auditClass none, matching the location and reservation lists beside it: a list of draft counts is not the ledger, and this slice mints no read-audit action. Keyset on inv.opening_inventory_batches:created_at_desc with a microsecond cursor, because as_of_date is the date the count DESCRIBES and two batches may share it while approved_at is NULL for every draft — the set the approver is actually looking for. lineCount is counted in SQL, not by paging the lines, so an approver decision cannot depend on a page size. Falsifiability measured: neutralising the company/branch predicate is RED on the case asserting a BRANCH_A2 batch never appears for INV_FULL, which is unrestricted — allowed_branch_ids is NULL, RLS admits every tenant-A row, and the SQL predicate is the only narrowing, so the suite has to carry that proof itself',
  },
  'inv.opening-batch-read': {
    files: ['tests/backend/p1-30-opening-batch-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-30 seam S-17, class C. Reading what you are about to approve: approval is the only operation in the platform that creates stock from nothing, and until this route the approver could not see the counted lines at all. The path names a BATCH and not a branch, so the in-service authorizeScope on the row own company and branch is the ONLY scoped guard — the route has no target for the pre-handler check and the declared scope:branch would otherwise be inert while app.branch_ids, the permission-blind union of every active grant, did the whole narrowing (P1-18-A-01). NOT-FOUND IS DECIDED FIRST: the header lookup carries no scope predicate, so an unknown id, a soft-deleted batch and another tenant batch all answer 404 ERR-RES-001 before any scope decision, because a 403 on an id the caller may not see would confirm the id names a real batch somewhere. Lines are read only AFTER the scope decision, so an unauthorized caller never causes a line query. Quantities cross as decimal STRINGS from numeric(12,3), and the lines are unpaged and bounded by uq_opening_inventory_lines_cell — one live line per item and location — so a count is never split across pages. cross-tenant and isolation both derive from the batchId in the path; declared here as well so the reader sees what the suite owes. Falsifiability measured: deleting the authorizeScope call is RED on the case where a caller holding inv.stock.read only in BRANCH_A2 reads a BRANCH_A1 batch',
  },
  'inv.opening-batch-approve': {
    files: ['tests/backend/p1-21-inventory-intake.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'isolation'],
    note: 'the ONLY operation that creates stock from nothing, so it takes inv.adjustment.approve and not inv.stock.operate — counting and approving a count are separate authorities, and ck_opening_inventory_batches_maker_checker enforces approver <> counter in the database so the rule cannot depend on which endpoint someone called; each posted movement is bound by inv.guard_stock_movement_provenance to its own line quantity, item and location, so the movements cannot say anything the count did not; an EMPTY batch is refused, because approving nothing records an approval attesting to no count and that is worse than an error since it looks like evidence; a second approval is refused because the batch is no longer draft',
  },
  'inv.stock-reservation-create': {
    files: ['tests/backend/p1-21-inventory-stock.test.ts'],
    required: ['success', 'denial', 'audit', 'outbox', 'idempotency', 'isolation'],
    note: 'the last-unit race is resolved in the DATABASE and not here: inv.reserve_stock takes the balance-row FOR UPDATE lock, expires stale rows for the cell, and re-reads on_hand and the active-reservation sum INSIDE the lock, so two concurrent requests for the same final unit leave exactly one winner and one 23514 — checking availability in application code first would add a read-then-write race and change nothing; the replay is detected BEFORE the call by looking the idempotency key up, because inv.reserve_stock resolves it inside the lock and returns the existing id, which from outside is indistinguishable from a fresh booking, so a retrying client could not otherwise tell whether it reserved twice (idempotency); a key reused for a DIFFERENT quantity, item or location is a conflict and not a silent success under someone else booking; the location is the scope anchor and its company/branch are the authorizationTarget (isolation)',
  },
  'inv.stock-reservation-release': {
    files: ['tests/backend/p1-21-inventory-stock.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox', 'isolation'],
    note: 'a subresource and not a colon-action, because the registry PATH_PATTERN accepts only lower-case literals and {camelCase} parameters; inv.release_reservation is a no-op on an already terminal reservation — inv.guard_stock_reservation_status makes every non-active status terminal — so a duplicate release is idempotent rather than an error, and the audit row and outbox event are written ONLY when the call actually changed state, because recording a change that did not happen would make the trail lie and would let a retry loop inflate the outbox; releasing a CONSUMED reservation does not return issued units to available, since those left through an out movement and can only come back through a return; the path names a reservation and not a branch, so the reservation own company/branch are the deferred authorizationTarget (isolation, P1-18-A-01)',
  },
  'inv.stock-issue-create': {
    files: ['tests/backend/p1-21-inventory-stock.test.ts'],
    required: ['success', 'denial', 'audit', 'outbox', 'idempotency', 'isolation'],
    note: 'closes three defects in inv.issue_part, each reproduced against a live database: D-01 the function posts the out movement BEFORE consuming the reservation, so on_hand falls while reserved is still held and ck_stock_balances_available rejects the write whenever the reservation covers the stock being issued — the natural reserve-exactly-then-issue flow FAILS inside the protected function, and the fix is ordering rather than privilege, inserting part_issues then consuming then posting; D-02 the function selects wo.work_orders.state and never reads the variable, so a draft work order accepts an issue, and the service instead locks the work order and reads the data-driven wo.work_order_states flags so a concurrent transition cannot race the check; D-03 the function consumes whatever reservation id it is handed including one belonging to a different ITEM, releasing reserved quantity on an unrelated cell, and the service refuses a reservation that does not match this item, location and work order and refuses an issue larger than the reservation holds, since inv.consume_reservation releases it in full whatever the issued quantity',
  },
  'inv.stock-return-create': {
    files: ['tests/backend/p1-21-inventory-stock.test.ts'],
    required: ['success', 'denial', 'audit', 'idempotency', 'isolation'],
    note: 'addressed by the ISSUE it reverses, which makes returning another work order issue unrepresentable rather than merely refused: there is no parameter in which to name a different work order, item or location, because all three are read off the issue, so stock cannot be moved sideways under cover of a return; the over-return ceiling is enforced three times — the service pre-checks for a readable message, inv.return_part re-checks under a row lock on the parent issue so two concurrent returns cannot each see room for the last unit, and inv.guard_part_return_ceiling checks again on the part_returns insert itself, which is what closes the phantom-stock path a raw insert bypassing the function would open; the ordering problem of D-01 does not arise because a return is an in movement, so on_hand rises and the available invariant cannot dip',
  },
  'inv.damaged-stock-create': {
    files: ['tests/backend/p1-21-inventory-stock.test.ts'],
    required: ['success', 'denial', 'audit', 'idempotency', 'isolation'],
    note: 'damaged units leave sellable availability STRUCTURALLY, by a paired out/in movement into a quarantine location, rather than by a flag a later query might forget to filter on — and the two legs are distinguishable to uq_stock_movements_source only by direction, which is why damage is the one reference kind that legitimately posts two ledger rows; ck_damaged_stock_locations requires only that the two locations DIFFER, which is not enough, so the service additionally requires location_type = quarantine and refuses damaging stock already in quarantine — otherwise a damaged unit could be moved to another sellable location and stay available, the exact availability inflation this task must prevent; inv.record_damage calls inv.free_reservations_for_loss first so reducing on_hand cannot breach ck_stock_balances_available, and the reservations that lose out are recorded as stock_loss rather than silently vanishing; both locations must be in one branch, since no transfer primitive exists to move stock across one',
  },
  'inv.customer-supplied-part-create': {
    files: ['tests/backend/p1-21-inventory-intake.test.ts'],
    required: ['success', 'denial', 'audit', 'idempotency', 'isolation'],
    note: 'posts NO movement and touches NO balance, and that is structural rather than conventional: the table is documented as custody-tracked never valued stock, ck_customer_supplied_parts_owned CHECK (customer_owned) makes company ownership unrepresentable, inv.item_master own comment states customer-supplied parts are not item_master rows, and there is no customer_supplied value in ck_stock_movements_reference_kind so a movement citing one could not be inserted even by mistake; the test asserts the balance and the ledger are UNCHANGED across the call rather than merely asserting a 201, because the failure being guarded against is a customer alternator appearing in company on-hand; affectsStock:false and customerOwned:true are in the response so a client never has to infer non-ownership from the absence of a movement id; takes inv.custody.manage and not inv.stock.operate, whose stated meaning is post/reserve/issue/return — none of which this does',
  },
  'inv.external-purchase-part-create': {
    files: ['tests/backend/p1-21-inventory-intake.test.ts'],
    required: ['success', 'denial', 'audit', 'idempotency', 'isolation'],
    note: 'a reference and not procurement: ck_external_purchase_parts_not_procurement CHECK (is_procurement = false) is the schema refusing to become a PO/goods-receipt workflow, so this creates no purchase order, runs no approval chain and adds no stock — a part that physically arrives becomes company stock only through an opening batch or an adjustment, both of which need inv.adjustment.approve and a second person, because letting a purchase record raise on_hand directly would be an unapproved path to minting stock; the test asserts the ledger and balances are unchanged; unitCost is written to inv.external_purchase_part_details whose every RLS policy is gated by iam.has_permission(inv.cost.view), so a caller without it gets a refusal rather than a silently dropped cost, and the amount is NEVER echoed back — costRecorded is a boolean; ck_external_purchase_parts_supplier requires a partner or a name and the absence of both is a field-level refusal rather than a constraint name (denial)',
  },

  // ========================================================================
  // Phase 1-22 (sal. / wty.) — Billing, Payment, Delivery and Warranty.
  //
  // The derived floor already supplies route, service, success, authorization,
  // plus cross-tenant for a `{param}` path, isolation for branch scope, audit
  // for a non-`none` class, idempotency for `idempotent: true` and
  // stale-version for `versionGuarded: true`. So `required` below adds only
  // what the REGISTRATION cannot know:
  //
  //   `outbox`       — the eight operations that publish an event. The
  //                    registration says nothing about the outbox, so without
  //                    this the one row per commit is unproven.
  //   `denial`       — a validation or state refusal. Every mutation here has
  //                    one that matters, and several reads do too.
  //   `cross-tenant` — added by hand for the four operations with NO path
  //                    parameter, because the derived rule keys on `{param}`
  //                    and these carry the foreign identifier in the BODY
  //                    instead. `POST /invoices` naming another tenant's work
  //                    order is exactly the same risk as `GET /invoices/{id}`
  //                    naming another tenant's invoice; the derived rule simply
  //                    cannot see it. `sal.payment-method-list` is the one
  //                    genuine exception — it takes no resource identifier at
  //                    all, so there is no foreign row to reach for.
  // ========================================================================
  'sal.invoice-preview': {
    files: [
      'tests/backend/p1-22-invoice-lifecycle.test.ts',
      'tests/backend/p1-22-isolation.test.ts',
    ],
    required: ['denial'],
    note: 'read-only and writes nothing, so it is safe to call repeatedly while a price is negotiated — which is why it exists separately from create; every amount is computed by PostgreSQL in numeric with round(...,4), the same shape ck_invoice_amounts_gross enforces and sal.issue_invoice later applies, so the preview cannot disagree with the invoice it previews; requires sal.finance.view because the preview IS money and a caller who may not see an invoice’s amounts must not obtain them from a preview instead; tax is the rate the quotation captured and this phase invents nothing, but that is NOT a guarantee the rate is non-zero: org.tax_classes has zero rows and no writer, so price_rules.tax_class_id is unsettable and the resolver’s zero branch is the only reachable one — every invoice this API can produce is untaxed today, recorded as P1-22-L-08 rather than asserted away (denial)',
  },
  'sal.invoice-create': {
    files: [
      'tests/backend/p1-22-invoice-lifecycle.test.ts',
      'tests/backend/p1-22-isolation.test.ts',
    ],
    required: ['outbox', 'denial', 'cross-tenant'],
    note: 'client totals are not ignored, they are UNEXPRESSIBLE: the body has no amount, total, tax, lines or unitPrice and .strict() makes a body carrying one a refusal rather than a silent drop, so no code path can trust a client total because no field delivers one; born draft because sal.guard_invoice_freeze raises check_violation on any INSERT whose status is not draft, closing the bypass of the numbering allocator and the completeness event; uq_invoices_work_order_active permits at most ONE live invoice per work order so staged billing is structurally impossible and a second attempt is 23505 surfaced as a conflict (denial); requires sal.finance.view because the two amount tables are gated by it on INSERT as well as SELECT, so declaring only sal.invoice.manage would advertise an operation RLS always refuses; cross-tenant is declared by hand because the work order arrives in the body rather than the path',
  },
  'sal.invoice-issue': {
    files: [
      'tests/backend/p1-22-invoice-lifecycle.test.ts',
      'tests/backend/p1-22-concurrency.test.ts',
    ],
    required: ['outbox', 'denial'],
    note: 'EXACTLY ONE NUMBER, and the primitive is what guarantees it: sal.issue_invoice takes the row FOR UPDATE and returns the EXISTING invoice_number when the status is already issued, so a replay cannot mint a second number and two concurrent issues serialise on that lock — the concurrency suite asserts one allocation and one returned copy, not two numbers; an unprovisioned tenant is refused with a controlled configuration error naming the missing (company, branch, sequence_code) because shared.next_display_number raises P0002 and app_runtime holds NO INSERT grant and NO INSERT policy on shared.number_sequences, so the backend CANNOT self-heal and must not invent a fallback, a timestamp or a UUID (denial); a failed issue consumes no number, proved directly in tests/db/p1-22-protected-residuals.test.ts; the number is opaque text and is never constructed, parsed, regex-validated or sorted by',
  },
  'sal.invoice-detail': {
    files: [
      'tests/backend/p1-22-invoice-lifecycle.test.ts',
      'tests/backend/p1-22-isolation.test.ts',
    ],
    required: ['denial'],
    note: 'the ONE operation in this phase that deliberately does not require sal.finance.view: sal.invoices is scope-gated only while the money lives in two separately gated tables, so a caller without the finance permission must receive a header WITHOUT money rather than a 403 — returning 403 would deny a fact the schema leaves visible; built on a LEFT JOIN so RLS invisibility yields NULL rather than zero rows, and the money sub-object is OMITTED not zeroed, because a total of 0 would be a lie about the invoice where an absent key is the truth about the caller; the test drives it with a principal holding every sal code EXCEPT sal.finance.view and asserts the header is present and totals is null, which is the assertion that would fail if the join were an INNER one',
  },
  'sal.invoice-outstanding-read': {
    files: [
      'tests/backend/p1-22-invoice-lifecycle.test.ts',
      'tests/backend/p1-22-isolation.test.ts',
    ],
    required: ['denial'],
    note: 'server-derived BY CONSTRUCTION rather than by discipline: nothing stores a balance anywhere in sal, and sal.invoice_open_receivable recomputes round(gross − allocations − approved_credits, 4) on every call excluding reversed receipts (H-fin-1), so there is no column a client could write and no cached value that could drift; a separate operation rather than a field on the invoice because the header is readable without sal.finance.view and the balance is not — folding them would either deny the header or make the response shape change silently with the caller’s permissions; the currency is ALWAYS returned beside the amount, because the protected function returns a bare numeric with no currency predicate at all and only the invoice’s own currency_code labels it',
  },
  'sal.invoice-cancel': {
    files: ['tests/backend/p1-22-invoice-lifecycle.test.ts'],
    required: ['outbox', 'denial'],
    note: 'draft only, and the vocabulary itself refuses the alternative: the status is named void_before_issue, sal.guard_invoice_freeze permits draft → void_before_issue and nothing else reaches it, and ck_invoices_number_iff_issued makes it structural that a voided invoice carries a NULL number — so there is no state in which a voided invoice holds a number a customer has seen (denial asserts an ISSUED invoice is refused); a reason is required and lands in sal.invoice_status_history.reason, whose actor and timestamp are server-stamped by shared.stamp_status_history and are therefore not client inputs; idempotent on the terminal state and the test asserts a replay writes NO second history row and NO second audit record, which is the part a naive re-run of the transition would get wrong',
  },
  'sal.credit-note-create': {
    files: [
      'tests/backend/p1-22-credit-note.test.ts',
      'tests/backend/p1-22-currency-coherence.test.ts',
    ],
    required: ['denial'],
    note: 'the original invoice is never rewritten: a credit is a separate POSITIVE-amount row because there is no signed amount anywhere in sal, and the issued invoice’s own amounts stay frozen by sal.guard_invoice_amount_frozen; born pending via sal.stamp_dual_control_maker, which forces requested_by from iam.current_user_id() and NULLs the approval fields so a request cannot arrive pre-approved — nothing is credited here, which is why this operation publishes NO event and credit-note.issued fires on approval instead; CURRENCY IS READ FROM THE PARENT INVOICE and a supplied mismatch is refused, and that check is the ONLY defence in the entire system: five triggers fire on sal.credit_notes and not one reads sal.invoices.currency_code, sal.approve_credit_note compares amount and never currency, and sal.invoice_open_receivable has no currency predicate — tests/db/p1-22-protected-residuals.test.ts approves a JOD credit note against a USD invoice and shows 100.0000 become 60.0000 (P1-22-L-02, change-control candidate CC-1)',
  },
  'sal.credit-note-approve': {
    files: ['tests/backend/p1-22-credit-note.test.ts'],
    required: ['outbox', 'denial'],
    note: 'a SECOND operation rather than a flag, because sal.guard_dual_control_approval raises check_violation when approved_by = requested_by and BOTH are stamped from iam.current_user_id() — the maker on INSERT, the approver on UPDATE — so the two acts must come from two sessions belonging to two different users and no single endpoint could satisfy that however it were shaped; audit class is approval rather than financial because the fact recorded is a second person’s decision; the test drives it with a distinct approver principal and asserts the same-user attempt is refused with a caller-safe message rather than a constraint name (denial); idempotent because the primitive returns silently on an already-approved note, and uq_financial_events_source would refuse a second event with 23505 in any case — a free backstop',
  },
  'sal.payment-record': {
    files: [
      'tests/backend/p1-22-payments.test.ts',
      'tests/backend/p1-22-isolation.test.ts',
      'tests/backend/p1-30-tenant-bootstrap-reachability.test.ts',
    ],
    required: ['outbox', 'denial', 'cross-tenant'],
    note: 'records that money was received and structurally CANNOT claim a settlement: ck_payment_methods_kind admits exactly cash, card_terminal and bank_transfer with the schema comment "No online payment gateway/settlement types (ASM-14, CON-04)", so there is no column in which an authorisation or a card could be stored and the body has no such field; receivedBy is absent by construction because sal.record_receipt stamps the cashier and the tenant from the session, so offering either as an input would be offering a lie; the denial cases include a PLATFORM payment method, which is visible to every tenant via sel_payment_methods_scope and citable by NO receipt — fk_receipts_method resolves (tenant_id, payment_method_id) and a platform row’s tenant_id is NULL, so it raises 23503 about a method the caller can see in the list; a fifth decimal place is refused at the boundary because exceeding scale is NOT an error, PostgreSQL silently rounds it away',
  },
  'sal.payment-allocate': {
    files: ['tests/backend/p1-22-payments.test.ts', 'tests/backend/p1-22-concurrency.test.ts'],
    required: ['outbox', 'denial'],
    note: 'THE ONE INVARIANT THE DATABASE DOES NOT DEFEND: Σ allocations ≤ receipt.amount and ≤ invoice.open are enforced ONLY inside sal.allocate_receipt — no constraint, trigger or exclusion bounds the sum, and app_runtime holds raw INSERT on sal.payment_allocations, which tests/db/p1-22-protected-residuals.test.ts reproduces by driving both derivations to −400.0000 with one raw insert of 500 against a receipt of 100; so the service calls the primitive, the repository contains no INSERT path, and a test asserts that absence textually (change-control candidate CC-4, because a future module with the same grant could still bypass it); currency is REQUIRED even though the server knows it, because the primitive compares receipt against invoice and never sees what the caller believed — without it a client allocating what it thinks are USD against a JOD receipt succeeds in a currency it did not intend; allocations are append-only with no UPDATE or DELETE grant and no reversal record, so a misallocated line is correctable only by reversing the whole receipt, which this phase does not expose',
  },
  'sal.receipt-detail': {
    files: ['tests/backend/p1-22-payments.test.ts', 'tests/backend/p1-22-isolation.test.ts'],
    required: ['denial'],
    note: 'requires sal.finance.view where the invoice detail does not, and the asymmetry is the schema’s: sal.receipts is gated WHOLE-ROW by it on SELECT, so a caller without it sees zero receipts rather than redacted ones and there is no honest "receipt without amounts" projection to build — declaring the permission is the truthful contract, because the alternative is an endpoint that returns 404 for a receipt that exists; the receipt reference is stable and is not a second identity: receipt_number is allocated once by sal.record_receipt and frozen by sal.guard_receipt_freeze, which is unconditional on every UPDATE and covers the number as well as the money, so the test asserts the SAME number after a replay of the recording command',
  },
  'sal.payment-method-list': {
    files: [
      'tests/backend/p1-22-payments.test.ts',
      'tests/backend/p1-30-tenant-bootstrap-reachability.test.ts',
    ],
    required: [],
    note: 'exists because sal.record_receipt takes a payment_method_id and without a way to discover one payment recording is unreachable — the difference between a usable API and a decorative one; scope is tenant and that is FORCED by the table, which has no company_id and no branch_id column at all, so declaring branch would be a claim the schema cannot support and authorizeScope would have nothing coherent to check; the projection reports `recordable` per row, because the three seeded PLATFORM methods are visible to every tenant via sel_payment_methods_scope and citable by NO receipt — fk_receipts_method resolves (tenant_id, payment_method_id) and a platform row’s tenant_id is NULL — so leaving a caller to discover that FK by receiving a 23503 about a method it can see in the list would be the trap this list exists to remove. THE `required` LIST IS EMPTY, AND THAT IS DELIBERATE: this is the only P1-22 operation that parses NO input at all — no path parameter, no query schema, no body — so it has nothing to validate and no state to refuse, and neither `denial` nor `cross-tenant` can be backed by an assertion that is not a fiction. `denial` was in this entry and was REMOVED after the suite author refused to declare an unbacked flag and said so; the same argument this note already made for `cross-tenant` applies to it verbatim, and the obligation had been copy-pasted across the P1-22 block. The derived floor still requires route, service, success and authorization, so this is not an unguarded row — it is a row whose extra obligations were imaginary',
  },
  'sal.work-order-delivery-read': {
    files: ['tests/backend/p1-31-delivery-read-seam.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-31 prerequisite P-2, THE RECOVERY SEAM. DeliveryRepository.findLiveDeliveryForWorkOrder existed since P1-22 with no route: its only caller was the duplicate-create refusal in DeliveryService, which answers ERR-RES-002 naming the WORK ORDER and never the delivery, so the delivery id was unrecoverable once the create response was gone and with it the record, the eligibility, the receiver, the checklist and the signatures — six of P1-31 sixteen scope items failed on that one absence (P1-27-INT-084). This publishes the existing read and adds no query and no second mapper, on the sal.work-order-invoice-read precedent from P1-30 A2. Singleton by uq_delivery_records_work_order_active (status <> exception AND deleted_at IS NULL), so no pagination and no ordering contract; a delivery marked exception reports null because the index permits a new one. Absence is 200 with delivery null and NOT 404 — collapsing them would tell a caller no delivery for a work order in a branch they cannot see. Permission is sal.delivery.view, the code the eligibility read already declares and the only delivery READ code the catalogue seeds — NOT sal.delivery.read, which navigation.ts names and the catalogue does not define (RES-05). The proof is a recovery: the delivery is arranged through the real write routes, the authenticator is RESET, and the id is then recovered from the work order alone. Isolation in TWO layers: SAL_SCOPED_A2 gets 404 because RLS hides the parent work order, and SAL_PERMISSION_ELSEWHERE, whose permission-blind app.branch_ids union makes it visible, gets 403 from authorizeScope on the scope read FROM the work-order row (P1-18-A-01)',
  },
  'sal.delivery-read': {
    files: ['tests/backend/p1-31-delivery-read-seam.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-31 prerequisite P-3. Before it the only GET anywhere under /deliveries was eligibility, which answers with BLOCKERS and returns no field of the record — so the work order, vehicle, reception visit, delivering employee, delivered-at and final odometer reading reference were written and never readable (P1-27-INT-084, three of four limbs). Publishes DeliveryRepository.findDelivery through the existing requireDelivery: no new query, no second mapper. NOT-FOUND IS DECIDED FIRST — findDelivery returns null for absent and out-of-scope alike and requireDelivery turns both into one ERR-RES-001 before authorizeScope runs against the row own company and branch, so a foreign tenant learns nothing about existence. recordVersion is published in the body AND as the ETag, because sal.delivery-complete is versionGuarded and parseIfMatch accepts only an exact positive integer with no wildcard while every status advance bumps the counter; this read is now the cheapest current version, where the eligibility read composes eight facts across four modules to publish the same integer. No money crosses: a delivery record has no amount column and finalOdometerReadingId is a veh.odometer_readings REFERENCE rather than a value, asserted by walking the whole document for a number under any money-shaped key',
  },
  'sal.delivery-receiver-read': {
    files: ['tests/backend/p1-31-delivery-read-seam.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-31 prerequisite P-4. findReceiver existed and its only caller was the eligibility composition, which COLLAPSES the row into the boolean receiver_not_verified blocker — so a screen could learn whether a receiver was verified and never who, while the P1-11 frontend data contract asserts a delivery-gated view of receiver identity evidence that no published operation provided. Publishes the existing read unchanged. Absence is 200 with receiver null, the normal state of a fresh delivery; a 404 would make it indistinguishable from a scope refusal, and the DELIVERY visibility is already the not-found decision. deleted_at is deliberately NOT filtered, transcribed from sal.complete_delivery own receiver gate which has none either and from uq_authorized_receivers_delivery being a non-partial UNIQUE — filtering would report no receiver for a delivery the primitive would happily complete. identityEvidenceDocumentVersionId is a REFERENCE and no identity document content is read, stored, logged or returned; the whole row is gated by sal.delivery.view in sel_authorized_receivers_gated, which is the code this operation declares, so the application gate and the row gate are the same code',
  },
  'sal.delivery-checklist-result-list': {
    files: ['tests/backend/p1-31-delivery-read-seam.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-31 prerequisite P-4. NOT a pure publication and the route docblock says so: findChecklistResult is addressed by (delivery, templateItemId) and exists to answer was this ONE item already recorded for the write path, so publishing it as it stands would hand a screen a read it cannot address — the checklist TEMPLATE has no HTTP surface at all (PPD-12, prerequisite P-9) so no caller can discover a template_item_id. The set read is the smallest read that makes recorded results reachable and it reuses toChecklistResult, widened by two joined template columns rather than given a second mapper. itemCode is already on the POST response so publishing it is contract PARITY, and label is already published on the eligibility gap rows; without them a result is an opaque pair of uuids. The join is INNER and total by fk_delivery_checklist_results_item ON DELETE RESTRICT, and carries no ti.deleted_at predicate because a result recorded against a later soft-deleted item is still a recorded fact. deleted_at IS filtered on the RESULT, unlike findChecklistResult which must see a soft-deleted row because the unique index is non-partial. THIS DOES NOT CLOSE P1-27-INT-088: the gap side stays mandatory-only, capped at 20, with missingCount dropped, and the gap scan stays company-scoped. Keyset on sal.delivery_checklist_results:created_at_desc with the cursor minted by cursorTimestamp at MICROSECOND precision (P1-27-INT-006), sorting on a column the response does not carry',
  },
  'sal.delivery-signature-list': {
    files: ['tests/backend/p1-31-delivery-read-seam.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-31 prerequisite P-4. NOT a pure publication and the route docblock says so: findSignature is a REPLAY PROBE addressed by the exact (delivery, signerRole, signatureDocumentVersionId) triple, so a caller must already hold the document-version id to use it — the unrecoverable-identifier problem restated, not a read of the signatures — and hasSignature is a boolean the eligibility read publishes only as signature_missing. The set read is new and reuses toDeliverySignature, so there is no second mapper. PAGED because the set has no ceiling: there is deliberately no unique constraint on (delivery_record_id, signer_role) and the table comment records that corrections are made by APPENDING, so an unbounded SELECT is not available. The cursor is minted by cursorTimestamp on signed_at at microsecond precision because signed_at defaults to now() and signatures attached in one transaction share it exactly (P1-27-INT-006) — the test proves two pages are disjoint on exactly such a pair. References and never bytes, and NO download is offered by this module — a scope boundary and not an impossibility: the shared attachment path refuses a version with ERR-DOC-001 while it is not accepted, which is a state check, and the rest of the P1-22 rule (no application path can produce acceptance, P1-22-L-04) stopped being true when 20260815090000_shared_reception_evidence_foundation.sql granted INSERT on shared.file_scan_results and UPDATE(status) on shared.document_versions, so registerVersionAndScan can produce a verdict (corrected by P1-31 prerequisite P-14); the test asserts the serialised response carries no storageKey, contentType, sha256 or data URI',
  },
  'sal.delivery-status-history': {
    files: ['tests/backend/p1-31-delivery-read-seam.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-31 prerequisite P-5, finding P1-27-INT-089. sal.delivery_status_history is written on EVERY transition and, before this route, was read by nothing anywhere in apps/api/src — appendStatusHistory was the only method that had ever touched the table. So unlike the other four delivery reads there was no existing query to publish and this query and its row mapper are BOTH new, which is recorded rather than glossed. The ledger is the record and not a reconstruction: SELECT and INSERT grants only, no UPDATE and no DELETE for any application role, and shared.stamp_status_history sets actor_id and occurred_at from the session context so a transition cannot be back-dated or re-attributed. NO synthesised origin block, unlike the work-order and job ledgers whose AFTER UPDATE emitters miss the creating insert: sal.delivery_records has no history trigger, every advance appends its own row carrying from_status, and the create writes the genesis row with a null from_status — so the oldest entry is already the origin and the test asserts the response contains no origin key. Keyset newest-first on sal.delivery_status_history:occurred_at_desc, which ix_delivery_status_history_delivery leads on exactly; the tie-break is id rather than the seq identity column because keysetFragment compares (sort, id) and Cursor.i is validated as an identifier. sel_delivery_status_history_scope carries no permission term of its own, so the declared sal.delivery.view is the only application gate and it is the code that gates the receiver and signature rows these transitions are caused by',
  },
  'sal.delivery-list': {
    files: ['tests/backend/p1-31-delivery-list-seam.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-31 prerequisite P-2b, the last limb of the delivery read seam and the chapter first declared API. P-2 through P-5 made a delivery RECOVERABLE from something the caller already held - its own id or its work order id - and left the SET unreadable: nothing anywhere answered which deliveries a branch has, so the screen the Owner decision D-3 describes as a delivery-records reading had no read behind it. The query is NEW and the mapper is not: every finder in DeliveryRepository is addressed by an identifier, so there was no branch-wide read to publish, but rows come back through toDeliveryView and a listed delivery spells every field exactly as sal.delivery-read spells it. companyId and branchId are REQUIRED and are the authorizationTarget, authorized BEFORE any row is read - the exact reverse of the five id-addressed reads on this seam, and for the reason a list has no row to take a scope from: sel_delivery_records_scope narrows on the permission-blind allowed-branch union so an optional pair would read every branch the caller holds any grant in (P1-18-A-01), and authorizing first stops an empty page from reporting whether a branch has deliveries. THREE filters, each a column of the record: status validated against the ck_delivery_records_status vocabulary at the boundary so an unknown value is refused rather than answered with an empty page that reads as none, plus workOrderId and vehicleId. Keyset on sal.delivery_records:created_at_desc with the cursor minted by cursorTimestamp at MICROSECOND precision (P1-27-INT-006), sorting on a column the response does not carry; created_at and NOT delivered_at, which is NULL until the handover completes and cannot order a set most of whose rows have not delivered. NO INDEX AND NO MIGRATION: nothing leads on (tenant, company, branch, created_at) and the sort runs over the already-narrowed branch set, which is the decision wty.warranty-list took on the same evidence. Soft-deleted rows are excluded, as findDelivery excludes them. Permission is sal.delivery.view, the code every read on this seam declares - NOT sal.delivery.read, which navigation.ts names and the catalogue does not define (RES-05). No money crosses: the record has no amount column and finalOdometerReadingId is a veh.odometer_readings REFERENCE rather than a value',
  },
  // ---- P1-31 prerequisite P-9 - the checklist TEMPLATE surface (PPD-12) ----
  //
  // The two tables landed in P1-11 with INSERT and UPDATE grants and policies and
  // NOTHING in apps/api/src had ever written either one, so a tenant provisioned
  // through the product had an empty handover checklist and no way to fill it. Every
  // suite before this one seeded them by admin SQL; this suite authors every row it
  // reads through the published routes, because that is the claim under test.
  'sal.delivery-checklist-template-list': {
    files: ['tests/backend/p1-31-delivery-checklist-template-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-9, PPD-12. Paged keyset on sal.delivery_checklist_templates:created_at_desc with the cursor minted by cursorTimestamp at MICROSECOND precision (P1-27-INT-006), sorting on a column the response does not carry; the two pages are asserted disjoint. NO company filter is offered and that is a decision: every row carries its own companyId, sel_delivery_checklist_templates_scope already narrows to iam.allowed_company_ids(), and a filter that can only narrow further is a branch and a denial case for no capability - the svc.service-category-list rule. Scope is TENANT and that is the substantive read decision: the table has a company and NO branch, so a company target would be satisfiable only by a company-wide or unrestricted grant and would deny the checklist to the branch-scoped delivery officer who performs the handover; the suite proves a branch-scoped caller reads it and is refused every write. Inactive templates are NOT hidden, because the restore command would otherwise be unreachable. denial is declared because a caller lacking sal.delivery.view is refused with ERR-IAM-001 while holding sal.delivery.manage, so the refusal is the missing code and nothing else',
  },
  'sal.delivery-checklist-template-read': {
    files: ['tests/backend/p1-31-delivery-checklist-template-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-9. Returns the template WITH its live items, and the items are deliberately UNPAGED on the dia.template-version-item-list precedent - the order IS the checklist, so a page boundary would cut one in half; ordering is (sort_order, item_code) because sort_order is not unique and two reads must answer in the same order. Withdrawn items are excluded here while a result recorded against a withdrawn item stays readable through sal.delivery-checklist-result-list, whose join carries no ti.deleted_at predicate - the two are consistent on purpose. Absent and out-of-scope answer ONE ERR-RES-001 decided before anything else, so a foreign tenant learns nothing about existence; recordVersion is published in the body AND as the ETag because the rename and the status command are version-guarded and parseIfMatch accepts only an exact positive integer',
  },
  'sal.delivery-checklist-template-create': {
    files: ['tests/backend/p1-31-delivery-checklist-template-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-9. The header and its items land in ONE transaction, so a half-authored checklist is not a state this surface can produce; a body repeating an item code is refused at the boundary rather than by uq_delivery_checklist_template_items_code, because the constraint would abort the transaction and tell the caller only that a code is in use. THE AUTHORITY IS COMPANY-WIDE and that is measured, not chosen: sal.complete_delivery counts mandatory items by (tenant, company) across ALL templates - a delivery record carries no template reference - so one mandatory item authored here blocks every handover in that company, and a branch-scoped holder of sal.delivery.manage must not be able to do it. The suite proves all three sides: a branch-scoped caller refused, a company-scoped caller admitted in its own company, and the SAME company-scoped caller refused in another. companyId is a CLAIM checked by authorizeScope before the write; a company outside the tenant is refused by fk_delivery_checklist_templates_company, whose tenant half comes from the session context. The body refuses id and status, so a template cannot be born inactive - one offered nowhere while its items still gate. No permission was minted: sal.delivery.manage is reused on the svc.service-category-create rule',
  },
  'sal.delivery-checklist-template-rename': {
    files: ['tests/backend/p1-31-delivery-checklist-template-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-9. The label and nothing else: templateCode is absent because a re-coded template is a different configuration wearing the old identity and an operator reading a historical audit record could not know the code moved, and status is absent because retiring a checklist is its own command - the authority to fix a typo is not the authority to withdraw a checklist from every branch of a company. If-Match carries the TEMPLATE version, which both the detail read and the create response publish as their ETag; the ITEM routes carry a different counter and the suite exercises that trap directly. A stale version is ERR-CON-001 and the row is asserted unchanged; the new version is the DATABASE row rather than expectedVersion + 1, so the caller next If-Match is not an assumption about shared.touch_row_metadata',
  },
  'sal.delivery-checklist-template-status-set': {
    files: ['tests/backend/p1-31-delivery-checklist-template-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-9. Bidirectional on the apt.catalogue-source-channel-status-set precedent: uq_delivery_checklist_templates_code names deleted_at and says nothing about status, so an inactive template still holds its code and a retire-only command would burn it for the company permanently. WHAT DEACTIVATION DOES NOT DO is the finding this slice records: sal.complete_delivery counts mandatory items by (tenant, company) filtered on the ITEM deleted_at and never joins the parent template, so an inactive template with a mandatory item still blocks every handover in that company. The suite proves it on real rows in COMPANY_A9 - eligibility reports checklist_incomplete naming the item - and then proves that WITHDRAWING the item clears it. The mirror in the eligibility read is NOT corrected to match what a reader expects, because a mirror that improved on the primitive would report a delivery eligible that the primitive then refuses; correcting the gate is a migration and is recorded as change-control CC-14',
  },
  'sal.delivery-checklist-template-item-create': {
    files: ['tests/backend/p1-31-delivery-checklist-template-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-9. The later addition - a checklist grows when a workshop decides one more thing must be checked - where the create route authors the first set. isMandatory defaults to false and the route docblock states what true means: a company-wide gate, not a template-scoped one. A duplicate item code inside one template is 23505 on uq_delivery_checklist_template_items_code surfaced as ERR-CON-001 with rule duplicate_code. The ETag is the ITEM version, deliberately not the template one, because that is the value this item own PATCH expects in If-Match. There is no GET on this path: the items come back WITH their template, in checklist order',
  },
  'sal.delivery-checklist-template-item-update': {
    files: ['tests/backend/p1-31-delivery-checklist-template-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-9. label, isMandatory and sortOrder, each optional, applied with COALESCE so a patch carrying only label cannot silently turn a mandatory item optional - the suite asserts the two untouched fields after a one-field patch. An EMPTY body is refused rather than treated as a no-op that still burns a record version. itemCode is not editable because sal.delivery_checklist_results.template_item_id points at the row BY ID, so re-coding would re-label every outcome ever recorded against it. If-Match is the ITEM version. The parent is checked as well as the item: findTemplateItem resolves within the COMPANY, so without that check this path would edit a sibling template item and report success - the suite addresses an item through the wrong parent and asserts ERR-RES-001',
  },
  'sal.delivery-checklist-template-item-remove': {
    files: ['tests/backend/p1-31-delivery-checklist-template-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-9. A SOFT delete performed by UPDATE on the tech.technician-skill-withdraw precedent, because neither checklist table carries a DELETE grant or a DELETE policy for any application role and fk_delivery_checklist_results_item is ON DELETE RESTRICT - a hard removal is refused by the database however it is asked for. This is the ONLY affordance that removes an item from the completion gate, since sal.complete_delivery filters mandatory items on exactly the column this sets, and deactivating the parent template does not have that effect. Deliberately NOT version-guarded, following the same precedent: the withdrawal has one possible outcome whatever the label or order happen to be, and a second attempt answers the uniform ERR-RES-001. uq_delivery_checklist_template_items_code is partial on deleted_at IS NULL so the code returns to the template, which the suite proves by adding it again',
  },
  'sal.delivery-create': {
    files: ['tests/backend/p1-22-delivery.test.ts', 'tests/backend/p1-22-isolation.test.ts'],
    required: ['denial', 'cross-tenant'],
    note: 'creates the parent that eligibility, receiver, checklist, signature and completion all hang off, and hands nothing over — the record is born ready; the vehicle and reception visit are NOT client inputs because sal.guard_delivery_coherence (M-dlv-1) requires both to equal the work order’s, so the service derives them, which is both safer and a better error: a mismatch cannot be expressed at all rather than surfacing as a 23514 naming a trigger; uq_delivery_records_work_order_active permits one live delivery per work order so a second attempt is 23505 surfaced as a conflict (denial); publishes no event, because opening a delivery is not yet a business fact any consumer waits for — vehicle.delivered is',
  },
  'sal.delivery-eligibility-read': {
    files: ['tests/backend/p1-22-delivery.test.ts', 'tests/backend/p1-22-isolation.test.ts'],
    required: ['denial'],
    note: 'THE FINANCIAL BLOCKER HAS NO DATABASE ENFORCEMENT ANYWHERE: sal.complete_delivery checks a receiver row, mandatory checklist results and one signature, and checks no work-order state, no quality control and no balance — deleting this composition would not fail a single constraint; requires sal.finance.view in ADDITION to the delivery authority, and that is not belt-and-braces: the blocker composes from sal.invoice_open_receivable whose inputs sit behind that permission, so a caller without it would be waved through by an RLS-INVISIBLE ZERO reading as "nothing outstanding", the worst available failure mode for a handover gate; there is no `eligible` input anywhere on this path, the answer is a closed BLOCKER_CODES vocabulary rather than a boolean, and the service FAILS CLOSED on any fact it cannot establish — including treating billing’s null as blocking, which deliberately disagrees with the billing port’s own doc comment because null conflates "nothing invoiced" with "no work order found"',
  },
  'sal.delivery-readiness-list': {
    files: ['tests/backend/p1-31-delivery-readiness-seam.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-31, the Owner D-3 decision of 2026-09-09. The OPERATIONAL ready-for-delivery queue, and it is a different set from GET /api/v1/deliveries: that route lists delivery RECORDS, so a finished work order that owes nothing is invisible to it precisely because nobody has started a handover yet — which is when it is most worth showing. FOUR of the eight BLOCKER_CODES are carried and the other four are ABSENT rather than reported as satisfied: delivery_state_invalid, checklist_incomplete, receiver_not_verified and signature_missing are counted against a delivery row id and are unaskable for a work order that has none, so reporting them would raise receiver_not_verified for every eligible work order in the branch. The four that ARE carried come from composeWorkOrderFacts, which calls the SAME private readers the eligibility composition uses and restates none of them — a second definition of the financial fact is the one gate with no database backstop. NO NEW WORK-ORDER STATUS: ready is not a state anybody sets, it is composed on every read, so a row stops being ready the moment a part is reserved. The candidate predicate is CLOSED AND NOT A CANCELLATION and that conjunction is the trap: the platform graph sets is_closed true for cancelled as well as closed, so is_closed alone would offer every abandoned job, and the suite asserts both catalogue flags on the real row before asserting the exclusion. Three permissions, all NECESSARY and together SUFFICIENT, proved by four principals: SAL_READER holds exactly the three and is admitted, and one principal short of each code is refused ERR-IAM-001. sal.finance.view is the decisive one and it is NOT belt-and-braces — the eligibility route requires it because an RLS-invisible zero would read as "nothing outstanding" — so the caller is refused at the operation and there is no softened fact to test. A DELIVERED work order raises NO blocker here and is still not ready, which the suite asserts directly, because a client inferring readiness from an empty blocker list would offer a vehicle that has already left. Page default 20 and maximum 50, below the platform 50/100 and refused at the boundary rather than clamped, because no batch variant of the four fact sources exists so a page of N costs about 5N round trips — batch fact ports in quality, billing and inventory are the named prerequisite of any larger page. No money crosses: the financial fact is a blocker CODE and a provenance string, never an amount in any spelling',
  },
  'sal.delivery-receiver-verify': {
    files: ['tests/backend/p1-22-delivery.test.ts'],
    required: ['denial'],
    note: 'singular because uq_authorized_receivers_delivery permits exactly ONE receiver per delivery, so a plural path would advertise a collection the schema cannot hold; the authority is checked against the VISIT rather than asserted by the caller — sal.guard_authorized_receiver (M-dlv-2) requires a rec.reception_party_roles row valid at the moment of verification, and it is TIME-AWARE, so an expired role does not authorise a collection today and one starting tomorrow does not authorise one now (denial drives a partner with no valid role and asserts a caller-safe message rather than a trigger name); identity evidence is bound BY REFERENCE and its contents are never read, stored or logged, and no biometric or legal-validation claim is made anywhere on the path',
  },
  'sal.delivery-checklist-record': {
    files: ['tests/backend/p1-22-delivery.test.ts'],
    required: ['denial'],
    note: 'ck_delivery_checklist_results_waiver makes the waiver rule a BICONDITIONAL — (outcome = waived) = (waiver_reason IS NOT NULL) — so a waiver with no reason AND a reason attached to a pass are both refused, and the second is the half a caller would not expect, which is why it is an explicit refusal rather than a silently dropped field (both are denial cases); sal.complete_delivery evaluates mandatory items scoped to the delivery’s COMPANY rather than to any one template, so adding a mandatory item to any active template immediately blocks every in-flight delivery with no result for it — the test asserts that, because it is the behaviour an operator will otherwise discover in production; uq_delivery_checklist_results_item permits one result per item per delivery and the service REFUSES a re-record rather than overwriting, because an overwrite would silently erase a failed outcome a completion gate had already read',
  },
  'sal.delivery-signature-attach': {
    files: ['tests/backend/p1-22-delivery.test.ts'],
    required: ['denial'],
    note: 'a REFERENCE, never the image: the body carries a shared.document_versions id and nothing else, .strict() makes a body carrying signatureData a refusal rather than an ignored field, and no signature bytes reach an audit detail, an event payload or a log line — the test asserts the audit details and the outbox payload contain no base64-shaped value; NO biometric and NO legal-validation claim is made, because this platform records that a document was bound to a handover and does not assert whose mark it is; bound, and downloadable only once accepted (P1-22-L-04, corrected by P1-31 prerequisite P-14): the table accepts any document_versions row regardless of status while DOWNLOADABLE_STATES is [accepted], so a bound version is refused with ERR-DOC-001 while it is not accepted — a state check and not an impossibility, since 20260815090000_shared_reception_evidence_foundation.sql grants INSERT on shared.file_scan_results and UPDATE(status) on shared.document_versions and registerVersionAndScan can produce a verdict — and this module still ships NO retrieval endpoint of its own, which is a scope statement: retrieval of a shared.document_versions row is the contract of the shared attachment path',
  },
  'sal.delivery-complete': {
    files: ['tests/backend/p1-22-delivery.test.ts', 'tests/backend/p1-22-concurrency.test.ts'],
    required: ['outbox', 'denial'],
    note: 'the point at which the shop’s custody ends, and the three checks the primitive does NOT make are composed here: work-order state, quality control and the financial balance; eligibility is recomputed INSIDE the transaction after locking the row, from the SAME read service that answers the GET, so what a caller was shown and what is enforced are the same code over the same tables — two implementations would be two chances for the financial blocker to be dropped from the one that matters; EXACTLY ONE blocker is overridable (financial_balance_outstanding), it requires a reason, its authority is sal.delivery.complete rather than sal.delivery.manage, and the reason lands in the audit details — the others are not overridable because two of them are enforced INSIDE the primitive, so an override would be accepted here and then fail at the database, and advertising an override that cannot work is worse than not offering one; the test proves financial BLOCKING and authorized override behaviour as separate cases',
  },
  // ---- P1-31 prerequisite P-10 - the warranty POLICY and COVERAGE surface (PPD-04) ----
  //
  // Both tables landed in P1-11 with INSERT and UPDATE grants and policies and NOTHING
  // in apps/api/src had ever written either one, while wty.policy.manage sat in the
  // permission catalogue declared by no operation and named by no policy predicate. So
  // warranty generation refused every company that had no active policy and nothing
  // could create one: a tenant provisioned through the product could never issue a
  // warranty at all. Every suite before this one seeded the two tables by admin SQL;
  // this suite authors every row it reads through the published routes, because that is
  // the claim under test.
  'wty.warranty-policy-list': {
    files: ['tests/backend/p1-31-warranty-policy-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-10, PPD-04. Paged keyset on wty.warranty_policies:created_at_desc with the cursor minted by cursorTimestamp at MICROSECOND precision (P1-27-INT-006), sorting on a column the response does not carry; the two pages are asserted disjoint, which matters here because a policy and its sibling are frequently authored inside one transaction. Ordered on created_at and NOT on policy_code, which is what listActivePolicies orders on: that read is a disambiguation over a bounded set and this one is a configuration list a person scrolls. ONE filter is offered, status, because the generation form needs the policies a warranty can actually be issued under and resolvePolicy counts exactly the active ones; it is optional and the unfiltered list shows archived rows, or the restore command would be unreachable. NO company filter, on the svc.service-category-list rule: every row carries its own companyId, sel_warranty_policies_scope already narrows to iam.allowed_company_ids(), and a filter that can only narrow further is a branch and a denial case for no capability. Scope is TENANT and that is the substantive read decision: both tables have a company and NO branch, so a company target would deny the policy list to the branch-scoped warranty clerk that wty.warranty-generate is built for. The permission is the READ code wty.warranty.read and not the administration code, and denial is declared because a caller holding only wty.policy.manage is refused with ERR-IAM-001 naming wty.warranty.read',
  },
  'wty.warranty-policy-read': {
    files: ['tests/backend/p1-31-warranty-policy-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-10. Returns the policy WITH its coverage rows, deliberately UNPAGED on the dia.template-version-item-list precedent: the terms of a policy are read as one thing and the set is bounded by ex_warranty_coverage_no_overlap, which admits at most one ACTIVE row per policy and scope on any day, so only archived history accumulates. Ordered (covered_scope, effective_from, id) - the exclusion constraint excludes only ACTIVE rows so an archived row may repeat the first two and the id is what makes the order total. ARCHIVED coverage IS included, because it is the history explaining a warranty issued under terms since replaced and hiding it would make the reactivation command unreachable. Absent and out-of-scope answer ONE ERR-RES-001 decided before any scope decision, so a foreign tenant learns nothing about existence; recordVersion is published in the body AND as the ETag because the rename and the status command are version-guarded and parseIfMatch accepts only an exact positive integer',
  },
  'wty.warranty-policy-create': {
    files: ['tests/backend/p1-31-warranty-policy-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-10. The header and its coverage land in ONE transaction, because a policy with no coverage is exactly the configuration the issue primitive refuses with a bare check_violation - POLICY_NO_COVERAGE is a P1-22 fixture precisely because that state is reachable - so a create-then-add-each-only surface would make the half-configured policy the normal outcome of a dropped connection. A body whose own two windows overlap for one scope is refused at the BOUNDARY rather than by the exclusion constraint, which would abort the transaction and tell the caller only that two windows overlap. THE AUTHORITY IS COMPANY-WIDE and that is measured, not chosen: neither table has a branch column, both RLS policies narrow by iam.allowed_company_ids() with no branch clause, and resolvePolicy picks a company only active policy for every branch of it - so one coverage row sets the terms of every warranty issued anywhere in that company. The suite proves all three sides: a BRANCH-scoped holder of wty.policy.manage refused while still reading, a COMPANY-scoped holder admitted in its own company, and the SAME caller refused in another. companyId is a CLAIM checked by authorizeScope before the write; a company outside the tenant is refused by fk_warranty_policies_company, whose tenant half comes from the session context. The body refuses id and status, so a policy cannot be born archived. NOTHING WAS MINTED: wty.policy.manage has been a catalogue row since P1-08 and this is the first operation in the repository to declare it',
  },
  'wty.warranty-policy-rename': {
    files: ['tests/backend/p1-31-warranty-policy-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-10. The name and nothing else: policyCode is absent because every warranty record cites its policy by id for the life of the warranty and an operator reading one issued last year could not know the code moved, and status is absent because archiving a policy is its own command - the authority to fix a typo is not the authority to stop a company issuing warranties. If-Match carries the POLICY version, which both the detail read and the create response publish as their ETag; a COVERAGE row carries a different counter and the suite exercises that trap directly by moving the policy counter first and then offering it on the coverage path. A stale version is ERR-CON-001 and the row is asserted unchanged; the new version is the DATABASE row rather than expectedVersion + 1, so the caller next If-Match is not an assumption about shared.touch_row_metadata',
  },
  'wty.warranty-policy-status-set': {
    files: ['tests/backend/p1-31-warranty-policy-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-10. Bidirectional on the apt.catalogue-source-channel-status-set precedent: uq_warranty_policies_code names deleted_at and says nothing about status, so an archived policy still holds its code and an archive-only command would burn it for the company permanently. ARCHIVING DOES NOT CASCADE TO THE COVERAGE ROWS, and the suite asserts that on real rows: wty.issue_warranty filters coverage on the COVERAGE own status and never reads the policy status, so a cascade would change what the primitive resolves for reasons the operator did not choose, and restoring the policy could not tell which rows the cascade archived from which an operator did. What archiving DOES do is remove the policy from listActivePolicies, which is what resolvePolicy counts - the end-to-end case proves a company going from unconfigured, to issuing a warranty carrying the very terms just authored, to unconfigured again after this command, and proves that NAMING the archived policy is a different refusal (ERR-TRN-001 from assertPolicyActive) than omitting it (ERR-RES-001), which is why findPolicy does not filter on status',
  },
  'wty.warranty-coverage-create': {
    files: ['tests/backend/p1-31-warranty-policy-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-10. The later addition - a policy terms change when next year warranty runs for a different number of months, and the way that is expressed is a NEW window beside the old one rather than an edit of it, because tg_warranty_coverage_immutable freezes policy_id and effective_from and re-closing effective_to in place would restate the terms a customer was already bound to. ex_warranty_coverage_no_overlap is the enforcement point and is reported as ERR-CON-001 with rule overlapping_coverage; the range is HALF-OPEN so a window ending on the day the next begins is legal, which the suite proves, and a different covered_scope over the same days is accepted, which it also proves. odometerAllowance is a STRING and never a JSON number: it is a distance, and veh.odometer_readings.value is numeric and crosses the wire as an exact decimal string everywhere in this codebase - one spelling for the reading and another for the allowance is how a float gets onto the path. It is deliberately NOT called odometerLimit, which is the record ABSOLUTE ceiling rather than this RELATIVE allowance. The ETag is the COVERAGE version, deliberately not the policy one',
  },
  'wty.warranty-coverage-status-set': {
    files: ['tests/backend/p1-31-warranty-policy-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-10. The command that actually changes a company warranty terms: the issue primitive selects coverage on status = active, so archiving the row effective today stops those terms being granted to the next vehicle while every warranty already issued under it stays readable and intact. A REACTIVATION CAN BE REFUSED and that is not a fault - ex_warranty_coverage_no_overlap is PARTIAL on status = active, so an archived row window may have been re-covered while it was archived, and putting it back would make the terms a customer receives depend on which row the planner returned first. The suite proves the whole sequence on real rows: archive, write a replacement over the freed days, then fail the reactivation with the SAME overlapping_coverage rule an insert produces, with the archived row asserted unchanged so a refused reactivation burns no version. Version-guarded and deliberately NOT idempotent, unlike the policy status command beside it: a stored replay would hide a conflict raised by rows written since, and the version guard already makes a duplicate submission safe. The If-Match is the COVERAGE version. There is no PATCH and no delete: no DELETE grant or policy exists for any application role and fk_warranty_records_coverage is ON DELETE RESTRICT',
  },
  'wty.warranty-generate': {
    files: ['tests/backend/p1-22-warranty.test.ts', 'tests/backend/p1-22-isolation.test.ts'],
    required: ['outbox', 'denial'],
    note: 'a subresource of the delivery rather than a top-level POST, and the shape carries meaning: wty.guard_warranty_record_coherence refuses an INSERT whose delivery is not delivered and every term is dated from delivered_at, so making the delivery the parent segment means "issue a warranty for nothing" cannot be expressed; the caller may name a policy AND NOTHING ELSE — duration, odometer limit, covered scope and the effective window all come from the coverage row effective at the delivery date, a missing one is a controlled configuration error and never a defaulted twelve months, and an ambiguous or absent policy is a configuration error too because guessing which of two policies a customer’s warranty falls under would be inventing a legal term (denial); the record’s odometer_limit is ABSOLUTE where the coverage’s is RELATIVE and the test asserts that arithmetic; an ARCHIVED policy is refused by the application because wty.issue_warranty checks the coverage status and NEVER the policy’s — a gap closed in code because closing it in the database needs a migration (CC-6)',
  },
  'wty.warranty-list': {
    files: ['tests/backend/p1-31-warranty-read-seam.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-31 prerequisite P-6, the chapter second declared API and the second half of VHM-06/WF-26. NOT a pure publication on the sal.work-order-invoice-read rule, and the route docblock says which half fails: every finder in WarrantyRepository is addressed by an identifier the caller must ALREADY hold — a record id, an idempotency key, a delivery id — so there was no branch-wide read to publish and this query is new; the MAPPER is not, rows come back through toRecord and the published row spells every field exactly as wty.warranty-detail spells it, so a screen sees one shape. companyId and branchId are REQUIRED and are the authorizationTarget, authorized BEFORE any row is read: sel_warranty_records_scope narrows on the permission-blind iam.allowed_branch_ids() union, so an optional pair would read every branch the caller holds any grant in (P1-18-A-01), and authorizing first stops an empty page from reporting whether a branch issues warranties. vehicleId is the ONLY filter — A0 records under P-6 that the table carries a NOT NULL vehicle reference so it needs no new column, ix_warranty_records_vehicle already covers it, and the chapter names no other filter, so none is invented. The policy block is carried and not a bare policyId: no operation lists warranty policies (PPD-04, P-10), so an unresolvable identifier would be the very defect this phase keeps finding; the page distinct policies are read in ONE statement on the listReceipts payment-method pattern, never one per row. Keyset on wty.warranty_records:start_date_desc, the ordering listWarrantiesForDelivery already uses on this table, with the id tie-break making it total — start_date is a date so ties are ordinary and P1-27-INT-006 does not apply, because a YYYY-MM-DD rendering truncates nothing and no cursorTimestamp is used. NO MONEY anywhere: wty has 80 columns and not one is an amount, a currency or a cap, and odometerAtIssue/odometerLimit are exact decimal STRINGS for a distance reading',
  },
  'wty.warranty-detail': {
    files: [
      'tests/backend/p1-22-warranty.test.ts',
      'tests/backend/p1-22-isolation.test.ts',
      'tests/backend/p1-31-warranty-read-seam.test.ts',
    ],
    required: ['denial'],
    note: 'RE-POINTED on 2026-09-08 by P1-31 prerequisite P-7 from the WRITE code wty.warranty.issue to the newly minted wty.warranty.read. Until then the permission catalogue held only wty.policy.manage and wty.warranty.issue, so a read was gated on the authority to CREATE a warranty — over-granting by omission — and borrowing wty.policy.manage instead would have been worse, handing coverage administration to a caller who only needs to read a record; both readings are now moot and the least-privilege read code exists, seeded in 04_iam_permission_catalog.sql and carried by the tenant administrator bundle so the re-point removes no capability from a freshly provisioned organisation. The re-point is proved behaviourally rather than asserted: a principal holding ONLY wty.warranty.read reads a warranty issued through the real generation route, and a principal holding ONLY wty.warranty.issue is REFUSED it with ERR-IAM-001 naming wty.warranty.read — so collapsing the two codes turns both cases red. Carries NO monetary field, and that is not an omission to fill in later: wty has 80 columns and not one is an amount, a currency or a cap in any unit of account, so a covered value here would be a fabricated business fact and the test asserts the response has no key matching /amount|currency|price|cost|value/i; carries no claim history because there is none to carry — status may legally READ claimed_against since it is in ck_warranty_records_status, and nothing in this phase can ever WRITE it (P1-22-L-01), which the test pins structurally so a future edit cannot quietly add a claim route',
  },
  // ========================================================================
  // PRE-P1-29 Wave B (platform.) — the control plane. The only operations in
  // the product that are not inside a tenant, so the derived floor's
  // cross-tenant obligation means something different here: not "one tenant
  // cannot read another's rows", but "a tenant-bound principal cannot reach the
  // control plane at all". Each entry adds `denial` because the 403 path IS the
  // control — a platform route that answered 403 to everyone would satisfy every
  // structural gate, which is PC-1.
  // ========================================================================
  // ========================================================================
  // PRE-P1-29 Wave C — the Company RBAC Backend (canonical G-4, G-6, P-1/G-5).
  //
  // Every entry adds `denial`, and for these eight it is not ceremony. Three of
  // the permissions involved (org.company.manage, org.branch.manage,
  // org.department.manage) were seeded with ZERO references anywhere in the
  // product before this slice, so nothing had ever exercised the path where they
  // are false. A denial case is the only thing that distinguishes "the
  // permission is now enforced" from "the permission is still inert".
  //
  // `org.department-list` additionally carries the split that org.department.read
  // exists for: an actor holding only org.department.manage must be REFUSED the
  // list. Without that case, collapsing the two codes back into one would go
  // unnoticed.
  // ========================================================================
  'org.company-list': {
    files: ['tests/backend/pre-p1-29-wave-c-company-rbac.test.ts'],
    required: ['denial'],
    note: 'half of P-1: the companies an actor MAY REACH, by name; the reach rule is sel_legal_companies_tenant and is deliberately not restated in TypeScript, where the unrestricted case (empty allowed-ids meaning everything) is easy to invert',
  },
  'org.branch-list': {
    files: ['tests/backend/pre-p1-29-wave-c-company-rbac.test.ts'],
    required: ['denial'],
    note: 'the other half of P-1; a separate operation from the company list because evaluatePermissions requires EVERY declared code, so one combined read would refuse a branch-only reader',
  },
  'org.company-update': {
    files: ['tests/backend/pre-p1-29-wave-c-company-rbac.test.ts'],
    required: ['denial', 'audit'],
    note: 'G-4: org.company.manage guarded nothing before this; status is absent from the body because org.company-status-set owns transitions and this route must not become a second path with no reason and no history',
  },
  'org.company-status-set': {
    files: ['tests/backend/pre-p1-29-wave-c-company-rbac.test.ts'],
    required: ['denial', 'audit'],
    note: 'the first caller org.change_company_status has ever had; migration 133 shipped it granted and unreachable, which is the declared-but-never-wired class that dominated P1-27',
  },
  'org.branch-update': {
    files: ['tests/backend/pre-p1-29-wave-c-company-rbac.test.ts'],
    required: ['denial', 'audit'],
    note: 'G-4: org.branch.manage guarded nothing; company and branch code are frozen by tg_branches_immutable and status belongs to shared.branch-status-change, so the body carries none of the three',
  },
  'org.department-create': {
    files: ['tests/backend/pre-p1-29-wave-c-company-rbac.test.ts'],
    required: ['denial', 'audit', 'idempotency'],
    note: 'G-6: the FIRST insert into org.departments in the product; a grant could be scoped to a department that no path could create',
  },
  'org.department-list': {
    files: ['tests/backend/pre-p1-29-wave-c-company-rbac.test.ts'],
    required: ['denial'],
    note: 'G-6, on the NEW least-privilege org.department.read; the suite proves the split by refusing an actor who holds only org.department.manage, so collapsing the two codes goes red',
  },
  'org.department-update': {
    files: ['tests/backend/pre-p1-29-wave-c-company-rbac.test.ts'],
    required: ['denial', 'audit'],
    note: 'G-6: rename, retire and reinstate; no archive verb, because archiving frees the code via uq_departments_branch_code_live and no shipped operation has precedent for the un-archive collision',
  },
  // ---- P1-31 prerequisite P-17 - the employee register (Owner decision 2026-09-10) ----
  //
  // The platform had no employee. It had LOGIN ACCOUNTS, and every attempt to name a
  // person resolved to one: tech.technician_profiles.user_id and
  // iam.user_employee_links.user_id are both NOT NULL foreign keys into
  // iam.user_accounts, so neither can hold someone with no reason to sign in. That was
  // measured before a new table was proposed and it is the whole justification for one.
  // The same slice gives sal.delivery_records.delivering_employee_id the foreign key it
  // never had, so these four operations are a PREREQUISITE of the delivery surface
  // rather than an addition beside it.
  'org.employee-list': {
    files: ['tests/backend/p1-31-delivering-employee-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-17. Keyset-paged on org.employees:created_at_desc, branch-scoped, and the company/branch pair is REQUIRED in the query rather than optional: scope branch is inert without a target because requiresScopedEvaluation returns false on an empty one whatever the declaration says, and app.branch_ids is the permission-blind union of every active grant, so RLS cannot compensate. ONE filter is offered, status, and it is optional because the unfiltered list must show retired employees or the reinstate command would be unreachable from the register it acts on. The permission is the READ code org.employee.read and not the administration code, and denial is declared because a caller holding only org.employee.manage is refused with ERR-IAM-001 naming org.employee.read - the same split org.department carries, proved rather than asserted so that collapsing the two codes goes red',
  },
  'org.employee-detail': {
    files: ['tests/backend/p1-31-delivering-employee-seam.test.ts'],
    required: ['denial'],
    note: 'P1-31 prerequisite P-17. Resolves the row FIRST and re-authorizes against the row own company and branch, so a caller cannot reach another branch by naming an id from it. Absent, soft-deleted, out of reach and in another tenant are ONE ERR-RES-001 decided before any scope decision, which is what stops the register becoming a way to enumerate another organisation people. recordVersion is published in the body AND as the ETag because the status command is version-guarded and parseIfMatch accepts only an exact positive integer',
  },
  'org.employee-create': {
    files: ['tests/backend/p1-31-delivering-employee-seam.test.ts'],
    required: ['denial', 'audit', 'idempotency'],
    note: 'P1-31 prerequisite P-17, and the FIRST insert into org.employees in the product. userAccountId is OPTIONAL and that single fact is why the table exists: an employee with no login cannot be represented by tech.technician_profiles or iam.user_employee_links, both of which require an account. status is absent from the body so an employee cannot be born retired. The company/branch pair is a CLAIM authorized before the insert and re-checked against what the session can SEE, because an actor holding org.employee.manage unrestricted satisfies the permission for any pair they name and a cross-tenant pair would otherwise reach the INSERT and be refused there as a 500. Both codes are MINTED by this slice and both are carried in the provisioning bundle, because a delivery cannot be created without an employee to name',
  },
  'org.employee-status-set': {
    files: ['tests/backend/p1-31-delivering-employee-seam.test.ts'],
    required: ['denial', 'audit'],
    note: 'P1-31 prerequisite P-17. Bidirectional because status is the ONLY retirement this register has - org.employees grants DELETE to no application role and fk_delivery_records_delivering_employee is ON DELETE RESTRICT - so a one-way command would make a mistaken retirement permanent. Retiring stops the employee being named on a NEW handover immediately, at the database, because sal.stamp_delivering_employee_identity refuses a non-active employee on INSERT; it changes nothing about handovers already recorded, each of which carries its own stamped display-name snapshot. Version-guarded and deliberately NOT idempotent, on the wty.warranty-coverage-status-set precedent: a stored replay would hide a conflict raised by a change written since, and the version guard already makes a duplicate submission safe. A missing If-Match is ERR-CON-002 and a stale one ERR-CON-001, asserted as different failures',
  },
  'platform.organization-read': {
    files: ['tests/backend/pre-p1-29-platform-control-plane.test.ts'],
    required: ['denial'],
    note: 'one operation serves the collection and a single tenant via an optional query parameter, the inv.stock-availability-read shape; reads the tenant root and nothing beneath it, bounded by sel_tenants_platform rather than by a tenant predicate',
  },
  'platform.organization-provision': {
    files: [
      'tests/backend/pre-p1-29-platform-control-plane.test.ts',
      'tests/backend/p1-29-w9-owner-bootstrap.test.ts',
      'tests/backend/p1-30-tenant-bootstrap-reachability.test.ts',
    ],
    required: ['denial'],
    note: 'the sanctioned path to org.provision_organization; tenant.activate is never forwarded, because that branch would close the §6.3 bootstrap window inside the transaction that depends on it',
  },
  'platform.organization-lifecycle': {
    files: ['tests/backend/pre-p1-29-platform-control-plane.test.ts'],
    required: ['denial', 'audit'],
    note: 'the operation that makes the bootstrap window self-closing rather than permanent; the graph is M4s and the history row is M3s, so the route duplicates neither',
  },

  // ========================================================================
  // Phase 1-30 A2 — the published READ seams (S-07 … S-16).
  //
  // Twelve operations across ten seams: 2 class A (the read existed and was
  // unpublished), 5 class B (an existing model needed a thin route), 3 class C
  // (a new read model). S-11 was reclassified B -> C by executable evidence.
  //
  // Every one is a GET, none mints a permission code, and none carries an audit
  // action: A2 is a read slice and does not invent write-style audit for ordinary
  // reads. The derived floor (route, service, success, authorization, plus
  // cross-tenant for a path naming a resource and isolation for a branch scope)
  // comes from the registration; `required` below is additive.
  // ========================================================================
  'sal.work-order-invoice-read': {
    files: ['tests/backend/p1-30-a2-published-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-30 A2 seam S-10, class A. BillingRepository.liveInvoiceForWorkOrder existed since P1-22 with no route: its only callers were the duplicate-create refusal and the delivery module financial blocker, so a work-order screen could not answer has this been invoiced without listing invoices and filtering client-side. Singleton by uq_invoices_work_order_active, so no pagination and no ordering contract. Absence is 200 with invoice null and NOT 404 — collapsing them would tell a caller no invoice for a work order in a branch they cannot see, an existence oracle disguised as an empty result. A caller without sal.finance.view gets totals null and never a zero: sel_invoice_amounts_gated hides the amounts row, the query is a LEFT JOIN precisely so that yields NULL, money is OMITTED not fabricated. Permission is sal.invoice.manage, the code the sibling sal.invoice-detail declares — NOT sal.invoice.read, which navigation.ts names but the 118-code catalogue does not define (RES-05), so declaring it would gate the route on a permission no actor can hold. Isolation is proved in TWO layers deliberately: SAL_SCOPED_A2 gets 404 because sel_work_orders_scope hides the parent (database layer) and SAL_PERMISSION_ELSEWHERE, whose widening grant makes the parent visible, gets 403 from authorizeScope on the scope read FROM the work-order row (application layer, P1-18-A-01). Widening one assertion to [403,404] would have proved only the first',
  },
  'svc.service-detail': {
    files: ['tests/backend/p1-30-a2-published-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'P1-30 A2 seam S-12, class A. ServiceCatalogService.detail existed and was unrouted, so a service could be created and updated and never read back individually; the GET was added to the existing route file and needed no new path template. Tenant scope, because svc.services carries no company_id and no branch_id and the path names no branch — a branch declaration would have no target and fail closed for every caller (P1-18-A-01). The projection carries NO price: resolution depends on company, branch, customer class and date and is gated on svc.price.read in a different module, so bolting one on here would leak the price book to every catalogue reader, and the test asserts the absence of amount, unitPrice, currency and priceRule by substring. Publishes record_version and an ETag, which the guarded update has always demanded via If-Match',
  },
  'quo.quotation-list': {
    files: ['tests/backend/p1-30-a2-published-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-30 A2 seam S-07, class B. quo.quotations.work_order_id is NOT NULL and immutable, so the parent is the authority for scope and the path names it; a top-level GET /quotations?workOrderId= would name no parent, which makes the declared branch scope inert (requiresScopedEvaluation returns false on an empty target) and leaves app.branch_ids — the permission-blind union of every active grant — as the only narrowing. Scope comes from requireWorkOrder, the same port quotation create uses. A visible work order nobody has quoted answers an EMPTY page; one the caller may not see is ERR-RES-001 before any quotation is read, so an empty page can never stand in for a refusal. Headers only: no revision object and no priced line travels, so nothing here can round money — currentRevisionId is present as the navigation link and the assertion is on the nested key, not the substring. Keyset on the qualified contract quo.quotations:created_at_desc with the cursor minted by cursorTimestamp at MICROSECOND precision (P1-27-INT-006), because quotations written in one transaction share transaction_timestamp exactly; two pages are proved to be disjoint. A malformed cursor is ERR-PAG-001 at 400 and an unknown query parameter ERR-VAL-001 at 422, asserted separately. Falsifiability measured: removing authorizeScope turns the isolation case RED (200 for 403) — this read has no pre-handler target, so that check is the only guard',
  },
  'quo.quotation-revision-list': {
    files: ['tests/backend/p1-30-a2-published-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-30 A2 seam S-08, list half, class B (A0 classed the seam A and section 6.3 corrected it: listRevisions and findRevision are NOT unrouted, quo.quotation-detail reaches both). The real gap is that the detail publishes ONLY current_revision_id, so a superseded, rejected or expired revision was unreadable although the rows are immutable and retained on purpose. Keyset on quo.quotation_revisions:revision_number_desc — the document own sequence, unique per quotation by uq_quotation_revisions_number, rather than created_at which for revisions produced in one transaction distinguishes nothing. isCurrent is the EFFECTIVE current revision: current_revision_id when set, and the highest revision number when it is NULL, because that column is only written on ISSUE and QuotationService.detail already falls back the same way — reading the column alone made the history claim no revision is current while the detail endpoint named one, which the test now pins. Captured totals stay decimal STRINGS and nothing recomputes ck_quotation_revisions_totals. Scope is re-decided against the PARENT quotation row',
  },
  'quo.quotation-revision-detail': {
    files: ['tests/backend/p1-30-a2-published-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-30 A2 seam S-08, drill-down half, class B. Top-level /quotation-revisions/{revisionId} because that collection already exists in this API — POST /quotation-revisions/{revisionId}/decisions addresses exactly this row — and nesting the read under the quotation would give the same row two addresses. findRevision and listItems are reused unchanged; what is new is that a revision which is NOT the quotation current one can be read at all, which the test proves by reading a SUPERSEDED revision with its lines after a revise. Every amount on the revision and on each line is numeric(18,4) and crosses as a decimal STRING; ck_quotation_revisions_totals and ck_quotation_items_tax_amount hold the arithmetic in the database and nothing here recomputes either. Scope is derived from the revision row own company and branch, which are immutable and tied to the parent by the composite FK, so authorizing the row is authorizing the document. Publishes record_version and an ETag for the guarded issue command',
  },
  'quo.quotation-revision-decisions-read': {
    files: ['tests/backend/p1-30-a2-published-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-30 A2 seam S-09, class C. quo.approval_decisions had exactly one reader — findDecisionForItem, a single-item lookup the WRITE path uses to detect a replay — and quo.approval_evidence had an INSERT and no read at all, so the append-only approval trail the schema exists to keep (BR-QUO-001/002) could be written and never read back: a dispute about what a customer approved had no answer through the API. Bounded and deliberately NOT paginated: uq_approval_decisions_item permits at most one decision per revision-item and MAX_ITEMS_PER_REVISION caps items at 200, so the set has a hard structural ceiling that cannot grow with time or use. Ordered by the ITEM line number, not decided_at, because a reviewer reads the list against the quotation they are holding. evidence is an ARRAY even though evidence_ref is a single column, because approval_evidence is keyed only by approval_decision_id with no uniqueness constraint and a scalar would silently drop the rest; the aggregate uses json_agg FILTER-equivalent COALESCE so a decision with no evidence yields [] and never a phantom null row. outcome is RECOMPUTED by rollUpDecisions from the item rows on every call — there is no stored revision-level decision in quo and this read invents none — and null while lines remain undecided is a real state, reported beside itemCount so a caller does not have to infer it. Publishes no storage key (evidence carries a shared.document_versions id, and resolving it is a separate read with its own authorization) and no actor name',
  },
  'svc.price-list-detail': {
    files: ['tests/backend/p1-30-a2-published-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'P1-30 A2 seam S-13, detail half, class C. findPriceList existed as an internal single-row lookup with no route and NOTHING could list a price list versions — findPriceListVersion reads one by id, which a caller can only use if it already knows the id — so svc.price-list-list could show that a list exists and svc.price-list-version-create could add to it while no caller could see what versions it had, which was published, or which was effective, and svc.resolve_price picked among them with the product unable to show its working. Versions are BOUNDED with one row of headroom and versionsTruncated reports the bound rather than returning a short list silently; a price list gains a version when a tenant republishes prices, so a cursor would be ceremony. Tenant scope, like every other operation on svc.price_lists, which carries no company_id and no branch_id. The list currency is published and no amount is — prices live on the rules',
  },
  'svc.price-rule-list': {
    files: ['tests/backend/p1-30-a2-published-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant'],
    note: 'P1-30 A2 seam S-13, rules half, class C. svc.price_rules could be written, counted by an internal guard and read by the resolver, and by nothing else — there was no rule list at any layer, so an operator could publish a price list and never see what was in it. Ordered by the RESOLVER own precedence, specificity DESC then priority DESC with branch 4, company 2 and customer class 1, reproduced in the ORDER BY and published as a computed specificity field so the order the rows arrive in and the number explaining it come from the same arithmetic; sorting alphabetically would have hidden the precedence the engine actually uses. amount is numeric(18,4) as a decimal STRING labelled with the PARENT LIST currency, because svc.price_rules stores none and a rule inherits the list — a bare figure would be an unlabelled amount. The version must belong to the price list named in the path and a version under a DIFFERENT list is refused with the same ERR-RES-001 an absent one gets, so the path id is not decoration and cannot be used to probe which version ids are real. Bounded with headroom; truncated is reported',
  },
  'sal.receipt-list': {
    files: ['tests/backend/p1-30-a2-published-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-30 A2 seam S-11, class C — RECLASSIFIED from B by executable evidence and accepted by Owner decision 2026-09-04: PaymentReadService had only listPaymentMethods and readReceipt, and PaymentsRepository only single-row finders plus listAllocations, so query, projection, repository method, service method and route are all new. The payments module surface RECORDED a deliberate refusal to list receipts; that refusal is answered rather than overridden, because it rests on there being no honest amount-free projection for a caller WITHOUT sal.finance.view and this operation DECLARES that code — the same one the sibling sal.receipt-detail declares — so the only callers it serves are ones sel_receipts_gated already hands whole rows to. The stale claim in the module docblock was corrected in the same commit. companyId and branchId are REQUIRED and are the authorizationTarget: the policy scope arms narrow on iam.allowed_branch_ids, the permission-blind union of every active grant, so an optional pair would mean sal.finance.view held in one branch reads the cash taken in every branch the caller has any grant in (P1-18-A-01). money and unallocated are exact decimal STRINGS with the receipt own currency; unallocated is sal.receipt_unallocated, PostgreSQL own round(amount - sum(allocations), 4), derived per row and stored nowhere, and it is 0 for a REVERSED receipt as well as a fully allocated one, which is why status travels beside it. deleted_at is filtered here unlike findReceipt, which cannot filter it because the primitives it feeds ignore it. Payment methods are labelled by loading the dual-scope reference set ONCE per page rather than joining, so the (scope = platform OR tenant_id = ...) predicate is not copied into a second place, and an unresolvable method is null rather than a fabricated label. Falsifiability measured and recorded honestly: removing authorizeScope alone is GREEN (the pre-handler target check refuses first), removing the pre-handler target alone is GREEN (the service check refuses), removing BOTH is RED at 200 for 403 — two independently sufficient layers, and only the third mutation shows the property is enforced at all',
  },
  'inv.stock-reservation-list': {
    files: ['tests/backend/p1-30-a2-inventory-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-30 A2 seam S-14, class B. inv.reserve_stock and inv.release_reservation both had routes and nothing could ask what is reserved: a screen could read GET /stock-availability and see that some quantity was committed but not to which work order or when it lapses, so a reservation could not be released deliberately, only left to expire. companyId and branchId are REQUIRED and are the authorizationTarget, the inv.stock-movement-list precedent. auditClass none, matching inv.stock-availability-read rather than the movement ledger: the ledger is audited because it is the complete record of what a branch holds and consumes, a list of open commitments is not that record, and this slice mints no read-audit action. A named locationId is resolved to its OWN company and branch and compared against the authorized pair, otherwise it would be a way around the branch check. quantity is numeric(12,3) as a decimal STRING; expiresAt is published as stored INCLUDING null, because a reservation with no expiry is a real state and a far-future substitute would make an open commitment look time-bounded. Keyset on inv.stock_reservations:created_at_desc with a microsecond cursor. Falsifiability measured: neutralising the company/branch predicate was GREEN at first and that was a hole in the SUITE, not defence in depth — every fixture reservation lived in branch A1 — so a reservation in BRANCH_A2 and a case asserting it never appears were added, and the same mutation is now RED on exactly that case. INV_FULL is unrestricted, so allowed_branch_ids is NULL and RLS admits every tenant-A row: for such a caller the SQL predicate is the ONLY narrowing and the suite has to carry that proof itself',
  },
  'inv.work-order-part-issue-list': {
    files: ['tests/backend/p1-30-a2-inventory-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-30 A2 seam S-15, class B, PARENT-SCOPED and that is the whole point. A0 section 6.3 corrected the shape: a top-level GET /stock-issues?workOrderId= narrowed only by a query parameter would name no parent, so requiresScopedEvaluation sees an empty target and returns false whatever scope is declared (P1-18-A-01), leaving app.branch_ids as the only narrowing on a per-work-order stock history. Naming the parent in the path makes the work-order ROW the thing authorized, and the service resolves it through the work-order module public surface before reading a single issue. A visible work order with nothing issued answers an EMPTY page; one the caller may not see is ERR-RES-001 before any issue row is touched. returnedQty is the SAME correlated sum over inv.part_returns that readPartIssue computes, in SQL; quantity and returnedQty are both numeric(12,3) decimal STRINGS and the outstanding amount is deliberately NOT published, because netting two exact decimals in IEEE-754 is the arithmetic the server-owned-amount rule forbids and inv.guard_part_return_ceiling is the authority on the bound. Ordered by created_at, not issued_at — measured against the table, which has no issued_at column. Both isolation layers are proved: INV_SCOPED_A2 gets 404 because RLS hides the parent, and INV_PERMISSION_ELSEWHERE, whose widening grant makes it visible, gets 403 from the application check. Falsifiability measured: removing authorizeScope turns that second case RED at 200 for 403',
  },
  'inv.stock-location-list': {
    files: ['tests/backend/p1-30-a2-inventory-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation', 'pagination'],
    note: 'P1-30 A2 seam S-16, class B, and the read every other stock operation depended on. The location is the SCOPE ANCHOR: inv.post_stock_movement derives company_id and branch_id from it rather than from anything the caller sends, and reserving, issuing, returning, adjusting and recording damage all take a locationId — so before this route every one of those commands required an id the product could not produce, while readLocation existed as an internal scope resolver with no list in front of it. companyId and branchId are REQUIRED and are the authorizationTarget: a branch-blind location list would be a directory of which branches exist and how they are laid out. INACTIVE locations are listed rather than hidden, because stock already sitting in a location that was later deactivated still has to be findable and a picker that omitted it would strand that stock; status is on every row and offered as a filter instead. Ordered by location_code ascending, which uq_stock_locations_code makes total within a branch and which is the string an operator actually reads; name and parentLocationId are carried because two bins in different warehouses can be indistinguishable otherwise. No amount and no quantity crosses — a location is reference data. Falsifiability measured: neutralising the company/branch predicate is RED on three cases with no change to the suite, because the location fixtures already span both branches',
  },
};

// ---------------------------------------------------------------------------
// Registry scanning
// ---------------------------------------------------------------------------

/**
 * Reads one declared field out of a `defineOperation({...})` literal.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is the whole point of these two lines.
 *
 * A `defineOperation` literal in this codebase routinely explains its choice by
 * naming the alternative it REJECTED — `scope: 'branch'` would fail closed here,
 * `auditClass: 'none'` would be wrong because this writes money — in a comment
 * directly above the real key. The regex takes the FIRST match, so a
 * comment-blind read returns the rejected value and the operation is measured as
 * something it never declared.
 *
 * `derivedRequirements()` reads exactly these fields to decide what evidence an
 * operation owes, so the failure is not cosmetic. One direction is harmless — a
 * commented `scope: 'branch'` above a real `tenant` ADDS an isolation obligation
 * nothing owes, which is a false FAILURE and gets noticed. The other direction is
 * a false GREEN: a commented `scope: 'tenant'` above a real `branch` DROPS the
 * isolation requirement, a commented `auditClass: 'none'` above a real class
 * drops `audit`, and the gate then reports success over an operation whose
 * evidence was never demanded. A gate that can be silenced by a sentence of prose
 * beside the code is not a gate.
 *
 * It was live: `svc.service-list` declares `scope: 'tenant'` and explains, four
 * lines above, that "Declaring `scope: 'branch'` here would be worse than
 * useless". This gate read `branch` for the whole of P1-20 and every run since.
 * Only the manifest's own declared `isolation` — additive, and written for an
 * unrelated reason — kept the effective requirement correct.
 *
 * `stripComments` is a lexer, not a `//`-to-end-of-line regex: these literals
 * carry `path` and `summary` strings with `http://` in them, and truncating there
 * would delete real declarations. It is a hoisted function declaration, so the
 * forward reference from here is resolved before either helper can be called.
 *
 * Both helpers strip on their own input rather than trusting the caller, because
 * that is the property `tests/ci/operation-literal-parsing.test.ts` pins: fed a
 * raw literal whose comment names one value and whose code names another, the
 * CODE value wins.
 */
export const literalString = (source, key) => {
  const m = new RegExp(`\\b${key}\\s*:\\s*['"\`]([^'"\`]*)['"\`]`).exec(
    stripComments(source ?? '')
  );
  return m ? m[1] : null;
};

/** The boolean-flag form of `literalString`, comment-blind for the same reason. */
export const literalTrue = (source, key) =>
  new RegExp(`\\b${key}\\s*:\\s*true\\b`).test(stripComments(source ?? ''));

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
 * Scans every `defineOperation({...})` in the API application's source tree,
 * returning a Map of id -> facts. `surface` is derived from WHERE the
 * registration lives: an operation registered inside an App Router `route.ts`
 * is reachable over HTTP and is therefore public API surface; anything else is
 * internal.
 *
 * `root` is the REPOSITORY root, not the application root — the returned
 * `source` paths are repository-relative so the generated evidence means the
 * same thing wherever it is read. The application sub-path comes from the path
 * authority, never from a literal here.
 */
export function scanRegisteredOperations(root = REPOSITORY_ROOT) {
  const src = join(root, API_SRC_PATH);
  const operations = new Map();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    // `withFileTypes` answers "directory?" from the directory read itself, so
    // there is no second lookup that could disagree with the first.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const rel = toPosix(relative(root, full));
      if (rel.endsWith('server/auth/operation-registry.ts')) continue;
      /*
       * Stripped ONCE, for the brace balancing rather than for the field reads.
       *
       * `literalAt` counts `{` and `}` with no idea which are code, so a comment
       * that mentions `defineOperation()` in prose — six do today, in
       * `server/audit/audit.ts` and `server/auth/audit-actions.ts` — sends the
       * scanner hunting the next `{` in the file and slicing a "literal" that
       * spans whatever follows. Those six survive only because the slice happens
       * to contain no `id:`, which is luck, not a rule. A comment that spelled a
       * full literal would register a phantom operation the gate then demands
       * evidence for; a commented-out OLD registration sitting after the real one
       * would be worse, because `operations.set` is last-write-wins and the dead
       * copy's facts would replace the live ones.
       *
       * Measured before and after on this tree: identical id sets, identical
       * facts. This closes the hole rather than repairing damage.
       */
      const source = stripComments(readFileSync(full, 'utf8'));
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
              surface:
                rel.startsWith(`${API_ROUTES_PATH}/`) && /\/route\.tsx?$/.test(rel)
                  ? 'public-api'
                  : 'internal',
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
  if (!isDerivedId(operation.id)) {
    // The ONE derived obligation that is not namespace-scoped.
    //
    // `idempotent: true` is a promise made to the CALLER — retry this and you
    // will not double-write, double-audit or double-publish — and the caller
    // cannot see which phase delivered the route. A promise that creates an
    // obligation in `shared.` but not in `iam.` is not a weaker gate, it is an
    // inconsistent one, and CSA-22 is what that inconsistency looked like in
    // practice: ten P1-14 operations declared idempotency, `derived` came back
    // empty for every one of them, and nothing ever exercised a replay.
    //
    // The rest of the derived floor deliberately stays namespace-scoped. This is
    // not a general re-interpretation of P1-14's evidence model — it adds the
    // single obligation the operation created for itself by declaring the flag,
    // and only to operations that declare it. An operation that says nothing
    // about idempotency is unaffected, so the gate can only get stricter.
    return operation.idempotent ? [EVIDENCE_KEY_IDEMPOTENCY] : [];
  }

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
    // with P1-17, `apt`/`rec` with P1-18, `wo`/`tech`/`dia`/`qms` with P1-19,
    // `svc`/`quo` with P1-20, `inv` with P1-21, and `sal`/`wty` with P1-22. The
    // prefix list is explicit rather
    // than a wildcard so a typo in a declaration is a missing flag — which fails
    // the gate — instead of a silently accepted new namespace. Forgetting to add a
    // namespace here makes EVERY declaration for it invisible, so a new phase must
    // extend this alternation in the same commit that registers its operations.
    const m =
      /^\s*\*?\s*((?:iam|meta|shared|crm|veh|apt|rec|wo|tech|dia|qms|svc|quo|inv|sal|wty|rpt|platform|org)\.[a-z0-9-]+)\s*:\s*([a-z0-9 \-]+?)\s*$/.exec(
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
 *
 * It serves TWO readers, and both need the same lexer. Test files come through
 * here so prose cannot stand in for a test, as above; API source comes through
 * `scanRegisteredOperations` and `literalString`/`literalTrue` so a comment
 * beside a `defineOperation` key cannot be read as the declaration. The second
 * caller is why the string-awareness is load-bearing twice over — an operation's
 * `path` and `summary` are string literals that contain `//`.
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
      const strict = [
        ...P1_18_PREFIXES,
        ...P1_19_PREFIXES,
        ...P1_20_PREFIXES,
        ...P1_21_PREFIXES,
        ...P1_22_PREFIXES,
      ].some((prefix) => id.startsWith(prefix));
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
    //
    // P1-22 (`sal.`/`wty.`) opts in for a reason worth stating plainly: the phase
    // must report `metadata-only 0` and `unit-only 0` as acceptance criteria, and
    // a namespace absent from THIS list computes both as `false` for every row.
    // The counts would then read 0 because nothing was ever measured, not because
    // nothing was wrong — a vacuous green of exactly the kind this gate exists to
    // prevent.
    //
    // `inv.` (P1-21) is opted in at the same time, and the merged-phase caution
    // above is why it needed a measurement first rather than an assumption. P1-21
    // shipped both derived hooks but neither structural one and no phase-count
    // block, so adding the block alone would have printed an unmeasured
    // `P1-21 metadata-only: 0`. Opting the namespace in was measured before it was
    // done: across all 14 `inv.` operations, metadata-only 0, unit-only 0,
    // invocation-only 0, internal-without-reason 0, and 0 failing the strict
    // comment ratchet. It costs nothing and makes the printed figure true, which
    // is the opposite of the `crm.`/`veh.` case — those genuinely fail 38 rows and
    // stay out, as P1-18-R-02 records.
    const isDerived =
      id.startsWith(DERIVED_PREFIX) ||
      [
        ...P1_18_PREFIXES,
        ...P1_19_PREFIXES,
        ...P1_20_PREFIXES,
        ...P1_21_PREFIXES,
        ...P1_22_PREFIXES,
      ].some((p) => id.startsWith(p));
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
        `${id}: registered outside ${API_ROUTES_PATH}/**/route.ts but carries no manifest internalReason`
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
  // P1-21 spans one namespace.
  const p1_21Rows = matrix.filter((m) => P1_21_PREFIXES.some((p) => m.id.startsWith(p)));
  // P1-22 spans two namespaces, so its phase row set is their union.
  const p1_22Rows = matrix.filter((m) => P1_22_PREFIXES.some((p) => m.id.startsWith(p)));
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
    p1_21: phaseCounts(p1_21Rows),
    p1_22: phaseCounts(p1_22Rows),
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
  const ROOT = REPOSITORY_ROOT;
  const jsonOutput = process.argv.includes('--json');
  const readFile = (rel) => {
    // Read first, interpret the failure: absent is legitimate here, unreadable
    // is not, and the two-step form could not tell them apart.
    try {
      return readFileSync(join(ROOT, rel), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
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

  await writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-21', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts: counts.p1_21,
      operations: matrix.filter((m) => P1_21_PREFIXES.some((p) => m.id.startsWith(p))),
    }
  );

  await writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-22', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts: counts.p1_22,
      operations: matrix.filter((m) => P1_22_PREFIXES.some((p) => m.id.startsWith(p))),
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
    const v = counts.p1_21;
    console.log('');
    console.log(`P1-21 registered public operations: ${v.registered}`);
    console.log(`P1-21 operation-depth: ${v.operationDepth}`);
    console.log(`P1-21 invocation-only: ${v.invocationOnly}`);
    console.log(`P1-21 pending: ${v.pending}`);
    console.log(`P1-21 unit-only: ${v.unitOnly}`);
    console.log(`P1-21 unreferenced: ${v.unreferenced}`);
    console.log(`P1-21 metadata-only: ${v.metadataOnly}`);
    const w = counts.p1_22;
    console.log('');
    console.log(`P1-22 registered public operations: ${w.registered}`);
    console.log(`P1-22 operation-depth: ${w.operationDepth}`);
    console.log(`P1-22 invocation-only: ${w.invocationOnly}`);
    console.log(`P1-22 pending: ${w.pending}`);
    console.log(`P1-22 unit-only: ${w.unitOnly}`);
    console.log(`P1-22 unreferenced: ${w.unreferenced}`);
    console.log(`P1-22 metadata-only: ${w.metadataOnly}`);
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
