'use client';

import { useActionState, useState, useTransition } from 'react';
import { TextField } from '@/components/forms/Field';
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
import { useActionRefusal } from '@/lib/forms/use-action-refusal';
import {
  BranchPicker,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  StatusPill,
  TableFrame,
  Th,
} from '../../shared/components/StructureParts';
import type { BranchView, CompanyView } from '../../organization/types';
import {
  createDepartmentAction,
  renameDepartmentAction,
  setDepartmentStatusAction,
} from '../actions';
import { listDepartments } from '../api';
import type { DepartmentView } from '../types';

/**
 * Departments, one branch at a time.
 *
 * The list operation is branch-scoped and requires both halves of the branch, so
 * the screen asks which branch first and reads only after one is chosen. Every
 * write re-reads the list, because the version a rename or a retirement needs
 * next is the one the write just produced.
 */

type Pending =
  | { readonly kind: 'rename'; readonly department: DepartmentView }
  | { readonly kind: 'status'; readonly department: DepartmentView };

export function DepartmentsScreen({
  messages,
  branches,
  companies,
  canManage,
}: {
  readonly messages: Messages;
  readonly branches: ReadState<readonly BranchView[]>;
  readonly companies: readonly CompanyView[];
  readonly canManage: boolean;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);
  const [branch, setBranch] = useState<BranchView | null>(null);
  const [list, setList] = useState<ReadState<readonly DepartmentView[]> | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [outcome, setOutcome] = useState<ActionState>(IDLE);
  const [loading, startLoading] = useTransition();
  const [running, startRunning] = useTransition();
  // Bumped when the register follows the working branch, so the uncontrolled
  // branch control is re-seeded to show the branch now being read.
  const [followed, setFollowed] = useState(0);

  const reload = (chosen: BranchView | null) => {
    setBranch(chosen);
    setList(null);
    if (!chosen) return;
    startLoading(async () => {
      setList(await listDepartments({ companyId: chosen.companyId, branchId: chosen.id }));
    });
  };

  const run = (task: () => Promise<ActionState>) => {
    startRunning(async () => {
      const result = await task();
      setOutcome({ ...result, attempt: (outcome.attempt ?? 0) + 1 });
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        setPending(null);
        reload(branch);
      }
    });
  };

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
            {(rows) => (
              <BranchPicker
                key={followed}
                messages={messages}
                branches={rows}
                companies={companies}
                value={branch?.id ?? ''}
                attempt={outcome.attempt}
                onChange={(id) => reload(rows.find((row) => row.id === id) ?? null)}
              />
            )}
          </ReadBoundary>
        </div>
        {canManage && branch ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={() => setCreating(true)}>
            {t('departments.add')}
          </button>
        ) : null}
      </div>

      {!branch ? (
        <p className="text-supporting text-text-secondary">{t('departments.chooseBranch')}</p>
      ) : loading || list === null ? (
        <LoadingState messages={messages} />
      ) : (
        <ReadBoundary state={list} messages={messages}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState
                messages={messages}
                titleKey="departments.emptyTitle"
                descriptionKey="departments.emptyBody"
              />
            ) : (
              <TableFrame caption={`${t('departments.title')} — ${branch.name}`}>
                <thead className="border-b border-table-border bg-table-header">
                  <tr>
                    <Th>{t('organization.structure.code')}</Th>
                    <Th>{t('departments.name')}</Th>
                    <Th>{t('organization.status')}</Th>
                    {canManage ? <Th>{t('admin.actions')}</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((department) => (
                    <tr key={department.id} className="border-t border-border-subtle">
                      <td className="px-3 py-2 font-mono text-caption text-text-secondary">
                        {department.departmentCode}
                      </td>
                      <td className="px-3 py-2 text-text-primary">{department.name}</td>
                      <td className="px-3 py-2">
                        <StatusPill status={department.status} messages={messages} />
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              className={SECONDARY_BUTTON}
                              aria-label={`${t('departments.rename')}: ${department.name}`}
                              onClick={() => {
                                setOutcome(IDLE);
                                setPending({ kind: 'rename', department });
                              }}
                            >
                              {t('departments.rename')}
                            </button>
                            <button
                              type="button"
                              className={SECONDARY_BUTTON}
                              aria-label={`${t(
                                department.status === 'active'
                                  ? 'departments.retire'
                                  : 'departments.reinstate'
                              )}: ${department.name}`}
                              onClick={() => {
                                setOutcome(IDLE);
                                setPending({ kind: 'status', department });
                              }}
                            >
                              {t(
                                department.status === 'active'
                                  ? 'departments.retire'
                                  : 'departments.reinstate'
                              )}
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
            )
          }
        </ReadBoundary>
      )}

      {creating && branch ? (
        <CreateDepartmentDialog
          messages={messages}
          branch={branch}
          onClose={() => {
            setCreating(false);
            reload(branch);
          }}
        />
      ) : null}

      {pending?.kind === 'rename' ? (
        <RenameDialog
          messages={messages}
          department={pending.department}
          pending={running}
          outcome={outcome}
          onCancel={() => setPending(null)}
          onSubmit={(name) =>
            run(() =>
              renameDepartmentAction(pending.department.id, name, pending.department.recordVersion)
            )
          }
        />
      ) : null}

      {pending?.kind === 'status' ? (
        <ConfirmDialog
          open
          messages={messages}
          destructive={pending.department.status === 'active'}
          pending={running}
          title={t(
            pending.department.status === 'active'
              ? 'departments.confirmRetire'
              : 'departments.confirmReinstate'
          )}
          description={t(
            pending.department.status === 'active'
              ? 'departments.confirmRetireBody'
              : 'departments.confirmReinstateBody'
          )}
          confirmLabel={t(
            pending.department.status === 'active' ? 'departments.retire' : 'departments.reinstate'
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
            run(() =>
              setDepartmentStatusAction(
                pending.department.id,
                pending.department.status === 'active' ? 'inactive' : 'active',
                pending.department.recordVersion
              )
            )
          }
        />
      ) : null}
    </div>
  );
}

function CreateDepartmentDialog({
  messages,
  branch,
  onClose,
}: {
  readonly messages: Messages;
  readonly branch: BranchView;
  readonly onClose: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createDepartmentAction, IDLE);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const t = (key: string) => translate(messages, key as keyof Messages);
  // Question f: the cursor goes to the refused field, and its complaint goes
  // once the operator edits it (route sweep B3).
  const {
    edited: refusalEdited,
    errorKey: refusalErrorKey,
    formRef: refusalFormRef,
  } = useActionRefusal(state);
  const retain = (name: string) => (event: { target: { value: string } }) => {
    refusalEdited(name);
    setDraft((current) => ({ ...current, [name]: event.target.value }));
  };
  const fieldError = (name: string) => {
    const key = refusalErrorKey(name);
    return key ? t(key) : undefined;
  };

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t('departments.add')}
      description={`${t('departments.addDescription')} ${branch.name}`}
    >
      <form ref={refusalFormRef} action={formAction} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />
        <input type="hidden" name="companyId" value={branch.companyId} />
        <input type="hidden" name="branchId" value={branch.id} />
        <TextField
          key={`departmentCode-${state.attempt ?? 0}`}
          name="departmentCode"
          onChange={retain('departmentCode')}
          error={fieldError('departmentCode')}
          defaultValue={draft['departmentCode'] ?? ''}
          label={t('organization.structure.code')}
          description={t('organization.structure.codeHint')}
          required
          autoComplete="off"
          spellCheck={false}
        />
        <TextField
          key={`name-${state.attempt ?? 0}`}
          name="name"
          onChange={retain('name')}
          error={fieldError('name')}
          defaultValue={draft['name'] ?? ''}
          label={t('departments.name')}
          required
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

function RenameDialog({
  messages,
  department,
  pending,
  outcome,
  onCancel,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly department: DepartmentView;
  readonly pending: boolean;
  readonly outcome: ActionState;
  readonly onCancel: () => void;
  readonly onSubmit: (name: string) => void;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);
  const [name, setName] = useState(department.name);
  const {
    edited: refusalEdited,
    errorKey: refusalErrorKey,
    formRef: refusalFormRef,
  } = useActionRefusal(outcome);
  const nameError = refusalErrorKey('name');
  return (
    <Dialog open onClose={onCancel} messages={messages} title={t('departments.rename')}>
      <form
        ref={refusalFormRef}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(name);
        }}
      >
        <FormFeedback state={outcome.status === 'invalid' ? outcome : IDLE} messages={messages} />
        <TextField
          name="name"
          label={t('departments.name')}
          required
          autoComplete="off"
          value={name}
          onChange={(event) => {
            refusalEdited('name');
            setName(event.target.value);
          }}
          error={nameError ? t(nameError) : undefined}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-button text-text-secondary hover:bg-surface-subtle"
          >
            {t('admin.cancel')}
          </button>
          <button type="submit" className={PRIMARY_BUTTON} disabled={pending} aria-busy={pending}>
            {pending ? t('admin.saving') : t('admin.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
