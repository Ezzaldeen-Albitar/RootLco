'use client';

/**
 * Appointment setup (Owner decision 2026-09-29): the organisation's own
 * appointment types, booking channels and cancellation reasons.
 *
 * ## Nothing is preset
 *
 * Every list starts empty — the no-fake-data policy — and the organisation enters
 * its own entries. An empty list says so in plain words and invites the first
 * entry; it is never filled with examples. Booking needs at least one appointment
 * type, and cancelling needs at least one cancellation reason, which is why this
 * screen exists.
 *
 * ## On the shared Material wrappers (ADR-022)
 *
 * Each section is `OperationalGrid` over `useServerTable`: the management list's
 * own cursor, server mode, no count, and the grid's refused, unavailable (with a
 * retry), ended-session and failed states; a reply that arrives after a newer
 * request is dropped by the hook. An entry is named by its name and its status is
 * said in words; the code is asked for once, when the entry is created, and is not
 * shown afterwards. A shared platform entry is marked and offers no change.
 *
 * The create form is `FormTextField`: every refused field is marked red with the
 * sentence beside it, the cursor moves to the first one, what was typed survives a
 * refusal, and a complaint goes once its field changes. Typed work is unsaved work
 * (`useUnsavedGuard`) until it is stored.
 *
 * Renaming holds the stored name and the version it was read at
 * (`useEditBaseline`): the save sends that version, a stale one is the server's
 * conflict, and "Load the latest version" discards the stale work and reads the
 * list again. Retiring and restoring ask first (`ConfirmDialog`) and send the
 * version the list showed.
 */
import { useCallback, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { ConfirmDialog, DecisionActions, DecisionDialog } from '@/components/dialogs/ConfirmDialog';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import {
  createAppointmentType,
  createCancellationReason,
  createSourceChannel,
  listManagedAppointmentTypes,
  listManagedCancellationReasons,
  listManagedSourceChannels,
  renameAppointmentType,
  renameCancellationReason,
  renameSourceChannel,
  setAppointmentTypeStatus,
  setCancellationReasonStatus,
  setSourceChannelStatus,
  type CatalogueEntryDraft,
  type CatalogueEntryStatus,
  type ManagedCatalogueEntry,
} from '../catalogue-api';

/** The three lists, each with its own reads, writes and words. */
type SetupKind = 'types' | 'channels' | 'reasons';

interface SetupSectionConfig {
  readonly kind: SetupKind;
  readonly list: (
    limit: number,
    cursor: string | null
  ) => Promise<ReadState<CursorPage<ManagedCatalogueEntry>>>;
  readonly create: (draft: CatalogueEntryDraft) => Promise<ActionState>;
}

const SECTIONS: readonly SetupSectionConfig[] = [
  { kind: 'types', list: listManagedAppointmentTypes, create: createAppointmentType },
  { kind: 'channels', list: listManagedSourceChannels, create: createSourceChannel },
  { kind: 'reasons', list: listManagedCancellationReasons, create: createCancellationReason },
];

export function AppointmentSetupScreen({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  return (
    <div className="flex flex-col gap-6">
      {SECTIONS.map((section) => (
        <SetupSection key={section.kind} locale={locale} messages={messages} config={section} />
      ))}
    </div>
  );
}

/** What an operator is about to do to one entry. */
type Pending =
  | { readonly kind: 'rename'; readonly entry: ManagedCatalogueEntry }
  | { readonly kind: 'status'; readonly entry: ManagedCatalogueEntry };

function SetupSection({
  locale,
  messages,
  config,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly config: SetupSectionConfig;
}) {
  const { kind, list } = config;
  const words = (suffix: string) =>
    translateDynamic(messages, `appointmentSetup.${kind}.${suffix}`);
  const [pending, setPending] = useState<Pending | null>(null);
  const [statusOutcome, setStatusOutcome] = useState<ActionState>(IDLE);
  const [statusRunning, setStatusRunning] = useState(false);

  const load = useCallback(
    async (
      request: TableRequest,
      cursor: string | null
    ): Promise<ServerPage<ManagedCatalogueEntry>> => {
      const read = await list(request.pageSize, cursor);
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
    [list]
  );
  const table = useServerTable<ManagedCatalogueEntry>(load, { initial: INITIAL_REQUEST });
  const rows = table.response?.rows ?? [];

  const columns = useMemo<readonly OperationalColumn<ManagedCatalogueEntry>[]>(
    () => [
      {
        id: 'name',
        headerKey: 'appointmentSetup.column.name',
        flex: 2,
        cell: (row) => <bdi className="font-medium">{row.name}</bdi>,
      },
      {
        id: 'status',
        headerKey: 'appointmentSetup.column.status',
        cell: (row) =>
          translateDynamic(
            messages,
            row.status === 'active'
              ? 'appointmentSetup.status.active'
              : 'appointmentSetup.status.inactive'
          ),
      },
      {
        id: 'owner',
        headerKey: 'appointmentSetup.column.owner',
        hideBelow: 'md',
        cell: (row) =>
          translate(
            messages,
            row.scope === 'tenant' ? 'appointmentSetup.owner.own' : 'appointmentSetup.owner.shared'
          ),
      },
    ],
    [messages]
  );

  const rowActions = useCallback(
    (row: ManagedCatalogueEntry): readonly RowAction[] =>
      // A shared platform entry is visible and cannot be changed here; offering a
      // control the server is certain to refuse would be a door with no handle.
      row.scope !== 'tenant'
        ? []
        : [
            {
              kind: 'button',
              label: translate(messages, 'appointmentSetup.rename'),
              about: row.name,
              onClick: () => setPending({ kind: 'rename', entry: row }),
            },
            {
              kind: 'button',
              label: translate(
                messages,
                row.status === 'active' ? 'appointmentSetup.retire' : 'appointmentSetup.restore'
              ),
              about: row.name,
              onClick: () => {
                setStatusOutcome(IDLE);
                setPending({ kind: 'status', entry: row });
              },
            },
          ],
    [messages]
  );

  const confirmStatus = async (entry: ManagedCatalogueEntry) => {
    const next: CatalogueEntryStatus = entry.status === 'active' ? 'inactive' : 'active';
    setStatusRunning(true);
    let result: ActionState;
    try {
      // The version the list showed: a list read since moved on is a conflict.
      result = await (kind === 'types'
        ? setAppointmentTypeStatus(entry.id, entry.recordVersion, next)
        : kind === 'channels'
          ? setSourceChannelStatus(entry.id, entry.recordVersion, next)
          : setCancellationReasonStatus(entry.id, entry.recordVersion, next));
    } catch {
      result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      setStatusRunning(false);
    }
    notifyActionResult(result, messages);
    if (result.status === 'success' || result.status === 'conflict') {
      // Stored, or overtaken: either way the list is read again, and a conflict
      // is said beside the list with the way to the latest version.
      setPending(null);
      setStatusOutcome(result.status === 'conflict' ? result : IDLE);
      table.refresh();
      return;
    }
    setStatusOutcome(result);
  };

  // The row as the list answers it now, so a re-read brings the stored name and
  // version into an open dialog; the row as it was opened while a re-read is in
  // flight, so the dialog is not torn down under the operator's work.
  const renaming =
    pending?.kind === 'rename'
      ? (rows.find((row) => row.id === pending.entry.id) ?? pending.entry)
      : null;

  return (
    <section
      aria-labelledby={`appointment-setup-${kind}-heading`}
      className="flex min-h-0 flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      data-testid={`appointment-setup-${kind}`}
    >
      <div className="flex flex-col gap-1">
        <h2
          id={`appointment-setup-${kind}-heading`}
          className="text-section-title font-medium text-text-primary"
        >
          {words('heading')}
        </h2>
        <p className="text-supporting text-text-secondary" lang={locale}>
          {words('explain')}
        </p>
      </div>

      <CreateEntryForm
        messages={messages}
        kind={kind}
        create={config.create}
        refresh={() => table.refresh()}
      />

      {statusOutcome.status === 'conflict' ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-body text-error">
            {translateWithValues(
              messages,
              statusOutcome.messageKey ?? 'state.conflict.message',
              statusOutcome.messageValues
            )}
          </p>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => {
              setStatusOutcome(IDLE);
              table.refresh();
            }}
          >
            {translate(messages, 'form.loadLatest')}
          </Button>
        </div>
      ) : null}

      <OperationalGrid<ManagedCatalogueEntry>
        messages={messages}
        locale={locale}
        label={words('heading')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={rowActions}
        // "Nothing yet" is this screen's own sentence: it invites the first entry.
        suppressEmptyState
        testId={`appointment-setup-${kind}-grid`}
      />
      {table.status === 'idle' && table.response && table.response.rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="appointmentSetup.emptyTitle"
          descriptionKey="appointmentSetup.emptyBody"
          testId={`appointment-setup-${kind}-empty`}
        />
      ) : null}

      {renaming ? (
        <RenameDialog
          key={renaming.id}
          messages={messages}
          kind={kind}
          entry={renaming}
          refresh={() => table.refresh()}
          onClose={() => setPending(null)}
        />
      ) : null}

      {pending?.kind === 'status' ? (
        <ConfirmDialog
          open
          messages={messages}
          destructive={pending.entry.status === 'active'}
          pending={statusRunning}
          title={translateWithValues(
            messages,
            pending.entry.status === 'active'
              ? 'appointmentSetup.confirmRetire'
              : 'appointmentSetup.confirmRestore',
            { name: pending.entry.name }
          )}
          description={translate(
            messages,
            pending.entry.status === 'active'
              ? 'appointmentSetup.confirmRetireBody'
              : 'appointmentSetup.confirmRestoreBody'
          )}
          confirmLabel={translate(
            messages,
            pending.entry.status === 'active'
              ? 'appointmentSetup.retire'
              : 'appointmentSetup.restore'
          )}
          error={
            statusOutcome.status !== 'idle' &&
            statusOutcome.status !== 'success' &&
            statusOutcome.status !== 'conflict'
              ? translateWithValues(
                  messages,
                  statusOutcome.messageKey ?? 'action.failed',
                  statusOutcome.messageValues
                )
              : undefined
          }
          onCancel={() => {
            setPending(null);
            setStatusOutcome(IDLE);
          }}
          onConfirm={() => void confirmStatus(pending.entry)}
          testId={`appointment-setup-${kind}-confirm`}
        />
      ) : null}
    </section>
  );
}

const EMPTY_DRAFT: CatalogueEntryDraft = { code: '', name: '' };

function CreateEntryForm({
  messages,
  kind,
  create,
  refresh,
}: {
  readonly messages: Messages;
  readonly kind: SetupKind;
  readonly create: (draft: CatalogueEntryDraft) => Promise<ActionState>;
  readonly refresh: () => void;
}) {
  const [draft, setDraft] = useState<CatalogueEntryDraft>(EMPTY_DRAFT);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  // The cursor goes to the first refused field, and a complaint goes once its
  // field changes; what was typed stays.
  const { errors, formRef } = useHeldRefusal(fieldErrors, { ...draft });
  useUnsavedGuard(draft.code.trim().length > 0 || draft.name.trim().length > 0, () => {
    setDraft(EMPTY_DRAFT);
    setFieldErrors({});
    setProblem(null);
  });

  const errorFor = (field: string): string | undefined => {
    const key = errors[field];
    return key ? translateDynamic(messages, key) : undefined;
  };
  const set = (field: keyof CatalogueEntryDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    setProblem(null);
    const found: Record<string, string> = {};
    if (draft.code.trim().length === 0) found['code'] = 'field.required';
    if (draft.name.trim().length === 0) found['name'] = 'field.required';
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    setRunning(true);
    let outcome: ActionState;
    try {
      outcome = await create(draft);
    } catch {
      // No answer came back: what was typed stays, and the button works again.
      setProblem('state.unavailable.message');
      return;
    } finally {
      setRunning(false);
    }
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setDraft(EMPTY_DRAFT);
      setFieldErrors({});
      refresh();
      return;
    }
    if (outcome.fieldErrors && Object.keys(outcome.fieldErrors).length > 0) {
      setFieldErrors(outcome.fieldErrors);
      return;
    }
    setProblem(outcome.messageKey ?? 'action.failed');
  };

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={translateDynamic(messages, `appointmentSetup.${kind}.add`)}
      onSubmit={(event) => {
        event.preventDefault();
        if (running) return;
        void submit();
      }}
      className="grid gap-3 sm:grid-cols-3"
      data-testid={`appointment-setup-${kind}-form`}
    >
      <FormTextField
        name="name"
        label={translate(messages, 'appointmentSetup.field.name')}
        value={draft.name}
        onChange={set('name')}
        error={errorFor('name')}
        required
        autoComplete="off"
        maxLength={200}
      />
      <FormTextField
        name="code"
        label={translate(messages, 'appointmentSetup.field.code')}
        description={translate(messages, 'appointmentSetup.field.codeHint')}
        value={draft.code}
        onChange={set('code')}
        error={errorFor('code')}
        required
        dir="ltr"
        autoComplete="off"
        maxLength={63}
      />
      <div className="flex flex-wrap items-start gap-3">
        <Button
          type="submit"
          variant="contained"
          disabled={running}
          aria-busy={running || undefined}
        >
          {translate(messages, running ? 'appointmentSetup.adding' : 'appointmentSetup.add')}
        </Button>
      </div>
      {problem === null ? null : (
        <p role="alert" className="text-body text-error sm:col-span-3">
          {translateDynamic(messages, problem)}
        </p>
      )}
    </form>
  );
}

function RenameDialog({
  messages,
  kind,
  entry,
  refresh,
  onClose,
}: {
  readonly messages: Messages;
  readonly kind: SetupKind;
  readonly entry: ManagedCatalogueEntry;
  readonly refresh: () => void;
  readonly onClose: () => void;
}) {
  /*
   * The stored name and the version it was read at. A clean form follows the
   * list; a form holding a typed name keeps the version its work was based on,
   * and the save sends that one.
   */
  const edit = useEditBaseline<{ readonly name: string }>({
    stored: { name: entry.name },
    storedVersion: entry.recordVersion,
    differs: (values, baseline) => values.name.trim() !== baseline.name.trim(),
  });
  const [outcome, setOutcome] = useState<ActionState>(IDLE);
  const [running, setRunning] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, { name: edit.values.name });
  useUnsavedGuard(edit.dirty, onClose);

  const submit = async () => {
    if (edit.values.name.trim().length === 0) {
      setFieldErrors({ name: 'field.required' });
      return;
    }
    setFieldErrors({});
    setRunning(true);
    let result: ActionState;
    try {
      // The BASELINE's version: a name typed on a record that has since moved is
      // the server's conflict, never a silent overwrite.
      result = await (kind === 'types'
        ? renameAppointmentType(entry.id, edit.version, edit.values.name)
        : kind === 'channels'
          ? renameSourceChannel(entry.id, edit.version, edit.values.name)
          : renameCancellationReason(entry.id, edit.version, edit.values.name));
    } catch {
      result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      setRunning(false);
    }
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      // Stored: the form is clean again; the list read brings the new version.
      edit.rebase({ name: edit.values.name.trim() });
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
      ? translateWithValues(messages, outcome.messageKey ?? 'action.failed', outcome.messageValues)
      : undefined;

  return (
    <DecisionDialog
      title={translateWithValues(messages, 'appointmentSetup.renameTitle', { name: entry.name })}
      onCancel={onClose}
      pending={running}
      testId={`appointment-setup-${kind}-rename`}
      actions={
        <DecisionActions
          messages={messages}
          error={refusal}
          pending={running}
          destructive={false}
          confirmLabel={translate(messages, 'appointmentSetup.save')}
          onCancel={onClose}
          onConfirm={() => void submit()}
          focusCancel={false}
        />
      }
    >
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (running) return;
          void submit();
        }}
        className="flex flex-col gap-3 pt-2"
      >
        <FormTextField
          name="name"
          label={translate(messages, 'appointmentSetup.field.name')}
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
              {translate(messages, 'form.loadLatest')}
            </Button>
          </div>
        ) : null}
      </form>
    </DecisionDialog>
  );
}
