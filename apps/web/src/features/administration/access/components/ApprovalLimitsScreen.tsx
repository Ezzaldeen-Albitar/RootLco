'use client';

import { useCallback, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { DateField, workingZone } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { DirectoryEmptyNotice } from '@/features/working-context/components/WorkingBranchField';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic, translateWithValues } from '@/i18n/get-messages';
import { formatDayInZone } from '@/lib/branch-time';
import { formatMoney } from '@/lib/money';
import { intlLocale } from '@/lib/format';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import { AccountPicker, type ChosenAccount } from '../../users/components/AccountPicker';
import { FormDialog } from '../../shared/components/FormDialog';
import { useServerTable } from '../../shared/use-server-table';
import { listApprovalLimits } from '../api';
import {
  APPROVAL_LIMIT_TYPES,
  isKnownApprovalLimitType,
  type ApprovalLimitRow,
  type RoleRow,
} from '../types';
import { createApprovalLimitAction, endApprovalLimitAction } from '../actions';
import { roleDisplayName } from '../role-name';

/**
 * Approval limits, on Material UI (ADR-022, `P1-32-PRE-OD-ADM4`).
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
 * The limit type is CHOSEN from the types the platform consults
 * (`APPROVAL_LIMIT_TYPES`): a discount approval limit and a credit-note approval
 * limit (Owner decision D13, ADR-023), each with its own currency. They are
 * separate — neither counts for the other — and the screen names each in words.
 * A row of any other type already on file is listed under its own code. This
 * screen supplies neither a default limit type nor a default currency. A
 * credit-note limit must be above zero, and every amount must fit its
 * currency's smallest coin; the server answers the second, on the amount field.
 *
 * ## Nobody sets their own ceiling here
 *
 * The service refuses a limit for yourself and a limit for a role you hold
 * (`assertApprovalLimitNotForSelf`, `assertApprovalLimitNotForHeldRole`, ADR-023
 * D8). The form offers no control that could exempt anyone from that, and the
 * refusal is said in its own words beside the buttons — never as a missing
 * permission, which would send the operator to ask for access that would change
 * nothing.
 *
 * ## A person and a role are NAMED, by the list itself
 *
 * `iam.approval-limit-list` publishes the person's display name and the role's
 * name beside each reference (route checklist prerequisite 9), each only to a
 * caller holding the code that reads it (`iam.user.read`, `iam.role.read`). A
 * name the list withholds is said to be unavailable, in words — never the
 * account or role reference. A provisioned role is named in the reader's
 * language (`roleDisplayName`) when this screen holds the role's code.
 *
 * ## The list is complete, and says so
 *
 * `GET /iam/approval-limits` takes filters and no cursor: it returns the whole
 * set, which the loader pages for the grid. Below the server's cap the screen
 * says this is the complete list; at the cap it says the list may be incomplete.
 *
 * ## Writes
 *
 * Both forms are the shared `FormDialog`, held in this component's state and sent
 * from its own handler, so a refusal keeps every entry and moves the cursor to
 * the field it names. Each write is sent once; every entry counts as unsaved
 * work. Ending a limit sends the version the list showed; a limit changed since
 * is the server's conflict, said with "Load the latest version".
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
   * `iam.user.read` — whether a person can be FOUND by name for a limit, and
   * whether the list can name them. Without it the dialog keeps the labelled
   * account reference box, because `iam.approval-limit-create` does not need the
   * user read.
   */
  readonly canReadUsers?: boolean;
}) {
  const table = useServerTable<ApprovalLimitRow>(listApprovalLimits);
  const context = useWorkingContext();
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<ApprovalLimitRow | null>(null);
  const [conflict, setConflict] = useState<ActionState | null>(null);

  const t = useCallback((key: string) => translateDynamic(messages, key), [messages]);
  const zone = workingZone(context) ?? 'UTC';
  const day = (value: string) => formatDayInZone(value, intlLocale(locale), zone);

  const roleName = (row: ApprovalLimitRow): string => {
    const role = roles.find((candidate) => candidate.id === row.roleId);
    if (role) return roleDisplayName(messages, role);
    if (typeof row.roleName === 'string' && row.roleName.trim() !== '') return row.roleName;
    return t('approvalLimits.subject.roleUnknown');
  };
  const personName = (row: ApprovalLimitRow): string => {
    if (typeof row.userDisplayName === 'string' && row.userDisplayName.trim() !== '') {
      return row.userDisplayName;
    }
    // Withheld: without the user read the list names nobody; with it, an
    // account the directory could not name is said to be one.
    return t(canReadUsers ? 'approvalLimits.person.notAvailable' : 'approvalLimits.person.denied');
  };
  const typeOf = (row: ApprovalLimitRow) =>
    isKnownApprovalLimitType(row.limitType)
      ? t(`approvalLimits.type.${row.limitType}`)
      : row.limitType;
  const subjectOf = (row: ApprovalLimitRow) =>
    row.roleId
      ? roleName(row)
      : row.userId
        ? personName(row)
        : t('approvalLimits.person.unresolved');

  const columns: readonly OperationalColumn<ApprovalLimitRow>[] = [
    {
      id: 'subject',
      headerKey: 'approvalLimits.column.subject',
      flex: 1.4,
      cell: (row) => (
        <span>
          <span className="text-text-muted">
            {t(row.roleId ? 'approvalLimits.subject.role' : 'approvalLimits.subject.user')}:{' '}
          </span>
          <bdi>{subjectOf(row)}</bdi>
        </span>
      ),
    },
    {
      id: 'limitType',
      headerKey: 'approvalLimits.column.type',
      flex: 1.1,
      cell: (row) =>
        isKnownApprovalLimitType(row.limitType) ? (
          <span>{t(`approvalLimits.type.${row.limitType}`)}</span>
        ) : (
          <code className="font-mono text-caption" dir="ltr">
            {row.limitType}
          </code>
        ),
    },
    {
      id: 'amount',
      headerKey: 'approvalLimits.column.amount',
      numeric: true,
      // `currencyCode`, because that is what the API publishes on the read
      // path even though the create body takes `currency` (P1-26-F-016).
      cell: (row) => (
        <bdi>
          {formatMoney({ amount: row.amount, currency: row.currencyCode }, intlLocale(locale))}
        </bdi>
      ),
    },
    {
      id: 'effectiveFrom',
      headerKey: 'approvalLimits.column.from',
      cell: (row) => <bdi>{day(row.effectiveFrom)}</bdi>,
    },
    {
      id: 'effectiveTo',
      headerKey: 'approvalLimits.column.to',
      cell: (row) => (row.effectiveTo ? <bdi>{day(row.effectiveTo)}</bdi> : '—'),
    },
  ];

  const rowActions = (row: ApprovalLimitRow): readonly RowAction[] =>
    canManage && row.effectiveTo === null
      ? [
          {
            kind: 'button',
            label: t('approvalLimits.end'),
            // Who and what, so each row's button has its own name.
            about: `${subjectOf(row)}, ${typeOf(row)}`,
            onClick: () => {
              setConflict(null);
              setEnding(row);
            },
          },
        ]
      : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="approval-limits-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-supporting text-text-muted">
          {table.response && table.response.total === null
            ? t('approvalLimits.mayBeTruncated')
            : t('approvalLimits.completeList')}
        </p>
        {canManage ? (
          <Button
            type="button"
            variant="contained"
            onClick={() => {
              setConflict(null);
              setCreating(true);
            }}
          >
            {t('approvalLimits.create')}
          </Button>
        ) : null}
      </div>

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

      <OperationalGrid<ApprovalLimitRow>
        messages={messages}
        locale={locale}
        label={t('approvalLimits.title')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={canManage ? rowActions : undefined}
        testId="approval-limits-grid"
      />

      {creating ? (
        <CreateDialog
          locale={locale}
          messages={messages}
          roles={roles}
          canReadUsers={canReadUsers}
          onCreated={() => {
            setCreating(false);
            table.refresh();
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {ending ? (
        <EndDialog
          key={ending.id}
          messages={messages}
          limit={ending}
          subject={subjectOf(ending)}
          onEnded={() => {
            setEnding(null);
            table.refresh();
          }}
          onConflict={(result) => {
            setEnding(null);
            setConflict(result);
            table.refresh();
          }}
          onClose={() => setEnding(null)}
        />
      ) : null}
    </div>
  );
}

/** The refusal said beside the buttons: anything that is not a field's own complaint. */
function refusalSentence(messages: Messages, outcome: ActionState | null): string | undefined {
  if (!outcome || outcome.status === 'idle' || outcome.status === 'success') return undefined;
  if (Object.keys(outcome.fieldErrors ?? {}).length > 0) return undefined;
  return translateWithValues(
    messages,
    outcome.messageKey ?? 'admin.actionFailed',
    outcome.messageValues
  );
}

function EndDialog({
  messages,
  limit,
  subject,
  onEnded,
  onConflict,
  onClose,
}: {
  readonly messages: Messages;
  readonly limit: ApprovalLimitRow;
  readonly subject: string;
  readonly onEnded: () => void;
  readonly onConflict: (result: ActionState) => void;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const [effectiveTo, setEffectiveTo] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState | null>(null);
  const [running, setRunning] = useState(false);
  const sending = useRef(false);
  const { errors, formRef } = useHeldRefusal(fieldErrors, { effectiveTo });
  useUnsavedGuard(effectiveTo !== '', onClose);

  const submit = async () => {
    if (sending.current) return;
    setProblem(null);
    if (effectiveTo === '') {
      setFieldErrors({ effectiveTo: 'approvalLimits.error.date' });
      return;
    }
    setFieldErrors({});
    sending.current = true;
    setRunning(true);
    let result: ActionState;
    try {
      // The version the list showed: a limit changed since is a conflict.
      result = await endApprovalLimitAction(limit.id, limit.recordVersion, effectiveTo);
    } catch {
      result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    }
    // Held after a success until the dialog closes: an Enter or a press in the
    // moment before it does would otherwise send the same values again.
    if (result.status !== 'success') sending.current = false;
    setRunning(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      onEnded();
      return;
    }
    if (result.status === 'conflict') {
      onConflict(result);
      return;
    }
    if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
      setFieldErrors(result.fieldErrors);
    }
    setProblem(result);
  };

  return (
    <FormDialog
      messages={messages}
      title={t('approvalLimits.end.title')}
      description={`${subject}. ${t('approvalLimits.end.body')}`}
      submitLabel={t('admin.save')}
      pending={running}
      error={refusalSentence(messages, problem)}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="approval-limits-end"
    >
      <DateField
        name="effectiveTo"
        label={t('approvalLimits.field.effectiveTo')}
        required
        value={effectiveTo}
        onChange={setEffectiveTo}
        error={errors['effectiveTo'] ? t(errors['effectiveTo']) : undefined}
      />
    </FormDialog>
  );
}

interface LimitDraft {
  readonly subject: 'role' | 'user';
  readonly companyId: string;
  readonly roleId: string;
  readonly userReference: string;
  readonly limitType: string;
  readonly amount: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
}

function CreateDialog({
  locale,
  messages,
  roles,
  canReadUsers,
  onCreated,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly roles: readonly RoleRow[];
  readonly canReadUsers: boolean;
  readonly onCreated: () => void;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  /*
   * The companies this operator may act in, BY NAME, from the working context.
   * The reference is still what is SENT — the operation takes a company
   * identifier — and it is still authorized server-side.
   */
  const { companies: workingCompanies } = useWorkingContext();
  /*
   * Every entry lives here and is sent from here, so a refusal — usually about
   * the amount, or the server's separation-of-duties answer — keeps all of them.
   * The amount is held as the operator typed it, never parsed or normalised.
   * Neither the limit type nor the currency has a default (see the file header).
   */
  const initial: LimitDraft = {
    subject: 'role',
    companyId: workingCompanies[0]?.id ?? '',
    roleId: roles[0]?.id ?? '',
    userReference: '',
    limitType: '',
    amount: '',
    currency: '',
    effectiveFrom: '',
    effectiveTo: '',
  };
  const [draft, setDraft] = useState<LimitDraft>(initial);
  /* The person, FOUND by name or email, for a caller holding `iam.user.read`. */
  const [person, setPerson] = useState<ChosenAccount | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState | null>(null);
  const [running, setRunning] = useState(false);
  // One create sent at a time, before `running` has disabled the button.
  const sending = useRef(false);
  const userId = canReadUsers ? (person?.id ?? '') : draft.userReference;
  const { errors, formRef } = useHeldRefusal(fieldErrors, {
    companyId: draft.companyId,
    subject: draft.subject,
    roleId: draft.roleId,
    userId,
    limitType: draft.limitType,
    amount: draft.amount,
    currency: draft.currency,
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo,
  });
  const dirty =
    draft.subject !== initial.subject ||
    draft.companyId !== initial.companyId ||
    draft.roleId !== initial.roleId ||
    userId !== '' ||
    draft.limitType !== '' ||
    draft.amount.trim() !== '' ||
    draft.currency.trim() !== '' ||
    draft.effectiveFrom !== '' ||
    draft.effectiveTo !== '';
  useUnsavedGuard(dirty, onClose);

  const set =
    <K extends keyof LimitDraft>(field: K) =>
    (value: LimitDraft[K]) =>
      setDraft((current) => ({ ...current, [field]: value }));
  const errorFor = (field: string): string | undefined =>
    errors[field] ? t(errors[field] as string) : undefined;

  const submit = async () => {
    if (sending.current) return;
    setProblem(null);
    const form = new FormData();
    form.set('companyId', draft.companyId);
    form.set('subject', draft.subject);
    if (draft.subject === 'role') form.set('roleId', draft.roleId);
    else form.set('userId', userId);
    form.set('limitType', draft.limitType);
    form.set('amount', draft.amount);
    form.set('currency', draft.currency);
    form.set('effectiveFrom', draft.effectiveFrom);
    if (draft.effectiveTo !== '') form.set('effectiveTo', draft.effectiveTo);
    sending.current = true;
    setRunning(true);
    let outcome: ActionState;
    try {
      // The action checks every rule first and sends nothing when one fails.
      outcome = await createApprovalLimitAction(IDLE, form);
    } catch {
      outcome = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    }
    // Held after a success until the dialog closes: an Enter or a press in the
    // moment before it does would otherwise send the same values again.
    if (outcome.status !== 'success') sending.current = false;
    setRunning(false);
    if (outcome.status !== 'invalid') notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setDraft(initial);
      setPerson(null);
      onCreated();
      return;
    }
    setFieldErrors(outcome.fieldErrors ?? {});
    setProblem(outcome);
  };

  return (
    <FormDialog
      messages={messages}
      title={t('approvalLimits.create.title')}
      submitLabel={t('admin.create')}
      pendingLabel={t('admin.creating')}
      pending={running}
      error={refusalSentence(messages, problem)}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="approval-limits-create"
    >
      {workingCompanies.length > 0 ? (
        <FormSelectField
          name="companyId"
          label={t('approvalLimits.field.companyId')}
          required
          value={draft.companyId}
          onChange={set('companyId')}
          options={workingCompanies.map((company) => ({ value: company.id, label: company.name }))}
          placeholder={t('form.select.placeholder')}
          error={errorFor('companyId')}
        />
      ) : (
        // No company to choose, or the directory could not be read: said so.
        <DirectoryEmptyNotice messages={messages} fallbackKey="workingContext.noCompany" />
      )}

      <FormSelectField
        name="subject"
        label={t('approvalLimits.field.subject')}
        value={draft.subject}
        onChange={(value) => set('subject')(value === 'user' ? 'user' : 'role')}
        options={[
          { value: 'role', label: t('approvalLimits.subject.role') },
          { value: 'user', label: t('approvalLimits.subject.user') },
        ]}
        error={errorFor('subject')}
      />

      {draft.subject === 'role' ? (
        <FormSelectField
          name="roleId"
          label={t('approvalLimits.field.roleId')}
          value={draft.roleId}
          onChange={set('roleId')}
          options={roles.map((role) => ({
            value: role.id,
            label: roleDisplayName(messages, role),
          }))}
          placeholder={roles.length === 0 ? t('field.selectPlaceholder') : undefined}
          error={errorFor('roleId')}
        />
      ) : canReadUsers ? (
        <AccountPicker
          messages={messages}
          locale={locale}
          label={t('approvalLimits.field.person')}
          value={person}
          onChange={setPerson}
          canSearch
          error={errorFor('userId')}
          countsAsUnsaved
          testId="approval-limit-person-picker"
        />
      ) : (
        // Without `iam.user.read` nobody can be looked up here, and creating a
        // limit does not need that code: the account reference box stays,
        // labelled and explained, and the action checks its shape.
        <FormTextField
          name="userId"
          label={t('approvalLimits.field.userId')}
          description={t('approvalLimits.field.userIdHelp')}
          required
          spellCheck={false}
          autoComplete="off"
          dir="ltr"
          value={draft.userReference}
          onChange={set('userReference')}
          error={errorFor('userId')}
          testId="approval-limit-person-reference"
        />
      )}

      <FormSelectField
        name="limitType"
        label={t('approvalLimits.field.limitType')}
        description={t('approvalLimits.field.limitTypeHint')}
        required
        value={draft.limitType}
        onChange={set('limitType')}
        options={APPROVAL_LIMIT_TYPES.map((value) => ({
          value,
          label: t(`approvalLimits.type.${value}`),
        }))}
        placeholder={t('form.select.placeholder')}
        error={errorFor('limitType')}
      />

      {/*
        `inputMode="decimal"` and NOT a number input. A number input hands back
        a value the browser has already coerced, drops trailing zeros, and
        differs between locales on the decimal separator — all of which are
        ways an exact amount stops being exact before it leaves the page.
      */}
      <FormTextField
        name="amount"
        inputMode="decimal"
        label={t('approvalLimits.field.amount')}
        required
        spellCheck={false}
        autoComplete="off"
        dir="ltr"
        value={draft.amount}
        onChange={set('amount')}
        error={errorFor('amount')}
      />

      <FormTextField
        name="currency"
        label={t('approvalLimits.field.currency')}
        description={t('approvalLimits.field.currencyHint')}
        required
        maxLength={3}
        spellCheck={false}
        autoComplete="off"
        dir="ltr"
        value={draft.currency}
        onChange={set('currency')}
        error={errorFor('currency')}
      />

      <DateField
        name="effectiveFrom"
        label={t('approvalLimits.field.effectiveFrom')}
        required
        value={draft.effectiveFrom}
        onChange={set('effectiveFrom')}
        error={errorFor('effectiveFrom')}
      />
      <DateField
        name="effectiveTo"
        label={t('approvalLimits.field.effectiveTo')}
        description={t('field.optional')}
        value={draft.effectiveTo}
        onChange={set('effectiveTo')}
        error={errorFor('effectiveTo')}
      />
    </FormDialog>
  );
}
