import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';
import { permittedWrites } from '@/features/crm/customers/governance-contract';
import { CRM_PERMISSIONS } from '@/features/crm/permissions';
import type { CustomerDetail } from '@/features/crm/customers/profile-contract';
import type { ActionState } from '@/lib/forms/action-result';

/*
 * Fields are resolved by ROLE and accessible name, not by `getByLabelText`.
 *
 * `RecordForm` puts the required marker INSIDE the `<label>` as
 * `<span aria-hidden="true">`. Accessible-name computation excludes an
 * aria-hidden node, so the name of a required control is exactly its label —
 * but `getByLabelText` reads the label's `textContent`, which does not honour
 * `aria-hidden` and therefore sees the marker too. Every required field in this
 * file failed to resolve that way on the first run.
 */
const field = (container: HTMLElement, name: string) =>
  within(container).getByRole('combobox', { name });
const textbox = (container: HTMLElement, name: string) =>
  within(container).getByRole('textbox', { name });

/**
 * The consents form's submit control, resolved by ROLE inside the form rather
 * than by its accessible NAME.
 *
 * `RecordForm` renders its heading and its submit label from the same message
 * key, and the button's label flips to the pending text while a transition is in
 * flight — so `findByRole('button', { name: … })` can miss a button that is
 * present, which is exactly what the captured failure showed: the error's own
 * accessible-roles dump listed an `<h3>` carrying the name it said it could not
 * find.
 *
 * Waiting for the HEADING is the deterministic signal that the form has mounted;
 * the submit control is then the only button inside that form. This does not
 * depend on knowing why the label differs, which is the point — a query that is
 * correct either way beats a longer timeout on a query that is not.
 */
async function consentForm(): Promise<{ form: HTMLElement; submit: HTMLElement }> {
  const heading = await screen.findByRole(
    'heading',
    { name: en['crm.customers.consents.record'] },
    WAIT
  );
  const form = heading.closest('form');
  expect(form, 'the consents heading is not inside a form').not.toBeNull();
  return { form: form as HTMLElement, submit: within(form as HTMLElement).getByRole('button') };
}

/**
 * `NEW-FE-01` proved through REAL consumers, not the component alone.
 *
 * ## Why this file exists although `record-form.dom.test.tsx` already passes
 *
 * That file renders `RecordForm` directly with a two-field fixture of its own
 * making. It proves the component. It does not prove that any shipped screen
 * gets the behaviour, because a consumer can defeat it — by keying the form on
 * something stable, by remounting the section after a failure, by rendering the
 * select outside `RecordForm` entirely. Eleven P1-27 write surfaces render
 * through this component and none of them was the thing under test.
 *
 * The same gap in the opposite direction is what made `FE-004` shippable: the
 * creation screen had its own form, so a passing `RecordForm` would have proved
 * nothing about it either.
 *
 * ## The two chosen consumers
 *
 * **CRM — the consents section.** Four selects, and a consent is a legal record.
 * `RECORDABLE_CONSENT_STATUSES` is `['granted', 'withdrawn']`, so the reset
 * target and the operator's likely intent are OPPOSITE: an operator recording a
 * withdrawal whose select silently returns to `granted` can press the button
 * again and record the customer consenting to the thing they just refused. That
 * is the worst instance of this defect in the phase.
 *
 * **Vehicle — the EV profile.** A different tree, a different action shape
 * (`create-or-REPLACE`), and a form that is pre-filled rather than empty — so
 * the reset target here is a real value rather than a placeholder, which is the
 * case most likely to hide the defect from a reviewer.
 *
 * ## What is asserted, per consumer
 *
 * The operator chooses a non-default option, submits, the transport fails, and
 * then: the form is still rendered · text still there · the select still on the
 * operator's exact choice · the action called exactly ONCE, so nothing retried
 * behind their back and spent a second write attempt.
 */

/*
 * ## The intermittent in this file, and the mechanism — measured, not guessed
 *
 * The first consent case failed four times in full-suite runs while passing in
 * isolation. Two theories were wrong before the message was captured, and both
 * are recorded because each cost a cycle.
 *
 * **What it actually is.** The captured failure is
 * `Unable to find an accessible element with the role "button" and name
 * "Record a consent decision"` — and the accessible-roles dump printed WITH that
 * error shows an `<h3>` carrying exactly that name. `RecordForm` renders its
 * title and its submit label from the same key, so the form HAD rendered by the
 * time the error was composed. The query simply gave up first.
 *
 * `findByRole` carries its OWN default timeout of 1 s, separate from `waitFor`'s.
 * The consents section renders its form only after an async read resolves, and
 * under full-suite load that read exceeds a second.
 *
 * **The wrong turns.** First it was called unexplained, correctly, because
 * nothing had been captured. Then the timeout hypothesis was applied to the
 * `waitFor` calls — the right kind of cause attached to the wrong calls — and it
 * recurred, which is what proved that fix incomplete rather than wrong. Both
 * timeouts are given room now; a default timeout is a bet on machine load, and
 * `findBy*` hides one where a reader looks for `waitFor`.
 *
 * What is under test is the form's behaviour, never how fast the machine is.
 */
const WAIT = { timeout: 10_000 };

const listConsents = vi.fn();
const recordConsentAction = vi.fn();
const setEvProfileAction = vi.fn();

const page = (rows: readonly unknown[] = []) => ({
  status: 'ok',
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'fixed-correlation-id',
});

vi.mock('@/features/crm/customers/profile-api', () => ({
  readCustomer: vi.fn(),
  listContacts: vi.fn(async () => page()),
  listAddresses: vi.fn(async () => page()),
  listPreferences: vi.fn(async () => page()),
  listConsents: (...a: unknown[]) => listConsents(...a),
  listNotes: vi.fn(async () => page()),
  listAlerts: vi.fn(async () => page()),
  listTags: vi.fn(async () => page()),
  listRestrictions: vi.fn(async () => page()),
}));

// Unmocked this reaches `authorizedClient` and calls `cookies()` outside a
// request scope — the same trap `crm-customer-components.dom.test.tsx` documents.
vi.mock('@/features/crm/customers/identity-api', () => ({
  listTimeline: async () => page(),
  listDuplicates: async () => page(),
  reviewDuplicateAction: vi.fn(),
}));

vi.mock('@/features/crm/customers/governance-actions', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    recordConsentAction: (...a: unknown[]) => recordConsentAction(...a),
  };
});

vi.mock('@/features/vehicles/relations-api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    setEvProfileAction: (...a: unknown[]) => setEvProfileAction(...a),
    listRelationships: async () => page(),
  };
});
vi.mock('@/features/crm/customers/api', () => ({ searchCustomers: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { CustomerProfileScreen } =
  await import('@/features/crm/customers/components/CustomerProfileScreen');
const { EvProfileSection } =
  await import('@/features/vehicles/components/VehicleRelationsSections');

/** What a transport failure looks like to a form. Not a validation rejection. */
const UNAVAILABLE: ActionState = {
  status: 'unavailable',
  messageKey: 'state.unavailable.title',
  correlationId: 'corr-consumer-1',
  attempt: 1,
};

const CUSTOMER: CustomerDetail = {
  id: '2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f',
  displayNumber: 'C-0001',
  displayName: 'Nadia Khoury',
  partyType: 'individual',
  lifecycleStatus: 'active',
  commercialStatus: 'normal',
  recordVersion: 3,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: null,
  givenName: 'Nadia',
  familyName: 'Khoury',
  preferredLocale: 'ar',
  legalName: null,
  tradeName: null,
};

beforeEach(() => {
  listConsents.mockReset();
  listConsents.mockResolvedValue(page());
  recordConsentAction.mockReset();
  recordConsentAction.mockResolvedValue(UNAVAILABLE);
  setEvProfileAction.mockReset();
  setEvProfileAction.mockResolvedValue(UNAVAILABLE);
});

describe('CRM consumer — a consent decision survives a failed write', () => {
  it('keeps Withdrawn selected, so a retry cannot record the opposite', async () => {
    const user = userEvent.setup();
    renderLtr(
      <CustomerProfileScreen
        locale="en"
        messages={en}
        customer={CUSTOMER}
        // Since SEC-001 a successful read is necessary and no longer sufficient;
        // the caller must also hold the write for the form to render at all.
        writes={permittedWrites([CRM_PERMISSIONS.consentWrite])}
      />
    );
    await user.click(screen.getByRole('button', { name: /Consents/ }));
    await waitFor(() => expect(listConsents).toHaveBeenCalled(), WAIT);

    const { submit: form } = await consentForm();

    /*
     * `withdrawn` is deliberately the SECOND option. Asserting `granted` would
     * pass whether or not the value survived, because `granted` is also what a
     * reset returns to — the two coincide, which is exactly what hid this defect
     * in `RecordForm` until the component was rendered directly.
     */
    /*
     * ALL FOUR selects are `required`, so leaving any empty makes HTML
     * validation block the submit and the action is never called — the form
     * then looks unreachable rather than broken. `ev-profile.dom.test.tsx`
     * records hitting the same thing; this file hit it too.
     */
    const body = document.body;
    await user.selectOptions(field(body, en['crm.customers.column.status']), 'withdrawn');
    await user.selectOptions(field(body, en['crm.customers.consents.kind']), 'marketing');
    await user.selectOptions(field(body, en['crm.customers.contacts.channel']), 'email');
    await user.selectOptions(field(body, en['crm.customers.preferences.purpose']), 'marketing');
    await user.type(textbox(body, en['crm.customers.consents.source']), 'Telephone call, 09:40');
    await user.click(form);

    await waitFor(() => expect(recordConsentAction).toHaveBeenCalled(), WAIT);

    // 4 — the form is still there rather than replaced by an error page.
    expect((await consentForm()).submit, 'the form was replaced by an error page').toBeTruthy();
    // 5 — typed text survives.
    expect(textbox(body, en['crm.customers.consents.source'])).toHaveValue('Telephone call, 09:40');
    // 6 — and so does every chosen option. This is the assertion that was absent.
    expect(
      field(body, en['crm.customers.column.status']),
      'a retry would now record the opposite of the customer decision'
    ).toHaveValue('withdrawn');
    expect(field(body, en['crm.customers.consents.kind'])).toHaveValue('marketing');
    // 7 — exactly one attempt. A silent retry spends a second write.
    expect(recordConsentAction).toHaveBeenCalledTimes(1);
  });

  it('DOES clear on success, because a consent record is an append', async () => {
    /*
     * The control, and it is consumer-specific rather than generic. Without it
     * the case above would pass against a form that never clears — which for an
     * APPEND form is its own defect: the second consent decision of the morning
     * starts pre-filled with the first one's answers, and an operator who
     * changes only the kind records the previous status against the new consent.
     *
     * Note the contrast with the EV consumer below, which must NOT clear. The
     * two semantics are opposite and both are correct; a test asserting one
     * behaviour for "RecordForm" in general would be wrong for half the phase.
     */
    recordConsentAction.mockResolvedValue({ status: 'success' } satisfies ActionState);
    const user = userEvent.setup();
    renderLtr(
      <CustomerProfileScreen
        locale="en"
        messages={en}
        customer={CUSTOMER}
        writes={permittedWrites([CRM_PERMISSIONS.consentWrite])}
      />
    );
    await user.click(screen.getByRole('button', { name: /Consents/ }));
    const { submit } = await consentForm();

    const body = document.body;
    await user.selectOptions(field(body, en['crm.customers.column.status']), 'withdrawn');
    await user.selectOptions(field(body, en['crm.customers.consents.kind']), 'marketing');
    await user.selectOptions(field(body, en['crm.customers.contacts.channel']), 'email');
    await user.selectOptions(field(body, en['crm.customers.preferences.purpose']), 'marketing');
    await user.type(textbox(body, en['crm.customers.consents.source']), 'Telephone call, 09:40');
    await user.click(submit);

    await waitFor(() => expect(recordConsentAction).toHaveBeenCalledTimes(1), WAIT);
    await waitFor(
      () => expect(textbox(body, en['crm.customers.consents.source'])).toHaveValue(''),
      WAIT
    );
  });
});

describe('Vehicle consumer — the EV profile survives a failed write', () => {
  function renderEv() {
    return renderLtr(
      <EvProfileSection
        locale="en"
        messages={en}
        state={{
          status: 'ok',
          profile: {
            evKind: 'bev',
            usableCapacityKwh: '64.50',
            chargePortType: 'CCS2',
            highVoltageWarning: true,
          },
        }}
        powertrainCategory="ev"
        canEdit
        vehicleId="v-1"
      />
    );
  }

  it('keeps the chosen kind and the edited port after a transport failure', async () => {
    /*
     * The pre-filled case, which is the one most likely to hide the defect: the
     * form opens holding real values, so a reviewer eyeballing it after a failure
     * sees a populated form and moves on. `phev` is chosen precisely because the
     * prefill is `bev` — a reset would return it there and look deliberate.
     *
     * The write is create-or-REPLACE, so losing a field is not losing a keystroke:
     * an omitted field is CLEARED on the record.
     */
    const user = userEvent.setup();
    const view = renderEv();

    await user.selectOptions(field(view.container, en['vehicles.ev.kind']), 'phev');
    const port = textbox(view.container, en['vehicles.ev.port']);
    await user.clear(port);
    await user.type(port, 'CHAdeMO');
    await user.click(
      within(view.container).getByRole('button', { name: en['vehicles.ev.record'] })
    );

    await waitFor(() => expect(setEvProfileAction).toHaveBeenCalled());

    expect(
      within(view.container).getByRole('button', { name: en['vehicles.ev.record'] })
    ).toBeTruthy();
    expect(textbox(view.container, en['vehicles.ev.port'])).toHaveValue('CHAdeMO');
    expect(
      field(view.container, en['vehicles.ev.kind']),
      'the chosen powertrain reverted to the prefill'
    ).toHaveValue('phev');
    expect(within(view.container).getByLabelText(en['vehicles.ev.capacity'])).toHaveValue(64.5);
    expect(setEvProfileAction).toHaveBeenCalledTimes(1);
  });

  it('keeps the HIGH-VOLTAGE flag ticked after a failed write', async () => {
    /*
     * The field this file walked straight past on its first version.
     *
     * `NEW-FE-01` was fixed for `<select>` and the checkbox branch of the same
     * component was left as a controlled `checked=`. React resyncs a text
     * input's DOM default on every render but assigns `defaultChecked` only when
     * `checked` is nullish, so a controlled checkbox's default is frozen at its
     * mount value: `form.reset()` returns it to how it started while every
     * neighbour survives. The form LOOKS intact, which is why nobody saw it.
     *
     * `veh.vehicle-ev-profile-set` is a REPLACE. The operator ticks the hazard
     * flag on a vehicle that did not carry one, the write fails on transport,
     * the box silently un-ticks, and pressing Save again — having changed
     * nothing they can see — sends no `highVoltageWarning` at all. The adapter
     * maps absence to `false` and the record is stored WITHOUT the high-voltage
     * warning, successfully.
     */
    const user = userEvent.setup();
    const view = renderLtr(
      <EvProfileSection
        locale="en"
        messages={en}
        state={{
          status: 'ok',
          profile: {
            evKind: 'bev',
            usableCapacityKwh: '64.50',
            chargePortType: 'CCS2',
            // Deliberately NOT set, so ticking it is a real change and the
            // reset target and the operator's intent are opposite.
            highVoltageWarning: false,
          },
        }}
        powertrainCategory="ev"
        canEdit
        vehicleId="v-1"
      />
    );

    const hazard = within(view.container).getByRole('checkbox', {
      name: en['vehicles.ev.highVoltage'],
    });
    await user.click(hazard);
    await user.click(
      within(view.container).getByRole('button', { name: en['vehicles.ev.record'] })
    );

    await waitFor(() => expect(setEvProfileAction).toHaveBeenCalledTimes(1));
    expect(
      (setEvProfileAction.mock.calls[0]?.[2] as FormData | undefined)?.get('highVoltageWarning'),
      'the tick never reached the first attempt'
    ).toBe('on');

    // The tick must still be there for the operator to see and to resend.
    expect(
      within(view.container).getByRole('checkbox', { name: en['vehicles.ev.highVoltage'] }),
      'the high-voltage flag silently un-ticked after a transport failure'
    ).toBeChecked();

    // And the retry must still carry it. This is the assertion that matters:
    // the visible state and what is SENT can disagree.
    await user.click(
      within(view.container).getByRole('button', { name: en['vehicles.ev.record'] })
    );
    await waitFor(() => expect(setEvProfileAction).toHaveBeenCalledTimes(2));
    expect(
      (setEvProfileAction.mock.calls[1]?.[2] as FormData | undefined)?.get('highVoltageWarning'),
      'the retry stored the safety flag as false'
    ).toBe('on');
  });

  it('keeps an UNTICKED hazard flag unticked, the inverse direction', async () => {
    /*
     * The opposite direction, which is equally broken by the same mechanism and
     * would not be caught by the case above: a profile that HAS the flag, an
     * operator who removes it, a failed write. A reset re-asserts the flag, so
     * the retry silently restores a warning the operator deliberately cleared.
     */
    const user = userEvent.setup();
    const view = renderEv(); // seeded highVoltageWarning: true

    await user.click(
      within(view.container).getByRole('checkbox', { name: en['vehicles.ev.highVoltage'] })
    );
    await user.click(
      within(view.container).getByRole('button', { name: en['vehicles.ev.record'] })
    );

    await waitFor(() => expect(setEvProfileAction).toHaveBeenCalledTimes(1));
    expect(
      (setEvProfileAction.mock.calls[0]?.[2] as FormData | undefined)?.get('highVoltageWarning')
    ).toBeNull();

    expect(
      within(view.container).getByRole('checkbox', { name: en['vehicles.ev.highVoltage'] }),
      'the cleared hazard flag was silently restored'
    ).not.toBeChecked();
  });

  it('must NOT clear on success, or the next save would wipe the profile', async () => {
    /*
     * The opposite control to the CRM one, and the reason a single generic
     * assertion about `RecordForm` would be wrong. `veh.vehicle-ev-profile-set`
     * is create-or-REPLACE: every field is sent every time and an omitted one is
     * CLEARED on the record. So the default `clearOnSuccess` would empty this
     * form after a save, and an operator pressing save a second time — having
     * changed nothing — would erase the capacity and port they just stored.
     *
     * `VehicleRelationsSections.tsx:72` passes `clearOnSuccess={false}` for
     * exactly this reason. Nothing asserted it; this does. The mutation is to
     * delete that one prop.
     */
    setEvProfileAction.mockResolvedValue({ status: 'success' } satisfies ActionState);
    const user = userEvent.setup();
    const view = renderEv();

    const port = textbox(view.container, en['vehicles.ev.port']);
    await user.clear(port);
    await user.type(port, 'CHAdeMO');
    await user.click(
      within(view.container).getByRole('button', { name: en['vehicles.ev.record'] })
    );

    await waitFor(() => expect(setEvProfileAction).toHaveBeenCalledTimes(1));
    // What was saved is what is shown. Not empty, and not the pre-edit value.
    expect(textbox(view.container, en['vehicles.ev.port'])).toHaveValue('CHAdeMO');
    expect(within(view.container).getByLabelText(en['vehicles.ev.capacity'])).toHaveValue(64.5);
  });
});
