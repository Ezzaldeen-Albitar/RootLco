import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { DiscountThresholdScreen } from '@/features/pricing/components/DiscountThresholdScreen';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The company discount threshold (P1-32-PRE-OD-DISC-01).
 *
 * `svc.price.read` gates the page, because the read IS that code; the company is
 * the one in the working context. `svc.price.manage` — the code the write
 * declares — decides whether the form that records the next version is offered.
 */
export default async function DiscountThresholdPage({
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
    { labelKey: 'nav.discountThreshold' },
  ];

  if (!holds(session.permissions, PERMISSIONS.priceRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="discountThreshold.title"
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
        titleKey="discountThreshold.title"
        descriptionKey="discountThreshold.description"
        crumbs={crumbs}
      />
      <PageBody>
        <DiscountThresholdScreen
          locale={locale}
          messages={messages}
          canManage={holds(session.permissions, PERMISSIONS.priceManage)}
        />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('discountThreshold.title');
