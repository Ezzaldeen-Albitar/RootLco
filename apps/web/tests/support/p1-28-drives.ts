import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import * as aptApi from '@/features/appointments/api';
import * as aptCatalogue from '@/features/appointments/catalogue-api';
import * as recApi from '@/features/receptions/api';
import * as recCatalogue from '@/features/receptions/catalogue-api';
import * as recEvidenceCapture from '@/features/receptions/evidence-capture';
import * as recSignatureCapture from '@/features/receptions/signature-capture';
import * as recSupport from '@/features/receptions/support-api';
import * as recWorkOrder from '@/features/receptions/work-order-api';
import * as customerDirectory from '@/lib/customers/directory';
import * as customerVehicles from '@/lib/customers/vehicles';

/**
 * The attachments adapters, taken REAL rather than through the tier mock.
 *
 * `p1-28-qa.test.ts` mocks `@/features/attachments/api` at the module boundary,
 * because that is the only way the two composite captures can be driven at all:
 * without it a single drive would issue five requests plus an object PUT, and
 * every sweep asserting "exactly one request, on the channel it declares" would
 * have to be weakened to accommodate them.
 *
 * That mock is also what made this tree invisible. A static import here would
 * resolve to the mock, so a drive over it would record a call into the
 * recorder, reach no client, and prove nothing — the sweep would grow three
 * entries and measure the same nothing it measured before. `vi.importActual`
 * bypasses the mock for THIS module only; its own imports still resolve
 * normally, so `@/lib/api/server-client` stays mocked and these drives land on
 * the same recorded transport as every other entry in the table.
 *
 * Top-level `await` rather than a lazy handle inside each `call`, so a module
 * that fails to load fails when the table is built rather than as one confusing
 * assertion inside whichever sweep happened to run first.
 */
const attachmentsApi = await vi.importActual<typeof import('@/features/attachments/api')>(
  '@/features/attachments/api'
);

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
 * thing under test. Twenty-five reads and twenty-two writes ship in this phase
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
 * `exportedP1_28Adapters()` walks the `'use server'` modules of the three
 * feature trees plus the customer→vehicle read the intake flow depends on, and
 * reports every exported async function. `p1-28-qa.test.ts` holds `DRIVES` to
 * that set by NAME — not by count, because adding one adapter while driving
 * another would balance a count and hide both.
 *
 * The derivation is only as wide as its ROOTS, and that is where it failed once
 * already: `src/features/attachments` is a `'use server'` tree this branch
 * created, it was not a root, and so the walk never saw it. The exhaustiveness
 * case stayed green over three undriven adapters and its own anti-vacuity floor
 * — `toBeGreaterThan(30)` — was satisfied by the trees it could see. A sweep is
 * blind to the tree it was never pointed at, which is the same failure as a hand
 * list wearing a derivation's clothes.
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
export const BINDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const SIGNATURE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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

/**
 * A chosen file, in the envelope a Server Action really receives.
 *
 * The two composite captures take `FormData` rather than a typed argument
 * because that is what the browser→Server-Action boundary carries, and driving
 * them with anything else would drive a signature the product does not have.
 * The bytes are a real JPEG start-of-image marker: non-empty is load-bearing,
 * because both actions refuse a zero-byte file before spending anything, and a
 * drive that was refused there would reach no client at all and make every
 * sweep over it vacuous.
 *
 * `lastModified` is set deliberately. It is what the DEVICE claims the capture
 * happened at, and a category whose `device_capture_timestamp_required` is true
 * — which every seeded reception category is — turns it into a
 * `deviceCapturedAt` on the binding. Left at the default it would be "now",
 * which is a fixture that changes between runs.
 */
export function capturedFile(field: string, fileName: string, contentType: string): FormData {
  const form = new FormData();
  form.set(
    field,
    new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], fileName, {
      type: contentType,
      lastModified: Date.UTC(2026, 8, 1, 9, 30),
    })
  );
  return form;
}

/** What `capturedFile` records as the device's claim, as the actions send it. */
export const CAPTURED_AT = new Date(Date.UTC(2026, 8, 1, 9, 30)).toISOString();

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
    name: 'readCaptureContract',
    channel: 'get',
    call: () => recApi.readCaptureContract(VISIT),
  },
  {
    name: 'readSignatures',
    channel: 'get',
    call: () => recApi.readSignatures(VISIT),
  },
  {
    name: 'listConditionEvidence',
    channel: 'get',
    call: () => recApi.listConditionEvidence(VISIT, 'complaint', REQUEST, null),
  },
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
    call: () => recSupport.listReceivingEmployeeCandidates(TARGET, REQUEST, null),
  },
  {
    name: 'readUserIdentity',
    channel: 'get',
    call: () => recSupport.readUserIdentity(EMPLOYEE),
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
  {
    /*
     * The governed category policy, and the one read of the shared evidence
     * chain this tier performs. It is what tells a capture which content types
     * and which ceiling apply, so `no-invented-media-limit` has a server answer
     * to point at instead of a constant somebody chose.
     */
    name: 'listDocumentCategories',
    channel: 'get',
    call: () => attachmentsApi.listDocumentCategories(),
  },
]);

/** A window whose halves carry an explicit offset and end strictly after the start. */
const WINDOW = Object.freeze({
  from: '2026-09-01T09:00:00Z',
  to: '2026-09-01T10:00:00Z',
});

/**
 * Run one drive with the object store answering as UNREACHABLE.
 *
 * `captureDocument` is three acts: authorize, PUT the bytes, register. Only the
 * first and third are requests to our API; the PUT goes through the global
 * `fetch` to a host the API named, and nothing in this table mocks that.
 *
 * Two things follow, and both are decisions rather than conveniences.
 *
 *   - **It must be stubbed.** Left alone, the drive would depend on an
 *     unmocked `fetch` happening to reject — which it does today, because the
 *     mocked authorization carries no `uploadUrl` to parse — and a drive that
 *     passes because a URL was malformed is a drive that stops passing for a
 *     reason unrelated to the product. Worse, a fixture that ever did carry a
 *     plausible URL would put a real outbound request in a unit run.
 *   - **It must fail.** A store that accepted the bytes would send the action
 *     on to `shared.attachment-version-register`, which is a SECOND request,
 *     and every consumer of this table asserts exactly one. That is the same
 *     decision the `captureRequirementEvidence` entry makes for the same reason
 *     — its registered version stays `pending` so the action does not go on to
 *     finalize.
 *
 * So what this drive measures is the AUTHORIZE half: the path built, the body
 * sent, the scope not sent, the key not minted, and every transport kind mapped
 * to a state that is never success. The store→register half issues a second
 * request and is therefore outside what a one-request-per-drive table can say
 * about it; `p1-28-reception-media.test.ts` pins its ORDER, and no drive here
 * claims to have executed it.
 *
 * The global is restored in a `finally`, so a drive that throws cannot leave a
 * stubbed `fetch` behind for whatever runs next.
 */
async function withUnreachableStore<T>(run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(null, { status: 503 })) as unknown as typeof globalThis.fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

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
 *
 * ## Four evidence writes, and two COMPOSITE actions beside them
 *
 * `P1-OD-025` resolved, so the document chain completes and four writes that had
 * nothing to reach them entered this table: `bindEvidence`,
 * `finalizeEvidenceBinding`, `overrideCaptureRequirement` and
 * `recordSignatureEvent`. Each resolves to a published operation the registry
 * marks `idempotent: true`, none is version guarded, and none mints a key of its
 * own — the contract-derived client does that, which is what `QA-004` asserts.
 *
 * Two entries are a different KIND of drive and say so where they stand.
 * `captureRequirementEvidence` and `captureSignatureEvidence` are not adapters:
 * they are Server Actions that walk a category read, an upload authorization, an
 * object PUT, a version registration and a link before they reach a reception
 * write — `bindEvidence` for the first (and `finalizeEvidenceBinding` after it,
 * when the version was accepted), `recordSignature` for the second.
 * `p1-28-qa.test.ts` mocks `@/features/attachments/api`, the shared P1-15 half of
 * that chain, which this phase consumes and does not own; so exactly ONE request
 * reaches the mocked transport per drive, and it is the `rec.*` write. What these
 * two entries prove is therefore what this file is for: that the reception
 * request the composite finally issues is the one the contract publishes, on the
 * right path, carrying no scope and no key of its own. What they deliberately do
 * NOT measure is the `shared.*` half — that half is driven by the two entries
 * below, against the real module.
 *
 * ## And the shared half, which had been driven by nothing
 *
 * `captureDocument` and `createDocumentLink` are the two writes of the evidence
 * chain, and until now the only statement any suite made about them was the
 * mock that replaces them. They are adapters of this application by every test
 * this repository applies — `'use server'`, exported, called by production code
 * — and they were invisible because the walk was never pointed at their tree.
 *
 * Both resolve to an operation the registry marks `idempotent: true`
 * (`shared.attachment-upload-authorize`, `shared.attachment-link-create`), and
 * neither passes an options object to `client.send`, so neither mints a key the
 * contract-derived client would then be unable to own. Neither is version
 * guarded: a document version is immutable and a link is an append, so there is
 * no record version for `If-Match` to protect.
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
    name: 'bindEvidence',
    channel: 'send',
    call: () =>
      recApi.bindEvidence(VISIT, {
        requirementCode: 'vin',
        documentId: DOCUMENT,
        documentVersionId: DOCUMENT_VERSION,
        qualityStatus: 'readable',
      }),
  },
  {
    name: 'finalizeEvidenceBinding',
    channel: 'send',
    call: () => recApi.finalizeEvidenceBinding(VISIT, BINDING),
  },
  {
    name: 'overrideCaptureRequirement',
    channel: 'send',
    call: () =>
      recApi.overrideCaptureRequirement(VISIT, {
        requirementCode: 'ev_soc',
        reason: 'The vehicle is not electric.',
      }),
  },
  {
    name: 'recordSignatureEvent',
    channel: 'send',
    call: () => recApi.recordSignatureEvent(VISIT, SIGNATURE, { eventType: 'finalized' }),
  },
  {
    /*
     * FE-017's composite. Driven against `vin` because that requirement maps to
     * exactly one category — `reception_vin` — so the drive exercises the
     * derivation `CAPTURE_CATEGORY_BY_REQUIREMENT` performs rather than a
     * category a caller chose.
     *
     * The registered version stays `pending` in the mocked chain, and that is a
     * decision rather than a convenience: an `accepted` version would make the
     * action finalize, which is a SECOND request, and every consumer of this
     * table asserts exactly one. The accepted path is proved separately, in the
     * one case that can afford two requests.
     */
    name: 'captureRequirementEvidence',
    channel: 'send',
    call: () =>
      recEvidenceCapture.captureRequirementEvidence(
        VISIT,
        'vin',
        capturedFile('evidenceFile', 'vin-plate.jpg', 'image/jpeg')
      ),
  },
  {
    /*
     * The chain's SECOND entry point: the finalization offered again on a
     * binding whose capture reached `bound` and stopped there.
     *
     * It exists because `captureRequirementEvidence` attempts the sixth call
     * exactly once — an expired session or a transport failure leaves a real
     * binding over an accepted version that counts towards nothing, and
     * re-capturing would leave a second document standing for the same panel.
     * It lives in `evidence-capture.ts` rather than on the screen because
     * `finalizeEvidenceBinding` is a step of the chain, and a step of the chain
     * called from a component is the sequence living in the browser.
     *
     * One request, on the `send` channel: the action delegates straight to the
     * adapter and adds no read of its own. It deliberately checks NOTHING about
     * the binding first — the RLS policy admits the update only while
     * `finalized_at IS NULL` and the binding guard refuses a version that is not
     * accepted, so the database is the authority and a check here would be a
     * second opinion about rows this tree cannot see.
     */
    name: 'finalizeCapturedEvidence',
    channel: 'send',
    call: () => recEvidenceCapture.finalizeCapturedEvidence(VISIT, BINDING),
  },
  {
    /*
     * FE-018's composite. The form fields are the ones `SignatureStep` really
     * submits — role, purpose, an optional party and the image — because a drive
     * that invented a field would prove the action accepts something no screen
     * sends. `captureMethod` is deliberately absent: the action fixes it to
     * `uploaded` server-side, which is why no form control offers it.
     */
    name: 'captureSignatureEvidence',
    channel: 'send',
    call: () => {
      const form = capturedFile('signatureFile', 'signature.png', 'image/png');
      form.set('signerRole', 'service_requester');
      form.set('purpose', 'reception_acknowledgement');
      form.set('signerPartnerId', PARTNER);
      return recSignatureCapture.captureSignatureEvidence(VISIT, form);
    },
  },
  {
    /*
     * The first act of the evidence chain, driven against the real module.
     *
     * The category is `reception_vin` and the entity is the visit, because that
     * is the pair `captureRequirementEvidence` derives for the `vin`
     * requirement — a drive that invented a category would prove the adapter
     * accepts something no caller sends. The bytes are the same JPEG
     * start-of-image marker `capturedFile` writes, and being non-empty is
     * load-bearing: a zero-byte file is refused before a session is even
     * resolved, so such a drive would reach no client and make every sweep over
     * it vacuous.
     *
     * `withUnreachableStore` explains why the PUT is stubbed to fail and what
     * this entry therefore does and does not measure.
     */
    name: 'captureDocument',
    channel: 'send',
    call: () =>
      withUnreachableStore(() =>
        attachmentsApi.captureDocument({
          categoryCode: 'reception_vin',
          entityType: 'rec.receptions',
          entityId: VISIT,
          fileName: 'vin-plate.jpg',
          contentType: 'image/jpeg',
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
          capturedAt: CAPTURED_AT,
        })
      ),
  },
  {
    /*
     * The last act: what makes a captured document reachable to somebody who
     * holds the visit rather than the document id. `identity_document` is the
     * `business_link_purpose` the seeded `reception_vin` category publishes
     * (`supabase/seeds/05_shared_reference.sql`), not a convenient invention —
     * a purpose the category does not admit is refused by
     * `ck_document_categories_link_purpose`, so a drive using one would prove
     * the adapter builds a request production could not make.
     */
    name: 'createDocumentLink',
    channel: 'send',
    call: () =>
      attachmentsApi.createDocumentLink(DOCUMENT, {
        entityType: 'rec.receptions',
        entityId: VISIT,
        linkPurpose: 'identity_document',
      }),
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
  /*
   * Empty, and that is the point.
   *
   * Its one entry was `conditionEvidenceKinds`, excluded because it issued no
   * request and so had no path, no body and no failure mapping to drive. An
   * adapter that cannot be driven and that nothing calls is not an adapter, and
   * `P1-28-F9` deleted it rather than keeping the exclusion — the vocabulary is
   * `EVIDENCE_KINDS` in `receptions-contract.ts` and always was.
   *
   * The map stays because the exclusion MECHANISM is worth having: the day an
   * adapter genuinely cannot be driven, the reason belongs written down and
   * checked, not discovered as a hole in the sweep.
   */
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

/**
 * The four trees P1-28 adapters live in.
 *
 * A root that is missing is not a smaller sweep, it is a SILENT one: the walk
 * reports what the roots contain, the exhaustiveness case compares that against
 * the table, and both agree perfectly about a tree neither can see.
 * `src/features/attachments` was exactly that — the `'use server'` module this
 * branch added for the P1-15 evidence chain, under no root, so its three
 * adapters were driven by nothing while `QA-001` read green.
 *
 * So the rule for adding one is the rule the walk itself uses: a tree
 * containing a module that opens with `'use server'` belongs here. There is no
 * third state in which an adapter is exempt from being discovered — an adapter
 * that should not be driven is excluded by NAME in `NOT_DRIVEN`, with a reason,
 * where the exclusion is checked.
 */
function adapterRoots(): readonly string[] {
  return [
    join(process.cwd(), 'src', 'features', 'appointments'),
    join(process.cwd(), 'src', 'features', 'attachments'),
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
