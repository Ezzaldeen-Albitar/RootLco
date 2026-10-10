'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { withFilter, withSearch, withoutFilter } from '@/components/data-table/table-state';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic, translateWithValues } from '@/i18n/get-messages';
import { formatDate } from '@/lib/format';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import { roleDisplayName } from '../../access/role-name';
import { FormDialog } from '../../shared/components/FormDialog';
import { useServerTable } from '../../shared/use-server-table';
import { listUsers, type RoleOption, type UserRow } from '../api';
import {
  activateInvitationAction,
  cancelInvitationAction,
  changeUserStatusAction,
  inviteUserAction,
  revokeUserSessionsAction,
} from '../actions';

/**
 * The Users screen, on Material UI (ADR-022, `P1-32-PRE-OD-ADM3`).
 *
 * ## What it reads, and how
 *
 * `GET /api/v1/iam/users` (`iam.user-list`, `iam.user.read`) is cursor-paged
 * with no total, so the list is the operational grid driven by
 * `useServerTable` (G1–G9): Previous and Next walk the server's cursor, the
 * label is "Page N", and nothing on the screen counts the people. The search
 * term and the status filter go to the server as part of the request and never
 * into the address.
 *
 * ## Every row action is a confirmation with a written reason
 *
 * Not decoration: `iam.user-status-change`, `iam.invitation-cancel`,
 * `iam.invitation-activate` and `iam.user-session-revoke-all` all take a
 * `reason` that becomes an audit record, and the backend refuses an empty one.
 * `ReasonDialog` keeps the reason in component state until submit — an audit
 * reason is free text about an operational decision and belongs in neither a
 * store nor a URL — and counts a typed reason as unsaved work.
 *
 * ## Which actions appear
 *
 * Only those the actor's permissions could satisfy, and only those legal from
 * the row's current status: `invited` may be activated or cancelled, `active`
 * may be locked (a suspension) or archived, `locked` may be unlocked (a
 * reactivation) or archived, `archived` is terminal. Offering an action the
 * transition engine will reject is a promise the product cannot keep.
 *
 * The visibility rule is courtesy. Every action still calls the operation and
 * the backend's refusal is the one that counts — including the refusal of an
 * administrator changing their own account.
 *
 * ## One press, one request
 *
 * A confirmation and the invitation are each held by a ref while their answer
 * is awaited, so two presses inside one frame send one request; the disabled
 * button is the visible half of the same rule.
 */

const STATUS_VALUES = ['invited', 'active', 'locked', 'archived'] as const;

/** The status filter's definition, so the grid can label the chip it shows. */
const STATUS_FILTER = {
  key: 'status',
  labelKey: 'users.filter.status',
  options: STATUS_VALUES.map((value) => ({ value, labelKey: `users.status.${value}` })),
} as const;

/** The longest term `iam.user-list` accepts. */
const MAX_SEARCH = 120;

type PendingAction = {
  readonly kind: 'lock' | 'unlock' | 'archive' | 'activate' | 'cancel' | 'revoke';
  readonly user: UserRow;
};

export function UsersScreen({
  locale,
  messages,
  canManage,
  canRevokeSessions,
  roles,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canManage: boolean;
  readonly canRevokeSessions: boolean;
  readonly roles: readonly RoleOption[];
}) {
  const table = useServerTable<UserRow>(listUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionState, setActionState] = useState<ActionState>(IDLE);
  const [running, startTransition] = useTransition();
  // The request in flight, held across the frame the disabled state needs to
  // reach the button: two presses inside one frame send one request.
  const inFlight = useRef(false);

  const t = useCallback((key: string) => translateDynamic(messages, key), [messages]);

  const statusFilter = table.request.filters.find((filter) => filter.key === 'status')?.value;

  const columns: readonly OperationalColumn<UserRow>[] = [
    {
      id: 'displayName',
      headerKey: 'users.column.displayName',
      flex: 1.2,
      cell: (row) => <span className="font-medium text-text-primary">{row.displayName}</span>,
    },
    {
      id: 'email',
      headerKey: 'users.column.email',
      flex: 1.4,
      // The address is also on the person's own page, which every row links to.
      hideBelow: 'md',
      cell: (row) => <span dir="ltr">{row.email}</span>,
    },
    {
      id: 'status',
      headerKey: 'users.column.status',
      cell: (row) => <StatusPill status={row.status} messages={messages} />,
    },
    {
      id: 'mfa',
      headerKey: 'users.column.mfa',
      hideBelow: 'lg',
      cell: (row) => t(row.mfaRequired ? 'users.mfa.required' : 'users.mfa.notRequired'),
    },
    {
      id: 'createdAt',
      headerKey: 'users.column.createdAt',
      hideBelow: 'lg',
      cell: (row) => formatDate(row.createdAt, locale),
    },
  ];

  const rowActions = (row: UserRow): readonly RowAction[] => [
    // Roles and where they apply live on the person's own page. Offered to every
    // reader of this list: that page reads with `iam.user.read`, the code this
    // list already required, and shows its management controls only to a
    // session holding the codes they declare.
    {
      kind: 'link',
      label: t('users.action.access'),
      href: `/${locale}/administration/users/${encodeURIComponent(row.id)}`,
      about: row.displayName,
    },
    ...availableActions(row, canManage, canRevokeSessions).map((kind): RowAction => ({
      kind: 'button',
      label: t(ACTION_LABEL[kind]),
      about: row.displayName,
      onClick: () => {
        setActionState(IDLE);
        setPending({ kind, user: row });
      },
    })),
  ];

  const run = (task: () => Promise<ActionState>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      let result: ActionState;
      try {
        result = await task();
      } catch {
        // The answer never arrived: nothing is known to have changed.
        result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
      } finally {
        inFlight.current = false;
      }
      // The attempt number makes a repeated refusal a new announcement
      // (P1-26-F-038); the counter lives here, where the repeats happen.
      setActionState((was) => ({ ...result, attempt: (was.attempt ?? 0) + 1 }));
      // The OPERATION result goes to the global notification authority, fixed
      // to the viewport, so the answer arrives where the person is
      // (`P1-26-F-070`). `invalid` is not raised there: it stays in the dialog.
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        setPending(null);
        table.refresh();
      }
    });
  };

  const refused = actionState.status !== 'idle' && actionState.status !== 'success';
  const reasonRefusal = refused ? actionState.fieldErrors?.reason : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="contained"
            onClick={() => {
              setActionState(IDLE);
              setInviteOpen(true);
            }}
          >
            {t('users.invite')}
          </Button>
        </div>
      ) : null}

      <FilterToolbar
        messages={messages}
        label={t('users.title')}
        testId="users-toolbar"
        search={{
          label: t('users.searchLabel'),
          example: t('users.searchHint'),
          value: table.request.search,
          maxLength: MAX_SEARCH,
          onChange: (next) => table.setRequest(withSearch(table.request, next)),
        }}
        filters={[
          {
            kind: 'select',
            key: 'status',
            label: t('users.filter.status'),
            placeholder: t('users.filter.all'),
            value: statusFilter ?? '',
            options: STATUS_VALUES.map((value) => ({ value, label: t(`users.status.${value}`) })),
            onChange: (chosen) => {
              const cleared = statusFilter
                ? withoutFilter(table.request, { key: 'status', value: statusFilter })
                : table.request;
              table.setRequest(
                chosen ? withFilter(cleared, { key: 'status', value: chosen }) : cleared
              );
            },
          },
        ]}
      />

      <OperationalGrid<UserRow>
        messages={messages}
        locale={locale}
        label={t('users.title')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        filterDefinitions={[STATUS_FILTER]}
        rowActions={rowActions}
        testId="users-grid"
      />

      {/*
        MOUNTED ONLY WHILE OPEN, so a second invitation starts from an empty
        form rather than the previous answer (P1-26-F-020).
      */}
      {inviteOpen ? (
        <InviteDialog
          // Closing always re-reads the list: an invitation that succeeded has
          // added a row, and a re-read of an unchanged list costs one request.
          onClose={() => {
            setInviteOpen(false);
            table.refresh();
          }}
          messages={messages}
          roles={roles}
        />
      ) : null}

      <ReasonDialog
        open={pending !== null}
        messages={messages}
        destructive={pending?.kind !== 'activate' && pending?.kind !== 'unlock'}
        pending={running}
        countsAsUnsaved
        title={pending ? t(CONFIRM_TITLE[pending.kind]) : ''}
        description={
          pending ? `${pending.user.displayName} — ${t(CONFIRM_BODY[pending.kind])}` : undefined
        }
        confirmLabel={pending ? t(ACTION_LABEL[pending.kind]) : ''}
        reasonLabel={t('admin.reason')}
        maxLength={500}
        reasonError={reasonRefusal ? t(reasonRefusal) : undefined}
        error={
          refused && !reasonRefusal
            ? translateWithValues(
                messages,
                actionState.fieldErrors?.status ?? actionState.messageKey ?? 'admin.actionFailed',
                actionState.fieldErrors?.status ? undefined : actionState.messageValues
              )
            : undefined
        }
        onCancel={() => setPending(null)}
        onConfirm={(text) => {
          if (!pending) return;
          const { kind, user } = pending;
          run(() => {
            if (kind === 'cancel') return cancelInvitationAction(user.id, text);
            if (kind === 'activate') return activateInvitationAction(user.id, text);
            if (kind === 'revoke') return revokeUserSessionsAction(user.id, text);
            const next = kind === 'archive' ? 'archived' : kind === 'lock' ? 'locked' : 'active';
            return changeUserStatusAction(user.id, next, text);
          });
        }}
      />
    </div>
  );
}

/**
 * The actions legal from a row's current status.
 *
 * `archived` is terminal in the transition engine, so it offers nothing —
 * showing a disabled Archive on an archived account invites the operator to
 * wonder what is wrong with the button.
 */
function availableActions(
  row: UserRow,
  canManage: boolean,
  canRevokeSessions: boolean
): PendingAction['kind'][] {
  const available: PendingAction['kind'][] = [];
  if (canManage) {
    if (row.status === 'invited') available.push('activate', 'cancel');
    if (row.status === 'active') available.push('lock', 'archive');
    if (row.status === 'locked') available.push('unlock', 'archive');
  }
  // Revoking sessions needs BOTH permissions the operation declares.
  if (canManage && canRevokeSessions && row.status !== 'archived') available.push('revoke');
  return available;
}

const ACTION_LABEL: Record<PendingAction['kind'], string> = {
  lock: 'users.action.lock',
  unlock: 'users.action.unlock',
  archive: 'users.action.archive',
  activate: 'users.action.activate',
  cancel: 'users.action.cancelInvitation',
  revoke: 'users.action.revokeSessions',
};

const CONFIRM_TITLE: Record<PendingAction['kind'], string> = {
  lock: 'users.confirm.lock',
  unlock: 'users.confirm.unlock',
  archive: 'users.confirm.archive',
  activate: 'users.confirm.activate',
  cancel: 'users.confirm.cancelInvitation',
  revoke: 'users.confirm.revokeSessions',
};

const CONFIRM_BODY: Record<PendingAction['kind'], string> = {
  lock: 'users.confirm.lockBody',
  unlock: 'users.confirm.unlockBody',
  archive: 'users.confirm.archiveBody',
  activate: 'users.confirm.activateBody',
  cancel: 'users.confirm.cancelInvitationBody',
  revoke: 'users.confirm.revokeSessionsBody',
};

const STATUS_TONE: Record<UserRow['status'], string> = {
  invited: 'border-info-border bg-info-subtle',
  active: 'border-success-border bg-success-subtle',
  locked: 'border-warning-border bg-warning-subtle',
  archived: 'border-border bg-surface-subtle',
};

function StatusPill({
  status,
  messages,
}: {
  readonly status: UserRow['status'];
  readonly messages: Messages;
}) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-caption text-text-primary ${STATUS_TONE[status]}`}
    >
      {translateDynamic(messages, `users.status.${status}`)}
    </span>
  );
}

interface InviteDraft {
  readonly email: string;
  readonly displayName: string;
  readonly mfaRequired: boolean;
  readonly roleIds: readonly string[];
}

const EMPTY_INVITE: InviteDraft = { email: '', displayName: '', mfaRequired: false, roleIds: [] };

/**
 * The invitation dialog.
 *
 * It does NOT close itself on success. An auto-close takes the confirmation off
 * screen before it has been read, and the operator is left guessing whether the
 * invitation was sent. The dialog shows the outcome; closing it is the
 * operator's decision, and closing re-reads the list.
 *
 * Every entry is held in this component's state and sent from it, so a refused
 * invitation — a duplicate address is the ordinary case — keeps the address,
 * the name, the two-factor requirement and every role that was chosen
 * (`NEW-FE-01`, which the Server Action form reset caused before). Every entry
 * counts as unsaved work until the invitation is sent.
 */
function InviteDialog({
  onClose,
  messages,
  roles,
}: {
  readonly onClose: () => void;
  readonly messages: Messages;
  readonly roles: readonly RoleOption[];
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const [draft, setDraft] = useState<InviteDraft>(EMPTY_INVITE);
  const [state, setState] = useState<ActionState>(IDLE);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, {
    email: draft.email,
    displayName: draft.displayName,
    roleIds: draft.roleIds.join(','),
  });
  const sent = state.status === 'success';
  const dirty =
    !sent &&
    (draft.email.trim() !== '' ||
      draft.displayName.trim() !== '' ||
      draft.mfaRequired ||
      draft.roleIds.length > 0);
  useUnsavedGuard(dirty, onClose);

  const submit = async () => {
    if (inFlight.current || sent) return;
    const local: Record<string, string> = {};
    if (draft.email.trim() === '') local['email'] = 'field.required';
    if (draft.displayName.trim() === '') local['displayName'] = 'field.required';
    if (Object.keys(local).length > 0) {
      setFieldErrors(local);
      setState(IDLE);
      return;
    }
    inFlight.current = true;
    setSending(true);
    const form = new FormData();
    form.set('email', draft.email);
    form.set('displayName', draft.displayName);
    if (draft.mfaRequired) form.set('mfaRequired', 'on');
    for (const id of draft.roleIds) form.append('roleIds', id);
    let result: ActionState;
    try {
      result = await inviteUserAction(state, form);
    } catch {
      result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      inFlight.current = false;
      setSending(false);
    }
    notifyActionResult(result, messages);
    // The duplicate address is a statement about the address: said on its box.
    const own =
      result.status === 'conflict' && result.messageKey === 'users.invite.duplicate'
        ? { email: 'users.invite.duplicate' }
        : (result.fieldErrors ?? {});
    setFieldErrors(own);
    setState(result);
  };

  const refusal =
    state.status !== 'idle' &&
    state.status !== 'success' &&
    Object.keys(state.fieldErrors ?? {}).length === 0 &&
    state.messageKey !== 'users.invite.duplicate'
      ? translateWithValues(messages, state.messageKey ?? 'admin.actionFailed', state.messageValues)
      : undefined;
  const fieldError = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);

  return (
    /*
     * A form, so the shared `FormDialog` (a dialog, not an alert —
     * `P1-32-PRE-OD-ADM4`). Send belongs to the form, so Enter in the address
     * or the name box and a press of Send are the same submission, behind the
     * same single-flight guard; once sent, the outcome stays on screen and only
     * Close remains.
     */
    <FormDialog
      messages={messages}
      title={t('users.invite.title')}
      description={t('users.invite.description')}
      submitLabel={t('users.invite.submit')}
      pending={sending}
      error={refusal}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      completed={sent ? t('users.invite.done') : undefined}
      testId="users-invite-dialog"
    >
      <FormTextField
        name="email"
        type="email"
        label={t('users.invite.email')}
        required
        autoFocus
        autoComplete="off"
        spellCheck={false}
        dir="ltr"
        maxLength={320}
        value={draft.email}
        onChange={(email) => setDraft((was) => ({ ...was, email }))}
        error={fieldError('email')}
      />
      <FormTextField
        name="displayName"
        label={t('users.invite.displayName')}
        required
        autoComplete="off"
        maxLength={200}
        value={draft.displayName}
        onChange={(displayName) => setDraft((was) => ({ ...was, displayName }))}
        error={fieldError('displayName')}
      />
      <FormCheckboxField
        name="mfaRequired"
        label={t('users.invite.mfaRequired')}
        checked={draft.mfaRequired}
        onChange={(mfaRequired) => setDraft((was) => ({ ...was, mfaRequired }))}
      />
      {roles.length > 0 ? (
        <fieldset
          className="flex flex-col gap-1"
          aria-describedby="users-invite-roles-hint"
          data-invalid={errors['roleIds'] ? true : undefined}
        >
          <legend className="text-label font-medium text-text-primary">
            {t('users.invite.roles')}
          </legend>
          <p id="users-invite-roles-hint" className="text-caption text-text-secondary">
            {t('users.invite.rolesHint')}
          </p>
          {roles.map((role) => (
            <FormCheckboxField
              key={role.id}
              label={roleDisplayName(messages, role)}
              checked={draft.roleIds.includes(role.id)}
              onChange={(on) =>
                setDraft((was) => ({
                  ...was,
                  roleIds: on
                    ? [...was.roleIds, role.id]
                    : was.roleIds.filter((id) => id !== role.id),
                }))
              }
            />
          ))}
          {errors['roleIds'] ? (
            <p role="alert" className="text-caption text-error">
              {t(errors['roleIds'])}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </FormDialog>
  );
}
