# ADR-016: CDN Readiness

## Status

Accepted by owner instruction — for the asset classification, cache-control rules, versioning
strategy, tenant-isolation rule, and purge ownership recorded below, which are binding on every phase
that produces a servable asset.

**No content delivery network is provisioned, and none is approved.** The hosting provider,
production region, and deployment platform remain **Open** (ADR-001, ADR-005, ADR-007, ADR-012), and
a CDN is a property of a platform none of which has been chosen. Selection, configuration, and
operation of a CDN are **Open** and out of scope for this record.

The only part of this decision implemented today is the API default: authenticated responses are sent
`Cache-Control: no-store, private`. Everything else is a rule binding on the phase that introduces
the surface it governs. **No CDN performance, hit-ratio, latency, or availability behaviour is
claimed** — no such system exists to observe.

## Context

Phase 1-13 delivers a backend foundation and exactly one endpoint. There is no frontend, no file
service, and no static-asset pipeline beyond what Next.js produces at build time. A CDN would have
almost nothing to serve.

The decision is nevertheless worth taking now, because the expensive CDN mistakes are made _before_
a CDN exists:

1. **Caching headers are decided at the origin.** If authenticated API responses are emitted without
   an explicit `Cache-Control`, the first shared cache placed in front of them decides for itself
   what is reusable — and it decides using the URL, which does not contain the tenant, the user, the
   company, or the branch.
2. **Asset immutability is decided by the build.** Long-lived caching is only safe for content
   addressed by a version or a content hash. Retrofitting that onto assets already published at
   stable paths means either short TTLs forever or a purge on every deploy.
3. **Signed-access decisions are decided by the file service.** Documents in this platform are
   tenant-owned, frequently classified, and governed by RLS and retention rules. Whether they can be
   served from an edge cache at all is a question the file-service design must answer, and the
   answer must be recorded before the design, not after.

Phase 1-15 owns the file service. This record is therefore written so that phase inherits
constraints rather than starting a fresh argument.

## Decision

**No CDN is introduced.** The rules below are binding now for the surfaces that exist, and binding on
each later phase for the surfaces it creates.

### 1. Asset classes

| Class                                                               | Public and edge-cacheable?   | Access control                                 | Notes                                                                       |
| ------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| Build-output static assets (JS, CSS chunks) at content-hashed paths | **Yes**                      | None required                                  | Immutable by construction; the hash is the version                          |
| Fonts, icons, and application images shipped with the build         | **Yes**                      | None required                                  | Must be versioned (§3)                                                      |
| Product marketing or documentation assets, if any are ever added    | **Yes**                      | None required                                  | Tenant-neutral by definition; anything tenant-specific is not in this class |
| The generated OpenAPI document as published in the repository       | Repository artefact          | Repository access control                      | Not served from an edge cache; it is not an application endpoint            |
| Authenticated API responses (business data)                         | **No**                       | Session + server-side authorization            | `Cache-Control: no-store, private` today                                    |
| Failure responses (problem documents)                               | **No**                       | —                                              | `Cache-Control: no-store`                                                   |
| Health and readiness responses                                      | **No**                       | —                                              | A cached health answer is worse than none                                   |
| Tenant-uploaded documents and their versions                        | **No — signed access only**  | Signed, short-lived, per-request authorization | Phase 1-15. Contents are tenant-owned and frequently classified             |
| Generated reports and exports                                       | **No — signed access only**  | Signed, short-lived, per-request authorization | Derived from authorized reads; inherits the source classification           |
| Anything containing a value classified restricted                   | **Never cacheable anywhere** | —                                              | Also permanently prohibited from the server-side cache                      |

The default for an unclassified asset is **not cacheable**. A class is added to the table above by a
reviewed change, never by a header written at a call site.

### 2. Cache-Control rules

| Surface                                   | Header                                               | Reason                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Authenticated API success                 | `Cache-Control: no-store, private`                   | **Implemented today.** `no-store` prevents retention; `private` additionally forbids a shared cache from reusing it |
| Any failure response                      | `Cache-Control: no-store`                            | **Implemented today.** A failure is never a cacheable representation of a resource                                  |
| Immutable, content-addressed static asset | `Cache-Control: public, max-age=31536000, immutable` | Safe only because the path changes when the content changes                                                         |
| Versioned but not content-addressed asset | `Cache-Control: public, max-age=<short>` + `ETag`    | Revalidation is required because the path can outlive the content                                                   |
| Signed document or export URL             | `Cache-Control: private, no-store` at the origin     | The URL is per-request and short-lived; an edge cache must not retain the bytes                                     |
| Health and readiness                      | `Cache-Control: no-store`                            | The answer is only meaningful at the instant it is produced                                                         |

**The binding rule:** _authenticated API responses default to non-public caching._ Today that default
is implemented literally as `Cache-Control: no-store, private`, applied by the request pipeline rather
than by individual handlers, so a handler cannot opt out by omission. Any future relaxation for a
specific endpoint requires an explicit declaration in the operation registry and a recorded reason,
and may never apply to a response whose content varies by tenant, company, branch, or user.

### 3. Immutable asset versioning

- **Content-addressed paths are the primary mechanism.** An asset whose filename contains a hash of
  its bytes can be cached for a year, because a change produces a different URL. This is what makes
  `immutable` honest rather than a gamble.
- **A stable path with changing content may never carry a long `max-age`.** If a path must be stable,
  it gets a short `max-age` plus revalidation.
- **Never rely on a purge to correct a long TTL.** Purges are asynchronous, per-provider, and
  frequently partial. A cache-control value that is only safe if a purge succeeds is not safe.
- **Version query strings are not versioning.** Some intermediaries ignore or strip them; the version
  belongs in the path.

### 4. ETag and content-version strategy

- **Static assets:** the content hash in the path is the version; an `ETag` derived from the same
  hash may accompany it for revalidation of non-addressed paths.
- **Business resources:** `ETag` carries the **record version**, formatted `"<record_version>"`, and
  is the same value the client returns in `If-Match` for optimistic concurrency. That is implemented
  today. It is a **concurrency-control** identifier, not a caching one — the response it accompanies
  is `no-store`, so no cache may use it for revalidation.
- **Weak validators** (`W/"…"`) are accepted on input for compatibility and are never emitted.
- **Never derive an ETag from a value that varies by caller** — a scope list, a user id, a locale
  resolved from a header. An ETag that varies by caller on a URL that does not is a cross-caller
  collision waiting for a shared cache.

### 5. Tenant isolation at the edge

- **Tenant, company, branch, and user scope never appear in a cacheable URL, and a shared cache is
  never permitted to key on URL alone for tenant-owned content.** Because the scope is not in the
  URL, a URL-keyed cache cannot distinguish two tenants' responses for the same path. The rule
  therefore is not "key carefully"; it is **do not cache authenticated business data at the edge at
  all.**
- **`Vary` is not an isolation mechanism.** `Vary: Authorization` or `Vary: Cookie` is a hint that
  intermediaries implement inconsistently and that fails open when they do not. It may be emitted for
  correctness, but it may never be relied upon as the control.
- **A tenant identifier must never be placed in a public asset path** to make an asset "tenant
  specific". That converts a tenant identifier into a public, enumerable value.
- **Tenant-specific branding or configuration assets**, if ever introduced, are authenticated
  application data, not public assets, and must be classified in §1 before they are served.

### 6. Purge ownership

Binding on the phase that introduces a CDN:

1. **Purge is owned by the deployment pipeline, never by application code.** An application path that
   can purge an edge cache is an application path that can be abused to purge an edge cache.
2. **Purge is a corrective action, not a design element.** Correct cache-control values plus content
   addressing must make the system correct without any purge; purging exists for mistakes and
   emergencies.
3. **Every purge is recorded** — what was purged, by whom, and why — in the same place deployments
   are recorded.
4. **Purge of tenant-owned content is not a supported operation**, because tenant-owned content is
   never at the edge in the first place.

### 7. File-service integration is deferred to Phase 1-15

`FileService` is a **contract-only stub** in Phase 1-13: `authorizeUpload`, `registerVersion`, and
`requestDownload` all throw the cataloged `ERR-STB-001`. There is no byte transfer, no storage
provider, no signed URL, no virus scanning, and no retention enforcement.

`DownloadGrant` already declares `{ url, expiresAt }`, which fixes the shape — a short-lived,
per-request grant — without deciding the mechanism. Phase 1-15 decides the storage provider, the
signing scheme, the expiry, and whether any document class may be edge-cached at all. Until then this
record's position stands: **documents are signed-access only and are not edge-cacheable.**

### 8. Explicitly not decided

Provider, edge topology, TLS termination, origin-shield configuration, compression settings, and any
hit-ratio, latency, or availability target. All are **Open**. Nothing in this record may be cited as
approving any of them.

## Alternatives Considered

**Alternative 1 — Provision a CDN now for the build's static assets.**
Rejected. It requires choosing a provider and a region, which are owner decisions that have not been
made (ADR-012), and it would incur cost and a data-residency position for a product with no hosted
deployment and no users. There is also almost nothing to serve: Phase 1-13 has no frontend and one
API endpoint. The claimed benefit — discovering edge behaviour early — is unavailable, because with no
traffic and no hosted origin there is nothing to observe.

**Alternative 2 — Allow authenticated API responses to be cached at the edge with `Vary` headers and
short TTLs.**
Rejected, and this is the most important rejection in the record. Authenticated responses in this
platform vary by tenant, user, company, and branch — none of which appear in the URL. Correctness
would depend on every intermediary implementing `Vary` faithfully over headers that are themselves
sensitive, and the failure mode is not a stale page but **one tenant receiving another tenant's
data**. Row-Level Security is the platform's primary isolation control (ADR-004); an edge cache that
serves a stored response never reaches RLS at all. The performance benefit is real and is not worth a
cross-tenant disclosure risk.

**Alternative 3 — Serve tenant documents from a public, unguessable URL.**
Rejected. Security by URL entropy fails to every mechanism that records URLs: proxy logs, browser
history, referrer headers, chat previews, and CDN access logs. It also cannot be revoked — the only
remedy is to move the object — and it cannot express expiry or per-request authorization. Documents
in this platform are tenant-owned and frequently classified; they require an authorization decision
per access, which is exactly what a signed, short-lived grant issued by an authorized call provides.

**Alternative 4 — Write the full CDN configuration now and apply it when a provider is chosen.**
Rejected for the reason ADR-012 gives: every substantive field would be invented, and invented
specifications are read later as decisions. The durable content of a CDN decision is the asset
classification, the cache-control rules, and the isolation rule — all of which are provider-independent
and are recorded here — not the provider's console settings.

## Consequences

**Positive.**

- The dangerous default is closed _before_ any edge cache exists: authenticated responses are
  already `no-store, private`, applied by the pipeline rather than by handler discipline.
- Phase 1-15 inherits a decided position on document delivery — signed, short-lived, not
  edge-cacheable — rather than re-arguing it under delivery pressure.
- Asset classification is a table that can be reviewed, extended, and checked, instead of a set of
  headers scattered across call sites.
- No cost, no region commitment, and no unverifiable provider configuration enters the repository.
- The ETag strategy separates concurrency control from caching explicitly, which prevents the common
  conflation in which a version identifier accidentally authorises revalidation of private data.

**Negative and trade-offs — accepted knowingly.**

- **No edge acceleration exists.** Every request is served by the origin. For a pilot with no hosted
  deployment this costs nothing; when a hosted deployment exists and users are geographically
  distributed, it will be a real latency cost until a CDN is provisioned.
- **`no-store, private` forgoes legitimate caching.** Some authenticated reads are genuinely
  stale-tolerant and could be cached privately by the browser. The blanket default gives that up in
  exchange for a rule with no exceptions to get wrong. Relaxing it per endpoint remains possible and
  requires an explicit declaration.
- **Signed-access document delivery costs an authorization round trip per download**, and the signing
  scheme is not yet designed.
- **These rules are unverified against a real CDN.** They are provider-independent by construction,
  but provider behaviour around `Vary`, `immutable`, and purge semantics differs, and the first
  provisioning will surface differences.
- **This record will need superseding** when a provider is chosen, to record the provider, the
  topology, and the purge mechanism actually used.

## Security Impact

- **The cross-tenant disclosure risk is the whole reason for the central rule.** Tenant, company, and
  branch scope are not in the URL. A shared cache that stores an authenticated response and serves it
  to a second caller bypasses both Row-Level Security and server-side authorization, because the
  origin is never consulted. `no-store, private` is therefore a tenant-isolation control, not a
  performance setting.
- **`Vary` may never be relied on as an isolation control.** It is implemented inconsistently by
  intermediaries and fails open.
- **A tenant identifier in a public asset path is an enumeration vector** and is prohibited.
- **Signed grants must be short-lived and per-request.** A long-lived signed URL is a bearer
  credential with no revocation.
- **Restricted-classified values are never cacheable anywhere** — not at the edge, not in the
  server-side cache, and not in logs. That is consistent across this record, the cache eligibility
  matrix, and the observability prohibition list.
- **Purge must not be reachable from application code**, because a reachable purge is an abusable
  purge.
- No CDN security assessment, edge WAF evaluation, or penetration test has been performed, and none
  is claimed. Verification is performed by the same engineer who implements; no independent QA
  ownership is assigned.

## Operational Impact

- **Nothing operational changes today.** There is no CDN to configure, monitor, purge, or pay for.
- **The only implemented element is the API cache-control default**, emitted by the request pipeline
  on every authenticated success and every failure response.
- **Phase 1-15 acquires the file-service work** — storage provider, signing scheme, expiry policy,
  scanning, and retention — and inherits this record's constraint that documents are signed-access
  only and not edge-cacheable.
- **A future CDN adds operational obligations** that are not estimated here: certificate management,
  origin protection, purge tooling and its audit trail, cache-hit observability, and a cost model. A
  provider decision is also a data-residency decision, which is an owner matter.
- **No hit ratio, edge latency, origin-offload figure, or availability target is claimed**, and none
  may be inferred from this record. Open decision **P1-OD-027 (NFR-SCL)** is unresolved.
- Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
  was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

## Related Phase 1 Task and Requirement IDs

| ID                  | Relationship to this ADR                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| P1-13-BE-021        | Request pipeline — where `Cache-Control: no-store, private` is applied                          |
| P1-13-BE-013        | Optimistic concurrency — the `ETag` / `If-Match` contract distinguished from caching validators |
| P1-13-BE-018        | File service contract — the stub whose behaviour Phase 1-15 implements                          |
| P1-OD-027 (NFR-SCL) | **Unresolved.** No latency, hit-ratio, or capacity target is claimed                            |
| ADR-004             | Mandatory Row-Level Security — the control an edge cache would bypass                           |
| ADR-012             | Local-first environment with controlled promotion — why no CDN is provisioned                   |
| ADR-014             | Distributed consistency model — the stale-tolerance position this record implements at the edge |
| ADR-015             | Load-balancer readiness — the adjacent edge decision, also not provisioned                      |
| Phase 1-15          | Owns the file service, the storage-key convention in practice, and the richer health endpoints  |
| OIR-01              | Open issue: hosting provider, production region, and deployment platform are not approved       |

Identifiers such as P1-OD-027 and OIR-01 are defined in the canonical documents recorded in
[canonical-documents.md](../governance/canonical-documents.md), which live outside this repository by
owner decision. The storage-key convention referenced by the file-service contract is
[storage-key-convention.md](../database/storage-key-convention.md).

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner; GitHub username `Ezzaldeen-Albitar`) — for the asset
classification, cache-control rules, versioning and ETag strategy, tenant-isolation rule, and purge
ownership. Recorded under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) — for the selection and provisioning of any
CDN, hosting provider, region, or deployment platform, which carry commercial and data-residency
commitments beyond the technical decision. None has been approved.

## Date

2026-07-21
