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
  ZonedDateTimeField,
  type DayProblem,
  type MomentProblem,
  dayToPicker,
  instantToPicker,
  pickerToDay,
  pickerToInstant,
  repeatedWallClock,
} from '@/components/forms/mui/DateField';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormRadioGroupField } from '@/components/forms/mui/FormRadioGroupField';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { correctionFor } from '@/components/forms/mui/field-wiring';
import {
  TREE_NONE_ID,
  TreePicker,
  ancestorsOf,
  treeShape,
  type TreePickerItem,
} from '@/components/pickers/TreePicker';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import type { Locale } from '@/i18n/config';
import { getMessages, type Messages } from '@/i18n/get-messages';
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
import { holdPickerBlur } from './support/held-picker-blur';
import { seriousViolations } from './support/stock-operations';

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

  it('turns spell-checking off for a value no dictionary knows, and leaves it alone otherwise', () => {
    // A reference or a code (the inventory reference boxes, `P1-32-PRE-OD-MUI7A1`)
    // is never underlined or "corrected"; a field that does not ask says nothing.
    mount(
      <>
        <FormTextField label="Reference" value="" onChange={() => undefined} spellCheck={false} />
        <FormTextField label="Note" value="" onChange={() => undefined} />
      </>
    );
    expect(screen.getByRole('textbox', { name: 'Reference' })).toHaveAttribute(
      'spellcheck',
      'false'
    );
    expect(screen.getByRole('textbox', { name: 'Note' })).not.toHaveAttribute('spellcheck');
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

  it('enters an empty refused picker on its first part, where typing starts the day', async () => {
    const user = userEvent.setup();
    mount(<RefusingDateForm />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const group = screen.getByRole('group', { name: /^Visit day/ });
    const [day] = within(group).getAllByRole('spinbutton');
    await waitFor(() => expect(document.activeElement).toBe(day));
  });
});

/**
 * Checkpoint browser QA, DEF-02: a half-typed day (`01/03/YYYY`) was refused
 * correctly, and then could not be finished — the cursor sat on the picker's
 * section container, a click on the year highlighted it and every digit typed
 * was dropped until focus left the field and came back. The picker now takes
 * the refused form's focus request itself, on its first EMPTY part.
 */
describe('a refused half-typed day is finished where it was left', () => {
  function HalfDayForm({ onDay }: { readonly onDay: (day: string) => void }) {
    const [state, setState] = useState<ActionState>({ status: 'idle' });
    const [day, setDay] = useState('');
    const [problem, setProblem] = useState<DayProblem>(null);
    const [refused, setRefused] = useState(false);
    const formRef = useFocusFirstInvalid(state);
    return (
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (problem === null && day !== '') return;
          setRefused(true);
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
          onChange={(next) => {
            setDay(next);
            onDay(next);
          }}
          onProblem={setProblem}
          timezone="Asia/Amman"
          // The complaint stands while the entry is still wrong, and goes the
          // moment the day is whole and valid — the screens' own rule.
          error={refused && (problem !== null || day === '') ? 'Choose a date.' : undefined}
        />
        <button type="submit">Save</button>
      </form>
    );
  }

  for (const locale of ['en', 'ar'] as const) {
    const catalogue = getMessages(locale);
    const year = catalogue['mui.pickers.year'];

    /**
     * With `holdBlur`, the refusal lands before the picker records that the
     * cursor left it (`holdPickerBlur`) — the order a loaded runner produces by
     * chance, and the one in which the picker itself selects nothing.
     */
    async function refuseHalfTyped(
      user: ReturnType<typeof userEvent.setup>,
      { holdBlur = false }: { readonly holdBlur?: boolean } = {}
    ) {
      const onDay = vi.fn();
      mount(<HalfDayForm onDay={onDay} />, locale);
      const group = screen.getByRole('group', { name: /^Visit day/ });
      await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
      await user.keyboard('0103');
      const releaseBlur = holdBlur ? holdPickerBlur(group) : () => 0;
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(group).toHaveAttribute('aria-invalid', 'true'));
      return { group, onDay, releaseBlur };
    }

    it(`puts the cursor on the empty year after the refusal, and typing finishes the day (${locale})`, async () => {
      const user = userEvent.setup();
      const { group, onDay, releaseBlur } = await refuseHalfTyped(user, { holdBlur: true });
      const yearPart = within(group).getByRole('spinbutton', { name: year });
      await waitFor(() => expect(document.activeElement).toBe(yearPart));
      // The year is entered already selected, in the same step that focuses
      // it, so the first digit replaces the empty year instead of landing in
      // front of it. Asserted at once, never waited for, and again once the
      // held blur update has run. Falsified by removing `selectFocusedPart`
      // in `DateField.tsx`: this case then fails in both locales, every run,
      // with the range collapsed at the start of the year (and, past this
      // check, `2027` is not taken as the year).
      const expectYearSelected = () => {
        expect(document.activeElement).toBe(yearPart);
        const selection = document.getSelection();
        const range =
          selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        expect(range).not.toBeNull();
        expect(range?.collapsed).toBe(false);
        expect(range !== null && yearPart.contains(range.startContainer)).toBe(true);
        expect(range !== null && yearPart.contains(range.endContainer)).toBe(true);
      };
      expectYearSelected();
      expect(releaseBlur()).toBeGreaterThan(0);
      expectYearSelected();
      await user.keyboard('2027');
      expect(onDay).toHaveBeenLastCalledWith('2027-03-01');
      await waitFor(() => expect(group).not.toHaveAttribute('aria-invalid'));
      expect(screen.queryByText('Choose a date.')).toBeNull();
    });

    it(`takes the year when it is clicked after the refusal (${locale})`, async () => {
      const user = userEvent.setup();
      const { group, onDay } = await refuseHalfTyped(user);
      const yearPart = within(group).getByRole('spinbutton', { name: year });
      await waitFor(() => expect(group.contains(document.activeElement)).toBe(true));
      await user.click(yearPart);
      await user.keyboard('2027');
      expect(onDay).toHaveBeenLastCalledWith('2027-03-01');
      await waitFor(() => expect(group).not.toHaveAttribute('aria-invalid'));
    });
  }
});

/**
 * The same answer to a refused form's focus request, on `DateTimeField`: the
 * picker takes the cursor itself, onto its first EMPTY part in the locale's own
 * section order, and typing there finishes the moment. The two locales order
 * their parts differently — English puts the day first and the time last,
 * Arabic puts the time (with its morning/afternoon part) first and the day
 * after it — so each is half-typed in its own order, leaving a different first
 * empty part. Without the answer the cursor lands on the first part, which is
 * already typed, and the rest of the entry goes into the wrong part.
 */
describe('a refused half-typed moment is finished where it was left', () => {
  function HalfMomentForm({
    locale,
    onMoment,
  }: {
    readonly locale: Locale;
    readonly onMoment: (moment: string) => void;
  }) {
    const [state, setState] = useState<ActionState>({ status: 'idle' });
    const [moment, setMoment] = useState('');
    const [refused, setRefused] = useState(false);
    const formRef = useFocusFirstInvalid(state);
    return (
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (moment !== '') return;
          setRefused(true);
          setState({
            status: 'invalid',
            fieldErrors: { moment: 'form.required' },
            attempt: (state.attempt ?? 0) + 1,
          });
        }}
      >
        <FormTextField label="Reference" value="DOC-1" onChange={() => undefined} />
        <DateTimeField
          messages={getMessages(locale)}
          label="Visit time"
          value={moment}
          onChange={(next) => {
            setMoment(next);
            onMoment(next);
          }}
          timezone="Asia/Amman"
          error={refused && moment === '' ? 'Choose a time.' : undefined}
        />
        <button type="submit">Save</button>
      </form>
    );
  }

  // `typed` fills the first parts in the locale's order; `firstEmpty` names the
  // part that is then first and empty; `rest` fills every part from there on.
  const cases = [
    {
      locale: 'en',
      typed: '0103',
      firstEmpty: 'mui.pickers.year',
      rest: '20270930',
    },
    {
      locale: 'ar',
      typed: 'ص0930',
      firstEmpty: 'mui.pickers.day',
      rest: '01032027',
    },
  ] as const;

  for (const { locale, typed, firstEmpty, rest } of cases) {
    const catalogue = getMessages(locale);

    it(`puts the cursor on the first empty part after the refusal, and typing finishes the moment (${locale})`, async () => {
      const user = userEvent.setup();
      const onMoment = vi.fn();
      mount(<HalfMomentForm locale={locale} onMoment={onMoment} />, locale);
      const group = screen.getByRole('group', { name: /^Visit time/ });
      const parts = within(group).getAllByRole('spinbutton');
      await user.click(parts[0] as HTMLElement);
      await user.keyboard(typed);
      // Half typed: the first part holds a value, and the named part is the
      // first one still empty in this locale's order.
      const empty = catalogue['mui.pickers.empty'];
      expect(parts[0]).not.toHaveAttribute('aria-valuetext', empty);
      const unfinished = parts.find((part) => part.getAttribute('aria-valuetext') === empty);
      const target = within(group).getByRole('spinbutton', { name: catalogue[firstEmpty] });
      expect(unfinished).toBe(target);
      expect(onMoment).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(group).toHaveAttribute('aria-invalid', 'true'));
      await waitFor(() => expect(document.activeElement).toBe(target));
      await user.keyboard(rest);
      expect(onMoment).toHaveBeenLastCalledWith('2027-03-01T09:30:00+03:00');
      await waitFor(() => expect(group).not.toHaveAttribute('aria-invalid'));
      expect(screen.queryByText('Choose a time.')).toBeNull();
    });
  }
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

  it('reports the canonical amount on blur as a string, and keeps showing what was typed', async () => {
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
    // The canonical string goes up; the box is not rewritten at the storage scale
    // (DF-6: a typed 25.000 JOD came back as 25.0000).
    expect(input).toHaveValue('12.5');
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
    expect(input).toHaveValue('5');
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
  messages = en,
}: {
  readonly initial?: string;
  readonly zone?: string;
  readonly onMoment?: (moment: string) => void;
  readonly messages?: Messages;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateTimeField
      messages={messages}
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
    expect(pickerInput(group)).not.toHaveAttribute('required');
    // A part per piece of the date, each its own spin button.
    expect(within(group).getAllByRole('spinbutton')).toHaveLength(3);
    /*
     * Required is announced on every part: a `group` may not carry
     * `aria-required` (axe `aria-allowed-attr`), a `spinbutton` may
     * (`P1-32-PRE-OD-INV3`; it was asserted on the group before).
     */
    for (const part of within(group).getAllByRole('spinbutton')) {
      expect(part).toHaveAttribute('aria-required', 'true');
    }
    expect(group).not.toHaveAttribute('aria-required');
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`a required day has no serious or critical accessibility finding (${locale})`, async () => {
      const { container } = mount(
        <DayHost required description="The day the vehicle arrives." />,
        locale
      );
      expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
      expect(await seriousViolations(container)).toEqual([]);
    });
  }

  it('an optional day announces no part as required', () => {
    mount(<DayHost />);
    const group = screen.getByRole('group', { name: /^Visit day/ });
    for (const part of within(group).getAllByRole('spinbutton')) {
      expect(part).not.toHaveAttribute('aria-required');
    }
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

  it('reports a day only partly typed as incomplete, and withdraws it once the day is whole', async () => {
    // The picker itself publishes neither a value nor an error while parts of an
    // empty field are blank, so without the wrapper's own report a half-typed day
    // reads as "no day" and a form leaves it out silently.
    const user = userEvent.setup();
    const onDay = vi.fn();
    const onProblem = vi.fn();
    mount(<DayHost zone="Asia/Amman" onDay={onDay} onProblem={onProblem} />);
    const group = screen.getByRole('group', { name: /^Visit day/ });
    expect(onProblem).not.toHaveBeenCalled();
    await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('0103');
    expect(onProblem).toHaveBeenLastCalledWith('incomplete');
    expect(onDay).not.toHaveBeenCalled();
    await user.keyboard('2026');
    expect(onDay).toHaveBeenLastCalledWith('2026-03-01');
    expect(onProblem).toHaveBeenLastCalledWith(null);
  });

  it('withdraws the incomplete report when the partly typed parts are cleared again', async () => {
    const user = userEvent.setup();
    const onProblem = vi.fn();
    mount(<DayHost zone="Asia/Amman" onProblem={onProblem} />);
    const group = screen.getByRole('group', { name: /^Visit day/ });
    const day = within(group).getAllByRole('spinbutton')[0] as HTMLElement;
    await user.click(day);
    await user.keyboard('01');
    expect(onProblem).toHaveBeenLastCalledWith('incomplete');
    await user.click(day);
    await user.keyboard('{Backspace}');
    expect(onProblem).toHaveBeenLastCalledWith(null);
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

  /*
   * `ZonedDateTimeField` — the same field on a clock the caller NAMES, for a
   * record reached by its address (the appointment detail): it reads no working
   * context, so "All my branches" in the header neither refuses it nor moves
   * its clock. Falsified by rendering `DateTimeField` in its place: the first
   * case then draws the choose-one-branch refusal instead of a picker.
   */
  function ZonedHost({
    zone,
    onMoment,
    messages = en,
  }: {
    readonly zone: string;
    readonly onMoment?: (moment: string) => void;
    readonly messages?: Messages;
  }) {
    const [value, setValue] = useState('2026-01-15T12:00:00Z');
    return (
      <ZonedDateTimeField
        messages={messages}
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

  it('ZonedDateTimeField: takes a moment on the named clock under "All my branches"', async () => {
    const user = userEvent.setup();
    const onMoment = vi.fn();
    const second = { ...TEST_BRANCH, id: '88888888-8888-4888-8888-888888888888', name: 'Second' };
    mount(
      inBranch(
        <>
          <BranchSwitch to="all" label="use all" />
          <ZonedHost zone="Asia/Tokyo" onMoment={onMoment} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, second]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));
    const group = await screen.findByRole('group', { name: /^Visit time/ });
    expect(screen.queryByTestId('date-time-requires-branch')).toBeNull();
    // 12:00 UTC is 21:00 in Tokyo.
    expect(pickerInput(group)).toHaveValue('15/01/2026 21:00');
    await user.click(within(group).getAllByRole('spinbutton')[3] as HTMLElement);
    await user.keyboard('0930');
    expect(onMoment).toHaveBeenLastCalledWith('2026-01-15T09:30:00+09:00');
  });

  it('ZonedDateTimeField: needs no working context at all', () => {
    mount(<ZonedHost zone="America/New_York" />);
    const group = screen.getByRole('group', { name: /^Visit time/ });
    expect(pickerInput(group)).toHaveValue('15/01/2026 07:00');
  });

  /*
   * A moment only partly typed is reported as `'incomplete'`, as a day is: the
   * picker publishes neither a value nor an error while parts are blank, so
   * without the wrapper's own report an unfinished moment reads as "none" and a
   * form sends without it (the quotation expiry). Falsified by removing
   * `onPartsBlank` from `ZonedDateTimeField`: the first report never comes.
   */
  function EmptyZonedHost({
    onMoment,
    onProblem,
  }: {
    readonly onMoment: (moment: string) => void;
    readonly onProblem: (problem: MomentProblem) => void;
  }) {
    const [value, setValue] = useState('');
    return (
      <ZonedDateTimeField
        messages={en}
        label="Visit time"
        value={value}
        onChange={(next) => {
          onMoment(next);
          setValue(next);
        }}
        onProblem={onProblem}
        timezone="Asia/Riyadh"
      />
    );
  }

  it('ZonedDateTimeField: reports a moment only partly typed as incomplete, and withdraws it once whole', async () => {
    const user = userEvent.setup();
    const onMoment = vi.fn();
    const onProblem = vi.fn();
    mount(<EmptyZonedHost onMoment={onMoment} onProblem={onProblem} />);
    const group = screen.getByRole('group', { name: /^Visit time/ });
    expect(onProblem).not.toHaveBeenCalled();
    await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('0112');
    expect(onProblem).toHaveBeenLastCalledWith('incomplete');
    expect(onMoment.mock.calls.every(([moment]) => moment === '')).toBe(true);
    await user.keyboard('20261000');
    expect(onMoment).toHaveBeenLastCalledWith('2026-12-01T10:00:00+03:00');
    expect(onProblem).toHaveBeenLastCalledWith(null);
  });

  it('ZonedDateTimeField: withdraws the incomplete report when the typed parts are cleared again', async () => {
    const user = userEvent.setup();
    const onProblem = vi.fn();
    mount(<EmptyZonedHost onMoment={() => undefined} onProblem={onProblem} />);
    const group = screen.getByRole('group', { name: /^Visit time/ });
    const day = within(group).getAllByRole('spinbutton')[0] as HTMLElement;
    await user.click(day);
    await user.keyboard('01');
    expect(onProblem).toHaveBeenLastCalledWith('incomplete');
    await user.click(day);
    await user.keyboard('{Backspace}');
    expect(onProblem).toHaveBeenLastCalledWith(null);
  });

  it('ZonedDateTimeField: reports a moment typed whole but impossible, and emits no instant', async () => {
    const user = userEvent.setup();
    const onMoment = vi.fn();
    const onProblem = vi.fn();
    mount(<EmptyZonedHost onMoment={onMoment} onProblem={onProblem} />);
    const group = screen.getByRole('group', { name: /^Visit time/ });
    await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('310220261000');
    expect(onProblem.mock.lastCall?.[0]).not.toBeNull();
    expect(onProblem.mock.lastCall?.[0]).not.toBe('incomplete');
    expect(onMoment.mock.calls.every(([moment]) => moment === '')).toBe(true);
  });

  /*
   * The Arabic 12-hour clock (DEF-01). Arabic writes a moment with its
   * morning/afternoon part FIRST, then the time, then the day. Every afternoon
   * time was shown in the field and then refused as empty, because the date
   * library read the afternoon word back as the morning and the strict
   * read-back failed. Falsified by mounting the stock MUI X adapter in
   * `UiFoundationProvider`: every afternoon case below then emits nothing.
   */
  const arabic = getMessages('ar');
  const MORNING_WORD = 'ص';
  const AFTERNOON_WORD = 'م';

  for (const { typed, moment } of [
    { typed: `${AFTERNOON_WORD}0300`, moment: '2026-09-30T15:00:00+03:00' },
    { typed: `${AFTERNOON_WORD}1230`, moment: '2026-09-30T12:30:00+03:00' },
    { typed: `${MORNING_WORD}0300`, moment: '2026-09-30T03:00:00+03:00' },
    { typed: `${MORNING_WORD}1230`, moment: '2026-09-30T00:30:00+03:00' },
  ]) {
    it(`DateTimeField in Arabic: takes ${typed} on the branch clock as ${moment}`, async () => {
      const user = userEvent.setup();
      const onMoment = vi.fn();
      mount(<MomentHost zone="Asia/Amman" onMoment={onMoment} messages={arabic} />, 'ar');
      const group = screen.getByRole('group', { name: /^Visit time/ });
      await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
      await user.keyboard(typed);
      // The time alone is half a moment: nothing is emitted yet.
      expect(onMoment).not.toHaveBeenCalled();
      await user.keyboard('30092026');
      expect(onMoment).toHaveBeenLastCalledWith(moment);
      expect(pickerInput(group).value).toContain('30/09/2026');
      expect(pickerInput(group).value).not.toMatch(/[٠-٩۰-۹]/);
      expect(group).not.toHaveAttribute('aria-invalid');
    });
  }

  it('DateTimeField in Arabic: turning a morning into the afternoon moves the moment by twelve hours', async () => {
    const user = userEvent.setup();
    const onMoment = vi.fn();
    mount(
      <MomentHost
        initial="2026-09-30T00:00:00Z"
        zone="Asia/Amman"
        onMoment={onMoment}
        messages={arabic}
      />,
      'ar'
    );
    const group = screen.getByRole('group', { name: /^Visit time/ });
    const meridiem = within(group).getAllByRole('spinbutton')[0] as HTMLElement;
    expect(meridiem).toHaveTextContent(MORNING_WORD);
    await user.click(meridiem);
    await user.keyboard('{ArrowUp}');
    expect(onMoment).toHaveBeenLastCalledWith('2026-09-30T15:00:00+03:00');
    expect(meridiem).toHaveTextContent(AFTERNOON_WORD);
  });

  it('ZonedDateTimeField in Arabic: an afternoon moment it holds stays editable in the afternoon', async () => {
    // The reschedule form's case: 12:00 UTC is 15:00 in Amman, drawn with the
    // afternoon word; changing the hour must keep the afternoon.
    const user = userEvent.setup();
    const onMoment = vi.fn();
    mount(<ZonedHost zone="Asia/Amman" onMoment={onMoment} messages={arabic} />, 'ar');
    const group = screen.getByRole('group', { name: /^Visit time/ });
    const parts = within(group).getAllByRole('spinbutton');
    expect(parts[0]).toHaveTextContent(AFTERNOON_WORD);
    await user.click(parts[1] as HTMLElement);
    await user.keyboard('04');
    expect(onMoment).toHaveBeenLastCalledWith('2026-01-15T16:00:00+03:00');
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

/**
 * `TreePicker` — one record from a GENUINE hierarchy, on the MUI X Community
 * tree view (ADR-022), with the `FieldFrame` contract.
 *
 * What a tree picker gets wrong: dropping a row whose parent it cannot place,
 * looping on a cycle, hiding the chosen row inside a closed parent, marking
 * itself invalid when nothing is wrong, and refusing the focus a refused form
 * asks for. Each is a case here, in both directions.
 */

const TREE_ITEMS: readonly TreePickerItem[] = [
  { id: 'engine', parentId: null, label: 'Engine' },
  { id: 'oil', parentId: 'engine', label: 'Engine oil' },
  { id: 'filters', parentId: 'oil', label: 'Oil filters' },
  { id: 'body', parentId: null, label: 'Body' },
];

/**
 * A row by its OWN label. A row's accessible name also carries its open
 * children's labels, so a name match would find the parent for a child's words.
 */
function treeRow(label: string, container: HTMLElement = document.body): HTMLElement {
  const found = within(container)
    .getAllByRole('treeitem')
    .find((row) =>
      within(row)
        .queryAllByText(label)
        .some((text) => text.closest('[role="treeitem"]') === row)
    );
  if (found === undefined) throw new Error(`no tree row labelled ${label}`);
  return found;
}

/** A controlled picker, as a screen holds one. */
function HeldTree({
  initial = '',
  onChange,
  onEdit,
  error,
  required,
  items = TREE_ITEMS,
}: {
  readonly initial?: string;
  readonly onChange?: (id: string) => void;
  readonly onEdit?: () => void;
  readonly error?: string;
  readonly required?: boolean;
  readonly items?: readonly TreePickerItem[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <TreePicker
      label="Category"
      description="Choose where it belongs."
      items={items}
      value={value}
      noneLabel="Any category"
      error={error}
      required={required}
      onEdit={onEdit}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
      testId="tree"
    />
  );
}

describe('TreePicker — the shape of the tree', () => {
  it('files each row under its parent, in the caller’s order', () => {
    const shape = treeShape(TREE_ITEMS);
    expect(shape.roots.map((item) => item.id)).toEqual(['engine', 'body']);
    expect(shape.children.get('engine')?.map((item) => item.id)).toEqual(['oil']);
    expect(shape.children.get('oil')?.map((item) => item.id)).toEqual(['filters']);
  });

  it('draws a row whose parent is not in the list at the top level, rather than dropping it', () => {
    const shape = treeShape([
      ...TREE_ITEMS,
      { id: 'orphan', parentId: 'missing', label: 'Orphan' },
    ]);
    expect(shape.roots.map((item) => item.id)).toContain('orphan');
  });

  it('draws a cycle the list carries at the top level too, and terminates', () => {
    const cycle: TreePickerItem[] = [
      { id: 'a', parentId: 'b', label: 'A' },
      { id: 'b', parentId: 'a', label: 'B' },
    ];
    const shape = treeShape(cycle);
    const reachable = new Set<string>();
    const walk = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const child of shape.children.get(id) ?? []) walk(child.id);
    };
    shape.roots.forEach((root) => walk(root.id));
    expect([...reachable].sort()).toEqual(['a', 'b']);
    expect(ancestorsOf(cycle, 'a')).toEqual(['b']);
  });

  it('names a row’s ancestors nearest first', () => {
    expect(ancestorsOf(TREE_ITEMS, 'filters')).toEqual(['oil', 'engine']);
    expect(ancestorsOf(TREE_ITEMS, 'engine')).toEqual([]);
    expect(ancestorsOf(TREE_ITEMS, 'unknown')).toEqual([]);
  });
});

describe('TreePicker — choosing', () => {
  it('reports the chosen row’s id, and the "none" row as empty — with onEdit first', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    mount(
      <HeldTree onEdit={() => order.push('edit')} onChange={(id) => order.push(`change:${id}`)} />
    );
    const tree = screen.getByRole('tree', { name: /^Category/ });
    await user.click(within(tree).getByText('Body'));
    await user.click(within(tree).getByText('Any category'));
    expect(order).toEqual(['edit', 'change:body', 'edit', 'change:']);
    expect(treeRow('Any category', tree)).toHaveAttribute('aria-checked', 'true');
  });

  it('nests a child inside its parent, and opens the chosen row’s ancestors', () => {
    mount(<HeldTree initial="filters" />);
    const tree = screen.getByRole('tree', { name: /^Category/ });
    const engine = treeRow('Engine', tree);
    expect(engine).toHaveAttribute('aria-expanded', 'true');
    const oil = treeRow('Engine oil', engine);
    const filters = treeRow('Oil filters', oil);
    expect(filters).toHaveAttribute('aria-checked', 'true');
    expect(filters).toBeVisible();
  });

  it('opens the ancestors of a value the caller sets later', async () => {
    function Later() {
      const [value, setValue] = useState('');
      return (
        <>
          <button type="button" onClick={() => setValue('oil')}>
            set
          </button>
          <TreePicker label="Category" items={TREE_ITEMS} value={value} onChange={setValue} />
        </>
      );
    }
    const user = userEvent.setup();
    mount(<Later />);
    const engine = treeRow('Engine');
    expect(engine).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'set' }));
    await waitFor(() => expect(engine).toHaveAttribute('aria-expanded', 'true'));
    expect(treeRow('Engine oil', engine)).toHaveAttribute('aria-checked', 'true');
  });

  it('is driven by the keyboard: arrows move and open, Space chooses and never unchooses', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount(<HeldTree onChange={onChange} />);
    const none = treeRow('Any category');
    none.focus();
    await user.keyboard('{ArrowDown}');
    expect(treeRow('Engine')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(treeRow('Engine')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown} ');
    expect(onChange).toHaveBeenLastCalledWith('oil');
    // Space again on the chosen row keeps it chosen.
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(treeRow('Engine oil')).toHaveAttribute('aria-checked', 'true');
    // Enter on a row with no children chooses it.
    await user.keyboard('{ArrowDown}');
    expect(treeRow('Body')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('body');
  });

  it('in Arabic, right to left, the arrow toward the start of the line opens a row', async () => {
    const user = userEvent.setup();
    mount(<HeldTree />, 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    const engine = treeRow('Engine');
    engine.focus();
    await user.keyboard('{ArrowLeft}');
    expect(engine).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowRight}');
    expect(engine).toHaveAttribute('aria-expanded', 'false');
  });

  it('never exposes the internal id of the "none" row', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mount(<HeldTree initial="body" onChange={onChange} />);
    await user.click(screen.getByText('Any category'));
    expect(onChange).toHaveBeenCalledWith('');
    expect(onChange).not.toHaveBeenCalledWith(TREE_NONE_ID);
  });
});

describe('TreePicker — the FieldFrame contract', () => {
  it('is named by its label and described by its description; invalid only with an error', () => {
    const { unmount } = mount(<HeldTree required />);
    const tree = screen.getByRole('tree', { name: /^Category/ });
    expect(tree).toHaveAccessibleDescription('Choose where it belongs.');
    expect(tree).not.toHaveAttribute('aria-invalid');
    expect(tree).toHaveAttribute('aria-required', 'true');
    unmount();

    mount(<HeldTree error="Choose a category." />);
    const refused = screen.getByRole('tree', { name: /^Category/ });
    expect(refused).toHaveAttribute('aria-invalid', 'true');
    expect(refused).toHaveAccessibleDescription(/Choose where it belongs\..*Choose a category\./);
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a category.');
  });

  it('a refused form puts the cursor inside the tree, on its focusable row', async () => {
    function Refusing() {
      const [attempt, setAttempt] = useState(0);
      const formRef = useFocusFirstInvalid(
        attempt === 0
          ? { status: 'idle', attempt }
          : { status: 'invalid', fieldErrors: { category: 'x' }, attempt }
      );
      return (
        <form ref={formRef} aria-label="refusing">
          <TreePicker
            label="Category"
            items={TREE_ITEMS}
            value=""
            onChange={() => undefined}
            error={attempt === 0 ? undefined : 'Choose a category.'}
          />
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            submit
          </button>
        </form>
      );
    }
    const user = userEvent.setup();
    mount(<Refusing />);
    await user.click(screen.getByRole('button', { name: 'submit' }));
    const tree = screen.getByRole('tree', { name: /^Category/ });
    await waitFor(() => expect(tree.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toHaveAttribute('role', 'treeitem');
  });
});

/*
 * The two wrappers the reception slice added (ADR-022): a yes-or-no answer and
 * one answer from a short list, each keeping `FieldFrame`'s contract.
 */
describe('FormCheckboxField', () => {
  function Witness({ error }: { readonly error?: string }) {
    const [checked, setChecked] = useState(false);
    const [edits, setEdits] = useState(0);
    return (
      <>
        <FormCheckboxField
          label="I witnessed the declaration"
          description="Recorded against your account."
          checked={checked}
          onChange={setChecked}
          onEdit={() => setEdits((count) => count + 1)}
          error={error}
        />
        <output data-testid="checkbox-edits">{edits}</output>
      </>
    );
  }

  it('is named by its label, toggles, and reports the edit before the value', async () => {
    const user = userEvent.setup();
    mount(<Witness />);
    const box = screen.getByRole('checkbox', { name: 'I witnessed the declaration' });
    expect(box).not.toBeChecked();
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(box).toHaveAccessibleDescription('Recorded against your account.');
    await user.click(box);
    expect(box).toBeChecked();
    expect(screen.getByTestId('checkbox-edits')).toHaveTextContent('1');
  });

  it('marks and describes an error, description first, and no native required', () => {
    mount(<Witness error="Confirm you witnessed it." />);
    const box = screen.getByRole('checkbox', { name: 'I witnessed the declaration' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).not.toHaveAttribute('required');
    const [first, second] = describedByIds(box);
    expect(document.getElementById(first ?? '')).toHaveTextContent(
      'Recorded against your account.'
    );
    expect(document.getElementById(second ?? '')).toHaveTextContent('Confirm you witnessed it.');
    expect(screen.getByRole('alert')).toHaveTextContent('Confirm you witnessed it.');
  });

  it('reads right to left in Arabic, the label at the start', () => {
    mount(<Witness />, 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('checkbox', { name: 'I witnessed the declaration' })).toBeVisible();
  });
});

describe('FormRadioGroupField', () => {
  function Origin({
    error,
    required = false,
  }: {
    readonly error?: string;
    readonly required?: boolean;
  }) {
    const [value, setValue] = useState('walk_in');
    return (
      <FormRadioGroupField
        label="Where the visit came from"
        description="One origin, never both."
        required={required}
        value={value}
        onChange={setValue}
        error={error}
        options={[
          { value: 'walk_in', label: 'Walk-in', description: 'Nobody booked it.' },
          { value: 'appointment', label: 'Appointment' },
        ]}
      />
    );
  }

  it('is a radiogroup named by its label, one answer at a time', async () => {
    const user = userEvent.setup();
    mount(<Origin required />);
    const group = screen.getByRole('radiogroup', { name: /^Where the visit came from/ });
    expect(group).toHaveAttribute('aria-required', 'true');
    expect(group).not.toHaveAttribute('aria-invalid');
    expect(group).toHaveAccessibleDescription('One origin, never both.');
    const walkIn = within(group).getByRole('radio', { name: /^Walk-in/ });
    const appointment = within(group).getByRole('radio', { name: 'Appointment' });
    expect(walkIn).toBeChecked();
    await user.click(appointment);
    expect(appointment).toBeChecked();
    expect(walkIn).not.toBeChecked();
    // An option's own sentence is read with it.
    expect(walkIn).toHaveAccessibleName(expect.stringContaining('Nobody booked it.'));
  });

  it('marks the group invalid, describes it by the error, and a refused form enters it', async () => {
    function Refused() {
      const [state, setState] = useState<ActionState>({ status: 'idle' });
      const formRef = useFocusFirstInvalid(state);
      const corrections = useClearOnCorrect(state);
      const [value, setValue] = useState('');
      return (
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            setState({
              status: 'invalid',
              fieldErrors: { origin: 'form.required' },
              attempt: (state.attempt ?? 0) + 1,
            });
          }}
        >
          <FormRadioGroupField
            label="Where the visit came from"
            value={value}
            onChange={setValue}
            options={[
              { value: 'walk_in', label: 'Walk-in' },
              { value: 'appointment', label: 'Appointment' },
            ]}
            {...correctionFor(corrections, 'origin', en)}
          />
          <button type="submit">Save</button>
        </form>
      );
    }
    const user = userEvent.setup();
    mount(<Refused />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const group = screen.getByRole('radiogroup', { name: 'Where the visit came from' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    // Marked for `useFocusFirstInvalid` as every other field is (F7).
    expect(group).toHaveAttribute('data-invalid', 'true');
    expect(group).toHaveAccessibleDescription(en['form.required']);
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: 'Walk-in' })).toHaveFocus()
    );
    // A choice withdraws the complaint.
    await user.click(within(group).getByRole('radio', { name: 'Appointment' }));
    expect(group).not.toHaveAttribute('aria-invalid');
    expect(group).not.toHaveAttribute('data-invalid');
  });

  it('reads right to left in Arabic', () => {
    mount(<Origin error="Choose one." />, 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('radiogroup', { name: 'Where the visit came from' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });
});
