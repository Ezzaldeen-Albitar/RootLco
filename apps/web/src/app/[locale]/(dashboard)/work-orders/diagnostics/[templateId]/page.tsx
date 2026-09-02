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
import { readTemplate } from '@/features/diagnostics/api';
import { TemplateDetailScreen } from '@/features/diagnostics/components/TemplateDetailScreen';
import { DIAGNOSTICS_PERMISSIONS } from '@/features/diagnostics/diagnostics-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/work-orders/diagnostics/{templateId}` (P1-29 W7) — one template, its
 * versions and their items. Gated on `dia.diagnostic.read` BEFORE the read.
 */
export default async function TemplateDetailPage({
  params,
}: {
  readonly params: Promise<{ locale: string; templateId: string }>;
}) {
  const { locale, templateId } = await params;
  if (!isLocale(locale)) notFound();
  if (!UUID.test(templateId)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.workOrders', href: '/work-orders' },
    { labelKey: 'nav.diagnostics', href: '/work-orders/diagnostics' },
    { labelKey: 'diagnostics.template.crumb' },
  ];

  const shell = (body: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="diagnostics.template.title"
        crumbs={crumbs}
      />
      <PageBody>{body}</PageBody>
    </>
  );

  if (!holds(session.permissions, DIAGNOSTICS_PERMISSIONS.read)) {
    return shell(<PermissionDeniedState messages={messages} />);
  }

  const detail = await readTemplate(templateId);
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
    <TemplateDetailScreen
      locale={locale}
      messages={messages}
      templateId={templateId}
      initial={detail.data}
      canManage={holds(session.permissions, DIAGNOSTICS_PERMISSIONS.manage)}
    />
  );
}

export const generateMetadata = pageMetadata('diagnostics.template.title');
