'use client';

import type { ReactNode } from 'react';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ReadFailureStatus } from '@/lib/api/read-operation';
import { zoneDisplayName } from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';
import { formatReportTime, reportClock } from '../report-labels';

/**
 * The pieces both report screens share.
 *
 * The states are the SHARED ones. A screen that invented its own wording for a
 * refusal would be a second authority on what a refusal looks like, and the
 * wording is deliberately identical across this product: it names neither the
 * report nor the missing authority, because "you may not see this thing, which
 * exists" is itself a disclosure — and on this surface it would also be a way to
 * discover which report codes a workshop has configured.
 *
 * This file lives in `features/reports` rather than being imported from another
 * feature, because a feature does not import another feature. The delivery
 * screens hold their own copy of the same idea for the same reason.
 *
 * Since `P1-32-PRE-OD-REPA` (ADR-022) the states are the Material UI ones
 * (`MuiStates`), with the same catalogue entries: the same sentence for each
 * outcome, now with a retry where retrying can change the answer.
 */

/**
 * A read outcome other than success.
 *
 * Five outcomes, and each is a different sentence with a different action behind
 * it. Collapsing them was the defect `P1-27-QA-002` recorded: a caller who had
 * merely been rate-limited was told the system had broken, and an ended session
 * was told the same and handed a control that could not work.
 *
 * `denied` is what `ERR-IAM-001` becomes — the uniform refusal the run service
 * answers whether the caller may not run reports at all, may not read the rows
 * this dataset returns, or named a company and branch outside their own tenant.
 * `not-found` is what `ERR-RES-001` becomes — an unknown code, a draft, an
 * archived configuration, or a published one with no live version, all
 * deliberately indistinguishable. Nothing on this side tries to tell them apart.
 */
export function ReportFailure({
  messages,
  status,
  correlationId,
  locale,
  onRetry,
}: {
  readonly messages: Messages;
  readonly status: ReadFailureStatus;
  readonly correlationId: string | null;
  /** Only so an ended session can offer the way back to signing in. */
  readonly locale?: Locale | undefined;
  /**
   * Read again. Offered by the outage and the fault only — a refusal, an ended
   * session and an absent report are answered identically however often they
   * are asked (`MuiReadFailureState`).
   */
  readonly onRetry?: (() => void) | undefined;
}) {
  return (
    <MuiReadFailureState
      messages={messages}
      locale={locale}
      status={status}
      correlationId={correlationId}
      onRetry={onRetry}
    />
  );
}

/** The shared loading placeholder, so one screen cannot invent a second. */
export function ReportLoading({ messages }: { readonly messages: Messages }) {
  return <MuiLoadingState messages={messages} />;
}

/**
 * A machine name shown AS a machine name.
 *
 * A report code, a column key and a measure key are identifiers, not language.
 * When the catalogue holds no message for one, it is drawn monospaced and left to
 * right instead of being dropped into a heading as though somebody had written
 * it — the same position the work-order board takes on workshop-owned state
 * codes, and for the same reason.
 */
export function MachineName({ value }: { readonly value: string }) {
  return (
    <code className="break-all font-mono text-caption text-text-primary" dir="ltr">
      {value}
    </code>
  );
}

/** A labelled fact of the report's own context. */
export function ContextFact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-text-muted">{label}</span>
      <span className="text-body text-text-primary">{children}</span>
    </div>
  );
}

/**
 * A day or an instant of a report, written for reading on the reported
 * branch's clock (`formatReportTime`) with the value itself kept on the
 * `<time>` element.
 *
 * Where it is an instant and the branch's zone is not a clock this browser
 * knows, NO time is written: the plain "time not shown" words stand in its
 * place, marked `data-zone-unknown`. A time on UTC, or on the reader's clock,
 * would sit beside days counted on the branch's clock and read as one of them
 * (Owner decision D-17; `P1-32-PRE-OD-REPA-03`).
 */
export function ReportTime({
  messages,
  locale,
  zone,
  value,
  testId,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  /** The zone the period was resolved in: the reported branch's own. */
  readonly zone: string;
  readonly value: string;
  readonly testId?: string | undefined;
}) {
  const written = formatReportTime(value, locale, zone);
  if (written === null) {
    return (
      <span className="text-text-muted" lang={locale} data-testid={testId} data-zone-unknown="true">
        {translate(messages, 'reports.time.notShown')}
      </span>
    );
  }
  return (
    <time dateTime={value} data-testid={testId}>
      {written}
    </time>
  );
}

/**
 * The reported branch's zone, named for a reader with its offset
 * (`zoneDisplayName`) — or, for a zone this browser does not know, the plain
 * statement that it is not known here. The stored identifier is a
 * configuration value and is never the thing shown.
 */
export function ReportZoneName({
  messages,
  locale,
  zone,
  at,
  testId,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly zone: string;
  /** The instant whose offset is named. */
  readonly at: string;
  readonly testId?: string | undefined;
}) {
  if (reportClock(zone) === null) {
    return (
      <span lang={locale} data-testid={testId} data-zone-unknown="true">
        {translate(messages, 'reports.context.timezoneUnknown')}
      </span>
    );
  }
  return <bdi data-testid={testId}>{zoneDisplayName(zone, intlLocale(locale), at)}</bdi>;
}

/**
 * The sentence under a report's context facts: that days and times are on the
 * zone named above — or, where that zone is not a clock this browser knows,
 * that the times are not shown and why.
 */
export function ReportClockNote({
  messages,
  locale,
  zone,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly zone: string;
}) {
  return (
    <p className="text-caption text-text-muted" lang={locale}>
      {translate(
        messages,
        reportClock(zone) === null
          ? 'reports.context.zoneUnknownNote'
          : 'reports.context.periodNote'
      )}
    </p>
  );
}

export const REPORT_PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export const REPORT_SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

export const REPORT_TABLE_HEADER =
  'px-3 py-2 text-start text-table-header font-semibold uppercase tracking-wide text-table-header-text';

export const REPORT_TABLE_CELL = 'px-3 py-2 align-top text-body text-text-primary';
