/**
 * Reception media capture — what this build is allowed to say (`P1-28-FE-017`).
 *
 * ## This module exists because the feature does NOT
 *
 * `FE-017` is "reception camera and media upload". Nothing here captures
 * anything, and that is the deliverable rather than a shortfall:
 *
 *   - `P1-OD-025` — the document and media file policy — is an **OPEN** Owner
 *     decision (`docs/phase-1/phase-1-28/canonical-plan.md` §7). It owns the
 *     accepted file kinds, the size ceilings and the storage placement, so a
 *     screen that asserted any of the three would be publishing a policy the
 *     Owner has not taken.
 *   - The Owner's own media rows are **Blocked** (`INT-093/094/095`), and only
 *     the COUNT of the exterior set is fixed — which views make it up is an
 *     unconfirmed proposal (`reception-media-checklist.md:102-105`).
 *   - The platform behind it is dead-ended in two independent places:
 *     `STORAGE_PROVIDER` defaults to `unconfigured`, and version acceptance
 *     requires a `clean` row in a scan table granted to no role. The honest
 *     best state of any registered file is therefore **"registered, pending,
 *     never downloadable"** (`reception-media-checklist.md:208-210`).
 *   - The `no-upload-path` and `no-invented-media-limit` gate rules
 *     (the `RULES` table of `scripts/ci/check-p1-27-frontend.mjs`) refuse capture code and
 *     invented ceilings while the decision is open.
 *
 * So what ships is the NOTICE: the operator is told, where they would have
 * reached for the camera, that capture is blocked, which decision blocks it,
 * what the Owner has to decide, and what will exist afterwards.
 * `docs/phase-1/phase-1-28/media-capture-decision-record.md` is the Owner-facing
 * half of the same statement.
 *
 * ## Why a notice and not a disabled control
 *
 * A greyed-out camera button advertises a capability the product does not have,
 * and a disabled control is the single most likely thing for a later commit to
 * enable. There is no control here at all — the P1-27 vehicle-media surface
 * settled the same question the same way (`documents-contract.ts`), and
 * `tests/p1-28-reception-media.test.ts` reads the component's own source to
 * prove no control crept back in.
 *
 * ## Why it is shared
 *
 * Three surfaces are blocked by ONE decision, and two of them belong to other
 * waves: the reception evidence area (`FE-017`), the damage-map template
 * document (`FE-012`, whose mark-capture write is otherwise ready) and the
 * signature image (`FE-018`, whose metadata write is otherwise ready). One
 * component, three surface statements — so the day `P1-OD-025` lands there is
 * one place to change, and until then the three cannot drift into three
 * different accounts of the same block.
 */

/** The open Owner decision. Named on screen so it can be tracked, not guessed at. */
export const MEDIA_DECISION_ID = 'P1-OD-025';

/**
 * What this build can do about reception media.
 *
 * A single closed value, deliberately NOT a feature flag: a flag implies
 * something to switch on, and there is no implementation behind it to enable.
 */
export const MEDIA_CAPTURE_STATUS = 'blocked-on-p1-od-025' as const;

/**
 * The three places an operator would reach for a camera, and nothing else.
 *
 * A surface is a `union`, not a free string, so a later wave embedding this
 * notice has to declare WHICH block it is stating rather than inventing a
 * fourth account of the same decision.
 */
export type MediaSurface = 'reception-evidence' | 'damage-map-template' | 'signature-image';

/** The line that says what specifically cannot be captured on each surface. */
export const MEDIA_SURFACE_KEYS: Readonly<Record<MediaSurface, string>> = Object.freeze({
  'reception-evidence': 'receptions.media.surface.evidence',
  'damage-map-template': 'receptions.media.surface.damageMap',
  'signature-image': 'receptions.media.surface.signature',
});

/**
 * What the Owner has to settle, in the order the decision has to settle it.
 *
 * Every one of these is recorded as "Not established" in
 * `reception-media-checklist.md` §9 — so listing them RECORDS the open
 * questions rather than proposing answers to them. No entry may become a
 * default: a "sensible" ceiling shown to an operator is the decision taken by
 * the implementer, which is exactly what the disposition forbids.
 */
export const MEDIA_DECISION_KEYS: readonly string[] = Object.freeze([
  'receptions.media.decide.set',
  'receptions.media.decide.formats',
  'receptions.media.decide.storage',
  'receptions.media.decide.enforcement',
]);

/* ------------------------------------------------------------------ *
 * The document chain — why `damage_map` and `rec.reception-signature`
 * are unreachable, stated as facts a test can check
 * ------------------------------------------------------------------ */

/**
 * THE CORRECTION THIS TABLE EXISTS TO MAKE.
 *
 * Three places in this tree said, in one form or another, "no operation
 * registers a document" — and the SEC-004 manifest said it of the **published
 * surface**, unqualified. That sentence is false, and a reader can refute it in
 * one grep: `shared.attachment-upload-authorize` is a published, registered
 * operation (`docs/api/openapi.v1.json`), and creating the `shared.documents`
 * row is the first thing it does
 * (`attachment-service.ts` → `insertDocument`).
 *
 * The CONCLUSION it was offered in support of survives — `damage_map` and
 * `rec.reception-signature` both require a `documentId` **and** the exact
 * `documentVersionId`, and neither value can be obtained — but it survives for
 * reasons that are stronger, different, and checkable. A wrong reason attached
 * to a right verdict is how a classification gets overturned by the first
 * person who checks it, so the reason is replaced rather than softened.
 *
 * `apps/web` calls no part of the chain, and that is a separate fact from the
 * chain being unable to complete. Both are true; only the second is the reason
 * a screen may not offer the capability.
 */
export interface DocumentChainBlocker {
  /** Stable id, used by the manifest and by the test that checks the fact. */
  readonly id: string;
  /** What stops the chain, in one sentence. */
  readonly what: string;
  /** The repository file that establishes it. Checked to exist and to say so. */
  readonly evidence: string;
}

/**
 * Every independent reason the document chain cannot complete in this platform.
 *
 * INDEPENDENT is the load-bearing word: closing any one of these leaves the
 * chain dead, so a future commit that (say) provisions object storage does not
 * silently make `damage_map` reachable. `tests/p1-28-reception-media.test.ts`
 * re-derives each row against the repository, so a row that stops being true
 * FAILS rather than quietly becoming a stale justification — which is the whole
 * defect this table replaces.
 */
export const DOCUMENT_CHAIN_BLOCKERS: readonly DocumentChainBlocker[] = Object.freeze([
  {
    id: 'no-document-category',
    what:
      'The one operation that creates a document resolves a category code against ' +
      'shared.document_categories before anything else. That table ships ZERO rows — no seed ' +
      'anywhere inserts one — and no operation in the published surface creates, updates or ' +
      'even lists a category. So the call fails ERR-RES-001 for every tenant, configured or ' +
      'not, and there is no such thing as a tenant that has a document.',
    evidence: 'supabase/migrations/20260718100000_shared_document_categories_and_documents.sql',
  },
  {
    id: 'no-storage-provider',
    what:
      'Past the category it signs a URL through the storage provider, and the default provider ' +
      'refuses every call with ERR-SYS-001 rather than pretending an object store exists. The ' +
      'only other provider the composition root can build is the local fake; no production ' +
      'provider is provisioned, and ADR-012 is open.',
    evidence: 'apps/api/src/modules/shared-services/provider/storage-provider.ts',
  },
  {
    id: 'no-acceptance',
    what:
      // The ceiling is stated in the module docblock above and NOT repeated as a
      // quoted phrase here: `p1-28-reception-media.test.ts` pins the words this
      // tree may use about a file, over the comment-stripped source, so a string
      // literal restating them is a claim where the docblock is a note.
      'Even a registered version stays pending for ever: the initial-state guard refuses any ' +
      'other status at insert, and acceptance additionally needs a clean scan record that no ' +
      'application role may write. So the best state the chain can reach is a pending version ' +
      'nobody can open — which is why nothing downstream of it may be offered.',
    evidence: 'apps/api/src/app/api/v1/attachments/versions/route.ts',
  },
]);

/**
 * The two reception writes that cannot be reached because of the table above.
 *
 * Named here rather than in either step, because the fact is one fact and the
 * two steps were drifting into two accounts of it — the same reason
 * `MediaSurface` is a union.
 */
export const DOCUMENT_BOUND_WRITES: readonly string[] = Object.freeze([
  'rec.reception-condition-evidence [kind damage_map]',
  'rec.reception-signature',
]);
