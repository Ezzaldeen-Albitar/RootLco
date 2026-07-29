# Correction: "0 open findings" was measured on a partial analysis

**The claim was wrong. It is retracted here, and every document that carried it
is corrected rather than quietly amended.**

## What was claimed

> Fixed 21 · Refuted 0 · Dismissed 0 · **Open 0** · Unreviewed 0.

That sentence reached the README, PR #92's body, and the merge commit now on
`develop`.

## What is true

GitHub's own alert list for `refs/heads/develop`, immediately after the merge:

```
3 OPEN — 2 high, 1 medium
#28 high    js/remote-property-injection    src/server/http/validation.ts:111
#10 high    js/insufficient-password-hash   src/server/http/idempotency.ts:327
#33 medium  js/http-to-file-access          scripts/ci/check-commit-checks.mjs:252
```

**19 of the 21 backlog alerts closed. The two application alerts never did.**

## How a green pipeline said otherwise

Every run verified before the merge was a **pull-request** run, and CodeQL
analyses pull requests `diff-informed` — it reports findings in changed regions,
not across the tree. The first full-tree analysis was the push to `develop`
_after_ the merge, and it failed immediately:

```
open findings rose to 2, above the recorded ceiling of 0.
```

**The gate worked. The evidence behind the claim did not.** A ceiling of zero,
enforced on a partial scan, reads exactly like a ceiling of zero enforced on a
whole one — which is the AR-45 shape this initiative was built to prevent,
reproduced by the initiative itself, one layer up.

The measurement in `run.properties.incrementalMode` said `diff-informed` in
every PR SARIF I read. I read those files repeatedly, for other reasons, and
never once asked what that field meant.

## What was actually fixed, and what was not

The remediations are real and are not withdrawn:

- `searchParamsToObject` builds a null-prototype object, and **Zod reads
  inherited properties** — that measurement stands, and it is the reason the
  fix matters more than the alert did.
- `requestFingerprint` refuses secret-shaped material before `createHash`, and
  the three barriers it enforces were previously enforced by nothing.

Both are mutation-proven. Neither removed the **dataflow** CodeQL reports,
because CodeQL does not model `Object.create(null)` or a runtime guard as a
sanitiser. Fixing the impact and clearing the alert are different things, and
this initiative reported the second while having done the first.

## What the alerts actually were

Reading the SARIF `codeFlows` — which should have been the first move, not the
last — the `js/insufficient-password-hash` path is:

```
PASSWORD_RESET_COMPLETION_OPERATION      (a route descriptor constant)
  → operation → operation.path/.method
  → input.path/.method → framed([…]) → createHash('sha256')
```

**No password is in it.** The query's source heuristic fires on the _identifier
name_ of a route descriptor, and the values reaching SHA-256 are a route
template and the string `POST`.

It was still worth fixing, for a reason the alert did not give: the function was
hashing pass-through strings it had never checked. It now hashes a verb matched
from a frozen literal array and a path proven to be a registered template — so
the digest provably binds a routable target, an unroutable one is refused
instead of hashed, and the dataflow ends because the value genuinely stops being
derived from the input.

`js/remote-property-injection` was the same shape: `Object.create(null)` fixed
the impact while leaving `out[key] = …` — the sink itself — in the code, where a
future reader would copy it. The accumulator is now an entries array materialised
through `Object.fromEntries`, so no dynamic property write exists at all.

## The mirror-image mistake, made immediately afterwards

The first fix scoped dismissal staleness by rule set, and the pull-request run
then failed with:

```
dismissal for `js/http-to-file-access` at `scripts/ci/check-commit-checks.mjs`
matches nothing.
```

**A diff-informed run does not re-report a finding whose file did not change**,
so on a pull request _every_ dismissal looks stale. Same error, opposite
direction: the first read a partial scan's silence as "nothing is there", the
second read it as "it is gone".

## What the gate does now

`run.properties.incrementalMode` is CodeQL's own declaration that the analysis
was partial, so the gate reads it and separates two kinds of claim:

- **What a partial run saw is trustworthy.** A blocking finding still fails; a
  count _above_ the ceiling still fails. Those are positive observations.
- **What a partial run did not see proves nothing.** Staleness is deferred to a
  full analysis. A count at or below the ceiling is reported as _"does NOT
  establish the repository ceiling"_, and the verdict reads **`Go (partial)`**,
  never a bare `Go` — because a bare `Go` is what let this through the first
  time.

## The rule this leaves behind

**A partial analysis reporting zero is not a clean analysis, and the gate must
say which one it ran.** The same words apply to the previous initiative's five
green heads with a red GHAS check, to the four vacuous assertions, and now to
this. Three times, one shape: something did not look, and its silence was read
as an answer.
