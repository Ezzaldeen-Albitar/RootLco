'use client';

import { useCallback, useMemo } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { listRelationships, type EvProfileState } from '../relations-api';
import { intervalState } from '../history-contract';
import {
  SCOPED_ROLE,
  canHaveEvProfile,
  scopeState,
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

/** `FE-024`. Read on the server; this renders whichever of four states came back. */
export function EvProfileSection({
  locale,
  messages,
  state,
  powertrainCategory,
  canEdit,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly state: EvProfileState;
  readonly powertrainCategory: string;
  readonly canEdit: boolean;
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
          <p className="mt-2 text-caption text-text-muted">
            {translate(messages, 'vehicles.ev.canRecord')}
          </p>
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
    </section>
  );
}

/** `FE-025`. */
export function RelationshipsSection({
  locale,
  messages,
  vehicleId,
  today,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly vehicleId: string;
  readonly today: string;
  readonly canManage: boolean;
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
        id: 'partnerId',
        headerKey: 'vehicles.relationships.person',
        // The operation publishes `partner_id` and no name. Shown as a reference
        // and labelled as one rather than resolved by a CRM read this operation
        // does not imply.
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.partnerId}
          </code>
        ),
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
    ],
    [messages, today]
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

      {canManage ? (
        <p className="px-2 text-caption text-text-muted" lang={locale}>
          {/* There is no GET for authorized parties. They are visible only
              through this list, which needs a DIFFERENT permission — so a
              caller may be able to add one without being able to see it. */}
          {translate(messages, 'vehicles.relationships.manageNote')}
        </p>
      ) : null}
    </section>
  );
}

export { SCOPED_ROLE };
