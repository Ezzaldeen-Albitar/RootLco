'use client';

import Link from 'next/link';
import { useCallback, useState, useTransition } from 'react';
import { CursorPager } from '@/components/data-table/CursorPager';
import type { TableStatus } from '@/components/data-table/DataTable';
import {
  membershipVerdict,
  readCompleteness,
  type MembershipVerdict,
} from '@/components/data-table/read-completeness';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import {
  useServerTable,
  type ServerPage,
  type ServerTable,
} from '@/components/data-table/use-server-table';
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
import { RECEIVING_EMPLOYEE_NOTICE_KEY } from '../people/receiving-employee-directory';
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
 * A lookup that did not answer is NOT a vehicle with nothing open, and the
 * difference is now on screen rather than in this paragraph:
 * `OpenVisitOutcome` names the eight things the lookup can have established and
 * only one of them — the read covered the set and found no open visit — renders
 * as the empty space the screen used to render for all of them.
 *
 * ## The receiving employee (Owner decision `FE-007`)
 *
 * `receivingEmployeeId` now carries a same-tenant foreign key to
 * `iam.user_accounts`, an insert-time eligibility guard and an immutable
 * display-name snapshot (`DBCR-P1-18-002`). The default is the signed-in
 * operator — the one identity certainly present — and the picker offers the
 * accounts ELIGIBLE FOR THIS BRANCH via `rec.receiving-employee-list`, for the
 * operator receiving on a colleague's behalf. An operator who is not themselves
 * eligible for the chosen branch loses the default and is told why, because
 * offering it would be offering a value the insert refuses.
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
 * The handed-over vehicle, held only as the identifier that arrived.
 *
 * How far it GOT is not stored, deliberately. It used to be — a
 * `pending | selected | not-listed` field written by an effect once the
 * vehicle list answered — and that is a second copy of something the list
 * already knows, kept in sync by a `setState` inside an effect body
 * (`react-hooks/set-state-in-effect`, which fails `lint:web`). The verdict is
 * derived below instead, so there is nothing to fall out of step and no
 * cascading render: `null` means no handoff or a consumed one, and everything
 * else follows from the rows.
 */
type HandoffState = { readonly vehicleId: string } | null;

/**
 * What the handoff notice says for each verdict, in both catalogues.
 *
 * `pending` covers both "the list has not answered yet" and "there is no
 * handoff": in either case the only truthful sentence is the one that explains
 * where the pre-selection came from, and the notice is not rendered at all
 * without a handoff. `as const satisfies` so a fifth verdict fails to compile
 * here rather than rendering a missing key.
 */
const HANDOFF_NOTICE_KEYS = {
  present: 'receptions.checkIn.handoffApplied',
  pending: 'receptions.checkIn.handoffApplied',
  absent: 'receptions.checkIn.handoffVehicleMissing',
  'unknown-truncated': 'receptions.checkIn.handoffVehicleUnconfirmed',
  'unknown-unreadable': 'receptions.checkIn.handoffVehicleUnreadable',
} as const satisfies Readonly<Record<MembershipVerdict, string>>;

/**
 * What the open-visit lookup ESTABLISHED — one value, and only one silence.
 *
 * `openVisitAmong(rows)` answers a vehicle-filtered `rec.reception-list` page,
 * and the screen used to take its `null` as the whole story: no resumable visit
 * on the page meant no banner, and no banner meant nothing on screen at all. Six
 * of `TableStatus`'s seven names produce that same `null` — `loading`, `denied`,
 * `expired`, `unavailable`, `error` and `not-found` — so a read that was refused,
 * that timed out, that was rate-limited or that had simply not come back yet was
 * rendered exactly like a vehicle with a clean history. Silence is a claim here:
 * the operator reads it as "this vehicle is free", fills the rest of the form,
 * and meets `ERR-RES-002` at the create — a 409 whose copy deliberately refuses
 * to guess which of its two readings applies, because it cannot.
 *
 * Each of the six now has its own sentence, and each names a different next
 * step: wait, ask for the permission, sign in again, try again shortly, try
 * again, or check the branch. That is the platform's own five-way read boundary
 * (`ScreenStates.ReadBoundary`) plus the pending state, restated inline because
 * this lookup has no other surface — a picker announces its own failure in the
 * space its rows would have filled, whereas this one is invisible until it has
 * something to say.
 *
 * `truncated` is the seventh, and it is not a failure: the read succeeded and
 * the server says more rows exist for this vehicle than were returned. An open
 * visit could be among them, so the absence is not established and the notice
 * says so — with the pager the rule in `read-completeness.ts` requires, because
 * a sentence that says "more exists" and offers no way to reach it tells an
 * operator their answer is somewhere they cannot go.
 *
 * `none` — the read covered the set and found no open visit — is the one state
 * whose honest rendering is nothing at all: the create form beneath it is the
 * answer.
 */
type OpenVisitOutcome =
  'none' | 'truncated' | 'pending' | 'denied' | 'expired' | 'unavailable' | 'not-found' | 'error';

/**
 * The lookup's outcome from the table's own two published facts.
 *
 * The five failure names are RETURNED rather than re-listed, so a seventh
 * `TableStatus` cannot be introduced without failing to compile here — the
 * silent-collapse this function exists to end is exactly what a `default` arm
 * would quietly restore.
 */
function openVisitOutcome(status: TableStatus, hasMore: boolean | undefined): OpenVisitOutcome {
  if (status === 'loading') return 'pending';
  if (status === 'idle') return hasMore === true ? 'truncated' : 'none';
  return status;
}

/**
 * What each outcome says, in both catalogues.
 *
 * `none` is deliberately absent: it has no sentence because it needs none, and
 * `as const satisfies` makes that a compile error to forget rather than a
 * missing key rendered on a screen.
 */
const OPEN_VISIT_NOTICE_KEYS = {
  pending: 'receptions.checkIn.openVisitChecking',
  denied: 'receptions.checkIn.openVisitDenied',
  expired: 'receptions.checkIn.openVisitExpired',
  unavailable: 'receptions.checkIn.openVisitUnavailable',
  'not-found': 'receptions.checkIn.openVisitScopeUnknown',
  error: 'receptions.checkIn.openVisitUnread',
  truncated: 'receptions.checkIn.openVisitTruncated',
} as const satisfies Readonly<Record<Exclude<OpenVisitOutcome, 'none'>, string>>;

/**
 * The outcomes that carry the backend reference, and the ones that must not.
 *
 * `P1-27-DO-002`, and the rule `ScreenStates` states for the whole platform: a
 * refusal, a rate limit and a failure are what an operator telephones about, and
 * the reference is the only thing that ties their call to the server-side log.
 * An expired session and an unknown branch are not faults, and printing a
 * reference beside them invites a support ticket for a working system.
 */
const OPEN_VISIT_REFERENCED: readonly OpenVisitOutcome[] = ['denied', 'unavailable', 'error'];

/** The outcomes a Retry can actually change. */
const OPEN_VISIT_RETRYABLE: readonly OpenVisitOutcome[] = ['unavailable', 'error'];

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
  /**
   * `rec.reception.manage` — the SAME code as `canCreate`, deliberately.
   *
   * The picker and the create it feeds cost one capability, so a screen that
   * cannot open a visit cannot read who might have received one either. It was
   * `iam.user.read` while the only staff read was the tenant-wide directory.
   */
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
   * Applying the handed-over vehicle, by DERIVATION.
   *
   * It arrives as an identifier, and what the form submits is a ROW off this
   * customer's own list — so the pre-selection can only exist once that list has
   * answered. It is computed from the rows on every render rather than copied
   * into state by an effect: a copy needs synchronising, synchronising it in an
   * effect is `react-hooks/set-state-in-effect`, and a copy that falls behind
   * would submit a vehicle the operator can no longer see.
   *
   * The operator's own choice WINS over the handoff, and a `not-listed` verdict
   * is stated on screen rather than left as an empty control they have no
   * reason to distrust.
   */
  const vehicleRows = vehicles.response?.rows ?? null;
  const vehiclesLoaded = vehicles.status === 'idle' && vehicleRows !== null;
  const handoffVehicle =
    handoff === null || !vehiclesLoaded
      ? null
      : ((vehicleRows ?? []).find((row) => row.vehicleId === handoff.vehicleId) ?? null);
  /*
   * Why the pre-selection is not there, told apart from whether it EXISTS.
   *
   * This used to be one boolean — the list answered and the row was not on it —
   * which printed "that vehicle is not in this customer's list" for a customer
   * whose twenty-sixth vehicle was the handed-over one, and for a list that
   * never answered at all. `hasMore` and the read status separate the three, and
   * the pager under the picker makes the truncated case reachable.
   */
  const handoffVerdict: MembershipVerdict =
    handoff === null
      ? 'pending'
      : membershipVerdict(
          vehicles.status,
          vehicles.response,
          (row) => row.vehicleId === handoff.vehicleId,
          vehicles.request.page
        );
  /** What the form actually submits: the explicit choice, else the handed-over row. */
  const effectiveVehicle = walkInVehicle ?? handoffVehicle;

  /* --- the open-visit lookup (resume) -------------------------------------- */

  const chosenVehicleId =
    origin.kind === 'appointment'
      ? (appointment?.vehicleId ?? null)
      : (effectiveVehicle?.vehicleId ?? null);

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
  /*
   * Whether the lookup was ASKED at all, in the loader's own words.
   *
   * `UNASKED` answers `ok` with no rows, which is indistinguishable at the table
   * from a branch that read the vehicle's whole history and found nothing — so
   * the condition that decides whether the read happens is the condition that
   * decides whether anything may be concluded from it. Before a target and a
   * vehicle exist there is no question, and a screen with no question owes no
   * answer.
   */
  const openVisitAsked = targetReady && chosenVehicleId !== null;
  const openVisitLookup = openVisitOutcome(visits.status, visits.response?.hasMore);

  /* --- receiving employee (Owner decision `FE-007`) ------------------------- */

  const [chosenEmployee, setChosenEmployee] = useState<{
    readonly id: string;
    readonly label: string;
  }>({ id: sessionUserId, label: sessionUserName });

  /*
   * The eligible list is read HERE, not in the control that renders it.
   *
   * The first shape read it inside `EmployeeControl` and cleared the parent’s
   * selection from an effect when the operator turned out to be ineligible.
   * `react-hooks/set-state-in-effect` refused it, and the rule was right about
   * more than style: a selection that a render can DERIVE should never be a
   * second piece of state that an effect has to chase. Reading it here makes
   * the withdrawal a derivation, and — the part that actually matters — makes
   * `submit` see the same value the screen shows, rather than whatever the
   * effect had managed to write by the time the operator clicked.
   */
  const loadEmployees = useCallback(
    (
      request: TableRequest,
      cursor: string | null
    ): Promise<ServerPage<ReceivingEmployeeCandidate>> =>
      targetReady && canPickEmployee
        ? listReceivingEmployeeCandidates({ companyId, branchId }, request, cursor)
        : Promise.resolve(UNASKED),
    [targetReady, canPickEmployee, companyId, branchId]
  );
  const employees = useServerTable<ReceivingEmployeeCandidate>(loadEmployees, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: targetReady && canPickEmployee ? `${companyId}:${branchId}` : 'none',
  });

  /*
   * Whether the DEFAULT is eligible — and `null` while that is unknown.
   *
   * Three states, not two. `false` is an observation ("the branch answered,
   * and the operator is not on it"); `null` is the absence of one, and they
   * must not render the same way. FOUR ways it stays `null`, and
   * `canPickEmployee` is the one this screen shipped without: the loader
   * answers an empty page when the capability is absent, so a branch with
   * nobody eligible and an operator who was never allowed to ask looked
   * identical, and the default was withdrawn from the second. Three DOM cases
   * caught it. It is the same defect `F1` found on the acknowledgement
   * document: a read that did not happen, printed as an observed absence.
   */
  const eligible = employees.response?.rows ?? [];
  /*
   * A TRUNCATED read is not an answer either, and that was the hole left in
   * the reasoning above. The branch directory is a keyset page: with more
   * candidates than one page holds, an operator listed on page two was absent
   * from the rows this screen had, so `some()` answered false and the screen
   * stated "Your account is not eligible to accept custody in this branch" and
   * withdrew their own default — from a read that never covered them.
   *
   * `readCompleteness` is the same primitive `InspectionStep` and
   * `EvidenceReadBack` use, and it already separates the four cases. Only
   * `complete` is an answer; loading, unreadable and truncated are all "not
   * known", which is what `null` means here and what the notice below refuses
   * to render.
   */
  const eligibilityRead = readCompleteness(
    employees.status,
    employees.response?.hasMore,
    employees.request.page
  );
  const selfEligible: boolean | null =
    !canPickEmployee ||
    !targetReady ||
    eligibilityRead !== 'complete' ||
    employees.response === null
      ? null
      : eligible.some((row) => row.id === sessionUserId);

  /*
   * What the screen SHOWS and what `submit` sends, as one value.
   *
   * An operator who is not eligible in the branch they are receiving into no
   * longer holds the default: offering it would offer a value
   * `rec.stamp_receiving_employee_identity()` refuses, so the create would
   * fail at a database guard instead of at a choice.
   */
  const employee =
    selfEligible === false && chosenEmployee.id === sessionUserId
      ? { id: '', label: '' }
      : chosenEmployee;

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
      walkInVehicleId: effectiveVehicle?.vehicleId ?? null,
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
                {translate(messages, HANDOFF_NOTICE_KEYS[handoffVerdict])}
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
                    chosen={effectiveVehicle}
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
      ) : openVisitAsked && openVisitLookup !== 'none' ? (
        /*
         * No resume offer, and WHY there is none.
         *
         * The absence of the banner above used to be the whole answer, which
         * made "this vehicle is free" and "we could not find out" the same
         * screen. Only `none` — a read that covered the set and found nothing —
         * is entitled to say nothing.
         */
        <div
          role="status"
          data-testid="open-visit-lookup"
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface-subtle p-4"
        >
          <p className="text-body text-text-secondary" lang={locale}>
            {translate(messages, OPEN_VISIT_NOTICE_KEYS[openVisitLookup])}
          </p>
          {OPEN_VISIT_REFERENCED.includes(openVisitLookup) && visits.correlationId ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'state.correlationId')}{' '}
              <code className="font-mono">{visits.correlationId}</code>
            </p>
          ) : null}
          {OPEN_VISIT_RETRYABLE.includes(openVisitLookup) ? (
            <div>
              <button
                type="button"
                onClick={visits.refresh}
                className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {translate(messages, 'state.retry')}
              </button>
            </div>
          ) : null}
          {openVisitLookup === 'truncated' ? (
            <CursorPager
              messages={messages}
              table={visits}
              label={translate(messages, 'receptions.checkIn.openVisitPagerLabel')}
            />
          ) : null}
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
          targetReady={targetReady}
          table={employees}
          eligible={eligible}
          selfEligible={selfEligible}
          sessionUserId={sessionUserId}
          sessionUserName={sessionUserName}
          employee={employee}
          onChange={setChosenEmployee}
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
  const completeness = readCompleteness(table.status, table.response?.hasMore, table.request.page);
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-text-secondary">
          {/* "No recorded vehicles" is a claim about the SET, so it is only made
              by a read that covered the set. Linking one is a CRM/Vehicle
              capability, and the sentence points there rather than offering a
              control this screen does not have. */}
          {translate(
            messages,
            completeness === 'truncated'
              ? 'receptions.checkIn.vehiclesTruncated'
              : 'receptions.checkIn.noCustomerVehicles'
          )}
        </p>
        <CursorPager
          messages={messages}
          table={table}
          label={translate(messages, 'receptions.checkIn.vehiclePagerLabel')}
        />
      </div>
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
      {completeness === 'truncated' ? (
        <p data-testid="checkin-vehicles-truncated" className="mt-1 text-caption text-text-muted">
          {translate(messages, 'receptions.checkIn.vehiclesTruncated')}
        </p>
      ) : null}
      <div className="mt-2">
        <CursorPager
          messages={messages}
          table={table}
          label={translate(messages, 'receptions.checkIn.vehiclePagerLabel')}
        />
      </div>
    </div>
  );
}

/**
 * The receiving-employee control (Owner decision `FE-007`).
 *
 * PRESENTATIONAL. The screen above owns the eligible-list read and derives which
 * account is selected, so what an operator sees and what `submit` sends are one
 * value rather than two kept in step by an effect. The first shape of this file
 * did read the list here and cleared the parent's selection from a `useEffect`;
 * `react-hooks/set-state-in-effect` refused it, and the rule was right about more
 * than style.
 *
 * ## What it offers, and why the list is short
 *
 * `rec.receiving-employee-list` answers the ACTIVE accounts whose live role
 * grants cover the branch this visit is being received into. It takes no search
 * term, and that is the shape rather than an omission: the question is "who may
 * accept custody here", which is a list an operator scans. The control this
 * replaced searched `iam.user-list` — every account in the tenant, at tenant
 * scope — because there was nothing narrower to read.
 *
 * ## Three eligibility states, and `null` is not `false`
 *
 * `selfEligible` arrives as `true`, `false` or `null`, and only `false` is an
 * observation. `null` means the question was not answered — no capability to
 * ask, no branch chosen, the read still in flight, or the read failed — and
 * saying "you are not eligible" from any of those would be reporting a
 * conclusion nobody reached.
 *
 * ## Before a branch is chosen there is nothing to ask
 *
 * Eligibility is per branch, so the picker withholds itself with a stated reason
 * until `companyId` and `branchId` are both set, rather than reading a list that
 * would answer for the wrong branch or 422 on a half pair.
 */
function EmployeeControl({
  locale,
  messages,
  canPickEmployee,
  targetReady,
  table,
  eligible,
  selfEligible,
  sessionUserId,
  sessionUserName,
  employee,
  onChange,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canPickEmployee: boolean;
  /** Both halves of the branch target are set. Eligibility is per branch. */
  readonly targetReady: boolean;
  readonly table: ServerTable<ReceivingEmployeeCandidate>;
  readonly eligible: readonly ReceivingEmployeeCandidate[];
  /** `null` where the question was not answered. See the docblock. */
  readonly selfEligible: boolean | null;
  readonly sessionUserId: string;
  readonly sessionUserName: string;
  /** The EFFECTIVE selection, already derived by the screen. */
  readonly employee: { readonly id: string; readonly label: string };
  readonly onChange: (next: { readonly id: string; readonly label: string }) => void;
}) {
  const [showing, setShowing] = useState(false);
  // Opened for the operator when their own default was withdrawn: they have to
  // choose somebody, so the list is in front of them rather than behind a button.
  const listOpen = showing || selfEligible === false;

  const chosenLabel =
    employee.id === ''
      ? translate(messages, 'receptions.checkIn.employeeUnset')
      : employee.id === sessionUserId
        ? `${translate(messages, 'receptions.checkIn.employeeSelf')} — ${sessionUserName}`
        : employee.label;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="employee-chosen" className="text-body text-text-primary">
          {chosenLabel}
        </span>
        {employee.id !== sessionUserId && selfEligible !== false ? (
          <button
            type="button"
            onClick={() => onChange({ id: sessionUserId, label: sessionUserName })}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'receptions.checkIn.employeeReset')}
          </button>
        ) : null}
        {canPickEmployee && targetReady ? (
          <button
            type="button"
            onClick={() => setShowing((current) => !current)}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'receptions.checkIn.employeeChoose')}
          </button>
        ) : null}
      </div>

      {selfEligible === false ? (
        <p
          data-testid="employee-self-ineligible"
          role="note"
          className="text-caption text-warning"
          lang={locale}
        >
          {translate(messages, 'receptions.checkIn.employeeSelfIneligible')}
        </p>
      ) : null}

      <p className="text-caption text-text-muted" lang={locale}>
        {/* Stated where the choice is made: the platform records a PLATFORM
            ACCOUNT that accepted custody, not an employee-register entry. */}
        {translate(messages, 'receptions.checkIn.employeeHint')}
      </p>

      {canPickEmployee ? (
        <p
          data-testid="employee-directory-scope"
          className="text-caption text-text-muted"
          lang={locale}
        >
          {/* `P1-28-SEC-001`, stated where the capability is exercised rather
              than only in a document: this control reads the accounts eligible
              for ONE branch, behind the same code that opens a check-in.
              `features/receptions/people/receiving-employee-directory.ts`
              carries the reasoning and what it replaced. */}
          {translate(messages, RECEIVING_EMPLOYEE_NOTICE_KEY)}
        </p>
      ) : null}

      {canPickEmployee && !targetReady ? (
        <p
          data-testid="employee-needs-branch"
          className="text-caption text-text-muted"
          lang={locale}
        >
          {translate(messages, 'receptions.checkIn.employeeNeedsBranch')}
        </p>
      ) : null}

      {listOpen && canPickEmployee && targetReady ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          {table.status === 'loading' ? (
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
          ) : eligible.length === 0 ? (
            <p data-testid="employee-none-eligible" className="text-body text-text-secondary">
              {translate(messages, 'receptions.checkIn.employeeNoneEligible')}
            </p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {eligible.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({ id: row.id, label: row.displayName });
                        setShowing(false);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-start transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      {/* The NAME and nothing else. The operation answers no
                          email and no status — an inactive account is not
                          offered — so there is no second column to render. */}
                      <span className="text-body text-text-primary">{row.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <CursorPager
                messages={messages}
                table={table}
                label={translate(messages, 'receptions.checkIn.employeePagerLabel')}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
