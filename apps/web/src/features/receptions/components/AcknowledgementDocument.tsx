import { BrandMark } from '@/components/brand/BrandMark';
import type { ServerPageStatus } from '@/components/data-table/use-server-table';
import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type {
  AuthorizationEntry,
  ConditionEvidenceEntry,
  PartyRoleEntry,
  ReceptionDetail,
} from '../receptions-contract';
import { hasRegisteredMedia, isCustomerReported } from '../check-in/closure';

/**
 * The reception acknowledgement document (`FE-021`).
 *
 * A rendering of the visit record the customer takes away, and the copy the
 * workshop keeps. It is a SERVER component with no controls of its own: printing
 * is the browser's, and nothing here is interactive, so nothing has to be hidden
 * on paper.
 *
 * ## It uses the print foundation P1-27 shipped, and does not build a second one
 *
 * `components/print/PrintDocument.tsx` already owns the page geometry, the
 * repeating header, the forced `paper` surface (a dark theme would otherwise
 * print grey blocks), and `PrintTable`, whose real `<thead>` is what repeats a
 * header across a page break. Those are exactly the four things a second
 * document would get wrong differently. `dir` is inherited from the document
 * root, so the Arabic acknowledgement is RTL without a second layout.
 *
 * No PDF is generated and no bytes are produced. This is HTML that prints well —
 * the export gate refuses blob/download/PDF generation, and this document does
 * not claim to be one.
 *
 * ## What it deliberately does not print
 *
 *   - **Storage keys and document identifiers.** Media reaches the record as a
 *     document REFERENCE; a customer's copy has no use for an internal
 *     identifier and printing one leaks the shape of the store. What prints is
 *     the STATE: *registered, pending*. Never "uploaded" — `P1-OD-025` is open,
 *     no upload path exists in this phase, and a document that said "uploaded"
 *     would be asserting something the platform has not done.
 *   - **The customer's complaint wording.** `rec.complaint_details` is a
 *     restricted narrative table the evidence read excludes on purpose, so the
 *     words are not available to print. The document says so rather than
 *     paraphrasing a complaint into a finding.
 *   - **A verification claim.** Nothing on this sheet has been through a
 *     technician: reception records what the customer reported and what staff
 *     observed, and diagnosis belongs to the work order. Every evidence line
 *     therefore carries *Not yet technically verified*, in Arabic and in
 *     English, and a customer-reported line is labelled as the customer's
 *     report rather than as a fact the workshop has asserted.
 *   - **The receiving employee's name.** There is none to print: G-EMP is an
 *     open decision and the column holds a bare identifier with no referent, so
 *     the document prints the identifier and says what it is.
 */

/**
 * One section of the sheet, WITH the outcome of the read that produced it.
 *
 * The status travels because an empty list and a failed read are different
 * facts and print differently. They used to be the same value here — the page
 * passed `rows` alone, a failure arrives as `rows: []`, and the sheet printed
 * *nothing is recorded on this visit*: an observed ABSENCE, asserted on a
 * document the customer signs and takes away, about records that may well
 * exist. A read that did not happen is now said to have not happened, with its
 * correlation reference, which is the only honest thing the sheet can print.
 */
export interface AcknowledgementSection<Row> {
  readonly status: ServerPageStatus;
  readonly rows: readonly Row[];
  /** True when the read reported more rows than this one page carries. */
  readonly hasMore: boolean;
  /** The failed read's reference, for the operator who has to chase it. */
  readonly correlationId: string | null;
}

export interface AcknowledgementSections {
  readonly parties: AcknowledgementSection<PartyRoleEntry>;
  readonly authorizations: AcknowledgementSection<AuthorizationEntry>;
  readonly evidence: AcknowledgementSection<ConditionEvidenceEntry>;
}

export function AcknowledgementDocument({
  locale,
  messages,
  detail,
  sections,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: ReceptionDetail;
  readonly sections: AcknowledgementSections;
}) {
  const title =
    detail.displayNumber !== null
      ? `${translate(messages, 'receptions.acknowledgement.title')} — ${detail.displayNumber}`
      : translate(messages, 'receptions.acknowledgement.title');

  return (
    <PrintDocument
      title={title}
      brand={<BrandMark />}
      header={
        <>
          <p>
            {translate(messages, 'receptions.wizard.custodyAccepted')}:{' '}
            <bdi>{formatDateTime(detail.custodyAcceptedAt, locale)}</bdi>
          </p>
          <p>
            {translate(messages, 'receptions.wizard.status')}:{' '}
            {translateDynamic(messages, `receptions.status.${detail.receptionStatus}`)}
          </p>
        </>
      }
      footer={<p lang={locale}>{translate(messages, 'receptions.acknowledgement.footerNote')}</p>}
    >
      <section aria-labelledby="acknowledgement-visit" className="mb-6">
        <h2 id="acknowledgement-visit" className="mb-2 text-section-title font-medium">
          {translate(messages, 'receptions.acknowledgement.visitHeading')}
        </h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Fact label={translate(messages, 'receptions.wizard.origin')}>
            {translateDynamic(messages, `receptions.origin.${detail.origin}`)}
          </Fact>
          <Fact label={translate(messages, 'receptions.wizard.vehicle')}>
            {detail.vehicleDisplayNumber ??
              translate(messages, 'receptions.wizard.vehicleUnnumbered')}
          </Fact>
          {detail.fuelLevelName !== null ? (
            <Fact label={translate(messages, 'receptions.wizard.fuelLevel')}>
              {detail.fuelLevelName}
            </Fact>
          ) : null}
          {detail.evSocPercent !== null ? (
            <Fact label={translate(messages, 'receptions.wizard.evSoc')}>
              {/* numeric(5,2) travels as a STRING; printed as received, LTR. */}
              <span dir="ltr">{detail.evSocPercent}%</span>
            </Fact>
          ) : null}
          <Fact label={translate(messages, 'receptions.wizard.receivingEmployee')}>
            <code className="font-mono text-caption" dir="ltr">
              {detail.receivingEmployeeId}
            </code>
          </Fact>
        </dl>
        <p className="mt-2 text-supporting text-text-muted" lang={locale}>
          {translate(messages, 'receptions.wizard.receivingEmployeeNote')}
        </p>
      </section>

      <section aria-labelledby="acknowledgement-parties" className="mb-6">
        <h2 id="acknowledgement-parties" className="mb-2 text-section-title font-medium">
          {translate(messages, 'receptions.summary.partiesHeading')}
        </h2>
        {sections.parties.status !== 'ok' ? (
          <Unreadable locale={locale} messages={messages} section={sections.parties} />
        ) : sections.parties.rows.length === 0 ? (
          <p lang={locale}>{translate(messages, 'receptions.summary.partiesEmpty')}</p>
        ) : (
          <PrintTable
            headers={[
              translate(messages, 'receptions.acknowledgement.columnParty'),
              translate(messages, 'receptions.parties.role'),
              translate(messages, 'receptions.acknowledgement.columnFrom'),
            ]}
            rows={sections.parties.rows.map((row) => [
              row.partnerDisplayName ?? translate(messages, 'receptions.checkIn.partyUnavailable'),
              translateDynamic(messages, `receptions.partyRole.${row.relationshipRole}`),
              <bdi key={row.id}>{formatDateTime(row.validFrom, locale)}</bdi>,
            ])}
          />
        )}
        <Truncation locale={locale} messages={messages} section={sections.parties} />
      </section>

      <section aria-labelledby="acknowledgement-authorizations" className="mb-6">
        <h2 id="acknowledgement-authorizations" className="mb-2 text-section-title font-medium">
          {translate(messages, 'receptions.summary.authorizationsHeading')}
        </h2>
        {sections.authorizations.status !== 'ok' ? (
          <Unreadable locale={locale} messages={messages} section={sections.authorizations} />
        ) : sections.authorizations.rows.length === 0 ? (
          <p lang={locale}>{translate(messages, 'receptions.summary.authorizationsEmpty')}</p>
        ) : (
          <PrintTable
            headers={[
              translate(messages, 'receptions.acknowledgement.columnParty'),
              translate(messages, 'receptions.authorization.decision'),
              translate(messages, 'receptions.acknowledgement.columnRecord'),
            ]}
            rows={sections.authorizations.rows.map((row) => [
              row.partnerDisplayName ?? translate(messages, 'receptions.checkIn.partyUnavailable'),
              translate(
                messages,
                row.decision === 'approved'
                  ? 'receptions.authorization.approved'
                  : 'receptions.authorization.declined'
              ),
              translate(
                messages,
                row.kind === 'refusal'
                  ? 'receptions.authorization.kindRefusal'
                  : 'receptions.authorization.kindAuthorization'
              ),
            ])}
          />
        )}
        <Truncation locale={locale} messages={messages} section={sections.authorizations} />
      </section>

      <section aria-labelledby="acknowledgement-evidence">
        <h2 id="acknowledgement-evidence" className="mb-2 text-section-title font-medium">
          {translate(messages, 'receptions.summary.evidenceHeading')}
        </h2>
        <p className="mb-2" lang={locale}>
          {translate(messages, 'receptions.summary.notVerified')}
        </p>
        {sections.evidence.status !== 'ok' ? (
          <Unreadable locale={locale} messages={messages} section={sections.evidence} />
        ) : sections.evidence.rows.length === 0 ? (
          <p lang={locale}>{translate(messages, 'receptions.summary.evidenceEmpty')}</p>
        ) : (
          <PrintTable
            headers={[
              translate(messages, 'receptions.acknowledgement.columnEvidence'),
              translate(messages, 'receptions.acknowledgement.columnSource'),
              translate(messages, 'receptions.acknowledgement.columnMedia'),
              translate(messages, 'receptions.acknowledgement.columnRecordedAt'),
            ]}
            rows={sections.evidence.rows.map((row) => [
              translateDynamic(messages, `receptions.evidenceKind.${row.kind}`),
              translate(
                messages,
                isCustomerReported(row.kind)
                  ? 'receptions.summary.customerReported'
                  : 'receptions.summary.staffObserved'
              ),
              hasRegisteredMedia(row.evidenceDocumentId)
                ? // The STATE, never the reference. See the docblock.
                  translate(messages, 'receptions.summary.mediaRegistered')
                : translate(messages, 'receptions.acknowledgement.noMedia'),
              <bdi key={row.id}>{formatDateTime(row.recordedAt, locale)}</bdi>,
            ])}
          />
        )}
        <p className="mt-2 text-supporting text-text-muted" lang={locale}>
          {translate(messages, 'receptions.summary.complaintWordsRestricted')}
        </p>
        <Truncation locale={locale} messages={messages} section={sections.evidence} />
      </section>
    </PrintDocument>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-supporting text-text-secondary">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A section whose read FAILED, said in place of the rows it would have carried.
 *
 * This is the whole point of carrying the status: the alternative printed
 * *nothing is recorded on this visit* — an absence the sheet never observed —
 * on the copy a customer signs. What the reader gets instead is the truth
 * (this section could not be read) and the reference that identifies the failed
 * request, so the gap is chaseable rather than mistaken for a fact.
 *
 * Every failure prints the same sentence. A denial, an expiry and an outage are
 * different causes with the same consequence for this sheet — the section is
 * missing — and naming the cause on a customer's copy would state the
 * workshop's internal condition to the wrong reader.
 */
function Unreadable({
  locale,
  messages,
  section,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly section: AcknowledgementSection<unknown>;
}) {
  return (
    <p lang={locale}>
      {translate(messages, 'receptions.acknowledgement.sectionUnreadable')}
      {section.correlationId !== null ? (
        <code className="ms-2 font-mono text-caption" dir="ltr">
          {section.correlationId}
        </code>
      ) : null}
    </p>
  );
}

/**
 * Truncation, said rather than hidden.
 *
 * Each section prints ONE keyset page. A document that silently stopped at the
 * page boundary would be a customer's copy missing records nobody mentioned, so
 * when the read reports more, the sheet says so and points at the screen that
 * pages.
 *
 * A failed read reports `hasMore: false`, which is not a claim that there is no
 * more — it is the absence of an answer. `Unreadable` has already said so, so
 * this note is withheld rather than printed as a second, quieter falsehood.
 */
function Truncation({
  locale,
  messages,
  section,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly section: AcknowledgementSection<unknown>;
}) {
  if (section.status !== 'ok' || !section.hasMore) return null;
  return (
    <p className="mt-2 text-supporting text-text-muted" lang={locale}>
      {translate(messages, 'receptions.acknowledgement.truncated')}
    </p>
  );
}
