# Phase 1-15 — Object Storage Port, Storage Keys, and Signed URLs

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-23 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) — never an
independent third-party audit) ·
**Owner gate:** [Phase 1-15 Owner Gate](./phase-1-15-owner-gate.md) — **Pending**.

**Related:** [Attachment lifecycle](./attachment-lifecycle.md) ·
[Storage-Key Convention](../../database/storage-key-convention.md) ·
[Document Access and File Security (P1-5)](../phase-1-5/document-access-and-file-security.md) ·
[ADR-012 — local-first environment with controlled promotion](../../adr/ADR-012-local-first-environment-with-controlled-promotion.md) ·
[Binding implementation decisions](./phase-1-15-implementation-decisions.md)

**Implementation:** [`src/modules/shared-services/provider/storage-provider.ts`](../../../src/modules/shared-services/provider/storage-provider.ts) ·
[`src/modules/shared-services/provider/local-storage-provider.ts`](../../../src/modules/shared-services/provider/local-storage-provider.ts) ·
[`src/modules/shared-services/domain/storage-key.ts`](../../../src/modules/shared-services/domain/storage-key.ts) ·
[`src/server/config/backend-config.ts`](../../../src/server/config/backend-config.ts) ·
Evidence: [`tests/foundation/p1-15-signed-urls.test.ts`](../../../tests/foundation/p1-15-signed-urls.test.ts),
[`tests/foundation/p1-15-storage-key.test.ts`](../../../tests/foundation/p1-15-storage-key.test.ts)

---

## 1. The headline, first

**No production object store is provisioned, and none has been selected.** ADR-012 leaves the
storage provider open and this phase does not close it. What P1-15 delivers is the **port** — the
shape every adapter must satisfy and the guarantees the application may rely on regardless of which
one is installed — plus a deterministic local adapter that reaches no network, and a default that
refuses to sign at all.

That is stated here rather than buried, because everything below describes a _contract_, not a
running storage tier. Selecting, provisioning, and hardening a real provider is an owner decision,
and it remains open. Nothing in this document should be read as a claim that bytes are stored
anywhere, replicated anywhere, served from anywhere, or backed by any availability commitment.

## 2. The port, and what it guarantees regardless of adapter

`StorageProvider` is deliberately tiny — a name and two methods:

```ts
interface StorageProvider {
  readonly name: string; // e.g. 'local_fake'
  signUpload(request: SignUrlRequest): Promise<SignedUrl>;
  signDownload(request: SignUrlRequest): Promise<SignedUrl>;
}
```

A small surface is the point: an adapter that can only sign cannot accidentally become the place
where authorization, listing, or deletion lives. Four guarantees are structural in the types, so
they hold for any adapter that compiles against them.

| Guarantee                                 | How the port makes it structural                                                                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The key is server-built**               | `SignUrlRequest.storageKey` is documented as a server-composed key and every adapter re-validates it. No adapter accepts a caller-supplied _path_, so `../` cannot appear and two tenants cannot collide.                                |
| **Every URL expires**                     | `expiresInSeconds` is **required**, not optional. There is no way to express "no expiry" — the type does not have one.                                                                                                                   |
| **A URL is bound to one method**          | `SignedUrl.method` is `'PUT'` or `'GET'`, and — where the adapter supports it — the content type and byte length are bound too. A download URL cannot be replayed as an upload.                                                          |
| **Nothing in the result is a credential** | `SignedUrl` is exactly `{ url, method, expiresAt, provider }`. Access keys, tokens, and bucket policies never cross this boundary. `provider` is a low-cardinality adapter name for observability — never a hostname and never a bucket. |

Faults are normalised into `StorageProviderError` with a `kind` of `timeout`, `outage`, or
`refused`. The first two are retryable and are mapped by the application to `ERR-DEP-001`; `refused`
is not, because a caller asking for a longer-lived capability must never be retried into success.
The application never names the dependency to the caller — the failure says a dependency is
unavailable, not which one.

### 2.1 The default refuses

`UnconfiguredStorageProvider` is the installed default, and it fails every call with `ERR-SYS-001`
rather than pretending an object store exists:

> `No object-storage provider is configured. Set STORAGE_PROVIDER; no production provider is
provisioned for this platform (ADR-012 remains open).`

The setting is named in the developer-facing message only; `safeDetails` is empty, so the caller is
told nothing. This is the same shape P1-14 used for `UnconfiguredIdentityProvider`, and the reason is
the same: a caller cannot fix a platform with no storage configured, so this is a _system_ failure,
not a request failure. Selecting `local_fake` is an explicit act in
[`installSharedServicesRuntime()`](../../../src/modules/shared-services/index.ts); anything else
leaves the refusing default in place.

## 3. The storage key

The shape is fixed by [the storage-key convention §3](../../database/storage-key-convention.md):

```
<environment>/<tenant_id>/<document_id>/<version_segment>
```

`buildStorageKey()` produces it from four server-resolved values — the configured environment token
(`local` · `development` · `staging` · `production`), the session tenant, and two freshly generated
UUIDs. **A caller supplies none of them.** That is what makes traversal, cross-tenant collision, and
business data in a key _structurally impossible_ rather than filtered: there is no input to filter.
A non-UUID identifier throws rather than being interpolated, and the error names the offending
_field_ and never echoes the offending _value_, because that value may be exactly the business data
the convention forbids a key from carrying.

`assertKeyIsWellFormed()` then re-checks the **output** — the last line before a value the database
freezes forever, since `storage_key` is immutable under `tg_document_versions_immutable` and
replacement content is a new version row, never an edit. Four rules:

| #   | Rule                                              | What it mirrors, and why it is separate                                                                                                                                                                                       |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Length is 8–512 characters                        | The bound in `ck_document_versions_storage_key_format`. Checked here so a key is refused in the application before the column refuses it with `23514`.                                                                        |
| 2   | Matches `^[A-Za-z0-9][A-Za-z0-9._/=-]*$`          | The column CHECK's character class, verbatim. No whitespace and no `@`, so a space-bearing name or an email address is structurally invalid.                                                                                  |
| 3   | No traversal and no empty segment                 | No `..`, no `//`, no leading or trailing `/`. **The charset alone permits `a/../b`** — the database CHECK would accept it. This rule is the reason the convention is more than the CHECK.                                     |
| 4   | Exactly four segments, and segments 2–4 are UUIDs | The convention's shape, enforced. It is what keeps a key _opaque_: a locator, never a description of its content, so the §4 prohibition on emails, phone numbers, names, VINs and registration numbers holds by construction. |

Rule 4 is stricter than the convention document, which also permits a `v<n>` version segment. The
implementation chose the version **UUID**, so the key is stable before the version number is known —
allocation of `version_number` needs a lock on the parent document, and building the key first lets
the whole authorization happen in one round trip. Both forms satisfy the convention; only one is
produced, and `assertKeyIsWellFormed()` rejects the other so the two cannot drift apart.

`keyBelongsToTenant()` is the belt to that brace: it compares segment 2 against the resolved tenant
id, positionally, before a download URL is signed. RLS has already decided the caller may see the
version row, so this only catches an application bug that paired the wrong row with the wrong
tenant — but that bug is precisely the one that would hand a caller another tenant's bytes.

## 4. The deterministic local adapter

`LocalStorageProvider` (`name: 'local_fake'`) signs URLs the way a real provider would — canonical
string, HMAC-SHA256, bounded expiry, method and content binding — against a host in the RFC 2606
reserved `.invalid` TLD:

```
https://object-storage.invalid/<bucket>/<storage key>
  ?x-method=PUT|GET
  &x-expires=<absolute epoch seconds>
  &x-content-type=…   &x-content-length=…   &x-filename=…     (when supplied)
  &x-signature=<base64url HMAC-SHA256>
```

A URL it issues is therefore two things at once, and both are deliberate:

- **Verifiable.** The adapter carries its own `verify()`, which is what lets the security tests be
  _evidence_ rather than assertion. Without it, "a download URL cannot be replayed as an upload"
  would be a claim about a string; with it, each tampered URL is handed to the same code path that
  accepts a genuine one, so a rejection is an observed refusal.
- **Useless.** `.invalid` is reserved by RFC 2606 and no resolver may ever answer for it. A URL that
  escapes into a log, a screenshot, or a bug report cannot reach anything, anywhere. That is what
  stops this adapter from quietly becoming production: it cannot, because it does not resolve.

No credential is ever returned. The HMAC key is generated per process with `randomBytes(32)` — or
supplied by a test for reproducibility — and never leaves the object. Two adapters with different
keys do not honour each other's URLs; two with the same key do, which is the control that makes the
first fact attributable to the key rather than to per-instance state.

The adapter also carries a `behaviour` seam (`'ok' | 'timeout' | 'outage'`, defaulting to `'ok'`) so
the provider-fault paths can be exercised without a network. It is a test seam, stated as one.

## 5. Time bounds, and where they come from

Three layers, and the tightest wins.

| Bound                              | Value                     | Where it lives                                                                                  |
| ---------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `ABSOLUTE_MAX_URL_TTL_SECONDS`     | **900** seconds           | The port. The longest lifetime _any_ adapter may issue, whatever configuration says.            |
| `STORAGE_UPLOAD_URL_TTL_SECONDS`   | 30 – 900, default **600** | `backendConfig()`. Upload gets the longer window because the transfer itself happens inside it. |
| `STORAGE_DOWNLOAD_URL_TTL_SECONDS` | 15 – 600, default **120** | `backendConfig()`. A download needs only long enough to start.                                  |

Both configuration values are bounded on **both** sides, and the reasoning is symmetric: a URL that
lives for hours is a bearer credential sitting in a browser history, and one that lives for two
seconds cannot survive a slow upload. An unbounded floor is as much a defect as an unbounded
ceiling.

The adapter re-checks the bound it was handed rather than trusting the caller — an integer in the
inclusive range `1 … ABSOLUTE_MAX_URL_TTL_SECONDS`, so zero, negatives, fractions, `NaN`, and
`Infinity` are all refused with `kind: 'refused'` **before any URL exists**. Both ends of that range
are exercised as accepted values, which is what keeps the refusals above evidence of a policy rather
than of an off-by-one. Refusing before issuance matters: a
URL that is filtered after being minted has already been computed, and the failure mode of "we
generated it but discarded it" is one code change away from "we generated it and returned it".

The related size ceilings work the same way. `STORAGE_MAX_UPLOAD_BYTES` (1 KiB – 256 MiB, default
25 MiB) is a **platform cap**, not the limit: `shared.document_categories.max_size_bytes` is
authoritative per category, and the effective ceiling is the minimum of the two, so a mis-configured
category cannot exceed the platform value.

## 6. What is inside the signature

The canonical string is joined with newlines and contains, in order:

```
v1
<bucket>
<method>
<storage key>
<absolute expiry, epoch seconds>
<content type or ''>
<content length or ''>
<download filename or ''>
```

Two choices in that list carry the security properties.

**The absolute expiry is signed, not the duration.** Signing `expiresInSeconds` would let a holder
keep a URL alive by re-deriving it from a later clock. Signing the instant means the expiry cannot be
moved — an edited `x-expires` fails signature verification both while the original URL is still live
_and_ at the moment the extension was supposed to buy.

**The method is inside the signature.** That is what binds a `GET` URL to `GET`. With the same key,
the same clock, and the same expiry, a PUT URL and a GET URL differ only in the method, so an
identical signature would mean the method was not bound at all.

Content type and content length are bound the same way, which is what makes an upload URL a
capability for _one object of one declared shape_ rather than a general write handle to a key.

Verification compares signatures with `timingSafeEqual`, length-checked first — `timingSafeEqual`
throws on a length mismatch, and a truncated signature must produce the ordinary refusal rather than
an exception. Every refusal returns a stable machine-readable reason (`unparseable`, `wrong-host`,
`wrong-bucket`, `malformed`, `bad-signature`, `expired`) and never echoes the key it was given.

## 7. `Content-Disposition`: three separate hazards

`safeContentDispositionFilename()` exists because the naive
`Content-Disposition: attachment; filename="${name}"` hits all three of the following, and a filename
is business-supplied text that arrives from a browser.

| #   | Hazard                  | The vector                                                                                                           | The treatment                                                                                            |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | **Header injection**    | CR/LF in the name splits the header and forges a second one.                                                         | Every character in the C0 range (`U+0000`–`U+001F`) **and DEL** (`U+007F`) is **stripped, not escaped**. |
| 2   | **Parameter injection** | `"`, `;`, `\` and `,` end or extend the parameter — which is how `x";attachment;filename="y` becomes two directives. | All four are stripped.                                                                                   |
| 3   | **Path disclosure**     | A browser-supplied name can carry a full local path, leaking a directory layout or a username.                       | Only the last path segment is kept, splitting on either separator.                                       |

Three further rules finish the function: runs of whitespace are collapsed to a single space so the
name stays readable rather than being deleted; a name that is only dots is discarded, because it
would render as `.` or `..` in a file manager; and the result is bounded to 200 characters. A name
that ends up empty becomes the literal `attachment`, so the header is always well-formed.

One thing the function deliberately does **not** do: transliterate. Non-ASCII characters, Arabic
among them, are preserved verbatim, and the **caller** is responsible for emitting them as RFC 5987
`filename*=UTF-8''…` rather than as a raw `filename=`. Mangling an Arabic filename into ASCII would
be a worse outcome than requiring the caller to encode correctly, and the unit suite pins that
behaviour with an explicit Arabic case.

`safeStoredFileName()` applies exactly the same sanitisation before the title is persisted in
`shared.documents`. The original is **not** kept anywhere: a value that cannot be rendered safely in
a header should not be stored only to be sanitised again by every later reader.

## 8. Three values that never appear in a log

**A signed URL, a storage key, and a dedupe key are never logged as values.** Not at info, not at
debug, not in an error, not in an audit record, not in an event payload.

The reasons differ, and each is worth naming:

- **A signed URL _is_ the capability.** Whoever holds it can read or write the bytes it names, with
  no session, no tenant context, and no RLS anywhere in the path. Logging it converts a log index
  into an access-control bypass.
- **A storage key travels further than row data.** Logs, storage inventories, replication tooling,
  and backup listings all see keys _outside_ RLS. It grants no access on its own — the
  [convention §5](../../database/storage-key-convention.md) is explicit that possessing a key is not
  authorization — but it is a locator, and locators accumulate.
- **A dedupe key routinely encodes a business identity.** It is caller-chosen and typically built
  from the thing being notified about, so it is treated as restricted: recorded in the audit trail
  with `classification: 'restricted'` (which `iam.audit_mask` collapses to a fixed marker before
  storage) and never placed in a log context at all.

### 8.1 Why the redactor cannot be trusted to do this

[`src/server/observability/redaction.ts`](../../../src/server/observability/redaction.ts) matches
secret key fragments as **case-insensitive substrings**, and its list includes `key`, `auth`,
`session`, `signature`, and `token`. That produces an asymmetry that is easy to get wrong in both
directions:

| Field name   | Redactor behaviour            | Consequence                                                                                       |
| ------------ | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `storageKey` | `[REDACTED]` — contains `key` | Safe **by accident**, and unusable for debugging.                                                 |
| `dedupeKey`  | `[REDACTED]` — contains `key` | Same.                                                                                             |
| `objectKey`  | `[REDACTED]` — contains `key` | Same.                                                                                             |
| `url`        | **passes through**            | A signed URL logged under `url` is emitted in full. The redactor has no rule that would catch it. |

So the rule cannot be delegated to the redactor: it would over-redact the harmless fields and
under-redact the dangerous one. The value-shape scrubber does not close the gap either — it matches
JWTs, `Bearer` headers, PEM blocks, and PostgreSQL URLs with inline passwords, and a signed URL
looks like none of those.

The decision, recorded in the [binding implementation decisions](./phase-1-15-implementation-decisions.md)
§4, is to treat the redactor as **correct by default and to work with it, not around it**. No
redaction rule is weakened to make a P1-15 log line more readable. Instead the log states the _fact_
of an issuance and nothing else:

```ts
log.info('Signed URL issued', {
  module,
  operation,
  correlationId,
  result: 'success',
  context: { purpose, ttlSeconds, provider: storageProvider().name },
});
```

`purpose` is `upload` or `download`, `ttlSeconds` is a number, and `provider` is a low-cardinality
adapter name. Together they answer every operational question a log can legitimately answer — did we
issue one, for what, how long was it good for — without carrying the capability. Metrics follow the
same discipline: `storage.signed_url.count`, `storage.signed_url.duration_ms`, and
`attachment.authorization.count` are labelled with `provider`, `purpose`, and `result` only.

The audit trail applies the same rule at the row level. The upload-authorization record carries
`storage_key_issued = "true"` — the fact that a key was reserved, never the key.

## 9. Provisioning status — the honest record

| Item                                            | State on 2026-07-23                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Object-storage **port** and its guarantees      | Implemented; unit-tested against the local adapter and its verifier, with no network and no database                                                 |
| Storage-key construction and validation         | Implemented; the four rules above are exercised as a unit suite                                                                                      |
| Signed-URL issuance, binding, and expiry        | Implemented for the local adapter; method, key, absolute expiry, content type, and content length are each edited in turn and the edited URL refused |
| `Content-Disposition` sanitisation              | Implemented; the three hazards each have dedicated cases                                                                                             |
| **Production object store**                     | **Not provisioned. Not selected. Open owner decision (ADR-012 remains open).**                                                                       |
| Default provider in an unconfigured environment | `unconfigured` — refuses every call with `ERR-SYS-001`                                                                                               |
| Byte transfer through this platform             | None. No request handler reads or writes file content.                                                                                               |
| Malware scanning of stored objects              | **None.** No scanner is configured or implemented; see [attachment lifecycle §4](./attachment-lifecycle.md)                                          |
| Replication, CDN, failover, throughput, or SLOs | **None claimed, none provisioned, none measured.**                                                                                                   |

### 9.1 What choosing a provider will still require

Recorded so the open decision is scoped rather than merely open. Each of these is _not_ solved by
the port:

- **Key management for the signing material.** The local adapter generates per-process HMAC material
  precisely because no key management is provisioned. A real provider signs with credentials that
  must be rotated, scoped, and kept out of the application image.
- **Bucket-side policy.** The port guarantees that the application never issues an unbounded URL. It
  cannot guarantee that the bucket itself is private, versioned, encrypted at rest, or closed to
  public listing — those are provider configuration and are outside anything this phase can assert.
- **Server-side enforcement of the content bindings.** The canonical string binds content type and
  length, and the local verifier checks them. Whether a real provider _enforces_ them at its edge is
  a property of that provider, and must be verified against it rather than assumed from this
  document.
- **Orphan reconciliation.** A storage key is reserved before the bytes exist, and a client that
  abandons an upload leaves a reserved key with no object. Nothing in this phase reconciles the two,
  because nothing in this phase can list a bucket.

## 10. Governance

This document describes the committed implementation as read on 2026-07-23 against the working tree.
It records owner-authorized technical self-review under the Standing Technical Authorization and
Solo Developer Review policies, and is **never** represented as an independent review, independent
QA, or a third-party audit.

**The Phase 1-15 owner gate is [Pending](./phase-1-15-owner-gate.md).** No production readiness,
availability, durability, throughput, failover, CDN, replication, or monitoring outcome is claimed
here, and the selection of an object-storage provider remains an open owner decision.
