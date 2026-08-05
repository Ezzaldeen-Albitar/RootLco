'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { EmptyState } from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { searchVehicles } from '../api';
import type { CatalogueOption } from '../catalogue-api';
import {
  EMPTY_CRITERIA,
  POWERTRAIN_CATEGORIES,
  VEHICLE_LIFECYCLE_STATUSES,
  isEmptyCriteria,
  normalizeVinForDisplay,
  MAX_PLATE_FRAGMENT,
  MAX_VEHICLE_NUMBER,
  MAX_VIN_FRAGMENT,
  type VehicleSearchCriteria,
  type VehicleSearchHit,
} from '../contract';

/**
 * Vehicle search (`FE-017`).
 *
 * ## Nothing is requested until the operator asks
 *
 * `useServerTable` reads on mount, so the results table is a **separately
 * mounted component** rather than a hook held at the top of this screen. That
 * makes "no request before intent" structural: before submission the component
 * that would issue the read does not exist. Guarding it with a flag two files
 * away is the arrangement that let the CRM screen quietly read on mount in
 * Wave 2, and it is not repeated here.
 *
 * This screen therefore does **not** load a default list. The prompt allows
 * either behaviour if the contract supports it; the contract does not. Search is
 * `expensive-read` at 30 requests per minute per user, an unfiltered query is a
 * full scan, and the adapter refuses empty criteria — so a bounded default list
 * would need a filter nobody chose. Recorded in `contract-archaeology.md`.
 *
 * ## Every text filter is EXACT
 *
 * VIN, plate and vehicle number are equality matches, not prefixes. The hint
 * text says so, because a box that silently requires the whole value while
 * looking like a type-ahead is worse than one that explains itself.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canCreate: boolean;
  /** Resolved once on the server, for the make/model columns. */
  readonly makes: readonly CatalogueOption[];
}

export function VehicleSearchScreen({ locale, messages, canCreate, makes }: Props) {
  const [draft, setDraft] = useState<VehicleSearchCriteria>(EMPTY_CRITERIA);
  /** The criteria actually submitted. `null` until the operator searches. */
  const [submitted, setSubmitted] = useState<VehicleSearchCriteria | null>(null);
  const formId = useId();

  const set = (key: keyof VehicleSearchCriteria, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const blocked = isEmptyCriteria(draft);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          // Enter submits, because this is a real form with a real submit
          // button — not a keydown handler that reimplements one.
          if (!blocked) setSubmitted(draft);
        }}
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            messages={messages}
            id={`${formId}-vin`}
            labelKey="vehicles.search.vin"
            hintKey="vehicles.search.vinHint"
            value={draft.vin}
            onChange={(v) => set('vin', v)}
            maxLength={MAX_VIN_FRAGMENT}
            dir="ltr"
            // Shown, not applied. The raw value is what gets sent; the backend
            // normalises authoritatively. Two normalisers that disagree is how a
            // search box and a database look at different vehicles.
            note={
              draft.vin.trim().length > 0 &&
              normalizeVinForDisplay(draft.vin) !== draft.vin.trim().toUpperCase()
                ? `${translate(messages, 'vehicles.search.vinNormalized')} ${normalizeVinForDisplay(draft.vin)}`
                : null
            }
          />
          <Field
            messages={messages}
            id={`${formId}-plate`}
            labelKey="vehicles.search.plate"
            hintKey="vehicles.search.plateHint"
            value={draft.plate}
            onChange={(v) => set('plate', v)}
            maxLength={MAX_PLATE_FRAGMENT}
            dir="ltr"
            note={null}
          />
          <Field
            messages={messages}
            id={`${formId}-number`}
            labelKey="vehicles.search.vehicleNumber"
            hintKey="vehicles.search.exactHint"
            value={draft.vehicleNumber}
            onChange={(v) => set('vehicleNumber', v)}
            maxLength={MAX_VEHICLE_NUMBER}
            dir="ltr"
            note={null}
          />

          <Select
            messages={messages}
            id={`${formId}-lifecycle`}
            labelKey="vehicles.search.lifecycleStatus"
            value={draft.lifecycleStatus}
            onChange={(v) => set('lifecycleStatus', v)}
            options={VEHICLE_LIFECYCLE_STATUSES}
            prefix="vehicles.lifecycle."
          />
          <Select
            messages={messages}
            id={`${formId}-powertrain`}
            labelKey="vehicles.search.powertrainCategory"
            value={draft.powertrainCategory}
            onChange={(v) => set('powertrainCategory', v)}
            options={POWERTRAIN_CATEGORIES}
            prefix="vehicles.powertrain."
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={blocked}
            className="rounded-md bg-brand-primary px-4 py-2 text-body font-medium text-text-inverse disabled:opacity-60"
          >
            {translate(messages, 'vehicles.search.submit')}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY_CRITERIA);
              // Clears the RESULTS too. Leaving a stale table under an emptied
              // form would show an answer to a question no longer on screen.
              setSubmitted(null);
            }}
            className="rounded-md border border-border px-4 py-2 text-body text-text-primary"
          >
            {translate(messages, 'vehicles.search.clear')}
          </button>
          {canCreate ? (
            <Link
              href={`/${locale}/vehicles/new`}
              className="ms-auto rounded-md border border-border px-4 py-2 text-body text-text-primary"
            >
              {translate(messages, 'vehicles.create.title')}
            </Link>
          ) : null}
        </div>

        {blocked ? (
          <p className="mt-2 text-caption text-text-muted">
            {translate(messages, 'vehicles.search.needCriteria')}
          </p>
        ) : null}
      </form>

      {submitted === null ? (
        <EmptyState
          messages={messages}
          titleKey="vehicles.search.idleTitle"
          descriptionKey="vehicles.search.idleBody"
        />
      ) : (
        // Mounted only after submission — see the docblock. The key restarts the
        // table on a new search rather than paging the previous one.
        <VehicleSearchResults
          key={JSON.stringify(submitted)}
          locale={locale}
          messages={messages}
          criteria={submitted}
          makes={makes}
        />
      )}
    </div>
  );
}

function VehicleSearchResults({
  locale,
  messages,
  criteria,
  makes,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly criteria: VehicleSearchCriteria;
  readonly makes: readonly CatalogueOption[];
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => searchVehicles(criteria, request, cursor),
    [criteria]
  );
  const table = useServerTable<VehicleSearchHit>(load, { initial: INITIAL_REQUEST });

  const makeById = useMemo(() => new Map(makes.map((make) => [make.id, make.name])), [makes]);

  const columns = useMemo<readonly Column<VehicleSearchHit>[]>(
    () => [
      {
        id: 'displayNumber',
        headerKey: 'vehicles.column.reference',
        cell: (row) =>
          row.displayNumber ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.displayNumber}
            </code>
          ) : (
            // Never the uuid. An internal identifier in the reference slot reads
            // to an operator as the vehicle's number.
            <span className="text-text-muted">
              {translate(messages, 'vehicles.column.noReference')}
            </span>
          ),
      },
      {
        id: 'vin',
        headerKey: 'vehicles.column.vin',
        cell: (row) =>
          row.vin ? (
            <span className="font-mono text-caption" dir="ltr">
              {row.vin}
            </span>
          ) : (
            <span className="text-text-muted">{translate(messages, 'vehicles.column.noVin')}</span>
          ),
      },
      {
        id: 'make',
        headerKey: 'vehicles.column.make',
        // Search publishes `makeId` and NO name — only the detail read resolves
        // labels. The id is matched against the catalogue this page already
        // loaded. Three outcomes, and they are three different facts:
        //   - no makeId          -> the vehicle has no make recorded
        //   - makeId, resolved   -> the name
        //   - makeId, unresolved -> a make this caller cannot see, said plainly
        //                           rather than rendered as a raw uuid
        cell: (row) => {
          if (row.makeId === null) {
            return (
              <span className="text-text-muted">
                {translate(messages, 'vehicles.column.noMake')}
              </span>
            );
          }
          const name = makeById.get(row.makeId);
          return (
            name ?? (
              <span className="text-text-muted">
                {translate(messages, 'vehicles.column.makeUnavailable')}
              </span>
            )
          );
        },
      },
      {
        id: 'modelYear',
        headerKey: 'vehicles.column.modelYear',
        // `integer`, a real JS number. Rendered with `dir="ltr"` so a year does
        // not reorder in an RTL row.
        cell: (row) =>
          row.modelYear === null ? (
            <span className="text-text-muted">—</span>
          ) : (
            <span dir="ltr">{row.modelYear}</span>
          ),
      },
      {
        id: 'lifecycleStatus',
        headerKey: 'crm.customers.column.status',
        cell: (row) => (
          <span className="flex flex-col">
            <span>{translateDynamic(messages, `vehicles.lifecycle.${row.lifecycleStatus}`)}</span>
            {row.mergedIntoId ? (
              // A merged vehicle is RETURNED by search, not hidden, and every
              // write against it answers 409. Saying so here is what stops an
              // operator selecting it and meeting an unexplained conflict.
              //
              // Stated, not linked: the vehicle profile route arrives in Wave 8
              // (`FE-019`), and a link to a route that does not exist yet is a
              // 404 dressed up as a feature.
              <span className="text-caption text-text-muted">
                {translate(messages, 'vehicles.column.mergedInto')}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'powertrainCategory',
        headerKey: 'vehicles.column.powertrain',
        cell: (row) => translateDynamic(messages, `vehicles.powertrain.${row.powertrainCategory}`),
      },
      {
        id: 'workshopStatus',
        headerKey: 'vehicles.column.workshop',
        cell: (row) => translateDynamic(messages, `vehicles.workshop.${row.workshopStatus}`),
      },
    ],
    // `locale` is not a dependency: the merged-into cell became a plain
    // statement rather than a link when the profile route turned out to be a
    // Wave 8 deliverable, and nothing in these columns builds a URL any more.
    [makeById, messages]
  );

  return (
    <section aria-labelledby="vehicle-results-heading" className="flex min-h-0 flex-col">
      <h2 id="vehicle-results-heading" className="sr-only">
        {translate(messages, 'vehicles.search.resultsHeading')}
      </h2>
      <DataTable<VehicleSearchHit>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'vehicles.search.caption')}
      />
      <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'vehicles.search.exactMatchNote')}
      </p>
    </section>
  );
}

function Field({
  messages,
  id,
  labelKey,
  hintKey,
  value,
  onChange,
  maxLength,
  dir,
  note,
}: {
  readonly messages: Messages;
  readonly id: string;
  readonly labelKey: string;
  readonly hintKey: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength: number;
  readonly dir: 'ltr' | 'rtl';
  readonly note: string | null;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-caption text-text-secondary">
        {translateDynamic(messages, labelKey)}
      </label>
      <input
        id={id}
        type="text"
        dir={dir}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        aria-describedby={`${id}-hint`}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
      />
      <p id={`${id}-hint`} className="mt-1 text-caption text-text-muted">
        {translateDynamic(messages, hintKey)}
      </p>
      {note ? (
        <p className="mt-1 text-caption text-text-muted" dir="ltr">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function Select({
  messages,
  id,
  labelKey,
  value,
  onChange,
  options,
  prefix,
}: {
  readonly messages: Messages;
  readonly id: string;
  readonly labelKey: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly string[];
  readonly prefix: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-caption text-text-secondary">
        {translateDynamic(messages, labelKey)}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
      >
        <option value="">{translate(messages, 'vehicles.search.anyOption')}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {translateDynamic(messages, `${prefix}${option}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
