import { ConfirmationStep } from '../components/steps/ConfirmationStep';
import { ConversionStep } from '../components/steps/ConversionStep';
import { PartiesStep } from '../components/steps/PartiesStep';
import { SummaryStep } from '../components/steps/SummaryStep';
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
 * recorded, evidence steps slot in after parties when they land, and the two
 * closing steps come last because they are the decision the rest is evidence
 * for — the summary (`FE-020`, approval and the two terminal exits) and then
 * the conversion (`FE-022`), which is legal only from `authorized` and so can
 * only follow it.
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
    id: 'summary-and-approval',
    titleKey: 'receptions.steps.summary.title',
    descriptionKey: 'receptions.steps.summary.description',
    Component: SummaryStep,
  },
  {
    id: 'convert-to-work-order',
    titleKey: 'receptions.steps.convert.title',
    descriptionKey: 'receptions.steps.convert.description',
    Component: ConversionStep,
  },
]);
