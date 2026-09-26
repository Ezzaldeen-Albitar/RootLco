import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import {
  FilterToolbar,
  type ToolbarFilter,
  type ToolbarPeriod,
} from '@/components/filters/FilterToolbar';
import {
  TODAY_PERIOD,
  checkCustomPeriod,
  daysCovered,
  periodDays,
  periodWindow,
  type PeriodFormat,
  type PeriodKind,
  type PeriodSelection,
  type PeriodWindow,
} from '@/components/filters/period';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest } from '@/lib/api/use-search-request';
import { BOTH_DIRECTIONS, renderLtr, renderRtl } from './render';

/**
 * `FilterToolbar` (ADR-022 PR1): one search box with `SearchBox`'s contract,
 * filter chips and selects, and a period on the BRANCH's clock whose bounds are
 * emitted in the format the screen's operation already reads.
 *
 * Zones: Asia/Amman keeps one offset all year; America/New_York moves to
 * daylight saving on 2026-03-08, so a period spanning that day starts and ends
 * on different offsets.
 */

const en = getMessages('en');
const ar = getMessages('ar');

function mount(ui: ReactElement, locale: Locale = 'en') {
  const catalogue = getMessages(locale);
  const renderIn = locale === 'ar' ? renderRtl : renderLtr;
  return renderIn(
    <UiFoundationProvider locale={locale} text={muiTextOf(catalogue)}>
      {ui}
    </UiFoundationProvider>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

const ALL_PRESETS: readonly PeriodKind[] = ['today', 'yesterday', 'last7', 'beforeToday', 'custom'];

function PeriodHost({
  zone,
  format,
  maxDays,
  onPeriod,
  locale = 'en',
}: {
  readonly zone: string;
  readonly format: PeriodFormat;
  readonly maxDays?: number;
  readonly onPeriod: (selection: PeriodSelection, window: PeriodWindow) => void;
  readonly locale?: Locale;
}) {
  const [value, setValue] = useState<PeriodSelection>(TODAY_PERIOD);
  const period: ToolbarPeriod = {
    presets: ALL_PRESETS,
    value,
    zone,
    format,
    maxDays,
    onChange: (selection, window) => {
      onPeriod(selection, window);
      setValue(selection);
    },
  };
  return <FilterToolbar messages={getMessages(locale)} label="Narrow the list" period={period} />;
}

/** Freezes the clock at an instant, for the Date object only. */
function freezeAt(instant: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
}

async function typeDay(user: ReturnType<typeof userEvent.setup>, label: string, digits: string) {
  const group = screen.getByRole('group', { name: new RegExp(`^${label}`) });
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard(digits);
  return group;
}

describe('the period presets', () => {
  it('are pressed buttons, one pressed at a time, Today first', () => {
    mount(<PeriodHost zone="Asia/Amman" format="days" onPeriod={vi.fn()} />);
    const group = screen.getByRole('group', { name: en['filters.period.legend'] });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Today',
      'Yesterday',
      'Last 7 days',
      'Before today',
      'Choose dates',
    ]);
    expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true')).toEqual([
      buttons[0],
    ]);
  });

  it('send calendar days on the branch clock to an operation that reads days', async () => {
    freezeAt('2026-09-21T22:30:00Z');
    const user = userEvent.setup();
    const onPeriod = vi.fn();
    mount(<PeriodHost zone="Asia/Amman" format="days" onPeriod={onPeriod} />);
    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    // 22:30 UTC on the 21st is already the 22nd in Amman: yesterday is the 21st.
    expect(onPeriod).toHaveBeenLastCalledWith(
      { kind: 'yesterday', from: '', to: '' },
      { from: '2026-09-21', to: '2026-09-21' }
    );
    expect(screen.getByRole('button', { name: 'Yesterday' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('send the first and LAST instant of each day, on the branch clock, to a board', async () => {
    freezeAt('2026-09-21T22:30:00Z');
    const user = userEvent.setup();
    const onPeriod = vi.fn();
    mount(<PeriodHost zone="Asia/Amman" format="instants" onPeriod={onPeriod} />);
    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(onPeriod).toHaveBeenLastCalledWith(
      { kind: 'yesterday', from: '', to: '' },
      { from: '2026-09-20T21:00:00.000Z', to: '2026-09-21T20:59:59.999Z' }
    );
  });

  it('name a different day on a different branch clock at the same instant', async () => {
    // The falsification of "whose clock": the same instant, another zone.
    freezeAt('2026-09-21T22:30:00Z');
    const user = userEvent.setup();
    const onPeriod = vi.fn();
    mount(<PeriodHost zone="America/New_York" format="instants" onPeriod={onPeriod} />);
    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(onPeriod).toHaveBeenLastCalledWith(
      { kind: 'yesterday', from: '', to: '' },
      { from: '2026-09-20T04:00:00.000Z', to: '2026-09-21T03:59:59.999Z' }
    );
  });

  it('cover seven days across a daylight-saving change, each end on its own offset', async () => {
    freezeAt('2026-03-10T15:00:00Z');
    const user = userEvent.setup();
    const onPeriod = vi.fn();
    mount(<PeriodHost zone="America/New_York" format="instants" onPeriod={onPeriod} />);
    await user.click(screen.getByRole('button', { name: 'Last 7 days' }));
    // 4 March starts on standard time (-05:00); 10 March ends on daylight time (-04:00).
    expect(onPeriod).toHaveBeenLastCalledWith(
      { kind: 'last7', from: '', to: '' },
      { from: '2026-03-04T05:00:00.000Z', to: '2026-03-11T03:59:59.999Z' }
    );
  });

  it('send only an upper bound for "Before today": the last instant of yesterday', async () => {
    freezeAt('2026-09-21T22:30:00Z');
    const user = userEvent.setup();
    const onPeriod = vi.fn();
    mount(<PeriodHost zone="Asia/Amman" format="instants" onPeriod={onPeriod} />);
    await user.click(screen.getByRole('button', { name: 'Before today' }));
    expect(onPeriod).toHaveBeenLastCalledWith(
      { kind: 'beforeToday', from: '', to: '' },
      { to: '2026-09-21T20:59:59.999Z' }
    );
  });
});

describe('a chosen period', () => {
  it('asks nothing until the two days are applied, and says the list has not changed', async () => {
    const user = userEvent.setup();
    const onPeriod = vi.fn();
    mount(<PeriodHost zone="Asia/Amman" format="days" onPeriod={onPeriod} />);
    await user.click(screen.getByRole('button', { name: 'Choose dates' }));
    expect(onPeriod).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: /^From/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^To/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The list still covers Today. Choose two dates and press Use these dates.'
    );
  });

  it('refuses a missing day on the box that is empty', async () => {
    const user = userEvent.setup();
    const onPeriod = vi.fn();
    mount(<PeriodHost zone="Asia/Amman" format="days" onPeriod={onPeriod} />);
    await user.click(screen.getByRole('button', { name: 'Choose dates' }));
    await typeDay(user, 'From', '01092026');
    await user.click(screen.getByRole('button', { name: 'Use these dates' }));
    expect(onPeriod).not.toHaveBeenCalled();
    const to = screen.getByRole('group', { name: /^To/ });
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('group', { name: /^From/ })).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose both dates.');
  });

  it('refuses a last day before the first, on the second box, and withdraws it once corrected', async () => {
    const user = userEvent.setup();
    const onPeriod = vi.fn();
    mount(<PeriodHost zone="Asia/Amman" format="days" onPeriod={onPeriod} />);
    await user.click(screen.getByRole('button', { name: 'Choose dates' }));
    await typeDay(user, 'From', '22092026');
    await typeDay(user, 'To', '20092026');
    await user.click(screen.getByRole('button', { name: 'Use these dates' }));
    expect(onPeriod).not.toHaveBeenCalled();
    const to = screen.getByRole('group', { name: /^To/ });
    expect(to).toHaveAttribute('aria-invalid', 'true');
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('The second date cannot be earlier than the first.');
    expect((to.getAttribute('aria-describedby') ?? '').split(' ')).toContain(error.id);

    await typeDay(user, 'To', '23092026');
    await waitFor(() => expect(to).not.toHaveAttribute('aria-invalid'));
    await user.click(screen.getByRole('button', { name: 'Use these dates' }));
    expect(onPeriod).toHaveBeenLastCalledWith(
      { kind: 'custom', from: '2026-09-22', to: '2026-09-23' },
      { from: '2026-09-22', to: '2026-09-23' }
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('refuses a period longer than the operation accepts, and only when it has a limit', async () => {
    const user = userEvent.setup();
    const limited = vi.fn();
    const { unmount } = mount(
      <PeriodHost zone="Asia/Amman" format="days" maxDays={92} onPeriod={limited} />
    );
    await user.click(screen.getByRole('button', { name: 'Choose dates' }));
    await typeDay(user, 'From', '01012026');
    await typeDay(user, 'To', '30062026');
    await user.click(screen.getByRole('button', { name: 'Use these dates' }));
    expect(limited).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a period of 92 days or fewer.');
    unmount();

    const unlimited = vi.fn();
    mount(<PeriodHost zone="Asia/Amman" format="days" onPeriod={unlimited} />);
    await user.click(screen.getByRole('button', { name: 'Choose dates' }));
    await typeDay(user, 'From', '01012026');
    await typeDay(user, 'To', '30062026');
    await user.click(screen.getByRole('button', { name: 'Use these dates' }));
    expect(unlimited).toHaveBeenCalledTimes(1);
  });

  it('sends a chosen pair as instants on the branch clock to a board', async () => {
    const user = userEvent.setup();
    const onPeriod = vi.fn();
    mount(<PeriodHost zone="America/New_York" format="instants" onPeriod={onPeriod} />);
    await user.click(screen.getByRole('button', { name: 'Choose dates' }));
    await typeDay(user, 'From', '07032026');
    await typeDay(user, 'To', '08032026');
    await user.click(screen.getByRole('button', { name: 'Use these dates' }));
    expect(onPeriod).toHaveBeenLastCalledWith(
      { kind: 'custom', from: '2026-03-07', to: '2026-03-08' },
      { from: '2026-03-07T05:00:00.000Z', to: '2026-03-09T03:59:59.999Z' }
    );
  });

  it('applies on Enter in a date box, like the button', async () => {
    const user = userEvent.setup();
    const onPeriod = vi.fn();
    mount(<PeriodHost zone="Asia/Amman" format="days" onPeriod={onPeriod} />);
    await user.click(screen.getByRole('button', { name: 'Choose dates' }));
    await typeDay(user, 'From', '01092026');
    await typeDay(user, 'To', '02092026');
    await user.keyboard('{Enter}');
    expect(onPeriod).toHaveBeenLastCalledWith(
      { kind: 'custom', from: '2026-09-01', to: '2026-09-02' },
      { from: '2026-09-01', to: '2026-09-02' }
    );
  });

  it('writes Latin digits and Arabic words in Arabic', async () => {
    const user = userEvent.setup();
    mount(<PeriodHost zone="Asia/Amman" format="days" onPeriod={vi.fn()} locale="ar" />, 'ar');
    expect(screen.getByRole('button', { name: ar['filters.period.last7'] })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: ar['filters.period.custom'] }));
    const from = await typeDay(user, ar['filters.period.from'], '22092026');
    const shown = (from.parentElement?.querySelector('input') as HTMLInputElement).value;
    expect(shown).toContain('22/09/2026');
    expect(shown).not.toMatch(/[٠-٩۰-۹]/);
  });
});

describe('the search box keeps the SearchBox contract', () => {
  function SearchHost({
    onTerm,
    onSubmit,
    onPeriod = vi.fn(),
    error,
  }: {
    readonly onTerm: (term: string) => void;
    readonly onSubmit?: () => void;
    readonly onPeriod?: (selection: PeriodSelection) => void;
    readonly error?: string;
  }) {
    const [term, setTerm] = useState('');
    const [value, setValue] = useState<PeriodSelection>(TODAY_PERIOD);
    return (
      <FilterToolbar
        messages={en}
        label="Narrow the list"
        search={{
          label: 'Find a visit',
          value: term,
          onChange: (next) => {
            onTerm(next);
            setTerm(next);
          },
          onSubmit,
          example: 'A plate or a phone number',
          error,
        }}
        period={{
          presets: ALL_PRESETS,
          value,
          zone: 'Asia/Amman',
          format: 'instants',
          onChange: (selection) => {
            onPeriod(selection);
            setValue(selection);
          },
        }}
      />
    );
  }

  let pushState: ReturnType<typeof vi.spyOn>;
  let replaceState: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    pushState = vi.spyOn(window.history, 'pushState');
    replaceState = vi.spyOn(window.history, 'replaceState');
  });
  afterEach(() => {
    pushState.mockRestore();
    replaceState.mockRestore();
  });

  it('reports what is typed, as typed, and never puts it in the address bar', async () => {
    const user = userEvent.setup();
    const onTerm = vi.fn();
    const before = window.location.href;
    mount(<SearchHost onTerm={onTerm} />);
    const box = screen.getByRole('searchbox', { name: 'Find a visit' });
    await user.type(box, 'علي ٠٧٩');
    expect(onTerm).toHaveBeenLastCalledWith('علي ٠٧٩');
    expect(box).toHaveValue('علي ٠٧٩');
    // SEC-002: a name or a phone number in a URL is in every history and log.
    expect(window.location.href).toBe(before);
    expect(window.location.href).not.toContain(encodeURIComponent('علي'));
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('asks at once on Enter, without submitting the toolbar (which applies dates)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onPeriod = vi.fn();
    mount(<SearchHost onTerm={vi.fn()} onSubmit={onSubmit} onPeriod={onPeriod} />);
    // Two valid days waiting to be applied: a submitted toolbar would apply them.
    await user.click(screen.getByRole('button', { name: 'Choose dates' }));
    await typeDay(user, 'From', '01092026');
    await typeDay(user, 'To', '02092026');
    await user.type(screen.getByRole('searchbox', { name: 'Find a visit' }), 'plate{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onPeriod).not.toHaveBeenCalled();
  });

  it('clears on Escape and on the clear control', async () => {
    const user = userEvent.setup();
    const onTerm = vi.fn();
    mount(<SearchHost onTerm={onTerm} />);
    const box = screen.getByRole('searchbox', { name: 'Find a visit' });
    await user.type(box, 'abc{Escape}');
    expect(box).toHaveValue('');
    await user.type(box, 'xyz');
    await user.click(screen.getByRole('button', { name: en['search.clear'] }));
    expect(box).toHaveValue('');
    expect(onTerm).toHaveBeenLastCalledWith('');
  });

  it('shows the example as a line of its own and marks the box when the term is refused', () => {
    mount(<SearchHost onTerm={vi.fn()} error="Type at least two characters." />);
    const box = screen.getByRole('searchbox', { name: 'Find a visit' });
    expect(box).toHaveAccessibleDescription(
      'A plate or a phone number Type at least two characters.'
    );
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAttribute('inputmode', 'text');
    expect(screen.getByRole('alert')).toHaveTextContent('Type at least two characters.');
  });

  it("leaves the pause to the screen's read hook: one read per pause, and Enter asks now", async () => {
    const user = userEvent.setup();
    const load = vi.fn<
      (
        criteria: { readonly term: string },
        cursor: string | null,
        signal: AbortSignal
      ) => Promise<ReadState<CursorPage<{ readonly id: string }>>>
    >(async () => ({
      status: 'ok',
      data: { items: [], nextCursor: null, hasMore: false },
      correlationId: null,
    }));
    function Board() {
      const [term, setTerm] = useState('');
      const search = useSearchRequest<{ readonly id: string }, { readonly term: string }>({
        criteria: term.length === 0 ? null : { term },
        load,
        debounceMs: 40,
      });
      return (
        <FilterToolbar
          messages={en}
          label="Narrow the list"
          search={{
            label: 'Find a visit',
            value: term,
            onChange: setTerm,
            onSubmit: search.submit,
          }}
        />
      );
    }
    mount(<Board />);
    await user.type(screen.getByRole('searchbox', { name: 'Find a visit' }), 'abc');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(load.mock.calls[0]?.[0]).toEqual({ term: 'abc' });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
});

describe('filters', () => {
  function FilterHost({ onStatus }: { readonly onStatus: (value: string) => void }) {
    const [status, setStatus] = useState('');
    const [kind, setKind] = useState('');
    const filters: ToolbarFilter[] = [
      {
        kind: 'chips',
        key: 'status',
        label: 'State',
        options: [
          { value: 'open', label: 'Open' },
          { value: 'closed', label: 'Closed' },
        ],
        value: status,
        onChange: (next) => {
          onStatus(next);
          setStatus(next);
        },
      },
      {
        kind: 'select',
        key: 'kind',
        label: 'Kind',
        options: [
          { value: 'service', label: 'Service' },
          { value: 'repair', label: 'Repair' },
        ],
        value: kind,
        onChange: setKind,
        placeholder: 'Any kind',
      },
    ];
    return <FilterToolbar messages={en} label="Narrow the list" filters={filters} />;
  }

  it('shows a small set whole as pressed chips, "All" first and pressed by default', async () => {
    const user = userEvent.setup();
    const onStatus = vi.fn();
    mount(<FilterHost onStatus={onStatus} />);
    const group = screen.getByRole('group', { name: 'State' });
    const chips = within(group).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual(['All', 'Open', 'Closed']);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(group).getByRole('button', { name: 'Closed' }));
    expect(onStatus).toHaveBeenLastCalledWith('closed');
    expect(within(group).getByRole('button', { name: 'Closed' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('uses a native select for a longer list', async () => {
    const user = userEvent.setup();
    mount(<FilterHost onStatus={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Kind' });
    expect(select.tagName).toBe('SELECT');
    await user.selectOptions(select, 'repair');
    expect(select).toHaveValue('repair');
  });
});

describe('the toolbar in both directions', () => {
  it.each(BOTH_DIRECTIONS)('is a named form with no axe violations in %s', async (locale) => {
    const catalogue = getMessages(locale);
    const { container } = mount(
      <FilterToolbar
        messages={catalogue}
        label={catalogue['filters.period.legend']}
        search={{ label: catalogue['search.submit'], value: '', onChange: vi.fn() }}
        filters={[
          {
            kind: 'chips',
            key: 'status',
            label: catalogue['filters.period.legend'],
            options: [{ value: 'today', label: catalogue['filters.period.today'] }],
            value: '',
            onChange: vi.fn(),
          },
        ]}
        period={{
          presets: ALL_PRESETS,
          value: TODAY_PERIOD,
          zone: 'Asia/Amman',
          format: 'days',
          onChange: vi.fn(),
        }}
      />,
      locale
    );
    expect(
      screen.getByRole('form', { name: catalogue['filters.period.legend'] })
    ).toBeInTheDocument();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});

describe('period arithmetic', () => {
  const now = new Date('2026-09-21T22:30:00Z');

  it('names the days of each preset on the zone it is given', () => {
    expect(periodDays({ kind: 'today', from: '', to: '' }, 'Asia/Amman', now)).toEqual({
      from: '2026-09-22',
      to: '2026-09-22',
    });
    expect(periodDays({ kind: 'today', from: '', to: '' }, 'America/New_York', now)).toEqual({
      from: '2026-09-21',
      to: '2026-09-21',
    });
    expect(periodDays({ kind: 'last7', from: '', to: '' }, 'Asia/Amman', now)).toEqual({
      from: '2026-09-16',
      to: '2026-09-22',
    });
    expect(periodDays({ kind: 'custom', from: '', to: '' }, 'Asia/Amman', now)).toEqual({});
  });

  it('turns days into closed instant bounds only for the instants format', () => {
    const custom: PeriodSelection = { kind: 'custom', from: '2026-09-01', to: '2026-09-02' };
    expect(periodWindow(custom, 'Asia/Amman', 'days', now)).toEqual({
      from: '2026-09-01',
      to: '2026-09-02',
    });
    expect(periodWindow(custom, 'Asia/Amman', 'instants', now)).toEqual({
      from: '2026-08-31T21:00:00.000Z',
      to: '2026-09-02T20:59:59.999Z',
    });
  });

  it('checks a chosen pair: both days, in order, within the limit', () => {
    expect(checkCustomPeriod('', '2026-09-02')).toEqual({ field: 'from', problem: 'incomplete' });
    expect(checkCustomPeriod('2026-09-01', '')).toEqual({ field: 'to', problem: 'incomplete' });
    expect(checkCustomPeriod('2026-09-02', '2026-09-01')).toEqual({
      field: 'to',
      problem: 'inverted',
    });
    expect(checkCustomPeriod('2026-01-01', '2026-04-03', 92)).toEqual({
      field: 'to',
      problem: 'tooLong',
      maxDays: 92,
    });
    // 92 days exactly is accepted: both ends are included.
    expect(daysCovered('2026-01-01', '2026-04-02')).toBe(92);
    expect(checkCustomPeriod('2026-01-01', '2026-04-02', 92)).toBeNull();
    expect(checkCustomPeriod('2026-09-01', '2026-09-01', 92)).toBeNull();
  });
});
