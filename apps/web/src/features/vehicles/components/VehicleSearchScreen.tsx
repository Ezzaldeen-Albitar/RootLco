'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { SearchBox } from '@/components/search/SearchBox';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { DigitsEcho } from '@/components/forms/DigitsEcho';
import { EmptyState } from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { formatDate } from '@/lib/format';
import { searchVehicles } from '../api';
import type { CatalogueResult } from '../catalogue-api';
import {
  EMPTY_CRITERIA,
  POWERTRAIN_CATEGORIES,
  VEHICLE_LIFECYCLE_STATUSES,
  hasTooShortCriteria,
  isEmptyCriteria,
  normalizeVinForDisplay,
  MAX_PLATE_FRAGMENT,
  MAX_VEHICLE_NUMBER,
  MAX_VEHICLE_TEXT,
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
 * ## One box first, then the precise filters (P1-32)
 *
 * The free-text box sends `q` (make, model, vehicle number, part of a VIN or of
 * any plate). VIN and vehicle number stay exact; make and model are contains
 * matches; plate matches any plate the vehicle has carried. When a plate search
 * matched an EARLIER plate the row says so with a badge and the date that plate
 * stopped being valid, because an operator reading the current plate beside the
 * one they typed would otherwise think the search was wrong.
 *
 * Criteria live in screen state, never in the address bar (`P1-27-SEC-002`).
 * Digits typed on an Arabic keyboard are echoed as Western digits for reading
 * only; the value is sent as typed and the backend folds it.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canCreate: boolean;
  /** Resolved once on the server, for the make/model columns. */
  readonly makes: CatalogueResult;
}

export function VehicleSearchScreen({ locale, messages, canCreate, makes }: Props) {
  const [draft, setDraft] = useState<VehicleSearchCriteria>(EMPTY_CRITERIA);
  /** The criteria actually submitted. `null` until the operator searches. */
  const [submitted, setSubmitted] = useState<VehicleSearchCriteria | null>(null);
  const formId = useId();

  const set = (key: keyof VehicleSearchCriteria, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const blocked = isEmptyCriteria(draft);
  const [tooShort, setTooShort] = useState(false);

  /*
   * One submission path, shared by the form and by the search box.
   *
   * `SearchBox` intercepts Enter rather than relying on implicit submission —
   * it is used outside a form on other surfaces — so the rule that decides what
   * a submission does has to live somewhere both can reach it. Two copies would
   * be two chances for the too-short refusal to disagree with itself.
   */
  const submitSearch = () => {
    if (blocked) return;
    // The backend refuses a one-character free-text, make or model value.
    if (hasTooShortCriteria(draft)) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setSubmitted(draft);
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
        className="rounded-lg border border-border bg-surface p-4"
      >
        {/*
          The shared search box (P1-32), replacing a hand-rolled input.
          
          What it brings that the hand-rolled one did not: a clear control,
          Escape to empty the box, Enter handled explicitly rather than by
          implicit form submission, an `inputMode` that does not summon a
          digits-only keypad for a box that also takes a make or a model, and
          the same non-colour error cue every other field carries. The words
          stay this screen's — they say what may be typed HERE.
        */}
        <div className="mb-3">
          <SearchBox
            messages={messages}
            label={translate(messages, 'vehicles.search.q')}
            example={translate(messages, 'vehicles.search.qHint')}
            value={draft.q}
            maxLength={MAX_VEHICLE_TEXT}
            onChange={(next) => set('q', next)}
            onSubmit={submitSearch}
            // NOT wired to `tooShort`: that refusal is about the free-text box,
            // the make OR the model, and marking only this control invalid would
            // point the operator at the wrong field. The form states it once,
            // below, exactly as it did before.
            inlineSubmit={false}
            testId="vehicle-search-box"
          />
          <DigitsEcho messages={messages} value={draft.q} />
        </div>
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
            echo
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
            echo
          />
          <Field
            messages={messages}
            id={`${formId}-make`}
            labelKey="vehicles.search.make"
            hintKey="vehicles.search.containsHint"
            value={draft.make}
            onChange={(v) => set('make', v)}
            maxLength={MAX_VEHICLE_TEXT}
            dir="auto"
            note={null}
          />
          <Field
            messages={messages}
            id={`${formId}-model`}
            labelKey="vehicles.search.model"
            hintKey="vehicles.search.containsHint"
            value={draft.model}
            onChange={(v) => set('model', v)}
            maxLength={MAX_VEHICLE_TEXT}
            dir="auto"
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
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-text-inverse disabled:opacity-60"
          >
            {translate(messages, 'vehicles.search.submit')}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY_CRITERIA);
              setTooShort(false);
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
        {!blocked && tooShort ? (
          <p role="alert" className="mt-2 text-caption text-error">
            {translate(messages, 'vehicles.search.tooShort')}
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
          canCreate={canCreate}
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
  canCreate,
  criteria,
  makes,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `veh.vehicle.create` — gates the offer to create the vehicle not found. */
  readonly canCreate: boolean;
  readonly criteria: VehicleSearchCriteria;
  readonly makes: CatalogueResult;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => searchVehicles(criteria, request, cursor),
    [criteria]
  );
  const table = useServerTable<VehicleSearchHit>(load, { initial: INITIAL_REQUEST });
  const router = useRouter();

  const makeById = useMemo(
    () => new Map((makes.status === 'ok' ? makes.options : []).map((m) => [m.id, m.name])),
    [makes]
  );

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
        id: 'plate',
        headerKey: 'vehicles.column.plate',
        /*
         * P1-32. The current plate, and — when the search matched a plate the
         * vehicle no longer carries — a badge naming that plate and the date it
         * stopped being valid. Without the badge an operator who typed an old
         * plate sees a different plate in the row and concludes the search is
         * wrong.
         */
        cell: (row) => (
          <span className="flex flex-col gap-1">
            {row.activePlate ? (
              <code className="font-mono text-caption" dir="ltr">
                {row.activePlate}
              </code>
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'vehicles.column.noPlate')}
              </span>
            )}
            {row.plateMatch && !row.plateMatch.active ? (
              <span
                data-testid="previous-plate-badge"
                className="inline-flex flex-wrap items-center gap-1 rounded-md border border-warning-border bg-warning-subtle px-2 py-0.5 text-caption text-text-primary"
              >
                <span>
                  {row.plateMatch.validTo
                    ? translate(messages, 'vehicles.search.previousPlateUntil')
                    : translate(messages, 'vehicles.search.previousPlate')}
                </span>
                {row.plateMatch.validTo ? (
                  <bdi>{formatDate(row.plateMatch.validTo, locale)}</bdi>
                ) : null}
                <code className="font-mono" dir="ltr">
                  {row.plateMatch.plate}
                </code>
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'owner',
        headerKey: 'vehicles.column.owner',
        // Null when there is no current owner or the operator may not read
        // customers. Either way the row shows an absence, never a guess.
        cell: (row) =>
          row.customerDisplayName ? (
            <bdi>{row.customerDisplayName}</bdi>
          ) : (
            <span className="text-text-muted">—</span>
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
        /*
         * Search publishes `makeId` and NO name — only the detail read resolves
         * labels — so the id is matched against the catalogue this page loaded.
         *
         * FOUR outcomes, because an unresolved id has more than one cause and
         * they are not interchangeable:
         *   - no makeId                  -> the vehicle has no make recorded
         *   - resolved                   -> the name
         *   - unresolved, catalogue bad  -> the CATALOGUE failed or was cut short
         *   - unresolved, catalogue good -> this id is genuinely not in it
         *
         * The third case is the one that was wrong. This comment used to promise
         * three outcomes and the code delivered two, with the fallback reading
         * "Make not available to you" — a sentence asserting a permission. That
         * assertion cannot be true here: `veh.catalogue-make-list` requires the
         * capability the page has already gated on, so a caller who reaches this
         * table can always see the catalogue. What actually fails is the read —
         * a 429 or a timeout, which `read-operation.ts` classifies as
         * `unavailable`, "try again shortly", not a fault and certainly not a
         * denial. And when the catalogue fails, EVERY row says it at once, so
         * the whole column accused the operator of lacking access they hold.
         *
         * The two catalogue sentences are the ones FE-018 already ships and
         * translates (`vehicles.create.catalogueUnavailable` / `…Truncated`);
         * nothing new is invented here. No per-row retry and no per-row
         * reference: the catalogue is read once per page, so if a reference is
         * ever wanted it belongs once, beside the table, from
         * `makes.correlationId`.
         */
        cell: (row) => {
          // P1-32: the backend now resolves the names. The catalogue fallback
          // below stays for a hit whose name did not resolve.
          if (row.makeName) {
            return (
              <span className="flex flex-col">
                <bdi>{row.makeName}</bdi>
                {row.modelName ? (
                  <bdi className="text-caption text-text-secondary">{row.modelName}</bdi>
                ) : null}
              </span>
            );
          }
          if (row.makeId === null) {
            return (
              <span className="text-text-muted">
                {translate(messages, 'vehicles.column.noMake')}
              </span>
            );
          }
          const name = makeById.get(row.makeId);
          if (name !== undefined) return name;

          const key =
            makes.status !== 'ok'
              ? 'vehicles.create.catalogueUnavailable'
              : makes.truncated
                ? 'vehicles.create.catalogueTruncated'
                : 'vehicles.column.makeUnrecognised';
          return <span className="text-text-muted">{translate(messages, key)}</span>;
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
              // Stated, not linked — but NOT because the route is missing. That
              // was the original reason and it stopped being true when `FE-019`
              // added row navigation to that very route, fifty lines below, in
              // this file. The sentence outlived the fact for a whole phase,
              // because nothing in the repository reads comments.
              //
              // The real reason: search publishes only `mergedIntoId`, an opaque
              // identifier with no readable label, so a link here would be a bare
              // uuid — which this product does not show. The operator reaches the
              // surviving record by searching for it, or from the duplicate queue
              // where both sides are named.
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
    // `locale` IS a dependency since P1-32: the previous-plate badge formats the
    // date that plate stopped being valid. The row action builds a URL and is
    // defined outside this memo.
    //
    // The earlier note said "nothing in these columns builds a URL any more" and
    // attributed it to the profile route being a later deliverable. Both halves
    // were stale: the route exists and this file routes to it.
    // `makes.status` and `makes.truncated` are read by the Make column to tell a
    // failed catalogue apart from an unrecognised id. They are NOT implied by
    // `makeById`: a catalogue that fails and one that is merely missing this id
    // both yield the same empty map, which is precisely the confusion the column
    // exists to resolve. Omitting them would have made the column render the
    // wrong sentence from a stale outcome.
    [locale, makeById, makes.status, makes.truncated, messages]
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
        /*
         * `P1-27-FE-002`, the vehicle half. Same defect and same cause as the
         * customer search: the criteria live outside `TableRequest`, so
         * `isNarrowed` is permanently false and a search matching nothing said
         * "Nothing here yet" about the tenant's entire fleet.
         *
         * Unlike the customer search this screen had no zero-result block of its
         * own, so one is added below rather than only suppressing the wrong one.
         */
        suppressEmptyState
        /*
         * Opening a found vehicle (`P1-27-FE-019`).
         *
         * This table listed vehicles and offered no way to open one. The vehicle
         * profile route existed, and the ONLY links to it in the whole
         * application were on the duplicate-review queue — so the profile, and
         * with it plate assignment, odometer capture, ownership transfer, the
         * electric-drive profile, customer relationships, documents and history,
         * could be reached only by an operator who happened to be reviewing a
         * suspected duplicate.
         *
         * The same defect shape as the unreachable writes: the screen was built,
         * and nothing navigated to it. The CRM search has carried this row action
         * since Wave 2; the vehicle search never gained one.
         */
        rowActions={(row) => (
          <button
            type="button"
            onClick={() => router.push(`/${locale}/vehicles/${row.id}`)}
            className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
          >
            {translate(messages, 'vehicles.search.open')}
          </button>
        )}
      />
      {/*
        A search that matched nothing is a statement about the SEARCH, not about
        the fleet. Creating the vehicle that was not found is the actual next
        step, and it is offered only to an operator who may create one — a
        control whose only possible outcome is a 403 is worse than no control.
      */}
      {table.response && table.response.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-body text-text-secondary" lang={locale}>
            {translate(messages, 'vehicles.search.noMatch')}
          </p>
          {canCreate ? (
            <Link
              href={`/${locale}/vehicles/new`}
              data-testid="create-vehicle-from-no-results"
              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-body font-medium text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle"
            >
              {translate(messages, 'vehicles.create.title')}
            </Link>
          ) : null}
        </div>
      ) : null}

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
  echo = false,
}: {
  readonly messages: Messages;
  readonly id: string;
  readonly labelKey: string;
  readonly hintKey: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength: number;
  readonly dir: 'ltr' | 'rtl' | 'auto';
  readonly note: string | null;
  /** Echo Arabic-Indic digits as Western digits under the box, for reading only. */
  readonly echo?: boolean;
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
      {echo ? <DigitsEcho messages={messages} value={value} /> : null}
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
