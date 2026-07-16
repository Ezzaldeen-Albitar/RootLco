# Pull Request

## Purpose

_State in one or two sentences why this change exists and what problem it solves._

## Related Phase 1 Task IDs

_List the Phase 1 task identifiers this pull request addresses (for example, P1-01-DO-001, P1-01-DOC-012). Write "None" if no task applies._

## Changes

_Summarise what was added, modified, or removed. Group by area where that aids review._

## Architecture Decisions

_Record any architectural decision taken or applied here, and reference the corresponding entry in the Architecture Decision Register (P1-01-DOC-014). Write "None" if the change introduces no architectural decision._

## Docker Setup

_Describe any change to Dockerfiles, Compose files, images, volumes, or local container configuration. Docker-based local development is the accepted development model; only the Local environment is implemented._

## Validation Commands

_List the exact commands a reviewer must run to validate this change, in the order they should be executed._

## Tests Performed

_State precisely which checks were executed and what was observed. Do not claim a result that was not actually produced. Note that independent QA ownership is not assigned; technical tests are currently executed by Eng. Ezzaldeen Al-Bitar._

## Security Impact

_Describe the effect on tenant isolation, Row-Level Security policies, authentication, authorisation, secrets handling, or repository access control. Write "None identified" only if that is accurate._

## Documentation Updated

_List the documentation files updated in this repository. The two canonical Word documents live outside this repository by owner decision and are not committed; Git documentation is not a replacement canonical copy._

## Remaining Blockers

_List anything still blocked or unresolved, including known blocked items such as branch protection and Pull Request automation (GitHub CLI is not installed and no GitHub token is available). Write "None" if nothing is outstanding._

## Evidence Paths

_Give the repository-relative paths to evidence artefacts, logs, or outputs supporting the claims made above._

## Rollback Instructions

_Explain how to revert this change safely, including any migration, seed data, or container state that must be undone._

---

## Checklist

- [ ] This pull request targets `develop`, not `main`.
- [ ] No secrets, credentials, tokens, or private keys are included in the diff or in any committed file.
- [ ] Lint, type-check, tests, and build were executed, and their actual results are reported truthfully in "Tests Performed".
- [ ] The Docker build was executed and its actual result is reported truthfully.
- [ ] The Architecture Decision Register is updated if this change introduces or alters an architectural decision.
- [ ] No tenant-specific hard-coding is introduced. Tenants, including the first pilot tenant Benzene Vehicle Services, are onboarded through configuration and seed data only.
- [ ] No Phase 1-2 work is included. Phase 1-1 has not been passed, and Phase 1-2 work may only be included once the Phase 1-1 gate is approved by the product owners.
