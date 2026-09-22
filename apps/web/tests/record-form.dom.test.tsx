import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { BOTH_DIRECTIONS, messagesFor, renderLtr } from './render';
import { RecordForm } from '@/components/forms/RecordForm';
import { TextField } from '@/components/forms/Field';
import {
  composeInstant,
  instantFieldError,
  toLocalDateTimeValue,
} from '@/components/forms/instant';
import { fromFailure, type ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { ApiClient } from '@/lib/api/client';

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

  it('keeps every entry, and says so, when the connection is what failed', async () => {
    /*
     * The transport half, driven end to end rather than from a hand-written
     * state: a real client whose `fetch` rejects, the real kind it derives, the
     * real mapping, and the sentence the operator is actually shown.
     *
     * Before this, a lost connection rendered "Service unavailable" — a label,
     * with no statement about what had happened to the two minutes of typing on
     * the screen. The catalogue now says the entries are still there, and this
     * case is what makes that sentence true rather than reassuring: it asserts
     * the promise and the text in the same run, so neither can drift from the
     * other.
     */
    const client = new ApiClient({
      baseUrl: 'https://api.invalid',
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
      newCorrelationId: () => 'corr-network',
    });
    const result = await client.send('POST', '/api/v1/health/ready', { any: 'body' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('network');

    const action = vi.fn(async (): Promise<ActionState> => fromFailure(result, 1));
    const user = userEvent.setup();
    renderForm(action);

    const field = screen.getByLabelText(en['crm.customers.notes.body']);
    await user.type(field, 'Two minutes of typing nobody should have to repeat');
    await user.selectOptions(
      screen.getByLabelText(en['crm.customers.alerts.severity']),
      'critical'
    );
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(en['state.unavailable.message']);
    // The promise the sentence makes, asserted against the form itself.
    expect(screen.getByLabelText(en['crm.customers.notes.body'])).toHaveValue(
      'Two minutes of typing nobody should have to repeat'
    );
    expect(screen.getByLabelText(en['crm.customers.alerts.severity'])).toHaveValue('critical');
  });

  it('says nothing at all when the operator was the one who stopped it', async () => {
    /*
     * A cancellation is not a fault and must not be dressed as one. It used to
     * render "Something went wrong"; the state now carries no message key, so
     * there is no banner to find — and the entries are still on the page,
     * because the operator may well be about to press the button again.
     */
    const controller = new AbortController();
    const client = new ApiClient({
      baseUrl: 'https://api.invalid',
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        }),
      newCorrelationId: () => 'corr-cancelled',
    });
    const pending = client.send(
      'POST',
      '/api/v1/health/ready',
      { any: 'body' },
      {
        signal: controller.signal,
      }
    );
    controller.abort(new DOMException('aborted', 'AbortError'));
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('cancelled');

    const state = fromFailure(result, 1);
    expect(state.status).toBe('cancelled');
    expect(state.messageKey).toBeUndefined();

    const action = vi.fn(async (): Promise<ActionState> => state);
    const user = userEvent.setup();
    renderForm(action);

    const field = screen.getByLabelText(en['crm.customers.notes.body']);
    await user.type(field, 'Half an entry the operator abandoned');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(en['state.error.title'])).toBeNull();
    expect(screen.getByLabelText(en['crm.customers.notes.body'])).toHaveValue(
      'Half an entry the operator abandoned'
    );
  });

  it('fills the number a refusal sentence names, instead of printing the placeholder', async () => {
    /*
     * The banner renders `messageKey`, and two families of refusal sentence
     * carry a `{name}` placeholder the server's own figures fill: the throttle
     * wait, and the capacity ceiling. This component translated the key and
     * dropped `messageValues`, so an operator who sent one request too many was
     * told to "Wait {seconds} seconds" — the catalogue's source text, on screen,
     * in front of a customer.
     *
     * Driven through `fromFailure` rather than from a hand-written state, so the
     * key and the values are paired by the code that pairs them in production.
     * Both assertions are needed: the first would pass against a form that
     * rendered nothing at all, and the second is the one that fails when the
     * values are dropped again.
     */
    const state = fromFailure(
      {
        ok: false,
        kind: 'rate-limited',
        status: 429,
        problem: { retryAfterSeconds: 30 },
        correlationId: 'corr-throttled',
      },
      1
    );
    const action = vi.fn(async (): Promise<ActionState> => state);
    const user = userEvent.setup();
    renderForm(action);

    await user.type(
      screen.getByLabelText(en['crm.customers.notes.body']),
      'An entry worth keeping'
    );
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(
      'Too many requests were sent in a short time. Wait 30 seconds, then try again.'
    );
    expect(banner.textContent).not.toContain('{seconds}');
  });

  it.each(BOTH_DIRECTIONS)(
    'adds the next step under a refused permission (%s)',
    async (locale, renderIn) => {
      /*
       * `state.denied.title` is a LABEL — "You do not have access" — and for a
       * 403 it is the whole of what this banner said. True, and the reader is no
       * further forward: nothing on screen named who can undo it. The heading is
       * left exactly as it was, because sealed records and the user manual quote
       * it by that key; the sentence is a second element beneath it.
       *
       * Both languages, in the same case, because the sentence is only worth
       * anything to the operator who reads the one they were given. The last
       * assertion is the direction that actually fails when the pairing is
       * dropped: the heading alone would still satisfy the first.
       */
      const catalogue = messagesFor(locale);
      const action = vi.fn(async (): Promise<ActionState> => ({
        status: 'denied',
        messageKey: 'state.denied.title',
        correlationId: 'corr-denied',
        attempt: 1,
      }));
      const user = userEvent.setup();
      renderIn(
        <RecordForm
          messages={catalogue}
          fields={FIELDS}
          action={action}
          submitKey="form.submit"
          titleKey="crm.customers.notes.add"
        />
      );

      await user.click(screen.getByRole('button', { name: catalogue['form.submit'] }));

      await waitFor(() => expect(action).toHaveBeenCalled());
      const banner = await screen.findByRole('alert');
      // The heading still reads exactly as it did, as its own node.
      expect(screen.getByText(catalogue['state.denied.title'])).toBeInTheDocument();
      expect(banner).toHaveTextContent(catalogue['state.denied.message']);
      // And the Arabic really is Arabic: a catalogue that copied the English
      // would satisfy every assertion above in both runs.
      expect(en['state.denied.message']).not.toBe(ar['state.denied.message']);
    }
  );

  it.each(BOTH_DIRECTIONS)(
    'adds the next step under a refused save (%s)',
    async (locale, renderIn) => {
      /*
       * The same defect as the case above, on the kind an operator meets most
       * often. "Someone else changed this" is a verdict; the reader was not told
       * that reloading is what makes the save possible, nor that the record may
       * simply be in a state that refuses the change. The heading is untouched —
       * the sealed P1-27 records quote the client line that chooses it — and the
       * sentence arrives as the second element the same pairing already builds.
       */
      const catalogue = messagesFor(locale);
      const action = vi.fn(async (): Promise<ActionState> => ({
        status: 'conflict',
        messageKey: 'state.conflict.title',
        correlationId: 'corr-conflict',
        attempt: 1,
      }));
      const user = userEvent.setup();
      renderIn(
        <RecordForm
          messages={catalogue}
          fields={FIELDS}
          action={action}
          submitKey="form.submit"
          titleKey="crm.customers.notes.add"
        />
      );

      await user.click(screen.getByRole('button', { name: catalogue['form.submit'] }));

      await waitFor(() => expect(action).toHaveBeenCalled());
      const banner = await screen.findByRole('alert');
      expect(screen.getByText(catalogue['state.conflict.title'])).toBeInTheDocument();
      expect(banner).toHaveTextContent(catalogue['state.conflict.message']);
      expect(en['state.conflict.message']).not.toBe(ar['state.conflict.message']);
    }
  );

  it('leaves a key that is already a sentence with no second line', async () => {
    // The control on the case above. A pairing that fired for every key would
    // append the wrong sentence to `state.expired.message`, which explains
    // itself, and both cases would still be green.
    const action = vi.fn(async (): Promise<ActionState> => ({
      status: 'expired',
      messageKey: 'state.expired.message',
      attempt: 1,
    }));
    const user = userEvent.setup();
    renderForm(action);

    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(en['state.expired.message']);
    expect(banner.textContent?.trim()).toBe(en['state.expired.message']);
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
    // The submitted `FormData` is captured rather than cast out of the spy's
    // call tuple: a spy taking no arguments reports `calls: []`, so every
    // assertion about the body would have to be written past the type system.
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

/* ------------------------------------------------------------------ *
 * `instant` — a moment, submitted with its offset (F2)
 * ------------------------------------------------------------------ */

describe('the instant field submits an offset-bearing moment, never what was typed', () => {
  const INSTANT_FIELDS = [
    {
      name: 'observedAt',
      kind: 'instant' as const,
      labelKey: 'vehicles.odometer.observedAt',
      required: true,
    },
  ];

  function renderInstant(action: (previous: ActionState, form: FormData) => Promise<ActionState>) {
    return renderLtr(
      <RecordForm
        messages={en}
        fields={INSTANT_FIELDS}
        action={action}
        submitKey="form.submit"
        titleKey="crm.customers.notes.add"
      />
    );
  }

  const OBSERVED_LABEL = new RegExp(`^${en['vehicles.odometer.observedAt']}`);

  it('sends the composed instant under the field name, and never the local value', async () => {
    /*
     * The whole point of the kind. The operator sees and types a wall time with
     * no zone in it; the submitted form receives ONE value for `observedAt` and
     * it is the composed instant. The two inputs share a name only in
     * appearance — the visible one has none — so the zoneless value cannot be
     * submitted even as a duplicate.
     */
    const seen: string[] = [];
    const action = vi.fn(async (_previous: ActionState, form: FormData): Promise<ActionState> => {
      for (const value of form.getAll('observedAt')) seen.push(String(value));
      return { status: 'success', messageKey: 'form.saved', attempt: 1 };
    });
    const user = userEvent.setup();
    renderInstant(action);

    await user.type(screen.getByLabelText(OBSERVED_LABEL), '2026-03-05T09:30');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^2026-03-05T09:30:00(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/);
    expect(seen[0]).not.toBe('2026-03-05T09:30');
    // Derived rather than literal: the offset composed is the runner's own zone.
    expect(seen[0]).toBe(composeInstant('2026-03-05T09:30'));
  });

  it('shows the operator the instant it will send', async () => {
    const user = userEvent.setup();
    renderInstant(vi.fn(async (): Promise<ActionState> => ({ status: 'idle' })));

    await user.type(screen.getByLabelText(OBSERVED_LABEL), '2026-03-05T09:30');
    expect(screen.getByText(composeInstant('2026-03-05T09:30') as string)).toBeInTheDocument();
  });

  it('seeds the control from a stored instant rather than showing an empty box', () => {
    // The control accepts no offset at all, so an instant seeded straight in is
    // dropped by the browser and an edit form opens blank on a record that
    // exists. `seedValues` converts it to the same MOMENT on this clock.
    renderLtr(
      <RecordForm
        messages={en}
        fields={INSTANT_FIELDS}
        action={vi.fn(async (): Promise<ActionState> => ({ status: 'idle' }))}
        submitKey="form.submit"
        titleKey="crm.customers.notes.add"
        initialValues={{ observedAt: '2026-03-05T09:30:00Z' }}
      />
    );
    const box = screen.getByLabelText(OBSERVED_LABEL);
    expect(box).toHaveValue(toLocalDateTimeValue('2026-03-05T09:30:00Z'));
    expect(box).not.toHaveValue('');
  });
});

describe('instantFieldError — the rule for a browser with no date-time control', () => {
  /*
   * The date-time control sanitises anything that is not a complete local
   * date-time to the empty string, so on a browser that implements it the wrong
   * shape cannot exist. A browser that does NOT implement it degrades the
   * control to a plain TEXT box, silently, and then the operator can type
   * whatever they like into the field that dates the record — including
   * `2026-03-01T09:30:00Z`, which is exactly what this field's old hint asked
   * for. No DOM environment can reproduce that degradation, so the rule is
   * asserted directly rather than through a control that cannot express it.
   */
  it('refuses a value that is not a local date and time, by name', () => {
    for (const typed of ['2026-03-01T09:30:00Z', '2026-03-01 09:30', '2026-03-01', 'tomorrow']) {
      expect(instantFieldError(typed, true), typed).toBe('field.instantNeedsOffset');
    }
  });

  it('accepts a local date and time, because the composition attaches the offset', () => {
    for (const typed of ['2026-03-01T09:30', '2026-03-01T09:30:15', '  2026-03-01T09:30  ']) {
      expect(instantFieldError(typed, true), typed).toBeNull();
    }
  });

  it('separates empty-and-required from empty-and-optional', () => {
    expect(instantFieldError('', true)).toBe('field.required');
    expect(instantFieldError('   ', true)).toBe('field.required');
    expect(instantFieldError('', false)).toBeNull();
  });

  it('never names a key that is missing from either catalogue', () => {
    // A refusal an operator reads as a raw key is the same defect as no refusal.
    for (const key of ['field.instantNeedsOffset', 'field.required']) {
      expect(key in (en as Record<string, string>), key).toBe(true);
      expect(key in (ar as Record<string, string>), key).toBe(true);
    }
  });
});

/* ====================================================================== *
 * After a refusal: where the cursor goes, what stops complaining, and how
 * the complaint is carried
 * ====================================================================== */

/**
 * Three behaviours that did not exist, and one that did and is now pinned.
 *
 * A form refused, marked three fields and left focus on the submit button. The
 * operator was told the save failed and had to hunt for red text — red text
 * being the only carrier of "this one", and the corrections they made having no
 * effect on it until they spent another request finding out.
 */
function refusal(fieldErrors: Record<string, string>, attempt = 1): ActionState {
  return { status: 'invalid', messageKey: 'form.formError', fieldErrors, attempt };
}

describe('after a refusal the cursor lands on the first thing to fix', () => {
  it('focuses the first invalid control in DOM ORDER, not the first error key', async () => {
    // Both fields are refused and the error map is deliberately written with
    // the SECOND field first, so a hook that trusted key order would focus the
    // wrong control and this case would catch it.
    const action = vi.fn(async (): Promise<ActionState> =>
      refusal({ severity: 'field.required', reason: 'field.required' })
    );
    const user = userEvent.setup();
    renderForm(action);

    const submit = screen.getByRole('button', { name: en['form.submit'] });
    await user.click(submit);
    await waitFor(() => expect(action).toHaveBeenCalled());

    const reason = screen.getByLabelText(en['crm.customers.notes.body'], { exact: false });
    await waitFor(() => expect(document.activeElement).toBe(reason));
    // And not where it was left, which is the whole defect.
    expect(document.activeElement).not.toBe(submit);
  });

  it('marks ONLY the fields that are wrong, so the query cannot pick a healthy one', async () => {
    const action = vi.fn(async (): Promise<ActionState> => refusal({ severity: 'field.required' }));
    const user = userEvent.setup();
    renderForm(action);
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));
    await waitFor(() => expect(action).toHaveBeenCalled());

    const reason = screen.getByLabelText(en['crm.customers.notes.body'], { exact: false });
    const severity = screen.getByLabelText(en['crm.customers.alerts.severity'], { exact: false });
    // Absent, not `"false"`. `aria-invalid="false"` would be invisible to the
    // query; a bare attribute on every control would make the first field the
    // answer every time.
    expect(reason).not.toHaveAttribute('aria-invalid');
    expect(severity).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(document.activeElement).toBe(severity));
  });

  it('does NOT move focus on MOUNT, and DOES on the attempt that follows', async () => {
    /*
     * A mount is not a refusal.
     *
     * `RecordForm` itself cannot reach this: its `useActionState` starts at
     * `EMPTY`, so attempt zero with no errors is the only state it can mount
     * with. The guard is for the OTHER callers the hook is exposed to — a
     * hand-built `useActionState` form whose state is held by a parent, or one
     * remounted under a new key while its last result is still in hand. Those
     * can mount carrying an attempt and its errors, and moving the cursor then
     * takes the operator somewhere they did not ask to go, on arrival, while a
     * screen reader is still announcing the page.
     *
     * So the hook is driven DIRECTLY here, with the state as an input. The
     * previous version of this case rendered a `RecordForm` that had not been
     * submitted, asserted that focus was still on the body, and would have
     * passed against a hook with no guard at all — it proved nothing, because
     * nothing in it was ever marked invalid.
     */
    function FocusHarness({ state }: { readonly state: ActionState }) {
      const formRef = useFocusFirstInvalid(state);
      return (
        <form ref={formRef}>
          <input aria-label="first" />
          <input
            aria-label="second"
            aria-invalid={state.fieldErrors?.['second'] === undefined ? undefined : true}
          />
        </form>
      );
    }

    const carried = refusal({ second: 'field.required' }, 4);
    const { rerender } = renderLtr(<FocusHarness state={carried} />);

    // The control IS marked invalid — without this the case would be vacuous
    // in the same way the old one was.
    expect(screen.getByLabelText('second')).toHaveAttribute('aria-invalid', 'true');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.activeElement).toBe(document.body);

    // One new attempt, same errors: now it moves.
    rerender(<FocusHarness state={refusal({ second: 'field.required' }, 5)} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('second')));
  });

  it('does NOT move focus when the refusal names no field', async () => {
    // A rate limit or an outage is a banner, not a field, and stealing focus on
    // one would take the operator away from whatever they had moved on to.
    const action = vi.fn(async (): Promise<ActionState> => ({
      status: 'unavailable',
      messageKey: 'state.unavailable.title',
      correlationId: 'corr-x',
      attempt: 1,
    }));
    const user = userEvent.setup();
    renderForm(action);
    const submit = screen.getByRole('button', { name: en['form.submit'] });
    await user.click(submit);
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(document.activeElement).toBe(submit);
  });
});

describe('a corrected field stops complaining before the next submission', () => {
  it('clears the error for the field the operator edits, and only that one', async () => {
    const action = vi.fn(async (): Promise<ActionState> =>
      refusal({ reason: 'field.required', severity: 'field.required' })
    );
    const user = userEvent.setup();
    renderForm(action);
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2);

    await user.type(screen.getByLabelText(en['crm.customers.notes.body'], { exact: false }), 'ok');

    const reason = screen.getByLabelText(en['crm.customers.notes.body'], { exact: false });
    await waitFor(() => expect(reason).not.toHaveAttribute('aria-invalid'));
    // The one the operator has NOT touched still says so: a correction must
    // never quieten a complaint about a different field.
    expect(
      screen.getByLabelText(en['crm.customers.alerts.severity'], { exact: false })
    ).toHaveAttribute('aria-invalid', 'true');
  });

  it('brings the complaint BACK when the next attempt refuses the same field', async () => {
    // The direction that makes the clearing honest. It does not claim the new
    // value is acceptable — only that the old sentence was about a value that
    // is no longer there.
    let attempt = 0;
    const action = vi.fn(async (): Promise<ActionState> => {
      attempt += 1;
      return refusal({ reason: 'field.required' }, attempt);
    });
    const user = userEvent.setup();
    renderForm(action);
    const submit = screen.getByRole('button', { name: en['form.submit'] });

    await user.click(submit);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText(en['crm.customers.notes.body'], { exact: false }), 'x');
    await waitFor(() =>
      expect(
        screen.getByLabelText(en['crm.customers.notes.body'], { exact: false })
      ).not.toHaveAttribute('aria-invalid')
    );

    await user.click(submit);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByLabelText(en['crm.customers.notes.body'], { exact: false })
      ).toHaveAttribute('aria-invalid', 'true')
    );
  });
});

describe('an error is not carried by colour alone', () => {
  it('leads the message with a glyph that is hidden from assistive technology', async () => {
    const action = vi.fn(async (): Promise<ActionState> => refusal({ reason: 'field.required' }));
    const user = userEvent.setup();
    renderForm(action);
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));
    await waitFor(() => expect(action).toHaveBeenCalled());

    const alert = screen.getAllByRole('alert')[0] as HTMLElement;
    // The sentence is there, and so is a shape in front of it. Under forced
    // colours or in greyscale, red supporting text and grey supporting text are
    // the same text.
    expect(alert).toHaveTextContent(en['field.required']);
    const glyph = alert.querySelector('[aria-hidden="true"]');
    expect(glyph, 'the error carries no non-colour cue').not.toBeNull();
    expect(glyph).toHaveTextContent('!');
    // Announcing "exclamation mark" before every message is noise; the sentence
    // and `aria-invalid` already carry the meaning.
    expect(alert.textContent).toContain(en['field.required']);
  });

  it('carries the same cue on a FieldFrame control', () => {
    renderLtr(<TextField label="Chassis number" error="This does not look right" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This does not look right');
    expect(alert.querySelector('[aria-hidden="true"]')).toHaveTextContent('!');
    // And nothing is marked invalid when there is nothing wrong.
    expect(screen.getByLabelText('Chassis number')).toHaveAttribute('aria-invalid', 'true');
  });

  it('writes no aria-invalid at all on a healthy FieldFrame control', () => {
    renderLtr(<TextField label="Chassis number" />);
    expect(screen.getByLabelText('Chassis number')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
