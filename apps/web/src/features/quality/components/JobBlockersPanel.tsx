'use client';

/**
 * The blocker record of one job (P1-29 W6, consumed by W8): `wo.job-blocker-list`
 * for whoever reads the work order, `wo.job-blocker-raise` / `-resolve` for the
 * holder of `tech.labor.record` — the work-log precedent: a blocker is the
 * worker's own statement about the work in front of them. A blocker is never
 * edited; it is resolved by a second event that references it, and the list
 * folds the pair into one blocker with a derived status.
 *
 * ## On the shared Material wrappers (ADR-022, Owner directive slice 4)
 *
 * The note boxes are `FormTextField`: an empty note is refused on the box
 * itself (red, the sentence beside it, the cursor moved there) rather than by a
 * button that silently did nothing, and a refusal from the service lands on the
 * note it was about. Each form stays busy until the list it changed — and the
 * work order around it — has been read again, and a failed list read is the
 * state it is, with a retry.
 */
import Button from '@mui/material/Button';
import { useCallback, useState } from 'react';
import { correctionFor } from '@/components/forms/mui/field-wiring';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useReread } from '@/lib/api/use-reread';
import type { ActionState } from '@/lib/forms/action-result';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listJobBlockers, raiseJobBlocker, resolveJobBlocker } from '../api';

export function JobBlockersPanel({
  locale,
  messages,
  jobId,
  canRecord,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly jobId: string;
  readonly canRecord: boolean;
  /** The work order's re-read, awaited before the form is offered again. */
  readonly onChanged?: () => void | Promise<void>;
}) {
  const read = useCallback(() => listJobBlockers(jobId), [jobId]);
  const list = useReread(read);
  /** Which form's write is in flight — one at a time across the panel. */
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Sends one blocker event and settles it: the list and the work order are
   * read again before the form is offered again, and a refusal of the note is
   * handed back to the form that holds it.
   *
   * `body.note` — the blocker event was refused by the database guard. There is
   * no stage condition behind it: `wo.guard_job_blocker_event` refuses a
   * resolution that names something other than a raised blocker of this same
   * job, and the frozen CHECKs refuse a blank note and a raise that carries a
   * reference. The job's own stage is never consulted. The sentence belongs
   * beside the note that was refused — per form, because raising and resolving
   * both publish it against `note` — and the note itself is kept: it is cleared
   * only on success.
   */
  const send = async (form: string, write: () => Promise<ActionState>): Promise<NoteOutcome> => {
    setProblem(null);
    setPending(form);
    try {
      let outcome: ActionState;
      try {
        outcome = await write();
      } catch {
        setProblem('state.unavailable.message');
        return { stored: false };
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        await Promise.all([list.reload(), onChanged?.()]);
        return { stored: true };
      }
      setProblem(outcome.messageKey ?? 'action.failed');
      return { stored: false, noteError: outcome.fieldErrors?.['note'] };
    } finally {
      setPending(null);
    }
  };

  const shown = list.value;

  return (
    <section aria-labelledby={`blockers-${jobId}`} className="mt-3 flex flex-col gap-2">
      <h4 id={`blockers-${jobId}`} className="text-body font-medium text-text-primary">
        {translate(messages, 'workOrders.detail.blockersHeading')}
      </h4>
      {canRecord ? (
        <BlockerNoteForm
          messages={messages}
          name={`blocker-note-${jobId}`}
          labelKey="workOrders.detail.blockerNote"
          submitKey="workOrders.detail.raiseBlocker"
          pendingKey="workOrders.detail.raising"
          pending={pending === 'raise'}
          busy={pending !== null}
          onSend={(text) => send('raise', () => raiseJobBlocker(jobId, { note: text }))}
        />
      ) : null}
      {problem === null ? null : (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, problem)}
        </p>
      )}
      {shown === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : shown.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={shown.status}
          correlationId={shown.correlationId}
          onRetry={() => void list.reload()}
        />
      ) : shown.data.items.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'workOrders.detail.noBlockers')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.data.items.map((blocker) => (
            <li key={blocker.id} className="rounded-md bg-surface-subtle px-3 py-2">
              <p className="text-body text-text-primary">
                <bdi>{blocker.note}</bdi>
                <span className="text-caption text-text-muted">
                  {' '}
                  ·{' '}
                  {translateDynamic(
                    messages,
                    `workOrders.detail.blockerStatus.${blocker.status}`
                  )}{' '}
                  · {translate(messages, 'workOrders.detail.blockerRaisedAt')}{' '}
                  <bdi>{formatDateTime(blocker.raisedAt, locale)}</bdi>
                </span>
              </p>
              {blocker.resolution ? (
                <p className="text-caption text-text-secondary">
                  <bdi>{blocker.resolution.note}</bdi> ·{' '}
                  {translate(messages, 'workOrders.detail.blockerResolvedAt')}{' '}
                  <bdi>{formatDateTime(blocker.resolution.resolvedAt, locale)}</bdi>
                </p>
              ) : canRecord ? (
                <div className="mt-1">
                  <BlockerNoteForm
                    messages={messages}
                    name={`resolution-${blocker.id}`}
                    labelKey="workOrders.detail.resolutionNote"
                    submitKey="workOrders.detail.resolveBlocker"
                    pendingKey="workOrders.detail.resolving"
                    pending={pending === blocker.id}
                    busy={pending !== null}
                    onSend={(text) =>
                      send(blocker.id, () => resolveJobBlocker(blocker.id, { note: text }))
                    }
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface NoteOutcome {
  readonly stored: boolean;
  /** The service's refusal of the note itself, as a catalogue key. */
  readonly noteError?: string | undefined;
}

/**
 * One note and its submit — the raise form, or one blocker's resolution.
 *
 * An empty note is refused on the box, before anything is sent; a refusal of
 * the note from the service lands on the same box; either way the cursor is
 * moved there (`useFocusFirstInvalid`) and the complaint goes the moment the
 * note is edited. What was typed is kept until it is stored, and is unsaved
 * work until then: a branch switch or leaving the page asks, and a confirmed
 * discard empties it — the job is not addressed to the working branch, so
 * nothing else would.
 */
function BlockerNoteForm({
  messages,
  name,
  labelKey,
  submitKey,
  pendingKey,
  pending,
  busy,
  onSend,
}: {
  readonly messages: Messages;
  readonly name: string;
  readonly labelKey: 'workOrders.detail.blockerNote' | 'workOrders.detail.resolutionNote';
  readonly submitKey: 'workOrders.detail.raiseBlocker' | 'workOrders.detail.resolveBlocker';
  readonly pendingKey: 'workOrders.detail.raising' | 'workOrders.detail.resolving';
  readonly pending: boolean;
  readonly busy: boolean;
  readonly onSend: (text: string) => Promise<NoteOutcome>;
}) {
  const [text, setText] = useState('');
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const formRef = useFocusFirstInvalid(state);
  const corrections = useClearOnCorrect(state);
  useUnsavedGuard(text.trim().length > 0, () => {
    setText('');
    setState((current) => ({ status: 'idle', attempt: current.attempt ?? 0 }));
  });

  const refuse = (key: string) =>
    setState((current) => ({
      status: 'invalid',
      fieldErrors: { note: key },
      attempt: (current.attempt ?? 0) + 1,
    }));

  const submit = async () => {
    if (busy) return;
    if (text.trim().length === 0) {
      refuse('field.required');
      return;
    }
    const outcome = await onSend(text.trim());
    if (outcome.stored) {
      setText('');
      setState((current) => ({ status: 'idle', attempt: current.attempt ?? 0 }));
      return;
    }
    if (outcome.noteError) refuse(outcome.noteError);
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-wrap items-start gap-2"
    >
      <FormTextField
        name={name}
        label={translate(messages, labelKey)}
        value={text}
        onChange={setText}
        required
        {...correctionFor(corrections, 'note', messages)}
      />
      <Button type="submit" variant="outlined" disabled={busy} aria-busy={pending || undefined}>
        {translate(messages, pending ? pendingKey : submitKey)}
      </Button>
    </form>
  );
}
