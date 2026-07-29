# CSA-22 — the ten IAM idempotency waivers

Not a CodeQL finding. It is closed here because it could not be closed anywhere
else without turning `develop` red.

## The finding

The Comprehensive CI/CD initiative's first run of
`scripts/ci/check-idempotency-evidence.mjs` found **ten P1-14 IAM and
organisation-settings operations declaring `idempotent: true` with nothing
exercising the promise**:

`iam.approval-limit-create` · `iam.grant-issue` · `iam.grant-scope-add` ·
`iam.invitation-create` · `iam.invitation-activate` · `iam.role-create` ·
`iam.role-permission-add` · `iam.user-status-change` ·
`iam.branch-settings-write` · `iam.company-settings-write`

They were recorded as named, expiring exceptions rather than accepted quietly.
`idempotent: true` is a promise to the caller that a retry will not double-write
state, audit or outbox; whether the code honoured it was a P1-14 question a CI
initiative could not settle.

## Why the evidence branch could not merge alone

`fix/p1-14-idempotency-replay-evidence@c27b2a0` carried replay tests for exactly
those ten. The CI gate record predicted the hazard:

> when it lands, these exceptions become stale and nothing will flag the overlap
> automatically

That was right, and it is stronger than "stale" suggests. Measured on the
reconciled tree with the evidence present and the ten entries still in place:

```
Operations declared in routes      199
Declaring idempotent: true         107
With replay evidence               107
Without replay evidence              0
…of which waived                     0

❌ ×10  idempotency exception for `iam.…` matches nothing …
EXIT 1
```

`check-idempotency-evidence.mjs` marks an exception `used` only inside
`consider()`, which runs for **unproven** operations. Give an operation
evidence and its waiver becomes unmatched — a **hard failure**, not a warning.

That gate is called unconditionally by `_reusable-integration-tests.yml` under
`set -euo pipefail`, and `integration-tests` is a `ci-gate` dependency. It also
runs on the protected push. So merging the branch on its own would have turned
`develop` red immediately after the merge, with no way to fix it except a second
change.

The evidence and the removal are mutually blocking. They landed together.

## How it was reconciled

**Provenance preserved.** All four files the branch touches were byte-identical
between its parent `0f8268e` and `develop 4cb0bbb`, so a cherry-pick applied
cleanly:

```
git cherry-pick -x c27b2a06680b1325a76b08c0f7f6ff51e2174711
```

Author `Ezzaldeen-Albitar`, original date preserved, `(cherry picked from …)`
recorded in the message.

| File                                                          | Lines    |
| ------------------------------------------------------------- | -------- |
| `tests/backend/p1-14-idempotency-replay.test.ts`              | 801, new |
| `scripts/check-operation-test-coverage.mjs`                   | 76       |
| `docs/phase-1/phase-1-14/evidence/operation-test-matrix.json` | 114      |
| `tests/foundation/operation-coverage-gate.test.ts`            | 19       |

Zero files under `src/`.

**The matrix was not hand-carried.** `npm run validate:operation-coverage`
regenerates all seven matrices as a side effect, and
`_reusable-integration-tests.yml` asserts a clean worktree with a pathspec that
does **not** exclude `docs/phase-1/**/operation-test-matrix.json`. Run on the
reconciled tree: **zero drift**. The committed JSON is the tool's own output
here, not an artifact from another commit.

**The exceptions were emptied in the same change.** `operations: []`, with a
`closure` block recording the finding, the date, the evidence file, the source
SHA, and — in `whyNotMergedSeparately` — the measurement above.

## After

```
Declaring idempotent: true         107
With replay evidence               107
Without replay evidence              0
…of which waived                     0
EXIT 0
```

**No defect was found in any of the ten.** All ten really are idempotent —
which is what the exception list existed to establish rather than assume.

## Four documents that still claimed ten live waivers

Nothing in CI reconciles prose against that JSON, so all four would have gone
quietly stale — the AR-51 problem again:

- `automated-testing-strategy.md`
- `execution-checkpoint.md`
- `gate-record.md`
- `pull-request-body.md`

All four now say closed. The gate record's two open items are **struck through
rather than deleted**, so the prediction and its outcome stay visible together.

## What the replay tests prove

For each of the ten, through the **real exported route handler** on the deployed
`app_runtime` identity — the only depth at which the declaration under test
exists, since it is `route-handler.ts` that reads `Idempotency-Key` and builds
the principal-bound fingerprint:

- same key + same payload returns the stored response
- the retry writes no second row, no second audit record, no second outbox event
- same key + a **different** payload is refused with the controlled conflict
  rather than silently replayed
- the fingerprint is principal-, route- and method-bound
