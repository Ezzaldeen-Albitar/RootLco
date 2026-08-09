import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';
import { RecordForm } from '@/components/forms/RecordForm';
import type { ActionState } from '@/lib/forms/action-result';

/**
 * `RecordForm`, rendered directly (`P1-27-QA-001`).
 *
 * ## Why this file exists
 *
 * Eleven P1-27 write surfaces render through this component — six customer
 * sections and five vehicle ones — and nothing rendered it BY NAME. It appeared
 * in three suites only as a mocked module or as prose, so the component that
 * eleven forms delegate their behaviour to was covered exactly as much as a
 * component nobody had written.
 *
 * That is the same gap round one of the adversarial recheck found for
 * `VehicleProfileScreen`, `VinField` and `DuplicateDecisionPanel`, and the
 * inventory did not report it because `src/components/forms` was outside the
 * walked roots.
 *
 * ## What is asserted
 *
 * The property this component exists for, stated in its own docblock: **entered
 * values survive a failure.** React resets an uncontrolled form once a Server
 * Action completes, so a timeout or a 500 would empty the form and ask the
 * operator to retype a 500-character restriction reason for a fault that was not
 * theirs.
 *
 * Its sibling property is asserted in the same breath and in the opposite
 * direction: the form DOES clear on success, because the record is now stored
 * and the next entry is a different one. A test for only the first would pass
 * against a form that never cleared at all.
 */

const FIELDS = [
  { name: 'reason', kind: 'text' as const, labelKey: 'crm.customers.notes.body' },
  {
    name: 'severity',
    kind: 'select' as const,
    labelKey: 'crm.customers.alerts.severity',
    // `readonly string[]` with a key prefix — the component's real contract.
    options: ['info', 'critical'] as const,
    optionKeyPrefix: 'crm.severity.',
  },
];

function renderForm(action: (previous: ActionState, form: FormData) => Promise<ActionState>) {
  return renderLtr(
    <RecordForm
      messages={en}
      fields={FIELDS}
      action={action}
      submitKey="form.submit"
      titleKey="crm.customers.notes.add"
    />
  );
}

describe('RecordForm keeps what the operator typed when the write fails', () => {
  it('preserves a text value across a transport failure', async () => {
    const action = vi.fn(async (): Promise<ActionState> => ({
      status: 'unavailable',
      messageKey: 'state.unavailable.title',
      correlationId: 'corr-1',
      attempt: 1,
    }));
    const user = userEvent.setup();
    renderForm(action);

    const field = screen.getByLabelText(en['crm.customers.notes.body']);
    await user.type(field, 'Customer asked us to call before any work');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    // The whole reason this component exists rather than a `<form>` per section.
    expect(screen.getByLabelText(en['crm.customers.notes.body'])).toHaveValue(
      'Customer asked us to call before any work'
    );
  });

  it('preserves a CHOSEN select value too, not only typed text', async () => {
    /*
     * The direction that is easy to lose and hard to see. A reverted select
     * leaves no visual trace — unlike a cleared text box — so it is exactly the
     * case a reviewer skims past. `FE-004` shipped precisely this defect on the
     * customer-creation form.
     *
     * "critical" is deliberately not the first option: asserting the default
     * would pass whether or not the value survived.
     */
    const action = vi.fn(async (): Promise<ActionState> => ({
      status: 'unavailable',
      messageKey: 'state.unavailable.title',
      correlationId: 'corr-1',
      attempt: 1,
    }));
    const user = userEvent.setup();
    renderForm(action);

    const select = screen.getByLabelText(en['crm.customers.alerts.severity']);
    await user.selectOptions(select, 'critical');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(screen.getByLabelText(en['crm.customers.alerts.severity'])).toHaveValue('critical');
  });

  it('DOES clear on success, so the next entry starts empty', async () => {
    // The control. Without it the two cases above would pass against a form that
    // never clears — which would be its own defect, one the operator meets on
    // every second record they enter.
    const action = vi.fn(async (): Promise<ActionState> => ({ status: 'success' }));
    const user = userEvent.setup();
    renderForm(action);

    const field = screen.getByLabelText(en['crm.customers.notes.body']);
    await user.type(field, 'Recorded and stored');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText(en['crm.customers.notes.body'])).toHaveValue('')
    );
  });
});
