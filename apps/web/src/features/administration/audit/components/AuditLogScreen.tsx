'use client';

import { useCallback, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import type { TableRequest } from '@/components/data-table/table-state';
import { TextField } from '@/components/forms/Field';
import { Drawer } from '@/components/overlays/Overlays';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import { useServerTable } from '../../shared/use-server-table';
import { listAuditEvents, readAuditEvent } from '../api';
import type { AuditDetail, AuditRow } from '../types';

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
 * ## No export
 *
 * There is no export operation for audit records, so none is offered. An export
 * built here would be a client-side copy of restricted data leaving through a
 * path with no server-side authorization and no export audit — which is exactly
 * what the export policy exists to prevent.
 */
export function AuditLogScreen({
  locale,
  messages,
  initialFrom,
  initialTo,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly initialFrom: string;
  readonly initialTo: string;
}) {
  const t = useCallback((key: string) => translate(messages, key as keyof Messages), [messages]);

  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listAuditEvents(request, cursor, {
        from: `${range.from}T00:00:00.000Z`,
        to: `${range.to}T23:59:59.999Z`,
      }),
    [range.from, range.to]
  );

  // The range is what `load` closes over, so it is what must invalidate the
  // held page. Without it the effect key never moved and changing the dates
  // re-rendered the same rows (P1-26-F-019).
  const table = useServerTable<AuditRow>(load, { loadKey: `${range.from}..${range.to}` });

  const columns: readonly Column<AuditRow>[] = [
    {
      id: 'occurredAt',
      headerKey: 'audit.column.occurredAt',
      // `occurredAt` is REQUIRED by the published record. There is no
      // `createdAt` on it, and the fallback that read one was guesswork.
      cell: (row) => formatDateTime(row.occurredAt, locale),
    },
    {
      id: 'actor',
      headerKey: 'audit.column.actor',
      cell: (row) =>
        row.actorId ? <code className="break-all font-mono text-caption">{row.actorId}</code> : '—',
    },
    {
      id: 'action',
      headerKey: 'audit.column.action',
      cell: (row) => <code className="font-mono text-caption">{row.action}</code>,
    },
    {
      id: 'entity',
      headerKey: 'audit.column.entity',
      cell: (row) => (
        <span className="text-text-secondary">
          {row.entityType}
          {row.entityId ? (
            <code className="ms-1 break-all font-mono text-caption">{row.entityId}</code>
          ) : null}
        </span>
      ),
    },
    {
      id: 'correlationId',
      headerKey: 'audit.column.correlationId',
      cell: (row) =>
        row.correlationId ? (
          <code className="break-all font-mono text-caption">{row.correlationId}</code>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          type="date"
          label={t('audit.from')}
          value={range.from}
          onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))}
        />
        <TextField
          type="date"
          label={t('audit.to')}
          value={range.to}
          onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
        />
        <p className="text-supporting text-text-muted">{t('audit.rangeHint')}</p>
      </div>

      <p className="text-caption text-text-muted">
        {t('audit.readOnly')} {t('audit.viewedNotice')} {t('audit.noExport')}
      </p>

      <DataTable<AuditRow>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        density="compact"
        caption={t('audit.title')}
        rowActions={(row) => (
          <button
            type="button"
            disabled={detailBusy}
            onClick={async () => {
              setDetailBusy(true);
              const result = await readAuditEvent(row.id);
              setDetailBusy(false);
              if (result.status === 'ok' && result.record) setDetail(result.record);
            }}
            className="rounded-md border border-border bg-surface px-2 py-1 text-caption text-text-secondary transition-colors duration-fast ease-standard hover:bg-surface-subtle hover:text-text-primary disabled:cursor-not-allowed"
          >
            {t('admin.open')}
          </button>
        )}
      />

      <Drawer
        open={detail !== null}
        onClose={() => setDetail(null)}
        messages={messages}
        title={t('audit.detail.title')}
      >
        {detail ? (
          <dl className="flex flex-col gap-4">
            <Row label={t('audit.column.action')} value={detail.action} mono />
            <Row
              label={t('audit.column.occurredAt')}
              value={formatDateTime(detail.occurredAt, locale)}
            />
            <Row label={t('audit.column.entity')} value={detail.entityType} />
            <Row label={t('audit.column.actor')} value={detail.actorId ?? detail.actorKind} mono />
            <Row label={t('audit.column.correlationId')} value={detail.correlationId ?? '—'} mono />

            <div>
              <dt className="text-label font-medium text-text-primary">
                {t('audit.detail.details')}
              </dt>
              <dd className="mt-1">
                {/*
                  `details` ABSENT and `details` EMPTY are different facts:
                  the caller may not read them, or the record has none. They
                  render differently.
                */}
                {detail.details === undefined ? (
                  <p className="text-body text-text-muted">{t('audit.detail.masked')}</p>
                ) : detail.details.length === 0 ? (
                  <p className="text-body text-text-muted">—</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {detail.details.map((entry) => (
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
        ) : null}
      </Drawer>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-label font-medium text-text-primary">{label}</dt>
      <dd className={`text-body text-text-secondary ${mono ? 'break-all font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
