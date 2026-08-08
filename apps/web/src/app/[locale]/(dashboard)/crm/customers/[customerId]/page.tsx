import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import {
  BackendUnavailableState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { CustomerProfileScreen } from '@/features/crm/customers/components/CustomerProfileScreen';
import { readCustomer } from '@/features/crm/customers/profile-api';
import { CRM_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * A customer profile (`P1-27-FE-006`).
 *
 * ## The header is read on the server, the components on demand
 *
 * The profile cannot render without the customer, so that one read happens here
 * and its failure IS the page's state. The nine component lists are separate
 * operations and load inside their own sections, so a slow or denied component
 * does not blank a profile that otherwise loaded.
 *
 * ## 404 means four things and the screen must not guess which
 *
 * Absent, soft-deleted, merged away, and belonging to another tenant all answer
 * `ERR-RES-001`. That is deliberate: it stops the endpoint being an existence
 * oracle. So "not found" is what is shown, and no copy here speculates about
 * which of the four it was — speculating would rebuild the oracle in the
 * interface.
 */
export default async function CustomerProfilePage({
  params,
}: {
  readonly params: Promise<{ locale: string; customerId: string }>;
}) {
  const { locale, customerId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const frame = (body: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="crm.customers.title"
        crumbs={[
          { labelKey: 'nav.customers', href: `/${locale}/crm/customers` },
          { labelKey: 'crm.customers.profile.title' },
        ]}
      />
      <PageBody>{body}</PageBody>
    </>
  );

  if (!holds(session.permissions, CRM_PERMISSIONS.customerRead)) {
    return frame(<PermissionDeniedState messages={messages} />);
  }

  const result = await readCustomer(customerId);

  if (result.status === 'denied') {
    return frame(
      <PermissionDeniedState
        messages={messages}
        correlationId={result.correlationId ?? undefined}
      />
    );
  }
  if (result.status === 'not-found') {
    return frame(<NotFoundState messages={messages} />);
  }
  if (result.status === 'expired') {
    return frame(<SessionExpiredState messages={messages} />);
  }
  if (result.status !== 'ok') {
    return frame(<BackendUnavailableState messages={messages} />);
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="crm.customers.profile.title"
        crumbs={[
          { labelKey: 'nav.customers', href: `/${locale}/crm/customers` },
          { labelKey: 'crm.customers.profile.title' },
        ]}
      />
      <PageBody fill>
        <CustomerProfileScreen
          locale={locale}
          messages={messages}
          customer={result.data}
          // `crm.customer-status-set` needs `crm.customer.governance.manage` —
          // the same code as alerts and tags, and NOT the read that gates this
          // page. Visibility only; the server decides.
          canManageStatus={holds(session.permissions, CRM_PERMISSIONS.governanceManage)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('crm.customers.profile.title');
