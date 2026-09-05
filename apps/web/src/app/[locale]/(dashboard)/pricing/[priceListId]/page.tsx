import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import {
  BackendUnavailableState,
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { readPriceList } from '@/features/pricing/api';
import { PriceListDetailScreen } from '@/features/pricing/components/PriceListDetailScreen';
import { PRICING_PERMISSIONS } from '@/features/pricing/pricing-contract';
import { SERVICE_PERMISSIONS } from '@/features/services/services-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One price list (P1-30, `W2`, FE-002) — `svc.price-list-detail` and the
 * writes on it.
 *
 * `svc.price.read` gates the page and is checked BEFORE the read is issued;
 * `svc.price.manage`, `svc.price.publish`, `org.branch.read` and
 * `svc.service.read` are capabilities handed to the screen, which offers or
 * withholds the forms accordingly. A refusal of the read itself renders as that
 * state and nothing else — a not-found is never softened into an empty detail.
 */
export default async function PriceListDetailPage({
  params,
}: {
  readonly params: Promise<{ locale: string; priceListId: string }>;
}) {
  const { locale, priceListId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.pricing' }];

  const shell = (children: React.ReactNode, describe = false) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="pricing.detail.title"
        {...(describe ? { descriptionKey: 'pricing.detail.description' } : {})}
        crumbs={crumbs}
      />
      <PageBody>{children}</PageBody>
    </>
  );

  if (!holds(session.permissions, PRICING_PERMISSIONS.read)) {
    return shell(<PermissionDeniedState messages={messages} />);
  }

  const detail = await readPriceList(priceListId);
  const reference = detail.correlationId ?? undefined;
  if (detail.status === 'not-found') return shell(<NotFoundState messages={messages} />);
  if (detail.status === 'denied') {
    return shell(<PermissionDeniedState messages={messages} correlationId={reference} />);
  }
  if (detail.status === 'expired') return shell(<SessionExpiredState messages={messages} />);
  if (detail.status === 'unavailable') {
    return shell(<BackendUnavailableState messages={messages} correlationId={reference} />);
  }
  if (detail.status !== 'ok') {
    return shell(<ErrorState messages={messages} correlationId={reference} />);
  }

  return shell(
    <PriceListDetailScreen
      locale={locale}
      messages={messages}
      priceList={detail.data}
      canManage={holds(session.permissions, PRICING_PERMISSIONS.manage)}
      canPublish={holds(session.permissions, PRICING_PERMISSIONS.publish)}
      canReadBranches={holds(session.permissions, PRICING_PERMISSIONS.branchRead)}
      canReadServices={holds(session.permissions, SERVICE_PERMISSIONS.read)}
    />,
    true
  );
}

export const generateMetadata = pageMetadata('pricing.detail.title');
