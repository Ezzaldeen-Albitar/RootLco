import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { allRoles } from '@/features/administration/access/api';
import { ApprovalLimitsScreen } from '@/features/administration/access/components/ApprovalLimitsScreen';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Approval limits.
 *
 * `iam.approval.manage` gates both reading and writing on this operation — the
 * list and the create share one permission — so a single check covers the
 * screen, and the write controls are shown to everyone who can see it.
 */
export default async function ApprovalLimitsPage({
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
    { labelKey: 'nav.approvalLimits' },
  ];

  if (!holds(session.permissions, PERMISSIONS.approvalManage)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="approvalLimits.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const roles = holds(session.permissions, PERMISSIONS.roleRead) ? await allRoles() : [];

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="approvalLimits.title"
        descriptionKey="approvalLimits.description"
        crumbs={crumbs}
      />
      <PageBody fill>
        <ApprovalLimitsScreen
          locale={locale}
          messages={messages}
          roles={roles}
          companyIds={session.companyIds}
          canManage
        />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('approvalLimits.title');
