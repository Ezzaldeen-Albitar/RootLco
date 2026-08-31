/**
 * `iam` module — public surface (P1-14).
 *
 * The ONLY legal import path for this module (ADR-001). Everything under
 * `application/`, `domain/`, `data/`, `provider/`, and `auth/` is internal: the
 * boundary checker and the ESLint rule both reject `@/modules/iam/<anything>`.
 *
 * ## What is exported, and what deliberately is not
 *
 * Services and their result types are exported. Repositories are not — handing
 * one out would let a caller run SQL under this module's identity and bypass the
 * delegation, last-holder, and audit rules that only the services apply. The
 * `IdentityProvider` **type** is exported so composition and tests can install
 * an adapter; the Supabase adapter and the fake are exported for the same
 * reason, and neither is constructed here except through `installIamRuntime()`.
 *
 * ## Composition installs the authenticator
 *
 * `installIamRuntime()` is what turns the P1-13 foundation from "fails closed
 * because nothing is configured" into a working authentication path: it builds
 * the provider adapter from configuration and registers a
 * `BearerSessionAuthenticator` through the seam P1-13 left. It is called once,
 * lazily, from the module factory — so importing this module in a unit test that
 * never touches a route does not require provider configuration.
 */
import { composeModule } from '@/server/layering';
import { setSessionAuthenticator } from '@/server/context/principal';
import { backendConfig } from '@/server/config/backend-config';
import { clientEnv, serverEnv } from '@/config/env';
import { AppFailure } from '@/server/errors/app-failure';

import { IdentityRepository } from './data/identity-repository';
import { AuthorizationRepository } from './data/authorization-repository';
import { OrganizationRepository } from './data/organization-repository';
import { OrganizationAdministrationRepository } from './data/organization-administration-repository';
import { AuditRepository } from './data/audit-repository';

import { IdentityPolicy } from './domain/identity-policy';
import { DelegationPolicy } from './domain/delegation-policy';
import { CredentialPolicy } from './domain/credential-policy';

import { AuthenticationService } from './application/authentication-service';
import { IdentityDirectoryService } from './application/identity-directory-service';
import { InvitationService } from './application/invitation-service';
import { UserAdministrationService } from './application/user-administration-service';
import { AccessAdministrationService } from './application/access-administration-service';
import { OrganizationSettingsService } from './application/organization-settings-service';
import { OrganizationAdministrationService } from './application/organization-administration-service';
import { AuditViewService } from './application/audit-view-service';

import {
  identityProvider,
  setIdentityProvider,
  UnconfiguredIdentityProvider,
  type IdentityProvider,
} from './provider/identity-provider';
import { SupabaseIdentityProvider } from './provider/supabase-provider';
import { BearerSessionAuthenticator } from './auth/bearer-authenticator';

export type {
  IdentityProvider,
  ProviderIdentity,
  ProviderSession,
} from './provider/identity-provider';
export { ProviderFailure, setIdentityProvider } from './provider/identity-provider';
export { FakeIdentityProvider } from './provider/fake-provider';
export { BearerSessionAuthenticator } from './auth/bearer-authenticator';
export { verifyBearerToken } from './provider/token-verifier';
export { IdentityPolicy } from './domain/identity-policy';
export { DelegationPolicy } from './domain/delegation-policy';
export { CredentialPolicy } from './domain/credential-policy';
export { USER_ORDERING } from './data/identity-repository';
export { ROLE_ORDERING } from './data/authorization-repository';
export { AUDIT_ORDERING } from './data/audit-repository';
export type { LoginResult, SessionSummary } from './application/authentication-service';
export type { UserView, UserDetailView } from './application/user-administration-service';
/**
 * The identity projection a ledger needs to name an actor (`P1-27-INT-026`).
 *
 * Two fields, `id` and `displayName`. Published so a module holding an actor id
 * can compose `iamDirectory().directory.resolveDisplayIdentities` rather than
 * joining `iam.user_accounts` itself — the same shape as the CRM module's
 * partner-identity surface.
 */
export type { UserDisplayIdentity } from './data/identity-repository';
export type { SettingView, TenantSettingsView } from './application/organization-settings-service';

/**
 * Builds the Supabase adapter from configuration.
 *
 * Throws rather than degrading: an authentication provider that is "partly
 * configured" would fail at the first login with an opaque error instead of at
 * boot with a precise one. `serverEnv()` refuses to run in a browser, so the
 * service-role key cannot reach a client bundle through this path.
 */
function buildProviderFromConfig(): IdentityProvider {
  const config = backendConfig();
  const server = serverEnv();
  const client = clientEnv();

  const missing: string[] = [];
  if (!server.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!config.AUTH_JWT_SECRET) missing.push('AUTH_JWT_SECRET');
  if (!config.AUTH_JWT_ISSUER) missing.push('AUTH_JWT_ISSUER');
  if (missing.length > 0) {
    // Names only, never values.
    throw new AppFailure('ERR-SYS-001', {
      message: `Authentication provider is not configured; missing: ${missing.join(', ')}`,
    });
  }

  return new SupabaseIdentityProvider({
    url: client.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: client.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: server.SUPABASE_SERVICE_ROLE_KEY as string,
    jwtSecret: config.AUTH_JWT_SECRET as string,
    issuer: config.AUTH_JWT_ISSUER as string,
    audience: config.AUTH_JWT_AUDIENCE,
    algorithms: config.AUTH_JWT_ALGORITHMS,
    clockSkewSeconds: config.AUTH_CLOCK_SKEW_SECONDS,
    providerName: config.AUTH_IDENTITY_PROVIDER,
  });
}

/**
 * Installs the runtime provider and authenticator.
 *
 * Idempotent and test-friendly: if a provider has already been installed — by a
 * test harness calling `setIdentityProvider()` with the fake — it is used as is,
 * and no configuration is read. That is what lets the whole suite run with no
 * provider credentials, as ADR-019 requires.
 */
export function installIamRuntime(): IdentityProvider {
  let provider = identityProvider();
  if (provider instanceof UnconfiguredIdentityProvider) {
    provider = buildProviderFromConfig();
    setIdentityProvider(provider);
  }
  setSessionAuthenticator(new BearerSessionAuthenticator(provider));
  return provider;
}

/**
 * The provider-free composition root (`P1-27-INT-026`).
 *
 * ## Why there are two roots for one module
 *
 * `iamModule()` below calls `installIamRuntime()`, which builds the Supabase
 * adapter from configuration and reads `clientEnv()`. That is right for the
 * authentication and administration surfaces, which cannot work without a
 * provider — and wrong for a caller that only wants to turn an actor id into a
 * name. Composing `iamModule()` for that makes an unrelated domain read depend
 * on `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and answer
 * `ERR-SYS-001` wherever they are unset.
 *
 * Measured, not feared: wiring the vehicle history read to `iamModule()` turned
 * two green backend tests into 500s. And the repository already knew — the P1-20
 * discount-approval work refused to route a permission check through
 * `@/modules/iam` for exactly this reason, twice, in
 * `server/auth/authorization.ts:171-174` and `:232-233`. It routed around the
 * wall; this removes it.
 *
 * `composeModule` memoises per closure rather than per module name, so the two
 * roots are independent and neither can boot the other. `iamModule()` is
 * unchanged: every existing consumer, and the authenticator installation that
 * depends on it, behaves exactly as before.
 *
 * Nothing that needs an `IdentityProvider` may be added here, and that rule is
 * held by a TEST, not by the compiler.
 *
 * An earlier version of this paragraph claimed otherwise — "a service that
 * needed a provider could not be constructed in this factory without the type
 * system objecting". It can. `IdentityDirectoryService`'s constructor takes only
 * the repository, but nothing stops a SECOND, provider-taking service being
 * added to the object below; a reviewer compiled exactly that mutation. What
 * catches it is `tests/foundation/iam-directory-composition.test.ts`, which
 * composes this root with every provider variable unset and asserts it does not
 * throw — and asserts, in the same file, that `iamModule()` under the identical
 * environment still does. Adding `installIamRuntime()` here fails four of its
 * five cases.
 *
 * Recording that distinction matters: a comment claiming a compiler guarantee
 * that does not exist is how this phase's defects have repeatedly survived.
 */
export const iamDirectory = composeModule({
  module: 'iam',
  create: () => ({
    directory: new IdentityDirectoryService(new IdentityRepository()),
  }),
});

/**
 * Composition root. Services are constructed once per process; the provider is
 * resolved per call so a test that swaps the provider between cases is not
 * fighting a memoised adapter.
 */
export const iamModule = composeModule({
  module: 'iam',
  create: () => {
    const identities = new IdentityRepository();
    const authorization = new AuthorizationRepository();
    const organization = new OrganizationRepository();
    // A SEPARATE repository from settings: settings are append-only version rows
    // and administration is an in-place update. One class behind two write models
    // is how a rule ends up applied to the wrong one.
    const organizationAdministration = new OrganizationAdministrationRepository();
    const audit = new AuditRepository();

    const identityPolicy = new IdentityPolicy();
    const delegationPolicy = new DelegationPolicy();
    const credentialPolicy = new CredentialPolicy();

    const provider = installIamRuntime();

    return {
      authentication: new AuthenticationService(
        provider,
        identities,
        authorization,
        identityPolicy,
        credentialPolicy
      ),
      invitations: new InvitationService(
        provider,
        identities,
        authorization,
        identityPolicy,
        credentialPolicy,
        delegationPolicy
      ),
      users: new UserAdministrationService(
        provider,
        identities,
        authorization,
        identityPolicy,
        delegationPolicy
      ),
      access: new AccessAdministrationService(
        authorization,
        identities,
        organization,
        delegationPolicy,
        credentialPolicy,
        identityPolicy
      ),
      organization: new OrganizationSettingsService(organization, authorization, delegationPolicy),
      organizationAdministration: new OrganizationAdministrationService(organizationAdministration),
      auditView: new AuditViewService(audit, authorization),
    };
  },
});
