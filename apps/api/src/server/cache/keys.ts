/**
 * Cache key factory (P1-13 caching foundation).
 *
 * Keys are built here and nowhere else. Hand-concatenated keys are how a cache
 * serves one tenant's data to another: someone writes `` `partner:${id}` ``,
 * forgets the tenant, and the bug is invisible until two tenants happen to share
 * an id space — or until an id is guessable.
 *
 * Four properties are enforced structurally:
 *
 *  1. **Versioned.** `SERIALIZATION_VERSION` is part of every key, so changing a
 *     cached value's shape cannot serve an old shape to new code. Deploying a
 *     shape change is a version bump, not a cache flush people forget to run.
 *  2. **Environment-namespaced.** A shared cache instance across environments
 *     cannot cross-serve.
 *  3. **Module-namespaced.** Two modules cannot collide on a common noun.
 *  4. **Tenant-aware and collision-proof.** Every segment is length-prefixed, so
 *     no combination of segment *contents* can forge another key: `a|bc` and
 *     `ab|c` produce different keys, and a value containing the separator is
 *     harmless.
 *
 * A key for tenant-owned data without a tenant is not expressible: `tenantKey()`
 * requires the tenant, and `platformKey()` is a separate, deliberately-named call.
 */

/**
 * Bumped whenever a cached value's serialized shape changes in a way that old
 * readers would misinterpret.
 */
export const SERIALIZATION_VERSION = 1;

function segment(label: string, value: string): string {
  return `${label}:${value.length}:${value}`;
}

function environment(): string {
  return process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? 'local';
}

export interface TenantKeyInput {
  readonly module: string;
  /** Logical entity or query name, e.g. `partner`, `price-list`. */
  readonly entity: string;
  readonly tenantId: string;
  readonly companyId?: string | null;
  readonly branchId?: string | null;
  /** Remaining discriminators, e.g. an id or a normalised filter hash. */
  readonly parts?: readonly string[];
}

/** Key for tenant-owned data. The tenant is mandatory and always present. */
export function tenantKey(input: TenantKeyInput): string {
  const segments = [
    segment('v', String(SERIALIZATION_VERSION)),
    segment('env', environment()),
    segment('mod', input.module),
    segment('ent', input.entity),
    segment('tnt', input.tenantId),
  ];
  if (input.companyId) segments.push(segment('cmp', input.companyId));
  if (input.branchId) segments.push(segment('brn', input.branchId));
  for (const part of input.parts ?? []) segments.push(segment('p', part));
  return segments.join('|');
}

export interface PlatformKeyInput {
  readonly module: string;
  readonly entity: string;
  readonly parts?: readonly string[];
}

/**
 * Key for genuinely tenant-neutral platform data (currency list, locale
 * catalogue). Separately named so choosing it is a deliberate act that a
 * reviewer sees, not an omission.
 */
export function platformKey(input: PlatformKeyInput): string {
  const segments = [
    segment('v', String(SERIALIZATION_VERSION)),
    segment('env', environment()),
    segment('mod', input.module),
    segment('ent', input.entity),
    segment('tnt', '-platform-'),
  ];
  for (const part of input.parts ?? []) segments.push(segment('p', part));
  return segments.join('|');
}

/**
 * Namespace prefix for invalidation. Deleting by this prefix removes every key
 * for one entity within one tenant and nothing else.
 */
export function tenantNamespace(input: Omit<TenantKeyInput, 'parts'>): string {
  return tenantKey({ ...input, parts: [] });
}

/** Extracts the tenant segment. Used by the cross-tenant collision test. */
export function tenantOfKey(key: string): string | null {
  const marker = '|tnt:';
  const at = key.indexOf(marker);
  if (at < 0) return null;
  const rest = key.slice(at + marker.length);
  const colon = rest.indexOf(':');
  if (colon < 0) return null;
  const length = Number(rest.slice(0, colon));
  if (!Number.isInteger(length)) return null;
  return rest.slice(colon + 1, colon + 1 + length);
}
