'use client';

import { useCallback, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import type { TableRequest } from '@/components/data-table/table-state';
import { SelectField, TextField } from '@/components/forms/Field';
import type { BranchTarget } from '@/lib/api/read-operation';
import { Drawer } from '@/components/overlays/Overlays';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import { useServerTable } from '../../shared/use-server-table';
import { listAuditEvents, readAuditEvent } from '../api';
import {
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

const PRIMARY_BUTTON =
  'rounded-lg bg-primary px-4 py-2 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';
const SECONDARY_BUTTON =
  'rounded-lg border border-border bg-surface px-4 py-2 text-button text-text-secondary hover:bg-surface-subtle';

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
 *
 * ## The criteria are the backend's, and they are applied on demand
 *
 * The list operation takes a fixed allow-list of bound parameters, and until now
 * the screen surfaced none of them: it sent the window and nothing else, so an
 * operator looking for one action in a quarter of records had to read the pages.
 * The text criteria travel with an optional authorized company/branch target.
 * Selecting a company prepares its branch choices; applying requires a pair.
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
  scopeOptions,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly initialFrom: string;
  readonly initialTo: string;
  readonly scopeOptions?: AuditScopeOptions;
}) {
  const t = useCallback((key: string) => translate(messages, key as keyof Messages), [messages]);

  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  // Two states, not one: `draft` is what the operator is typing and `applied`
  // is what the last read was made with. Collapsing them would make every
  // keystroke a request, and would also make the visible criteria disagree with
  // the rows on screen while a page is in flight.
  const [draft, setDraft] = useState<AuditFilters>(NO_AUDIT_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(NO_AUDIT_FILTERS);
  const [actorInvalid, setActorInvalid] = useState(false);
  const [draftTarget, setDraftTarget] = useState<BranchTarget>({ companyId: '', branchId: '' });
  const [appliedTarget, setAppliedTarget] = useState<BranchTarget | null>(null);
  const [targetInvalid, setTargetInvalid] = useState(false);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listAuditEvents(
        request,
        cursor,
        {
          from: `${range.from}T00:00:00.000Z`,
          to: `${range.to}T23:59:59.999Z`,
        },
        applied,
        appliedTarget
      ),
    [range.from, range.to, applied, appliedTarget]
  );

  // The range is what `load` closes over, so it is what must invalidate the
  // held page. Without it the effect key never moved and changing the dates
  // re-rendered the same rows (P1-26-F-019). The applied criteria close over it
  // for the same reason, and they must also reset the page: page four of an
  // unfiltered set is not page four of a filtered one, and a cursor taken from
  // the first is meaningless against the second.
  const table = useServerTable<AuditRow>(load, {
    loadKey: `${range.from}..${range.to}#${applied.action}#${applied.entityType}#${applied.actorId}#${appliedTarget?.companyId ?? ''}#${appliedTarget?.branchId ?? ''}`,
  });

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

      <form
        aria-label={t('audit.filter.formLabel')}
        className="flex flex-wrap items-start gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const actorId = draft.actorId.trim();
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
            <SelectField
              label={t('audit.filter.company')}
              value={draftTarget.companyId}
              placeholder={t('audit.filter.allCompanies')}
              options={scopeOptions.companies.map((company) => ({
                value: company.id,
                label: company.legalName,
              }))}
              onChange={(event) => {
                setDraftTarget({ companyId: event.target.value, branchId: '' });
                setTargetInvalid(false);
              }}
            />
            <SelectField
              label={t('audit.filter.branch')}
              value={draftTarget.branchId}
              disabled={!draftTarget.companyId}
              placeholder={t('field.selectPlaceholder')}
              options={scopeOptions.branches
                .filter((branch) => branch.companyId === draftTarget.companyId)
                .map((branch) => ({ value: branch.id, label: branch.name }))}
              error={targetInvalid ? t('audit.filter.chooseBranch') : undefined}
              onChange={(event) =>
                setDraftTarget((current) => ({ ...current, branchId: event.target.value }))
              }
            />
          </>
        ) : scopeOptions ? (
          <p className="w-full text-caption text-text-muted">
            {t('audit.filter.scopeUnavailable')}
          </p>
        ) : null}
        <TextField
          label={t('audit.filter.action')}
          spellCheck={false}
          dir="ltr"
          value={draft.action}
          onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
        />
        <TextField
          label={t('audit.filter.entityType')}
          spellCheck={false}
          dir="ltr"
          value={draft.entityType}
          onChange={(event) =>
            setDraft((current) => ({ ...current, entityType: event.target.value }))
          }
        />
        <TextField
          label={t('audit.filter.actor')}
          description={t('audit.filter.identifierHelp')}
          spellCheck={false}
          dir="ltr"
          value={draft.actorId}
          onChange={(event) => setDraft((current) => ({ ...current, actorId: event.target.value }))}
          error={actorInvalid ? t('audit.filter.idFormat') : undefined}
        />
        <div className="flex items-center gap-2 pt-6">
          <button type="submit" className={PRIMARY_BUTTON}>
            {t('audit.filter.apply')}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={() => {
              setDraft(NO_AUDIT_FILTERS);
              setApplied(NO_AUDIT_FILTERS);
              setActorInvalid(false);
              setDraftTarget({ companyId: '', branchId: '' });
              setAppliedTarget(null);
              setTargetInvalid(false);
            }}
          >
            {t('audit.filter.clear')}
          </button>
        </div>
        <p className="w-full text-caption text-text-muted">{t('audit.filter.hint')}</p>
      </form>

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
