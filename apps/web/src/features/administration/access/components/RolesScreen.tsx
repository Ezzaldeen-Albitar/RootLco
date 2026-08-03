'use client';

import { useActionState, useState, useTransition } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { TextAreaField, TextField } from '@/components/forms/Field';
import { ConfirmDialog, Dialog } from '@/components/overlays/Overlays';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { SubmitButton } from '@/features/authentication/components/SubmitButton';
import { useServerTable } from '../../shared/use-server-table';
import { listRoles, type RoleRow } from '../api';
import { createRoleAction, updateRoleAction } from '../actions';

/**
 * Roles.
 *
 * ## What the contract does and does not offer
 *
 * There is no role-delete operation and no role-detail operation. Archiving is
 * `PATCH … {archive:true}`, and it is what this screen offers — a Delete button
 * would be a promise the platform cannot keep. There is also no assigned-user
 * count on a role, so none is shown: a zero that means "not published" is worse
 * than no column.
 *
 * A **system role** is refused by the backend outright, so its row offers no
 * actions and says why. Presenting an Edit that would certainly fail wastes the
 * operator's time and then blames them for it.
 */
export function RolesScreen({
  messages,
  canManage,
}: {
  readonly messages: Messages;
  readonly canManage: boolean;
}) {
  const table = useServerTable<RoleRow>(listRoles);
  const [createOpen, setCreateOpen] = useState(false);
  const [archiving, setArchiving] = useState<RoleRow | null>(null);
  const [state, setState] = useState<ActionState>(IDLE);
  const [running, start] = useTransition();

  const t = (key: string) => translate(messages, key as keyof Messages);

  const columns: readonly Column<RoleRow>[] = [
    {
      id: 'name',
      headerKey: 'roles.column.name',
      cell: (row) => <span className="font-medium text-text-primary">{row.name}</span>,
    },
    {
      id: 'roleCode',
      headerKey: 'roles.column.code',
      cell: (row) => <code className="font-mono text-caption">{row.roleCode}</code>,
    },
    {
      id: 'description',
      headerKey: 'roles.column.description',
      cell: (row) => row.description ?? '—',
    },
    {
      id: 'kind',
      headerKey: 'roles.column.kind',
      cell: (row) => t(row.isSystem ? 'roles.kind.system' : 'roles.kind.tenant'),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {state.status !== 'idle' && !archiving ? (
        <FormFeedback state={state} messages={messages} />
      ) : null}

      {canManage ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setState(IDLE);
              setCreateOpen(true);
            }}
            className="rounded-lg bg-primary px-4 py-2 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {t('roles.create')}
          </button>
        </div>
      ) : null}

      <DataTable<RoleRow>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={t('roles.title')}
        rowActions={(row) =>
          !canManage ? null : row.isSystem ? (
            <span className="text-caption text-text-muted">{t('roles.systemLocked')}</span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setState(IDLE);
                setArchiving(row);
              }}
              className="rounded-md border border-border bg-surface px-2 py-1 text-caption text-text-secondary transition-colors duration-fast ease-standard hover:bg-surface-subtle hover:text-text-primary"
            >
              {t('roles.archive')}
            </button>
          )
        }
      />

      <CreateRoleDialog
        open={createOpen}
        messages={messages}
        onClose={() => {
          setCreateOpen(false);
          table.refresh();
        }}
      />

      {archiving ? (
        <ConfirmDialog
          open
          destructive
          messages={messages}
          pending={running}
          title={t('roles.confirm.archive')}
          description={t('roles.confirm.archiveBody')}
          confirmLabel={t('roles.archive')}
          error={
            state.status !== 'idle' && state.status !== 'success'
              ? t(state.messageKey ?? 'admin.actionFailed')
              : undefined
          }
          onCancel={() => setArchiving(null)}
          onConfirm={() => {
            const role = archiving;
            start(async () => {
              const result = await updateRoleAction(role.id, role.recordVersion, {
                archive: true,
              });
              setState(result);
              if (result.status === 'success') {
                setArchiving(null);
                table.refresh();
              }
            });
          }}
        />
      ) : null}
    </div>
  );
}

function CreateRoleDialog({
  open,
  messages,
  onClose,
}: {
  readonly open: boolean;
  readonly messages: Messages;
  readonly onClose: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createRoleAction, IDLE);
  const t = (key: string) => translate(messages, key as keyof Messages);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      messages={messages}
      title={t('roles.create.title')}
      description={t('roles.create.description')}
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />
        <TextField
          name="roleCode"
          label={t('roles.field.code')}
          description={t('roles.field.codeHint')}
          required
          spellCheck={false}
          error={state.fieldErrors?.roleCode ? t(state.fieldErrors.roleCode) : undefined}
        />
        <TextField
          name="name"
          label={t('roles.field.name')}
          required
          error={state.fieldErrors?.name ? t(state.fieldErrors.name) : undefined}
        />
        <TextAreaField name="description" label={t('roles.field.description')} rows={3} />
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
