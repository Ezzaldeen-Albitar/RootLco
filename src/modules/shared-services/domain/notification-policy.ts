/**
 * Notification enqueue rules (P1-15).
 *
 * Pure decisions about a queue request, separated from the service so each can
 * be unit-tested exhaustively without a database.
 *
 * ## Two conflicts with the frozen contract, resolved toward the database
 *
 * 1. **Channels.** `NotificationService`'s frozen `NotificationChannel` type is
 *    `'email' | 'sms' | 'whatsapp' | 'in_app'`, but
 *    `ck_outbound_messages_channel` and `ck_message_templates_channel` both
 *    allow **only `email` and `in_app`**. The interface signature is not
 *    changed — P1-13 froze it and later phases compile against it — so `sms` and
 *    `whatsapp` are accepted by the *type* and refused by this policy with a
 *    stable code. The alternative, letting the request through, would surface as
 *    SQLSTATE 23514 from a CHECK, which is neither a contract nor actionable.
 *
 * 2. **Locale.** The frozen input requires `locale`, and
 *    `shared.outbound_messages` has no locale column: the locale lives on the
 *    *template* (`message_templates.locale_code`). So `locale` is not stored —
 *    it is **checked** against the chosen template version's template, and a
 *    mismatch is refused. That makes the required field load-bearing instead of
 *    decorative: a caller asking for Arabic and being sent an English template
 *    is exactly the failure the field exists to prevent.
 *
 * ## The recipient is a reference, never an address
 *
 * `recipientRef` must be a UUID. Not "should be" — must, structurally. An email
 * address or phone number cannot pass the check, which removes recipient-header
 * injection and arbitrary-destination sending from the threat model instead of
 * filtering for them. Where the reference is a tenant user it is stored as
 * `recipient_user_id`; otherwise only a SHA-256 digest of it is stored, and the
 * raw reference never reaches the row.
 */
import { createHash } from 'node:crypto';
import type { NotificationChannel } from '@/server/contracts/notification-service';

/** Channels the database accepts. The frozen type is wider; this is the truth. */
export const SUPPORTED_CHANNELS = ['email', 'in_app'] as const;
export type SupportedChannel = (typeof SUPPORTED_CHANNELS)[number];

/** `ck_outbound_messages_purpose` / `ck_message_templates_purpose`. */
export const MESSAGE_PURPOSES = ['transactional', 'marketing', 'system'] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

export const MAX_DEDUPE_KEY_LENGTH = 200;
export const MIN_DEDUPE_KEY_LENGTH = 8;

export function isSupportedChannel(channel: NotificationChannel): channel is SupportedChannel {
  return (SUPPORTED_CHANNELS as readonly string[]).includes(channel);
}

export type PolicyRule =
  | 'unsupported_channel'
  | 'channel_mismatch'
  | 'locale_mismatch'
  | 'recipient_not_a_reference'
  | 'dedupe_key_length'
  | 'dedupe_key_charset'
  | 'consent_not_granted'
  | 'consent_stale'
  | 'template_not_approved'
  | 'template_wrong_tenant';

export class NotificationPolicyError extends Error {
  public override readonly name = 'NotificationPolicyError';
  constructor(
    message: string,
    public readonly rule: PolicyRule
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Dedupe keys travel into logs and indexes; keep them boring and printable. */
const DEDUPE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Longest a consent evaluation may be before it is refused as stale. */
export const MAX_CONSENT_AGE_MS = 5 * 60 * 1000;

export interface ConsentDecisionInput {
  readonly granted: boolean;
  readonly evaluatedAt: Date;
}

/**
 * Refuses a request whose consent decision is missing, negative, or old.
 *
 * Staleness matters: a consent evaluation performed an hour before the enqueue
 * is a claim about the past, and the recipient may have withdrawn consent since.
 * A future-dated evaluation is refused too — a clock that runs ahead would make
 * a stale decision look fresh indefinitely.
 */
export function assertConsent(consent: ConsentDecisionInput, now: Date): void {
  if (!consent.granted) {
    throw new NotificationPolicyError(
      'Recipient consent was not granted for this channel',
      'consent_not_granted'
    );
  }
  const age = now.getTime() - consent.evaluatedAt.getTime();
  if (age > MAX_CONSENT_AGE_MS || age < -MAX_CONSENT_AGE_MS) {
    throw new NotificationPolicyError(
      'Consent evaluation is stale or dated in the future',
      'consent_stale'
    );
  }
}

/** Refuses a channel the database cannot store. */
export function assertSupportedChannel(channel: NotificationChannel): SupportedChannel {
  if (!isSupportedChannel(channel)) {
    throw new NotificationPolicyError(
      `Channel "${channel}" is declared by the frozen contract but is not supported by the platform`,
      'unsupported_channel'
    );
  }
  return channel;
}

/** Refuses anything that is not an opaque reference. */
export function assertRecipientReference(recipientRef: string): string {
  if (!UUID.test(recipientRef)) {
    // Never echoes the value: if the caller passed an address, this message
    // would otherwise put it in the log the rule exists to keep it out of.
    throw new NotificationPolicyError(
      'Recipient must be an opaque reference (UUID), never an address',
      'recipient_not_a_reference'
    );
  }
  return recipientRef.toLowerCase();
}

export function assertDedupeKey(dedupeKey: string): string {
  const trimmed = dedupeKey.trim();
  if (trimmed.length < MIN_DEDUPE_KEY_LENGTH || trimmed.length > MAX_DEDUPE_KEY_LENGTH) {
    throw new NotificationPolicyError(
      `Dedupe key must be ${MIN_DEDUPE_KEY_LENGTH}–${MAX_DEDUPE_KEY_LENGTH} characters`,
      'dedupe_key_length'
    );
  }
  if (!DEDUPE_KEY.test(trimmed)) {
    throw new NotificationPolicyError(
      'Dedupe key may hold only letters, digits, and . _ : -',
      'dedupe_key_charset'
    );
  }
  return trimmed;
}

export interface TemplateFacts {
  readonly versionId: string;
  readonly versionStatus: string;
  /** `null` for a platform template. */
  readonly templateTenantId: string | null;
  readonly channel: string;
  readonly localeCode: string;
  readonly purpose: string;
}

/**
 * Checks the template the caller chose against the request.
 *
 * The database enforces the approval and tenant rules too
 * (`guard_outbound_message_scope`), and that enforcement is the guarantee. This
 * check exists so the caller receives a stable, explained refusal instead of a
 * CHECK violation, and so the failure is attributable to a field.
 */
export function assertTemplateUsable(
  facts: TemplateFacts,
  request: {
    readonly channel: SupportedChannel;
    readonly locale: string;
    readonly tenantId: string;
  }
): void {
  if (facts.versionStatus !== 'approved') {
    throw new NotificationPolicyError(
      'Messages may only be sent from an approved template version',
      'template_not_approved'
    );
  }
  if (facts.templateTenantId !== null && facts.templateTenantId !== request.tenantId) {
    throw new NotificationPolicyError(
      'Template version belongs to another tenant',
      'template_wrong_tenant'
    );
  }
  if (facts.channel !== request.channel) {
    throw new NotificationPolicyError(
      'Template channel does not match the requested channel',
      'channel_mismatch'
    );
  }
  if (facts.localeCode !== request.locale) {
    throw new NotificationPolicyError(
      'Template locale does not match the requested locale',
      'locale_mismatch'
    );
  }
}

/**
 * Digest stored in `outbound_messages.recipient_digest`.
 *
 * Salted with the tenant id so the same reference in two tenants produces two
 * digests: without that, an operator with cross-tenant read on the ledger could
 * correlate the same person across tenants by digest equality.
 */
export function recipientDigest(tenantId: string, recipientRef: string): Buffer {
  return createHash('sha256').update(`${tenantId}:${recipientRef}`, 'utf8').digest();
}

/** Digest stored in `outbound_messages.body_sha256`. */
export function bodyDigest(canonicalRendered: string): Buffer {
  return createHash('sha256').update(canonicalRendered, 'utf8').digest();
}
