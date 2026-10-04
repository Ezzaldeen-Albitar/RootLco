import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { readDepartmentNames } from '@/features/administration/departments/api';
import { listBranches, listCompanies } from '@/features/administration/organization/api';
import { ReadBoundary } from '@/features/administration/shared/components/ScreenStates';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { readUserAccess } from '@/features/administration/users/api';
import { UserAccessScreen } from '@/features/administration/users/components/UserAccessScreen';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One user's roles and where each applies.
 *
 * Gated on `iam.user.read`, the code `iam.user-detail` declares, and decided
 * BEFORE any read. Every further read is decided by its own code first: grant
 * scopes and role names by `iam.role.read`, company and branch names by
 * `org.company.read` and `org.branch.read`, department names by
 * `org.department.read`. Granting, adding and removing places appear only with
 * `iam.grant.manage`, and the server refuses them without it either way.
 */
export default async function UserAccessPage({
  params,
}: {
  readonly params: Promise<{ locale: string; userId: string }>;
}) {
  const { locale, userId } = await params;
  if (!isLocale(locale)) notFound();
  if (!UUID.test(userId)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.administration', href: `/${locale}/administration` },
    { labelKey: 'nav.users', href: `/${locale}/administration/users` },
    { labelKey: 'users.access.title' },
  ];

  if (!holds(session.permissions, PERMISSIONS.userRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="users.access.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const canReadRoles = holds(session.permissions, PERMISSIONS.roleRead);
  const canReadDepartments =
    holds(session.permissions, PERMISSIONS.departmentRead) &&
    holds(session.permissions, PERMISSIONS.branchRead);

  const access = await readUserAccess(userId, canReadRoles);
  const companies = holds(session.permissions, PERMISSIONS.companyRead)
    ? await listCompanies()
    : null;
  const branches = holds(session.permissions, PERMISSIONS.branchRead) ? await listBranches() : null;

  // Department names only for the branches a department place names, and only
  // when the session may read departments.
  const departmentNames = canReadDepartments
    ? await readDepartmentNames(access.grants.flatMap((grant) => grant.scopes ?? []))
    : {};

  const state =
    access.status === 'ok' && access.user !== null
      ? { status: 'ok' as const, data: access.user, correlationId: access.correlationId }
      : {
          status: access.status === 'ok' ? ('error' as const) : access.status,
          correlationId: access.correlationId,
        };

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="users.access.title"
        descriptionKey="users.access.description"
        crumbs={crumbs}
      />
      <PageBody>
        <ReadBoundary state={state} messages={messages}>
          {(user) => (
            <UserAccessScreen
              locale={locale}
              messages={messages}
              user={user}
              grants={access.grants}
              roles={access.roles}
              companies={companies?.status === 'ok' ? companies.data : []}
              branches={branches?.status === 'ok' ? branches.data : []}
              departmentNames={departmentNames}
              canManageGrants={holds(session.permissions, PERMISSIONS.grantManage)}
              canReadRoles={canReadRoles}
              canReadDepartments={canReadDepartments}
            />
          )}
        </ReadBoundary>
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('users.access.title');
