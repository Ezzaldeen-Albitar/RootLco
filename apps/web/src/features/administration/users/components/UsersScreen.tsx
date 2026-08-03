'use client';

import { useActionState, useCallback, useState, useTransition } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { withSearch, type TableRequest } from '@/components/data-table/table-state';
import { CheckboxField, SelectField, TextField } from '@/components/forms/Field';
import { Dialog, ReasonConfirmDialog } from '@/components/overlays/Overlays';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { formatDate } from '@/lib/format';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { SubmitButton } from '@/features/authentication/components/SubmitButton';
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
 * The Users screen.
 *
 * ## Every row action is a confirmation with a written reason
 *
 * Not decoration: `iam.user-status-change`, `iam.invitation-cancel`,
 * `iam.invitation-activate` and `iam.user-session-revoke-all` all take a
 * `reason` that becomes an audit record, and the backend refuses an empty one.
 * `ReasonConfirmDialog` is the shared control for exactly this, and it keeps the
 * reason in component state until submit — an audit reason is free text about an
 * operational decision and belongs in neither a store nor a URL.
 *
 * ## Which actions appear
 *
 * Only those the actor's permissions could satisfy, and only those legal from
 * the row's current status: `invited` may be activated or cancelled, `active`
 * may be locked or archived, `locked` may be unlocked or archived, `archived` is
 * terminal. Offering an action the transition engine will reject is a promise
 * the product cannot keep.
 *
 * The visibility rule is courtesy. Every action still calls the operation and
 * the backend's refusal is the one that counts.
 */

const STATUS_FILTER = {
  key: 'status',
  labelKey: 'users.filter.status',
  options: [
    { value: 'invited', labelKey: 'users.status.invited' },
    { value: 'active', labelKey: 'users.status.active' },
    { value: 'locked', labelKey: 'users.status.locked' },
    { value: 'archived', labelKey: 'users.status.archived' },
  ],
} as const;

type PendingAction =
  | { readonly kind: 'lock' | 'unlock' | 'archive' | 'activate' | 'cancel' | 'revoke'; readonly user: UserRow };

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

  const t = useCallback(
    (key: string) => translate(messages, key as keyof Messages),
    [messages]
  );

  const columns: readonly Column<UserRow>[] = [
    {
      id: 'displayName',
      headerKey: 'users.column.displayName',
      cell: (row) => <span className="font-medium text-text-primary">{row.displayName}</span>,
    },
    { id: 'email', headerKey: 'users.column.email', cell: (row) => row.email },
    {
      id: 'status',
      headerKey: 'users.column.status',
      cell: (row) => <StatusPill status={row.status} messages={messages} />,
    },
    {
      id: 'mfa',
      headerKey: 'users.column.mfa',
      cell: (row) => (row.mfaRequired ? t('field.active') : '—'),
    },
    {
      id: 'createdAt',
      headerKey: 'column.updated',
      cell: (row) => formatDate(row.createdAt, locale),
    },
  ];

  const run = (task: () => Promise<ActionState>) => {
    startTransition(async () => {
      const result = await task();
      setActionState(result);
      if (result.status === 'success') {
        setPending(null);
        table.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {actionState.status !== 'idle' && !pending ? (
        <FormFeedback state={actionState} messages={messages} />
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-sm">
          <TextField
            label={t('users.searchLabel')}
            description={t('users.searchHint')}
            type="search"
            value={table.request.search}
            onChange={(event) => table.setRequest(withSearch(table.request, event.target.value))}
          />
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setActionState(IDLE);
              setInviteOpen(true);
            }}
            className="rounded-lg bg-primary px-4 py-2 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {t('users.invite')}
          </button>
        ) : null}
      </div>

      <DataTable<UserRow>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        filterDefinitions={[STATUS_FILTER]}
        onRequestChange={(next: TableRequest) => table.setRequest(next)}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={t('users.title')}
        rowActions={(row) => (
          <RowActions
            row={row}
            messages={messages}
            canManage={canManage}
            canRevokeSessions={canRevokeSessions}
            onChoose={(kind) => {
              setActionState(IDLE);
              setPending({ kind, user: row });
            }}
          />
        )}
      />

      <InviteDialog
        open={inviteOpen}
        // Closing always re-reads the list. An invitation that succeeded has
        // added a row; one that failed has not, and a re-read of an unchanged
        // list costs one request. That is cheaper than an auto-close, which
        // would take the confirmation off screen before it had been read.
        onClose={() => {
          setInviteOpen(false);
          table.refresh();
        }}
        messages={messages}
        roles={roles}
      />

      {pending ? (
        <ReasonConfirmDialog
          open
          messages={messages}
          destructive={pending.kind !== 'activate' && pending.kind !== 'unlock'}
          pending={running}
          title={t(CONFIRM_TITLE[pending.kind])}
          description={t(CONFIRM_BODY[pending.kind])}
          confirmLabel={t(ACTION_LABEL[pending.kind])}
          reasonLabel={t('admin.reason')}
          error={
            actionState.status !== 'idle' && actionState.status !== 'success'
              ? t(actionState.messageKey ?? 'admin.actionFailed')
              : undefined
          }
          onCancel={() => setPending(null)}
          onConfirm={(text) => {
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
      ) : null}
    </div>
  );
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
      {translate(messages, `users.status.${status}` as keyof Messages)}
    </span>
  );
}

/**
 * The actions legal from a row's current status.
 *
 * `archived` is terminal in the transition engine, so it offers nothing —
 * showing a disabled Archive on an archived account invites the operator to
 * wonder what is wrong with the button.
 */
function RowActions({
  row,
  messages,
  canManage,
  canRevokeSessions,
  onChoose,
}: {
  readonly row: UserRow;
  readonly messages: Messages;
  readonly canManage: boolean;
  readonly canRevokeSessions: boolean;
  readonly onChoose: (kind: PendingAction['kind']) => void;
}) {
  const available: PendingAction['kind'][] = [];
  if (canManage) {
    if (row.status === 'invited') available.push('activate', 'cancel');
    if (row.status === 'active') available.push('lock', 'archive');
    if (row.status === 'locked') available.push('unlock', 'archive');
  }
  // Revoking sessions needs BOTH permissions the operation declares.
  if (canManage && canRevokeSessions && row.status !== 'archived') available.push('revoke');

  if (available.length === 0) return null;

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {available.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => onChoose(kind)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-caption text-text-secondary transition-colors duration-fast ease-standard hover:bg-surface-subtle hover:text-text-primary"
        >
          {translate(messages, ACTION_LABEL[kind] as keyof Messages)}
        </button>
      ))}
    </div>
  );
}

/**
 * The invitation dialog.
 *
 * It does NOT close itself on success. An auto-close takes the confirmation off
 * screen before it has been read, and the operator is left guessing whether the
 * invitation was sent. The dialog shows the outcome; closing it is the
 * operator's decision, and closing re-reads the list.
 */
function InviteDialog({
  open,
  onClose,
  messages,
  roles,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly messages: Messages;
  readonly roles: readonly RoleOption[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(inviteUserAction, IDLE);
  const t = (key: string) => translate(messages, key as keyof Messages);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      messages={messages}
      title={t('users.invite.title')}
      description={t('users.invite.description')}
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />

        <TextField
          name="email"
          type="email"
          label={t('users.invite.email')}
          required
          autoComplete="off"
          spellCheck={false}
          error={state.fieldErrors?.email ? t(state.fieldErrors.email) : undefined}
        />
        <TextField
          name="displayName"
          label={t('users.invite.displayName')}
          required
          autoComplete="off"
          error={state.fieldErrors?.displayName ? t(state.fieldErrors.displayName) : undefined}
        />
        <CheckboxField name="mfaRequired" label={t('users.invite.mfaRequired')} />

        {roles.length > 0 ? (
          <SelectField
            name="roleIds"
            multiple
            size={Math.min(roles.length, 6)}
            label={t('users.invite.roles')}
            description={t('users.invite.rolesHint')}
            options={roles.map((role) => ({ value: role.id, label: role.name }))}
          />
        ) : null}

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
              label={t('users.invite.submit')}
              pendingLabel={t('admin.creating')}
              full={false}
            />
          )}
        </div>
      </form>
    </Dialog>
  );
}
