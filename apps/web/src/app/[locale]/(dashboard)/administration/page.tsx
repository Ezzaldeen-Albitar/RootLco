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

/**
 * The administration hub.
 *
 * A map, not a dashboard: no counts, no queues, no "12 users pending". There is
 * no operation that returns those numbers, and a screen full of plausible zeros
 * reads as a working product that happens to be empty.
 *
 * Each card is shown only when the actor holds the permission its screen needs —
 * the same rule the sidebar uses, and for the same reason. An entry an operator
 * cannot open is a door with no handle.
 */

interface Entry {
  readonly href: string;
  readonly labelKey: string;
  readonly permission: string;
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
        permission: PERMISSIONS.settingsManage,
      },
      { href: '/administration/taxes', labelKey: 'nav.taxes', permission: PERMISSIONS.taxManage },
      {
        href: '/administration/currencies',
        labelKey: 'nav.currencies',
        permission: PERMISSIONS.settingsManage,
      },
      {
        href: '/administration/languages',
        labelKey: 'nav.languages',
        permission: PERMISSIONS.tenantRead,
      },
      {
        href: '/administration/system-settings',
        labelKey: 'nav.systemSettings',
        permission: PERMISSIONS.settingsManage,
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
    entries: section.entries.filter((entry) =>
      holds(session.permissions, entry.permission as AdministrationPermission)
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
