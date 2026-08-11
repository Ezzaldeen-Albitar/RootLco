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

/**
 * A `select` whose values have no catalogue key (`P1-27-FE-023`).
 *
 * ## What forced the change
 *
 * `options` was `readonly string[]` and every label was resolved as
 * `optionKeyPrefix + option` through `translateDynamic`. That is exactly right
 * for a closed vocabulary — `'reception'` under `vehicles.captureMethod.` — and
 * cannot express the odometer correction's first control, which has to name the
 * READING being corrected. A reading is identified by a uuid: there is no
 * catalogue key for it, there never will be, and it must not be on screen.
 *
 * So `options` also accepts `{ value, label }`, where the label is already the
 * operator's own words. The cases below are what "safely" means here: the object
 * form renders its own label and submits its own value, and the string form
 * still translates — in the SAME component, on the same render, because five
 * other screens depend on the string form and none of them changed.
 *
 * A parallel `optionLabels` array was the alternative, and is the reason this is
 * a widening instead: two arrays can disagree about length, order, or which
 * label belongs to which value, and every one of those disagreements renders a
 * plausible screen.
 */
describe('RecordForm renders a select option that has no translation key', () => {
  const READING_A = {
    value: 'f1a2b3c4-0000-4000-8000-000000000001',
    label: '180000 km — 4 Mar 2026',
  };
  const READING_B = {
    value: 'f1a2b3c4-0000-4000-8000-000000000002',
    label: '120000 km — 10 Jan 2026',
  };

  /** Both forms on one form, because the point is that they coexist. */
  const MIXED_FIELDS = [
    {
      name: 'correctionOf',
      kind: 'select' as const,
      labelKey: 'vehicles.odometer.correctionOf',
      options: [READING_A, READING_B],
    },
    {
      name: 'correctionReason',
      kind: 'select' as const,
      labelKey: 'vehicles.odometer.correctionReason',
      options: ['lower_than_prior', 'data_entry_correction'] as const,
      optionKeyPrefix: 'vehicles.anomalyReason.',
    },
  ];

  function renderMixed(action: (previous: ActionState, form: FormData) => Promise<ActionState>) {
    return renderLtr(
      <RecordForm
        messages={en}
        fields={MIXED_FIELDS}
        action={action}
        submitKey="form.submit"
        titleKey="vehicles.odometer.record"
      />
    );
  }

  it('shows the supplied label and never the value it carries', () => {
    renderMixed(vi.fn(async (): Promise<ActionState> => ({ status: 'success' })));

    const select = screen.getByLabelText(en['vehicles.odometer.correctionOf']);
    const options = [...select.querySelectorAll('option')];
    // Anti-vacuity: the placeholder plus the two readings. A component that
    // rendered no options at all would satisfy every "is not on screen"
    // assertion below.
    expect(options).toHaveLength(3);

    const rendered = options.map((option) => option.textContent ?? '');
    expect(rendered).toContain(READING_A.label);
    expect(rendered).toContain(READING_B.label);
    // The load-bearing half. `translateDynamic` returns a non-catalogue string
    // unchanged, so a component that still translated the object form would put
    // the raw uuid on screen — and this is the only assertion here that can see
    // the difference.
    for (const uuid of [READING_A.value, READING_B.value]) {
      expect(rendered.join('|'), 'a raw id reached the screen').not.toContain(uuid);
    }
  });

  it('submits the VALUE the operator chose, not the words they read', async () => {
    // The submitted `FormData` is captured rather than cast out of the mock's
    // call tuple: a zero-argument mock records `calls: []`, so every assertion
    // about the body would have to be written past the type system.
    const submitted: FormData[] = [];
    const action = vi.fn(async (previous: ActionState, form: FormData): Promise<ActionState> => {
      submitted.push(form);
      return { status: 'success', attempt: (previous.attempt ?? 0) + 1 };
    });
    const user = userEvent.setup();
    renderMixed(action);

    // Chosen by its human label, which is the only handle an operator has.
    await user.selectOptions(
      screen.getByLabelText(en['vehicles.odometer.correctionOf']),
      screen.getByRole('option', { name: READING_B.label })
    );
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(submitted, 'the form submitted nothing').toHaveLength(1);
    expect(submitted[0]?.get('correctionOf')).toBe(READING_B.value);
  });

  it('still translates a string option through its key prefix, on the same form', () => {
    // The regression guard for the five surfaces that were already shipping.
    // Widening a union is the kind of change that passes a typecheck while the
    // renderer quietly takes one branch for everything.
    renderMixed(vi.fn(async (): Promise<ActionState> => ({ status: 'success' })));

    const select = screen.getByLabelText(en['vehicles.odometer.correctionReason']);
    const rendered = [...select.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(rendered).toContain(en['vehicles.anomalyReason.lower_than_prior']);
    expect(rendered).toContain(en['vehicles.anomalyReason.data_entry_correction']);
    // And the token itself is not what is shown.
    expect(rendered).not.toContain('lower_than_prior');
  });

  it('preserves an object-form choice across a failure, like every other control', async () => {
    /*
     * `NEW-FE-01` applies to the new shape too. The select is keyed on the
     * attempt and seeded from state by `defaultValue`, and neither depends on
     * where the label came from — but "neither depends on" is a claim, and this
     * is the case that turns it into one the suite can check.
     */
    const action = vi.fn(async (): Promise<ActionState> => ({
      status: 'unavailable',
      messageKey: 'state.unavailable.title',
      attempt: 1,
    }));
    const user = userEvent.setup();
    renderMixed(action);

    await user.selectOptions(
      screen.getByLabelText(en['vehicles.odometer.correctionOf']),
      screen.getByRole('option', { name: READING_A.label })
    );
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText(en['vehicles.odometer.correctionOf'])).toHaveValue(
        READING_A.value
      )
    );
  });
});
