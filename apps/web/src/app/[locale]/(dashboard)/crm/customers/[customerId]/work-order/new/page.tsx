import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import {
  BackendUnavailableState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { CRM_PERMISSIONS, VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';
import { CustomerWorkOrderStartScreen } from '@/features/receptions/intake/components/CustomerWorkOrderStartScreen';
import { RECEPTION_PERMISSIONS } from '@/features/receptions/receptions-contract';
import { readCustomerSummary } from '@/features/receptions/support-api';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The vehicle step of the customer-first route into reception
 * (`P1-32-PRE-077`, the Owner requirement of 2026-09-17).
 *
 * The customer profile offers "New work order" and lands here. The customer is
 * therefore already decided; the vehicle is not, and the reception flow cannot
 * open a visit without one — `rec.reception-create` takes a `vehicleId`. So the
 * one question this route asks is which vehicle, and its only way onward is the
 * EXISTING check-in start screen, reached through the same query the walk-in
 * intake already uses (`intake-handoff.ts`).
 *
 * ## The gate is the code the act itself requires
 *
 * Opening a visit is `rec.reception-create`, and that operation declares
 * `rec.reception.manage`. So that is the code here: the whole purpose of this
 * route is to reach the form behind it, and walking somebody through a vehicle
 * choice into a denial is worse than not offering the route.
 *
 * `rec.reception.read` is deliberately NOT consulted. It gates the check-in
 * page's own resume path — finding an open visit — which is not what this route
 * leads to, and no operation reachable from here requires it; demanding a code
 * nothing reachable needs is the surplus privilege
 * `scripts/ci/check-p1-28-access.mjs` exists to catch.
 *
 * `crm.customer.read` IS consulted, because the step names the customer and
 * lists that customer's vehicles, and both are that code. No permission is
 * invented here, and neither gate is the security boundary: the backend
 * re-checks every request.
 *
 * ## The customer is read HERE
 *
 * Exactly as the check-in start screen resolves its handoff: a preselected
 * customer is displayed by NAME, and the browser is never the source of one. A
 * customer that does not read back is the page's state — not-found, denied,
 * ended session or unavailable — rather than a step rendered around an
 * identifier nobody could resolve.
 */
export default async function CustomerWorkOrderStartPage({
  params,
}: {
  readonly params: Promise<{ locale: string; customerId: string }>;
}) {
  const { locale, customerId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const crumbs = [
    { labelKey: 'nav.customers', href: `/${locale}/crm/customers` },
    { labelKey: 'crm.customers.profile.title', href: `/${locale}/crm/customers/${customerId}` },
    { labelKey: 'receptions.workOrderStart.title' },
  ];

  const frame = (body: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="receptions.workOrderStart.title"
        crumbs={crumbs}
      />
      <PageBody>{body}</PageBody>
    </>
  );

  if (
    !holds(session.permissions, CRM_PERMISSIONS.customerRead) ||
    !holds(session.permissions, RECEPTION_PERMISSIONS.manage)
  ) {
    return frame(<PermissionDeniedState messages={messages} />);
  }

  const customer = await readCustomerSummary(customerId);

  if (customer.status === 'denied') {
    return frame(
      <PermissionDeniedState
        messages={messages}
        correlationId={customer.correlationId ?? undefined}
      />
    );
  }
  if (customer.status === 'not-found') return frame(<NotFoundState messages={messages} />);
  if (customer.status === 'expired') return frame(<SessionExpiredState messages={messages} />);
  if (customer.status !== 'ok') {
    return frame(
      <BackendUnavailableState
        messages={messages}
        correlationId={customer.correlationId ?? undefined}
      />
    );
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="receptions.workOrderStart.title"
        descriptionKey="receptions.workOrderStart.description"
        crumbs={crumbs}
      />
      <PageBody>
        <CustomerWorkOrderStartScreen
          locale={locale}
          messages={messages}
          customer={{
            id: customer.data.id,
            displayName: customer.data.displayName,
            displayNumber: customer.data.displayNumber,
            partyType: customer.data.partyType,
          }}
          canSearchVehicles={holds(session.permissions, VEHICLE_PERMISSIONS.vehicleRead)}
          canCreateVehicle={holds(session.permissions, VEHICLE_PERMISSIONS.vehicleManage)}
          canLinkVehicle={holds(session.permissions, CRM_PERMISSIONS.vehicleManage)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('receptions.workOrderStart.title');
