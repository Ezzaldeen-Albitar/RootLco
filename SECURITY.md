# Security Policy

**Repository:** `github.com/Ezzaldeen-Albitar/RootLco` (private)
**Vendor / owner:** RootLco — Root Link Company
**Product:** [PRODUCT NAME — Pending Final Approval] (Commercial Multi-Tenant Automotive CRM and ERP Platform)
**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 1. Scope and Classification

This repository and everything in it — source code, planning documents, schemas, configuration, and issue history — are classified **Confidential — Commercial Product and Pilot Planning**. Access is restricted to individuals explicitly granted repository access by the technical owner.

This policy applies to the RootLco platform repository only. It does not extend to tenant-operated systems, third-party services, or any environment not provisioned under this repository.

Tenant identity note: Benzene Vehicle Services (بنزين لخدمات المركبات) is the first subscribing customer and first pilot tenant. It is not an owner of this software and holds no repository access rights by virtue of that relationship.

---

## 2. Reporting a Vulnerability

Report suspected vulnerabilities privately to the technical and IT owner:

**Eng. Ezzaldeen Al-Bitar** — technical and IT owner (GitHub: `Ezzaldeen-Albitar`)

> **Reporting channel: OPEN ITEM — requires owner input.**
> **`<SECURITY-CONTACT-PLACEHOLDER — to be supplied by Eng. Ezzaldeen Al-Bitar>`**
>
> No security contact address, mailbox, or intake form has been established or approved. No `security@` mailbox exists. Nothing in this document should be read as confirming a monitored reporting channel. Until the owner supplies and approves a channel, reporters should use whatever direct contact route they already hold with the technical owner.

### Reporting expectations

| Item                  | Position                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Public disclosure     | Do not open a public issue, post, or gist describing a suspected vulnerability.               |
| Content of a report   | Affected component, reproduction steps, observed impact, and any relevant environment detail. |
| Proof-of-concept data | Do not include live credentials, tenant data, or personal data in a report.                   |
| Acknowledgement time  | **Not defined.** No service level for acknowledgement or remediation has been agreed.         |
| Remediation time      | **Not defined.**                                                                              |
| Bounty or reward      | None. No programme exists.                                                                    |

The absence of defined response times is stated deliberately rather than concealed. It is an open governance item for the product owners, Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat.

---

## 3. Supported Versions

The product is **pre-release**. No version has been released.

| Version                     | Status                        | Supported for production |
| --------------------------- | ----------------------------- | ------------------------ |
| (none)                      | No released version exists    | No                       |
| `main` / `develop` branches | Pre-release development state | No                       |

There is no supported version, no maintenance branch, and no security patch stream. **No version of this software is supported for production use.** No party should deploy this software to production or process live customer data with it at this time.

The only environment currently being implemented is **Local** (Docker-based local development, accepted by owner instruction). Development, Staging, and Production environments are **Planned — not provisioned**. No cloud provider, production region, or deployment platform has been approved by the owner; those remain Proposed/Open.

---

## 4. Secret Handling

### 4.1 Prohibited in version control

The following must never be committed to this repository, in any branch, commit, tag, comment, test fixture, screenshot, or documentation file:

- `.env` files of any kind (`.env`, `.env.local`, `.env.development`, `.env.production`, and equivalents)
- Supabase **service-role keys** and any other key granting privilege beyond an anonymous client
- Database passwords, connection strings containing credentials, or DSN values
- API tokens, personal access tokens, OAuth client secrets, refresh tokens, session tokens
- Private keys, certificates with private material, signing keys
- JWT signing secrets
- Third-party credentials of any tenant, including those of Benzene Vehicle Services

### 4.2 What is permitted

- **`.env.example` only.** It must contain variable names and non-sensitive placeholder values. Every placeholder must be obviously non-functional (for example `SUPABASE_SERVICE_ROLE_KEY=<set-locally-never-commit>`). A real value must never be pasted into `.env.example`, including "expired" or "test" values.
- Real values live in the developer's local, untracked `.env`, or in a secret store once one is selected. No secret store has been selected or approved; this is an open item.

### 4.3 Rotation expectation

- Any secret that is exposed, suspected of exposure, or shared through an unencrypted channel is treated as compromised and must be rotated.
- Secrets are expected to be rotated on developer offboarding and on any change to who holds repository access.
- A fixed periodic rotation interval has **not** been agreed and is an open item for the owners.

---

## 5. If a Secret Is Committed

Order matters. Rotation comes first, because purging history does not invalidate a value that has already been read.

1. **Rotate the secret first.** Invalidate the exposed value at its source (Supabase, database, provider console). Do this before any repository work. Assume the value is already compromised the moment it reaches a remote.
2. **Confirm the old value is dead.** Verify the rotated-out credential no longer authenticates.
3. **Then purge the history.** Remove the value from Git history (for example with `git filter-repo`), force-push the rewritten history, and require every clone holder to re-clone rather than merge. Coordinate the rewrite with the technical owner before executing it.
4. **Record the incident** in the security section of the project register: what leaked, when, where it reached, what was rotated, and when. Record it openly rather than quietly.
5. **Never re-post the value.** Do not paste the exposed secret into an issue, a pull request, a commit message, a chat channel, or an incident note — not to identify it, not to document it, not to prove it was rotated. Refer to it by variable name and by the date of rotation only.

If the exposed value reached a public location at any point, treat the exposure as public regardless of how quickly it was removed.

---

## 6. Row-Level Security (RLS) Direction

**Current state (updated 2026-07-16, Phase 1-2):** RLS is implemented, **enabled and forced**, on the Phase 1-2 shared foundation table (`shared.number_sequences`) with default-deny policies, and is verified by the database test suite executing as a non-owner runtime role (see `docs/database/rls-standard.md`). Business-domain tables do not exist yet — they arrive from Phase 1-3 onward, and each must land with RLS enabled, forced, and tested.

Direction of travel, as approved technical direction:

- The platform is multi-tenant, multi-company, multi-branch. Tenant isolation is a correctness requirement, not a feature.
- **PostgreSQL Row-Level Security is mandatory from the foundational business schemas onward.** Every table holding tenant-scoped data is to have RLS enabled and forced, with policies that constrain access by tenant, company, and branch context.
- Tenant onboarding is by **configuration and seed data only**. No tenant is to be hard-coded — this includes the first pilot tenant, Benzene Vehicle Services.
- The Supabase service-role key bypasses RLS by design. Its use must therefore be confined to narrowly scoped server-side paths, never exposed to a client bundle, and never used as a convenience route around a policy.
- Application-layer filtering is not a substitute for RLS and does not satisfy this requirement.

**Gate (status updated 2026-07-16):** Phase 1-1 closed with a recorded owner **Go** (`docs/phase-1/phase-1-1/phase-1-1-owner-gate.md`); Phase 1-2 established the RLS standard, the session-context contract, and the tested foundation — its exit gate (Database Standards Gate) is **not decided**. Tenant-isolation evidence to date is owner-authorized self-review under the Solo Developer Review Policy; **no independent verification exists** (P1-EC-016 remains open), and RLS coverage of every future business schema remains a binding obligation on the phase that creates it.

---

## 7. Dependency Policy

| Rule                 | Position                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime baseline     | **Application / container runtime: Node 22 LTS**, pinned in the `Dockerfile` (`ARG NODE_VERSION=22-alpine`) for every stage; Docker-based local development is the accepted model, so this is the runtime the application actually executes on. **Host tooling measured at Node v24.16.0, npm 11.13.0** — that is the developer machine's toolchain, not the application runtime. npm is the package manager; pnpm and yarn are not installed and are not to be introduced without owner decision. |
| Lockfile             | `package-lock.json` is committed and authoritative. **Binding rule:** installs in Docker builds and in CI use `npm ci`, never `npm install`. A CI workflow definition exists at `.github/workflows/ci.yml` and obeys this rule; pull requests #1–#3 were merged through the required CI checks (owner-stated; run results live in GitHub Actions), and the Phase 1-2 branch awaits its first run on its own pull request.                                                                          |
| Pinned direction     | Next.js 16.2.10, React 19.2.4, TypeScript 5 (strict). Changes to these are architecture decisions and belong in the Architecture Decision Register (P1-01-DOC-014), not in an unreviewed dependency bump.                                                                                                                                                                                                                                                                                          |
| Adding a dependency  | Prefer the standard library and existing dependencies. A new dependency requires a stated justification, a licence check for commercial-product compatibility, and technical-owner review.                                                                                                                                                                                                                                                                                                         |
| Vulnerability review | `npm audit` is to be run and its findings reviewed and triaged by the technical owner. Findings are recorded, including those accepted. **No automated dependency scanning is currently configured, and no audit result is claimed here as clean.**                                                                                                                                                                                                                                                |
| Transitive risk      | Install scripts from untrusted packages are a known risk; unfamiliar packages are to be reviewed before adoption.                                                                                                                                                                                                                                                                                                                                                                                  |
| Licences             | Copyleft licences incompatible with a closed commercial product are not acceptable without owner decision.                                                                                                                                                                                                                                                                                                                                                                                         |

---

## 8. Docker Image Policy

Docker is used from the beginning, for local development, by owner instruction. The following apply to every image defined in this repository.

- **Non-root.** Containers must run as a dedicated unprivileged user. A `USER` directive is required; running as `root` is not acceptable, including in development images.
- **No baked secrets.** No secret may be placed in a `Dockerfile`, an `ENV` instruction, a build argument, an image layer, or a committed compose file. Build arguments are visible in image history and are not a secret mechanism. Secrets are supplied at run time from the local untracked `.env` or, later, from an approved secret store.
- **Pinned base images.** Base images are pinned to explicit versions rather than floating tags, so that a rebuild is reproducible and a base change is a visible, reviewable event.
- **Minimal surface.** Install only what the image needs. Exclude source control metadata, local `.env` files, and developer artefacts via `.dockerignore`.
- **No privileged containers**, no unnecessary capabilities, and no bind mounts of host paths beyond what local development requires.
- **Local scope only.** The compose setup targets the Local environment. It is not hardened for, and must not be presented as suitable for, any hosted or production environment.

Measured local platform for reference: Docker Engine 29.5.3, Docker Compose v5.1.4, Docker Desktop linux engine, 12 CPUs, approximately 16.5 GB RAM.

---

## 9. Known Gaps and Explicit Non-Claims

These statements are recorded openly. None of them may be softened or omitted in derived documentation.

- **No penetration test has been performed** on this software, at any point, by any party.
- **No security audit, code audit, or third-party security review has been performed.**
- **No compliance certification is claimed.** No ISO, SOC, PCI DSS, GDPR, or equivalent certification, attestation, or readiness assessment exists for this product or for RootLco in connection with it. Any document suggesting otherwise is incorrect (see P1-01-SEC-005, verification that no secrets or fabricated compliance claims exist).
- **No security testing has passed**, because none has been designed or executed.
- **Independent QA ownership is not assigned.** Technical tests are currently executed by Eng. Ezzaldeen Al-Bitar, who is also the technical owner and implementer. This operates under the owner-approved [Solo Developer Review Policy](docs/governance/solo-developer-review-policy.md) (2026-07-16): the risk is owner-accepted and disclosed, and it is still a self-verification gap — nothing in this document mitigates it or presents it as independent review.
- **Security review is an owner-authorized self-review.** Under the same policy, Eng. Ezzaldeen Al-Bitar holds security implementation and review authority. P1-EC-016 (independent security reviewer before production release) remains open.
- **Branch protection status (updated 2026-07-16).** Branch rules were applied by the repository administrator in the GitHub UI (pull requests #1–#3 merged through them). Under the Solo Developer Review Policy the required approving-review count is 0 while pull requests, required CI checks, conversation resolution, force-push blocking, and branch-deletion blocking remain enabled. The live ruleset is not inspectable from the build environment (no GitHub CLI or token); this statement reflects the owner-approved policy state.
- **Repository access control review** is tracked under P1-01-SEC-004 (classification of the Phase 1 plan set sensitivity and repository access control) and is not complete.
- **The two canonical Word documents** (`RootLco_Phase_1_Development_Plan_recovered_v01.docx` and `RootLco_Master_Project_Documentation.docx`) reside outside this repository, in the parent folder, by owner decision, and are deliberately not committed. Documentation held in Git is a working aid and must never be treated as a replacement canonical copy. Handling of those files, including their storage and backup, is the owner's responsibility and is outside the controls described here.

---

## 10. Out of Scope

Zoom Vehicle Inspection and Evaluation Services is outside Phase 1 and is future work. No Phase 1 code, tables, modules, APIs, migrations, or workflows exist for it, and this policy makes no statement about it.

---

## 11. Ownership and Review

| Role                                                         | Holder                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Technical and IT owner                                       | Eng. Ezzaldeen Al-Bitar (GitHub: `Ezzaldeen-Albitar`)                                                                           |
| Product owners / final business approval authority (jointly) | Eng. Ezzaldeen Al-Bitar; Eng. Bilal Jradat                                                                                      |
| Independent QA owner                                         | **Not assigned** — owner-accepted gap under the [Solo Developer Review Policy](docs/governance/solo-developer-review-policy.md) |
| Security contact channel                                     | **Open item** — see Section 2                                                                                                   |

This policy describes intended controls and current state. Where a control is not yet implemented, that is stated. This document confers no assurance, warranty, or certification of any kind.

---

## 12. Application-Security Baseline

By owner instruction of 2026-07-17, the repository carries a formal application-security baseline under [docs/security/](docs/security/security-baseline.md), pinning **OWASP ASVS v5.0.0** (Level 2 as the general verification target; Level 3 selectively for high-risk workflows), **OWASP Top 10:2025**, **OWASP API Security Top 10:2023**, **NIST SSDF v1.1**, and **OWASP SAMM v2.0.3** (as a future maturity model — no assessment performed).

- The [ASVS matrix](docs/security/owasp-asvs-5-matrix.md) enumerates all 345 requirements of the pinned edition with per-row status; a requirement is never marked Verified without named test evidence.
- The verified Phase 1-2 database-security controls are recorded as RL-SEC-DB-001..014 in [security-baseline.md](docs/security/security-baseline.md) §9.
- A [Security Gate](docs/security/security-baseline.md) binds every phase exit gate: no unresolved Critical findings; no unresolved High findings without a documented, owner-approved, time-bounded exception in the [exceptions register](docs/security/security-exceptions-register.md) (currently empty).
- **This baseline is an adoption and tracking instrument. It is not — and must never be represented as — an OWASP compliance claim, certification, or attestation.** The non-claims in §9 above remain fully in force.
