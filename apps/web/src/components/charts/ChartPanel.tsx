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
import { translate } from '@/i18n/get-messages';
import { formatInteger } from '@/lib/format';
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
 *     well as coloured, and the legend and the table say it in words.
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

const TONE_SWATCH: Record<ChartTone, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  muted: 'bg-text-muted',
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

/** The pie chart's configuration: one slice per category, token colours in order. */
export function pieChartProps(input: Omit<BuildInput, 'layout'>): PieChartProps {
  const { categories, series, locale, skipAnimation, hatchUrl } = input;
  const only = series[0];
  return {
    series: [
      {
        id: only?.id ?? 'values',
        data: categories.map((category, index) => ({
          id: category.key,
          value: only?.data[index] ?? 0,
          label: wording(category),
          color: category.hatched
            ? hatchUrl
            : (SLICE_COLOURS[index % SLICE_COLOURS.length] as string),
        })),
        arcLabel: (item) => formatInteger(item.value, locale),
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
  const hatchedAnything =
    series.some((entry) => entry.hatched) || categories.some((category) => category.hatched);

  const drawing = () => {
    const input = { categories, series, locale, skipAnimation, hatchUrl };
    if (kind === 'pie') return <PieChart {...pieChartProps(input)} />;
    if (kind === 'line') return <LineChart {...lineChartProps(input)} />;
    return <BarChart {...barChartProps({ ...input, layout })} />;
  };

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
        <p role="status" className="text-body text-text-muted">
          {emptyText}
        </p>
      ) : (
        <>
          {hatchedAnything ? <HatchDefinition id={hatchId} /> : null}
          {series.length > 1 || hatchedAnything ? (
            <ul className="flex flex-wrap items-center gap-4 text-caption text-text-secondary">
              {series.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2">
                  <Swatch tone={entry.tone} hatched={entry.hatched === true} />
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
          {linked ? (
            <ul className="flex flex-wrap gap-2">
              {categories.map((category, index) =>
                category.href === undefined ? null : (
                  <li key={category.key}>
                    <Link
                      href={category.href}
                      className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-caption text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      <bdi>{linkText(category)}</bdi>
                      <span className="text-text-secondary">
                        {series
                          .map((entry) => formatInteger(entry.data[index] ?? 0, locale))
                          .join(' / ')}
                      </span>
                    </Link>
                  </li>
                )
              )}
            </ul>
          ) : null}
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

/** A legend swatch: the series' tone, or the hatch drawn as a bordered box. */
function Swatch({ tone, hatched }: { readonly tone: ChartTone; readonly hatched: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        hatched
          ? 'inline-block size-3 rounded-sm border border-border-strong bg-surface-subtle'
          : `inline-block size-3 rounded-sm ${TONE_SWATCH[tone]}`
      }
    />
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
