'use client';

import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import {
  ChartPanel,
  type ChartCategory,
  type ChartSeries,
  type ChartState,
} from '@/components/charts/ChartPanel';
import { MetricCard, type MetricValue } from '@/components/charts/MetricCard';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import {
  TODAY_PERIOD,
  dashboardPeriodRequest,
  type PeriodSelection,
} from '@/components/filters/period';
import {
  MuiErrorState,
  MuiExpiredState,
  MuiLoadingState,
  MuiRefusedState,
  MuiUnavailableState,
} from '@/components/states/MuiStates';
import { RequiresConcreteBranch } from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import {
  workOrderStateLabel,
  type WorkOrderStateCatalogueEntry,
} from '@/features/work-orders/work-orders-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import type { BranchScope, ReadState } from '@/lib/api/read-operation';
import { UNANSWERED_READ, settleRead } from '@/lib/api/use-search-request';
import { formatDayInZone, formatInZone, zoneLabelAt } from '@/lib/branch-time';
import { formatInteger, intlLocale } from '@/lib/format';
import { readDashboardSummaryCancellable } from '../dashboard-summary-read';
import {
  attentionAreaLink,
  receptionsPeriodLink,
  workOrdersStateLink,
  workOrdersViewLink,
} from '../dashboard-links';
import {
  DASHBOARD_PERIODS,
  type DashboardSection,
  type DashboardSummary,
} from '../overview-contract';

/**
 * The dashboard: what this branch is holding, right now (Owner directive,
 * `P1-32-PRE-OD-UX`), on the Material UI wrappers (ADR-022): the period is
 * `FilterToolbar`'s, the seven figures are `MetricCard`s, the three charts are
 * `ChartPanel`s and the read states are `MuiStates`.
 *
 * ## One read, and every figure on the screen comes out of it
 *
 * `ovw.dashboard-summary-read` computes each figure as an aggregate over the
 * whole scoped selection inside the authorized transaction. This screen issues
 * it once per working branch and period, and draws nothing it did not receive:
 * no figure is summed here, no percentage is derived, and no board's page is
 * counted to stand in for a set. (A chart's one-sentence description adds up
 * the figures it draws, for a reader who cannot see the bars.)
 *
 * ## A withheld figure is not a zero
 *
 * Every section carries its own state. `unauthorized` means the reader may not
 * see that part of the workshop, and the card or chart says so — printing `0`
 * would be a false statement about the workshop instead of a true one about the
 * reader. `unavailable` means the platform cannot answer the question at all.
 *
 * ## Lateness is not shown, because the platform does not record it
 *
 * The summary publishes `overdue` as permanently unanswerable: a work order
 * records when it was opened and not when it was promised. Nothing on this
 * screen counts, colours or sorts by lateness, and there is no card for it.
 *
 * ## A branch switch must not repaint the previous branch's figures
 *
 * The answer is filed under the key it was read for — branch, period and the
 * working context's version — and a held answer whose key no longer matches is
 * not rendered at all. That is decided during render rather than cleared from an
 * effect, so there is no frame in which one branch's numbers sit under another
 * branch's heading.
 *
 * ## Whose clock
 *
 * The days a period covers are the server's: it cuts them on the clock of the
 * first branch of the set it resolved, and says which (`period.timezone`) — for
 * one branch, that branch's clock. Under "All my branches" the covering line
 * says the days follow one branch's clock. When the figures were taken is
 * written on the working branch's clock, and on UTC under "All my branches",
 * with the clock named either way — never the laptop's (the rule `MetricCard`
 * follows).
 */

/** One figure, with the address of the rows behind it. */
interface FigureCard {
  readonly id: string;
  readonly labelKey: string;
  readonly section: DashboardSection<number>;
  /** `null` when no list on this product can be narrowed the way this counted. */
  readonly href: string | null;
  /**
   * What the link says. `dashboard.card.openTheList` is a CLAIM — that the page
   * behind it lists exactly the set this figure counted, under the same
   * predicate, period and branch scope — and only a card for which that is true
   * may use it. A card whose destination is related but not identical names the
   * destination instead.
   */
  readonly linkLabelKey: string;
}

const OPEN_THE_LIST = 'dashboard.card.openTheList';

/** The longest period the operation accepts: a calendar quarter's worst case. */
const MAX_PERIOD_DAYS = 92;

/** A figure's section, as the card draws it. */
function metricOf(section: DashboardSection<number>): MetricValue {
  if (section.status === 'ok') return { status: 'ok', value: section.value };
  return { status: section.status };
}

/** A chart's section, as the panel draws it. */
function chartStateOf(section: DashboardSection<unknown>): ChartState {
  return section.status === 'ok' ? 'ready' : section.status;
}

export function DashboardScreen({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();
  const t = (key: keyof Messages) => translate(messages, key);

  const [period, setPeriod] = useState<PeriodSelection>(TODAY_PERIOD);
  /** Bumped by the refresh control and the retry. Part of the key, so it re-reads. */
  const [asAt, setAsAt] = useState(0);
  const refresh = () => {
    setAsAt((previous) => previous + 1);
  };

  const scope: BranchScope | null =
    branch.kind === 'ready'
      ? { companyId: branch.target.companyId, branchId: branch.target.branchId }
      : branch.kind === 'all' && context.selection?.companyId
        ? { companyId: context.selection.companyId, branchId: null }
        : null;

  // The toolbar only ever hands over a period the dashboard names, and a chosen
  // one only with both days — so this is `null` only if that ever stops being so.
  const request = dashboardPeriodRequest(period);

  /*
   * The one key everything is filed under, and the inputs it is built from.
   *
   * Every part is a primitive: branch, period, the two chosen days, the
   * working-context version and the refresh counter. The effect below depends on
   * those primitives rather than on a rebuilt request object, so a render that
   * changes nothing asks for nothing — and a change to any of them makes the
   * held answer unrenderable in the same render it changed in.
   */
  const companyId = scope?.companyId ?? null;
  const branchId = scope?.branchId ?? null;
  const periodKind = scope === null || request === null ? null : request.period;
  const askedFrom = request?.period === 'custom' ? request.from : '';
  const askedTo = request?.period === 'custom' ? request.to : '';
  const version = context.version;
  const key =
    companyId === null || periodKind === null
      ? null
      : [
          companyId,
          branchId ?? '',
          periodKind,
          askedFrom,
          askedTo,
          String(version),
          String(asAt),
        ].join('|');

  const [held, setHeld] = useState<{
    readonly key: string;
    readonly read: ReadState<DashboardSummary>;
  } | null>(null);

  const signal = context.signal;
  useEffect(() => {
    if (key === null || companyId === null || periodKind === null) return undefined;
    let live = true;
    const criteria =
      periodKind === 'custom'
        ? { period: periodKind, from: askedFrom, to: askedTo }
        : { period: periodKind };
    /*
     * Settled, never left hanging. A refresh whose call REJECTED — the web tier
     * answering 503, the connection dropping — used to leave the held answer
     * where the new key could not match it, so the figures vanished and the
     * header read "Reading the figures" for good, with no sentence and no retry
     * (browser QA part 7, row 7.4). `settleRead` turns a rejection, and a read
     * that outlives the client ceiling, into `unavailable`, which renders the
     * outage and its Try again.
     */
    /*
     * This read's own controller, aborted when the effect is torn down — a new
     * period, a refresh, leaving the screen — AND when the working context's
     * signal aborts on a branch change. The read is cancellable
     * (P1-32-PRE-OD-READ), so either one now stops the request rather than
     * only discarding its answer.
     */
    const controller = new AbortController();
    const onContextAbort = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onContextAbort, { once: true });
    void settleRead<ReadState<DashboardSummary>>(
      () => readDashboardSummaryCancellable({ companyId, branchId }, criteria, controller.signal),
      UNANSWERED_READ,
      { signal: controller.signal }
    ).then((read) => {
      // Two guards, and they answer different questions: `live` is "this effect
      // is still the current one", `signal.aborted` is "the branch has moved on
      // since this was asked". Either way the request was cancelled and its
      // settled placeholder is not an answer to show.
      if (live && !signal.aborted) setHeld({ key, read });
    });
    return () => {
      live = false;
      signal.removeEventListener('abort', onContextAbort);
      controller.abort();
    };
  }, [key, companyId, branchId, periodKind, askedFrom, askedTo, signal]);

  const answer = held !== null && key !== null && held.key === key ? held.read : null;
  const summary = answer !== null && answer.status === 'ok' ? answer.data : null;

  /** The working branch's clock, when one branch is in force. */
  const workingZone =
    branch.kind === 'ready'
      ? (context.branches.find((entry) => entry.id === branch.target.branchId)?.timezone ?? null)
      : null;
  /** The clock the chosen days are picked on: the working branch's, or the first one's. */
  const pickerZone = workingZone ?? context.branches[0]?.timezone ?? 'UTC';
  /** The clock "as they stood at" is written on. See "Whose clock". */
  const freshnessZone =
    branchId === null ? 'UTC' : (workingZone ?? summary?.period.timezone ?? 'UTC');

  /*
   * "Reading the figures" only while a read is in flight. A read that answered
   * with a failure is not being read any more, and saying it is was the whole
   * of what the operator saw after a failed refresh; a screen that asked for
   * nothing — no branch chosen yet — is not reading either.
   */
  const summaryLine = (): string | undefined => {
    if (summary === null)
      return answer === null && key !== null ? t('dashboard.period.pending') : undefined;
    const days = summary.period.timezone;
    const covering = formatMessage(
      t(branchId === null ? 'dashboard.period.coveringUnion' : 'dashboard.period.covering'),
      {
        from: formatDayInZone(summary.period.from, intlLocale(locale), days),
        to: formatDayInZone(summary.period.to, intlLocale(locale), days),
        zone: days,
      }
    );
    const freshness = formatMessage(t('dashboard.freshness'), {
      when: formatInZone(summary.generatedAt, intlLocale(locale), freshnessZone),
      zone: zoneLabelAt(summary.generatedAt, intlLocale(locale), freshnessZone),
    });
    return `${covering} ${freshness}`;
  };

  const header = (
    <FilterToolbar
      messages={messages}
      label={t('dashboard.period.legend')}
      testId="dashboard-toolbar"
      period={{
        format: 'dashboard',
        presets: DASHBOARD_PERIODS,
        value: period,
        zone: pickerZone,
        maxDays: MAX_PERIOD_DAYS,
        onChange: (selection) => setPeriod(selection),
        notApplied: {
          preset: t('dashboard.period.notApplied'),
          custom: t('dashboard.period.notAppliedCustom'),
        },
      }}
      summary={summaryLine()}
      actions={
        <Button type="button" variant="outlined" size="small" onClick={refresh}>
          {t('dashboard.refresh')}
        </Button>
      }
    />
  );

  const body = (): ReactNode => {
    if (branch.kind === 'all' && scope === null) {
      return (
        <p
          role="status"
          data-testid="dashboard-spans-companies"
          className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary"
        >
          {t('workingContext.spansCompanies')}
        </p>
      );
    }
    if (branch.kind === 'unchosen' || branch.kind === 'none' || branch.kind === 'unavailable') {
      return (
        <RequiresConcreteBranch messages={messages} state={branch} testId="dashboard-blocked" />
      );
    }
    if (key === null) return null;
    if (answer === null) {
      return <MuiLoadingState messages={messages} rows={4} testId="dashboard-loading" />;
    }
    if (answer.status === 'denied') {
      return <MuiRefusedState messages={messages} correlationId={answer.correlationId} />;
    }
    if (answer.status === 'expired') return <MuiExpiredState messages={messages} locale={locale} />;
    // An outage and a fault both offer the same read again, here beside the
    // sentence rather than only as the toolbar's Refresh, which an operator
    // looking at the failure has no reason to connect with it.
    if (answer.status === 'unavailable') {
      return (
        <MuiUnavailableState
          messages={messages}
          onRetry={refresh}
          correlationId={answer.correlationId}
        />
      );
    }
    if (answer.status !== 'ok') {
      return (
        <MuiErrorState messages={messages} onRetry={refresh} correlationId={answer.correlationId} />
      );
    }

    // Read off the ANSWER rather than the derived `summary`: the two can only
    // ever hold the same object, and testing the second for absence was a
    // branch no run could reach — dead code that reads like a handled case.
    const sections = answer.data.sections;
    const days = answer.data.period.timezone;
    const criteriaForLink = request ?? { period: 'today' as const };

    const cards: readonly FigureCard[] = [
      {
        id: 'receptionsOpened',
        labelKey: 'dashboard.card.receptionsOpened',
        section: sections.receptionsOpened,
        href: receptionsPeriodLink(locale, criteriaForLink),
        linkLabelKey: OPEN_THE_LIST,
      },
      {
        id: 'activeWorkOrders',
        labelKey: 'dashboard.card.activeWorkOrders',
        section: sections.activeWorkOrders,
        // `active` is the board's state GROUP the overview aggregate counts.
        href: workOrdersViewLink(locale, 'active'),
        linkLabelKey: OPEN_THE_LIST,
      },
      {
        // Distinct live WORK ORDERS with a pending request — the board view's
        // own predicate, shared in SQL — and not the number of requests.
        id: 'awaitingApproval',
        labelKey: 'dashboard.card.awaitingApproval',
        section: sections.awaitingApproval,
        href: workOrdersViewLink(locale, 'awaitingApproval'),
        linkLabelKey: OPEN_THE_LIST,
      },
      {
        // Unfinished orders whose parts are not yet in hand — the ONE SQL
        // predicate the board's `awaitingParts` view also filters with.
        id: 'awaitingParts',
        labelKey: 'dashboard.card.awaitingParts',
        section: sections.awaitingParts,
        href: workOrdersViewLink(locale, 'awaitingParts'),
        linkLabelKey: OPEN_THE_LIST,
      },
      {
        id: 'readyForDelivery',
        labelKey: 'dashboard.card.readyForDelivery',
        section: sections.readyForDelivery,
        href: workOrdersViewLink(locale, 'readyForDelivery'),
        linkLabelKey: OPEN_THE_LIST,
      },
      {
        // No link: the board's one completion view is `completedToday`, and
        // it lists orders finished NOW while this figure counts ENTRIES into a
        // finished state over the period — they disagree about a job completed
        // and then reopened. Linking to a list that counts differently would
        // answer a different question.
        id: 'completedInPeriod',
        labelKey: 'dashboard.card.completedInPeriod',
        section: sections.completedInPeriod,
        href: null,
        linkLabelKey: OPEN_THE_LIST,
      },
      {
        /*
         * A RELATED destination, never "the list". The figure counts distinct
         * ITEMS at or below a reorder level in the branch set it was asked for;
         * the Attention page lists FINDINGS, one per applicable level, one
         * branch at a time, and caps the list. No page counts this set, so the
         * link names where the items are dealt with instead.
         *
         * For one working branch that page opens on the SAME branch the figure
         * was counted for — it reads the working context too. For "all my
         * branches" there is no one branch to open on, and the words say the
         * warnings are reviewed branch by branch rather than implying a
         * company-wide list.
         */
        id: 'lowStock',
        labelKey: 'dashboard.card.lowStock',
        section: sections.lowStock,
        href: attentionAreaLink(locale),
        linkLabelKey:
          branchId === null
            ? 'dashboard.card.reviewStockByBranch'
            : 'dashboard.card.reviewBranchStock',
      },
    ];

    const finished = t('dashboard.byState.finished');
    const stateBuckets =
      sections.workOrdersByState.status === 'ok' ? sections.workOrdersByState.value : [];
    const stateCategories: readonly ChartCategory[] = stateBuckets.map((bucket) => {
      /*
       * The label is the platform's word for its own states and the workshop's
       * own word for the rest. The catalogue the board reads is not read again
       * here: each bucket already carries the name recorded against the state,
       * which is exactly what that catalogue would supply for a code the
       * platform does not define.
       */
      const catalogue: readonly WorkOrderStateCatalogueEntry[] = [
        {
          code: bucket.state,
          name: bucket.label,
          isTerminal: bucket.isTerminal,
          isClosed: bucket.isTerminal,
          isCancellation: false,
        },
      ];
      const label = workOrderStateLabel(bucket.state, catalogue, (messageKey) =>
        translateDynamic(messages, messageKey)
      );
      return {
        key: bucket.state,
        label,
        // A finished state is hatched AND said in words, never told by colour alone.
        note: bucket.isTerminal ? finished : undefined,
        hatched: bucket.isTerminal,
        href: workOrdersStateLink(locale, bucket.state),
      };
    });
    const stateCounts = stateBuckets.map((bucket) => bucket.count);
    const stateSeries: readonly ChartSeries[] = [
      { id: 'count', label: t('dashboard.byState.count'), data: stateCounts, tone: 'primary' },
    ];

    const trendPoints =
      sections.intakeCompletionTrend.status === 'ok' ? sections.intakeCompletionTrend.value : [];
    const trendCategories: readonly ChartCategory[] = trendPoints.map((point) => ({
      key: point.date,
      // Short enough for an axis — the day within its month; the table and the
      // tooltip carry the whole day.
      label: formatInteger(Number(point.date.slice(8, 10)), locale),
      fullLabel: formatDayInZone(point.date, intlLocale(locale), days),
    }));
    const opened = trendPoints.map((point) => point.opened);
    const completed = trendPoints.map((point) => point.completed);
    // `opened` counts WORK ORDERS opened, not visits received — the legend says so.
    const trendSeries: readonly ChartSeries[] = [
      { id: 'opened', label: t('dashboard.trend.opened'), data: opened, tone: 'primary' },
      {
        id: 'completed',
        label: t('dashboard.trend.completed'),
        data: completed,
        tone: 'muted',
        hatched: true,
      },
    ];

    const workload =
      sections.technicianWorkload.status === 'ok' ? sections.technicianWorkload.value : [];
    const workloadCategories: readonly ChartCategory[] = workload.map((entry) => ({
      key: entry.technicianId,
      label: entry.displayName ?? t('dashboard.workload.unnamed'),
    }));
    const workloadSeries: readonly ChartSeries[] = [
      {
        id: 'activeCount',
        label: t('dashboard.workload.count'),
        data: workload.map((entry) => entry.activeCount),
        tone: 'primary',
      },
    ];

    const total = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0);

    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <MetricCard
              key={card.id}
              messages={messages}
              locale={locale}
              label={translateDynamic(messages, card.labelKey)}
              metric={metricOf(card.section)}
              href={card.href}
              linkLabel={translateDynamic(messages, card.linkLabelKey)}
              timeZone={freshnessZone}
              testId={`dashboard-figure-${card.id}`}
            />
          ))}
        </div>

        <ActionablePanel
          messages={messages}
          locale={locale}
          waitingOrders={sections.awaitingApproval}
          pendingRequests={sections.pendingApprovalsCount}
          lowStock={sections.lowStock}
          attentionHref={attentionAreaLink(locale)}
        />

        <ChartPanel
          messages={messages}
          locale={locale}
          title={t('dashboard.byState.title')}
          description={t('dashboard.byState.description')}
          summary={formatMessage(t('dashboard.byState.summary'), {
            states: formatInteger(stateCategories.length, locale),
            total: formatInteger(total(stateCounts), locale),
          })}
          kind="bar"
          layout="horizontal"
          categories={stateCategories}
          series={stateSeries}
          categoryHeader={t('dashboard.byState.state')}
          linkHeader={t('dashboard.byState.openTheList')}
          linkLabel={(category) =>
            formatMessage(t('dashboard.byState.openStateList'), {
              state: category.fullLabel ?? category.label,
            })
          }
          emptyText={t('dashboard.byState.emptyTitle')}
          state={chartStateOf(sections.workOrdersByState)}
          testId="dashboard-chart-byState"
        />

        <ChartPanel
          messages={messages}
          locale={locale}
          title={t('dashboard.trend.title')}
          description={t('dashboard.trend.description')}
          summary={formatMessage(t('dashboard.trend.summary'), {
            days: formatInteger(trendCategories.length, locale),
            opened: formatInteger(total(opened), locale),
            completed: formatInteger(total(completed), locale),
          })}
          kind="bar"
          layout="vertical"
          categories={trendCategories}
          series={trendSeries}
          categoryHeader={t('dashboard.trend.day')}
          emptyText={t('dashboard.trend.emptyTitle')}
          state={chartStateOf(sections.intakeCompletionTrend)}
          testId="dashboard-chart-trend"
        />

        <ChartPanel
          messages={messages}
          locale={locale}
          title={t('dashboard.workload.title')}
          description={t('dashboard.workload.description')}
          summary={formatMessage(t('dashboard.workload.summary'), {
            people: formatInteger(workloadCategories.length, locale),
          })}
          kind="bar"
          layout="horizontal"
          categories={workloadCategories}
          series={workloadSeries}
          categoryHeader={t('dashboard.workload.technician')}
          emptyText={t('dashboard.workload.emptyTitle')}
          state={chartStateOf(sections.technicianWorkload)}
          testId="dashboard-chart-workload"
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {header}
      {body()}
    </div>
  );
}

/**
 * What is waiting for somebody, and where it is dealt with.
 *
 * ## The figure beside a link is the figure of that link's list
 *
 * "Open the waiting list" opens the board's `awaitingApproval` view, which
 * lists WORK ORDERS — so the number beside it is the distinct live work orders
 * with a pending request, the same predicate in SQL. The number of pending
 * REQUESTS is useful too (five on one order is still one stalled vehicle), and
 * it is shown on its own line with its own words and NO link, because no list
 * on the product enumerates requests.
 *
 * The stock line links to the Attention page, which opens on the working
 * branch the figure was counted for, and is worded as the page where warnings
 * are dealt with, not as the list of what was
 * counted — see `attentionAreaLink`.
 *
 * The four stock warnings and the allowance warning are NOT read here. Each is
 * its own branch-targeted read with its own permission, and issuing five more
 * calls to print five more numbers would make this screen slower than the screen
 * that shows the findings themselves. The panel links there instead, and says
 * that is where they are — an honest signpost rather than a count nobody asked
 * the server for.
 *
 * No wrapper draws a signpost list, so this stays the screen's own: a Material
 * card on the token layer, the same frame as the figures above it.
 */
function ActionablePanel({
  messages,
  locale,
  waitingOrders,
  pendingRequests,
  lowStock,
  attentionHref,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  /** Distinct live work orders with a pending request: the linked list's count. */
  readonly waitingOrders: DashboardSection<number>;
  /** Pending requests on those orders. Never paired with a link. */
  readonly pendingRequests: DashboardSection<number>;
  readonly lowStock: DashboardSection<number>;
  /** The Attention page, on the figure's branch when there is one. */
  readonly attentionHref: string;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const titleId = useId();
  const line = (section: DashboardSection<number>): string =>
    section.status === 'ok'
      ? formatInteger(section.value, locale)
      : section.status === 'unauthorized'
        ? t('metric.withheld')
        : t('metric.unavailable');
  const linkClass =
    'text-caption text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

  return (
    <Card component="section" variant="outlined" aria-labelledby={titleId}>
      <CardContent className="flex flex-col gap-2">
        <Typography id={titleId} variant="h3" component="h2" className="text-text-heading">
          {t('dashboard.actions.title')}
        </Typography>
        <ul className="flex flex-col gap-2">
          <li
            data-actionable="approvalOrders"
            className="flex flex-wrap items-baseline gap-2 text-body text-text-primary"
          >
            <span>{t('dashboard.actions.approvalOrders')}</span>
            <strong className="text-text-heading">{line(waitingOrders)}</strong>
            <Link href={workOrdersViewLink(locale, 'awaitingApproval')} className={linkClass}>
              {t('dashboard.actions.openApprovals')}
            </Link>
          </li>
          <li
            data-actionable="approvalRequests"
            className="flex flex-wrap items-baseline gap-2 text-body text-text-secondary"
          >
            <span>{t('dashboard.actions.approvals')}</span>
            <strong className="text-text-heading">{line(pendingRequests)}</strong>
          </li>
          <li
            data-actionable="lowStock"
            className="flex flex-wrap items-baseline gap-2 text-body text-text-primary"
          >
            <span>{t('dashboard.actions.lowStock')}</span>
            <strong className="text-text-heading">{line(lowStock)}</strong>
            <Link href={attentionHref} className={linkClass}>
              {t('dashboard.actions.openAttention')}
            </Link>
          </li>
          <li
            data-actionable="otherWarnings"
            className="flex flex-wrap items-baseline gap-2 text-body text-text-secondary"
          >
            <span>{t('dashboard.actions.otherWarnings')}</span>
            <Link href={attentionHref} className={linkClass}>
              {t('dashboard.actions.openAttention')}
            </Link>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
