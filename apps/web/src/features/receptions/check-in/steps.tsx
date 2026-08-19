import { ComplaintsStep } from '../components/steps/ComplaintsStep';
import { ConfirmationStep } from '../components/steps/ConfirmationStep';
import { ContentsStep } from '../components/steps/ContentsStep';
import { ConversionStep } from '../components/steps/ConversionStep';
import { DamageMapStep } from '../components/steps/DamageMapStep';
import { InspectionStep } from '../components/steps/InspectionStep';
import { MediaStep } from '../components/steps/MediaStep';
import { PartiesStep } from '../components/steps/PartiesStep';
import { ReadingsStep } from '../components/steps/ReadingsStep';
import { RefusalStep } from '../components/steps/RefusalStep';
import { SignatureStep } from '../components/steps/SignatureStep';
import { SummaryStep } from '../components/steps/SummaryStep';
import { WarningLightsStep } from '../components/steps/WarningLightsStep';
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
 * Wave E did exactly that: eight condition-evidence, reading, signature and
 * refusal steps appended below, and the shell was untouched except for the
 * session identity every step now receives (the referent-less `inspector_id`
 * and `witnessed_by_employee_id` fields, G-EMP). Wave F/G then appended the
 * two closing steps, and Wave H the media step (`FE-017`).
 *
 * Order is presentation order, and it follows the ramp: identity is confirmed,
 * the parties are recorded, then the condition of the vehicle is documented in
 * the order an operator walks it — what the customer said, what staff saw,
 * where the damage is, what the meters read, what the dashboard showed, what is
 * inside, and then the photographs themselves — then what anybody signed or
 * declined. The media step sits at `FE-017`'s own place in that walk, between
 * the contents and the signatures, so the operator captures where they would
 * have reached for the camera. The two closing steps come last because
 * they are the decision the rest is evidence for: the summary (`FE-020`,
 * approval and the two terminal exits) and then the conversion (`FE-022`),
 * which is legal only from `authorized` and so can only follow it.
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
    id: 'condition-complaints',
    titleKey: 'receptions.steps.complaints.title',
    descriptionKey: 'receptions.steps.complaints.description',
    Component: ComplaintsStep,
  },
  {
    id: 'condition-inspection',
    titleKey: 'receptions.steps.inspection.title',
    descriptionKey: 'receptions.steps.inspection.description',
    Component: InspectionStep,
  },
  {
    id: 'condition-damage',
    titleKey: 'receptions.steps.damage.title',
    descriptionKey: 'receptions.steps.damage.description',
    Component: DamageMapStep,
  },
  {
    id: 'condition-readings',
    titleKey: 'receptions.steps.readings.title',
    descriptionKey: 'receptions.steps.readings.description',
    Component: ReadingsStep,
  },
  {
    id: 'condition-warning-lights',
    titleKey: 'receptions.steps.warningLights.title',
    descriptionKey: 'receptions.steps.warningLights.description',
    Component: WarningLightsStep,
  },
  {
    id: 'condition-contents',
    titleKey: 'receptions.steps.contents.title',
    descriptionKey: 'receptions.steps.contents.description',
    Component: ContentsStep,
  },
  {
    /*
     * `FE-017`, and it captures — which it did not always.
     *
     * The entry was registered while capture was blocked, so that an operator
     * met the reason where they would have reached for the camera rather than
     * searching the whole wizard for a control that could not exist. Its place
     * in the walk is unchanged and its content is not: `MediaStep` renders the
     * visit's resolved capture policy, takes one capture per requirement, and
     * carries the waiver behind `rec.reception.evidence.override`. See
     * `../media/media-decision.ts` for which fact closed which blocker.
     */
    id: 'media-and-photographs',
    titleKey: 'receptions.steps.media.title',
    descriptionKey: 'receptions.steps.media.description',
    Component: MediaStep,
  },
  {
    id: 'reception-signature',
    titleKey: 'receptions.steps.signature.title',
    descriptionKey: 'receptions.steps.signature.description',
    Component: SignatureStep,
  },
  {
    id: 'reception-refusal',
    titleKey: 'receptions.steps.refusal.title',
    descriptionKey: 'receptions.steps.refusal.description',
    Component: RefusalStep,
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
