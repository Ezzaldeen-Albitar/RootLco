/**
 * Quotation decisions and approval evidence (Phase 1-20, P1-20-BE-008, BE-009, BE-012).
 *
 * ## The decision model, stated plainly
 *
 * The protected schema records a decision **per quotation item**:
 * `quo.record_item_decision` takes a `quotation_item_id`, and
 * `uq_approval_decisions_item` makes one decision per
 * `(tenant, company, branch, revision, item)` permanent. There is no
 * revision-level decision row anywhere in `quo`.
 *
 * So this service exposes two things, and is explicit about which is stored and
 * which is derived:
 *
 *  - **`decideItem`** — the stored fact. One item, one decision, append-only.
 *  - **`decideRevision`** — an *orchestration* over the stored facts. It locks the
 *    revision, enumerates every undecided item, and records the same decision
 *    against each inside one transaction. It creates no second source of truth:
 *    the quotation-level outcome is always recomputed from the item rows by
 *    `rollUpDecisions`, never stored independently and never trusted from a
 *    client.
 *
 * A partial revision decision cannot survive: the orchestration runs in the
 * caller's transaction, so a failure on item three rolls back items one and two.
 *
 * ## What "the deciding party" means here, honestly
 *
 * `quo.approval_decisions.decided_by` is set by the database to
 * `iam.current_user_id()` — the **staff user who recorded** the decision, not the
 * customer. The schema has no column for a customer principal, and inventing one
 * in the application would be a fiction. What the schema does carry is
 * `decision_channel`, i.e. how the customer communicated it.
 *
 * The integrity control is therefore: a claimed customer party is validated
 * against the quotation's own `payer_partner_ref` before anything is written. A
 * caller cannot name an arbitrary partner and have it accepted, and the recorded
 * fact is truthfully "staff user X recorded that the payer decided Y over channel
 * Z" — which is what actually happened.
 */
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { iamDirectory } from '@/modules/iam';
import { sharedServicesModule } from '@/modules/shared-services';
import { normalizePhoneDigits } from '@/shared/text/normalization';
import {
  AcceptanceContactError,
  DECISION_CHANNELS,
  DECISIONS,
  EVIDENCE_KINDS,
  QuotationRuleError,
  assertContactNotOnReplay,
  assertContactReachesRecord,
  assertEvidenceShape,
  hasExpired,
  lineDecisionCompletesAcceptance,
  normalizeAcceptanceContact,
  rollUpDecisions,
  type AcceptanceContact,
} from '../domain/quotation';
import type {
  AcceptanceRecordRow,
  DecisionRow,
  ItemRow,
  QuotationRepository,
  QuotationRow,
  RevisionRow,
} from '../data/quotation-repository';

export interface EvidenceInput {
  readonly evidenceKind: string;
  /** A `shared.document_versions` id. **Never** a storage key. */
  readonly documentVersionId?: string | undefined;
  readonly referenceNote?: string | undefined;
}

export interface DecideInput {
  readonly decision: string;
  readonly channel: string;
  /**
   * The customer party the decision is attributed to. Validated against the
   * quotation's `payer_partner_ref`; an arbitrary id is refused.
   */
  readonly decidingPartyRef?: string | undefined;
  readonly evidence?: EvidenceInput | undefined;
  /**
   * Who spoke for the customer, when the decision completes an acceptance
   * (ADR-023 D11). A typed name and telephone number: the CRM model records a
   * customer's contact channels, not the people who speak for it. Both optional,
   * and refused on a rejection. Kept on the acceptance record only.
   */
  readonly contactName?: string | undefined;
  readonly contactPhone?: string | undefined;
  /** The revision the caller believes it is deciding. Refused if it has moved on. */
  readonly presentedRevisionId: string;
}

/**
 * What the decision that completes an acceptance carries into the acceptance
 * record: the deciding party as validated, the contact, the channel and the
 * evidence as given. The recorder and the time are the session's own.
 */
interface AcceptanceDetails {
  readonly customerPartnerId: string | null;
  readonly contact: AcceptanceContact;
  readonly channel: string;
  readonly evidenceKind: string | null;
  readonly referenceNote: string | null;
  readonly evidenceDocumentVersionId: string | null;
}

/** A person named on an acceptance record. `displayName` is `null` for a caller who may not read users. */
export interface AcceptanceRecorderView {
  readonly id: string;
  readonly displayName: string | null;
}

/**
 * The acceptance record of an accepted revision (P1-32-PRE-OD-FD11, ADR-023 D11).
 *
 * Who accepted (the payer, when the employee said the payer decided, and the
 * contact who spoke for them), how (`channel`), when (`acceptedAt`, the
 * database's time), who recorded it (`recordedBy`, the signed-in employee) and on
 * what reference or evidence. It is a record of what the employee was told and
 * did, not an electronic signature. Every optional part is `null` when it was not
 * given — nothing is filled in.
 *
 * `recordedBy.displayName` is resolved through the identity directory, which
 * names nobody to a caller who may not read users; `recordedByCaller` still lets
 * that caller see the record was their own.
 */
export interface AcceptanceRecordView {
  readonly id: string;
  readonly quotationRevisionId: string;
  readonly customerPartnerId: string | null;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly channel: string;
  readonly evidenceKind: string | null;
  readonly referenceNote: string | null;
  readonly documentVersionId: string | null;
  readonly acceptedAt: string;
  readonly recordedBy: AcceptanceRecorderView;
  readonly recordedByCaller: boolean;
}

export interface DecisionView {
  readonly decisionId: string;
  readonly quotationItemId: string;
  readonly quotationRevisionId: string;
  readonly decision: string;
  readonly channel: string;
  readonly decidedAt: string;
  readonly recordedBy: string;
  readonly evidenceId: string | null;
}

export interface RevisionDecisionView {
  readonly quotationId: string;
  readonly revisionId: string;
  readonly decision: string;
  readonly itemsDecided: number;
  readonly decisions: readonly DecisionView[];
  /** The recomputed quotation-level outcome, or `null` if still incomplete. */
  readonly quotationStatus: string | null;
}

/**
 * One recorded decision as the audit read renders it (P1-30 A2, seam S-09).
 *
 * `DecisionView` above is the WRITE response - what was just recorded. This is
 * the read: it names the LINE the decision belongs to, so a reviewer can hold it
 * against the revision without a second lookup, and it carries every evidence row
 * rather than the single `evidence_ref` the write path echoes back.
 *
 * `decidedBy` is a `iam.user_accounts` id and is returned for navigation only.
 * It is deliberately NOT resolved to a name here: that is personal data behind
 * its own read, and joining it in would publish an actor directory to anyone
 * holding `quo.quotation.read`.
 */
export interface DecisionAuditView {
  readonly decisionId: string;
  readonly quotationRevisionId: string;
  readonly quotationItemId: string;
  readonly lineNumber: number;
  readonly description: string | null;
  readonly decision: string;
  readonly channel: string;
  readonly decidedAt: string;
  readonly recordedBy: string;
  readonly evidence: readonly EvidenceView[];
}

/** One evidence row. Carries a document VERSION id, never a storage key. */
export interface EvidenceView {
  readonly id: string;
  readonly evidenceKind: string;
  readonly documentVersionId: string | null;
  readonly referenceNote: string | null;
  readonly recordedAt: string;
}

/**
 * The decision state of one revision (P1-30 A2, seam S-09).
 *
 * `outcome` is RECOMPUTED from the item rows by `rollUpDecisions`, exactly as
 * every other consumer of this data computes it - there is no stored
 * revision-level decision in `quo` and this read invents none. `null` means the
 * revision is still partly undecided, which is a real state and not an absence.
 *
 * `itemCount` comes from the revision's items, not from the decisions, so
 * `decisions.length < itemCount` is visibly "not everything has been answered"
 * rather than something a caller has to infer.
 */
export interface RevisionDecisionAuditView {
  readonly quotationId: string;
  readonly revisionId: string;
  readonly revisionStatus: string;
  readonly itemCount: number;
  readonly decidedCount: number;
  readonly outcome: 'accepted' | 'rejected' | null;
  readonly decisions: readonly DecisionAuditView[];
  /**
   * The revision's acceptance record, or `null`. `null` beside `outcome:
   * 'accepted'` is a revision accepted before acceptance records existed — it is
   * not backfilled, because who spoke for the customer was never captured.
   */
  readonly acceptance: AcceptanceRecordView | null;
}

export class QuotationDecisionService {
  public constructor(private readonly repository: QuotationRepository) {}

  /**
   * Every decision recorded against one revision, with its evidence
   * (Phase 1-30 A2, seam S-09).
   *
   * ## What was missing
   *
   * Everything. `quo.approval_decisions` could be written per item and per
   * revision, and read back exactly one item at a time through
   * `findDecisionForItem` - which the write path uses to detect a replay, not to
   * publish anything. `quo.approval_evidence` had an INSERT and no read at all.
   * So the append-only approval trail the schema was built to keep
   * (BR-QUO-001/002) was unreadable through the product: a dispute over what a
   * customer approved could not be answered from the API.
   *
   * ## Scope
   *
   * From the revision row's own company and branch, resolved BEFORE any decision
   * is read. The path names no branch, so `scope: 'branch'` would otherwise be
   * inert (P1-18-A-01), and a revision the caller may not see is `ERR-RES-001`
   * rather than an empty decision list.
   *
   * ## The outcome is derived, never stored
   *
   * `rollUpDecisions` folds the item rows the same way `commercialApproval` and
   * the write path do. Caching it here would create a second approval truth that
   * could disagree with the rows underneath it.
   */
  public async readRevisionDecisions(
    db: DbHandle,
    revisionId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<RevisionDecisionAuditView> {
    const revision = await this.repository.findRevision(db, revisionId);
    if (revision === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Quotation revision ${revisionId} is not visible`,
      });
    }
    await authorizeScope({ companyId: revision.companyId, branchId: revision.branchId });

    const rows = await this.repository.listDecisionsForRevision(db, revision.id);
    const tally = await this.repository.tallyDecisions(db, revision.id);
    const record = await this.repository.findAcceptanceRecordForRevision(db, revision.id);
    const acceptance = record === null ? null : await this.describeAcceptance(db, record);
    return {
      quotationId: revision.quotationId,
      revisionId: revision.id,
      revisionStatus: revision.status,
      itemCount: tally.itemCount,
      decidedCount: tally.approvedCount + tally.rejectedCount,
      outcome: rollUpDecisions(tally),
      decisions: rows.map((row) => ({
        decisionId: row.id,
        quotationRevisionId: row.quotationRevisionId,
        quotationItemId: row.quotationItemId,
        lineNumber: row.lineNumber,
        description: row.description,
        decision: row.decision,
        channel: row.decisionChannel,
        decidedAt: row.decidedAt.toISOString(),
        recordedBy: row.decidedBy,
        evidence: row.evidence.map((piece) => ({
          id: piece.id,
          evidenceKind: piece.evidenceKind,
          documentVersionId: piece.documentVersionId,
          referenceNote: piece.referenceNote,
          recordedAt: piece.recordedAt.toISOString(),
        })),
      })),
      acceptance,
    };
  }

  /** Renders an acceptance record for the wire, naming the recorder where the caller may. */
  private async describeAcceptance(
    db: DbHandle,
    record: AcceptanceRecordRow
  ): Promise<AcceptanceRecordView> {
    const names = await iamDirectory().directory.resolveDisplayIdentities(db, [record.recordedBy]);
    return {
      id: record.id,
      quotationRevisionId: record.quotationRevisionId,
      customerPartnerId: record.customerPartnerId,
      contactName: record.contactName,
      contactPhone: record.contactPhone,
      channel: record.channel,
      evidenceKind: record.evidenceKind,
      referenceNote: record.referenceNote,
      documentVersionId: record.evidenceDocumentVersionId,
      acceptedAt: record.acceptedAt.toISOString(),
      recordedBy: {
        id: record.recordedBy,
        displayName: names.get(record.recordedBy)?.displayName ?? null,
      },
      recordedByCaller: record.recordedBy === db.context.principal.userId,
    };
  }

  /**
   * Records the customer's decision on ONE quotation line.
   *
   * Every guard below closes a specific way a decision could be recorded against
   * something the customer never saw.
   */
  public async decideItem(
    db: DbHandle,
    itemId: string,
    input: DecideInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<DecisionView> {
    this.assertVocabulary(input);
    const contact = this.acceptanceContact(input);

    const item = await this.repository.findItem(db, itemId);
    if (item === null) {
      throw new AppFailure('ERR-RES-001', { message: `Quotation item ${itemId} is not visible` });
    }

    const revision = await this.repository.findRevision(db, item.quotationRevisionId);
    if (revision === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Revision ${item.quotationRevisionId} is not visible`,
      });
    }

    // Parent first, then re-read the revision under the lock. Both
    // `quo.record_item_decision` and `quo.issue_revision` take this same lock, so
    // any other order deadlocks against them.
    const quotation = await this.lockAndAuthorize(db, revision.quotationId, authorizeScope);
    const locked = await this.repository.lockRevision(db, revision.id);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', { message: `Revision ${revision.id} is not visible` });
    }

    await this.assertDecidable(db, quotation, locked, input.presentedRevisionId);
    this.assertParty(quotation, input.decidingPartyRef ?? null);

    const existing = await this.repository.findDecisionForItem(db, item.id);
    if (existing !== null) {
      // Settling writes nothing: another call decided this line meanwhile and, when
      // it completed the acceptance, wrote the record without this contact. A
      // contact here would be answered 201 and kept nowhere, so it is refused.
      const settled = this.settleExisting(existing, input);
      this.refuseContact(() => assertContactNotOnReplay(input, false));
      return settled;
    }

    // A contact is kept only on the acceptance record, which only the decision
    // completing the acceptance writes. Counted under the revision lock, before
    // anything is written, so a contact on any other approval is refused rather
    // than answered 201 and stored nowhere.
    if (input.contactName !== undefined || input.contactPhone !== undefined) {
      const tally = await this.repository.tallyDecisions(db, locked.id);
      this.refuseContact(() =>
        assertContactReachesRecord(input, lineDecisionCompletesAcceptance(input.decision, tally))
      );
    }

    const evidenceRef = await this.resolveEvidenceRef(db, quotation, input.evidence);
    const decisionId = await this.repository.recordItemDecision(db, {
      itemId: item.id,
      decision: input.decision,
      channel: input.channel,
      evidenceRef,
    });

    const evidence =
      input.evidence === undefined
        ? null
        : await this.repository.insertEvidence(db, {
            companyId: quotation.companyId,
            branchId: quotation.branchId,
            approvalDecisionId: decisionId,
            evidenceKind: input.evidence.evidenceKind,
            documentVersionId: input.evidence.documentVersionId ?? null,
            referenceNote: input.evidence.referenceNote ?? null,
          });

    await this.auditDecision(db, quotation, locked, item, input, decisionId, evidence?.id ?? null);
    await this.publishItemDecided(db, quotation, locked, item, input.decision, decisionId);
    await this.rollUp(db, quotation, locked, this.acceptanceDetails(input, contact, evidenceRef));

    const stored = await this.repository.findDecisionForItem(db, item.id);
    if (stored === null) {
      throw new AppFailure('ERR-SYS-001', { message: 'The decision was not recorded' });
    }
    return {
      decisionId: stored.id,
      quotationItemId: item.id,
      quotationRevisionId: locked.id,
      decision: stored.decision,
      channel: stored.decisionChannel,
      decidedAt: stored.decidedAt.toISOString(),
      recordedBy: stored.decidedBy,
      evidenceId: evidence?.id ?? null,
    };
  }

  /**
   * Records ONE decision against every still-undecided item of a revision.
   *
   * The atomic whole-revision command. It is an orchestration over the protected
   * per-item function, not an alternative storage path — there is no
   * revision-level decision row, and this method creates none.
   *
   * All-or-nothing: it runs entirely inside the caller's transaction, so a
   * failure part-way leaves no partially decided revision. Items that already
   * carry the SAME decision are treated as already-settled (idempotent replay);
   * an item carrying the OPPOSITE decision is a conflict and aborts the whole
   * command, because silently overwriting it would discard a recorded customer
   * choice.
   */
  public async decideRevision(
    db: DbHandle,
    revisionId: string,
    input: DecideInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<RevisionDecisionView> {
    this.assertVocabulary(input);
    const contact = this.acceptanceContact(input);

    const revision = await this.repository.findRevision(db, revisionId);
    if (revision === null) {
      throw new AppFailure('ERR-RES-001', { message: `Revision ${revisionId} is not visible` });
    }
    const quotation = await this.lockAndAuthorize(db, revision.quotationId, authorizeScope);
    const locked = await this.repository.lockRevision(db, revisionId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', { message: `Revision ${revisionId} is not visible` });
    }

    await this.assertDecidable(db, quotation, locked, input.presentedRevisionId);
    this.assertParty(quotation, input.decidingPartyRef ?? null);

    const items = await this.repository.listItems(db, locked.id);
    if (items.length === 0) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'This revision has no lines to decide',
      });
    }

    const evidenceRef = await this.resolveEvidenceRef(db, quotation, input.evidence);

    // Every line's stored decision, read under the revision lock before anything is
    // written, so a conflict or a refused contact leaves nothing behind.
    const settled = new Map<string, DecisionRow>();
    for (const item of items) {
      const existing = await this.repository.findDecisionForItem(db, item.id);
      if (existing === null) continue;
      if (existing.decision !== input.decision) {
        throw new AppFailure('ERR-CON-001', {
          message:
            `Line ${item.lineNumber} was already ${existing.decision}; a conflicting ` +
            'revision-wide decision would discard a recorded customer choice',
        });
      }
      settled.set(item.id, existing);
    }
    // Every line already decided: this call is a pure replay and writes no line,
    // and the acceptance it repeats was recorded by an earlier call. A contact
    // sent with it would be answered 201 and kept nowhere, so it is refused.
    this.refuseContact(() => assertContactNotOnReplay(input, settled.size < items.length));

    const decisions: DecisionView[] = [];
    for (const item of items) {
      const existing = settled.get(item.id);
      if (existing !== undefined) {
        decisions.push({
          decisionId: existing.id,
          quotationItemId: item.id,
          quotationRevisionId: locked.id,
          decision: existing.decision,
          channel: existing.decisionChannel,
          decidedAt: existing.decidedAt.toISOString(),
          recordedBy: existing.decidedBy,
          evidenceId: null,
        });
        continue;
      }

      const decisionId = await this.repository.recordItemDecision(db, {
        itemId: item.id,
        decision: input.decision,
        channel: input.channel,
        evidenceRef,
      });
      const evidence =
        input.evidence === undefined
          ? null
          : await this.repository.insertEvidence(db, {
              companyId: quotation.companyId,
              branchId: quotation.branchId,
              approvalDecisionId: decisionId,
              evidenceKind: input.evidence.evidenceKind,
              documentVersionId: input.evidence.documentVersionId ?? null,
              referenceNote: input.evidence.referenceNote ?? null,
            });
      await this.publishItemDecided(db, quotation, locked, item, input.decision, decisionId);
      const stored = await this.repository.findDecisionForItem(db, item.id);
      decisions.push({
        decisionId,
        quotationItemId: item.id,
        quotationRevisionId: locked.id,
        decision: input.decision,
        channel: input.channel,
        decidedAt: (stored?.decidedAt ?? new Date()).toISOString(),
        recordedBy: stored?.decidedBy ?? db.context.principal.userId,
        evidenceId: evidence?.id ?? null,
      });
    }

    // ONE aggregate audit record for the revision-wide act, beside the per-item
    // events. The act a reviewer needs to see is "the customer decided this
    // revision", and a row per line would bury it.
    await appendAudit(db, {
      action: 'quo.quotation_revision.decided',
      entityType: 'quo.quotation_revision',
      entityId: locked.id,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      details: [
        { field: 'quotationId', classification: 'internal', value: quotation.id },
        { field: 'decision', classification: 'public', value: input.decision },
        { field: 'channel', classification: 'public', value: input.channel },
        { field: 'itemsDecided', classification: 'public', value: String(items.length) },
        ...(input.decidingPartyRef === undefined
          ? []
          : [
              {
                field: 'decidingPartyRef',
                classification: 'internal' as const,
                value: input.decidingPartyRef,
              },
            ]),
      ],
    });

    const outcome = await this.rollUp(
      db,
      quotation,
      locked,
      this.acceptanceDetails(input, contact, evidenceRef)
    );
    return {
      quotationId: quotation.id,
      revisionId: locked.id,
      decision: input.decision,
      itemsDecided: items.length,
      decisions,
      quotationStatus: outcome,
    };
  }

  // ---- internals -----------------------------------------------------------

  private assertVocabulary(input: DecideInput): void {
    if (!(DECISIONS as readonly string[]).includes(input.decision)) {
      throw new AppFailure('ERR-VAL-001', {
        message: `Decision must be one of ${DECISIONS.join(', ')}`,
      });
    }
    if (!(DECISION_CHANNELS as readonly string[]).includes(input.channel)) {
      throw new AppFailure('ERR-VAL-001', {
        message: `Channel must be one of ${DECISION_CHANNELS.join(', ')}`,
      });
    }
    if (input.evidence !== undefined) {
      if (!(EVIDENCE_KINDS as readonly string[]).includes(input.evidence.evidenceKind)) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Evidence kind must be one of ${EVIDENCE_KINDS.join(', ')}`,
        });
      }
      try {
        assertEvidenceShape(input.evidence.evidenceKind, input.evidence.documentVersionId ?? null);
      } catch (cause) {
        throw new AppFailure('ERR-VAL-001', {
          message: cause instanceof QuotationRuleError ? cause.message : 'Invalid evidence',
        });
      }
    }
  }

  /**
   * The contact of an acceptance, normalised, or a field refusal naming the box.
   * Checked before anything is written, so a bad telephone number never leaves a
   * half-recorded decision behind.
   */
  private acceptanceContact(input: DecideInput): AcceptanceContact {
    return this.refuseContact(() =>
      normalizeAcceptanceContact(
        input.decision,
        { contactName: input.contactName, contactPhone: input.contactPhone },
        normalizePhoneDigits
      )
    );
  }

  /** Runs a contact rule, turning its refusal into a field violation naming the box. */
  private refuseContact<T>(rule: () => T): T {
    try {
      return rule();
    } catch (cause) {
      if (cause instanceof AcceptanceContactError) {
        throw new AppFailure('ERR-VAL-001', {
          message: cause.message,
          safeDetails: { violations: [{ path: `body.${cause.field}`, rule: cause.rule }] },
        });
      }
      throw cause;
    }
  }

  /** What an acceptance completed by this decision records, all of it as given. */
  private acceptanceDetails(
    input: DecideInput,
    contact: AcceptanceContact,
    evidenceRef: string | null
  ): AcceptanceDetails {
    return {
      // `assertParty` has already refused any party that is not the payer.
      customerPartnerId: input.decidingPartyRef ?? null,
      contact,
      channel: input.channel,
      evidenceKind: input.evidence?.evidenceKind ?? null,
      referenceNote: input.evidence?.referenceNote ?? null,
      evidenceDocumentVersionId: evidenceRef,
    };
  }

  private async lockAndAuthorize(
    db: DbHandle,
    quotationId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<QuotationRow> {
    const quotation = await this.repository.lockQuotation(db, quotationId);
    if (quotation === null) {
      throw new AppFailure('ERR-RES-001', { message: `Quotation ${quotationId} is not visible` });
    }
    await authorizeScope({ companyId: quotation.companyId, branchId: quotation.branchId });
    return quotation;
  }

  /**
   * Every reason a revision may not be decided right now.
   *
   * `presentedRevisionId` is the important one and is easy to miss: without it, a
   * client that fetched revision 2, then had revision 3 issued underneath it,
   * would approve revision 3 while believing it approved revision 2. Approval of
   * revision N must never approve revision N+1.
   */
  private async assertDecidable(
    db: DbHandle,
    quotation: QuotationRow,
    revision: RevisionRow,
    presentedRevisionId: string
  ): Promise<void> {
    if (presentedRevisionId !== revision.id) {
      throw new AppFailure('ERR-CON-001', {
        message:
          `The presented revision ${presentedRevisionId} is not the revision being decided ` +
          `(${revision.id}); re-read the quotation before deciding`,
      });
    }
    if (quotation.currentRevisionId !== revision.id) {
      throw new AppFailure('ERR-CON-001', {
        message: 'This revision has been superseded and can no longer be decided',
      });
    }
    if (revision.status !== 'issued') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Revision ${revision.revisionNumber} is ${revision.status}; only an issued revision may be decided`,
      });
    }
    /**
     * The DATABASE clock, not the process clock.
     *
     * This is the only expiry gate on the two shipped decision routes, so it decides
     * whether a lapsed quotation can still be accepted. `new Date()` made that decision
     * on the application container's clock: a container running behind the database would
     * accept a decision on a revision the database considers expired, and the acceptance
     * would then be indistinguishable from a valid one. An audit could not even detect it,
     * because nothing records which clock was consulted.
     *
     * `serverNow()` reads `now()`, which is the transaction's start time, so this gate and
     * every `expires_at <= now()` predicate in the same transaction agree by construction.
     * The sweep and the port were moved to it earlier; this path was missed, and the
     * evidence claiming "the database clock on both sides" was wrong until now.
     */
    if (hasExpired(revision.expiresAt, await this.repository.serverNow(db))) {
      throw new AppFailure('ERR-TRN-001', {
        message: 'This quotation revision has expired and can no longer be decided',
      });
    }
  }

  /**
   * Validates a claimed customer party against the quotation's own payer.
   *
   * Refusing an unrelated partner is the whole of the "forged party" control the
   * schema permits: there is no customer principal column, so the truthful check
   * is that the party named matches the payer this quotation was raised for.
   */
  private assertParty(quotation: QuotationRow, decidingPartyRef: string | null): void {
    if (decidingPartyRef === null) return;
    if (quotation.payerPartnerRef === null) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'This quotation names no payer, so a deciding party cannot be attributed',
      });
    }
    if (quotation.payerPartnerRef !== decidingPartyRef) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'The deciding party is not the payer this quotation was raised for',
      });
    }
  }

  /**
   * Turns an evidence input into a `document_versions` id, or `null`.
   *
   * A direct storage key is impossible to pass: the field is a version id, and
   * the shared attachment service is asked to confirm the version exists in the
   * caller's scope, sits in the same company/branch as the quotation, and is
   * actually linked to THIS quotation. Without the link check, any visible
   * document could be attached as evidence for any quotation.
   */
  private async resolveEvidenceRef(
    db: DbHandle,
    quotation: QuotationRow,
    evidence: EvidenceInput | undefined
  ): Promise<string | null> {
    if (evidence?.documentVersionId === undefined) return null;

    const verified = await sharedServicesModule().attachments.verifyEvidenceVersion(
      db,
      evidence.documentVersionId,
      'quo.quotations',
      quotation.id
    );
    if (!verified.linkedToEntity) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'That document is not attached to this quotation and cannot be its evidence',
      });
    }
    // `null` on the version means tenant-wide, which is acceptable; a version that
    // names a DIFFERENT company or branch is not.
    if (verified.companyId !== null && verified.companyId !== quotation.companyId) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'That document belongs to another company',
      });
    }
    if (verified.branchId !== null && verified.branchId !== quotation.branchId) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'That document belongs to another branch',
      });
    }
    return verified.versionId;
  }

  /**
   * An idempotent replay returns the stored decision; a conflicting one refuses.
   *
   * `uq_approval_decisions_item` makes the first decision permanent, so the only
   * two honest answers are "you already did this" and "you cannot change it".
   */
  private settleExisting(existing: DecisionRow, input: DecideInput): DecisionView {
    if (existing.decision !== input.decision) {
      throw new AppFailure('ERR-CON-001', {
        message: `This line was already ${existing.decision} and that decision is final`,
      });
    }
    return {
      decisionId: existing.id,
      quotationItemId: existing.quotationItemId,
      quotationRevisionId: existing.quotationRevisionId,
      decision: existing.decision,
      channel: existing.decisionChannel,
      decidedAt: existing.decidedAt.toISOString(),
      recordedBy: existing.decidedBy,
      evidenceId: null,
    };
  }

  private async auditDecision(
    db: DbHandle,
    quotation: QuotationRow,
    revision: RevisionRow,
    item: ItemRow,
    input: DecideInput,
    decisionId: string,
    evidenceId: string | null
  ): Promise<void> {
    await appendAudit(db, {
      action: 'quo.quotation_item.decided',
      entityType: 'quo.quotation_item',
      entityId: item.id,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      // No evidence CONTENT and no note text: the audit trail records that
      // evidence exists and which row it is, never what it says.
      details: [
        { field: 'quotationId', classification: 'internal', value: quotation.id },
        { field: 'revisionId', classification: 'internal', value: revision.id },
        { field: 'lineNumber', classification: 'public', value: String(item.lineNumber) },
        { field: 'decision', classification: 'public', value: input.decision },
        { field: 'channel', classification: 'public', value: input.channel },
        { field: 'decisionId', classification: 'internal', value: decisionId },
        ...(evidenceId === null
          ? []
          : [{ field: 'evidenceId', classification: 'internal' as const, value: evidenceId }]),
      ],
    });
  }

  private async publishItemDecided(
    db: DbHandle,
    quotation: QuotationRow,
    revision: RevisionRow,
    item: ItemRow,
    decision: string,
    decisionId: string
  ): Promise<void> {
    await publishEvent(db, {
      eventType: 'quotation.item-decided',
      aggregateId: item.id,
      aggregateVersion: item.recordVersion,
      producer: 'quotation.quotation-decision-service',
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      // No amounts and no evidence: a consumer that may see the money reads the
      // revision under its own authorization.
      payload: {
        quotationId: quotation.id,
        revisionId: revision.id,
        quotationItemId: item.id,
        lineNumber: item.lineNumber,
        decision,
      },
      // One decision per item is terminal, so the key needs no version and a
      // replay collides rather than publishing twice.
      eventKey: `quotation.item-decided:${decisionId}`,
    });
  }

  /**
   * Recomputes the quotation-level outcome from the stored item decisions.
   *
   * Derived every time, never cached: the item rows are the only truth, and a
   * stored roll-up could drift from them. Returns the new status, or `null` when
   * the revision is still awaiting decisions.
   */
  private async rollUp(
    db: DbHandle,
    quotation: QuotationRow,
    revision: RevisionRow,
    acceptance: AcceptanceDetails
  ): Promise<string | null> {
    const tally = await this.repository.tallyDecisions(db, revision.id);
    const outcome = rollUpDecisions(tally);
    if (outcome === null) return null;

    // Re-read under the lock we already hold: `record_item_decision` does not bump
    // the quotation, but the roll-up may run after several item writes.
    const current = await this.repository.findQuotation(db, quotation.id);
    if (current === null || current.status === outcome) return outcome;

    const next = await this.repository.updateQuotationStatus(
      db,
      quotation.id,
      outcome,
      current.recordVersion
    );
    if (next === null) {
      throw new AppFailure('ERR-CON-001', {
        message: `Quotation ${quotation.id} was modified by another request`,
      });
    }

    /**
     * A rejection is TERMINAL for the revision (P1-20-BE-009).
     *
     * An acceptance deliberately leaves the revision `issued`: it is still the
     * document the customer agreed to, and `quo.guard_quotation_revision_freeze`
     * treats `superseded`/`rejected`/`expired` as terminal, so there is no
     * `accepted` revision state to move to. A rejection is different — the revision
     * as presented is dead, and marking it so is what stops a later revision-wide
     * approval from overwriting the customer's refusal.
     */
    if (outcome === 'rejected') {
      await this.repository.updateRevisionStatus(db, revision.id, 'rejected');
    }

    /**
     * The acceptance record (ADR-023 D11), written exactly once: only on the
     * transition INTO `accepted` — a replay finds the quotation already accepted
     * and returns above — and `uq_acceptance_records_revision` refuses a second
     * row for the revision in any case. Same transaction as the decision, so an
     * acceptance without its record, or a record without its acceptance, cannot
     * be committed.
     */
    const record =
      outcome === 'accepted'
        ? await this.repository.insertAcceptanceRecord(db, {
            companyId: quotation.companyId,
            branchId: quotation.branchId,
            quotationId: quotation.id,
            quotationRevisionId: revision.id,
            customerPartnerId: acceptance.customerPartnerId,
            contactName: acceptance.contact.contactName,
            contactPhone: acceptance.contact.contactPhone,
            channel: acceptance.channel,
            evidenceKind: acceptance.evidenceKind,
            referenceNote: acceptance.referenceNote,
            evidenceDocumentVersionId: acceptance.evidenceDocumentVersionId,
          })
        : null;

    await appendAudit(db, {
      action: outcome === 'accepted' ? 'quo.quotation.accepted' : 'quo.quotation.rejected',
      entityType: 'quo.quotation',
      entityId: quotation.id,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      details: [
        { field: 'revisionId', classification: 'internal', value: revision.id },
        {
          field: 'status',
          classification: 'public',
          previousValue: current.status,
          value: outcome,
        },
        { field: 'itemCount', classification: 'public', value: String(tally.itemCount) },
        // Which record states the acceptance — never its contents: the contact is
        // personal data and stays on the record, behind the record's own read.
        ...(record === null
          ? []
          : [
              {
                field: 'acceptanceRecordId',
                classification: 'internal' as const,
                value: record.id,
              },
            ]),
      ],
    });

    await publishEvent(db, {
      eventType: outcome === 'accepted' ? 'quotation.accepted' : 'quotation.rejected',
      aggregateId: quotation.id,
      aggregateVersion: next,
      producer: 'quotation.quotation-decision-service',
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      /**
       * NO amount. The currency stays because it is not a price.
       *
       * `quotation.revision-issued` carries `grandTotal` because issuing IS the act
       * of quoting a figure, and its consumer is the delivery intent that presents
       * that figure to the customer. An acceptance is a state change, and a consumer
       * that needs the amount reads the revision under its own authorization — where
       * the totals are classified `restricted`. Putting them in an outbox payload
       * moves a restricted figure into a row with different retention and no
       * per-consumer authorization, and every consumer of this event gets it whether
       * it needs it or not.
       */
      payload: {
        quotationId: quotation.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        currency: revision.currencyCode,
      },
      // Keyed on the revision: a quotation reaches a given outcome once per
      // revision, so a replay collides instead of publishing twice.
      eventKey: `quotation.${outcome}:${revision.id}`,
    });
    return outcome;
  }
}
