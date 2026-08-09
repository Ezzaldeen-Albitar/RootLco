import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import {
  allowedTransitions,
  isConsequentialTransition,
  permittedWrites,
  SETTABLE_LIFECYCLE_STATES,
  WRITE_PERMISSIONS,
} from '@/features/crm/customers/governance-contract';

/**
 * Changing a customer's status (`crm.customer-status-set`, defect D1).
 *
 * The profile header has displayed `lifecycleStatus` since the day it shipped
 * and offered no way to change it, while the operation sat registered,
 * permission-covered, audited and called from nowhere. The phase's own
 * traceability recorded it as "CRM profile surface — Not called".
 *
 * That is an omission rather than a decision, and the difference is checkable:
 * the two operations this phase deliberately does NOT expose — the two merges —
 * each carry an approved decision reference (`P1-OD-017`). No decision anywhere
 * says customer status should not be editable. So it is REACHABLE, and these
 * tests hold it to the rules the state machine already publishes.
 */

const setCustomerStatusAction = vi.fn();

vi.mock('@/features/crm/customers/governance-actions', () => ({
  setCustomerStatusAction: (...a: unknown[]) => setCustomerStatusAction(...a),
  addNoteAction: vi.fn(),
  assignTagAction: vi.fn(),
  imposeRestrictionAction: vi.fn(),
  raiseAlertAction: vi.fn(),
  recordConsentAction: vi.fn(),
  setPreferenceAction: vi.fn(),
}));
vi.mock('@/features/crm/customers/profile-api', () => ({
  listAddresses: vi.fn(async () => EMPTY),
  listAlerts: vi.fn(async () => EMPTY),
  listConsents: vi.fn(async () => EMPTY),
  listContacts: vi.fn(async () => EMPTY),
  listNotes: vi.fn(async () => EMPTY),
  listPreferences: vi.fn(async () => EMPTY),
  listRestrictions: vi.fn(async () => EMPTY),
  listTags: vi.fn(async () => EMPTY),
}));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { CustomerProfileScreen } =
  await import('@/features/crm/customers/components/CustomerProfileScreen');

const EMPTY = {
  status: 'ok',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'fixed-correlation-id',
};

function customer(lifecycleStatus = 'active') {
  return {
    id: 'c1',
    displayNumber: 'C-000482',
    displayName: 'Layla Haddad',
    partyType: 'individual' as const,
    lifecycleStatus,
    commercialStatus: 'standard',
    recordVersion: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    givenName: 'Layla',
    familyName: 'Haddad',
    preferredLocale: null,
    legalName: null,
    tradeName: null,
  };
}

/**
 * Status is one of nine writes now, and takes its verdict from the same map as
 * the other eight (`P1-27-SEC-001`). Built from real permission CODES rather
 * than by hand, so this test exercises the resolution the page performs instead
 * of a shape invented to satisfy it.
 */
const render = (status = 'active', canManageStatus = true) =>
  renderLtr(
    <CustomerProfileScreen
      locale="en"
      messages={en}
      customer={customer(status)}
      writes={permittedWrites(canManageStatus ? [WRITE_PERMISSIONS.status] : [])}
    />
  );

const statusSelect = () =>
  screen.getByLabelText(en['crm.customers.status.newStatus'], { exact: false });

beforeEach(() => {
  setCustomerStatusAction.mockReset();
  refresh.mockReset();
  setCustomerStatusAction.mockResolvedValue({
    status: 'success',
    messageKey: 'crm.customers.status.changed',
  });
});

describe('the status change is reachable', () => {
  it('offers the control to an operator who may manage governance', () => {
    render();
    expect(
      screen.getByRole('button', { name: en['crm.customers.status.change'] })
    ).toBeInTheDocument();
  });

  it('offers it to nobody else', () => {
    render('active', false);
    // The header still SHOWS the status — the read is not the write.
    expect(screen.getByText(en['crm.lifecycle.active'])).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: en['crm.customers.status.change'] })
    ).not.toBeInTheDocument();
  });

  it('sends the chosen state and the reason', async () => {
    const user = userEvent.setup();
    render('active');
    await user.selectOptions(statusSelect(), 'inactive');
    await user.type(
      screen.getByLabelText(en['crm.customers.restrictions.reason'], { exact: false }),
      'Moved abroad and closed the account'
    );
    await user.click(screen.getByRole('button', { name: en['crm.customers.status.change'] }));

    await waitFor(() => expect(setCustomerStatusAction).toHaveBeenCalledTimes(1));
    const form = setCustomerStatusAction.mock.calls[0]?.[2] as FormData;
    expect(form.get('lifecycleStatus')).toBe('inactive');
    expect(form.get('reason')).toBe('Moved abroad and closed the account');
  });

  it('keeps the chosen status AND the block confirmation after a failed write', async () => {
    /*
     * `R-03` — `NEW-FE-01`'s third site, and the one where the reset was worse
     * than a lost choice.
     *
     * A `prelude` renders inside `RecordForm`'s `<form action={…}>`, so it
     * inherits the reset React performs once the action settles and gains none
     * of the protection `RecordForm` gives the fields it owns. Both controls
     * here were controlled props with no `key`, so the reset won.
     *
     * The failure mode is a DIVERGENCE, not a blank field. After a failure the
     * screen showed "Select…" and an UN-TICKED confirmation, while `target` was
     * still `blocked` and `confirmed` was still `true` in React state — so the
     * `guard` would have allowed a resubmit that blocked a customer while
     * showing the operator no confirmation at all.
     *
     * Both are asserted, because fixing only the select would leave the
     * dangerous half in place.
     */
    setCustomerStatusAction.mockResolvedValue({
      status: 'unavailable',
      messageKey: 'state.unavailable.title',
      correlationId: 'corr-status-1',
      attempt: 1,
    });
    const user = userEvent.setup();
    render('active');

    await user.selectOptions(statusSelect(), 'blocked');
    await user.click(screen.getByRole('checkbox'));
    // Required, like the success case above — an unfilled form never reaches
    // the action and the case would fail for the wrong reason.
    await user.type(
      screen.getByLabelText(en['crm.customers.restrictions.reason'], { exact: false }),
      'Repeated non-payment after three reminders'
    );
    await user.click(screen.getByRole('button', { name: en['crm.customers.status.change'] }));

    await waitFor(() => expect(setCustomerStatusAction).toHaveBeenCalledTimes(1));

    expect(statusSelect(), 'the chosen status was discarded by the failure').toHaveValue('blocked');
    expect(
      screen.getByRole('checkbox'),
      'the confirmation un-ticked while state still held it — the screen and the guard disagreed'
    ).toBeChecked();
  });

  it('refreshes the page so the header shows the new state', async () => {
    const user = userEvent.setup();
    render('active');
    await user.selectOptions(statusSelect(), 'inactive');
    await user.type(
      screen.getByLabelText(en['crm.customers.restrictions.reason'], { exact: false }),
      'Moved abroad and closed the account'
    );
    await user.click(screen.getByRole('button', { name: en['crm.customers.status.change'] }));
    // The status is read on the server and handed down as a prop, so nothing
    // client-side can show the new value without re-running that read.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('only the moves the state machine allows are offered', () => {
  it('offers inactive and blocked from active', () => {
    render('active');
    const values = Array.from(statusSelect().querySelectorAll('option'))
      .map((o) => o.getAttribute('value'))
      .filter((v) => v !== '');
    expect(values).toEqual(['inactive', 'blocked']);
  });

  it('offers active and inactive from prospect, and never blocked', () => {
    render('prospect');
    const values = Array.from(statusSelect().querySelectorAll('option'))
      .map((o) => o.getAttribute('value'))
      .filter((v) => v !== '');
    // A prospect has never been a customer; blocking one is not a move the
    // graph admits, and offering it would produce a 422 nobody can act on.
    expect(values).toEqual(['active', 'inactive']);
  });

  it('offers no move at all from merged, and says so', () => {
    render('merged');
    expect(screen.getByText(en['crm.customers.status.terminal'])).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: en['crm.customers.status.change'] })
    ).not.toBeInTheDocument();
  });

  it('never offers `merged` as a target from any state', () => {
    for (const from of ['prospect', 'active', 'inactive', 'blocked']) {
      // A merge is not a status somebody assigns: it is written by the merge
      // operation together with `merged_into_id`, under a permission this phase
      // withholds (`P1-OD-017`).
      expect(allowedTransitions(from), from).not.toContain('merged');
    }
    expect(SETTABLE_LIFECYCLE_STATES).not.toContain('merged');
  });
});

describe('blocking asks twice', () => {
  it('refuses to send a block until it is confirmed', async () => {
    const user = userEvent.setup();
    render('active');
    await user.selectOptions(statusSelect(), 'blocked');
    await user.type(
      screen.getByLabelText(en['crm.customers.restrictions.reason'], { exact: false }),
      'Repeated non-payment after three reminders'
    );
    await user.click(screen.getByRole('button', { name: en['crm.customers.status.change'] }));

    expect(await screen.findByText(en['crm.customers.status.confirmRequired'])).toBeInTheDocument();
    // Blocking stops the workshop serving a real customer. The guard runs
    // before the action, so nothing was sent.
    expect(setCustomerStatusAction).not.toHaveBeenCalled();
  });

  it('sends the block once confirmed', async () => {
    const user = userEvent.setup();
    render('active');
    await user.selectOptions(statusSelect(), 'blocked');
    await user.click(screen.getByLabelText(en['crm.customers.status.confirmBlock']));
    await user.type(
      screen.getByLabelText(en['crm.customers.restrictions.reason'], { exact: false }),
      'Repeated non-payment after three reminders'
    );
    await user.click(screen.getByRole('button', { name: en['crm.customers.status.change'] }));

    await waitFor(() => expect(setCustomerStatusAction).toHaveBeenCalledTimes(1));
  });

  it('asks for no confirmation on an ordinary move', async () => {
    const user = userEvent.setup();
    render('active');
    await user.selectOptions(statusSelect(), 'inactive');
    // Confirming every transition would train an operator to click through the
    // one that matters.
    expect(
      screen.queryByLabelText(en['crm.customers.status.confirmBlock'])
    ).not.toBeInTheDocument();
    expect(isConsequentialTransition('inactive')).toBe(false);
    expect(isConsequentialTransition('blocked')).toBe(true);
  });

  it('drops the confirmation when the target changes', async () => {
    const user = userEvent.setup();
    render('active');
    await user.selectOptions(statusSelect(), 'blocked');
    await user.click(screen.getByLabelText(en['crm.customers.status.confirmBlock']));
    await user.selectOptions(statusSelect(), 'inactive');
    await user.selectOptions(statusSelect(), 'blocked');

    // Agreeing to block somebody, switching away, and switching back must not
    // carry the tick across — the operator would be blocking on a consent they
    // gave to a different decision.
    expect(screen.getByLabelText(en['crm.customers.status.confirmBlock'])).not.toBeChecked();
  });
});

describe('the reason is mandatory and substantial', () => {
  it('marks the reason required', () => {
    render('active');
    // `crm.partner_status_history.reason` is NOT NULL with a not-blank check,
    // and the route enforces ten characters. A blocked customer is a person
    // somebody has to explain the decision to.
    const reason = screen.getByLabelText(en['crm.customers.restrictions.reason'], {
      exact: false,
    });
    expect(reason).toBeRequired();
  });

  it('says how long the reason must be', () => {
    render('active');
    expect(screen.getByText(en['crm.customers.status.reasonHint'])).toBeInTheDocument();
  });
});

describe('the same control in Arabic', () => {
  it('renders right-to-left with Arabic copy', () => {
    renderRtl(
      <CustomerProfileScreen
        locale="ar"
        messages={ar}
        customer={customer()}
        writes={permittedWrites([WRITE_PERMISSIONS.status])}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      screen.getByRole('button', { name: ar['crm.customers.status.change'] })
    ).toBeInTheDocument();
  });
});

describe('this file is not vacuous', () => {
  it('asserts against catalogue entries that really exist', () => {
    for (const key of [
      'crm.customers.status.change',
      'crm.customers.status.changed',
      'crm.customers.status.confirmBlock',
      'crm.customers.status.confirmRequired',
      'crm.customers.status.newStatus',
      'crm.customers.status.reasonHint',
      'crm.customers.status.terminal',
    ]) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
    }
  });
});
