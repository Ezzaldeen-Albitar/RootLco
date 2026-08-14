'use client';

import { MediaDecisionNotice } from '../../media/MediaDecisionNotice';
import type { CheckInStepProps } from '../../check-in/wizard';

/**
 * The reception evidence area, where photographs would be recorded
 * (`P1-28-FE-017`).
 *
 * The step exists so the block is where the operator meets it. A check-in
 * wizard that simply had no media step would leave a desk clerk hunting for a
 * camera control through every other step and concluding the build is broken;
 * this one states, at the point of expectation, that capture is blocked by
 * `P1-OD-025`, what the Owner must decide and what will exist afterwards.
 *
 * ## It takes no capability and no version
 *
 * `CheckInStepProps` carries `visitId`, `recordVersion`, `capabilities` and
 * `refresh`, and this step uses none of them: it issues no read, performs no
 * write and therefore has no `If-Match` to source. QA-004 has nothing to bind
 * here precisely because nothing is guarded — and a step that accepted a
 * version it never sends would be the cached-version defect the wizard's shape
 * exists to prevent.
 *
 * ## `writesLocked` changes nothing either
 *
 * A terminal visit renders exactly the same notice. The block is a property of
 * the release, not of the visit's state, so suppressing it on a converted visit
 * would tell two different stories about one decision.
 */
export function MediaStep({ locale, messages }: CheckInStepProps) {
  return (
    <MediaDecisionNotice
      locale={locale}
      messages={messages}
      surface="reception-evidence"
      headingId="check-in-media-notice-heading"
    />
  );
}
