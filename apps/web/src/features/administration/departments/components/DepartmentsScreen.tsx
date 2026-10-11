'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import { WorkingBranchField } from '@/features/working-context/components/WorkingBranchField';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import { FormDialog } from '../../shared/components/FormDialog';
import { StatusPill } from '../../shared/components/StructureParts';
import { useWorkingBranch } from '../../shared/use-working-branch';
import type { BranchView, CompanyView } from '../../organization/types';
import { createDepartment, renameDepartmentAction, setDepartmentStatusAction } from '../actions';
import { listDepartments } from '../api';
import type { DepartmentView } from '../types';

/**
 * Departments, one branch at a time — on the shared Material wrappers (ADR-022,
 * `P1-32-PRE-OD-ADM2`).
 *
 * ## Scope
 *
 * The list operation is branch-scoped and requires both halves of the branch, so
 * the register reads the branch the header names (`useWorkingBranch`) and
 * nothing else. Everything addressed to that branch — the list, the Add button
 * and every dialog — lives in `BranchDepartments`, keyed on the branch pair, so
 * a switch to another branch remounts it empty and a switch to "All my branches"
 * unmounts it: no dialog is left open writing to a branch the header no longer
 * names.
 *
 * ## The list
 *
 * Material's table, not the operational grid: `org.department-list` answers one
 * bounded list with no cursor (planner ruling 2026-10-09). The read carries no
 * "more exist" flag, so the register cannot say a list was cut short; that is a
 * recorded gap of the operation, not something this screen can derive.
 *
 * ## Writes
 *
 * Every write re-reads the list, because the version a rename or a retirement
 * needs next is the one the write just produced. Each write is sent once: a
 * second press made before the button is disabled sends nothing (`sending`).
 * A stale version is the server's conflict, said beside the list with "Load the
 * latest version"; it is never retried on the operator's behalf.
 */

type Pending =
  | { readonly kind: 'rename'; readonly department: DepartmentView }
  | { readonly kind: 'status'; readonly department: DepartmentView };

export function DepartmentsScreen({
  messages,
  locale,
  branches,
  canManage,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly branches: ReadState<readonly BranchView[]>;
  /** Accepted so the route did not change; not read — the branch is the working one. */
  readonly companies: readonly CompanyView[];
  readonly canManage: boolean;
}) {
  const branch = useWorkingBranch(branches.status === 'ok' ? branches.data : null);

  if (branches.status !== 'ok') {
    return (
      <MuiReadFailureState
        messages={messages}
        locale={locale}
        status={branches.status}
        correlationId={branches.correlationId}
        testId="departments-branches-failure"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="w-full max-w-md">
        {/*
         * The working branch, stated. Every read and write here is for the
         * branch the header names; there is no second chooser on this screen.
         */}
        <WorkingBranchField
          messages={messages}
          label={translate(messages, 'admin.scope.branch')}
          testId="departments-branch"
        />
      </div>
      {branch === null ? (
        <p className="text-supporting text-text-secondary">
          {translate(messages, 'departments.chooseBranch')}
        </p>
      ) : (
        <BranchDepartments
          key={`${branch.companyId}:${branch.id}`}
          messages={messages}
          locale={locale}
          branch={branch}
          canManage={canManage}
        />
      )}
    </div>
  );
}

/*
 * `org.department-list` answers at most this many departments, with no cursor
 * and no "more exist" flag. A list of exactly this length may have been cut
 * short, so the register says only the first ones are shown — an inference
 * from the length, never a statement that more exist.
 */
const DEPARTMENT_LIST_CAP = 500;

interface HeldRead {
  readonly generation: number;
  readonly state: ReadState<readonly DepartmentView[]>;
}

function BranchDepartments({
  messages,
  locale,
  branch,
  canManage,
}: {
  readonly messages: Messages;
  readonly locale: Locale | undefined;
  readonly branch: BranchView;
  readonly canManage: boolean;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [generation, setGeneration] = useState(0);
  const [held, setHeld] = useState<HeldRead | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [statusOutcome, setStatusOutcome] = useState<ActionState>(IDLE);
  const [conflict, setConflict] = useState<ActionState | null>(null);
  const [statusRunning, setStatusRunning] = useState(false);
  const statusSending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let state: ReadState<readonly DepartmentView[]>;
      try {
        state = await listDepartments({ companyId: branch.companyId, branchId: branch.id });
      } catch {
        // No answer came back: said as an outage, with a retry.
        state = { status: 'unavailable', correlationId: null };
      }
      if (!cancelled) setHeld({ generation, state });
    })();
    return () => {
      cancelled = true;
    };
  }, [branch.companyId, branch.id, generation]);

  const refresh = () => setGeneration((current) => current + 1);
  const refreshing = held !== null && held.generation !== generation;
  const rows = held?.state.status === 'ok' ? held.state.data : [];

  const confirmStatus = async (department: DepartmentView) => {
    if (statusSending.current) return;
    statusSending.current = true;
    setStatusRunning(true);
    let result: ActionState;
    try {
      // The version the list showed: a list read since moved on is a conflict.
      result = await setDepartmentStatusAction(
        department.id,
        department.status === 'active' ? 'inactive' : 'active',
        department.recordVersion
      );
    } catch {
      result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      statusSending.current = false;
      setStatusRunning(false);
    }
    notifyActionResult(result, messages);
    if (result.status === 'success' || result.status === 'conflict') {
      setPending(null);
      setStatusOutcome(IDLE);
      setConflict(result.status === 'conflict' ? result : null);
      refresh();
      return;
    }
    setStatusOutcome(result);
  };

  // The row as the list answers it now, so a re-read brings the stored name and
  // version into an open rename dialog.
  const renaming =
    pending?.kind === 'rename'
      ? (rows.find((row) => row.id === pending.department.id) ?? pending.department)
      : null;

  return (
    <div className="flex flex-col gap-4" data-testid="departments-register">
      {canManage ? (
        <div>
          <Button
            type="button"
            variant="contained"
            onClick={() => {
              setConflict(null);
              setCreating(true);
            }}
          >
            {t('departments.add')}
          </Button>
        </div>
      ) : null}

      {conflict ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-body text-error">
            {translateWithValues(
              messages,
              conflict.messageKey ?? 'state.conflict.message',
              conflict.messageValues
            )}
          </p>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => {
              setConflict(null);
              refresh();
            }}
          >
            {t('form.loadLatest')}
          </Button>
        </div>
      ) : null}

      {held === null ? (
        <MuiLoadingState messages={messages} testId="departments-loading" />
      ) : held.state.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={held.state.status}
          correlationId={held.state.correlationId}
          onRetry={refresh}
          testId="departments-failure"
        />
      ) : rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="departments.emptyTitle"
          descriptionKey="departments.emptyBody"
          testId="departments-empty"
        />
      ) : (
        <>
          {rows.length >= DEPARTMENT_LIST_CAP ? (
            <p className="text-caption text-text-muted" data-testid="departments-capped">
              {translateWithValues(messages, 'departments.listCapped', {
                count: String(DEPARTMENT_LIST_CAP),
              })}
            </p>
          ) : null}
          <TableContainer aria-busy={refreshing || undefined}>
            <Table size="small">
              <caption className="sr-only">{`${t('departments.title')} — ${branch.name}`}</caption>
              <TableHead>
                <TableRow>
                  <TableCell scope="col">{t('departments.name')}</TableCell>
                  <TableCell scope="col">{t('organization.structure.code')}</TableCell>
                  <TableCell scope="col">{t('organization.status')}</TableCell>
                  {canManage ? <TableCell scope="col">{t('admin.actions')}</TableCell> : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((department) => (
                  <TableRow key={department.id}>
                    <TableCell>
                      <bdi className="font-medium text-text-primary">{department.name}</bdi>
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-caption text-text-secondary" dir="ltr">
                        {department.departmentCode}
                      </code>
                    </TableCell>
                    <TableCell>
                      <StatusPill status={department.status} messages={messages} />
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outlined"
                            size="small"
                            aria-label={`${t('departments.rename')}: ${department.name}`}
                            onClick={() => {
                              setConflict(null);
                              setPending({ kind: 'rename', department });
                            }}
                          >
                            {t('departments.rename')}
                          </Button>
                          <Button
                            type="button"
                            variant="outlined"
                            size="small"
                            color={department.status === 'active' ? 'error' : 'primary'}
                            aria-label={`${t(
                              department.status === 'active'
                                ? 'departments.retire'
                                : 'departments.reinstate'
                            )}: ${department.name}`}
                            onClick={() => {
                              setConflict(null);
                              setStatusOutcome(IDLE);
                              setPending({ kind: 'status', department });
                            }}
                          >
                            {t(
                              department.status === 'active'
                                ? 'departments.retire'
                                : 'departments.reinstate'
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {creating ? (
        <CreateDepartmentDialog
          messages={messages}
          branch={branch}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {renaming ? (
        <RenameDialog
          key={renaming.id}
          messages={messages}
          department={renaming}
          refresh={refresh}
          onClose={() => setPending(null)}
        />
      ) : null}

      {pending?.kind === 'status' ? (
        <ConfirmDialog
          open
          messages={messages}
          destructive={pending.department.status === 'active'}
          pending={statusRunning}
          title={t(
            pending.department.status === 'active'
              ? 'departments.confirmRetire'
              : 'departments.confirmReinstate'
          )}
          description={`${pending.department.name}. ${t(
            pending.department.status === 'active'
              ? 'departments.confirmRetireBody'
              : 'departments.confirmReinstateBody'
          )}`}
          confirmLabel={t(
            pending.department.status === 'active' ? 'departments.retire' : 'departments.reinstate'
          )}
          error={
            statusOutcome.status !== 'idle' && statusOutcome.status !== 'success'
              ? translateWithValues(
                  messages,
                  statusOutcome.messageKey ?? 'admin.actionFailed',
                  statusOutcome.messageValues
                )
              : undefined
          }
          onCancel={() => {
            setPending(null);
            setStatusOutcome(IDLE);
          }}
          onConfirm={() => void confirmStatus(pending.department)}
          testId="departments-status-confirm"
        />
      ) : null}
    </div>
  );
}

/** The rule `ck_departments_code_format` holds, checked before anything is sent. */
const DEPARTMENT_CODE = /^[a-z][a-z0-9_]{1,62}$/;

interface DepartmentDraft {
  readonly departmentCode: string;
  readonly name: string;
}

const EMPTY_DEPARTMENT: DepartmentDraft = { departmentCode: '', name: '' };

/** The form's own checks, keyed by field, as catalogue keys. */
function checkDepartment(draft: DepartmentDraft): Record<string, string> {
  const found: Record<string, string> = {};
  if (draft.name.trim().length === 0) found['name'] = 'field.required';
  else if (draft.name.trim().length > 200) found['name'] = 'field.tooLong';
  if (!DEPARTMENT_CODE.test(draft.departmentCode.trim())) {
    found['departmentCode'] =
      draft.departmentCode.trim().length === 0
        ? 'field.required'
        : 'organization.structure.codeHint';
  }
  return found;
}

function CreateDepartmentDialog({
  messages,
  branch,
  onCreated,
  onClose,
}: {
  readonly messages: Messages;
  readonly branch: BranchView;
  readonly onCreated: () => void;
  readonly onClose: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [draft, setDraft] = useState<DepartmentDraft>(EMPTY_DEPARTMENT);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState | null>(null);
  const [running, setRunning] = useState(false);
  // One create sent at a time, before `running` has disabled the button.
  const sending = useRef(false);
  // The cursor goes to the first refused field, and a complaint goes once its
  // field changes; what was typed stays.
  const { errors, formRef } = useHeldRefusal(fieldErrors, { ...draft });
  /*
   * Every field is unsaved work: the code and the name. A confirmed discard —
   * towards another branch or towards "All my branches" — empties the draft and
   * closes the dialog, whichever the switch chose.
   */
  useUnsavedGuard(draft.departmentCode.trim().length > 0 || draft.name.trim().length > 0, () => {
    setDraft(EMPTY_DEPARTMENT);
    setFieldErrors({});
    setProblem(null);
    onClose();
  });

  const set = (field: keyof DepartmentDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const errorFor = (field: string): string | undefined => {
    const key = errors[field];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    if (sending.current) return;
    setProblem(null);
    const found = checkDepartment(draft);
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    sending.current = true;
    setRunning(true);
    let outcome: ActionState;
    try {
      outcome = await createDepartment({
        companyId: branch.companyId,
        branchId: branch.id,
        departmentCode: draft.departmentCode,
        name: draft.name,
      });
    } catch {
      // No answer came back: what was typed stays, and the button works again.
      outcome = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    }
    // Held after a success until the dialog closes: an Enter or a press in the
    // moment before it does would otherwise send the same values again.
    if (outcome.status !== 'success') sending.current = false;
    setRunning(false);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setDraft(EMPTY_DEPARTMENT);
      onCreated();
      return;
    }
    if (outcome.fieldErrors && Object.keys(outcome.fieldErrors).length > 0) {
      setFieldErrors(outcome.fieldErrors);
    }
    setProblem(outcome);
  };

  const refusal =
    problem && problem.status !== 'invalid'
      ? translateWithValues(
          messages,
          problem.messageKey ?? 'admin.actionFailed',
          problem.messageValues
        )
      : problem?.status === 'invalid' && problem.messageKey
        ? translateDynamic(messages, problem.messageKey)
        : undefined;

  return (
    <FormDialog
      messages={messages}
      title={t('departments.add')}
      description={`${t('departments.addDescription')} ${branch.name}`}
      submitLabel={t('admin.create')}
      pendingLabel={t('admin.creating')}
      pending={running}
      error={refusal}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="departments-create"
    >
      <FormTextField
        name="name"
        label={t('departments.name')}
        value={draft.name}
        onChange={set('name')}
        error={errorFor('name')}
        required
        autoComplete="off"
        maxLength={200}
        autoFocus
      />
      <FormTextField
        name="departmentCode"
        label={t('organization.structure.code')}
        description={t('organization.structure.codeHint')}
        value={draft.departmentCode}
        onChange={set('departmentCode')}
        error={errorFor('departmentCode')}
        required
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        maxLength={63}
      />
    </FormDialog>
  );
}

function RenameDialog({
  messages,
  department,
  refresh,
  onClose,
}: {
  readonly messages: Messages;
  readonly department: DepartmentView;
  readonly refresh: () => void;
  readonly onClose: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  /*
   * The stored name and the version it was read at. A clean form follows the
   * list; a form holding a typed name keeps the version its work was based on,
   * and the save sends that one.
   */
  const edit = useEditBaseline<{ readonly name: string }>({
    stored: { name: department.name },
    storedVersion: department.recordVersion,
    differs: (values, baseline) => values.name.trim() !== baseline.name.trim(),
  });
  const [outcome, setOutcome] = useState<ActionState>(IDLE);
  const [running, setRunning] = useState(false);
  const sending = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, { name: edit.values.name });
  // A changed name not yet saved is lost if a branch switch closes this, and a
  // confirmed discard closes it whichever selection the switch made.
  useUnsavedGuard(edit.dirty, onClose);

  const submit = async () => {
    if (sending.current) return;
    const name = edit.values.name.trim();
    if (name.length === 0 || name.length > 200) {
      setFieldErrors({ name: name.length === 0 ? 'field.required' : 'field.tooLong' });
      return;
    }
    setFieldErrors({});
    sending.current = true;
    setRunning(true);
    let result: ActionState;
    try {
      // The BASELINE's version: a name typed on a record that has since moved is
      // the server's conflict, never a silent overwrite.
      result = await renameDepartmentAction(department.id, name, edit.version);
    } catch {
      result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    }
    // Held after a success until the dialog closes: an Enter or a press in the
    // moment before it does would otherwise send the same values again.
    if (result.status !== 'success') sending.current = false;
    setRunning(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      edit.rebase({ name });
      refresh();
      onClose();
      return;
    }
    if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
      setFieldErrors(result.fieldErrors);
    }
    setOutcome(result);
  };

  /*
   * The conflict's way out: what is stored now replaces the stale work, and the
   * list is read again so the newer record — name and version — arrives here.
   */
  const loadLatest = () => {
    edit.discard();
    setOutcome(IDLE);
    refresh();
  };

  const nameError = errors['name'];
  const refusal =
    outcome.status !== 'idle' && outcome.status !== 'success' && outcome.status !== 'invalid'
      ? translateWithValues(
          messages,
          outcome.messageKey ?? 'admin.actionFailed',
          outcome.messageValues
        )
      : undefined;

  return (
    <FormDialog
      messages={messages}
      title={t('departments.rename')}
      description={department.name}
      submitLabel={t('admin.save')}
      pending={running}
      error={refusal}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="departments-rename"
    >
      <FormTextField
        name="name"
        label={t('departments.name')}
        value={edit.values.name}
        onChange={(name) => edit.setValues({ name })}
        error={nameError ? translateDynamic(messages, nameError) : undefined}
        required
        autoComplete="off"
        maxLength={200}
        autoFocus
      />
      {outcome.status === 'conflict' ? (
        <div>
          <Button type="button" variant="outlined" size="small" onClick={loadLatest}>
            {t('form.loadLatest')}
          </Button>
        </div>
      ) : null}
    </FormDialog>
  );
}
