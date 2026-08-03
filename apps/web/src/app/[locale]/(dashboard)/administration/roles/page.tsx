import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { RolesScreen } from '@/features/administration/access/components/RolesScreen';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * Roles.
 *
 * The route-level check renders the denial INSTEAD of the screen, so a denied
 * visitor never causes the first list read to be issued. `GET /iam/roles`
 * enforces `iam.role.read` server-side regardless; this only stops an operator
 * being shown a table that would come back empty-handed.
 */
export default async function RolesPage({
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
    { labelKey: 'nav.roles' },
  ];

  if (!holds(session.permissions, PERMISSIONS.roleRead)) {
    return (
      <>
        <PageHeader locale={locale} messages={messages} titleKey="roles.title" crumbs={crumbs} />
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
        titleKey="roles.title"
        descriptionKey="roles.description"
        crumbs={crumbs}
      />
      <PageBody>
        <RolesScreen
          messages={messages}
          canManage={holds(session.permissions, PERMISSIONS.roleManage)}
        />
      </PageBody>
    </>
  );
}
