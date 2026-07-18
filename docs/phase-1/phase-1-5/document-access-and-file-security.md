# Phase 1-5 — Document Access and File Security

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-5 · **Date:** 2026-07-18 ·
**Author:** Eng. Ezzaldeen Al-Bitar

## 1. Scope

The security posture of the document foundation built in Increments A–C and
corrected in Increment L: `shared.document_categories`, `shared.documents`
(migration `20260718100000`), `shared.document_versions`,
`shared.file_scan_results` (`20260718101000`), `shared.document_links` and the
resolution primitive `shared.document_ids_for_entity` (`20260718102000`), and
the fix-forward guards of `20260718111000`. **Metadata only** — no file byte is
stored anywhere in the database; object storage, uploads, signed URLs, and the
scanning worker are later backend/infra scope. Evidence lives in
`tests/db/shared-documents.test.ts` (16 tests),
`tests/db/shared-document-versions.test.ts` (14),
`tests/db/shared-document-links.test.ts` (9), and
`tests/db/shared-hardening.test.ts` (10).

## 2. `storage_key` is metadata, never authorization

`shared.document_versions.storage_key` is an **opaque, structured object-store
handle**. Possessing a `document_id`, `version_id`, `storage_key`, or `sha256`
grants **no access**: every read is decided by FORCE-RLS tenant policies
(`sel_documents_tenant`, `sel_document_versions_tenant`,
`sel_file_scan_results_tenant`) and, for domain reachability, by the
link-derived contract of §3. What the database enforces today:

- **Charset + length CHECK** (`ck_document_versions_storage_key_format`,
  migration `20260718101000`): `^[A-Za-z0-9][A-Za-z0-9._/=-]*$`, 8–512
  characters — no whitespace, no `@`. A malformed key is rejected with SQLSTATE
  `23514` (proven in `shared-document-versions.test.ts`).
- **Immutability**: `storage_key` (with the other content columns) is frozen by
  `tg_document_versions_immutable`; a re-point attempt fails `23514` (proven).
- **Tenant inertness**: a runtime session in another tenant resolves zero rows
  for the same version id, and runtime has no INSERT/UPDATE/DELETE grant at all
  (`42501`, proven).
- `sha256` (32-byte `bytea`, length-checked) is an **integrity** value, not an
  access token.

The full key shape (environment-separated tenant/document/version segments) and
the prohibited-content rules are the binding
[storage-key convention](../../database/storage-key-convention.md).

## 3. The link-derived access contract

A document is reachable through a **live link to an entity the principal may
see** — never by merely knowing an identifier. The contract has two parts:

- `shared.document_links`: tenant-scoped links with a composite
  `(tenant_id, document_id)` FK, so a **cross-tenant link is structurally
  impossible** (`23503`, proven). One active link per
  `(document, entity, purpose)`; soft delete permits re-linking.
- `shared.document_ids_for_entity(entity_type, entity_id)`: the resolution
  primitive later domain policies compose. It is **SECURITY INVOKER** with an
  empty `search_path`, so it runs under the caller's RLS: it returns nothing
  across tenants and nothing for a soft-deleted link.

Proven in `shared-document-links.test.ts` with **synthetic** entity types (no
domain table is created): resolution succeeds through a live link within the
tenant; the same call in another tenant returns zero rows; a soft-deleted link
yields no derived access; runtime cannot write links (`42501`). In this phase
the baseline read policy on `shared.documents` is strict tenant isolation;
classification-based permission gating of restricted documents is later domain
scope and is not claimed here.

## 4. Generic links — residual risk, per-domain validation, orphan review

`entity_type` is a constrained `schema.table` token (format CHECK, proven) and
`entity_id` a bare `uuid`: the target domains do not exist yet, so **no real FK
is possible**. The adversarial review (2026-07-18) refuted cross-tenant escape
through links and accepted two residuals, recorded here rather than hidden:

| Residual                                                                               | Severity | Disposition                                                                           |
| -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| A link may name a non-existent or wrong-domain `entity_id` (no FK until domains exist) | Medium   | Mitigated by the per-domain validation contract and the orphan-review procedure below |
| `document_links.linked_by` is a plain `uuid` (created before the attribution-FK rule)  | Low      | Accepted; normalised when the attribution rule is applied repo-wide                   |

### 4.1 Per-domain validation contract (binding on Phase 1-6+)

1. Links are created only by backend code of the owning domain — there is no
   runtime write grant (proven `42501`).
2. Before insert, the domain **must verify `entity_id` exists** in the named
   domain table **within the same tenant**.
3. `entity_type` must be the canonical `schema.table` of the validated table.
4. Deleting or archiving a domain entity must **soft-delete its links in the
   same transaction** — a soft-deleted link removes derived access (proven).
5. Domain read policies compose `shared.document_ids_for_entity` with their own
   entity-visibility rule; the resolver never widens access beyond RLS.

### 4.2 Orphan-review operational procedure (for later phases)

Today this procedure has **no live surface**: no `crm`/`veh` table exists
(proven by `shared-hardening.test.ts`). From the first domain phase onward:

1. Inventory active links (`deleted_at IS NULL`) grouped by `entity_type`; any
   token naming a table absent from the catalog is an immediate finding.
2. For each `entity_type` whose table exists, anti-join `entity_id` against
   that table within the tenant; unmatched rows are orphan candidates.
3. The owner reviews findings; disposition is an audited **soft delete** of the
   link — never a hard delete, never silent repair.
4. Cadence: at every domain-phase gate, and scheduled once the controlled
   disposition job exists.

## 5. Scan lifecycle

`shared.file_scan_results` is the append-only verdict history
(`pending | clean | infected | error`, provider-neutral `scanner_code`,
`threat_name` only on an infected verdict, `details` a sanitized JSON object).
The version lifecycle is one-way and gated by
`shared.guard_document_version_transition`:

```
pending ──► accepted     requires ≥1 clean scan AND no infected scan; stamps accepted_at
        ──► quarantined  stamps quarantined_at
        ──► rejected     stamps rejected_at
```

Terminal states are immutable. Proven in `shared-document-versions.test.ts`:
acceptance without a clean scan fails; acceptance with an infected scan on
record fails even when a clean scan also exists; acceptance stamps
`accepted_at`; an accepted version cannot be re-transitioned; quarantine stamps
its timestamp; scan rows cannot cross tenants (composite FK) and runtime cannot
write them. Actual scanning is a later worker operation — this phase stores and
gates the verdicts; it does not claim a scanner runs.

## 6. Increment L — initial-state and organization-scope guards (fix-forward)

Migrations `20260718100000`/`20260718101000` are merged history, so Increment L
(`20260718111000`) corrects them forward, as the adversarial review required:

- **Terminal-state INSERT bypass closed.** `shared.guard_document_initial_state`
  and `shared.guard_document_version_initial_state` force every new document /
  version to be inserted `pending` with all terminal timestamps NULL. A direct
  `archived` document insert and a direct `accepted` version insert (even with
  its stamp) are rejected `23514` (proven in `shared-hardening.test.ts`). The
  audited archival path (§ retention design) and the clean-scan gate are the
  only routes to terminal states.
- **Company/branch mismatch closed.** `fk_documents_branch` was replaced with
  the three-column shape `(tenant_id, company_id, branch_id) →
org.branches (tenant_id, company_id, id)` plus
  `ck_documents_branch_requires_company`, so a same-tenant branch of a
  different company is a FK violation (`23503`, proven).
- Non-partial FK-support indexes added (`ix_document_links_document`,
  `ix_legal_holds_document`, `ix_document_categories_tenant`,
  `ix_documents_org_scope`, `ix_number_sequences_org_scope`).

Both guards are SECURITY INVOKER, empty `search_path`, no PUBLIC EXECUTE —
posture proven suite-wide by the module-routine test in
`shared-hardening.test.ts`.

## 7. Honest boundaries

No object storage, upload path, signed-URL issuance, scanner, or byte handling
exists in this phase — the database stores and access-controls the metadata
shapes only. Runtime and readonly roles hold SELECT (plus resolver EXECUTE)
only; every write path is a later backend/platform operation. CI on the final
SHA is owner-verifiable; the Phase 1-5 PR is not opened, the owner gate is
Pending, and Phase 1-6 has not started. The adversarial review of 2026-07-18
closed with zero unresolved Critical/High findings for this surface.
