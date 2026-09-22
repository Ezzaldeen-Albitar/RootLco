'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { TextField } from '@/components/forms/Field';
import {
  BackendUnavailableState,
  ErrorState,
  PermissionDeniedState,
  SessionExpiredState,
  SkeletonRows,
} from '@/components/states/States';
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
import { formatDayInZone, isCalendarDay } from '@/lib/branch-time';
import { IDLE, invalid, type ActionState } from '@/lib/forms/action-result';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { formatDateTime, formatInteger, intlLocale } from '@/lib/format';
import { readDashboardSummary } from '../api';
import {
  attentionAreaLink,
  receptionsPeriodLink,
  workOrdersStateLink,
  workOrdersViewLink,
} from '../dashboard-links';
import {
  DASHBOARD_PERIODS,
  type DashboardPeriod,
  type DashboardSection,
  type DashboardSummary,
} from '../overview-contract';
import { StateBarChart, TrendChart, WorkloadChart, type TrendRow } from './charts';

/**
 * The dashboard: what this branch is holding, right now (Owner directive,
 * `P1-32-PRE-OD-UX`).
 *
 * ## One read, and every figure on the screen comes out of it
 *
 * `ovw.dashboard-summary-read` computes each figure as an aggregate over the
 * whole scoped selection inside the authorized transaction. This screen issues
 * it once per working branch and period, and draws nothing it did not receive:
 * no total is summed here, no percentage is derived, and no board's page is
 * counted to stand in for a set.
 *
 * ## A withheld figure is not a zero
 *
 * Every section carries its own state. `unauthorized` means the reader may not
 * see that part of the workshop, and the card says so — printing `0` would be a
 * false statement about the workshop instead of a true one about the reader.
 * `unavailable` means the platform cannot answer the question at all.
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
 */

/** The period in force, plus the two days a chosen one was applied with. */
interface AppliedPeriod {
  readonly kind: DashboardPeriod;
  readonly from: string;
  readonly to: string;
}

const TODAY: AppliedPeriod = { kind: 'today', from: '', to: '' };

/** The longest period the operation accepts: a calendar quarter's worst case. */
const MAX_PERIOD_DAYS = 92;

const DAY_MS = 86_400_000;

/** How many calendar days a chosen period covers, both ends included. */
function daysCovered(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** What the read is asked for. `null` when there is nothing to ask. */
interface Asked {
  readonly scope: BranchScope;
  readonly period: DashboardPeriod;
  readonly from?: string;
  readonly to?: string;
}

/** One figure, with the address of the rows behind it. */
interface FigureCard {
  readonly id: string;
  readonly labelKey: string;
  readonly section: DashboardSection<number>;
  /** `null` when no list on this product can be narrowed the way this counted. */
  readonly href: string | null;
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

  const [period, setPeriod] = useState<AppliedPeriod>(TODAY);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [custom, setCustom] = useState(false);
  /** Bumped by the refresh control. Part of the key, so it re-reads. */
  const [asAt, setAsAt] = useState(0);
  const [refusal, setRefusal] = useState<ActionState>(IDLE);
  const formRef = useFocusFirstInvalid(refusal);
  const corrections = useClearOnCorrect(refusal);

  const scope: BranchScope | null =
    branch.kind === 'ready'
      ? { companyId: branch.target.companyId, branchId: branch.target.branchId }
      : branch.kind === 'all' && context.selection?.companyId
        ? { companyId: context.selection.companyId, branchId: null }
        : null;

  const asked: Asked | null =
    scope === null
      ? null
      : period.kind === 'custom'
        ? period.from === '' || period.to === ''
          ? null
          : { scope, period: 'custom', from: period.from, to: period.to }
        : { scope, period: period.kind };

  /*
   * The one key everything is filed under, and the inputs it is built from.
   *
   * Every part is a primitive: branch, period, the two chosen days, the
   * working-context version and the refresh counter. The effect below depends on
   * those primitives rather than on the rebuilt request object, so a render that
   * changes nothing asks for nothing — and a change to any of them makes the
   * held answer unrenderable in the same render it changed in.
   */
  const companyId = scope?.companyId ?? null;
  const branchId = scope?.branchId ?? null;
  const periodKind = asked?.period ?? null;
  const askedFrom = asked?.from ?? '';
  const askedTo = asked?.to ?? '';
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
    void readDashboardSummary({ companyId, branchId }, criteria).then((read) => {
      // Two guards, and they answer different questions: `live` is "this effect
      // is still the current one", `signal.aborted` is "the branch has moved on
      // since this was asked". A Server Action call cannot be cancelled across
      // the boundary, so what aborting buys is that the answer is DISCARDED.
      if (live && !signal.aborted) setHeld({ key, read });
    });
    return () => {
      live = false;
    };
  }, [key, companyId, branchId, periodKind, askedFrom, askedTo, signal]);

  const answer = held !== null && key !== null && held.key === key ? held.read : null;
  const summary = answer !== null && answer.status === 'ok' ? answer.data : null;

  const zone =
    summary?.period.timezone ??
    (branch.kind === 'ready'
      ? context.branches.find((entry) => entry.id === branch.target.branchId)?.timezone
      : context.branches[0]?.timezone) ??
    'UTC';

  const choosePeriod = (kind: DashboardPeriod) => {
    setRefusal(IDLE);
    if (kind === 'custom') {
      setCustom(true);
      return;
    }
    setCustom(false);
    setPeriod({ kind, from: '', to: '' });
  };

  const applyCustom = () => {
    if (draftFrom === '' || draftTo === '') {
      setRefusal(
        invalid(
          { [draftFrom === '' ? 'from' : 'to']: 'dashboard.period.incomplete' },
          (refusal.attempt ?? 0) + 1
        )
      );
      return;
    }
    if (!isCalendarDay(draftFrom) || !isCalendarDay(draftTo)) {
      setRefusal(
        invalid(
          { [isCalendarDay(draftFrom) ? 'to' : 'from']: 'dashboard.period.incomplete' },
          (refusal.attempt ?? 0) + 1
        )
      );
      return;
    }
    if (draftTo < draftFrom) {
      // Refused here rather than at the backend: an inverted range is answered
      // 422, and a page-level failure teaches nobody which box to fix.
      setRefusal(invalid({ to: 'dashboard.period.inverted' }, (refusal.attempt ?? 0) + 1));
      return;
    }
    if (daysCovered(draftFrom, draftTo) > MAX_PERIOD_DAYS) {
      setRefusal(invalid({ to: 'dashboard.period.tooLong' }, (refusal.attempt ?? 0) + 1));
      return;
    }
    setRefusal(IDLE);
    setPeriod({ kind: 'custom', from: draftFrom, to: draftTo });
  };

  const errorFor = (field: string): string | undefined => {
    const messageKey = corrections.errorFor(field);
    return messageKey === undefined ? undefined : translateDynamic(messages, messageKey);
  };
  const fromError = errorFor('from');
  const toError = errorFor('to');

  const criteriaForLink =
    period.kind === 'custom' && period.from !== '' && period.to !== ''
      ? { period: period.kind, from: period.from, to: period.to }
      : { period: period.kind };

  const header = (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        applyCustom();
      }}
      noValidate
      aria-label={t('dashboard.period.legend')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div
        role="group"
        aria-label={t('dashboard.period.legend')}
        className="flex flex-wrap items-center gap-2"
      >
        {DASHBOARD_PERIODS.map((kind) => {
          const pressed = kind === 'custom' ? custom : !custom && period.kind === kind;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                choosePeriod(kind);
              }}
              className={
                pressed
                  ? 'rounded-md border border-border bg-primary px-3 py-1.5 text-body text-on-primary transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
                  : 'rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
              }
            >
              {translateDynamic(messages, `dashboard.period.${kind}`)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setAsAt((previous) => previous + 1);
          }}
          className="ms-auto rounded-md border border-border px-3 py-1.5 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {t('dashboard.refresh')}
        </button>
      </div>

      {custom ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            type="date"
            label={t('dashboard.period.from')}
            value={draftFrom}
            onChange={(event) => {
              corrections.noteEdited('from');
              setDraftFrom(event.target.value);
            }}
            {...(fromError === undefined ? {} : { error: fromError })}
          />
          <TextField
            type="date"
            label={t('dashboard.period.to')}
            value={draftTo}
            onChange={(event) => {
              corrections.noteEdited('to');
              setDraftTo(event.target.value);
            }}
            {...(toError === undefined ? {} : { error: toError })}
          />
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {t('dashboard.period.apply')}
            </button>
          </div>
        </div>
      ) : null}

      {/*
        Pressing "Choose dates" does not change a single figure — the days have
        not been named yet, so there is nothing to ask for. Without this line
        the control reads as applied while every number below still answers the
        period before it, which is the screen stating one period and showing
        another.
      */}
      {custom && period.kind !== 'custom' ? (
        <p className="text-supporting text-warning">
          {formatMessage(t('dashboard.period.notApplied'), {
            period: translateDynamic(messages, `dashboard.period.${period.kind}`),
          })}
        </p>
      ) : null}

      <p className="text-supporting text-text-secondary">
        {summary === null
          ? t('dashboard.period.pending')
          : formatMessage(t('dashboard.period.covering'), {
              from: formatDayInZone(summary.period.from, intlLocale(locale), zone),
              to: formatDayInZone(summary.period.to, intlLocale(locale), zone),
              zone: summary.period.timezone,
            })}
      </p>
      {summary === null ? null : (
        <p className="text-caption text-text-muted">
          {formatMessage(t('dashboard.freshness'), {
            when: formatDateTime(summary.generatedAt, locale),
          })}
        </p>
      )}
    </form>
  );

  const body = (): ReactNode => {
    if (branch.kind === 'all' && scope === null) {
      return <Notice messages={messages} messageKey="workingContext.spansCompanies" />;
    }
    if (branch.kind === 'unchosen') {
      return <Notice messages={messages} messageKey="workingContext.chooseFirst" />;
    }
    if (branch.kind === 'none') {
      return <Notice messages={messages} messageKey="workingContext.noBranch" />;
    }
    if (branch.kind === 'unavailable') {
      return <Notice messages={messages} messageKey="workingContext.unavailable" />;
    }
    if (asked === null) {
      return <Notice messages={messages} messageKey="dashboard.period.incomplete" />;
    }
    if (answer === null) return <SkeletonRows rows={4} />;
    if (answer.status === 'denied') {
      return (
        <PermissionDeniedState
          messages={messages}
          {...(answer.correlationId === null ? {} : { correlationId: answer.correlationId })}
        />
      );
    }
    if (answer.status === 'expired') return <SessionExpiredState messages={messages} />;
    if (answer.status === 'unavailable') {
      return (
        <BackendUnavailableState
          messages={messages}
          {...(answer.correlationId === null ? {} : { correlationId: answer.correlationId })}
        />
      );
    }
    if (answer.status !== 'ok') {
      return (
        <ErrorState
          messages={messages}
          {...(answer.correlationId === null ? {} : { correlationId: answer.correlationId })}
        />
      );
    }

    // Read off the ANSWER rather than the derived `summary`: the two can only
    // ever hold the same object, and testing the second for absence was a
    // branch no run could reach — dead code that reads like a handled case.
    const sections = answer.data.sections;

    const cards: readonly FigureCard[] = [
      {
        id: 'receptionsOpened',
        labelKey: 'dashboard.card.receptionsOpened',
        section: sections.receptionsOpened,
        href: receptionsPeriodLink(locale, criteriaForLink),
      },
      {
        id: 'activeWorkOrders',
        labelKey: 'dashboard.card.activeWorkOrders',
        section: sections.activeWorkOrders,
        href: workOrdersViewLink(locale, 'all'),
      },
      {
        id: 'awaitingApproval',
        labelKey: 'dashboard.card.awaitingApproval',
        section: sections.awaitingApproval,
        href: workOrdersViewLink(locale, 'awaitingApproval'),
      },
      {
        id: 'awaitingParts',
        labelKey: 'dashboard.card.awaitingParts',
        section: sections.awaitingParts,
        href: workOrdersViewLink(locale, 'awaitingParts'),
      },
      {
        id: 'readyForDelivery',
        labelKey: 'dashboard.card.readyForDelivery',
        section: sections.readyForDelivery,
        href: workOrdersViewLink(locale, 'readyForDelivery'),
      },
      {
        // No link: the board can be sent an OPENED window and no completed one,
        // so there is no list that is narrowed the way this figure counted.
        // Linking to the unfiltered board would answer a different question.
        id: 'completedInPeriod',
        labelKey: 'dashboard.card.completedInPeriod',
        section: sections.completedInPeriod,
        href: null,
      },
      {
        id: 'lowStock',
        labelKey: 'dashboard.card.lowStock',
        section: sections.lowStock,
        href: attentionAreaLink(locale),
      },
    ];

    const stateRows =
      sections.workOrdersByState.status === 'ok'
        ? sections.workOrdersByState.value.map((bucket) => {
            /*
             * The label is the platform's word for its own states and the
             * workshop's own word for the rest. The catalogue the board reads is
             * not read again here: each bucket already carries the name recorded
             * against the state, which is exactly what that catalogue would
             * supply for a code the platform does not define.
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
            return {
              code: bucket.state,
              label: workOrderStateLabel(bucket.state, catalogue, (messageKey) =>
                translateDynamic(messages, messageKey)
              ),
              count: bucket.count,
              isTerminal: bucket.isTerminal,
              href: workOrdersStateLink(locale, bucket.state),
            };
          })
        : [];

    const trendRows: readonly TrendRow[] =
      sections.intakeCompletionTrend.status === 'ok'
        ? sections.intakeCompletionTrend.value.map((point) => ({
            date: point.date,
            label: formatInteger(Number(point.date.slice(8, 10)), locale),
            dayLabel: formatDayInZone(point.date, intlLocale(locale), zone),
            opened: point.opened,
            completed: point.completed,
          }))
        : [];

    const workloadRows =
      sections.technicianWorkload.status === 'ok'
        ? sections.technicianWorkload.value.map((entry) => ({
            technicianId: entry.technicianId,
            label: entry.displayName ?? t('dashboard.workload.unnamed'),
            activeCount: entry.activeCount,
          }))
        : [];

    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <FigureTile key={card.id} card={card} messages={messages} locale={locale} />
          ))}
        </div>

        <ActionablePanel
          messages={messages}
          locale={locale}
          pendingApprovals={sections.pendingApprovalsCount}
          lowStock={sections.lowStock}
        />

        {sections.workOrdersByState.status === 'ok' ? (
          <StateBarChart messages={messages} locale={locale} rows={stateRows} />
        ) : (
          <SectionNotice messages={messages} section={sections.workOrdersByState} />
        )}

        {sections.intakeCompletionTrend.status === 'ok' ? (
          <TrendChart messages={messages} locale={locale} rows={trendRows} />
        ) : (
          <SectionNotice messages={messages} section={sections.intakeCompletionTrend} />
        )}

        {sections.technicianWorkload.status === 'ok' ? (
          <WorkloadChart messages={messages} locale={locale} rows={workloadRows} />
        ) : (
          <SectionNotice messages={messages} section={sections.technicianWorkload} />
        )}
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

/** A sentence in a frame, for the states that have nothing to draw. */
function Notice({
  messages,
  messageKey,
}: {
  readonly messages: Messages;
  readonly messageKey: string;
}) {
  return (
    <p className="rounded-xl border border-border-subtle bg-surface p-4 text-body text-text-muted">
      {translateDynamic(messages, messageKey)}
    </p>
  );
}

/** What a whole withheld or unanswerable section says instead of drawing. */
function SectionNotice({
  messages,
  section,
}: {
  readonly messages: Messages;
  readonly section: DashboardSection<unknown>;
}) {
  return (
    <Notice
      messages={messages}
      messageKey={
        section.status === 'unauthorized'
          ? 'dashboard.section.withheld'
          : 'dashboard.card.unavailable'
      }
    />
  );
}

/**
 * One figure.
 *
 * Three arms and three different renderings, because they are three different
 * statements: a number the platform counted, a refusal addressed to this reader,
 * and a question the platform cannot answer. Only the first is a link — there is
 * nothing to open behind the other two.
 */
function FigureTile({
  card,
  messages,
  locale,
}: {
  readonly card: FigureCard;
  readonly messages: Messages;
  readonly locale: Locale;
}) {
  const label = translateDynamic(messages, card.labelKey);
  const frame =
    'flex flex-col gap-1 rounded-xl border border-border-subtle bg-surface p-4 shadow-xs';

  if (card.section.status === 'unauthorized') {
    return (
      <div className={frame} data-figure={card.id}>
        <span className="text-supporting text-text-secondary">{label}</span>
        <span className="text-body text-text-muted">
          {translate(messages, 'dashboard.card.withheld')}
        </span>
      </div>
    );
  }

  if (card.section.status === 'unavailable') {
    return (
      <div className={frame} data-figure={card.id}>
        <span className="text-supporting text-text-secondary">{label}</span>
        <span className="text-body text-text-muted">
          {translate(messages, 'dashboard.card.unavailable')}
        </span>
      </div>
    );
  }

  const figure = (
    <>
      <span className="text-supporting text-text-secondary">{label}</span>
      <span className="text-display font-semibold text-text-heading">
        {formatInteger(card.section.value, locale)}
      </span>
    </>
  );

  if (card.href === null) {
    return (
      <div className={frame} data-figure={card.id}>
        {figure}
      </div>
    );
  }

  return (
    <Link
      href={card.href}
      data-figure={card.id}
      className={`${frame} transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring`}
    >
      {figure}
      <span className="text-caption text-primary">
        {translate(messages, 'dashboard.card.openTheList')}
      </span>
    </Link>
  );
}

/**
 * What is waiting for somebody, and where it is dealt with.
 *
 * The four stock warnings and the allowance warning are NOT read here. Each is
 * its own branch-targeted read with its own permission, and issuing five more
 * calls to print five more numbers would make this screen slower than the screen
 * that shows the findings themselves. The panel links there instead, and says
 * that is where they are — an honest signpost rather than a count nobody asked
 * the server for.
 */
function ActionablePanel({
  messages,
  locale,
  pendingApprovals,
  lowStock,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly pendingApprovals: DashboardSection<number>;
  readonly lowStock: DashboardSection<number>;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const line = (section: DashboardSection<number>): string =>
    section.status === 'ok'
      ? formatInteger(section.value, locale)
      : section.status === 'unauthorized'
        ? t('dashboard.card.withheld')
        : t('dashboard.card.unavailable');

  return (
    <section className="rounded-xl border border-border-subtle bg-surface p-4">
      <h2 className="text-section-title font-semibold text-text-heading">
        {t('dashboard.actions.title')}
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        <li className="flex flex-wrap items-baseline gap-2 text-body text-text-primary">
          <span>{t('dashboard.actions.approvals')}</span>
          <strong className="text-text-heading">{line(pendingApprovals)}</strong>
          <Link
            href={workOrdersViewLink(locale, 'awaitingApproval')}
            className="text-caption text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {t('dashboard.actions.openApprovals')}
          </Link>
        </li>
        <li className="flex flex-wrap items-baseline gap-2 text-body text-text-primary">
          <span>{t('dashboard.actions.lowStock')}</span>
          <strong className="text-text-heading">{line(lowStock)}</strong>
          <Link
            href={attentionAreaLink(locale)}
            className="text-caption text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {t('dashboard.actions.openAttention')}
          </Link>
        </li>
        <li className="flex flex-wrap items-baseline gap-2 text-body text-text-secondary">
          <span>{t('dashboard.actions.otherWarnings')}</span>
          <Link
            href={attentionAreaLink(locale)}
            className="text-caption text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {t('dashboard.actions.openAttention')}
          </Link>
        </li>
      </ul>
    </section>
  );
}
