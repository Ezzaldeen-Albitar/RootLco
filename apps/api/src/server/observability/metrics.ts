/**
 * Metrics abstraction (P1-13-BE-009 / P1-13-DO-002).
 *
 * A port, not a platform. No metrics backend is provisioned (ADR-012), so the
 * default recorder keeps counters and histograms in memory for tests and for the
 * worker's own health reporting, and a real exporter is a later adapter that
 * implements `MetricsRecorder`.
 *
 * The instrument names are fixed here so dashboards and alert rules can be
 * written against a stable vocabulary before any exporter exists. Label sets are
 * deliberately low-cardinality: `tenantRef` is NOT a label, because per-tenant
 * series would explode cardinality and leak tenant enumeration into a metrics
 * store that has no tenant isolation.
 */

/** Fixed instrument vocabulary. Adding one is a reviewable change here. */
export const METRICS = {
  requestCount: 'http.request.count',
  requestDuration: 'http.request.duration_ms',
  errorCount: 'http.error.count',
  throttleCount: 'http.throttle.count',
  cacheHit: 'cache.hit.count',
  cacheMiss: 'cache.miss.count',
  outboxQueueDepth: 'outbox.queue.depth',
  outboxOldestAgeSeconds: 'outbox.queue.oldest_age_seconds',
  outboxRetryCount: 'outbox.retry.count',
  outboxDeadLetterCount: 'outbox.dead_letter.count',
  workerProcessingDuration: 'worker.processing.duration_ms',

  // --- Shared services (P1-15) --------------------------------------------
  //
  // Every label these instruments carry is catalogue metadata — a sequence
  // code, an aggregate name, a channel, a result word. None is an identifier:
  // an attachment id, storage key, dedupe key, recipient, VIN, or tenant would
  // both explode cardinality and turn the metrics store into an enumeration
  // oracle for data it has no isolation for. `tests/foundation/p1-15-observability.test.ts`
  // asserts that, so the rule is enforced rather than remembered.
  numberAllocationCount: 'numbering.allocation.count',
  auditAppendFailureCount: 'audit.append.failure_count',
  transitionCount: 'transition.applied.count',
  transitionConflictCount: 'transition.conflict.count',
  attachmentAuthorizationCount: 'attachment.authorization.count',
  signedUrlCount: 'storage.signed_url.count',
  signedUrlDuration: 'storage.signed_url.duration_ms',
  notificationEnqueueCount: 'notification.enqueue.count',
  notificationDeliveryCount: 'notification.delivery.count',
  notificationRetryCount: 'notification.retry.count',
  notificationDeadLetterCount: 'notification.dead_letter.count',
  templateRenderCount: 'template.render.count',
  templateRenderFailureCount: 'template.render.failure_count',
  eventRejectionCount: 'event.rejected.count',
  normalizationRejectionCount: 'normalization.rejected.count',
  queryLimitRejectionCount: 'query.limit_rejected.count',
  exportAuthorizationCount: 'export.authorization.count',
  readinessCheckDuration: 'readiness.dependency.duration_ms',
  readinessCheckCount: 'readiness.dependency.count',
} as const;

export type MetricName = (typeof METRICS)[keyof typeof METRICS];

/** Low-cardinality labels only. Never an identifier, never free text. */
export type MetricLabels = Readonly<Record<string, string | number | boolean>>;

export interface MetricsRecorder {
  increment(name: MetricName, labels?: MetricLabels, value?: number): void;
  observe(name: MetricName, value: number, labels?: MetricLabels): void;
  gauge(name: MetricName, value: number, labels?: MetricLabels): void;
}

export interface MetricSample {
  readonly name: MetricName;
  readonly kind: 'counter' | 'histogram' | 'gauge';
  readonly value: number;
  readonly labels: MetricLabels;
}

/**
 * In-memory recorder. Bounded: a fixed number of distinct series and a fixed
 * number of retained observations, so a mislabelled instrument degrades the
 * metric rather than the process.
 */
export class InMemoryMetricsRecorder implements MetricsRecorder {
  private static readonly MAX_SERIES = 512;
  private static readonly MAX_OBSERVATIONS = 4096;

  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly observations: MetricSample[] = [];

  private static seriesKey(name: string, labels: MetricLabels): string {
    const parts = Object.keys(labels)
      .sort()
      .map((key) => `${key}=${String(labels[key])}`);
    return parts.length > 0 ? `${name}{${parts.join(',')}}` : name;
  }

  increment(name: MetricName, labels: MetricLabels = {}, value = 1): void {
    const key = InMemoryMetricsRecorder.seriesKey(name, labels);
    if (!this.counters.has(key) && this.counters.size >= InMemoryMetricsRecorder.MAX_SERIES) return;
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  observe(name: MetricName, value: number, labels: MetricLabels = {}): void {
    if (this.observations.length >= InMemoryMetricsRecorder.MAX_OBSERVATIONS) {
      this.observations.shift();
    }
    this.observations.push({ name, kind: 'histogram', value, labels });
  }

  gauge(name: MetricName, value: number, labels: MetricLabels = {}): void {
    const key = InMemoryMetricsRecorder.seriesKey(name, labels);
    if (!this.gauges.has(key) && this.gauges.size >= InMemoryMetricsRecorder.MAX_SERIES) return;
    this.gauges.set(key, value);
  }

  counterValue(name: MetricName, labels: MetricLabels = {}): number {
    return this.counters.get(InMemoryMetricsRecorder.seriesKey(name, labels)) ?? 0;
  }

  gaugeValue(name: MetricName, labels: MetricLabels = {}): number | undefined {
    return this.gauges.get(InMemoryMetricsRecorder.seriesKey(name, labels));
  }

  observationsFor(name: MetricName): readonly MetricSample[] {
    return this.observations.filter((sample) => sample.name === name);
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.observations.length = 0;
  }
}

let recorder: MetricsRecorder = new InMemoryMetricsRecorder();

export function metrics(): MetricsRecorder {
  return recorder;
}

/** Installs an exporter-backed recorder. Called by composition, never by a handler. */
export function setMetricsRecorder(next: MetricsRecorder): void {
  recorder = next;
}

/** Test seam: restores the default in-memory recorder and returns it. */
export function __resetMetricsForTests(): InMemoryMetricsRecorder {
  const fresh = new InMemoryMetricsRecorder();
  recorder = fresh;
  return fresh;
}
