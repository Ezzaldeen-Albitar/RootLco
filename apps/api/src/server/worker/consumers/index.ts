/**
 * The worker's consumer registrations (PRE-P1-29-BR-09).
 *
 * ## Why a registration STEP and not a barrel of side effects
 *
 * `registerConsumer` mutates a process-wide map. Doing that at module load would
 * make the registry's contents depend on which files happened to be imported —
 * so a test that imported a consumer for its types would silently change dispatch
 * for every other test in the file, and a suite that called
 * `__resetConsumersForTests()` could never restore them, because a second import
 * of a cached module executes nothing.
 *
 * One explicit, idempotent call instead. The worker process makes it at boot; a
 * test makes it when it wants the real dispatch set.
 *
 * ## This is deliberately the only place that knows the whole set
 *
 * `consumersFor()` answers *who handles this event*; this file answers *which
 * consumers exist at all*. Keeping the second question in one place is what makes
 * "the worker completed the event having done nothing" — the `INS-25` failure —
 * something a reader can notice rather than infer from an absence.
 */
import { registerJobAssignedNotifier } from './job-assigned-notifier';

/**
 * Registers every worker consumer. Safe to call more than once.
 *
 * Called by the worker entrypoint at boot. Note that the entrypoint has no
 * production runner yet (ADR-012 — only Local exists, and nothing invokes
 * `startOutboxWorker()`), so today this runs in tests and in a local process; it
 * is written to be correct when a runner arrives rather than to assume one.
 */
export function registerWorkerConsumers(): void {
  registerJobAssignedNotifier();
}
