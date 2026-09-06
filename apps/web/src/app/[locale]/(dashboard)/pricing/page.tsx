import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { PricingScreen } from '@/features/pricing/components/PricingScreen';
import { PRICING_PERMISSIONS } from '@/features/pricing/pricing-contract';
import { SERVICE_PERMISSIONS } from '@/features/services/services-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Price lists and the price lookup (P1-30, `W2`, FE-002 and FE-006).
 *
 * `svc.price.read` gates the page, because both the list and the lookup ARE
 * that read. The further codes decide what the screen OFFERS: `svc.price.manage`
 * opens the create form, `org.branch.read` decides whether a branch list is
 * requested, and `svc.service.read` whether a service can be found by code.
 *
 * The check is placed BEFORE any read is issued; nothing is awaited above the
 * guard but the session that produces the permissions being tested.
 */
export default async function PricingPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.pricing' }];

  if (!holds(session.permissions, PRICING_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="pricing.list.title"
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
        titleKey="pricing.list.title"
        descriptionKey="pricing.list.description"
        crumbs={crumbs}
      />
      <PageBody>
        <PricingScreen
          locale={locale}
          messages={messages}
          canManage={holds(session.permissions, PRICING_PERMISSIONS.manage)}
          canReadBranches={holds(session.permissions, PRICING_PERMISSIONS.branchRead)}
          canReadServices={holds(session.permissions, SERVICE_PERMISSIONS.read)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('pricing.list.title');
