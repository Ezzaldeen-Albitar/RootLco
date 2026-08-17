'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CursorPager } from '@/components/data-table/CursorPager';
import {
  membershipVerdict,
  readCompleteness,
  type MembershipVerdict,
} from '@/components/data-table/read-completeness';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { PartyLabel } from '@/components/party/PartyLabel';
import {
  ErrorState,
  LoadingState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { listCustomerVehicles } from '@/lib/customers/vehicles';
import type { CustomerVehicleEntry } from '@/lib/customers/vehicles-contract';
import { listPartyRoles } from '../../api';
import type { PartyRoleEntry } from '../../receptions-contract';
import {
  listVehicleRelationshipEntries,
  readCustomerSummary,
  readVehicleSummary,
  type CheckInCustomerSummary,
  type CheckInVehicleRelationship,
  type CheckInVehicleSummary,
} from '../../support-api';
import type { CheckInStepProps } from '../../check-in/wizard';

/**
 * Customer and vehicle confirmation (`FE-008`) — identity before evidence.
 *
 * Four published reads, one question: is the person in front of the desk and
 * the vehicle on the ramp who the visit says they are?
 *
 *   - the visit's ACTIVE `service_requester` party role names the customer
 *     (`rec.reception-party-role-list`);
 *   - `crm.customer-read` presents that customer's identity;
 *   - `veh.vehicle-read` presents the vehicle — including a MERGED vehicle,
 *     which the operation deliberately returns rather than 404s: the visit
 *     references it, live work orders may reference it, and a screen that
 *     called it missing would be reporting a record the platform holds;
 *   - `veh.vehicle-relationship-list` and `crm.customer-vehicle-list` say, in
 *     both directions, whether the platform has the two RECORDED as related.
 *
 * ## "No recorded link" is a fact, not an error — when the read EARNED it
 *
 * A walk-in customer may present a vehicle the platform has never linked to
 * them. The cross-check states what is recorded and stops; refusing to proceed
 * would invent a rule the backend does not have.
 *
 * That sentence is only true of a read that covered the list. This step used to
 * print it off ONE page of twenty-five with `hasMore` discarded, so a requester
 * with twenty-six linked vehicles whose match sat on page two was told, about
 * the vehicle on the ramp, that no link is recorded. `membershipVerdict`
 * separates the three answers the platform can actually give — recorded, not
 * recorded (whole list read), and not established (page boundary, or a read that
 * never answered) — and the pager below makes the third one reachable instead of
 * merely announced.
 *
 * ## There is deliberately NO "Confirm" control here
 *
 * No `rec.*` operation records a confirmation; the truthful-labelling rule
 * forbids a control that claims an effect nothing implements. Confirmation is
 * the operator reading this step and moving on.
 */

const EMPTY_PAGE = { rows: [], nextCursor: null, hasMore: false } as const;

/**
 * What each verdict SAYS, in both catalogues.
 *
 * `as const satisfies` rather than an annotation: the annotation widens the
 * values to `string` and `translate` takes `keyof Messages` precisely so a
 * mistyped key is a compile error. The `satisfies` half keeps the other half of
 * the guarantee — a verdict added to `MembershipVerdict` fails to compile here
 * until it has been given something to say.
 *
 * `pending` is absent deliberately: it is rendered as the loading state, not as
 * a sentence, and giving it one here would let a caller print it.
 */
const LINK_VERDICT_KEYS = {
  present: 'receptions.confirm.linkRecorded',
  absent: 'receptions.confirm.linkAbsent',
  'unknown-truncated': 'receptions.confirm.linkTruncated',
  'unknown-unreadable': 'receptions.confirm.linkUnknown',
} as const satisfies Readonly<Record<Exclude<MembershipVerdict, 'pending'>, string>>;

export function ConfirmationStep({
  locale,
  messages,
  visitId,
  recordVersion,
  detail,
  capabilities,
}: CheckInStepProps) {
  // The sub-reads re-run whenever the shell's refresh lands a new version, so
  // this step can never present identities staler than the shell's own truth.
  const readKey = `${visitId}:${recordVersion}`;

  /* --- who is the service requester -------------------------------------- */

  const loadRoles = useCallback(
    (request: Parameters<typeof listPartyRoles>[2], cursor: string | null) =>
      listPartyRoles(visitId, 'active', request, cursor),
    [visitId]
  );
  const roles = useServerTable<PartyRoleEntry>(loadRoles, {
    initial: { ...INITIAL_REQUEST, pageSize: 50 },
    loadKey: readKey,
  });

  const requester =
    roles.response?.rows.find(
      (row) => row.relationshipRole === 'service_requester' && row.validTo === null
    ) ?? null;

  /* --- the customer, read from CRM --------------------------------------- */

  const [customer, setCustomer] = useState<{
    readonly key: string;
    readonly result: ReadState<CheckInCustomerSummary>;
  } | null>(null);

  const requesterPartnerId = requester?.partnerId ?? null;
  useEffect(() => {
    if (!capabilities.readCustomers || requesterPartnerId === null) return;
    let cancelled = false;
    const key = `${requesterPartnerId}:${readKey}`;
    readCustomerSummary(requesterPartnerId)
      .then((result) => {
        if (!cancelled) setCustomer({ key, result });
      })
      // A rejected call is a STATE, not a permanent absence of one.
      // `WarningLightsStep` carries the full reasoning.
      .catch(() => {
        if (!cancelled) setCustomer({ key, result: { status: 'error', correlationId: null } });
      });
    return () => {
      cancelled = true;
    };
  }, [capabilities.readCustomers, requesterPartnerId, readKey]);

  const customerState =
    customer !== null && customer.key === `${requesterPartnerId}:${readKey}`
      ? customer.result
      : null;

  /* --- the vehicle, read from the vehicle registry ------------------------ */

  const [vehicle, setVehicle] = useState<{
    readonly key: string;
    readonly result: ReadState<CheckInVehicleSummary>;
  } | null>(null);

  useEffect(() => {
    if (!capabilities.readVehicles) return;
    let cancelled = false;
    readVehicleSummary(detail.vehicleId)
      .then((result) => {
        if (!cancelled) setVehicle({ key: readKey, result });
      })
      // A rejected call is a STATE, not a permanent absence of one.
      // `WarningLightsStep` carries the full reasoning.
      .catch(() => {
        if (!cancelled)
          setVehicle({ key: readKey, result: { status: 'error', correlationId: null } });
      });
    return () => {
      cancelled = true;
    };
  }, [capabilities.readVehicles, detail.vehicleId, readKey]);

  const vehicleState = vehicle !== null && vehicle.key === readKey ? vehicle.result : null;

  /* --- both directions of the recorded relationship ----------------------- */

  const loadRelationships = useCallback(
    (
      request: Parameters<typeof listVehicleRelationshipEntries>[1],
      cursor: string | null
    ): Promise<ServerPage<CheckInVehicleRelationship>> =>
      capabilities.readVehicles
        ? listVehicleRelationshipEntries(detail.vehicleId, request, cursor)
        : Promise.resolve({ ...EMPTY_PAGE, status: 'denied', correlationId: null }),
    [capabilities.readVehicles, detail.vehicleId]
  );
  const relationships = useServerTable<CheckInVehicleRelationship>(loadRelationships, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: readKey,
  });

  const loadCustomerVehicles = useCallback(
    (
      request: Parameters<typeof listCustomerVehicles>[1],
      cursor: string | null
    ): Promise<ServerPage<CustomerVehicleEntry>> =>
      capabilities.readCustomers && requesterPartnerId !== null
        ? listCustomerVehicles(requesterPartnerId, request, cursor)
        : Promise.resolve({ ...EMPTY_PAGE, status: 'denied', correlationId: null }),
    [capabilities.readCustomers, requesterPartnerId]
  );
  const customerVehicles = useServerTable<CustomerVehicleEntry>(loadCustomerVehicles, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: `${requesterPartnerId ?? 'none'}:${readKey}`,
  });

  /*
   * Recorded / not recorded / not established — never two of the three.
   *
   * `present` is decided by the rows, so it survives a truncated page: finding
   * the link is proof whatever else went unread. Everything else defers to the
   * read's own completeness, which is why `hasMore` reaches this line at all.
   */
  const linkVerdict = membershipVerdict(
    customerVehicles.status,
    customerVehicles.response,
    (row) => row.vehicleId === detail.vehicleId && row.active
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section
        aria-labelledby="confirm-customer-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h4 id="confirm-customer-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.confirm.customerHeading')}
        </h4>

        {!capabilities.readCustomers ? (
          <PermissionDeniedState messages={messages} />
        ) : roles.status === 'loading' ? (
          <LoadingState messages={messages} />
        ) : roles.status !== 'idle' ? (
          <RolesFailure messages={messages} status={roles.status} table={roles} />
        ) : requester === null ? (
          // A visit always seeds its requester role at creation, so an empty
          // answer is stated as the anomaly it is, not silently skipped.
          <p className="mt-2 text-body text-text-secondary">
            {translate(messages, 'receptions.confirm.noRequesterRole')}
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <PartyLabel
              messages={messages}
              party={{
                partnerName: requester.partnerDisplayName,
                partnerNumber: requester.partnerDisplayNumber,
                partnerType: null,
              }}
            />
            <CustomerIdentity messages={messages} state={customerState} />
          </div>
        )}
      </section>

      <section
        aria-labelledby="confirm-vehicle-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h4 id="confirm-vehicle-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.confirm.vehicleHeading')}
        </h4>

        {!capabilities.readVehicles ? (
          <PermissionDeniedState messages={messages} />
        ) : (
          <VehicleIdentity locale={locale} messages={messages} state={vehicleState} />
        )}
      </section>

      <section
        aria-labelledby="confirm-link-heading"
        className="rounded-lg border border-border bg-surface p-4 lg:col-span-2"
      >
        <h4 id="confirm-link-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.confirm.linkHeading')}
        </h4>

        {capabilities.readCustomers && requesterPartnerId !== null ? (
          linkVerdict === 'pending' ? (
            <LoadingState messages={messages} />
          ) : (
            <>
              <p data-testid="confirm-link-verdict" className="mt-2 text-body text-text-secondary">
                {translate(messages, LINK_VERDICT_KEYS[linkVerdict])}
              </p>
              {/* Announced AND reachable. A truncation notice with no control
                  tells the operator their answer is somewhere they cannot go. */}
              <div className="mt-2">
                <CursorPager
                  messages={messages}
                  table={customerVehicles}
                  label={translate(messages, 'receptions.confirm.linkPagerLabel')}
                />
              </div>
            </>
          )
        ) : (
          <p data-testid="confirm-link-verdict" className="mt-2 text-body text-text-secondary">
            {translate(messages, 'receptions.confirm.linkUnknown')}
          </p>
        )}

        <h5 className="mt-4 text-caption font-medium text-text-secondary">
          {translate(messages, 'receptions.confirm.relationshipsHeading')}
        </h5>
        {relationships.status === 'loading' ? (
          <LoadingState messages={messages} />
        ) : relationships.status === 'denied' ? (
          <PermissionDeniedState
            messages={messages}
            {...(relationships.correlationId ? { correlationId: relationships.correlationId } : {})}
          />
        ) : relationships.status !== 'idle' ? (
          <ErrorState
            messages={messages}
            action={<RetryButton messages={messages} onRetry={relationships.refresh} />}
            {...(relationships.correlationId ? { correlationId: relationships.correlationId } : {})}
          />
        ) : (relationships.response?.rows.length ?? 0) === 0 ? (
          <p className="mt-2 text-body text-text-secondary">
            {/* The same three states as the link above: an empty page is only
                "none recorded" when the read covered the set. */}
            {translate(
              messages,
              readCompleteness(relationships.status, relationships.response?.hasMore) ===
                'truncated'
                ? 'receptions.confirm.relationshipsTruncated'
                : 'receptions.confirm.relationshipsEmpty'
            )}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-border rounded-md border border-border">
            {(relationships.response?.rows ?? []).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <PartyLabel
                  messages={messages}
                  party={{
                    partnerName: row.partnerName,
                    partnerNumber: row.partnerNumber,
                    partnerType: row.partnerType,
                  }}
                />
                <span className="text-caption text-text-secondary">
                  {/* The VEHICLE relationship vocabulary — `vehicles.role.*` —
                      not the reception party-role one; these rows come from
                      `veh.vehicle-relationship-list`. */}
                  {translateDynamic(messages, `vehicles.role.${row.relationshipRole}`)}
                </span>
                {row.active ? (
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-caption text-text-secondary">
                    {translate(messages, 'receptions.confirm.relationshipActive')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <CursorPager
            messages={messages}
            table={relationships}
            label={translate(messages, 'receptions.confirm.relationshipsPagerLabel')}
          />
        </div>
      </section>

      <p className="text-caption text-text-muted lg:col-span-2" lang={locale}>
        {/* No Confirm control: nothing implements one. See the module docblock. */}
        {translate(messages, 'receptions.confirm.proceedNote')}
      </p>
    </div>
  );
}

function RolesFailure({
  messages,
  status,
  table,
}: {
  readonly messages: Messages;
  readonly status: string;
  readonly table: { readonly correlationId: string | undefined; readonly refresh: () => void };
}) {
  if (status === 'denied') {
    return (
      <PermissionDeniedState
        messages={messages}
        {...(table.correlationId ? { correlationId: table.correlationId } : {})}
      />
    );
  }
  if (status === 'expired') return <SessionExpiredState messages={messages} />;
  return (
    <ErrorState
      messages={messages}
      action={<RetryButton messages={messages} onRetry={table.refresh} />}
      {...(table.correlationId ? { correlationId: table.correlationId } : {})}
    />
  );
}

function CustomerIdentity({
  messages,
  state,
}: {
  readonly messages: Messages;
  readonly state: ReadState<CheckInCustomerSummary> | null;
}) {
  if (state === null) return <LoadingState messages={messages} />;
  if (state.status === 'denied') {
    return (
      <PermissionDeniedState
        messages={messages}
        {...(state.correlationId ? { correlationId: state.correlationId } : {})}
      />
    );
  }
  if (state.status === 'not-found') return <NotFoundState messages={messages} />;
  if (state.status === 'expired') return <SessionExpiredState messages={messages} />;
  if (state.status !== 'ok' || state.data === null) {
    return (
      <ErrorState
        messages={messages}
        {...(state.correlationId ? { correlationId: state.correlationId } : {})}
      />
    );
  }
  const data = state.data;
  return (
    <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      <div>
        <dt className="text-caption text-text-secondary">
          {translate(messages, 'receptions.confirm.customerType')}
        </dt>
        <dd className="text-body text-text-primary">
          {translateDynamic(messages, `crm.partyType.${data.partyType}`)}
        </dd>
      </div>
      <div>
        <dt className="text-caption text-text-secondary">
          {translate(messages, 'receptions.confirm.customerStatus')}
        </dt>
        <dd className="text-body text-text-primary">
          {translateDynamic(messages, `crm.lifecycle.${data.lifecycleStatus}`)}
        </dd>
      </div>
    </dl>
  );
}

function VehicleIdentity({
  locale,
  messages,
  state,
}: {
  readonly locale: string;
  readonly messages: Messages;
  readonly state: ReadState<CheckInVehicleSummary> | null;
}) {
  if (state === null) return <LoadingState messages={messages} />;
  if (state.status === 'denied') {
    return (
      <PermissionDeniedState
        messages={messages}
        {...(state.correlationId ? { correlationId: state.correlationId } : {})}
      />
    );
  }
  if (state.status === 'not-found') return <NotFoundState messages={messages} />;
  if (state.status === 'expired') return <SessionExpiredState messages={messages} />;
  if (state.status !== 'ok' || state.data === null) {
    return (
      <ErrorState
        messages={messages}
        {...(state.correlationId ? { correlationId: state.correlationId } : {})}
      />
    );
  }
  const data = state.data;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {data.mergedIntoId !== null ? (
        /*
         * A merged vehicle is returned, and shown — `mergedIntoId` is NOT a
         * 404. The visit's reference stays readable; the surviving record is
         * one link away, named as what it is.
         */
        <div
          role="status"
          className="rounded-md border border-border bg-surface-subtle p-3 text-body text-text-primary"
        >
          <p>{translate(messages, 'receptions.confirm.vehicleMerged')}</p>
          <Link
            href={`/${locale}/vehicles/${data.mergedIntoId}`}
            className="mt-1 inline-block text-body text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'receptions.confirm.vehicleMergedLink')}
          </Link>
        </div>
      ) : null}

      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.confirm.vehicleReference')}
          </dt>
          <dd className="text-body text-text-primary" dir="ltr">
            {data.displayNumber ?? translate(messages, 'receptions.confirm.notRecorded')}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.confirm.vehicleVin')}
          </dt>
          <dd className="text-body text-text-primary" dir="ltr">
            {data.vin ?? translate(messages, 'receptions.confirm.notRecorded')}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.confirm.vehicleMakeModel')}
          </dt>
          <dd className="text-body text-text-primary">
            {[data.makeName, data.modelName].filter(Boolean).join(' ') ||
              translate(messages, 'receptions.confirm.notRecorded')}
            {data.modelYear !== null ? ` (${data.modelYear})` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.confirm.vehicleColor')}
          </dt>
          <dd className="text-body text-text-primary">
            {data.color ?? translate(messages, 'receptions.confirm.notRecorded')}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.confirm.vehicleLifecycle')}
          </dt>
          <dd className="text-body text-text-primary">
            {translateDynamic(messages, `vehicles.lifecycle.${data.lifecycleStatus}`)}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.confirm.vehicleWorkshop')}
          </dt>
          <dd className="text-body text-text-primary">
            {translateDynamic(messages, `vehicles.workshop.${data.workshopStatus}`)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function RetryButton({
  messages,
  onRetry,
}: {
  readonly messages: Messages;
  readonly onRetry: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {translate(messages, 'state.retry')}
    </button>
  );
}
