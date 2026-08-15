/**
 * The CONFIGURED acceptance workspace, built through the product's own
 * published contracts.
 *
 * ## The question this answers
 *
 * `canonical-plan.md` §7 records `P1-28-OD-001`: the intake catalogues ship
 * empty, PR #227 published the 21 management writes that can fill them, and no
 * canonical P1-28 task binds a screen that reaches those writes. A brand-new
 * tenant therefore starts with zero appointment types, zero cancellation
 * reasons, zero fuel levels and zero warning-light codes — and four operator
 * capabilities are inert until somebody configures them.
 *
 * That leaves an acceptance environment able to evidence exactly one half of
 * four screens: the truthful unconfigured state. The other half — that booking,
 * cancelling, recording a fuel level and recording a lamp actually WORK once a
 * catalogue has rows — was unobservable in a browser, at any tier that talks to
 * a real database. This module makes it observable.
 *
 * ## Why this is not seeding, and how the line is drawn
 *
 * The permanent no-fake-data policy forbids fabricated BUSINESS ROWS shipping as
 * product defaults. Nothing here ships. There is no migration, no seed, no
 * fixture file under `supabase/` and no row written by `apps/`. Every row below
 * is created at RUN TIME, against a loopback development database, by an
 * authenticated HTTP call to the same published operation an administrator would
 * use — the same standard the Owner-acceptance account itself is held to
 * (`create-owner-account.mjs`: "every row goes through the platform's own
 * tables, constraints and triggers").
 *
 * Two consequences are stated rather than left to be discovered:
 *
 *   - **Tenant A is never touched by this module.** The Owner-acceptance
 *     workspace keeps its empty catalogues, so every assertion that the product
 *     states its unconfigured state truthfully still runs, in the same suite, in
 *     the same run. Both states are proved because two tenants hold them.
 *   - **These fixtures and `tests/db/no-fake-data.test.ts` are mutually
 *     exclusive**, exactly as the Owner-acceptance account already is: that test
 *     requires every business table in the live local database to be empty.
 *     `acceptance:full-cycle` is what keeps the two apart, and this module adds
 *     nothing new to that constraint — it adds rows to tables that were already
 *     non-empty the moment an acceptance tenant existed.
 *
 * ## Deterministic, idempotent, and obviously synthetic
 *
 * Every code is `acceptance_…` and every display name begins "Acceptance
 * fixture", so a row seen on a screen cannot be mistaken for a decided business
 * default. Provisioning READS each catalogue first and creates only what is
 * absent, so a second run reconciles instead of duplicating — and the create
 * carries a fresh idempotency key rather than a deterministic one, because a
 * deterministic key replayed after a database reset would answer 200 with the
 * identifier of a row that no longer exists.
 *
 * Local only: `provisionAcceptanceFixtures` refuses any API origin that is not
 * loopback.
 */
import { randomUUID } from 'node:crypto';

/** How everything here refuses. Mirrors `context.mjs`'s own failure type. */
export class FixtureFailure extends Error {}

/** Hosts that count as this machine. Same set as `context.mjs`. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** The only variable characters a database UUID may contribute to local state. */
export const UUID_ALPHABET = '0123456789abcdef';
const UUID_LENGTH = 36;
const UUID_SEPARATORS = new Set([8, 13, 18, 23]);

/**
 * Rebuilds an API-returned UUID from a local alphabet, or refuses it.
 *
 * ## Why this exists — `js/http-to-file-access`
 *
 * The provisioning command writes the identifiers needed by the browser tier
 * to a git-ignored local manifest. The API is loopback-only, but its response
 * is still a network trust boundary: persisting response fields verbatim would
 * let a compromised or misdirected service choose arbitrary file content.
 *
 * This is an allow-list, not a regex-shaped assertion followed by the original
 * value. Every emitted hexadecimal character comes from `UUID_ALPHABET`, every
 * separator comes from this module, and the input contributes only the index of
 * the constant character to copy. The output is therefore a canonical lowercase
 * UUID even when the API used uppercase hexadecimal.
 *
 * @param {unknown} value an identifier returned by the loopback API
 * @param {string} label the fixture field named in a refusal
 * @returns {string} the same UUID rebuilt entirely from local constants
 */
export function reconstructFixtureUuid(value, label = 'fixture identifier') {
  if (typeof value !== 'string') {
    throw new FixtureFailure(`${label} is absent or is not a string UUID.`);
  }
  if (value.length !== UUID_LENGTH) {
    throw new FixtureFailure(`${label} has ${value.length} characters; a UUID must have 36.`);
  }

  const out = [];
  for (let position = 0; position < UUID_LENGTH; position += 1) {
    if (UUID_SEPARATORS.has(position)) {
      if (value[position] !== '-') {
        throw new FixtureFailure(`${label} has no UUID separator at position ${position + 1}.`);
      }
      out.push('-');
      continue;
    }

    const index = UUID_ALPHABET.indexOf(value[position].toLowerCase());
    if (index < 0) {
      throw new FixtureFailure(
        `${label} contains a character outside the UUID alphabet at position ${position + 1}.`
      );
    }
    // The alphabet's own character, never the network response's character.
    out.push(UUID_ALPHABET[index]);
  }
  return out.join('');
}

/**
 * Proves the target is this machine, or refuses.
 *
 * The CLI in `provision-acceptance-fixtures.mjs` additionally runs the full
 * three-guard `assertLocalTarget()`. This one exists because the browser tier
 * imports the provisioning function directly, with a token it already holds, and
 * a guard that only the CLI path runs is a guard the important caller skips.
 */
export function assertLoopbackApi(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new FixtureFailure(`Fail closed: '${origin}' is not a usable API origin.`);
  }
  if (!LOOPBACK.has(parsed.hostname)) {
    throw new FixtureFailure(
      `Fail closed: acceptance fixtures may only be written to a loopback API. ` +
        `Received '${parsed.hostname}'.`
    );
  }
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * The seven intake catalogues, their published routes, and the row each one
 * gets.
 *
 * One row per catalogue, deliberately: the point is that the capability works
 * against a configured tenant, and a second row would evidence nothing the first
 * does not. `code` satisfies `ck_<t>_code_format` (`^[a-z][a-z0-9_]{1,62}$`) and
 * `name` stays well inside `MAX_CATALOGUE_NAME` (200).
 *
 * The names are English because they are DATA an operator types, not product
 * copy: nothing here reaches `en.json` or `ar.json`, and a fixture that
 * pretended to be localised content would be inventing a translation nobody
 * agreed to. What the Arabic run proves is that the SCREEN renders in Arabic
 * around them, which is what `authenticated-ar` measures.
 */
export const INTAKE_CATALOGUE_FIXTURES = Object.freeze([
  {
    key: 'appointmentType',
    path: '/api/v1/appointment-catalogue/appointment-types',
    code: 'acceptance_general_service',
    name: 'Acceptance fixture: general service',
  },
  {
    key: 'sourceChannel',
    path: '/api/v1/appointment-catalogue/source-channels',
    code: 'acceptance_front_desk',
    name: 'Acceptance fixture: front desk',
  },
  {
    key: 'cancellationReason',
    path: '/api/v1/appointment-catalogue/cancellation-reasons',
    code: 'acceptance_customer_withdrew',
    name: 'Acceptance fixture: customer withdrew the request',
  },
  {
    key: 'fuelLevel',
    path: '/api/v1/reception-catalogue/fuel-levels',
    code: 'acceptance_half_tank',
    name: 'Acceptance fixture: half a tank',
  },
  {
    key: 'warningLightCode',
    path: '/api/v1/reception-catalogue/warning-light-codes',
    code: 'acceptance_engine_lamp',
    name: 'Acceptance fixture: engine management lamp',
  },
  {
    key: 'visitReason',
    path: '/api/v1/reception-catalogue/visit-reasons',
    code: 'acceptance_scheduled_service',
    name: 'Acceptance fixture: scheduled service',
  },
  {
    key: 'refusalReason',
    path: '/api/v1/reception-catalogue/refusal-reasons',
    code: 'acceptance_customer_declined',
    name: 'Acceptance fixture: customer declined the work',
  },
]);

/**
 * The one customer and the one vehicle a booking and a check-in need.
 *
 * `apt.appointment-create` requires a `requesterPartnerId` AND a `vehicleId`,
 * and the booking screen only offers vehicles the CHOSEN customer is linked to
 * (`crm.customer-vehicle-list`) — so the pair and the link between them are all
 * three required before any of the four rows under test can be exercised.
 *
 * The name is searchable: the customer selector searches on a normalised name
 * PREFIX, so "Acceptance" finds this record and nothing else in a workspace that
 * holds no other customer.
 *
 * The VIN avoids `I`, `O` and `Q` the way a real one does, and is 17 characters,
 * so nothing about it looks malformed on a screen that prints it.
 */
export const PARTY_FIXTURE = Object.freeze({
  givenName: 'Acceptance',
  familyName: 'Fixture Customer',
  /** What `crm.customer-search?name=` is given. A prefix of the display name. */
  searchName: 'Acceptance',
  vin: 'ACCEPTANCEFXTR001',
  vehicleDisplayNumber: 'ACC-VEH-0001',
  vehicleColor: 'Acceptance fixture colour',
  modelYear: 2024,
  relationshipRole: 'owner',
});

/** Existing workspaces may carry the pre-hardening default; new fixtures are active. */
const ACCEPTANCE_CUSTOMER_LIFECYCLES = new Set(['active', 'prospect']);

/** Fixture rows carry no personal data, so a name may be reported. */
const label = (fixture) => `${fixture.key} (${fixture.code})`;

/**
 * One authenticated call, with the problem document surfaced when it fails.
 *
 * A bare `response.ok` check would report "provisioning failed" and throw away
 * the only thing that says why — and the failures worth reading here are
 * precise: 403 means the acceptance role is missing `apt.catalogue.manage`,
 * 428 means the idempotency header never left, 422 names the field.
 */
async function call(origin, token, method, path, { body, idempotent = false } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // A fresh key per attempt. See the module docblock: a deterministic key
  // replayed after a reset answers 200 with a dead identifier.
  if (idempotent) headers['Idempotency-Key'] = `acceptance-fixture-${randomUUID()}`;

  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }
  if (!response.ok) {
    throw new FixtureFailure(
      `${method} ${path} answered ${response.status}: ${JSON.stringify(parsed)}`
    );
  }
  return parsed;
}

/** A list operation must prove it returned a page before absence can mean absence. */
function pageItems(page, operation) {
  if (page === null || typeof page !== 'object' || !Array.isArray(page.items)) {
    throw new FixtureFailure(`${operation} returned no valid items array.`);
  }
  return page.items;
}

/**
 * Reads one catalogue and returns the fixture row, or `null`.
 *
 * The plain list is used rather than the management list on purpose: it is the
 * exact read the pickers make, filtered to `status = 'active'`. Finding the row
 * here therefore means the picker will find it too, which is the property this
 * whole module exists to establish.
 */
async function findCatalogueRow(origin, token, fixture) {
  const page = await call(origin, token, 'GET', `${fixture.path}?limit=100`);
  const matches = pageItems(page, `GET ${fixture.path}`).filter(
    (item) => item?.code === fixture.code
  );
  if (matches.length > 1) {
    throw new FixtureFailure(`${label(fixture)} was returned more than once.`);
  }
  return matches[0] ?? null;
}

/**
 * Populates the seven intake catalogues of the caller's own tenant.
 *
 * Returns `{ [key]: { id, code, name, created } }`. `created` distinguishes a
 * first run from a reconciling one, so a caller can say which it did rather than
 * guess.
 */
export async function provisionIntakeCatalogues({ apiOrigin, token, log = () => {} }) {
  const origin = assertLoopbackApi(apiOrigin);
  const provisioned = {};

  for (const fixture of INTAKE_CATALOGUE_FIXTURES) {
    const existing = await findCatalogueRow(origin, token, fixture);
    if (existing !== null) {
      if (existing.code !== fixture.code || existing.name !== fixture.name) {
        throw new FixtureFailure(
          `${label(fixture)} does not match the configured fixture returned by the API.`
        );
      }
      provisioned[fixture.key] = {
        id: reconstructFixtureUuid(existing.id, `${label(fixture)} id`),
        code: fixture.code,
        name: fixture.name,
        created: false,
      };
      log(`  catalogue ${label(fixture).padEnd(48)} present`);
      continue;
    }
    const created = await call(origin, token, 'POST', fixture.path, {
      body: { code: fixture.code, name: fixture.name },
      idempotent: true,
    });
    if (created?.code !== fixture.code || created?.name !== fixture.name) {
      throw new FixtureFailure(
        `${fixture.path} did not return the configured fixture: ${JSON.stringify(created)}`
      );
    }
    provisioned[fixture.key] = {
      id: reconstructFixtureUuid(created.id, `${label(fixture)} id`),
      code: fixture.code,
      name: fixture.name,
      created: true,
    };
    log(`  catalogue ${label(fixture).padEnd(48)} created`);
  }

  return provisioned;
}

/**
 * Creates (or finds) the synthetic customer, its vehicle, and the link.
 *
 * Every step is discovered before it is written, so a re-run adds nothing. The
 * link is what the booking screen's vehicle picker reads, and it is the step
 * most easily forgotten: a customer and a vehicle that exist but are not linked
 * produce a booking form that offers no vehicle at all, and the screen would
 * state that truthfully while the run looked like a defect.
 */
export async function provisionPartyAndVehicle({ apiOrigin, token, log = () => {} }) {
  const origin = assertLoopbackApi(apiOrigin);

  const wanted = `${PARTY_FIXTURE.givenName} ${PARTY_FIXTURE.familyName}`;
  const customerPath =
    `/api/v1/customers?name=${encodeURIComponent(PARTY_FIXTURE.searchName)}` + '&limit=10';
  const findCustomer = async () => {
    const page = await call(origin, token, 'GET', customerPath);
    const matches = pageItems(page, 'GET /api/v1/customers').filter(
      (hit) => hit?.displayName === wanted
    );
    if (matches.length > 1) {
      throw new FixtureFailure(`more than one customer is named ${wanted}.`);
    }
    const match = matches[0] ?? null;
    if (
      match !== null &&
      (match.partyType !== 'individual' ||
        !ACCEPTANCE_CUSTOMER_LIFECYCLES.has(match.lifecycleStatus))
    ) {
      throw new FixtureFailure(`${wanted} exists but is not a usable acceptance individual.`);
    }
    return match;
  };

  let customer = await findCustomer();

  if (customer === null) {
    const created = await call(origin, token, 'POST', '/api/v1/customers/individuals', {
      body: {
        givenName: PARTY_FIXTURE.givenName,
        familyName: PARTY_FIXTURE.familyName,
        lifecycleStatus: 'active',
      },
      idempotent: true,
    });
    const createdId = reconstructFixtureUuid(
      created?.id ?? created?.customerId ?? created?.partnerId,
      'the created acceptance customer id'
    );
    customer = await findCustomer();
    if (
      customer === null ||
      reconstructFixtureUuid(customer.id, 'the acceptance customer search id') !== createdId
    ) {
      throw new FixtureFailure('the created acceptance customer could not be verified by search.');
    }
    log(`  customer  ${wanted.padEnd(48)} created`);
  } else {
    log(`  customer  ${wanted.padEnd(48)} present`);
  }
  const customerId = reconstructFixtureUuid(
    customer?.id ?? customer?.customerId ?? customer?.partnerId,
    'the acceptance customer id'
  );

  const vehiclePath = `/api/v1/vehicles?vin=${encodeURIComponent(PARTY_FIXTURE.vin)}&limit=10`;
  const findVehicle = async () => {
    const page = await call(origin, token, 'GET', vehiclePath);
    const items = pageItems(page, 'GET /api/v1/vehicles');
    const matches = items.filter(
      (vehicle) =>
        vehicle?.vin === PARTY_FIXTURE.vin &&
        vehicle?.displayNumber === PARTY_FIXTURE.vehicleDisplayNumber &&
        vehicle?.modelYear === PARTY_FIXTURE.modelYear &&
        vehicle?.lifecycleStatus === 'draft'
    );
    if (matches.length > 1) {
      throw new FixtureFailure(`the acceptance vehicle ${PARTY_FIXTURE.vin} was returned twice.`);
    }
    if (items.length > 0 && matches.length === 0) {
      throw new FixtureFailure(
        `the vehicle search returned a row that is not the configured fixture ${PARTY_FIXTURE.vin}.`
      );
    }
    return matches[0] ?? null;
  };

  let vehicle = await findVehicle();

  if (vehicle === null) {
    const created = await call(origin, token, 'POST', '/api/v1/vehicles', {
      body: {
        vin: PARTY_FIXTURE.vin,
        displayNumber: PARTY_FIXTURE.vehicleDisplayNumber,
        color: PARTY_FIXTURE.vehicleColor,
        modelYear: PARTY_FIXTURE.modelYear,
      },
      idempotent: true,
    });
    const createdId = reconstructFixtureUuid(
      created?.id ?? created?.vehicleId,
      'the created acceptance vehicle id'
    );
    vehicle = await findVehicle();
    if (
      vehicle === null ||
      reconstructFixtureUuid(vehicle.id, 'the acceptance vehicle search id') !== createdId
    ) {
      throw new FixtureFailure('the created acceptance vehicle could not be verified by search.');
    }
    log(`  vehicle   ${PARTY_FIXTURE.vin.padEnd(48)} created`);
  } else {
    log(`  vehicle   ${PARTY_FIXTURE.vin.padEnd(48)} present`);
  }
  const vehicleId = reconstructFixtureUuid(vehicle.id, 'the acceptance vehicle id');

  const links = await call(
    origin,
    token,
    'GET',
    `/api/v1/customers/${customerId}/vehicles?limit=50`
  );
  const canonicalLinks = pageItems(links, 'GET /api/v1/customers/{customerId}/vehicles').map(
    (row) => {
      if (typeof row?.active !== 'boolean') {
        throw new FixtureFailure('a customer vehicle relationship carries no active state.');
      }
      return {
        vehicleId: reconstructFixtureUuid(row.vehicleId, 'a customer vehicle relationship id'),
        active: row.active,
      };
    }
  );
  const linked = canonicalLinks.some((row) => row.vehicleId === vehicleId && row.active);
  if (!linked) {
    await call(origin, token, 'POST', `/api/v1/customers/${customerId}/vehicles`, {
      body: { vehicleId, relationshipRole: PARTY_FIXTURE.relationshipRole },
      idempotent: true,
    });
    log(`  link      ${'customer to vehicle'.padEnd(48)} created`);
  } else {
    log(`  link      ${'customer to vehicle'.padEnd(48)} present`);
  }

  return { customerId, vehicleId, displayName: wanted };
}

/** Reception statuses no transition leaves. Mirrors `RECEPTION_TRANSITIONS`. */
const TERMINAL_RECEPTION_STATUSES = new Set(['converted', 'closed_without_work', 'refused']);

/**
 * Closes any visit still open on the fixture vehicle, so a check-in can be
 * driven again.
 *
 * ## Why this is setup and not evidence
 *
 * One vehicle may hold ONE open visit at a time — a second `rec.reception-create`
 * answers 409 `ERR-RES-002`, and R5 released that uniqueness only on a terminal
 * state. A browser run that opens a visit therefore poisons the next run: the
 * check-in screen correctly offers "resume" instead of the create form, and the
 * run after that would be exercising a different path from the run before it,
 * silently. Evidence that changes shape depending on how many times it has been
 * collected is not evidence.
 *
 * So this is called explicitly, before a run, by the caller that intends to
 * drive a check-in — never as a side effect of ordinary provisioning, because an
 * operator who left a visit open by hand should find it where they left it.
 *
 * `close-without-work` is version-guarded, so the current version is READ first
 * and travels as `If-Match`. A stale guess would 409 and the cleanup would
 * report a conflict where there is none.
 */
export async function releaseOpenVisits({
  apiOrigin,
  token,
  companyId,
  branchId,
  vehicleId,
  log = () => {},
}) {
  const origin = assertLoopbackApi(apiOrigin);
  const page = await call(
    origin,
    token,
    'GET',
    `/api/v1/receptions?companyId=${companyId}&branchId=${branchId}&vehicleId=${vehicleId}&limit=50`
  );
  const items = pageItems(page, 'GET /api/v1/receptions');
  let released = 0;

  for (const visit of items) {
    if (typeof visit?.id !== 'string') continue;
    if (TERMINAL_RECEPTION_STATUSES.has(visit.receptionStatus)) continue;

    const detail = await call(origin, token, 'GET', `/api/v1/receptions/${visit.id}`);
    const version = detail?.recordVersion;
    if (typeof version !== 'number') {
      throw new FixtureFailure(`reception ${visit.id} carries no recordVersion to guard against.`);
    }
    const response = await fetch(`${origin}/api/v1/receptions/${visit.id}/close-without-work`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'If-Match': `"${version}"`,
        'Idempotency-Key': `acceptance-fixture-${randomUUID()}`,
      },
      body: JSON.stringify({
        reason: 'Acceptance fixture: released so the check-in path can be driven again.',
      }),
    });
    if (!response.ok) {
      throw new FixtureFailure(
        `releasing reception ${visit.id} answered ${response.status}: ${await response.text()}`
      );
    }
    released += 1;
    log(`  released  ${visit.id} (was ${visit.receptionStatus})`);
  }

  return released;
}

/**
 * The whole configured workspace: catalogues, then the party pair.
 *
 * Ordered rather than parallel. The catalogues are what the four blocked rows
 * need and they are cheap; the party pair is what turns "the picker offers a
 * type" into "an appointment was booked", and a failure in the first half should
 * be reported before the second half compounds it.
 */
export async function provisionAcceptanceFixtures({ apiOrigin, token, log = () => {} }) {
  const catalogues = await provisionIntakeCatalogues({ apiOrigin, token, log });
  const party = await provisionPartyAndVehicle({ apiOrigin, token, log });
  return { catalogues, ...party };
}
