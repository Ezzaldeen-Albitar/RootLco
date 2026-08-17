/**
 * Reception media capture — what this build can say about it (`P1-28-FE-017`).
 *
 * ## This module used to be a block, and is now a runtime status
 *
 * It existed because `P1-OD-025` — the document and media file policy — was an
 * OPEN Owner decision, and a screen that offered capture would have been
 * publishing a policy nobody had taken. It carried a `MEDIA_CAPTURE_STATUS` of
 * `blocked-on-p1-od-025`, three `DOCUMENT_CHAIN_BLOCKERS` and a surface notice
 * rendered where the camera would have been.
 *
 * Every one of those is now false, and each was closed by something different:
 *
 *   - **`P1-OD-025` is RESOLVED.** The approved model is private and versioned —
 *     Document → immutable Version → business link, `pending → scanning →
 *     accepted`, only an accepted version is finalized evidence.
 *   - **`no-document-category`** said the category table ships zero rows and
 *     nothing can add one. `supabase/seeds/05_shared_reference.sql` inserts
 *     seven platform-scoped `reception_*` categories, `tenant_id` NULL, so every
 *     tenant resolves them.
 *   - **`no-acceptance`** said a registered version can never leave `pending`.
 *     `registerVersionAndScan` reads the object back, hashes it, decodes it,
 *     checks for EICAR and completes the scan;
 *     `shared.guard_document_version_transition` admits the transition on an
 *     exclusively clean verdict.
 *   - **`no-storage-provider`** said no store is provisioned. This one was the
 *     last to fall and the one most easily declared closed wrongly: an S3
 *     adapter had existed for some time, and a class that COULD be configured is
 *     not a store that IS. It closed when the acceptance launcher began
 *     configuring the local S3-compatible endpoint into the API process, and it
 *     is proved by `tests/acceptance/storage-round-trip.test.ts` moving a real
 *     object rather than by anybody reading the adapter.
 *
 * ## What a screen may still have to say, and what it may NOT say
 *
 * Capture can be unavailable at RUNTIME — the store is not configured in this
 * environment, or the scanner could not read an object back — and an operator
 * has to be told which. That is a configuration fact and this module names it as
 * one. What no surface may say any more is that an Owner decision is pending:
 * the decision was taken, and copy that still reports it as open would be
 * telling an operator something false about their own product.
 *
 * The states themselves are not held here. They are derived per capture from
 * what the API answered — `scannerAvailable` and the version status — and
 * rendered by `components/steps/MediaStep.tsx`, because a status held in a
 * constant is a status that cannot change when the environment does.
 */

/**
 * The Owner decision this surface was blocked on. RESOLVED.
 *
 * Kept as a constant, not deleted, so the closure is checkable: a commit that
 * re-blocks the capture surface has to say which decision re-opened, and a
 * screen that names this identifier fails `p1-28-reception-media.test.ts`.
 */
export const MEDIA_DECISION_ID = 'P1-OD-025';

/** Whether the decision is open. Read by the tests that forbid stale copy. */
export const MEDIA_DECISION_RESOLVED = true;

/**
 * Why capture may be unavailable, at RUNTIME.
 *
 * Three states, none of which is an Owner decision:
 *
 *   - `available` — the store answered and the version reached `accepted`.
 *   - `unverifiable` — the object was stored and no scanner could read it back,
 *     so the version stays `pending`. It is recorded, and it does NOT count.
 *   - `unconfigured` — no object store is configured in this environment, so
 *     nothing can be stored at all.
 *
 * `as const satisfies` so a fourth state fails to compile here rather than
 * rendering a missing key.
 */
export const MEDIA_RUNTIME_STATES = ['available', 'unverifiable', 'unconfigured'] as const;
export type MediaRuntimeState = (typeof MEDIA_RUNTIME_STATES)[number];

/** What each runtime state says, in both catalogues. */
export const MEDIA_RUNTIME_KEYS = {
  available: 'receptions.capture.state.satisfied',
  unverifiable: 'receptions.capture.boundNoScanner',
  unconfigured: 'attachments.capture.storeUnavailable',
} as const satisfies Readonly<Record<MediaRuntimeState, string>>;

/**
 * The surfaces the capture chain reaches.
 *
 * A union rather than a free string, for the reason it always was: a later wave
 * embedding a media statement has to declare WHICH surface it is about rather
 * than inventing a fourth account of the same behaviour.
 */
export type MediaSurface = 'reception-evidence' | 'damage-map-template' | 'signature-image';

/** The line that names what each surface captures. */
export const MEDIA_SURFACE_KEYS: Readonly<Record<MediaSurface, string>> = Object.freeze({
  'reception-evidence': 'receptions.media.surface.evidence',
  'damage-map-template': 'receptions.media.surface.damageMap',
  'signature-image': 'receptions.media.surface.signature',
});

/**
 * Which runtime state a completed capture landed in.
 *
 * Derived from what the API returned, never from configuration this tier can
 * read: `apps/web` holds no `STORAGE_*` variable, so the only honest source for
 * "is there a store" is whether one answered.
 */
export function runtimeStateOf(outcome: {
  readonly stored: boolean;
  readonly scannerAvailable: boolean;
  readonly versionStatus: string;
}): MediaRuntimeState {
  if (!outcome.stored) return 'unconfigured';
  if (!outcome.scannerAvailable || outcome.versionStatus !== 'accepted') return 'unverifiable';
  return 'available';
}
