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
import { AuditRepository } from './data/audit-repository';

import { IdentityPolicy } from './domain/identity-policy';
import { DelegationPolicy } from './domain/delegation-policy';
import { CredentialPolicy } from './domain/credential-policy';

import { AuthenticationService } from './application/authentication-service';
import { InvitationService } from './application/invitation-service';
import { UserAdministrationService } from './application/user-administration-service';
import { AccessAdministrationService } from './application/access-administration-service';
import { OrganizationSettingsService } from './application/organization-settings-service';
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
      auditView: new AuditViewService(audit, authorization),
    };
  },
});
