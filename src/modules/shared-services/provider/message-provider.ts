/**
 * Message-delivery port and its deterministic local adapter (P1-15).
 *
 * **No production delivery provider is provisioned**, and this phase does not
 * select one: ADR-012 leaves it open. What exists is the port every adapter must
 * satisfy, plus an in-process adapter that reaches no network — so the retry,
 * timeout, outage, and dead-letter paths are exercised by real code rather than
 * described.
 *
 * ## What the port refuses to carry
 *
 * `DeliveryRequest` has **no recipient address field**. The adapter is given a
 * recipient *reference* and the rendered content; resolving a reference to an
 * address is the adapter's own concern against its own configuration, and the
 * platform never holds a plaintext destination (`outbound_messages` stores a
 * digest or a user id, by design). An adapter that needs an address obtains it
 * where the address lives, and this boundary is where that separation is stated.
 *
 * A `DeliveryOutcome` carries a provider reference and a response code, never a
 * response body: `ck_delivery_attempts_error_only_errored` accepts a *sanitised*
 * summary, and the column comment forbids raw payloads and stack traces.
 */
export type DeliveryFailureKind = 'timeout' | 'outage' | 'rejected' | 'invalid_recipient';

export interface DeliveryRequest {
  readonly messageId: string;
  readonly channel: string;
  /** Opaque reference. Never an address. */
  readonly recipientRef: string;
  readonly subject: string | null;
  readonly body: string;
}

export interface DeliveryOutcome {
  readonly accepted: boolean;
  /** Opaque provider-side identifier. Classified internal, never a token. */
  readonly providerMessageRef: string | null;
  /** Short provider status code, e.g. `202`. Never a body. */
  readonly responseCode: string | null;
}

export class MessageProviderError extends Error {
  public override readonly name = 'MessageProviderError';
  constructor(
    message: string,
    public readonly kind: DeliveryFailureKind,
    /** Already sanitised: no payload, no stack, no address. */
    public readonly summary: string
  ) {
    super(message);
  }

  /** Whether a retry could plausibly succeed. Drives dead-lettering. */
  get retryable(): boolean {
    return this.kind === 'timeout' || this.kind === 'outage';
  }
}

export interface MessageProvider {
  /** Stable adapter name. Matches `ck_delivery_attempts_provider_format`. */
  readonly code: string;
  deliver(request: DeliveryRequest): Promise<DeliveryOutcome>;
}

/** The default. Refuses to deliver rather than pretending a provider exists. */
export class UnconfiguredMessageProvider implements MessageProvider {
  public readonly code = 'unconfigured';
  async deliver(): Promise<DeliveryOutcome> {
    throw new MessageProviderError(
      'No message-delivery provider is configured. Set NOTIFICATION_PROVIDER; no production ' +
        'provider is provisioned for this platform (ADR-012 remains open).',
      'outage',
      'provider_unconfigured'
    );
  }
}

export type LocalProviderBehaviour = 'accept' | 'timeout' | 'outage' | 'reject';

export interface LocalMessageProviderOptions {
  /** Test seam: which outcome to produce. Defaults to `accept`. */
  readonly behaviour?: LocalProviderBehaviour;
  /** Test seam: fail the first N attempts, then accept. */
  readonly failFirst?: number;
}

/**
 * Deterministic in-process adapter.
 *
 * Delivers nothing anywhere. `providerMessageRef` is derived from the message id
 * so it is stable across runs, which is what lets a test assert the ref recorded
 * on an attempt without pinning a random value.
 */
export class LocalMessageProvider implements MessageProvider {
  public readonly code = 'local_fake';

  private readonly behaviour: LocalProviderBehaviour;
  private readonly failFirst: number;
  private attempts = 0;

  constructor(options: LocalMessageProviderOptions = {}) {
    this.behaviour = options.behaviour ?? 'accept';
    this.failFirst = options.failFirst ?? 0;
  }

  /** Number of `deliver` calls seen. Test observability only. */
  get callCount(): number {
    return this.attempts;
  }

  async deliver(request: DeliveryRequest): Promise<DeliveryOutcome> {
    this.attempts += 1;

    if (this.attempts <= this.failFirst) {
      throw new MessageProviderError(
        'local_fake: transient failure',
        'outage',
        'transient_provider_failure'
      );
    }
    switch (this.behaviour) {
      case 'timeout':
        throw new MessageProviderError('local_fake: timeout', 'timeout', 'provider_timeout');
      case 'outage':
        throw new MessageProviderError('local_fake: outage', 'outage', 'provider_outage');
      case 'reject':
        throw new MessageProviderError(
          'local_fake: rejected',
          'rejected',
          'provider_rejected_message'
        );
      case 'accept':
        return {
          accepted: true,
          providerMessageRef: `local-${request.messageId}`,
          responseCode: '202',
        };
    }
  }
}

let provider: MessageProvider = new UnconfiguredMessageProvider();

export function messageProvider(): MessageProvider {
  return provider;
}

export function setMessageProvider(next: MessageProvider): void {
  provider = next;
}

export function __resetMessageProviderForTests(): void {
  provider = new UnconfiguredMessageProvider();
}
