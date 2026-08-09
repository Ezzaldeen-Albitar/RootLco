'use client';

import { useActionState, useCallback, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import type { ActionState } from '@/lib/forms/action-result';
import { changeVehicleStatusAction, updateVehicleAction } from '../profile-api';
import { MAX_COLOR, MAX_DISPLAY_NUMBER, MAX_VIN_INPUT } from '../contract';
import {
  allowedLifecycleTargets,
  allowedWorkshopTargets,
  isFrozen,
  isTerminal,
  labelFor,
  type VehicleDetail,
} from '../profile-contract';
import { localToday } from '../history-contract';
import type { EvProfileState } from '../relations-api';
import { EvProfileSection, RelationshipsSection } from './VehicleRelationsSections';
import { VehicleDocumentsSection } from './VehicleDocumentsSection';
import { VehicleAttributeHistorySection } from './VehicleAttributeHistorySection';
import type { DocumentsState } from '../documents-api';
import { OdometerSection, OwnershipSection, PlateSection } from './VehicleHistorySections';
import { VinField } from './VinField';

/**
 * Vehicle profile (`FE-019`).
 *
 * ## A merged vehicle is shown, and shown as frozen
 *
 * `veh.vehicle-read` returns merged vehicles deliberately — the update route
 * treats them as existing-but-frozen (409, not 404), so hiding one would report
 * a vehicle that live work orders still reference as missing. Every write
 * control is withdrawn and the reason is stated, rather than left to fail.
 *
 * ## Two permissions, two panels
 *
 * Editing the description needs `veh.vehicle.manage`; changing the lifecycle
 * needs `veh.vehicle.status.manage`. Showing both to anyone who holds one would
 * be wrong in the direction that always matters.
 *
 * ## `If-Match` is not sent
 *
 * No vehicle operation is `versionGuarded`, so the header is ignored at best and
 * a 428 at worst. `recordVersion` is displayed as a record fact, and the screen
 * states plainly that a concurrent edit by another operator is not detected —
 * because it is not, and implying otherwise would be worse than saying so.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicle: VehicleDetail;
  readonly canEdit: boolean;
  readonly canChangeStatus: boolean;
  /** `veh.vehicle.relationship.manage` — a third, separate capability. */
  readonly canManageRelationships: boolean;
  /** `crm.customer.vehicle.manage` — a CRM capability, held independently. */
  readonly canLinkCustomer: boolean;
  /**
   * `veh.vehicle.odometer.record` — its own code, implied by none of the others.
   *
   * A technician reading a dashboard at check-in records mileage without being
   * able to edit the vehicle, which is why the platform kept it separate. The
   * odometer form asked for none of this and rendered for every reader
   * (`P1-27-SEC-001`).
   */
  readonly canRecordOdometer: boolean;
  /** Read on the server, because a 404 here is an ordinary state, not an error. */
  readonly evProfile: EvProfileState;
  /** `shared.document.manage` — a manage capability from a DIFFERENT module. */
  readonly canListDocuments: boolean;
  readonly documents: DocumentsState;
}

/**
 * Every profile section.
 *
 * The last one is `history`, not `timeline`. `veh.vehicle-history` reads
 * `veh.vehicle_attribute_history` — field-level changes to the vehicle master —
 * and the vehicle schema has no equivalent of `crm.timeline_events`. A tab
 * labelled "timeline" would promise a single event stream that does not exist
 * and would disagree with the five sections beside it, each of which has its own
 * operation.
 */
const SECTIONS = [
  'overview',
  'ownership',
  'plates',
  'odometer',
  'ev',
  'relationships',
  'documents',
  'history',
] as const;
type Section = (typeof SECTIONS)[number];

/** Sections with a screen today. The rest say so rather than being absent. */
const BUILT: readonly Section[] = SECTIONS;

export function VehicleProfileScreen({
  locale,
  messages,
  vehicle,
  canEdit,
  canChangeStatus,
  canManageRelationships,
  canLinkCustomer,
  canRecordOdometer,
  evProfile,
  canListDocuments,
  documents,
}: Props) {
  // TWO predicates, because the server has two rules. `frozen` (merged) refuses
  // every write; `terminal` (merged or scrapped) refuses the four that ADD to a
  // vehicle's registration or equipment. See `profile-contract.ts` for the
  // writer-by-writer table this was read from.
  const frozen = isFrozen(vehicle);
  const terminal = isTerminal(vehicle);
  const [section, setSection] = useState<Section>('overview');

  // The EV profile and the documents list are read on the SERVER and handed to
  // this component as props, so a save cannot be reflected by re-running a
  // client fetch — there is none. `router.refresh()` re-runs the page's own read,
  // which is the only thing that can show what was just stored.
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);

  // Resolved ONCE, from the operator's own clock, and threaded into every
  // section. Each section computing its own would let a page open before
  // midnight disagree with itself after it.
  const [today] = useState(() => localToday(new Date()));

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ProfileHeader locale={locale} messages={messages} vehicle={vehicle} frozen={frozen} />

      <nav aria-label={translate(messages, 'vehicles.profile.sections')}>
        <ul className="flex flex-wrap gap-1 border-b border-border">
          {SECTIONS.map((name) => {
            const active = name === section;
            const built = BUILT.includes(name);
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => setSection(name)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'rounded-t-md px-3 py-2 text-body',
                    active
                      ? 'border-b-2 border-primary font-medium text-text-primary'
                      : 'text-text-secondary',
                  ].join(' ')}
                >
                  {translateDynamic(messages, `vehicles.profile.section.${name}`)}
                  {built ? null : (
                    // An unbuilt section that is simply absent leaves an operator
                    // unable to tell "not built" from "hidden from me".
                    <span className="ms-1 text-caption text-text-muted">
                      {translate(messages, 'nav.planned')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {section === 'ownership' ? (
        <OwnershipSection
          locale={locale}
          messages={messages}
          vehicleId={vehicle.id}
          today={today}
          // `terminal` as well as the capability: `requireWritableVehicle`
          // (`vehicle-registration-service.ts:194`) refuses a merged OR SCRAPPED
          // vehicle with a 409, so offering the transfer form on one is offering
          // an action that can only fail.
          canManageRelationships={canManageRelationships && !terminal}
        />
      ) : null}
      {section === 'plates' ? (
        <PlateSection
          locale={locale}
          messages={messages}
          vehicleId={vehicle.id}
          today={today}
          // `veh.vehicle.manage`, and `terminal` for the same reason ownership
          // carries it — the same `requireWritableVehicle` call: a merged or
          // scrapped vehicle answers 409.
          canEdit={canEdit && !terminal}
        />
      ) : null}
      {section === 'odometer' ? (
        // No `today`: odometer readings are timestamped observations, not dated
        // intervals, so there is nothing here to be "in force".
        // `frozen`, NOT `terminal` — and this one is a PRODUCT DECISION, not a
        // server mirror. An earlier comment here said the refusal was "the merge
        // freeze at the database"; there is no such refusal.
        // `vehicle-odometer-service.ts` has no lifecycle guard, and
        // `tg_vehicles_merge_guard` is `BEFORE UPDATE ON veh.vehicles`, so it
        // cannot fire for an INSERT into `veh.odometer_readings` — the server
        // accepts a reading against a merged vehicle.
        //
        // It is withheld anyway: a merged vehicle is a duplicate folded into a
        // survivor, and a reading recorded against the tombstone is a reading
        // nobody will find. A scrapped vehicle's FINAL reading is different, and
        // stays available. Owner policy, stated as policy.
        <OdometerSection
          locale={locale}
          messages={messages}
          vehicleId={vehicle.id}
          canRecord={canRecordOdometer && !frozen}
        />
      ) : null}
      {section === 'ev' ? (
        <EvProfileSection
          locale={locale}
          messages={messages}
          state={evProfile}
          powertrainCategory={vehicle.powertrainCategory}
          // `terminal` as well as the capability, like plates and ownership
          // beside it. Verified against the server rather than assumed by
          // analogy: `vehicle-lifecycle-service.ts:68-74` throws `ERR-RES-002`
          // for a merged OR SCRAPPED vehicle, so the form could only ever fail
          // there. This docblock said exactly that while the gate it described
          // tested `merged` alone — the fix is the gate, not the sentence.
          canEdit={canEdit && !terminal}
          vehicleId={vehicle.id}
          // The profile is read on the SERVER, so a save cannot be reflected by
          // re-running a client fetch. A router refresh re-runs the page's own
          // read, which is the only thing that can show the saved value.
          onSaved={refresh}
        />
      ) : null}
      {section === 'relationships' ? (
        <RelationshipsSection
          locale={locale}
          messages={messages}
          vehicleId={vehicle.id}
          today={today}
          // THREE different answers, because the three writers behind this one
          // section have three different lifecycle rules:
          //
          //   ADD an authorised party — `vehicle-relations-service.ts:171` calls
          //     `requireWritableVehicle`, so merged and scrapped both 409.
          //   RETIRE one — `retireAuthorizedParty` (:104-152) calls it NOWHERE,
          //     and `veh.vehicle_relationships` carries no lifecycle trigger, so
          //     the server accepts it on a scrapped vehicle. Taking a driver off
          //     a written-off car is legitimate cleanup and stays available.
          //   LINK a customer — `customer-identity-service.ts:302` has no
          //     lifecycle guard either. `!frozen` here is a PRODUCT decision
          //     about a merged duplicate, not a server mirror; see below.
          canManage={canManageRelationships && !terminal}
          canRetire={canManageRelationships}
          canLinkCustomer={canLinkCustomer && !frozen}
        />
      ) : null}
      {section === 'documents' ? (
        <VehicleDocumentsSection
          locale={locale}
          messages={messages}
          state={documents}
          canListDocuments={canListDocuments}
        />
      ) : null}
      {section === 'history' ? (
        <VehicleAttributeHistorySection
          locale={locale}
          messages={messages}
          vehicleId={vehicle.id}
        />
      ) : null}
      {!BUILT.includes(section) ? (
        <p role="status" className="px-2 py-8 text-center text-body text-text-secondary">
          {translate(messages, 'crm.customers.profile.sectionPending')}
        </p>
      ) : null}

      {section !== 'overview' ? null : (
        <VehicleOverviewSection
          locale={locale}
          messages={messages}
          vehicle={vehicle}
          frozen={frozen}
          terminal={terminal}
          canEdit={canEdit}
          canChangeStatus={canChangeStatus}
        />
      )}
    </div>
  );
}

function VehicleOverviewSection({
  locale,
  messages,
  vehicle,
  frozen,
  terminal,
  canEdit,
  canChangeStatus,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicle: VehicleDetail;
  readonly frozen: boolean;
  readonly terminal: boolean;
  readonly canEdit: boolean;
  readonly canChangeStatus: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <Overview messages={messages} vehicle={vehicle} />

      {frozen ? (
        // Nothing editable. Said once, here, instead of letting six controls
        // each discover their own 409.
        <p
          role="status"
          className="rounded-lg border border-border bg-surface p-4 text-body text-text-secondary"
        >
          {translate(messages, 'vehicles.profile.frozenNote')}
        </p>
      ) : (
        <>
          {/*
            A SCRAPPED vehicle is not frozen. Its details can still be corrected
            — `vehicle-write-service.ts:119` guards `merged` alone — so the edit
            panel stays. Its STATUS cannot move: `LIFECYCLE_TRANSITIONS.scrapped`
            is `[]`, and a terminal vehicle's workshop axis is pinned to `none`
            by `ck_vehicles_terminal_workshop`, so every control on the status
            panel would answer 409. It is withdrawn, with the reason said once.
          */}
          {canEdit ? <EditPanel locale={locale} messages={messages} vehicle={vehicle} /> : null}
          {canChangeStatus && !terminal ? (
            <StatusPanel messages={messages} vehicle={vehicle} />
          ) : null}
          {/*
            UNGATED, like the frozen note above it. This carried a
            `canChangeStatus &&` conjunct, which is a permission governing NONE
            of the four surfaces it explains — so an operator holding
            `veh.vehicle.manage` and `veh.vehicle.relationship.manage` but not
            status-manage lost the plate form, the transfer, the authorise form
            and the electric-drive save with no explanation anywhere. That is
            the silence the note exists to prevent.
          */}
          {terminal ? (
            <p
              role="status"
              className="rounded-lg border border-border bg-surface p-4 text-body text-text-secondary"
            >
              {translate(messages, 'vehicles.profile.terminalNote')}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function ProfileHeader({
  locale,
  messages,
  vehicle,
  frozen,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicle: VehicleDetail;
  readonly frozen: boolean;
}) {
  const make = labelFor(vehicle.makeId, vehicle.makeName);
  const model = labelFor(vehicle.modelId, vehicle.modelName);

  // "Toyota Camry 2019" when it can be assembled, and the reference otherwise.
  // Never a uuid, and never a half-title like "2019" on its own.
  const title =
    make.kind === 'value' || model.kind === 'value'
      ? [make.kind === 'value' ? make.name : null, model.kind === 'value' ? model.name : null]
          .filter(Boolean)
          .join(' ')
      : (vehicle.displayNumber ?? vehicle.vin ?? translate(messages, 'vehicles.profile.untitled'));

  return (
    <header className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-page-title font-semibold text-text-primary">{title}</h1>
        {vehicle.modelYear === null ? null : (
          <span className="text-body text-text-secondary" dir="ltr">
            {vehicle.modelYear}
          </span>
        )}
        {vehicle.displayNumber ? (
          <code className="font-mono text-caption text-text-secondary" dir="ltr">
            {vehicle.displayNumber}
          </code>
        ) : null}
        {frozen ? (
          <span className="rounded-md bg-warning/15 px-2 py-0.5 text-caption text-warning">
            {translate(messages, 'vehicles.profile.frozenBadge')}
          </span>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-4">
        <Fact
          messages={messages}
          labelKey="crm.customers.column.status"
          value={translateDynamic(messages, `vehicles.lifecycle.${vehicle.lifecycleStatus}`)}
        />
        <Fact
          messages={messages}
          labelKey="vehicles.column.workshop"
          value={translateDynamic(messages, `vehicles.workshop.${vehicle.workshopStatus}`)}
        />
        <Fact
          messages={messages}
          labelKey="vehicles.column.powertrain"
          value={translateDynamic(messages, `vehicles.powertrain.${vehicle.powertrainCategory}`)}
        />
        <Fact
          messages={messages}
          labelKey="vehicles.profile.recordVersion"
          value={<span dir="ltr">{vehicle.recordVersion}</span>}
        />
      </dl>

      {vehicle.mergedIntoId ? (
        <p className="mt-3 text-body text-text-secondary" lang={locale}>
          {translate(messages, 'vehicles.profile.mergedInto')}{' '}
          <code className="font-mono text-caption" dir="ltr">
            {vehicle.mergedIntoId}
          </code>
        </p>
      ) : null}
    </header>
  );
}

function Overview({
  messages,
  vehicle,
}: {
  readonly messages: Messages;
  readonly vehicle: VehicleDetail;
}) {
  const catalogue = [
    ['vehicles.column.make', labelFor(vehicle.makeId, vehicle.makeName)],
    ['vehicles.column.model', labelFor(vehicle.modelId, vehicle.modelName)],
    ['vehicles.column.trim', labelFor(vehicle.trimId, vehicle.trimName)],
    ['vehicles.column.bodyType', labelFor(vehicle.bodyTypeId, vehicle.bodyTypeName)],
    [
      'vehicles.column.powertrainType',
      labelFor(vehicle.powertrainTypeId, vehicle.powertrainTypeName),
    ],
  ] as const;

  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
      <Fact
        messages={messages}
        labelKey="vehicles.column.vin"
        value={
          vehicle.vin ? (
            <span className="font-mono text-caption" dir="ltr">
              {vehicle.vin}
            </span>
          ) : (
            <Muted messages={messages} messageKey="vehicles.column.noVin" />
          )
        }
      />
      {catalogue.map(([labelKey, label]) => (
        <Fact
          key={labelKey}
          messages={messages}
          labelKey={labelKey}
          value={
            label.kind === 'value' ? (
              label.name
            ) : (
              // Two DIFFERENT facts. A null name beside a non-null id means the
              // catalogue row is not visible to this caller; a null id means
              // nothing was ever recorded. The contract offers no flag, so this
              // is the most that can be said honestly.
              <Muted
                messages={messages}
                messageKey={
                  label.kind === 'unset'
                    ? 'vehicles.profile.notRecorded'
                    : 'vehicles.profile.catalogueNotVisible'
                }
              />
            )
          }
        />
      ))}
      <Fact
        messages={messages}
        labelKey="vehicles.create.color"
        value={
          vehicle.color ?? <Muted messages={messages} messageKey="vehicles.profile.notRecorded" />
        }
      />
    </dl>
  );
}

/** `veh.vehicle.manage`. Only changed fields are sent. */
function EditPanel({
  locale,
  messages,
  vehicle,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicle: VehicleDetail;
}) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>({
    vin: vehicle.vin ?? '',
    color: vehicle.color ?? '',
    displayNumber: vehicle.displayNumber ?? '',
    modelYear: vehicle.modelYear === null ? '' : String(vehicle.modelYear),
  });

  const [state, submit, pending] = useActionState(
    async (previous: ActionState) => {
      // Only what actually changed. An absent field leaves the column untouched
      // and an explicit null CLEARS it, so sending every field would wipe the
      // ones the operator did not touch.
      const changed: Record<string, string | number | null> = {};

      const original: Record<string, string> = {
        vin: vehicle.vin ?? '',
        color: vehicle.color ?? '',
        displayNumber: vehicle.displayNumber ?? '',
        modelYear: vehicle.modelYear === null ? '' : String(vehicle.modelYear),
      };

      for (const [key, value] of Object.entries(values)) {
        const trimmed = value.trim();
        if (trimmed === (original[key] ?? '')) continue;
        if (trimmed === '') {
          // Cleared deliberately — an explicit null, which the route accepts and
          // which is a different request from omitting the field.
          changed[key] = null;
        } else if (key === 'modelYear') {
          if (!/^\d+$/.test(trimmed)) continue;
          changed[key] = Number(trimmed);
        } else {
          changed[key] = trimmed;
        }
      }

      return updateVehicleAction(vehicle.id, changed, previous);
    },
    { status: 'idle' } as ActionState
  );

  const set = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  return (
    <form action={submit} className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-section-title font-medium text-text-primary">
        {translate(messages, 'vehicles.profile.editHeading')}
      </h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <VinField
          messages={messages}
          id={`${formId}-vin`}
          value={values.vin ?? ''}
          onChange={(v) => set('vin', v)}
          excludeVehicleId={vehicle.id}
          maxLength={MAX_VIN_INPUT}
        />
        <Text
          messages={messages}
          id={`${formId}-number`}
          name="displayNumber"
          labelKey="vehicles.column.reference"
          value={values.displayNumber ?? ''}
          onChange={set}
          maxLength={MAX_DISPLAY_NUMBER}
        />
        <Text
          messages={messages}
          id={`${formId}-color`}
          name="color"
          labelKey="vehicles.create.color"
          value={values.color ?? ''}
          onChange={set}
          maxLength={MAX_COLOR}
        />
        <Text
          messages={messages}
          id={`${formId}-year`}
          name="modelYear"
          labelKey="vehicles.column.modelYear"
          value={values.modelYear ?? ''}
          onChange={set}
          maxLength={4}
        />
      </div>

      <p className="mt-3 text-caption text-text-muted" lang={locale}>
        {/* Said out loud. No vehicle operation is versionGuarded, so a
            concurrent edit by another operator is NOT detected. */}
        {translate(messages, 'vehicles.profile.noConcurrencyNote')}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-text-inverse disabled:opacity-60"
        >
          {pending ? translate(messages, 'form.pending') : translate(messages, 'form.submit')}
        </button>
        <Outcome messages={messages} state={state} />
      </div>
    </form>
  );
}

/** `veh.vehicle.status.manage` — a different permission from the edit above. */
function StatusPanel({
  messages,
  vehicle,
}: {
  readonly messages: Messages;
  readonly vehicle: VehicleDetail;
}) {
  const formId = useId();
  const [state, submit, pending] = useActionState(
    changeVehicleStatusAction.bind(null, vehicle.id),
    { status: 'idle' } as ActionState
  );
  /*
   * `NEW-FE-01`, fourth site. Both selects were plain `defaultValue=""` with no
   * `onChange`, so nothing held what the operator picked: React resets the form
   * once the action settles, the choice reverted to "leave unchanged", and a
   * resubmit sent NOTHING — which `changeVehicleStatusAction` answers with
   * `vehicles.profile.chooseAStatus` rather than retrying the move that failed.
   *
   * The operator sees "choose a status" after choosing a status.
   */
  const [lifecycle, setLifecycle] = useState('');
  const [workshop, setWorkshop] = useState('');

  return (
    <form action={submit} className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-section-title font-medium text-text-primary">
        {translate(messages, 'vehicles.profile.statusHeading')}
      </h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${formId}-lifecycle`} className="block text-caption text-text-secondary">
            {translate(messages, 'crm.customers.column.status')}
          </label>
          <select
            key={`lifecycle-${state.attempt ?? 0}`}
            id={`${formId}-lifecycle`}
            name="lifecycleStatus"
            defaultValue={lifecycle}
            onChange={(event) => setLifecycle(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
          >
            <option value="">{translate(messages, 'vehicles.profile.leaveUnchanged')}</option>
            {/*
              Driven by the transition GRAPH, not by the whole vocabulary.

              This listed every status except `merged`, from wherever the vehicle
              was, so `draft → inactive` and `inactive → draft` were both on the
              menu and both refused with `invalid_transition`
              (`vehicle-lifecycle.ts:227-233`). The `merged` filter that used to
              live here is gone because the graph already omits `merged` from
              every row — one statement of the rule, not two.

              The refusal was also invisible, which is what made it worth fixing
              rather than tolerating: the platform publishes field detail as
              `violations` and the client reads `errors` (`P1-27-INT-028`), so
              `Outcome` showed only "The form could not be saved." An operator
              choosing a plausible-looking option learned nothing.
            */}
            {allowedLifecycleTargets(vehicle).map((status) => (
              <option key={status} value={status}>
                {translateDynamic(messages, `vehicles.lifecycle.${status}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${formId}-workshop`} className="block text-caption text-text-secondary">
            {translate(messages, 'vehicles.column.workshop')}
          </label>
          <select
            key={`workshop-${state.attempt ?? 0}`}
            id={`${formId}-workshop`}
            name="workshopStatus"
            defaultValue={workshop}
            onChange={(event) => setWorkshop(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
          >
            <option value="">{translate(messages, 'vehicles.profile.leaveUnchanged')}</option>
            {/* Same rule on the workshop axis (`vehicle-lifecycle.ts:68-74`). */}
            {allowedWorkshopTargets(vehicle).map((status) => (
              <option key={status} value={status}>
                {translateDynamic(messages, `vehicles.workshop.${status}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border px-4 py-2 text-body text-text-primary disabled:opacity-60"
        >
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'vehicles.profile.applyStatus')}
        </button>
        <Outcome messages={messages} state={state} />
      </div>
    </form>
  );
}

function Outcome({
  messages,
  state,
}: {
  readonly messages: Messages;
  readonly state: ActionState;
}) {
  if (state.status === 'idle' || !state.messageKey) return null;
  const failed = state.status !== 'success';
  return (
    <p
      role={failed ? 'alert' : 'status'}
      className={`text-body ${failed ? 'text-error' : 'text-success'}`}
    >
      {translateDynamic(messages, state.messageKey)}
      {state.correlationId ? (
        <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
      ) : null}
    </p>
  );
}

function Fact({
  messages,
  labelKey,
  value,
}: {
  readonly messages: Messages;
  readonly labelKey: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-caption text-text-secondary">{translateDynamic(messages, labelKey)}</dt>
      <dd className="text-body text-text-primary">{value}</dd>
    </div>
  );
}

function Muted({
  messages,
  messageKey,
}: {
  readonly messages: Messages;
  readonly messageKey: string;
}) {
  return <span className="text-text-muted">{translateDynamic(messages, messageKey)}</span>;
}

function Text({
  messages,
  id,
  name,
  labelKey,
  value,
  onChange,
  maxLength,
}: {
  readonly messages: Messages;
  readonly id: string;
  readonly name: string;
  readonly labelKey: string;
  readonly value: string;
  readonly onChange: (name: string, value: string) => void;
  readonly maxLength: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-caption text-text-secondary">
        {translateDynamic(messages, labelKey)}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        dir="auto"
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        maxLength={maxLength}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
      />
    </div>
  );
}
