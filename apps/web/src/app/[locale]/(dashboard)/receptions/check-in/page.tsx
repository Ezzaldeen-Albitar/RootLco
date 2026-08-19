import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { APPOINTMENT_PERMISSIONS } from '@/features/appointments/appointments-contract';
import { CRM_PERMISSIONS, holds } from '@/features/crm/permissions';
import { listFuelLevels, type IntakeCatalogueResult } from '@/features/receptions/catalogue-api';
import {
  CheckInStartScreen,
  type WalkInHandoffStart,
} from '@/features/receptions/components/CheckInStartScreen';
import { walkInHandoffFromQuery } from '@/features/receptions/intake/intake-handoff';
import { RECEIVING_EMPLOYEE_PERMISSION } from '@/features/receptions/people/receiving-employee-directory';
import { RECEPTION_PERMISSIONS } from '@/features/receptions/receptions-contract';
import { readCustomerSummary } from '@/features/receptions/support-api';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The check-in start screen (`P1-28-FE-007`).
 *
 * Two permissions, two different questions:
 *
 * - `rec.reception.read` gates the PAGE — the resume path is a read
 *   (`rec.reception-list` + `rec.reception-detail`), and an operator who may
 *   only read still has a legitimate reason to be here: finding the open visit.
 * - `rec.reception.manage` gates OPENING a visit; without it the screen states
 *   the denial where the create form would be, rather than hiding the page.
 *
 * The auxiliary capabilities are resolved HERE, before any request, and passed
 * as booleans: the appointment picker (`apt.appointment.read`), the customer
 * search and vehicle list (`crm.customer.read`), and the receiving-employee
 * picker (`iam.user.read` — a stand-in for an employee master that does not
 * exist; the named open decision G-EMP is stated on the screen itself).
 *
 * The fuel-level catalogue is read on the server so the first paint has a
 * usable picker — and only when the operator can actually create, so a
 * read-only visitor never spends the read discovering a form they cannot use.
 *
 * ## The walk-in handoff arrives here, in the query
 *
 * The walk-in intake (`P1-28-FE-006`) ends holding the customer and the vehicle
 * and links here carrying both. This page is where that link is READ:
 * `walkInHandoffFromQuery` delegates to `parseWalkInHandoff`, which refuses a
 * half or malformed pair, and the customer's NAME is resolved server-side
 * (`crm.customer-read`) because the screen renders names and never identifiers.
 * Anything that does not resolve to a nameable customer is not a handoff — the
 * screen receives `null` and starts empty, which is the same state as arriving
 * from the navigation. See `resolveWalkInHandoff` below.
 */
export default async function CheckInStartPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const crumbs = [
    { labelKey: 'nav.receptions', href: `/${locale}/receptions` },
    { labelKey: 'receptions.checkIn.title' },
  ];

  if (!holds(session.permissions, RECEPTION_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="receptions.checkIn.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const canCreate = holds(session.permissions, RECEPTION_PERMISSIONS.manage);
  const canSearchCustomers = holds(session.permissions, CRM_PERMISSIONS.customerRead);
  /*
   * The code the OPERATION declares, imported from the module that owns the
   * directory rather than spelled again here. This read `iam.user.read`, left
   * over from when the only staff read was the tenant-wide IAM directory. The
   * operation behind the picker declares `rec.reception.manage`
   * (`reception-catalogue/receiving-employees/route.ts`), and
   * `CheckInStartScreen`'s own docblock said so while this page did not.
   *
   * Behaviourally inert today, in both directions, and the alignment is the
   * point rather than a defect closed. `GET /api/v1/auth/session` itself
   * declares `iam.user.read`, so nobody who reaches this dashboard lacks it;
   * and `CheckInStartScreen` returns `PermissionDeniedState` when `canCreate`
   * is false, so the effective gate on the whole form already was
   * `rec.reception.manage`. What was wrong is that the page, the screen's
   * docblock, the operation and the binding test did not all name the same code
   * — and the binding test pinned the superseded one, so agreeing with the
   * operation used to turn it red.
   */
  const canPickEmployee = holds(session.permissions, RECEIVING_EMPLOYEE_PERMISSION);

  const EMPTY_CATALOGUE: IntakeCatalogueResult = {
    status: 'ok',
    options: [],
    truncated: false,
    correlationId: null,
  };
  const fuelLevels = canCreate ? await listFuelLevels() : EMPTY_CATALOGUE;
  const walkInHandoff = await resolveWalkInHandoff(
    await searchParams,
    canCreate && canSearchCustomers
  );

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="receptions.checkIn.title"
        descriptionKey="receptions.checkIn.description"
        crumbs={crumbs}
      />
      <PageBody>
        <CheckInStartScreen
          locale={locale}
          messages={messages}
          sessionUserId={session.userId}
          sessionUserName={session.displayName}
          companyIds={session.companyIds}
          branchIds={session.branchIds}
          canCreate={canCreate}
          canListAppointments={holds(session.permissions, APPOINTMENT_PERMISSIONS.read)}
          canPickEmployee={canPickEmployee}
          canSearchCustomers={canSearchCustomers}
          fuelLevels={fuelLevels}
          walkInHandoff={walkInHandoff}
        />
      </PageBody>
    </>
  );
}

/**
 * The handed-over pair, turned into something the screen can render.
 *
 * Three refusals, all of them "start empty" rather than an error state, because
 * an operator who navigated here directly is in exactly the same position:
 *
 *   - `allowed` is false — the pre-selection would fill a form this operator
 *     cannot submit, or name a customer they may not read. No request is spent
 *     discovering that.
 *   - the query is not a complete, well-formed pair (`parseWalkInHandoff`).
 *   - the customer does not read back. A pre-selected customer is displayed by
 *     NAME; a failed read leaves only a uuid, and this screen renders none.
 *
 * The vehicle identifier travels on as an identifier: what the form submits is
 * a row from that customer's own vehicle list, so the screen matches it there
 * rather than reading the vehicle a second time.
 */
async function resolveWalkInHandoff(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
  allowed: boolean
): Promise<WalkInHandoffStart | null> {
  if (!allowed) return null;

  const handoff = walkInHandoffFromQuery(searchParams);
  if (handoff === null) return null;

  const customer = await readCustomerSummary(handoff.customerId);
  if (customer.status !== 'ok') return null;

  return {
    requester: {
      id: customer.data.id,
      displayName: customer.data.displayName,
      displayNumber: customer.data.displayNumber,
      partyType: customer.data.partyType,
    },
    vehicleId: handoff.vehicleId,
  };
}

export const generateMetadata = pageMetadata('receptions.checkIn.title');
