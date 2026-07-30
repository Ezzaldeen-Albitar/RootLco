# Pre-P1-23 batch 2 — Dependabot policy

Ten separate pull requests in one morning is the symptom this section addresses.
The configuration changes below are derived from **what actually went wrong**, not
from a general preference for fewer pull requests.

## Why ten arrived

| PR                    | Why it was not grouped                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| #121 `eslint` 10      | major — correctly ungrouped                                                                     |
| #122 `sass`           | minor, dev — **the `dev-tooling` group listed packages by hand and `sass` was not on the list** |
| #123 `@types/node` 26 | major — correctly ungrouped                                                                     |
| #124 `pino` 10        | major, production — correctly ungrouped                                                         |
| #125 `supabase`       | minor, dev — **also missing from the hand-written list**                                        |
| #126 actions group    | correctly grouped — the CodeQL pair                                                             |
| #127–#130             | majors — correctly ungrouped                                                                    |

So seven of the ten were majors and _should_ be individual. The avoidable noise
was #122 and #125: a hand-maintained package list silently missed two dev
dependencies. A list that has to be remembered will be forgotten.

## Changes made

### npm — coupled pairs get their own groups

The headline change is not about volume. `@vitest/coverage-v8` pins `vitest` as
an **exact** peer, and a lone `vitest` bump fails `npm ci` outright — that was
PR #99, thirteen red checks from one install failure. Putting both patterns in
one group makes Dependabot propose them as a **single pull request** for every
minor and patch, so the half-move cannot recur in the compatible range.

```yaml
vitest-coupled:
  patterns: ['vitest', '@vitest/*']
  update-types: [minor, patch]
```

The ESLint stack gets the same treatment, for the same reason from the other
direction: ESLint 10 was refused because three plugins reached through
`eslint-config-next` still declare `eslint: ^9`. A lone plugin bump can break
lint just as a lone `eslint` bump can.

```yaml
eslint-stack:
  patterns: ['eslint', 'eslint-*', '@eslint/*', 'typescript-eslint', '@typescript-eslint/*']
  exclude-patterns: ['eslint-config-next'] # belongs to next-and-react
  update-types: [minor, patch]
```

### npm — the hand-written lists are gone

`dev-tooling` now matches **all** development dependencies at minor and patch,
excluding the coupled groups above so they keep their own pull request.
`production-patches` becomes `production-updates` and widens from patch-only to
patch **and** minor — patch-only is why a production minor arrived alone.

Both keep the framework packages out, since `next-and-react` already governs them.

### Groups stay small enough to diagnose

Four npm groups, not one. A single "everything" group would collapse the ten into
one pull request whose failure tells you nothing. The split is by _failure
domain_: framework, ESLint stack, Vitest pair, remaining dev tooling, production.

### Majors stay separate

No group declares `major`. Every semver-major continues to arrive as its own
pull request requiring individual review. Unrelated major runtime, tooling and
action changes are never grouped together.

### GitHub Actions

Unchanged — `patterns: ['*']`, `update-types: [minor, patch]`. It behaved
correctly this round: it collected the CodeQL `init`+`analyze` patch pair
**together** and left the four majors standalone.

Note the residual limitation, which configuration cannot fix: `directory: /` does
**not** scan `.github/actions/*/action.yml`, so Dependabot will keep proposing
composite-blind action updates. That is why #129 shipped a split pin and why the
integration had to add the seventeenth reference by hand.

## Security updates — the mechanism, stated correctly

The previous round's record claimed a `version-update:semver-*` ignore "does not
affect security updates". **That is false as a general rule** and was corrected;
it is repeated here because it is the sentence a future maintainer will act on.

From GitHub's options reference, read from raw source:

- `## ignore` carries **both** the Version-updates and **Security-updates**
  markers, and the page states: _"All options marked with a \[shield-check\]
  Security updates icon also change how Dependabot creates pull requests for
  security updates, **except where `target-branch` is used**."_
- `### update-types (ignore)` contains **no** security carve-out. The exemption
  sentence exists only under `### update-types` (**`allow`**).

Security coverage survives here **only** because `target-branch: develop` takes
the whole npm block out of scope for security updates, which always use the
default branch. That mechanism is now named in the file itself, with a warning
against removing `target-branch`.

No security update is disabled. No blanket ignore exists.

## Deferred majors — exact, never blanket

| Package                                               | Ignore            | Tracking issue                                                  |
| ----------------------------------------------------- | ----------------- | --------------------------------------------------------------- |
| `typescript`                                          | semver-major only | [#117](https://github.com/Ezzaldeen-Albitar/RootLco/issues/117) |
| `vitest`                                              | semver-major only | [#118](https://github.com/Ezzaldeen-Albitar/RootLco/issues/118) |
| `@vitest/coverage-v8`                                 | semver-major only | [#118](https://github.com/Ezzaldeen-Albitar/RootLco/issues/118) |
| **`eslint`**                                          | semver-major only | [#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132) |
| **`@types/node`**                                     | semver-major only | [#133](https://github.com/Ezzaldeen-Albitar/RootLco/issues/133) |
| `next`, `react`, `react-dom`, `@supabase/supabase-js` | semver-major only | framework policy                                                |

Every entry carries `update-types: ['version-update:semver-major']`. **Patches
and minors continue to arrive for all of them.** There is no
`dependency-type: development` blanket ignore and no bare `dependency-name`
without `update-types` — the latter matters, because a bare name _would_ suppress
security updates.

## Validation

Validated structurally in the maintenance run itself: **9 npm ignore entries, all
`version-update:semver-major` only; 5 npm groups, none declaring `major`; no
blanket `dependency-type` ignore; no bare `dependency-name`.** The repository's
workflow-security gates also cover `.github/`.

> **A correction.** An earlier draft claimed the configuration "is checked by
> GitHub's own Dependabot configuration check, which appears as the
> `.github/dependabot.yml` check-run **on every commit**". That is not true: the
> check-run appears on some commits (for example `b5e4f6f9`) and **not** on
> others (it is absent from `027024d5`). Citing it as a standing guarantee
> overstated the validation, so the structural assertions above — which are
> re-derived on demand — are what this record relies on.

## Expected effect

Applied to this batch, the new grouping would have produced roughly **7 pull
requests instead of 10** — `sass` and `supabase` folded into `dev-tooling`, and
the CodeQL pair already grouped. The seven majors would still have arrived
individually, which is correct: each needed its own review, and one of them was
red.
