import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { AttentionScreen } from '@/features/attention/components/AttentionScreen';
import { ATTENTION_PERMISSIONS } from '@/features/attention/attention-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Attention (Owner directive, operational alerts): what is about to stop
 * working, in one place.
 *
 * ## Two codes, and the page needs EITHER
 *
 * The four stock cards are `inv.stock.read` and the allowance card is
 * `org.tenant.read`. A session holding one of them has something to see here, so
 * the page is refused only to a session holding neither — and each half of the
 * screen states its own denial, so an operator who may read stock but not the
 * subscription is told which is which rather than shown an empty card.
 *
 * Every read happens INSIDE the screen, against the working branch the header
 * holds: the stock alerts are branch-targeted and the server re-authorizes the
 * pair on each call. Nothing is read here, so there is no server-side read
 * outcome for this route to map.
 *
 * ## No address parameter
 *
 * The page used to read a `branchId` from its address to preselect a picker of
 * its own. The picker is gone (Browser QA part 7, row 1a.3) — the header's
 * working branch is the one answer — and with it the parameter: an address that
 * could name a branch other than the header's would be a second authority for
 * the same fact.
 */
export default async function AttentionPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.attention' }];

  const canReadStock = holds(session.permissions, ATTENTION_PERMISSIONS.stockRead);
  const canReadCapacity = holds(session.permissions, ATTENTION_PERMISSIONS.tenantRead);

  if (!canReadStock && !canReadCapacity) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="attention.page.title"
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
        titleKey="attention.page.title"
        descriptionKey="attention.page.description"
        crumbs={crumbs}
      />
      <PageBody>
        <AttentionScreen
          locale={locale}
          messages={messages}
          canReadStock={canReadStock}
          canReadCapacity={canReadCapacity}
          canReadBranches={holds(session.permissions, ATTENTION_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('attention.page.title');
