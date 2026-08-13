import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { ReceptionQueueScreen } from '@/features/receptions/components/ReceptionQueueScreen';
import { RECEPTION_PERMISSIONS } from '@/features/receptions/receptions-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The branch reception queue (`P1-28-FE-001`, the queue half).
 *
 * `rec.reception.read` gates the page — the board IS the read. Opening a visit
 * is `rec.reception.manage` and gates only the offer to check a vehicle in; an
 * operator who may read but not open still has every reason to be here, so the
 * denial is a missing button rather than a missing page.
 *
 * The board is the module's landing screen, which is why the navigation entry
 * now points here rather than straight at the check-in wizard.
 *
 * No read is issued by this route: the list REQUIRES a branch target and the
 * server refuses to guess which of a multi-grant operator's branches a board is
 * for, so the screen mounts its results only once the operator names one. What
 * this route passes down is the session's own RESOLVED scope — the identifiers
 * the server already decided this account may act within, never a scope the
 * browser asserts.
 */
export default async function ReceptionQueuePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const crumbs = [{ labelKey: 'nav.receptions' }];

  if (!holds(session.permissions, RECEPTION_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="receptions.queue.title"
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
        titleKey="receptions.queue.title"
        descriptionKey="receptions.queue.description"
        crumbs={crumbs}
      />
      <PageBody>
        <ReceptionQueueScreen
          locale={locale}
          messages={messages}
          companyIds={session.companyIds}
          branchIds={session.branchIds}
          canCreate={holds(session.permissions, RECEPTION_PERMISSIONS.manage)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('receptions.queue.title');
