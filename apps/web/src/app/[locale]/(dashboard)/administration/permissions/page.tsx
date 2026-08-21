import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { allRoles } from '@/features/administration/access/api';
import { PermissionsScreen } from '@/features/administration/access/components/PermissionsScreen';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Permissions.
 *
 * The role list is read on the server so the screen opens with a role already
 * chosen. Without it the first paint is an empty picker and an empty table,
 * which reads as "there are no permissions" rather than "choose a role".
 */
export default async function PermissionsPage({
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
    { labelKey: 'nav.permissions' },
  ];

  if (!holds(session.permissions, PERMISSIONS.roleRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="permissions.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const roles = await allRoles();

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="permissions.title"
        descriptionKey="permissions.description"
        crumbs={crumbs}
      />
      <PageBody>
        <PermissionsScreen
          messages={messages}
          roles={roles}
          canManage={holds(session.permissions, PERMISSIONS.roleManage)}
        />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('permissions.title');
