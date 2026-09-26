import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import {
  CHART_LABEL_FONT_SIZE,
  CHART_LABEL_TEXT_WIDTH,
  ChartPanel,
  barChartProps,
  countGutter,
  lineChartProps,
  OTHER_SLICE_KEY,
  otherSliceKey,
  PIE_MAX_SLICES,
  pieChartProps,
  pieSlices,
  type ChartCategory,
  type ChartPanelProps,
  type ChartSeries,
} from '@/components/charts/ChartPanel';
import { estimatedTextWidth, fitLabel } from '@/components/charts/label-fit';
import { MetricCard, type MetricValue } from '@/components/charts/MetricCard';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { REDUCED_MOTION_QUERY } from '@/components/ui-foundation/use-reduced-motion';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import {
  fitLabel as dashboardFitLabel,
  estimatedTextWidth as dashboardTextWidth,
} from '@/features/overview/components/charts';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { BOTH_DIRECTIONS, renderLtr, renderRtl } from './render';

/**
 * `MetricCard` and `ChartPanel` (ADR-022 PR1): a figure's four states kept
 * apart, and a chart that is also text — a named drawing, a table alternative,
 * a link per category — mirrored for Arabic, cut but never lost, with no count
 * clipped, colours from the token layer and no motion for anyone who asked for
 * none.
 *
 * jsdom lays nothing out, so the chart's geometry is asserted on what the panel
 * HANDS the chart (`barChartProps` and its siblings, which the panel spreads
 * unchanged), and how a browser draws it is confirmed by eye in browser QA.
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

const ARABIC_INDIC = /[٠-٩۰-۹]/;

describe('MetricCard: four statements that never look alike', () => {
  function card(metric: MetricValue, locale: Locale = 'en', timeZone = 'Asia/Amman') {
    const catalogue = getMessages(locale);
    return mount(
      <MetricCard
        messages={catalogue}
        locale={locale}
        label="Open placeholders"
        metric={metric}
        href="/en/gallery#open"
        linkLabel="Open the list"
        asOf="2026-09-22T06:30:00Z"
        timeZone={timeZone}
        testId="metric"
      />,
      locale
    );
  }

  /** The time and the clock's name, worked out here rather than borrowed from the card. */
  function stood(zone: string): string {
    const instant = new Date('2026-09-22T06:30:00Z');
    const when = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(instant);
    const name =
      new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(instant)
        .find((part) => part.type === 'timeZoneName')?.value ?? '';
    return `As it stood at ${when} (${name}).`;
  }

  it("writes when it was counted on the BRANCH's clock, naming the clock — not the browser's", () => {
    // Pacific/Kiritimati is UTC+14: 06:30 UTC is 20:30 there, a clock no test
    // machine keeps, so a card reading the browser's clock cannot pass.
    card({ status: 'ok', value: 5 }, 'en', 'Pacific/Kiritimati');
    const metric = screen.getByTestId('metric');
    expect(metric).toHaveTextContent(stood('Pacific/Kiritimati'));
    expect(metric).toHaveTextContent(/20:30 \(GMT\+14\)/);
    const browser = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' }).format(
      new Date('2026-09-22T06:30:00Z')
    );
    expect(metric.textContent ?? '').not.toContain(`${browser} (`);
  });

  it('writes the time on UTC, and says so, under "All my branches"', () => {
    card({ status: 'ok', value: 5 }, 'en', 'UTC');
    const metric = screen.getByTestId('metric');
    expect(metric).toHaveTextContent(stood('UTC'));
    expect(metric).toHaveTextContent(/06:30 \(GMT/);
  });

  it('draws a count as a number that links to its list, with when it was counted', () => {
    card({ status: 'ok', value: 1234 });
    const metric = screen.getByTestId('metric');
    expect(metric).toHaveAttribute('data-metric-state', 'value');
    expect(metric).toHaveTextContent('1,234');
    const link = within(metric).getByRole('link');
    expect(link).toHaveAttribute('href', '/en/gallery#open');
    expect(link).toHaveTextContent('Open the list');
    expect(metric).toHaveTextContent(/^.*As it stood at .+\..*$/);
  });

  it('draws ZERO as a count — a number and a link — not as an absence', () => {
    card({ status: 'ok', value: 0 });
    const metric = screen.getByTestId('metric');
    expect(metric).toHaveAttribute('data-metric-state', 'zero');
    expect(metric).toHaveTextContent('0');
    expect(within(metric).getByRole('link')).toHaveAttribute('href', '/en/gallery#open');
    expect(metric).not.toHaveTextContent(en['metric.unavailable']);
    expect(metric).not.toHaveTextContent(en['metric.withheld']);
  });

  it('withholds a figure from a reader who may not see it: no number, no link, no freshness', () => {
    card({ status: 'unauthorized' });
    const metric = screen.getByTestId('metric');
    expect(metric).toHaveAttribute('data-metric-state', 'unauthorized');
    expect(metric).toHaveTextContent(en['metric.withheld']);
    expect(metric).not.toHaveTextContent(/\d/);
    expect(within(metric).queryByRole('link')).toBeNull();
  });

  it('says a figure cannot be worked out — in different words from a withheld one', () => {
    card({ status: 'unavailable' });
    const metric = screen.getByTestId('metric');
    expect(metric).toHaveAttribute('data-metric-state', 'unavailable');
    expect(metric).toHaveTextContent(en['metric.unavailable']);
    expect(en['metric.unavailable']).not.toBe(en['metric.withheld']);
    expect(metric).not.toHaveTextContent(/\d/);
    expect(within(metric).queryByRole('link')).toBeNull();
  });

  it('announces a figure being read, with no number yet', () => {
    card({ status: 'loading' });
    const metric = screen.getByTestId('metric');
    expect(metric).toHaveAttribute('data-metric-state', 'loading');
    expect(within(metric).getByRole('status')).toHaveTextContent(en['metric.loading']);
    expect(metric).not.toHaveTextContent(/\d/);
    expect(within(metric).queryByRole('link')).toBeNull();
  });

  it('writes Latin digits in Arabic', () => {
    card({ status: 'ok', value: 1234 }, 'ar');
    const metric = screen.getByTestId('metric');
    expect(metric).toHaveTextContent(/1.?234/);
    expect(metric.textContent ?? '').not.toMatch(ARABIC_INDIC);
    expect(metric).toHaveTextContent(ar['metric.freshness'].split('{')[0]?.trim() ?? '');
  });

  it.each(BOTH_DIRECTIONS)('has no axe violations in %s', async (locale) => {
    const { container } = card({ status: 'ok', value: 7 }, locale);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});

const LONG_LABEL = 'Waiting for the customer to agree to the revised estimate';

const STATES: readonly ChartCategory[] = [
  { key: 'open', label: 'Open', href: '/en/work-orders?state=open' },
  { key: 'waiting', label: LONG_LABEL, href: '/en/work-orders?state=waiting' },
  {
    key: 'done',
    label: 'Done',
    note: 'finished',
    hatched: true,
    href: '/en/work-orders?state=done',
  },
];

const COUNTS: readonly ChartSeries[] = [
  { id: 'orders', label: 'Work orders', data: [12, 1234567, 3], tone: 'primary' },
];

function panel(overrides: Partial<ChartPanelProps> = {}, locale: Locale = 'en') {
  const catalogue = getMessages(locale);
  return mount(
    <ChartPanel
      messages={catalogue}
      locale={locale}
      title="Work orders by state"
      description="Every open work order, by the state it is in."
      summary="3 states, 1,234,582 work orders."
      kind="bar"
      layout="horizontal"
      categories={STATES}
      series={COUNTS}
      categoryHeader="State"
      linkHeader="Open the list"
      linkLabel={(category) => `Open the ${category.fullLabel ?? category.label} list`}
      emptyText="No work orders are open here."
      testId="chart"
      {...overrides}
    />,
    locale
  );
}

describe('ChartPanel: a drawing that is also text', () => {
  it('is a named, described drawing, laid out left to right', () => {
    panel();
    const drawing = screen.getByRole('img', { name: 'Work orders by state' });
    expect(drawing).toHaveAccessibleDescription('3 states, 1,234,582 work orders.');
    // A chart's text anchors are physical sides; see the anchoring rule.
    expect(drawing).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('region', { name: 'Work orders by state' })).toBe(
      screen.getByTestId('chart')
    );
  });

  it('keeps the table one button away, absent until asked for, with every figure and link', async () => {
    const user = userEvent.setup();
    panel();
    expect(screen.queryByRole('table')).toBeNull();
    const toggle = screen.getByRole('button', { name: en['chart.showTable'] });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const table = screen.getByRole('table', { name: 'Work orders by state' });
    expect(screen.getByRole('button', { name: en['chart.hideTable'] })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[2]).toHaveTextContent(LONG_LABEL);
    expect(rows[2]).toHaveTextContent('1,234,567');
    expect(rows[3]).toHaveTextContent('finished');
    expect(within(rows[2] as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/en/work-orders?state=waiting'
    );
    await user.click(screen.getByRole('button', { name: en['chart.hideTable'] }));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('can show the table always, with no disclosure', () => {
    panel({ tableMode: 'always' });
    expect(screen.getByRole('table', { name: 'Work orders by state' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en['chart.showTable'] })).toBeNull();
  });

  it('keeps an ordinary link per category beside the drawing, with the WHOLE label', () => {
    panel();
    const links = screen
      .getAllByRole('link')
      .filter((link) => link.closest('[role="img"]') === null);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/en/work-orders?state=open',
      '/en/work-orders?state=waiting',
      '/en/work-orders?state=done',
    ]);
    expect(links[1]).toHaveTextContent(`Open the ${LONG_LABEL} list`);
    expect(links[1]).toHaveTextContent('1,234,567');
  });

  it('defines the hatch the finished state is drawn with, and names it in the legend', () => {
    const { container } = panel();
    const pattern = container.querySelector('pattern');
    expect(pattern).not.toBeNull();
    const config = barChartProps({
      layout: 'horizontal',
      categories: STATES,
      series: COUNTS,
      locale: 'en',
      skipAnimation: false,
      hatchUrl: `url(#${pattern?.id ?? ''})`,
    });
    const axis = config.yAxis?.[0] as { colorMap?: { colors: readonly string[] } };
    expect(axis.colorMap?.colors).toEqual([
      'var(--color-primary)',
      'var(--color-primary)',
      `url(#${pattern?.id ?? ''})`,
    ]);
    expect(screen.getByText('Work orders', { selector: 'li' })).toBeInTheDocument();
  });

  it('records the direction it drew in: not mirrored in English', () => {
    panel({}, 'en');
    expect(screen.getByTestId('chart')).toHaveAttribute('data-axis-reversed', 'false');
  });

  it('records the mirrored direction in Arabic, with Latin digits in the figures', () => {
    panel({ title: 'أوامر العمل حسب الحالة', summary: 'ملخص', linkLabel: undefined }, 'ar');
    const chart = screen.getByTestId('chart');
    expect(chart).toHaveAttribute('data-axis-reversed', 'true');
    expect(chart.textContent ?? '').not.toMatch(ARABIC_INDIC);
  });

  it('turns the animation off for anybody who asked for less motion, and only then', () => {
    const original = window.matchMedia;
    const answer = (reduce: boolean) => (query: string) =>
      ({
        matches: reduce && query === REDUCED_MOTION_QUERY,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList;
    try {
      window.matchMedia = answer(true);
      const reduced = panel();
      expect(screen.getByTestId('chart')).toHaveAttribute('data-skip-animation', 'true');
      reduced.unmount();
      window.matchMedia = answer(false);
      panel();
      expect(screen.getByTestId('chart')).toHaveAttribute('data-skip-animation', 'false');
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('ChartPanel: states', () => {
  it('announces loading and draws nothing else', () => {
    panel({ state: 'loading' });
    expect(screen.getByTestId('chart-loading')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: en['chart.showTable'] })).toBeNull();
  });

  it('says withheld and unanswerable in two different sentences, with no figures', () => {
    const { unmount } = panel({ state: 'unauthorized' });
    expect(screen.getByRole('status')).toHaveTextContent(en['chart.withheld']);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    unmount();
    panel({ state: 'unavailable' });
    expect(screen.getByRole('status')).toHaveTextContent(en['chart.unavailable']);
    expect(en['chart.unavailable']).not.toBe(en['chart.withheld']);
    expect(screen.queryByRole('button', { name: en['chart.showTable'] })).toBeNull();
  });

  it('keeps every per-category link when the figures are zero: zero is an answer and still links', () => {
    panel({ series: [{ id: 'orders', label: 'Work orders', data: [0, 0, 0], tone: 'primary' }] });
    expect(screen.getByTestId('chart')).toHaveAttribute('data-chart-state', 'empty');
    const links = within(screen.getByTestId('chart-links')).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/en/work-orders?state=open',
      '/en/work-orders?state=waiting',
      '/en/work-orders?state=done',
    ]);
    for (const link of links) expect(link).toHaveTextContent(/0$/);
  });

  it('says so when every figure is zero, and still offers the table of zeros', () => {
    panel({ series: [{ id: 'orders', label: 'Work orders', data: [0, 0, 0], tone: 'primary' }] });
    expect(screen.getByTestId('chart')).toHaveAttribute('data-chart-state', 'empty');
    expect(screen.getByRole('status')).toHaveTextContent('No work orders are open here.');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: en['chart.showTable'] })).toBeInTheDocument();
  });

  it('offers no table when there is nothing at all to tabulate', () => {
    panel({ categories: [], series: [] });
    expect(screen.getByRole('status')).toHaveTextContent('No work orders are open here.');
    expect(screen.queryByRole('button', { name: en['chart.showTable'] })).toBeNull();
  });

  it.each(BOTH_DIRECTIONS)('has no axe violations in %s', async (locale) => {
    const { container } = panel({}, locale);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});

describe('legend swatches are painted like the drawing', () => {
  const TWO_LINES: readonly ChartSeries[] = [
    { id: 'opened', label: 'Opened', data: [1, 2, 3], tone: 'primary' },
    // Asked to be hatched — a line cannot be, so neither may its swatch.
    { id: 'closed', label: 'Closed', data: [0, 1, 2], tone: 'muted', hatched: true },
  ];

  it('draws a line swatch for a line, never a hatch, and defines no hatch at all', () => {
    const { container } = panel({ kind: 'line', series: TWO_LINES });
    const legend = screen.getByTestId('chart-legend');
    const swatches = [...legend.querySelectorAll('[data-swatch]')];
    expect(swatches.map((swatch) => swatch.getAttribute('data-swatch'))).toEqual(['line', 'line']);
    expect(swatches[1]?.querySelector('line')).toHaveAttribute('stroke', 'var(--color-text-muted)');
    expect(legend.innerHTML).not.toContain('url(#');
    expect(container.querySelector('pattern')).toBeNull();
  });

  it('paints a hatched bar series with the very hatch the bars use', () => {
    const { container } = panel({ kind: 'bar', layout: 'vertical', series: TWO_LINES });
    const pattern = container.querySelector('pattern');
    expect(pattern).not.toBeNull();
    const swatches = [...screen.getByTestId('chart-legend').querySelectorAll('[data-swatch]')];
    expect(swatches.map((swatch) => swatch.getAttribute('data-swatch'))).toEqual(['fill', 'hatch']);
    expect(swatches[0]?.querySelector('rect')).toHaveAttribute('fill', 'var(--color-primary)');
    expect(swatches[1]?.querySelector('rect')).toHaveAttribute(
      'fill',
      `url(#${pattern?.id ?? ''})`
    );
  });
});

describe('a pie is identifiable without colour', () => {
  const EIGHT: readonly ChartCategory[] = [
    'Brakes',
    'Tyres',
    'Engine',
    'Electrics',
    'Body',
    'Glass',
    'Air conditioning',
    'Inspection',
  ].map((label, index) => ({
    key: `k${String(index)}`,
    label,
    href: `/en/work-orders?kind=k${String(index)}`,
  }));
  const EIGHT_COUNTS: readonly ChartSeries[] = [
    { id: 'orders', label: 'Work orders', data: [8, 7, 6, 5, 4, 3, 2, 1], tone: 'primary' },
  ];

  it('numbers every slice and lists each number with its words and count; the tail is folded and named', () => {
    panel({
      kind: 'pie',
      categories: EIGHT,
      series: EIGHT_COUNTS,
      tableMode: 'always',
      summary: '8 kinds, 36 work orders.',
    });
    const legend = screen.getByTestId('chart-legend');
    expect(legend.tagName).toBe('OL');
    const items = within(legend).getAllByRole('listitem');
    expect(items).toHaveLength(PIE_MAX_SLICES);
    expect(items.map((item) => item.firstElementChild?.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(items.slice(0, 5).map((item) => item.querySelector('bdi')?.textContent)).toEqual([
      'Brakes',
      'Tyres',
      'Engine',
      'Electrics',
      'Body',
    ]);
    // The sixth slice is everything else, and says which categories it holds.
    expect(items[5]).toHaveAttribute('data-slice', OTHER_SLICE_KEY);
    expect(items[5]).toHaveTextContent('Everything else: Glass, Air conditioning, Inspection');
    expect(items[5]).toHaveTextContent(/6$/);
    // Every category is named in words somewhere a reader can find it without
    // telling a colour apart: the legend, and — one row each — the table and
    // the links.
    for (const category of EIGHT) {
      expect(legend).toHaveTextContent(category.label);
    }
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(EIGHT.length + 1);
    expect(within(screen.getByTestId('chart-links')).getAllByRole('link')).toHaveLength(
      EIGHT.length
    );
  });

  it('writes each slice NUMBER on the drawing, and gives six slices six distinct paints', () => {
    const input = {
      categories: EIGHT,
      series: EIGHT_COUNTS,
      locale: 'en' as const,
      skipAnimation: false,
      hatchUrl: 'url(#hatch)',
    };
    const config = pieChartProps(input);
    const pie = config.series[0] as {
      data: readonly { id: string; value: number; color: string }[];
      arcLabel: (item: { id: string; value: number }) => string;
    };
    expect(pie.data).toHaveLength(PIE_MAX_SLICES);
    expect(new Set(pie.data.map((slice) => slice.color)).size).toBe(PIE_MAX_SLICES);
    expect(pie.data.map((slice) => pie.arcLabel(slice))).toEqual(['1', '2', '3', '4', '5', '6']);
    // The folded slice counts the whole tail.
    expect(pie.data[5]?.value).toBe(3 + 2 + 1);
    // Six categories or fewer: no folding, one slice each.
    expect(pieSlices({ ...input, categories: EIGHT.slice(0, 6) })).toHaveLength(6);
    expect(
      pieSlices({ ...input, categories: EIGHT.slice(0, 6) }).some(
        (slice) => slice.key === OTHER_SLICE_KEY
      )
    ).toBe(false);
  });

  it('lists the folded names with the Arabic comma in Arabic, never a Latin comma', () => {
    panel(
      {
        kind: 'pie',
        categories: EIGHT,
        series: EIGHT_COUNTS,
        summary: '8 kinds, 36 work orders.',
      },
      'ar'
    );
    const items = within(screen.getByTestId('chart-legend')).getAllByRole('listitem');
    const folded = items[5]?.textContent ?? '';
    expect(folded).toContain('Glass، وAir conditioning، وInspection');
    expect(folded).not.toContain(', ');
    // English keeps its own comma.
    const english = pieSlices({
      categories: EIGHT,
      series: EIGHT_COUNTS,
      locale: 'en',
      skipAnimation: false,
      hatchUrl: 'url(#hatch)',
    });
    expect(english[5]?.label).toBe('Glass, Air conditioning, Inspection');
  });

  it('keeps a category keyed like the folded slice apart from the folded slice', () => {
    const clashing: readonly ChartCategory[] = EIGHT.map((category, index) =>
      index === 0 ? { ...category, key: OTHER_SLICE_KEY } : category
    );
    const slices = pieSlices({
      categories: clashing,
      series: EIGHT_COUNTS,
      locale: 'en',
      skipAnimation: false,
      hatchUrl: 'url(#hatch)',
    });
    expect(slices).toHaveLength(PIE_MAX_SLICES);
    expect(new Set(slices.map((slice) => slice.key)).size).toBe(PIE_MAX_SLICES);
    expect(slices[0]?.key).toBe(OTHER_SLICE_KEY);
    expect(slices[5]?.key).toBe(otherSliceKey(clashing));
    expect(slices[5]?.key).not.toBe(OTHER_SLICE_KEY);

    panel({
      kind: 'pie',
      categories: clashing,
      series: EIGHT_COUNTS,
      summary: '8 kinds, 36 work orders.',
    });
    const items = within(screen.getByTestId('chart-legend')).getAllByRole('listitem');
    expect(items).toHaveLength(PIE_MAX_SLICES);
    expect(items[0]).toHaveAttribute('data-slice', OTHER_SLICE_KEY);
    expect(items[0]?.querySelector('bdi')?.textContent).toBe('Brakes');
    expect(items[0]).toHaveTextContent(/8$/);
    expect(items[5]).not.toHaveAttribute('data-slice', OTHER_SLICE_KEY);
    expect(items[5]).toHaveTextContent('Everything else: Glass, Air conditioning, Inspection');
  });
});

describe('what the panel hands the chart', () => {
  const base = {
    categories: STATES,
    series: COUNTS,
    skipAnimation: false,
    hatchUrl: 'url(#hatch)',
  } as const;

  it('grows horizontal bars from the reading edge: reversed value axis and labels on the right in Arabic', () => {
    const arabic = barChartProps({ ...base, layout: 'horizontal', locale: 'ar' });
    const english = barChartProps({ ...base, layout: 'horizontal', locale: 'en' });
    expect((arabic.xAxis?.[0] as { reverse?: boolean }).reverse).toBe(true);
    expect((english.xAxis?.[0] as { reverse?: boolean }).reverse).toBe(false);
    expect((arabic.yAxis?.[0] as { position?: string }).position).toBe('right');
    expect((english.yAxis?.[0] as { position?: string }).position).toBe('left');
  });

  it('reverses the category axis of vertical bars and lines in Arabic, and stands the scale on the right', () => {
    for (const config of [
      barChartProps({ ...base, layout: 'vertical', locale: 'ar' }),
      lineChartProps({ ...base, locale: 'ar' }),
    ]) {
      expect((config.xAxis?.[0] as { reverse?: boolean }).reverse).toBe(true);
      expect((config.yAxis?.[0] as { position?: string }).position).toBe('right');
    }
    expect(
      (
        barChartProps({ ...base, layout: 'vertical', locale: 'en' }).xAxis?.[0] as {
          reverse?: boolean;
        }
      ).reverse
    ).toBe(false);
  });

  it('cuts a long tick label and keeps the whole wording for the tooltip', () => {
    const config = barChartProps({ ...base, layout: 'horizontal', locale: 'en' });
    const axis = config.yAxis?.[0] as {
      valueFormatter: (value: string, context: { location: string }) => string;
    };
    const tick = axis.valueFormatter('waiting', { location: 'tick' });
    expect(tick.endsWith('…')).toBe(true);
    expect(estimatedTextWidth(tick, CHART_LABEL_FONT_SIZE)).toBeLessThanOrEqual(
      CHART_LABEL_TEXT_WIDTH
    );
    expect(axis.valueFormatter('waiting', { location: 'tooltip' })).toBe(LONG_LABEL);
    // A short label is drawn whole, and a note is said in words.
    expect(axis.valueFormatter('open', { location: 'tick' })).toBe('Open');
    expect(axis.valueFormatter('done', { location: 'tooltip' })).toBe('Done — finished');
  });

  it('writes each count past its bar, and reserves the far margin for the widest one', () => {
    const english = barChartProps({ ...base, layout: 'horizontal', locale: 'en' });
    const arabic = barChartProps({ ...base, layout: 'horizontal', locale: 'ar' });
    const series = english.series[0] as {
      barLabelPlacement?: string;
      barLabel?: (item: { value: number | null }) => string;
    };
    expect(series.barLabelPlacement).toBe('outside');
    expect(series.barLabel?.({ value: 1234567 })).toBe('1,234,567');
    const needed = estimatedTextWidth('1,234,567', CHART_LABEL_FONT_SIZE);
    const margin = english.margin as { right: number };
    expect(margin.right).toBeGreaterThanOrEqual(needed);
    // The same gutter on the other side in Arabic, where bars grow leftwards.
    expect((arabic.margin as { left: number }).left).toBe(margin.right);
    // Never less than seven glyphs, even for small counts.
    expect(countGutter(['3'])).toBeGreaterThanOrEqual(64);
  });

  it('takes every colour from the token layer', () => {
    const all = [
      ...barChartProps({ ...base, layout: 'vertical', locale: 'en' }).series,
      ...lineChartProps({ ...base, locale: 'en' }).series,
      ...(pieChartProps({ ...base, locale: 'en' }).series[0]?.data ?? []),
    ].map((entry) => (entry as { color?: string }).color);
    expect(all.length).toBeGreaterThan(0);
    for (const colour of all) {
      expect(colour).toMatch(/^(var\(--color-[a-z-]+\)|url\(#hatch\))$/);
    }
  });

  it('passes the reduced-motion answer to the chart', () => {
    expect(
      barChartProps({ ...base, layout: 'horizontal', locale: 'en', skipAnimation: true })
        .skipAnimation
    ).toBe(true);
    expect(lineChartProps({ ...base, locale: 'en', skipAnimation: true }).skipAnimation).toBe(true);
    expect(pieChartProps({ ...base, locale: 'en', skipAnimation: true }).skipAnimation).toBe(true);
  });

  it('fits labels with the same budget as the dashboard charts', () => {
    expect(fitLabel(LONG_LABEL, CHART_LABEL_TEXT_WIDTH, CHART_LABEL_FONT_SIZE)).toBe(
      dashboardFitLabel(LONG_LABEL)
    );
    expect(estimatedTextWidth('MMM', 12)).toBe(dashboardTextWidth('MMM'));
  });
});

afterEach(() => {
  for (const style of document.head.querySelectorAll('style')) style.remove();
});
