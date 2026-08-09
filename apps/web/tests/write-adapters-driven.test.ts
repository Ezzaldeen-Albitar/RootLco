import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * Every write adapter, EXECUTED (`P1-27-QA-001`, `FE-004`, `FE-005`).
 *
 * ## What was wrong
 *
 * Nine of the twenty-three write adapters the two feature trees export were
 * never executed by anything. Every reference to them in `apps/web/tests` was a
 * `vi.fn()` — a DOM suite mocking the module wholesale so it could render the
 * screen — so mutating the adapter changed no result anywhere:
 *
 *   creation-actions.ts        createIndividualAction, createCompanyAction
 *   governance-actions.ts      setCustomerStatusAction
 *   vehicles/history-api.ts    transferOwnershipAction
 *   vehicles/profile-api.ts    changeVehicleStatusAction
 *   vehicles/relations-api.ts  setEvProfileAction, linkCustomerAction,
 *                              authorizePartyAction, retirePartyAction
 *
 * The one place a path WAS pinned for the two creation actions —
 * `crm-customer-create.dom.test.tsx` — pinned it by reading the module's source
 * text and searching for the literal. A string scan cannot tell a path the code
 * sends from a path a comment mentions, and it survives any change to how the
 * request is built. That is the defect, not the proof.
 *
 * ## How this file executes them
 *
 * Only `@/lib/api/server-client` is mocked. The adapters, their Zod schemas and
 * their body assembly are the real ones, and the assertions are on the request
 * that came out — the same boundary the operator meets. The pattern is the one
 * `crm-profile-api.test.ts`, `duplicate-review-writes.test.ts` and
 * `governance-write-validation.test.ts` already use.
 *
 * ## Nothing here asserts a FAILURE mapping
 *
 * `fromFailure` reads `@/lib/api/client`, whose problem-details contract is
 * being corrected under a separate change. Rendering 422 field errors, conflict
 * copy chosen by `problem.code` and VIN-attributed conflict text are deferred to
 * that work and are deliberately absent. Every rejection asserted below is one
 * the EDGE makes before any request exists, which no contract change can move.
 */

const send = vi.fn();
const get = vi.fn();
const client = { send, get };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const { WRITE_DRIVES, DRIVE_IDS, exportedWriteAdapters, formOf } =
  await import('./support/write-drives');

const creation = await import('@/features/crm/customers/creation-actions');
const governance = await import('@/features/crm/customers/governance-actions');
const vehHistory = await import('@/features/vehicles/history-api');
const vehProfile = await import('@/features/vehicles/profile-api');
const vehRelations = await import('@/features/vehicles/relations-api');

const { CREATABLE_LIFECYCLE_STATUSES, MAX_COMPANY_NAME, MAX_PERSON_NAME } =
  await import('@/features/crm/customers/creation-contract');
const { MAX_PREFERRED_LOCALE, MIN_PREFERRED_LOCALE, MIN_REASON, SETTABLE_LIFECYCLE_STATES } =
  await import('@/features/crm/customers/governance-contract');
const { AUTHORIZED_ACTIONS, LINKABLE_ROLES, MAX_USABLE_CAPACITY_KWH, SCOPED_ROLE } =
  await import('@/features/vehicles/relations-contract');

const IDLE = { status: 'idle' } as const;
const {
  customer: CUSTOMER,
  vehicle: VEHICLE,
  partner: PARTNER,
  relationship: RELATIONSHIP,
} = DRIVE_IDS;

beforeEach(() => {
  send.mockReset();
  get.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
  send.mockResolvedValue({ ok: true, data: {}, correlationId: 'corr-1' });
});

/** The `[method, path, body]` a single accepted write produced. */
async function sent(
  call: () => Promise<unknown>
): Promise<[string, string, Record<string, unknown>]> {
  const state = (await call()) as { status: string };
  expect(
    send,
    `the write was refused before it sent: ${JSON.stringify(state)}`
  ).toHaveBeenCalledTimes(1);
  const [method, path, body] = send.mock.calls[0] as [string, string, Record<string, unknown>];
  return [method, path, body ?? {}];
}

/** Whether a field-error key resolves in BOTH catalogues, rather than in neither. */
function translatable(key: string | undefined): boolean {
  if (key === undefined) return false;
  return key in (en as Record<string, string>) && key in (ar as Record<string, string>);
}

/**
 * The field errors a REJECTED write returns.
 *
 * `send` must not have been called: a write that reached the client was
 * accepted, whatever the returned state looks like, and asserting only on
 * `fieldErrors` would let a silently successful write read as a rejection.
 */
async function refused(call: () => Promise<unknown>): Promise<Record<string, string>> {
  const state = (await call()) as { status: string; fieldErrors?: Record<string, string> };
  expect(send, 'the value was sent rather than refused').toHaveBeenCalledTimes(0);
  expect(state.status).toBe('invalid');
  return state.fieldErrors ?? {};
}

describe('every write adapter the feature trees export is executed', () => {
  it('drives all twenty-three, and fails closed when a twenty-fourth appears', () => {
    /*
     * The completeness mechanism, and the reason this is a set comparison rather
     * than a count.
     *
     * `p1-27-qa.test.ts` used to pin the count at twenty-three and record that
     * three were driven — an honest statement of a sample, which is why nine
     * adapters could stay undriven for the whole phase without anything going
     * red. A count cannot say WHICH, so adding one adapter and driving another
     * would have balanced.
     *
     * Both directions are asserted: an adapter with no drive fails, and a drive
     * naming an adapter that no longer exists fails too, so the table cannot
     * become a place to park a name.
     */
    const exported = exportedWriteAdapters();
    const driven = WRITE_DRIVES.map((drive) => drive.name).sort();

    expect(exported.length, 'no write adapters were discovered — the walk is broken').toBe(23);
    expect(new Set(driven).size, 'the drive table names the same adapter twice').toBe(
      driven.length
    );

    const undriven = exported.filter((name) => !driven.includes(name));
    expect(
      undriven,
      `these write adapters are executed by no test:\n  ${undriven.join('\n  ')}`
    ).toEqual([]);

    const phantom = driven.filter((name) => !exported.includes(name));
    expect(
      phantom,
      `these drives name an adapter that is not exported:\n  ${phantom.join('\n  ')}`
    ).toEqual([]);
  });

  it('actually issues exactly one request for each one', async () => {
    /*
     * The anti-vacuity control for every other case in this file and for the
     * scope sweep in `p1-27-qa.test.ts` that shares this table. An adapter that
     * silently stopped calling the client would satisfy a "no tenant in the
     * body" assertion perfectly, because there would be no body.
     */
    for (const drive of WRITE_DRIVES) {
      send.mockReset();
      send.mockResolvedValue({ ok: true, data: {}, correlationId: 'corr-1' });
      await drive.call();
      expect(send, `${drive.name} issued no request`).toHaveBeenCalledTimes(1);

      const [method, path] = send.mock.calls[0] as [string, string];
      expect(['POST', 'PUT', 'PATCH'], `${drive.name} used ${method}`).toContain(method);
      // Every write goes to the versioned API, and no path may carry a query
      // string: these are commands, and a body is where their input belongs.
      expect(path.startsWith('/api/v1/'), `${drive.name} sent ${path}`).toBe(true);
      expect(path, `${drive.name} put input in the query string`).not.toContain('?');
    }
  });

  it('refuses every one of them when the session has expired, before sending', async () => {
    // The ordering rule `action-support.ts` states: validate, check the session,
    // then send. A session that ended mid-form must not spend a rate-limit slot.
    for (const drive of WRITE_DRIVES) {
      send.mockReset();
      authorizedClient.mockResolvedValue(null);
      const state = (await drive.call()) as { status: string };
      expect(state.status, `${drive.name} did not report an expired session`).toBe('expired');
      expect(send, `${drive.name} sent a request with no session`).toHaveBeenCalledTimes(0);
      authorizedClient.mockResolvedValue(client as unknown);
    }
  });
});

describe('createIndividualAction — FE-004', () => {
  it('sends the operation the contract publishes, with the trimmed names', async () => {
    const [method, path, body] = await sent(() =>
      creation.createIndividualAction(
        IDLE as never,
        formOf({ givenName: '  Nadia  ', familyName: ' Khoury ', lifecycleStatus: 'active' })
      )
    );
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/customers/individuals');
    expect(body).toEqual({ givenName: 'Nadia', familyName: 'Khoury', lifecycleStatus: 'active' });
  });

  it('omits an empty preferred locale rather than sending null', async () => {
    const [, , body] = await sent(() =>
      creation.createIndividualAction(
        IDLE as never,
        formOf({
          givenName: 'Nadia',
          familyName: 'Khoury',
          lifecycleStatus: 'prospect',
          preferredLocale: '   ',
        })
      )
    );
    expect('preferredLocale' in body).toBe(false);
  });

  it('sends a preferred locale that was given', async () => {
    const [, , body] = await sent(() =>
      creation.createIndividualAction(
        IDLE as never,
        formOf({
          givenName: 'Nadia',
          familyName: 'Khoury',
          lifecycleStatus: 'prospect',
          preferredLocale: ' ar ',
        })
      )
    );
    expect(body.preferredLocale).toBe('ar');
  });

  it('refuses a name of spaces as empty rather than as long enough', async () => {
    // The backend carries not-blank CHECK constraints, so whitespace is empty
    // there however long it looks here.
    const errors = await refused(() =>
      creation.createIndividualAction(
        IDLE as never,
        formOf({ givenName: '     ', familyName: 'Khoury', lifecycleStatus: 'active' })
      )
    );
    expect(errors.givenName).toBe('field.required');
  });

  it('refuses a name past the route ceiling', async () => {
    const errors = await refused(() =>
      creation.createIndividualAction(
        IDLE as never,
        formOf({
          givenName: 'x'.repeat(MAX_PERSON_NAME + 1),
          familyName: 'Khoury',
          lifecycleStatus: 'active',
        })
      )
    );
    expect(errors.givenName).toBe('field.tooLong');
  });

  it('accepts a name at exactly the ceiling', async () => {
    // The bound in the other direction. Without this the case above would pass
    // against a schema that refused every name.
    const [, , body] = await sent(() =>
      creation.createIndividualAction(
        IDLE as never,
        formOf({
          givenName: 'x'.repeat(MAX_PERSON_NAME),
          familyName: 'Khoury',
          lifecycleStatus: 'active',
        })
      )
    );
    expect(String(body.givenName)).toHaveLength(MAX_PERSON_NAME);
  });

  it('refuses a one-character locale with a key, not with Zod prose', async () => {
    /*
     * `FE-004`. `.min(2)` is the one bound an operator can actually reach here:
     * the input's `maxLength` stops them exceeding the ceiling and nothing stops
     * them typing a single character. Before the key was supplied this produced
     * Zod's own English sentence, which `translateDynamic` renders verbatim —
     * English library prose under an Arabic label.
     */
    expect(MIN_PREFERRED_LOCALE).toBe(2);
    const errors = await refused(() =>
      creation.createIndividualAction(
        IDLE as never,
        formOf({
          givenName: 'Nadia',
          familyName: 'Khoury',
          lifecycleStatus: 'active',
          preferredLocale: 'a',
        })
      )
    );
    expect(errors.preferredLocale).toBe('field.tooShort');
    expect(translatable(errors.preferredLocale)).toBe(true);
  });

  it('refuses a locale past the ceiling', async () => {
    const errors = await refused(() =>
      creation.createIndividualAction(
        IDLE as never,
        formOf({
          givenName: 'Nadia',
          familyName: 'Khoury',
          lifecycleStatus: 'active',
          preferredLocale: 'x'.repeat(MAX_PREFERRED_LOCALE + 1),
        })
      )
    );
    expect(errors.preferredLocale).toBe('field.tooLong');
  });

  it('refuses a lifecycle status a creation may not set', async () => {
    // `CREATABLE_LIFECYCLE_STATUSES` is narrower than the search vocabulary:
    // a customer is not created blocked, inactive or merged.
    expect([...CREATABLE_LIFECYCLE_STATUSES]).toEqual(['prospect', 'active']);
    for (const status of ['blocked', 'inactive', 'merged']) {
      send.mockReset();
      const errors = await refused(() =>
        creation.createIndividualAction(
          IDLE as never,
          formOf({ givenName: 'Nadia', familyName: 'Khoury', lifecycleStatus: status })
        )
      );
      expect(errors.lifecycleStatus, status).toBeTruthy();
    }
  });

  it('hands the created customer back to the form', async () => {
    // The id the form navigates to and the duplicate warning it renders both
    // come from the response body. A state that dropped them would look like a
    // success and go nowhere.
    send.mockResolvedValue({
      ok: true,
      data: { id: CUSTOMER, displayNumber: 'C-0001', possibleDuplicates: [] },
      correlationId: 'corr-1',
    });
    const state = (await creation.createIndividualAction(
      IDLE as never,
      formOf({ givenName: 'Nadia', familyName: 'Khoury', lifecycleStatus: 'active' })
    )) as unknown as { status: string; created?: { id: string } };
    expect(state.status).toBe('success');
    expect(state.created?.id).toBe(CUSTOMER);
  });
});

describe('createCompanyAction — FE-005', () => {
  it('sends the company operation, not the individual one', async () => {
    const [method, path, body] = await sent(() =>
      creation.createCompanyAction(
        IDLE as never,
        formOf({ legalName: '  Al Nour Trading  ', lifecycleStatus: 'prospect' })
      )
    );
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/customers/companies');
    expect(body).toEqual({ legalName: 'Al Nour Trading', lifecycleStatus: 'prospect' });
  });

  it('omits a blank trade name and sends a trimmed one', async () => {
    const [, , blank] = await sent(() =>
      creation.createCompanyAction(
        IDLE as never,
        formOf({ legalName: 'Al Nour Trading', lifecycleStatus: 'active', tradeName: '  ' })
      )
    );
    expect('tradeName' in blank).toBe(false);

    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'corr-1' });
    const [, , given] = await sent(() =>
      creation.createCompanyAction(
        IDLE as never,
        formOf({ legalName: 'Al Nour Trading', lifecycleStatus: 'active', tradeName: '  Nour  ' })
      )
    );
    expect(given.tradeName).toBe('Nour');
  });

  it('refuses a blank legal name and a name past the company ceiling', async () => {
    const blank = await refused(() =>
      creation.createCompanyAction(IDLE as never, formOf({ legalName: '   ' }))
    );
    expect(blank.legalName).toBe('field.required');

    send.mockReset();
    const long = await refused(() =>
      creation.createCompanyAction(
        IDLE as never,
        formOf({ legalName: 'x'.repeat(MAX_COMPANY_NAME + 1), lifecycleStatus: 'active' })
      )
    );
    expect(long.legalName).toBe('field.tooLong');
  });

  it('defaults the lifecycle status to prospect when the form omits it', async () => {
    // The form always sends one; the default is what a caller that forgets
    // produces, and the safe direction is the weaker of the two states.
    const [, , body] = await sent(() =>
      creation.createCompanyAction(IDLE as never, formOf({ legalName: 'Al Nour Trading' }))
    );
    expect(body.lifecycleStatus).toBe('prospect');
  });
});

describe('setCustomerStatusAction — FE-013', () => {
  it('is a PUT to the status sub-resource of the encoded customer', async () => {
    const [method, path, body] = await sent(() =>
      governance.setCustomerStatusAction(
        CUSTOMER,
        IDLE as never,
        formOf({ lifecycleStatus: 'inactive', reason: '  ' + 'x'.repeat(MIN_REASON) + '  ' })
      )
    );
    expect(method).toBe('PUT');
    expect(path).toBe(`/api/v1/customers/${CUSTOMER}/status`);
    expect(body).toEqual({ lifecycleStatus: 'inactive', reason: 'x'.repeat(MIN_REASON) });
  });

  it('cannot be walked out of its own segment by a hostile id', async () => {
    const [, path] = await sent(() =>
      governance.setCustomerStatusAction(
        '../../admin/users',
        IDLE as never,
        formOf({ lifecycleStatus: 'active', reason: 'x'.repeat(MIN_REASON) })
      )
    );
    expect(path).not.toContain('../');
    expect(path).toContain('%2F');
  });

  it('refuses a reason of spaces as empty rather than as long enough', async () => {
    // `crm.partner_status_history.reason` is NOT NULL with a not-blank check,
    // because a blocked customer standing at the counter is a person somebody
    // has to be able to explain the decision to.
    const errors = await refused(() =>
      governance.setCustomerStatusAction(
        CUSTOMER,
        IDLE as never,
        formOf({ lifecycleStatus: 'blocked', reason: ' '.repeat(MIN_REASON + 5) })
      )
    );
    expect(errors.reason).toBeTruthy();
  });

  it('refuses a reason one character short of the floor and accepts it at the floor', async () => {
    const short = await refused(() =>
      governance.setCustomerStatusAction(
        CUSTOMER,
        IDLE as never,
        formOf({ lifecycleStatus: 'blocked', reason: 'x'.repeat(MIN_REASON - 1) })
      )
    );
    expect(short.reason).toBe('field.tooShort');

    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'corr-1' });
    const [, , body] = await sent(() =>
      governance.setCustomerStatusAction(
        CUSTOMER,
        IDLE as never,
        formOf({ lifecycleStatus: 'blocked', reason: 'x'.repeat(MIN_REASON) })
      )
    );
    expect(String(body.reason)).toHaveLength(MIN_REASON);
  });

  it('never accepts merged, which is an outcome rather than a status anybody assigns', async () => {
    expect([...SETTABLE_LIFECYCLE_STATES]).not.toContain('merged');
    const errors = await refused(() =>
      governance.setCustomerStatusAction(
        CUSTOMER,
        IDLE as never,
        formOf({ lifecycleStatus: 'merged', reason: 'x'.repeat(MIN_REASON) })
      )
    );
    expect(errors.lifecycleStatus).toBeTruthy();
  });

  it('accepts every state the contract says a client may set', async () => {
    for (const status of SETTABLE_LIFECYCLE_STATES) {
      send.mockReset();
      send.mockResolvedValue({ ok: true, data: {}, correlationId: 'corr-1' });
      const [, , body] = await sent(() =>
        governance.setCustomerStatusAction(
          CUSTOMER,
          IDLE as never,
          formOf({ lifecycleStatus: status, reason: 'x'.repeat(MIN_REASON) })
        )
      );
      expect(body.lifecycleStatus, status).toBe(status);
    }
  });
});

describe('transferOwnershipAction — FE-021', () => {
  it('posts to the vehicle ownerships collection with the chosen partner', async () => {
    const [method, path, body] = await sent(() =>
      vehHistory.transferOwnershipAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, ownershipKind: 'fleet', effectiveDate: '2026-06-30' })
      )
    );
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/vehicles/${VEHICLE}/ownerships`);
    expect(body).toEqual({
      partnerId: PARTNER,
      ownershipKind: 'fleet',
      effectiveDate: '2026-06-30',
    });
  });

  it('omits every optional field the operator left blank', async () => {
    // An omitted optional lets the ROUTE's own default stand. Sending `''` is a
    // 422 the operator cannot act on.
    const [, , body] = await sent(() =>
      vehHistory.transferOwnershipAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, ownershipKind: '', effectiveDate: '', transferReason: '  ' })
      )
    );
    expect(Object.keys(body)).toEqual(['partnerId']);
  });

  it('refuses a partner that is not a uuid, with the selector key rather than Zod prose', async () => {
    // The only honest control for a `partnerId` is a chooser; a typed value can
    // only arrive from a tampered form.
    const errors = await refused(() =>
      vehHistory.transferOwnershipAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: 'Layla Haddad' })
      )
    );
    expect(errors.partnerId).toBe('vehicles.ownership.error.customer');
    expect(translatable(errors.partnerId)).toBe(true);
  });

  it('refuses a date that is not ten characters', async () => {
    // Ten characters, straight from a `date` input: no time, no zone, so the
    // calendar day the operator picked cannot shift.
    for (const date of ['2026-6-30', '2026-06-30T00:00:00Z']) {
      send.mockReset();
      const errors = await refused(() =>
        vehHistory.transferOwnershipAction(
          VEHICLE,
          IDLE as never,
          formOf({ partnerId: PARTNER, effectiveDate: date })
        )
      );
      expect(errors.effectiveDate, date).toBe('vehicles.plate.error.date');
    }
  });

  it('does NOT refuse a ten-character date in the wrong ORDER — recorded, not fixed', async () => {
    /*
     * The bound in the other direction, and it corrected this file's own first
     * draft: `30/06/2026` was asserted as refused, and it is not. Both history
     * writes measure `effectiveDate` with `.length(10)` and no pattern, so a
     * day-first date is exactly ten characters and passes the edge.
     *
     * Recorded rather than tightened, for the reason `RecordForm`'s `FieldSpec`
     * docblock gives: the control is a `date` input, which can only produce
     * `YYYY-MM-DD`, so this value cannot arrive from the screen — and the route's
     * own schema is the authority on the format. A client bound stricter than the
     * server's refuses values the server would have stored. `retirePartyAction`
     * next door DOES carry the pattern, so the two are inconsistent; making them
     * agree is a decision about which side is right, not a test fix.
     */
    const [, , body] = await sent(() =>
      vehHistory.transferOwnershipAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, effectiveDate: '30/06/2026' })
      )
    );
    expect(body.effectiveDate).toBe('30/06/2026');
  });

  it('refuses an ownership kind outside the CHECK constraint', async () => {
    const errors = await refused(() =>
      vehHistory.transferOwnershipAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, ownershipKind: 'lessee' })
      )
    );
    expect(errors.ownershipKind).toBeTruthy();
  });
});

describe('assignPlateAction — FE-022', () => {
  it('uppercases the country code and posts the raw plate as typed', async () => {
    // Uppercased ONLY when present: the normalised plate is what the uniqueness
    // constraint is built on, and the country code column is upper case.
    const [method, path, body] = await sent(() =>
      vehHistory.assignPlateAction(
        VEHICLE,
        IDLE as never,
        formOf({ countryCode: ' jo ', plateRaw: ' 12-3456 ', effectiveDate: '2026-01-01' })
      )
    );
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/vehicles/${VEHICLE}/plates`);
    expect(body).toEqual({
      countryCode: 'JO',
      plateRaw: '12-3456',
      effectiveDate: '2026-01-01',
    });
  });

  it('refuses a country code of one character and of four', async () => {
    // Two to three, matching the route. The scope-smuggle sweep that was this
    // action's only driver asserted nothing about the schema, so it passed
    // whether or not these bounds worked at all.
    for (const code of ['J', 'JORD']) {
      send.mockReset();
      const errors = await refused(() =>
        vehHistory.assignPlateAction(
          VEHICLE,
          IDLE as never,
          formOf({ countryCode: code, plateRaw: '12-3456' })
        )
      );
      expect(errors.countryCode, code).toBe('vehicles.plate.error.country');
    }
  });

  it('accepts a three-character country code', async () => {
    const [, , body] = await sent(() =>
      vehHistory.assignPlateAction(
        VEHICLE,
        IDLE as never,
        formOf({ countryCode: 'jor', plateRaw: '12-3456' })
      )
    );
    expect(body.countryCode).toBe('JOR');
  });

  it('refuses a plate of spaces and omits an unset effective date', async () => {
    const errors = await refused(() =>
      vehHistory.assignPlateAction(
        VEHICLE,
        IDLE as never,
        formOf({ countryCode: 'JO', plateRaw: '   ' })
      )
    );
    expect(errors.plateRaw).toBe('field.required');

    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'corr-1' });
    const [, , body] = await sent(() =>
      vehHistory.assignPlateAction(
        VEHICLE,
        IDLE as never,
        formOf({ countryCode: 'JO', plateRaw: '12-3456', effectiveDate: '' })
      )
    );
    expect('effectiveDate' in body).toBe(false);
  });

  it('refuses an effective date that is not exactly ten characters', async () => {
    const errors = await refused(() =>
      vehHistory.assignPlateAction(
        VEHICLE,
        IDLE as never,
        formOf({ countryCode: 'JO', plateRaw: '12-3456', effectiveDate: '2026-1-1' })
      )
    );
    expect(errors.effectiveDate).toBe('vehicles.plate.error.date');
  });
});

describe('changeVehicleStatusAction — FE-019', () => {
  it('is a PATCH to the status sub-resource', async () => {
    const [method, path, body] = await sent(() =>
      vehProfile.changeVehicleStatusAction(
        VEHICLE,
        IDLE as never,
        formOf({ lifecycleStatus: 'inactive', workshopStatus: '' })
      )
    );
    expect(method).toBe('PATCH');
    expect(path).toBe(`/api/v1/vehicles/${VEHICLE}/status`);
    // Only the axis the operator actually moved. Sending the untouched one would
    // be a second status change nobody asked for.
    expect(body).toEqual({ lifecycleStatus: 'inactive' });
  });

  it('sends the workshop axis on its own', async () => {
    const [, , body] = await sent(() =>
      vehProfile.changeVehicleStatusAction(
        VEHICLE,
        IDLE as never,
        formOf({ lifecycleStatus: '', workshopStatus: 'in_workshop' })
      )
    );
    expect(body).toEqual({ workshopStatus: 'in_workshop' });
  });

  it('refuses an empty submission locally rather than sending an empty PATCH', async () => {
    // Both selects left on "leave unchanged". A `{}` body is a request that can
    // only be refused, and the operator would learn nothing from the refusal.
    const errors = await refused(() =>
      vehProfile.changeVehicleStatusAction(
        VEHICLE,
        IDLE as never,
        formOf({ lifecycleStatus: '', workshopStatus: '  ' })
      )
    );
    expect(errors.lifecycleStatus).toBe('vehicles.profile.chooseAStatus');
    expect(translatable(errors.lifecycleStatus)).toBe(true);
  });

  it('refuses a status outside either vocabulary', async () => {
    for (const form of [{ lifecycleStatus: 'sold' }, { workshopStatus: 'washing' }]) {
      send.mockReset();
      const errors = await refused(() =>
        vehProfile.changeVehicleStatusAction(VEHICLE, IDLE as never, formOf(form))
      );
      expect(Object.keys(errors).length, JSON.stringify(form)).toBeGreaterThan(0);
    }
  });
});

describe('updateVehicleAction — FE-019', () => {
  it('PATCHes only the fields the panel says changed', async () => {
    const [method, path, body] = await sent(() =>
      vehProfile.updateVehicleAction(VEHICLE, { color: 'Blue' }, IDLE as never)
    );
    expect(method).toBe('PATCH');
    expect(path).toBe(`/api/v1/vehicles/${VEHICLE}`);
    expect(body).toEqual({ color: 'Blue' });
  });

  it('keeps an explicit null distinct from an omission', async () => {
    // Absent leaves the column untouched; an explicit null CLEARS it. Collapsing
    // the two would wipe a vehicle's description on the first edit.
    const [, , body] = await sent(() =>
      vehProfile.updateVehicleAction(VEHICLE, { color: null }, IDLE as never)
    );
    expect(body).toEqual({ color: null });
    expect('displayNumber' in body).toBe(false);
  });

  it('sends nothing at all when nothing changed', async () => {
    const state = (await vehProfile.updateVehicleAction(VEHICLE, {}, IDLE as never)) as {
      status: string;
    };
    expect(state.status).toBe('idle');
    expect(send).toHaveBeenCalledTimes(0);
  });
});

describe('setEvProfileAction — FE-024', () => {
  it('posts the whole profile, because the operation is a replace', async () => {
    const [method, path, body] = await sent(() =>
      vehRelations.setEvProfileAction(
        VEHICLE,
        IDLE as never,
        formOf({ evKind: 'bev', usableCapacityKwh: '64', chargePortType: ' CCS2 ' })
      )
    );
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/vehicles/${VEHICLE}/ev-profile`);
    expect(body).toEqual({
      evKind: 'bev',
      usableCapacityKwh: 64,
      chargePortType: 'CCS2',
      // A checkbox is ABSENT from FormData when unchecked, and the field is a
      // boolean: reading it as a string would send `"false"` to a strict schema.
      highVoltageWarning: false,
    });
  });

  it('sends the capacity as a NUMBER, never as the string a form field yields', async () => {
    const [, , body] = await sent(() =>
      vehRelations.setEvProfileAction(VEHICLE, IDLE as never, formOf({ evKind: 'phev' }))
    );
    expect(typeof body.usableCapacityKwh === 'number' || body.usableCapacityKwh === null).toBe(
      true
    );
  });

  it('accepts a capacity of zero — the client must not be stricter than the route', async () => {
    /*
     * This schema was `.positive()` while the route declares
     * `z.number().min(0)`. A client bound tighter than the server's refuses a
     * value the server would have stored, with an error the operator cannot act
     * on. Zero is a real reading: a battery that has been removed, or one
     * recorded as unknown-and-zero.
     */
    const [, , body] = await sent(() =>
      vehRelations.setEvProfileAction(
        VEHICLE,
        IDLE as never,
        formOf({ evKind: 'bev', usableCapacityKwh: '0' })
      )
    );
    expect(body.usableCapacityKwh).toBe(0);
  });

  it('refuses a capacity above the domain ceiling', async () => {
    const errors = await refused(() =>
      vehRelations.setEvProfileAction(
        VEHICLE,
        IDLE as never,
        formOf({ evKind: 'bev', usableCapacityKwh: String(MAX_USABLE_CAPACITY_KWH + 1) })
      )
    );
    expect(errors.usableCapacityKwh).toBe('field.tooLong');
  });

  it('clears an emptied field with an explicit null rather than omitting it', async () => {
    // A replace: an omitted field is CLEARED anyway, so the two agree — but an
    // explicit null says so, and the form is pre-filled from the current profile
    // precisely so saving one field does not silently erase the others.
    const [, , body] = await sent(() =>
      vehRelations.setEvProfileAction(
        VEHICLE,
        IDLE as never,
        formOf({ evKind: 'bev', usableCapacityKwh: '', chargePortType: '  ' })
      )
    );
    expect(body.usableCapacityKwh).toBeNull();
    expect(body.chargePortType).toBeNull();
  });

  it('sends the high-voltage warning as true when the box is ticked', async () => {
    const [, , body] = await sent(() =>
      vehRelations.setEvProfileAction(
        VEHICLE,
        IDLE as never,
        formOf({ evKind: 'hybrid', highVoltageWarning: 'on' })
      )
    );
    expect(body.highVoltageWarning).toBe(true);
  });

  it('refuses an EV kind outside the vocabulary', async () => {
    const errors = await refused(() =>
      vehRelations.setEvProfileAction(VEHICLE, IDLE as never, formOf({ evKind: 'electric' }))
    );
    expect(errors.evKind).toBeTruthy();
  });
});

describe('linkCustomerAction — FE-025', () => {
  it('addresses the CUSTOMER, with the vehicle in the body', async () => {
    /*
     * The mirror of every other write on this screen, and the reason it is worth
     * executing: `crm.vehicle-link` is a CRM operation with a customer-centric
     * path. An implementation that reached for the vehicle path would 404, and
     * a mocked reference could never tell.
     */
    const [method, path, body] = await sent(() =>
      vehRelations.linkCustomerAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, relationshipRole: 'driver' })
      )
    );
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/customers/${PARTNER}/vehicles`);
    expect(body).toEqual({ vehicleId: VEHICLE, relationshipRole: 'driver' });
  });

  it('refuses the one role that may carry an authorization scope', async () => {
    // `ck_vehicle_relationships_scope_role` makes `authorized_person` the only
    // role allowed a scope, and this operation sets none — so a link in that
    // role would create the bad row the dedicated authorise operation exists for.
    expect([...LINKABLE_ROLES]).not.toContain(SCOPED_ROLE);
    const errors = await refused(() =>
      vehRelations.linkCustomerAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, relationshipRole: SCOPED_ROLE })
      )
    );
    expect(errors.relationshipRole).toBeTruthy();
  });

  it('accepts every linkable role', async () => {
    for (const role of LINKABLE_ROLES) {
      send.mockReset();
      send.mockResolvedValue({ ok: true, data: {}, correlationId: 'corr-1' });
      const [, , body] = await sent(() =>
        vehRelations.linkCustomerAction(
          VEHICLE,
          IDLE as never,
          formOf({ partnerId: PARTNER, relationshipRole: role })
        )
      );
      expect(body.relationshipRole, role).toBe(role);
    }
  });

  it('refuses a partner that is not a uuid', async () => {
    const errors = await refused(() =>
      vehRelations.linkCustomerAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: 'Layla Haddad', relationshipRole: 'driver' })
      )
    );
    expect(errors.partnerId).toBe('vehicles.ownership.error.customer');
  });
});

describe('authorizePartyAction — FE-025', () => {
  it('posts the scope to the vehicle authorized-parties collection', async () => {
    const [method, path, body] = await sent(() =>
      vehRelations.authorizePartyAction(
        VEHICLE,
        IDLE as never,
        formOf({
          partnerId: PARTNER,
          allowedActions: ['approve_quotation', 'receive_vehicle'],
          effectiveDate: '2026-06-30',
        })
      )
    );
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/vehicles/${VEHICLE}/authorized-parties`);
    expect(body).toEqual({
      partnerId: PARTNER,
      // Every ticked box, in order. Reading one value from a multi-valued field
      // would silently drop the rest of the scope.
      allowedActions: ['approve_quotation', 'receive_vehicle'],
      effectiveDate: '2026-06-30',
    });
  });

  it('refuses an empty scope, which the constraint forbids', async () => {
    const errors = await refused(() =>
      vehRelations.authorizePartyAction(VEHICLE, IDLE as never, formOf({ partnerId: PARTNER }))
    );
    expect(errors.allowedActions).toBe('vehicles.relationships.scopeEmpty');
    expect(translatable(errors.allowedActions)).toBe(true);
  });

  it('refuses an action outside the six the constraint names', async () => {
    expect(AUTHORIZED_ACTIONS).toHaveLength(6);
    const errors = await refused(() =>
      vehRelations.authorizePartyAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, allowedActions: ['approve_quotation', 'take_ownership'] })
      )
    );
    expect(errors.allowedActions).toBeTruthy();
  });

  it('omits an unset effective date rather than deriving one', async () => {
    // Omitting it lets the DATABASE SERVER's calendar decide the start day,
    // which is a different day from the operator's in most of the world — so an
    // unset date is sent as absent deliberately, and the screen says so.
    const [, , body] = await sent(() =>
      vehRelations.authorizePartyAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, allowedActions: ['receive_reports'], effectiveDate: '  ' })
      )
    );
    expect('effectiveDate' in body).toBe(false);
  });

  it('refuses a malformed effective date', async () => {
    const errors = await refused(() =>
      vehRelations.authorizePartyAction(
        VEHICLE,
        IDLE as never,
        formOf({
          partnerId: PARTNER,
          allowedActions: ['receive_reports'],
          effectiveDate: '30-06-2026',
        })
      )
    );
    expect(errors.effectiveDate).toBe('field.required');
  });
});

describe('retirePartyAction — FE-025', () => {
  it('posts to the retirement sub-resource of the relationship, both ids encoded', async () => {
    const [method, path, body] = await sent(() =>
      vehRelations.retirePartyAction(
        VEHICLE,
        RELATIONSHIP,
        IDLE as never,
        formOf({ effectiveDate: '2026-06-30' })
      )
    );
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/vehicles/${VEHICLE}/authorized-parties/${RELATIONSHIP}/retirement`);
    expect(body).toEqual({ effectiveDate: '2026-06-30' });
  });

  it('is a retirement rather than a deletion', async () => {
    // The relationship stays in the history with a `valid_to`, which is what
    // makes "who was authorized last March" answerable.
    const [method, path] = await sent(() =>
      vehRelations.retirePartyAction(VEHICLE, RELATIONSHIP, IDLE as never, formOf({}))
    );
    expect(method).not.toBe('DELETE');
    expect(path.endsWith('/retirement')).toBe(true);
  });

  it('sends an empty body when the operator chose no date', async () => {
    const [, , body] = await sent(() =>
      vehRelations.retirePartyAction(VEHICLE, RELATIONSHIP, IDLE as never, formOf({}))
    );
    expect(body).toEqual({});
  });

  it('refuses a malformed date before sending', async () => {
    const errors = await refused(() =>
      vehRelations.retirePartyAction(
        VEHICLE,
        RELATIONSHIP,
        IDLE as never,
        formOf({ effectiveDate: 'yesterday' })
      )
    );
    expect(errors.effectiveDate).toBe('field.required');
  });

  it('cannot be walked out of its segment by a hostile relationship id', async () => {
    const [, path] = await sent(() =>
      vehRelations.retirePartyAction(VEHICLE, '../../vehicles', IDLE as never, formOf({}))
    );
    expect(path).not.toContain('../');
    expect(path).toContain('%2F');
  });
});

describe('every field error these adapters produce is translatable', () => {
  it('never returns a message that is missing from either catalogue', async () => {
    /*
     * `FE-004`, asserted against the nine adapters this file exists for. A key
     * that resolves in neither catalogue renders as itself — a dotted identifier
     * under a form field — which is no better than the English library sentence
     * it replaced, only stranger.
     */
    const cases: Array<() => Promise<unknown>> = [
      () => creation.createIndividualAction(IDLE as never, formOf({ preferredLocale: 'a' })),
      () => creation.createCompanyAction(IDLE as never, formOf({ legalName: '' })),
      () =>
        governance.setCustomerStatusAction(
          CUSTOMER,
          IDLE as never,
          formOf({ lifecycleStatus: 'nope', reason: 'no' })
        ),
      () =>
        vehHistory.transferOwnershipAction(
          VEHICLE,
          IDLE as never,
          formOf({ partnerId: 'nope', effectiveDate: 'nope' })
        ),
      () =>
        vehHistory.assignPlateAction(
          VEHICLE,
          IDLE as never,
          formOf({ countryCode: 'X', plateRaw: '' })
        ),
      () => vehProfile.changeVehicleStatusAction(VEHICLE, IDLE as never, formOf({})),
      () =>
        vehRelations.setEvProfileAction(
          VEHICLE,
          IDLE as never,
          formOf({ evKind: 'nope', usableCapacityKwh: '-1' })
        ),
      () =>
        vehRelations.linkCustomerAction(
          VEHICLE,
          IDLE as never,
          formOf({ partnerId: 'nope', relationshipRole: 'nope' })
        ),
      () => vehRelations.authorizePartyAction(VEHICLE, IDLE as never, formOf({ partnerId: 'x' })),
      () =>
        vehRelations.retirePartyAction(
          VEHICLE,
          RELATIONSHIP,
          IDLE as never,
          formOf({ effectiveDate: 'nope' })
        ),
    ];

    let asserted = 0;
    for (const build of cases) {
      send.mockReset();
      const errors = await refused(build);
      // Each case must actually produce errors, or the loop proves nothing.
      expect(Object.keys(errors).length).toBeGreaterThan(0);
      for (const message of Object.values(errors)) {
        expect(message in (en as Record<string, string>), `${message} missing from en`).toBe(true);
        expect(message in (ar as Record<string, string>), `${message} missing from ar`).toBe(true);
        asserted += 1;
      }
    }
    expect(asserted).toBeGreaterThan(9);
  });
});
