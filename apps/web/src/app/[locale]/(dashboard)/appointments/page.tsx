import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { AppointmentCalendarScreen } from '@/features/appointments/components/AppointmentCalendarScreen';
import { APPOINTMENT_PERMISSIONS } from '@/features/appointments/appointments-contract';
import { holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The branch calendar (`P1-28-FE-001`).
 *
 * The route-level check renders the denial INSTEAD of the screen — it is not
 * the security boundary (`GET /api/v1/appointments` enforces the read
 * permission on every request), it only stops an operator being handed a form
 * whose every submission would come back denied.
 *
 * The session's resolved `companyIds`/`branchIds` are passed down as the
 * OPTIONS for the mandatory branch target — the operation demands the pair as
 * a resource selector, and the resolved scope is the only directory of
 * references this product has. Empty arrays mean unrestricted, and the screen
 * offers typed entry instead, the approval-limits precedent.
 */
export default async function AppointmentsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  if (!holds(session.permissions, APPOINTMENT_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="appointments.calendar.title"
          crumbs={[{ labelKey: 'nav.appointments' }]}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="appointments.calendar.title"
        descriptionKey="appointments.calendar.description"
        crumbs={[{ labelKey: 'nav.appointments' }]}
      />
      <PageBody fill>
        <AppointmentCalendarScreen
          locale={locale}
          messages={messages}
          companyIds={session.companyIds}
          branchIds={session.branchIds}
          canManage={holds(session.permissions, APPOINTMENT_PERMISSIONS.manage)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('appointments.calendar.title');
