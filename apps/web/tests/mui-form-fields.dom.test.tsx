import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import TextField from '@mui/material/TextField';
import dayjs from 'dayjs';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DateField,
  DateTimeField,
  dayToPicker,
  instantToPicker,
  pickerToDay,
  pickerToInstant,
  repeatedWallClock,
} from '@/components/forms/mui/DateField';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { correctionFor } from '@/components/forms/mui/field-wiring';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { validateInstant } from '@/components/forms/instant';
import {
  BranchSwitch,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';

/**
 * The Material UI form fields (ADR-022 PR1) keep `FieldFrame`'s contract:
 * named by their label, `aria-invalid` only when wrong and absent otherwise,
 * the description then the error in `aria-describedby`, the error announced and
 * drawn with a shape, no native `required`, the typed value kept, and both
 * `useClearOnCorrect` and `useFocusFirstInvalid` working through them.
 */

const en = getMessages('en');

function mount(ui: ReactElement, locale: Locale = 'en') {
  const messages = getMessages(locale);
  const renderIn = locale === 'ar' ? renderRtl : renderLtr;
  return renderIn(
    <UiFoundationProvider locale={locale} text={muiTextOf(messages)}>
      {ui}
    </UiFoundationProvider>
  );
}

/** The catalogue's `{name}` placeholders, filled — written here, not borrowed from the component. */
function formatMessageText(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

function describedByIds(element: HTMLElement): string[] {
  return (element.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
}

afterEach(() => {
  for (const style of document.head.querySelectorAll('style')) style.remove();
});

function Text({
  error,
  description,
  required,
}: {
  readonly error?: string;
  readonly description?: string;
  readonly required?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <FormTextField
      label="Reference"
      name="reference"
      value={value}
      onChange={setValue}
      error={error}
      description={description}
      required={required}
    />
  );
}

describe('the FieldFrame contract, on Material UI', () => {
  it('is named by its label; a required field is marked for the eye and for assistive technology', () => {
    mount(<Text required />);
    const input = screen.getByRole('textbox', { name: /^Reference/ });
    expect(input).toHaveAttribute('aria-required', 'true');
    // No native `required`: the browser's own bubble must never pre-empt the server.
    expect(input).not.toHaveAttribute('required');
    const asterisk = document.querySelector('.MuiFormLabel-asterisk');
    expect(asterisk).toHaveAttribute('aria-hidden', 'true');
  });

  it('writes no aria-invalid at all on a healthy field', () => {
    mount(<Text description="As printed on the document." />);
    const input = screen.getByRole('textbox', { name: 'Reference' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-errormessage');
    expect(input).toHaveAccessibleDescription('As printed on the document.');
  });

  it('FALSIFICATION: Material alone writes aria-invalid="false", which the wrapper removes', () => {
    mount(<TextField label="Bare" />);
    expect(screen.getByRole('textbox', { name: 'Bare' })).toHaveAttribute('aria-invalid', 'false');
  });

  it('marks, describes and announces an error — description first, then the correction', () => {
    mount(<Text description="As printed on the document." error="Enter the reference." />);
    const input = screen.getByRole('textbox', { name: 'Reference' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const [first, second] = describedByIds(input);
    expect(document.getElementById(first ?? '')).toHaveTextContent('As printed on the document.');
    expect(document.getElementById(second ?? '')).toHaveTextContent('Enter the reference.');
    expect(input).toHaveAttribute('aria-errormessage', second);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter the reference.');
    // A shape as well as a colour, and the shape is not announced.
    expect(alert.querySelector('[aria-hidden="true"]')).toHaveTextContent('!');
  });

  it('keeps what was typed when a refusal arrives', async () => {
    const user = userEvent.setup();
    function Refused() {
      const [value, setValue] = useState('');
      const [error, setError] = useState<string | undefined>(undefined);
      return (
        <>
          <FormTextField label="Reference" value={value} onChange={setValue} error={error} />
          <button type="button" onClick={() => setError('Enter the reference.')}>
            refuse
          </button>
        </>
      );
    }
    mount(<Refused />);
    await user.type(screen.getByRole('textbox', { name: 'Reference' }), 'DOC-77');
    await user.click(screen.getByRole('button', { name: 'refuse' }));
    expect(screen.getByRole('textbox', { name: 'Reference' })).toHaveValue('DOC-77');
    expect(screen.getByRole('textbox', { name: 'Reference' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });
});

describe('the form hooks work through the fields', () => {
  function RefusingForm() {
    const [state, setState] = useState<ActionState>({ status: 'idle' });
    const [values, setValues] = useState({ reference: 'DOC-1', quantity: '', amount: '' });
    const formRef = useFocusFirstInvalid(state);
    const corrections = useClearOnCorrect(state);
    return (
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          setState({
            status: 'invalid',
            fieldErrors: { quantity: 'form.required', amount: 'money.error.empty' },
            attempt: (state.attempt ?? 0) + 1,
          });
        }}
      >
        <FormTextField
          label="Reference"
          value={values.reference}
          onChange={(reference) => setValues((current) => ({ ...current, reference }))}
          {...correctionFor(corrections, 'reference', en)}
        />
        <FormNumberField
          label="Quantity"
          value={values.quantity}
          onChange={(quantity) => setValues((current) => ({ ...current, quantity }))}
          {...correctionFor(corrections, 'quantity', en)}
        />
        <FormMoneyField
          messages={en}
          label="Amount"
          currency="JOD"
          value={values.amount}
          onChange={(amount) => setValues((current) => ({ ...current, amount }))}
          {...correctionFor(corrections, 'amount', en)}
        />
        <button type="submit">Save</button>
      </form>
    );
  }

  it('moves the cursor to the first refused field, then withdraws its complaint once corrected', async () => {
    const user = userEvent.setup();
    mount(<RefusingForm />);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const quantity = screen.getByRole('textbox', { name: 'Quantity' });
    await waitFor(() => expect(quantity).toHaveFocus());
    expect(quantity).toHaveAttribute('aria-invalid', 'true');
    expect(quantity).toHaveAccessibleDescription(en['form.required']);
    expect(screen.getByRole('textbox', { name: 'Reference' })).not.toHaveAttribute('aria-invalid');

    await user.type(quantity, '3');
    expect(quantity).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('the cursor enters a refused date picker', () => {
  // The picker marks its whole field invalid — a group that cannot itself take
  // focus — so the hook must enter it: focusing the group alone left the cursor
  // on Save.
  function RefusingDateForm() {
    const [state, setState] = useState<ActionState>({ status: 'idle' });
    const [day, setDay] = useState('');
    const formRef = useFocusFirstInvalid(state);
    return (
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          setState({
            status: 'invalid',
            fieldErrors: { day: 'form.required' },
            attempt: (state.attempt ?? 0) + 1,
          });
        }}
      >
        <FormTextField label="Reference" value="DOC-1" onChange={() => undefined} />
        <DateField
          label="Visit day"
          value={day}
          onChange={setDay}
          timezone="Asia/Amman"
          error={state.status === 'invalid' ? 'Choose a day.' : undefined}
        />
        <button type="submit">Save</button>
      </form>
    );
  }

  it('lands inside the picker, not on Save and not on a neighbour', async () => {
    const user = userEvent.setup();
    mount(<RefusingDateForm />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const group = screen.getByRole('group', { name: /^Visit day/ });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(group.contains(document.activeElement)).toBe(true));
  });
});

describe('number and money stay strings', () => {
  it('reports the typed text uncoerced, on a numeric keypad, left to right', async () => {
    const reported = vi.fn();
    const user = userEvent.setup();
    function Quantity() {
      const [value, setValue] = useState('');
      return (
        <FormNumberField
          label="Distance"
          value={value}
          onChange={(next) => {
            reported(next);
            setValue(next);
          }}
          unit="km"
          unitId="distance-unit"
          integer
        />
      );
    }
    mount(<Quantity />);
    const input = screen.getByRole('textbox', { name: 'Distance' });
    await user.type(input, '007');
    expect(reported).toHaveBeenLastCalledWith('007');
    await user.clear(input);
    await user.type(input, '1e3');
    // Not 1000: the server decides what the text means.
    expect(reported).toHaveBeenLastCalledWith('1e3');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input).not.toHaveAttribute('type', 'number');
    expect(input).toHaveAccessibleDescription('km');
  });

  it('canonicalises money on blur and reports it as a string', async () => {
    const reported = vi.fn();
    const user = userEvent.setup();
    function Amount() {
      const [value, setValue] = useState('');
      return (
        <>
          <FormMoneyField
            messages={en}
            label="Amount"
            currency="JOD"
            value={value}
            onChange={(next, valid) => {
              reported(next, valid);
              setValue(next);
            }}
          />
          <button type="button">elsewhere</button>
        </>
      );
    }
    mount(<Amount />);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    expect(input).toHaveAccessibleDescription('JOD');
    await user.type(input, '12.5');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(input).toHaveValue('12.5000');
    expect(reported).toHaveBeenLastCalledWith('12.5000', true);
    for (const call of reported.mock.calls) expect(typeof call[0]).toBe('string');
  });

  it('says what is wrong with an amount in the catalogue’s words, until the next keystroke', async () => {
    const user = userEvent.setup();
    function Amount() {
      const [value, setValue] = useState('');
      return (
        <>
          <FormMoneyField
            messages={en}
            label="Amount"
            currency="JOD"
            value={value}
            onChange={(next) => setValue(next)}
          />
          <button type="button">elsewhere</button>
        </>
      );
    }
    mount(<Amount />);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    await user.type(input, '1.123456');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.getByRole('alert')).toHaveTextContent(en['money.error.tooManyDecimals']);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.type(input, '7');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a value the caller sets later, and the caller’s error wins', async () => {
    const user = userEvent.setup();
    function Reset() {
      const [value, setValue] = useState('');
      return (
        <>
          <FormMoneyField
            messages={en}
            label="Amount"
            currency="JOD"
            value={value}
            onChange={(next) => setValue(next)}
            error={value === '5.0000' ? 'This amount is above the limit.' : undefined}
          />
          <button type="button" onClick={() => setValue('')}>
            discard
          </button>
        </>
      );
    }
    mount(<Reset />);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    await user.type(input, '5');
    await user.tab();
    expect(input).toHaveValue('5.0000');
    expect(screen.getByRole('alert')).toHaveTextContent('This amount is above the limit.');
    await user.click(screen.getByRole('button', { name: 'discard' }));
    expect(input).toHaveValue('');
  });
});

describe('select', () => {
  it('is a native select with groups and a placeholder, wired like the others', async () => {
    const edited = vi.fn();
    const user = userEvent.setup();
    function Status({ error }: { readonly error?: string }) {
      const [value, setValue] = useState('');
      return (
        <FormSelectField
          label="Status"
          value={value}
          onChange={setValue}
          onEdit={edited}
          placeholder="Choose a status"
          options={[{ value: 'open', label: 'Open' }]}
          groups={[{ label: 'Finished', options: [{ value: 'closed', label: 'Closed' }] }]}
          error={error}
          required
        />
      );
    }
    const { rerender } = mount(<Status />);
    const select = screen.getByRole('combobox', { name: /^Status/ });
    expect(select.tagName).toBe('SELECT');
    expect(select).not.toHaveAttribute('aria-invalid');
    expect(select).toHaveAttribute('aria-required', 'true');
    expect(select).not.toHaveAttribute('required');
    expect(screen.getByRole('group', { name: 'Finished' })).toBeInTheDocument();

    await user.selectOptions(select, 'closed');
    expect(select).toHaveValue('closed');
    expect(edited).toHaveBeenCalledTimes(1);

    rerender(
      <UiFoundationProvider locale="en" text={muiTextOf(en)}>
        <Status error="Choose a status." />
      </UiFoundationProvider>
    );
    expect(screen.getByRole('combobox', { name: /^Status/ })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });
});

describe('right to left', () => {
  it('keeps numbers left to right inside an Arabic page, with the unit at the logical end', () => {
    mount(
      <FormNumberField
        label="المسافة"
        value="12"
        onChange={() => undefined}
        unit="كم"
        unitId="distance-unit"
      />,
      'ar'
    );
    expect(document.documentElement.dir).toBe('rtl');
    const input = screen.getByRole('textbox', { name: 'المسافة' });
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(document.querySelector('.MuiInputAdornment-positionEnd')).toHaveTextContent('كم');
  });
});

/*
 * Dates and moments on the MIT pickers (`DateField`, `DateTimeField`).
 *
 * The value a screen holds is a calendar day or an instant WITH its offset —
 * never the picker's own object — and every day is a day on the BRANCH's
 * clock. Asia/Amman keeps one offset all year; America/New_York changes on
 * 2026-03-08, so a moment either side of that carries a different offset.
 */
function pickerInput(group: HTMLElement): HTMLInputElement {
  const input = group.parentElement?.querySelector('input');
  if (!input) throw new Error('the picker has no value input');
  return input;
}

function DayHost({
  initial = '',
  zone,
  onDay,
  error,
  description,
  required,
  min,
  onProblem,
}: {
  readonly initial?: string;
  readonly zone?: string;
  readonly onDay?: (day: string) => void;
  readonly error?: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly min?: string;
  readonly onProblem?: (problem: unknown) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      label="Visit day"
      value={value}
      onChange={(next) => {
        onDay?.(next);
        setValue(next);
      }}
      timezone={zone}
      error={error}
      description={description}
      required={required}
      min={min}
      onProblem={onProblem}
    />
  );
}

function MomentHost({
  initial = '',
  zone,
  onMoment,
}: {
  readonly initial?: string;
  readonly zone?: string;
  readonly onMoment?: (moment: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateTimeField
      messages={en}
      label="Visit time"
      value={value}
      onChange={(next) => {
        onMoment?.(next);
        setValue(next);
      }}
      timezone={zone}
    />
  );
}

describe('DateField and DateTimeField: the FieldFrame contract on a picker', () => {
  it('is a group named by its label; aria-invalid only when wrong; no native required', () => {
    mount(<DayHost required description="The day the vehicle arrives." />);
    const group = screen.getByRole('group', { name: /^Visit day/ });
    expect(group).not.toHaveAttribute('aria-invalid');
    expect(group).toHaveAttribute('aria-required', 'true');
    expect(pickerInput(group)).not.toHaveAttribute('required');
    // A part per piece of the date, each its own spin button.
    expect(within(group).getAllByRole('spinbutton')).toHaveLength(3);
  });

  it('marks the group invalid, lists the description then the error, and announces the error', () => {
    mount(<DayHost description="The day the vehicle arrives." error="Choose a day." />);
    const group = screen.getByRole('group', { name: /^Visit day/ });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Choose a day.');
    const described = (group.getAttribute('aria-describedby') ?? '').split(' ');
    const description = screen.getByText('The day the vehicle arrives.');
    expect(described).toEqual([description.id, error.id]);
    expect(group).toHaveAttribute('aria-errormessage', error.id);
  });

  it('takes a day typed part by part and reports it as YYYY-MM-DD', async () => {
    const user = userEvent.setup();
    const onDay = vi.fn();
    mount(<DayHost zone="Asia/Amman" onDay={onDay} />);
    const group = screen.getByRole('group', { name: /^Visit day/ });
    await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('22092026');
    expect(onDay).toHaveBeenLastCalledWith('2026-09-22');
    expect(pickerInput(group)).toHaveValue('22/09/2026');
  });

  it('reports the same typed day on a zone far from the laptop, not the day before', async () => {
    // The falsification of the held value: rebuilt from the string after each
    // keystroke, the year passed through 0202 on a historical offset and the
    // finished entry came back a day early.
    const user = userEvent.setup();
    const onDay = vi.fn();
    mount(<DayHost zone="America/New_York" onDay={onDay} />);
    const group = screen.getByRole('group', { name: /^Visit day/ });
    await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('08032026');
    expect(onDay).toHaveBeenLastCalledWith('2026-03-08');
  });

  it("marks TODAY on the branch's clock, not the laptop's", async () => {
    // 22:30 UTC: already the 22nd in Amman, still the 21st in New York.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-21T22:30:00Z'));
    try {
      const user = userEvent.setup();
      for (const [zone, today] of [
        ['America/New_York', '21'],
        ['Asia/Amman', '22'],
      ] as const) {
        const { unmount } = mount(<DayHost zone={zone} />);
        await user.click(screen.getByRole('button', { name: en['mui.pickers.chooseDate'] }));
        const marked = await screen.findByRole('gridcell', { current: 'date' });
        expect(marked, zone).toHaveTextContent(today);
        unmount();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('says when a day is before the earliest it may be', () => {
    const onProblem = vi.fn();
    mount(<DayHost initial="2026-09-01" min="2026-09-10" onProblem={onProblem} />);
    expect(onProblem).toHaveBeenCalledWith('minDate');
  });

  it('shows and types a moment on the BRANCH clock and emits it with that offset', async () => {
    const user = userEvent.setup();
    const onMoment = vi.fn();
    mount(<MomentHost initial="2026-09-22T06:30:00Z" zone="Asia/Amman" onMoment={onMoment} />);
    const group = screen.getByRole('group', { name: /^Visit time/ });
    // 06:30 UTC is 09:30 on the branch's clock.
    expect(pickerInput(group)).toHaveValue('22/09/2026 09:30');
    const parts = within(group).getAllByRole('spinbutton');
    await user.click(parts[3] as HTMLElement);
    await user.keyboard('1015');
    expect(onMoment).toHaveBeenLastCalledWith('2026-09-22T10:15:00+03:00');
  });

  it('draws the same instant differently on another branch clock', () => {
    mount(<MomentHost initial="2026-09-22T06:30:00Z" zone="America/New_York" />);
    const group = screen.getByRole('group', { name: /^Visit time/ });
    expect(pickerInput(group)).toHaveValue('22/09/2026 02:30');
  });

  it("follows the working branch's zone when the caller names none", () => {
    const newYork = { ...TEST_BRANCH, timezone: 'America/New_York' };
    mount(
      inBranch(<MomentHost initial="2026-01-15T12:00:00Z" />, {
        snapshot: branchSnapshot([newYork]),
      })
    );
    const group = screen.getByRole('group', { name: /^Visit time/ });
    expect(pickerInput(group)).toHaveValue('15/01/2026 07:00');
  });

  it('refuses to take a moment under "All my branches": no picker, and the choose-one-branch sentence', async () => {
    // A moment is a write input, and writes need a concrete branch. The
    // falsification: before the refusal the field silently used the laptop's
    // clock here.
    const user = userEvent.setup();
    const second = { ...TEST_BRANCH, id: '88888888-8888-4888-8888-888888888888', name: 'Second' };
    mount(
      inBranch(
        <>
          <BranchSwitch to="all" label="use all" />
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <MomentHost initial="2026-01-15T12:00:00Z" />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, second]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));
    const refusal = await screen.findByTestId('date-time-requires-branch');
    expect(refusal).toHaveTextContent(en['workingContext.needsOneBranch']);
    expect(refusal.closest('[data-zone-refused="true"]')).toHaveTextContent('Visit time');
    expect(screen.queryByRole('group', { name: /^Visit time/ })).toBeNull();
    expect(document.querySelector('input')).toBeNull();

    // One branch again: the picker is back, on that branch's clock (UTC+3).
    await user.click(screen.getByRole('button', { name: 'use main' }));
    const group = await screen.findByRole('group', { name: /^Visit time/ });
    expect(pickerInput(group)).toHaveValue('15/01/2026 15:00');
    expect(screen.queryByTestId('date-time-requires-branch')).toBeNull();
  });

  it('refuses a moment on a branch whose zone is not known, in its own words', () => {
    const unknown = { ...TEST_BRANCH, timezone: '' };
    mount(inBranch(<MomentHost />, { snapshot: branchSnapshot([unknown]) }));
    expect(screen.getByTestId('date-time-requires-branch')).toHaveTextContent(
      en['dateField.zoneUnknown']
    );
    expect(screen.queryByRole('group', { name: /^Visit time/ })).toBeNull();
  });

  it('takes the EARLIER of the two 01:30s on the night the clocks go back, and says so', async () => {
    // 1 November 2026, America/New_York: 02:00 daylight time becomes 01:00
    // standard time, so 01:00-01:59 happens twice, at -04:00 and then -05:00.
    const user = userEvent.setup();
    const onMoment = vi.fn();
    mount(<MomentHost zone="America/New_York" onMoment={onMoment} />);
    const group = screen.getByRole('group', { name: /^Visit time/ });
    await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('011120260130');
    expect(onMoment).toHaveBeenLastCalledWith('2026-11-01T01:30:00-04:00');
    const note = formatMessageText(en['dateField.repeatedTime'], { offset: 'UTC-04:00' });
    await waitFor(() => expect(group).toHaveAccessibleDescription(note));

    // An hour later on the clock is an ordinary time again: no note.
    await user.click(within(group).getAllByRole('spinbutton')[3] as HTMLElement);
    await user.keyboard('03');
    expect(onMoment).toHaveBeenLastCalledWith('2026-11-01T03:30:00-05:00');
    await waitFor(() => expect(group).not.toHaveAccessibleDescription(note));
  });

  it('names the later offset when the moment it holds IS the later 01:30', () => {
    mount(<MomentHost initial="2026-11-01T01:30:00-05:00" zone="America/New_York" />);
    const group = screen.getByRole('group', { name: /^Visit time/ });
    expect(pickerInput(group)).toHaveValue('01/11/2026 01:30');
    expect(group).toHaveAccessibleDescription(
      formatMessageText(en['dateField.repeatedTime'], { offset: 'UTC-05:00' })
    );
  });

  it('is in Arabic, with Latin digits and the catalogue placeholders', () => {
    const arabic = getMessages('ar');
    mount(
      <>
        <DayHost initial="2026-09-22" zone="Asia/Amman" />
        <DayHost zone="Asia/Amman" />
      </>,
      'ar'
    );
    const [filled, empty] = screen.getAllByRole('group');
    const shown = pickerInput(filled as HTMLElement).value;
    expect(shown).toContain('22/09/2026');
    // No Arabic-Indic digit anywhere: the repository's `ar-jo-latn` locale,
    // not dayjs's own `ar`, which rewrites every digit.
    expect(shown).not.toMatch(/[٠-٩۰-۹]/);
    const month = within(filled as HTMLElement).getAllByRole('spinbutton')[1] as HTMLElement;
    expect(month.getAttribute('aria-valuetext')).toBe(
      new Intl.DateTimeFormat('ar-JO-u-nu-latn', { month: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2026, 8, 15))
      )
    );
    expect(
      within(empty as HTMLElement)
        .getAllByRole('spinbutton')
        .map((part) => part.textContent)
    ).toEqual([
      arabic['mui.pickers.placeholderDay'],
      arabic['mui.pickers.placeholderMonth'],
      arabic['mui.pickers.placeholderYear'],
    ]);
  });
});

describe('the conversions between a picker value and what a screen holds', () => {
  it('reads a calendar day on the zone it is given', () => {
    // 22:30 UTC on the 21st is already the 22nd in Amman and still the 21st in New York.
    const instant = dayjs('2026-09-21T22:30:00Z');
    expect(pickerToDay(instant, 'Asia/Amman')).toBe('2026-09-22');
    expect(pickerToDay(instant, 'America/New_York')).toBe('2026-09-21');
  });

  it('places a calendar day at that zone’s midnight', () => {
    expect(dayToPicker('2026-09-22', 'Asia/Amman')?.toISOString()).toBe('2026-09-21T21:00:00.000Z');
    expect(dayToPicker('2026-09-22', 'America/New_York')?.toISOString()).toBe(
      '2026-09-22T04:00:00.000Z'
    );
    expect(dayToPicker('22/09/2026', 'Asia/Amman')).toBeNull();
    expect(pickerToDay(null, 'Asia/Amman')).toBe('');
  });

  it('emits each moment with the offset in force AT that moment (daylight saving)', () => {
    const before = dayjs.tz('2026-03-07 12:00', 'America/New_York');
    const after = dayjs.tz('2026-03-09 12:00', 'America/New_York');
    expect(pickerToInstant(before, 'America/New_York')).toBe('2026-03-07T12:00:00-05:00');
    expect(pickerToInstant(after, 'America/New_York')).toBe('2026-03-09T12:00:00-04:00');
    // No transitions: the same offset in winter and in summer.
    expect(pickerToInstant(dayjs.tz('2026-01-15 12:00', 'Asia/Amman'), 'Asia/Amman')).toBe(
      '2026-01-15T12:00:00+03:00'
    );
    expect(pickerToInstant(dayjs.tz('2026-07-15 12:00', 'Asia/Amman'), 'Asia/Amman')).toBe(
      '2026-07-15T12:00:00+03:00'
    );
  });

  it('reads what the operator typed, even when the picker object carries a stale offset', () => {
    // Built the way the picker builds it while a year is typed digit by digit:
    // a year-202 midnight, then the year set to 2026. The object keeps an offset
    // that is wrong for 8 March 2026 in New York (daylight saving starts at
    // 02:00), so converting its instant would land on the 7th.
    const adapter = new AdapterDayjs();
    const typed = adapter.setYear(adapter.date('0202-03-08T00:00:00', 'America/New_York'), 2026);
    expect(typed.format('YYYY-MM-DD')).toBe('2026-03-08');
    expect(pickerToDay(typed, 'America/New_York')).toBe('2026-03-08');
  });

  it('types a moment on the day the clocks change and emits the offset of that moment', async () => {
    const user = userEvent.setup();
    const onMoment = vi.fn();
    mount(<MomentHost zone="America/New_York" onMoment={onMoment} />);
    const group = screen.getByRole('group', { name: /^Visit time/ });
    await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('080320260030');
    // 00:30 is before the 02:00 change: still standard time.
    expect(onMoment).toHaveBeenLastCalledWith('2026-03-08T00:30:00-05:00');
  });

  it('finds the repeated hour, and only the repeated hour', () => {
    const zone = 'America/New_York';
    expect(repeatedWallClock('2026-11-01T01:30:00-04:00', zone)).toEqual({
      earlier: '-04:00',
      later: '-05:00',
      shown: '-04:00',
    });
    expect(repeatedWallClock('2026-11-01T01:30:00-05:00', zone)).toEqual({
      earlier: '-04:00',
      later: '-05:00',
      shown: '-05:00',
    });
    // Just outside the repeated hour, the skipped spring hour, and a zone with
    // no transitions: none is repeated.
    expect(repeatedWallClock('2026-11-01T00:59:00-04:00', zone)).toBeNull();
    expect(repeatedWallClock('2026-11-01T02:00:00-05:00', zone)).toBeNull();
    expect(repeatedWallClock('2026-03-08T03:30:00-04:00', zone)).toBeNull();
    expect(repeatedWallClock('2026-11-01T01:30:00+03:00', 'Asia/Amman')).toBeNull();
    expect(repeatedWallClock('', zone)).toBeNull();
  });

  it('emits an instant the offset rule accepts, and nothing for an unfinished one', () => {
    const emitted = pickerToInstant(dayjs.tz('2026-09-22 09:30', 'Asia/Amman'), 'Asia/Amman');
    expect(validateInstant(emitted)).toBe('ok');
    expect(pickerToInstant(dayjs('not a date'), 'Asia/Amman')).toBe('');
    expect(instantToPicker('', 'Asia/Amman')).toBeNull();
  });
});
