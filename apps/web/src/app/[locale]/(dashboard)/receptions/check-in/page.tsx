import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { PERMISSIONS as ADMIN_PERMISSIONS } from '@/features/administration/shared/permissions';
import { APPOINTMENT_PERMISSIONS } from '@/features/appointments/appointments-contract';
import { CRM_PERMISSIONS, holds } from '@/features/crm/permissions';
import { listFuelLevels, type IntakeCatalogueResult } from '@/features/receptions/catalogue-api';
import { CheckInStartScreen } from '@/features/receptions/components/CheckInStartScreen';
import { RECEPTION_PERMISSIONS } from '@/features/receptions/receptions-contract';
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
 */
export default async function CheckInStartPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const crumbs = [
    { labelKey: 'nav.receptions', href: `/${locale}/receptions/check-in` },
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

  const EMPTY_CATALOGUE: IntakeCatalogueResult = {
    status: 'ok',
    options: [],
    truncated: false,
    correlationId: null,
  };
  const fuelLevels = canCreate ? await listFuelLevels() : EMPTY_CATALOGUE;

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
          canPickEmployee={holds(session.permissions, ADMIN_PERMISSIONS.userRead)}
          canSearchCustomers={holds(session.permissions, CRM_PERMISSIONS.customerRead)}
          fuelLevels={fuelLevels}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('receptions.checkIn.title');
