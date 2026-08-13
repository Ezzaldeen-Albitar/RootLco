import type { ActionState } from '@/lib/forms/action-result';
import { isRestrictedNarrative } from './evidence';
import type { EvidenceKind } from '../receptions-contract';
import type { CheckInCapabilities } from './wizard';

/**
 * The restricted-narrative controls — `P1-28-SEC-002`.
 *
 * Pure module: no fetch, no React. What the complaint and contents steps decide
 * about a capability lives here so `tests/p1-28-security.test.ts` can hold it
 * directly, the same shape `check-in/evidence.ts` established.
 *
 * ## WF-27, stated exactly
 *
 * Two of the eight condition-evidence kinds write a RESTRICTED narrative row
 * beside their envelope: `complaint` stores the customer's own words in
 * `rec.complaint_details`, and `contents` stores the item description, the
 * declared value and its currency in `rec.vehicle_content_details`. The
 * OPERATION registers one permission — `rec.reception.evidence.manage` — and the
 * application check passes on that alone. The two narrative tables then carry
 * row-level policies of their own that end
 * `AND iam.has_permission('iam.sensitive.view')`
 * (`supabase/migrations/20260721099000_rec_complaints.sql:186` and
 * `20260721103000_rec_vehicle_contents.sql:186`), so the DATABASE refuses the
 * insert. The service maps that `42501` to `ERR-IAM-001` — 403, an authorization
 * outcome rather than a fault (`reception-evidence-service.ts:688-703`).
 *
 * The result an operator would otherwise meet: a form they were allowed to open,
 * four thousand characters typed into it, and a bare "access denied" on submit.
 *
 * ## What this module does about it, and what it refuses to do
 *
 * **Withhold before, do not guess after.**
 *
 * A session that does not carry `iam.sensitive.view` at all cannot succeed at
 * either write, whatever its scope — so the capture form is withheld with the
 * requirement stated, exactly as it is withheld for a missing
 * `rec.reception.evidence.manage`. That is the pre-flight half, and it is sound
 * in one direction only: holding the code is NECESSARY, never sufficient. The
 * database asks `iam.has_permission`, which is scope-aware, so a grant that does
 * not reach this visit's company or branch is refused with the code held.
 *
 * Therefore nothing here rewrites a denial into a diagnosis. A 403 on these two
 * kinds means the pair was not satisfied IN THIS SCOPE and the platform
 * deliberately does not disclose which half failed — the same non-disclosing
 * posture the authority guard takes. `narrativeDenialKey` returns a supplement
 * that names the pair and says the refusal does not distinguish them; the
 * refusal itself is still rendered by the shared permissions message, unchanged.
 */

/** The capability the DATABASE demands on top of the operation's own. */
export const SENSITIVE_NARRATIVE_PERMISSION = 'iam.sensitive.view';

/** The permission the OPERATION registers — passed by the application check. */
export const NARRATIVE_CAPTURE_PERMISSION = 'rec.reception.evidence.manage';

export type NarrativeGateStatus = 'open' | 'locked' | 'no-capture' | 'no-narrative';

export interface NarrativeGate {
  readonly status: NarrativeGateStatus;
  /** The statement to put where the form would have been; `null` when open. */
  readonly noticeKey: string | null;
}

/**
 * Whether a kind's capture form may be shown, and what to say when it may not.
 *
 * Ordered by what is most true: a visit that has ended refuses every write, then
 * the operation's own capability, then — for the two restricted kinds only — the
 * database's. A kind that writes no narrative is unaffected by the third test,
 * which is the composition the backend deliberately did NOT fold into the
 * operation's permission list: a damage mark carries no personal narrative and
 * must not require a sensitive-data capability to record.
 */
export function narrativeGate(
  kind: EvidenceKind,
  capabilities: CheckInCapabilities,
  writesLocked: boolean
): NarrativeGate {
  if (writesLocked) return { status: 'locked', noticeKey: 'receptions.evidence.lockedNote' };
  if (!capabilities.manageEvidence) {
    return { status: 'no-capture', noticeKey: 'receptions.evidence.readOnly' };
  }
  if (isRestrictedNarrative(kind) && !capabilities.viewSensitiveNarratives) {
    return { status: 'no-narrative', noticeKey: 'receptions.evidence.sensitiveRequired' };
  }
  return { status: 'open', noticeKey: null };
}

/**
 * The supplement to a refused restricted-narrative write, or `null`.
 *
 * Returned for a `denied` outcome on a restricted kind and for nothing else — an
 * invalid draft, a conflict and a transport failure are not permission problems
 * and saying "you may be missing a permission" beside one of them would send an
 * operator to an administrator over a typo.
 */
export function narrativeDenialKey(kind: EvidenceKind, state: ActionState): string | null {
  if (state.status !== 'denied') return null;
  if (!isRestrictedNarrative(kind)) return null;
  return 'receptions.evidence.sensitiveDenied';
}
