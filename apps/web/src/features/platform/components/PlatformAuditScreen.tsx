'use client';

import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import type { TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField, TextField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translateDynamic } from '@/i18n/get-messages';
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
import { PRIMARY_BUTTON } from './ui';

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
 */

const ENTITY_KEYS: Readonly<Record<string, string>> = {
  'org.tenant': 'platform.audit.entity.organization',
  'org.subscription_plan': 'platform.audit.entity.plan',
  'org.tenant_subscription': 'platform.audit.entity.subscription',
  'org.subscription_charge': 'platform.audit.entity.charge',
  'org.subscription_receipt': 'platform.audit.entity.receipt',
};

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
  const t = (key: string) => translateDynamic(messages, key);
  const [fromDay, setFromDay] = useState(initialFrom);
  const [toDay, setToDay] = useState(initialTo);
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

  const table = useServerTable<PlatformAuditEvent>(
    (request, cursor) => searchPlatformAudit(applied, request, cursor),
    { loadKey: JSON.stringify(applied) }
  );

  const names = useMemo(
    () => new Map(organizations.map((entry) => [entry.id, entry.displayName])),
    [organizations]
  );

  const columns: readonly Column<PlatformAuditEvent>[] = [
    {
      id: 'time',
      headerKey: 'platform.audit.column.time',
      cell: (row) => formatDateTime(row.occurredAt, locale),
    },
    {
      id: 'action',
      headerKey: 'platform.audit.column.action',
      cell: (row) => t(auditActionKey(row.action)),
    },
    {
      id: 'actor',
      headerKey: 'platform.audit.column.actor',
      cell: (row) => (
        <span>
          {t(
            row.actorKind === 'user' ? 'platform.audit.actor.user' : 'platform.audit.actor.system'
          )}
          {row.actorId ? (
            <span dir="ltr" className="ms-1 font-mono text-caption text-text-muted">
              {row.actorId.slice(0, 8)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'organization',
      headerKey: 'platform.audit.column.organization',
      cell: (row) =>
        row.targetTenantId
          ? (names.get(row.targetTenantId) ?? t('platform.audit.unknownOrganization'))
          : '—',
    },
    {
      id: 'summary',
      headerKey: 'platform.audit.column.summary',
      cell: (row) => t(ENTITY_KEYS[row.entityType] ?? 'platform.audit.entity.other'),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const problem = auditWindowProblem(fromDay, toDay);
          setWindowProblem(problem);
          if (problem !== null) return;
          setApplied(auditCriteria({ fromDay, toDay, action, organizationId }));
        }}
      >
        <div className="w-44">
          <TextField
            name="from"
            type="date"
            label={t('platform.audit.from')}
            required
            value={fromDay}
            onChange={(event) => {
              setFromDay(event.target.value);
              setWindowProblem(null);
            }}
          />
        </div>
        <div className="w-44">
          <TextField
            name="to"
            type="date"
            label={t('platform.audit.to')}
            required
            value={toDay}
            onChange={(event) => {
              setToDay(event.target.value);
              setWindowProblem(null);
            }}
            /*
             * Both refusals are about the END of the window, which is the field
             * the server names too (`query.to`), and only one of the two can be
             * true at a time.
             */
            error={
              windowProblem === null
                ? undefined
                : windowProblem === 'platform.audit.error.window'
                  ? formatMessage(t(windowProblem), {
                      days: formatInteger(AUDIT_MAX_WINDOW_DAYS, locale),
                    })
                  : t(windowProblem)
            }
          />
        </div>
        <div className="w-60">
          <SelectField
            name="action"
            label={t('platform.audit.column.action')}
            value={action}
            placeholder={t('platform.audit.allActions')}
            onChange={(event) => setAction(event.target.value)}
            options={PLATFORM_AUDIT_ACTIONS.map((code) => ({
              value: code,
              label: t(auditActionKey(code)),
            }))}
          />
        </div>
        <div className="w-60">
          <SelectField
            name="organization"
            label={t('platform.audit.column.organization')}
            value={organizationId}
            placeholder={t('platform.audit.allOrganizations')}
            onChange={(event) => setOrganizationId(event.target.value)}
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
        <button type="submit" className={PRIMARY_BUTTON}>
          {t('platform.audit.apply')}
        </button>
      </form>

      <DataTable<PlatformAuditEvent>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={(next: TableRequest) => table.setRequest(next)}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={t('platform.audit.title')}
        suppressEmptyState
      />

      {table.status === 'idle' && (table.response?.rows.length ?? 0) === 0 ? (
        <p data-testid="platform-audit-empty" className="text-body text-text-muted">
          {t('platform.audit.noMatches')}
        </p>
      ) : null}
    </div>
  );
}
