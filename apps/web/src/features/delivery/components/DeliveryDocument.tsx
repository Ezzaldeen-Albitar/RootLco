'use client';

import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand/BrandMark';
import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { WorkOrderDetail } from '@/features/work-orders/work-orders-contract';

import type {
  AuthorizedReceiver,
  ChecklistResult,
  DeliveryEligibility,
  DeliveryRecord,
  DeliverySignature,
  DeliveryStatusTransition,
} from '../delivery-contract';
import { BlockerLabel, OutcomeLabel, SignerRoleLabel, StatusLabel } from './CodeLabel';

/**
 * The printable handover document (P1-31, FE-007).
 *
 * ## What the Owner decided, and what that forbids
 *
 * D-7 (2026-09-10, `docs/phase-1/phase-1-31/owner-decisions-2026-09-10.md` §2):
 * the delivery document is a **permission-checked printable operational view**.
 * Stored immutable versions remain deferred and arrive, if ever, through their
 * own contract. So this is composed on the client from the reads the caller
 * already holds, no backend print route is called and none exists, nothing is
 * written, and the footer states in both languages that the sheet is an
 * operational printout rather than an archived version. It renders what the
 * server published to the person who printed it, at the moment they printed it,
 * and that is the whole of its claim.
 *
 * ## It reuses the print foundation rather than building a second one
 *
 * `components/print/PrintDocument.tsx` owns the page geometry, the repeating
 * header, the forced `paper` surface — a dark theme would otherwise print grey
 * blocks — and `PrintTable`, whose real `<thead>` is what repeats a header
 * across a page break. `dir` is inherited from the document root, so the Arabic
 * sheet is right-to-left without a second layout. No PDF is generated and no
 * bytes are produced.
 *
 * ## Every part states the outcome of the read that produced it
 *
 * A section is `read`, `refused` or `withheld`, never a bare row array. An empty
 * list and a failed read are different facts: printing "nothing is recorded"
 * over a refusal would assert an absence this sheet never observed, on paper,
 * to a reader who cannot check it. A refused part says it could not be read and
 * carries the reference the backend logged; a withheld part says the reader does
 * not hold the permission the read declares.
 *
 * ## What it deliberately does not print
 *
 *   - **The signature image and the identity-evidence document.** Both are
 *     stored-document references and both stay references: the sheet states that
 *     the mark or the proof is on file and offers no way to fetch the bytes.
 *   - **A name for an identifier the platform does not resolve.** The vehicle,
 *     the visit, the delivering employee and the final odometer reading are bare
 *     identifiers with no reader anywhere in the platform — the delivering
 *     employee's display name lands with a backend slice that is not merged —
 *     so each is printed as the labelled reference it is. The customer name, the
 *     registration plate and the work-order number are the exception: the work
 *     order's own read publishes them, and they are printed from that read, for
 *     a caller who holds its permission, or not at all.
 *   - **A figure.** Not one delivery read carries an amount, and the release
 *     checks publish blocker CODES rather than numbers. Nothing here formats or
 *     computes money.
 */

/** One fact that was asked for, with the outcome of the read. */
export type DocumentRead<T> =
  /** The read succeeded. `value` is what it published, absence included. */
  | { readonly kind: 'read'; readonly value: T }
  /** Asked and not answered. The reference is the one the backend logged. */
  | { readonly kind: 'refused'; readonly reference: string | null };

/**
 * One fact that a caller may not be allowed to ask for at all.
 *
 * `withheld` exists only where a read declares a permission ON TOP of the
 * delivery code — the release checks demand the financial one, the work-order
 * read its own — so the screen decides before it asks rather than spending a
 * request on an answer it already knows. Every other part of this sheet is
 * covered by the code the route already required, and those carry
 * `DocumentRead`, which has no such branch to leave unreachable.
 */
export type DocumentFact<T> = DocumentRead<T> | { readonly kind: 'withheld' };

/**
 * One list, with the outcome of its read and the server's own end-of-set signal.
 *
 * `hasMore` is the server's, never inferred from a short page. One page is
 * printed, and a sheet that silently stopped at the page boundary would be a
 * copy missing records nobody mentioned — so truncation is said rather than
 * hidden.
 */
export type DocumentSection<T> =
  | { readonly kind: 'read'; readonly rows: readonly T[]; readonly hasMore: boolean }
  | { readonly kind: 'refused'; readonly reference: string | null };

export function DeliveryDocument({
  locale,
  messages,
  delivery,
  workOrder,
  eligibility,
  receiver,
  checklist,
  signatures,
  history,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The page's own read, already on screen when the sheet is asked for. */
  readonly delivery: DeliveryRecord;
  /** `wo.work-order-detail`, which is the only read publishing a customer or a plate. */
  readonly workOrder: DocumentFact<WorkOrderDetail>;
  /** `sal.delivery-eligibility-read`, withheld without the financial read code. */
  readonly eligibility: DocumentFact<DeliveryEligibility>;
  /** `sal.delivery-receiver-read`. A verified receiver, or the fact that there is none. */
  readonly receiver: DocumentRead<AuthorizedReceiver | null>;
  readonly checklist: DocumentSection<ChecklistResult>;
  readonly signatures: DocumentSection<DeliverySignature>;
  readonly history: DocumentSection<DeliveryStatusTransition>;
}) {
  return (
    <PrintDocument
      title={translate(messages, 'delivery.document.title')}
      brand={<BrandMark />}
      header={
        <>
          <p lang={locale}>
            {translate(messages, 'delivery.summary.status')}{' '}
            <StatusLabel messages={messages} status={delivery.status} />
          </p>
          <p lang={locale}>
            {translate(messages, 'delivery.summary.deliveredAt')}{' '}
            {delivery.deliveredAt === null ? (
              translate(messages, 'delivery.summary.notDeliveredYet')
            ) : (
              <bdi>{formatDateTime(delivery.deliveredAt, locale)}</bdi>
            )}
          </p>
        </>
      }
      footer={<p lang={locale}>{translate(messages, 'delivery.document.disclaimer')}</p>}
    >
      <section aria-labelledby="delivery-document-handover" className="mb-6">
        <h2 id="delivery-document-handover" className="mb-2 text-section-title font-medium">
          {translate(messages, 'delivery.document.handoverHeading')}
        </h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <WorkOrderFacts locale={locale} messages={messages} workOrder={workOrder} />
          <Fact label={translate(messages, 'delivery.summary.vehicle')}>
            <Identifier value={delivery.vehicleId} />
          </Fact>
          <Fact label={translate(messages, 'delivery.summary.visit')}>
            <Identifier value={delivery.receptionVisitId} />
          </Fact>
          {/*
            The identifier the column holds, and nothing more. Nothing in the
            platform turns it into a person: the display-name field arrives with
            a backend slice that is not merged at this head, and a name invented
            on this side would be printed, signed and taken away.
          */}
          <Fact label={translate(messages, 'delivery.summary.deliveringEmployee')}>
            <Identifier value={delivery.deliveringEmployeeId} />
          </Fact>
          <Fact label={translate(messages, 'delivery.summary.finalOdometerReading')}>
            <Identifier value={delivery.finalOdometerReadingId} />
          </Fact>
        </dl>
        <p className="mt-2 text-supporting text-text-muted" lang={locale}>
          {translate(messages, 'delivery.summary.identifiersExplain')}
        </p>
      </section>

      <section aria-labelledby="delivery-document-checks" className="mb-6">
        <h2 id="delivery-document-checks" className="mb-2 text-section-title font-medium">
          {translate(messages, 'delivery.document.releaseChecksHeading')}
        </h2>
        {eligibility.kind === 'withheld' ? (
          <p lang={locale}>{translate(messages, 'delivery.document.financeWithheld')}</p>
        ) : eligibility.kind === 'refused' ? (
          <Unreadable locale={locale} messages={messages} reference={eligibility.reference} />
        ) : (
          <>
            <p lang={locale}>
              {translate(
                messages,
                eligibility.value.eligible
                  ? 'delivery.eligibility.eligible'
                  : 'delivery.eligibility.notEligible'
              )}
            </p>
            {eligibility.value.blockers.length === 0 ? null : (
              <>
                <h3 className="mt-2 text-body font-medium" lang={locale}>
                  {translate(messages, 'delivery.eligibility.blockersHeading')}
                </h3>
                <ul className="mt-1 list-disc ps-6">
                  {eligibility.value.blockers.map((code) => (
                    <li key={code} lang={locale}>
                      <BlockerLabel messages={messages} code={code} />
                      {/*
                        A reason the server could not ESTABLISH is not a reason
                        it observed. Printing the two alike would turn a read
                        that failed into a fact about this customer.
                      */}
                      {isUnestablished(eligibility.value, code) ? (
                        <span className="text-text-muted">
                          {' — '}
                          {translate(messages, 'delivery.document.factUnreadable')}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="delivery-document-receiver" className="mb-6">
        <h2 id="delivery-document-receiver" className="mb-2 text-section-title font-medium">
          {translate(messages, 'delivery.receiver.heading')}
        </h2>
        {receiver.kind === 'refused' ? (
          <Unreadable locale={locale} messages={messages} reference={receiver.reference} />
        ) : receiver.value === null ? (
          <p lang={locale}>{translate(messages, 'delivery.receiver.noneDescription')}</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Fact label={translate(messages, 'delivery.receiver.partner')}>
              <Identifier value={receiver.value.receiverPartnerId} />
            </Fact>
            <Fact label={translate(messages, 'delivery.receiver.verifiedBy')}>
              <Identifier value={receiver.value.verifiedBy} />
            </Fact>
            <Fact label={translate(messages, 'delivery.receiver.verifiedAt')}>
              <bdi>{formatDateTime(receiver.value.verifiedAt, locale)}</bdi>
            </Fact>
            {/* EXISTENCE, never the reference and never the content. */}
            <Fact label={translate(messages, 'delivery.document.identityEvidence')}>
              {translate(
                messages,
                receiver.value.identityEvidenceDocumentVersionId === null
                  ? 'delivery.receiver.evidenceAbsent'
                  : 'delivery.receiver.evidenceOnFile'
              )}
            </Fact>
          </dl>
        )}
      </section>

      <section aria-labelledby="delivery-document-checklist" className="mb-6">
        <h2 id="delivery-document-checklist" className="mb-2 text-section-title font-medium">
          {translate(messages, 'delivery.document.checklistCaption')}
        </h2>
        {checklist.kind === 'refused' ? (
          <Unreadable locale={locale} messages={messages} reference={checklist.reference} />
        ) : checklist.rows.length === 0 ? (
          <p lang={locale}>{translate(messages, 'delivery.document.checklistNone')}</p>
        ) : (
          <PrintTable
            caption={translate(messages, 'delivery.document.checklistCaption')}
            headers={[
              translate(messages, 'delivery.document.column.itemCode'),
              translate(messages, 'delivery.document.column.item'),
              translate(messages, 'delivery.document.column.result'),
              translate(messages, 'delivery.document.column.waiverReason'),
            ]}
            rows={checklist.rows.map((row) => [
              <code key="c" className="font-mono" dir="ltr">
                {row.itemCode}
              </code>,
              <bdi key="l">{row.label}</bdi>,
              <OutcomeLabel key="o" messages={messages} outcome={row.outcome} />,
              row.waiverReason === null ? (
                <NotRecorded key="w" />
              ) : (
                <bdi key="w">{row.waiverReason}</bdi>
              ),
            ])}
          />
        )}
        <Truncation locale={locale} messages={messages} section={checklist} />
      </section>

      <section aria-labelledby="delivery-document-signatures" className="mb-6">
        <h2 id="delivery-document-signatures" className="mb-2 text-section-title font-medium">
          {translate(messages, 'delivery.document.signaturesCaption')}
        </h2>
        {signatures.kind === 'refused' ? (
          <Unreadable locale={locale} messages={messages} reference={signatures.reference} />
        ) : signatures.rows.length === 0 ? (
          <p lang={locale}>{translate(messages, 'delivery.document.signaturesNone')}</p>
        ) : (
          <PrintTable
            caption={translate(messages, 'delivery.document.signaturesCaption')}
            headers={[
              translate(messages, 'delivery.document.column.signer'),
              translate(messages, 'delivery.document.column.signedAt'),
              translate(messages, 'delivery.document.column.signatureImage'),
            ]}
            rows={signatures.rows.map((row) => [
              <SignerRoleLabel key="r" messages={messages} role={row.signerRole} />,
              <bdi key="s">{formatDateTime(row.signedAt, locale)}</bdi>,
              // The mark is on file. The bytes are neither fetched nor offered.
              translate(messages, 'delivery.signatures.onFile'),
            ])}
          />
        )}
        <p className="mt-2 text-supporting text-text-muted" lang={locale}>
          {translate(messages, 'delivery.signatures.documentsExplain')}
        </p>
        <Truncation locale={locale} messages={messages} section={signatures} />
      </section>

      <section aria-labelledby="delivery-document-history">
        <h2 id="delivery-document-history" className="mb-2 text-section-title font-medium">
          {translate(messages, 'delivery.document.historyCaption')}
        </h2>
        {history.kind === 'refused' ? (
          <Unreadable locale={locale} messages={messages} reference={history.reference} />
        ) : history.rows.length === 0 ? (
          <p lang={locale}>{translate(messages, 'delivery.document.historyNone')}</p>
        ) : (
          <PrintTable
            caption={translate(messages, 'delivery.document.historyCaption')}
            headers={[
              translate(messages, 'delivery.document.column.from'),
              translate(messages, 'delivery.document.column.to'),
              translate(messages, 'delivery.document.column.when'),
              translate(messages, 'delivery.document.column.recordedBy'),
            ]}
            rows={history.rows.map((row) => [
              // A first transition has no previous stage. That is a beginning,
              // not a gap, and it is printed as one.
              row.fromStatus === null ? (
                translate(messages, 'delivery.document.start')
              ) : (
                <StatusLabel key="f" messages={messages} status={row.fromStatus} />
              ),
              <StatusLabel key="t" messages={messages} status={row.toStatus} />,
              <bdi key="w">{formatDateTime(row.occurredAt, locale)}</bdi>,
              <Identifier key="a" value={row.actorId} />,
            ])}
          />
        )}
        <Truncation locale={locale} messages={messages} section={history} />
      </section>
    </PrintDocument>
  );
}

/**
 * The work order, the customer and the vehicle as the work-order read publishes
 * them — or as references, when it was not read.
 *
 * `wo.work-order-detail` is the ONLY read reachable from this screen that
 * publishes a customer name, a registration plate or a work-order number, and it
 * declares its own permission. A caller without that permission gets the
 * identifier the delivery record itself carries, and the sheet says why: the
 * alternative is a screen that resolves a name its reader may not see.
 */
function WorkOrderFacts({
  locale,
  messages,
  workOrder,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrder: DocumentFact<WorkOrderDetail>;
}) {
  if (workOrder.kind !== 'read') {
    return (
      <div className="sm:col-span-2">
        <dt className="text-supporting text-text-secondary">
          {translate(messages, 'delivery.document.workOrder')}
        </dt>
        <dd lang={locale}>
          {translate(
            messages,
            workOrder.kind === 'withheld'
              ? 'delivery.document.workOrderWithheld'
              : 'delivery.document.workOrderRefused'
          )}
        </dd>
      </div>
    );
  }

  const entry = workOrder.value.workOrder;
  return (
    <>
      <Fact label={translate(messages, 'delivery.document.workOrder')}>
        {entry.displayNumber === null ? (
          <Identifier value={entry.id} />
        ) : (
          <span className="font-mono" dir="ltr">
            {entry.displayNumber}
          </span>
        )}
      </Fact>
      <Fact label={translate(messages, 'delivery.document.customer')}>
        {entry.customer === null ? <NotRecorded /> : <bdi>{entry.customer.displayName}</bdi>}
      </Fact>
      <Fact label={translate(messages, 'delivery.document.vehicle')}>
        {entry.vehicle.registrationPlate === null && entry.vehicle.makeModel === null ? (
          <Identifier value={entry.vehicle.vehicleId} />
        ) : (
          <bdi>
            {[entry.vehicle.registrationPlate, entry.vehicle.makeModel]
              .filter((part) => part !== null)
              .join(' — ')}
          </bdi>
        )}
      </Fact>
    </>
  );
}

/** Whether a blocker's composed fact was never established, so it is assumed. */
function isUnestablished(eligibility: DeliveryEligibility, code: string): boolean {
  const fact = eligibility.facts.find((entry) => entry.blocker === code);
  return fact !== undefined && !fact.established;
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div>
      <dt className="text-supporting text-text-secondary">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** An identifier, printed as an identifier: left-to-right in both directions. */
function Identifier({ value }: { readonly value: string | null }) {
  if (value === null) return <NotRecorded />;
  return (
    <code className="font-mono text-caption" dir="ltr">
      {value}
    </code>
  );
}

/** A value the record does not carry. */
function NotRecorded() {
  return <span className="text-text-muted">{'—'}</span>;
}

/**
 * A part whose read failed, said in place of what it would have carried.
 *
 * Every failure prints one sentence and the reference the backend logged. A
 * denial, an expiry and an outage are different causes with one consequence for
 * this sheet — the part is missing — and naming the cause on a sheet that leaves
 * the building states the workshop's internal condition to the wrong reader.
 */
function Unreadable({
  locale,
  messages,
  reference,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reference: string | null;
}) {
  return (
    <p lang={locale}>
      {translate(messages, 'delivery.document.sectionRefused')}
      {reference === null ? null : (
        <code className="ms-2 font-mono text-caption" dir="ltr">
          {reference}
        </code>
      )}
    </p>
  );
}

/**
 * Truncation, said rather than hidden.
 *
 * One page of each list is printed. A refused read reports no end-of-set signal
 * at all, and `Unreadable` has already said so, so this note is withheld there
 * rather than printed as a second, quieter falsehood.
 */
function Truncation({
  locale,
  messages,
  section,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly section: DocumentSection<unknown>;
}) {
  if (section.kind !== 'read' || !section.hasMore) return null;
  return (
    <p className="mt-2 text-supporting text-text-muted" lang={locale}>
      {translate(messages, 'delivery.document.partialList')}
    </p>
  );
}
