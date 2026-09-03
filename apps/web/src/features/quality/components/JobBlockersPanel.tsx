'use client';

/**
 * The blocker record of one job (P1-29 W6, consumed by W8): `wo.job-blocker-list`
 * for whoever reads the work order, `wo.job-blocker-raise` / `-resolve` for the
 * holder of `tech.labor.record` — the work-log precedent: a blocker is the
 * worker's own statement about the work in front of them. A blocker is never
 * edited; it is resolved by a second event that references it, and the list
 * folds the pair into one blocker with a derived status.
 */
import { useCallback, useEffect, useState } from 'react';
import { TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { ItemsOnly, ReadState } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listJobBlockers, raiseJobBlocker, resolveJobBlocker } from '../api';
import type { JobBlocker } from '../quality-contract';

const SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

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
  readonly onChanged?: () => void;
}) {
  const [list, setList] = useState<ReadState<ItemsOnly<JobBlocker>> | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const reload = useCallback(() => setReloadCount((n) => n + 1), []);
  const [note, setNote] = useState('');
  const [resolutions, setResolutions] = useState<Readonly<Record<string, string>>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listJobBlockers(jobId).then((next) => {
      if (!cancelled) setList(next);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, reloadCount]);

  const settle = (outcome: { readonly status: string; readonly messageKey?: string }) => {
    if (outcome.status === 'success') {
      reload();
      onChanged?.();
      return true;
    }
    setProblem(outcome.messageKey ?? 'action.failed');
    return false;
  };

  const raise = async () => {
    if (note.trim().length === 0) return;
    setPending('raise');
    setProblem(null);
    const outcome = await raiseJobBlocker(jobId, { note: note.trim() });
    setPending(null);
    notifyActionResult(outcome, messages);
    if (settle(outcome)) setNote('');
  };

  const resolve = async (blockerId: string) => {
    const text = (resolutions[blockerId] ?? '').trim();
    if (text.length === 0) return;
    setPending(blockerId);
    setProblem(null);
    const outcome = await resolveJobBlocker(blockerId, { note: text });
    setPending(null);
    notifyActionResult(outcome, messages);
    if (settle(outcome)) setResolutions((current) => ({ ...current, [blockerId]: '' }));
  };

  return (
    <section aria-labelledby={`blockers-${jobId}`} className="mt-3 flex flex-col gap-2">
      <h4 id={`blockers-${jobId}`} className="text-body font-medium text-text-primary">
        {translate(messages, 'workOrders.detail.blockersHeading')}
      </h4>
      {canRecord ? (
        <form action={() => void raise()} className="flex flex-wrap items-end gap-2">
          <TextField
            name={`blocker-note-${jobId}`}
            label={translate(messages, 'workOrders.detail.blockerNote')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            required
          />
          <button type="submit" disabled={pending !== null} className={SECONDARY_BUTTON}>
            {translate(
              messages,
              pending === 'raise' ? 'workOrders.detail.raising' : 'workOrders.detail.raiseBlocker'
            )}
          </button>
        </form>
      ) : null}
      {problem === null ? null : (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, problem)}
        </p>
      )}
      {list === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : list.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, `state.${list.status}.title`)}
        </p>
      ) : list.data.items.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'workOrders.detail.noBlockers')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.items.map((blocker) => (
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
                  {formatDateTime(blocker.raisedAt, locale)}
                </span>
              </p>
              {blocker.resolution ? (
                <p className="text-caption text-text-secondary">
                  <bdi>{blocker.resolution.note}</bdi> ·{' '}
                  {translate(messages, 'workOrders.detail.blockerResolvedAt')}{' '}
                  {formatDateTime(blocker.resolution.resolvedAt, locale)}
                </p>
              ) : canRecord ? (
                <form
                  action={() => void resolve(blocker.id)}
                  className="mt-1 flex flex-wrap items-end gap-2"
                >
                  <TextField
                    name={`resolution-${blocker.id}`}
                    label={translate(messages, 'workOrders.detail.resolutionNote')}
                    value={resolutions[blocker.id] ?? ''}
                    onChange={(event) =>
                      setResolutions((current) => ({
                        ...current,
                        [blocker.id]: event.target.value,
                      }))
                    }
                    required
                  />
                  <button type="submit" disabled={pending !== null} className={SECONDARY_BUTTON}>
                    {translate(
                      messages,
                      pending === blocker.id
                        ? 'workOrders.detail.resolving'
                        : 'workOrders.detail.resolveBlocker'
                    )}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
