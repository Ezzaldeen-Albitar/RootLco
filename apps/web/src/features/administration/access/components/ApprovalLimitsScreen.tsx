'use client';

import { useActionState, useState, useTransition } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { SelectField, TextField } from '@/components/forms/Field';
import { Dialog } from '@/components/overlays/Overlays';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { formatMoney } from '@/lib/money';
import { intlLocale } from '@/lib/format';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { SubmitButton } from '@/features/authentication/components/SubmitButton';
import { useServerTable } from '../../shared/use-server-table';
import { listApprovalLimits } from '../api';
import type { ApprovalLimitRow, RoleRow } from '../types';
import { createApprovalLimitAction, endApprovalLimitAction } from '../actions';

/**
 * Approval limits.
 *
 * ## Money never becomes a number
 *
 * `amount` arrives as a decimal string, is validated by pattern, is displayed
 * through `formatMoney` — the one function permitted to hand a canonical string
 * to `Intl` — and is submitted as the string the operator typed. Nothing here
 * calls `Number()`, `parseFloat`, `toFixed`, or an arithmetic operator on an
 * amount. The column is `numeric(18,4)`; a double cannot hold it.
 *
 * ## No approval hierarchy is invented
 *
 * `limitType` and `currency` are operator-supplied. The contract fixes their
 * *shape* — `^[a-z][a-z0-9_]{1,62}$` and `^[A-Z]{3}$` — and not their meaning,
 * so this screen supplies neither a default limit type nor a default currency,
 * and implies no ordering between types.
 *
 * ## The list is complete, and says so
 *
 * `GET /iam/approval-limits` takes filters and no cursor: it returns the whole
 * set. So the table is given a real `total` and pages it client-side, and the
 * screen states that this is the complete list rather than a page of one.
 * Client-side paging of a complete set is arithmetic; paging a *window* and
 * calling it a set is the thing that must never happen.
 */
export function ApprovalLimitsScreen({
  locale,
  messages,
  roles,
  companyIds,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly roles: readonly RoleRow[];
  readonly companyIds: readonly string[];
  readonly canManage: boolean;
}) {
  const table = useServerTable<ApprovalLimitRow>(listApprovalLimits);
  const [createOpen, setCreateOpen] = useState(false);
  const [ending, setEnding] = useState<ApprovalLimitRow | null>(null);
  const [endDate, setEndDate] = useState('');
  const [state, setState] = useState<ActionState>(IDLE);
  const [running, start] = useTransition();

  const t = (key: string) => translate(messages, key as keyof Messages);
  const roleName = (id: string | null) =>
    id ? (roles.find((role) => role.id === id)?.name ?? id) : null;

  const columns: readonly Column<ApprovalLimitRow>[] = [
    {
      id: 'subject',
      headerKey: 'approvalLimits.column.subject',
      cell: (row) =>
        row.roleId ? (
          <span>
            <span className="text-text-muted">{t('approvalLimits.subject.role')}: </span>
            {roleName(row.roleId)}
          </span>
        ) : (
          <span>
            <span className="text-text-muted">{t('approvalLimits.subject.user')}: </span>
            <code className="font-mono text-caption">{row.userId}</code>
          </span>
        ),
    },
    {
      id: 'limitType',
      headerKey: 'approvalLimits.column.type',
      cell: (row) => <code className="font-mono text-caption">{row.limitType}</code>,
    },
    {
      id: 'amount',
      headerKey: 'approvalLimits.column.amount',
      numeric: true,
      // `currencyCode`, because that is what the API publishes on the read
      // path even though the create body takes `currency` (P1-26-F-016).
      cell: (row) =>
        formatMoney({ amount: row.amount, currency: row.currencyCode }, intlLocale(locale)),
    },
    {
      id: 'effectiveFrom',
      headerKey: 'approvalLimits.column.from',
      cell: (row) => row.effectiveFrom,
    },
    {
      id: 'effectiveTo',
      headerKey: 'approvalLimits.column.to',
      cell: (row) => row.effectiveTo ?? '—',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {state.status !== 'idle' && !ending ? (
        <FormFeedback state={state} messages={messages} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-supporting text-text-muted">
          {table.response && table.response.total === null
            ? t('approvalLimits.mayBeTruncated')
            : t('approvalLimits.completeList')}
        </p>
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setState(IDLE);
              setCreateOpen(true);
            }}
            className="rounded-lg bg-primary px-4 py-2 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {t('approvalLimits.create')}
          </button>
        ) : null}
      </div>

      <DataTable<ApprovalLimitRow>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={t('approvalLimits.title')}
        rowActions={(row) =>
          canManage && row.effectiveTo === null ? (
            <button
              type="button"
              onClick={() => {
                setState(IDLE);
                setEndDate('');
                setEnding(row);
              }}
              className="rounded-md border border-border bg-surface px-2 py-1 text-caption text-text-secondary transition-colors duration-fast ease-standard hover:bg-surface-subtle hover:text-text-primary"
            >
              {t('approvalLimits.end')}
            </button>
          ) : null
        }
      />

      {/* Mounted only while open, so its action state cannot survive a close. */}
      {createOpen ? (
        <CreateDialog
          open
          messages={messages}
          roles={roles}
          companyIds={companyIds}
          onClose={() => {
            setCreateOpen(false);
            table.refresh();
          }}
        />
      ) : null}

      {ending ? (
        <Dialog
          open
          onClose={() => setEnding(null)}
          messages={messages}
          width="sm"
          title={t('approvalLimits.end.title')}
          description={t('approvalLimits.end.body')}
          footer={
            <>
              <button
                type="button"
                onClick={() => setEnding(null)}
                className="rounded-md border border-border bg-surface px-4 py-2 text-button text-text-secondary hover:bg-surface-subtle"
              >
                {t('admin.cancel')}
              </button>
              <button
                type="button"
                disabled={running || endDate.length === 0}
                aria-busy={running || undefined}
                onClick={() => {
                  const limit = ending;
                  start(async () => {
                    const result = await endApprovalLimitAction(
                      limit.id,
                      limit.recordVersion,
                      endDate
                    );
                    setState(result);
                    if (result.status === 'success') {
                      setEnding(null);
                      table.refresh();
                    }
                  });
                }}
                className="rounded-md bg-primary px-4 py-2 text-button font-medium text-on-primary hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {running ? t('admin.saving') : t('admin.save')}
              </button>
            </>
          }
        >
          <TextField
            type="date"
            label={t('approvalLimits.field.effectiveTo')}
            value={endDate}
            required
            onChange={(event) => setEndDate(event.target.value)}
            error={
              state.status !== 'idle' && state.status !== 'success'
                ? t(state.messageKey ?? 'admin.actionFailed')
                : undefined
            }
          />
        </Dialog>
      ) : null}
    </div>
  );
}

function CreateDialog({
  open,
  messages,
  roles,
  companyIds,
  onClose,
}: {
  readonly open: boolean;
  readonly messages: Messages;
  readonly roles: readonly RoleRow[];
  readonly companyIds: readonly string[];
  readonly onClose: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    createApprovalLimitAction,
    IDLE
  );
  const [subject, setSubject] = useState<'role' | 'user'>('role');
  const t = (key: string) => translate(messages, key as keyof Messages);
  const error = (name: string) => {
    const key = state.fieldErrors?.[name];
    return key ? t(key) : undefined;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      messages={messages}
      title={t('approvalLimits.create.title')}
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />

        {companyIds.length > 0 ? (
          <SelectField
            name="companyId"
            label={t('approvalLimits.field.companyId')}
            description={t('admin.contractGap.noDirectory')}
            options={companyIds.map((id) => ({ value: id, label: id }))}
            error={error('companyId')}
          />
        ) : (
          <TextField
            name="companyId"
            label={t('approvalLimits.field.companyId')}
            description={t('admin.scope.noneResolved')}
            required
            spellCheck={false}
            error={error('companyId')}
          />
        )}

        <SelectField
          name="subject"
          label={t('approvalLimits.field.subject')}
          value={subject}
          onChange={(event) => setSubject(event.target.value as 'role' | 'user')}
          options={[
            { value: 'role', label: t('approvalLimits.subject.role') },
            { value: 'user', label: t('approvalLimits.subject.user') },
          ]}
          error={error('subject')}
        />

        {subject === 'role' ? (
          <SelectField
            name="roleId"
            label={t('approvalLimits.field.roleId')}
            options={roles.map((role) => ({ value: role.id, label: role.name }))}
            error={error('roleId')}
          />
        ) : (
          <TextField
            name="userId"
            label={t('approvalLimits.field.userId')}
            required
            spellCheck={false}
            error={error('userId')}
          />
        )}

        <TextField
          name="limitType"
          label={t('approvalLimits.field.limitType')}
          description={t('approvalLimits.field.limitTypeHint')}
          required
          spellCheck={false}
          error={error('limitType')}
        />

        {/*
          `inputMode="decimal"` and NOT `type="number"`. A number input hands back
          a value the browser has already coerced, drops trailing zeros, and
          differs between locales on the decimal separator — all of which are
          ways an exact amount stops being exact before it leaves the page.
        */}
        <TextField
          name="amount"
          inputMode="decimal"
          label={t('approvalLimits.field.amount')}
          required
          spellCheck={false}
          error={error('amount')}
        />

        <TextField
          name="currency"
          label={t('approvalLimits.field.currency')}
          description={t('approvalLimits.field.currencyHint')}
          required
          maxLength={3}
          spellCheck={false}
          error={error('currency')}
        />

        <TextField
          name="effectiveFrom"
          type="date"
          label={t('approvalLimits.field.effectiveFrom')}
          required
          error={error('effectiveFrom')}
        />
        <TextField
          name="effectiveTo"
          type="date"
          label={t('approvalLimits.field.effectiveTo')}
          optionalHint={t('field.optional')}
          error={error('effectiveTo')}
        />

        <div className="flex justify-end gap-2">
          {state.status === 'success' ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-button text-text-secondary hover:bg-surface-subtle"
            >
              {t('admin.close')}
            </button>
          ) : (
            <SubmitButton
              label={t('admin.create')}
              pendingLabel={t('admin.creating')}
              full={false}
            />
          )}
        </div>
      </form>
    </Dialog>
  );
}
