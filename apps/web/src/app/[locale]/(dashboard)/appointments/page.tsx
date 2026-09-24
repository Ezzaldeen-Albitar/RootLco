import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { AppointmentCalendarScreen } from '@/features/appointments/components/AppointmentCalendarScreen';
import { APPOINTMENT_PERMISSIONS } from '@/features/appointments/appointments-contract';
import { holds } from '@/features/crm/permissions';
import { RECEPTION_PERMISSIONS } from '@/features/receptions/receptions-contract';
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
 * The branch is not passed down. It is the working context's own named
 * selection, read by the screen from the header: the session publishes bare
 * references with no names on them, and an unrestricted grant publishes them as
 * empty arrays, so neither half could ever be shown to an operator.
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
          canManage={holds(session.permissions, APPOINTMENT_PERMISSIONS.manage)}
          /*
           * The day queue's arrival affordance leads to `rec.reception-create`,
           * so it is gated on THAT operation's permission rather than on an
           * appointment code. Gating a control on a code the operation behind it
           * does not require is the defect `P1-26-F-011` and `P1-26-F-029` both
           * recorded.
           */
          canCheckIn={holds(session.permissions, RECEPTION_PERMISSIONS.manage)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('appointments.calendar.title');
