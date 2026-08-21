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

/*
 * ## What this module deliberately no longer holds
 *
 * It briefly carried a second account of the runtime states — a
 * `MEDIA_RUNTIME_STATES` union, a `MEDIA_RUNTIME_KEYS` map and a
 * `runtimeStateOf()` deriving one from a capture outcome — written when the
 * block was converted. Nothing ever called any of it, and it could not have
 * been called: `runtimeStateOf` took a `stored` boolean that `CaptureOutcome`
 * does not have and never had. It was a description of the behaviour sitting
 * beside the behaviour, agreeing with it by coincidence.
 *
 * That is the shape this project keeps catching — a module stating a rule the
 * code does not implement — so it is gone rather than wired up for symmetry.
 * The states an operator actually meets are derived where the answer comes
 * from, in `components/steps/MediaStep.tsx` (`outcomeKey`) and
 * `components/steps/SignatureStep.tsx`, from what the API returned: the version
 * status and whether a scanner could read the object back. One account, in the
 * place that has the facts.
 *
 * `MEDIA_SURFACE_KEYS` went the same way. Its three strings each said a surface
 * could not produce a document "in this release"; two of them are now false and
 * the third was rendered by the deleted notice.
 */
