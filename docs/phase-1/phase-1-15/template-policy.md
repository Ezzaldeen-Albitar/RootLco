# Phase 1-15 — Message Template Policy

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Owner gate:** **Pending** — this document records design and behaviour, not a gate decision. ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent review, independent QA, or a third-party audit.**

**Related:** [Notification architecture](./notification-architecture.md) ·
[Binding implementation decisions](./phase-1-15-implementation-decisions.md) ·
[P1-15 owner gate](./phase-1-15-owner-gate.md) ·
[DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md) ·
[Notification data contract (P1-5)](../phase-1-5/notification-data-contract.md) ·
[Shared services RLS policy matrix (P1-5)](../phase-1-5/shared-services-rls-policy-matrix.md)

---

## 1. What a template is, in this platform

A message template is **organization configuration that produces customer-facing text**. Both halves
of that sentence drive the design. Because it is configuration, it is administered under the
organization's own permission and audited as a privileged change. Because it produces customer-facing
text, its approved form is immutable, its renderer executes nothing, and its variables are treated as
untrusted input.

A template (`shared.message_templates`) carries identity — code, channel, purpose, locale — and points
at an active version. A version (`shared.template_versions`) carries content — an optional subject, a
body, and a deterministic content hash. Messages are sent from a **version**, never from a template
and never from a string assembled at a call site; that constraint was frozen into the P1-13
`NotificationService` contract and is enforced again by the database at enqueue time.

## 2. The dual-scope model

Every template has a `scope`:

| Scope      | `tenant_id` | Who may create it                      | What a tenant may do with it              |
| ---------- | ----------- | -------------------------------------- | ----------------------------------------- |
| `platform` | `NULL`      | not through this API                   | **read and use only**                     |
| `tenant`   | the tenant  | the tenant, with `org.settings.manage` | create, revise, approve, retire, activate |

Resolution is deliberate rather than incidental. `TemplateRepository.findTemplateByCode()` selects
over both scopes and orders `scope = 'tenant' DESC` before `LIMIT 1`, so a tenant override wins over
the platform default. Without that ordering, which row you got would depend on physical row order —
which is precisely the kind of behaviour that works for a year and then changes after a vacuum.

Identity is kept unique per scope by two partial unique indexes:
`uq_message_templates_platform_identity` on `(template_code, channel, locale_code)` for platform rows
and `uq_message_templates_tenant_identity` on `(tenant_id, template_code, channel, locale_code)` for
tenant rows, both restricted to live rows (`deleted_at IS NULL`). A duplicate is reported as
`ERR-RES-002` rather than as a raw unique violation.

### Platform templates are read-only for a tenant from every direction

This is enforced three times over, and each layer would hold on its own:

1. **Row-level security.** `ins_message_templates_tenant` pins `scope = 'tenant'`,
   `tenant_id = iam.current_tenant_id()`, `created_by = iam.current_user_id()` and
   `iam.has_permission('org.settings.manage')` in its `WITH CHECK`.
   `upd_message_templates_tenant` carries the same predicate in **both** `USING` and `WITH CHECK`, so
   a platform row is neither visible to the update nor acceptable as its result. The version policies
   mirror this with `tenant_id IS NOT NULL AND tenant_id = iam.current_tenant_id()`.
2. **The application refuses first.** `requireTenantTemplate()` and `requireTenantVersion()` in
   [`template-service.ts`](../../../src/modules/shared-services/application/template-service.ts) raise
   `ERR-IAM-001` with an explanation — "Platform templates are read-only for a tenant" — rather than
   letting the caller receive a successful response that changed zero rows. A zero-row UPDATE that
   reports success is the worst possible outcome here.
3. **The grant surface.** Column privileges limit what may be written at all, independently of who is
   asking.

One policy deserves explanation because it looks like a hole and is not.
`lck_template_versions_reference` is an UPDATE policy with `USING (tenant_id IS NULL OR tenant_id = iam.current_tenant_id())`
and **`WITH CHECK (false)`**. It exists solely so that a _locking read_ of a platform version is
possible: `shared.guard_outbound_message_scope()` takes `FOR SHARE` on the chosen version during
enqueue, and under row-level security a locking read requires an UPDATE policy even though it writes
nothing. `WITH CHECK (false)` means no row can ever be the result of an update through it.

## 3. Lifecycle: `draft → approved → retired`

`shared.guard_template_version_lifecycle()` is the authority, and the application composes it rather
than reimplementing it.

**On INSERT** a version must be an unstamped `draft`: `status = 'draft'`, and `approved_at`,
`approved_by` and `retired_at` all null. There is no way to create a version that is already
approved.

**On UPDATE** exactly three transitions are accepted:

| From       | To         | What the guard does                                                                                                                              |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `draft`    | `draft`    | permits content revision                                                                                                                         |
| `draft`    | `approved` | **requires** `approved_by`; stamps `approved_at`; clears `retired_at`                                                                            |
| `approved` | `retired`  | **refuses** if any template still points at this version as `active_version_id`; stamps `retired_at` and preserves `approved_at` / `approved_by` |

Everything else raises `invalid template version transition: X to Y`. In particular there is no path
back from `approved` to `draft`, and none from `retired` to anything.

### Approved content is immutable, structurally

The guard's second rule is the important one: once `OLD.status` is anything other than `draft`, a
statement that changes `tenant_id`, `template_id`, `version_number`, `subject`, `body` or
`content_hash` is refused with _"approved or retired template-version content is immutable"_. So an
approved version is a fixed artefact. That is what makes it safe for
[the notification path](./notification-architecture.md) to record only a template version id and a
digest: the version the message was rendered from cannot subsequently be edited into something else.

`approved_by` is written from the session context and never from the request body. Letting a caller
name the approver would make the approval record unfalsifiable in the wrong direction — anyone able
to approve could attribute the approval to someone else. `approved_at` is stamped by the guard, not
by the application.

Activation is guarded separately. `shared.guard_template_active_version()` refuses a non-null
`active_version_id` on INSERT at all, and on UPDATE re-reads the target version `FOR UPDATE` and
refuses anything that is not `approved`. Taking the version row's lock first also fixes a global lock
order, which is what keeps activation and retirement from deadlocking against each other. The service
translates the resulting `check_violation` into `ERR-TRN-001` with a sentence a human can act on
("Only an approved version may be made active", "The active version of a template cannot be
retired").

Concurrency on every one of these operations is optimistic: the caller supplies the `record_version`
it read, the UPDATE carries `record_version = $expected`, and a mismatch is reported through
`assertVersionMatched()`. `record_version` is not in any UPDATE grant and does not need to be —
`shared.touch_row_metadata()` advances it in a BEFORE trigger, and column privileges are checked
against the statement's SET list, not against what a trigger writes.

## 4. The renderer executes nothing

A template engine is a code-execution surface unless it is deliberately made not to be.
[`template-rendering.ts`](../../../src/modules/shared-services/domain/template-rendering.ts) is made
not to be **by omission rather than by filtering**, which is the distinction that matters: there is
no denylist to get wrong.

| Property                    | What exists                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| Syntax                      | `{{name}}` and nothing else. Names match `^[a-zA-Z][a-zA-Z0-9_]{0,63}$` — no dots, no indexing |
| Expressions                 | none                                                                                           |
| Conditionals and loops      | none                                                                                           |
| Partials, includes, layouts | none                                                                                           |
| Helpers and filters         | none                                                                                           |
| Filesystem access           | none — nothing is read from disk                                                               |
| Dynamic import              | none — no module is loaded at render time                                                      |
| Substitution                | **a single pass** over the template                                                            |

The single pass is a security property, not an optimisation. Values are prepared **once, before**
substitution begins, so the substitution pass itself performs no transformation that a value could
influence. A value that happens to contain `{{other}}` is inserted as text and is never re-scanned,
which is what stops a caller smuggling a placeholder through a variable — including a value that
names its own placeholder, which cannot recurse.

The same property gives determinism: for identical version content and identical variables the output
is byte-for-byte identical. That is what makes `shared.outbound_messages.body_sha256` a usable
integrity digest rather than decoration.

### Escaping is per part, and the body is not the untrusted part

The template body is authored by an administrator holding `org.settings.manage`. The **variables** are
the untrusted part — they carry customer names, vehicle descriptions and free text. So values are
escaped and the authored body is not; escaping the body would corrupt the markup its author
deliberately wrote.

| Part        | Applied to each variable value                                                                                                                                    | Applied to the authored text                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Body**    | control characters removed (tab, LF and CR survive); zero-width and bidirectional-override characters removed; then HTML-escaped: `&` `<` `>` `"` `'`             | nothing — left exactly as written                   |
| **Subject** | **all** control characters removed, including CR and LF; zero-width and bidirectional-override characters removed; whitespace collapsed to single spaces; trimmed | whitespace collapsed and trimmed after substitution |

A subject is treated as a **header, not as content**. CR and LF are removed outright rather than
escaped, because a subject line containing one splits the header no matter how it is quoted. A null
subject stays null.

Zero-width and bidirectional characters (`U+200B`–`U+200F`, `U+202A`–`U+202E`, `U+2066`–`U+2069`,
`U+FEFF`) are stripped from values in both parts. A bidirectional override inside a customer name
renders as a different string than it stores — which is how one recipient's name can be made to
display as another's.

## 5. Missing and unknown variables are both errors

`renderTemplate()` is strict in both directions, and each direction is refused for a different
reason:

- **A placeholder with no supplied value** is `missing_variable`, not an empty string. "Dear ," is a
  message that should never have been sent, and silently emitting it converts a caller bug into a
  customer-visible defect.
- **A supplied value the template does not use** is `unknown_variable`. This one is less obvious and
  matters more: it means the caller and the template disagree about the contract. Dropping the value
  silently is how a phone number ends up passed to a template that never displays it, and nobody
  notices for a year.

The checks run in a fixed order, so the first failure a caller sees is the most fundamental one:

`empty_body` → `invalid_variable_name` → `invalid_variable_value` (a non-string is refused rather
than coerced) → `missing_variable` → `unknown_variable` → substitution → `rendered_too_large`.

Every failure carries a stable machine `rule` and the **placeholder names** involved. Names are
template metadata the caller already knows, so returning them discloses nothing; **values are never
included**, in the error, in the log, or in the metric labels.

## 6. The rendered-size ceiling

`NOTIFICATION_MAX_RENDERED_CHARS` bounds `subject.length + body.length` **after** substitution.
Its default is 20,000 characters and configuration is itself bounded to 256–262,144, so the ceiling
cannot be configured away.

Measuring after rendering is the whole point: a modest template with one enormous variable value
produces an enormous message, and a limit applied to the template alone would not see it. The
overrun is reported as `rendered_too_large` with the actual size and the ceiling, which is
actionable without disclosing content.

The ceiling is also applied **before content can be stored**. `assertContentRenderable()` renders
every new or revised draft with a one-character probe value per placeholder — checking the _template_
rather than any caller's data — so a blank body or a body already over the ceiling is refused at
authoring time rather than discovered at send time. The probe render uses the `email` channel because
escaping behaviour is what is being exercised, not channel selection.

## 7. Authorization: `org.settings.manage`, reused deliberately

Every template operation declares the same permission:

| Operation                         | Method and path                                      | Audit action                       |
| --------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| `shared.template-create`          | `POST /message-templates`                            | `shared.template.created`          |
| `shared.template-update`          | `PATCH /message-templates/{templateId}`              | `shared.template.updated`          |
| `shared.template-version-create`  | `POST /message-templates/{templateId}/versions`      | `shared.template.version_created`  |
| `shared.template-version-revise`  | `PATCH /template-versions/{versionId}`               | `shared.template.version_created`  |
| `shared.template-version-approve` | `POST /template-versions/{versionId}/approval`       | `shared.template.version_approved` |
| `shared.template-version-retire`  | `POST /template-versions/{versionId}/retirement`     | `shared.template.version_retired`  |
| `shared.template-activation-set`  | `PUT /message-templates/{templateId}/active-version` | `shared.template.updated`          |
| `shared.template-version-preview` | `POST /template-versions/{versionId}/preview`        | — (renders, changes nothing)       |

**A new permission was not invented, and that is a decision rather than an omission.** Template
content _is_ organization configuration: the same administrator who configures the organization's
settings is the one who decides what the organization says to its customers. Splitting the two would
create a permission that nobody could sensibly grant separately, and every additional permission is
another row in the matrix that must be assigned correctly for the rest of the system to be secure.

The reuse has a second, structural benefit: `org.settings.manage` is exactly what the RLS
`WITH CHECK` clauses require. Operation-level authorization and database-level authorization therefore
agree **by construction rather than by coincidence**. A caller without the permission does not get a
partially applied change — they get zero rows or `42501`.

Approval carries a distinct audit class. `shared.template.version_approved` is registered as class
`approval` while the other template actions are `privileged`, because approving the content the
platform will send in the organization's name is a different kind of act from renaming a template.

## 8. Preview, and why it discloses nothing new

`previewVersion()` renders a version with caller-supplied sample variables and returns the result
without sending anything. It is available to a caller who already holds `org.settings.manage` and can
therefore read the template body directly — so it discloses nothing they could not already read. It
is also the only way an administrator can see what the escaping rules in §4 do to their markup
_before_ approving it, which is the difference between an escaping rule that is understood and one
that is discovered in a customer's inbox.

Preview accepts any version visible to the caller, including a platform version, because reading is
not the restricted direction; writing is.

## 9. The content hash

`templateContentHash()` is `SHA-256` over the canonical form `subject ?? '' + NUL + body` — the same
canonical form the notification path hashes into `body_sha256`. The NUL separator is not decorative:
without it, `{subject: 'ab', body: 'c'}` and `{subject: 'a', body: 'bc'}` would hash identically, and
the digest would stop distinguishing two genuinely different messages.

The hash is written on create and on every draft revision, and the lifecycle guard freezes it
alongside the content once the version leaves `draft`.

## 10. What is written, audited, and published

The runtime's write surface on these two tables, verified against the live catalogue:

| Relation                   | `app_runtime` may write                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `shared.message_templates` | INSERT on 12 columns · UPDATE on `active_version_id`, `deleted_at`, `description`, `name`, `status` |
| `shared.template_versions` | INSERT on 9 columns · UPDATE on `approved_by`, `body`, `content_hash`, `status`, `subject`          |

Nothing else is writable — not `approved_at`, not `retired_at`, not `record_version`. Note that
`active_version_id` appears in the INSERT grant while `guard_template_active_version()` refuses a
non-null value on INSERT; the grant permits the column, the guard decides the value, and the stricter
of the two wins.

Every change is audited with `previousValue` where a previous value exists, so the audit records the
transition rather than only the outcome. Template **content is never placed in an event**: the
`message-template.version.changed` envelope carries only which kind of change occurred and the
aggregate version, because an event travels further than the row it describes. Its `eventKey` is
`template.change:<templateId>:<change>:<aggregateVersion>`, and `shared.event_outbox` enforces key
uniqueness per tenant, so a retried command cannot publish the same change twice.

## 11. Claims this document does not make

- **The renderer's safety rests on omission, not on scanning.** No sanitiser, filter, or content
  scanner is claimed, and none exists in this path.
- **No production message provider is provisioned**, so no template has been rendered to a real
  destination. See [notification architecture §9](./notification-architecture.md#9-the-provider-is-a-port-with-an-unconfigured-default).
- **No performance, throughput, or capacity claim is made** about rendering or template
  administration; nothing was measured.
- **No sample, demo, or business template content ships** with the platform. The tables start empty.
- **The P1-15 owner gate is Pending.** Nothing here records or implies a Go.

## 12. Where the behaviour is exercised

| Concern                                                                                          | Location                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Determinism, strict variable handling, per-part escaping, single-pass substitution, size ceiling | [`tests/foundation/p1-15-template-rendering.test.ts`](../../../tests/foundation/p1-15-template-rendering.test.ts)                                             |
| Template usability at enqueue — approval, tenant, channel and locale agreement                   | [`tests/foundation/p1-15-notification-policy.test.ts`](../../../tests/foundation/p1-15-notification-policy.test.ts)                                           |
| Schema-level template behaviour                                                                  | [`tests/db/shared-message-templates.test.ts`](../../../tests/db/shared-message-templates.test.ts)                                                             |
| Role capability surface against the live database                                                | [`tests/db/p1-15-shared-services-runtime-capabilities.test.ts`](../../../tests/db/p1-15-shared-services-runtime-capabilities.test.ts)                         |
| The capability grant itself                                                                      | [`20260728090000_shared_services_runtime_write_capabilities.sql`](../../../supabase/migrations/20260728090000_shared_services_runtime_write_capabilities.sql) |
