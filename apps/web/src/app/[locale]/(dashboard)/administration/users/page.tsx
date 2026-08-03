import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { listGrantableRoles } from '@/features/administration/users/api';
import { UsersScreen } from '@/features/administration/users/components/UsersScreen';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Users.
 *
 * The route-level check renders the denial **instead of** the screen. A screen
 * that mounts and then discovers it is denied has already issued its first read
 * — and if that read succeeded, the data reached the browser before the denial
 * was drawn over it.
 *
 * The check is still not the security boundary. `GET /api/v1/iam/users` requires
 * `iam.user.read` and enforces it server-side on every request; this only stops
 * an operator being shown a table that would come back empty-handed.
 */
export default async function UsersPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  if (!holds(session.permissions, PERMISSIONS.userRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="users.title"
          crumbs={[
            { labelKey: 'nav.administration', href: `/${locale}/administration` },
            { labelKey: 'nav.users' },
          ]}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const canManage = holds(session.permissions, PERMISSIONS.userManage);
  // The invitation form offers roles only to someone who could grant them. The
  // backend bounds the choice by the inviter's own delegable authority anyway,
  // so an empty list here is a narrower offer, never a wider one.
  const roles =
    canManage && holds(session.permissions, PERMISSIONS.roleRead) ? await listGrantableRoles() : [];

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="users.title"
        descriptionKey="users.description"
        crumbs={[
          { labelKey: 'nav.administration', href: `/${locale}/administration` },
          { labelKey: 'nav.users' },
        ]}
      />
      <PageBody>
        <UsersScreen
          locale={locale}
          messages={messages}
          canManage={canManage}
          canRevokeSessions={holds(session.permissions, PERMISSIONS.sessionViewAll)}
          roles={roles}
        />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('users.title');
