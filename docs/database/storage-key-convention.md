# Storage-Key Convention

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding convention — Phase 1-5 deliverable ·
**Date:** 2026-07-18 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
technical self-review, not an independent review) ·
**Related:**
[Retention and Sensitive-Data Standard](./retention-and-sensitive-data-standard.md) ·
[RLS Standard](./rls-standard.md) ·
[Document Access and File Security](../phase-1/phase-1-5/document-access-and-file-security.md)

---

## 1. Purpose and scope

`shared.document_versions.storage_key` (migration `20260718101000`) is the
handle under which a document version's bytes will live in object storage. **No
object store exists in Phase 1-5** — the database stores metadata only. This
convention binds the later backend phase that first writes versions: it fixes
the key **shape** now so no earlier design produces keys the platform cannot
govern.

## 2. What the database enforces today

From `ck_document_versions_storage_key_format` in `20260718101000`:

```sql
CONSTRAINT ck_document_versions_storage_key_format
  CHECK (
    storage_key ~ '^[A-Za-z0-9][A-Za-z0-9._/=-]*$'
    AND char_length(storage_key) BETWEEN 8 AND 512
  )
```

- **Charset:** letters, digits, `.` `_` `/` `=` `-`; must start alphanumeric.
  No whitespace, no `@` — a space-bearing name or an email address is
  structurally invalid (rejected `23514`, proven in
  `tests/db/shared-document-versions.test.ts`).
- **Length:** 8–512 characters.
- **Immutability:** `storage_key` is frozen by
  `tg_document_versions_immutable`; re-pointing an existing version fails
  `23514` (proven). Replacement content is a **new version row**, never an
  edit.

The CHECK is deliberately a charset/length floor: the database cannot verify
which environment or tenant a key encodes, and a digit-only business value
would pass the charset. The shape (§3) and content prohibitions (§4) are
therefore binding review/backend rules, not claims of database enforcement.

## 3. The shape — opaque, structured, environment-separated

```
<environment>/<tenant_id>/<document_id>/<version_segment>
```

| Segment             | Content                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<environment>`     | The environment that owns the bytes (e.g. `local`, `staging`, `production` — final tokens are fixed when environments are provisioned). First segment, always. |
| `<tenant_id>`       | The owning tenant's UUID — and nothing else about the tenant.                                                                                                  |
| `<document_id>`     | The `shared.documents` UUID.                                                                                                                                   |
| `<version_segment>` | The version identity, e.g. `v<version_number>` or the version UUID.                                                                                            |

Synthetic example (all identifiers synthetic):

```
local/f0000000-0000-4000-8000-00000000000a/f1000000-0000-4000-8000-00000000000b/v3
```

Why this shape:

- **Environment-separated:** a key states which environment it belongs to, so a
  key can never be mistaken across environments during controlled promotion.
- **Structured but opaque:** every segment is a UUID, a version marker, or an
  environment token. A key is a _locator_, never a description of its content.
- **Tenant-prefixed:** storage-side listing and disposition can operate
  per-tenant without opening any object.

## 4. Prohibited content

A storage key must **never** contain, in any encoding:

- an email address, phone number, or personal name;
- a VIN or vehicle registration number;
- any customer-, vehicle-, or business-descriptive value;
- any secret, token, or credential material.

Rationale: keys travel further than row data — logs, storage inventories,
replication tooling, and backup listings all see keys outside RLS. A key
carrying business data would leak it through every one of those channels. The
charset CHECK blocks emails and space-bearing names structurally; digit-only
values (phones, registration numbers) are excluded by this convention and
checked at review and in the backend write path.

## 5. Metadata, never authorization

Possessing a storage key grants **no access**. Reads of version rows are
decided by FORCE-RLS tenant policies, and document reachability by the
link-derived access contract
([document access and file security](../phase-1/phase-1-5/document-access-and-file-security.md)).
`sha256` alongside the key is an integrity value, not an access token. When
object storage arrives, the backend must apply the same rule there: bytes are
served only after the database-side authorization decision, never because a
caller presented a key.

## 6. Current state — honest record

| Item                                 | State on 2026-07-18                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| Charset + length CHECK, immutability | Enforced and test-proven (`tests/db/shared-document-versions.test.ts`)                  |
| Key shape (§3), prohibitions (§4)    | Binding convention — no writer exists yet; enforced at review and by the future backend |
| Object storage / upload path         | Not built — later backend/infra scope                                                   |
| Environment tokens                   | Not final — fixed when environments are provisioned                                     |
