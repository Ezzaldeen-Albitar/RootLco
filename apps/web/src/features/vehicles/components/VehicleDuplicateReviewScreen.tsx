'use client';

import Link from 'next/link';
import { useActionState, useCallback, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { MatchExplanation } from '@/components/duplicates/MatchExplanation';
import type { ActionState } from '@/lib/forms/action-result';
import { vehicleMatchReasons } from '@/lib/duplicates/explanations';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { listVehicleDuplicates, reviewVehicleDuplicateAction } from '../duplicates-api';
import {
  MAX_REVIEW_REASON,
  MIN_REVIEW_REASON,
  VEHICLE_CONFIDENCE_BANDS,
  VEHICLE_DUPLICATE_STATUSES,
  formatMatchScore,
  vehiclePairMembers,
  isActionable,
  type VehicleDuplicateCandidate,
} from '../duplicates-contract';

/**
 * `FE-028` — the vehicle duplicate-candidate review queue.
 *
 * ## The queue is never populated by scanning
 *
 * `veh.vehicle-duplicate-scan` reads like a query and is a privileged audited
 * **write**: it creates candidate rows, emits an audit record and is throttled at
 * 30/min. There is no rescan button and the screen does not fire it on mount. The
 * table reads `veh.vehicle-duplicate-list` and shows what the detector has
 * already found.
 *
 * ## There is no merge affordance
 *
 * Same rule as `FE-016`, for the same open decision. `P1-OD-017` is unresolved,
 * the plan requires the affordance to be *absent* rather than disabled, and the
 * screen says so in a sentence instead of showing a control that cannot work.
 *
 * ## Each side is named by its own reference
 *
 * `veh.vehicle-duplicate-list` publishes `displayNumberA` and `displayNumberB`
 * alongside the two ids, so no second read is needed to name the pair. This
 * docblock previously argued the opposite — that the operation returned ids only
 * and that naming them would mean N+1 reads — and that stopped being true at
 * #194 while the sentence stayed. The screen then showed "First record" and
 * "Second record" on the one surface whose entire job is telling two vehicles
 * apart.
 *
 * Neither a VIN nor a plate is shown here: the reference is the business key an
 * operator already uses, and a VIN is `internal`-classified. Each side still
 * links to its own profile, where the full record is.
 *
 * A and B are the order the detector recorded. Neither is "the duplicate", so the
 * ordinal is kept — but ALONGSIDE the reference, not instead of it. An
 * `aria-label` would have replaced the accessible name outright, which is
 * WCAG 2.5.3 Label in Name (Level A): a speech-input user saying "click V-0001"
 * would have matched nothing, and a screen reader would have announced "First
 * record" on the screen whose entire job is telling two vehicles apart.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
}

export function VehicleDuplicateReviewScreen({ locale, messages }: Props) {
  const [status, setStatus] = useState<string>('open');
  const [selected, setSelected] = useState<VehicleDuplicateCandidate | null>(null);

  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listVehicleDuplicates(status, request, cursor),
    [status]
  );
  /*
   * `loadKey: status` is what makes the status filter a control rather than
   * decoration, and its absence made it decoration.
   *
   * `useServerTable`'s read effect keys on
   * `${ordering}#${loadKey}#${page}#${generation}` and deliberately EXCLUDES
   * `load` from its dependencies (`use-server-table.ts:110-113`), because
   * including it would re-run on every cursor write. `ordering` is derived from
   * `TableRequest` alone (`use-cursor-pages.ts:42-51`), and `status` is not a
   * `TableRequest` field — so changing it rebuilt `load` and moved nothing the
   * effect watches. The select set the state, the state reached no request, and
   * two of its three options were unreachable: picking "dismissed" or "merged"
   * re-rendered the same open pairs.
   *
   * This is the failure the hook's own docblock names at `use-server-table.ts:70-83`
   * (`P1-26-F-019`, "the operator changed the dates and watched the same rows sit
   * there"), reappearing in the one place the mechanism built to prevent it was
   * not used. Only `AuditLogScreen` and `CustomerSelector` passed a `loadKey`.
   *
   * The two search screens escape it differently — `key={JSON.stringify(...)}`
   * remounts their results — which is why they are not affected and why this
   * queue was the exception rather than the rule.
   */
  const table = useServerTable<VehicleDuplicateCandidate>(load, {
    initial: INITIAL_REQUEST,
    loadKey: status,
  });

  const columns = useMemo<readonly Column<VehicleDuplicateCandidate>[]>(
    () => [
      {
        id: 'pair',
        headerKey: 'vehicles.duplicates.pair',
        /*
         * Each side named by its own reference, not by its position in the pair
         * (`P1-27-FE-028`).
         *
         * This column rendered "First record" and "Second record" — labels that
         * tell a reviewer nothing about which two vehicles they are being asked
         * to compare, on the screen whose entire job is that comparison. The
         * operation publishes `displayNumberA` / `displayNumberB` and has since
         * #194; the frontend TYPE omitted them, so TypeScript could not see the
         * omission and the fixture inherited it.
         *
         * The ordinal survives, because two links whose visible text is a
         * reference still need to be distinguishable when the reference is
         * missing — but as a visually-hidden SUFFIX inside the link, not as an
         * `aria-label`. `aria-label` wins the accessible-name computation
         * outright, so the first fix left the announced name as "First record"
         * while the screen showed `V-0001`: the visible label was not contained
         * in the accessible name, which is a WCAG 2.5.3 failure at Level A.
         *
         * Visible reference FIRST, so a speech-input user's "click V-0001"
         * matches from the start of the name. The uuid is never shown — the same
         * rule as the customer queue beside it.
         */
        cell: (row) => (
          <div className="flex flex-col gap-0.5">
            {vehiclePairMembers(row).map((member, index) => (
              <Link
                key={member.id}
                href={`/${locale}/vehicles/${member.id}`}
                className="text-caption text-primary underline"
                dir="ltr"
              >
                {member.number ?? translate(messages, 'vehicles.duplicates.numberUnavailable')}
                <span className="sr-only">
                  {' '}
                  {translate(
                    messages,
                    index === 0 ? 'vehicles.duplicates.memberA' : 'vehicles.duplicates.memberB'
                  )}
                </span>
              </Link>
            ))}
          </div>
        ),
      },
      {
        id: 'matchScore',
        headerKey: 'vehicles.duplicates.score',
        cell: (row) => {
          const formatted = formatMatchScore(row.matchScore);
          return formatted === null ? (
            // Raw, not guessed. `numeric` arrives as a string because it need not
            // fit a double, and this number decides whether two vehicle records
            // are treated as the same vehicle.
            <code className="font-mono text-caption" dir="ltr">
              {row.matchScore}
            </code>
          ) : (
            <span dir="ltr">{formatted}</span>
          );
        },
      },
      {
        id: 'status',
        headerKey: 'crm.customers.column.status',
        cell: (row) => translateDynamic(messages, `vehicles.duplicateStatus.${row.status}`),
      },
      {
        id: 'detectedAt',
        headerKey: 'crm.duplicates.detectedAt',
        cell: (row) => (
          <time dateTime={row.detectedAt} dir="ltr">
            {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(row.detectedAt)
            )}
          </time>
        ),
      },
      {
        id: 'decide',
        headerKey: 'crm.duplicates.decision',
        cell: (row) =>
          isActionable(row) ? (
            <button
              type="button"
              onClick={() => setSelected(row)}
              className="rounded-md border border-border px-2 py-1 text-caption text-text-primary"
            >
              {translate(messages, 'crm.duplicates.review')}
            </button>
          ) : (
            <span className="text-caption text-text-muted">
              {row.reviewedAt ? (
                <time dateTime={row.reviewedAt} dir="ltr">
                  {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                    new Date(row.reviewedAt)
                  )}
                </time>
              ) : (
                '—'
              )}
            </span>
          ),
      },
    ],
    [locale, messages]
  );

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/*
        No heading here — same reason as the CRM twin.

        `vehicles/duplicates/page.tsx` renders `PageHeader` with this exact
        `vehicles.duplicates.title`, and that is the page's one `<h1>`. This
        screen repeated it, so the queue shipped `h1 count: 2` with the title
        printed twice. Reproduced by hand on `/en/vehicles/duplicates`.
      */}
      <p className="text-body text-text-secondary">
        {translate(messages, 'vehicles.duplicates.intro')}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">
            {translate(messages, 'crm.customers.column.status')}
          </span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              // The panel belongs to a row that may not survive the filter
              // change. Closing it stops a decision landing on a candidate the
              // reviewer can no longer see.
              setSelected(null);
            }}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
          >
            {VEHICLE_DUPLICATE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {translateDynamic(messages, `vehicles.duplicateStatus.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DataTable<VehicleDuplicateCandidate>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'vehicles.duplicates.caption')}
      />

      {/* Stated, not implied by an absent button. The queue never triggers a
          scan, and a reviewer who expected one deserves to know why. */}
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'vehicles.duplicates.scanNote')}
      </p>

      {selected ? (
        <VehicleDuplicateDecisionPanel
          locale={locale}
          messages={messages}
          candidate={selected}
          onClose={() => setSelected(null)}
          onDecided={() => {
            setSelected(null);
            table.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

const EMPTY: ActionState = { status: 'idle' };

function VehicleDuplicateDecisionPanel({
  locale,
  messages,
  candidate,
  onClose,
  onDecided,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly candidate: VehicleDuplicateCandidate;
  readonly onClose: () => void;
  readonly onDecided: () => void;
}) {
  const [reason, setReason] = useState('');
  const [state, submit, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    const result = await reviewVehicleDuplicateAction(candidate.id, previous, form);
    if (result.status === 'success') {
      setReason('');
      onDecided();
    }
    return result;
  }, EMPTY);

  const score = formatMatchScore(candidate.matchScore);

  return (
    <section
      aria-labelledby="vehicle-duplicate-decision-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="vehicle-duplicate-decision-heading"
          className="text-section-title font-medium text-text-primary"
        >
          {translate(messages, 'crm.duplicates.decideHeading')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-caption text-text-secondary underline"
        >
          {translate(messages, 'action.close')}
        </button>
      </div>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'vehicles.duplicates.score')}
          </dt>
          <dd className="text-body text-text-primary" dir="ltr">
            {score ?? candidate.matchScore}
          </dd>
        </div>
        {/* The ordinal stays the TERM, because A and B carry no meaning and the
            reviewer needs to tell the two apart. The reference is the DEFINITION
            — the thing that identifies which vehicle this side actually is,
            which the panel did not say at all. */}
        {vehiclePairMembers(candidate).map((member, index) => (
          <div key={member.id}>
            <dt className="text-caption text-text-secondary">
              {translate(
                messages,
                index === 0 ? 'vehicles.duplicates.memberA' : 'vehicles.duplicates.memberB'
              )}
            </dt>
            <dd className="text-body">
              <span className="block text-text-primary" dir="ltr">
                {member.number ?? translate(messages, 'vehicles.duplicates.numberUnavailable')}
              </span>
              <Link
                href={`/${locale}/vehicles/${member.id}`}
                className="text-primary underline"
                dir="ltr"
              >
                {translate(messages, 'vehicles.duplicates.openProfile')}
              </Link>
            </dd>
          </div>
        ))}
      </dl>

      {/*
        The evidence, as sentences. It used to be `JSON.stringify(matchBasis)` in
        a `<pre>` — which is what the Product Owner was looking at when they
        wrote "Duplicate-review screens do not explain, in normal business
        language, why records may be duplicates".

        The chassis numbers themselves never appear here. `veh.valid_match_basis`
        already forbids raw identifier values from being stored in the evidence,
        and this screen additionally never echoes any part of the stored object.
      */}
      <MatchExplanation
        locale={locale}
        messages={messages}
        score={candidate.matchScore}
        bands={VEHICLE_CONFIDENCE_BANDS}
        reasonKeys={vehicleMatchReasons(candidate.matchBasis)}
      />

      <form action={submit} className="rounded-md border border-border p-3">
        <h3 className="text-body font-medium text-text-primary">
          {translate(messages, 'crm.duplicates.dismissHeading')}
        </h3>
        <p className="mt-1 text-caption text-text-muted" lang={locale}>
          {translate(messages, 'vehicles.duplicates.dismissHint')}
        </p>

        {/* The only decision the operation accepts. A select with one option is
            a control that cannot be used and reads as one that is broken. */}
        <input type="hidden" name="decision" value="dismissed" />

        <label
          htmlFor="vehicle-duplicate-reason"
          className="mt-3 block text-caption text-text-secondary"
        >
          {translate(messages, 'crm.customers.restrictions.reason')}
          <span aria-hidden="true" className="ms-1 text-error">
            *
          </span>
        </label>
        <textarea
          id="vehicle-duplicate-reason"
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          minLength={MIN_REVIEW_REASON}
          maxLength={MAX_REVIEW_REASON}
          rows={3}
          aria-invalid={state.fieldErrors?.reason ? true : undefined}
          aria-describedby={
            state.fieldErrors?.reason ? 'vehicle-duplicate-reason-error' : undefined
          }
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
        />
        {state.fieldErrors?.reason ? (
          <p
            id="vehicle-duplicate-reason-error"
            role="alert"
            className="mt-1 text-caption text-error"
          >
            {translateDynamic(messages, state.fieldErrors.reason)}
          </p>
        ) : null}

        {state.status !== 'idle' && state.status !== 'invalid' && state.messageKey ? (
          <p
            role={state.status === 'success' ? 'status' : 'alert'}
            className={`mt-2 text-body ${
              state.status === 'success' ? 'text-success' : 'text-error'
            }`}
          >
            {translateDynamic(messages, state.messageKey)}
            {state.correlationId ? (
              <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
            ) : null}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-3 rounded-md border border-border px-4 py-2 text-body text-text-primary disabled:opacity-60"
        >
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'crm.duplicates.dismiss')}
        </button>
      </form>

      {/* NO merge affordance. `P1-OD-017` is OPEN and the plan requires absence
          rather than a disabled control, because a disabled button asserts the
          capability exists and this operator lacks permission — a different and
          false statement. */}
      <p
        className="rounded-md border border-border p-3 text-body text-text-secondary"
        lang={locale}
      >
        {translate(messages, 'vehicles.duplicates.mergePendingDecision')}
        <code className="ms-2 font-mono text-caption" dir="ltr">
          P1-OD-017
        </code>
      </p>
    </section>
  );
}
