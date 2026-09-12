import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { WarrantyPolicyListScreen } from '@/features/warranty/components/WarrantyPolicyListScreen';
import { WARRANTY_PERMISSIONS } from '@/features/warranty/warranty-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The warranty plans a tenant holds (P1-31, FE-008 plan administration).
 *
 * ## The guard runs BEFORE anything is read
 *
 * `wty.warranty.read` is tested and returned on before the screen that issues the plan
 * list read is rendered at all. `scripts/ci/check-p1-31-access.mjs` is what keeps that
 * ordering true here, and the five write operations this screen's controls reach were
 * added to its allow-list in the same change.
 *
 * ## The page is gated on the READ code, not on the administration code
 *
 * That is `wty.warranty-policy-list`'s own decision and this page follows it: the plan
 * list answers `wty.warranty.read` so that a clerk who issues warranties can see the
 * plans they issue under. Gating this page on `wty.policy.manage` would hide from that
 * clerk a list the backend is willing to show them.
 *
 * ## A second permission is computed and does not gate the page
 *
 * `wty.policy.manage` decides whether any control that CHANGES a plan is drawn. It is
 * an affordance and never enforcement: every write is decided again by the backend,
 * which declares that code on all five of them. A third, `org.branch.read`, decides
 * only whether the company on the create form is chosen from a directory or typed.
 */
export default async function WarrantyPolicyListPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.warranty', href: `/${locale}/warranty` },
    { labelKey: 'warranty.policies.crumb' },
  ];

  if (!holds(session.permissions, WARRANTY_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="warranty.policies.title"
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
        titleKey="warranty.policies.title"
        descriptionKey="warranty.policies.description"
        crumbs={crumbs}
      />
      <PageBody>
        <WarrantyPolicyListScreen
          locale={locale}
          messages={messages}
          canManagePolicies={holds(session.permissions, WARRANTY_PERMISSIONS.policyManage)}
          canReadBranches={holds(session.permissions, WARRANTY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('warranty.policies.title');
