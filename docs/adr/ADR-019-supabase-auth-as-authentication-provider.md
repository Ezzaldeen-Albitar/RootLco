# ADR-019: Supabase Auth as Authentication Provider

## Status

Accepted by owner instruction — for the authentication and session provider, for the division of
responsibility between the provider and the RootLco IAM contracts, and for the adapter boundary that
keeps application services free of provider SDK details. Binding on every backend phase from Phase
1-14 onward.

**Open — for the hosted Supabase project, its region, and its commercial plan.** ADR-003 already
records those as Open and this record does not change them. Only the official Supabase CLI Docker
stack exists (Local). Nothing here claims a hosted authentication service is provisioned, that any
availability or throughput figure has been observed, or that production credentials exist.

**Open — for multi-factor authentication, single sign-on, SAML, SCIM, and social identity
providers.** All are out of Phase 1-14 scope. The adapter boundary is drawn so that adding one later
is a change behind the port rather than a change to every application service, but no such provider
is selected, configured, or approved.

## Context

Phase 1-13 delivered the backend foundation and deliberately stopped one step short of
authentication. `src/server/context/principal.ts` fixes the contract — a `SessionAuthenticator` port
returning `PrincipalClaims { identityProvider, providerSubject, tenantId }` — and installs an
`UnconfiguredAuthenticator` that returns `null`, so every authenticated operation answers
`ERR-IAM-002` until Phase 1-14 installs a real one. The phase gate recorded the provider decision as
the open item `AUTH-PROVIDER`, with the stated reason that Phase 1-14 owns it.

Three facts constrain the decision, and all three were verified in the repository and the database
before it was taken rather than assumed:

1. **No ADR forbids Supabase Auth, and ADR-003 actively supports it.** ADR-001 … ADR-018 and the
   register itself were inspected. ADR-003 is the only record touching authentication technology. It
   names Supabase as the platform layer around PostgreSQL "providing authentication", and it
   explicitly rejects two alternatives that would otherwise be live here: hand-built authentication
   (recorded as "a disproportionate risk to carry") and a project-owned Compose file assembling
   GoTrue and the other Supabase services by hand.

2. **The database stores no credential material and is designed not to.** `iam.user_accounts` holds
   `identity_provider` and `provider_subject` and no password, hash, MFA secret, or token column;
   `identity-authorization-schema-design.md` states the rule directly. The frozen schema therefore
   already assumes an external identity provider — the only undecided part was which one.

3. **Authorization already lives in the database and is not negotiable.** `iam.has_permission`,
   `iam.has_permission_in_scope`, deny precedence, grant validity windows, scope matching, and the
   nineteen permission-gated write policies added by DBCR-P1-14-001 are the authorization system.
   Re-deriving any of that from provider claims would create a second source of truth whose drift
   would be silent until it was a breach.

The question this record answers is therefore narrow: **who verifies credentials and issues
sessions**, and **what a verified session is allowed to assert**.

## Decision

**Supabase Auth (GoTrue) is the authentication and session provider. The RootLco PostgreSQL IAM and
organization contracts remain the sole source of truth for authorization and business scope.**

### Supabase Auth is responsible for

- Credential verification (email and password in Phase 1-14).
- Provider identities and the provider subject (`sub`).
- Password lifecycle: setting, changing, resetting, and the strength policy the provider enforces.
- Session issuance, access tokens, refresh tokens, and their expiry.
- The invitation and password-reset token primitives, including single use and time bounds.
- Email confirmation of an invited identity.

### RootLco IAM and organization contracts are responsible for

- Whether an application user exists at all, and its lifecycle state
  (`invited` / `active` / `locked` / `archived`).
- Tenant membership, and the company and branch scope of every grant.
- Roles, permission mappings, deny precedence, grant validity windows, and delegation limits.
- Approval limits.
- Whether a given operation is permitted, evaluated inside the request transaction.
- The audit chain and the security-event record.

### Five rules that follow, and are binding

1. **A provider session is a claim of identity, never a claim of authority.** After the provider
   verifies a token, the request still resolves the application user from
   `iam.user_accounts`, still resolves scope from `iam.role_grants` / `iam.grant_scopes`, and still
   evaluates every permission through `iam.has_permission`. A valid provider token for a user who is
   `locked`, `archived`, `invited`, or soft-deleted authorizes nothing: `iam.has_permission` returns
   false unless the account is `active`, at the database layer, regardless of what the token says.

2. **Mutable authorization state never enters a token.** Roles, permission codes, company and branch
   lists, and approval limits are read from the database on every request. Putting any of them into
   a JWT would make revocation take effect only at token expiry — the exact failure the phase
   forbids. Revocation is immediate because nothing cached it.

3. **The tenant binding is an identity lookup key, not authorization truth.** The provider's
   `app_metadata.tenant_id` — writable only by the service role, never by the end user — is carried
   as `PrincipalClaims.tenantId` and used exactly as Phase 1-13 specified: as a lookup key that must
   resolve to an active account holding that provider subject inside that tenant. A forged or stale
   tenant binding finds no account and is denied. It grants nothing on its own.

4. **The provider is reached only through a port.** `IdentityProvider` in
   `src/modules/iam` declares the eleven capabilities the phase needs; `SupabaseIdentityProvider` is
   the adapter, and `FakeIdentityProvider` is the deterministic test double. No application service,
   domain service, repository, or Route Handler imports a Supabase SDK type. Replacing the provider
   is a change to one file plus its tests.

5. **The service-role key is server-only and never leaves the server.** It bypasses RLS. It is read
   through `serverEnv()`, which throws in a browser; it is absent from every client bundle, asserted
   by `npm run security:browser-secrets`; and it never appears in a log, a metric label, an audit
   record, an event payload, or a problem document.

### Boundaries this record does not cross

- **Tenant provisioning and the first administrator remain an owner/operator capability** (ADR-008,
  DBCR-P1-14-001 §5.5). No policy added by Phase 1-14 lets an ordinary tenant administrator create
  the first administrator of a tenant, and this record does not weaken that.
- **Account status transitions are administrative.** The protected schema gates every write to
  `iam.user_accounts` and `iam.user_status_history` behind `iam.user.manage`, and
  `iam.stamp_user_status_history` forces the actor to be the current user. Self-service activation is
  therefore not expressible against the frozen schema; invitation acceptance happens in the provider
  and activation is an audited administrative action that verifies acceptance with the provider
  first. See the Authentication and Session Architecture record.

## Alternatives Considered

**Hand-built authentication inside the application.** Rejected. ADR-003 already rejected it in
general terms and the reasoning holds specifically: it would put password hashing, reset-token
issuance, session rotation, and timing-safe comparison into project code, each of which is a
well-understood way to introduce a vulnerability, and none of which is a differentiator for an
automotive CRM and ERP platform. It would also require credential columns the frozen schema
deliberately does not have.

**A separately-hosted identity provider (Auth0, Keycloak, Cognito, Entra ID).** Rejected for Phase
1-14, not on capability grounds — several are more capable — but because each introduces a second
vendor, a second hosting decision, and a second set of credentials into a project whose hosting
decisions are all still Open (ADR-012). Supabase is already the data platform of record; using its
authentication service adds no new vendor, no new network dependency in Local, and no new commercial
negotiation. The adapter boundary in rule 4 is what keeps this reversible: adopting one of these
later replaces one file.

**A project-owned GoTrue container.** Rejected. ADR-003 examined and rejected exactly this for the
whole Supabase service set, and nothing about authentication makes it a better idea in isolation: it
would mean owning the upgrade path, the JWT key rotation, and the operational surface of an identity
service for no gain over the CLI stack that already runs it.

**Putting roles and permissions into the JWT.** Rejected, and this is the alternative worth naming
explicitly because it is the conventional design. It is faster — no database round trip for
authorization — and it is wrong here for a specific reason: a revoked grant would continue to
authorize until the token expired. The phase requires that revocation take effect immediately
through current authorization checks. It also cannot express deny precedence over a scope hierarchy
without duplicating `iam.has_permission_in_scope` in a second language. The measured cost of the
correct design is one indexed function call per declared permission inside a transaction that is
already open.

## Consequences

- **Every protected request performs a database round trip to resolve the principal and scope.** That
  is accepted deliberately; see the rejected alternative above. No authorization result is cached,
  and `src/server/cache/eligibility.ts` continues to refuse to cache anything permission-dependent.
- **The application cannot authenticate when the provider is unreachable.** Login and session
  validation fail closed with a cataloged error. There is no local fallback credential path, and
  introducing one would defeat the decision.
- **Tests do not need a running provider.** `FakeIdentityProvider` implements the same port with
  deterministic behaviour, so unit, backend, and API suites run in CI with no provider credentials
  and no network access. A real-provider run is possible locally against the CLI stack and is
  evidenced separately when performed; it is never a CI requirement.
- **Two identity systems must stay reconciled.** A provider identity with no active RootLco account
  fails closed, and a RootLco account whose provider identity was deleted cannot authenticate. Both
  are correct, both are observable, and the reconciliation direction is fixed: RootLco IAM decides
  what a session may do, the provider decides whether a session exists.
- **Adding MFA, SSO, or a social provider later is a change behind the port**, plus whatever schema
  the additional factor genuinely requires. `iam.user_accounts.mfa_required` already exists as a
  flag; nothing enforces it in Phase 1-14 and nothing claims to.

## Security Impact

- **Credential material never enters the RootLco database, the application process, a log, or a
  backup.** The application forwards a password to the provider over the server-side client and
  never stores or logs it. `src/server/observability/redaction.ts` scrubs the token, password,
  cookie, and authorization families before any record is written.
- **Authorization is unchanged and remains database-enforced.** This record adds an authentication
  layer in front of the existing model; it removes no check. The nineteen write policies from
  DBCR-P1-14-001, FORCE RLS on all seventeen `iam` tables, and deny precedence all continue to apply
  to a request that arrives with a perfectly valid provider token.
- **Session revocation is terminal and immediate.** `iam.user_sessions` carries `revoked_at`, both
  UPDATE policies require `revoked_at IS NULL` in `USING`, so a revoked session cannot be
  resurrected; and context resolution refuses a request whose session row is revoked or idle-expired.
- **Enumeration is resisted at the boundary.** Login, password reset, and invitation responses are
  generic and do not distinguish unknown account, wrong password, locked account, or disabled
  account. The distinction is recorded server-side with the correlation ID.
- **The service-role key is the highest-value secret in the system.** It bypasses RLS entirely. Rule
  5 above is the control; `npm run security:browser-secrets` and `npm run security:tracked-secrets`
  are the automated checks.
- **A provider outage is a denial of service, not a denial of security.** Failing closed means an
  outage stops logins. That is the correct direction and is documented in the operator runbook.

## Operational Impact

- **New configuration**, all server-only, all validated with bounded defaults and never echoed by
  value: the provider URL, the service-role key, the expected JWT issuer and audience, the accepted
  signing algorithm, the permitted clock skew, the session idle timeout, and the allow-list of
  password-reset and invitation redirect destinations.
- **Local development is unchanged in shape.** The Supabase CLI stack already runs GoTrue
  (`supabase_auth_RootLco`); no new container, image, or port is introduced.
- **Runbooks are required and are delivered with the phase**: provider outage, session-revocation
  incident, credential and service-role rotation, and account-lock support.
- **No production monitoring is provisioned.** Metrics and log fields for login outcome, throttling,
  lock, revocation, and provider latency exist and are exercised in tests. Alert thresholds are
  proposed baselines pending measurement; P1-OD-027 (NFR-SCL) remains unresolved.
- **No capacity, failover, or availability figure is claimed** for authentication, because none has
  been measured in any environment beyond Local.

## Related Phase 1 Task and Requirement IDs

P1-14 (Authentication, Authorization, and Administration Backend); P1-13-BE-004 (authentication port
and server-side scope resolution); P1-13-SEC-002 (no client-supplied scope); P1-13-SEC-001
(authorization coverage); FR-IAM-002; BR-IAM-001 (deny precedence); FR-AUD-001; ADR-003 (data
platform); ADR-004 (mandatory RLS); ADR-008 (configuration-driven tenant onboarding);
DBCR-P1-14-001; open decision `AUTH-PROVIDER` (closed by this record); open decision P1-OD-027
(NFR-SCL, unresolved).

Identifiers prefixed `FR-`, `BR-`, `NFR-`, and `P1-OD-` are defined in the canonical Word documents,
which live outside this repository by owner decision — see
[../governance/canonical-documents.md](../governance/canonical-documents.md).

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner) for the provider selection, the responsibility
split, the adapter boundary, and the five binding rules — taken under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and reviewed under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md). This is
owner-authorized technical self-review and is never an independent third-party audit.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) for the still-Open commercial matters
inherited from ADR-003: the hosted Supabase project, its region, and its plan — none of which this
record decides.

## Date

2026-07-22
