import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { AttentionScreen } from '@/features/attention/components/AttentionScreen';
import {
  ATTENTION_BRANCH_PARAM,
  ATTENTION_PERMISSIONS,
  isAttentionBranchParam,
} from '@/features/attention/attention-contract';
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
 * Every read happens INSIDE the screen, against a branch chosen there: the stock
 * alerts are branch-targeted and the server re-authorizes the pair on each call.
 * Nothing is read here, so there is no server-side read outcome for this route
 * to map.
 *
 * ## One address parameter: the branch to open on
 *
 * `branchId` preselects the stock cards' branch — the dashboard sends the
 * branch its figure was counted for. It is checked for the shape of an
 * identifier HERE and dropped otherwise, and the screen then believes it only if
 * it is one of the branches its own picker lists. See
 * `ATTENTION_BRANCH_PARAM`.
 */
export default async function AttentionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>> | undefined;
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

  const query = (await searchParams) ?? {};
  const raw = query[ATTENTION_BRANCH_PARAM];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const initialBranchId = isAttentionBranchParam(candidate) ? candidate : null;

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
          initialBranchId={initialBranchId}
          canReadStock={canReadStock}
          canReadCapacity={canReadCapacity}
          canReadBranches={holds(session.permissions, ATTENTION_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('attention.page.title');
