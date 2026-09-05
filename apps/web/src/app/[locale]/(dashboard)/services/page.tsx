import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { ServiceCatalogueScreen } from '@/features/services/components/ServiceCatalogueScreen';
import { SERVICE_PERMISSIONS } from '@/features/services/services-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The service catalogue (P1-30, `W1`, FE-001).
 *
 * `svc.service.read` gates the page, because the catalogue IS the read — there
 * is no part of this screen an operator without that code may see. The two
 * further codes the screen consults decide what it OFFERS, not what it shows:
 * `svc.service.manage` opens the create forms, and `org.branch.read` decides
 * whether a branch list is requested for the availability filter or an
 * identifier field is shown instead.
 *
 * The check is placed BEFORE any read is issued. `requireSession` runs first
 * and must: it is what produces the permissions being tested. Nothing else is
 * awaited above the guard, and the screen's own reads start only in the
 * browser, after this page has already decided the operator may see them.
 */
export default async function ServiceCataloguePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.catalog' }];

  if (!holds(session.permissions, SERVICE_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="services.catalogue.title"
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
        titleKey="services.catalogue.title"
        descriptionKey="services.catalogue.description"
        crumbs={crumbs}
      />
      <PageBody>
        <ServiceCatalogueScreen
          locale={locale}
          messages={messages}
          canManage={holds(session.permissions, SERVICE_PERMISSIONS.manage)}
          canReadBranches={holds(session.permissions, SERVICE_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('services.catalogue.title');
