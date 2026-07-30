# Pre-P1-23 batch 2 — GitHub Actions review

Covers #126–#130, all superseded by the maintainer integration
[#131](https://github.com/Ezzaldeen-Albitar/RootLco/pull/131).

## The finding that decided the shape of this work

**Dependabot's `actions/checkout` pull request (#129) installs a split pin.**

It updates **16** workflow files and leaves the **17th** reference — the one in
the composite at `.github/actions/setup-project/action.yml:138` — on v4.4.0,
because `dependabot.yml`'s `github-actions` entry with `directory: /` **does not
scan `.github/actions/*/action.yml`**.

Merging it would leave two different SHAs for one action:

```
25 × actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 1 × actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
```

The security model requires that **all references to the same action carry the
same SHA**. `WFS-001`/`WFS-002` cannot catch this: they check that each pin _is_
a full SHA with a version comment, never that two references to one action
_agree_. Its CI is green because both versions work.

It is also the wrong half to leave behind. `pr-ci.yml` performs a deliberately
sparse, shallow checkout whose only job is to make the composite resolvable; the
comment above it says so, and **the composite then performs the real exact-head
checkout and replaces the workspace**. Dependabot upgraded the cosmetic
checkouts and left the functional one on the old major.

This is the same defect as the `setup-node` migration in the previous round,
which moved 3 of 24 effective call sites. Same blind spot, same detector gap.

The integration moves all **17**.

## Split-pin verification

After #131, every action resolves to exactly one SHA:

| Action                             | Distinct SHAs | Refs                   |
| ---------------------------------- | ------------- | ---------------------- |
| `actions/checkout`                 | 1             | 26                     |
| `actions/upload-artifact`          | 1             | 20                     |
| `docker/build-push-action`         | 1             | 4                      |
| `actions/setup-node`               | 1             | 4                      |
| `docker/setup-buildx-action`       | 1             | 3                      |
| `aquasecurity/trivy-action`        | 1             | 3                      |
| `actions/download-artifact`        | 1             | 2                      |
| `github/codeql-action/*`           | 1             | 2 (`init` + `analyze`) |
| `hadolint/hadolint-action`         | 1             | 1                      |
| `anchore/sbom-action`              | 1             | 1                      |
| `actions/dependency-review-action` | 1             | 1                      |
| `actions/attest-build-provenance`  | 1             | 1                      |

**12 actions · 0 split pins · 0 mismatched pins · 0 mutable tags.**

## The green checks were proven to have executed the new versions

A green icon does not prove the change ran. For each pull request the job log was
read and the runner's own _"Download action repository"_ line checked:

| PR   | Action → version         | Downloaded SHA                          | Job                                     | Result  |
| ---- | ------------------------ | --------------------------------------- | --------------------------------------- | ------- |
| #126 | codeql-action v4.37.4    | `f205ea1c3313…`                         | `code-security (javascript-typescript)` | success |
| #127 | setup-buildx v4.2.0      | `bb05f3f5519d…`                         | `container-security`                    | success |
| #128 | dependency-review v5.0.0 | `a1d282b36b6f…`                         | `dependency-security`                   | success |
| #129 | checkout v7.0.1          | `3d3c42e5aac5…` **and** `11d5960a3267…` | `unit-coverage`                         | success |
| #130 | build-push v7.3.0        | `53b7df96c91f…`                         | `container-security`                    | success |

The two SHAs on #129 are the split pin, visible in the runner log.

This also settles the **runner requirement** empirically: checkout v7,
dependency-review v5 and build-push v7 all run on Node 24 and require Actions
Runner ≥ v2.327.1. They downloaded and executed successfully, so the hosted
runners satisfy it — proven rather than assumed.

## Per-action exposure

| Action                  | Breaking change                                                                 | Repository exposure                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `checkout` v7           | fork-PR refusal under `pull_request_target`; `allow-unsafe-pr-checkout` opt-out | **none** — no `pull_request_target` workflow exists; plain `pull_request` explicitly unchanged; enforcement already backported to v4 |
| `build-push` v7         | removes `DOCKER_BUILD_NO_SUMMARY`, `DOCKER_BUILD_EXPORT_RETENTION_DAYS`         | **none** — neither used                                                                                                              |
| `setup-buildx` v4       | removes deprecated inputs                                                       | **none** — called with no `with:` block at all                                                                                       |
| `dependency-review` v5  | Node 24 runtime only                                                            | inputs `fail-on-severity: high`, `comment-summary-in-pr: never`, `deny-licenses` all retained                                        |
| `codeql-action` v4.37.4 | patch                                                                           | `init` and `analyze` kept on one SHA                                                                                                 |

## Container integrity

`setup-buildx` and `build-push` were validated as one coupled toolchain, not
independently: both moved in the same commit and the container jobs ran against
the combined tree. `container-security`, `Docker build validation` and the
hosted clean room are green. `push: false` at every call site — **no image is
pushed to any registry**, and no deployment is triggered.

## Pin registry

`docs/engineering/ci-automation/security-model.md` §3 was corrected **in the same
commit** as the workflow changes: five rows updated and the _"`actions/checkout`
remains on v4.4.0"_ exception closed. That table is not maintained by Dependabot
and was left stale once before. It is now re-derived mechanically from the tree —
**12 registry rows, 12 live actions, 0 mismatches**.
