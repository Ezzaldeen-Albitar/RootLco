/**
 * Worker process entrypoint (P1-13-DO-002, load-balancer readiness).
 *
 * The web role and the worker role must be startable **independently** — that is
 * what lets them scale, fail, and be rotated separately, and it is a precondition
 * for putting the web tier behind a load balancer at all.
 *
 * This module is that seam. It is not a deployment manifest: no scheduler,
 * supervisor, container spec, or alert route is provisioned here (ADR-012 — only
 * Local exists), and claiming one would be describing infrastructure that does
 * not exist. What is delivered is the process lifecycle a supervisor needs:
 *
 *   start → run → (SIGTERM|SIGINT) → stop claiming → bounded drain → exit
 *
 * Shutdown order is deliberate. Readiness flips first so an orchestrator stops
 * routing work; only then does the loop stop claiming; only then do we wait for
 * the in-flight batch. Anything still unfinished when the grace period expires is
 * left claimed on purpose — the database lease returns it to the queue, which is
 * safer than forcing a completion whose consumers may not have finished.
 */
import { OutboxWorker } from './outbox-worker';
import { closeWorkerPool } from './worker-db';
import { workerReadiness, type ReadinessReport } from '../health/readiness';
import { log } from '../observability/logger';

export interface WorkerProcess {
  /** Current readiness, for an orchestrator probe. */
  readiness(): Promise<ReadinessReport>;
  /** Stops claiming, drains within the grace period, and releases the pool. */
  shutdown(): Promise<void>;
}

/**
 * Starts the outbox worker and wires signal handling.
 *
 * Returns immediately with a handle; the loop runs in the background. The caller
 * (a supervisor, a test) decides when to stop.
 */
export function startOutboxWorker(): WorkerProcess {
  const worker = new OutboxWorker();
  let draining = false;

  // The loop is intentionally not awaited: `start()` resolves only on shutdown.
  void worker.start().catch((error) => {
    log.error('Outbox worker loop exited unexpectedly', {
      module: 'outbox-worker',
      operation: 'worker.start',
      result: 'failure',
      context: { name: error instanceof Error ? error.name : 'unknown' },
    });
  });

  const shutdown = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    log.info('Outbox worker draining', {
      module: 'outbox-worker',
      operation: 'worker.shutdown',
      result: 'skipped',
    });
    await worker.stop();
    await closeWorkerPool();
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown().then(() => process.exit(0));
    });
  }

  return {
    // Readiness reports `unavailable` the moment draining starts, before the
    // loop has actually stopped — so traffic leaves before capacity does.
    readiness: () => workerReadiness(worker.isRunning() && !draining),
    shutdown,
  };
}
