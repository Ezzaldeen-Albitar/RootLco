import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import {
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { AppointmentDetailScreen } from '@/features/appointments/components/AppointmentDetailScreen';
import { APPOINTMENT_PERMISSIONS } from '@/features/appointments/appointments-contract';
import { readAppointment } from '@/features/appointments/api';
import { listCancellationReasons } from '@/features/appointments/catalogue-api';
import type { IntakeCatalogueResult } from '@/features/appointments/catalogue-api';
import { holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One appointment (`P1-28-FE-001` detail; hosts `FE-003`/`FE-004`/`FE-005`).
 *
 * Two permissions, two different questions: `apt.appointment.manage` is
 * arranging (reschedule/confirm), `apt.appointment.lifecycle.manage` is ENDING
 * (cancel, no-show) — a separate authority, deliberately. The read gates the
 * page; the other two gate panels inside it.
 *
 * The detail read is also where every guarded command's `If-Match` comes from
 * (QA-004): the returned `recordVersion` travels into the screen, and after
 * each successful command the page re-reads.
 *
 * The cancellation-reason catalogue is read only for a holder of the
 * lifecycle permission — a denied operator never spends a request discovering
 * a picker they cannot use. One branch per read outcome, in the same order as
 * the vehicle-profile twin, expired handled distinctly so an ended session is
 * never reported as a fault.
 */
export default async function AppointmentDetailPage({
  params,
}: {
  readonly params: Promise<{ locale: string; appointmentId: string }>;
}) {
  const { locale, appointmentId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const frame = (body: ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="appointments.detail.title"
        crumbs={[
          { labelKey: 'nav.appointments', href: `/${locale}/appointments` },
          { labelKey: 'appointments.detail.title' },
        ]}
      />
      <PageBody>{body}</PageBody>
    </>
  );

  if (!holds(session.permissions, APPOINTMENT_PERMISSIONS.read)) {
    // Decided here, before any request — nothing was called, so there is no
    // reference to carry, unlike the backend denial below.
    return frame(<PermissionDeniedState messages={messages} />);
  }

  const result = await readAppointment(appointmentId);

  if (result.status === 'denied') {
    return frame(
      <PermissionDeniedState
        messages={messages}
        correlationId={result.correlationId ?? undefined}
      />
    );
  }

  if (result.status === 'not-found') {
    return frame(<NotFoundState messages={messages} />);
  }

  if (result.status === 'expired') {
    // No retry control, deliberately: re-issuing the same request with the
    // same dead session fails identically.
    return frame(<SessionExpiredState messages={messages} />);
  }

  if (result.status !== 'ok') {
    return frame(
      <ErrorState messages={messages} correlationId={result.correlationId ?? undefined} />
    );
  }

  const canEndLifecycle = holds(session.permissions, APPOINTMENT_PERMISSIONS.lifecycleManage);
  const cancellationReasons: IntakeCatalogueResult | null = canEndLifecycle
    ? await listCancellationReasons()
    : null;

  return frame(
    <AppointmentDetailScreen
      locale={locale}
      messages={messages}
      detail={result.data}
      canManage={holds(session.permissions, APPOINTMENT_PERMISSIONS.manage)}
      canEndLifecycle={canEndLifecycle}
      cancellationReasons={cancellationReasons}
    />
  );
}

export const generateMetadata = pageMetadata('appointments.detail.title');
