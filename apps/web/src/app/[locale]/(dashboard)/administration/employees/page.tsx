import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { EmployeesScreen } from '@/features/administration/employees/components/EmployeesScreen';
import { listLoginAccounts } from '@/features/administration/employees/api';
import { listBranches, listCompanies } from '@/features/administration/organization/api';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Employees.
 *
 * Gated on `org.employee.read`, the code `org.employee-list` declares, together
 * with `org.branch.read` for the branch picker, and decided BEFORE any read.
 * Adding, retiring and reinstating appear only with `org.employee.manage`. The
 * login-account picker is read only when the session holds `iam.user.read` and
 * may add employees; otherwise the link is simply not offered.
 */
export default async function EmployeesPage({
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
    { labelKey: 'nav.employees' },
  ];

  if (
    !holds(session.permissions, PERMISSIONS.employeeRead) ||
    !holds(session.permissions, PERMISSIONS.branchRead)
  ) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="employees.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const canManage = holds(session.permissions, PERMISSIONS.employeeManage);
  const branches = await listBranches();
  const companies = holds(session.permissions, PERMISSIONS.companyRead)
    ? await listCompanies()
    : null;
  const loginAccounts =
    canManage && holds(session.permissions, PERMISSIONS.userRead) ? await listLoginAccounts() : [];

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="employees.title"
        descriptionKey="employees.description"
        crumbs={crumbs}
      />
      <PageBody>
        <EmployeesScreen
          messages={messages}
          branches={branches}
          companies={companies?.status === 'ok' ? companies.data : []}
          loginAccounts={loginAccounts}
          canManage={canManage}
        />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('employees.title');
