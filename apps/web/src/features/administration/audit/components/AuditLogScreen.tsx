'use client';

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import type { TableRequest } from '@/components/data-table/table-state';
import { DateField } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useReducedMotion } from '@/components/ui-foundation/use-reduced-motion';
import {
  StockMoment,
  momentText,
  useWorkingDisplayZone,
} from '@/features/inventory/components/stock-operations';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';
import type { BranchTarget } from '@/lib/api/read-operation';
import {
  addDays,
  dayIn,
  endOfDay,
  isCalendarDay,
  startOfDay,
  zoneDisplayName,
} from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';
import { useServerTable, type ServerPageStatus } from '../../shared/use-server-table';
import { AccountPicker, type ChosenAccount } from '../../users/components/AccountPicker';
import { listAuditEvents, readAuditEvent } from '../api';
import {
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  NO_AUDIT_FILTERS,
  type AuditDetail,
  type AuditFilters,
  type AuditRow,
  type AuditScopeOptions,
} from '../types';

/**
 * The strict identifier shape, as the rest of Administration writes it. The
 * backend's own schema refuses anything else with a 422, so a typo is caught
 * here and named instead of arriving as a validation failure about a parameter
 * the operator never saw.
 */
const IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The entity type every user-account audit record is written under. */
const USER_ACCOUNT_ENTITY = 'iam.user_account';

const DAY_MS = 24 * 60 * 60 * 1000;

interface DayRange {
  readonly from: string;
  readonly to: string;
}

type RangeProblem = 'audit.range.incomplete' | 'audit.range.order' | 'audit.range.tooWide';

/**
 * What is wrong with a pair of days, or `null`. Checked before a read, so a
 * window the service would refuse (`MAX_RANGE_DAYS`) is said on the box rather
 * than drawn as a failed read.
 */
function rangeProblem(range: DayRange): RangeProblem | null {
  if (!isCalendarDay(range.from) || !isCalendarDay(range.to)) return 'audit.range.incomplete';
  if (range.to < range.from) return 'audit.range.order';
  const span =
    (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS;
  // Both days are whole, so the window is one day longer than their distance.
  if (span + 1 > MAX_WINDOW_DAYS) return 'audit.range.tooWide';
  return null;
}

/**
 * Who did it, in words — never an identifier (`P1-32-PRE-OD-ADM6`).
 *
 * The read names the actor itself (`actorDisplayName`) for a session holding
 * `iam.user.read`. Where it does not, the sentence says why the name is absent
 * rather than printing the identifier it used to: a record with no actor at all
 * was made by the system or a service, by design, and an actor this session may
 * not have named reads "Name not available".
 */
function actorLabel(messages: Messages, row: AuditRow): string {
  if (row.actorDisplayName !== null) return row.actorDisplayName;
  if (row.actorId !== null) return translate(messages, 'audit.actor.unnamed');
  if (row.actorKind === 'system') return translate(messages, 'audit.actor.system');
  if (row.actorKind === 'service') return translate(messages, 'audit.actor.service');
  return translate(messages, 'audit.actor.none');
}

/** The account a user-account record is about, in words, or `null` for any other record. */
function subjectLabel(messages: Messages, row: AuditRow): string | null {
  if (row.entityType !== USER_ACCOUNT_ENTITY || row.entityId === null) return null;
  return row.subjectDisplayName ?? translate(messages, 'audit.actor.unnamed');
}

/**
 * The audit log. Read-only, and it says so.
 *
 * ## What it never renders
 *
 * No password, reset token, invitation token, secret, SQL, stack trace or
 * internal filesystem path. The backend already masks restricted detail values
 * unless the caller holds `iam.sensitive.view`, and this screen renders exactly
 * what the operation returned — it does not reconstruct, join or enrich. A
 * withheld value is shown as withheld rather than as an empty cell, because an
 * empty cell reads as "nothing happened there".
 *
 * ## People by name, resolved by the read (`P1-32-PRE-OD-ADM6`)
 *
 * Both audit reads name the actor, and the account a user-account record is
 * about, in the same read — one lookup per page on the server, withheld unless
 * the session holds `iam.user.read`. The screen makes no lookup of its own and
 * never prints an account identifier in place of a name.
 *
 * ## On a named clock
 *
 * The days and times are on the working branch's clock when one branch with a
 * known zone is in force, and on UTC under "All my branches" — never the
 * browser's — and the clock is named above the table and beside every time
 * (`useWorkingDisplayZone`, the rule the organisation's other tenant-wide
 * records follow). The two days are read as that clock's whole days.
 *
 * ## No export
 *
 * There is no export operation for audit records, so none is offered. An export
 * built here would be a client-side copy of restricted data leaving through a
 * path with no server-side authorization and no export audit — which is exactly
 * what the export policy exists to prevent.
 *
 * ## The criteria are the backend's, and they are applied on demand
 *
 * The list operation takes a fixed allow-list of bound parameters. The text
 * criteria travel with an optional authorized company/branch target. Selecting
 * a company prepares its branch choices; applying requires a pair.
 *
 * They apply on submit rather than on each keystroke. The read is rate-limited
 * as an expensive one and is itself an audited act, so a criterion typed
 * character by character would be a dozen recorded reads of the audit trail for
 * one question.
 */
export function AuditLogScreen({
  locale,
  messages,
  initialFrom,
  initialTo,
  openedAt,
  scopeOptions,
  canReadUsers = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly initialFrom: string;
  readonly initialTo: string;
  /**
   * The server's moment of opening, when the route page gives one. The opening
   * window is then the last `DEFAULT_WINDOW_DAYS` days up to TODAY ON THE CLOCK
   * IN FORCE — not the server's UTC days, which on a branch ahead of UTC would
   * leave the first hours of the branch's own day outside the window. Without
   * it the given days are used as they are.
   */
  readonly openedAt?: string | undefined;
  readonly scopeOptions?: AuditScopeOptions;
  /**
   * `iam.user.read` — whether the "who" criterion can be FOUND by name or email
   * (route sweep B3), and whether the read names people at all. The audit read
   * does not need that code, so a caller without it keeps the labelled
   * reference box, checked for shape as before.
   */
  readonly canReadUsers?: boolean;
}) {
  const t = useCallback((key: string) => translate(messages, key as keyof Messages), [messages]);
  const zone = useWorkingDisplayZone();

  // The opening window follows the clock in force until the operator changes a
  // day: a working context that settles after the first paint re-bases it once
  // rather than leaving it on the clock it opened on.
  const opening = useMemo<DayRange>(() => {
    if (openedAt === undefined) return { from: initialFrom, to: initialTo };
    const today = dayIn(zone, new Date(openedAt));
    return { from: addDays(today, -DEFAULT_WINDOW_DAYS), to: today };
  }, [openedAt, initialFrom, initialTo, zone]);
  // The days in the boxes, and the last pair that was whole and in bounds. A
  // pair being edited never reaches the read half-typed.
  const [edited, setEdited] = useState<{
    readonly range: DayRange;
    readonly applied: DayRange;
  } | null>(null);
  const range = edited?.range ?? opening;
  const appliedRange = edited?.applied ?? opening;
  const problem = rangeProblem(range);
  // An unfinished day is said on its own box; an order or a width is said on
  // the last day, which is the one to move.
  const fromError =
    problem === 'audit.range.incomplete' && !isCalendarDay(range.from) ? t(problem) : undefined;
  const toError =
    problem === null
      ? undefined
      : problem !== 'audit.range.incomplete' || !isCalendarDay(range.to)
        ? t(problem)
        : undefined;
  const changeRange = (next: DayRange) => {
    setEdited({ range: next, applied: rangeProblem(next) === null ? next : appliedRange });
  };

  // Two states, not one: `draft` is what the operator is typing and `applied`
  // is what the last read was made with. Collapsing them would make every
  // keystroke a request, and would also make the visible criteria disagree with
  // the rows on screen while a page is in flight.
  const [draft, setDraft] = useState<AuditFilters>(NO_AUDIT_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(NO_AUDIT_FILTERS);
  const [actorInvalid, setActorInvalid] = useState(false);
  const [actor, setActor] = useState<ChosenAccount | null>(null);
  const [draftTarget, setDraftTarget] = useState<BranchTarget>({ companyId: '', branchId: '' });
  const [appliedTarget, setAppliedTarget] = useState<BranchTarget | null>(null);
  const [targetInvalid, setTargetInvalid] = useState(false);
  const [viewing, setViewing] = useState<AuditRow | null>(null);

  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listAuditEvents(
        request,
        cursor,
        {
          from: startOfDay(zone, appliedRange.from).toISOString(),
          to: endOfDay(zone, appliedRange.to).toISOString(),
        },
        applied,
        appliedTarget
      ),
    [zone, appliedRange.from, appliedRange.to, applied, appliedTarget]
  );

  // The window, its clock and the applied criteria are what `load` closes
  // over, so they are what must invalidate the held page — and reset it: page
  // four of an unfiltered set is not page four of a filtered one, and a cursor
  // taken from the first is meaningless against the second (P1-26-F-019).
  //
  // With a branch applied, `listAuditEvents` re-reads the caller's companies and
  // branches before it reads the events — two server reads in sequence — so the
  // table waits for both rather than for one (`settleRead`). Without a branch it
  // reads once.
  const table = useServerTable<AuditRow>(load, {
    loadKey: `${zone}#${appliedRange.from}..${appliedRange.to}#${applied.action}#${applied.entityType}#${applied.actorId}#${appliedTarget?.companyId ?? ''}#${appliedTarget?.branchId ?? ''}`,
    serverReads: appliedTarget === null ? 1 : 2,
  });

  const narrowed =
    applied.action !== '' ||
    applied.entityType !== '' ||
    applied.actorId !== '' ||
    appliedTarget !== null;

  const clearCriteria = useCallback(() => {
    setDraft(NO_AUDIT_FILTERS);
    setApplied(NO_AUDIT_FILTERS);
    setActor(null);
    setActorInvalid(false);
    setDraftTarget({ companyId: '', branchId: '' });
    setAppliedTarget(null);
    setTargetInvalid(false);
  }, []);

  const columns = useMemo<readonly OperationalColumn<AuditRow>[]>(
    () => [
      {
        id: 'occurredAt',
        headerKey: 'audit.column.occurredAt',
        flex: 2,
        // `occurredAt` is REQUIRED by the published record, written on the
        // clock named above the table.
        cell: (row) => <StockMoment value={row.occurredAt} locale={locale} zone={zone} />,
      },
      {
        id: 'actor',
        headerKey: 'audit.column.actor',
        flex: 2,
        cell: (row) => (
          <bdi className={row.actorDisplayName === null ? 'text-text-secondary' : 'font-medium'}>
            {actorLabel(messages, row)}
          </bdi>
        ),
      },
      {
        id: 'action',
        headerKey: 'audit.column.action',
        flex: 2,
        cell: (row) => <code className="font-mono text-caption">{row.action}</code>,
      },
      {
        id: 'entity',
        headerKey: 'audit.column.entity',
        flex: 2,
        cell: (row) => {
          const subject = subjectLabel(messages, row);
          return (
            <span className="text-text-secondary">
              <code className="font-mono text-caption">{row.entityType}</code>
              {subject === null ? null : (
                <>
                  {' · '}
                  <bdi>{subject}</bdi>
                </>
              )}
            </span>
          );
        },
      },
      {
        id: 'correlationId',
        headerKey: 'audit.column.correlationId',
        hideBelow: 'md',
        flex: 2,
        cell: (row) =>
          row.correlationId ? (
            <code className="break-all font-mono text-caption">{row.correlationId}</code>
          ) : (
            '—'
          ),
      },
    ],
    [locale, messages, zone]
  );

  const rowActions = useCallback(
    (row: AuditRow): readonly RowAction[] => [
      {
        kind: 'button',
        label: translate(messages, 'admin.open'),
        about: `${row.action}, ${momentText(row.occurredAt, locale, zone)}`,
        onClick: () => setViewing(row),
      },
    ],
    [locale, messages, zone]
  );

  const clockName = zoneDisplayName(zone, intlLocale(locale), new Date().toISOString());
  const clockSentence =
    zone === 'UTC'
      ? t('audit.clock.utc')
      : formatMessage(t('audit.clock.branch'), { zone: clockName });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-full max-w-xs">
          <DateField
            label={t('audit.from')}
            value={range.from}
            timezone={zone}
            onChange={(from) => changeRange({ ...range, from })}
            error={fromError}
            testId="audit-range-from"
          />
        </div>
        <div className="w-full max-w-xs">
          <DateField
            label={t('audit.to')}
            value={range.to}
            timezone={zone}
            onChange={(to) => changeRange({ ...range, to })}
            error={toError}
            testId="audit-range-to"
          />
        </div>
        <div className="flex w-full flex-col gap-1">
          <p className="text-supporting text-text-muted">{t('audit.rangeHint')}</p>
          <p className="text-supporting text-text-secondary" data-testid="audit-clock">
            {clockSentence}
          </p>
        </div>
      </div>

      <form
        aria-label={t('audit.filter.formLabel')}
        className="flex flex-wrap items-start gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const actorId = canReadUsers ? (actor?.id ?? '') : draft.actorId.trim();
          // Refused here rather than sent: the parameter is schema-checked, so
          // a malformed one fails the WHOLE request and the operator is told
          // the request was invalid without being told which box.
          if (actorId.length > 0 && !IDENTIFIER.test(actorId)) {
            setActorInvalid(true);
            return;
          }
          setActorInvalid(false);
          if (draftTarget.companyId && !draftTarget.branchId) {
            setTargetInvalid(true);
            return;
          }
          setTargetInvalid(false);
          setAppliedTarget(draftTarget.branchId ? draftTarget : null);
          setApplied({
            action: draft.action.trim(),
            entityType: draft.entityType.trim(),
            actorId,
          });
        }}
      >
        {scopeOptions?.status === 'ok' ? (
          <>
            <div className="w-full max-w-xs">
              <FormSelectField
                label={t('audit.filter.company')}
                value={draftTarget.companyId}
                placeholder={t('audit.filter.allCompanies')}
                options={scopeOptions.companies.map((company) => ({
                  value: company.id,
                  label: company.legalName,
                }))}
                onChange={(companyId) => {
                  setDraftTarget({ companyId, branchId: '' });
                  setTargetInvalid(false);
                }}
              />
            </div>
            <div className="w-full max-w-xs">
              <FormSelectField
                label={t('audit.filter.branch')}
                value={draftTarget.branchId}
                disabled={!draftTarget.companyId}
                placeholder={t('field.selectPlaceholder')}
                options={scopeOptions.branches
                  .filter((branch) => branch.companyId === draftTarget.companyId)
                  .map((branch) => ({ value: branch.id, label: branch.name }))}
                error={targetInvalid ? t('audit.filter.chooseBranch') : undefined}
                onChange={(branchId) => {
                  setDraftTarget((current) => ({ ...current, branchId }));
                  setTargetInvalid(false);
                }}
              />
            </div>
          </>
        ) : scopeOptions ? (
          <p className="w-full text-caption text-text-muted">
            {t('audit.filter.scopeUnavailable')}
          </p>
        ) : null}
        <div className="w-full max-w-xs">
          <FormTextField
            label={t('audit.filter.action')}
            spellCheck={false}
            dir="ltr"
            value={draft.action}
            onChange={(action) => setDraft((current) => ({ ...current, action }))}
          />
        </div>
        <div className="w-full max-w-xs">
          <FormTextField
            label={t('audit.filter.entityType')}
            spellCheck={false}
            dir="ltr"
            value={draft.entityType}
            onChange={(entityType) => setDraft((current) => ({ ...current, entityType }))}
          />
        </div>
        {canReadUsers ? (
          <div className="w-full max-w-md">
            <AccountPicker
              messages={messages}
              locale={locale}
              label={t('audit.filter.actor')}
              value={actor}
              onChange={setActor}
              canSearch
              countsAsUnsaved={false}
              testId="audit-actor-picker"
            />
          </div>
        ) : (
          <div className="w-full max-w-md">
            <FormTextField
              label={t('audit.filter.actor')}
              description={t('audit.filter.identifierHelp')}
              spellCheck={false}
              dir="ltr"
              value={draft.actorId}
              onChange={(actorId) => setDraft((current) => ({ ...current, actorId }))}
              onEdit={() => setActorInvalid(false)}
              error={actorInvalid ? t('audit.filter.idFormat') : undefined}
            />
          </div>
        )}
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button type="submit" variant="contained">
            {t('audit.filter.apply')}
          </Button>
          <Button type="button" variant="outlined" onClick={clearCriteria}>
            {t('audit.filter.clear')}
          </Button>
        </div>
        <p className="w-full text-caption text-text-muted">{t('audit.filter.hint')}</p>
      </form>

      <p className="text-caption text-text-muted">
        {t('audit.readOnly')} {t('audit.viewedNotice')} {t('audit.noExport')}
      </p>
      {canReadUsers ? null : (
        <p className="text-caption text-text-muted" data-testid="audit-names-withheld">
          {t('audit.actor.namesWithheld')}
        </p>
      )}

      <OperationalGrid<AuditRow>
        messages={messages}
        locale={locale}
        label={t('audit.title')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={rowActions}
        density="compact"
        // "Nothing in this period" and "nothing matches these filters" are
        // this log's own sentences: the window always narrows it.
        suppressEmptyState
        testId="audit-grid"
      />
      {table.status === 'idle' && table.response && table.response.rows.length === 0 ? (
        narrowed ? (
          <MuiEmptyState
            messages={messages}
            titleKey="audit.empty.filteredTitle"
            descriptionKey="audit.empty.filteredBody"
            testId="audit-empty-filtered"
            action={
              <Button type="button" size="small" variant="outlined" onClick={clearCriteria}>
                {t('audit.filter.clear')}
              </Button>
            }
          />
        ) : (
          <MuiEmptyState
            messages={messages}
            titleKey="audit.empty.title"
            descriptionKey="audit.empty.body"
            testId="audit-empty"
          />
        )
      ) : null}

      {viewing ? (
        <AuditDetailDrawer
          key={viewing.id}
          messages={messages}
          locale={locale}
          zone={zone}
          row={viewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}

interface HeldDetail {
  readonly generation: number;
  readonly status: ServerPageStatus;
  readonly record: AuditDetail | null;
  readonly correlationId: string | null;
}

/**
 * One record, read on opening (`iam.audit-event-detail`, itself audited).
 *
 * Material's drawer traps Tab inside while it is open and returns focus to the
 * button that opened it; Escape and Close both close it, and a closed drawer
 * leaves the page at once. A refused, ended or failed read is said as itself,
 * with a retry only where retrying can change the answer.
 */
function AuditDetailDrawer({
  messages,
  locale,
  zone,
  row,
  onClose,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly zone: string;
  readonly row: AuditRow;
  readonly onClose: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const titleId = useId();
  const reducedMotion = useReducedMotion();
  const [generation, setGeneration] = useState(0);
  const [held, setHeld] = useState<HeldDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: Omit<HeldDetail, 'generation'>;
      try {
        next = await readAuditEvent(row.id);
      } catch {
        next = { status: 'unavailable', record: null, correlationId: null };
      }
      if (!cancelled) setHeld({ generation, ...next });
    })();
    return () => {
      cancelled = true;
    };
  }, [row.id, generation]);

  const loading = held === null || held.generation !== generation;
  const record = !loading && held.status === 'ok' ? held.record : null;

  return (
    <Drawer
      open
      anchor="right"
      onClose={onClose}
      {...(reducedMotion ? { transitionDuration: 0 } : {})}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': titleId,
          className: 'w-full max-w-md',
          'data-testid': 'audit-detail',
        } as Record<string, unknown>,
      }}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-section-title font-medium text-text-primary">
            {t('audit.detail.title')}
          </h2>
          <Button type="button" variant="outlined" size="small" onClick={onClose} autoFocus>
            {t('admin.close')}
          </Button>
        </div>
        {loading ? (
          <MuiLoadingState messages={messages} testId="audit-detail-loading" />
        ) : record === null ? (
          <MuiReadFailureState
            messages={messages}
            locale={locale}
            status={held.status === 'ok' ? 'not-found' : held.status}
            correlationId={held.correlationId}
            onRetry={() => setGeneration((current) => current + 1)}
            testId="audit-detail-failure"
          />
        ) : (
          <dl className="flex flex-col gap-4">
            <DetailRow term={t('audit.column.action')}>
              <code className="break-all font-mono">{record.action}</code>
            </DetailRow>
            <DetailRow term={t('audit.column.occurredAt')}>
              <StockMoment value={record.occurredAt} locale={locale} zone={zone} />
            </DetailRow>
            <DetailRow term={t('audit.column.actor')}>
              <bdi>{actorLabel(messages, record)}</bdi>
            </DetailRow>
            <DetailRow term={t('audit.column.entity')}>
              <code className="break-all font-mono">{record.entityType}</code>
            </DetailRow>
            {subjectLabel(messages, record) === null ? null : (
              <DetailRow term={t('audit.detail.subject')}>
                <bdi>{subjectLabel(messages, record)}</bdi>
              </DetailRow>
            )}
            <DetailRow term={t('audit.column.correlationId')}>
              {record.correlationId ? (
                <code className="break-all font-mono">{record.correlationId}</code>
              ) : (
                '—'
              )}
            </DetailRow>

            <div>
              <dt className="text-label font-medium text-text-secondary">
                {t('audit.detail.details')}
              </dt>
              <dd className="mt-1">
                {/*
                  `details` ABSENT and `details` EMPTY are different facts:
                  the caller may not read them, or the record has none. They
                  render differently.
                */}
                {record.details === undefined ? (
                  <p className="text-body text-text-muted">{t('audit.detail.masked')}</p>
                ) : record.details.length === 0 ? (
                  <p className="text-body text-text-muted">{t('audit.detail.noDetails')}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {record.details.map((entry) => (
                      <li
                        key={entry.fieldName}
                        className="rounded-md border border-border-subtle p-2"
                      >
                        <p className="font-mono text-caption text-text-muted">{entry.fieldName}</p>
                        <p className="break-all text-supporting text-text-primary">
                          {entry.oldValueMasked !== null ? (
                            <>
                              <span className="text-text-muted line-through">
                                {entry.oldValueMasked}
                              </span>{' '}
                            </>
                          ) : null}
                          {entry.newValueMasked ?? '—'}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-caption text-text-muted">{t('audit.detail.maskedHint')}</p>
              </dd>
            </div>
          </dl>
        )}
      </div>
    </Drawer>
  );
}

function DetailRow({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-label font-medium text-text-secondary">{term}</dt>
      <dd className="text-body text-text-primary">{children}</dd>
    </div>
  );
}
