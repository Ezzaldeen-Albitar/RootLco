# Canonical Documents — Controlled Reference Record

**Status:** Active · **Owner:** Eng. Ezzaldeen Al-Bitar (technical and IT owner) ·
**Last verified:** 2026-07-16 · **Task:** P1-01-DOC-001, P1-01-DO-003

---

## The rule

> **The two canonical Word documents are the single authoritative source of truth.**
> They live **outside this repository** and are **intentionally not committed to Git.**
>
> **Markdown in this repository is never a replacement canonical copy.** If this
> repository and a canonical document disagree, **the canonical document wins**, and the
> repository is what gets corrected.

Committing a copy into Git would create a second document that can be edited, merged and
diverged independently. Two "canonical" copies means there is no canonical copy. This
decision was taken deliberately by the owners on 2026-07-16.

The repository records **metadata and integrity hashes only**, so that drift is detectable
without duplication.

## The documents

<!-- canonical-documents:begin -->

```json
{
  "recordVersion": 1,
  "lastVerified": "2026-07-16",
  "documents": [
    {
      "filename": "RootLco_Phase_1_Development_Plan_recovered_v01.docx",
      "authority": "Phase 1 execution",
      "purpose": "Governs Phase 1 execution sequence, Phase 1-1 through Phase 1-39, tasks, dependencies, gates, database/backend/frontend execution, integration, migration, the Benzene pilot, go-live, hypercare and acceptance.",
      "internalVersion": "1.0-rc2",
      "internalStatus": "Draft for owner review — not approved for execution",
      "relativePath": "../RootLco_Phase_1_Development_Plan_recovered_v01.docx",
      "sha256": "af49dd91c5fd588c09947e407ec32aa5346b5044d46326b5367d8154b215c30c",
      "bytes": 1161062,
      "lastVerifiedModified": "2026-07-16T13:20:25Z",
      "committedToGit": false
    },
    {
      "filename": "RootLco_Master_Project_Documentation.docx",
      "authority": "Business truth",
      "purpose": "Governs business vision, scope, requirements, business rules, use cases, architecture, security, testing strategy and product direction.",
      "internalVersion": "0.3",
      "internalStatus": "Corrected canonical review baseline — pending owner review and approval",
      "relativePath": "../documentation/RootLco_Master_Project_Documentation.docx",
      "sha256": "b1008a73d0f12fa62c41549a20d4ba030f326ba3e11bbe137f48dcb340cdbadc",
      "bytes": 4478674,
      "lastVerifiedModified": "2026-07-16T13:17:48Z",
      "committedToGit": false
    }
  ]
}
```

<!-- canonical-documents:end -->

> The hashes above are recorded **after** the Phase 1-1 execution-evidence updates of
> 16 July 2026 (Appendix B.4 in the Phase 1 plan; the technology-stack and related-document
> updates in the Master document) were applied in place and both documents were confirmed to
> open in Microsoft Word without a repair prompt (Phase 1 plan: 707 pages, 245 tables,
> 3 diagrams; Master: 228 pages, 51 tables, 47 diagrams).

## Authority split

| Question                                                                                          | Authority                                             |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| What the business needs; requirements; rules; use cases; architecture; security; testing strategy | `RootLco_Master_Project_Documentation.docx`           |
| What gets built when; tasks; dependencies; gates; Phase 1-1 … Phase 1-39                          | `RootLco_Phase_1_Development_Plan_recovered_v01.docx` |
| Conflict between the two                                                                          | The latest explicit RootLco owner instruction         |
| Anything in this repository that contradicts either                                               | The canonical document wins                           |

Historical Markdown files and "Output 1" are **historical development artifacts**. They are
retained for traceability and **do not govern**.

## Verifying

```bash
npm run validate:canonical-docs          # verify against the recorded hashes
node scripts/validate-canonical-documents.mjs --print   # print actual hashes
```

The script is **read-only**. It never copies, modifies, uploads, or commits a canonical
document, and it never treats a cached copy as authoritative.

Exit codes: `0` verified · `1` missing/changed · `2` reference record unreadable.

## If a document is missing or has moved

1. **Do not copy it into this repository.** It is external by design.
2. Look for it at the recorded `relativePath`, resolved from the repository root.
3. If it genuinely moved, have the owners confirm the new location, then update **only**
   `relativePath` in the JSON block above.
4. If it is lost, restore it from the protected backups kept beside the canonical-document
   workspace (`_archive/`). **Never** reconstruct it from this repository's Markdown.

## If a document has changed (hash mismatch)

1. Expected whenever the owners approve a documented edit.
2. Confirm the change was intentional and is recorded in the documentation change log.
3. Re-run with `--print`, then update `sha256`, `bytes`, `lastVerifiedModified` and
   `lastVerified` in the **same commit** that explains why.
4. If the change was **not** intentional, treat it as a possible integrity incident: do
   **not** overwrite the recorded hash, and escalate to the technical owner.

## Updating a canonical document

1. Take a protected backup first, beside the canonical-document workspace.
2. Edit the `.docx` **in place**. Preserve the exact filename — never produce
   `final`, `corrected`, `updated`, `v2`, `copy`, or `(1)` variants.
3. Confirm it opens in Microsoft Word **without a repair prompt**.
4. Recalculate the hash and update this record.
5. Commit the record change on the relevant working branch with an explanation.
