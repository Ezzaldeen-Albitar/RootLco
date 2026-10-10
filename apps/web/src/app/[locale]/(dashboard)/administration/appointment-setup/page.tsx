import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { AppointmentSetupScreen } from '@/features/appointments/components/AppointmentSetupScreen';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Appointment setup (Owner decision 2026-09-29).
 *
 * The organisation's own appointment types, booking channels and cancellation
 * reasons. Nothing is preset: every list starts empty and the organisation enters
 * its own. Gated on `apt.catalogue.manage` — the code all twelve operations the
 * screen calls declare — and decided BEFORE anything is read, so a denied operator
 * costs nothing and learns the true state.
 *
 * Tenant-wide (route scope `none`): the entries belong to the organisation, not to
 * a branch, so the screen neither reads nor asks for the working branch.
 */
export default async function AppointmentSetupPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.administration', href: `/${locale}/administration` },
    { labelKey: 'nav.appointmentSetup' },
  ];

  if (!holds(session.permissions, PERMISSIONS.appointmentCatalogueManage)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="appointmentSetup.title"
          crumbs={crumbs}
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
        titleKey="appointmentSetup.title"
        descriptionKey="appointmentSetup.description"
        crumbs={crumbs}
      />
      <PageBody>
        <AppointmentSetupScreen locale={locale} messages={messages} />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('appointmentSetup.title');
