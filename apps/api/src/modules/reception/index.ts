/**
 * `reception` module — public surface (Phase 1-18).
 *
 * The ONLY legal import path for this module (ADR-001): the boundary checker and
 * the ESLint rule both reject `@/modules/reception/<anything>`. It exports
 * behaviour (composed services) and types/contract constants — never
 * repositories, pools, or SQL.
 *
 * ## Why appointments and receptions are one module
 *
 * The frozen XOR-origin contract and `rec.accept_check_in()` make consuming an
 * appointment and opening a reception visit a single transaction spanning `apt`
 * and `rec`. Splitting them would put half of an indivisible decision behind
 * another module's public surface, which is how a visit ends up existing while
 * its appointment still reads `confirmed`. Operation ids keep the `apt.` and
 * `rec.` prefixes, so the schema each command touches stays visible.
 *
 * Display numbering is borrowed from the shared-services module through its public
 * surface — reception owns no sequence implementation, and a second one would give
 * the platform two ways to allocate a number that could drift apart.
 */
import { composeModule } from '@/server/layering';
import { sharedServicesModule } from '@/modules/shared-services';
import { AppointmentRepository } from './data/appointment-repository';
import { AppointmentReadRepository } from './data/appointment-read-repository';
import { IntakeCatalogueRepository } from './data/intake-catalogue-repository';
import { ReceptionRepository } from './data/reception-repository';
import { ReceptionEvidenceRepository } from './data/reception-evidence-repository';
import { ReceptionConversionRepository } from './data/reception-conversion-repository';
import { ReceptionReadRepository } from './data/reception-read-repository';
import { AppointmentService } from './application/appointment-service';
import { AppointmentReadService } from './application/appointment-read-service';
import { IntakeCatalogueService } from './application/intake-catalogue-service';
import { ReceptionService } from './application/reception-service';
import { ReceptionEvidenceService } from './application/reception-evidence-service';
import { ReceptionConversionService } from './application/reception-conversion-service';
import { ReceptionReadService } from './application/reception-read-service';

export type {
  AppointmentChangeKind,
  AppointmentChanged,
  AppointmentCreated,
} from './application/appointment-service';
export type {
  AuthorizationInput,
  AuthorizationRecorded,
  PartyRoleAssigned,
  PartyRoleInput,
  ReceptionApproved,
  ReceptionClosed,
  ReceptionCreated,
} from './application/reception-service';
// Read-surface row types (never the repositories themselves — ADR-001).
export type {
  AuthorizationEntry,
  ConditionEvidenceEntry,
  PartyRoleEntry,
  ReceptionDetailRow,
  ReceptionHistoryEntry,
  ReceptionListEntry,
  ReceivingEmployeeEntry,
} from './data/reception-read-repository';
export type {
  AppointmentDetailRow,
  AppointmentListEntry,
} from './data/appointment-read-repository';
export type {
  IntakeCatalogueEntry,
  IntakeCatalogueRecord,
} from './data/intake-catalogue-repository';
export type { IntakeCatalogueEntryView } from './application/intake-catalogue-service';
// The intake-catalogue management contract (P1-27-INT-018). The bounds are
// exported because the ROUTES validate against them: a code that fails
// `ck_<t>_code_format` must be a 422 naming the field, not a CHECK violation.
export {
  CATALOGUE_CODE_PATTERN,
  CATALOGUE_STATUSES,
  INTAKE_CATALOGUE_DESCRIPTORS,
  MAX_CATALOGUE_NAME,
  type CatalogueStatus,
} from './domain/intake-catalogue';
export type {
  ComplaintEvidence,
  ConditionEvidenceInput,
  ConditionEvidenceRecorded,
  ConditionItemEvidence,
  ContentsEvidence,
  DamageMapEvidence,
  DamageMarkEvidence,
  InspectionEvidence,
  LeakEvidence,
  RefusalInput,
  RefusalRecorded,
  SignatureInput,
  SignatureRecorded,
  WarningLightEvidence,
} from './application/reception-evidence-service';
export type { ReceptionConverted } from './application/reception-conversion-service';

export {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  TERMINAL_APPOINTMENT_STATUSES,
  type AppointmentCreateInput,
  type AppointmentStatus,
  type CancelInput,
  type RescheduleInput,
} from './domain/appointment';
export {
  AUTHORIZATION_CHANNELS,
  AUTHORIZATION_DECISIONS,
  AUTHORIZING_ROLES,
  CLOSE_OUTCOMES,
  MAX_CLOSURE_REASON,
  MAX_SOC_PERCENT,
  MAX_WALK_IN_NOTE,
  MIN_SOC_PERCENT,
  RECEPTION_PARTY_ROLES,
  RECEPTION_STATUSES,
  RECEPTION_TRANSITIONS,
  TERMINAL_RECEPTION_STATUSES,
  type AuthorizationChannel,
  type AuthorizationDecision,
  type AuthorizingRole,
  type CloseOutcome,
  type ReceptionCreateInput,
  type ReceptionOrigin,
  type ReceptionPartyRole,
  type ReceptionStatus,
} from './domain/reception';
export {
  COMPLAINT_CATEGORIES,
  COMPLAINT_SEVERITIES,
  DAMAGE_MARK_TYPES,
  EVIDENCE_KINDS,
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  LEAK_SEVERITIES,
  MAX_COMPLAINT_TEXT,
  MAX_CONTENT_QUANTITY,
  MAX_COORD,
  MAX_DECLARED_VALUE,
  MAX_ITEM_DESCRIPTION,
  MAX_LOCATION,
  MAX_MAP_TYPE,
  MAX_NOTE,
  MAX_ZONE,
  MIN_COORD,
  REFUSAL_TYPES,
  SIGNATURE_CAPTURE_METHODS,
  SIGNATURE_PURPOSES,
  SIGNER_ROLES,
  type ComplaintCategory,
  type ComplaintSeverity,
  type DamageMarkType,
  type EvidenceKind,
  type FindingCategory,
  type FindingSeverity,
  type RefusalType,
  type SignatureCaptureMethod,
  type SignaturePurpose,
  type SignerRole,
} from './domain/reception-evidence';

/**
 * Composition root: constructs the module's services once per process.
 *
 * `ReceptionRepository` is shared by three services rather than instantiated
 * three times, because all three lock the same visit row and there is exactly one
 * way to do that correctly.
 */
export const receptionModule = composeModule({
  module: 'reception',
  create: () => {
    const appointments = new AppointmentRepository();
    const receptions = new ReceptionRepository();
    const numbers = sharedServicesModule().numbers;
    return {
      appointments: new AppointmentService(appointments, numbers),
      appointmentRead: new AppointmentReadService(new AppointmentReadRepository()),
      receptions: new ReceptionService(receptions, appointments, numbers),
      receptionRead: new ReceptionReadService(new ReceptionReadRepository()),
      receptionEvidence: new ReceptionEvidenceService(
        new ReceptionEvidenceRepository(),
        receptions
      ),
      receptionConversion: new ReceptionConversionService(
        new ReceptionConversionRepository(),
        receptions,
        numbers
      ),
      intakeCatalogues: new IntakeCatalogueService(new IntakeCatalogueRepository()),
    };
  },
});
