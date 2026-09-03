import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { TemplateCatalogueScreen } from '@/features/diagnostics/components/TemplateCatalogueScreen';
import { DIAGNOSTICS_PERMISSIONS } from '@/features/diagnostics/diagnostics-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * `/work-orders/diagnostics` (P1-29 W7) — the inspection-template catalogue.
 * Gated on `dia.diagnostic.read` BEFORE any read; authoring controls appear
 * only for `dia.catalogue.manage`, and every write is refused server-side
 * regardless of what the screen shows.
 */
export default async function DiagnosticsCataloguePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.workOrders', href: '/work-orders' },
    { labelKey: 'nav.diagnostics' },
  ];

  if (!holds(session.permissions, DIAGNOSTICS_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="diagnostics.catalogue.title"
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
        titleKey="diagnostics.catalogue.title"
        descriptionKey="diagnostics.catalogue.description"
        crumbs={crumbs}
      />
      <PageBody>
        <TemplateCatalogueScreen
          locale={locale}
          messages={messages}
          canManage={holds(session.permissions, DIAGNOSTICS_PERMISSIONS.manage)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('diagnostics.catalogue.title');
