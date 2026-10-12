'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useReducedMotion } from '@/components/ui-foundation/use-reduced-motion';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import { WorkingBranchField } from '@/features/working-context/components/WorkingBranchField';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import { FormDialog } from '../../shared/components/FormDialog';
import { StatusPill } from '../../shared/components/StructureParts';
import { usePersonNames, type PersonNames } from '../../shared/person-name';
import { useWorkingBranch } from '../../shared/use-working-branch';
import type { BranchView, CompanyView } from '../../organization/types';
import { createEmployee, setEmployeeStatusAction } from '../actions';
import { listEmployees, readEmployee } from '../api';
import type { EmployeeView, LoginAccountOption } from '../types';

/**
 * The employee register, one branch at a time — on the shared Material wrappers
 * (ADR-022, `P1-32-PRE-OD-ADM2`).
 *
 * An employee is a person the workshop names — on a handover, for example —
 * whether or not they have a login. The link to a login account is optional and
 * is offered only to a session that may read the account list; without it the
 * register still works, it just cannot link.
 *
 * ## Scope
 *
 * The register reads the branch the header names (`useWorkingBranch`). The
 * grid, the Add button and every dialog live in `BranchEmployees`, keyed on the
 * branch pair: a switch to another branch remounts it, and a switch to "All my
 * branches" unmounts it. An employee's home branch decides nothing elsewhere in
 * the tenant; this register only lists who belongs to the branch.
 *
 * ## The list
 *
 * `org.employee-list` is keyset-paged, so the list is the operational grid over
 * `useServerTable`: server pages, no count, Previous and Next from the cursor,
 * and the grid's own refused, unavailable, ended-session and failed states.
 *
 * ## What can change
 *
 * Adding, retiring and reinstating are the only changes the platform publishes.
 * There is no operation that changes an employee's name, login account or
 * employment reference, so none is offered — the detail view says so in words
 * rather than drawing a control that would do nothing (a recorded gap).
 */

export function EmployeesScreen({
  messages,
  locale,
  branches,
  companies,
  loginAccounts,
  canManage,
  canReadUsers = false,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly branches: ReadState<readonly BranchView[]>;
  /** Names the company in the detail view, when the session may read companies. */
  readonly companies: readonly CompanyView[];
  readonly loginAccounts: readonly LoginAccountOption[];
  readonly canManage: boolean;
  /** `iam.user.read`: a linked account outside the picker's list is named by its own read. */
  readonly canReadUsers?: boolean;
}) {
  const branch = useWorkingBranch(branches.status === 'ok' ? branches.data : null);

  if (branches.status !== 'ok') {
    return (
      <MuiReadFailureState
        messages={messages}
        locale={locale}
        status={branches.status}
        correlationId={branches.correlationId}
        testId="employees-branches-failure"
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
          testId="employees-branch"
        />
      </div>
      {branch === null ? (
        <p className="text-supporting text-text-secondary">
          {translate(messages, 'employees.chooseBranch')}
        </p>
      ) : (
        <BranchEmployees
          key={`${branch.companyId}:${branch.id}`}
          messages={messages}
          locale={locale}
          branch={branch}
          companies={companies}
          loginAccounts={loginAccounts}
          canManage={canManage}
          canReadUsers={canReadUsers}
        />
      )}
    </div>
  );
}

/** The register's first page size: the size it read before it moved onto the grid. */
const FIRST_REQUEST: TableRequest = { ...INITIAL_REQUEST, pageSize: 50 };

function BranchEmployees({
  messages,
  locale,
  branch,
  companies,
  loginAccounts,
  canManage,
  canReadUsers,
}: {
  readonly messages: Messages;
  readonly locale: Locale | undefined;
  readonly branch: BranchView;
  readonly companies: readonly CompanyView[];
  readonly loginAccounts: readonly LoginAccountOption[];
  readonly canManage: boolean;
  readonly canReadUsers: boolean;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<EmployeeView | null>(null);
  const [pending, setPending] = useState<EmployeeView | null>(null);
  const [statusOutcome, setStatusOutcome] = useState<ActionState>(IDLE);
  const [conflict, setConflict] = useState<ActionState | null>(null);
  const [statusRunning, setStatusRunning] = useState(false);
  const statusSending = useRef(false);

  const load = useCallback(
    async (request: TableRequest, cursor: string | null): Promise<ServerPage<EmployeeView>> => {
      let read: Awaited<ReturnType<typeof listEmployees>>;
      try {
        read = await listEmployees(
          { companyId: branch.companyId, branchId: branch.id },
          cursor,
          request.pageSize
        );
      } catch {
        read = { status: 'unavailable', correlationId: null };
      }
      if (read.status !== 'ok') {
        return {
          status: read.status,
          rows: [],
          nextCursor: null,
          hasMore: false,
          correlationId: read.correlationId,
        };
      }
      return {
        status: 'ok',
        rows: read.data.items,
        nextCursor: read.data.nextCursor,
        hasMore: read.data.hasMore,
        correlationId: read.correlationId,
      };
    },
    [branch.companyId, branch.id]
  );
  const table = useServerTable<EmployeeView>(load, { initial: FIRST_REQUEST });
  const rows = useMemo(() => table.response?.rows ?? [], [table.response]);

  // A linked account the picker's list does not hold (retired, or beyond its
  // first hundred) is named by its own read, when the session may read accounts.
  const listed = useMemo(
    () => new Map(loginAccounts.map((account) => [account.id, account.displayName])),
    [loginAccounts]
  );
  const unlisted = rows
    .map((row) => row.userAccountId)
    .filter((id): id is string => id !== null && !listed.has(id));
  const looked = usePersonNames(unlisted, canReadUsers);
  const accountLabel = useCallback(
    (userAccountId: string | null) => accountName(messages, userAccountId, listed, looked),
    [messages, listed, looked]
  );

  const columns = useMemo<readonly OperationalColumn<EmployeeView>[]>(
    () => [
      {
        id: 'displayName',
        headerKey: 'employees.displayName',
        flex: 2,
        cell: (row) => <bdi className="font-medium">{row.displayName}</bdi>,
      },
      {
        id: 'loginAccount',
        headerKey: 'employees.loginAccount',
        flex: 2,
        cell: (row) => <bdi>{accountLabel(row.userAccountId)}</bdi>,
      },
      {
        id: 'employmentRef',
        headerKey: 'employees.employmentRef',
        hideBelow: 'md',
        cell: (row) =>
          row.employmentRef === null ? (
            translate(messages, 'employees.detail.noReference')
          ) : (
            <bdi>{row.employmentRef}</bdi>
          ),
      },
      {
        id: 'status',
        headerKey: 'organization.status',
        cell: (row) => <StatusPill status={row.status} messages={messages} />,
      },
    ],
    [messages, accountLabel]
  );

  const rowActions = useCallback(
    (row: EmployeeView): readonly RowAction[] => [
      {
        kind: 'button',
        label: translate(messages, 'employees.details'),
        about: row.displayName,
        onClick: () => setViewing(row),
      },
      ...(canManage
        ? [
            {
              kind: 'button' as const,
              label: translate(
                messages,
                row.status === 'active' ? 'employees.deactivate' : 'employees.reactivate'
              ),
              about: row.displayName,
              onClick: () => {
                setConflict(null);
                setStatusOutcome(IDLE);
                setPending(row);
              },
            },
          ]
        : []),
    ],
    [messages, canManage]
  );

  const confirmStatus = async (employee: EmployeeView) => {
    if (statusSending.current) return;
    statusSending.current = true;
    setStatusRunning(true);
    let result: ActionState;
    try {
      // The version the list showed: a list read since moved on is a conflict.
      result = await setEmployeeStatusAction(
        employee.id,
        employee.status === 'active' ? 'inactive' : 'active',
        employee.recordVersion
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
      table.refresh();
      return;
    }
    setStatusOutcome(result);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="employees-register">
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
            {t('employees.add')}
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
              table.refresh();
            }}
          >
            {t('form.loadLatest')}
          </Button>
        </div>
      ) : null}

      <OperationalGrid<EmployeeView>
        messages={messages}
        locale={locale}
        label={`${t('employees.title')} — ${branch.name}`}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={rowActions}
        // "Nothing yet" is this register's own sentence: it invites the first entry.
        suppressEmptyState
        testId="employees-grid"
      />
      {table.status === 'idle' && table.response && table.response.rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="employees.emptyTitle"
          descriptionKey="employees.emptyBody"
          testId="employees-empty"
        />
      ) : null}

      {creating ? (
        <CreateEmployeeDialog
          messages={messages}
          branch={branch}
          loginAccounts={loginAccounts}
          onCreated={() => {
            setCreating(false);
            table.refresh();
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {viewing ? (
        <EmployeeDetailDrawer
          key={viewing.id}
          messages={messages}
          locale={locale}
          employee={viewing}
          branch={branch}
          companies={companies}
          accountLabel={accountLabel}
          onClose={() => setViewing(null)}
        />
      ) : null}

      {pending ? (
        <ConfirmDialog
          open
          messages={messages}
          destructive={pending.status === 'active'}
          pending={statusRunning}
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
          onConfirm={() => void confirmStatus(pending)}
          testId="employees-status-confirm"
        />
      ) : null}
    </div>
  );
}

/** A linked login account, by name — never by its reference. */
function accountName(
  messages: Messages,
  userAccountId: string | null,
  listed: ReadonlyMap<string, string>,
  looked: PersonNames
): string {
  if (userAccountId === null) return translate(messages, 'employees.noLogin');
  const fromList = listed.get(userAccountId);
  if (fromList !== undefined) return fromList;
  const person = looked.get(userAccountId);
  return person?.status === 'named'
    ? person.displayName
    : translate(messages, 'employees.hasLogin');
}

interface EmployeeDraft {
  readonly displayName: string;
  readonly userAccountId: string;
  readonly employmentRef: string;
}

const EMPTY_EMPLOYEE: EmployeeDraft = { displayName: '', userAccountId: '', employmentRef: '' };

/** The form's own checks, keyed by field, as catalogue keys. */
function checkEmployee(draft: EmployeeDraft): Record<string, string> {
  const found: Record<string, string> = {};
  const name = draft.displayName.trim();
  if (name.length === 0) found['displayName'] = 'field.required';
  else if (name.length > 200) found['displayName'] = 'field.tooLong';
  if (draft.employmentRef.trim().length > 64) found['employmentRef'] = 'field.tooLong';
  return found;
}

function CreateEmployeeDialog({
  messages,
  branch,
  loginAccounts,
  onCreated,
  onClose,
}: {
  readonly messages: Messages;
  readonly branch: BranchView;
  readonly loginAccounts: readonly LoginAccountOption[];
  readonly onCreated: () => void;
  readonly onClose: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [draft, setDraft] = useState<EmployeeDraft>(EMPTY_EMPLOYEE);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState | null>(null);
  const [running, setRunning] = useState(false);
  // One create sent at a time, before `running` has disabled the button.
  const sending = useRef(false);
  const { errors, formRef } = useHeldRefusal(fieldErrors, { ...draft });
  /*
   * Every field is unsaved work: the name, the chosen login account and the
   * reference. A confirmed discard — towards another branch or towards "All my
   * branches" — empties the draft and closes the dialog, whichever the switch
   * chose.
   */
  useUnsavedGuard(
    draft.displayName.trim().length > 0 ||
      draft.userAccountId !== '' ||
      draft.employmentRef.trim().length > 0,
    () => {
      setDraft(EMPTY_EMPLOYEE);
      setFieldErrors({});
      setProblem(null);
      onClose();
    }
  );

  const set = (field: keyof EmployeeDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const errorFor = (field: string): string | undefined => {
    const key = errors[field];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    if (sending.current) return;
    setProblem(null);
    const found = checkEmployee(draft);
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    sending.current = true;
    setRunning(true);
    let outcome: ActionState;
    try {
      outcome = await createEmployee({
        companyId: branch.companyId,
        branchId: branch.id,
        displayName: draft.displayName,
        userAccountId: draft.userAccountId,
        employmentRef: draft.employmentRef,
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
      setDraft(EMPTY_EMPLOYEE);
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
      title={t('employees.add')}
      description={`${t('employees.addDescription')} ${branch.name}`}
      submitLabel={t('admin.create')}
      pendingLabel={t('admin.creating')}
      pending={running}
      error={refusal}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="employees-create"
    >
      <FormTextField
        name="displayName"
        label={t('employees.displayName')}
        value={draft.displayName}
        onChange={set('displayName')}
        error={errorFor('displayName')}
        required
        autoComplete="off"
        maxLength={200}
        autoFocus
      />
      {loginAccounts.length > 0 ? (
        <FormSelectField
          name="userAccountId"
          label={t('employees.loginAccount')}
          description={t('employees.loginAccountHint')}
          value={draft.userAccountId}
          onChange={set('userAccountId')}
          error={errorFor('userAccountId')}
          placeholder={t('employees.noLogin')}
          options={loginAccounts.map((account) => ({
            value: account.id,
            label: `${account.displayName} — ${account.email}`,
          }))}
        />
      ) : null}
      <FormTextField
        name="employmentRef"
        label={t('employees.employmentRef')}
        description={t('employees.employmentRefHint')}
        value={draft.employmentRef}
        onChange={set('employmentRef')}
        error={errorFor('employmentRef')}
        autoComplete="off"
        spellCheck={false}
        maxLength={64}
      />
    </FormDialog>
  );
}

interface HeldDetail {
  readonly generation: number;
  readonly state: ReadState<EmployeeView>;
}

/**
 * One employee as stored now (`org.employee-detail`), in a drawer at the
 * logical end of the page.
 *
 * Material's drawer traps Tab inside while it is open and returns focus to the
 * button that opened it; Escape and Close both close it, and a closed drawer
 * leaves the page at once. Every value is said by name: the branch and company
 * from the lists the page holds, the login account from the account read.
 */
function EmployeeDetailDrawer({
  messages,
  locale,
  employee,
  branch,
  companies,
  accountLabel,
  onClose,
}: {
  readonly messages: Messages;
  readonly locale: Locale | undefined;
  readonly employee: EmployeeView;
  readonly branch: BranchView;
  readonly companies: readonly CompanyView[];
  readonly accountLabel: (userAccountId: string | null) => string;
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
      let state: ReadState<EmployeeView>;
      try {
        state = await readEmployee(employee.id);
      } catch {
        state = { status: 'unavailable', correlationId: null };
      }
      if (!cancelled) setHeld({ generation, state });
    })();
    return () => {
      cancelled = true;
    };
  }, [employee.id, generation]);

  const loading = held === null || held.generation !== generation;
  const company = companies.find((entry) => entry.id === branch.companyId) ?? null;

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
          'data-testid': 'employees-detail',
        } as Record<string, unknown>,
      }}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-section-title font-medium text-text-primary">
            <bdi>{employee.displayName}</bdi>
          </h2>
          <Button type="button" variant="outlined" size="small" onClick={onClose} autoFocus>
            {t('admin.close')}
          </Button>
        </div>
        {loading ? (
          <MuiLoadingState messages={messages} testId="employees-detail-loading" />
        ) : held.state.status !== 'ok' ? (
          <MuiReadFailureState
            messages={messages}
            locale={locale}
            status={held.state.status}
            correlationId={held.state.correlationId}
            onRetry={() => setGeneration((current) => current + 1)}
            testId="employees-detail-failure"
          />
        ) : (
          <dl className="grid grid-cols-1 gap-3">
            <DetailRow term={t('employees.displayName')}>
              <bdi>{held.state.data.displayName}</bdi>
            </DetailRow>
            <DetailRow term={t('admin.scope.branch')}>
              <bdi>{held.state.data.branchId === branch.id ? branch.name : '—'}</bdi>
              {company ? (
                <span className="text-text-secondary">
                  {' · '}
                  <bdi>{company.legalName}</bdi>
                </span>
              ) : null}
            </DetailRow>
            <DetailRow term={t('employees.loginAccount')}>
              <bdi>{accountLabel(held.state.data.userAccountId)}</bdi>
            </DetailRow>
            <DetailRow term={t('employees.employmentRef')}>
              {held.state.data.employmentRef === null ? (
                t('employees.detail.noReference')
              ) : (
                <bdi>{held.state.data.employmentRef}</bdi>
              )}
            </DetailRow>
            <DetailRow term={t('organization.status')}>
              <StatusPill status={held.state.data.status} messages={messages} />
            </DetailRow>
          </dl>
        )}
        <p className="text-supporting text-text-secondary" data-testid="employees-detail-no-edit">
          {t('employees.detail.noEdit')}
        </p>
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
