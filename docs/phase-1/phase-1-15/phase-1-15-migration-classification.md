# Phase 1-15 — Migration classification and rollback

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Change request:** [DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md) ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. The migration this phase adds

| Item                          | Value                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| Filename                      | `supabase/migrations/20260728090000_shared_services_runtime_write_capabilities.sql` |
| Ordinal                       | **117** (migrations 1–116 are unchanged and byte-identical to protected `develop`)  |
| Class                         | **Security / capability** — grants and RLS policies only                            |
| Rollback classification       | **ROLLBACK-SAFE** — no data is written, moved, or destroyed                         |
| Objects created               | none: no table, column, constraint, index, sequence, trigger, or function           |
| `SECURITY DEFINER` introduced | **0**                                                                               |

## 2. Exact content

**18 column-scoped `GRANT` statements** and **14 RLS policies**.

Request runtime (`app_runtime`):

| Relation                   | Command | Columns                                                                                                                                                              |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.documents`         | INSERT  | `id, tenant_id, company_id, branch_id, category_id, title, classification, retention_class, created_by`                                                              |
| `shared.document_versions` | INSERT  | `id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes, sha256, uploaded_by, created_by`                                                 |
| `shared.document_versions` | UPDATE  | `status`                                                                                                                                                             |
| `shared.document_links`    | INSERT  | `id, tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by`                                                                            |
| `shared.document_links`    | UPDATE  | `deleted_at`                                                                                                                                                         |
| `shared.outbound_messages` | INSERT  | `id, tenant_id, company_id, branch_id, template_version_id, channel, purpose, recipient_digest, recipient_user_id, body_sha256, dedupe_key, consent_ref, created_by` |
| `shared.message_templates` | INSERT  | `id, scope, tenant_id, template_code, name, channel, purpose, locale_code, description, active_version_id, status, created_by`                                       |
| `shared.message_templates` | UPDATE  | `name, description, active_version_id, status, deleted_at`                                                                                                           |
| `shared.template_versions` | INSERT  | `id, tenant_id, template_id, version_number, subject, body, content_hash, status, created_by`                                                                        |
| `shared.template_versions` | UPDATE  | `subject, body, content_hash, status, approved_by`                                                                                                                   |

Asynchronous worker (`app_worker`):

| Relation                   | Command                           | Columns                                                                                                                                                                 |
| -------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.outbound_messages` | SELECT / UPDATE                   | UPDATE limited to `status, failure_class`                                                                                                                               |
| `shared.delivery_attempts` | SELECT / INSERT                   | `id, tenant_id, message_id, attempt_number, provider_code, provider_message_ref, status, response_code, error_summary, details, attempted_at, completed_at, created_by` |
| `shared.search_metadata`   | SELECT / INSERT / UPDATE / DELETE | UPDATE limited to `normalized_value, classification, source_updated_at`                                                                                                 |

Policies added: `ins_documents_scoped`, `ins_document_versions_scoped`,
`upd_document_versions_reject`, `ins_document_links_scoped`, `upd_document_links_unlink`,
`ins_outbound_messages_enqueue`, `ins_message_templates_tenant`, `upd_message_templates_tenant`,
`ins_template_versions_tenant`, `upd_template_versions_tenant`, `lck_template_versions_reference`,
`wkr_outbound_messages_dispatch`, `wkr_delivery_attempts_all`, `wkr_search_metadata_all`.

`app_readonly` receives nothing. No `DELETE` is granted to `app_runtime` anywhere. No `TRUNCATE`,
`REFERENCES`, `TRIGGER`, or `GRANT ALL` is issued to any role, and no schema-level privilege is added.

## 3. Database catalogue — before and after

Measured from an empty rebuild through all migrations, on the module schemas
(`org, iam, shared, crm, veh, apt, rec, wo, dia, tech, qms, svc, quo, inv, sal, wty, rpt`).

| Metric             | Before (116) | After (117) | Delta   |
| ------------------ | ------------ | ----------- | ------- |
| Migrations         | 116          | **117**     | +1      |
| Tables             | 242          | **242**     | 0       |
| Functions          | 212          | **212**     | 0       |
| Policies           | 615          | **629**     | **+14** |
| Triggers           | 541          | **541**     | 0       |
| `SECURITY DEFINER` | 0            | **0**       | 0       |
| Permission codes   | 43           | **45**      | +2      |

The policy delta is exactly the fourteen policies listed above. Nothing else moved.

## 4. Rollback

The migration carries an explicit, executable rollback section at the end of the file: every added
`GRANT` has a matching `REVOKE` with the identical column list, and every added `CREATE POLICY` has a
matching `DROP POLICY`, written in reverse dependency order (policies first, then privileges). No
function, trigger, table, or column is created, so there is nothing else to reverse.

The permission-catalog addition is idempotent seed data
(`ON CONFLICT (permission_code) DO NOTHING`). Reversing it is a delete of the two codes
`shared.document.manage` and `shared.notification.send`; because no production role is granted them by
this change, removing them cannot orphan a live grant.

## 5. What this migration deliberately does NOT do

- It does not make `shared.status_history` or `shared.status_evidence` writable by any application
  role. Those tables cannot bind a transition to a business aggregate, and every module already owns a
  scope-bound, coherence-guarded history table.
- It does not grant any role the ability to write `shared.file_scan_results`. A `clean` verdict is the
  only positive evidence `shared.guard_document_version_transition` accepts, so a role able to write
  it could manufacture the evidence the guard exists to demand. **No malware scanning is implemented
  or claimed, and a document version therefore cannot reach `accepted` in this phase.**
- It does not change `shared.error_records` or `shared.processed_events`, whose existing
  `app_worker` contracts were already correct.
- It does not weaken any existing guard, trigger, constraint, or policy.
