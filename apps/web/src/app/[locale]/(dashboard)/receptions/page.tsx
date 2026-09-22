import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { CRM_PERMISSIONS, holds } from '@/features/crm/permissions';
import { ReceptionQueueScreen } from '@/features/receptions/components/ReceptionQueueScreen';
import {
  RECEPTION_PERMISSIONS,
  isReceptionBoardPeriod,
} from '@/features/receptions/receptions-contract';
import { isCalendarDay } from '@/lib/branch-time';
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
 * No read is issued by this route. The board reads on arrival in the browser,
 * bounded to the working branch's own day, and the branch is the working
 * context's named selection rather than anything this route resolves.
 *
 * `crm.customer.read` gates the offer to receive a NEW customer, because that is
 * the code the walk-in desk's own route gates on. An offer that lands on a
 * refusal is worse than no offer, and this page must not invent a second,
 * softer rule for who may open that screen.
 */
export default async function ReceptionQueuePage({
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

  /*
   * The period the board opens on, when the dashboard sent the reader here.
   *
   * A period NAME out of the five this repository declares, and for a chosen
   * range the two calendar days it covers. Days are what a reader picked for a
   * report — not a name, a plate or an amount — and without them the period they
   * were looking at cannot be carried across at all. Anything that fails its
   * check is dropped here, and the board opens on today.
   */
  const query = (await searchParams) ?? {};
  const askedPeriod = single(query['period']);
  const from = single(query['from']);
  const to = single(query['to']);
  const initialPeriod =
    askedPeriod !== null && isReceptionBoardPeriod(askedPeriod)
      ? askedPeriod === 'custom'
        ? from !== null && to !== null && isCalendarDay(from) && isCalendarDay(to) && from <= to
          ? { kind: askedPeriod, from, to }
          : undefined
        : { kind: askedPeriod, from: '', to: '' }
      : undefined;

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
          canReachIntake={holds(session.permissions, CRM_PERMISSIONS.customerRead)}
          initialPeriod={initialPeriod}
        />
      </PageBody>
    </>
  );
}

/** One value, or none. A repeated parameter is a malformed address, not a list. */
function single(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null;
}

export const generateMetadata = pageMetadata('receptions.queue.title');
