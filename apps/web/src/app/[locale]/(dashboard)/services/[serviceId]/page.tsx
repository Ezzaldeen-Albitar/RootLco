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
import { readService } from '@/features/services/api';
import { ServiceDetailScreen } from '@/features/services/components/ServiceDetailScreen';
import { SERVICE_PERMISSIONS } from '@/features/services/services-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One service (P1-30, `W1`, FE-001) — `svc.service-detail` and the writes on it.
 *
 * `svc.service.read` gates the page and is checked BEFORE the read is issued;
 * `svc.service.manage` and `org.branch.read` are capabilities handed to the
 * screen, which offers or withholds the forms accordingly. A refusal of the
 * read itself — a 403 the pre-check did not predict, a 404 for a service in
 * another tenant, an expired session — renders as that state and nothing else:
 * a not-found in particular must not be softened into an empty detail.
 */
export default async function ServiceDetailPage({
  params,
}: {
  readonly params: Promise<{ locale: string; serviceId: string }>;
}) {
  const { locale, serviceId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.catalog' }];

  const shell = (children: React.ReactNode, describe = false) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="services.detail.title"
        {...(describe ? { descriptionKey: 'services.detail.description' } : {})}
        crumbs={crumbs}
      />
      <PageBody>{children}</PageBody>
    </>
  );

  if (!holds(session.permissions, SERVICE_PERMISSIONS.read)) {
    return shell(<PermissionDeniedState messages={messages} />);
  }

  const detail = await readService(serviceId);
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
    <ServiceDetailScreen
      locale={locale}
      messages={messages}
      service={detail.data}
      canManage={holds(session.permissions, SERVICE_PERMISSIONS.manage)}
      canReadBranches={holds(session.permissions, SERVICE_PERMISSIONS.branchRead)}
    />,
    true
  );
}

export const generateMetadata = pageMetadata('services.detail.title');
