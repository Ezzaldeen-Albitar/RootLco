import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { CustomerSearchScreen } from '@/features/crm/customers/components/CustomerSearchScreen';
import { CRM_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * CRM customer search (`P1-27-FE-001`, `P1-27-FE-002`).
 *
 * The route-level check renders the denial **instead of** the screen. A screen
 * that mounts and then discovers it is denied has already issued its first read
 * — and if that read succeeded, the data reached the browser before the denial
 * was drawn over it.
 *
 * The check is still not the security boundary. `GET /api/v1/customers` requires
 * `crm.customer.read` and enforces it server-side on every request; this only
 * stops an operator being shown a form whose every submission would come back
 * denied.
 */
export default async function CustomerSearchPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  if (!holds(session.permissions, CRM_PERMISSIONS.customerRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="crm.customers.title"
          crumbs={[{ labelKey: 'nav.customers' }]}
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
        titleKey="crm.customers.title"
        descriptionKey="crm.customers.description"
        crumbs={[{ labelKey: 'nav.customers' }]}
      />
      <PageBody fill>
        <CustomerSearchScreen
          locale={locale}
          messages={messages}
          canCreate={holds(session.permissions, CRM_PERMISSIONS.customerCreate)}
        />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('crm.customers.title');
