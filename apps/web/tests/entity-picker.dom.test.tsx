import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FormEvent, type ReactElement } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityPicker, SearchPicker as AdaptedPicker } from '@/components/pickers/EntityPicker';
import type { SearchPickerProps } from '@/components/search/SearchPicker';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  switchExpectingQuestion,
  switchWithoutQuestion,
} from './support/branch-switch';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';

/**
 * `EntityPicker` — `SearchPicker`'s contract on Material UI's Autocomplete
 * (ADR-022 PR1).
 *
 * Every rule `SearchPicker` is held to by `customer-selector.dom.test.tsx` and
 * `shell.dom.test.tsx` is held here too, restated for a combobox: the search is
 * the server's and is sent once per pause, a superseded reply is dropped, the
 * minimum length is honoured, a working-context switch forgets the term and the
 * choice (asking first in a form that writes), the caller's refusal marks the
 * control `useFocusFirstInvalid` finds, and the cursor stays on the control
 * after a choice.
 */

const en = getMessages('en');
const ar = getMessages('ar');

interface Rec {
  readonly id: string;
  readonly name: string;
}

const LAYLA: Rec = { id: '9f8e7d6c-5b4a-4392-8172-0e02b2c3d479', name: 'Layla Haddad' };
const OMAR: Rec = { id: '11112222-3333-4444-8555-666677778888', name: 'Omar Saleh' };

type Load = SearchPickerProps<Rec>['load'];

function page(items: readonly Rec[], nextCursor: string | null = null): ReadState<CursorPage<Rec>> {
  return {
    status: 'ok',
    data: { items, nextCursor, hasMore: nextCursor !== null },
    correlationId: 'corr-1',
  };
}

function refusedWith(
  status: 'denied' | 'unavailable' | 'expired' | 'error'
): ReadState<CursorPage<Rec>> {
  return { status, correlationId: 'corr-7' } as ReadState<CursorPage<Rec>>;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function Harness({
  load,
  locale = 'en',
  canSearch = true,
  error,
  describedBy,
  countsAsUnsaved,
  opened = null,
  onChosen,
  adapted = false,
}: {
  readonly load: Load;
  readonly locale?: Locale;
  readonly canSearch?: boolean;
  readonly error?: string | undefined;
  readonly describedBy?: string;
  readonly countsAsUnsaved?: boolean;
  readonly opened?: Rec | null;
  readonly onChosen?: (next: Rec | null) => Rec | null;
  readonly adapted?: boolean;
}) {
  const [value, setValue] = useState<Rec | null>(opened);
  const Picker = adapted ? AdaptedPicker : EntityPicker;
  return (
    <>
      <Picker<Rec>
        messages={getMessages(locale)}
        locale={locale}
        label="Paying customer"
        value={value}
        onChange={(next) => setValue(onChosen ? onChosen(next) : next)}
        labelOf={(row) => row.name}
        load={load}
        canSearch={canSearch}
        notPermitted="You may not look up customers."
        unavailableId="picker-unavailable"
        error={error}
        minLength={2}
        maxLength={40}
        placeholder="Name or number"
        example="For example: Layla or 0791234567"
        tooShort="Type at least two characters."
        resultsLabel="Matching customers"
        change="Change customer"
        pristineId={opened?.id ?? null}
        {...(countsAsUnsaved === undefined ? {} : { countsAsUnsaved })}
        describedBy={describedBy}
        testId="entity-picker"
      />
      <output data-testid="picker-value">{value?.id ?? ''}</output>
    </>
  );
}

function mount(ui: ReactElement, locale: Locale = 'en') {
  const messages = getMessages(locale);
  const renderIn = locale === 'ar' ? renderRtl : renderLtr;
  return renderIn(
    <UiFoundationProvider locale={locale} text={muiTextOf(messages)}>
      {ui}
    </UiFoundationProvider>
  );
}

const box = () => screen.getByRole('combobox', { name: /^Paying customer/ });

afterEach(() => {
  vi.restoreAllMocks();
  for (const style of document.head.querySelectorAll('style')) style.remove();
});

describe('the search is the server’s, once per pause', () => {
  it('sends nothing on mount, then exactly one read for a settled term', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    expect(load).not.toHaveBeenCalled();

    await user.type(box(), 'Layla');
    expect(await screen.findByRole('option', { name: 'Layla Haddad' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]).toEqual(['Layla', null]);
  });

  it('refuses a term shorter than the minimum, and sends at exactly the minimum', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);

    await user.type(box(), 'L');
    expect(await screen.findByText('Type at least two characters.')).toBeVisible();
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(load).not.toHaveBeenCalled();

    // FALSIFICATION of the boundary: one more character and the read goes out.
    await user.type(box(), 'a');
    await screen.findByRole('option', { name: 'Layla Haddad' });
    expect(load.mock.calls.at(-1)).toEqual(['La', null]);
    expect(box()).not.toHaveAttribute('aria-invalid');
  });

  it('drops a superseded reply that lands after the newer one', async () => {
    const slow = deferred<ReadState<CursorPage<Rec>>>();
    const load = vi
      .fn<Load>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(page([OMAR]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);

    await user.type(box(), 'La');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await user.type(box(), 'x');
    expect(await screen.findByRole('option', { name: 'Omar Saleh' })).toBeInTheDocument();

    slow.resolve(page([LAYLA]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('option', { name: 'Layla Haddad' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Omar Saleh' })).toBeInTheDocument();
  });

  it('lists what the server returned, in its order, and never narrows it on the client', async () => {
    // Neither row contains the typed term. A client filter would hide both.
    const load = vi.fn<Load>().mockResolvedValue(page([OMAR, LAYLA]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), 'zz');
    const listbox = await screen.findByRole('listbox', { name: 'Matching customers' });
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Omar Saleh', 'Layla Haddad']);
  });

  it('sends Arabic-Indic digits as typed', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), '٠٧٩١');
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(load.mock.calls.at(-1)?.[0]).toBe('٠٧٩١');
  });

  it('Enter searches now and never submits the form around it', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const submitted = vi.fn((event: FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    mount(
      <form onSubmit={submitted}>
        <Harness load={load} />
      </form>
    );
    await user.type(box(), 'La{Enter}');
    await waitFor(() => expect(load).toHaveBeenCalledWith('La', null));
    expect(submitted).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('entity-picker')).queryAllByRole('button')).not.toContain(
      document.querySelector('button[type="submit"]')
    );
  });

  it('walks the server’s pages with the cursor it returned', async () => {
    const load = vi
      .fn<Load>()
      .mockResolvedValueOnce(page([LAYLA], 'p-2'))
      .mockResolvedValueOnce(page([OMAR]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), 'La');
    await screen.findByRole('option', { name: 'Layla Haddad' });

    await user.click(screen.getByRole('button', { name: en['table.nextPage'] }));
    expect(await screen.findByRole('option', { name: 'Omar Saleh' })).toBeInTheDocument();
    expect(load.mock.calls.at(-1)).toEqual(['La', 'p-2']);
    expect(screen.getByRole('button', { name: en['table.previousPage'] })).toBeEnabled();
  });
});

describe('choosing', () => {
  it('chooses by name, reports the identifier and never shows it', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), 'Layla');
    await user.click(await screen.findByRole('option', { name: 'Layla Haddad' }));

    expect(box()).toHaveValue('Layla Haddad');
    expect(screen.getByTestId('picker-value')).toHaveTextContent(LAYLA.id);
    expect(screen.getByTestId('entity-picker')).not.toHaveTextContent(LAYLA.id);
    // The cursor stays on the control, which now reads the chosen name.
    await waitFor(() => expect(box()).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('chooses from the keyboard, and the change control puts the choice back', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA, OMAR]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), 'La');
    await screen.findByRole('option', { name: 'Omar Saleh' });
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByTestId('picker-value')).toHaveTextContent(OMAR.id);

    await user.click(screen.getByRole('button', { name: 'Change customer' }));
    expect(screen.getByTestId('picker-value')).toHaveTextContent('');
    expect(box()).toHaveValue('');
  });

  it('the change control is a visible button next in the tab order, and Enter on it puts the choice back', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA, OMAR]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), 'La');
    await screen.findByRole('option', { name: 'Omar Saleh' });
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByTestId('picker-value')).toHaveTextContent(OMAR.id);
    await waitFor(() => expect(box()).toHaveFocus());

    // Material's own clear icon is hover-only and out of the tab order; it is
    // not the control here.
    expect(document.querySelector('.MuiAutocomplete-clearIndicator')).toBeNull();
    await user.tab();
    const change = screen.getByRole('button', { name: 'Change customer' });
    expect(change).toHaveFocus();
    expect(change).toBeVisible();
    expect(change).not.toHaveAttribute('tabindex', '-1');

    await user.keyboard('{Enter}');
    expect(screen.getByTestId('picker-value')).toHaveTextContent('');
    expect(box()).toHaveValue('');
    expect(box()).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Change customer' })).toBeNull();
  });

  it('Escape on the box still puts a chosen record back', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), 'Layla');
    await user.click(await screen.findByRole('option', { name: 'Layla Haddad' }));
    await waitFor(() => expect(box()).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('picker-value')).toHaveTextContent('');
    expect(box()).toHaveValue('');
  });

  it('Escape clears what was typed', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), 'La');
    await screen.findByRole('option', { name: 'Layla Haddad' });
    await user.keyboard('{Escape}{Escape}');
    expect(box()).toHaveValue('');
  });

  it('a refused choice, then a record the caller sets, moves nobody (QA round three)', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    function Refusing() {
      const [candidate, setCandidate] = useState<Rec | null>(null);
      const [held, setHeld] = useState<Rec | null>(null);
      return (
        <>
          <EntityPicker<Rec>
            messages={en}
            label="Paying customer"
            value={held}
            onChange={(next) => {
              if (next !== null) setCandidate(next);
              else setHeld(null);
            }}
            labelOf={(row) => row.name}
            load={load}
            canSearch
            notPermitted="You may not look up customers."
            minLength={2}
            maxLength={40}
            placeholder=""
            example=""
            tooShort="Type at least two characters."
            resultsLabel="Matching customers"
            change="Change customer"
            testId="entity-picker"
          />
          <button type="button" disabled={candidate === null} onClick={() => setHeld(candidate)}>
            hand the record over
          </button>
        </>
      );
    }
    mount(<Refusing />);
    await user.type(box(), 'Layla');
    await user.click(await screen.findByRole('option', { name: 'Layla Haddad' }));

    const handOver = screen.getByRole('button', { name: 'hand the record over' });
    await waitFor(() => expect(handOver).toBeEnabled());
    await user.click(handOver);
    await waitFor(() => expect(box()).toHaveValue('Layla Haddad'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(box()).not.toHaveFocus();
    expect(handOver).toHaveFocus();
  });

  it('the adapter takes the same props under SearchPicker’s name', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    mount(<Harness load={load} adapted />);
    await user.type(box(), 'Layla');
    await user.click(await screen.findByRole('option', { name: 'Layla Haddad' }));
    expect(screen.getByTestId('picker-value')).toHaveTextContent(LAYLA.id);
  });
});

describe('errors belong to the field', () => {
  it('puts the caller’s refusal on the combobox, described and announced', () => {
    const load = vi.fn<Load>();
    mount(
      <>
        <p id="picker-note">Only customers of this branch are offered.</p>
        <Harness load={load} error="Choose the paying customer." describedBy="picker-note" />
      </>
    );
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(box()).toHaveAttribute('data-invalid', 'true');
    expect(box()).toHaveAccessibleDescription(
      expect.stringContaining('Only customers of this branch are offered.')
    );
    expect(box()).toHaveAccessibleDescription(
      expect.stringContaining('Choose the paying customer.')
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the paying customer.');
    const errorId = box().getAttribute('aria-errormessage');
    expect(errorId && document.getElementById(errorId)).toHaveTextContent(
      'Choose the paying customer.'
    );
  });

  it('marks nothing on a healthy field — the attribute is absent, not "false"', () => {
    mount(<Harness load={vi.fn<Load>()} />);
    expect(box()).not.toHaveAttribute('aria-invalid');
    expect(box()).not.toHaveAttribute('data-invalid');
    expect(box()).toHaveAccessibleDescription(
      expect.stringContaining('For example: Layla or 0791234567')
    );
  });

  it('marks the chosen record’s control when the choice itself is refused', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    const { rerender } = mount(<Harness load={load} />);
    await user.type(box(), 'Layla');
    await user.click(await screen.findByRole('option', { name: 'Layla Haddad' }));
    const messages = getMessages('en');
    rerender(
      <UiFoundationProvider locale="en" text={muiTextOf(messages)}>
        <Harness load={load} error="This customer cannot pay this invoice." />
      </UiFoundationProvider>
    );
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(box()).toHaveAccessibleDescription(
      expect.stringContaining('This customer cannot pay this invoice.')
    );
  });

  it('useFocusFirstInvalid lands on the picker after a refused submit', async () => {
    const load = vi.fn<Load>();
    const user = userEvent.setup();
    function RefusingForm() {
      const [state, setState] = useState<ActionState>({ status: 'idle' });
      const formRef = useFocusFirstInvalid(state);
      const error = state.fieldErrors?.['customer'] ? 'Choose the paying customer.' : undefined;
      return (
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            setState({
              status: 'invalid',
              fieldErrors: { customer: 'form.required' },
              attempt: (state.attempt ?? 0) + 1,
            });
          }}
        >
          <input aria-label="Reference" defaultValue="x" />
          <Harness load={load} error={error} />
          <button type="submit">Save</button>
        </form>
      );
    }
    mount(<RefusingForm />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(box()).toHaveFocus());
  });
});

describe('every non-answer reads as itself', () => {
  it.each([
    ['denied', 'state-refused', false],
    ['unavailable', 'state-unavailable', true],
    ['error', 'state-error', true],
    ['expired', 'state-expired', false],
  ] as const)('%s → %s (retry offered: %s)', async (status, testId, retry) => {
    const load = vi.fn<Load>().mockResolvedValue(refusedWith(status));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), 'La');
    const state = await screen.findByTestId(testId);
    const button = within(state).queryByRole('button', { name: en['state.retry'] });
    if (retry) {
      expect(button).not.toBeNull();
      await user.click(button as HTMLElement);
      await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    } else {
      expect(button).toBeNull();
    }
    expect(screen.queryByTestId('state-no-results')).toBeNull();
  });

  it('says "no matches" only after an answer with no rows', async () => {
    const reply = deferred<ReadState<CursorPage<Rec>>>();
    const load = vi.fn<Load>().mockReturnValue(reply.promise);
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), 'La');
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.queryByTestId('state-no-results')).toBeNull();
    reply.resolve(page([]));
    const none = await screen.findByTestId('state-no-results');
    expect(none).toHaveTextContent(en['state.noSearchMatches.title']);
    expect(none).toHaveTextContent(en['state.noSearchMatches.description']);
    expect(none).not.toHaveTextContent(en['state.noResults.description']);
  });

  it('without the read it offers no box and names the reason by id', () => {
    mount(<Harness load={vi.fn<Load>()} canSearch={false} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(document.getElementById('picker-unavailable')).toHaveTextContent(
      'You may not look up customers.'
    );
    expect(screen.queryByTestId('entity-picker-chosen')).toBeNull();
  });

  it('without the read it still shows the record it holds, read-only, before the reason', () => {
    const load = vi.fn<Load>();
    mount(<Harness load={load} canSearch={false} opened={OMAR} />);
    const chosen = screen.getByTestId('entity-picker-chosen');
    expect(chosen).toHaveTextContent('Omar Saleh');
    expect(screen.getByRole('group', { name: 'Paying customer' })).toContainElement(chosen);
    const reason = document.getElementById('picker-unavailable');
    expect(reason).toHaveTextContent('You may not look up customers.');
    // The held record comes first, then why it cannot be changed here.
    expect(
      chosen.compareDocumentPosition(reason as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Read-only: no box, no control to put it back, and no read.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change customer' })).toBeNull();
    expect(screen.getByTestId('entity-picker')).not.toHaveTextContent(OMAR.id);
    expect(load).not.toHaveBeenCalled();
  });

  it('announces loading once — in the state under the box, never again in the list', async () => {
    const reply = deferred<ReadState<CursorPage<Rec>>>();
    const load = vi.fn<Load>().mockReturnValue(reply.promise);
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await user.type(box(), 'La');
    await waitFor(() => expect(load).toHaveBeenCalled());

    const loading = await screen.findAllByText(en['state.loading']);
    expect(loading).toHaveLength(1);
    expect(screen.queryByText(en['mui.material.autocompleteLoading'])).toBeNull();
    expect(document.querySelector('.MuiAutocomplete-loading')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    // Exactly one live region carries it: no region nested inside another.
    const regions: Element[] = [];
    for (let node: Element | null = loading[0] ?? null; node !== null; node = node.parentElement) {
      if (node.getAttribute('aria-live') || node.getAttribute('role') === 'status') {
        regions.push(node);
      }
    }
    expect(regions).toHaveLength(1);

    reply.resolve(page([LAYLA]));
    expect(await screen.findByRole('option', { name: 'Layla Haddad' })).toBeInTheDocument();
    expect(screen.queryByText(en['state.loading'])).toBeNull();
  });
});

describe('the working context', () => {
  afterEach(() => forgetRememberedBranch());

  function inTwoBranches(ui: ReactElement) {
    return mount(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          {ui}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
  }

  it('a chosen record in a form that writes asks before a switch, and a discard forgets it', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    inTwoBranches(<Harness load={load} />);
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await user.type(box(), 'Layla');
    await user.click(await screen.findByRole('option', { name: 'Layla Haddad' }));

    const dialog = await switchExpectingQuestion(user, 'use second');
    await discardAndSwitch(user, dialog);
    await waitFor(() => expect(screen.getByTestId('picker-value')).toHaveTextContent(''));
    expect(box()).toHaveValue('');
  });

  it('a list filter forgets its choice without asking', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    inTwoBranches(<Harness load={load} countsAsUnsaved={false} />);
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await user.type(box(), 'Layla');
    await user.click(await screen.findByRole('option', { name: 'Layla Haddad' }));

    await switchWithoutQuestion(user, 'use second');
    await waitFor(() => expect(screen.getByTestId('picker-value')).toHaveTextContent(''));
  });

  it('forgets a typed term on a switch, and the next read is for the new branch', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    inTwoBranches(<Harness load={load} countsAsUnsaved={false} />);
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await user.type(box(), 'La');
    await screen.findByRole('option', { name: 'Layla Haddad' });

    await switchWithoutQuestion(user, 'use second');
    await waitFor(() => expect(box()).toHaveValue(''));
    expect(screen.queryByRole('option')).toBeNull();
  });

  function openedOn(load: Load) {
    // No remembered branch, so nothing moves the working context on mount and
    // the record the form opened with is still held when the case begins.
    window.localStorage.clear();
    return mount(
      inBranch(
        <>
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <Harness load={load} opened={OMAR} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
  }

  it('holding the record the form opened with is not unsaved work', async () => {
    const user = userEvent.setup();
    openedOn(vi.fn<Load>().mockResolvedValue(page([LAYLA])));
    expect(box()).toHaveValue('Omar Saleh');
    await switchWithoutQuestion(user, 'use second');
  });

  it('putting back the record a form opened with is a change, and asks', async () => {
    const user = userEvent.setup();
    openedOn(vi.fn<Load>().mockResolvedValue(page([LAYLA])));
    await user.click(screen.getByRole('button', { name: 'Change customer' }));
    expect(screen.getByTestId('picker-value')).toHaveTextContent('');
    await switchExpectingQuestion(user, 'use second');
  });
});

describe('both languages', () => {
  it('renders right to left in Arabic with the catalogue’s component texts', async () => {
    const load = vi.fn<Load>().mockResolvedValue(page([LAYLA]));
    const user = userEvent.setup();
    mount(<Harness load={load} locale="ar" />, 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      screen.getByRole('button', { name: ar['mui.material.autocompleteOpen'] })
    ).toBeInTheDocument();
    await user.type(box(), 'La');
    expect(await screen.findByRole('listbox', { name: 'Matching customers' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: ar['mui.material.autocompleteClose'] })
    ).toBeInTheDocument();
  });

  it('says loading and no matches in Arabic, once each, and no English leaks', async () => {
    const reply = deferred<ReadState<CursorPage<Rec>>>();
    const load = vi.fn<Load>().mockReturnValue(reply.promise);
    const user = userEvent.setup();
    mount(<Harness load={load} locale="ar" />, 'ar');
    await user.type(box(), 'La');
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(await screen.findAllByText(ar['state.loading'])).toHaveLength(1);

    reply.resolve(page([]));
    const none = await screen.findByTestId('state-no-results');
    expect(none).toHaveTextContent(ar['state.noSearchMatches.title']);
    expect(none).not.toHaveTextContent(ar['state.noResults.description']);
    expect(screen.queryByText(ar['state.loading'])).toBeNull();
    const shown = screen.getByTestId('entity-picker').textContent ?? '';
    for (const english of [
      en['state.loading'],
      en['mui.material.autocompleteLoading'],
      en['mui.material.autocompleteNoOptions'],
      'No options',
    ]) {
      expect(shown).not.toContain(english);
    }
  });

  it('the list’s own loading and no-options texts are the catalogue’s Arabic', () => {
    // The texts Material's list would show, from the theme the picker inherits.
    // The picker opens its list only on an answer with rows; these are what any
    // list under this theme says in the other two cases.
    mount(
      <>
        <Autocomplete
          open
          loading
          options={[]}
          renderInput={(params) => <TextField {...params} label="loading list" />}
        />
        <Autocomplete
          open
          options={[]}
          renderInput={(params) => <TextField {...params} label="empty list" />}
        />
      </>,
      'ar'
    );
    expect(screen.getByText(ar['mui.material.autocompleteLoading'])).toBeInTheDocument();
    expect(screen.getByText(ar['mui.material.autocompleteNoOptions'])).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText('No options')).toBeNull();
  });
});
