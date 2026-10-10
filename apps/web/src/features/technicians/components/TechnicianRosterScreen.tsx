'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import {
  INITIAL_REQUEST,
  withFilter,
  withoutFilter,
  type TableRequest,
} from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState } from '@/components/states/MuiStates';
import { FormDialog } from '@/features/administration/shared/components/FormDialog';
import {
  AccountPicker,
  type ChosenAccount,
} from '@/features/administration/users/components/AccountPicker';
import {
  RequiresConcreteBranch,
  WorkingBranchField,
} from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { BranchTarget } from '@/lib/api/read-operation';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import { createTechnician } from '../roster-actions';
import { listTechnicians } from '../roster-api';
import { MAX_EMPLOYMENT_REF, MAX_TRADE, type TechnicianRosterEntry } from '../roster-types';
import { refusalSentence, technicianName } from './roster-parts';

/**
 * The technician roster of one branch (`P1-32-PRE-OD-ADM2B`), on the shared
 * Material wrappers (ADR-022).
 *
 * ## Scope
 *
 * `tech.technician-list` is a one-branch read: the pair is its authorization
 * target. The roster reads the branch the header names (`useBranchTarget`);
 * under "All my branches", or before a branch is chosen, it says so in words and
 * reads nothing. The list, the Add button and the dialog live in `BranchRoster`,
 * keyed on the branch and the working-context version, so a switch drops the
 * previous branch's rows and an open form with them.
 *
 * ## Names, never references
 *
 * Each row names its person by the display name the list publishes. A session
 * without `iam.user.read` is told no name — the server publishes `null` — and
 * the row says so in words rather than printing the account reference. Adding a
 * technician picks a person by name or email from the account directory
 * (`AccountPicker`); without `iam.user.read` the picker says it cannot search,
 * and nobody can be added from here.
 *
 * ## The list
 *
 * Keyset-paged, so the operational grid over `useServerTable`: Previous and
 * Next from the server's cursor, the product's page sizes, and the grid's own
 * refused, unavailable, ended-session and failed states. The one filter the
 * route publishes — active or inactive — is the toolbar's.
 */
export function TechnicianRosterScreen({
  messages,
  locale,
  canManage,
  canReadUsers,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly canManage: boolean;
  /** `iam.user.read`: the person picker on "Add technician". */
  readonly canReadUsers: boolean;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="w-full max-w-md">
        <WorkingBranchField
          messages={messages}
          label={translate(messages, 'admin.scope.branch')}
          testId="technician-roster-branch"
        />
      </div>
      {branch.kind === 'ready' ? (
        <BranchRoster
          key={`${context.version}:${branch.target.companyId}/${branch.target.branchId}`}
          messages={messages}
          locale={locale}
          target={branch.target}
          branchName={context.branchName(branch.target.branchId) ?? ''}
          canManage={canManage}
          canReadUsers={canReadUsers}
        />
      ) : (
        <RequiresConcreteBranch
          messages={messages}
          state={branch}
          testId="technician-roster-blocked"
        />
      )}
    </div>
  );
}

/** The roster's first page size: one of the product's sizes, inside the route's bound. */
const FIRST_REQUEST: TableRequest = { ...INITIAL_REQUEST, pageSize: 25 };

const ACTIVE_FILTER = {
  key: 'state',
  labelKey: 'technicians.roster.filter.state',
  options: [
    { value: 'active', labelKey: 'technicians.roster.state.active' },
    { value: 'inactive', labelKey: 'technicians.roster.state.inactive' },
  ],
} as const;

function BranchRoster({
  messages,
  locale,
  target,
  branchName,
  canManage,
  canReadUsers,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly target: BranchTarget;
  readonly branchName: string;
  readonly canManage: boolean;
  readonly canReadUsers: boolean;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [creating, setCreating] = useState(false);
  const canAdd = canManage && canReadUsers;

  const load = useCallback(
    async (
      request: TableRequest,
      cursor: string | null
    ): Promise<ServerPage<TechnicianRosterEntry>> => {
      const state = request.filters.find((filter) => filter.key === 'state')?.value;
      let read: Awaited<ReturnType<typeof listTechnicians>>;
      try {
        read = await listTechnicians(target, {
          isActive: state === 'active' ? true : state === 'inactive' ? false : null,
          cursor,
          limit: request.pageSize,
        });
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
    [target]
  );
  const table = useServerTable<TechnicianRosterEntry>(load, { initial: FIRST_REQUEST });
  const stateFilter = table.request.filters.find((filter) => filter.key === 'state')?.value;

  const columns = useMemo<readonly OperationalColumn<TechnicianRosterEntry>[]>(
    () => [
      {
        id: 'name',
        headerKey: 'technicians.roster.name',
        flex: 2,
        cell: (row) =>
          row.displayName === null ? (
            <span className="text-text-secondary">{technicianName(messages, row)}</span>
          ) : (
            <bdi className="font-medium">{row.displayName}</bdi>
          ),
      },
      {
        id: 'trade',
        headerKey: 'technicians.roster.trade',
        flex: 1,
        cell: (row) =>
          row.trade === null ? (
            <span className="text-text-secondary">
              {translate(messages, 'technicians.roster.noTrade')}
            </span>
          ) : (
            <bdi>{row.trade}</bdi>
          ),
      },
      {
        id: 'employmentRef',
        headerKey: 'technicians.roster.employmentRef',
        hideBelow: 'md',
        cell: (row) =>
          row.employmentRef === null ? (
            <span className="text-text-secondary">
              {translate(messages, 'technicians.roster.noReference')}
            </span>
          ) : (
            <bdi>{row.employmentRef}</bdi>
          ),
      },
      {
        id: 'state',
        headerKey: 'technicians.roster.filter.state',
        cell: (row) =>
          translate(
            messages,
            row.isActive ? 'technicians.roster.state.active' : 'technicians.roster.state.inactive'
          ),
      },
    ],
    [messages]
  );

  const rowActions = useCallback(
    (row: TechnicianRosterEntry): readonly RowAction[] => [
      {
        kind: 'link',
        label: translate(messages, 'technicians.roster.open'),
        href: `/${locale}/technicians/${encodeURIComponent(row.id)}`,
        about: technicianName(messages, row),
      },
    ],
    [messages, locale]
  );

  return (
    <div className="flex flex-col gap-4" data-testid="technician-roster">
      {/*
       * Adding a technician means choosing a person, and the person picker can
       * search only with the user read. Without it the dialog could never pick
       * anyone, so the action is withheld and the reason is said instead.
       */}
      {canAdd ? (
        <div>
          <Button type="button" variant="contained" onClick={() => setCreating(true)}>
            {t('technicians.roster.add')}
          </Button>
        </div>
      ) : canManage ? (
        <p
          className="text-body text-text-secondary"
          data-testid="technician-roster-add-needs-users"
        >
          {t('technicians.roster.addNeedsUserList')}
        </p>
      ) : null}

      <FilterToolbar
        messages={messages}
        label={t('technicians.roster.title')}
        testId="technician-roster-toolbar"
        filters={[
          {
            kind: 'select',
            key: 'state',
            label: t('technicians.roster.filter.state'),
            placeholder: t('technicians.roster.filter.all'),
            value: stateFilter ?? '',
            options: ACTIVE_FILTER.options.map((option) => ({
              value: option.value,
              label: translate(messages, option.labelKey),
            })),
            onChange: (chosen) => {
              const cleared = stateFilter
                ? withoutFilter(table.request, { key: 'state', value: stateFilter })
                : table.request;
              table.setRequest(
                chosen ? withFilter(cleared, { key: 'state', value: chosen }) : cleared
              );
            },
          },
        ]}
      />

      <OperationalGrid<TechnicianRosterEntry>
        messages={messages}
        locale={locale}
        label={
          branchName
            ? `${t('technicians.roster.title')} — ${branchName}`
            : t('technicians.roster.title')
        }
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        filterDefinitions={[ACTIVE_FILTER]}
        rowActions={rowActions}
        suppressEmptyState={stateFilter === undefined}
        testId="technician-roster-grid"
      />
      {stateFilter === undefined &&
      table.status === 'idle' &&
      table.response &&
      table.response.rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="technicians.roster.emptyTitle"
          descriptionKey={
            canAdd ? 'technicians.roster.emptyBody' : 'technicians.roster.emptyBodyReadOnly'
          }
          testId="technician-roster-empty"
        />
      ) : null}

      {creating && canAdd ? (
        <AddTechnicianDialog
          messages={messages}
          locale={locale}
          target={target}
          branchName={branchName}
          canReadUsers={canReadUsers}
          onCreated={() => {
            setCreating(false);
            table.refresh();
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

interface TechnicianDraft {
  readonly person: ChosenAccount | null;
  readonly trade: string;
  readonly employmentRef: string;
}

const EMPTY_DRAFT: TechnicianDraft = { person: null, trade: '', employmentRef: '' };

/** The form's own checks, keyed by field, as catalogue keys. */
function checkDraft(draft: TechnicianDraft): Record<string, string> {
  const found: Record<string, string> = {};
  if (draft.person === null) found['userId'] = 'technicians.roster.personRequired';
  if (draft.trade.trim().length > MAX_TRADE) found['trade'] = 'field.tooLong';
  if (draft.employmentRef.trim().length > MAX_EMPLOYMENT_REF) {
    found['employmentRef'] = 'field.tooLong';
  }
  return found;
}

function AddTechnicianDialog({
  messages,
  locale,
  target,
  branchName,
  canReadUsers,
  onCreated,
  onClose,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly target: BranchTarget;
  readonly branchName: string;
  readonly canReadUsers: boolean;
  readonly onCreated: () => void;
  readonly onClose: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [draft, setDraft] = useState<TechnicianDraft>(EMPTY_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState>(IDLE);
  const [running, setRunning] = useState(false);
  // One create sent at a time, before `running` has disabled the button.
  const sending = useRef(false);
  const { errors, formRef } = useHeldRefusal(fieldErrors, {
    userId: draft.person?.id ?? '',
    trade: draft.trade,
    employmentRef: draft.employmentRef,
  });
  /*
   * Every field is unsaved work: the chosen person, the trade and the
   * reference. A confirmed discard — towards another branch or towards "All my
   * branches" — empties the draft and closes the dialog.
   */
  useUnsavedGuard(
    draft.person !== null || draft.trade.trim().length > 0 || draft.employmentRef.trim().length > 0,
    () => {
      setDraft(EMPTY_DRAFT);
      setFieldErrors({});
      setProblem(IDLE);
      onClose();
    }
  );

  const errorFor = (field: string): string | undefined => {
    const key = errors[field];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    if (sending.current) return;
    setProblem(IDLE);
    const found = checkDraft(draft);
    setFieldErrors(found);
    if (Object.keys(found).length > 0 || draft.person === null) return;
    sending.current = true;
    setRunning(true);
    let outcome: ActionState;
    try {
      outcome = await createTechnician({
        userId: draft.person.id,
        companyId: target.companyId,
        branchId: target.branchId,
        trade: draft.trade,
        employmentRef: draft.employmentRef,
      });
    } catch {
      // No answer came back: what was entered stays, and the button works again.
      outcome = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      sending.current = false;
      setRunning(false);
    }
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setDraft(EMPTY_DRAFT);
      onCreated();
      return;
    }
    if (outcome.fieldErrors && Object.keys(outcome.fieldErrors).length > 0) {
      setFieldErrors(outcome.fieldErrors);
    }
    setProblem(outcome);
  };

  const refusal = refusalSentence(messages, problem);

  return (
    <FormDialog
      messages={messages}
      title={t('technicians.roster.add')}
      description={
        branchName
          ? `${t('technicians.roster.addDescription')} ${branchName}`
          : t('technicians.roster.addDescription')
      }
      submitLabel={t('technicians.roster.addSubmit')}
      pendingLabel={t('admin.creating')}
      pending={running}
      error={refusal}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="technician-roster-create"
    >
      <AccountPicker
        messages={messages}
        locale={locale}
        label={t('technicians.roster.person')}
        value={draft.person}
        onChange={(person) => setDraft((current) => ({ ...current, person }))}
        canSearch={canReadUsers}
        error={errorFor('userId')}
        countsAsUnsaved
        testId="technician-roster-person"
      />
      <FormTextField
        name="trade"
        label={t('technicians.roster.trade')}
        description={t('technicians.roster.tradeHint')}
        value={draft.trade}
        onChange={(trade) => setDraft((current) => ({ ...current, trade }))}
        error={errorFor('trade')}
        autoComplete="off"
        maxLength={MAX_TRADE}
      />
      <FormTextField
        name="employmentRef"
        label={t('technicians.roster.employmentRef')}
        description={t('technicians.roster.employmentRefHint')}
        value={draft.employmentRef}
        onChange={(employmentRef) => setDraft((current) => ({ ...current, employmentRef }))}
        error={errorFor('employmentRef')}
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_EMPLOYMENT_REF}
      />
    </FormDialog>
  );
}
