'use client';

import { useCallback, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic, translateWithValues } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import { FormDialog } from '../../shared/components/FormDialog';
import { useServerTable } from '../../shared/use-server-table';
import { listRoles } from '../api';
import type { RoleRow } from '../types';
import { roleDisplayName } from '../role-name';
import { createRoleAction, updateRoleAction } from '../actions';

/**
 * Roles, on Material UI (ADR-022, `P1-32-PRE-OD-ADM4`).
 *
 * ## What it reads, and how
 *
 * `GET /api/v1/iam/roles` (`iam.role-list`, `iam.role.read`) is cursor-paged
 * with no count, so the list is the operational grid driven by `useServerTable`:
 * Previous and Next walk the server's cursor and nothing counts the roles. A
 * refused, failed or empty read is drawn by the grid's own states, never as an
 * empty table.
 *
 * ## What the contract does and does not offer
 *
 * There is no role-delete operation and no role-detail operation. Archiving is
 * `PATCH … {archive:true}`, and it is what this screen offers — a Delete button
 * would be a promise the platform cannot keep. The same operation renames a role
 * and changes its description ("Edit"); the code cannot be changed. There is no
 * assigned-user count on a role, so none is shown.
 *
 * A **system role** is refused by the backend outright, so its row offers no
 * action and its kind says why.
 *
 * ## Writes
 *
 * Every form is the shared `FormDialog` (a dialog, not an alert): its first
 * field takes the cursor, Escape cancels, and the cursor returns to the button
 * that opened it. Each write is sent once — a second press made before the
 * button is disabled sends nothing — and every entry counts as unsaved work
 * until it is saved. An edit sends the version the list showed as `If-Match`; a
 * role changed since is the server's conflict, said with "Load the latest
 * version", and never retried on the operator's behalf.
 */
export function RolesScreen({
  messages,
  locale,
  canManage,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly canManage: boolean;
}) {
  const table = useServerTable<RoleRow>(listRoles);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [archiving, setArchiving] = useState<RoleRow | null>(null);
  const [archiveOutcome, setArchiveOutcome] = useState<ActionState>(IDLE);
  const [archiveRunning, setArchiveRunning] = useState(false);
  const [conflict, setConflict] = useState<ActionState | null>(null);
  const archiveSending = useRef(false);

  const t = useCallback((key: string) => translateDynamic(messages, key), [messages]);

  const columns: readonly OperationalColumn<RoleRow>[] = [
    {
      id: 'name',
      headerKey: 'roles.column.name',
      flex: 1.2,
      cell: (row) => (
        <bdi className="font-medium text-text-primary">{roleDisplayName(messages, row)}</bdi>
      ),
    },
    {
      id: 'roleCode',
      headerKey: 'roles.column.code',
      cell: (row) => (
        <code className="font-mono text-caption" dir="ltr">
          {row.roleCode}
        </code>
      ),
    },
    {
      id: 'description',
      headerKey: 'roles.column.description',
      flex: 1.6,
      hideBelow: 'md',
      cell: (row) => (row.description ? <bdi>{row.description}</bdi> : '—'),
    },
    {
      id: 'kind',
      headerKey: 'roles.column.kind',
      cell: (row) =>
        row.isSystem ? (
          <span title={t('roles.systemLocked')}>{t('roles.kind.system')}</span>
        ) : (
          t('roles.kind.tenant')
        ),
    },
  ];

  const rowActions = (row: RoleRow): readonly RowAction[] =>
    !canManage || row.isSystem
      ? []
      : [
          {
            kind: 'button',
            label: t('roles.edit'),
            about: roleDisplayName(messages, row),
            onClick: () => {
              setConflict(null);
              setEditing(row);
            },
          },
          {
            kind: 'button',
            label: t('roles.archive'),
            about: roleDisplayName(messages, row),
            onClick: () => {
              setConflict(null);
              setArchiveOutcome(IDLE);
              setArchiving(row);
            },
          },
        ];

  const confirmArchive = async (role: RoleRow) => {
    if (archiveSending.current) return;
    archiveSending.current = true;
    setArchiveRunning(true);
    let result: ActionState;
    try {
      // The version the list showed: a role changed since is a conflict.
      result = await updateRoleAction(role.id, role.recordVersion, { archive: true });
    } catch {
      result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      archiveSending.current = false;
      setArchiveRunning(false);
    }
    notifyActionResult(result, messages);
    if (result.status === 'success' || result.status === 'conflict') {
      setArchiving(null);
      setArchiveOutcome(IDLE);
      setConflict(result.status === 'conflict' ? result : null);
      table.refresh();
      return;
    }
    setArchiveOutcome(result);
  };

  // The row as the list answers it now, so a re-read brings the stored name and
  // version into an open edit dialog.
  const editingNow = editing
    ? ((table.response?.rows ?? []).find((row) => row.id === editing.id) ?? editing)
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="roles-screen">
      {canManage ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="contained"
            onClick={() => {
              setConflict(null);
              setCreating(true);
            }}
          >
            {t('roles.create')}
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

      <OperationalGrid<RoleRow>
        messages={messages}
        locale={locale}
        label={t('roles.title')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={canManage ? rowActions : undefined}
        testId="roles-grid"
      />

      {creating ? (
        <CreateRoleDialog
          messages={messages}
          onCreated={() => {
            setCreating(false);
            table.refresh();
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editingNow ? (
        <EditRoleDialog
          key={editingNow.id}
          messages={messages}
          role={editingNow}
          refresh={table.refresh}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {archiving ? (
        <ConfirmDialog
          open
          destructive
          messages={messages}
          pending={archiveRunning}
          title={t('roles.confirm.archive')}
          description={`${roleDisplayName(messages, archiving)}. ${t('roles.confirm.archiveBody')}`}
          confirmLabel={t('roles.archive')}
          error={
            archiveOutcome.status !== 'idle' && archiveOutcome.status !== 'success'
              ? translateWithValues(
                  messages,
                  archiveOutcome.messageKey ?? 'admin.actionFailed',
                  archiveOutcome.messageValues
                )
              : undefined
          }
          onCancel={() => {
            setArchiving(null);
            setArchiveOutcome(IDLE);
          }}
          onConfirm={() => void confirmArchive(archiving)}
          testId="roles-archive-confirm"
        />
      ) : null}
    </div>
  );
}

/** The rule `ck_roles_code_format` holds, checked before anything is sent. */
const ROLE_CODE = /^[a-z][a-z0-9_]{1,62}$/;

interface RoleDraft {
  readonly roleCode: string;
  readonly name: string;
  readonly description: string;
}

const EMPTY_ROLE: RoleDraft = { roleCode: '', name: '', description: '' };

/** The form's own checks, keyed by field, as catalogue keys. */
function checkRole(draft: RoleDraft): Record<string, string> {
  const found: Record<string, string> = {};
  const code = draft.roleCode.trim();
  if (code.length === 0) found['roleCode'] = 'field.required';
  else if (!ROLE_CODE.test(code)) found['roleCode'] = 'roles.field.codeHint';
  if (draft.name.trim().length === 0) found['name'] = 'field.required';
  else if (draft.name.trim().length > 200) found['name'] = 'field.tooLong';
  if (draft.description.trim().length > 1000) found['description'] = 'field.tooLong';
  return found;
}

/** The refusal said beside the buttons: anything that is not a field's own complaint. */
function refusalSentence(messages: Messages, outcome: ActionState | null): string | undefined {
  if (!outcome || outcome.status === 'idle' || outcome.status === 'success') return undefined;
  if (outcome.status === 'invalid' && Object.keys(outcome.fieldErrors ?? {}).length > 0) {
    return undefined;
  }
  return translateWithValues(
    messages,
    outcome.messageKey ?? 'admin.actionFailed',
    outcome.messageValues
  );
}

function CreateRoleDialog({
  messages,
  onCreated,
  onClose,
}: {
  readonly messages: Messages;
  readonly onCreated: () => void;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const [draft, setDraft] = useState<RoleDraft>(EMPTY_ROLE);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState | null>(null);
  const [running, setRunning] = useState(false);
  // One create sent at a time, before `running` has disabled the button.
  const sending = useRef(false);
  // The cursor goes to the first refused field; a complaint goes once its field
  // changes, and what was typed stays.
  const { errors, formRef } = useHeldRefusal(fieldErrors, { ...draft });
  useUnsavedGuard(
    draft.roleCode.trim() !== '' || draft.name.trim() !== '' || draft.description.trim() !== '',
    () => {
      setDraft(EMPTY_ROLE);
      onClose();
    }
  );

  const set = (field: keyof RoleDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const errorFor = (field: string): string | undefined =>
    errors[field] ? t(errors[field] as string) : undefined;

  const submit = async () => {
    if (sending.current) return;
    setProblem(null);
    const found = checkRole(draft);
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    sending.current = true;
    setRunning(true);
    const form = new FormData();
    form.set('roleCode', draft.roleCode.trim());
    form.set('name', draft.name);
    if (draft.description.trim() !== '') form.set('description', draft.description);
    let outcome: ActionState;
    try {
      outcome = await createRoleAction(IDLE, form);
    } catch {
      // No answer came back: what was typed stays, and the button works again.
      outcome = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      sending.current = false;
      setRunning(false);
    }
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setDraft(EMPTY_ROLE);
      onCreated();
      return;
    }
    if (outcome.fieldErrors && Object.keys(outcome.fieldErrors).length > 0) {
      setFieldErrors(outcome.fieldErrors);
    }
    setProblem(outcome);
  };

  return (
    <FormDialog
      messages={messages}
      title={t('roles.create.title')}
      description={t('roles.create.description')}
      submitLabel={t('admin.create')}
      pendingLabel={t('admin.creating')}
      pending={running}
      error={refusalSentence(messages, problem)}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="roles-create"
    >
      <FormTextField
        name="roleCode"
        label={t('roles.field.code')}
        description={t('roles.field.codeHint')}
        value={draft.roleCode}
        onChange={set('roleCode')}
        error={errorFor('roleCode')}
        required
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        maxLength={63}
        autoFocus
      />
      <FormTextField
        name="name"
        label={t('roles.field.name')}
        value={draft.name}
        onChange={set('name')}
        error={errorFor('name')}
        required
        autoComplete="off"
        maxLength={200}
      />
      <FormTextField
        name="description"
        label={t('roles.field.description')}
        value={draft.description}
        onChange={set('description')}
        error={errorFor('description')}
        multiline
        rows={3}
        maxLength={1000}
      />
    </FormDialog>
  );
}

interface RoleEdit {
  readonly name: string;
  readonly description: string;
}

function EditRoleDialog({
  messages,
  role,
  refresh,
  onClose,
}: {
  readonly messages: Messages;
  readonly role: RoleRow;
  readonly refresh: () => void;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  /*
   * The stored name and description, and the version they were read at. A
   * clean form follows the list; a form holding typed work keeps the version
   * its work was based on, and the save sends that one.
   */
  const edit = useEditBaseline<RoleEdit>({
    stored: { name: role.name, description: role.description ?? '' },
    storedVersion: role.recordVersion,
    differs: (values, baseline) =>
      values.name.trim() !== baseline.name.trim() ||
      values.description.trim() !== baseline.description.trim(),
  });
  const [outcome, setOutcome] = useState<ActionState>(IDLE);
  const [running, setRunning] = useState(false);
  const sending = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, { ...edit.values });
  useUnsavedGuard(edit.dirty, onClose);

  const submit = async () => {
    if (sending.current) return;
    const name = edit.values.name.trim();
    const description = edit.values.description.trim();
    const found: Record<string, string> = {};
    if (name.length === 0) found['name'] = 'field.required';
    else if (name.length > 200) found['name'] = 'field.tooLong';
    if (description.length > 1000) found['description'] = 'field.tooLong';
    setFieldErrors(found);
    if (Object.keys(found).length > 0) {
      setOutcome(IDLE);
      return;
    }
    if (!edit.dirty) {
      setOutcome({ status: 'invalid', messageKey: 'roles.edit.unchanged', attempt: 1 });
      return;
    }
    // Only what changed is sent: an unchanged field is not the operator's edit.
    const changes: { name?: string; description?: string } = {};
    if (name !== edit.baseline.name.trim()) changes.name = name;
    if (description !== edit.baseline.description.trim()) changes.description = description;
    sending.current = true;
    setRunning(true);
    let result: ActionState;
    try {
      // The BASELINE's version: work typed on a role that has since moved is the
      // server's conflict, never a silent overwrite.
      result = await updateRoleAction(role.id, edit.version, changes);
    } catch {
      result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      sending.current = false;
      setRunning(false);
    }
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      edit.rebase({ name, description });
      refresh();
      onClose();
      return;
    }
    if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
      setFieldErrors(result.fieldErrors);
    }
    setOutcome(result);
  };

  // The conflict's way out: what is stored now replaces the stale work, and the
  // list is read again so the newer role — name and version — arrives here.
  const loadLatest = () => {
    edit.discard();
    setFieldErrors({});
    setOutcome(IDLE);
    refresh();
  };

  const refusal =
    outcome.status === 'invalid' && outcome.messageKey === 'roles.edit.unchanged'
      ? t('roles.edit.unchanged')
      : refusalSentence(messages, outcome);

  return (
    <FormDialog
      messages={messages}
      title={t('roles.edit.title')}
      description={`${roleDisplayName(messages, role)}. ${t('roles.edit.description')}`}
      submitLabel={t('admin.save')}
      pending={running}
      error={refusal}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="roles-edit"
    >
      <FormTextField
        name="name"
        label={t('roles.field.name')}
        value={edit.values.name}
        onChange={(name) => edit.setValues((was) => ({ ...was, name }))}
        error={errors['name'] ? t(errors['name']) : undefined}
        required
        autoComplete="off"
        maxLength={200}
        autoFocus
      />
      <FormTextField
        name="description"
        label={t('roles.field.description')}
        value={edit.values.description}
        onChange={(description) => edit.setValues((was) => ({ ...was, description }))}
        error={errors['description'] ? t(errors['description']) : undefined}
        multiline
        rows={3}
        maxLength={1000}
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
