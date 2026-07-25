# Phase 1-15 — Performance and Query Evidence

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Date:** 2026-07-23 ·
**Owner gate:** **Pending** ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit, benchmark, or capacity
certification.**

---

## 1. What this document is

Real execution plans, gathered on the local development database, for the access paths P1-15 puts on
a hot path. Every plan below is the verbatim output of `EXPLAIN (ANALYZE, BUFFERS)` executed against
the running container. Nothing is estimated, reconstructed, or copied from a previous phase.

It answers exactly one question: **does an index already serve each P1-15 access path, or does the
planner fall back to filtering?** It answers no question about capacity, throughput, or latency
under load, and [§6](#6-what-this-evidence-does-not-establish) says so unreservedly.

**No index was added, altered, or dropped.** Where a path is not fully index-served, this document
reports it and stops. Changing the index set is a database change with its own change request, and
Phase 1-15 is an application-layer phase.

## 2. Method

### 2.1 Environment

| Fact             | Value                                                                          |
| ---------------- | ------------------------------------------------------------------------------ |
| Server version   | `PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit` |
| Container        | `supabase_db_RootLco`                                                          |
| Invocation       | `docker exec supabase_db_RootLco psql -U postgres -d postgres -X -c "…"`       |
| Connected role   | `postgres` — `rolsuper = f`, `rolbypassrls = t`                                |
| Planner settings | Defaults. No `enable_*` flag was touched, no cost constant was adjusted.       |

### 2.2 Data, and why the database is still empty

Every P1-15 table was empty before this exercise and is empty after it. That is not incidental: the
[no-fake-data policy](./phase-1-15-implementation-decisions.md) means no business data ships, and an
`EXPLAIN` against an empty table tells you nothing — the planner picks a sequential scan over zero
pages regardless of what indexes exist.

So the plans were gathered like this:

1. `BEGIN`, then `SET LOCAL session_replication_role = replica` to suspend trigger and
   foreign-key enforcement for the load. **Check constraints, NOT NULL, and unique indexes remained
   in force**, so every generated row is structurally valid against the real schema.
2. Insert **generated, entirely synthetic, non-personal** rows: sequential integers, `gen_random_uuid()`,
   `sha256()` digests, and machine-shaped codes such as `br_1743`, `seq_3`, `tpl_17`, `dedupe-98765`.
   No name, address, email, phone, VIN, or any other real or realistic personal or business value
   appears anywhere in the fixture.
3. `ANALYZE` each table so the planner has genuine statistics rather than defaults.
4. Run `EXPLAIN (ANALYZE, BUFFERS)` on each access path.
5. `ROLLBACK`.

Because `ANALYZE` writes to `pg_statistic`, which is transactional, the rollback discards the
statistics along with the rows. Row counts were re-checked afterwards and every table read **0**
again, so the exercise left nothing behind.

| Relation                   | Generated rows |
| -------------------------- | -------------- |
| `org.branches`             | 2,000          |
| `shared.number_sequences`  | 8,160          |
| `shared.documents`         | 40,000         |
| `shared.document_versions` | 120,000        |
| `shared.outbound_messages` | 150,000        |
| `shared.message_templates` | 900            |

Four tenants share the data, so a tenant predicate is genuinely selective rather than trivially
matching everything — which matters, because a single-tenant fixture makes any tenant-leading index
look better than it is.

### 2.3 Three honest caveats about the measurements

- **RLS is not exercised.** `postgres` holds `rolbypassrls`, so no policy predicate was added to any
  plan. In the application, these statements run as `app_runtime` with the policy `USING` clause
  merged into the query, which the planner also sees and costs. The plans below are therefore the
  **index-selection** picture, not the complete production picture.
- **Timings are single cold executions** inside one transaction on a developer workstation. They are
  reported because omitting them from verbatim output would be editing the evidence, not because
  they measure anything. In particular the `Planning Time` values (9.396 ms on the first plan, 0.218 ms
  on a later one) reflect first-touch catalogue loading, visible in the large `Planning: Buffers`
  counts, and are not a property of the queries.
- **The generated distribution is uniform.** Real data is not. A skewed distribution can change a
  planner's choice, and nothing here predicts that.

## 3. Access paths, with the plans

Each query is the statement the repository actually issues, with bound parameters replaced by
literals of the same type. Repository sources:
[`number-sequence-repository.ts`](../../../src/modules/shared-services/data/number-sequence-repository.ts) ·
[`document-repository.ts`](../../../src/modules/shared-services/data/document-repository.ts) ·
[`notification-repository.ts`](../../../src/modules/shared-services/data/notification-repository.ts) ·
[`template-repository.ts`](../../../src/modules/shared-services/data/template-repository.ts) ·
[`transition-repository.ts`](../../../src/modules/shared-services/data/transition-repository.ts).

### 3.1 Number-sequence scope lookup

This is the lock-acquiring `SELECT … FOR UPDATE` **inside `shared.next_display_number()`** — the
statement on which every display-number allocation serialises. It is reproduced here verbatim from
the function body, since the repository calls the function rather than issuing the SQL itself.

The index under test:

```sql
CREATE UNIQUE INDEX uq_number_sequences_scope
    ON shared.number_sequences USING btree (tenant_id, sequence_code, company_id, branch_id)
 NULLS NOT DISTINCT;
```

#### Q1 — tenant-wide sequence (company and branch both `NULL`)

```sql
SELECT * FROM shared.number_sequences ns
 WHERE ns.tenant_id = '11111111-1111-4111-8111-000000000002'::uuid
   AND ns.sequence_code = 'seq_37'
   AND ns.company_id IS NOT DISTINCT FROM NULL::uuid
   AND ns.branch_id  IS NOT DISTINCT FROM NULL::uuid
   FOR UPDATE;
```

```text
 LockRows  (cost=0.28..8.32 rows=1 width=182) (actual time=0.137..0.141 rows=1 loops=1)
   Buffers: shared hit=3 read=1 dirtied=1
   ->  Index Scan using uq_number_sequences_scope on number_sequences ns  (cost=0.28..8.31 rows=1 width=182) (actual time=0.126..0.129 rows=1 loops=1)
         Index Cond: ((tenant_id = '11111111-1111-4111-8111-000000000002'::uuid) AND (sequence_code = 'seq_37'::text))
         Filter: ((NOT (company_id IS DISTINCT FROM NULL::uuid)) AND (NOT (branch_id IS DISTINCT FROM NULL::uuid)))
         Buffers: shared hit=3 read=1
 Planning Time: 9.396 ms
 Execution Time: 0.250 ms
```

**Node chosen:** `Index Scan` on `uq_number_sequences_scope`. **Index serves it:** partially — see
below.

#### Q1b — branch-scoped sequence (company and branch both non-`NULL`)

```sql
SELECT * FROM shared.number_sequences ns
 WHERE ns.tenant_id = '11111111-1111-4111-8111-000000000002'::uuid
   AND ns.sequence_code = 'seq_3'
   AND ns.company_id IS NOT DISTINCT FROM 'c0000000-0000-4000-8000-000000000012'::uuid
   AND ns.branch_id  IS NOT DISTINCT FROM 'a0000000-0000-4000-8000-000000000011'::uuid
   FOR UPDATE;
```

```text
 LockRows  (cost=57.29..231.32 rows=1 width=182) (actual time=0.406..0.672 rows=1 loops=1)
   Buffers: shared hit=46 read=6
   ->  Bitmap Heap Scan on number_sequences ns  (cost=57.29..231.31 rows=1 width=182) (actual time=0.396..0.658 rows=1 loops=1)
         Recheck Cond: ((tenant_id = '…0002'::uuid) AND (sequence_code = 'seq_3'::text))
         Filter: ((NOT (company_id IS DISTINCT FROM 'c0000000-…-000000000012'::uuid)) AND (NOT (branch_id IS DISTINCT FROM 'a0000000-…-000000000011'::uuid)))
         Rows Removed by Filter: 500
         Heap Blocks: exact=43
         Buffers: shared hit=45 read=6
         ->  Bitmap Index Scan on uq_number_sequences_scope  (cost=0.00..57.29 rows=501 width=0) (actual time=0.357..0.359 rows=501 loops=1)
               Index Cond: ((tenant_id = '…0002'::uuid) AND (sequence_code = 'seq_3'::text))
               Buffers: shared hit=2 read=6
 Planning Time: 0.258 ms
 Execution Time: 0.743 ms
```

**Node chosen:** `Bitmap Heap Scan` fed by a `Bitmap Index Scan` on `uq_number_sequences_scope`.
501 index entries were retrieved across 43 heap blocks and **500 rows were discarded by the filter**
to return one.

#### Q1c — the control: the same predicate written with plain equality

```sql
SELECT * FROM shared.number_sequences ns
 WHERE ns.tenant_id = '11111111-1111-4111-8111-000000000002'::uuid
   AND ns.sequence_code = 'seq_3'
   AND ns.company_id = 'c0000000-0000-4000-8000-000000000012'::uuid
   AND ns.branch_id  = 'a0000000-0000-4000-8000-000000000011'::uuid
   FOR UPDATE;
```

```text
 LockRows  (cost=0.28..8.32 rows=1 width=182) (actual time=0.079..0.084 rows=1 loops=1)
   Buffers: shared hit=6 read=1
   ->  Index Scan using ix_number_sequences_org_scope on number_sequences ns  (cost=0.28..8.31 rows=1 width=182) (actual time=0.075..0.078 rows=1 loops=1)
         Index Cond: ((tenant_id = '…0002'::uuid) AND (company_id = 'c0000000-…-000000000012'::uuid) AND (branch_id = 'a0000000-…-000000000011'::uuid))
         Filter: (sequence_code = 'seq_3'::text)
         Rows Removed by Filter: 3
 Planning Time: 0.218 ms
 Execution Time: 0.137 ms
```

#### Finding P1-15-PERF-001 — `IS NOT DISTINCT FROM` is not an indexable predicate

Comparing Q1b with Q1c isolates the cause exactly. With `IS NOT DISTINCT FROM`, only the leading
`(tenant_id, sequence_code)` columns reach the `Index Cond`; the trailing scope columns fall through
to a `Filter` and 500 rows are read and discarded. With plain `=`, the planner drives three columns
through an index condition and discards three rows.

The cause is the operator, not the index set: `IS NOT DISTINCT FROM` is not a btree-indexable
operator, so `NULLS NOT DISTINCT` on `uq_number_sequences_scope` makes the _uniqueness_ semantics
correct without making the _lookup_ semantics indexable. The function uses that operator for a good
reason — it is the only way one statement matches both `NULL` and non-`NULL` scope in the same
expression, and rewriting it as `(company_id = $2 OR ($2 IS NULL AND company_id IS NULL))` changes
allocation semantics that are frozen in protected history.

**No index is missing, and none was added.** The rows discarded scale with the number of scope rows
sharing one `(tenant_id, sequence_code)` pair — 501 in this fixture, because 500 branches and one
tenant-wide row share `seq_3`. A tenant with few scoped sequences (the common shape) sees Q1's plan,
not Q1b's. This is recorded as an observation for whichever later phase owns numbering at scale, and
deliberately left unresolved here: it is a database-layer change and Phase 1-15 is not authorised to
make one.

### 3.2 Document-by-tenant lookup

`DocumentRepository.findDocument()`.

```sql
SELECT id, tenant_id, company_id, branch_id, category_id, title, classification,
       retention_class, legal_hold, status, record_version
  FROM shared.documents
 WHERE tenant_id = '11111111-1111-4111-8111-000000000002'::uuid
   AND id = 'f0000000-0000-4000-8000-0000000061a9'::uuid
   AND deleted_at IS NULL;
```

```text
 Index Scan using pk_documents on documents  (cost=0.29..8.31 rows=1 width=138) (actual time=0.022..0.024 rows=1 loops=1)
   Index Cond: (id = 'f0000000-0000-4000-8000-0000000061a9'::uuid)
   Filter: ((deleted_at IS NULL) AND (tenant_id = '11111111-1111-4111-8111-000000000002'::uuid))
   Buffers: shared hit=3
 Planning Time: 0.822 ms
 Execution Time: 0.076 ms
```

**Node chosen:** `Index Scan` on `pk_documents (id)`. **Index serves it:** yes.

The planner preferred the primary key over `uq_documents_tenant_id (tenant_id, id)` and applied the
tenant predicate as a filter. Both are unique indexes and both resolve to a single row, so the choice
is immaterial to cost — and the tenant predicate is still evaluated, which is what the controlled
data-access rule requires of it. It is worth noting only so that a later reader does not mistake
"`tenant_id` appears under `Filter`" for "the tenant predicate was dropped". It was not; three
buffers were touched.

### 3.3 Version-by-document lookup

`DocumentRepository.findLatestVersion()`.

```sql
SELECT v.id, v.document_id, v.version_number, v.storage_key, v.content_type,
       v.size_bytes, v.status, d.company_id, d.branch_id
  FROM shared.document_versions v
  JOIN shared.documents d
    ON d.tenant_id = v.tenant_id AND d.id = v.document_id
 WHERE v.tenant_id = '11111111-1111-4111-8111-000000000002'::uuid
   AND v.document_id = 'f0000000-0000-4000-8000-0000000061a9'::uuid
   AND d.deleted_at IS NULL
 ORDER BY v.version_number DESC
 LIMIT 1;
```

```text
 Limit  (cost=0.71..16.76 rows=1 width=187) (actual time=0.347..0.350 rows=1 loops=1)
   Buffers: shared hit=6 read=1
   ->  Nested Loop  (cost=0.71..16.76 rows=1 width=187) (actual time=0.344..0.346 rows=1 loops=1)
         ->  Index Scan Backward using uq_document_versions_number on document_versions v  (cost=0.42..8.44 rows=1 width=171) (actual time=0.313..0.314 rows=1 loops=1)
               Index Cond: ((tenant_id = '…0002'::uuid) AND (document_id = 'f0000000-…-0000000061a9'::uuid))
               Buffers: shared hit=3 read=1
         ->  Index Scan using pk_documents on documents d  (cost=0.29..8.31 rows=1 width=64) (actual time=0.024..0.024 rows=1 loops=1)
               Index Cond: (id = 'f0000000-…-0000000061a9'::uuid)
               Filter: ((deleted_at IS NULL) AND (tenant_id = '…0002'::uuid))
 Planning Time: 9.871 ms
 Execution Time: 0.562 ms
```

**Node chosen:** `Limit` over a `Nested Loop`, driven by an `Index Scan Backward` on
`uq_document_versions_number (tenant_id, document_id, version_number)`. **Index serves it:** yes,
and well.

This is the best available outcome for the shape. Because the index's trailing column is
`version_number`, `ORDER BY v.version_number DESC LIMIT 1` is satisfied by walking the index
backwards and stopping at the first entry — no sort node, no aggregate over the document's versions.
The index exists for the uniqueness constraint on `(tenant_id, document_id, version_number)`; that it
also answers "newest version" for free is a genuine benefit of that column order, not an accident to
be relied on silently.

### 3.4 Outbound-message dedupe lookup

`NotificationRepository.findByDedupeKey()`. The same index is the `ON CONFLICT (tenant_id,
dedupe_key) DO NOTHING` arbiter on the enqueue path.

```sql
SELECT id, channel, purpose, status, template_version_id, recipient_user_id,
       dedupe_key, retry_count, failure_class, company_id, branch_id, record_version
  FROM shared.outbound_messages
 WHERE tenant_id = '11111111-1111-4111-8111-000000000002'::uuid
   AND dedupe_key = 'dedupe-98765';
```

```text
 Index Scan using uq_outbound_messages_dedupe on outbound_messages  (cost=0.42..8.44 rows=1 width=161) (actual time=0.041..0.042 rows=1 loops=1)
   Index Cond: ((tenant_id = '11111111-1111-4111-8111-000000000002'::uuid) AND (dedupe_key = 'dedupe-98765'::text))
   Buffers: shared hit=4
 Planning Time: 0.970 ms
 Execution Time: 0.098 ms
```

**Node chosen:** `Index Scan` on `uq_outbound_messages_dedupe (tenant_id, dedupe_key)`, both columns
in the `Index Cond`. **Index serves it:** yes, completely — four buffers against 150,000 rows.

This is the one path where index support is not merely a performance question. `uq_outbound_messages_dedupe`
is unconditional (no partial predicate, no `deleted_at` clause), so it is a sound `ON CONFLICT`
arbiter, and the deduplication guarantee is the index rather than the application read. The read
above only recovers the identifier of the message that already existed.

### 3.5 Template natural-key lookup

`TemplateRepository.findTemplateByCode()`. The two partial unique indexes involved:

```sql
CREATE UNIQUE INDEX uq_message_templates_tenant_identity
    ON shared.message_templates (tenant_id, template_code, channel, locale_code)
 WHERE scope = 'tenant' AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_message_templates_platform_identity
    ON shared.message_templates (template_code, channel, locale_code)
 WHERE scope = 'platform' AND deleted_at IS NULL;
```

#### Q5 — the query as issued

```sql
SELECT id, scope, tenant_id, template_code, name, channel, purpose, locale_code,
       description, active_version_id, status, record_version
  FROM shared.message_templates
 WHERE template_code = 'tpl_17' AND channel = 'in_app' AND locale_code = 'en-US'
   AND deleted_at IS NULL
   AND (scope = 'platform' OR tenant_id = '11111111-1111-4111-8111-000000000002'::uuid)
 ORDER BY scope = 'tenant' DESC
 LIMIT 1;
```

```text
 Limit  (cost=34.16..34.17 rows=1 width=142) (actual time=0.300..0.303 rows=1 loops=1)
   ->  Sort  (cost=34.16..34.17 rows=1 width=142) (actual time=0.298..0.299 rows=1 loops=1)
         Sort Key: ((scope = 'tenant'::text)) DESC
         Sort Method: quicksort  Memory: 25kB
         ->  Bitmap Heap Scan on message_templates  (cost=6.40..34.15 rows=1 width=142) (actual time=0.130..0.282 rows=2 loops=1)
               Recheck Cond: (locale_code = 'en-US'::text)
               Filter: ((deleted_at IS NULL) AND (template_code = 'tpl_17'::text) AND (channel = 'in_app'::text) AND ((scope = 'platform'::text) OR (tenant_id = '…0002'::uuid)))
               Rows Removed by Filter: 298
               Heap Blocks: exact=19
               ->  Bitmap Index Scan on ix_message_templates_locale  (cost=0.00..6.40 rows=300 width=0) (actual time=0.044..0.044 rows=300 loops=1)
                     Index Cond: (locale_code = 'en-US'::text)
 Planning Time: 1.090 ms
 Execution Time: 0.390 ms
```

**Node chosen:** `Bitmap Heap Scan` driven by `ix_message_templates_locale (locale_code)` — the
**least** selective available index. Neither partial unique index was used; 300 rows were retrieved
and 298 discarded.

#### Q5b and Q5c — each leg alone

```sql
SELECT id FROM shared.message_templates
 WHERE tenant_id = '11111111-1111-4111-8111-000000000002'::uuid
   AND template_code = 'tpl_17' AND channel = 'in_app' AND locale_code = 'en-US'
   AND scope = 'tenant' AND deleted_at IS NULL;
```

```text
 Index Scan using uq_message_templates_tenant_identity on message_templates  (cost=0.28..8.30 rows=1 width=16) (actual time=0.036..0.038 rows=1 loops=1)
   Index Cond: ((tenant_id = '…0002'::uuid) AND (template_code = 'tpl_17'::text) AND (channel = 'in_app'::text) AND (locale_code = 'en-US'::text))
   Buffers: shared hit=3
 Execution Time: 0.131 ms
```

```sql
SELECT id FROM shared.message_templates
 WHERE template_code = 'tpl_17' AND channel = 'in_app' AND locale_code = 'en-US'
   AND scope = 'platform' AND deleted_at IS NULL;
```

```text
 Index Scan using uq_message_templates_platform_identity on message_templates  (cost=0.27..8.29 rows=1 width=16) (actual time=0.033..0.035 rows=1 loops=1)
   Index Cond: ((template_code = 'tpl_17'::text) AND (channel = 'in_app'::text) AND (locale_code = 'en-US'::text))
   Buffers: shared hit=3
 Execution Time: 0.069 ms
```

#### Finding P1-15-PERF-002 — the scope disjunction defeats both partial unique indexes

Both partial indexes are healthy and each fully serves its own leg (Q5b, Q5c). What defeats them in
Q5 is the query shape: each index is predicated on a specific `scope` value, and the single query
asks for `scope = 'platform' OR tenant_id = $4` in one disjunction. A partial index can only be used
where the planner can prove the index predicate holds for every row the query wants, and here it
provably does not — the query deliberately wants rows of **both** scopes so that a tenant override
can win over the platform default via the `ORDER BY scope = 'tenant' DESC`.

**No index is missing, and none was added.** At 900 rows this costs 19 heap blocks and 0.39 ms, and
the resolution result is a strong caching candidate rather than an indexing problem. It is recorded
because the cost grows with the total number of templates in the installation, not with the number
relevant to the caller — so it is the shape most likely to need attention first if template
catalogues grow, and a later reader should find the measurement here rather than rediscover it.

### 3.6 Branch lookup

`BranchTransitionAdapter` in
[`transition-repository.ts`](../../../src/modules/shared-services/data/transition-repository.ts)
reads this snapshot before every branch status transition. `OrganizationRepository.companyOfBranch()`
issues the same shape.

```sql
SELECT id, status, record_version, company_id
  FROM org.branches
 WHERE tenant_id = '11111111-1111-4111-8111-000000000002'::uuid
   AND id = 'a0000000-0000-4000-8000-000000000011'::uuid
   AND deleted_at IS NULL;
```

```text
 Index Scan using uq_branches_tenant_id_id on branches  (cost=0.28..8.30 rows=1 width=43) (actual time=0.064..0.067 rows=1 loops=1)
   Index Cond: ((tenant_id = '11111111-1111-4111-8111-000000000002'::uuid) AND (id = 'a0000000-0000-4000-8000-000000000011'::uuid))
   Filter: (deleted_at IS NULL)
   Buffers: shared hit=1 read=2
 Planning Time: 0.946 ms
 Execution Time: 0.125 ms
```

**Node chosen:** `Index Scan` on `uq_branches_tenant_id_id (tenant_id, id)`, both columns in the
`Index Cond`. **Index serves it:** yes, completely.

Here the planner chose the tenant-leading unique index over the primary key — the opposite of its
choice on `shared.documents` (§3.2). Both are single-row lookups and neither choice is a defect; the
contrast is included because it demonstrates that "`tenant_id` under `Filter`" and "`tenant_id` under
`Index Cond`" are both normal outcomes for equivalent unique-index sets, and neither should be read
as a signal about isolation.

## 4. Summary

| #   | Access path                  | Plan node chosen                          | Index used                               | Fully index-served                                             |
| --- | ---------------------------- | ----------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| 1   | Number-sequence scope lookup | Index Scan / Bitmap Heap Scan             | `uq_number_sequences_scope`              | **Partially** — leading two columns only (P1-15-PERF-001)      |
| 2   | Document by tenant           | Index Scan                                | `pk_documents`                           | Yes                                                            |
| 3   | Version by document          | Limit → Nested Loop → Index Scan Backward | `uq_document_versions_number`            | Yes                                                            |
| 4   | Outbound-message dedupe      | Index Scan                                | `uq_outbound_messages_dedupe`            | Yes                                                            |
| 5   | Template natural key         | Bitmap Heap Scan over a locale index      | `ix_message_templates_locale`            | **No** — both partial unique indexes bypassed (P1-15-PERF-002) |
| 5b  | Template, tenant leg alone   | Index Scan                                | `uq_message_templates_tenant_identity`   | Yes                                                            |
| 5c  | Template, platform leg alone | Index Scan                                | `uq_message_templates_platform_identity` | Yes                                                            |
| 6   | Branch lookup                | Index Scan                                | `uq_branches_tenant_id_id`               | Yes                                                            |

Both findings are **query-shape** findings, not missing-index findings. In each case the index the
path would want already exists and is healthy; what prevents its use is an operator
(`IS NOT DISTINCT FROM`) or a disjunction (`scope = 'platform' OR tenant_id = $`) that the planner
cannot push into an index condition. Neither was changed, and neither is a defect in the schema.

## 5. Reproducing this

The full fixture and plan script used to produce every plan above is reproduced in this document's
queries; the mechanism was a single transaction of the form:

```text
BEGIN;
SET LOCAL session_replication_role = replica;   -- suspend FK/trigger enforcement for the load
<generated INSERTs>                             -- synthetic values only
ANALYZE <each table>;
EXPLAIN (ANALYZE, BUFFERS) <each access path>;
ROLLBACK;                                       -- rows and statistics both discarded
```

executed as

```text
docker exec supabase_db_RootLco psql -U postgres -d postgres -X -c "…"
```

Row counts were confirmed as 0 both before and after. Anyone re-running this should confirm the same,
and should not commit the fixture: it exists to make a planner decision observable, and it has no
other purpose.

## 6. What this evidence does not establish

Stated plainly, because plan output is easily mistaken for a benchmark:

- **No production SLO, latency target, throughput figure, requests-per-second number, or capacity
  claim is made or supported by anything above.** These are single cold executions on one developer
  workstation against a synthetic fixture, with row-level security bypassed.
- **No environment beyond Local exists**
  ([ADR-012](../../adr/ADR-012-local-first-environment-with-controlled-promotion.md)). There is no
  hosted database, no connection pooler under load, no read replica, no failover, no sharding, and
  no CDN. Nothing here says anything about any of them.
- **No monitoring backend is provisioned**, so none of these paths is currently observed in
  production-like conditions. See
  [Phase 1-15 observability and runbooks](./observability-and-runbooks.md).
- **Open decision P1-OD-027 (NFR-SCL) remains open.** Every numeric limit in the
  [Scalability and Backpressure Standard](../../standards/scalability-and-backpressure-standard.md)
  is still a proposed validation baseline pending measurement, and **this document must not be cited
  as evidence that P1-OD-027 has been resolved** — it measures plan shape, not capacity.
- **No independent review, independent QA, or third-party audit informed this document.** It is
  owner-authorized technical self-review.
- **The Phase 1-15 owner gate is Pending.** Nothing here records or implies a Go.
