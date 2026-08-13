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
 *     (`scripts/ci/check-p1-27-frontend.mjs:558-711`) refuse capture code and
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
 * `tests/p1-28-reception-media.test.tsx` reads the component's own source to
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
