'use client';

import Link from 'next/link';
import { useCallback, useState, useTransition } from 'react';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { RadioGroupField, SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
import { listCustomerVehicles } from '@/lib/customers/vehicles';
import type { CustomerVehicleEntry } from '@/lib/customers/vehicles-contract';
import { createReception, listReceptions } from '../api';
import type { IntakeCatalogueResult } from '../catalogue-api';
import { MAX_WALK_IN_NOTE, type ReceptionCreated } from '../receptions-contract';
import {
  INITIAL_ORIGIN,
  buildCreateInput,
  openVisitAmong,
  switchOriginKind,
  type ChosenAppointment,
  type OriginDraft,
} from '../check-in/wizard';
import {
  listConfirmedAppointments,
  listReceivingEmployeeCandidates,
  type CheckInAppointmentCandidate,
  type ReceivingEmployeeCandidate,
} from '../support-api';

/**
 * The check-in start screen (`FE-007`) — opening or resuming a reception visit.
 *
 * ## Origin: appointment XOR walk-in, structurally
 *
 * `ck_reception_visits_one_origin` allows exactly one origin, and the draft is
 * a discriminated union (`check-in/wizard.ts`) so both can never be submitted.
 * The appointment path CHECKS IN a booked appointment: `rec.reception-create`
 * moves it `confirmed → checked_in` in the same transaction, which is why the
 * picker offers only confirmed appointments and why the vehicle and requester
 * come from the appointment itself — anything else is the 422
 * `incoherent_reference` the backend refuses.
 *
 * ## Resume: an open visit is not an error, it is where the operator goes next
 *
 * One open visit per vehicle (`uq_reception_visits_open_vehicle`). As soon as a
 * vehicle is chosen the screen looks its open visit up
 * (`rec.reception-list`, filtered by vehicle) and offers Resume; and when the
 * create itself answers 409 `ERR-RES-002` the copy states BOTH readings —
 * "already has an open visit" and "origin already consumed" arrive as the SAME
 * code, so guessing which would be lying half the time.
 *
 * ## The receiving employee (G-EMP, named open decision)
 *
 * `receivingEmployeeId` has no foreign key and no employee master exists. The
 * default is the signed-in operator — the one identity that is certainly
 * present — and the picker offers PLATFORM USERS via `iam.user-list` for the
 * operator who is receiving on a colleague's behalf. The disposition is stated
 * beside the control rather than hidden: the platform records an identifier,
 * not an employee-register entry.
 *
 * ## The walk-in handoff (`P1-28-FE-006` → this screen)
 *
 * An operator arriving from the walk-in intake has just found or created the
 * customer and the vehicle. Making them search for both again is the seam
 * failing quietly, so `walkInHandoff` — resolved by the PAGE, which parses the
 * query with `parseWalkInHandoff` and reads the customer's name so a uuid is
 * never rendered — pre-selects the pair on the walk-in origin path. The
 * pre-selection is CONSUMED ONCE: switching origin or changing the customer
 * drops it, because re-applying it would resurrect a choice the operator had
 * deliberately cleared. A vehicle the customer's list does not hold is said so
 * rather than silently ignored, and a half or malformed pair never gets here
 * at all — `parseWalkInHandoff` refuses it and the page passes `null`.
 */

const IDLE: ActionState = { status: 'idle' };

const UNASKED = {
  status: 'ok',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: null,
} as const;

/**
 * The pair the walk-in intake handed over, with the customer already named.
 *
 * The wire form is two identifiers (`WalkInHandoff`); this is what the page
 * turns them into after `crm.customer-read` resolves the name. The screen never
 * renders a uuid, so a customer it cannot name is not a pre-selection — the
 * page passes `null` and the operator starts from the ordinary empty form.
 */
export interface WalkInHandoffStart {
  readonly requester: SelectedCustomer;
  readonly vehicleId: string;
}

/**
 * The handed-over vehicle identifier, held only while the handoff is live.
 *
 * How far it GOT — pending, selected, not-listed — is deliberately NOT stored
 * beside it: it is a function of this identifier and the customer's own vehicle
 * list, and storing a derivation is what forced the update into an effect.
 */
type HandoffState = { readonly vehicleId: string } | null;

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly sessionUserId: string;
  readonly sessionUserName: string;
  /** The session's resolved scope. Empty means unrestricted within the tenant. */
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
  /** `rec.reception.manage` — may this operator open a visit at all. */
  readonly canCreate: boolean;
  /** `apt.appointment.read` — may the appointment picker read the calendar. */
  readonly canListAppointments: boolean;
  /** `iam.user.read` — may the employee picker search platform users. */
  readonly canPickEmployee: boolean;
  /** `crm.customer.read` — may the requester search and vehicle list read. */
  readonly canSearchCustomers: boolean;
  /** Read on the server so the first paint has a usable picker. */
  readonly fuelLevels: IntakeCatalogueResult;
  /**
   * The walk-in intake's `(customer, vehicle)` pair, resolved by the page.
   * `null` whenever there is no handoff, the pair was malformed, or the
   * customer could not be read — every one of which starts an empty form.
   */
  readonly walkInHandoff?: WalkInHandoffStart | null;
}

export function CheckInStartScreen({
  locale,
  messages,
  sessionUserId,
  sessionUserName,
  companyIds,
  branchIds,
  canCreate,
  canListAppointments,
  canPickEmployee,
  canSearchCustomers,
  fuelLevels,
  walkInHandoff = null,
}: Props) {
  /* --- the branch the visit is FOR --------------------------------------- */

  const [companyId, setCompanyId] = useState(companyIds.length === 1 ? (companyIds[0] ?? '') : '');
  const [branchId, setBranchId] = useState(branchIds.length === 1 ? (branchIds[0] ?? '') : '');
  const targetReady = companyId !== '' && branchId !== '';

  /* --- origin ------------------------------------------------------------- */

  const [origin, setOrigin] = useState<OriginDraft>(INITIAL_ORIGIN);
  const [appointment, setAppointment] = useState<
    (ChosenAppointment & { readonly label: string }) | null
  >(null);
  const [requester, setRequester] = useState<SelectedCustomer | null>(
    walkInHandoff?.requester ?? null
  );
  const [walkInVehicle, setWalkInVehicle] = useState<CustomerVehicleEntry | null>(null);

  /*
   * The handoff, held as state so it can be CONSUMED. Once the operator moves
   * away from the pair — another origin, another customer — it is gone, and the
   * note explaining the pre-selection goes with it.
   */
  const [handoff, setHandoff] = useState<HandoffState>(
    walkInHandoff === null ? null : { vehicleId: walkInHandoff.vehicleId }
  );

  const switchOrigin = (kind: 'walk_in' | 'appointment') => {
    setOrigin((current) => switchOriginKind(current, kind));
    // The other side's SELECTIONS go too — a stale choice silently resurrected
    // by switching back is the XOR being circumvented in state.
    setAppointment(null);
    setWalkInVehicle(null);
    setHandoff(null);
  };

  /* --- confirmed appointments, on demand ---------------------------------- */

  const [appointmentsAsked, setAppointmentsAsked] = useState(false);
  const loadAppointments = useCallback(
    (
      request: TableRequest,
      cursor: string | null
    ): Promise<ServerPage<CheckInAppointmentCandidate>> =>
      appointmentsAsked && targetReady && canListAppointments
        ? listConfirmedAppointments({ companyId, branchId }, request, cursor)
        : Promise.resolve(UNASKED),
    [appointmentsAsked, targetReady, canListAppointments, companyId, branchId]
  );
  const appointments = useServerTable<CheckInAppointmentCandidate>(loadAppointments, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
    loadKey: `${appointmentsAsked}:${companyId}:${branchId}`,
  });

  /* --- the requester's vehicles (walk-in) ---------------------------------- */

  const requesterId = requester?.id ?? null;
  const loadVehicles = useCallback(
    (request: TableRequest, cursor: string | null): Promise<ServerPage<CustomerVehicleEntry>> =>
      requesterId !== null && canSearchCustomers
        ? listCustomerVehicles(requesterId, request, cursor)
        : Promise.resolve(UNASKED),
    [requesterId, canSearchCustomers]
  );
  const vehicles = useServerTable<CustomerVehicleEntry>(loadVehicles, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: requesterId ?? 'none',
  });

  /*
   * Applying the handed-over vehicle. It arrives as an identifier, and what the
   * form submits is a ROW off this customer's own list — so the pre-selection
   * can only be made once that list has answered, and a `not-listed` verdict is
   * stated on screen rather than left as an empty control the operator has no
   * reason to distrust.
   *
   * DERIVED, not stored. This was an effect that wrote both the verdict and the
   * pre-selection back into state, which `react-hooks/set-state-in-effect`
   * refuses and is right to: the pair is a pure function of the handoff and the
   * list beside it, so a stored copy can only ever be the same answer or a stale
   * one. The list is one page with no pager, so it does not move under the
   * derivation; the operator's own choice takes precedence over it in
   * `chosenWalkInVehicle`, which is what makes this equivalent to the effect it
   * replaces rather than merely similar.
   */
  const vehicleRows = vehicles.response?.rows ?? null;
  const vehiclesLoaded = vehicles.status === 'idle' && vehicleRows !== null;
  const handoffMatch =
    handoff !== null && vehiclesLoaded
      ? ((vehicleRows ?? []).find((row) => row.vehicleId === handoff.vehicleId) ?? null)
      : null;
  const handoffVerdict: 'pending' | 'selected' | 'not-listed' | null =
    handoff === null
      ? null
      : !vehiclesLoaded
        ? 'pending'
        : handoffMatch !== null
          ? 'selected'
          : 'not-listed';
  /** The operator's own choice wins; the handoff only fills the gap it left. */
  const chosenWalkInVehicle = walkInVehicle ?? handoffMatch;

  /* --- the open-visit lookup (resume) -------------------------------------- */

  const chosenVehicleId =
    origin.kind === 'appointment'
      ? (appointment?.vehicleId ?? null)
      : (chosenWalkInVehicle?.vehicleId ?? null);

  const loadOpenVisits = useCallback(
    (request: TableRequest, cursor: string | null) =>
      targetReady && chosenVehicleId !== null
        ? listReceptions({ companyId, branchId }, { vehicleId: chosenVehicleId }, request, cursor)
        : Promise.resolve(UNASKED),
    [targetReady, chosenVehicleId, companyId, branchId]
  );
  const visits = useServerTable(loadOpenVisits, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
    loadKey: `${chosenVehicleId ?? 'none'}:${companyId}:${branchId}`,
  });
  // `useServerTable` reports a loaded page as 'idle' (loading is derived).
  const openVisit = visits.status === 'idle' ? openVisitAmong(visits.response?.rows ?? []) : null;

  /* --- receiving employee (G-EMP) ------------------------------------------ */

  const [employee, setEmployee] = useState<{ readonly id: string; readonly label: string }>({
    id: sessionUserId,
    label: sessionUserName,
  });

  /* --- optional intake facts ----------------------------------------------- */

  const [fuelLevelId, setFuelLevelId] = useState('');
  const [evSocPercent, setEvSocPercent] = useState('');

  /* --- submission ----------------------------------------------------------- */

  const [state, setState] = useState<ActionState>(IDLE);
  const [localError, setLocalError] = useState<string | null>(null);
  const [created, setCreated] = useState<ReceptionCreated | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const draft = buildCreateInput({
      companyId,
      branchId,
      origin,
      appointment,
      walkInVehicleId: chosenWalkInVehicle?.vehicleId ?? null,
      walkInRequesterId: requesterId,
      receivingEmployeeId: employee.id,
      fuelLevelId,
      evSocPercent,
    });
    if (!draft.ok) {
      setLocalError(draft.messageKey);
      return;
    }
    setLocalError(null);
    startTransition(async () => {
      const result = await createReception(draft.input, (state.attempt ?? 0) + 1);
      setState(result);
      notifyActionResult(result, messages);
      if (result.status === 'success' && result.created) {
        setCreated(result.created);
      }
    });
  };

  if (created !== null) {
    return (
      <section
        aria-labelledby="check-in-created-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="check-in-created-heading" className="text-section-title font-medium text-success">
          {translate(messages, 'receptions.checkIn.created')}
        </h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.checkIn.createdNumber')}
            </dt>
            <dd className="text-body text-text-primary">
              {created.displayNumber ?? translate(messages, 'receptions.wizard.visitUnnumbered')}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.wizard.status')}
            </dt>
            <dd className="text-body text-text-primary">
              {translateDynamic(messages, `receptions.status.${created.receptionStatus}`)}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/${locale}/receptions/check-in/${created.receptionVisitId}`}
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'receptions.checkIn.continue')}
          </Link>
          <button
            type="button"
            onClick={() => location.reload()}
            className="rounded-md border border-border px-4 py-2 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'receptions.checkIn.another')}
          </button>
        </div>
      </section>
    );
  }

  if (!canCreate) {
    // The page is visible with `rec.reception.read` (the resume path needs no
    // more); OPENING a visit is `rec.reception.manage`, said plainly.
    return (
      <div className="flex flex-col gap-3">
        <PermissionDeniedState messages={messages} />
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.checkIn.createDenied')}
        </p>
      </div>
    );
  }

  return (
    <form
      aria-label={translate(messages, 'receptions.checkIn.formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <fieldset className="rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-caption text-text-secondary">
          {translate(messages, 'receptions.checkIn.targetLegend')}
        </legend>
        <p className="mb-3 text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.checkIn.targetHint')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ScopeControl
            messages={messages}
            label={translate(messages, 'receptions.checkIn.company')}
            options={companyIds}
            value={companyId}
            onChange={setCompanyId}
          />
          <ScopeControl
            messages={messages}
            label={translate(messages, 'receptions.checkIn.branch')}
            options={branchIds}
            value={branchId}
            onChange={setBranchId}
          />
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-caption text-text-secondary">
          {translate(messages, 'receptions.checkIn.originLegend')}
        </legend>
        <RadioGroupField
          label={translate(messages, 'receptions.checkIn.originLabel')}
          description={translate(messages, 'receptions.checkIn.originHint')}
          required
          name="originKind"
          value={origin.kind}
          onChange={(value) => switchOrigin(value as 'walk_in' | 'appointment')}
          options={[
            {
              value: 'walk_in',
              label: translate(messages, 'receptions.origin.walk_in'),
              description: translate(messages, 'receptions.checkIn.walkInDescription'),
            },
            {
              value: 'appointment',
              label: translate(messages, 'receptions.origin.appointment'),
              description: translate(messages, 'receptions.checkIn.appointmentDescription'),
            },
          ]}
        />

        {origin.kind === 'appointment' ? (
          <div className="mt-3 flex flex-col gap-3">
            {!canListAppointments ? (
              <p className="text-caption text-text-muted" lang={locale}>
                {translate(messages, 'receptions.checkIn.appointmentsDenied')}
              </p>
            ) : appointment !== null ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2">
                <span className="text-body text-text-primary">{appointment.label}</span>
                <button
                  type="button"
                  onClick={() => {
                    setAppointment(null);
                    setOrigin({ kind: 'appointment', appointmentId: null });
                  }}
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  {translate(messages, 'receptions.checkIn.appointmentChange')}
                </button>
              </div>
            ) : (
              <>
                <div>
                  <button
                    type="button"
                    disabled={!targetReady}
                    onClick={() => {
                      setAppointmentsAsked(true);
                      appointments.refresh();
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    {translate(messages, 'receptions.checkIn.loadAppointments')}
                  </button>
                  {!targetReady ? (
                    <p className="mt-1 text-caption text-text-muted">
                      {translate(messages, 'receptions.checkIn.targetFirst')}
                    </p>
                  ) : null}
                </div>
                {appointmentsAsked ? (
                  <AppointmentResults
                    locale={locale}
                    messages={messages}
                    table={appointments}
                    onChoose={(entry) => {
                      setAppointment({
                        id: entry.id,
                        vehicleId: entry.vehicleId,
                        requesterPartnerId: entry.requesterPartnerId,
                        label: appointmentLabel(messages, locale, entry),
                      });
                      setOrigin({ kind: 'appointment', appointmentId: entry.id });
                    }}
                  />
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {handoff !== null ? (
              /*
               * Why this form arrived filled in. An operator who did not put
               * these values here is owed the sentence that says who did — and
               * when the vehicle could not be matched, the sentence says that
               * instead of implying a selection that is not there.
               */
              <p
                role="status"
                data-testid="walk-in-handoff-notice"
                lang={locale}
                className="rounded-md border border-border bg-surface-subtle p-3 text-caption text-text-secondary"
              >
                {translate(
                  messages,
                  handoffVerdict === 'not-listed'
                    ? 'receptions.checkIn.handoffVehicleMissing'
                    : 'receptions.checkIn.handoffApplied'
                )}
              </p>
            ) : null}
            {!canSearchCustomers ? (
              <p className="text-caption text-text-muted" lang={locale}>
                {translate(messages, 'receptions.checkIn.customersDenied')}
              </p>
            ) : (
              <>
                <CustomerSelector
                  locale={locale}
                  messages={messages}
                  name="serviceRequesterPartnerId"
                  labelKey="receptions.checkIn.requester"
                  value={requester}
                  onChange={(next) => {
                    setRequester(next);
                    setWalkInVehicle(null);
                    // The handoff belonged to the customer it named.
                    setHandoff(null);
                  }}
                  required
                  attempt={state.attempt ?? 0}
                />
                {requester !== null ? (
                  <VehicleChoice
                    messages={messages}
                    table={vehicles}
                    chosen={chosenWalkInVehicle}
                    onChoose={setWalkInVehicle}
                  />
                ) : null}
              </>
            )}
            <TextAreaField
              label={translate(messages, 'receptions.checkIn.walkInNote')}
              optionalHint={translate(messages, 'form.optional')}
              value={origin.kind === 'walk_in' ? origin.note : ''}
              maxLength={MAX_WALK_IN_NOTE}
              onChange={(event) => setOrigin({ kind: 'walk_in', note: event.target.value })}
              rows={2}
            />
          </div>
        )}
      </fieldset>

      {openVisit !== null ? (
        /*
         * The RESUME path. One open visit per vehicle; offering to create a
         * second would only ever answer 409, so the open one is offered first.
         */
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle p-4"
        >
          <div>
            <p className="text-body font-medium text-text-primary">
              {translate(messages, 'receptions.checkIn.openVisitTitle')}
            </p>
            <p className="text-caption text-text-secondary">
              {openVisit.displayNumber ?? translate(messages, 'receptions.wizard.visitUnnumbered')}{' '}
              · {translateDynamic(messages, `receptions.status.${openVisit.receptionStatus}`)}
            </p>
          </div>
          <Link
            href={`/${locale}/receptions/check-in/${openVisit.id}`}
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'receptions.checkIn.resume')}
          </Link>
        </div>
      ) : null}

      <fieldset className="rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-caption text-text-secondary">
          {translate(messages, 'receptions.checkIn.employeeLegend')}
        </legend>
        <EmployeeControl
          locale={locale}
          messages={messages}
          canPickEmployee={canPickEmployee}
          sessionUserId={sessionUserId}
          sessionUserName={sessionUserName}
          employee={employee}
          onChange={setEmployee}
        />
      </fieldset>

      <fieldset className="rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-caption text-text-secondary">
          {translate(messages, 'receptions.checkIn.intakeLegend')}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <SelectField
              label={translate(messages, 'receptions.checkIn.fuelLevel')}
              optionalHint={translate(messages, 'form.optional')}
              value={fuelLevelId}
              onChange={(event) => setFuelLevelId(event.target.value)}
              options={
                fuelLevels.status === 'ok'
                  ? fuelLevels.options.map((option) => ({ value: option.id, label: option.name }))
                  : []
              }
              placeholder={translate(messages, 'form.select.placeholder')}
              disabled={fuelLevels.status !== 'ok' || fuelLevels.options.length === 0}
            />
            <p className="mt-1 text-caption text-text-muted">
              {fuelLevels.status !== 'ok'
                ? translate(messages, 'receptions.checkIn.fuelUnavailable')
                : fuelLevels.options.length === 0
                  ? // An empty catalogue is the catalogue WORKING (zero rows
                    // ship); the field is nullable, so the form degrades and
                    // the operation does not.
                    translate(messages, 'receptions.checkIn.fuelEmpty')
                  : ''}
            </p>
          </div>
          <TextField
            label={translate(messages, 'receptions.checkIn.evSoc')}
            description={translate(messages, 'receptions.checkIn.evSocHint')}
            optionalHint={translate(messages, 'form.optional')}
            value={evSocPercent}
            onChange={(event) => setEvSocPercent(event.target.value)}
            inputMode="decimal"
            dir="ltr"
            maxLength={6}
          />
        </div>
      </fieldset>

      {localError !== null ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, localError)}
        </p>
      ) : null}

      {state.status === 'conflict' ? (
        <div role="alert" className="rounded-lg border border-border bg-surface-subtle p-4">
          <p className="text-body text-text-primary">
            {/* BOTH readings of ERR-RES-002, because the code does not say
                which: an open visit already holds the vehicle, or this origin
                was already consumed. */}
            {translate(messages, 'receptions.checkIn.conflictBody')}
          </p>
          {state.correlationId ? (
            <p className="mt-1 text-caption text-text-muted">
              {translate(messages, 'state.correlationId')}{' '}
              <code className="font-mono">{state.correlationId}</code>
            </p>
          ) : null}
        </div>
      ) : state.status !== 'idle' && state.status !== 'success' && state.messageKey ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, state.messageKey)}
          {state.correlationId ? (
            <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
          ) : null}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'receptions.checkIn.submit')}
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------- *
 * Pieces
 * ---------------------------------------------------------------------- */

/**
 * One scope identifier: a select over the session's resolved ids, or a plain
 * identifier input when the session is UNRESTRICTED (an empty array means
 * "everything in the tenant", and the platform publishes no company/branch
 * directory read this screen could turn into names — rendering the identifier
 * is what the approval-limits precedent does, and inventing labels would be
 * fabricating data).
 */
function ScopeControl({
  messages,
  label,
  options,
  value,
  onChange,
}: {
  readonly messages: Messages;
  readonly label: string;
  readonly options: readonly string[];
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  if (options.length > 0) {
    return (
      <SelectField
        label={label}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={options.map((id) => ({ value: id, label: id }))}
        placeholder={translate(messages, 'form.select.placeholder')}
      />
    );
  }
  return (
    <TextField
      label={label}
      description={translate(messages, 'receptions.checkIn.scopeUnrestricted')}
      required
      value={value}
      onChange={(event) => onChange(event.target.value)}
      dir="ltr"
    />
  );
}

function appointmentLabel(
  messages: Messages,
  locale: Locale,
  entry: CheckInAppointmentCandidate
): string {
  const who =
    entry.requesterDisplayName ?? translate(messages, 'receptions.checkIn.partyUnavailable');
  const when = entry.confirmedFrom !== null ? formatDateTime(entry.confirmedFrom, locale) : '';
  const vehicle = entry.vehicleDisplayNumber ?? '';
  return [entry.displayNumber, who, vehicle, when].filter(Boolean).join(' · ');
}

function AppointmentResults({
  locale,
  messages,
  table,
  onChoose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly table: ReturnType<typeof useServerTable<CheckInAppointmentCandidate>>;
  readonly onChoose: (entry: CheckInAppointmentCandidate) => void;
}) {
  if (table.status === 'loading') return <LoadingState messages={messages} />;
  if (table.status === 'denied') {
    return (
      <PermissionDeniedState
        messages={messages}
        {...(table.correlationId ? { correlationId: table.correlationId } : {})}
      />
    );
  }
  if (table.status === 'expired') return <SessionExpiredState messages={messages} />;
  if (table.status !== 'idle') {
    return (
      <ErrorState
        messages={messages}
        action={
          <button
            type="button"
            onClick={table.refresh}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'state.retry')}
          </button>
        }
        {...(table.correlationId ? { correlationId: table.correlationId } : {})}
      />
    );
  }
  const rows = table.response?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        {translate(messages, 'receptions.checkIn.noConfirmedAppointments')}
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {rows.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onChoose(entry)}
            className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-start transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <span className="text-body text-text-primary">
              {appointmentLabel(messages, locale, entry)}
            </span>
            {entry.appointmentTypeName !== null ? (
              <span className="text-caption text-text-muted">{entry.appointmentTypeName}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function VehicleChoice({
  messages,
  table,
  chosen,
  onChoose,
}: {
  readonly messages: Messages;
  readonly table: ReturnType<typeof useServerTable<CustomerVehicleEntry>>;
  readonly chosen: CustomerVehicleEntry | null;
  readonly onChoose: (entry: CustomerVehicleEntry) => void;
}) {
  if (table.status === 'loading') return <LoadingState messages={messages} />;
  if (table.status === 'denied') {
    return (
      <PermissionDeniedState
        messages={messages}
        {...(table.correlationId ? { correlationId: table.correlationId } : {})}
      />
    );
  }
  if (table.status === 'expired') return <SessionExpiredState messages={messages} />;
  if (table.status !== 'idle') {
    return (
      <ErrorState
        messages={messages}
        action={
          <button
            type="button"
            onClick={table.refresh}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'state.retry')}
          </button>
        }
        {...(table.correlationId ? { correlationId: table.correlationId } : {})}
      />
    );
  }
  const rows = table.response?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        {/* Honest: this customer has no recorded vehicles. Linking one is a
            CRM/Vehicle capability, and the sentence points there rather than
            offering a control this screen does not have. */}
        {translate(messages, 'receptions.checkIn.noCustomerVehicles')}
      </p>
    );
  }
  return (
    <div role="group" aria-label={translate(messages, 'receptions.checkIn.vehicleLabel')}>
      <p className="mb-1 text-label font-medium text-text-primary">
        {translate(messages, 'receptions.checkIn.vehicleLabel')}
        <span aria-hidden="true" className="ms-1 text-error">
          *
        </span>
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {rows.map((row) => {
          const current = chosen !== null && chosen.vehicleId === row.vehicleId;
          const identity =
            row.vehicleDisplayNumber ??
            row.vin ??
            translate(messages, 'receptions.checkIn.vehicleUnidentified');
          return (
            <li key={row.id}>
              <button
                type="button"
                aria-pressed={current}
                onClick={() => onChoose(row)}
                className={
                  'flex w-full flex-wrap items-center gap-3 px-3 py-2 text-start transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ' +
                  (current ? 'bg-surface-subtle' : 'hover:bg-surface-subtle')
                }
              >
                <span className="text-body text-text-primary" dir="ltr">
                  {identity}
                </span>
                <span className="text-caption text-text-muted">
                  {translateDynamic(messages, `vehicles.role.${row.relationshipRole}`)}
                </span>
                {!row.active ? (
                  <span className="text-caption text-text-muted">
                    {translate(messages, 'receptions.checkIn.vehicleLinkEnded')}
                  </span>
                ) : null}
                {current ? (
                  <span className="ms-auto text-caption font-medium text-primary">
                    {translate(messages, 'receptions.checkIn.vehicleChosen')}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmployeeControl({
  locale,
  messages,
  canPickEmployee,
  sessionUserId,
  sessionUserName,
  employee,
  onChange,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canPickEmployee: boolean;
  readonly sessionUserId: string;
  readonly sessionUserName: string;
  readonly employee: { readonly id: string; readonly label: string };
  readonly onChange: (next: { readonly id: string; readonly label: string }) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState('');
  const [asked, setAsked] = useState<string | null>(null);

  const load = useCallback(
    (
      request: TableRequest,
      cursor: string | null
    ): Promise<ServerPage<ReceivingEmployeeCandidate>> =>
      asked !== null && canPickEmployee
        ? listReceivingEmployeeCandidates(asked, request, cursor)
        : Promise.resolve(UNASKED),
    [asked, canPickEmployee]
  );
  const table = useServerTable<ReceivingEmployeeCandidate>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
    loadKey: asked ?? 'none',
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-body text-text-primary">
          {employee.id === sessionUserId
            ? `${translate(messages, 'receptions.checkIn.employeeSelf')} — ${sessionUserName}`
            : employee.label}
        </span>
        {employee.id !== sessionUserId ? (
          <button
            type="button"
            onClick={() => onChange({ id: sessionUserId, label: sessionUserName })}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'receptions.checkIn.employeeReset')}
          </button>
        ) : null}
        {canPickEmployee ? (
          <button
            type="button"
            onClick={() => setSearching((current) => !current)}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'receptions.checkIn.employeeChoose')}
          </button>
        ) : null}
      </div>

      <p className="text-caption text-text-muted" lang={locale}>
        {/* G-EMP, stated where the choice is made: an identifier is recorded;
            no employee master exists to validate it against. */}
        {translate(messages, 'receptions.checkIn.employeeHint')}
      </p>

      {searching && canPickEmployee ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-end gap-2">
            <TextField
              label={translate(messages, 'receptions.checkIn.employeeSearch')}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (term.trim() !== '') setAsked(term.trim());
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (term.trim() !== '') setAsked(term.trim());
              }}
              className="rounded-md border border-border px-3 py-2 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {translate(messages, 'customerSelector.search')}
            </button>
          </div>
          {asked === null ? null : table.status === 'loading' ? (
            <LoadingState messages={messages} />
          ) : table.status === 'denied' ? (
            <PermissionDeniedState
              messages={messages}
              {...(table.correlationId ? { correlationId: table.correlationId } : {})}
            />
          ) : table.status === 'expired' ? (
            <SessionExpiredState messages={messages} />
          ) : table.status !== 'idle' ? (
            <ErrorState
              messages={messages}
              action={
                <button
                  type="button"
                  onClick={table.refresh}
                  className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  {translate(messages, 'state.retry')}
                </button>
              }
              {...(table.correlationId ? { correlationId: table.correlationId } : {})}
            />
          ) : (table.response?.rows.length ?? 0) === 0 ? (
            <p className="text-body text-text-secondary">
              {translate(messages, 'state.noResults.title')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {(table.response?.rows ?? []).map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ id: row.id, label: row.displayName });
                      setSearching(false);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-start transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <span className="text-body text-text-primary">{row.displayName}</span>
                    <span className="text-caption text-text-muted" dir="ltr">
                      {row.email}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
