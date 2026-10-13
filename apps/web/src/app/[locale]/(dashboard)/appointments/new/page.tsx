import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { AppointmentBookingScreen } from '@/features/appointments/components/AppointmentBookingScreen';
import { APPOINTMENT_PERMISSIONS } from '@/features/appointments/appointments-contract';
import { listAppointmentTypes, listSourceChannels } from '@/features/appointments/catalogue-api';
import { holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The booking form (`P1-28-FE-002`).
 *
 * Gated on `apt.appointment.manage` — the code `apt.appointment-create`
 * registers — checked BEFORE the catalogue reads so a denied operator costs
 * nothing and learns the true state.
 *
 * Both intake catalogues are read here, once, on the server, and the whole
 * OUTCOME travels to the screen: "failed", "truncated" and "empty" are three
 * different renderable facts (the vehicle-search Make column precedent), and
 * an empty catalogue in particular is the no-fake-data policy working — the
 * screen says "not configured", never "error". A holder of `apt.catalogue.manage`
 * is shown the way to the appointment setup screen from an empty type catalogue
 * (Owner decision 2026-09-29); the capability is decided here, not in the screen.
 */
export default async function AppointmentBookingPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const frame = (body: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="appointments.book.title"
        descriptionKey="appointments.book.description"
        crumbs={[
          { labelKey: 'nav.appointments', href: `/${locale}/appointments` },
          { labelKey: 'appointments.book.title' },
        ]}
      />
      <PageBody>{body}</PageBody>
    </>
  );

  if (!holds(session.permissions, APPOINTMENT_PERMISSIONS.manage)) {
    return frame(<PermissionDeniedState messages={messages} />);
  }

  const [types, channels] = await Promise.all([listAppointmentTypes(), listSourceChannels()]);

  return frame(
    <AppointmentBookingScreen
      locale={locale}
      messages={messages}
      types={types}
      channels={channels}
      canSetUpCatalogue={holds(session.permissions, APPOINTMENT_PERMISSIONS.catalogueManage)}
    />
  );
}

export const generateMetadata = pageMetadata('appointments.book.title');
