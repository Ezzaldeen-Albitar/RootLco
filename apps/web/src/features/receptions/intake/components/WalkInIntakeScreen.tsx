'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import { PartyLabel } from '@/components/party/PartyLabel';
import { Icon } from '@/components/primitives/Icon';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { checkInWizardHref } from '../intake-handoff';
import { IntakeCustomerCreate } from './IntakeCustomerCreate';
import { IntakeVehicleStep, type ChosenVehicle } from './IntakeVehicleStep';

/**
 * Walk-in customer and vehicle intake (`P1-28-FE-006`, `TC-P1-28-XD-001`) —
 * the reception desk's first screen.
 *
 * One composed flow: find or create the CUSTOMER, find or create the VEHICLE,
 * record the relationship between them where it is not already on record, and
 * end holding the `(customerId, vehicleId)` pair the check-in wizard
 * (`P1-28-FE-007`, Wave D) starts from. The handoff shape and the wizard's
 * address live in `../intake-handoff.ts`, which is the Wave-D consumption
 * point.
 *
 * ## Every operation here is an EXISTING CRM or Vehicle operation
 *
 * `crm.customer-search`, `crm.individual-create`, `crm.company-create`,
 * `crm.customer-vehicle-list`, `veh.vehicle-search`, `veh.vehicle-create` and
 * `crm.vehicle-link` — nothing in this flow invents a request shape. The
 * adapters are the P1-27 authorities (`lib/customers/*`, `features/crm`,
 * `features/vehicles`), consumed rather than copied: a second authority for
 * the same operation is the defect class this repository's gates exist to
 * prevent, and this flow genuinely depends on those modules — a reception
 * desk receiving a person and their car IS a CRM act followed by a vehicle
 * act, which is why the import direction is honest here where it would not be
 * between the CRM and Vehicle features themselves.
 *
 * ## One stated degradation, on screen (`G-CRM-PHONE`)
 *
 * Customer search by PHONE NUMBER is not supported by the platform's customer
 * directory (remediation `R7` is open with the Backend). The first thing a
 * receptionist will try is the caller's phone number, so the search step SAYS
 * the capability is missing, beside the boxes where the number would be typed
 * — in both languages — instead of silently returning nothing. No disabled
 * phone box is offered: a control that cannot work advertises a capability
 * the product does not have.
 *
 * ## The handoff is truthful about the wizard's existence
 *
 * `checkInAvailable` says whether the check-in route is mounted. It is TRUE
 * today — `P1-28-FE-007` landed — so the final step links to the wizard,
 * carrying the pair, and the wizard pre-selects both rather than asking the
 * operator to search again for what they just recorded. When the prop is false
 * the step states that check-in is not available instead of rendering a link
 * that would 404; the pair is still fully usable, because the customer and
 * vehicle pages it links to are real.
 */

/** The customer this flow settled on, however it was reached. */
export interface ChosenCustomer {
  readonly id: string;
  readonly displayName: string;
  readonly displayNumber: string | null;
  /** Null when the choice came from a duplicate-name row, which carries none. */
  readonly partyType: string | null;
}

export function toChosenCustomer(selected: SelectedCustomer): ChosenCustomer {
  return {
    id: selected.id,
    displayName: selected.displayName,
    displayNumber: selected.displayNumber,
    partyType: selected.partyType,
  };
}

/** How the relationship step concluded. `null` while it has not. */
export type LinkOutcome = 'recorded' | 'already-linked' | 'skipped' | 'not-permitted';

export interface WalkInIntakeScreenProps {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `crm.customer.create` — gates the two create-customer paths. */
  readonly canCreateCustomer: boolean;
  /** `veh.vehicle.read` — gates the search across all vehicles. */
  readonly canSearchVehicles: boolean;
  /** `veh.vehicle.manage` — gates registering a new vehicle. */
  readonly canCreateVehicle: boolean;
  /** `crm.customer.vehicle.manage` — gates recording the relationship. */
  readonly canLinkVehicle: boolean;
  /**
   * Whether the check-in wizard route is mounted at `CHECK_IN_WIZARD_PATH`.
   * True since `P1-28-FE-007` landed; the false branch keeps the screen honest
   * for any surface that renders it without the route, and never links to a 404.
   */
  readonly checkInAvailable: boolean;
}

type Step = 'customer' | 'vehicle' | 'link' | 'done';

export function WalkInIntakeScreen({
  locale,
  messages,
  canCreateCustomer,
  canSearchVehicles,
  canCreateVehicle,
  canLinkVehicle,
  checkInAvailable,
}: WalkInIntakeScreenProps) {
  const [customer, setCustomer] = useState<ChosenCustomer | null>(null);
  const [vehicle, setVehicle] = useState<ChosenVehicle | null>(null);
  const [linkOutcome, setLinkOutcome] = useState<LinkOutcome | null>(null);

  /*
   * The step is DERIVED, not stored. A stored step and a stored choice can
   * disagree — a cleared customer with a step still saying "vehicle" renders a
   * vehicle list for nobody — and a derivation cannot.
   */
  const step: Step =
    customer === null
      ? 'customer'
      : vehicle === null
        ? 'vehicle'
        : linkOutcome === null
          ? 'link'
          : 'done';

  const chooseVehicle = (chosen: ChosenVehicle) => {
    setVehicle(chosen);
    // A vehicle picked from the customer's own list is already on record
    // against them — that is what the list MEANS — so the relationship step
    // has nothing to record and is answered rather than asked.
    setLinkOutcome(chosen.alreadyLinked ? 'already-linked' : null);
  };

  const changeCustomer = () => {
    // The vehicle and the relationship answer belong to the customer they
    // were chosen for. Keeping either across a customer change would hand the
    // wizard a pair nobody assembled.
    setCustomer(null);
    setVehicle(null);
    setLinkOutcome(null);
  };

  const changeVehicle = () => {
    setVehicle(null);
    setLinkOutcome(null);
  };

  const startOver = () => {
    setCustomer(null);
    setVehicle(null);
    setLinkOutcome(null);
  };

  return (
    <div className="flex max-w-content flex-col gap-4">
      <StepIndicator messages={messages} step={step} />

      {customer !== null ? (
        <ChosenCustomerSummary
          messages={messages}
          customer={customer}
          onChange={changeCustomer}
          changeable={step !== 'done'}
        />
      ) : null}

      {step === 'customer' ? (
        <CustomerStep
          locale={locale}
          messages={messages}
          canCreateCustomer={canCreateCustomer}
          onChosen={setCustomer}
        />
      ) : null}

      {step === 'vehicle' || step === 'link' ? (
        <IntakeVehicleStep
          locale={locale}
          messages={messages}
          customer={customer as ChosenCustomer}
          vehicle={vehicle}
          canSearchVehicles={canSearchVehicles}
          canCreateVehicle={canCreateVehicle}
          canLinkVehicle={canLinkVehicle}
          onVehicleChosen={chooseVehicle}
          onVehicleCleared={changeVehicle}
          onLinkOutcome={setLinkOutcome}
        />
      ) : null}

      {step === 'done' && customer !== null && vehicle !== null && linkOutcome !== null ? (
        <DoneStep
          locale={locale}
          messages={messages}
          customer={customer}
          vehicle={vehicle}
          linkOutcome={linkOutcome}
          checkInAvailable={checkInAvailable}
          onStartOver={startOver}
          onChangeVehicle={changeVehicle}
        />
      ) : null}
    </div>
  );
}

/**
 * Where the operator is in the flow. Three named stations — the relationship
 * question is part of the vehicle station rather than a fourth stop, because
 * for a vehicle picked off the customer's own list it never occurs at all.
 */
function StepIndicator({ messages, step }: { readonly messages: Messages; readonly step: Step }) {
  const stations = [
    { key: 'customer', labelKey: 'receptions.intake.step.customer', active: step === 'customer' },
    {
      key: 'vehicle',
      labelKey: 'receptions.intake.step.vehicle',
      active: step === 'vehicle' || step === 'link',
    },
    { key: 'done', labelKey: 'receptions.intake.step.handoff', active: step === 'done' },
  ] as const;

  return (
    <nav aria-label={translate(messages, 'receptions.intake.steps')}>
      <ol className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
        {stations.map((station, index) => (
          <li key={station.key} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-text-disabled">
                /
              </span>
            ) : null}
            <span
              {...(station.active ? { 'aria-current': 'step' } : {})}
              className={
                station.active
                  ? 'rounded-md bg-surface-subtle px-2 py-1 font-medium text-text-primary'
                  : 'px-2 py-1'
              }
            >
              {translate(messages, station.labelKey)}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The settled customer, named the same way every other surface names one. */
function ChosenCustomerSummary({
  messages,
  customer,
  onChange,
  changeable,
}: {
  readonly messages: Messages;
  readonly customer: ChosenCustomer;
  readonly onChange: () => void;
  readonly changeable: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-caption font-medium text-text-secondary">
          {translate(messages, 'receptions.intake.step.customer')}
        </span>
        <PartyLabel
          messages={messages}
          party={{
            partnerName: customer.displayName,
            partnerNumber: customer.displayNumber,
            partnerType: customer.partyType,
          }}
        />
      </div>
      {changeable ? (
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'receptions.intake.customer.change')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The stated phone degradation (`G-CRM-PHONE`).
 *
 * Rendered BESIDE the search controls — where a receptionist would type the
 * caller's number — not in a help page. It is a statement about a capability
 * the platform does not have yet, so it names the alternative that works
 * rather than apologising in general.
 */
function PhoneSearchNotice({ messages }: { readonly messages: Messages }) {
  return (
    <div
      role="note"
      data-testid="phone-search-notice"
      className="flex items-start gap-2 rounded-md border border-warning bg-surface p-3"
    >
      <span aria-hidden="true" className="mt-0.5 text-warning">
        <Icon name="reports" size={18} />
      </span>
      <div>
        <p className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.intake.phone.title')}
        </p>
        <p className="mt-0.5 text-caption text-text-secondary">
          {translate(messages, 'receptions.intake.phone.body')}
        </p>
      </div>
    </div>
  );
}

/**
 * Find or create the customer.
 *
 * The search is `CustomerSelector` — the one customer-search surface, reused,
 * so a customer reads identically here and on every vehicle screen. The
 * create paths are offered beside it, not behind a failed search: a
 * receptionist facing a brand-new customer knows they are new.
 */
function CustomerStep({
  locale,
  messages,
  canCreateCustomer,
  onChosen,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canCreateCustomer: boolean;
  readonly onChosen: (customer: ChosenCustomer) => void;
}) {
  const [mode, setMode] = useState<'search' | 'individual' | 'company'>('search');

  if (mode !== 'search') {
    return (
      <section
        aria-labelledby="intake-customer-create-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2
          id="intake-customer-create-heading"
          className="text-section-title font-medium text-text-primary"
        >
          {translate(
            messages,
            mode === 'individual'
              ? 'crm.customers.create.individualTitle'
              : 'crm.customers.create.companyTitle'
          )}
        </h2>
        <div className="mt-3">
          <IntakeCustomerCreate
            locale={locale}
            messages={messages}
            kind={mode}
            onChosen={onChosen}
            onBack={() => setMode('search')}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="intake-customer-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="intake-customer-heading" className="text-section-title font-medium text-text-primary">
        {translate(messages, 'receptions.intake.customer.heading')}
      </h2>

      <CustomerSelector
        locale={locale}
        messages={messages}
        name="intakeCustomerId"
        labelKey="receptions.intake.customer.selectorLabel"
        value={null}
        onChange={(selected) => {
          if (selected !== null) onChosen(toChosenCustomer(selected));
        }}
        required
        attempt={0}
      />

      <PhoneSearchNotice messages={messages} />

      {canCreateCustomer ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-caption text-text-secondary">
            {translate(messages, 'receptions.intake.customer.createOffer')}
          </span>
          <button
            type="button"
            onClick={() => setMode('individual')}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'crm.customers.create.individualTitle')}
          </button>
          <button
            type="button"
            onClick={() => setMode('company')}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'crm.customers.create.companyTitle')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The completed intake.
 *
 * The pair is stated, the relationship answer is stated, and the way onward is
 * truthful: a link to the wizard when the wizard exists, and a plain sentence
 * when it does not — never a link that 404s.
 */
function DoneStep({
  locale,
  messages,
  customer,
  vehicle,
  linkOutcome,
  checkInAvailable,
  onStartOver,
  onChangeVehicle,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customer: ChosenCustomer;
  readonly vehicle: ChosenVehicle;
  readonly linkOutcome: LinkOutcome;
  readonly checkInAvailable: boolean;
  readonly onStartOver: () => void;
  readonly onChangeVehicle: () => void;
}) {
  const LINK_OUTCOME_KEY: Record<LinkOutcome, string> = {
    recorded: 'receptions.intake.done.linkRecorded',
    'already-linked': 'receptions.intake.done.linkExisting',
    skipped: 'receptions.intake.done.linkSkipped',
    'not-permitted': 'receptions.intake.done.linkNotPermitted',
  };

  return (
    <section
      aria-labelledby="intake-done-heading"
      className="flex flex-col gap-4 rounded-lg border border-success bg-surface p-4"
    >
      <div role="status">
        <h2 id="intake-done-heading" className="text-section-title font-semibold text-text-primary">
          {translate(messages, 'receptions.intake.done.heading')}
        </h2>
        <p className="mt-1 text-body text-text-secondary">
          {translate(messages, 'receptions.intake.done.body')}
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.intake.step.customer')}
          </dt>
          <dd className="mt-0.5">
            <PartyLabel
              messages={messages}
              party={{
                partnerName: customer.displayName,
                partnerNumber: customer.displayNumber,
                partnerType: customer.partyType,
              }}
            />
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.intake.step.vehicle')}
          </dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-body text-text-primary">
            {vehicle.displayNumber ? (
              <code className="font-mono text-caption" dir="ltr">
                {vehicle.displayNumber}
              </code>
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'vehicles.column.noReference')}
              </span>
            )}
            {vehicle.vin ? (
              <span className="font-mono text-caption" dir="ltr">
                {vehicle.vin}
              </span>
            ) : (
              <span className="text-caption text-text-muted">
                {translate(messages, 'vehicles.column.noVin')}
              </span>
            )}
            {vehicle.modelYear !== null ? <span dir="ltr">{vehicle.modelYear}</span> : null}
          </dd>
        </div>
      </dl>

      <p className="text-caption text-text-secondary">
        {translateDynamic(messages, LINK_OUTCOME_KEY[linkOutcome])}
      </p>

      {checkInAvailable ? (
        <div>
          <Link
            href={checkInWizardHref(locale, { customerId: customer.id, vehicleId: vehicle.id })}
            className="inline-block rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary"
          >
            {translate(messages, 'receptions.intake.done.continue')}
          </Link>
        </div>
      ) : (
        // Stating the wizard's absence is the honest alternative to a link
        // that answers 404.
        <p
          role="note"
          className="rounded-md border border-border bg-surface-subtle p-3 text-body text-text-secondary"
        >
          {translate(messages, 'receptions.intake.done.wizardPending')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/${locale}/crm/customers/${customer.id}`}
          className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary"
        >
          {translate(messages, 'receptions.intake.done.openCustomer')}
        </Link>
        <Link
          href={`/${locale}/vehicles/${vehicle.id}`}
          className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary"
        >
          {translate(messages, 'receptions.intake.done.openVehicle')}
        </Link>
        <button
          type="button"
          onClick={onChangeVehicle}
          className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'receptions.intake.vehicle.change')}
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'receptions.intake.done.startOver')}
        </button>
      </div>
    </section>
  );
}
