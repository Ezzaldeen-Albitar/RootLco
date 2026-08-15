/**
 * The acceptance fixture API boundary and its local manifest values.
 *
 * The configured-workspace browser tier needs database identifiers returned by
 * the loopback API. It must not persist arbitrary response fields merely because
 * that API is local, so identifiers are rebuilt from a fixed UUID alphabet and
 * catalogue labels are accepted only when they match the fixtures defined in
 * the repository.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FixtureFailure,
  INTAKE_CATALOGUE_FIXTURES,
  PARTY_FIXTURE,
  UUID_ALPHABET,
  provisionIntakeCatalogues,
  provisionPartyAndVehicle,
  reconstructFixtureUuid,
} from '../../scripts/dev/owner-acceptance/acceptance-fixtures.mjs';
import { IDS, NAMES } from '../../scripts/dev/owner-acceptance/context.mjs';
import { composeFixtureManifest } from '../../scripts/dev/owner-acceptance/provision-acceptance-fixtures.mjs';

const LOWER_UUID = '12345678-90ab-cdef-1234-567890abcdef';
const UPPER_UUID = '12345678-90AB-CDEF-1234-567890ABCDEF';
const LOWER_VEHICLE_UUID = 'abcdef01-2345-6789-abcd-ef0123456789';
const UPPER_VEHICLE_UUID = 'ABCDEF01-2345-6789-ABCD-EF0123456789';

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reconstructFixtureUuid', () => {
  it('rebuilds a canonical UUID from the local alphabet', () => {
    expect(reconstructFixtureUuid(UPPER_UUID)).toBe(LOWER_UUID);
    for (const character of reconstructFixtureUuid(UPPER_UUID).replaceAll('-', '')) {
      expect(UUID_ALPHABET).toContain(character);
    }
  });

  it('refuses non-strings, wrong lengths, misplaced separators and foreign characters', () => {
    for (const value of [undefined, null, 42, {}, ['a']]) {
      expect(() => reconstructFixtureUuid(value)).toThrow(FixtureFailure);
    }
    expect(() => reconstructFixtureUuid(LOWER_UUID.slice(1))).toThrow(/36/);
    expect(() => reconstructFixtureUuid(LOWER_UUID.replace('-', '0'))).toThrow(/separator/);
    expect(() => reconstructFixtureUuid(`g${LOWER_UUID.slice(1)}`)).toThrow(/outside/);
  });
});

describe('provisionIntakeCatalogues', () => {
  it('returns only canonical identifiers and repository-defined catalogue fields', async () => {
    const fetch = vi.fn(async (url: string) => {
      const fixture = INTAKE_CATALOGUE_FIXTURES.find(({ path }) => url.includes(path));
      if (!fixture) throw new Error(`unexpected URL: ${url}`);
      return response({
        items: [
          {
            id: UPPER_UUID,
            code: fixture.code,
            name: fixture.name,
            injected: '<arbitrary network field>',
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetch);

    const result = await provisionIntakeCatalogues({
      apiOrigin: 'http://127.0.0.1:54321',
      token: 'test-token',
    });

    expect(fetch).toHaveBeenCalledTimes(INTAKE_CATALOGUE_FIXTURES.length);
    for (const fixture of INTAKE_CATALOGUE_FIXTURES) {
      expect(result[fixture.key]).toEqual({
        id: LOWER_UUID,
        code: fixture.code,
        name: fixture.name,
        created: false,
      });
      expect(result[fixture.key]).not.toHaveProperty('injected');
    }
  });

  it('canonicalises newly created catalogue responses too', async () => {
    const fetch = vi.fn(async (url: string, init?: { method?: string }) => {
      const fixture = INTAKE_CATALOGUE_FIXTURES.find(({ path }) => url.includes(path));
      if (!fixture) throw new Error(`unexpected URL: ${url}`);
      if (init?.method === 'GET') return response({ items: [] });
      return response(
        {
          id: UPPER_UUID,
          code: fixture.code,
          name: fixture.name,
          injected: '<arbitrary network field>',
        },
        201
      );
    });
    vi.stubGlobal('fetch', fetch);

    const result = await provisionIntakeCatalogues({
      apiOrigin: 'http://127.0.0.1:54321',
      token: 'test-token',
    });

    expect(fetch).toHaveBeenCalledTimes(INTAKE_CATALOGUE_FIXTURES.length * 2);
    for (const fixture of INTAKE_CATALOGUE_FIXTURES) {
      expect(result[fixture.key]).toEqual({
        id: LOWER_UUID,
        code: fixture.code,
        name: fixture.name,
        created: true,
      });
      expect(result[fixture.key]).not.toHaveProperty('injected');
    }
  });

  it('fails closed when an existing catalogue name has drifted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          items: [
            {
              id: LOWER_UUID,
              code: INTAKE_CATALOGUE_FIXTURES[0]?.code,
              name: 'network-chosen name',
            },
          ],
        })
      )
    );

    await expect(
      provisionIntakeCatalogues({
        apiOrigin: 'http://localhost:54321',
        token: 'test-token',
      })
    ).rejects.toThrow(/does not match/);
  });

  it('fails closed before returning a malformed catalogue identifier', async () => {
    const first = INTAKE_CATALOGUE_FIXTURES[0];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          items: [{ id: 'not-a-uuid', code: first?.code, name: first?.name }],
        })
      )
    );

    await expect(
      provisionIntakeCatalogues({
        apiOrigin: 'http://[::1]:54321',
        token: 'test-token',
      })
    ).rejects.toThrow(/UUID/);
  });

  it('does not turn a malformed page into permission to create', async () => {
    const fetch = vi.fn(async () => response({ hasMore: false }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      provisionIntakeCatalogues({
        apiOrigin: 'http://localhost:54321',
        token: 'test-token',
      })
    ).rejects.toThrow(/valid items array/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

const expectedCustomer = (id = UPPER_UUID, lifecycleStatus = 'active') => ({
  id,
  displayName: `${PARTY_FIXTURE.givenName} ${PARTY_FIXTURE.familyName}`,
  partyType: 'individual',
  lifecycleStatus,
});

const expectedVehicle = (id = UPPER_VEHICLE_UUID) => ({
  id,
  vin: PARTY_FIXTURE.vin,
  displayNumber: PARTY_FIXTURE.vehicleDisplayNumber,
  modelYear: PARTY_FIXTURE.modelYear,
  lifecycleStatus: 'draft',
});

describe('provisionPartyAndVehicle', () => {
  it('adopts only exact fixture identities and recognises a canonical-equivalent link', async () => {
    const fetch = vi.fn(async (url: string, init?: { method?: string }) => {
      expect(init?.method).toBe('GET');
      if (url.includes('/api/v1/customers?')) {
        return response({ items: [expectedCustomer(UPPER_UUID, 'prospect')] });
      }
      if (url.includes('/api/v1/vehicles?')) {
        return response({ items: [expectedVehicle()] });
      }
      if (url.includes('/vehicles?limit=50')) {
        return response({ items: [{ vehicleId: UPPER_VEHICLE_UUID, active: true }] });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);

    await expect(
      provisionPartyAndVehicle({
        apiOrigin: 'http://localhost:54321',
        token: 'test-token',
      })
    ).resolves.toEqual({
      customerId: LOWER_UUID,
      vehicleId: LOWER_VEHICLE_UUID,
      displayName: `${PARTY_FIXTURE.givenName} ${PARTY_FIXTURE.familyName}`,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('re-reads created records and binds the returned ids to exact fixture identities', async () => {
    let customerReads = 0;
    let vehicleReads = 0;
    const fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url.includes('/api/v1/customers?')) {
        customerReads += 1;
        return response({ items: customerReads === 1 ? [] : [expectedCustomer()] });
      }
      if (url.endsWith('/api/v1/customers/individuals')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init.body ?? '{}')).toEqual({
          givenName: PARTY_FIXTURE.givenName,
          familyName: PARTY_FIXTURE.familyName,
          lifecycleStatus: 'active',
        });
        return response({ customerId: UPPER_UUID, injected: 'discard me' }, 201);
      }
      if (url.includes('/api/v1/vehicles?')) {
        vehicleReads += 1;
        return response({ items: vehicleReads === 1 ? [] : [expectedVehicle()] });
      }
      if (url.endsWith('/api/v1/vehicles')) {
        expect(init?.method).toBe('POST');
        return response({ vehicleId: UPPER_VEHICLE_UUID, injected: 'discard me' }, 201);
      }
      if (url.includes('/vehicles?limit=50')) return response({ items: [] });
      if (url.includes(`/customers/${LOWER_UUID}/vehicles`)) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init.body ?? '{}')).toEqual({
          vehicleId: LOWER_VEHICLE_UUID,
          relationshipRole: PARTY_FIXTURE.relationshipRole,
        });
        return response({ relationshipId: LOWER_UUID }, 201);
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);

    const result = await provisionPartyAndVehicle({
      apiOrigin: 'http://127.0.0.1:54321',
      token: 'test-token',
    });

    expect(result.customerId).toBe(LOWER_UUID);
    expect(result.vehicleId).toBe(LOWER_VEHICLE_UUID);
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it('refuses an ambiguous configured customer rather than choosing the first', async () => {
    const fetch = vi.fn(async () =>
      response({ items: [expectedCustomer(), expectedCustomer(UPPER_VEHICLE_UUID)] })
    );
    vi.stubGlobal('fetch', fetch);

    await expect(
      provisionPartyAndVehicle({
        apiOrigin: 'http://localhost:54321',
        token: 'test-token',
      })
    ).rejects.toThrow(/more than one/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses an unusable exact-name customer rather than creating a duplicate', async () => {
    const fetch = vi.fn(async () =>
      response({ items: [expectedCustomer(UPPER_UUID, 'suspended')] })
    );
    vi.stubGlobal('fetch', fetch);

    await expect(
      provisionPartyAndVehicle({
        apiOrigin: 'http://localhost:54321',
        token: 'test-token',
      })
    ).rejects.toThrow(/not a usable acceptance individual/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a wrong vehicle returned for the exact VIN query', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/customers?')) return response({ items: [expectedCustomer()] });
      if (url.includes('/api/v1/vehicles?')) {
        return response({ items: [{ ...expectedVehicle(), vin: 'WRONGVIN000000001' }] });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);

    await expect(
      provisionPartyAndVehicle({
        apiOrigin: 'http://localhost:54321',
        token: 'test-token',
      })
    ).rejects.toThrow(/not the configured fixture/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refuses malformed customer, vehicle and relationship pages', async () => {
    for (const malformedCall of [1, 2, 3]) {
      let calls = 0;
      const fetch = vi.fn(async (url: string) => {
        calls += 1;
        if (calls === malformedCall) return response({ hasMore: false });
        if (url.includes('/api/v1/customers?')) return response({ items: [expectedCustomer()] });
        if (url.includes('/api/v1/vehicles?')) return response({ items: [expectedVehicle()] });
        return response({ items: [{ vehicleId: UPPER_VEHICLE_UUID, active: true }] });
      });
      vi.stubGlobal('fetch', fetch);

      await expect(
        provisionPartyAndVehicle({
          apiOrigin: 'http://localhost:54321',
          token: 'test-token',
        })
      ).rejects.toThrow(/valid items array/);
      expect(fetch).toHaveBeenCalledTimes(malformedCall);
      vi.unstubAllGlobals();
    }
  });

  it('validates every relationship identifier before deciding the fixture is linked', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/customers?')) return response({ items: [expectedCustomer()] });
      if (url.includes('/api/v1/vehicles?')) return response({ items: [expectedVehicle()] });
      return response({
        items: [
          { vehicleId: UPPER_VEHICLE_UUID, active: true },
          { vehicleId: 'not-a-uuid', active: false },
        ],
      });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(
      provisionPartyAndVehicle({
        apiOrigin: 'http://localhost:54321',
        token: 'test-token',
      })
    ).rejects.toThrow(/UUID/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('composeFixtureManifest', () => {
  it('emits the exact allow-list and no response-only field', () => {
    const timestamp = new Date('2026-08-15T10:00:00.000Z');
    const catalogues = Object.fromEntries(
      INTAKE_CATALOGUE_FIXTURES.map((fixture) => [
        fixture.key,
        {
          id: UPPER_UUID,
          code: fixture.code,
          name: fixture.name,
          created: true,
          injected: '<network sentinel>',
        },
      ])
    );
    const manifest = composeFixtureManifest(
      {
        catalogues,
        customerId: UPPER_UUID,
        vehicleId: UPPER_VEHICLE_UUID,
        displayName: `${PARTY_FIXTURE.givenName} ${PARTY_FIXTURE.familyName}`,
        injected: '<network sentinel>',
      },
      timestamp
    );

    expect(manifest).toEqual({
      warning:
        'LOCAL DEVELOPMENT ONLY. Synthetic acceptance fixtures, written through the ' +
        'published management contracts. Never commit this file.',
      provisionedAt: timestamp.toISOString(),
      tenantId: IDS.tenantC,
      tenantName: NAMES.tenantNameC,
      companyId: IDS.companyC,
      branchId: IDS.branchC,
      operatorEmail: NAMES.configuredEmail,
      catalogues: Object.fromEntries(
        INTAKE_CATALOGUE_FIXTURES.map((fixture) => [
          fixture.key,
          { id: LOWER_UUID, code: fixture.code, name: fixture.name },
        ])
      ),
      customerId: LOWER_UUID,
      customerDisplayName: `${PARTY_FIXTURE.givenName} ${PARTY_FIXTURE.familyName}`,
      vehicleId: LOWER_VEHICLE_UUID,
      vehicleDisplayNumber: PARTY_FIXTURE.vehicleDisplayNumber,
    });
    expect(JSON.stringify(manifest)).not.toContain('network sentinel');
    expect(manifest).not.toHaveProperty('openVisitsReleased');
  });
});
