'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, LoadingState } from '@/components/states/States';
import { SelectField, TextField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDate } from '@/lib/format';

import { listBranches, listWarranties, type WarrantyListState } from '../warranty-api';
import type { WarrantyListRow } from '../warranty-contract';
import {
  Distance,
  PRIMARY_BUTTON,
  ReadFailure,
  SECONDARY_BUTTON,
  Section,
  UUID,
  WarrantyStatusLabel,
} from './shared';
import type { BranchOption } from '@/features/services/services-contract';

/**
 * A branch's warranty records (P1-31, FE-008 entry point, FE-009 partial).
 *
 * ## Nothing is read until a branch is named
 *
 * `wty.warranty-list` makes `companyId` and `branchId` required and authorizes that
 * pair before a row is read, because the row-level scope narrows on the
 * permission-blind union of every grant the caller holds. So the pair is chosen
 * first, in the target section, and every read is addressed to it. A screen that
 * guessed a branch would be asserting a scope on the operator's behalf.
 *
 * ## FE-009 is this filter, and the rest is named rather than faked
 *
 * Filtering by vehicle gives the warranties issued for one vehicle, newest first —
 * which is the history this backend publishes. The per-record transition ledger
 * (`wty.warranty_record_status_history`) has no reader anywhere, so the screen says
 * that in its own words instead of assembling a plausible sequence out of a record's
 * current state. An invented ledger is worse than an absent one: it would be believed.
 *
 * ## A refusal is never drawn as an empty branch
 *
 * The first read's whole outcome is kept, not flattened into rows, so "you may not
 * see these" and "this branch has issued none" are two different sentences. Drawing
 * them the same way is the single most misleading thing a permission-gated list can do.
 *
 * ## The end of the set is the server's to declare
 *
 * `hasMore` and `nextCursor` come from the response; nothing here infers the end from
 * a short page and no total is requested or invented. A failed further page leaves
 * the rows already on screen and reports the failure beside the button that caused it.
 */

interface Target {
  readonly companyId: string;
  readonly branchId: string;
}

const EMPTY_PAIR: Target = { companyId: '', branchId: '' };

export function WarrantyListScreen({
  locale,
  messages,
  initialVehicleId,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** From the address, when the screen was reached from a vehicle. Filters on arrival. */
  readonly initialVehicleId: string | null;
  /** `org.branch.read` — whether a branch directory is requested for the target picker. */
  readonly canReadBranches: boolean;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(initialVehicleId);

  return (
    <div className="flex flex-col gap-6">
      <TargetSection
        messages={messages}
        canReadBranches={canReadBranches}
        chosen={target}
        onChosen={setTarget}
      />

      <VehicleFilterSection messages={messages} vehicleId={vehicleId} onChanged={setVehicleId} />

      {target === null ? (
        <p className="rounded-md border border-border bg-surface p-4 text-body text-text-secondary">
          {translate(messages, 'warranty.list.chooseBranchFirst')}
        </p>
      ) : (
        <ResultsSection locale={locale} messages={messages} target={target} vehicleId={vehicleId} />
      )}
    </div>
  );
}

/** The branch whose warranties are read. Chosen, never assumed. */
function TargetSection({
  messages,
  canReadBranches,
  chosen,
  onChosen,
}: {
  readonly messages: Messages;
  readonly canReadBranches: boolean;
  readonly chosen: Target | null;
  readonly onChosen: (next: Target) => void;
}) {
  const [branches, setBranches] = useState<readonly BranchOption[] | null>(null);
  const [branchesRefused, setBranchesRefused] = useState(false);
  const [pair, setPair] = useState<Target>(EMPTY_PAIR);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    if (!canReadBranches) return;
    let live = true;
    void listBranches().then((state) => {
      if (!live) return;
      if (state.status === 'ok') setBranches(state.data.items);
      else setBranchesRefused(true);
    });
    return () => {
      live = false;
    };
  }, [canReadBranches]);

  // An empty directory is not a picker: with no branch to choose, the operator gets
  // the identifier fields rather than a control with nothing in it.
  const offered = canReadBranches && branches !== null && branches.length > 0;

  return (
    <Section
      headingId="warranty-target-heading"
      titleKey="warranty.target.heading"
      messages={messages}
      description={translate(messages, 'warranty.target.explain')}
    >
      <form
        aria-label={translate(messages, 'warranty.target.formLabel')}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const found: Record<string, string> = {};
          // The company is chosen with the branch when a directory is offered, so
          // only the branch has a control that could show an error.
          if (!offered && !UUID.test(pair.companyId.trim())) {
            found['companyId'] = 'warranty.common.idFormat';
          }
          if (!UUID.test(pair.branchId.trim())) found['branchId'] = 'warranty.common.idFormat';
          setErrors(found);
          if (Object.keys(found).length > 0) return;
          onChosen({ companyId: pair.companyId.trim(), branchId: pair.branchId.trim() });
        }}
      >
        {offered ? (
          <SelectField
            label={translate(messages, 'warranty.common.branchField')}
            required
            value={pair.branchId}
            onChange={(event) => {
              const picked = branches?.find((branch) => branch.id === event.target.value);
              setPair(picked ? { companyId: picked.companyId, branchId: picked.id } : EMPTY_PAIR);
            }}
            options={(branches ?? []).map((branch) => ({
              value: branch.id,
              label: `${branch.branchCode} — ${branch.name}`,
            }))}
            placeholder={translate(messages, 'warranty.common.branchPlaceholder')}
            error={errors['branchId'] ? translateDynamic(messages, errors['branchId']) : undefined}
          />
        ) : (
          <>
            <TextField
              label={translate(messages, 'warranty.common.companyIdField')}
              description={
                branchesRefused
                  ? translate(messages, 'warranty.common.branchesRefused')
                  : translate(messages, 'warranty.common.identifierHelp')
              }
              required
              spellCheck={false}
              dir="ltr"
              value={pair.companyId}
              onChange={(event) => setPair({ ...pair, companyId: event.target.value })}
              error={
                errors['companyId'] ? translateDynamic(messages, errors['companyId']) : undefined
              }
            />
            <TextField
              label={translate(messages, 'warranty.common.branchIdField')}
              required
              spellCheck={false}
              dir="ltr"
              value={pair.branchId}
              onChange={(event) => setPair({ ...pair, branchId: event.target.value })}
              error={
                errors['branchId'] ? translateDynamic(messages, errors['branchId']) : undefined
              }
            />
          </>
        )}
        <div className="sm:col-span-2">
          <button type="submit" className={PRIMARY_BUTTON}>
            {translate(messages, chosen ? 'warranty.target.change' : 'warranty.target.choose')}
          </button>
        </div>
      </form>
    </Section>
  );
}

/**
 * The one filter the read accepts.
 *
 * The route is `.strict()` and offers `vehicleId` and nothing else, so this control
 * offers nothing else either. Applying it is what FE-009 asks of this screen: the
 * warranties of one vehicle, in order.
 */
function VehicleFilterSection({
  messages,
  vehicleId,
  onChanged,
}: {
  readonly messages: Messages;
  readonly vehicleId: string | null;
  readonly onChanged: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(vehicleId ?? '');
  const [error, setError] = useState<string | null>(null);

  return (
    <Section
      headingId="warranty-filter-heading"
      titleKey="warranty.filter.heading"
      messages={messages}
      description={translate(messages, 'warranty.filter.explain')}
    >
      <form
        aria-label={translate(messages, 'warranty.filter.formLabel')}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = draft.trim();
          if (trimmed.length === 0) {
            setError(null);
            onChanged(null);
            return;
          }
          if (!UUID.test(trimmed)) {
            // Refused here rather than at the backend: a malformed filter is a 422
            // for the whole request, and being told by the control is how it gets
            // corrected instead of looking like an outage.
            setError('warranty.common.idFormat');
            return;
          }
          setError(null);
          onChanged(trimmed);
        }}
      >
        <div className="grow">
          <TextField
            label={translate(messages, 'warranty.filter.vehicleField')}
            spellCheck={false}
            dir="ltr"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            error={error ? translateDynamic(messages, error) : undefined}
          />
        </div>
        <button type="submit" className={SECONDARY_BUTTON}>
          {translate(messages, 'warranty.filter.apply')}
        </button>
      </form>
    </Section>
  );
}

/** What is held, and the read it belongs to. */
interface Held {
  readonly key: string;
  readonly first: WarrantyListState;
  readonly rows: readonly WarrantyListRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly moreFailed: string | null;
}

const keyOf = (target: Target, vehicleId: string | null) =>
  `${target.companyId}#${target.branchId}#${vehicleId ?? ''}`;

function ResultsSection({
  locale,
  messages,
  target,
  vehicleId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: Target;
  readonly vehicleId: string | null;
}) {
  const [held, setHeld] = useState<Held | null>(null);
  const [loading, setLoading] = useState(false);
  const key = keyOf(target, vehicleId);

  useEffect(() => {
    let live = true;
    void listWarranties(target, vehicleId, null).then((state) => {
      if (!live) return;
      // Carrying the key the read belongs to, so an answer for a branch or a filter
      // the operator has since left is treated as absent rather than shown under the
      // heading it no longer describes.
      setHeld({
        key,
        first: state,
        rows: state.rows,
        nextCursor: state.nextCursor,
        hasMore: state.hasMore,
        moreFailed: null,
      });
    });
    return () => {
      live = false;
    };
  }, [key, target, vehicleId]);

  const loadMore = useCallback(async () => {
    if (!held || held.key !== key || held.nextCursor === null || loading) return;
    setLoading(true);
    const next = await listWarranties(target, vehicleId, held.nextCursor);
    setLoading(false);
    if (next.status !== 'ok') {
      // The operator keeps the pages they have. Wiping them to report a transient
      // fault loses their place for no benefit.
      setHeld({ ...held, moreFailed: next.status });
      return;
    }
    setHeld({
      ...held,
      rows: [...held.rows, ...next.rows],
      nextCursor: next.nextCursor,
      hasMore: next.hasMore,
      moreFailed: null,
    });
  }, [held, key, loading, target, vehicleId]);

  const current = held !== null && held.key === key ? held : null;

  return (
    <Section
      headingId="warranty-results-heading"
      titleKey="warranty.list.heading"
      messages={messages}
    >
      {current === null ? (
        <LoadingState messages={messages} />
      ) : current.first.status !== 'ok' ? (
        <ReadFailure
          messages={messages}
          status={current.first.status}
          correlationId={current.first.correlationId}
        />
      ) : current.rows.length === 0 ? (
        <EmptyState
          messages={messages}
          titleKey="warranty.list.noneTitle"
          descriptionKey="warranty.list.noneDescription"
        />
      ) : (
        <>
          <table className="w-full text-body">
            <caption className="sr-only">
              {translate(messages, 'warranty.list.tableCaption')}
            </caption>
            <thead>
              <tr className="text-caption text-text-muted">
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.list.columnPolicy')}
                </th>
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.list.columnStatus')}
                </th>
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.list.columnStart')}
                </th>
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.list.columnExpiry')}
                </th>
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.list.columnOdometerLimit')}
                </th>
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.list.columnVehicle')}
                </th>
              </tr>
            </thead>
            <tbody>
              {current.rows.map((row) => (
                <tr key={row.id} className="border-t border-border-subtle">
                  <td className="p-2">
                    <Link
                      href={`/${locale}/warranty/${row.id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      <bdi>{row.policy.name}</bdi>
                    </Link>
                  </td>
                  <td className="p-2">
                    <WarrantyStatusLabel messages={messages} status={row.status} />
                  </td>
                  <td className="p-2">{formatDate(row.startDate, locale)}</td>
                  <td className="p-2">{formatDate(row.expiryDate, locale)}</td>
                  <td className="p-2">
                    {row.odometerLimit === null ? (
                      translate(messages, 'warranty.summary.noDistanceLimit')
                    ) : (
                      <Distance value={row.odometerLimit} />
                    )}
                  </td>
                  <td className="p-2">
                    <code className="font-mono text-caption" dir="ltr">
                      {row.vehicleId}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {current.moreFailed === null ? null : (
            <p role="alert" className="mt-2 text-body text-error">
              {translateDynamic(messages, `state.${current.moreFailed}.title`)}
            </p>
          )}

          {current.hasMore ? (
            <button
              type="button"
              className={`mt-3 ${SECONDARY_BUTTON}`}
              disabled={loading}
              onClick={() => void loadMore()}
            >
              {translate(messages, 'warranty.list.loadMore')}
            </button>
          ) : null}
        </>
      )}
    </Section>
  );
}
