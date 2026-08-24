# Governance remediation — branch ownership profiles

Finding `INS-49`, re-verified live against `c081a019` and against the two planning branches that
exist today.

**No executable gate is changed by this document.** A preparation slice may not change CI behaviour,
and the required change is recorded as a remediation item rather than made.

---

## 1. Exact current behaviour

### 1.1 Resolution is first-match-wins over a committed prefix list

`scripts/ci/check-phase-ownership.mjs`, `fromBranch()` at `:532-568`:

```js
const rule = rules.find(
  (r) =>
    typeof r?.branchPrefix === 'string' &&
    r.branchPrefix !== '' &&
    branch.startsWith(r.branchPrefix)
);
```

`Array.prototype.find` returns the **first** match, so **a longer, more specific prefix must be
declared before a shorter one that also matches.**

### 1.2 An unmatched branch is refused, and the refusal is a hard failure

```js
if (!rule) {
  return refuse(
    `branch \`${branch}\` declares no changed-file ownership profile. Add a rule to ` +
      `${PROFILE_MAP_PATH} … Refusing to judge it against another phase's declaration, which is ` +
      'how every branch came to be measured against p1-26-frontend.'
  );
}
```

`refuse` returns `{action: 'refuse', …}` (`:517-518`), and at `:889-891`:

```js
if (verdict.action === 'refuse') { … process.exit(1); }
```

`.github/ci-baselines/phase-ownership-profiles.json` carries `unmappedPolicy` whose value **is the
rationale**, not a flag:

> _"A branch that matches no rule is refused, and the message says to add a rule. The alternative — a
> permissive default — is how `check-phase-ownership.mjs` came to judge every branch against
> `p1-26-frontend`, including Backend branches the profile cannot pass. Declaring what a branch is
> allowed to change is a one-line diff and is the whole point of the gate."_

### 1.3 The `p1-26-frontend` default governs a hand run only

`:926`:

```js
const profileName = process.argv[2] ?? process.env.PHASE_OWNERSHIP_PROFILE ?? 'p1-26-frontend';
```

**In CI the default is unreachable.** `.github/workflows/_reusable-node-quality.yml:349-358`:

```bash
node scripts/ci/check-phase-ownership.mjs --resolve-context --env-out ownership-context.env …
. ./ownership-context.env
if [ "${OWNERSHIP_ACTION}" = "check" ]; then
  PHASE_OWNERSHIP_PROFILE="${OWNERSHIP_PROFILE}" \
  PHASE_OWNERSHIP_BASE="${OWNERSHIP_BASE}" \
    npm run validate:phase-ownership
fi
```

The profile is always passed explicitly, and `--resolve-context` is checked at `:899` **before**
anything reads `process.argv[2]`. The resolve step exits 1 when the context is unusable and the step
runs under `set -euo pipefail`, so an unmatched branch fails there — **before**
`validate:phase-ownership` is reached.

**So the failure mode has two distinct halves and they must not be conflated:**

| where                                 | what happens                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI, unmatched branch**              | the resolve step exits 1. The job fails with the "declares no changed-file ownership profile" message. **Correct, and loud.**                                                                                                                       |
| **a local hand run with no argument** | falls through to the literal `p1-26-frontend` and reports a verdict **against the wrong declaration** — a Frontend profile that forbids `apiSource`, `apiConfig`, `migrations` and `supabase`. **A Backend branch gets a confident, wrong answer.** |

## 2. Why it happens

Two independent causes.

1. **No rule matches.** The map holds **24** `branchPrefix` rules. Verified live — none matches
   `planning/`, and none matches any `p1-29` prefix. The existing `pre-p1-29` rules are
   `chore/pre-p1-29-` → `repository-tooling`, `feature/pre-p1-29-backend-` → `pre-p1-29-backend`,
   `feature/pre-p1-29-web-` → `pre-p1-29-web`, and one exact-branch rule for the initiative.
   **`planning/*` matches none of them** — `startsWith` is a prefix test, and `planning/` shares no
   prefix with `chore/`, `feature/`, `docs/`, `fix/`, `closure/`, `remediation/`, `tooling/` or
   `p1-2x/`.
2. **The positional default is a literal.** It was a reasonable convenience when one Frontend phase
   was in flight; it is now a foot-gun for every Backend and mixed branch, and the file's own
   docblock at `:906-920` says so.

## 3. Affected branch patterns

| pattern                                                        | today                        | consequence                                                                                      |
| -------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `planning/p1-29-work-order-diagnostics-technician-preparation` | **unmatched**                | a PR from it would fail the ownership step                                                       |
| `planning/pre-p1-29-remaining-waves-and-p1-29-a0`              | **unmatched**                | same                                                                                             |
| any future `planning/*`                                        | **unmatched**                | same                                                                                             |
| any `feature/p1-29-*`                                          | **unmatched**                | same                                                                                             |
| any `remediation/p1-29-*`                                      | **unmatched**                | same                                                                                             |
| a hand run on **any** branch with no argument                  | resolves to `p1-26-frontend` | a Backend diff is judged against a profile that forbids `apiSource`, `migrations` and `supabase` |

**Neither planning branch has a PR, so neither has hit this yet.** It becomes a hard blocker the
moment either is proposed for merge, or the moment a `BR-` branch is opened.

## 4. Security and governance implications

**The gate is not an authorization control**, and the implication is narrower than "a hole".

| implication                                              | severity                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a `planning/*` PR cannot go green until a rule exists    | **blocking, not dangerous** — it fails closed                                                                                                                                                                                                                                                          |
| a **local** run silently judges against `p1-26-frontend` | **the real risk.** An engineer runs the gate, sees a pass, and concludes the branch is compliant. For a Backend branch the profile forbids exactly the buckets that branch changes, so a _pass_ under it means the diff touched none of them — a stronger claim than the engineer thinks they verified |
| **`verify:policies` reads COMMITTED state**              | a pre-commit local run proves nothing about what a PR will see                                                                                                                                                                                                                                         |
| a permissive default returning                           | the file's own docblock records that this is how every branch came to be measured against `p1-26-frontend`. **Do not reintroduce one**                                                                                                                                                                 |

**No data is exposed, no permission is widened, no tenant boundary is crossed.** This is a
release-governance defect with a correctness consequence, not a security vulnerability — and stating
it as the latter would be the overreach the register forbids.

## 5. The exact future change required

**Two changes. Neither is made here.**

### 5.1 Add the ownership rules — in the first commit that opens each branch

`.github/ci-baselines/phase-ownership-profiles.json`, **longest prefix first**, because
`Array.find` is first-match-wins:

```
planning/                         →  p1-29-planning        (new profile, docs-only)
remediation/p1-29-backend-        →  p1-29-backend         (new profile)
feature/p1-29-                    →  p1-29-frontend        (new profile)
```

`planning/` is deliberately the **bare** prefix: every planning branch in this repository is
docs-only by construction, and one rule covering all of them is honest where three phase-specific
ones would be three copies of the same declaration.

### 5.2 Add the profiles — and follow the P1-28 precedent exactly

**A MIXED phase needs two or three profiles, never one permissive profile.** The precedent solved
exactly this problem: four of the five P1-28 prefixes map to `p1-27-frontend`, and the exception
`remediation/p1-28-owner-qa-backend` maps to `p1-28-backend-owner-qa` and is declared **before** the
general `remediation/p1-28-` rule.

| new profile          | `allowed`                                                                       | `forbidden`                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`p1-29-planning`** | `docs`                                                                          | everything else — `web`, `webContract`, `apiSource`, `apiConfig`, `migrations`, `supabase`, `tooling`, `tests`, `rootConfig`. A preparation slice may not change CI behaviour, and this profile is what enforces it   |
| **`p1-29-backend`**  | `apiSource`, `migrations`, `supabase`, `docs`, `tooling`, `tests`, `rootConfig` | `web`, `webContract` — _"the Frontend half is reviewed as its own change"_, the reason every Backend profile forbids it                                                                                               |
| **`p1-29-frontend`** | `web`, `webContract`, `docs`, `tooling`, `tests`, `rootConfig`                  | `apiSource`, `apiConfig`, `migrations`, `supabase` — identical in effect to `p1-27-frontend`, and **declared under its own name**, because _"a phase that borrows another phase's profile is not declaring anything"_ |

**Each `BR-` slice ships on a `remediation/p1-29-backend-*` branch** under `p1-29-backend`.
`BR-08c`'s mirror work touches `apps/web` and therefore ships **separately**, under
`p1-29-frontend`. That split is not bureaucratic: `BR-08b` changes `apps/api` and `BR-08c` changes
`apps/web`, and no single profile should permit both.

### 5.3 The positional default — a separate remediation, deliberately

Replacing `?? 'p1-26-frontend'` with a refusal is the correct fix, and it is **not** part of any
`BR-` slice:

- it changes the behaviour of a gate that **every** branch runs, including P1-28's sealed artefacts;
- a phase branch changing a shared gate is the coupling this repository has been bitten by before;
- it needs its own red-proof and its own mutation tests.

**Recorded as `GOV-P1-29-001`, owned by `repository-tooling`** — the profile that exists for exactly
this: a gate branch owned by no phase.

## 6. Required tests

For §5.1 and §5.2 — shipped **with** the rules, in the branch's first commit:

| #   | case                                                                                          | expected                                                 |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| G1  | `planning/anything` resolves to `p1-29-planning`                                              | resolved, not refused                                    |
| G2  | `remediation/p1-29-backend-br-01` resolves to `p1-29-backend`                                 |                                                          |
| G3  | `feature/p1-29-work-orders` resolves to `p1-29-frontend`                                      |                                                          |
| G4  | **ordering**: a branch matching both a longer and a shorter prefix resolves to the **longer** | proves first-match-wins is respected as rules accumulate |
| G5  | a `p1-29-planning` branch changing a file under `scripts/`                                    | **refused**                                              |
| G6  | a `p1-29-backend` branch changing a file under `apps/web/src`                                 | **refused**                                              |
| G7  | a `p1-29-frontend` branch changing a migration                                                | **refused**                                              |
| G8  | a branch matching no rule                                                                     | still **refused**, message unchanged                     |

For `GOV-P1-29-001` — mutation tests, because the change is to the gate itself:

| #   | case                                               | expected                                                    |
| --- | -------------------------------------------------- | ----------------------------------------------------------- |
| G9  | **red-proof**: a hand run with no profile argument | **refuses**; today it silently resolves to `p1-26-frontend` |
| G10 | a hand run with an explicit profile                | unchanged                                                   |
| G11 | the CI path                                        | unchanged — it always passes the profile explicitly         |
| G12 | every existing rule still resolves as before       | 24 cases, one per rule                                      |

## 7. Where this belongs in the sequence

**Before P1-29 implementation, and inside the branch that starts it — not in a dedicated slice.**

§5.1 and §5.2 are a **one-line-per-rule diff to a JSON baseline plus three profile literals**. The
gate's own message says the remedy is to add a rule, and the map's `unmappedPolicy` prose says
declaring what a branch may change _is the whole point of the gate_. Deferring it to a governance
slice would mean the first `BR-` branch cannot go green.

**`GOV-P1-29-001` (§5.3) is the opposite** — a change to shared gate behaviour, needing its own
red-proof and mutation tests, touching every branch in the repository. It belongs to
`repository-tooling` and it blocks nothing.

| item                       | owner                  | when                 | blocks                 |
| -------------------------- | ---------------------- | -------------------- | ---------------------- |
| §5.1 rules + §5.2 profiles | the first `BR-` branch | **its first commit** | every `BR-` slice's CI |
| §5.3 positional default    | `repository-tooling`   | any time             | nothing                |

## 8. Two things this document does not do

- **It does not change `.github/ci-baselines/phase-ownership-profiles.json`.** A preparation slice
  may not change CI behaviour, and the branch carrying this document is itself a `planning/*` branch
  that the gate would refuse — adding a rule for it here would be the slice legislating its own
  compliance.
- **It does not run the gate to "prove" the finding.** A local run without an explicit profile is
  exactly the misleading result §4 describes; running it and reporting the output would reproduce
  the defect rather than demonstrate it. The evidence above is read from the source and the
  committed baseline, both of which are deterministic.
