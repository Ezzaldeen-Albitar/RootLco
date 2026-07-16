# ADR-011: Product Name Remains Pending Final Approval

## Status

Accepted by owner instruction

## Context

The commercial software product under development by RootLco — Root Link Company is currently described only by the temporary descriptive title "Commercial Multi-Tenant Automotive CRM and ERP Platform". No final product name has been selected, and no naming decision has been taken by the product owners.

Two distinct naming risks were identified during Phase 1-1 source-of-truth validation:

1. **Company-name substitution.** RootLco is the company, vendor, and platform owner. It is not the software product name. Written material that uses "RootLco" where a product name belongs creates a false impression that the naming question is settled and embeds an incorrect identity into the documentation set, the repository, and any future user-facing strings.
2. **Customer-name substitution.** Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer, the first subscribed tenant, and the first pilot. It is not the software owner and not the platform owner. Naming the product after the first tenant would contradict the multi-tenant, configuration-driven architecture and would imply tenant-specific coupling that the design explicitly rejects.

A further complication is historical. The Master Project Documentation uses a legacy internal placeholder, `[SYSTEM NAME]`, in positions where a product name would appear. That placeholder predates the current Phase 1 plan set and is inconsistent with the placeholder used in the Phase 1 Development Plan. Two divergent placeholders in the canonical documentation increase the chance that one of them is silently resolved to an invented name during editing or during automated text processing.

The naming decision is a business and commercial decision, not a technical one. It carries trademark, domain, and market-positioning consequences that fall outside the technical owner's authority. It is tracked as open item OIR-01 and rests on assumption ASM-01.

## Decision

The product name remains undecided. Until the product owners jointly grant final naming approval, the following applies:

- The controlled placeholder `[PRODUCT NAME — Pending Final Approval]` is used, verbatim and without variation, wherever a product name would otherwise appear. The separator is an em-dash (U+2014).
- No product name may be invented, inferred, abbreviated, or improvised in any document, commit message, code identifier, configuration value, database seed, or user-facing string.
- "RootLco" and "Root Link Company" denote the company only and must never be used as the product name.
- "Benzene Vehicle Services" denotes the first customer and first tenant only and must never be used as the product name.
- The legacy internal placeholder `[SYSTEM NAME]` appearing in the Master Project Documentation is declared **equivalent in meaning** to `[PRODUCT NAME — Pending Final Approval]` until final naming approval. It is recognised as a synonym, not as an alternative decision, and it does not represent a second naming track. It is not being retrofitted in the canonical Word documents at this time, because those documents live outside this repository by owner decision and are not committed here; the equivalence is recorded so that neither placeholder is mistaken for a resolved name.
- The temporary descriptive title "Commercial Multi-Tenant Automotive CRM and ERP Platform" may be used in prose where a descriptive phrase, rather than a name, is required.
- Resolution of the placeholder requires joint approval by Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat, and will be recorded by superseding this record.

The placeholder is deliberately conspicuous. A reader encountering it should immediately understand that a decision is outstanding rather than mistake it for a name.

## Alternatives Considered

| Alternative                                                          | Reason for rejection                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use "RootLco" as the product name                                    | RootLco is the company and vendor. Using the company name as the product name would conflate two separate legal and commercial identities and would pre-empt a naming decision that the product owners have not made. It would also obstruct any future scenario in which RootLco owns more than one product, because the company name would already be bound to this one.                                                         |
| Use "Benzene" or a Benzene-derived name                              | Benzene Vehicle Services is the first customer and first tenant, onboarded through configuration and seed data only. Naming the product after a tenant contradicts the multi-tenant, configuration-driven direction, implies that the platform is tenant-specific, and would be commercially untenable when a second tenant subscribes.                                                                                            |
| Adopt a provisional working codename now and rename later            | A codename would spread into commit history, documentation, identifiers, and conversation, and renaming would then require a coordinated sweep across the repository and the canonical documents. Worse, a codename reads as a decided name to any reader who does not know its provisional status, which defeats the purpose of tracking OIR-01 as open. The placeholder carries the same identifying function at no rename cost. |
| Retain the legacy `[SYSTEM NAME]` placeholder as the single standard | `[SYSTEM NAME]` does not state that the matter is pending, and it reads as a template field awaiting mechanical substitution rather than as an open business decision. It also does not distinguish product name from system or module names. The explicit `[PRODUCT NAME — Pending Final Approval]` form states the status inline and cannot be mistaken for a fill-in-the-blank field.                                           |
| Defer all naming references by omitting them entirely                | Some documents genuinely need to refer to the product. Omission produces awkward or ambiguous prose and leaves no marker for the outstanding decision, making it harder to locate every affected position when the name is finally approved.                                                                                                                                                                                       |

## Consequences

**Positive**

- No incorrect product identity is embedded in the repository, the documentation set, or any code path.
- The company, the first customer, and the product remain cleanly separated in all written material, which reinforces the multi-tenant, no-tenant-hard-coding direction.
- Every position requiring the eventual name is discoverable by a single literal search for the placeholder string, which makes the future substitution mechanical and auditable.
- The open status of OIR-01 stays visible to every reader rather than being obscured behind a plausible-looking name.

**Negative and trade-offs**

- The placeholder is verbose and degrades readability where a name would appear repeatedly in a paragraph. Documents read less fluently than they would with a real name.
- The exact string, including the em-dash (U+2014), must be reproduced precisely. Substitution of a hyphen or an en-dash produces a variant that a literal search will miss, which weakens the discoverability benefit and requires review attention.
- Recognising `[SYSTEM NAME]` as an equivalent synonym means two distinct strings must be searched, not one, until the legacy placeholder is retired. This is an accepted temporary inconsistency, not a target state.
- No branding, no marketing surface, no domain, no trademark search, and no user-facing naming work can proceed, and any activity that depends on those remains blocked.
- A future rename sweep is still required, however mechanical. The cost is deferred, not eliminated.
- Where the descriptive title is used instead of the placeholder, some ambiguity remains as to whether the text refers to the product or to the category of product.

## Security Impact

Low, and indirect rather than direct.

- The placeholder introduces no secret, no credential, and no sensitive value. It is inert text and is safe to commit under the repository classification "Confidential — Commercial Product and Pilot Planning".
- Withholding a product name reduces, marginally, the information available about an unreleased commercial product in the event of unauthorised repository disclosure. This is a side effect and is not a justification for the decision.
- The decision supports the verification performed under P1-01-SEC-005, in that it forbids the invention of unsupported identity claims. An invented product name asserted as approved would be a fabricated claim of the same category that P1-01-SEC-005 exists to detect.
- The prohibition on tenant-derived naming is consistent with the tenant-isolation posture: no tenant identity, including that of Benzene Vehicle Services, should be structurally privileged anywhere in the platform, including in its name.
- No change to Row-Level Security policy, authentication, authorisation, or repository access control arises from this record.

## Operational Impact

- Authors and reviewers must reproduce `[PRODUCT NAME — Pending Final Approval]` exactly, with the em-dash character, and must not paraphrase it.
- Reviewers must reject any document, commit, or change that introduces an invented product name, uses RootLco as the product name, or uses a Benzene-derived name as the product name.
- The placeholder is documentation-level and repository-level. Because Phase 1-1 is source-of-truth validation and development readiness, and Phase 1-2 has not started, no application code, schema object, migration, or configuration key currently depends on a product name. Introducing such a dependency before naming approval should be avoided; where a display name is unavoidable in later phases, it must be sourced from configuration rather than a literal.
- When the product owners grant naming approval, the substitution is expected to proceed by a single co-ordinated pass over both placeholder strings, in the repository and in the canonical Word documents, followed by superseding this record with one that names the approved decision.
- The canonical Word documents (`RootLco_Phase_1_Development_Plan_recovered_v01.docx` and `RootLco_Master_Project_Documentation.docx`) reside outside this repository in the parent folder by owner decision and are deliberately not committed. The naming sweep must therefore be applied to those documents separately. Git documentation is not a replacement canonical copy and must never be treated as one.
- No environment, deployment, or provisioning action follows from this record. Only the Local environment is being implemented; Development, Staging, and Production remain Planned — not provisioned.

## Related Phase 1 Task and Requirement IDs

| ID            | Relationship                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| OIR-01        | Open item recording that the product name is undecided. This record does not close it.                                                        |
| ASM-01        | Assumption on which the placeholder approach rests.                                                                                           |
| P1-01-DOC-014 | Produce the Architecture Decision Register. This record is a constituent entry.                                                               |
| P1-01-SEC-005 | Verify no secrets or fabricated compliance claims. An invented product name presented as approved would constitute a fabricated claim.        |
| P1-01-SEC-004 | Classify Phase 1 plan set sensitivity and repository access control. The placeholder text is inert and carries no classification consequence. |
| P1-01-DOC-012 | Development-readiness checklist for the 22 entry criteria. Naming remains open and does not block development readiness.                      |
| P1-01-QA-009  | Verify the development-readiness checklist. Verification of placeholder usage falls within documentation review scope.                        |
| P1-01-DO-001  | Verify repository readiness. Placeholder consistency across committed documentation is in scope.                                              |
| Phase 1-2     | Not started. Any product-name dependency introduced from Phase 1-2 onwards must be configuration-sourced until naming approval.               |

## Decision Owner

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly).

The product name is a business, scope, and commercial decision. Final naming approval is reserved to the product owners acting jointly. Eng. Ezzaldeen Al-Bitar, as technical and IT owner, is responsible for enforcing the placeholder convention across the repository and the documentation set until that approval is granted.

## Date

2026-07-16
