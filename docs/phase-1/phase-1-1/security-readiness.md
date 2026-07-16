# Security Readiness Evidence — Phase 1-1

**Classification:** Confidential — Commercial Product and Pilot Planning
**Company:** RootLco — Root Link Company
**Product:** [PRODUCT NAME — Pending Final Approval]
**Date:** 2026-07-16
**Scope:** P1-01-SEC-001 to P1-01-SEC-005, limited to what this repository can evidence
**Security implementation owner:** Eng. Ezzaldeen Al-Bitar

> Ownership honesty (P1-01-SEC-003): Eng. Ezzaldeen Al-Bitar is the Security
> IMPLEMENTATION owner. A named independent security reviewer, an exception
> authority, and an incident contact are NOT yet evidenced. This is a blocking
> candidate for entry criterion P1-EC-016 and is recorded as such rather than
> papered over.

Every command below was executed on 2026-07-16 on the development host
(Windows 11, Node v24.16.0, npm 11.13.0, Docker Engine 29.5.3). No output is
fabricated; where a result is summarised, the summary matches the measured
outcome.

---

## 1. Secret scan (P1-01-SEC-005)

A scan equivalent to the CI secret-scan patterns was run over all tracked
files and all untracked files that were staged to be committed.

Pattern classes scanned:

| Class                          | Pattern intent                                    |
| ------------------------------ | ------------------------------------------------- |
| JWTs                           | `eyJ`-prefixed three-segment tokens               |
| Supabase secret keys           | `sb_secret_` prefixes                             |
| AWS access keys                | `AKIA` prefixes                                   |
| GitHub tokens                  | `ghp_` / `gho_` / `ghs_` / `github_pat_` prefixes |
| Private keys                   | `-----BEGIN ... PRIVATE KEY-----` blocks          |
| Database URLs with credentials | `postgres://user:password@...` forms              |

**Result: CLEAN.** No match in any tracked file or any untracked file
intended for commit.

`.env.local` exists on the developer machine but is excluded from version
control and was never staged:

```
$ git check-ignore -v .env.local
.gitignore:8:.env.*	.env.local
```

Exit code 0 — the file is matched by the `.env.*` rule at `.gitignore` line 8.

---

## 2. Environment-variable review (P1-01-SEC-005, P1-01-DO-002)

### 2.1 NEXT_PUBLIC_ audit

Next.js inlines only variables prefixed `NEXT_PUBLIC_` into the browser
bundle. The audit (`grep -rn "NEXT_PUBLIC_" src/`) found exactly three
variables validated by the client schema in `src/config/env.ts`, each with a
documented justification:

| Variable                        | Justification for public exposure                                                                                                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | The API endpoint URL is not a secret; it is visible in every browser network request.                                                                                                                                                                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Designed by Supabase to be public. It is only safe because Row-Level Security constrains it — and RLS is NOT yet implemented (no tenant tables exist), which is why RLS is a mandatory Phase 1-2 gate (ADR-004). The code comment in `env.ts` states this explicitly. |
| `NEXT_PUBLIC_APP_ENV`           | An environment label (`local` / `development` / `staging` / `production`), not a credential.                                                                                                                                                                          |

Two further informational values (`NEXT_PUBLIC_APP_VERSION`,
`NEXT_PUBLIC_COMMIT_SHA`) are read in `src/shared/constants/app.ts` with safe
fallbacks; both are non-sensitive build metadata.

### 2.2 Service-role key: server-only and deliberately unwired

`SUPABASE_SERVICE_ROLE_KEY` is defined only in the server schema of
`src/config/env.ts`, is optional in Phase 1-1 because no server-side
privileged operation exists yet, and is never referenced by any client code.
`serverEnv()` throws if invoked in a browser context
(`typeof window !== 'undefined'` guard), so the key cannot reach the client
bundle even by accident.

### 2.3 Validation never echoes values

Environment-validation failures report the variable NAME and the reason only.
The `describe()` formatter in `src/config/env.ts` maps Zod issues by path and
never includes the raw input; the thrown `EnvironmentValidationError` message
ends with "No secret values are shown above by design." The health endpoint's
`environmentIsConfigured()` probe returns a boolean only. This behaviour is
covered by the 10 passing tests in `tests/env.test.ts`.

### 2.4 Logger redaction by key name

See section 9. Redaction is applied by key name, so even a mistakenly logged
context object has secret-shaped keys replaced before serialisation.

---

## 3. Git history check (P1-01-SEC-005)

```
$ git log --oneline --all
a6e0af4 chore(repo): bootstrap RootLco repository

$ git branch --show-current
chore/p1-01-development-readiness
```

At documentation time the repository history comprises two commits: the
bootstrap commit `a6e0af4` (README, LICENSE, `.gitignore` only — an
explicitly authorised initialisation exception, pushed to `main` and
`develop`) and the Phase 1-1 work commit on
`chore/p1-01-development-readiness`, which contains all readiness work
including this document and had not been pushed at documentation time.

Review outcome: nothing sensitive appears anywhere in the history. No
credentials, tokens, keys, or `.env` files were ever committed or staged.
`.env.local` is verified gitignored (section 1).

---

## 4. Dependency audit (P1-01-SEC-004)

```
$ npm audit
```

**Result: 2 moderate findings**, both reached through the `next` dependency
chain:

1. `next` 9.3.4-canary.0 – 16.3.0-canary.5 (advisory range including the
   installed next 16.2.10).
2. `postcss` < 8.5.10 — "XSS via unescaped `</style>`" — reached only through
   `next`.

The only remediation npm offers is a downgrade to `next@9.3.3`, a
semver-major regression of seven major versions, which is not a serious
option for a Next 16 application.

**Decision: ACCEPTED RISK, monitored.** The findings are transitive through
Next.js itself; the project tracks upstream for a patched Next 16 release and
will take it as soon as it exists. `npm audit --omit=dev` (production
dependencies alone) reports the same 2 findings, confirming this is not a
dev-tooling artefact.

---

## 5. Docker review (P1-01-SEC-002)

Verified against running containers, not merely image inspection:

- **Non-root at runtime, verified.** The dev container runs as user `node`
  (uid 1000) and the production runner as user `nextjs` (uid 1001), confirmed
  by executing `id` inside the running containers.
- **No secrets baked into images.** `NEXT_PUBLIC_*` build arguments are
  public by definition; the runner receives configuration at runtime only.
  The production container test (`rootlco-prod-test`) reached healthy in 12
  seconds with runtime placeholder environment variables and no secrets.
- **`.dockerignore` excludes secrets and VCS.** Verified entries: `.env`,
  `.env.*` (with `!.env.example` allowed back), `*.pem`, `*.key`, `*.p12`,
  `*.pfx`, `secrets/`, `.secrets/`, `.git`, `.github`. Nothing in these
  classes can enter the build context.
- **Base image pinning: major version only.** `node:22-alpine` is pinned by
  major version via a Dockerfile `ARG`. Digest pinning is an OPEN hardening
  item, recorded, not done.
- **GitHub Actions pinning: major version only.** Workflow actions are
  pinned by major version tag. SHA pinning is an OPEN hardening item,
  recorded, not done.

---

## 6. Branch protection review (P1-01-SEC-001) — BLOCKED

**Status: BLOCKED — recorded as Blocked, not applied.**

Reason: no GitHub CLI is installed on this machine, no GitHub token is
available, and the owner forbade installing or authenticating tooling during
this run. Branch protection cannot be configured from a git remote alone; it
requires the GitHub web UI or API.

The repository administrator must apply the following manually in
GitHub → Settings → Branches, for **both `main` and `develop`**:

- [ ] Require a pull request before merging (no direct pushes).
- [ ] Require at least 1 approving review before merge.
- [ ] Dismiss stale approvals when new commits are pushed.
- [ ] Require status checks to pass before merging, and mark the CI quality
      job (lint, typecheck, format check, stylelint, tests, build) as
      required once the first CI run has registered it.
- [ ] Require branches to be up to date before merging.
- [ ] Require conversation resolution before merging.
- [ ] Block force pushes.
- [ ] Block branch deletion.
- [ ] Apply the rules to administrators as well (no bypass).

Pull-request creation is blocked for the same reason. Once the working
branch is pushed (pushes retry via `scripts/git-push-retry.sh` because SSH to
the remote is intermittent), the PR is opened manually at:

`https://github.com/Ezzaldeen-Albitar/RootLco/compare/develop...chore/p1-01-development-readiness?expand=1`

PR title: `[P1-01] Complete development readiness, Docker, Supabase, and Sass foundation`, target `develop`.

---

## 7. Repository visibility

The repository `Ezzaldeen-Albitar/RootLco` is expected to be **private**,
consistent with the Confidential classification. This cannot be verified from
this environment: visibility is a GitHub-side setting and no API access or
CLI authentication was available (see section 6). **Action for the
repository administrator:** confirm in GitHub → Settings → General that
visibility is Private, and record the confirmation.

---

## 8. File permissions (Windows / OneDrive context)

The working copy lives under a OneDrive-synchronised user profile directory
on Windows 11. Access is limited to the local user account by standard NTFS
ACLs; nothing in the repository is served to the network from this path. The
only network-exposed surfaces are the local dev/prod containers and the local
Supabase stack, all bound to localhost. No world-readable or world-served
file exposure exists. POSIX-style permission hardening does not apply on this
host; container-side permissions are covered in section 5 (non-root users
verified at runtime).

---

## 9. Logging review (P1-01-SEC-005)

`src/lib/logging/logger.ts` implements structured logging with redaction by
key name:

- **Secret-key redaction, including nested objects and arrays.** Any key
  containing (case-insensitively) `key`, `secret`, `token`, `password`,
  `passwd`, `authorization`, `auth`, `cookie`, `session`, `credential`,
  `connectionstring`, `database_url`, or `dsn` has its value replaced with
  `[REDACTED]` recursively.
- **Error objects are reduced to name and message** — no stack traces or
  attached properties are serialised into log context.
- **`MAX_DEPTH` guard:** recursion stops at depth 6 and emits `[MAX_DEPTH]`,
  preventing pathological or cyclic structures from being dumped.
- The Supabase anon key would also be redacted despite being public by
  design — the code comment notes that redacting it "costs nothing and avoids
  training anyone to expect keys in logs".

Evidence: `npm test` passes 22 tests across 3 files, of which
`tests/logger.test.ts` contributes **7 passing tests** covering the redaction
behaviour above.

---

## 10. HTTP security headers

`next.config.ts` applies a conservative baseline to all routes:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

A Content-Security-Policy is **deliberately deferred** and recorded as an
OPEN item: no real UI exists yet (no visual identity is approved — OIR-06
remains open), and a CSP written against an empty application would be
untested guesswork. The CSP must be authored when the first genuine UI
surfaces arrive.

---

## 11. Explicit non-claims

To keep this evidence honest, the following are stated plainly:

- **NO penetration test has been performed.**
- **NO compliance certification is claimed** — nothing here asserts ISO,
  SOC 2, GDPR, or any other certification status.
- **RLS is NOT implemented.** No tenant tables exist yet, so no Row-Level
  Security policies exist and **no RLS test has ever been executed or
  passed.** RLS is a mandatory Phase 1-2 gate (ADR-004) and must land with
  the first tenant-scoped table.
- Independent QA ownership is not assigned; technical tests were executed by
  Eng. Ezzaldeen Al-Bitar (recorded as a risk / conditional-gate item).
- A named independent security reviewer, exception authority, and incident
  contact are not yet evidenced (P1-EC-016 blocking candidate).
