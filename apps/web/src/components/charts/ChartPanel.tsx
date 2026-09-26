'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { BarChart, type BarChartProps } from '@mui/x-charts/BarChart';
import { LineChart, type LineChartProps } from '@mui/x-charts/LineChart';
import { PieChart, type PieChartProps } from '@mui/x-charts/PieChart';
import { MuiLoadingState } from '@/components/states/MuiStates';
import { useReducedMotion } from '@/components/ui-foundation/use-reduced-motion';
import { directionOf, type Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';
import { formatInteger, intlLocale } from '@/lib/format';
import { LAYOUT_PX } from '@/styles/tokens/generated/tokens';
import { estimatedTextWidth, fitLabel } from './label-fit';

/**
 * A chart on MUI X Charts (MIT), with the promises the dashboard's hand-drawn
 * charts make — ADR-022 PR1. Built to redraw those three charts (`kind`,
 * `layout`, a per-category hatch, links per category) when the dashboard moves
 * (PR5); until then `features/overview/components/charts.tsx` stays.
 *
 * ## A drawing is not a statement until it is also text
 *
 *   - The drawing is `role="img"`, named by the panel's title and described by
 *     `summary` — what it covers, in a sentence — so a reader who cannot see it
 *     is told what it is rather than handed a pile of shapes.
 *   - The FIGURES live in a table alternative with every category, every count
 *     and every link: one button away (`tableMode="toggle"`, a disclosure; the
 *     table is absent until asked for, so a screen reader does not walk a chart
 *     nobody opened) or always shown (`"always"`).
 *   - Where a category opens a list (`href`), an ordinary link per category is
 *     ALWAYS present beside the drawing: a shape inside `role="img"` is pruned
 *     from the accessibility tree and cannot be a keyboard's target.
 *   - Nothing is told by colour alone: a series or a category may be HATCHED as
 *     well as coloured, and the legend and the table say it in words. A legend
 *     swatch is drawn with the very paint the drawing uses — a filled box for
 *     a bar, the hatch for a hatched bar, a line with its mark for a line (a
 *     line is never hatched, so neither is its swatch).
 *   - A per-category link stays when its figure is ZERO. Zero is an answer:
 *     the platform counted and found none, and the list it counted still opens
 *     (the same rule `MetricCard` follows). A ready chart whose every figure is
 *     zero says `emptyText` instead of drawing, and still offers the links.
 *
 * ## A pie is numbered, not only coloured
 *
 * Every slice carries a NUMBER on the drawing, and a legend beside it — always
 * shown for a pie — lists each number with its swatch, its words and its
 * count, so a slice is found by its number without telling any colour apart.
 * There are six distinct slice colours; a pie with more categories than that
 * draws the first five as they come and folds the rest into a sixth slice,
 * "Everything else", whose legend entry names every category folded into it.
 * The table and the per-category links keep the full breakdown, one row and
 * one link per category, folded or not. Folding rather than patterns: a
 * seventh pattern on a quarter-circle is not something a reader can match to a
 * swatch at 12 pixels, whereas a number is.
 *
 * ## Right to left is a coordinate decision
 *
 * MUI X Charts do not mirror themselves. In Arabic the category axis is
 * REVERSED (`reverse`), the value axis stands on the right, and horizontal bars
 * grow from the right edge towards the left, exactly as the text runs. The
 * drawing itself is `dir="ltr"`: a chart's text anchors mean physical sides,
 * and a `start` anchor inherited from `<html dir="rtl">` hangs a right-hand
 * label off the wrong side of its tick (the anchoring rule the hand-drawn
 * charts document). Labels keep their own reading order through
 * `unicode-bidi: plaintext`. `data-axis-reversed` records which way it drew.
 *
 * ## Labels are cut, never lost; counts are never clipped
 *
 * A category label that does not fit the label column is cut with an ellipsis
 * (`label-fit.ts`), and its whole text is in the tooltip, the links and the
 * table. A horizontal bar's count is written past its end, and the far margin
 * is reserved for the widest count drawn (at least seven glyphs), so the
 * longest bar's figure is never cut off at the drawing's edge.
 *
 * ## Colours and motion
 *
 * Colours are the token layer's custom properties only (`var(--color-…)`), so a
 * theme remap reaches the charts with everything else. Under "reduce motion"
 * the bars do not grow (`skipAnimation`); `data-skip-animation` records it.
 *
 * ## States
 *
 * `loading` is announced; `unauthorized` (withheld from this reader) and
 * `unavailable` (the platform cannot answer yet) are two different sentences
 * and draw nothing; a ready chart whose every figure is zero draws the caller's
 * `emptyText` instead of an empty frame, and still offers the table.
 */

export type ChartKind = 'bar' | 'line' | 'pie';
export type ChartTone = 'primary' | 'secondary' | 'muted';
export type ChartState = 'ready' | 'loading' | 'unavailable' | 'unauthorized';

export interface ChartCategory {
  /** Stable identity: a code, a date, an id. Never shown. */
  readonly key: string;
  /** What the axis shows — short enough for a tick, cut if it is not. */
  readonly label: string;
  /** The whole wording, for the tooltip, the table and the links. Defaults to `label`. */
  readonly fullLabel?: string | undefined;
  /** A second meaning said in words (for instance, a finished state). */
  readonly note?: string | undefined;
  /** Hatched as well as coloured, when the chart has one series. */
  readonly hatched?: boolean | undefined;
  /** The list this category's figure counted. */
  readonly href?: string | undefined;
}

export interface ChartSeries {
  readonly id: string;
  readonly label: string;
  /** One figure per category, in category order. */
  readonly data: readonly number[];
  readonly tone: ChartTone;
  /** Hatched as well as coloured, so two series never differ by colour alone. */
  readonly hatched?: boolean | undefined;
}

export interface ChartPanelProps {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly title: string;
  readonly description: string;
  /** One sentence saying what the drawing covers, for a reader who cannot see it. */
  readonly summary: string;
  readonly kind: ChartKind;
  /** Bars only: `horizontal` grows along the reading direction. */
  readonly layout?: 'horizontal' | 'vertical';
  readonly categories: readonly ChartCategory[];
  readonly series: readonly ChartSeries[];
  /** The table's first column heading. */
  readonly categoryHeader: string;
  /** The table's link column heading, when categories link. */
  readonly linkHeader?: string | undefined;
  /** What a category's link says. Defaults to its whole label. */
  readonly linkLabel?: ((category: ChartCategory) => string) | undefined;
  /** What a ready chart with nothing to draw says. */
  readonly emptyText: string;
  readonly state?: ChartState;
  readonly tableMode?: 'toggle' | 'always';
  readonly testId?: string | undefined;
}

/** The bar-label size, in drawing units. */
export const CHART_LABEL_FONT_SIZE = 12;
/** The label column of a horizontal bar chart, in drawing units. */
export const CHART_LABEL_COLUMN = 190;
/** What a label may occupy: the column less an inset each side. */
export const CHART_LABEL_TEXT_WIDTH = CHART_LABEL_COLUMN - 8;
/** The room reserved past the longest bar: at least seven glyphs ("999,999"). */
const COUNT_GUTTER = 64;
/** The space between a bar's end and its count. */
const COUNT_GAP = 6;
/** One horizontal bar's band, in drawing units. */
const BAR_BAND = 32;

const TONE_COLOUR: Record<ChartTone, string> = {
  primary: 'var(--color-primary)',
  secondary: 'var(--color-secondary)',
  muted: 'var(--color-text-muted)',
};

/** Pie slices, in order: every one a token, none invented. */
const SLICE_COLOURS = [
  'var(--color-primary)',
  'var(--color-secondary)',
  'var(--color-info)',
  'var(--color-warning)',
  'var(--color-success)',
  'var(--color-text-muted)',
] as const;

/** A label's own reading order inside a left-to-right drawing. */
const BIDI_ISOLATE = { unicodeBidi: 'plaintext' } as const;

function wording(category: ChartCategory): string {
  const whole = category.fullLabel ?? category.label;
  return category.note ? `${whole} — ${category.note}` : whole;
}

/** The margin past the longest bar: the widest count drawn, and never less than seven glyphs. */
export function countGutter(counts: readonly string[]): number {
  const widest = counts.reduce(
    (max, count) => Math.max(max, estimatedTextWidth(count, CHART_LABEL_FONT_SIZE)),
    0
  );
  return COUNT_GAP + Math.max(COUNT_GUTTER, Math.ceil(widest));
}

interface BuildInput {
  readonly layout: 'horizontal' | 'vertical';
  readonly categories: readonly ChartCategory[];
  readonly series: readonly ChartSeries[];
  readonly locale: Locale;
  readonly skipAnimation: boolean;
  readonly hatchUrl: string;
}

/** A series' fill: its tone, or the hatch. */
function seriesColour(series: ChartSeries, hatchUrl: string): string {
  return series.hatched ? hatchUrl : TONE_COLOUR[series.tone];
}

/**
 * The bar chart's configuration — exported so the direction, the gutter and
 * the motion rules are tested on what is handed to the chart, not on a layout
 * jsdom cannot perform.
 */
export function barChartProps(input: BuildInput): BarChartProps {
  const { layout, categories, series, locale, skipAnimation, hatchUrl } = input;
  const rtl = directionOf(locale) === 'rtl';
  const keys = categories.map((category) => category.key);
  const byKey = new Map(categories.map((category) => [category.key, category]));
  const full = (key: string) => {
    const category = byKey.get(key);
    return category === undefined ? key : wording(category);
  };
  const format = (value: number | null) => (value === null ? '' : formatInteger(value, locale));
  const counts = series.flatMap((entry) => entry.data.map((value) => formatInteger(value, locale)));
  const highest = series.reduce((max, entry) => Math.max(max, ...entry.data), 0);

  // One series may hatch individual categories (a finished state, say).
  const perCategory =
    series.length === 1 && categories.some((category) => category.hatched)
      ? {
          colorMap: {
            type: 'ordinal' as const,
            values: keys,
            colors: categories.map((category) =>
              category.hatched ? hatchUrl : TONE_COLOUR[(series[0] as ChartSeries).tone]
            ),
          },
        }
      : {};

  const bars = series.map((entry) => ({
    id: entry.id,
    label: entry.label,
    data: [...entry.data],
    color: seriesColour(entry, hatchUrl),
    valueFormatter: format,
    ...(layout === 'horizontal'
      ? {
          barLabel: (item: { value: number | null }) => format(item.value),
          barLabelPlacement: 'outside' as const,
        }
      : {}),
  }));

  if (layout === 'horizontal') {
    const gutter = countGutter(counts);
    return {
      layout: 'horizontal',
      series: bars,
      height: Math.max(categories.length, 1) * BAR_BAND,
      skipAnimation,
      hideLegend: true,
      margin: rtl ? { left: gutter, right: 0 } : { right: gutter, left: 0 },
      yAxis: [
        {
          id: 'categories',
          scaleType: 'band',
          data: keys,
          position: rtl ? 'right' : 'left',
          width: CHART_LABEL_COLUMN,
          tickLabelStyle: BIDI_ISOLATE,
          valueFormatter: (key: string, context) =>
            context.location === 'tick'
              ? fitLabel(full(key), CHART_LABEL_TEXT_WIDTH, CHART_LABEL_FONT_SIZE)
              : full(key),
          ...perCategory,
        },
      ],
      xAxis: [{ id: 'values', reverse: rtl, position: 'none', min: 0, max: Math.max(highest, 1) }],
    };
  }

  return {
    layout: 'vertical',
    series: bars,
    height: LAYOUT_PX['chart-height'],
    skipAnimation,
    hideLegend: true,
    xAxis: [
      {
        id: 'categories',
        scaleType: 'band',
        data: keys,
        reverse: rtl,
        tickLabelStyle: BIDI_ISOLATE,
        // At a quarter's width every day cannot carry a legible label; the
        // table carries all of them.
        tickLabelInterval: (_value: string, index: number) =>
          index % (Math.ceil(categories.length / 8) || 1) === 0,
        valueFormatter: (key: string, context) =>
          context.location === 'tick' ? (byKey.get(key)?.label ?? key) : full(key),
        ...perCategory,
      },
    ],
    yAxis: [
      {
        id: 'values',
        position: rtl ? 'right' : 'left',
        min: 0,
        tickMinStep: 1,
        width: countGutter([formatInteger(highest, locale)]) - COUNT_GAP,
        valueFormatter: (value: number) => formatInteger(value, locale),
      },
    ],
  };
}

/** The line chart's configuration, mirrored the same way. */
export function lineChartProps(input: Omit<BuildInput, 'layout'>): LineChartProps {
  const { categories, series, locale, skipAnimation } = input;
  const rtl = directionOf(locale) === 'rtl';
  const byKey = new Map(categories.map((category) => [category.key, category]));
  const highest = series.reduce((max, entry) => Math.max(max, ...entry.data), 0);
  return {
    series: series.map((entry) => ({
      id: entry.id,
      label: entry.label,
      data: [...entry.data],
      // A line cannot be hatched. Lines are told apart by their marks, the
      // legend beside the drawing and the table, never by colour alone.
      color: TONE_COLOUR[entry.tone],
      showMark: true,
      valueFormatter: (value: number | null) =>
        value === null ? '' : formatInteger(value, locale),
    })),
    height: LAYOUT_PX['chart-height'],
    skipAnimation,
    hideLegend: true,
    xAxis: [
      {
        id: 'categories',
        scaleType: 'point',
        data: categories.map((category) => category.key),
        reverse: rtl,
        tickLabelStyle: BIDI_ISOLATE,
        valueFormatter: (key: string, context) =>
          context.location === 'tick'
            ? (byKey.get(key)?.label ?? key)
            : (() => {
                const category = byKey.get(key);
                return category === undefined ? key : wording(category);
              })(),
      },
    ],
    yAxis: [
      {
        id: 'values',
        position: rtl ? 'right' : 'left',
        min: 0,
        tickMinStep: 1,
        width: countGutter([formatInteger(highest, locale)]) - COUNT_GAP,
        valueFormatter: (value: number) => formatInteger(value, locale),
      },
    ],
  };
}

/** The most slices a pie draws: one per distinct slice colour. */
export const PIE_MAX_SLICES = SLICE_COLOURS.length;

/**
 * The key of the slice the tail is folded into, while no category holds it.
 * A category may: keys come from the data. Then see `otherSliceKey`.
 */
export const OTHER_SLICE_KEY = '__other';

/**
 * The folded slice's key for these categories: `OTHER_SLICE_KEY`, lengthened
 * until no category holds it, so the folded slice never shares a key (and so a
 * legend line, a React key or a drawn arc) with a category.
 */
export function otherSliceKey(categories: readonly ChartCategory[]): string {
  const taken = new Set(categories.map((category) => category.key));
  let key = OTHER_SLICE_KEY;
  while (taken.has(key)) key = `${key}_`;
  return key;
}

/**
 * The categories' names as one list, joined the way the locale joins a list:
 * a Latin comma in English, the Arabic comma in Arabic.
 */
export function listedNames(members: readonly ChartCategory[], locale: Locale): string {
  return new Intl.ListFormat(intlLocale(locale), { type: 'unit', style: 'long' }).format(
    members.map((member) => wording(member))
  );
}

/** One slice as drawn and as listed in the legend. */
export interface PieSlice {
  readonly key: string;
  /** The number written on the slice and beside it in the legend. */
  readonly marker: string;
  /** The legend's words for it. */
  readonly label: string;
  readonly value: number;
  /** The paint: a slice colour token, or the hatch. */
  readonly colour: string;
  readonly hatched: boolean;
  /** The categories it stands for: one, or the folded tail. */
  readonly members: readonly ChartCategory[];
}

interface PieInput extends Omit<BuildInput, 'layout'> {
  /** The legend's words for the folded tail. Defaults to the names, joined. */
  readonly otherWording?: ((members: readonly ChartCategory[]) => string) | undefined;
}

/**
 * The slices a pie draws: one per category, in the order given, while there are
 * no more categories than distinct colours; otherwise the first
 * `PIE_MAX_SLICES - 1` and one slice for the rest. See the docblock.
 */
export function pieSlices(input: PieInput): readonly PieSlice[] {
  const { categories, series, locale, hatchUrl } = input;
  const only = series[0];
  const valueAt = (index: number) => only?.data[index] ?? 0;
  const folds = categories.length > PIE_MAX_SLICES;
  const kept = folds ? categories.slice(0, PIE_MAX_SLICES - 1) : categories;
  const slices: PieSlice[] = kept.map((category, index) => ({
    key: category.key,
    marker: formatInteger(index + 1, locale),
    label: wording(category),
    value: valueAt(index),
    colour: category.hatched ? hatchUrl : (SLICE_COLOURS[index] as string),
    hatched: category.hatched === true,
    members: [category],
  }));
  if (folds) {
    const tail = categories.slice(PIE_MAX_SLICES - 1);
    const otherWording = input.otherWording ?? ((members) => listedNames(members, locale));
    slices.push({
      key: otherSliceKey(categories),
      marker: formatInteger(PIE_MAX_SLICES, locale),
      label: otherWording(tail),
      value: tail.reduce((sum, _member, index) => sum + valueAt(PIE_MAX_SLICES - 1 + index), 0),
      colour: SLICE_COLOURS[PIE_MAX_SLICES - 1] as string,
      hatched: false,
      members: tail,
    });
  }
  return slices;
}

/** The pie chart's configuration: the slices above, each numbered on the drawing. */
export function pieChartProps(input: PieInput): PieChartProps {
  const { series, locale, skipAnimation } = input;
  const slices = pieSlices(input);
  const markers = new Map(slices.map((slice) => [slice.key, slice.marker]));
  return {
    series: [
      {
        id: series[0]?.id ?? 'values',
        data: slices.map((slice) => ({
          id: slice.key,
          value: slice.value,
          label: slice.label,
          color: slice.colour,
        })),
        // The slice's number, not its count: the number is what ties the slice
        // to its line in the legend without comparing colours.
        arcLabel: (item) => markers.get(String(item.id)) ?? '',
        arcLabelMinAngle: 0,
        valueFormatter: (item) => formatInteger(item.value, locale),
      },
    ],
    height: LAYOUT_PX['chart-height'],
    skipAnimation,
    hideLegend: true,
  };
}

export function ChartPanel({
  messages,
  locale,
  title,
  description,
  summary,
  kind,
  layout = 'vertical',
  categories,
  series,
  categoryHeader,
  linkHeader,
  linkLabel,
  emptyText,
  state = 'ready',
  tableMode = 'toggle',
  testId,
}: ChartPanelProps) {
  const base = useId();
  const titleId = `${base}-title`;
  const summaryId = `${base}-summary`;
  // A paint server is referenced by URL, and a URL fragment must be a plain name.
  const hatchId = `chart-hatch-${base.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const hatchUrl = `url(#${hatchId})`;
  const rtl = directionOf(locale) === 'rtl';
  const skipAnimation = useReducedMotion();
  const [tableShown, setTableShown] = useState(tableMode === 'always');

  const empty =
    categories.length === 0 || series.every((entry) => entry.data.every((value) => value === 0));
  const linked = categories.some((category) => category.href !== undefined);
  const linkText = (category: ChartCategory) => linkLabel?.(category) ?? wording(category);
  const showsFigures = state === 'ready';
  const otherWording = (members: readonly ChartCategory[]) =>
    formatMessage(translate(messages, 'chart.otherSlice'), {
      names: listedNames(members, locale),
    });
  const input = { categories, series, locale, skipAnimation, hatchUrl, otherWording };
  const slices = kind === 'pie' ? pieSlices(input) : [];
  // Only what the drawing actually hatches: a line never is, and a bar chart
  // hatches a category only when it has one series.
  const hatchedAnything =
    kind === 'line'
      ? false
      : kind === 'pie'
        ? slices.some((slice) => slice.hatched)
        : series.some((entry) => entry.hatched) ||
          (series.length === 1 && categories.some((category) => category.hatched));

  const drawing = () => {
    if (kind === 'pie') return <PieChart {...pieChartProps(input)} />;
    if (kind === 'line') return <LineChart {...lineChartProps(input)} />;
    return <BarChart {...barChartProps({ ...input, layout })} />;
  };

  const categoryLinks = linked ? (
    <ul className="flex flex-wrap gap-2" data-testid="chart-links">
      {categories.map((category, index) =>
        category.href === undefined ? null : (
          <li key={category.key}>
            <Link
              href={category.href}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-caption text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <bdi>{linkText(category)}</bdi>
              <span className="text-text-secondary">
                {series.map((entry) => formatInteger(entry.data[index] ?? 0, locale)).join(' / ')}
              </span>
            </Link>
          </li>
        )
      )}
    </ul>
  ) : null;

  return (
    <section
      aria-labelledby={titleId}
      data-testid={testId}
      data-chart-kind={kind}
      data-chart-state={state === 'ready' && empty ? 'empty' : state}
      data-axis-reversed={kind === 'pie' ? undefined : String(rtl)}
      data-skip-animation={String(skipAnimation)}
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <Typography id={titleId} variant="h3" component="h3" className="text-text-heading">
          {title}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {description}
        </Typography>
      </div>

      {state === 'loading' ? (
        <MuiLoadingState messages={messages} variant="inline" testId="chart-loading" />
      ) : state === 'unauthorized' || state === 'unavailable' ? (
        <p role="status" className="text-body text-text-muted">
          {translate(messages, state === 'unauthorized' ? 'chart.withheld' : 'chart.unavailable')}
        </p>
      ) : empty ? (
        <>
          <p role="status" className="text-body text-text-muted">
            {emptyText}
          </p>
          {categoryLinks}
        </>
      ) : (
        <>
          {hatchedAnything ? <HatchDefinition id={hatchId} /> : null}
          {kind === 'pie' ? (
            <ol
              className="flex flex-col gap-1 text-caption text-text-secondary"
              data-testid="chart-legend"
            >
              {slices.map((slice) => (
                <li key={slice.key} data-slice={slice.key} className="flex items-center gap-2">
                  <span className="min-w-4 font-semibold text-text-primary">{slice.marker}</span>
                  <Swatch shape={slice.hatched ? 'hatch' : 'fill'} paint={slice.colour} />
                  <bdi>{slice.label}</bdi>
                  <span className="text-text-muted">{formatInteger(slice.value, locale)}</span>
                </li>
              ))}
            </ol>
          ) : series.length > 1 || hatchedAnything ? (
            <ul
              className="flex flex-wrap items-center gap-4 text-caption text-text-secondary"
              data-testid="chart-legend"
            >
              {series.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2">
                  <Swatch
                    shape={kind === 'line' ? 'line' : entry.hatched ? 'hatch' : 'fill'}
                    paint={
                      kind === 'line' ? TONE_COLOUR[entry.tone] : seriesColour(entry, hatchUrl)
                    }
                  />
                  {entry.label}
                </li>
              ))}
            </ul>
          ) : null}
          <div
            role="img"
            aria-labelledby={titleId}
            aria-describedby={summaryId}
            dir="ltr"
            data-testid="chart-drawing"
          >
            {drawing()}
          </div>
          <p id={summaryId} className="sr-only">
            {summary}
          </p>
          {categoryLinks}
        </>
      )}

      {showsFigures && categories.length > 0 ? (
        <div className="flex flex-col gap-3">
          {tableMode === 'toggle' ? (
            <div>
              <Button
                variant="outlined"
                size="small"
                aria-expanded={tableShown}
                onClick={() => setTableShown((shown) => !shown)}
              >
                {translate(messages, tableShown ? 'chart.hideTable' : 'chart.showTable')}
              </Button>
            </div>
          ) : null}
          {tableShown ? (
            <div className="overflow-x-auto">
              <Table size="small">
                <caption className="text-start text-supporting text-text-secondary">
                  {title}
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell component="th" scope="col">
                      {categoryHeader}
                    </TableCell>
                    {series.map((entry) => (
                      <TableCell key={entry.id} component="th" scope="col" className="text-end">
                        {entry.label}
                      </TableCell>
                    ))}
                    {linked && linkHeader ? (
                      <TableCell component="th" scope="col">
                        {linkHeader}
                      </TableCell>
                    ) : null}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {categories.map((category, index) => (
                    <TableRow key={category.key}>
                      <TableCell component="th" scope="row">
                        <bdi>{category.fullLabel ?? category.label}</bdi>
                        {category.note ? (
                          <span className="ms-1 text-caption text-text-muted">{category.note}</span>
                        ) : null}
                      </TableCell>
                      {series.map((entry) => (
                        <TableCell key={entry.id} className="text-end">
                          {formatInteger(entry.data[index] ?? 0, locale)}
                        </TableCell>
                      ))}
                      {linked && linkHeader ? (
                        <TableCell>
                          {category.href === undefined ? null : (
                            <Link
                              href={category.href}
                              className="text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                            >
                              {linkText(category)}
                            </Link>
                          )}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A legend swatch, painted with exactly what the drawing is painted with: a box
 * filled with the colour or the hatch (`paint` is the same `var(--color-…)` or
 * `url(#…)` the chart receives), or — for a line — a stroke with its mark.
 * `data-swatch` names the shape, so a test can tell them apart.
 */
function Swatch({
  shape,
  paint,
}: {
  readonly shape: 'fill' | 'hatch' | 'line';
  readonly paint: string;
}) {
  if (shape === 'line') {
    return (
      <svg aria-hidden="true" focusable="false" width={16} height={12} data-swatch="line">
        <line x1={0} y1={6} x2={16} y2={6} stroke={paint} strokeWidth={2} />
        <circle cx={8} cy={6} r={3} fill={paint} />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" focusable="false" width={12} height={12} data-swatch={shape}>
      <rect width={12} height={12} rx={2} fill={paint} />
    </svg>
  );
}

/**
 * The hatch every "second meaning" is drawn with, defined once beside the chart.
 * A paint server may be referenced from any drawing in the same document, so
 * the chart's bars use `url(#id)` for it; `currentColor` inside it takes this
 * element's text colour.
 */
function HatchDefinition({ id }: { readonly id: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      className="absolute text-text-secondary"
    >
      <defs>
        <pattern
          id={id}
          width={6}
          height={6}
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <rect width={6} height={6} fill="currentColor" opacity={0.18} />
          <line x1={0} y1={0} x2={0} y2={6} stroke="currentColor" strokeWidth={3} />
        </pattern>
      </defs>
    </svg>
  );
}
