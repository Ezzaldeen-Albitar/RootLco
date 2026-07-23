# Phase 1-15 — Open Decisions

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. Why a phase records the decisions it did not make

An engineering phase that reaches a decision it has no authority to take has two options: guess, or
build so the decision stays takeable. P1-15 took the second option everywhere, and this record exists
so the cost of that choice is visible rather than buried in a default value.

Each entry below states four things a reader needs to act: **the exact decision**, **who owns it**,
**what is blocked until it is taken**, and **how the code stays neutral in the meantime**. A decision
is recorded here only when the phase genuinely declined it — not when it was made and disliked. Choices
the phase _did_ make, including the ones that overrode planning instructions, are in
[the binding implementation decisions record](phase-1-15-implementation-decisions.md).

The rule applied throughout, inherited from P1-13: where a decision was open, the phase chose the
option that is **reversible and fails closed** over the option that is convenient and fails open. A
port with a refusing default can be replaced by an adapter; a hard-coded provider or a fabricated scan
verdict cannot be un-shipped.

## 2. Open decisions raised or carried by this phase

| Ref       | Decision                                                       | Owner                                                      | Blocked until taken                                                                       |
| --------- | -------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **OD-01** | Production object-store provider and its provisioning          | Product owners (commercial), with technical specification  | Any real upload or download; document bytes; export file generation                       |
| **OD-02** | Production message-delivery provider and its provisioning      | Product owners (commercial), with technical specification  | Any message actually reaching a recipient                                                 |
| **OD-03** | Key management for signing the cursor and the upload token     | Product owners (deployment/secrets), with technical design | Treating either value as a security boundary; carrying any decision inside either         |
| **OD-04** | Country / jurisdiction default for national-format input       | Product owners (commercial and legal)                      | Accepting a national-format phone number without an explicit region                       |
| **OD-05** | Malware scanner selection **and** the document-acceptance path | Product owners (commercial), with security design          | Document acceptance; downloads of any document; anything that depends on accepted content |
| **OD-06** | Whether a durable transient content store is introduced        | Product owners, on a recorded technical recommendation     | Cross-process reproduction or redelivery of rendered notification content                 |

## 3. Each decision in full

### OD-01 — Production object-store provider

**The exact decision needed.** Which object-storage service is used in each promoted environment; the
bucket or container naming and its provisioning owner; whether server-side encryption is required and
under whose keys; the retention and lifecycle policy for stored objects; and whether the signing
method that service offers can satisfy the port's guarantees (bound method, bound content type and
length where supported, mandatory expiry).

**Who it belongs to.** The product owners, jointly. [ADR-012](../../adr/ADR-012-local-first-environment-with-controlled-promotion.md)
records that no hosting provider, production region, or deployment platform has been approved, and
[ADR-003](../../adr/ADR-003-supabase-and-postgresql-data-platform.md) leaves the hosted project, its
region, and its commercial plan explicitly open. Storage selection carries the same commercial and
data-residency weight as those, so it is not a technical convenience.

**What is blocked.** Every path that moves bytes. Upload authorization and download authorization are
implemented and audited, but the default adapter refuses to sign, so no object can actually be stored
or retrieved outside the deterministic local adapter. Export **generation** (OD-05's neighbour, see
[risk register](risk-register.md) R-10) is blocked on this as well, because a generator needs somewhere
to write.

**How the code stays neutral.** `StorageProvider` in
[`src/modules/shared-services/provider/storage-provider.ts`](../../../src/modules/shared-services/provider/storage-provider.ts)
is a port whose default, `UnconfiguredStorageProvider`, refuses every call with `ERR-SYS-001` naming
the setting for the operator. `STORAGE_PROVIDER` defaults to `unconfigured` in
[`src/server/config/backend-config.ts`](../../../src/server/config/backend-config.ts) — the default
says "nothing is provisioned" rather than quietly selecting something. Selecting a provider is an
adapter plus a configuration value; no service, repository, route, or test changes.

### OD-02 — Production message-delivery provider

**The exact decision needed.** Which delivery service is used per channel (email, SMS, or others); the
sending identity and domain; how a recipient _reference_ resolves to an address inside the adapter,
given that the platform deliberately never stores a plaintext destination; the commercial plan and its
throughput ceiling; and the retention position for provider-side logs.

**Who it belongs to.** The product owners, jointly — same reasoning as OD-01. A sending domain and a
delivery contract are commercial and reputational commitments.

**What is blocked.** Delivery only. **Enqueue is not blocked**, and that separation is deliberate: the
durable outcome of a successful queue call is one `shared.outbound_messages` row in `pending`, and the
provider is contacted only by the worker, on a different database role, outside the business
transaction. So business modules can integrate against notifications today; what nobody can claim is
that a message reached anyone.

**How the code stays neutral.** `MessageProvider` in
[`src/modules/shared-services/provider/message-provider.ts`](../../../src/modules/shared-services/provider/message-provider.ts)
is a port; `UnconfiguredMessageProvider` refuses. The port carries **no recipient address field** at
all, so an adapter cannot be written that assumes the platform will hand it one — resolving a reference
to an address is the adapter's own concern against its own configuration. `NOTIFICATION_PROVIDER`
defaults to `unconfigured`.

### OD-03 — Key management for signing the cursor and the upload token

**The exact decision needed.** Whether a signing key exists at all; if so, where it lives, how it is
distributed to every instance, how it rotates, and what a verifier does with a value signed under a
retired key. Then, separately, whether the pagination cursor and the upload token should be signed at
all — signing a value that carries no authority buys little and adds an operational dependency.

**Who it belongs to.** The product owners for the secrets-management platform (it follows the hosting
decision in ADR-012), with the technical design of rotation and verification.

**What is blocked.** Nothing in current behaviour. What is blocked is _future_ behaviour: neither value
may ever carry a decision — a permission, a scope, a tenant that is not independently re-derived —
until this is taken. Both are unsigned base64url JSON today, and both are explicitly documented as not
being security boundaries, in
[`domain/attachment-policy.ts`](../../../src/modules/shared-services/domain/attachment-policy.ts) and
[`domain/query-primitives.ts`](../../../src/modules/shared-services/domain/query-primitives.ts)
respectively.

**How the code stays neutral.** Every claim in the upload token is re-validated server-side at
registration, and the storage key is re-derived rather than accepted; the cursor's contract key carries
a fingerprint of filter set, sort, and tenant so it fails closed across queries, and every page still
runs under RLS. A fingerprint is deliberately **not** described as a signature anywhere in the source.
Adding signing later is additive: a signed envelope around a payload that is already fully re-validated
changes no caller.

### OD-04 — Country / jurisdiction default for national-format input

**The exact decision needed.** Whether the platform has a default country at all, and if so which one;
whether the default is per-platform, per-tenant, or per-branch; and what an interface should do with a
national-format number when no region is available. The same decision governs default currency,
address format, and the jurisdiction under which tenant data is held — which is why it is not a
normalization detail.

**Who it belongs to.** The product owners, jointly. It is the same class of decision as the hosting
region: ADR-003 and ADR-012 both record that no region is approved and that **data residency is
undetermined precisely because no region has been chosen**. `P1-OD-027` (NFR-SCL) is adjacent but
distinct — it keeps every _numeric_ limit in this phase a proposed validation baseline rather than a
measured target, including the E.164 digit bounds used in phone plausibility.

**What is blocked.** Accepting a national-format phone number without an explicit region. P1-15 refuses
to guess: `normalizePhone()` reports `ambiguous-without-region` rather than assuming a calling code,
because guessing would merge two different people's numbers under one lookup key. An E.164 value
(leading `+`) is self-describing and needs no region, so the common case is unaffected.

**How the code stays neutral.** The region is an explicit `regionCallingCode` option on the call, never
a module constant and never a configuration default. **No default country is assumed anywhere in this
phase.** Taking the decision means supplying the option from wherever the owner decides it lives; it
does not change the normalizer.

### OD-05 — Malware scanner selection, and the acceptance path

**The exact decision needed.** Two decisions, and they must be taken together:

1. **Which scanner**, running where (inline before acceptance, or asynchronously against stored
   objects), under what commercial terms, with what verdict vocabulary and what latency budget.
2. **Which identity writes the verdict**, given that
   [DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md)
   deliberately withheld write capability on `shared.file_scan_results` from **every** application
   role. Granting it to a scanning identity is a database change request in its own right, and the
   grant must be narrow enough that a compromised request runtime still cannot fabricate a `clean`
   verdict.

**Who it belongs to.** The product owners for scanner selection and its commercial terms; the technical
design of the writing identity follows and must go through the controlled database change-request
process rather than an improvised migration.

**What is blocked.** Document **acceptance**, and therefore every download.
`shared.guard_document_version_transition` accepts a version only when a `clean` scan row exists, so the
transition is structurally unreachable today. Anything that depends on accepted content — issued
document delivery, signature evidence, inspection media retrieval — is blocked behind the same edge.
Byte-level verification that a stored object matches its declared content type is the same missing
component; nothing in P1-15 reads bytes.

**How the code stays neutral.** No code path fabricates a verdict, and none tries to. The refusal is
surfaced as `ERR-DOC-001` — a distinct code precisely so the failure is legible as a state problem
rather than disguised as "not found". The withholding is recorded as deliberate in the
[remediation verification](phase-1-15-remediation-verification.md) and re-proven on protected `develop`
against the real non-owner logins.

### OD-06 — Whether a durable transient content store is introduced

**The exact decision needed.** Whether rendered message content is stored durably between enqueue and
dispatch, and if so: where, under what encryption, with what retention, under whose RLS, and with what
answer to the obvious objection — that it becomes a **second place message content lives**, after the
platform went to some trouble to make `outbound_messages` store only a digest.

**Who it belongs to.** The product owners, on a recorded technical recommendation. It is a privacy and
retention decision before it is an engineering one.

**What is blocked.** Cross-process reproduction of rendered content. Today rendering happens once, at
enqueue, from an approved immutable version; the SHA-256 digest is stored and the content is handed to
the dispatcher in process, which recomputes the digest and refuses a mismatch. If the process holding
the content ends first, the content is gone — the row still proves the message was requested and
carries its lifecycle, but **cross-process redelivery of content is not implemented and is not
claimed**. See [risk register](risk-register.md) R-04.

**How the code stays neutral.** `queueMessage()` keeps the frozen P1-13 signature and returns only the
queue result; `queueMessageWithRendering()` is the additional method that hands back the transient
content. A durable store would be a new collaborator behind the same two methods, not a change to
either contract.

## 4. Carried forward from earlier phases, unresolved

Recorded so this document is a complete picture rather than only the new items. None was resolved by
this phase, and closing the P1-15 gate would close none of them.

| Ref                              | Decision                                                 | State                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **OIR-01**                       | Product name                                             | Pending owner approval ([ADR-011](../../adr/ADR-011-product-name-remains-pending-final-approval.md)). The placeholder is used everywhere |
| **OIR-01** (hosting)             | Cloud provider, production region, deployment platform   | Open (ADR-003, ADR-012). Data residency undetermined as a direct consequence                                                             |
| **P1-OD-027** (NFR-SCL)          | Capacity, throughput, latency, and scale targets         | Unresolved. Every numeric limit added by P1-15 is a proposed validation baseline                                                         |
| **P1-OD-041**                    | Release-group naming and grouping approval               | Pending owner approval; affects documentation labels only                                                                                |
| **MONITORING-PLATFORM**          | Error-monitoring platform and DSN handling               | Open. `ErrorMonitor` remains a port; nothing is provisioned                                                                              |
| **METRICS-BACKEND**              | Metrics exporter and storage                             | Open. The recorder remains in-memory and bounded; the P1-15 instruments were added to the existing vocabulary                            |
| **DISTRIBUTED-CACHE**            | Whether a shared cache service is adopted                | Open                                                                                                                                     |
| **DISTRIBUTED-RATE-LIMIT-STORE** | The shared store backing multi-instance rate limiting    | Open; depends on the deployment-topology decision                                                                                        |
| **REPLICA-TOPOLOGY**             | Whether read replicas are introduced                     | Open ([ADR-017](../../adr/ADR-017-read-replica-readiness.md)); no read is silently routed                                                |
| **BROKER**                       | Whether an external broker replaces or fronts the outbox | Open ([ADR-014](../../adr/ADR-014-distributed-consistency-model.md)); the outbox remains the source of truth                             |
| `AUTH-SESSION-TRANSPORT`         | Session transport                                        | Carried from P1-14, unresolved                                                                                                           |
| `IAM-SELF-ONBOARDING`            | Self-onboarding position                                 | Carried from P1-14, unresolved                                                                                                           |
| `IAM-BASELINE-PERMISSION`        | Baseline permission set                                  | Carried from P1-14, unresolved                                                                                                           |

## 5. Status

Every decision above is **open**. None was taken by this phase, and none may be inferred from a default
value, a configuration key, or the existence of an adapter. The P1-15 owner gate is **Pending**; taking
any decision here is a separate act by the approval owner, recorded in its own right.
