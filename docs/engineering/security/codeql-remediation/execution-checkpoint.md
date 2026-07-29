# Execution checkpoint

What happened, in order, including the mistakes. The mistakes are the useful
part: **eight** of the defects this initiative fixed were introduced by this
initiative, in files it had just edited, after it had already demonstrated it
knew how to find that exact class. The table at the end is the whole point.

## Baseline

`develop` at `4cb0bbb`, `main` at `491c4e0`, 21 open CodeQL alerts (17 high),
119 migrations, P1-22 not started.

Branch `feature/security-codeql-application-remediation` cut from `4cb0bbb`.

## 1 — The two application findings

Analysed both before touching either. The measurement that mattered was not in
the alerts:

**Zod reads inherited properties.** Against a plain `{}` accumulator, a polluted
`Object.prototype.role` parses as a _validated_ `role` field across 24 list
routes. CodeQL flagged the assignment; it could not see this. Running the code
could.

**The password path was unreachable.** Three independent barriers, each verified
by reading rather than assumed: fingerprints are computed only when
`operation.idempotent`, both password routes are `public: true` with no
idempotency, and `requestFingerprint` already refused an unauthenticated
principal. The one idempotent route with a token-shaped field carries an
_unsigned base64 claim_, not a secret.

Fixed both anyway — the second structurally, because nothing enforced any of
those three barriers.

## 2 — Two defects in my own fixes, found by review

- **`Object.create(null)` alone made the anomaly portable.** `__proto__` became a
  live own key that `Object.assign` and `for…in` carry into a fresh target. The
  old code never produced such a key.
- **The idempotency guard handed every caller a 500 on demand.** `options.body`
  is the _raw pre-validation_ JSON, so any caller could append `password` to any
  of 107 idempotent endpoints. I had grepped for exactly that pattern and
  concluded zero routes did it; my grep was single-line and the call spans four.

## 3 — CSA-22, reconciled atomically

Cherry-picked `c27b2a0` with authorship preserved **and** emptied the ten
exceptions in the same change. Proved the coupling first: with the evidence
present and the exceptions still there, **107/107 proven, ten `matches nothing`
failures, exit 1**. Merging the branch alone would have reddened `develop`.

Regenerated the matrices on the reconciled tree: **zero drift**.

Four documents still claimed ten live waivers; nothing in CI reconciles prose
against JSON, so all four would have gone quietly stale.

## 4 — Fifteen script alerts, four vacuous assertions

Three race shapes, six incomplete escapes, and two further race sites CodeQL did
_not_ flag — fixing only the reported lines would have left the same defect two
functions away.

The four `js/template-syntax-in-string-literal` warnings were the most valuable
in the inventory: all four tests were vacuous, and one asserted a **safety
property** — _"a reconciliation is a read"_ — while the reconciliation never ran.

**I broke a walker doing this.** Switching to `withFileTypes` makes `entry` a
`Dirent`, and one line still compared it as a string. Eighteen operations
vanished from the gate. Caught by running both scripts; the committed version was
tested in place with a stash first, to establish the failure was mine and not
pre-existing.

## 5 — The SARIF policy gate, and three defects it found in itself

On its **first hosted run** it failed, and every failure was real:

1. **It could not find a SARIF that was sitting right there.** CodeQL names the
   file after the _language_, not the pack — `javascript-typescript` writes
   `javascript.sarif`. The gate reported the one condition it exists to prevent.
2. **`js/http-to-file-access`** in the new `check-commit-checks.mjs`. GitHub's own
   CodeQL check reported that run **success** — it blocks only on high and
   critical. The repository ceiling of zero caught it.
3. **`js/incomplete-sanitization`, high**, in the _fix_ for defect 2: escaping
   pipes without escaping backslashes first, so `\|` became `\\|` — a literal
   backslash followed by a live table separator. The escaper produced the
   injection it existed to stop.

Also fixed while there: the ceiling counted dismissed findings, which made
"dismiss it" and "raise the ceiling" the same action; and dismissals were only
validated at blocking severities, so a medium-severity entry was never checked
and was then reported as stale.

## 6 — Ten adversarial lenses

`survivingCriticalOrHigh: []`. Four findings acted on regardless of severity:

- **the `__proto__` refusal produced an unhandled 500 on eight routes** — the
  same caller-triggerable-500 class fixed in step 2, reintroduced two commits
  later in a different file;
- **the regression-pin test was vacuous** — it iterated three queries, none
  containing `__proto__`, so it could not distinguish any implementation. Written
  by this initiative, three commits after fixing four vacuous assertions;
- no pagination in the check enumerator;
- a libuv assertion on exit.

Full adjudication, including what was refuted and what was recorded but not
acted on, in [`review-adjudication.md`](review-adjudication.md).

## 7 — Eighteen hostile mutations

`node scripts/ci/hostile-mutations.mjs` — each breaks one property in one place
and must make the guarding suite fail.

**17/18 on the first run.** The survivor was M-16: `safeText`'s only pipe
assertion was `expect(safeText('a|b')).toBe('a\\|b')`, and both escaping orders
satisfy it — so deleting the backslash rule, the exact high-severity finding
step 5 had fixed, changed nothing any test could see.

The third vacuous assertion found in this initiative's own work. Fixed, and
**18/18** now. Detail in
[`evidence/hostile-mutations.md`](evidence/hostile-mutations.md).

## 8 — The hosted run reded a check, on a finding I had refuted

The final head went out with every local gate green and came back with
`code-security (actions)` **red**. One failure, and it was mine twice over:

```
dismissal for `js/http-to-file-access` at `scripts/ci/check-commit-checks.mjs`
matches nothing. The finding was fixed, or it moved — either way this entry is
stale. Remove it.
```

`code-security` is a matrix. The `actions` leg reads **17 workflow YAML files
and no JavaScript**, so it judged a dismissal naming a file it had never opened.
The entry is live: replaying the same run's `javascript-typescript` SARIF —
**717 files** — finds it present and covered.

**Reviewer 10 filed exactly this and I refuted it**, because their reproduction
was against a dirty working tree. The reproduction was flawed; the claim was not.
I dismissed the second along with the first, and both SARIFs were downloadable
the whole time.

Fixed by scoping staleness to `run.artifacts` — CodeQL's own record of what it
read — with the reverse mutation (M-20) pinning that scoping cannot become a
hiding place for a genuinely dead entry.

## The pattern

| #   | Defect                         | Introduced            | Found by                |
| --- | ------------------------------ | --------------------- | ----------------------- |
| 1   | portable `__proto__` key       | the prototype fix     | review                  |
| 2   | caller-triggerable 500         | the idempotency guard | review                  |
| 3   | `Dirent` compared as a string  | the race fixes        | running the gate        |
| 4   | `http-to-file-access`          | the new gate          | **the new gate**        |
| 5   | backslash-before-pipe          | the fix for #4        | **the new gate**        |
| 6   | unhandled 500 on eight routes  | the prototype fix     | review                  |
| 7   | vacuous regression pin         | the prototype tests   | review                  |
| 8   | unpinned backslash-before-pipe | the fix for #5        | **the mutation matrix** |
| 9   | staleness judged out of scope  | the new gate          | **a hosted run**        |

Nine defects, every one in code written by this initiative, every one in a class
it had already fixed elsewhere. Three were vacuous assertions — written by the
initiative chartered to fix vacuous assertions, including one written to pin the
fix for #5. The last one had been **reported to me and refuted**.

Nothing here was found by being careful. All of it was found by running the code,
by letting somebody else attack it, by breaking it on purpose to see whether
anything noticed, and — for the last one — by a hosted runner declining to accept
a claim I had already talked myself out of.
