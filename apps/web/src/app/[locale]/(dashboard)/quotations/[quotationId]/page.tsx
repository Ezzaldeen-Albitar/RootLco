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
import { readQuotation } from '@/features/quotations/api';
import { QuotationDetailScreen } from '@/features/quotations/components/QuotationDetailScreen';
import { QUOTATION_PERMISSIONS } from '@/features/quotations/quotations-contract';
import { SERVICE_PERMISSIONS } from '@/features/services/services-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One quotation (P1-30, `W3`, FE-004, FE-007) — `quo.quotation-detail` and
 * the writes on it.
 *
 * `quo.quotation.read` gates the page and is checked BEFORE the read is
 * issued; `quo.quotation.manage`, `quo.decision.record`, `iam.approval.manage`
 * and `svc.service.read` are capabilities handed to the screen. A refusal of
 * the read itself renders as that state and nothing else — a not-found is
 * never softened into an empty quotation.
 */
export default async function QuotationDetailPage({
  params,
}: {
  readonly params: Promise<{ locale: string; quotationId: string }>;
}) {
  const { locale, quotationId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.quotations' }];

  const shell = (children: React.ReactNode, describe = false) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="quotations.detail.title"
        {...(describe ? { descriptionKey: 'quotations.detail.description' } : {})}
        crumbs={crumbs}
      />
      <PageBody>{children}</PageBody>
    </>
  );

  if (!holds(session.permissions, QUOTATION_PERMISSIONS.read)) {
    return shell(<PermissionDeniedState messages={messages} />);
  }

  const detail = await readQuotation(quotationId);
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
    <QuotationDetailScreen
      locale={locale}
      messages={messages}
      quotation={detail.data}
      canManage={holds(session.permissions, QUOTATION_PERMISSIONS.manage)}
      canDecide={holds(session.permissions, QUOTATION_PERMISSIONS.decide)}
      canReadLimits={holds(session.permissions, QUOTATION_PERMISSIONS.limitsRead)}
      canReadServices={holds(session.permissions, SERVICE_PERMISSIONS.read)}
    />,
    true
  );
}

export const generateMetadata = pageMetadata('quotations.detail.title');
