'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import {
  OperationalGrid,
  TwoLineCell,
  type OperationalColumn,
} from '@/components/data/OperationalGrid';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import { useSearchRequest } from '@/lib/api/use-search-request';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { DigitsEcho } from '@/components/forms/DigitsEcho';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { MuiEmptyState } from '@/components/states/MuiStates';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { formatDate } from '@/lib/format';
import { searchVehiclesCancellable } from '../vehicle-search-read';
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
 * Vehicle search (`FE-017`), on Material UI since `P1-32-PRE-OD-VEH1`.
 *
 * ## Nothing is requested until the operator asks
 *
 * The search reads when it is mounted, so the results are a **separately
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
 *
 * ## On Material UI (`P1-32-PRE-OD-VEH1`)
 *
 * Presentation only. The boxes and the two selects are the shared Material form
 * fields, the idle sentence is `MuiEmptyState`, and the results are
 * `OperationalGrid` over the search's own `table`. What is read, when, and with
 * which criteria is exactly as before: the loader, the submission rule and the
 * key the results are mounted under did not change.
 *
 * The filters stay in this screen's own form rather than in `FilterToolbar`.
 * The toolbar offers a search box, chips, selects and a period, and no free-text
 * filter, so the VIN, plate, reference, make and model boxes would have had to
 * sit outside it — two forms for one search, each with its own Enter.
 *
 * The shared search box is no longer used here. What it gave this box is kept on
 * the Material field: `type="search"`, `dir="auto"`, no spell check, no
 * autocomplete, a text keypad, Escape to empty the box, and the clear (×)
 * control at the box's logical end, named by the shared `search.clear` words.
 * Enter is the form's own submission, as it is in every other box here.
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
   * One submission path, and the rule that decides what a submission does.
   *
   * Every box is inside the form, so Enter in any of them and the Search button
   * all arrive here. The too-short refusal is decided once, in one place, so it
   * cannot disagree with itself.
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

  const vinNote =
    draft.vin.trim().length > 0 &&
    normalizeVinForDisplay(draft.vin) !== draft.vin.trim().toUpperCase()
      ? `${translate(messages, 'vehicles.search.vinNormalized')} ${normalizeVinForDisplay(draft.vin)}`
      : null;

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
          The prominent box. The words stay this screen's — they say what may be
          typed HERE. Escape empties it and the clear control does the same.

          NOT marked invalid by `tooShort`: that refusal is about the free-text
          box, the make OR the model, and marking only this control invalid
          would point the operator at the wrong field. The form states it once,
          below, exactly as it did before.
        */}
        <div className="mb-3 flex flex-col gap-1">
          <FormTextField
            label={translate(messages, 'vehicles.search.q')}
            description={translate(messages, 'vehicles.search.qHint')}
            type="search"
            inputMode="text"
            dir="auto"
            spellCheck={false}
            autoComplete="off"
            value={draft.q}
            maxLength={MAX_VEHICLE_TEXT}
            onChange={(next) => set('q', next)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && draft.q.length > 0) {
                event.preventDefault();
                set('q', '');
              }
            }}
            endAdornment={
              draft.q.length > 0 ? (
                <IconButton
                  type="button"
                  size="small"
                  aria-label={translate(messages, 'search.clear')}
                  onClick={() => set('q', '')}
                >
                  <span aria-hidden="true">&times;</span>
                </IconButton>
              ) : undefined
            }
            testId="vehicle-search-box"
          />
          <DigitsEcho messages={messages} value={draft.q} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <FormTextField
              label={translate(messages, 'vehicles.search.vin')}
              description={translate(messages, 'vehicles.search.vinHint')}
              value={draft.vin}
              onChange={(next) => set('vin', next)}
              maxLength={MAX_VIN_FRAGMENT}
              dir="ltr"
              spellCheck={false}
            />
            {/* Shown, not applied. The raw value is what gets sent; the backend
                normalises authoritatively. Two normalisers that disagree is how
                a search box and a database look at different vehicles. */}
            {vinNote ? (
              <p className="text-caption text-text-muted" dir="ltr">
                {vinNote}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <FormTextField
              label={translate(messages, 'vehicles.search.plate')}
              description={translate(messages, 'vehicles.search.plateHint')}
              value={draft.plate}
              onChange={(next) => set('plate', next)}
              maxLength={MAX_PLATE_FRAGMENT}
              dir="ltr"
              spellCheck={false}
            />
            <DigitsEcho messages={messages} value={draft.plate} />
          </div>
          <div className="flex flex-col gap-1">
            <FormTextField
              label={translate(messages, 'vehicles.search.vehicleNumber')}
              description={translate(messages, 'vehicles.search.exactHint')}
              value={draft.vehicleNumber}
              onChange={(next) => set('vehicleNumber', next)}
              maxLength={MAX_VEHICLE_NUMBER}
              dir="ltr"
              spellCheck={false}
            />
            <DigitsEcho messages={messages} value={draft.vehicleNumber} />
          </div>
          <FormTextField
            label={translate(messages, 'vehicles.search.make')}
            description={translate(messages, 'vehicles.search.containsHint')}
            value={draft.make}
            onChange={(next) => set('make', next)}
            maxLength={MAX_VEHICLE_TEXT}
            dir="auto"
          />
          <FormTextField
            label={translate(messages, 'vehicles.search.model')}
            description={translate(messages, 'vehicles.search.containsHint')}
            value={draft.model}
            onChange={(next) => set('model', next)}
            maxLength={MAX_VEHICLE_TEXT}
            dir="auto"
          />

          {/* "Any" first and empty, so choosing it again drops the filter. */}
          <FormSelectField
            label={translate(messages, 'vehicles.search.lifecycleStatus')}
            value={draft.lifecycleStatus}
            placeholder={translate(messages, 'vehicles.search.anyOption')}
            options={VEHICLE_LIFECYCLE_STATUSES.map((value) => ({
              value,
              label: translateDynamic(messages, `vehicles.lifecycle.${value}`),
            }))}
            onChange={(next) => set('lifecycleStatus', next)}
          />
          <FormSelectField
            label={translate(messages, 'vehicles.search.powertrainCategory')}
            value={draft.powertrainCategory}
            placeholder={translate(messages, 'vehicles.search.anyOption')}
            options={POWERTRAIN_CATEGORIES.map((value) => ({
              value,
              label: translateDynamic(messages, `vehicles.powertrain.${value}`),
            }))}
            onChange={(next) => set('powertrainCategory', next)}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="contained" disabled={blocked}>
            {translate(messages, 'vehicles.search.submit')}
          </Button>
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              setDraft(EMPTY_CRITERIA);
              setTooShort(false);
              // Clears the RESULTS too. Leaving a stale table under an emptied
              // form would show an answer to a question no longer on screen.
              setSubmitted(null);
            }}
          >
            {translate(messages, 'vehicles.search.clear')}
          </Button>
          {canCreate ? (
            <Button
              component={Link}
              href={`/${locale}/vehicles/new`}
              variant="outlined"
              className="ms-auto"
            >
              {translate(messages, 'vehicles.create.title')}
            </Button>
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
        // Not an empty result — nothing has been asked, so nothing is missing.
        <MuiEmptyState
          messages={messages}
          titleKey="vehicles.search.idleTitle"
          descriptionKey="vehicles.search.idleBody"
        />
      ) : (
        // Mounted only after submission — see the docblock. The key restarts the
        // grid on a new search rather than paging the previous one.
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
  const { version: workingContextVersion } = useWorkingContext();

  /*
   * One page of the search, renamed into the shape `useSearchRequest` reads.
   *
   * The feature adapter answers with `ServerPage` — the shape `useServerTable`
   * consumes — and the hook reads `ReadState<CursorPage>`. The two carry the
   * same facts under different names: `rows` is `items`, and the six status
   * words are the same six. Writing the translation here rather than widening
   * either contract keeps it visible at the one place they meet.
   */
  const load = useCallback(
    async (
      asked: VehicleSearchCriteria,
      cursor: string | null,
      signal: AbortSignal
    ): Promise<ReadState<CursorPage<VehicleSearchHit>>> => {
      // Cancellable (P1-32-PRE-OD-READ): a superseded search is aborted, not
      // only discarded.
      const page = await searchVehiclesCancellable(asked, INITIAL_REQUEST, cursor, signal);
      if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
      return {
        status: 'ok',
        data: { items: page.rows, nextCursor: page.nextCursor, hasMore: page.hasMore },
        correlationId: page.correlationId,
      };
    },
    []
  );

  /*
   * The search, not a table read (P1-32).
   *
   * `useServerTable` reads whenever its key moves and has no notion of a term
   * settling, of an explicit submission, or of an answer being superseded.
   * `useSearchRequest` owns those three and hands back the same page contract,
   * so the grid and its pager below walk it unchanged — Previous and Next still
   * walk the cursor stack, and a criteria or branch change still restarts at
   * page one.
   */
  const search = useSearchRequest<VehicleSearchHit, VehicleSearchCriteria>({
    criteria,
    load,
    version: workingContextVersion,
  });
  const router = useRouter();

  const makeById = useMemo(
    () => new Map((makes.status === 'ok' ? makes.options : []).map((m) => [m.id, m.name])),
    [makes]
  );

  // No column offers a sort: the operation has no sort parameter.
  const columns = useMemo<readonly OperationalColumn<VehicleSearchHit>[]>(
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
         * wrong. The badge is the cell's second line, so it fits the row.
         */
        cell: (row) => (
          <TwoLineCell
            primary={
              row.activePlate ? (
                <code className="font-mono text-caption" dir="ltr">
                  {row.activePlate}
                </code>
              ) : (
                <span className="text-text-muted">
                  {translate(messages, 'vehicles.column.noPlate')}
                </span>
              )
            }
            secondary={
              row.plateMatch && !row.plateMatch.active ? (
                <span
                  data-testid="previous-plate-badge"
                  className="inline-flex items-center gap-1 rounded-md border border-warning-border bg-warning-subtle px-2 text-caption text-text-primary"
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
              ) : null
            }
          />
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
              <TwoLineCell
                primary={<bdi>{row.makeName}</bdi>}
                secondary={row.modelName ? <bdi>{row.modelName}</bdi> : null}
              />
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
          <TwoLineCell
            primary={translateDynamic(messages, `vehicles.lifecycle.${row.lifecycleStatus}`)}
            secondary={
              row.mergedIntoId
                ? // A merged vehicle is RETURNED by search, not hidden, and every
                  // write against it answers 409. Saying so here is what stops an
                  // operator selecting it and meeting an unexplained conflict.
                  //
                  // Stated, not linked — but NOT because the route is missing. That
                  // was the original reason and it stopped being true when `FE-019`
                  // added row navigation to that very route, further down this
                  // file. The sentence outlived the fact for a whole phase,
                  // because nothing in the repository reads comments.
                  //
                  // The real reason: search publishes only `mergedIntoId`, an opaque
                  // identifier with no readable label, so a link here would be a bare
                  // uuid — which this product does not show. The operator reaches the
                  // surviving record by searching for it, or from the duplicate queue
                  // where both sides are named.
                  translate(messages, 'vehicles.column.mergedInto')
                : null
            }
          />
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
    <section aria-labelledby="vehicle-results-heading" className="flex min-h-0 flex-col gap-3">
      <h2 id="vehicle-results-heading" className="sr-only">
        {translate(messages, 'vehicles.search.resultsHeading')}
      </h2>
      <OperationalGrid<VehicleSearchHit>
        messages={messages}
        locale={locale}
        // The caption the table carried is the grid's accessible name.
        label={translate(messages, 'vehicles.search.caption')}
        columns={columns}
        rowId={(row) => row.id}
        table={search.table}
        /*
         * `P1-27-FE-002`, the vehicle half. Same defect and same cause as the
         * customer search: the criteria live outside `TableRequest`, so the
         * grid's own empty state would make a claim about the tenant's entire
         * fleet.
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
        rowActions={(row) => [
          {
            kind: 'button',
            label: translate(messages, 'vehicles.search.open'),
            onClick: () => router.push(`/${locale}/vehicles/${row.id}`),
          },
        ]}
        testId="vehicle-search-grid"
      />
      {/*
        A search that matched nothing is a statement about the SEARCH, not about
        the fleet. Creating the vehicle that was not found is the actual next
        step, and it is offered only to an operator who may create one — a
        control whose only possible outcome is a 403 is worse than no control.
      */}
      {/*
        "No matches" is the PHASE, not a row count. `empty` is reachable only
        from a COMPLETED read that returned nothing, so the sentence cannot
        appear before there is an answer to base it on.
      */}
      {search.phase === 'empty' ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-body text-text-secondary" lang={locale}>
            {translate(messages, 'vehicles.search.noMatch')}
          </p>
          {canCreate ? (
            <Button
              component={Link}
              href={`/${locale}/vehicles/new`}
              variant="outlined"
              data-testid="create-vehicle-from-no-results"
            >
              {translate(messages, 'vehicles.create.title')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'vehicles.search.exactMatchNote')}
      </p>
    </section>
  );
}
