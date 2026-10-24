'use client';

import { useCallback, useMemo, useState } from 'react';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { translate, translateDynamic, type Messages } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { formatDate, formatDateTime } from '@/lib/format';
import { listDuplicates } from '../identity-api';
import {
  DUPLICATE_STATUSES,
  formatMatchScore,
  isActionable,
  pairMembers,
  type DuplicateCandidate,
} from '../identity-contract';
import { DuplicateDecisionPanel } from './DuplicateDecisionPanel';

/**
 * `FE-016` — the duplicate-candidate review queue.
 *
 * ## Only dismissal is offered, because merge is blocked on an open decision
 *
 * `crm.duplicate-review` accepts exactly one decision — `dismissed` — behind
 * `crm.customer.duplicate.review`. Merging is `crm.customer-merge`, a different
 * operation behind **`crm.customer.merge`**, and this phase does not call it:
 * `P1-OD-017` is open, and the canonical plan requires the merge affordance to
 * be absent rather than disabled.
 *
 * So the queue opens a decision panel that compares the pair, shows the match
 * evidence, offers dismissal, and states that merge rules are pending.
 *
 * ## Neither side of a pair is "the duplicate"
 *
 * A and B are the order the detector happened to record. Rendering one as the
 * original and the other as the copy would invent a fact and quietly steer a
 * reviewer toward destroying whichever the layout put second.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
}

/**
 * One name of the pair, as an operator reads it. A missing display name is
 * possible and is NOT the uuid's cue to appear — an internal identifier in a
 * name slot reads as a customer reference.
 */
function memberName(messages: Messages, name: string | null): string {
  return name ?? translate(messages, 'crm.duplicates.nameUnavailable');
}

export function DuplicateReviewScreen({ locale, messages }: Props) {
  // `open` by default: the queue exists to be worked through, and a reviewer
  // opening it wants the outstanding pairs, not a mixed history.
  const [status, setStatus] = useState<string>('open');
  const [selected, setSelected] = useState<DuplicateCandidate | null>(null);

  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listDuplicates(status, request, cursor),
    [status]
  );
  /*
   * `loadKey: status` — see the long note in the vehicle twin,
   * `features/vehicles/components/VehicleDuplicateReviewScreen.tsx`.
   *
   * The same defect stood in both queues and was found in only one of them. It
   * is fixed in both, together, because a queue whose filter silently does
   * nothing is the same defect whichever module it sits in — and because fixing
   * the reported one alone is how the survivor becomes the next finding.
   *
   * Short form: `useServerTable` keys its read on `TableRequest` plus `loadKey`
   * and excludes `load` from the effect deps, so state the request does not
   * carry must be declared here or it reaches no request at all.
   */
  const table = useServerTable<DuplicateCandidate>(load, {
    initial: INITIAL_REQUEST,
    loadKey: status,
  });

  /*
   * On the operational grid (ADR-022) since P1-32-PRE-OD-CRM1C. The read, the
   * status filter and the decision panel are unchanged; only the renderer moved.
   * The pager is the grid's own, and it offers the same page sizes the shared
   * table did, so every request this queue can send is one it could send before.
   */
  const columns = useMemo<readonly OperationalColumn<DuplicateCandidate>[]>(
    () => [
      {
        id: 'pair',
        headerKey: 'crm.duplicates.pair',
        flex: 2,
        cell: (row) => {
          const [a, b] = pairMembers(row);
          // Both names on the same line style. A first line drawn stronger than
          // the second would be the layout choosing "the original".
          return (
            <span className="flex h-full min-w-0 flex-col justify-center">
              {[a, b].map((member) => (
                <span
                  key={member.id}
                  className={`min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap text-caption ${
                    member.name === null ? 'text-text-muted' : 'text-text-primary'
                  }`}
                >
                  {memberName(messages, member.name)}
                </span>
              ))}
            </span>
          );
        },
      },
      {
        id: 'matchScore',
        headerKey: 'crm.duplicates.score',
        cell: (row) => {
          const formatted = formatMatchScore(row.matchScore);
          return formatted === null ? (
            // Shown raw rather than as a confident wrong number. `matchScore` is
            // `numeric` and arrives as a string precisely because it does not
            // fit a float; an unexpected shape must not be guessed at.
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
        cell: (row) => translateDynamic(messages, `crm.duplicateStatus.${row.status}`),
      },
      {
        id: 'detectedAt',
        headerKey: 'crm.duplicates.detectedAt',
        minChars: 18,
        cell: (row) => (
          <time dateTime={row.detectedAt} dir="ltr">
            {formatDateTime(row.detectedAt, locale)}
          </time>
        ),
      },
      {
        id: 'decide',
        headerKey: 'crm.duplicates.decision',
        cell: (row) =>
          // An open pair is still waiting for its decision, and says so — its
          // Review is in the row-action column. A dismissed or merged pair is
          // settled: it shows when, if that day was recorded, and its row offers
          // no action (`rowActions` below). Re-deciding it is refused by the
          // backend, and the control should never have been there.
          isActionable(row) ? (
            <span className="text-caption text-text-secondary">
              {translate(messages, 'vehicles.duplicateStatus.open')}
            </span>
          ) : row.reviewedAt ? (
            <time className="text-caption text-text-muted" dateTime={row.reviewedAt} dir="ltr">
              {formatDate(row.reviewedAt, locale)}
            </time>
          ) : (
            <span className="text-caption text-text-muted">—</span>
          ),
      },
    ],
    [locale, messages]
  );

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/*
        No heading here, and no `<header>` to hang one on.

        `crm/customer-duplicates/page.tsx` already renders `PageHeader` with THIS
        SAME `crm.duplicates.title`, and `PageHeader` is the page's `<h1>` — one
        per page, as its own docblock states. This screen printed the identical
        string a second time, so the queue shipped with two `<h1>`s and the title
        visibly twice. Measured on `/en/crm/customer-duplicates`: `h1 count: 2`.
        Dropping it here loses no text; the title is still on screen, once.

        The intro stays. It is not the title said again — it explains what the
        pairs are and that merge is not offered yet, which nothing else says.
      */}
      <p className="text-body text-text-secondary">{translate(messages, 'crm.duplicates.intro')}</p>

      <div className="w-full max-w-xs">
        <FormSelectField
          label={translate(messages, 'crm.customers.column.status')}
          value={status}
          options={DUPLICATE_STATUSES.map((value) => ({
            value,
            label: translateDynamic(messages, `crm.duplicateStatus.${value}`),
          }))}
          onChange={(value) => {
            setStatus(value);
            // The open panel belongs to a row that may not be in the next
            // page. Closing it stops a decision being submitted against a
            // candidate the reviewer can no longer see.
            setSelected(null);
          }}
        />
      </div>

      <OperationalGrid<DuplicateCandidate>
        messages={messages}
        locale={locale}
        label={translate(messages, 'crm.duplicates.caption')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={(row) =>
          isActionable(row)
            ? [
                {
                  kind: 'button',
                  label: translate(messages, 'crm.duplicates.review'),
                  // Both names, so ten rows of "Review" are ten different
                  // controls to a screen reader.
                  about: pairMembers(row)
                    .map((member) => memberName(messages, member.name))
                    .join(' · '),
                  onClick: () => setSelected(row),
                },
              ]
            : []
        }
        testId="customer-duplicate-grid"
      />

      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'crm.duplicates.basisNote')}
      </p>

      {selected ? (
        <DuplicateDecisionPanel
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
