import { ConfirmationStep } from '../components/steps/ConfirmationStep';
import { MediaStep } from '../components/steps/MediaStep';
import { PartiesStep } from '../components/steps/PartiesStep';
import type { CheckInStepDefinition } from './wizard';

/**
 * The check-in wizard's step registry — THE extension point (P1-28, Wave D).
 *
 * The shell (`components/CheckInWizardShell.tsx`) renders exactly this list
 * and knows nothing about any step's content. A later wave adds a step —
 * evidence capture, signatures, refusals, the approval summary — by appending
 * ONE entry here whose `Component` takes `CheckInStepProps`, and by adding its
 * two translation keys to BOTH catalogues. Nothing else changes; the registry
 * test (`tests/reception-checkin-wizard.test.ts`) holds every entry to the
 * contract (unique id, feature-namespaced keys present in `en` and `ar`).
 *
 * Order is presentation order: identity is confirmed before parties are
 * recorded, and evidence steps slot in after parties when they land.
 */
export const CHECK_IN_STEPS: readonly CheckInStepDefinition[] = Object.freeze([
  {
    id: 'confirm-identities',
    titleKey: 'receptions.steps.confirm.title',
    descriptionKey: 'receptions.steps.confirm.description',
    Component: ConfirmationStep,
  },
  {
    id: 'parties-and-authorization',
    titleKey: 'receptions.steps.parties.title',
    descriptionKey: 'receptions.steps.parties.description',
    Component: PartiesStep,
  },
  {
    /*
     * `FE-017`, and it captures nothing — deliberately.
     *
     * The step is registered so the operator meets the block where they would
     * have reached for the camera, rather than searching the whole wizard for a
     * control that cannot exist while `P1-OD-025` is open. See
     * `../media/media-decision.ts`.
     */
    id: 'media-and-photographs',
    titleKey: 'receptions.steps.media.title',
    descriptionKey: 'receptions.steps.media.description',
    Component: MediaStep,
  },
]);
