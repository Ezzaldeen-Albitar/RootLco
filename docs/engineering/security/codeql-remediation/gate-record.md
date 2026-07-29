# Owner gate record — RootLco CodeQL Application Remediation and Security Hardening

**Decision: Go.**

Documentation only. This branch adds this file and nothing else.

| Item                    | Value                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `origin/develop`        | `4683357ffd4b60a8f6cd66cb936a614acc96144f`                                                  |
| Feature PRs             | #92 (`c0831e5`) and #93 (`108a4ed`), both merged with **merge commits**                     |
| Merge tree of #93       | `e41df491feff3d5e1d0b6f4974fcb8f3dfbe9108` — **byte-identical** to the verified head's tree |
| `origin/main`           | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — **untouched**, contains no part of this work   |
| Protected-branch checks | **17 of 17 green**, including `protected-gate` and both `code-security` legs                |
| Migrations              | 119, no `120`. Schema hash `a677eb05…` unchanged                                            |

## 1. The finding that matters most

**This initiative reported "21 fixed, 0 open" and merged it. The claim was
false.**

Every run verified before the first merge was a **pull-request** run, and CodeQL
analyses those `diff-informed` — changed regions only. The first full-tree
analysis was the push to `develop` _after_ that merge, and it failed on this
initiative's own gate:

```
open findings rose to 2, above the recorded ceiling of 0.
```

19 of the 21 backlog alerts were genuinely closed. **The two application alerts
were not, and had never been.** `develop` was red for roughly ninety minutes.

The gate did its job. The evidence behind the claim did not. `incrementalMode:
"diff-informed"` was sitting in every SARIF read during that work, repeatedly,
for other reasons. Full retraction and root cause:
[`correction-diff-informed-analysis.md`](correction-diff-informed-analysis.md).

## 2. Final state, on a full-tree analysis of the protected branch

`origin/develop` `4683357`, run `30468250093`, `incrementalMode` **absent**,
**719 files analysed**:

| Measure                                      | Value                        |
| -------------------------------------------- | ---------------------------- |
| **Open findings**                            | **0**                        |
| Application findings                         | **0**                        |
| Critical / High                              | **0 / 0**                    |
| Total live findings                          | 1 — covered by one dismissal |
| GitHub's alert list for `refs/heads/develop` | **1 open, medium**           |

The one remaining alert is `js/http-to-file-access` in
`scripts/ci/check-commit-checks.mjs` — a script **this initiative wrote**,
flagged by the gate **this initiative wrote**, on that gate's first run, while
GitHub's own CodeQL check reported that run _success_ because it blocks only on
high and critical. It is a false positive in impact, not in existence, per-path,
per-rule, expiring **2027-01-31**, with a full reproduction in
[`accepted-dismissals.md`](accepted-dismissals.md). Nothing under `src/` may be
dismissed at all.

| Job evidence (protected gate)       | Value                 |
| ----------------------------------- | --------------------- |
| Unit / foundation                   | **1194** passed       |
| Backend                             | **1391** passed       |
| Database / RLS                      | **1624** passed       |
| Coverage — lines                    | 93.31%                |
| Governed jobs                       | **12 of 12 accepted** |
| Application tables before migration | **0**                 |

## 3. How the two application alerts were actually eliminated

Not dismissed, not suppressed, not renamed. Proven across three full-tree runs:

| Head      | Open | What survived                                                    |
| --------- | ---- | ---------------------------------------------------------------- |
| `e83c6b6` | 2    | both application alerts                                          |
| `26e1cf4` | 1    | `#28` gone; the **method** flow gone; the **path** flow survived |
| `6742eea` | 0    | interning the template ended it                                  |

**`#28` `js/remote-property-injection`.** `Object.create(null)` fixed the impact
while leaving `out[key] = …` — the sink itself — in the code. It is now an
entries array materialised through `Object.fromEntries`, so no dynamic property
write exists at all, then `setPrototypeOf(…, null)` because **Zod reads
inherited properties** — the measurement that mattered more than the alert did.

**`#10` `js/insufficient-password-hash`.** The SARIF `codeFlow` showed **no
password in it**: the query's source heuristic fires on the identifier name
`PASSWORD_RESET_COMPLETION_OPERATION`, and what reached SHA-256 was a route
template and the string `POST`. Fixed anyway, because the function was hashing
pass-through strings it had never checked — the verb is now matched from a frozen
literal array, the path interned against all **169** registered templates.
**`FINGERPRINT_SCHEME` unchanged: no migration, no new secret**, and replay,
conflict, principal, route, tenant, audit and outbox semantics all preserved.

The middle row is the lesson worth keeping. `canonicalMethod` ended its flow; a
regex guard returning `match[0]` did not, because that value is still derived
from its input. Two guards that read alike — one a barrier, one decoration — and
only a full-tree analysis could tell them apart.

## 4. What the gate learned

`run.properties.incrementalMode` is now read, and the two kinds of claim are
separated:

- **What a partial analysis saw blocks.** A High it observed fails; a count above
  the ceiling fails. Positive observations are trustworthy.
- **What it did not see proves nothing.** Staleness and the ceiling defer to a
  full run, and a diff-informed verdict reads **`Go (partial)`**, never a bare
  `Go` — because a bare `Go` is precisely what reached a merge commit.

Dismissal staleness is additionally scoped to the pack's declared **rule set**.
An earlier attempt scoped it by `run.artifacts`, which reported 17 files for the
`actions` leg on a pull request and 712 on a push — same leg, same language — so
it agreed with reality once by coincidence and then reddened a protected branch.

## 5. Mistakes, counted

**Fourteen defects in this work were introduced by this work**, each in a class it
had already fixed elsewhere. The full table is in
[`execution-checkpoint.md`](execution-checkpoint.md). Two deserve naming here:

**Four vacuous assertions**, written by the initiative chartered to fix vacuous
assertions. The fourth was written into the very file whose purpose was the
property it claimed to test: JavaScript strings are values, so no runtime test
can distinguish returning a literal from returning its argument. It was caught
by mutating the source and watching the suite pass. It is deleted, and the file
now says the hosted analysis is the only evidence.

**A finding I refuted that a hosted run then proved.** An adversarial reviewer
filed that the one dismissal would red the `actions` leg; I refuted it because
their reproduction was against a dirty tree — true, and not an answer to the
finding. Recorded under its own heading in
[`review-adjudication.md`](review-adjudication.md) rather than amended away.

## 6. Verification not claimed

- The **race** and **escaping** fixes in `scripts/` are robustness fixes whose
  failure modes are latent; reverting them fails no test today, which is exactly
  why CodeQL found them and no suite did.
- That `internRouteTemplate` returns the array element rather than its argument
  is **not** unit-testable, and is not claimed to be. Only the dataflow analyser
  can see it.
- `parseJsonBody` still silently drops a `__proto__` member of a JSON body. Not
  exploitable; deliberately out of scope; recorded so it is visible rather than
  discovered.
- A `workflow_dispatch` run used to obtain full-tree SARIF also fails
  `database-security` and `database-migration-replay`, because "Applied
  migrations are immutable" needs a base ref a dispatch event does not have. A
  context limitation of that instrument, not a defect.
- One backend file failed once in a full run and passed in isolation and on a
  clean re-run. Recorded as a flake rather than smoothed over.

## 7. Scope boundaries observed

- **Not P1-22.** Not started.
- **No deployment.** Nothing to staging or production.
- **`main` untouched** at `491c4e0` — promotion is a founders' reserved decision
  (ADR-006).
- No squash, no rebase-merge, no direct push, no protected-branch bypass, no
  lowering of CodeQL sensitivity, no blanket dismissal, and nothing under `src/`
  dismissed.
- No secret printed, no secret-bearing artifact uploaded, no customer or
  production data touched.

## 8. Open items

- **31 hostile mutations, 31 caught** — `node scripts/ci/hostile-mutations.mjs`.
- The one dismissal expires **2027-01-31** and must be re-justified or removed.
- **P1-21-A-01** remains open (repository security settings) — untouched by this
  work.
