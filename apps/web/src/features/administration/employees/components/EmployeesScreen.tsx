'use client';

import { useActionState, useState, useTransition } from 'react';
import { SelectField, TextField } from '@/components/forms/Field';
import { ConfirmDialog, Dialog } from '@/components/overlays/Overlays';
import { EmptyState, LoadingState } from '@/components/states/States';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateWithValues } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { SubmitButton } from '@/features/authentication/components/SubmitButton';
import { ReadBoundary } from '../../shared/components/ScreenStates';
import { useWorkingBranch } from '../../shared/use-working-branch';
import {
  BranchPicker,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  StatusPill,
  TableFrame,
  Th,
} from '../../shared/components/StructureParts';
import type { BranchView, CompanyView } from '../../organization/types';
import { createEmployeeAction, setEmployeeStatusAction } from '../actions';
import { listEmployees } from '../api';
import type { EmployeePage, EmployeeView, LoginAccountOption } from '../types';

/**
 * The employee register, one branch at a time.
 *
 * An employee is a person the workshop names — on a handover, for example —
 * whether or not they have a login. The link to a login account is optional and
 * is offered only to a session that may read the account list; without it the
 * register still works, it just cannot link.
 *
 * Retiring and reinstating are the only changes the platform publishes. There is
 * no rename, so none is offered.
 */

export function EmployeesScreen({
  messages,
  branches,
  companies,
  loginAccounts,
  canManage,
}: {
  readonly messages: Messages;
  readonly branches: ReadState<readonly BranchView[]>;
  readonly companies: readonly CompanyView[];
  readonly loginAccounts: readonly LoginAccountOption[];
  readonly canManage: boolean;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);
  const [branch, setBranch] = useState<BranchView | null>(null);
  const [rows, setRows] = useState<readonly EmployeeView[]>([]);
  const [page, setPage] = useState<ReadState<EmployeePage> | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<EmployeeView | null>(null);
  const [outcome, setOutcome] = useState<ActionState>(IDLE);
  const [loading, startLoading] = useTransition();
  const [running, startRunning] = useTransition();
  // Bumped when the register follows the working branch, so the uncontrolled
  // branch control is re-seeded to show the branch now being read.
  const [followed, setFollowed] = useState(0);

  const accountName = new Map(loginAccounts.map((account) => [account.id, account.displayName]));

  const reload = (chosen: BranchView | null, cursor: string | null = null) => {
    setBranch(chosen);
    if (cursor === null) {
      setRows([]);
      setPage(null);
    }
    if (!chosen) return;
    startLoading(async () => {
      const read = await listEmployees(
        { companyId: chosen.companyId, branchId: chosen.id },
        cursor
      );
      setPage(read);
      if (read.status === 'ok') {
        setRows((current) =>
          cursor === null ? read.data.items : [...current, ...read.data.items]
        );
      }
    });
  };

  const hasMore = page?.status === 'ok' && page.data.hasMore;
  const nextCursor = page?.status === 'ok' ? page.data.nextCursor : null;

  /*
   * On arrival, and on every change of the working branch, the register reads
   * the branch the header names (route sweep B3). A dialog open over the
   * previous branch is closed rather than left to write against the new one.
   */
  useWorkingBranch(branches.status === 'ok' ? branches.data : null, (row) => {
    setCreating(false);
    setPending(null);
    setFollowed((count) => count + 1);
    reload(row);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-md">
          <ReadBoundary state={branches} messages={messages}>
            {(options) => (
              <BranchPicker
                key={followed}
                messages={messages}
                branches={options}
                companies={companies}
                value={branch?.id ?? ''}
                attempt={outcome.attempt}
                onChange={(id) => reload(options.find((row) => row.id === id) ?? null)}
              />
            )}
          </ReadBoundary>
        </div>
        {canManage && branch ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={() => setCreating(true)}>
            {t('employees.add')}
          </button>
        ) : null}
      </div>

      {!branch ? (
        <p className="text-supporting text-text-secondary">{t('employees.chooseBranch')}</p>
      ) : page === null || (loading && rows.length === 0) ? (
        <LoadingState messages={messages} />
      ) : page.status !== 'ok' && rows.length === 0 ? (
        <ReadBoundary state={page} messages={messages}>
          {() => null}
        </ReadBoundary>
      ) : rows.length === 0 ? (
        <EmptyState
          messages={messages}
          titleKey="employees.emptyTitle"
          descriptionKey="employees.emptyBody"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <TableFrame caption={`${t('employees.title')} — ${branch.name}`}>
            <thead className="border-b border-table-border bg-table-header">
              <tr>
                <Th>{t('employees.displayName')}</Th>
                <Th>{t('employees.loginAccount')}</Th>
                <Th>{t('employees.employmentRef')}</Th>
                <Th>{t('organization.status')}</Th>
                {canManage ? <Th>{t('admin.actions')}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((employee) => (
                <tr key={employee.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2 text-text-primary">{employee.displayName}</td>
                  <td className="px-3 py-2 text-text-secondary">
                    {employee.userAccountId === null
                      ? t('employees.noLogin')
                      : (accountName.get(employee.userAccountId) ?? t('employees.hasLogin'))}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{employee.employmentRef ?? '—'}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={employee.status} messages={messages} />
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className={SECONDARY_BUTTON}
                        aria-label={`${t(
                          employee.status === 'active'
                            ? 'employees.deactivate'
                            : 'employees.reactivate'
                        )}: ${employee.displayName}`}
                        onClick={() => {
                          setOutcome(IDLE);
                          setPending(employee);
                        }}
                      >
                        {t(
                          employee.status === 'active'
                            ? 'employees.deactivate'
                            : 'employees.reactivate'
                        )}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </TableFrame>
          {hasMore ? (
            <div>
              <button
                type="button"
                className={SECONDARY_BUTTON}
                disabled={loading}
                aria-busy={loading}
                onClick={() => reload(branch, nextCursor)}
              >
                {t('employees.showMore')}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {creating && branch ? (
        <CreateEmployeeDialog
          messages={messages}
          branch={branch}
          loginAccounts={loginAccounts}
          onClose={() => {
            setCreating(false);
            reload(branch);
          }}
        />
      ) : null}

      {pending ? (
        <ConfirmDialog
          open
          messages={messages}
          destructive={pending.status === 'active'}
          pending={running}
          title={t(
            pending.status === 'active'
              ? 'employees.confirmDeactivate'
              : 'employees.confirmReactivate'
          )}
          description={`${pending.displayName}. ${t(
            pending.status === 'active'
              ? 'employees.confirmDeactivateBody'
              : 'employees.confirmReactivateBody'
          )}`}
          confirmLabel={t(
            pending.status === 'active' ? 'employees.deactivate' : 'employees.reactivate'
          )}
          error={
            outcome.status !== 'idle' && outcome.status !== 'success'
              ? translateWithValues(
                  messages,
                  outcome.messageKey ?? 'admin.actionFailed',
                  outcome.messageValues
                )
              : undefined
          }
          onCancel={() => setPending(null)}
          onConfirm={() =>
            startRunning(async () => {
              const result = await setEmployeeStatusAction(
                pending.id,
                pending.status === 'active' ? 'inactive' : 'active',
                pending.recordVersion
              );
              setOutcome({ ...result, attempt: (outcome.attempt ?? 0) + 1 });
              notifyActionResult(result, messages);
              if (result.status === 'success') {
                setPending(null);
                reload(branch);
              }
            })
          }
        />
      ) : null}
    </div>
  );
}

function CreateEmployeeDialog({
  messages,
  branch,
  loginAccounts,
  onClose,
}: {
  readonly messages: Messages;
  readonly branch: BranchView;
  readonly loginAccounts: readonly LoginAccountOption[];
  readonly onClose: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createEmployeeAction, IDLE);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const t = (key: string) => translate(messages, key as keyof Messages);
  const retain = (name: string) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));
  const fieldError = (name: string) =>
    state.fieldErrors?.[name] ? t(state.fieldErrors[name]) : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t('employees.add')}
      description={`${t('employees.addDescription')} ${branch.name}`}
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />
        <input type="hidden" name="companyId" value={branch.companyId} />
        <input type="hidden" name="branchId" value={branch.id} />
        <TextField
          key={`displayName-${state.attempt ?? 0}`}
          name="displayName"
          onChange={retain('displayName')}
          error={fieldError('displayName')}
          defaultValue={draft['displayName'] ?? ''}
          label={t('employees.displayName')}
          required
          autoComplete="off"
        />
        {loginAccounts.length > 0 ? (
          <SelectField
            key={`userAccountId-${state.attempt ?? 0}`}
            name="userAccountId"
            onChange={retain('userAccountId')}
            error={fieldError('userAccountId')}
            defaultValue={draft['userAccountId'] ?? ''}
            label={t('employees.loginAccount')}
            description={t('employees.loginAccountHint')}
            optionalHint={t('field.optional')}
            placeholder={t('employees.noLogin')}
            options={loginAccounts.map((account) => ({
              value: account.id,
              label: `${account.displayName} — ${account.email}`,
            }))}
          />
        ) : null}
        <TextField
          key={`employmentRef-${state.attempt ?? 0}`}
          name="employmentRef"
          onChange={retain('employmentRef')}
          error={fieldError('employmentRef')}
          defaultValue={draft['employmentRef'] ?? ''}
          label={t('employees.employmentRef')}
          description={t('employees.employmentRefHint')}
          optionalHint={t('field.optional')}
          autoComplete="off"
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
