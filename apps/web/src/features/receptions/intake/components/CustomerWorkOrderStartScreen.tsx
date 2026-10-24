'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Button from '@mui/material/Button';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerTable } from '@/components/data-table/use-server-table';
import { PartyLabel } from '@/components/party/PartyLabel';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { listCustomerVehiclesCancellable } from '@/lib/customers/vehicles-read';
import type { CustomerVehicleEntry } from '@/lib/customers/vehicles-contract';
import { listPlates } from '@/features/vehicles/history-api';
import { isInForceOn, localToday } from '@/features/vehicles/history-contract';
import { readVehicleSummary, type CheckInVehicleSummary } from '../../support-api';
import { checkInWizardHref } from '../intake-handoff';
import { IntakeVehicleStep, type ChosenVehicle } from './IntakeVehicleStep';
import type { ChosenCustomer } from './WalkInIntakeScreen';

/**
 * The vehicle step of the customer-first route into reception (`P1-32-PRE-077`).
 *
 * The Owner's requirement is an entry point from the customer profile: the
 * person is already on screen, so the operator should not have to search for
 * them again in the walk-in intake. What the reception flow needs and this
 * screen does NOT yet have is the vehicle — and a visit may never be opened
 * without one.
 *
 * So this is one step and nothing more. It shows the preselected customer as a
 * fact, asks for exactly one vehicle, and then hands the SAME pair to the SAME
 * place the walk-in intake hands it: `checkInWizardHref`, read back by
 * `receptions/check-in` through `walkInHandoffFromQuery`. There is one seam,
 * not two.
 *
 * ## Nothing here writes a visit
 *
 * No reception record, no work order, no draft. The only writes reachable from
 * this screen are the vehicle ones the operator explicitly opens — registering
 * a vehicle and recording its relationship — and those are the EXISTING intake
 * controls, not new ones. Continue is a link, so a customer without a chosen
 * vehicle has no path forward at all rather than a path that fails later.
 *
 * ## Why the list is the CURRENT relationships only
 *
 * `crm.customer-vehicle-list` deliberately carries ended relationships too —
 * who was connected to which vehicle, and when, is kept on purpose. That
 * history belongs on the profile; it does not belong in a picker whose answer
 * becomes the vehicle on the ramp. A row is offered here only when the
 * relationship is open AND the vehicle record is still live (the identity comes
 * back as nulls as a group when it is not). Everything filtered out is still
 * reachable — through the vehicle search inside the existing intake step below.
 *
 * The filter runs on the page that was fetched, because the read publishes no
 * filter of its own and inventing a query parameter it does not accept would be
 * a fabricated contract. That has a consequence the screen must state rather
 * than hide: a page whose rows are all history is not a customer with no
 * vehicle, so an emptied page says so — and keeps its pager — while the "no
 * vehicle recorded" sentence is kept for the case where there is nothing
 * further to look at.
 */

export interface CustomerWorkOrderStartScreenProps {
  readonly locale: Locale;
  readonly messages: Messages;
  /** Resolved on the server from `crm.customer-read`; never typed by the browser. */
  readonly customer: ChosenCustomer;
  /** `veh.vehicle.read` — searching across all vehicles. */
  readonly canSearchVehicles: boolean;
  /** `veh.vehicle.manage` — registering a vehicle. */
  readonly canCreateVehicle: boolean;
  /** `crm.customer.vehicle.manage` — recording the relationship. */
  readonly canLinkVehicle: boolean;
}

export function CustomerWorkOrderStartScreen({
  locale,
  messages,
  customer,
  canSearchVehicles,
  canCreateVehicle,
  canLinkVehicle,
}: CustomerWorkOrderStartScreenProps) {
  /** The one vehicle this step will hand on. `null` means Continue cannot exist. */
  const [chosen, setChosen] = useState<ChosenVehicle | null>(null);
  /** True while the existing find-or-register-or-link step is open. */
  const [adding, setAdding] = useState(false);
  /** The vehicle that sub-flow settled on, while its relationship step runs. */
  const [pending, setPending] = useState<ChosenVehicle | null>(null);

  const settle = (vehicle: ChosenVehicle) => {
    setChosen(vehicle);
    setPending(null);
    setAdding(false);
  };

  return (
    <div className="flex max-w-content flex-col gap-4">
      <FixedCustomer messages={messages} customer={customer} />

      {adding ? (
        <>
          <IntakeVehicleStep
            locale={locale}
            messages={messages}
            customer={customer}
            vehicle={pending}
            canSearchVehicles={canSearchVehicles}
            canCreateVehicle={canCreateVehicle}
            canLinkVehicle={canLinkVehicle}
            /*
             * A vehicle taken off the customer's own list is already related to
             * them — that is what the list means — so the relationship step has
             * nothing to record and this step is settled at once. Anything else
             * goes through the existing relationship question first.
             */
            onVehicleChosen={(vehicle) =>
              vehicle.alreadyLinked ? settle(vehicle) : setPending(vehicle)
            }
            onVehicleCleared={() => setPending(null)}
            onLinkOutcome={() => {
              if (pending !== null) settle(pending);
            }}
          />
          <div>
            <Button
              type="button"
              variant="outlined"
              onClick={() => {
                setAdding(false);
                setPending(null);
              }}
            >
              {translate(messages, 'receptions.workOrderStart.backToList')}
            </Button>
          </div>
        </>
      ) : (
        <CurrentVehicleChoice
          locale={locale}
          messages={messages}
          customer={customer}
          chosen={chosen}
          onChoose={setChosen}
          canAdd={canSearchVehicles || canCreateVehicle || canLinkVehicle}
          onAdd={() => setAdding(true)}
        />
      )}

      <ContinueBar
        locale={locale}
        messages={messages}
        customer={customer}
        chosen={chosen}
        canReadVehicle={canSearchVehicles}
      />
    </div>
  );
}

/**
 * The customer, stated and not editable.
 *
 * The operator arrived from this customer's own profile, so changing them here
 * would silently open a visit for somebody they did not choose. Anyone who
 * wants a different customer goes back, or uses the walk-in intake, which is
 * the screen whose job the customer question is.
 */
function FixedCustomer({
  messages,
  customer,
}: {
  readonly messages: Messages;
  readonly customer: ChosenCustomer;
}) {
  return (
    <section
      aria-labelledby="work-order-start-customer-heading"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
      data-testid="work-order-start-customer"
    >
      <h2
        id="work-order-start-customer-heading"
        className="text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'receptions.intake.step.customer')}
      </h2>
      <PartyLabel
        messages={messages}
        party={{
          partnerName: customer.displayName,
          partnerNumber: customer.displayNumber,
          partnerType: customer.partyType,
        }}
      />
      <p className="text-caption text-text-secondary">
        {translate(messages, 'receptions.workOrderStart.customerFixed')}
      </p>
    </section>
  );
}

/** Offered here: an open relationship to a vehicle record that is still live. */
function isOffered(entry: CustomerVehicleEntry): boolean {
  return entry.active && entry.vehicleLifecycleStatus !== null;
}

/** A vehicle's identity in words, never its identifier — what its row action acts on. */
function vehicleName(messages: Messages, entry: CustomerVehicleEntry): string {
  const parts = [entry.vehicleDisplayNumber, entry.vin, entry.modelYear?.toString()].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  );
  return parts.length > 0 ? parts.join(' · ') : translate(messages, 'vehicles.column.noReference');
}

/**
 * The customer's current vehicles, as a single-choice question.
 *
 * On the operational grid (ADR-022) since P1-32-PRE-OD-CRM1C, the renderer the
 * walk-in step's own list already uses. "Exactly one" is still said in the
 * markup: each row's "Use this vehicle" is a toggle (`aria-pressed`), pressed on
 * the chosen row only, so a keyboard or screen-reader operator hears which row
 * is chosen with the button — the guarantee the disabled Continue gives the
 * mouse.
 *
 * ## The grid is handed the filtered page, never told to filter
 *
 * The grid renders the rows it is given and filters nothing. So the screen
 * hands it the same read with only the OFFERED rows of the fetched page in its
 * response — the filter this screen always ran, unchanged — and the pager,
 * which walks the read's cursor stack, still reaches every page. The page size
 * is fixed at ten, as before (`honours.pageSize: false`): this list never
 * offered a rows-per-page choice, and every request it sends is one it sent
 * before.
 */
function CurrentVehicleChoice({
  locale,
  messages,
  customer,
  chosen,
  onChoose,
  canAdd,
  onAdd,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customer: ChosenCustomer;
  readonly chosen: ChosenVehicle | null;
  readonly onChoose: (vehicle: ChosenVehicle) => void;
  readonly canAdd: boolean;
  readonly onAdd: () => void;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null, signal: AbortSignal) =>
      listCustomerVehiclesCancellable(customer.id, request, cursor, signal),
    [customer.id]
  );
  const table = useServerTable<CustomerVehicleEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
  });

  const offeredResponse = useMemo(
    () =>
      table.response === null
        ? null
        : { ...table.response, rows: table.response.rows.filter(isOffered) },
    [table.response]
  );
  const offeredTable: ServerTable<CustomerVehicleEntry> = {
    ...table,
    response: offeredResponse,
    honours: { pageSize: false, sort: false },
  };

  /*
   * A page whose rows were ALL filtered out is not the same fact as a customer
   * with no vehicle, and the screen said it was. The filter runs on the page
   * that was fetched — ten rows — because the read publishes no filter of its
   * own, so a customer whose first page holds only ended relationships was told
   * "no vehicle is recorded for this customer" beside a Next button that would
   * have found one. The sentence now says which of the two it is, and the pager
   * is untouched either way: it is what makes the first sentence actionable.
   */
  const morePages = table.response !== null && table.response.hasMore;

  const columns = useMemo<readonly OperationalColumn<CustomerVehicleEntry>[]>(
    () => [
      {
        id: 'vehicle',
        headerKey: 'receptions.wizard.vehicle',
        flex: 3,
        cell: (entry) => (
          <span className="flex flex-wrap items-center gap-2">
            {entry.vehicleDisplayNumber ? (
              <code className="font-mono text-caption" dir="ltr">
                {entry.vehicleDisplayNumber}
              </code>
            ) : (
              <span className="text-caption text-text-muted">
                {translate(messages, 'vehicles.column.noReference')}
              </span>
            )}
            {entry.vin ? (
              <span className="font-mono text-caption" dir="ltr">
                {entry.vin}
              </span>
            ) : (
              <span className="text-caption text-text-muted">
                {translate(messages, 'vehicles.column.noVin')}
              </span>
            )}
            {entry.modelYear !== null ? <span dir="ltr">{entry.modelYear}</span> : null}
          </span>
        ),
      },
      {
        id: 'role',
        headerKey: 'vehicles.relationships.role',
        cell: (entry) => translateDynamic(messages, `vehicles.role.${entry.relationshipRole}`),
      },
    ],
    [messages]
  );

  return (
    <section
      aria-labelledby="work-order-start-vehicle-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid="work-order-start-vehicle"
    >
      <h2
        id="work-order-start-vehicle-heading"
        className="text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'receptions.workOrderStart.vehicleHeading')}
      </h2>

      <p className="text-caption font-medium text-text-secondary">
        {translate(messages, 'receptions.workOrderStart.vehicleLegend')}
      </p>

      <OperationalGrid<CustomerVehicleEntry>
        messages={messages}
        locale={locale}
        label={translate(messages, 'receptions.workOrderStart.vehicleLegend')}
        columns={columns}
        rowId={(entry) => entry.id}
        table={offeredTable}
        rowActions={(entry) => [
          {
            kind: 'button',
            label: translate(messages, 'receptions.intake.vehicle.choose'),
            about: vehicleName(messages, entry),
            pressed: chosen !== null && chosen.id === entry.vehicleId,
            onClick: () =>
              onChoose({
                id: entry.vehicleId,
                displayNumber: entry.vehicleDisplayNumber,
                vin: entry.vin,
                modelYear: entry.modelYear,
                alreadyLinked: true,
              }),
          },
        ]}
        density="compact"
        // "No vehicle recorded" and "none on this page" are this step's own
        // sentences, below.
        suppressEmptyState
        testId="work-order-start-grid"
      />
      {table.status === 'idle' && offeredResponse !== null && offeredResponse.rows.length === 0 ? (
        <p className="text-caption text-text-muted" data-testid="work-order-start-empty">
          {translate(
            messages,
            morePages
              ? 'receptions.workOrderStart.emptyOnThisPage'
              : 'receptions.workOrderStart.empty'
          )}
        </p>
      ) : null}

      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.workOrderStart.currentOnlyNote')}
      </p>

      {canAdd ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-caption text-text-secondary">
            {translate(messages, 'receptions.workOrderStart.addOffer')}
          </span>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={onAdd}
            data-testid="work-order-start-add"
          >
            {translate(messages, 'receptions.workOrderStart.addVehicle')}
          </Button>
        </div>
      ) : (
        // The honest boundary: this operator can only choose from what is
        // already recorded against the customer.
        <p className="text-caption text-text-secondary">
          {translate(messages, 'receptions.intake.vehicle.limitedAccess')}
        </p>
      )}
    </section>
  );
}

/**
 * The way onward, which exists only when a vehicle does.
 *
 * Without a vehicle this is a disabled button and not a link: a link that is
 * merely styled as unavailable is still followable, and the one rule this step
 * enforces is that nothing proceeds without a vehicle.
 *
 * With a vehicle, the link sits beside the identity of the vehicle it will
 * carry. After registering or linking a vehicle in the sub-flow the operator
 * is returned here with no list row selected, so without this the only
 * statement of WHICH vehicle Continue carries was a uuid inside its address.
 */
function ContinueBar({
  locale,
  messages,
  customer,
  chosen,
  canReadVehicle,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customer: ChosenCustomer;
  readonly chosen: ChosenVehicle | null;
  readonly canReadVehicle: boolean;
}) {
  if (chosen === null) {
    return (
      <div className="flex flex-col gap-1">
        <div>
          <Button
            type="button"
            variant="contained"
            disabled
            data-testid="work-order-start-continue"
          >
            {translate(messages, 'receptions.workOrderStart.continue')}
          </Button>
        </div>
        <p className="text-caption text-text-muted">
          {translate(messages, 'receptions.workOrderStart.continueHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button
        component={Link}
        variant="contained"
        data-testid="work-order-start-continue"
        href={checkInWizardHref(locale, { customerId: customer.id, vehicleId: chosen.id })}
      >
        {translate(messages, 'receptions.workOrderStart.continue')}
      </Button>
      <SelectedVehicleIdentity messages={messages} chosen={chosen} canRead={canReadVehicle} />
    </div>
  );
}

/** The most plate-history pages walked looking for the plate in force. */
const PLATE_PAGE_BUDGET = 5;
/** The largest page the plate history operation accepts. */
const PLATE_PAGE_SIZE = 100;

/**
 * The plate in force today, or `null` when none is.
 *
 * `active` is `valid_to IS NULL` and is NOT "current": a plate assigned with a
 * future effective date is open and not yet in force. The history operation
 * offers no filter and no sort and lists newest first, so a future-dated plate
 * sits ahead of the one in force. Pages are walked at the largest size the
 * operation accepts until an in-force row is found, the set ends, or the page
 * budget is spent — never only the first few rows in default order.
 */
async function readPlateInForce(vehicleId: string, today: string): Promise<string | null> {
  let cursor: string | null = null;
  for (let walked = 0; walked < PLATE_PAGE_BUDGET; walked += 1) {
    const plates = await listPlates(
      vehicleId,
      { ...INITIAL_REQUEST, pageSize: PLATE_PAGE_SIZE },
      cursor
    );
    if (plates.status !== 'ok') return null;
    const inForce = plates.rows.find((entry) => isInForceOn(entry, today));
    if (inForce !== undefined) return inForce.plate;
    if (!plates.hasMore || plates.nextCursor === null) return null;
    cursor = plates.nextCursor;
  }
  return null;
}

interface IdentityRead {
  readonly vehicleId: string;
  readonly vehicle: CheckInVehicleSummary | null;
  readonly plate: string | null;
}

/**
 * Who the chosen vehicle is, read now rather than trusted from the moment it
 * was picked.
 *
 * The record is read through `veh.vehicle-read` and its current plate through
 * `veh.vehicle-plate-history` — both `veh.vehicle.read`. An operator without
 * that permission is not sent to discover the refusal, and a refused or failed
 * read is not a blank: the block still says "Selected vehicle" with the vehicle
 * number the step already holds, and shows nothing it could not read.
 */
function SelectedVehicleIdentity({
  messages,
  chosen,
  canRead,
}: {
  readonly messages: Messages;
  readonly chosen: ChosenVehicle;
  readonly canRead: boolean;
}) {
  const [read, setRead] = useState<IdentityRead | null>(null);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    const vehicleId = chosen.id;
    Promise.all([
      readVehicleSummary(vehicleId).catch(() => null),
      readPlateInForce(vehicleId, localToday(new Date())).catch(() => null),
    ]).then(([vehicle, plate]) => {
      if (cancelled) return;
      setRead({
        vehicleId,
        vehicle: vehicle !== null && vehicle.status === 'ok' ? vehicle.data : null,
        plate,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [canRead, chosen.id]);

  const identity = canRead && read !== null && read.vehicleId === chosen.id ? read : null;
  const vehicle = identity?.vehicle ?? null;
  const displayNumber = vehicle !== null ? vehicle.displayNumber : chosen.displayNumber;
  const makeModel =
    vehicle !== null
      ? [vehicle.makeName, vehicle.modelName].filter((part) => part !== null).join(' ')
      : '';

  return (
    <div
      className="flex flex-col gap-1 text-caption text-text-secondary"
      data-testid="work-order-start-selected-vehicle"
      data-read-state={canRead ? (identity !== null ? 'settled' : 'pending') : 'not-read'}
      aria-live="polite"
    >
      <span className="font-medium text-text-primary">
        {translate(messages, 'receptions.workOrderStart.selectedVehicle')}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span>{translate(messages, 'receptions.workOrderStart.selectedVehicleNumber')}</span>
        {displayNumber ? (
          <code className="font-mono" dir="ltr" data-testid="work-order-start-selected-number">
            {displayNumber}
          </code>
        ) : (
          <span className="text-text-muted">
            {translate(messages, 'vehicles.column.noReference')}
          </span>
        )}
      </span>
      {identity !== null && identity.plate !== null ? (
        <span className="flex flex-wrap items-center gap-2">
          <span>{translate(messages, 'vehicles.column.plate')}</span>
          <span className="font-mono" dir="ltr" data-testid="work-order-start-selected-plate">
            {identity.plate}
          </span>
        </span>
      ) : null}
      {vehicle !== null && vehicle.vin !== null ? (
        <span className="flex flex-wrap items-center gap-2">
          <span>{translate(messages, 'vehicles.column.vin')}</span>
          <span className="font-mono" dir="ltr" data-testid="work-order-start-selected-vin">
            {vehicle.vin}
          </span>
        </span>
      ) : null}
      {makeModel.length > 0 || (vehicle !== null && vehicle.modelYear !== null) ? (
        <span
          className="flex flex-wrap items-center gap-2"
          data-testid="work-order-start-selected-model"
        >
          {makeModel.length > 0 ? <span dir="auto">{makeModel}</span> : null}
          {vehicle !== null && vehicle.modelYear !== null ? (
            <span dir="ltr">{vehicle.modelYear}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
