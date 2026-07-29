# Hostile mutation matrix — results

Reproduce with:

```bash
node scripts/ci/hostile-mutations.mjs
```

Eighteen mutations, each breaking exactly one property in exactly one place.
Every one must make the suite that guards it **fail**. A mutation that survives
means the property is unpinned, whatever the test titles say.

**Result: 18/18 caught.** On the first run it was 17/18, and the survivor is the
reason this file exists.

## The survivor

**M-16 — `safeText` escapes the backslash before the pipe.**

The existing assertion was:

```ts
expect(safeText('a|b'), 'a pipe would break out of its table cell').toBe('a\\|b');
```

Both orderings map `a|b` to `a\|b`. The assertion passes against the defect, so
deleting the backslash rule — the exact high-severity `js/incomplete-sanitization`
finding this initiative fixed — changed nothing any test could see.

The distinguishing input has to contain **both** characters. It now does, along
with the property rather than just the string: after escaping, every `|` must be
preceded by an odd number of backslashes, because an even number means the last
backslash is itself escaped and the pipe still separates cells.

This is the **third** vacuous assertion this initiative has found in its own
work, after the four in a backend test and the regression pin the adversarial
review caught. The pattern is consistent: a test written immediately after a fix
tends to assert the fix's _happy path_, which the defect also satisfies.

## Full matrix

| ID   | Target                    | Property broken                                                         | Caught by                                    |
| ---- | ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| M-01 | `validation.ts`           | the accumulator has a null prototype                                    | `validation.test.ts`                         |
| M-02 | `validation.ts`           | `__proto__` is not copied into the result                               | `validation.test.ts`                         |
| M-03 | `validation.ts`           | the key comparison is exact, not case-folded                            | `validation.test.ts`                         |
| M-04 | `validation.ts`           | the function is **total** — 8 routes call it outside the error boundary | `validation.test.ts`                         |
| M-05 | `validation.ts`           | a repeated parameter still arrives as an array                          | `validation.test.ts`                         |
| M-06 | `idempotency.ts`          | the body is screened **before** `createHash`                            | `idempotency-secret-material.test.ts`        |
| M-07 | `idempotency.ts`          | route params are screened too                                           | `idempotency-secret-material.test.ts`        |
| M-08 | `idempotency.ts`          | the word list contains `password`                                       | `idempotency-secret-material.test.ts`        |
| M-09 | `idempotency.ts`          | camelCase is split, so `newPassword` is seen                            | `idempotency-secret-material.test.ts`        |
| M-10 | `idempotency.ts`          | nesting is walked                                                       | `idempotency-secret-material.test.ts`        |
| M-11 | `codeql-policy.mjs`       | a dismissal matches on rule **and** path                                | `codeql-policy.test.ts`                      |
| M-12 | `codeql-policy.mjs`       | the high band starts at 7.0                                             | `codeql-policy.test.ts`                      |
| M-13 | `codeql-policy.mjs`       | a missing SARIF is reported, not assumed clean                          | `codeql-policy.test.ts`                      |
| M-14 | `codeql-policy.mjs`       | `javascript-typescript` matches `javascript.sarif`                      | `codeql-policy.test.ts`                      |
| M-15 | `codeql-policy.mjs`       | the open-finding ceiling is enforced                                    | `codeql-policy.test.ts`                      |
| M-16 | `check-commit-checks.mjs` | backslash escaped **before** pipe                                       | `codeql-policy.test.ts` — **added for this** |
| M-17 | `check-commit-checks.mjs` | `failure` is not an acceptable conclusion                               | `codeql-policy.test.ts`                      |
| M-18 | `check-commit-checks.mjs` | a check still running is not counted as passed                          | `codeql-policy.test.ts`                      |

M-12 deserves a note: it is the _"do not lower CodeQL sensitivity to make alerts
disappear"_ constraint expressed as a test. Moving the high band from 7.0 to 8.5
would silently reclassify real highs as mediums, and the gate would keep
reporting a ceiling of zero while the alerts sat there. It fails.

## What the harness deliberately does not do

It is **not** wired into the pipeline. It edits tracked source in place, and a CI
job that does that is a job that can leave a broken tree behind if it is killed
between the write and the restore. It restores in a `finally`, and the tree was
verified clean after every run — but the right place for that risk is a
pre-merge instrument run by hand, not a job on every push.

It also refuses to score a mutation whose target string is not found. A mutation
that never applied is not a mutation that passed; that is the same shape as a
required check that never ran.
