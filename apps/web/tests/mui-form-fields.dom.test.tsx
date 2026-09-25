import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import TextField from '@mui/material/TextField';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { renderLtr, renderRtl } from './render';

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
