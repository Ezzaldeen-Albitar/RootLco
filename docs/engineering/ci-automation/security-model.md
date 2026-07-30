# Security model

## 1. Threat model for the pipeline itself

The repository is **public**. That changes what matters:

| Threat                                                                 | Control                                                                                                                                                                           |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A compromised third-party action exfiltrates the repository or a token | Every `uses:` pinned to a full commit SHA, enforced by `WFS-001`                                                                                                                  |
| An attacker-controlled pull-request value reaches a shell              | `WFS-006` blocks 17 known-untrusted `github.event.*` expressions; there is no `pull_request_target` anywhere (`WFS-005`)                                                          |
| A workflow leaks a secret into a public log                            | No workflow consumes a repository secret. Scanners report file and pattern class only, never the matched value                                                                    |
| A secret reaches a published artifact                                  | `scan-history.mjs --mode worktree` scans build output; Trivy scans image layers; the container job fails on any credential-shaped value in the image environment or build history |
| Excess token scope                                                     | Workflow default `contents: read`; write scope granted to exactly one job each                                                                                                    |
| A cache poisons a later build                                          | Only the npm download cache and Docker layers are cached, scoped per build target. No database, no security result, no gate decision                                              |
| A green result that means nothing                                      | `check-test-honesty.mjs` (10 rules), and every gate script refuses to report clean over an empty set                                                                              |

## 2. Workflow security rules

Enforced by `scripts/ci/check-workflow-security.mjs` on every pull request.

| Rule    | Enforces                                                                                    |
| ------- | ------------------------------------------------------------------------------------------- |
| WFS-001 | Third-party `uses:` pinned to a full 40-hex commit SHA                                      |
| WFS-002 | A SHA pin carries a `# vX.Y.Z` comment, so a human can tell what it is                      |
| WFS-003 | Every workflow declares top-level `permissions:`                                            |
| WFS-004 | Top-level permissions are read-only                                                         |
| WFS-005 | No `pull_request_target` — _critical_                                                       |
| WFS-006 | No attacker-controlled `github.event.*` value interpolated into a `run:` block — _critical_ |
| WFS-007 | Every multi-line `run:` block begins `set -euo pipefail`                                    |
| WFS-008 | No `\|\| true` or `\|\| :` that discards an exit status                                     |
| WFS-009 | No `continue-on-error: true`                                                                |
| WFS-010 | Every job declares `timeout-minutes`                                                        |
| WFS-011 | A reusable workflow declares exactly ONE job — _critical_                                   |
| WFS-012 | A bootstrap sparse checkout of `.github/actions` stays in cone mode — _critical_            |
| WFS-013 | A Trivy `scanners:` list includes `vuln` — _critical_                                       |
| WFS-014 | No apostrophe inside a single-quoted inline script (`node -e ...`)                          |

**WFS-012 exists because the second hosted run failed in every job.** The
bootstrap checkout that makes a local `uses: ./…` resolvable was written in
NON-CONE mode. `actions/checkout` calls `git sparse-checkout disable` when it is
given no sparse input — but against a non-cone repository that command is a
no-op: `core.sparseCheckout` stays true and no file is restored. Verified by
replaying both checkouts: non-cone leaves 1 file in the workspace, cone leaves
the full tree. The visible symptom was `setup-node` reporting "Dependencies
lock file is not found", three steps from the cause.

The composite action additionally tears down any sparse state before its own
checkout, and asserts afterwards that the number of tracked files on disk
matches the number tracked in git — being at the right COMMIT is not the same
as having the TREE.

**WFS-011 exists because the first hosted run failed at startup.** A caller’s
`permissions:` are the **ceiling for every job** in the workflow it calls,
including jobs an `if:` would skip, and GitHub validates that statically before
any condition is evaluated. The security workflow originally held three jobs
selected by `inputs.task`, so the callers that correctly granted only
`contents: read` were rejected:

```
The nested job 'code-security' is requesting 'security-events: write',
but is only allowed 'security-events: none'.
```

Granting SARIF write to every caller would have made it start while handing
write scope to the job whose whole purpose is pattern-matching over
untrusted-adjacent text. The file was split into `_reusable-secret-scan.yml`,
`_reusable-dependency-security.yml` and `_reusable-code-security.yml` — one
job, one fixed permission set each.

A suppression must name the rule and sit on the line or in the comment block
immediately above it. There are exactly **two** in the repository, both with the
reason written out in full:

- `_reusable-release-artifact.yml` — attestation may be unavailable on this plan;
  the next step inspects the outcome and downgrades the recorded provenance to
  `manifest-only`, so the failure changes the _claim_ rather than being ignored.
- `nightly-assurance.yml` — `continue-on-error` scoped to the _experimental_
  compatibility rows only. The supported pair (`node 22` / `postgres 17`) has
  `experimental: false`, so its failure still fails.

## 3. Action pinning

| Action                             | Pin                                        | Version |
| ---------------------------------- | ------------------------------------------ | ------- |
| `actions/checkout`                 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1  |
| `actions/setup-node`               | `820762786026740c76f36085b0efc47a31fe5020` | v7.0.0  |
| `actions/upload-artifact`          | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | v7.0.1  |
| `actions/download-artifact`        | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` | v8.0.1  |
| `actions/dependency-review-action` | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` | v5.0.0  |
| `actions/attest-build-provenance`  | `0f67c3f4856b2e3261c31976d6725780e5e4c373` | v4.1.1  |
| `github/codeql-action/*`           | `f205ea1c3313d32999d8d6a48b4f6530d4437b38` | v4.37.4 |
| `docker/setup-buildx-action`       | `bb05f3f5519dd87d3ba754cc423b652a5edd6d2c` | v4.2.0  |
| `docker/build-push-action`         | `53b7df96c91f9c12dcc8a07bcb9ccacbed38856a` | v7.3.0  |
| `aquasecurity/trivy-action`        | `ed142fd0673e97e23eac54620cfb913e5ce36c25` | v0.36.0 |
| `hadolint/hadolint-action`         | `2332a7b74a6de0dda2e2221d575162eba76ba5e5` | v3.3.0  |
| `anchore/sbom-action`              | `e22c389904149dbc22b58101806040fa8d37a610` | v0.24.0 |

All from trusted publishers: GitHub itself, Docker Inc., Aqua Security, hadolint,
Anchore.

**Pinning rule.** Every reference is a full 40-character commit SHA with a
trailing `# vX.Y.Z` comment, and **all references to the same action carry the
same SHA**. A tag or a floating major is never acceptable.

**Major-version rule — amended.** This section previously said pins stay
"within the major line the repository already proves works — deliberately not
the newest major". That was the rule while the pipeline was being built, and the
pre-P1-23 dependency-maintenance gate deliberately changed it: five actions were
migrated to their newest major (`upload-artifact` v4 → v7,
`download-artifact` v4 → v8, `setup-node` v4 → v7,
`attest-build-provenance` v2 → v4, `github/codeql-action` v3 → v4). The rule
now is that a newest-major migration is permitted **when it is proven on the
current tree**, which for that gate meant: every changed workflow read line by
line, every pinned SHA resolved against its claimed tag, both halves of any
coupled pair moved together, and a complete green check population on the
resulting tree — not on the stale base a bot proposed it against.

`actions/checkout` has since moved to **v7.0.1**, so the exception recorded
here is closed. It was proven on the current tree by the pre-P1-23 maintenance
batch: the fork-PR protection v7 introduces applies to `pull_request_target`,
which this repository does not use anywhere, and GitHub backported that
enforcement to v4 regardless; every input still used (`sparse-checkout`,
`fetch-depth`, `persist-credentials`, `ref`) survives v7; and the composite at
`.github/actions/setup-project/action.yml` was moved in the SAME change as the
sixteen workflows, because Dependabot proposed only the sixteen.

**There is no longer any action pinned below its newest proven major.**

Two lessons are recorded rather than smoothed over. **Coupled pairs must move
together**: `github/codeql-action/analyze` bumped alone broke every CodeQL leg
with "Loaded a configuration file for version '3.37.3', but running version
'4.37.3'", and `vitest` bumped without `@vitest/coverage-v8` broke `npm ci`
outright. **A pin can hide outside `.github/workflows/`**: the composite at
`.github/actions/setup-project/action.yml` holds the `setup-node` reference
that 15 workflows and 21 call sites actually use, and `dependabot.yml`'s
`github-actions` entry with `directory: /` does **not** see it — so the first
attempt at that upgrade moved 3 of 24 call sites and left the other 21 on the
old major. WFS-001/WFS-002 check that each pin _is_ a SHA with a comment, not
that two references to one action _agree_, so nothing detected the split.

`actionlint` is downloaded rather than used as an action, and its tarball is
verified against a SHA-256 checksum that was confirmed against the publisher's
own checksums file. A linter fetched over the network is itself a supply-chain
input.

Dependabot proposes pin updates, including the trailing version comment — which
is exactly the maintenance burden that makes teams abandon SHA pinning. It does
not keep them correct on its own, and this table is not maintained by it: it
cannot see `.github/actions/*/action.yml`, it moves one half of a coupled pair,
and it proposes against whatever base its branch was cut from. Every entry above
is a maintainer decision, and this table is the record that must be updated in
the same change as the workflows.

## 4. Dependency policy

Asymmetric, because the two trees have different blast radii.

**Production** (`npm audit --omit=dev`) — code that ships inside the runtime
image. HIGH or CRITICAL **fails, with no exceptions**. The exceptions file is not
consulted.

**Development** — code that runs on a developer machine or a CI runner and is
never copied into the `runner` stage. HIGH or CRITICAL fails unless the advisory
has an itemised entry with a reason, an owner and an unexpired review date.

### What was found and fixed

At the audit baseline the production path carried **3 HIGH findings covering 13
advisories**:

| Package          | Advisories                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next@16.2.10`   | GHSA-6gpp-xcg3-4w24 proxy bypass · GHSA-89xv-2m56-2m9x SSRF · GHSA-p9j2-gv94-2wf4 SSRF · GHSA-955p-x3mx-jcvp unauthenticated Server Function disclosure · GHSA-68g3-v927-f742 and GHSA-4633-3j49-mh5q cache confusion · GHSA-m99w-x7hq-7vfj DoS · GHSA-4c39-4ccg-62r3 unbounded payload · GHSA-q8wf-6r8g-63ch image DoS |
| `postcss@8.4.31` | GHSA-qx2v-qp2m-jg93 · GHSA-6g55-p6wh-862q · GHSA-r28c-9q8g-f849                                                                                                                                                                                                                                                         |
| `sharp@0.34.5`   | GHSA-f88m-g3jw-g9cj (libvips CVE-2026-33327/33328/35590/35591)                                                                                                                                                                                                                                                          |

Closed by `next` 16.2.10 → 16.2.12, plus `overrides` for `postcss ^8.5.24` and
`sharp ^0.35.3`. The overrides were necessary because Next pins `postcss` at
_exactly_ 8.4.31, and npm's only suggested remedy was downgrading Next to 9.3.3.

**Production is now at zero.**

### Status

**Production dependency advisories: Resolved through compatible patch upgrades.**

**brace-expansion advisory: Open — upstream-blocked development-tooling exception
with no proven production or runtime reachability.**

### The one development exception

`GHSA-mh99-v99m-4gvg` in `brace-expansion`, reaching the tree through `minimatch`
→ eslint, its plugins, and `@vitest/coverage-v8`.

It has **no consumable fix**. The advisory affects every release up to and
including 5.0.7; the only patched release is 5.0.8, whose changed export shape
breaks `minimatch` — verified by execution, not assumed: overriding to `^5.0.8`
makes `npm run lint` fail with `TypeError: expand is not a function` at
`Minimatch.braceExpand`. There is no patched release in the 1.x, 2.x, 3.x or 4.x
lines for `minimatch` to consume, and npm's own `fixAvailable` names
`eslint@10.8.0` with `isSemVerMajor: true`.

The override was reverted completely and must not be reintroduced. ESLint is not
weakened, no rule is disabled, and no lint coverage is removed.

Of the three resolved instances, **one is already patched**: `minimatch@10.2.5`
requires `^5.0.5`, so `node_modules/brace-expansion` resolves to 5.0.8. Only the
1.1.16 and 2.1.3 instances are affected, and npm's `nodes` list names exactly
those two.

Full evidence:
[`evidence/brace-expansion-reachability-proof.md`](evidence/brace-expansion-reachability-proof.md).

| Question                                    | Answer                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| Production-tree instances                   | **0** — `npm ls brace-expansion --omit=dev --all` returns `(empty)`       |
| Production audit                            | **0 vulnerabilities**                                                     |
| Code present in the built runner image      | **YES, unavoidably** — Node vendors it into the `node` binary via esbuild |
| Resolvable as a package in the runner image | **no** — no `node_modules/brace-expansion/`, asserted against the image   |
| Imported by `src/` or `scripts/`            | **no**                                                                    |
| Attacker-controlled patterns reach it       | **no** — every glob comes from committed configuration                    |
| Exploitability in RootLco's runtime         | **not reachable based on current evidence**                               |

The first two rows must be read together, and separating them is the whole
point. An earlier version of this table claimed only that the package was not
"present in the built runner image", which read as _the vulnerable code is
absent_. That was false: absence was never achievable, because the `node` binary
itself contains a vendored copy that no build step can remove. The achievable —
and sufficient — claim is the second row: nothing in the image can resolve or
`require()` the package, so the running application cannot invoke it.

Owner: platform-owner. Created 2026-07-28, review 2026-09-30, **expires
2026-10-31**. Approval status: **APPROVED by the platform owner on 2026-07-29**,
with the basis and the explicit scope limits recorded in the entry. The gate now
REQUIRES an approved, signed and dated entry: an unapproved exception waives
nothing, because a risk acceptance the machine ignores is not a control.

### What makes it an _exact_ exception

One advisory, one package, one affected range, one dependency-path fingerprint,
one expiry. The gate fails if any of them stops matching:

| Rule | Fails when                                                                          |
| ---- | ----------------------------------------------------------------------------------- |
| 1    | `npm audit` errored or produced malformed output                                    |
| 2    | — production and development findings are reported separately                       |
| 3    | any unwaived Critical/High production finding exists                                |
| 4    | an exception lacks evidence, an owner, or any required field                        |
| 5    | an exception matches nothing                                                        |
| 6    | an exception has passed its expiry                                                  |
| 7    | the package becomes production-reachable, enters the image, or is imported directly |
| 8    | the resolved dependency nodes stop matching the recorded ones                       |
| 9    | a **compatible** patched version becomes available while the exception remains      |
| 10   | — the report separates resolved, blocked, waived, reachability and expiry           |

Every rule has a mutation test in
[`tests/ci/dependency-gate.test.ts`](../../../tests/ci/dependency-gate.test.ts):
remove the exception, broaden its range, omit the dependency path, claim
production-safety without evidence, expire it, add an unwaived High, return an
audit error object, make the package production-reachable, and land a compatible
patched version while keeping the exception. Each makes the gate fail. Deleting
a _rule_ makes its test fail — verified.

Transitive nodes are resolved to their **root** advisory before being matched.
Waiving twelve package names for one problem would overstate the damage and,
worse, mean a genuinely new advisory in `eslint` landed on an already-waived name
and passed silently. The exact-match rules apply to the direct match only —
comparing the waiver's recorded package and nodes against an _ancestor_ would
compare two different things.

### Prohibited packages

Nine, each with the reason recorded: `event-stream`, `flatmap-stream`,
`node-ipc`, `colors`, `faker`, `request`, `coa`, `rc`, `ua-parser-js`.

### Licences

AGPL-3.0 (all variants) and SSPL-1.0 are refused as incompatible with a
proprietary product. Enforced twice — by `dependency-review-action` on a pull
request and offline by `dependency-policy.mjs` — so an outage of the action
cannot silently drop the control. Current tree: MIT 468, ISC 27, Apache-2.0 23,
BSD-3 8, BSD-2 7, and a long tail; zero disallowed.

## 5. Secret scanning

Four layers:

| Layer            | Scope                                                                                               | When     |
| ---------------- | --------------------------------------------------------------------------------------------------- | -------- |
| Tracked files    | `check-tracked-secrets.mjs` over tracked text                                                       | every PR |
| Browser exposure | `check-browser-exposed-secrets.mjs` — the service-role key must never carry a `NEXT_PUBLIC_` prefix | every PR |
| Build output     | `scan-history.mjs --mode worktree` over `.next`, `public`, `docs/api`                               | every PR |
| Git history      | `scan-history.mjs --mode history` over every commit reachable from any ref                          | nightly  |

Twelve high-signal patterns: private-key headers, AWS access and secret keys,
GitHub classic and fine-grained tokens, Supabase secret keys, JWT triples,
PostgreSQL URLs with an inline password, Docker registry auth, Slack tokens,
Stripe live keys, Google API keys. Deliberately narrow — a broad entropy
heuristic produces a week of false positives and is then switched off, which is
worse than not having it.

**The matched text is never recorded.** Not in the log, not in an artifact, not
in the JSON. Findings name the file and the pattern class only. A scanner that
echoes what it found turns a public Actions log into the disclosure it exists to
prevent.

### Allow-list

Nine entries, each naming **one file and one pattern class**. There is no
class-wide suppression: waiving a whole token class is how a real credential
later slips past. Three are historical-only — synthetic fixtures in commits that
have since been rewritten to construct their prefixes at runtime, and which the
current-tree scanner therefore no longer sees.

### Preflight result

Full history (438 commits) and the entire working tree were scanned. **No real
credential exists in this repository, past or present.** Every match is a
documented placeholder, a redaction-test fixture, a documentation example of the
detector's own shape, or a throwaway service-container value.

## 6. Container security

- Fixable CRITICAL/HIGH **block**. Unfixable ones are reported — the action there
  is to change or rebuild the base image, and conflating that with "bump a
  package" teaches people to ignore the gate. The nightly deep scan drops the
  filter so the full picture is always visible.
- **Any secret in a layer blocks**, whatever its severity or fixability. A
  credential in an image cannot be waited out.
- Runtime identity asserted as exactly `1001:1001`, not merely `uid != 0`. The
  weaker check would pass if the image silently started running as the built-in
  `node` user (1000), which owns more than the application needs.
- The image environment, the filesystem and the build history are each searched
  for credential-shaped values, `.env` files and key material.
- The container is **started** and must serve `/api/health`. A build that
  produces an image which exits immediately is a green build and a broken
  deployment; an exited container is detected rather than waited out.

## 7. GitHub-native security features — OWNER ACTION REQUIRED

Carried forward from P1-21 as **P1-21-A-01**, still open:

| Feature                         | State                                                                                                                                               | Effect                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Secret scanning                 | **disabled**                                                                                                                                        | GitHub is not watching pushes for known credential formats            |
| Push protection                 | **disabled**                                                                                                                                        | A credential can be pushed without being blocked at the point of push |
| Dependabot alerts               | **disabled**                                                                                                                                        | No alert when a new advisory lands against an installed version       |
| Dependabot security updates     | **disabled**                                                                                                                                        | No automatic remediation pull request                                 |
| Code scanning                   | **not configured**                                                                                                                                  | The Security tab has no default setup                                 |
| Dependency graph                | **disabled** — `dependency-review-action` cannot run without it; the job probes for it and records its absence rather than failing the pull request |
| Private vulnerability reporting | not configured                                                                                                                                      | No private channel for an external reporter                           |

**The absence of alerts is not evidence of cleanliness — nothing is watching.**

These are repository settings, not repository content, so no pull request can
change them. All are free on a public repository. Settings → Code security:

1. Enable **Secret scanning** and **Push protection**.
2. Enable **Dependabot alerts** and **Dependabot security updates**
   (`dependabot.yml` in this change configures the _version_ updates; alerts and
   security updates are separate switches).
3. **Code scanning** — the repository now ships its own CodeQL workflow, so
   choose _Advanced_ rather than _Default_, or the two will run twice.
4. Consider enabling **private vulnerability reporting**.

Until step 3 is done, CodeQL SARIF upload may fail on a plan where code scanning
is not enabled. The workflow attaches the SARIF as an artifact regardless, so the
findings are never lost.
