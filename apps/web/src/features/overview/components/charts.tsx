'use client';

import { useId, useState, type ReactNode } from 'react';
import { EmptyState } from '@/components/states/States';
import { directionOf, type Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';
import { formatInteger } from '@/lib/format';

/**
 * The dashboard's three charts, drawn by hand.
 *
 * ## Why there is no charting library here
 *
 * A chart library is a dependency that ships a renderer, a tooltip layer and an
 * accessibility story this product would then have to audit, for three figures
 * that are a rectangle each. These are inline drawings: a `<svg>` with a
 * `<title>` and a `<desc>`, bars sized from the read, and the same numbers
 * written out underneath in a table anybody can open.
 *
 * ## A drawing is not a statement until it is also text
 *
 * Every chart below is `role="img"` and names its own title and description, so
 * a reader who cannot see it is told what it is and what it covers rather than
 * being handed a pile of unlabelled shapes. The FIGURES themselves live in the
 * table alternative, which is one button away and carries every row, every
 * count and every link the drawing has.
 *
 * Nothing is distinguished by colour alone. A finished state is drawn in a
 * different fill AND hatched AND said in words; the two series of the trend are
 * drawn solid and hatched AND named in the legend and in the table.
 *
 * ## Right-to-left is a coordinate decision, not a stylesheet one
 *
 * CSS logical properties do not reach inside a drawing: an `x` is an `x`. So
 * every bar and every label below is mirrored from the locale's direction, and
 * a bar in Arabic grows from the right edge towards the left exactly as the
 * text does.
 */

/** The drawing's own coordinate space. Scaled to the container by the browser. */
const WIDTH = 600;
const LABEL_WIDTH = 190;
const PLOT_WIDTH = WIDTH - LABEL_WIDTH - 10;
const ROW_HEIGHT = 26;

/** The hatch every "second meaning" is drawn with, so colour is never alone. */
function Hatch({ id }: { readonly id: string }) {
  return (
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
  );
}

/**
 * The frame every chart shares: a heading, the drawing, and the same figures
 * as a table one button away.
 *
 * The button is a disclosure and not a second copy of the page: the table is
 * absent from the document until it is asked for, so a screen reader does not
 * walk every row of a chart nobody opened.
 */
function ChartFrame({
  messages,
  title,
  description,
  children,
  table,
}: {
  readonly messages: Messages;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly table: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <section className="rounded-xl border border-border-subtle bg-surface p-4">
      <h3 className="text-section-title font-semibold text-text-heading">{title}</h3>
      <p className="mt-1 text-supporting text-text-secondary">{description}</p>
      <div className="mt-3">{children}</div>
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setShown((previous) => !previous)}
        className="mt-3 rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {translate(messages, shown ? 'dashboard.chart.hideTable' : 'dashboard.chart.showTable')}
      </button>
      {shown ? <div className="mt-3 overflow-x-auto">{table}</div> : null}
    </section>
  );
}

/** The table every chart falls back to. One shape, so all three read alike. */
function FigureTable({
  caption,
  headers,
  rows,
}: {
  readonly caption: string;
  readonly headers: readonly string[];
  readonly rows: readonly {
    readonly key: string;
    readonly cells: readonly ReactNode[];
  }[];
}) {
  return (
    <table className="w-full border-collapse text-body">
      <caption className="text-start text-supporting text-text-secondary">{caption}</caption>
      <thead>
        <tr>
          {headers.map((header) => (
            <th
              key={header}
              scope="col"
              className="border-b border-table-border px-2 py-1 text-start text-table-header font-semibold text-text-heading"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {row.cells.map((cell, index) => (
              <td
                // The column index is the only identity a cell has; the cells of
                // one row are not reordered and never keyed by content.
                key={`${row.key}:${String(index)}`}
                className="border-b border-table-border px-2 py-1 text-text-primary"
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface StateBarRow {
  readonly code: string;
  readonly label: string;
  readonly count: number;
  readonly isTerminal: boolean;
  readonly href: string;
}

/**
 * Work orders by state, as horizontal bars.
 *
 * Each bar is also a link to the board filtered to that state, so the answer to
 * "which ones?" is one click away. The link is repeated in the table below,
 * which is the one a keyboard and a screen reader use — a shape inside a drawing
 * is a poor target for both.
 */
export function StateBarChart({
  messages,
  locale,
  rows,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly rows: readonly StateBarRow[];
}) {
  const titleId = useId();
  const descriptionId = useId();
  const hatchId = useId();
  const rtl = directionOf(locale) === 'rtl';
  const title = translate(messages, 'dashboard.byState.title');
  const description = translate(messages, 'dashboard.byState.description');
  const finished = translate(messages, 'dashboard.byState.finished');

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const highest = rows.reduce((max, row) => (row.count > max ? row.count : max), 0);
  const height = Math.max(rows.length * ROW_HEIGHT, ROW_HEIGHT);

  const table = (
    <FigureTable
      caption={title}
      headers={[
        translate(messages, 'dashboard.byState.state'),
        translate(messages, 'dashboard.byState.count'),
        translate(messages, 'dashboard.byState.openTheList'),
      ]}
      rows={rows.map((row) => ({
        key: row.code,
        cells: [
          <span key="label">
            <bdi>{row.label}</bdi>
            {row.isTerminal ? (
              <span className="ms-1 text-caption text-text-muted">{finished}</span>
            ) : null}
          </span>,
          formatInteger(row.count, locale),
          <a
            key="link"
            href={row.href}
            className="text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {formatMessage(translate(messages, 'dashboard.byState.openStateList'), {
              state: row.label,
            })}
          </a>,
        ],
      }))}
    />
  );

  if (rows.length === 0 || total === 0) {
    return (
      <ChartFrame messages={messages} title={title} description={description} table={table}>
        <EmptyState messages={messages} titleKey="dashboard.byState.emptyTitle" />
      </ChartFrame>
    );
  }

  return (
    <ChartFrame messages={messages} title={title} description={description} table={table}>
      <svg
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
        width="100%"
        height={height}
        className="text-primary"
      >
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>
          {formatMessage(translate(messages, 'dashboard.byState.summary'), {
            states: formatInteger(rows.length, locale),
            total: formatInteger(total, locale),
          })}
        </desc>
        <Hatch id={hatchId} />
        {rows.map((row, index) => {
          const y = index * ROW_HEIGHT;
          const length = highest === 0 ? 0 : (row.count / highest) * PLOT_WIDTH;
          const barX = rtl ? WIDTH - LABEL_WIDTH - length : LABEL_WIDTH;
          const labelX = rtl ? WIDTH - 4 : 4;
          const countX = rtl ? WIDTH - LABEL_WIDTH - length - 6 : LABEL_WIDTH + length + 6;
          return (
            <g key={row.code}>
              <text
                x={labelX}
                y={y + 15}
                textAnchor={rtl ? 'end' : 'start'}
                fontSize={12}
                fill="currentColor"
                className="text-text-primary"
              >
                {row.isTerminal ? `${row.label} — ${finished}` : row.label}
              </text>
              <rect
                x={barX}
                y={y + 5}
                width={Math.max(length, 1)}
                height={12}
                rx={2}
                fill={row.isTerminal ? `url(#${hatchId})` : 'currentColor'}
                className={row.isTerminal ? 'text-text-muted' : 'text-primary'}
              />
              <text
                x={countX}
                y={y + 15}
                textAnchor={rtl ? 'end' : 'start'}
                fontSize={12}
                fill="currentColor"
                className="text-text-secondary"
              >
                {formatInteger(row.count, locale)}
              </text>
            </g>
          );
        })}
      </svg>
      {/*
        The keyboard's way in, and everybody else's second one.

        The bars themselves are not links. A shape inside a `role="img"` is
        pruned from the accessibility tree along with anything nested in it, so
        an anchor drawn there is reachable by a mouse and by nothing else —
        which is a control that exists for some readers and not others. The
        legend beside the drawing carries one ordinary link per state, in the
        same order, with the same count and the same destination, and it is
        always present rather than hidden behind the table's disclosure.
      */}
      <ul className="mt-3 flex flex-wrap gap-2">
        {rows.map((row) => (
          <li key={row.code}>
            <a
              href={row.href}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-caption text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <span
                aria-hidden="true"
                className={
                  row.isTerminal
                    ? 'inline-block h-3 w-3 rounded-sm border border-border-strong bg-surface-subtle'
                    : 'inline-block h-3 w-3 rounded-sm bg-primary'
                }
              />
              <bdi>{row.label}</bdi>
              {row.isTerminal ? <span className="text-text-muted">{finished}</span> : null}
              <span className="text-text-secondary">{formatInteger(row.count, locale)}</span>
            </a>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}

export interface TrendRow {
  readonly date: string;
  /** Short enough for an axis — the day within its month. */
  readonly label: string;
  /** The whole day, written out, for the table and for a reader. */
  readonly dayLabel: string;
  readonly opened: number;
  readonly completed: number;
}

/**
 * What was opened and what was finished, one pair of bars per day.
 *
 * `opened` counts WORK ORDERS opened, not visits received — the two are
 * different populations and the legend says which this is.
 */
export function TrendChart({
  messages,
  locale,
  rows,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly rows: readonly TrendRow[];
}) {
  const titleId = useId();
  const descriptionId = useId();
  const hatchId = useId();
  const rtl = directionOf(locale) === 'rtl';
  const title = translate(messages, 'dashboard.trend.title');
  const description = translate(messages, 'dashboard.trend.description');
  const openedLabel = translate(messages, 'dashboard.trend.opened');
  const completedLabel = translate(messages, 'dashboard.trend.completed');

  const height = 180;
  const plotTop = 10;
  const plotBottom = height - 28;
  const plotHeight = plotBottom - plotTop;
  const axisStart = rtl ? WIDTH - 34 : 34;
  const plotWidth = WIDTH - 40;
  const highest = rows.reduce((max, row) => Math.max(max, row.opened, row.completed), 0);
  const step = rows.length === 0 ? plotWidth : plotWidth / rows.length;
  const barWidth = Math.max(Math.min(step / 2 - 2, 14), 2);
  // At a quarter's width every day cannot carry a legible label, so one in
  // every few is drawn — and the table carries all of them.
  const labelEvery = Math.ceil(rows.length / 8) || 1;

  const table = (
    <FigureTable
      caption={title}
      headers={[translate(messages, 'dashboard.trend.day'), openedLabel, completedLabel]}
      rows={rows.map((row) => ({
        key: row.date,
        cells: [
          <bdi key="day">{row.dayLabel}</bdi>,
          formatInteger(row.opened, locale),
          formatInteger(row.completed, locale),
        ],
      }))}
    />
  );

  const empty = rows.length === 0 || rows.every((row) => row.opened === 0 && row.completed === 0);

  return (
    <ChartFrame messages={messages} title={title} description={description} table={table}>
      <p className="mb-2 flex flex-wrap items-center gap-4 text-caption text-text-secondary">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-primary" />
          {openedLabel}
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm border border-border-strong bg-surface-subtle"
          />
          {completedLabel}
        </span>
      </p>
      {empty ? (
        <EmptyState messages={messages} titleKey="dashboard.trend.emptyTitle" />
      ) : (
        <svg
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
          viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
          width="100%"
          height={height}
          className="text-primary"
        >
          <title id={titleId}>{title}</title>
          <desc id={descriptionId}>
            {formatMessage(translate(messages, 'dashboard.trend.summary'), {
              days: formatInteger(rows.length, locale),
              opened: formatInteger(
                rows.reduce((sum, row) => sum + row.opened, 0),
                locale
              ),
              completed: formatInteger(
                rows.reduce((sum, row) => sum + row.completed, 0),
                locale
              ),
            })}
          </desc>
          <Hatch id={hatchId} />
          {/* The baseline and the top of the scale, both written out. */}
          <line
            x1={rtl ? WIDTH - 34 : 34}
            y1={plotBottom}
            x2={rtl ? WIDTH - 34 - plotWidth : 34 + plotWidth}
            y2={plotBottom}
            stroke="currentColor"
            strokeWidth={1}
            className="text-border-strong"
          />
          <text
            x={rtl ? WIDTH - 4 : 4}
            y={plotTop + 8}
            textAnchor={rtl ? 'end' : 'start'}
            fontSize={11}
            fill="currentColor"
            className="text-text-secondary"
          >
            {formatInteger(highest, locale)}
          </text>
          <text
            x={rtl ? WIDTH - 4 : 4}
            y={plotBottom}
            textAnchor={rtl ? 'end' : 'start'}
            fontSize={11}
            fill="currentColor"
            className="text-text-secondary"
          >
            {formatInteger(0, locale)}
          </text>
          {rows.map((row, index) => {
            const slot = rtl ? axisStart - (index + 1) * step : axisStart + index * step;
            const openedHeight = highest === 0 ? 0 : (row.opened / highest) * plotHeight;
            const completedHeight = highest === 0 ? 0 : (row.completed / highest) * plotHeight;
            return (
              <g key={row.date}>
                <rect
                  x={slot + 1}
                  y={plotBottom - openedHeight}
                  width={barWidth}
                  height={Math.max(openedHeight, row.opened > 0 ? 1 : 0)}
                  fill="currentColor"
                  className="text-primary"
                />
                <rect
                  x={slot + barWidth + 3}
                  y={plotBottom - completedHeight}
                  width={barWidth}
                  height={Math.max(completedHeight, row.completed > 0 ? 1 : 0)}
                  fill={`url(#${hatchId})`}
                  stroke="currentColor"
                  strokeWidth={0.5}
                  className="text-text-secondary"
                />
                {index % labelEvery === 0 ? (
                  <text
                    x={slot + barWidth}
                    y={plotBottom + 14}
                    textAnchor="middle"
                    fontSize={10}
                    fill="currentColor"
                    className="text-text-secondary"
                  >
                    {row.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
    </ChartFrame>
  );
}

export interface WorkloadRow {
  readonly technicianId: string;
  readonly label: string;
  readonly activeCount: number;
}

/** How much work each technician is holding, as a bar per person. */
export function WorkloadChart({
  messages,
  locale,
  rows,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly rows: readonly WorkloadRow[];
}) {
  const titleId = useId();
  const descriptionId = useId();
  const rtl = directionOf(locale) === 'rtl';
  const title = translate(messages, 'dashboard.workload.title');
  const description = translate(messages, 'dashboard.workload.description');
  const countHeader = translate(messages, 'dashboard.workload.count');

  const highest = rows.reduce((max, row) => (row.activeCount > max ? row.activeCount : max), 0);
  const height = Math.max(rows.length * ROW_HEIGHT, ROW_HEIGHT);

  const table = (
    <FigureTable
      caption={title}
      headers={[translate(messages, 'dashboard.workload.technician'), countHeader]}
      rows={rows.map((row) => ({
        key: row.technicianId,
        cells: [<bdi key="name">{row.label}</bdi>, formatInteger(row.activeCount, locale)],
      }))}
    />
  );

  if (rows.length === 0) {
    return (
      <ChartFrame messages={messages} title={title} description={description} table={table}>
        <EmptyState messages={messages} titleKey="dashboard.workload.emptyTitle" />
      </ChartFrame>
    );
  }

  return (
    <ChartFrame messages={messages} title={title} description={description} table={table}>
      <svg
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
        width="100%"
        height={height}
        className="text-primary"
      >
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>
          {formatMessage(translate(messages, 'dashboard.workload.summary'), {
            people: formatInteger(rows.length, locale),
          })}
        </desc>
        {rows.map((row, index) => {
          const y = index * ROW_HEIGHT;
          const length = highest === 0 ? 0 : (row.activeCount / highest) * PLOT_WIDTH;
          const barX = rtl ? WIDTH - LABEL_WIDTH - length : LABEL_WIDTH;
          const labelX = rtl ? WIDTH - 4 : 4;
          const countX = rtl ? WIDTH - LABEL_WIDTH - length - 6 : LABEL_WIDTH + length + 6;
          return (
            <g key={row.technicianId}>
              <text
                x={labelX}
                y={y + 15}
                textAnchor={rtl ? 'end' : 'start'}
                fontSize={12}
                fill="currentColor"
                className="text-text-primary"
              >
                {row.label}
              </text>
              <rect
                x={barX}
                y={y + 5}
                width={Math.max(length, 1)}
                height={12}
                rx={2}
                fill="currentColor"
                className="text-primary"
              />
              <text
                x={countX}
                y={y + 15}
                textAnchor={rtl ? 'end' : 'start'}
                fontSize={12}
                fill="currentColor"
                className="text-text-secondary"
              >
                {formatInteger(row.activeCount, locale)}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}
