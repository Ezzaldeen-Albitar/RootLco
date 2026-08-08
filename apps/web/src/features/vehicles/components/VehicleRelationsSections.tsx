'use client';

import { useCallback, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { RecordForm } from '@/components/forms/RecordForm';
import { PartyLabel } from '@/components/party/PartyLabel';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import {
  authorizePartyAction,
  linkCustomerAction,
  listRelationships,
  retirePartyAction,
  setEvProfileAction,
  type EvProfileState,
} from '../relations-api';
import { intervalState } from '../history-contract';
import {
  AUTHORIZED_ACTIONS,
  EV_KINDS,
  LINKABLE_ROLES,
  MAX_CHARGE_PORT,
  SCOPED_ROLE,
  canHaveEvProfile,
  scopeState,
  validateScope,
  type EvProfile,
  type VehicleRelationship,
} from '../relations-contract';

/**
 * EV/hybrid profile (`FE-024`) and vehicle-customer relationships (`FE-025`).
 *
 * Both sections exist mainly to avoid saying something false:
 *
 * - A 404 on the EV profile is the ordinary state of a petrol car, not a fault.
 * - A null `allowedActions` means "this role cannot carry a scope", not
 *   "this person has no permissions" — and it is null for six roles out of seven.
 */

/**
 * The electric-drive write (`FE-024`), written once and rendered in two states.
 *
 * `veh.vehicle-ev-profile-set` is a REPLACE — "set (create or replace)" — so
 * every field is sent every time and an omitted one is cleared. The form is
 * therefore seeded from the current profile when one exists, and does NOT clear
 * on success: what was just saved is the current state, and blanking it would
 * show an empty form for a profile that exists.
 */
function EvProfileForm({
  messages,
  vehicleId,
  current,
  onSaved,
}: {
  readonly messages: Messages;
  readonly vehicleId: string;
  readonly current?: EvProfile;
  readonly onSaved?: () => void;
}) {
  return (
    <RecordForm
      messages={messages}
      titleKey="vehicles.ev.record"
      submitKey="vehicles.ev.record"
      action={setEvProfileAction.bind(null, vehicleId)}
      clearOnSuccess={false}
      {...(onSaved ? { onRecorded: onSaved } : {})}
      {...(current
        ? {
            initialValues: {
              evKind: current.evKind,
              // Strings throughout. The capacity is `numeric` read as text and
              // any arithmetic here would reintroduce the loss that cast avoids.
              usableCapacityKwh: current.usableCapacityKwh ?? '',
              chargePortType: current.chargePortType ?? '',
              ...(current.highVoltageWarning ? { highVoltageWarning: 'on' } : {}),
            },
          }
        : {})}
      fields={[
        {
          name: 'evKind',
          kind: 'select',
          labelKey: 'vehicles.ev.kind',
          required: true,
          options: EV_KINDS,
          optionKeyPrefix: 'vehicles.evKind.',
        },
        {
          name: 'usableCapacityKwh',
          kind: 'number',
          labelKey: 'vehicles.ev.capacity',
          min: 0,
          step: 'any',
          hintKey: 'vehicles.ev.capacityHint',
        },
        {
          name: 'chargePortType',
          kind: 'text',
          labelKey: 'vehicles.ev.port',
          maxLength: MAX_CHARGE_PORT,
        },
        {
          name: 'highVoltageWarning',
          kind: 'checkbox',
          labelKey: 'vehicles.ev.highVoltage',
        },
      ]}
    />
  );
}

/** `FE-024`. Read on the server; this renders whichever of four states came back. */
export function EvProfileSection({
  locale,
  messages,
  state,
  powertrainCategory,
  canEdit,
  vehicleId,
  onSaved,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly state: EvProfileState;
  readonly powertrainCategory: string;
  readonly canEdit: boolean;
  readonly vehicleId: string;
  readonly onSaved?: () => void;
}) {
  if (state.status === 'none') {
    // The common case, and it is not an error. Which sentence to show depends on
    // whether an EV profile is even applicable to this vehicle.
    return (
      <section className="rounded-lg border border-border bg-surface p-4" aria-live="polite">
        <p className="text-body text-text-secondary" lang={locale}>
          {translate(
            messages,
            canHaveEvProfile(powertrainCategory)
              ? 'vehicles.ev.notRecordedYet'
              : 'vehicles.ev.notApplicable'
          )}
        </p>
        {canEdit && canHaveEvProfile(powertrainCategory) ? (
          <>
            <p className="mt-2 text-caption text-text-muted">
              {translate(messages, 'vehicles.ev.canRecord')}
            </p>
            {/* The copy above promised this for the whole of P1-27 while the
                save path had no call site. Wired here so the sentence is true. */}
            <div className="mt-3">
              <EvProfileForm
                messages={messages}
                vehicleId={vehicleId}
                {...(onSaved ? { onSaved } : {})}
              />
            </div>
          </>
        ) : null}
      </section>
    );
  }

  if (state.status !== 'ok') {
    return (
      <section className="rounded-lg border border-border bg-surface p-4" role="alert">
        <p className="text-body text-error">
          {/* A failed read is NOT "no profile". Collapsing them would tell an
              operator a battery-electric vehicle has no battery recorded. */}
          {translate(messages, 'vehicles.ev.readFailed')}
        </p>
        {state.correlationId ? (
          <code className="mt-1 block font-mono text-caption text-text-muted">
            {state.correlationId}
          </code>
        ) : null}
      </section>
    );
  }

  const profile = state.profile;

  return (
    <section
      aria-labelledby="vehicle-ev-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="vehicle-ev-heading" className="text-section-title font-medium text-text-primary">
        {translate(messages, 'vehicles.ev.heading')}
      </h2>

      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'vehicles.ev.kind')}
          </dt>
          <dd className="text-body text-text-primary">
            {translateDynamic(messages, `vehicles.evKind.${profile.evKind}`)}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'vehicles.ev.capacity')}
          </dt>
          <dd className="text-body text-text-primary" dir="ltr">
            {/* `numeric` as a string, with its unit appended. No arithmetic and
                no reformatting — the value is shown exactly as stored. */}
            {profile.usableCapacityKwh === null ? (
              <span className="text-text-muted">
                {translate(messages, 'vehicles.profile.notRecorded')}
              </span>
            ) : (
              `${profile.usableCapacityKwh} kWh`
            )}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'vehicles.ev.chargePort')}
          </dt>
          <dd className="text-body text-text-primary">
            {profile.chargePortType ?? (
              <span className="text-text-muted">
                {translate(messages, 'vehicles.profile.notRecorded')}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {profile.highVoltageWarning ? (
        // A safety flag the workshop set on this vehicle. It is reported exactly
        // as recorded — nothing here infers it from the battery size or the
        // powertrain, because a safety claim nobody made is worse than none.
        <p role="status" className="mt-3 rounded-md bg-warning/15 p-2 text-body text-warning">
          {translate(messages, 'vehicles.ev.highVoltage')}
        </p>
      ) : null}

      <p className="mt-3 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'vehicles.ev.scopeNote')}
      </p>

      {canEdit ? (
        // Seeded from the profile above, because the operation REPLACES: a blank
        // form would clear the capacity and the port the moment somebody changed
        // only the drive kind.
        <div className="mt-4">
          <EvProfileForm
            messages={messages}
            vehicleId={vehicleId}
            current={profile}
            {...(onSaved ? { onSaved } : {})}
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * `FE-025` — authorize a customer as a scoped party.
 *
 * `veh.vehicle-authorized-party-add` shipped registered, permission-covered and
 * called from nowhere, for the same reason ownership transfer did: the body
 * wants a `partnerId` and there was no way to choose a customer.
 *
 * The scope is a set of checkboxes over the six actions
 * `veh.valid_authorization_scope` admits, and no seventh is offered — the
 * constraint would reject it, and the operator could not act on the rejection.
 * Nothing here grants ownership: an authorized party is never the legal owner,
 * and the vocabulary contains no action that says otherwise.
 */
function AuthorizePartyForm({
  locale,
  messages,
  vehicleId,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicleId: string;
  readonly onRecorded: () => void;
}) {
  const [customer, setCustomer] = useState<SelectedCustomer | null>(null);
  const [actions, setActions] = useState<readonly string[]>([]);

  const toggle = (action: string) =>
    setActions((current) =>
      current.includes(action) ? current.filter((a) => a !== action) : [...current, action]
    );

  return (
    <RecordForm
      messages={messages}
      titleKey="vehicles.relationships.authorize"
      submitKey="vehicles.relationships.authorize"
      onRecorded={() => {
        setCustomer(null);
        setActions([]);
        onRecorded();
      }}
      action={authorizePartyAction.bind(null, vehicleId)}
      guard={() => {
        // Both checked here rather than only server-side, because both produce a
        // 422 the operator cannot see the cause of — and because `validateScope`
        // is the same rule the database constraint enforces.
        if (customer === null) return { partnerId: 'vehicles.ownership.error.customer' };
        if (validateScope(actions) !== 'ok') {
          return { allowedActions: 'vehicles.relationships.scopeEmpty' };
        }
        return null;
      }}
      prelude={(state) => (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <CustomerSelector
              locale={locale}
              messages={messages}
              name="partnerId"
              labelKey="vehicles.relationships.person"
              value={customer}
              onChange={setCustomer}
              required
            />
            {state.fieldErrors?.partnerId ? (
              <p role="alert" className="text-caption text-error">
                {translateDynamic(messages, state.fieldErrors.partnerId)}
              </p>
            ) : null}
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-label font-medium text-text-primary">
              {translate(messages, 'vehicles.relationships.scope')}
              <span aria-hidden="true" className="ms-1 text-error">
                *
              </span>
            </legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {AUTHORIZED_ACTIONS.map((action) => (
                <label key={action} className="flex items-start gap-2 text-body text-text-primary">
                  <input
                    type="checkbox"
                    // Repeated `name`, read with `getAll` — the shape the action
                    // expects, and the shape an array field must take in a form.
                    name="allowedActions"
                    value={action}
                    checked={actions.includes(action)}
                    onChange={() => toggle(action)}
                    className="mt-1 size-4 accent-primary"
                  />
                  <span>{translateDynamic(messages, `vehicles.action.${action}`)}</span>
                </label>
              ))}
            </div>
            {state.fieldErrors?.allowedActions ? (
              <p role="alert" className="text-caption text-error">
                {translateDynamic(messages, state.fieldErrors.allowedActions)}
              </p>
            ) : null}
          </fieldset>
        </div>
      )}
      fields={[
        {
          name: 'effectiveDate',
          kind: 'date',
          labelKey: 'vehicles.interval.from',
          hintKey: 'vehicles.relationships.effectiveHint',
        },
      ]}
    />
  );
}

/**
 * `FE-025` — link a customer to this vehicle in a role.
 *
 * `crm.vehicle-link`, permission `crm.customer.vehicle.manage` — a DIFFERENT
 * module and a different capability from the two `veh` writes beside it, so it
 * carries its own gate.
 *
 * Offered from the vehicle screen rather than the customer profile because
 * `POST /customers/{id}/vehicles` publishes no `GET`: there is no "this
 * customer's vehicles" read anywhere (`P1-27-INT-012`, owned by P1-16 and
 * deferred to P1-28), so a link made there would be invisible the moment it was
 * made. The CRM writer inserts into `veh.vehicle_relationships`, which is the
 * table the list above this form reads — so here, the result appears directly
 * above the control that created it.
 */
function LinkCustomerForm({
  locale,
  messages,
  vehicleId,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicleId: string;
  readonly onRecorded: () => void;
}) {
  const [customer, setCustomer] = useState<SelectedCustomer | null>(null);

  return (
    <RecordForm
      messages={messages}
      titleKey="vehicles.relationships.link"
      submitKey="vehicles.relationships.link"
      onRecorded={() => {
        setCustomer(null);
        onRecorded();
      }}
      action={linkCustomerAction.bind(null, vehicleId)}
      guard={() => (customer === null ? { partnerId: 'vehicles.ownership.error.customer' } : null)}
      prelude={(state) => (
        <div className="flex flex-col gap-1.5">
          <CustomerSelector
            locale={locale}
            messages={messages}
            name="partnerId"
            labelKey="vehicles.relationships.person"
            value={customer}
            onChange={setCustomer}
            required
          />
          {state.fieldErrors?.partnerId ? (
            <p role="alert" className="text-caption text-error">
              {translateDynamic(messages, state.fieldErrors.partnerId)}
            </p>
          ) : null}
        </div>
      )}
      fields={[
        {
          name: 'relationshipRole',
          kind: 'select',
          labelKey: 'vehicles.relationships.role',
          required: true,
          // Six roles, not seven. An authorised person is created by the control
          // below, which sets the scope this operation cannot.
          options: LINKABLE_ROLES,
          optionKeyPrefix: 'vehicles.role.',
          hintKey: 'vehicles.relationships.linkRoleHint',
        },
      ]}
    />
  );
}

/**
 * `FE-025` — retire an authorized party.
 *
 * A retirement, not a deletion: the relationship stays in the history with an
 * end date, which is what makes "who was authorized last March" answerable. The
 * confirmation exists because the control sits in a row of a table and a
 * mis-click would end somebody's authority to collect a vehicle.
 *
 * Offered ONLY on an open `authorized_person` row. The operation closes an open
 * interval, so on any other row it would be a control that can only fail — and
 * on an owner row it would suggest ownership can be ended from here, which it
 * cannot.
 */
function RetirePartyButton({
  messages,
  vehicleId,
  relationship,
  onRetired,
}: {
  readonly messages: Messages;
  readonly vehicleId: string;
  readonly relationship: VehicleRelationship;
  readonly onRetired: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-border px-2 py-1 text-caption text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {translate(messages, 'vehicles.relationships.retire')}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p role="alert" className="text-caption text-text-secondary">
        {translate(messages, 'vehicles.relationships.retireConfirm')}
      </p>
      <div className="flex gap-2">
        <RecordForm
          messages={messages}
          titleKey="vehicles.relationships.retire"
          submitKey="vehicles.relationships.retire"
          action={retirePartyAction.bind(null, vehicleId, relationship.id)}
          onRecorded={() => {
            setConfirming(false);
            onRetired();
          }}
          fields={[
            {
              name: 'effectiveDate',
              kind: 'date',
              labelKey: 'vehicles.interval.to',
              hintKey: 'vehicles.relationships.retireHint',
            },
          ]}
        />
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="self-start rounded-md border border-border px-2 py-1 text-caption text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'admin.cancel')}
        </button>
      </div>
    </div>
  );
}

/** `FE-025`. */
export function RelationshipsSection({
  locale,
  messages,
  vehicleId,
  today,
  canManage,
  canLinkCustomer = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicleId: string;
  readonly today: string;
  /** `veh.vehicle.relationship.manage` — authorise and retire. */
  readonly canManage: boolean;
  /** `crm.customer.vehicle.manage` — a DIFFERENT module's capability. */
  readonly canLinkCustomer?: boolean;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listRelationships(vehicleId, request, cursor),
    [vehicleId]
  );
  const table = useServerTable<VehicleRelationship>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<VehicleRelationship>[]>(
    () => [
      {
        id: 'relationshipRole',
        headerKey: 'vehicles.relationships.role',
        cell: (row) => translateDynamic(messages, `vehicles.role.${row.relationshipRole}`),
      },
      {
        id: 'partner',
        headerKey: 'vehicles.relationships.person',
        // The operation now resolves the party through the CRM module and
        // publishes a name, a reference and a type. It used to publish only
        // `partner_id`, and this column printed that uuid under a heading that
        // said "customer" (`P1-27-INT-025`). An unresolvable party renders as a
        // sentence — never as the id.
        cell: (row) => <PartyLabel messages={messages} party={row} />,
      },
      {
        id: 'scope',
        headerKey: 'vehicles.relationships.scope',
        cell: (row) => {
          const scope = scopeState(row);
          if (scope.kind === 'granted') {
            return (
              <ul className="flex flex-col gap-0.5">
                {scope.actions.map((action) => (
                  <li key={action} className="text-caption">
                    {translateDynamic(messages, `vehicles.action.${action}`)}
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <span className="text-caption text-text-muted">
              {/* THREE readings, not two. The schema forbids a scope on every
                  role but `authorized_person`, so null is "does not apply" for
                  six roles out of seven — and rendering that as "no permissions"
                  would describe an owner as restricted. */}
              {translate(
                messages,
                scope.kind === 'not-applicable'
                  ? 'vehicles.relationships.scopeNotApplicable'
                  : 'vehicles.relationships.scopeNoneGranted'
              )}
            </span>
          );
        },
      },
      {
        id: 'validFrom',
        headerKey: 'vehicles.interval.from',
        cell: (row) => <span dir="ltr">{row.validFrom}</span>,
      },
      {
        id: 'state',
        headerKey: 'crm.customers.column.status',
        // Same four-state derivation as ownership and plates: `active` is
        // `valid_to IS NULL` and says nothing about today.
        cell: (row) => (
          <span className="text-caption">
            {translateDynamic(messages, `vehicles.interval.${intervalState(row, today)}`)}
          </span>
        ),
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              headerKey: 'admin.actions',
              // ONLY on an open authorized party. The operation closes an open
              // interval, so anywhere else this control could only fail — and on
              // an owner row it would imply ownership can be ended from here.
              cell: (row: VehicleRelationship) =>
                row.relationshipRole === SCOPED_ROLE && row.validTo === null ? (
                  <RetirePartyButton
                    messages={messages}
                    vehicleId={vehicleId}
                    relationship={row}
                    onRetired={table.refresh}
                  />
                ) : null,
            },
          ]
        : []),
    ],
    [messages, today, canManage, vehicleId, table.refresh]
  );

  return (
    <section
      aria-labelledby="vehicle-relationships-heading"
      className="flex min-h-0 flex-col gap-3"
    >
      <h2 id="vehicle-relationships-heading" className="sr-only">
        {translate(messages, 'vehicles.relationships.heading')}
      </h2>

      <DataTable<VehicleRelationship>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'vehicles.relationships.caption')}
      />

      <p className="px-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'vehicles.relationships.scopeExplainer')}
      </p>

      {/* A DIFFERENT capability from `canManage`, so its own gate: an operator
          may link a customer without being able to authorise one, and the
          reverse. The list above shows the result either way — both writers
          insert into `veh.vehicle_relationships`. */}
      {canLinkCustomer && table.response ? (
        <LinkCustomerForm
          locale={locale}
          messages={messages}
          vehicleId={vehicleId}
          onRecorded={table.refresh}
        />
      ) : null}

      {canManage ? (
        <>
          <p className="px-2 text-caption text-text-muted" lang={locale}>
            {/* There is no GET for authorized parties. They are visible only
                through this list, which needs a DIFFERENT permission — so a
                caller may be able to add one without being able to see it. */}
            {translate(messages, 'vehicles.relationships.manageNote')}
          </p>
          {/* Gated on `response`, not on a status string: `TableStatus` has no
              `'ok'` member, so `status === 'ok'` is always false and would read
              exactly like a working guard while rendering the form never. */}
          {table.response ? (
            <AuthorizePartyForm
              locale={locale}
              messages={messages}
              vehicleId={vehicleId}
              onRecorded={table.refresh}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export { SCOPED_ROLE };
