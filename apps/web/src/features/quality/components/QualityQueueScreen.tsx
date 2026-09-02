'use client';

/**
 * The branch QC queue (P1-29 W8): `qms.qc-record-branch-list` for one branch
 * target chosen from the session's own companies and branches — the W4 shape,
 * for the W4 reason: a scope is resolved server-side from the session, and the
 * screen only says WHICH of the caller's branches to show. Each row links to
 * the work order's quality and closure view.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SelectField } from '@/components/forms/Field';
import {
  BackendUnavailableState,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { BranchTarget, CursorPage, ReadState } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listQcQueue } from '../api';
import type { QcRecord } from '../quality-contract';

const SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

const OVERALL_RESULTS = ['open', 'passed', 'failed'] as const;

export function QualityQueueScreen({
  locale,
  messages,
  companyIds,
  branchIds,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
}) {
  const single =
    companyIds.length === 1 && branchIds.length === 1
      ? { companyId: companyIds[0] ?? '', branchId: branchIds[0] ?? '' }
      : null;
  const [draft, setDraft] = useState<BranchTarget>({
    companyId: companyIds.length === 1 ? (companyIds[0] ?? '') : '',
    branchId: branchIds.length === 1 ? (branchIds[0] ?? '') : '',
  });
  const [target, setTarget] = useState<BranchTarget | null>(single);
  const [overallResult, setOverallResult] = useState('');
  const [pages, setPages] = useState<readonly CursorPage<QcRecord>[]>([]);
  const [state, setState] = useState<ReadState<CursorPage<QcRecord>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (target === null) return;
    let cancelled = false;
    void listQcQueue(target, overallResult ? { overallResult } : {}, null).then((next) => {
      if (cancelled) return;
      setState(next);
      if (next.status === 'ok') setPages([next.data]);
    });
    return () => {
      cancelled = true;
    };
  }, [target, overallResult]);

  const last = pages.at(-1) ?? null;
  const loadMore = async () => {
    if (target === null || last === null || !last.hasMore || last.nextCursor === null) return;
    setLoading(true);
    const next = await listQcQueue(target, overallResult ? { overallResult } : {}, last.nextCursor);
    setLoading(false);
    if (next.status === 'ok') setPages((current) => [...current, next.data]);
    else setState(next);
  };

  const submitTarget = () => {
    if (draft.companyId.length === 0 || draft.branchId.length === 0) return;
    setState(null);
    setPages([]);
    setTarget({ companyId: draft.companyId, branchId: draft.branchId });
  };

  return (
    <div className="flex min-h-0 flex-col gap-6">
      {single === null ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitTarget();
          }}
          noValidate
          className="flex flex-wrap items-end gap-3"
        >
          <SelectField
            label={translate(messages, 'quality.queue.company')}
            value={draft.companyId}
            onChange={(event) => setDraft({ ...draft, companyId: event.target.value })}
            options={companyIds.map((id) => ({ value: id, label: id }))}
            placeholder={translate(messages, 'quality.queue.company')}
            required
          />
          <SelectField
            label={translate(messages, 'quality.queue.branch')}
            value={draft.branchId}
            onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}
            options={branchIds.map((id) => ({ value: id, label: id }))}
            placeholder={translate(messages, 'quality.queue.branch')}
            required
          />
          <button type="submit" className={SECONDARY_BUTTON}>
            {translate(messages, 'quality.queue.showQueue')}
          </button>
        </form>
      ) : null}

      {target === null ? null : (
        <section
          aria-labelledby="qc-queue-heading"
          className="rounded-lg border border-border bg-surface p-4"
        >
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 id="qc-queue-heading" className="text-section-title font-medium text-text-primary">
              {translate(messages, 'quality.queue.heading')}
            </h2>
            {/* A filter, not a form field: it re-reads on change and is never submitted. */}
            <SelectField
              name="overallResult"
              label={translate(messages, 'quality.queue.filterResult')}
              value={overallResult}
              onChange={(event) => {
                setOverallResult(event.target.value);
                setState(null);
                setPages([]);
              }}
              options={OVERALL_RESULTS.map((value) => ({
                value,
                label: translate(messages, `quality.result.${value}` as keyof Messages),
              }))}
              placeholder={translate(messages, 'quality.queue.anyResult')}
            />
          </div>
          {state === null ? (
            <LoadingState messages={messages} />
          ) : state.status === 'denied' ? (
            <PermissionDeniedState
              messages={messages}
              correlationId={state.correlationId ?? undefined}
            />
          ) : state.status === 'expired' ? (
            <SessionExpiredState messages={messages} />
          ) : state.status === 'unavailable' ? (
            <BackendUnavailableState
              messages={messages}
              correlationId={state.correlationId ?? undefined}
            />
          ) : state.status !== 'ok' ? (
            <ErrorState messages={messages} correlationId={state.correlationId ?? undefined} />
          ) : pages[0]?.items.length === 0 ? (
            <EmptyState
              messages={messages}
              titleKey="quality.queue.emptyTitle"
              descriptionKey="quality.queue.emptyBody"
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {pages.flatMap((page) =>
                page.items.map((record) => (
                  <li
                    key={record.id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-border p-3"
                  >
                    <Link
                      href={`/${locale}/work-orders/${record.workOrderId}/closure`}
                      className="text-body font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {translate(messages, 'quality.queue.openOrder')}
                    </Link>
                    <span className="text-caption text-text-muted">
                      {translateDynamic(messages, `quality.result.${record.overallResult}`)}
                    </span>
                    {record.finalizedAt ? (
                      <span className="text-caption text-text-muted">
                        {translate(messages, 'quality.queue.finalizedAt')}{' '}
                        {formatDateTime(record.finalizedAt, locale)}
                      </span>
                    ) : null}
                    <code className="ms-auto font-mono text-caption" dir="ltr">
                      {record.workOrderId}
                    </code>
                  </li>
                ))
              )}
            </ul>
          )}
          {last !== null && last.hasMore ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading}
                className={SECONDARY_BUTTON}
              >
                {translate(messages, loading ? 'state.loading' : 'quality.queue.loadMore')}
              </button>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
