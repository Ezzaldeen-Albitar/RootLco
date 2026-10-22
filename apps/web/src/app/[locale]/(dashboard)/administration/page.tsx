import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { requireSession } from '@/features/authentication/api/session';
import {
  PERMISSIONS,
  holds,
  type AdministrationPermission,
} from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages, translate, type Messages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The administration hub.
 *
 * A map, not a dashboard: no counts, no queues, no "12 users pending". There is
 * no operation that returns those numbers, and a screen full of plausible zeros
 * reads as a working product that happens to be empty.
 *
 * Each card is shown only when the actor holds what its screen needs, so an
 * entry an operator cannot open is never offered: a door with no handle.
 *
 * ## Every code its page asks for (`P1-32-PRE-OD-ADM6`)
 *
 * `permission` and `orPermissions` are taken from the entry's navigation item
 * (`config/navigation.ts`). Each `orPermissions` code stands in for
 * `permission`: holding any one of them is enough. `alsoRequires` is all-of:
 * every code in it is needed besides. An entry may ask for more than its
 * navigation item where its page refuses without a further code (departments
 * and employees list one branch's records and need the branch read), so the hub
 * is not claimed to match the sidebar entry for entry. The hub cases in
 * `tests/audit-log.dom.test.tsx` render the gated pages and hold the hub to
 * what they draw.
 *
 * No technician roster entry: technicians sit in the sidebar outside
 * `/administration`, where the entry opens the technician's own workspace
 * (`/technicians/me`); no roster page exists yet (`config/navigation.ts`).
 */

interface Entry {
  readonly href: string;
  readonly labelKey: string;
  readonly permission: AdministrationPermission;
  /**
   * Codes that each stand in for `permission`, exactly as the sidebar entry's
   * `orPermissions`: for a screen that shows something to any one of them.
   */
  readonly orPermissions?: readonly AdministrationPermission[];
  /**
   * Codes that are ALL required as well, exactly as the sidebar entry's
   * `alsoRequires`.
   */
  readonly alsoRequires?: readonly AdministrationPermission[];
}

const SECTIONS: readonly {
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly entries: readonly Entry[];
}[] = [
  {
    titleKey: 'admin.section.identity',
    bodyKey: 'admin.section.identityBody',
    entries: [
      { href: '/administration/users', labelKey: 'nav.users', permission: PERMISSIONS.userRead },
      {
        href: '/administration/departments',
        labelKey: 'nav.departments',
        permission: PERMISSIONS.departmentRead,
        // The page lists one branch's departments and refuses without the
        // branch read (`administration/departments/page.tsx`).
        alsoRequires: [PERMISSIONS.branchRead],
      },
      {
        href: '/administration/employees',
        labelKey: 'nav.employees',
        permission: PERMISSIONS.employeeRead,
        alsoRequires: [PERMISSIONS.branchRead],
      },
      { href: '/administration/roles', labelKey: 'nav.roles', permission: PERMISSIONS.roleRead },
      {
        href: '/administration/permissions',
        labelKey: 'nav.permissions',
        permission: PERMISSIONS.roleRead,
      },
      {
        href: '/administration/approval-limits',
        labelKey: 'nav.approvalLimits',
        permission: PERMISSIONS.approvalManage,
      },
      {
        href: '/administration/discount-threshold',
        labelKey: 'nav.discountThreshold',
        permission: PERMISSIONS.priceRead,
      },
    ],
  },
  {
    titleKey: 'admin.section.configuration',
    bodyKey: 'admin.section.configurationBody',
    entries: [
      {
        href: '/administration/organization',
        labelKey: 'nav.organization',
        permission: PERMISSIONS.tenantRead,
      },
      {
        href: '/administration/numbering-rules',
        labelKey: 'nav.numberingRules',
        // See navigation.ts: read only, the company settings or the branch
        // settings, whichever the session may read.
        permission: PERMISSIONS.companyRead,
        orPermissions: [PERMISSIONS.branchRead],
      },
      {
        href: '/administration/taxes',
        labelKey: 'nav.taxes',
        // See navigation.ts: read only, as Numbering rules; never
        // `org.tax.manage` (P1-26-F-029).
        permission: PERMISSIONS.companyRead,
        orPermissions: [PERMISSIONS.branchRead],
      },
      {
        href: '/administration/currencies',
        labelKey: 'nav.currencies',
        // The company's enabled codes, or the platform's currency list.
        permission: PERMISSIONS.companyRead,
        orPermissions: [PERMISSIONS.tenantRead],
      },
      {
        href: '/administration/languages',
        labelKey: 'nav.languages',
        permission: PERMISSIONS.tenantRead,
      },
      {
        href: '/administration/system-settings',
        labelKey: 'nav.systemSettings',
        // See navigation.ts: the company settings or the branch settings,
        // whichever the session may read; saving needs settings management.
        permission: PERMISSIONS.companyRead,
        orPermissions: [PERMISSIONS.branchRead],
      },
      {
        href: '/administration/appointment-setup',
        labelKey: 'nav.appointmentSetup',
        permission: PERMISSIONS.appointmentCatalogueManage,
      },
    ],
  },
  {
    titleKey: 'admin.section.audit',
    bodyKey: 'admin.section.auditBody',
    entries: [
      {
        href: '/administration/audit-log',
        labelKey: 'nav.auditLog',
        permission: PERMISSIONS.auditView,
      },
    ],
  },
];

export default async function AdministrationPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const t = (key: string) => translate(messages, key as keyof Messages);

  const sections = SECTIONS.map((section) => ({
    ...section,
    // The sidebar's rule (`isVisible`): the entry's permission or any one of
    // its `orPermissions`, and then every one of its `alsoRequires`.
    entries: section.entries.filter(
      (entry) =>
        (holds(session.permissions, entry.permission) ||
          (entry.orPermissions ?? []).some((code) => holds(session.permissions, code))) &&
        (entry.alsoRequires ?? []).every((code) => holds(session.permissions, code))
    ),
  })).filter((section) => section.entries.length > 0);

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="admin.title"
        descriptionKey="admin.description"
        crumbs={[{ labelKey: 'nav.administration' }]}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          {sections.map((section) => (
            <section
              key={section.titleKey}
              className="rounded-xl border border-border-subtle bg-surface p-5 shadow-xs"
            >
              <h2 className="text-section-title font-semibold text-text-heading">
                {t(section.titleKey)}
              </h2>
              <p className="mt-1 text-supporting text-text-secondary">{t(section.bodyKey)}</p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {section.entries.map((entry) => (
                  <li key={entry.href}>
                    <Link
                      href={`/${locale}${entry.href}`}
                      className="flex items-center justify-between rounded-lg border border-border-subtle px-4 py-3 text-body text-text-primary transition-colors duration-fast ease-standard hover:border-primary hover:bg-primary-subtle"
                    >
                      {t(entry.labelKey)}
                      <span aria-hidden="true" className="text-text-muted rtl:-scale-x-100">
                        ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('admin.title');
