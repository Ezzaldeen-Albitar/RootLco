'use client';

import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import {
  OperationalGrid,
  TwoLineCell,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { useServerTable } from '@/components/data-table/use-server-table';
import { ZonedDateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { MuiEmptyState } from '@/components/states/MuiStates';
import { useReducedMotion } from '@/components/ui-foundation/use-reduced-motion';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime, formatInteger } from '@/lib/format';
import { searchPlatformAudit } from '../table-reads';
import {
  AUDIT_MAX_WINDOW_DAYS,
  PLATFORM_AUDIT_ACTIONS,
  auditActionKey,
  auditWindowProblem,
  type OrganizationRow,
  type PlatformAuditCriteria,
  type PlatformAuditEvent,
} from '../types';

/**
 * The platform operator's own audit trail (P1-32-PRE-068).
 *
 * The window opens on the dates the page was given — the last thirty days — and
 * the server bounds it. Criteria are applied together when the operator asks,
 * and applying them returns the table to its first page.
 *
 * Two things this screen owns rather than the table (P1-32-PRE-OD-CONSOLE-004):
 *
 *   - **The day range is judged before the request is spent.** A reversed range
 *     and a range wider than the server's ceiling are both refused as validation
 *     failures, and a refused read reaches a table as the general error state —
 *     "something went wrong", with a Retry that repeats the same refusal. The
 *     operator is told which date to change instead.
 *   - **The zero-row sentence is this screen's.** The criteria are held OUTSIDE
 *     the table request on purpose, so the table cannot tell a narrowed search
 *     from an empty trail: left to itself it announced "Nothing here yet" — a
 *     claim about every change ever made from this console — on the evidence of
 *     one window that happened to hold none.
 *
 *     Only the WORDING is this screen's. The state itself is the design
 *     system's empty state, with the title and description overridden, because
 *     the shell around it is what carries `role="status"`, the heading and the
 *     icon. A plain paragraph in its place told a sighted operator the search
 *     had matched nothing and told a screen-reader operator nothing at all: the
 *     rows simply vanished with no announcement and no heading to land on.
 *
 * ## On Material UI (ADR-022)
 *
 * The trail is the operational grid over the same read, paged by the server's
 * cursor under the applied criteria. The two days are day pickers on UTC, which
 * is the clock `auditCriteria` reads them on; they read no working context,
 * because a console operator has none. A day left blank or only partly typed is
 * refused on its own box before a request is spent: the picker hands back no
 * day for either, and a request built from no day is refused by the server as
 * the undifferentiated error this screen exists to avoid.
 *
 * ## One entry, whole
 *
 * A row opens the entry it stands for in a drawer. The search read already
 * carries every field of an entry, so the drawer reads nothing: it shows the
 * row in hand. Every field is there, and nothing is rewritten — where the
 * screen has words for a value (the change, who made it, the kind of record,
 * the organisation's name) the words are shown AND the value as it was
 * recorded, in its own element with exactly the characters the read returned;
 * where it has none (the account, the record, the support reference, the entry
 * itself) the reference is shown under a label that says what it is. A field
 * the entry does not hold is said to be not recorded, never left blank.
 *
 * The grid follows the same rule in less room: a change or a kind of record
 * this console has no words for keeps its neutral label and shows its code
 * beneath; an organisation that is not among the choices the page read shows
 * its reference beneath; and the account is shown by its whole reference, cut
 * only by the cell's own ellipsis, with the whole value behind it.
 */

const ENTITY_KEYS: Readonly<Record<string, string>> = {
  'org.tenant': 'platform.audit.entity.organization',
  'org.subscription_plan': 'platform.audit.entity.plan',
  'org.tenant_subscription': 'platform.audit.entity.subscription',
  'org.subscription_charge': 'platform.audit.entity.charge',
  'org.subscription_receipt': 'platform.audit.entity.receipt',
};

/** The clock both days are read on — see `auditCriteria`. */
const AUDIT_DAY_ZONE = 'UTC';

/** A day range as the instants the operation accepts, inclusive of both days. */
export function auditCriteria(input: {
  readonly fromDay: string;
  readonly toDay: string;
  readonly action: string;
  readonly organizationId: string;
}): PlatformAuditCriteria {
  return {
    from: `${input.fromDay}T00:00:00.000Z`,
    to: `${input.toDay}T23:59:59.999Z`,
    ...(input.action ? { action: input.action } : {}),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
  };
}

/** Whether this console has its own words for a change. */
function isNamedAction(action: string): boolean {
  return (PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(action);
}

function entityKey(entityType: string): string {
  return Object.hasOwn(ENTITY_KEYS, entityType)
    ? (ENTITY_KEYS[entityType] as string)
    : 'platform.audit.entity.other';
}

function actorKey(actorKind: string): string {
  return actorKind === 'user' ? 'platform.audit.actor.user' : 'platform.audit.actor.system';
}

/** A value as it was recorded: left to right, selectable whole, never cut. */
function Recorded({ value }: { readonly value: string }) {
  return (
    <code data-audit-verbatim dir="ltr" className="select-all whitespace-pre-wrap font-mono">
      {value}
    </code>
  );
}

export function PlatformAuditScreen({
  locale,
  messages,
  initialFrom,
  initialTo,
  initialOrganizationId,
  organizations,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly initialFrom: string;
  readonly initialTo: string;
  readonly initialOrganizationId: string;
  readonly organizations: readonly OrganizationRow[];
}) {
  const t = useCallback((key: string) => translateDynamic(messages, key), [messages]);
  const [fromDay, setFromDay] = useState(initialFrom);
  const [toDay, setToDay] = useState(initialTo);
  // What each picker finds wrong with its own entry: a day only partly typed,
  // a day that cannot be one, or nothing.
  const [fromProblem, setFromProblem] = useState<DayProblem>(null);
  const [toProblem, setToProblem] = useState<DayProblem>(null);
  const [action, setAction] = useState('');
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [applied, setApplied] = useState<PlatformAuditCriteria>(() =>
    auditCriteria({
      fromDay: initialFrom,
      toDay: initialTo,
      action: '',
      organizationId: initialOrganizationId,
    })
  );
  const [windowProblem, setWindowProblem] = useState<string | null>(null);
  // The boxes that held no day when the criteria were last asked for.
  const [missingDay, setMissingDay] = useState<{ readonly from: boolean; readonly to: boolean }>({
    from: false,
    to: false,
  });
  const [viewing, setViewing] = useState<PlatformAuditEvent | null>(null);

  const table = useServerTable<PlatformAuditEvent>(
    (request, cursor) => searchPlatformAudit(applied, request, cursor),
    { loadKey: JSON.stringify(applied) }
  );

  const names = useMemo(
    () => new Map(organizations.map((entry) => [entry.id, entry.displayName])),
    [organizations]
  );

  const columns = useMemo<readonly OperationalColumn<PlatformAuditEvent>[]>(
    () => [
      {
        id: 'time',
        headerKey: 'platform.audit.column.time',
        flex: 2,
        minChars: 24,
        cell: (row) => formatDateTime(row.occurredAt, locale),
      },
      {
        id: 'action',
        headerKey: 'platform.audit.column.action',
        flex: 2,
        cell: (row) => (
          <TwoLineCell
            primary={t(auditActionKey(row.action))}
            // A change this console has no words for: its code, beneath.
            secondary={isNamedAction(row.action) ? null : <code dir="ltr">{row.action}</code>}
          />
        ),
      },
      {
        id: 'actor',
        headerKey: 'platform.audit.column.actor',
        flex: 2,
        cell: (row) => (
          <TwoLineCell
            primary={t(actorKey(row.actorKind))}
            // The read names no account, so the reference is what there is —
            // whole, never a prefix of it.
            secondary={row.actorId === null ? null : <code dir="ltr">{row.actorId}</code>}
            testId="platform-audit-actor"
          />
        ),
      },
      {
        id: 'organization',
        headerKey: 'platform.audit.column.organization',
        flex: 2,
        cell: (row) => {
          if (row.targetTenantId === null) return '—';
          const name = names.get(row.targetTenantId);
          return name === undefined ? (
            <TwoLineCell
              primary={t('platform.audit.unknownOrganization')}
              secondary={<code dir="ltr">{row.targetTenantId}</code>}
            />
          ) : (
            <TwoLineCell primary={<bdi>{name}</bdi>} />
          );
        },
      },
      {
        id: 'summary',
        headerKey: 'platform.audit.column.summary',
        cell: (row) => (
          <TwoLineCell
            primary={t(entityKey(row.entityType))}
            secondary={
              Object.hasOwn(ENTITY_KEYS, row.entityType) ? null : (
                <code dir="ltr">{row.entityType}</code>
              )
            }
          />
        ),
      },
    ],
    [locale, names, t]
  );

  const rowActions = useCallback(
    (row: PlatformAuditEvent): readonly RowAction[] => [
      {
        kind: 'button',
        label: t('platform.audit.detail.open'),
        about: `${t(auditActionKey(row.action))}, ${formatDateTime(row.occurredAt, locale)}`,
        onClick: () => setViewing(row),
      },
    ],
    [locale, t]
  );

  const dayMissing = t('platform.error.date');
  const toError = missingDay.to
    ? dayMissing
    : windowProblem === null
      ? undefined
      : windowProblem === 'platform.audit.error.window'
        ? formatMessage(t(windowProblem), {
            days: formatInteger(AUDIT_MAX_WINDOW_DAYS, locale),
          })
        : t(windowProblem);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <form
        noValidate
        className="flex flex-wrap items-start gap-3"
        data-testid="platform-audit-criteria"
        onSubmit={(event) => {
          event.preventDefault();
          // No day, or a day not finished: said on its own box, and nothing is
          // asked of the server.
          const missing = {
            from: fromProblem !== null || fromDay === '',
            to: toProblem !== null || toDay === '',
          };
          setMissingDay(missing);
          if (missing.from || missing.to) {
            setWindowProblem(null);
            return;
          }
          const problem = auditWindowProblem(fromDay, toDay);
          setWindowProblem(problem);
          if (problem !== null) return;
          setApplied(auditCriteria({ fromDay, toDay, action, organizationId }));
        }}
      >
        <div className="w-full max-w-xs">
          <ZonedDateField
            name="from"
            timezone={AUDIT_DAY_ZONE}
            label={t('platform.audit.from')}
            required
            value={fromDay}
            onChange={setFromDay}
            onProblem={setFromProblem}
            onEdit={() => {
              setWindowProblem(null);
              setMissingDay((current) => ({ ...current, from: false }));
            }}
            error={missingDay.from ? dayMissing : undefined}
            testId="platform-audit-from"
          />
        </div>
        <div className="w-full max-w-xs">
          <ZonedDateField
            name="to"
            timezone={AUDIT_DAY_ZONE}
            label={t('platform.audit.to')}
            required
            value={toDay}
            onChange={setToDay}
            onProblem={setToProblem}
            onEdit={() => {
              setWindowProblem(null);
              setMissingDay((current) => ({ ...current, to: false }));
            }}
            /*
             * Both window refusals are about the END of the window, which is
             * the field the server names too (`query.to`), and only one of the
             * two can be true at a time.
             */
            error={toError}
            testId="platform-audit-to"
          />
        </div>
        <div className="w-full max-w-xs">
          <FormSelectField
            name="action"
            label={t('platform.audit.column.action')}
            value={action}
            placeholder={t('platform.audit.allActions')}
            onChange={setAction}
            options={PLATFORM_AUDIT_ACTIONS.map((code) => ({
              value: code,
              label: t(auditActionKey(code)),
            }))}
          />
        </div>
        <div className="w-full max-w-xs">
          <FormSelectField
            name="organization"
            label={t('platform.audit.column.organization')}
            value={organizationId}
            placeholder={t('platform.audit.allOrganizations')}
            onChange={setOrganizationId}
            options={[
              ...organizations.map((entry) => ({ value: entry.id, label: entry.displayName })),
              ...(initialOrganizationId && !names.has(initialOrganizationId)
                ? [
                    {
                      value: initialOrganizationId,
                      label: t('platform.audit.selectedOrganization'),
                    },
                  ]
                : []),
            ]}
          />
        </div>
        <Button type="submit" variant="contained">
          {t('platform.audit.apply')}
        </Button>
      </form>

      <OperationalGrid<PlatformAuditEvent>
        messages={messages}
        locale={locale}
        label={t('platform.audit.title')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={rowActions}
        // "No change matches these dates and filters" is this screen's own
        // sentence, below: the window always narrows the trail.
        suppressEmptyState
        testId="platform-audit-grid"
      />

      {table.status === 'idle' && (table.response?.rows.length ?? 0) === 0 ? (
        <div data-testid="platform-audit-empty">
          {/*
            The design system's own no-result wording for the title, this
            screen's sentence for the description: "No matches" is true of a
            search, where "Nothing here yet" is a claim about the whole record.
          */}
          <MuiEmptyState
            messages={messages}
            titleKey="state.noResults.title"
            descriptionKey="platform.audit.noMatches"
          />
        </div>
      ) : null}

      {viewing ? (
        <AuditEntryDrawer
          key={viewing.id}
          locale={locale}
          messages={messages}
          entry={viewing}
          organizationName={
            viewing.targetTenantId === null ? undefined : names.get(viewing.targetTenantId)
          }
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One entry of the trail, whole — see "One entry, whole" above.
 *
 * Material's drawer keeps Tab inside while it is open and returns focus to the
 * button that opened it; Escape and Close both close it, and a closed drawer
 * leaves the page at once.
 */
function AuditEntryDrawer({
  locale,
  messages,
  entry,
  organizationName,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly entry: PlatformAuditEvent;
  /** The organisation's name, when it is among the choices the page read. */
  readonly organizationName: string | undefined;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const titleId = useId();
  const reducedMotion = useReducedMotion();
  const notRecorded = (
    <span className="text-text-secondary">{t('platform.audit.detail.notRecorded')}</span>
  );

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
          'data-testid': 'platform-audit-detail',
        } as Record<string, unknown>,
      }}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-section-title font-medium text-text-primary">
            {t('platform.audit.detail.title')}
          </h2>
          <Button type="button" variant="outlined" size="small" onClick={onClose} autoFocus>
            {translate(messages, 'overlay.close')}
          </Button>
        </div>
        <dl className="flex flex-col gap-4">
          <EntryField
            messages={messages}
            field="action"
            term={t('platform.audit.column.action')}
            words={t(auditActionKey(entry.action))}
            recorded={entry.action}
          />
          <EntryField
            messages={messages}
            field="occurredAt"
            term={t('platform.audit.column.time')}
            words={formatDateTime(entry.occurredAt, locale)}
            recorded={entry.occurredAt}
          />
          <EntryField
            messages={messages}
            field="actorKind"
            term={t('platform.audit.column.actor')}
            words={t(actorKey(entry.actorKind))}
            recorded={entry.actorKind}
          />
          <EntryField
            messages={messages}
            field="actorId"
            term={t('platform.audit.detail.accountReference')}
            reference={entry.actorId ?? notRecorded}
          />
          <EntryField
            messages={messages}
            field="targetTenantId"
            term={t('platform.audit.column.organization')}
            {...(entry.targetTenantId === null
              ? { reference: notRecorded }
              : {
                  words: <bdi>{organizationName ?? t('platform.audit.unknownOrganization')}</bdi>,
                  recorded: entry.targetTenantId,
                })}
          />
          <EntryField
            messages={messages}
            field="entityType"
            term={t('platform.audit.column.summary')}
            words={t(entityKey(entry.entityType))}
            recorded={entry.entityType}
          />
          <EntryField
            messages={messages}
            field="entityId"
            term={t('platform.audit.detail.recordReference')}
            reference={entry.entityId ?? notRecorded}
          />
          <EntryField
            messages={messages}
            field="correlationId"
            term={t('platform.audit.detail.supportReference')}
            reference={entry.correlationId ?? notRecorded}
          />
          <EntryField
            messages={messages}
            field="id"
            term={t('platform.audit.detail.entryReference')}
            reference={entry.id}
          />
        </dl>
      </div>
    </Drawer>
  );
}

/**
 * One field of an entry.
 *
 * Either words with the value as it was recorded beneath them (`words`,
 * `recorded`), or a reference that has no words (`reference`): a string is
 * drawn as recorded, and anything else — the sentence for a field the entry
 * does not hold — as it is given.
 */
function EntryField({
  messages,
  field,
  term,
  words,
  recorded,
  reference,
}: {
  readonly messages: Messages;
  /** The entry's own field, so a reader of the markup can tell the rows apart. */
  readonly field: keyof PlatformAuditEvent;
  readonly term: string;
  readonly words?: ReactNode;
  readonly recorded?: string | undefined;
  readonly reference?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1" data-testid="platform-audit-field" data-field={field}>
      <dt className="text-label font-medium text-text-secondary">{term}</dt>
      <dd className="break-all text-body text-text-primary">
        {words === undefined ? null : <span data-audit-words>{words}</span>}
        {recorded === undefined ? null : (
          <span className="block text-caption text-text-muted">
            {translate(messages, 'platform.audit.detail.recorded')} <Recorded value={recorded} />
          </span>
        )}
        {reference === undefined ? null : typeof reference === 'string' ? (
          <Recorded value={reference} />
        ) : (
          reference
        )}
      </dd>
    </div>
  );
}
