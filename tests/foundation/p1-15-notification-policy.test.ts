/**
 * Phase 1-15 unit suite: the notification enqueue policy.
 *
 * No database, no network, no clock. Every rule proven here runs *before* a
 * request reaches `shared.outbound_messages`, and each one exists because the
 * failure it prevents is either unactionable or unrecoverable once the row is
 * written:
 *
 *  - **The channel conflict is the reason this file leads with channels.** The
 *    frozen P1-13 `NotificationChannel` type is `email | sms | whatsapp | in_app`
 *    while `ck_outbound_messages_channel` allows only `email` and `in_app`. The
 *    signature cannot change — later phases compile against it — so `sms` and
 *    `whatsapp` type-check and must be refused by policy with a stable rule. The
 *    test below constructs the wider list as a `NotificationChannel[]`, so the
 *    conflict is asserted at compile time as well as at run time: if someone
 *    narrows the frozen type, this file stops compiling rather than silently
 *    losing the proof.
 *  - **The recipient is a reference, never an address.** A rejection must not
 *    echo the value, because the message travels into the same log the rule
 *    exists to keep addresses out of. So the refusal is asserted twice: that it
 *    happened, and that it said nothing.
 *  - **The recipient digest is tenant-salted.** Without the salt, an operator
 *    with cross-tenant read on the ledger could correlate one person across
 *    tenants by digest equality. That is proven behaviourally — same reference,
 *    two tenants, two digests — not by re-deriving the hash expression.
 *
 * Fixture identifiers are the deterministic UUIDs from `tests/db/helpers.ts`,
 * restated as literals rather than imported: that module opens a `pg` pool at
 * import time and this tier must stay database-free. Every other fixture value
 * is `fx_`-prefixed and ephemeral.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  assertConsent,
  assertDedupeKey,
  assertRecipientReference,
  assertSupportedChannel,
  assertTemplateUsable,
  bodyDigest,
  isSupportedChannel,
  MAX_CONSENT_AGE_MS,
  MAX_DEDUPE_KEY_LENGTH,
  MIN_DEDUPE_KEY_LENGTH,
  NotificationPolicyError,
  recipientDigest,
  SUPPORTED_CHANNELS,
  type SupportedChannel,
  type TemplateFacts,
} from '@/modules/shared-services/domain/notification-policy';
import type { NotificationChannel } from '@/server/contracts/notification-service';

/** Deterministic fixture UUIDs — same values as `tests/db/helpers.ts`. */
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = 'a0000000-0000-4000-8000-000000000001';
const USER_B = 'b0000000-0000-4000-8000-000000000001';

/** Captures the refusal so its rule, not just its existence, can be asserted. */
function refusal(call: () => unknown): NotificationPolicyError {
  try {
    call();
  } catch (error) {
    if (error instanceof NotificationPolicyError) return error;
    throw error;
  }
  throw new Error('Expected a NotificationPolicyError; the call returned normally');
}

describe('channel support — the frozen contract is wider than the database', () => {
  it('accepts exactly the two channels the database can store', () => {
    expect([...SUPPORTED_CHANNELS]).toEqual(['email', 'in_app']);
    expect(assertSupportedChannel('email')).toBe('email');
    expect(assertSupportedChannel('in_app')).toBe('in_app');
    expect(isSupportedChannel('email')).toBe(true);
    expect(isSupportedChannel('in_app')).toBe(true);
  });

  it('refuses sms and whatsapp with rule "unsupported_channel"', () => {
    // This array type-checks only because the frozen contract still declares all
    // four members. It is the compile-time half of the documented conflict.
    const frozen: NotificationChannel[] = ['email', 'sms', 'whatsapp', 'in_app'];
    const refused = frozen.filter((channel) => !isSupportedChannel(channel));
    expect(refused).toEqual(['sms', 'whatsapp']);

    for (const channel of refused) {
      const error = refusal(() => assertSupportedChannel(channel));
      expect(error.rule).toBe('unsupported_channel');
      expect(error.name).toBe('NotificationPolicyError');
      // Naming the channel is safe and is the actionable part: it is a contract
      // constant, not caller data.
      expect(error.message).toContain(channel);
    }
  });

  it('refuses rather than deferring to the CHECK constraint', () => {
    // The alternative design — let the request through and let
    // `ck_outbound_messages_channel` raise 23514 — is what this rule replaces.
    // A refusal that carries a rule code is a contract; a SQLSTATE is not.
    expect(refusal(() => assertSupportedChannel('sms')).rule).toBe('unsupported_channel');
  });
});

describe('recipient references — an address can never be one', () => {
  it('accepts a UUID and canonicalises its case', () => {
    expect(assertRecipientReference(USER_A)).toBe(USER_A);
    expect(assertRecipientReference(USER_A.toUpperCase())).toBe(USER_A);
    // Canonicalisation is load-bearing: the digest is computed from the return
    // value, so an upper-cased reference must not produce a second digest.
    expect(
      recipientDigest(TENANT_A, assertRecipientReference(USER_A.toUpperCase())).equals(
        recipientDigest(TENANT_A, assertRecipientReference(USER_A))
      )
    ).toBe(true);
  });

  it('refuses an address, a phone number, and a header-injection payload', () => {
    const rejected = [
      'fx_ops@example.test',
      '+962790000000',
      `${USER_A}\r\nBcc: fx_collector@example.test`,
      'not-a-uuid',
      // Version nibble 0 and variant nibble 0: shaped like a UUID, is not one.
      '00000000-0000-0000-0000-000000000000',
      '',
    ];
    for (const value of rejected) {
      const error = refusal(() => assertRecipientReference(value));
      expect(error.rule).toBe('recipient_not_a_reference');
    }
  });

  it('never echoes the rejected value into the message', () => {
    // If it did, the refusal would put the address into the log the rule exists
    // to keep it out of — the leak would move, not close.
    for (const value of ['fx_ops@example.test', '+962790000000']) {
      const error = refusal(() => assertRecipientReference(value));
      expect(error.message).not.toContain(value);
      expect(String(error)).not.toContain(value);
    }

    const injection = `${USER_A}\r\nBcc: fx_collector@example.test`;
    const error = refusal(() => assertRecipientReference(injection));
    expect(error.message).not.toContain('fx_collector');
    expect(error.message).not.toContain('Bcc');
    // A message that carried the CRLF forward would itself be a log-injection
    // vector, so the absence of the control characters is asserted separately.
    expect(error.message).not.toMatch(/[\r\n]/);
  });

  it('excludes the digest salt delimiter from every accepted reference', () => {
    // `recipientDigest` joins tenant and reference with ':'. That join is
    // unambiguous only because no accepted reference can contain a ':' — this
    // test is what makes the salt boundary a fact rather than an assumption.
    expect(refusal(() => assertRecipientReference(`${TENANT_A}:${USER_A}`)).rule).toBe(
      'recipient_not_a_reference'
    );
  });
});

describe('dedupe keys', () => {
  it('publishes the bounds it enforces', () => {
    expect(MIN_DEDUPE_KEY_LENGTH).toBe(8);
    expect(MAX_DEDUPE_KEY_LENGTH).toBe(200);
  });

  it('accepts the boundary lengths and trims before measuring', () => {
    const shortest = 'fx_short'; // exactly MIN_DEDUPE_KEY_LENGTH
    const longest = `fx_${'a'.repeat(MAX_DEDUPE_KEY_LENGTH - 3)}`;
    expect(shortest).toHaveLength(MIN_DEDUPE_KEY_LENGTH);
    expect(longest).toHaveLength(MAX_DEDUPE_KEY_LENGTH);
    expect(assertDedupeKey(shortest)).toBe(shortest);
    expect(assertDedupeKey(longest)).toBe(longest);
    expect(assertDedupeKey('  fx_notify_dedupe_1  ')).toBe('fx_notify_dedupe_1');
  });

  it('refuses a key outside the bounds with rule "dedupe_key_length"', () => {
    for (const key of [
      'fx_shor', // 7
      `fx_${'a'.repeat(MAX_DEDUPE_KEY_LENGTH - 2)}`, // 201
      '',
      '        ', // whitespace is trimmed away, so this is empty, not eight
      '   fx_a   ', // padding must not be counted toward the minimum
    ]) {
      expect(refusal(() => assertDedupeKey(key)).rule).toBe('dedupe_key_length');
    }
  });

  it('accepts only letters, digits and . _ : -', () => {
    for (const key of [
      'fx_notify_dedupe_1',
      'fx-notify-dedupe-1',
      'fx.notify.dedupe.1',
      'fx:notify:dedupe:1',
      '1fxNOTIFYdedupe',
    ]) {
      expect(assertDedupeKey(key)).toBe(key);
    }
  });

  it('refuses a key with a foreign character or a non-alphanumeric first character', () => {
    for (const key of [
      'fx_notify/dedupe', // path separator
      'fx_notify dedupe', // interior space survives trimming
      'fx_notify\ndedupe', // dedupe keys travel into logs
      'fx_notify#dedupe',
      'fx_notify%40dedupe%0a', // percent-encoding is not an escape hatch
      '_fx_notify_dedupe', // must start alphanumeric
      '-fx_notify_dedupe',
      '.fx_notify_dedupe',
    ]) {
      expect(refusal(() => assertDedupeKey(key)).rule).toBe('dedupe_key_charset');
    }
  });

  it('reports length before charset when a key violates both', () => {
    // Stable ordering matters: a caller fixing one refusal at a time must not be
    // shown a different rule for the same input on the next run.
    expect(refusal(() => assertDedupeKey('a/b')).rule).toBe('dedupe_key_length');
  });
});

describe('consent', () => {
  const NOW = new Date('2026-07-23T12:00:00.000Z');
  const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

  it('accepts a granted evaluation up to and including the maximum age', () => {
    expect(() => assertConsent({ granted: true, evaluatedAt: NOW }, NOW)).not.toThrow();
    expect(() =>
      assertConsent({ granted: true, evaluatedAt: at(-MAX_CONSENT_AGE_MS) }, NOW)
    ).not.toThrow();
  });

  it('refuses a negative decision with rule "consent_not_granted"', () => {
    const error = refusal(() => assertConsent({ granted: false, evaluatedAt: NOW }, NOW));
    expect(error.rule).toBe('consent_not_granted');
    // The negative decision is reported as itself even when the evaluation is
    // also stale: "we were told no" is never downgraded to "ask again".
    expect(
      refusal(() =>
        assertConsent({ granted: false, evaluatedAt: at(-MAX_CONSENT_AGE_MS * 10) }, NOW)
      ).rule
    ).toBe('consent_not_granted');
  });

  it('refuses an evaluation older than MAX_CONSENT_AGE_MS with rule "consent_stale"', () => {
    // A decision made an hour ago is a claim about the past; consent may have
    // been withdrawn since.
    for (const age of [MAX_CONSENT_AGE_MS + 1, 60 * 60 * 1000]) {
      expect(refusal(() => assertConsent({ granted: true, evaluatedAt: at(-age) }, NOW)).rule).toBe(
        'consent_stale'
      );
    }
  });

  it('refuses an evaluation dated into the future with the same rule', () => {
    // A clock running ahead would otherwise make one stale decision look fresh
    // indefinitely.
    for (const ahead of [MAX_CONSENT_AGE_MS + 1, 24 * 60 * 60 * 1000]) {
      expect(
        refusal(() => assertConsent({ granted: true, evaluatedAt: at(ahead) }, NOW)).rule
      ).toBe('consent_stale');
    }
  });

  it('tolerates a future date within the same window, symmetrically', () => {
    // Stated rather than glossed: the future check is bounded by the SAME
    // constant, so an evaluation dated up to MAX_CONSENT_AGE_MS ahead is
    // accepted as clock skew. Future-dating is refused beyond that window, not
    // at zero — this test records the actual boundary so a later narrowing is a
    // visible change instead of a silent one.
    expect(() =>
      assertConsent({ granted: true, evaluatedAt: at(MAX_CONSENT_AGE_MS) }, NOW)
    ).not.toThrow();
  });
});

describe('template usability', () => {
  const APPROVED: TemplateFacts = {
    versionId: 'c0000000-0000-4000-8000-000000000001',
    versionStatus: 'approved',
    templateStatus: 'active',
    templateTenantId: null, // platform template
    channel: 'email',
    localeCode: 'en',
    purpose: 'transactional',
  };
  const REQUEST: { channel: SupportedChannel; locale: string; tenantId: string } = {
    channel: 'email',
    locale: 'en',
    tenantId: TENANT_A,
  };

  it('accepts an approved platform template that matches channel and locale', () => {
    expect(() => assertTemplateUsable(APPROVED, REQUEST)).not.toThrow();
  });

  it('accepts an approved template owned by the requesting tenant', () => {
    expect(() =>
      assertTemplateUsable({ ...APPROVED, templateTenantId: TENANT_A }, REQUEST)
    ).not.toThrow();
  });

  it('refuses any version that is not approved', () => {
    for (const status of ['draft', 'pending_approval', 'archived', 'APPROVED', '']) {
      expect(
        refusal(() => assertTemplateUsable({ ...APPROVED, versionStatus: status }, REQUEST)).rule
      ).toBe('template_not_approved');
    }
  });

  it('refuses a DISABLED template even when the version is approved (P1-15-SR-007)', () => {
    // Approval and status are different switches with different owners: approval
    // says the wording was reviewed, status says the template is in service.
    // Reading only the first is why disabling a template used to stop nothing.
    const error = refusal(() =>
      assertTemplateUsable({ ...APPROVED, templateStatus: 'disabled' }, REQUEST)
    );
    expect(error.rule).toBe('template_disabled');
    // And it is refused for the reason it was actually refused for, rather than
    // falling through to a channel or locale message that would send an operator
    // looking in the wrong place.
    expect(error.message).toContain('disabled');
  });

  it('refuses any template status that is not exactly active', () => {
    for (const status of ['disabled', 'archived', 'ACTIVE', '']) {
      expect(
        refusal(() => assertTemplateUsable({ ...APPROVED, templateStatus: status }, REQUEST)).rule
      ).toBe('template_disabled');
    }
  });

  it('refuses a version belonging to another tenant', () => {
    const error = refusal(() =>
      assertTemplateUsable({ ...APPROVED, templateTenantId: TENANT_B }, REQUEST)
    );
    expect(error.rule).toBe('template_wrong_tenant');
    expect(error.message).not.toContain(TENANT_B);
  });

  it('refuses a channel mismatch between the template and the request', () => {
    expect(
      refusal(() => assertTemplateUsable({ ...APPROVED, channel: 'in_app' }, REQUEST)).rule
    ).toBe('channel_mismatch');
    expect(
      refusal(() =>
        assertTemplateUsable(APPROVED, { ...REQUEST, channel: 'in_app' as SupportedChannel })
      ).rule
    ).toBe('channel_mismatch');
  });

  it('refuses a locale mismatch, which is what makes the required field load-bearing', () => {
    // A caller asking for Arabic and being sent the English template is exactly
    // the failure the mandatory `locale` argument exists to prevent.
    expect(refusal(() => assertTemplateUsable(APPROVED, { ...REQUEST, locale: 'ar' })).rule).toBe(
      'locale_mismatch'
    );
    expect(
      refusal(() => assertTemplateUsable({ ...APPROVED, localeCode: 'ar' }, REQUEST)).rule
    ).toBe('locale_mismatch');
    // Locale comparison is exact, not a language-tag prefix match.
    expect(
      refusal(() => assertTemplateUsable({ ...APPROVED, localeCode: 'en-GB' }, REQUEST)).rule
    ).toBe('locale_mismatch');
  });

  it('reports the strongest violation first when a version breaks several rules', () => {
    // Unapproved AND foreign-tenant AND wrong channel AND wrong locale: the
    // caller is told the version is not approved, because that is the refusal
    // that holds regardless of who asks.
    expect(
      refusal(() =>
        assertTemplateUsable(
          {
            ...APPROVED,
            versionStatus: 'draft',
            templateTenantId: TENANT_B,
            channel: 'in_app',
            localeCode: 'ar',
          },
          REQUEST
        )
      ).rule
    ).toBe('template_not_approved');
  });
});

describe('recipient digest — the cross-tenant correlation defence', () => {
  it('is a 32-byte digest', () => {
    expect(recipientDigest(TENANT_A, USER_A)).toHaveLength(32);
    expect(Buffer.isBuffer(recipientDigest(TENANT_A, USER_A))).toBe(true);
  });

  it('is stable for the same tenant and reference', () => {
    expect(recipientDigest(TENANT_A, USER_A).equals(recipientDigest(TENANT_A, USER_A))).toBe(true);
  });

  it('differs for the same reference under a different tenant', () => {
    // Without the salt, an operator with cross-tenant read on the ledger could
    // identify the same person in two tenants by digest equality alone.
    expect(recipientDigest(TENANT_A, USER_A).equals(recipientDigest(TENANT_B, USER_A))).toBe(false);
  });

  it('differs for a different reference within one tenant', () => {
    expect(recipientDigest(TENANT_A, USER_A).equals(recipientDigest(TENANT_A, USER_B))).toBe(false);
  });

  it('is not the unsalted digest of the reference', () => {
    // The behavioural statement of "salted": knowing the reference is not enough
    // to reproduce what is stored.
    const unsalted = createHash('sha256').update(USER_A, 'utf8').digest();
    expect(recipientDigest(TENANT_A, USER_A).equals(unsalted)).toBe(false);
  });
});

describe('body digest', () => {
  const RENDERED = 'subject: fx Service reminder\nbody: Your vehicle is ready for collection.';

  it('is a 32-byte digest and is stable for identical content', () => {
    expect(bodyDigest(RENDERED)).toHaveLength(32);
    expect(bodyDigest(RENDERED).equals(bodyDigest(RENDERED))).toBe(true);
  });

  it('changes when the rendered content changes', () => {
    const edited = RENDERED.replace('ready for collection', 'ready for collection today');
    expect(bodyDigest(edited).equals(bodyDigest(RENDERED))).toBe(false);
    // Including a change no reader would notice: the digest is an integrity
    // record for content that is never stored, so whitespace must count.
    expect(bodyDigest(`${RENDERED} `).equals(bodyDigest(RENDERED))).toBe(false);
  });

  it('distinguishes content of equal length', () => {
    expect(bodyDigest('fx-message-a').equals(bodyDigest('fx-message-b'))).toBe(false);
  });

  it('digests the empty rendering rather than refusing it', () => {
    // Emptiness is not this function's decision to make — rendering already
    // refused an empty body upstream. Here it must still produce 32 bytes.
    expect(bodyDigest('')).toHaveLength(32);
  });
});
