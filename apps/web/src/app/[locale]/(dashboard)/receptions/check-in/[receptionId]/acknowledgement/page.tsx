import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import {
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import {
  listAuthorizations,
  listConditionEvidence,
  listPartyRoles,
  readReception,
} from '@/features/receptions/api';
import { AcknowledgementDocument } from '@/features/receptions/components/AcknowledgementDocument';
import { RECEPTION_PERMISSIONS } from '@/features/receptions/receptions-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The reception acknowledgement document (`P1-28-FE-021`).
 *
 * One permission — `rec.reception.read` — because the document writes nothing:
 * it is the visit record, laid out for print and handover. The page performs
 * FOUR reads (`rec.reception-detail`, `-party-role-list`,
 * `-authorization-list`, `-condition-evidence-list`) on the server, so the first
 * paint is the finished sheet and an operator does not print a half-loaded page.
 *
 * ## The detail read decides the outcome; a section read does not
 *
 * Without the visit there is no document, so a failed detail read is rendered as
 * the failure it is, one branch per outcome, in the same order as the wizard
 * route beside it. A failed SECTION read is different: the sheet still exists
 * and the section is printed as empty with the run's truncation note absent —
 * the alternative is refusing to print a handover document because one of four
 * lists was unavailable. Each section carries its own `hasMore`, which the
 * document states on the sheet.
 *
 * The reads are issued together rather than in sequence: they are independent
 * and the page has nothing to decide between them.
 */
export default async function AcknowledgementPage({
  params,
}: {
  readonly params: Promise<{ locale: string; receptionId: string }>;
}) {
  const { locale, receptionId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const frame = (body: ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="receptions.acknowledgement.title"
        descriptionKey="receptions.acknowledgement.description"
        crumbs={[
          { labelKey: 'nav.receptions', href: `/${locale}/receptions` },
          {
            labelKey: 'receptions.wizard.title',
            href: `/${locale}/receptions/check-in/${receptionId}`,
          },
          { labelKey: 'receptions.acknowledgement.title' },
        ]}
      />
      <PageBody>{body}</PageBody>
    </>
  );

  if (!holds(session.permissions, RECEPTION_PERMISSIONS.read)) {
    // Decided before any request, so there is no reference to carry.
    return frame(<PermissionDeniedState messages={messages} />);
  }

  const detail = await readReception(receptionId);

  if (detail.status === 'denied') {
    return frame(
      <PermissionDeniedState
        messages={messages}
        correlationId={detail.correlationId ?? undefined}
      />
    );
  }
  if (detail.status === 'not-found' || (detail.status === 'ok' && detail.data === null)) {
    return frame(<NotFoundState messages={messages} />);
  }
  if (detail.status === 'expired') {
    return frame(<SessionExpiredState messages={messages} />);
  }
  if (detail.status !== 'ok' || detail.data === null) {
    return frame(
      <ErrorState messages={messages} correlationId={detail.correlationId ?? undefined} />
    );
  }

  const request = { ...INITIAL_REQUEST, pageSize: 50 };
  const [parties, authorizations, evidence] = await Promise.all([
    listPartyRoles(receptionId, 'active', request, null),
    listAuthorizations(receptionId, request, null),
    listConditionEvidence(receptionId, undefined, request, null),
  ]);

  return frame(
    <AcknowledgementDocument
      locale={locale}
      messages={messages}
      detail={detail.data}
      sections={{
        parties: parties.rows,
        authorizations: authorizations.rows,
        evidence: evidence.rows,
        truncated: {
          parties: parties.hasMore,
          authorizations: authorizations.hasMore,
          evidence: evidence.hasMore,
        },
      }}
    />
  );
}

export const generateMetadata = pageMetadata('receptions.acknowledgement.title');
