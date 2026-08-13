import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as aptApi from '@/features/appointments/api';
import * as aptCatalogue from '@/features/appointments/catalogue-api';
import * as recApi from '@/features/receptions/api';
import * as recCatalogue from '@/features/receptions/catalogue-api';
import * as recSupport from '@/features/receptions/support-api';
import * as recWorkOrder from '@/features/receptions/work-order-api';
import * as customerDirectory from '@/lib/customers/directory';
import * as customerVehicles from '@/lib/customers/vehicles';

/**
 * One accepted call for **every** adapter the P1-28 trees export
 * (`P1-28-QA-001`).
 *
 * ## Why this exists at all
 *
 * Every P1-28 `.dom` suite mocks its adapter module wholesale — which is right,
 * because what those suites are about is the SCREEN. The consequence is that
 * nothing was executing the adapters themselves. That is precisely the P1-27
 * Wave 5 finding: mutating an adapter left twenty DOM tests green, because the
 * only references to it in the whole suite were `vi.fn()` stubs that replace the
 * thing under test. Twenty-three reads and fourteen writes shipped in this phase
 * with contract-table coverage only, and a contract table cannot say which path
 * a function builds, whether it sends a scope, or what it returns for a 403.
 *
 * ## Not a test file
 *
 * `vitest.config.ts` collects `*.test.ts` / `*.dom.test.tsx` only, so this module
 * is imported and never collected. It is shared rather than inlined for the
 * reason `write-drives.ts` is shared: two suites that each keep their own list
 * can come to disagree about what the set is, and the shorter one wins silently.
 *
 * ## Every call here must REACH the client
 *
 * These are the accepted cases. A call that fails validation would make every
 * consumer vacuous — a sweep for a smuggled scope passes trivially against a
 * request that was never made — so each consumer asserts the client was called
 * exactly once per entry. The refused cases live in the suites, beside the bound
 * they are about.
 *
 * ## The set is DERIVED and the derivation is checked
 *
 * `exportedP1_28Adapters()` walks the `'use server'` modules of the two feature
 * trees plus the customer→vehicle read the intake flow depends on, and reports
 * every exported async function. `p1-28-qa.test.ts` holds `DRIVES` to that set
 * by NAME — not by count, because adding one adapter while driving another would
 * balance a count and hide both.
 */

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** Well-formed uuids, so a `.strict()` schema accepts every accepted case. */
export const VISIT = '11111111-1111-4111-8111-111111111111';
export const APPOINTMENT = '22222222-2222-4222-8222-222222222222';
export const VEHICLE = '33333333-3333-4333-8333-333333333333';
export const CUSTOMER = '44444444-4444-4444-8444-444444444444';
export const PARTNER = '55555555-5555-4555-8555-555555555555';
export const EMPLOYEE = '66666666-6666-4666-8666-666666666666';
export const DOCUMENT = '77777777-7777-4777-8777-777777777777';
export const DOCUMENT_VERSION = '88888888-8888-4888-8888-888888888888';
export const REASON = '99999999-9999-4999-8999-999999999999';
export const TYPE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const WORK_ORDER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/**
 * The branch a branch-target read is ABOUT.
 *
 * A resource selector the route's own `.strict()` schema demands, never a scope
 * assertion — `branchTargetQuery` is the one door `lib/api` opens for it, and
 * `QA-003` pins that this pair is the only place `companyId`/`branchId` may
 * appear in a P1-28 request.
 */
export const TARGET = Object.freeze({
  companyId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  branchId: '10101010-1010-4010-8010-101010101010',
});

/** A `TableRequest` the paginated adapters accept. */
export const REQUEST = { pageSize: 25 } as never;

/** The version a guarded command presents. Never computed — see `QA-004`. */
export const VERSION = 7;

/* ------------------------------------------------------------------ *
 * The drive table
 * ------------------------------------------------------------------ */

export interface AdapterDrive {
  /** The exported adapter name, exactly as the module declares it. */
  readonly name: string;
  /** `get` for a read, `send` for a mutation. */
  readonly channel: 'get' | 'send';
  /** True when the operation refuses the request without `If-Match`. */
  readonly versionGuarded?: boolean;
  readonly call: () => Promise<unknown>;
}

/**
 * Every read adapter, with a call that reaches `client.get`.
 *
 * The catalogue reads page internally, so one call is one request only while the
 * mocked page reports `hasMore: false` — which every consumer's success fixture
 * does, and which the "issues exactly one request" case then proves.
 */
export const READ_DRIVES: readonly AdapterDrive[] = Object.freeze([
  {
    name: 'listAppointments',
    channel: 'get',
    call: () => aptApi.listAppointments(TARGET, {}, REQUEST, null),
  },
  { name: 'readAppointment', channel: 'get', call: () => aptApi.readAppointment(APPOINTMENT) },
  { name: 'listAppointmentTypes', channel: 'get', call: () => aptCatalogue.listAppointmentTypes() },
  { name: 'listSourceChannels', channel: 'get', call: () => aptCatalogue.listSourceChannels() },
  {
    name: 'listCancellationReasons',
    channel: 'get',
    call: () => aptCatalogue.listCancellationReasons(),
  },
  {
    name: 'listReceptions',
    channel: 'get',
    call: () => recApi.listReceptions(TARGET, {}, REQUEST, null),
  },
  { name: 'readReception', channel: 'get', call: () => recApi.readReception(VISIT) },
  {
    name: 'listPartyRoles',
    channel: 'get',
    call: () => recApi.listPartyRoles(VISIT, 'active', REQUEST, null),
  },
  {
    name: 'listAuthorizations',
    channel: 'get',
    call: () => recApi.listAuthorizations(VISIT, REQUEST, null),
  },
  {
    name: 'listConditionEvidence',
    channel: 'get',
    call: () => recApi.listConditionEvidence(VISIT, 'complaint', REQUEST, null),
  },
  {
    name: 'listReceptionHistory',
    channel: 'get',
    call: () => recApi.listReceptionHistory(VISIT, REQUEST, null),
  },
  { name: 'listVisitReasons', channel: 'get', call: () => recCatalogue.listVisitReasons() },
  { name: 'listFuelLevels', channel: 'get', call: () => recCatalogue.listFuelLevels() },
  {
    name: 'listWarningLightCodes',
    channel: 'get',
    call: () => recCatalogue.listWarningLightCodes(),
  },
  { name: 'listRefusalReasons', channel: 'get', call: () => recCatalogue.listRefusalReasons() },
  {
    name: 'readCustomerSummary',
    channel: 'get',
    call: () => recSupport.readCustomerSummary(CUSTOMER),
  },
  {
    name: 'readVehicleSummary',
    channel: 'get',
    call: () => recSupport.readVehicleSummary(VEHICLE),
  },
  {
    name: 'listVehicleRelationshipEntries',
    channel: 'get',
    call: () => recSupport.listVehicleRelationshipEntries(VEHICLE, REQUEST, null),
  },
  {
    name: 'listReceivingEmployeeCandidates',
    channel: 'get',
    call: () => recSupport.listReceivingEmployeeCandidates('  ', REQUEST, null),
  },
  {
    name: 'listConfirmedAppointments',
    channel: 'get',
    call: () => recSupport.listConfirmedAppointments(TARGET, REQUEST, null),
  },
  {
    name: 'readConvertedWorkOrder',
    channel: 'get',
    call: () => recWorkOrder.readConvertedWorkOrder(WORK_ORDER),
  },
  {
    name: 'listCustomerVehicles',
    channel: 'get',
    call: () => customerVehicles.listCustomerVehicles(CUSTOMER, REQUEST, null),
  },
  {
    name: 'searchCustomerDirectory',
    channel: 'get',
    // A real criterion, because the adapter deliberately refuses to issue a
    // request for empty criteria — an unasked query is a wasted slot against a
    // 30-per-minute budget — and a drive that reached no client would make
    // every sweep over it vacuous.
    call: () => customerDirectory.searchCustomerDirectory(REQUEST, null, { name: 'Nadia' }),
  },
]);

/** A window whose halves carry an explicit offset and end strictly after the start. */
const WINDOW = Object.freeze({
  from: '2026-09-01T09:00:00Z',
  to: '2026-09-01T10:00:00Z',
});

/**
 * Every write adapter, with a call that reaches `client.send`.
 *
 * `versionGuarded` marks the SEVEN commands the backend refuses without
 * `If-Match` (428 `ERR-CON-002`) — three appointment lifecycle commands
 * (reschedule, cancel, no-show) and, on the reception side, approve, convert
 * and the two terminal exits (close-without-work, refuse). The sentence used to
 * say "four" while enumerating seven, which is the count and the enumeration
 * disagreeing inside one sentence. `QA-002` drives each of them through the 428
 * branch and asserts the census is seven, and `QA-004` proves each adapter takes
 * the version as a REQUIRED parameter rather than defaulting one.
 */
export const WRITE_DRIVES: readonly AdapterDrive[] = Object.freeze([
  {
    name: 'createAppointment',
    channel: 'send',
    call: () =>
      aptApi.createAppointment({
        companyId: TARGET.companyId,
        branchId: TARGET.branchId,
        vehicleId: VEHICLE,
        requesterPartnerId: PARTNER,
        appointmentTypeId: TYPE,
        requestedFrom: WINDOW.from,
        requestedTo: WINDOW.to,
      }),
  },
  {
    name: 'rescheduleAppointment',
    channel: 'send',
    versionGuarded: true,
    call: () =>
      aptApi.rescheduleAppointment(APPOINTMENT, VERSION, {
        confirmedFrom: WINDOW.from,
        confirmedTo: WINDOW.to,
      }),
  },
  {
    name: 'cancelAppointment',
    channel: 'send',
    versionGuarded: true,
    call: () => aptApi.cancelAppointment(APPOINTMENT, VERSION, { cancellationReasonId: REASON }),
  },
  {
    name: 'recordAppointmentNoShow',
    channel: 'send',
    versionGuarded: true,
    call: () => aptApi.recordAppointmentNoShow(APPOINTMENT, VERSION),
  },
  {
    name: 'createReception',
    channel: 'send',
    call: () =>
      recApi.createReception({
        companyId: TARGET.companyId,
        branchId: TARGET.branchId,
        vehicleId: VEHICLE,
        receivingEmployeeId: EMPLOYEE,
        serviceRequesterPartnerId: PARTNER,
        origin: { kind: 'walk_in' },
      }),
  },
  {
    name: 'assignPartyRole',
    channel: 'send',
    call: () =>
      recApi.assignPartyRole(VISIT, { partnerId: PARTNER, relationshipRole: 'vehicle_owner' }),
  },
  {
    name: 'recordAuthorization',
    channel: 'send',
    call: () =>
      recApi.recordAuthorization(VISIT, {
        authorizingRole: 'vehicle_owner',
        partnerId: PARTNER,
        decision: 'approved',
      }),
  },
  {
    name: 'recordConditionEvidence',
    channel: 'send',
    call: () =>
      recApi.recordConditionEvidence(VISIT, {
        kind: 'complaint',
        category: 'noise',
        complaintText: 'It pulls to the left under braking.',
      }),
  },
  {
    name: 'recordSignature',
    channel: 'send',
    call: () =>
      recApi.recordSignature(VISIT, {
        signerRole: 'service_requester',
        signatureDocumentId: DOCUMENT,
        signatureDocumentVersionId: DOCUMENT_VERSION,
        captureMethod: 'drawn',
        purpose: 'reception_acknowledgement',
      }),
  },
  {
    name: 'recordRefusal',
    channel: 'send',
    call: () => recApi.recordRefusal(VISIT, { refusalType: 'inspection_item' }),
  },
  {
    name: 'approveReception',
    channel: 'send',
    versionGuarded: true,
    call: () => recApi.approveReception(VISIT, VERSION),
  },
  {
    name: 'convertReceptionToWorkOrder',
    channel: 'send',
    versionGuarded: true,
    call: () => recApi.convertReceptionToWorkOrder(VISIT, VERSION),
  },
  {
    name: 'closeReceptionWithoutWork',
    channel: 'send',
    versionGuarded: true,
    call: () =>
      recApi.closeReceptionWithoutWork(VISIT, VERSION, { reason: 'The customer took it away.' }),
  },
  {
    name: 'refuseReception',
    channel: 'send',
    versionGuarded: true,
    call: () => recApi.refuseReception(VISIT, VERSION, { reason: 'No safe lift is available.' }),
  },
]);

/** Reads and writes together — what the exhaustiveness check is held against. */
export const DRIVES: readonly AdapterDrive[] = Object.freeze([...READ_DRIVES, ...WRITE_DRIVES]);

/* ------------------------------------------------------------------ *
 * The derivation the table is held to
 * ------------------------------------------------------------------ */

/**
 * Adapters this table deliberately does NOT drive, each with its reason.
 *
 * An exclusion is a decision, so it is written down and it is CHECKED: the name
 * must still be exported, or the list becomes somewhere to park a name that no
 * longer means anything.
 */
export const NOT_DRIVEN: ReadonlyMap<string, string> = new Map([
  [
    'conditionEvidenceKinds',
    'returns the frozen EVIDENCE_KINDS vocabulary and issues no request at all, ' +
      'so there is no path, no body and no failure mapping to drive. Its vocabulary ' +
      'is asserted against the contract in receptions-contract.test.ts.',
  ],
]);

/** Source with comments removed. `https://` is not a comment start. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/**
 * The modules whose exports ARE the P1-28 adapter surface.
 *
 * Chosen by SHAPE, not by filename: a module that opens with `'use server'` is
 * a Server Action module, and in this codebase that is exactly what an adapter
 * module is. A filename convention (`*-api.ts`) would have missed
 * `lib/customers/vehicles.ts`, which is neither in a feature tree nor named
 * `-api`, and which the intake flow's vehicle picker depends on.
 */
export function adapterModules(roots: readonly string[] = adapterRoots()): readonly string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      const source = readFileSync(full, 'utf8');
      if (/^\s*['"]use server['"]/.test(source)) files.push(full);
    }
  };
  for (const root of roots) walk(root);
  return files.sort();
}

/** The three trees P1-28 adapters live in. */
function adapterRoots(): readonly string[] {
  return [
    join(process.cwd(), 'src', 'features', 'appointments'),
    join(process.cwd(), 'src', 'features', 'receptions'),
    join(process.cwd(), 'src', 'lib', 'customers'),
  ];
}

/** Every adapter name one module's source declares as an export. */
export function adapterNamesIn(source: string): readonly string[] {
  const found = new Set<string>();
  const stripped = stripComments(source);
  for (const m of stripped.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) {
    if (m[1]) found.add(m[1]);
  }
  // `export const foo = async (…) => …` as well. Nothing in the tree uses the
  // form today; the point is that it would be discovered the day it appears
  // rather than the day somebody remembers to look.
  for (const m of stripped.matchAll(/^export\s+const\s+(\w+)\s*(?::[^=\n]+)?=\s*async\b/gm)) {
    if (m[1]) found.add(m[1]);
  }
  return [...found];
}

/**
 * Every adapter the P1-28 `'use server'` modules export, read from disk.
 *
 * Derived rather than listed, for the reason P1-27 learned twice: a hand list is
 * invisible to the adapter that was never added to it, and the coverage claim
 * reads green while nothing executes the code.
 */
export function exportedP1_28Adapters(
  roots: readonly string[] = adapterRoots()
): readonly string[] {
  const found = new Set<string>();
  for (const file of adapterModules(roots)) {
    for (const name of adapterNamesIn(readFileSync(file, 'utf8'))) found.add(name);
  }
  return [...found].sort();
}
