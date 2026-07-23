# Phase 1-15 — Shared-Services Module Architecture

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

> **Authority.** Phase scope and sequencing are governed by the canonical documents recorded in
> [canonical-documents.md](../../governance/canonical-documents.md), which live outside this
> repository by owner decision.
>
> **Gate state.** The [P1-15 owner gate](phase-1-15-owner-gate.md) is **Pending**. Nothing in this
> record is a gate decision, and nothing here asserts that the phase has passed.

---

## 1. What this record describes

The `shared-services` module is the single place where cross-cutting backend capability lives:
display-number allocation, status transitions, attachment lifecycle and signed URLs, notification
enqueueing and dispatch, message templates and rendering, deterministic normalization, bounded query
primitives, export authorization, and health projections.

This document explains **how the module is shaped and why** — its public surface, its four
sub-layers, how composition installs the two contracts Phase 1-13 froze, the boundary rules that are
executed in CI rather than reviewed by habit, the split between the request runtime and the worker
archetype, and the two places where the delivered design deliberately departs from the P1-15
planning text.

It does not restate the behaviour of individual services. Those have their own records — see the
[phase index](README.md).

Every structural claim below was read from the committed source before it was written. The module as
committed is **28 TypeScript files**: one public surface, 8 under `application/`, 7 under `data/`,
9 under `domain/`, 3 under `provider/` (counted directly from
[`src/modules/shared-services`](../../../src/modules/shared-services)).

## 2. One legal import path

[`src/modules/shared-services/index.ts`](../../../src/modules/shared-services/index.ts) is the whole
public surface of the module. Everything under `application/`, `data/`, `domain/`, and `provider/`
is internal, and the boundary checker fails the build for any other module that reaches past it —
in **any** import spelling, because every specifier is canonicalised before the rules see it
(§5).

This is [ADR-001](../../adr/ADR-001-modular-monolith-architecture.md) made mechanical rather than
aspirational: a modular monolith is only modular while the walls are enforced by something that runs.

### 2.1 What the surface exports

| Exported                                                                                                                                                                                                              | Why a caller legitimately needs it                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharedServicesModule()` — the memoised composition returning `attachments`, `notifications`, `templates`, `numbers`, `transitions`, `exports`, `health`, `dispatcher`                                                | The only way to obtain a service instance                                                                                                     |
| Service **input and result types** (`AllocateNumberInput`, `TransitionResult`, `DetailedUploadAuthorization`, `QueuedWithRendering`, `ExportAuthorization`, `LivenessReport`, `DispatchInput`, …)                     | A handler must be able to type the request it builds and the value it returns                                                                 |
| Pure **domain** functions and registries — normalization, the sequence registry, the transition graph, query primitives, export policy, template rendering, notification policy, attachment policy, storage-key rules | Another module needs these to _construct_ a request (a sequence code, a filter contract) or to normalize a value exactly as the database will |
| Provider **ports** and their local adapters, plus `setStorageProvider` / `setMessageProvider` and the `__reset…ForTests` helpers                                                                                      | Composition and the test harness must be able to install an adapter                                                                           |

### 2.2 What the surface deliberately withholds

**No repository, and no pool.** Not one of the seven repository classes is exported, and neither is
any database handle. This is the load-bearing omission: handing out `DocumentRepository` would let a
caller issue SQL under the module's identity while skipping the audit records, outbox events, scope
checks, and policy translation that only the application services apply. RLS would still hold — but
"the database would have stopped them" is a containment argument, not an architecture.

**No service classes, only instances.** `AttachmentService`, `SharedNotificationService`,
`TemplateService`, `MessageDispatcher` and their peers are not exported as constructors. A second
instance would mean a second wiring, and a second wiring is where a missing dependency hides.

**Not every internal helper.** `templateContentHash`, `recipientDigest`, `bodyDigest`,
`assertKeyIsWellFormed`, `contentTypeAllowed`, `ALLOCATION_SQLSTATE`, and `DISPATCH_TRANSITIONS`
stay internal. Each is a detail of _how_ a rule is implemented, and exporting one turns it into a
contract that a later change has to preserve.

## 3. Four sub-layers, one rule each

[`src/server/layering.ts`](../../../src/server/layering.ts) defines the base classes; the module
adds `provider/` as the fourth directory. The rule each layer obeys is what makes the layer worth
having.

| Layer          | Rule it obeys                                                                                                                                                                                                           | Enforced by                                                                                                                                                              | Committed examples                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `domain/`      | **Pure decisions only.** No database, no driver, no provider, no configuration read, no clock it did not receive. State a rule needs arrives as an argument                                                             | Boundary rules **B5** and **B12**; `DomainService` has no `DbHandle` in its signature                                                                                    | `normalization.ts`, `transitions.ts`, `query-primitives.ts`, `storage-key.ts`, `template-rendering.ts` |
| `data/`        | **SQL only, behind the context guard.** Extends `Repository`, issues statements through `this.run()` / `this.runOne()` with bound parameters, and always carries an explicit `tenant_id` predicate _in addition to_ RLS | `Repository`'s `assertContext()`; the controlled data-access rules in the [backend architecture standard](../../standards/backend-architecture-and-shared-foundation.md) | `document-repository.ts`, `number-sequence-repository.ts`, `template-repository.ts`                    |
| `application/` | **The use case.** Receives an already-open `DbHandle`, calls domain and data in order, appends audit, publishes events, maps failures to catalogued codes. Knows about the request; knows nothing about HTTP            | `ApplicationService`; the handle is passed per call, never held on the instance                                                                                          | `number-allocation-service.ts`, `status-transition-service.ts`, `attachment-service.ts`                |
| `provider/`    | **I/O to something outside the platform, behind a port.** Ports declare the shape; adapters implement it; the default refuses rather than pretends                                                                      | Boundary rule **B12** keeps the dependency pointing _into_ the domain, never out of it                                                                                   | `storage-provider.ts`, `message-provider.ts`, `local-storage-provider.ts`                              |

Two consequences are worth naming because they show the rules actually bit.

**The domain layer re-declares a foundation type rather than importing it.**
`domain/query-primitives.ts` needs `OrderingContract` from `src/server/db/pagination.ts`, but B5
forbids a domain file from importing `server/db`. The type is two fields, so it is declared locally;
TypeScript's structural typing makes the two interchangeable, and a compile-time assignment in
`tests/foundation/p1-15-query-primitives.test.ts` fails if the foundation type ever diverges. The
alternative — relaxing B5 for "just a type" — would have made the rule negotiable.

**The provider depends on the domain, never the reverse.**
`provider/local-storage-provider.ts` imports `assertKeyIsWellFormed` from `domain/storage-key.ts`,
so the adapter re-checks the key it was handed instead of signing whatever arrives. That direction is
legal and correct. The reverse — a domain rule reaching for `storageProvider()` — is refused by B12,
because a rule that can make a network call is no longer a rule that can be unit-tested.

## 4. Composition, and the two frozen P1-13 seams

`composeModule()` memoises: `create()` runs at most once per process, and the type system checks the
wiring instead of a runtime container resolving it. Phase 1-13 rejected a dependency-injection
container on purpose — its failure mode is a missing binding discovered in production.

### 4.1 The seams P1-13 left, and where P1-15 fills them

Phase 1-13 froze two interfaces and shipped stubs that reject every call with the catalogued
`ERR-STB-001`, deliberately rather than returning a successful no-op:

- [`src/server/contracts/file-service.ts`](../../../src/server/contracts/file-service.ts) —
  `fileService()` / `setFileService()`
- [`src/server/contracts/notification-service.ts`](../../../src/server/contracts/notification-service.ts) —
  `notificationService()` / `setNotificationService()`

P1-15 implements both without changing a signature. `AttachmentService implements FileService`;
`SharedNotificationService implements NotificationService`. Where a capability did not fit the frozen
shape it was **added beside it**, never inside it: the signed upload URL has no field in
`UploadAuthorization`, so `authorizeUploadDetailed()` returns it and the frozen `authorizeUpload()`
delegates and narrows. Likewise `queueMessageWithRendering()` returns the transient rendered content
while the frozen `queueMessage()` returns only the queue result.

### 4.2 Installation happens _inside_ the factory, not beside it

```ts
export const sharedServicesModule = composeModule({
  module: 'shared-services',
  create: () => {
    installSharedServicesRuntime();
    …
    setFileService(attachments);
    setNotificationService(notifications);
    …
  },
});
```

The two `set…` calls are in the composition body rather than in a separate bootstrap step for one
reason: **obtaining the module at all installs the seams**, so they cannot be forgotten. A separate
`initialise()` would be a step that works until someone adds a new entry point and does not call it —
and the symptom would be a production `ERR-STB-001` from a caller written months earlier.

### 4.3 `installSharedServicesRuntime()` is idempotent and configuration-light

```ts
export function installSharedServicesRuntime(): void {
  if (storageProvider() instanceof UnconfiguredStorageProvider) {
    setStorageProvider(buildStorageProvider());
  }
  if (messageProvider() instanceof UnconfiguredMessageProvider) {
    setMessageProvider(buildMessageProvider());
  }
}
```

An adapter a test already installed is **kept**, and no configuration is read for it. That single
property is what lets the whole suite run with no object storage and no delivery credentials: a test
installs a deterministic adapter first, and composition leaves it alone.

### 4.4 The default is `unconfigured`, and that is the honest default

`STORAGE_PROVIDER` and `NOTIFICATION_PROVIDER` both default to `unconfigured` in
[`backend-config.ts`](../../../src/server/config/backend-config.ts). With that default,
`UnconfiguredStorageProvider` refuses to sign and `UnconfiguredMessageProvider` refuses to deliver,
each naming the setting for an operator and neither returning something that looks like success.

**No production object store and no production message provider is provisioned.**
[ADR-012](../../adr/ADR-012-local-first-environment-with-controlled-promotion.md) leaves the choice
open and this phase does not close it. What P1-15 delivers is the _port_ plus a deterministic local
adapter: `LocalStorageProvider` signs with HMAC-SHA256 against a host in the RFC 2606 reserved
`.invalid` TLD, so a URL it issues is verifiable in a test and can never resolve in the world;
`LocalMessageProvider` delivers nothing anywhere and exists so the timeout, outage, retry, and
dead-letter paths are exercised by real code rather than described in prose.

## 5. Boundary rules

[`scripts/check-module-boundaries.mjs`](../../../scripts/check-module-boundaries.mjs) walks `src/`,
extracts every static import, `export … from`, dynamic `import()` and `require()`, canonicalises each
specifier, and applies the rules below. It is dependency-free, runs identically locally and in CI via
`npm run validate:module-boundaries`, and exits `0` clean, `1` on violations, `2` on a usage or IO
error.

**Why canonicalisation comes first.** P1-13's checker matched rules against raw import text, so an
architectural rule was really a rule about spelling — `@/server/db/pool` failed and the byte-equivalent
`../../../server/db/pool` passed. That was recorded as **ADV-01** and corrected in the
[P1-13 post-gate correction register](../phase-1-13/phase-1-13-post-gate-correction-register.md):
every specifier now resolves to one canonical, project-relative, extensionless, index-collapsed,
case-folded path _before_ any rule sees it. A project-local import that cannot be resolved that way
is a violation (B8), not a pass — failing open on the one import the checker did not understand is
how a boundary guard becomes decorative.

### 5.1 The rules as committed

| Rule                                           | What it enforces                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **B1** module-internals-are-private            | A module may be imported only through `@/modules/<name>`. A module reaching into its _own_ internals is explicitly allowed |
| **B3** foundation-must-not-depend-on-modules   | `server/`, `shared/`, `lib/`, `config/` may not import `modules/…` — dependencies point inward only                        |
| **B4** handlers-hold-no-data-access            | Files under `app/` may not import `server/db`, `server/events`, `server/audit`, or `server/worker`                         |
| **B5** domain-layer-is-database-free           | `modules/*/domain/` may not import `server/db`, and may not import the `pg` driver by name                                 |
| **B6** foundation-must-not-import-app          | `server/`, `shared/`, `lib/`, `config/`, `modules/` may not import `app/…`                                                 |
| **B7** backend-uses-the-backend-logger         | `server/` and `modules/` may not import the Phase 1-1 bootstrap logger `lib/logging/logger`                                |
| **B8** project-imports-must-resolve            | A project-local import that cannot be canonically resolved is refused                                                      |
| **B9** import-specifiers-must-be-literal       | A computed `import()` / `require()` specifier is refused — the rules cannot see through it                                 |
| **B10** no-symlinks-in-the-source-tree         | A symlink can launder a prohibited target into a permitted-looking canonical path                                          |
| **B11** handlers-do-not-hold-service-contracts | **New in P1-15.** Files under `app/` may not import `server/contracts/…`                                                   |
| **B12** domain-layer-holds-no-providers        | **New in P1-15.** `modules/*/domain/` may not import `modules/*/provider/…`                                                |

**There is no rule numbered B2 in the committed checker.** P1-13's B2 (`relative-module-escape`) was
removed as part of the ADV-01 correction: once every specifier is canonicalised, B1 subsumes it in
any syntax, and keeping a second rule that could never fire independently would have made the rule
list a description of history rather than of behaviour. The identifiers are stable names, not a dense
sequence — B2 is retired, not missing.

Executed against the tree as committed:

```
$ node scripts/check-module-boundaries.mjs
Module-boundary check: 155 files scanned in src
Rules enforced: B1-module-internals-are-private, B3-foundation-must-not-depend-on-modules,
B4-handlers-hold-no-data-access, B5-domain-layer-is-database-free,
B6-foundation-must-not-import-app, B7-backend-uses-the-backend-logger,
B11-handlers-do-not-hold-service-contracts, B12-domain-layer-holds-no-providers,
B8-project-imports-must-resolve, B9-import-specifiers-must-be-literal,
B10-no-symlinks-in-the-source-tree
OK: no boundary or layering violation
```

### 5.2 B11 — why a handler may not hold a service contract

`fileService()` and `notificationService()` are foundation accessors that return whatever was last
installed. Before composition runs, that is the P1-13 stub. A Route Handler that imported
`fileService()` directly would therefore be correct or broken depending on whether _some other file_
in the same process had already called `sharedServicesModule()` — a correctness property that lives
in import order, which is exactly the class of bug that does not reproduce locally.

B4 does not catch this: `server/contracts` is not `server/db`, `server/events`, `server/audit`, or
`server/worker`, so the import would have passed every rule P1-13 shipped. B11 closes that gap and
makes §4.2's guarantee enforceable rather than conventional: the contract is implemented and
installed by a module, so a handler calls **that module's application service**, and the seam is
always already filled by the time the call happens.

The rule also protects the capability boundary. `sharedServicesModule().attachments` exposes
`rejectVersion`, `link`, `unlink`, `scanState`, and `authorizeUploadDetailed`; the frozen
`FileService` interface exposes three methods. A handler that reached for the contract would silently
lose the additional surface and would be tempted to reimplement it — which is how two code paths to
the same table appear.

### 5.3 B12 — why the domain layer may not hold a provider

B5 already bars `server/db` and `pg`, but a provider is a _different_ kind of I/O and would have
slipped past it: `modules/shared-services/provider/storage-provider.ts` is neither.

The hazard is concrete. `domain/storage-key.ts` and `provider/local-storage-provider.ts` are natural
neighbours — the adapter calls the domain's `assertKeyIsWellFormed()` — and it would be a small,
plausible step to have a domain helper "just check with the provider" whether a key exists. That step
would make a pure rule depend on network state, make it untestable without a fake, and put an
outbound call somewhere no reviewer expects one. The rule's message says what to do instead: _pass
the result in as an argument_.

Same principle, same direction as every other layering rule here: decisions flow down into the
domain as values; I/O stays in the layers that are allowed to be slow and allowed to fail.

## 6. Two archetypes: the request runtime and the worker

The module spans both process archetypes, and the split is a security boundary, not an organisational
one.

|               | Request runtime                                                       | Worker                                                                                                            |
| ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Database role | `app_runtime`                                                         | `app_worker`                                                                                                      |
| Handle        | `DbHandle` carrying a `RequestContext`                                | [`WorkerDb`](../../../src/server/worker/worker-db.ts) — a bare query surface with **no context by design**        |
| Tenant        | Transaction-local, from the session; RLS predicates narrow every read | Read _from each row_; `app_worker` policies are `USING (true)` because a dispatcher must see every tenant's queue |
| Base class    | `ApplicationService` / `Repository`                                   | Neither — `MessageDispatcher` and `MessageDispatchRepository` take `WorkerDb` and hold no context guard           |
| Pool          | Web-tier pool                                                         | Separate pool, sized by the worker's own concurrency                                                              |

### 6.1 Why the dispatcher is a separate role

The privilege surface makes the answer structural rather than stylistic:

| Relation                   | `app_runtime` may                                                                                   | `app_worker` may                            |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `shared.outbound_messages` | SELECT · INSERT (policy pins `status = 'pending'` and requires `shared.notification.send` in scope) | SELECT · UPDATE (`status`, `failure_class`) |
| `shared.delivery_attempts` | **nothing**                                                                                         | SELECT · INSERT                             |
| `shared.template_versions` | SELECT · INSERT · restricted UPDATE                                                                 | **nothing at all**                          |

Read together, those three rows settle the whole design:

- **A request can ask, and cannot claim.** With no UPDATE on the message and no privilege at all on
  `delivery_attempts`, the request runtime physically cannot mark a message sent, forge an attempt,
  or record a delivery. Enqueue-first is therefore not a convention that a hurried change could
  bypass — the grant is missing.
- **The worker cannot render.** `app_worker` holds nothing on `shared.template_versions`, and
  `outbound_messages` stores no body (`body_sha256` is documented in the schema as the integrity
  digest of content that is _not_ persisted there). So content is rendered once, at enqueue, from an
  approved immutable version; the digest is stored; the content is handed to the dispatcher in
  process, and the dispatcher recomputes the digest and refuses a mismatch before contacting a
  provider. That is what makes the stored digest load-bearing rather than decorative.
- **No provider call happens inside a business transaction.** A network round trip inside the source
  transaction would hold a database transaction open across a third party's latency and make the
  business write's durability depend on that third party's availability.

There is a real cost, and it is recorded rather than hidden: **because no durable transient content
store is provisioned, rendered content lost from process memory cannot be reproduced by another
process.** The durable row still proves the message was requested and carries its digest and full
lifecycle, but cross-process redelivery of _content_ is not implemented and is not claimed.

### 6.2 What is wired, and what is not

`MessageDispatcher` is constructed by the module composition and reachable as
`sharedServicesModule().dispatcher`. The worker **process entrypoint**
([`src/server/worker/entrypoint.ts`](../../../src/server/worker/entrypoint.ts)) starts the P1-13
`OutboxWorker` and nothing else; no scheduled loop in `src/server/worker/` currently drives message
dispatch, and no scheduler, supervisor, container spec, or alert route is provisioned for one
(ADR-012 — only Local exists). The dispatcher is a composed, callable worker-archetype component;
describing it as a running delivery pipeline would be describing infrastructure that does not exist.

## 7. Deviations from the P1-15 planning text

The [binding implementation decisions](phase-1-15-implementation-decisions.md) record every conflict
between the planning instructions and an already-frozen contract. Two of them are _architectural_ —
they change what the API surface is — and belong here.

### 7.1 No colon paths: `POST /api/v1/numbers:allocate` is not implementable

The operation registry states the path grammar as a grammar, not as an alphabet:

```ts
const PATH_PATTERN = /^(?:\/(?:[a-z0-9-]+|\{[a-z][a-zA-Z0-9]*\}))+$/;
```

Each segment is either a lower-case literal or a `{camelCase}` parameter. A colon is in neither
alternative, so `defineOperation()` throws at **module load** for a path containing one — the failure
is a build failure, not a 404. The planning label was written in a Google-style custom-method
convention that this platform's API conventions do not use, and changing the grammar to admit it
would mean two spellings for the same idea across the whole surface.

### 7.2 No standalone number endpoint, for a reason that outlives the path grammar

Even with a legal path, a standalone allocation endpoint would be the wrong contract.
[The Number Sequence and Display Number Standard](../../database/number-sequence-standard.md) binds
allocation to _the same transaction as the business write that consumes the number_, and
`shared.next_display_number()` takes **no tenant parameter** — the tenant comes only from
`iam.current_tenant_id()`, which the transaction-local context set.

A separate endpoint would commit a counter advance that no business row consumes. The result is a
permanent gap in a sequence whose entire purpose is to be gapless on issued documents, produced by an
endpoint that _appears_ to promise gaplessness — the worst combination, because the number looks
authoritative when a customer asks about it later.

So the contract is an in-process application service that accepts an already-open handle:

```ts
await withTransaction(context, async (db) => {
  const number = await sharedServices().numbers.allocate(db, { sequenceCode: 'invoice' });
  await invoices.insert(db, { ...input, invoiceNumber: number.displayNumber });
});
```

Rollback takes the allocation with it, because the counter advance and the business insert are the
same transaction. **Committed allocations are gapless**, and that guarantee is claimed only where it
holds. `isProvisioned()` exists beside it so a module can fail early rather than discover mid-work
that an operator has not provisioned the sequence — sequence rows are configuration, and
`app_runtime` holds no INSERT on `shared.number_sequences`.

### 7.3 Other planning conflicts, resolved elsewhere

Recorded in full in the [implementation decisions](phase-1-15-implementation-decisions.md), and named
here so this record is not read as the complete list: the VIN and phone normalizers mirror the frozen
SQL exactly rather than the stricter planned rules; `/api/health` is not modified and the P1-15
probes live at new `/api/v1/health/…` paths; audit actions are added to the controlled catalog before
use rather than invented at the call site; the transition engine drives module-owned histories
because `shared.status_history` is unwritable by every application role.

## 8. What this architecture deliberately does not provide

Stated plainly so that no reader infers a capability from the presence of a port.

| Not provided                                                         | Why, and what exists instead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A production object store                                            | None is provisioned. A port plus a deterministic `.invalid` local adapter; `unconfigured` is the default and refuses to sign                                                                                                                                                                                                                                                                                                                                                                                       |
| A production message-delivery provider                               | None is provisioned. A port plus an in-process adapter that delivers nothing; `unconfigured` refuses to deliver                                                                                                                                                                                                                                                                                                                                                                                                    |
| Malware scanning, and therefore document **acceptance**              | **No scanner is configured and none is claimed.** `shared.guard_document_version_transition()` accepts a version only with a `clean` row in `shared.file_scan_results`, and no application role may write that table ([DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md) withheld it deliberately). P1-15 delivers creation, upload authorization, pre-acceptance version lifecycle, linking, rejection, and download authorization for eligible states |
| Export file generation                                               | P1-15 authorizes exports and audits the decision; the response carries `generated: false` so no consumer can mistake an authorization for a download                                                                                                                                                                                                                                                                                                                                                               |
| A signed upload token or signed cursor                               | Both are unsigned base64url JSON and are documented as carrying convenience, never authority. Every field is re-derived or re-checked server-side under RLS. Signing would need key management across instances, which is not provisioned                                                                                                                                                                                                                                                                          |
| A generic writable workflow store or client-defined transition graph | Transitions are registered in code; a request cannot name a state nobody reviewed                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Monitoring, alerting, SLOs, throughput or failover characteristics   | None is provisioned. Metrics are emitted as keys in the existing `METRICS` object; no collector, dashboard, or alert route exists                                                                                                                                                                                                                                                                                                                                                                                  |

## 9. Related records

| Document                                                                                                      | Why it matters here                                                              |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Binding implementation decisions](phase-1-15-implementation-decisions.md)                                    | Every planning-versus-frozen-contract conflict and how it was resolved           |
| [Initial audit and contract inventory](phase-1-15-initial-audit.md)                                           | The protected state and executable contracts this module composes                |
| [Protected remediation verification](phase-1-15-remediation-verification.md)                                  | Proof that the capability boundary this module is written against actually holds |
| [DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md) | The runtime write capabilities granted, and the three deliberately withheld      |
| [Backend architecture and shared foundation](../../standards/backend-architecture-and-shared-foundation.md)   | The P1-13 conventions this module composes rather than reinvents                 |
| [P1-13 post-gate correction register](../phase-1-13/phase-1-13-post-gate-correction-register.md)              | ADV-01, the reason every boundary rule judges a canonical path                   |
| [Owner gate](phase-1-15-owner-gate.md)                                                                        | **Pending.** The open decision this record feeds                                 |
