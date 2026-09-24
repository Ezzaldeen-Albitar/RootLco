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
import { RequiresConcreteBranch } from '@/features/working-context/components/WorkingBranchField';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import { SubmitButton } from '@/features/authentication/components/SubmitButton';
import { AccountPicker, type ChosenAccount } from '../../users/components/AccountPicker';
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
  canManage,
  canReadUsers = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly roles: readonly RoleRow[];
  readonly canManage: boolean;
  /**
   * `iam.user.read` — whether a person can be FOUND by name for a limit. Without
   * it the dialog keeps the labelled account reference it always had, because
   * `iam.approval-limit-create` does not need the user read (route sweep B3).
   */
  readonly canReadUsers?: boolean;
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
          locale={locale}
          messages={messages}
          roles={roles}
          canReadUsers={canReadUsers}
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
  locale,
  messages,
  roles,
  canReadUsers,
  onClose,
}: {
  readonly open: boolean;
  readonly locale: Locale;
  readonly messages: Messages;
  readonly roles: readonly RoleRow[];
  readonly canReadUsers: boolean;
  readonly onClose: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    createApprovalLimitAction,
    IDLE
  );
  const [subject, setSubject] = useState<'role' | 'user'>('role');
  /*
   * The company and the role are held in state for one reason only: the safe
   * shape needs something for `defaultValue` to be seeded FROM. They were plain
   * uncontrolled selects, which loses the operator's choice just as completely —
   * a refused create silently reverted the company to the first resolved id and
   * the role to the first row, and a retry that only corrected the amount then
   * granted the limit against a company nobody had chosen.
   *
   * Seeded from the FIRST option rather than the empty string, because neither
   * select offers a placeholder: with no matching option a browser selects the
   * first one, and state that said `''` while the control displayed a real id
   * would be the same divergence written the other way round.
   */
  /*
   * The typed values, retained for the same reason the two selects above are:
   * the Server Action settle resets the form DOM, and an UNCONTROLLED text box
   * is emptied by it exactly like a select. Measured on these components:
   *
   *     BEFORE {"subject":"user","userId":"9f2c…","amount":"12500.0000","note":"…"}
   *     AFTER  {"subject":"user","userId":"",     "amount":"",          "note":""}
   *
   * The amount is the one that matters most. A refusal here is usually ABOUT
   * the amount — `limitSchema` rejects more than four decimal places — so the
   * form was emptying the very field its error message names, and the operator
   * re-typed a currency figure from memory to satisfy a message about it.
   *
   * Held as raw strings, never parsed. `12500.0000` must come back as the
   * operator typed it: normalising it here would be this screen inventing a
   * value the server never saw and the operator never wrote.
   */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const retained = (name: string) => draft[name] ?? '';
  const retain = (name: string) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));
  /*
   * The companies this operator may act in, BY NAME.
   *
   * What this replaced was the session's `companyIds`: bare references with no
   * names, whose EMPTY state meant unrestricted rather than none. Those two
   * facts together produced the two controls this screen used to offer — a
   * select over strings nobody can read, and a free-text box for the operator
   * with the widest reach. The prop is gone from this component and from its
   * page; the working context is the only source now.
   */
  const { companies: workingCompanies } = useWorkingContext();
  const [companyId, setCompanyId] = useState(workingCompanies[0]?.id ?? '');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  /*
   * The person, FOUND by name or email (route sweep B3). Held in state like the
   * selects above, so the Server Action's form reset cannot lose it; the
   * account reference travels in a hidden field the reset cannot empty either.
   */
  const [person, setPerson] = useState<ChosenAccount | null>(null);
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

        {/*
          Every select in this dialog carries `key` + `defaultValue` + `onChange`
          together. React resets the form DOM once the Server Action settles, and
          neither a controlled `value=` nor a bare uncontrolled select survives
          it: the first is not re-written by the reconciler because the prop did
          not change, and the second reverts to its first option. `key` on the
          attempt forces the remount, `defaultValue` seeds it from state and is
          what `form.reset()` restores TO, and `onChange` keeps state current.
        */}
        {/*
          NAMED companies, from the working context.
          
          This control was the origin of `admin.contractGap.noDirectory` — "the
          service publishes no company or branch directory, so references are
          shown rather than names" — and of the free-text fallback shown to an
          operator whose session resolves to no company, which means
          unrestricted rather than none. `GET /auth/working-context` publishes
          the named, active companies this caller is authorized for, so both
          have gone: there is a directory now, and the sentence that said there
          was not would be false.

          The reference is still what is SENT — the operation takes a company
          identifier — and it is still authorized server-side. What changed is
          that the operator chooses by name.
        */}
        {workingCompanies.length > 0 ? (
          <SelectField
            key={`companyId-${state.attempt ?? 0}`}
            name="companyId"
            label={t('approvalLimits.field.companyId')}
            required
            defaultValue={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
            options={workingCompanies.map((company) => ({
              value: company.id,
              label: company.name,
            }))}
            placeholder={t('form.select.placeholder')}
            error={error('companyId')}
          />
        ) : (
          // No company to choose, or the directory could not be read. Saying so
          // is the honest answer; a box asking for a typed reference was not.
          <RequiresConcreteBranch messages={messages} fallbackKey="workingContext.noCompany" />
        )}

        {/*
          This one decides which of the two controls BELOW is rendered, so the
          reset stranded the operator rather than merely inconveniencing them:
          the select reverted to "Role" while `subject` state stayed `user`, so
          the dialog showed a user-id box under a control reading Role — and
          every retry failed the same way until the operator toggled it twice to
          put the two back in agreement.
        */}
        <SelectField
          key={`subject-${state.attempt ?? 0}`}
          name="subject"
          label={t('approvalLimits.field.subject')}
          defaultValue={subject}
          onChange={(event) => setSubject(event.target.value as 'role' | 'user')}
          options={[
            { value: 'role', label: t('approvalLimits.subject.role') },
            { value: 'user', label: t('approvalLimits.subject.user') },
          ]}
          error={error('subject')}
        />

        {subject === 'role' ? (
          <SelectField
            key={`roleId-${state.attempt ?? 0}`}
            name="roleId"
            label={t('approvalLimits.field.roleId')}
            defaultValue={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            options={roles.map((role) => ({ value: role.id, label: role.name }))}
            error={error('roleId')}
          />
        ) : canReadUsers ? (
          <>
            <AccountPicker
              messages={messages}
              locale={locale}
              label={t('approvalLimits.field.person')}
              value={person}
              onChange={setPerson}
              canSearch
              error={error('userId')}
              countsAsUnsaved
              testId="approval-limit-person-picker"
            />
            <input type="hidden" name="userId" value={person?.id ?? ''} />
          </>
        ) : (
          // Without `iam.user.read` nobody can be looked up here, and creating a
          // limit does not need that code: the account reference box stays,
          // labelled and explained, and the action checks its shape.
          <TextField
            key={`userId-${state.attempt ?? 0}`}
            name="userId"
            label={t('approvalLimits.field.userId')}
            description={t('approvalLimits.field.userIdHelp')}
            required
            spellCheck={false}
            autoComplete="off"
            dir="ltr"
            defaultValue={retained('userId')}
            onChange={retain('userId')}
            error={error('userId')}
            data-testid="approval-limit-person-reference"
          />
        )}

        <TextField
          key={`limitType-${state.attempt ?? 0}`}
          name="limitType"
          label={t('approvalLimits.field.limitType')}
          description={t('approvalLimits.field.limitTypeHint')}
          required
          spellCheck={false}
          defaultValue={retained('limitType')}
          onChange={retain('limitType')}
          error={error('limitType')}
        />

        {/*
          `inputMode="decimal"` and NOT `type="number"`. A number input hands back
          a value the browser has already coerced, drops trailing zeros, and
          differs between locales on the decimal separator — all of which are
          ways an exact amount stops being exact before it leaves the page.
        */}
        <TextField
          key={`amount-${state.attempt ?? 0}`}
          name="amount"
          inputMode="decimal"
          label={t('approvalLimits.field.amount')}
          required
          spellCheck={false}
          defaultValue={retained('amount')}
          onChange={retain('amount')}
          error={error('amount')}
        />

        <TextField
          key={`currency-${state.attempt ?? 0}`}
          name="currency"
          label={t('approvalLimits.field.currency')}
          description={t('approvalLimits.field.currencyHint')}
          required
          maxLength={3}
          spellCheck={false}
          defaultValue={retained('currency')}
          onChange={retain('currency')}
          error={error('currency')}
        />

        <TextField
          key={`effectiveFrom-${state.attempt ?? 0}`}
          name="effectiveFrom"
          type="date"
          label={t('approvalLimits.field.effectiveFrom')}
          required
          defaultValue={retained('effectiveFrom')}
          onChange={retain('effectiveFrom')}
          error={error('effectiveFrom')}
        />
        <TextField
          key={`effectiveTo-${state.attempt ?? 0}`}
          name="effectiveTo"
          type="date"
          label={t('approvalLimits.field.effectiveTo')}
          optionalHint={t('field.optional')}
          defaultValue={retained('effectiveTo')}
          onChange={retain('effectiveTo')}
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
