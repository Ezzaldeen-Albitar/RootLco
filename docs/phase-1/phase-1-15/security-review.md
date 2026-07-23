# Phase 1-15 — Security and adversarial review

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. Scope and method

This review covers the P1-15 shared-services backend: numbering, audit and event emission, status
transitions, attachments and signed URLs, notifications and templates, normalization, query
primitives, export authorization, and the health endpoints.

Three things count as evidence here and nothing else does:

1. a committed test that executes the behaviour, on the **real non-owner database role** where the
   claim is about a database boundary;
2. a direct reading of the source, quoted;
3. a live catalog query whose output is recorded.

Agreement between reviewers is not evidence. Neither is a passing test that never invoked the code
it claims to cover — which is why the strict operation-coverage gate re-checks that every
registered operation is genuinely referenced outside its own declaration block.

## 2. Corrected readings

Two conclusions from earlier in this phase were wrong and were corrected by execution rather than
by argument. Both are recorded because a review that only lists confirmed findings hides its own
error rate.

### 2.1 The numbering "blocker" that was not one

`information_schema.role_table_grants` shows **no UPDATE** for `app_runtime` on
`shared.number_sequences`, while an `UPDATE` policy (`upd_number_sequences_tenant`) exists. Read
together those say "policy present, grant absent" — an unreachable policy, and a blocker for the
mandatory number-allocation capability.

That reading was wrong. `app_runtime` holds a **column-scoped** grant:

```
next_value      -> app_runtime=w/postgres
current_period  -> app_runtime=w/postgres
```

`has_table_privilege(..., 'UPDATE')` returns `false` for a table whose only UPDATE grant is
column-level, which is the trap. Executing `shared.next_display_number('probe_seq')` as
`rootlco_test_runtime` — the real login, non-superuser, `NOBYPASSRLS` — **succeeded**, and so did
the underlying `SELECT … FOR UPDATE` and the two-column `UPDATE`.

No change request was needed and none was raised. The lesson is recorded in
[the number-allocation record](number-allocation-service.md): privilege claims are proven by
executing the operation as the role, never by reading one catalog view.

### 2.2 What the earlier remediation got right

`P1-15-R-001` — the missing UPDATE policy that made platform template versions unlockable, and
therefore made enqueue impossible — was found and fixed **inside the unmerged migration**, before
it reached protected history. It is now `lck_template_versions_reference` with `WITH CHECK (false)`,
and the regression is pinned by a test that enqueues from a **platform** template version.

## 3. Threat review

Each row states the attack, the control that stops it, and where the control is proven. A row whose
control is "not implemented" says so.

### 3.1 Number allocation

| Attack                                              | Control                                                                                                                                              | Proof                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Allocate from another tenant's sequence             | Tenant comes from `iam.current_tenant_id()`, never a parameter; RLS `sel_number_sequences_tenant`                                                    | `tests/db/p1-15-number-allocation.test.ts`                                       |
| Choose the prefix, pad width, or counter            | None of the three is an input; they live on the row, which the runtime cannot INSERT                                                                 | Column-grant inspection + INSERT refusal test                                    |
| Allocate outside the session's company/branch scope | The function raises `insufficient_privilege` against `iam.allowed_company_ids()` / `allowed_branch_ids()`                                            | Same file                                                                        |
| Rewind a counter to re-issue an issued number       | `guard_number_sequence_regression()` refuses a decrease without a legitimate period change; the `never`-rule CHECK closes the invented-period bypass | Same file                                                                        |
| Duplicate allocation under concurrency              | `SELECT … FOR UPDATE` inside the function serialises allocators                                                                                      | Same file                                                                        |
| Silent gap presented as gaplessness                 | No standalone allocation endpoint exists; allocation joins the consuming transaction                                                                 | Registry has no such operation; recorded in §2.6 of the implementation decisions |

### 3.2 Attachments and signed URLs

| Attack                                    | Control                                                                                                                                                                                   | Proof                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| IDOR / cross-tenant document read         | Every read is under RLS on the caller's connection with an explicit tenant predicate; not-found and out-of-scope are indistinguishable                                                    | `tests/backend/p1-15-attachments-notifications.test.ts` |
| Caller-chosen storage key, path traversal | The key is **built** from environment + session tenant + generated ids; `assertKeyIsWellFormed` rejects `..`, empty segments, and non-UUID segments; the adapter re-checks before signing | `tests/foundation/p1-15-storage-key.test.ts`            |
| Forged upload token                       | Every field is re-derived or re-checked at registration; the document is re-loaded under RLS; the key is rebuilt, not read from the token                                                 | Backend suite                                           |
| Replay of an upload authorization         | The version id is fixed in the token; a second registration hits `pk_document_versions` and is reported as a conflict                                                                     | Backend suite                                           |
| Cross-tenant key collision                | The tenant segment is the session's, so two tenants cannot address the same key                                                                                                           | `keyBelongsToTenant` proof                              |
| Permanent or over-long URL                | TTL is required, bounded by configuration and again by `ABSOLUTE_MAX_URL_TTL_SECONDS`; there is no way to express "no expiry"                                                             | `tests/foundation/p1-15-signed-urls.test.ts`            |
| Download URL replayed as an upload        | The HTTP method is inside the signature                                                                                                                                                   | Same file                                               |
| Signed URL leaking through logs           | No log line carries a URL, key, or dedupe key as a value; the issuance log carries purpose, TTL, and adapter name                                                                         | Source inspection + observability test                  |
| `Content-Disposition` injection           | CR/LF stripped, `"` `;` `\` `,` stripped, last path segment only, bounded length                                                                                                          | Storage-key unit suite                                  |
| MIME spoofing                             | The declared type is bounded by the category allow-list. **Byte-level type verification is not implemented and is not claimed** — it needs the same missing component as scanning         | Recorded limitation                                     |
| Fabricated malware verdict                | **No application role may write `shared.file_scan_results`**; acceptance requires a `clean` row, so no code path can accept a version                                                     | `tests/db/p1-15-attachments.test.ts`                    |
| Download of unscanned content             | Only `accepted` versions sign; every other state is `ERR-DOC-001`                                                                                                                         | Backend suite                                           |

### 3.3 Notifications and templates

| Attack                                             | Control                                                                                                                                                                                  | Proof                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Arbitrary destination / recipient header injection | `recipientRef` must be a UUID; an address cannot pass validation, and no address is ever stored                                                                                          | `tests/foundation/p1-15-notification-policy.test.ts` |
| Recipient enumeration from the ledger              | Non-user recipients are stored only as a **tenant-salted** SHA-256 digest, so the same person in two tenants produces two digests                                                        | Same file                                            |
| Consent bypass                                     | `consentEvaluation` is required by the frozen type and re-checked for grant **and freshness**; a stale or future-dated evaluation is refused                                             | Same file                                            |
| Duplicate delivery under replay                    | `uq_outbound_messages_dedupe` refereed at the database; the service reports `deduplicated` rather than inserting again                                                                   | `tests/db/p1-15-notifications.test.ts`               |
| Sending from unapproved or foreign content         | `guard_outbound_message_scope()` requires an approved version and a platform-or-same-tenant one                                                                                          | Same file                                            |
| Runtime forging a delivery or a delivered status   | `app_runtime` holds **nothing** on `shared.delivery_attempts` and no UPDATE on `outbound_messages`                                                                                       | Same file                                            |
| Forged lifecycle timestamps or retry count         | `guard_outbound_message_lifecycle()` assigns every timestamp and refuses a statement that sets one; `retry_count` moves only on `failed → queued`                                        | Same file                                            |
| Template injection / code execution                | The renderer has no expressions, conditionals, loops, includes, helpers, filesystem access, or dynamic import; substitution is single-pass so a value cannot introduce a placeholder     | `tests/foundation/p1-15-template-rendering.test.ts`  |
| HTML/script injection through a variable           | Values are escaped; the authored body is not (escaping it would corrupt the author's markup)                                                                                             | Same file                                            |
| Subject header injection                           | CR/LF removed from subject values, subject collapsed to one line                                                                                                                         | Same file                                            |
| Secrets smuggled into variables                    | Variables are typed `Record<string, string>` and rendered into content that is never persisted; the audit records the dedupe key and recipient as `restricted`, which the database masks | Source + backend suite                               |
| Platform template mutated by a tenant              | INSERT/UPDATE policies pin `scope = 'tenant'`; the service refuses before reaching the database                                                                                          | Backend suite                                        |
| Retry storm / unbounded delivery                   | Retries are bounded by `OUTBOX_MAX_ATTEMPTS`; exhaustion dead-letters to `cancelled` with a failure class, and nothing is deleted                                                        | `tests/backend/p1-15-dispatch-and-health.test.ts`    |
| Delivering content that is not what was approved   | The dispatcher recomputes SHA-256 and compares with `body_sha256` before contacting the provider                                                                                         | Same file                                            |

### 3.4 Transitions, events, and audit

| Attack                                                    | Control                                                                                                                                                       | Proof                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Client-defined workflow / skipped state                   | Transitions are a frozen registry; `from` is an explicit list and the current state must be in it                                                             | `tests/db/p1-15-transitions.test.ts`, backend suite |
| Forged actor or time in history                           | `org.stamp_branch_history()` overwrites `actor_id` and `occurred_at` from the session                                                                         | DB suite                                            |
| Writing a generic, unguarded history                      | `shared.status_history` / `shared.status_evidence` remain unwritable by every application role                                                                | DB suite                                            |
| Stale-version overwrite / lost update                     | Every state change carries a `record_version` predicate; zero rows is a conflict                                                                              | Backend suite                                       |
| Uncataloged audit action                                  | `defineOperation()` rejects one at module load; `check-authorization-coverage.mjs` re-checks by reading the source, so a route no test imports still fails CI | Gate output                                         |
| Audit record without its state change, or vice versa      | Both are in one transaction                                                                                                                                   | Rollback tests                                      |
| Unregistered or mis-owned event                           | `buildEventEnvelope()` rejects an unregistered type and a producer whose module is not the catalog owner                                                      | Catalog suite                                       |
| Event published without its source transaction committing | The outbox row is written in the same transaction; `event_key` is unique per tenant                                                                           | Backend suite                                       |
| Sensitive payload in an event                             | No event payload carries a recipient, content, reason, key, or free text                                                                                      | Source inspection                                   |

### 3.5 Query primitives, export, and health

| Attack                                             | Control                                                                                                                                           | Proof                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| SQL injection through a filter                     | Field names come from a code-constant contract; values are always bound                                                                           | `tests/foundation/p1-15-query-primitives.test.ts`          |
| Wildcard abuse / unbounded scan                    | `prefix` escapes `%`, `_`, `\` and uses `ESCAPE`; there is no regex operator and no raw JSON path                                                 | Same file                                                  |
| Unbounded filter or `in` list                      | `MAX_FILTERS`, `MAX_IN_VALUES`, and a per-value length bound                                                                                      | Same file                                                  |
| Cursor tampering to read another tenant            | The cursor decides nothing: the page still runs under RLS. The fingerprint binds it to filters, sort, and tenant, so a reused cursor fails closed | Same file                                                  |
| Sensitive-field read oracle through filtering      | Filtering a sensitive field requires `iam.sensitive.view`                                                                                         | Same file                                                  |
| Export-all / cross-tenant aggregation              | Resource and field allow-lists; the estimate runs under RLS; the row ceiling is bounded                                                           | `tests/backend/p1-15-templates-transitions-export.test.ts` |
| Sensitive columns exported by omission             | An empty field request returns only what the caller may read                                                                                      | Export unit suite                                          |
| Locators exported                                  | `storage_key`, `sha256`, `body_sha256`, `recipient_digest` and everything in `file_scan_results` are absent from every registry entry             | Same file                                                  |
| Topology or credential disclosure from health      | Liveness performs no I/O; readiness returns names and booleans only, and the database role name is dropped                                        | `tests/backend/p1-15-dispatch-and-health.test.ts`          |
| Health probe used as a denial-of-service amplifier | Readiness is bounded by `READINESS_TIMEOUT_MS` and rate-limited; liveness touches nothing                                                         | Source + declaration                                       |

## 4. What this review does not cover, and does not claim

- **No dependency-vulnerability scanning is claimed.** No approved executable control runs one in
  this phase, so nothing here says the dependency tree is clean.
- **No penetration test was performed.** The probes above are unit, integration, and database tests
  written by the same engineer who wrote the code, under the Solo Developer Review Policy.
- **No production environment was exercised.** Every observation is from a development machine and
  from hosted CI.
- **No malware scanning exists.** This is stated once more here because it is the most likely claim
  for a reader to assume: acceptance of a document version is _unavailable_, not merely unused.
- **No byte-level content-type verification exists.** A declared content type is bounded by an
  allow-list and is not verified against the bytes.
- **No homoglyph or confusable detection exists** in search normalization.

## 5. Finding disposition

| ID                                                                                       | Severity     | Status                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| P1-15-R-001 — platform template versions unlockable under RLS, making enqueue impossible | High         | **Resolved** before merge, in migration 117; regression pinned by a platform-template enqueue test |
| P1-15-SR-001 — the numbering privilege reading (§2.1)                                    | Not a defect | **Withdrawn** after executable disproof; recorded so the method is auditable                       |

No unresolved Critical finding. No unresolved High finding. Medium and Low findings, if any survive
the final adversarial pass, are listed in [the risk register](risk-register.md) with an explicit
disposition rather than being closed silently.

The Phase 1-15 owner gate remains **Pending**.
