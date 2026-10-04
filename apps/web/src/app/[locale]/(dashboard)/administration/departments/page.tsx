import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { DepartmentsScreen } from '@/features/administration/departments/components/DepartmentsScreen';
import { listBranches, listCompanies } from '@/features/administration/organization/api';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Departments.
 *
 * Gated on `org.department.read`, the code `org.department-list` declares, and
 * decided BEFORE any read. Choosing a branch needs the branch list as well, so
 * `org.branch.read` is part of the gate: without it the screen could show
 * nothing but an empty picker. Creating, renaming and retiring appear only with
 * `org.department.manage`; the server refuses them without it either way.
 */
export default async function DepartmentsPage({
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
    { labelKey: 'nav.departments' },
  ];

  if (
    !holds(session.permissions, PERMISSIONS.departmentRead) ||
    !holds(session.permissions, PERMISSIONS.branchRead)
  ) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="departments.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const branches = await listBranches();
  const companies = holds(session.permissions, PERMISSIONS.companyRead)
    ? await listCompanies()
    : null;

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="departments.title"
        descriptionKey="departments.description"
        crumbs={crumbs}
      />
      <PageBody>
        <DepartmentsScreen
          messages={messages}
          branches={branches}
          companies={companies?.status === 'ok' ? companies.data : []}
          canManage={holds(session.permissions, PERMISSIONS.departmentManage)}
        />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('departments.title');
