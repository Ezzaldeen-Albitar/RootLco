import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { CreditNotesScreen } from '@/features/billing/components/CreditNotesScreen';
import { BILLING_PERMISSIONS } from '@/features/billing/billing-contract';
import { holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Credit notes (DEF-T-07).
 *
 * BOTH declared permissions gate the page, and both are checked BEFORE any read
 * is issued. `sal.credit.manage` names the authority; `sal.finance.view` is
 * required by construction, because a credit note's whole row is gated by it —
 * a caller holding only the first would reach a screen that could show nothing
 * and would have to explain an empty list that meant a refusal.
 *
 * The branch is the working context's own named selection (Owner directive,
 * `P1-32-PRE-OD-UX`), so no directory code is consulted here; the branch pair is
 * re-authorized on every read regardless.
 *
 * One address leads in: a credit note named in the address opens straight onto
 * its detail, which is how the customer-returns screen links to the credit a
 * return raised.
 *
 * Raising a note and approving one declare the same two codes, so the page gate
 * covers both. Two things are passed on: who is signed in, so a note the caller
 * raised is shown as waiting for another approver rather than offered to them;
 * and `sal.invoice.manage`, which the invoice list behind the raise form's
 * invoice picker declares.
 */
export default async function CreditNotesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.creditNotes' }];

  if (
    !holds(session.permissions, BILLING_PERMISSIONS.creditManage) ||
    !holds(session.permissions, BILLING_PERMISSIONS.financeView)
  ) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="creditNotes.page.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const query = await searchParams;
  const named = Array.isArray(query['creditNoteId'])
    ? query['creditNoteId'][0]
    : query['creditNoteId'];

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="creditNotes.page.title"
        descriptionKey="creditNotes.page.description"
        crumbs={crumbs}
      />
      <PageBody>
        <CreditNotesScreen
          locale={locale}
          messages={messages}
          initialCreditNoteId={named && UUID.test(named) ? named : null}
          currentUserId={session.userId}
          canSearchInvoices={holds(session.permissions, BILLING_PERMISSIONS.manage)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('creditNotes.page.title');
