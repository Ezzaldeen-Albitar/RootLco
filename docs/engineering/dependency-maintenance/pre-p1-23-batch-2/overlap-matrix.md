# Pre-P1-23 batch 2 — overlap matrix

Computed mechanically from each pull request's own patch: every `uses:` line and
every `package.json` version line was extracted and grouped by identifier. No
decision here rests on a pull-request title or group name.

## Result: zero dependency overlap

**No dependency appears in more than one pull request.**

| Action identifier                  | Moved by |
| ---------------------------------- | -------- |
| `actions/checkout`                 | #129     |
| `actions/dependency-review-action` | #128     |
| `docker/build-push-action`         | #130     |
| `docker/setup-buildx-action`       | #127     |
| `github/codeql-action/init`        | #126     |
| `github/codeql-action/analyze`     | #126     |

| npm package   | Moved by |
| ------------- | -------- |
| `@types/node` | #123     |
| `eslint`      | #121     |
| `pino`        | #124     |
| `sass`        | #122     |
| `supabase`    | #125     |

**Overlapping dependencies: 0.** There is therefore no group-versus-standalone
duplication to resolve, and no pull request needs closing on the grounds that
another one already carries its dependency.

## The overlap everyone expects, and why it is not there

#126 is titled _"Bump the actions group with 2 updates"_, sitting beside four
standalone GitHub Actions pull requests. The obvious reading is that the group
duplicates some of them.

It does not. The two members are `github/codeql-action/init` and
`github/codeql-action/analyze`, v4.37.3 → v4.37.4. No standalone pull request
touches `github/codeql-action`.

The reason is the configuration working as intended: the `actions` group is
declared `update-types: [minor, patch]`, so it can only ever collect
minor and patch bumps. CodeQL v4.37.3 → v4.37.4 is a patch and was collected —
**including both halves of the coupled pair**, which is precisely the failure
mode that broke every CodeQL leg in the previous round. The other four are
**majors**, which the group cannot collect, so they arrived standalone. Correct
behaviour in both directions.

## Where the real collisions are: files, not dependencies

Five workflow files are edited by more than one pull request. This is textual
merge-conflict risk and sequencing cost — not duplicate dependency updates.

| File                                                  | Edited by        |
| ----------------------------------------------------- | ---------------- |
| `.github/workflows/ci.yml`                            | #127, #129, #130 |
| `.github/workflows/_reusable-container.yml`           | #127, #129, #130 |
| `.github/workflows/_reusable-code-security.yml`       | #126, #129       |
| `.github/workflows/_reusable-dependency-security.yml` | #128, #129       |
| `.github/workflows/_reusable-release-artifact.yml`    | #127, #129       |

#129 alone touches 16 files and therefore collides with all four of the others.
Merging the five one at a time would mean four rebases and four intermediate
trees, none of which is the tree that finally ships.

## The other collision: `package.json` and `package-lock.json`

All five npm pull requests (#121–#125) edit **both** `package.json` and
`package-lock.json`. Any two of them conflict textually. **At most one could ever
be merged as-is**; the rest would need a Dependabot rebase and a fresh CI cycle
each.

## Canonical path chosen

One canonical path per overlapping set, as required:

| Set                             | Canonical path                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions (#126–#130)      | **one maintainer integration PR** — [#131](https://github.com/Ezzaldeen-Albitar/RootLco/pull/131)                                                                    |
| npm accepted (#122, #124, #125) | **one maintainer integration PR** — #135                                                                                                                             |
| npm refused (#121, #123)        | deferred and closed against issues [#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132) / [#133](https://github.com/Ezzaldeen-Albitar/RootLco/issues/133) |

**No group and standalone pull request for the same dependency is merged**, because
no such pair exists. Every superseded pull request is closed only after its
replacement is open and its version coverage is proved line by line — see
[`review-adjudication.md`](review-adjudication.md).
