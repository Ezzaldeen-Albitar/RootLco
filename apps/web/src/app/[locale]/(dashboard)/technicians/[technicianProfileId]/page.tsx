import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { TechnicianProfileScreen } from '@/features/technicians/components/TechnicianProfileScreen';
import { TECHNICIAN_ROSTER_PERMISSIONS } from '@/features/technicians/roster-types';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One technician's profile (`P1-32-PRE-OD-ADM2B`), reached by its address.
 *
 * Gated on `tech.technician.read`, the code `tech.technician-detail` declares,
 * and decided BEFORE any read. Every change appears only with
 * `tech.technician.manage`; recording a certificate number also needs
 * `iam.sensitive.view`, the second code that operation declares. The profile's
 * own branch decides the rest, on the server.
 */
export default async function TechnicianProfilePage({
  params,
}: {
  readonly params: Promise<{ locale: string; technicianProfileId: string }>;
}) {
  const { locale, technicianProfileId } = await params;
  if (!isLocale(locale)) notFound();
  if (!UUID.test(technicianProfileId)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.technicians', href: `/${locale}/technicians` },
    { labelKey: 'technicians.profile.title' },
  ];

  if (!holds(session.permissions, TECHNICIAN_ROSTER_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="technicians.profile.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const canManage = holds(session.permissions, TECHNICIAN_ROSTER_PERMISSIONS.manage);

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="technicians.profile.title"
        descriptionKey="technicians.profile.description"
        crumbs={crumbs}
      />
      <PageBody>
        <TechnicianProfileScreen
          messages={messages}
          locale={locale}
          technicianProfileId={technicianProfileId}
          canManage={canManage}
          canRecordSensitive={
            canManage && holds(session.permissions, TECHNICIAN_ROSTER_PERMISSIONS.sensitiveView)
          }
        />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('technicians.profile.title');
