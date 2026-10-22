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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 *
 * One address leads in: a sale named in the address (`invoiceId`) is opened as
 * soon as the branch is known — how a credit note links the counter sale it
 * reduces (finance checkpoint, DF-B4). It is read like any other sale, after the
 * gate, and the server decides whether this reader may see it.
 *
 * The header and the body share one print scope (DF-B2): while the sale's
 * printable copy is open, the page title and its description stay off the paper
 * and the copy prints alone.
 */
export default async function CounterSalesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.inventory', href: `/${locale}/inventory` },
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

  const query = (await searchParams) ?? {};
  const named = Array.isArray(query['invoiceId']) ? query['invoiceId'][0] : query['invoiceId'];

  return (
    <div data-print-scope="document">
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
          initialInvoiceId={named && UUID.test(named) ? named : null}
        />
      </PageBody>
    </div>
  );
}

export const generateMetadata = pageMetadata('inventory.counterSales.title');
