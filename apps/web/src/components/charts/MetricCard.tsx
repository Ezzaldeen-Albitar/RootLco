'use client';

import Link from 'next/link';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';
import { formatDateTime, formatInteger } from '@/lib/format';

/**
 * One figure, and the address of the rows behind it — ADR-022 PR1.
 *
 * ## Four statements that must never look alike
 *
 *   - **A count** — including ZERO. Zero is an answer: the platform counted and
 *     found none, so it is drawn as a number and still links to its list.
 *   - **Withheld** (`unauthorized`) — the platform could answer and this reader
 *     may not see it. No number, no link: a zero here would be a lie, and a
 *     link would open a list the reader cannot read.
 *   - **Unanswerable** (`unavailable`) — the platform cannot work the figure out
 *     yet. No number, no link, and a different sentence from the withheld one,
 *     because the next step differs: one is a question for a manager, the other
 *     is nobody's fault.
 *   - **Being read** (`loading`) — a placeholder shape, announced, and no
 *     number.
 *
 * `data-metric-state` names which one is drawn (`value`, `zero`,
 * `unauthorized`, `unavailable`, `loading`), so a test can tell them apart
 * without reading the words.
 *
 * ## The link is a claim
 *
 * `href` must open a list of exactly the set this figure counted — the same
 * predicate, period and branch scope. A related list is named as what it is
 * (`linkLabel`), never as "the list". Only a count is a link.
 *
 * ## Freshness
 *
 * `asOf` is when the figure was computed, shown under it, so a figure read ten
 * minutes ago is not taken for one read now.
 */

export type MetricValue =
  | { readonly status: 'ok'; readonly value: number }
  | { readonly status: 'unauthorized' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'loading' };

export interface MetricCardProps {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly label: string;
  readonly metric: MetricValue;
  /** The list this figure counted. Only a count links. */
  readonly href?: string | null | undefined;
  /** What the link says. Required with `href`. */
  readonly linkLabel?: string | undefined;
  /** When the figure was computed, an instant. */
  readonly asOf?: string | null | undefined;
  readonly testId?: string | undefined;
}

type DrawnState = 'value' | 'zero' | 'unauthorized' | 'unavailable' | 'loading';

function drawnState(metric: MetricValue): DrawnState {
  if (metric.status !== 'ok') return metric.status;
  return metric.value === 0 ? 'zero' : 'value';
}

export function MetricCard({
  messages,
  locale,
  label,
  metric,
  href,
  linkLabel,
  asOf,
  testId,
}: MetricCardProps) {
  const state = drawnState(metric);
  const freshness =
    asOf === null || asOf === undefined || metric.status !== 'ok'
      ? null
      : formatMessage(translate(messages, 'metric.freshness'), {
          when: formatDateTime(asOf, locale),
        });

  const body = (
    <CardContent className="flex flex-col gap-1">
      <Typography variant="body2" component="span" className="text-text-secondary">
        {label}
      </Typography>
      {metric.status === 'ok' ? (
        <Typography variant="h1" component="span" className="text-text-heading">
          {formatInteger(metric.value, locale)}
        </Typography>
      ) : metric.status === 'loading' ? (
        <span role="status" aria-live="polite">
          <span className="sr-only">{translate(messages, 'metric.loading')}</span>
          <Skeleton variant="text" aria-hidden="true" className="w-1/3" />
        </span>
      ) : (
        <Typography variant="body1" component="span" className="text-text-muted">
          {translate(
            messages,
            metric.status === 'unauthorized' ? 'metric.withheld' : 'metric.unavailable'
          )}
        </Typography>
      )}
      {freshness === null ? null : (
        <Typography variant="caption" component="span" className="text-text-muted">
          {freshness}
        </Typography>
      )}
      {metric.status === 'ok' && href && linkLabel ? (
        <Typography variant="caption" component="span" className="text-primary">
          {linkLabel}
        </Typography>
      ) : null}
    </CardContent>
  );

  return (
    <Card variant="outlined" data-metric-state={state} data-testid={testId}>
      {metric.status === 'ok' && href ? (
        <CardActionArea component={Link} href={href}>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  );
}
