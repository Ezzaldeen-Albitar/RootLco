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
const DERIVED_PREFIXES = [DERIVED_PREFIX, P1_16_PREFIX];
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
    // `shared` joined `iam` and `meta` with P1-15; `crm` joins with P1-16. The
    // prefix list is explicit rather than a wildcard so a typo in a declaration
    // is a missing flag — which fails the gate — instead of a silently accepted
    // new namespace.
    const m = /^\s*\*?\s*((?:iam|meta|shared|crm)\.[a-z0-9-]+)\s*:\s*([a-z0-9 \-]+?)\s*$/.exec(
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
 * Removes the COVERAGE-EVIDENCE declaration block from a file's text, so the
 * "is this operation actually invoked?" check cannot be satisfied by the machine
 * -readable declaration itself. After stripping, the operation id must still
 * appear in the file — in the "Operations exercised here" listing and, for the
 * write operations, the `describe`/`it` bodies that invoke the service — for the
 * operation to count as referenced.
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
      const inThisFile = source != null && stripCoverageBlock(source).includes(id);
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

    const isDerived = id.startsWith(DERIVED_PREFIX);
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
  };
  return { failures, matrix, counts };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function writeMatrix(path, payload) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2) + '\n');
  } catch {
    /* evidence dir may be absent in some checkouts; not fatal to the gate */
  }
}

function runCli() {
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
  writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-14', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts,
      operations: matrix,
    }
  );
  writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-15', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts: counts.p1_15,
      operations: matrix.filter((m) => m.id.startsWith(DERIVED_PREFIX)),
    }
  );
  writeMatrix(
    join(ROOT, 'docs', 'phase-1', 'phase-1-16', 'evidence', 'operation-test-matrix.json'),
    {
      generatedFrom,
      counts: counts.p1_16,
      operations: matrix.filter((m) => m.id.startsWith(P1_16_PREFIX)),
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
  runCli();
}
