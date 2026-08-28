/**
 * The worker's consumer registration point.
 *
 * One function, called once at boot by `startOutboxWorker()`. Registration is
 * deliberately NOT an import side effect: a consumer that registers by being
 * imported depends on import order, and cannot be restored after
 * `__resetConsumersForTests()` — so a suite that resets the registry would
 * silently unregister production behaviour and every later assertion would pass
 * against a worker that does nothing.
 *
 * `registerConsumer` refuses a duplicate code, so calling this twice in one
 * process is a loud failure rather than a quiet double delivery.
 */
import type { Consumer } from '../consumer-registry';
import { registerJobAssignedNotifier } from './job-assigned-notifier';

export {
  JOB_ASSIGNED_NOTIFIER,
  CONSUMED_PAYLOAD_FIELDS,
  PoisonPayloadError,
} from './job-assigned-notifier';

/** Registers every consumer this worker runs. Returns them for assertion. */
export function registerWorkerConsumers(): readonly Consumer[] {
  return [registerJobAssignedNotifier()];
}
