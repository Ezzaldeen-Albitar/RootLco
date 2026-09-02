/**
 * P1-29 W9 — the Supabase identity adapter's password-completion path, pinned.
 *
 * Every authentication suite in this repository runs against the deterministic
 * `FakeIdentityProvider` (ADR-019: CI has no provider credentials and no
 * network), so the adapter that talks to the REAL provider had no test at all.
 * The W9 acceptance run, the first time a human set a credential through the
 * shipped routes against the real provider, found three defects in it that
 * every green tier had passed over:
 *
 *  1. the credential was written through a client that serves `updateUser`
 *     from its own stored session — with `persistSession: false` there is
 *     none, so every completion answered 401;
 *  2. an invitation's token hash is filed by the provider under `invite`, and
 *     only `recovery` was ever asked — every invited human was told the link
 *     had expired;
 *  3. "revoke every session" called an admin sign-out that takes a JWT, not a
 *     subject, and therefore never revoked anything.
 *
 * This suite mocks the provider's client library at the module boundary and
 * pins what the adapter now does: which token types it asks for and in what
 * order, that the credential is written by the service role for exactly the
 * verified identity, that the verified session is signed out everywhere, and
 * that nothing is written when no token type verifies. It is not evidence
 * about the real provider — the acceptance run is — but it makes the adapter's
 * behaviour a tested contract rather than an assumption.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      verifyOtp: client.verifyOtp,
      admin: { updateUserById: client.updateUserById },
    },
  })),
}));

import { ProviderFailure } from '@/modules/iam/provider/identity-provider';
import { SupabaseIdentityProvider } from '@/modules/iam/provider/supabase-provider';

const URL = 'http://provider.test';
const ANON_KEY = 'anon-key';

function provider(): SupabaseIdentityProvider {
  return new SupabaseIdentityProvider({
    url: URL,
    anonKey: ANON_KEY,
    serviceRoleKey: 'service-role-key',
    jwtSecret: 'x'.repeat(32),
    issuer: `${URL}/auth/v1`,
    audience: 'authenticated',
    algorithms: ['HS256'],
    clockSkewSeconds: 0,
    providerName: 'supabase',
  });
}

const user = {
  id: 'user-1',
  email: 'owner@example.test',
  email_confirmed_at: '2026-09-02T21:00:00Z',
  app_metadata: { tenant_id: 'tenant-1' },
};
const verifiedSession = { data: { session: { access_token: 'session-jwt' }, user }, error: null };
const refused = {
  data: { session: null, user: null },
  error: { status: 403, message: 'Token has expired or is invalid' },
};
const passwordWritten = { data: { user }, error: null };

const fetchMock = vi.fn();

beforeEach(() => {
  client.verifyOtp.mockReset();
  client.updateUserById.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function typesAsked(): string[] {
  return client.verifyOtp.mock.calls.map((call) => (call[0] as { type: string }).type);
}

describe('P1-29 W9 — password completion through the Supabase adapter', () => {
  it('verifies a recovery hash first and asks for nothing else when it holds', async () => {
    client.verifyOtp.mockResolvedValueOnce(verifiedSession);
    client.updateUserById.mockResolvedValueOnce(passwordWritten);

    const identity = await provider().completePasswordReset('hash-1', 'new-password');

    expect(typesAsked()).toEqual(['recovery']);
    expect(client.verifyOtp.mock.calls[0]?.[0]).toEqual({ token_hash: 'hash-1', type: 'recovery' });
    expect(identity.subject).toBe('user-1');
    expect(identity.email).toBe('owner@example.test');
  });

  it('falls back to the invitation type when the hash is not filed under recovery', async () => {
    client.verifyOtp.mockResolvedValueOnce(refused).mockResolvedValueOnce(verifiedSession);
    client.updateUserById.mockResolvedValueOnce(passwordWritten);

    const identity = await provider().completePasswordReset('invite-hash', 'new-password');

    expect(typesAsked()).toEqual(['recovery', 'invite']);
    expect(client.verifyOtp.mock.calls[1]?.[0]).toEqual({
      token_hash: 'invite-hash',
      type: 'invite',
    });
    expect(identity.subject).toBe('user-1');
  });

  it('writes the credential by the service role for exactly the verified identity', async () => {
    client.verifyOtp.mockResolvedValueOnce(verifiedSession);
    client.updateUserById.mockResolvedValueOnce(passwordWritten);

    await provider().completePasswordReset('hash-1', 'new-password');

    expect(client.updateUserById).toHaveBeenCalledTimes(1);
    expect(client.updateUserById).toHaveBeenCalledWith('user-1', { password: 'new-password' });
  });

  it('signs the verified session out everywhere with the session it just verified', async () => {
    client.verifyOtp.mockResolvedValueOnce(verifiedSession);
    client.updateUserById.mockResolvedValueOnce(passwordWritten);

    await provider().completePasswordReset('hash-1', 'new-password');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toBe(`${URL}/auth/v1/logout?scope=global`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ apikey: ANON_KEY, Authorization: 'Bearer session-jwt' });
  });

  it('writes nothing and signs nothing out when neither token type verifies', async () => {
    client.verifyOtp.mockResolvedValueOnce(refused).mockResolvedValueOnce(refused);

    await expect(provider().completePasswordReset('stale', 'new-password')).rejects.toBeInstanceOf(
      ProviderFailure
    );

    expect(typesAsked()).toEqual(['recovery', 'invite']);
    expect(client.updateUserById).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not try the second type when the provider is unreachable on the first', async () => {
    client.verifyOtp.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const failure = await provider()
      .completePasswordReset('hash-1', 'new-password')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderFailure);
    expect((failure as ProviderFailure).reason).toBe('provider-unavailable');
    expect((failure as ProviderFailure).retryable).toBe(true);
    expect(typesAsked()).toEqual(['recovery']);
    expect(client.updateUserById).not.toHaveBeenCalled();
  });

  it('refuses a credential write the provider rejected, and signs nothing out', async () => {
    client.verifyOtp.mockResolvedValueOnce(verifiedSession);
    client.updateUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 422, message: 'Password should be at least 8 characters' },
    });

    await expect(provider().completePasswordReset('hash-1', 'short')).rejects.toBeInstanceOf(
      ProviderFailure
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])(
    'tolerates a %i from the global sign-out — the sessions are already gone',
    async (status) => {
      client.verifyOtp.mockResolvedValueOnce(verifiedSession);
      client.updateUserById.mockResolvedValueOnce(passwordWritten);
      fetchMock.mockResolvedValueOnce({ ok: false, status });

      await expect(
        provider().completePasswordReset('hash-1', 'new-password')
      ).resolves.toBeDefined();
    }
  );

  it('reports a sign-out the provider refused for any other reason', async () => {
    client.verifyOtp.mockResolvedValueOnce(verifiedSession);
    client.updateUserById.mockResolvedValueOnce(passwordWritten);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const failure = await provider()
      .completePasswordReset('hash-1', 'new-password')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderFailure);
    expect((failure as ProviderFailure).reason).toBe('provider-rejected');
  });
});

describe('P1-29 W9 — revoking every session by subject', () => {
  it('is an honest no-op: the provider offers no revoke-by-subject (residual W9-R1)', async () => {
    await expect(provider().revokeAllSessions('user-1')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still refuses a blank subject', async () => {
    await expect(provider().revokeAllSessions('   ')).rejects.toBeInstanceOf(ProviderFailure);
  });
});

describe('P1-29 W9 — binding an identity to a tenant', () => {
  it('writes the binding into administrator-only metadata for exactly that subject', async () => {
    client.updateUserById.mockResolvedValueOnce({
      data: { user: { ...user, app_metadata: { tenant_id: 'tenant-2' } } },
      error: null,
    });

    const identity = await provider().bindTenant('user-1', 'tenant-2');

    expect(client.updateUserById).toHaveBeenCalledTimes(1);
    expect(client.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { tenant_id: 'tenant-2' },
    });
    expect(identity.tenantId).toBe('tenant-2');
  });

  it('reports a binding the provider refused', async () => {
    client.updateUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 404, message: 'User not found' },
    });

    await expect(provider().bindTenant('nobody', 'tenant-2')).rejects.toBeInstanceOf(
      ProviderFailure
    );
  });
});
