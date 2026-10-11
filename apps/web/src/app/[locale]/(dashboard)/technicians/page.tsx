import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { TechnicianRosterScreen } from '@/features/technicians/components/TechnicianRosterScreen';
import { TECHNICIAN_ROSTER_PERMISSIONS } from '@/features/technicians/roster-types';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The technician roster of one branch (`P1-32-PRE-OD-ADM2B`).
 *
 * Gated on `tech.technician.read`, the code `tech.technician-list` declares, and
 * decided BEFORE any read — the rule `check-p1-29-access.mjs` enforces. Adding a
 * technician appears only with `tech.technician.manage`; the person picker on it
 * searches only with `iam.user.read`, and without it the add is withheld with a
 * sentence saying why. These are affordances: the server decides every request
 * again against the branch it names.
 *
 * Every technician holds `tech.technician.read` for their own queue, so a plain
 * technician can still open this page by address and read the roster the server
 * answers them. The sidebar does not advertise it to them: its roster entry needs
 * `tech.technician.manage` too, and the module link names `/technicians/me`.
 */
export default async function TechnicianRosterPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.technicianRoster' }];

  if (!holds(session.permissions, TECHNICIAN_ROSTER_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="technicians.roster.title"
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
        titleKey="technicians.roster.title"
        descriptionKey="technicians.roster.description"
        crumbs={crumbs}
      />
      <PageBody>
        <TechnicianRosterScreen
          messages={messages}
          locale={locale}
          canManage={holds(session.permissions, TECHNICIAN_ROSTER_PERMISSIONS.manage)}
          canReadUsers={holds(session.permissions, TECHNICIAN_ROSTER_PERMISSIONS.userRead)}
        />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('technicians.roster.title');
