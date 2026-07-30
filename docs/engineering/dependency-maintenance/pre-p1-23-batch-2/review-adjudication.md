# Pre-P1-23 batch 2 — review adjudication

## Supersession proofs

A pull request is closed as superseded only when its dependency is **fully
covered elsewhere**, **no unique change is lost**, and the replacement is
**already open or merged**. Each claim below was checked against the replacement
branch's own content, not asserted.

### #126–#130 → [#131](https://github.com/Ezzaldeen-Albitar/RootLco/pull/131) (merged `027024d5`)

| PR   | Proposed                                                  | Present in #131                            | Unique content lost          |
| ---- | --------------------------------------------------------- | ------------------------------------------ | ---------------------------- |
| #126 | `codeql-action/init` + `/analyze` → v4.37.4 (`f205ea1c…`) | both, one SHA                              | none                         |
| #127 | `setup-buildx-action` → v4.2.0 (`bb05f3f5…`)              | 3 refs                                     | none                         |
| #128 | `dependency-review-action` → v5.0.0 (`a1d282b3…`)         | 1 ref                                      | none                         |
| #129 | `checkout` → v7.0.1 (`3d3c42e5…`)                         | **26 refs — 17 files, one more than #129** | none; #131 is a **superset** |
| #130 | `build-push-action` → v7.3.0 (`53b7df96…`)                | 4 refs                                     | none                         |

#129 is the only case where the replacement is not identical: it is strictly
larger. #129 changes 16 files; #131 changes 17, adding
`.github/actions/setup-project/action.yml`. Closing #129 loses nothing and gains
the fix for the split pin it would have introduced.

### #122, #124, #125 → #135

| PR   | Proposed              | Present in #135            | Unique content lost |
| ---- | --------------------- | -------------------------- | ------------------- |
| #122 | `sass` `^1.102.0`     | `^1.102.0`, locked 1.102.0 | none                |
| #124 | `pino` `^10.3.1`      | `^10.3.1`, locked 10.3.1   | none                |
| #125 | `supabase` `^2.110.0` | `^2.110.0`, locked 2.110.0 | none                |

Each pull request's only content was its `package.json` line and the matching
lockfile entry. Verified against the **replacement branch**
(`maint/batch-2-npm-policy-records`) — its `package.json` and regenerated
`package-lock.json`. (An earlier draft said "verified against
`develop:package.json` after merge"; at the time of writing #135 had not merged
and `develop` still carried the old versions, so that named the wrong evidence
source.)

## Deferrals — not superseded

#121 and #123 are **deferred and closed**, explicitly _not_ superseded: no
replacement carries either upgrade, and calling them superseded would be untrue.
Each closure comment states the exact reason, links the tracking issue, cites the
reproduction, and gives the revisit condition. Both issues existed **before**
either pull request was closed.

| PR                    | Issue                                                           | Reason                                                                                        |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| #121 `eslint` 10      | [#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132) | upstream — three plugins declare `eslint: ^9`; `eslint-plugin-react` crashes on a removed API |
| #123 `@types/node` 26 | [#133](https://github.com/Ezzaldeen-Albitar/RootLco/issues/133) | policy — types would run ahead of the Node 22 runtime                                         |

## Independent adversarial review

Fifteen read-only lenses were run against this batch before closure, covering PR
inventory accuracy, overlap and group decisions, ESLint compatibility, Node
types and runtime, Pino and logging security, Supabase and database
compatibility, checkout and repository integrity, dependency-review security
policy, Docker actions and image integrity, action-pin consistency, supply chain
and lockfile integrity, Dependabot policy and security-update behaviour, CI
hidden checks and waiter honesty, deployment safety, and documentation and
governance claims.

Every Critical and High finding was reproduced personally before being accepted
or refuted. Outcome and the corrections applied are recorded in
[`execution-checkpoint.md`](execution-checkpoint.md).

## Things this batch got wrong, recorded rather than smoothed over

**The `brace-expansion` / ESLint 10 expectation was wrong.** The standing note
said ESLint 10 was _"plausibly the upstream fix that removes the waiver
entirely"_, because the exception records
`fixAvailable: {eslint@10.8.0, isSemVerMajor: true}`. #121's own
`dependency-security` log disproved it: ESLint 10 is a **partial** fix that swaps
one affected node for another — eslint's own chain becomes patched at 5.0.8, but
`eslint-config-next`'s plugins introduce `brace-expansion@1.1.18`. Development
advisories stay at 9. The waiver survives against a different fingerprint.

**Two pull-request titles did not match their contents**, again. #125 declares a
range move of `^2.34.3 → ^2.110.0`, not the one-minor step its title states; and
#126's _"2 updates"_ names nothing, hiding that it is the coupled CodeQL pair.
The inventory was built from patches for exactly this reason.
