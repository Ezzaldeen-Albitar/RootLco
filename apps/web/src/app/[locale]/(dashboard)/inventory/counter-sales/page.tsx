import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { CounterSalesScreen } from '@/features/inventory/components/CounterSalesScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Selling stock over the counter (P1-32).
 *
 * `sal.invoice.manage` gates the page and is checked BEFORE any read is issued.
 * `sal.finance.view` is required BY CONSTRUCTION to draft a sale — the write
 * puts amounts into two gated tables — so the screen is offered only to a caller
 * holding both, rather than offering an act that would always be refused.
 * `sal.invoice.issue` decides whether the issue is offered, `crm.customer.read`
 * whether the buyer search is, and `org.branch.read` whether a branch list is
 * requested for the target.
 */
export default async function CounterSalesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.inventory', href: '/inventory' },
    { labelKey: 'inventory.counterSales.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.invoiceManage)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.counterSales.title"
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
        titleKey="inventory.counterSales.title"
        descriptionKey="inventory.counterSales.description"
        crumbs={crumbs}
      />
      <PageBody>
        <CounterSalesScreen
          locale={locale}
          messages={messages}
          canSell={holds(session.permissions, INVENTORY_PERMISSIONS.financeView)}
          canIssue={holds(session.permissions, INVENTORY_PERMISSIONS.invoiceIssue)}
          canReadCustomers={holds(session.permissions, INVENTORY_PERMISSIONS.customerRead)}
          canReadBranches={holds(session.permissions, INVENTORY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.counterSales.title');
