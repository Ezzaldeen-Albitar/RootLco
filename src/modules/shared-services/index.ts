/**
 * `shared-services` module — public surface (P1-15).
 *
 * The ONLY legal import path for this module (ADR-001). Everything under
 * `application/`, `domain/`, `data/`, and `provider/` is internal, and rule
 * **B1** in `scripts/check-module-boundaries.mjs` fails the build for any other
 * module that reaches past this file — in any import spelling, since every
 * specifier is canonicalised before the rules see it.
 *
 * ## What is exported, and what deliberately is not
 *
 * Services, their result types, and the pure domain functions other modules
 * legitimately need (normalization, query contracts, the sequence registry).
 * **No repository and no pool.** Handing out a repository would let a caller run
 * SQL under this module's identity and skip the audit, event, and scope rules
 * that only the services apply.
 *
 * Provider **ports** and their local adapters are exported so composition and
 * tests can install one; neither is constructed here except through
 * `installSharedServicesRuntime()`.
 *
 * ## Composition installs the frozen P1-13 contracts
 *
 * P1-13 froze `FileService` and `NotificationService` and left `setFileService()`
 * / `setNotificationService()` as the seams. `installSharedServicesRuntime()` is
 * where P1-15 fills them, so every earlier caller that was written against the
 * contract starts working without changing a line — and the `ERR-STB-001` stub
 * stops being reachable.
 *
 * It is idempotent and test-friendly: a provider a test already installed is
 * kept, and no configuration is read for it. That is what lets the whole suite
 * run with no storage and no delivery credentials.
 */
import { composeModule } from '@/server/layering';
import { backendConfig } from '@/server/config/backend-config';
import { setFileService } from '@/server/contracts/file-service';
import { setNotificationService } from '@/server/contracts/notification-service';

import { DocumentRepository } from './data/document-repository';
import { ExportRepository } from './data/export-repository';
import { MessageDispatchRepository } from './data/message-dispatch-repository';
import { NotificationRepository } from './data/notification-repository';
import { NumberSequenceRepository } from './data/number-sequence-repository';
import { TemplateRepository } from './data/template-repository';
import { BranchTransitionAdapter } from './data/transition-repository';

import { AttachmentService } from './application/attachment-service';
import { ExportAuthorizationService } from './application/export-authorization-service';
import { HealthService } from './application/health-service';
import { MessageDispatcher } from './application/message-dispatcher';
import { NumberAllocationService } from './application/number-allocation-service';
import { SharedNotificationService } from './application/notification-service';
import { StatusTransitionService } from './application/status-transition-service';
import { TemplateService } from './application/template-service';

import { LocalStorageProvider } from './provider/local-storage-provider';
import {
  setStorageProvider,
  storageProvider,
  UnconfiguredStorageProvider,
  type StorageProvider,
} from './provider/storage-provider';
import {
  LocalMessageProvider,
  messageProvider,
  setMessageProvider,
  UnconfiguredMessageProvider,
  type MessageProvider,
} from './provider/message-provider';

// ---- Public types -----------------------------------------------------------

export type { AllocateNumberInput, AllocatedNumber } from './application/number-allocation-service';
export type {
  ApplyTransitionInput,
  TransitionResult,
} from './application/status-transition-service';
export type {
  DetailedUploadAuthorization,
  LinkDocumentInput,
} from './application/attachment-service';
export type { QueuedWithRendering } from './application/notification-service';
export type { CreateTemplateInput, TemplateVersionView } from './application/template-service';
export type {
  AuthorizeExportInput,
  ExportAuthorization,
} from './application/export-authorization-service';
export type { LivenessReport, ReadinessProjection } from './application/health-service';
export type { DispatchInput, DispatchResult } from './application/message-dispatcher';

// ---- Public domain surface --------------------------------------------------
//
// Pure functions and registries. Other modules need these to build a request
// (a sequence code, a filter contract) or to normalize a value the same way the
// database will.

export {
  MAX_NORMALIZATION_INPUT,
  MAX_SEARCH_VALUE,
  normalizeEmail,
  normalizePhone,
  normalizePhoneDigits,
  normalizeSearchValue,
  normalizeVin,
  searchTokens,
  type NormalizationResult,
} from './domain/normalization';
export {
  findSequenceDefinition,
  SEQUENCE_CODE_PATTERN,
  SEQUENCE_DEFINITIONS,
  sequenceCodes,
  type SequenceDefinition,
} from './domain/sequence-registry';
export {
  AGGREGATES,
  findTransition,
  MAX_TRANSITION_REASON,
  reachableStates,
  TRANSITIONS,
  transitionIsAllowed,
  type TransitionDefinition,
} from './domain/transitions';
export {
  boundOrderingContract,
  buildFilterPredicate,
  escapeLikePrefix,
  MAX_FILTERS,
  MAX_IN_VALUES,
  resolveSort,
  type FilterInput,
  type FilterableField,
  type FilterOperator,
  type QueryContract,
  type SortInput,
} from './domain/query-primitives';
export {
  EXPORT_PERMISSION,
  EXPORT_RESOURCES,
  findExportResource,
  isFormulaRiskyCell,
  resolveExportFields,
  SENSITIVE_FIELD_PERMISSION,
  type ExportField,
  type ExportResource,
} from './domain/export-policy';
export {
  canonicalRenderedForm,
  renderTemplate,
  RENDERABLE_CHANNELS,
  templateVariables,
  TemplateRenderError,
  VARIABLE_NAME_PATTERN,
  type RenderedMessage,
  type TemplateContent,
} from './domain/template-rendering';
export {
  assertConsent,
  assertDedupeKey,
  assertRecipientReference,
  assertSupportedChannel,
  MESSAGE_PURPOSES,
  NotificationPolicyError,
  SUPPORTED_CHANNELS,
} from './domain/notification-policy';
export {
  DOWNLOADABLE_STATES,
  decodeUploadToken,
  encodeUploadToken,
  isLinkableEntityType,
  isLinkPurpose,
  LINK_PURPOSES,
  LINKABLE_ENTITY_TYPES,
} from './domain/attachment-policy';
export {
  buildStorageKey,
  keyBelongsToTenant,
  safeContentDispositionFilename,
  STORAGE_KEY_PATTERN,
  StorageKeyError,
} from './domain/storage-key';

// ---- Provider ports and local adapters -------------------------------------

export {
  ABSOLUTE_MAX_URL_TTL_SECONDS,
  setStorageProvider,
  storageProvider,
  StorageProviderError,
  UnconfiguredStorageProvider,
  __resetStorageProviderForTests,
  type SignedUrl,
  type StorageProvider,
} from './provider/storage-provider';
export { LocalStorageProvider } from './provider/local-storage-provider';
export {
  LocalMessageProvider,
  messageProvider,
  MessageProviderError,
  setMessageProvider,
  UnconfiguredMessageProvider,
  __resetMessageProviderForTests,
  type DeliveryOutcome,
  type DeliveryRequest,
  type MessageProvider,
} from './provider/message-provider';

// ---- Runtime installation ---------------------------------------------------

/**
 * Builds the storage adapter from configuration.
 *
 * `unconfigured` is the default and is honest: no object store is provisioned,
 * so the adapter refuses to sign rather than returning a URL that leads nowhere.
 * `local_fake` is selected explicitly and signs against a `.invalid` host, so a
 * URL it issues can be verified in a test and can never resolve in the world.
 */
function buildStorageProvider(): StorageProvider {
  const config = backendConfig();
  if (config.STORAGE_PROVIDER === 'local_fake') {
    return new LocalStorageProvider({ bucket: config.STORAGE_BUCKET });
  }
  return new UnconfiguredStorageProvider();
}

function buildMessageProvider(): MessageProvider {
  const config = backendConfig();
  if (config.NOTIFICATION_PROVIDER === 'local_fake') {
    return new LocalMessageProvider();
  }
  return new UnconfiguredMessageProvider();
}

/**
 * Installs the P1-15 runtime: providers, then the two frozen P1-13 contracts.
 *
 * Called once, lazily, from the module factory — so importing this module in a
 * unit test that never touches a route requires no configuration at all.
 */
export function installSharedServicesRuntime(): void {
  if (storageProvider() instanceof UnconfiguredStorageProvider) {
    setStorageProvider(buildStorageProvider());
  }
  if (messageProvider() instanceof UnconfiguredMessageProvider) {
    setMessageProvider(buildMessageProvider());
  }
}

/**
 * Composition root. Services are constructed once per process.
 *
 * The two frozen contracts are installed here rather than in a separate step so
 * they cannot be forgotten: obtaining the module at all installs them.
 */
export const sharedServicesModule = composeModule({
  module: 'shared-services',
  create: () => {
    installSharedServicesRuntime();

    const documents = new DocumentRepository();
    const templates = new TemplateRepository();
    const messages = new NotificationRepository();
    const sequences = new NumberSequenceRepository();
    const exports_ = new ExportRepository();
    const dispatch = new MessageDispatchRepository();

    const attachments = new AttachmentService(documents);
    const notifications = new SharedNotificationService(messages, templates);

    // The frozen P1-13 seams. After this, `fileService()` and
    // `notificationService()` return real implementations instead of the
    // `ERR-STB-001` stubs.
    setFileService(attachments);
    setNotificationService(notifications);

    return {
      attachments,
      notifications,
      templates: new TemplateService(templates),
      numbers: new NumberAllocationService(sequences),
      transitions: new StatusTransitionService([new BranchTransitionAdapter()]),
      exports: new ExportAuthorizationService(exports_),
      health: new HealthService(),
      dispatcher: new MessageDispatcher(dispatch),
    };
  },
});
