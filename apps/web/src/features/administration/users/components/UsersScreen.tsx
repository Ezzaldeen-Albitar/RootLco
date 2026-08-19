'use client';

import { useActionState, useCallback, useState, useTransition } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import {
  withFilter,
  withSearch,
  withoutFilter,
  type TableRequest,
} from '@/components/data-table/table-state';
import { CheckboxField, SelectField, TextField } from '@/components/forms/Field';
import { Dialog, ReasonConfirmDialog } from '@/components/overlays/Overlays';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { formatDate } from '@/lib/format';
import { notifyActionResult } from '@/components/notifications/action-notifications';
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

  const t = useCallback((key: string) => translate(messages, key as keyof Messages), [messages]);

  const statusFilter = table.request.filters.find((filter) => filter.key === 'status')?.value;

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
      // The attempt number is what makes FormFeedback remount and re-announce.
      // A server action that always returns 1 renders an identical node the
      // second time a row action fails, and the repeat is announced to nobody
      // (P1-26-F-038). The COUNTER lives here, where the repeats happen.
      setActionState({ ...result, attempt: (actionState.attempt ?? 0) + 1 });

      // The OPERATION result goes to the global notification authority, not into
      // this screen's flow (`P1-26-F-070`). It used to render at the top of the
      // page, which meant an operator who had scrolled a hundred rows down to
      // lock an account was told the outcome somewhere they could not see. A
      // toast is fixed to the viewport, so the answer arrives where the person
      // is rather than where the form was.
      //
      // `invalid` is not raised here: field errors stay beside their fields, and
      // `notifyActionResult` returns false for that status rather than leaving
      // the decision to each caller.
      notifyActionResult(result, messages);

      if (result.status === 'success') {
        setPending(null);
        table.refresh();
      }
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/*
        Kept for `invalid` ONLY. That is the one status whose message names a
        control on this screen, so it belongs on this screen; every other outcome
        is now a toast. Rendering both would say the same thing twice in two
        places, which is how an interface teaches people to ignore one of them.
      */}
      {actionState.status === 'invalid' && !pending ? (
        <FormFeedback state={actionState} messages={messages} />
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-sm">
            <TextField
              label={t('users.searchLabel')}
              description={t('users.searchHint')}
              type="search"
              value={table.request.search}
              onChange={(event) => table.setRequest(withSearch(table.request, event.target.value))}
            />
          </div>
          {/*
            The control that applies the filter. `filterDefinitions` alone only
            teaches the table how to LABEL a chip and how to remove one — it
            renders nothing that can add one, so declaring a status filter with
            no control left the whole server-side status path unreachable
            (P1-26-F-031).
          */}
          <div className="w-48">
            <SelectField
              label={t('users.filter.status')}
              value={statusFilter ?? ''}
              placeholder={t('users.filter.all')}
              onChange={(event) => {
                const chosen = event.target.value;
                const cleared = statusFilter
                  ? withoutFilter(table.request, { key: 'status', value: statusFilter })
                  : table.request;
                table.setRequest(
                  chosen ? withFilter(cleared, { key: 'status', value: chosen }) : cleared
                );
              }}
              options={STATUS_FILTER.options.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
            />
          </div>
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

      {/*
        MOUNTED ONLY WHILE OPEN. `Dialog` returns null when closed, but the form
        inside kept its `useActionState` — so after one successful invitation,
        reopening showed the previous success and a Close button where the submit
        should be, and no second user could be invited without a reload
        (P1-26-F-020). Unmounting is what resets it.
      */}
      {inviteOpen ? (
        <InviteDialog
          open
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
      ) : null}

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
  /*
   * The two non-text controls are held in state so the safe shape has
   * something to seed `defaultChecked` and `defaultValue` FROM.
   *
   * They were plain uncontrolled controls, which is the same defect as a
   * controlled `value=` and slightly worse to read: React resets the form DOM
   * once the Server Action settles, and an uncontrolled checkbox reverts to
   * cleared while an uncontrolled multi-select reverts to nothing selected.
   * So a refused invite — a duplicate address is the ordinary case — silently
   * discarded both the MFA requirement and every role the operator had picked,
   * and a retry that only corrected the address invited the user with no roles
   * and no MFA. Nothing on the screen said so.
   */
  const [mfaRequired, setMfaRequired] = useState(false);
  const [roleIds, setRoleIds] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const retained = (name: string) => draft[name] ?? '';
  const retain = (name: string) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));
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

        {/*
          The 409 this dialog exists to survive is a DUPLICATE ADDRESS, so the
          refusal that emptied this box was the one whose message names it.
        */}
        <TextField
          key={`email-${state.attempt ?? 0}`}
          name="email"
          type="email"
          label={t('users.invite.email')}
          required
          autoComplete="off"
          spellCheck={false}
          defaultValue={retained('email')}
          onChange={retain('email')}
          error={state.fieldErrors?.email ? t(state.fieldErrors.email) : undefined}
        />
        <TextField
          key={`displayName-${state.attempt ?? 0}`}
          name="displayName"
          label={t('users.invite.displayName')}
          required
          autoComplete="off"
          defaultValue={retained('displayName')}
          onChange={retain('displayName')}
          error={state.fieldErrors?.displayName ? t(state.fieldErrors.displayName) : undefined}
        />
        {/*
          `key` + a default + `onChange`, the shape this repository has now had
          to apply seven times. `key` on the attempt forces the remount,
          `defaultChecked` seeds it from retained state and is what the reset
          restores TO, and `onChange` keeps that state current.
        */}
        <CheckboxField
          key={`mfaRequired-${state.attempt ?? 0}`}
          name="mfaRequired"
          label={t('users.invite.mfaRequired')}
          defaultChecked={mfaRequired}
          onChange={(event) => setMfaRequired(event.target.checked)}
        />

        {roles.length > 0 ? (
          <SelectField
            key={`roleIds-${state.attempt ?? 0}`}
            name="roleIds"
            multiple
            size={Math.min(roles.length, 6)}
            label={t('users.invite.roles')}
            description={t('users.invite.rolesHint')}
            /*
             * A MULTIPLE select takes an array default, and every selected
             * option has to be read back on change — `event.target.value` is
             * only ever the first of them, so seeding from it would restore one
             * role out of however many were chosen.
             */
            defaultValue={[...roleIds]}
            onChange={(event) =>
              setRoleIds(Array.from(event.target.selectedOptions, (option) => option.value))
            }
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
