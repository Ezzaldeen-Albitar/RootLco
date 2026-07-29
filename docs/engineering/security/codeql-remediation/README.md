# RootLco CodeQL Application Remediation and Security Hardening

Closes the complete CodeQL backlog that the Comprehensive CI/CD initiative
surfaced, and closes CSA-22 in the same change.

The backlog was not a regression. Before that initiative there was **no SAST at
all** (CSA-09), so the first analysis reported a standing debt rather than a
delta — 21 open alerts, 17 of them high, every one of them older than the
pipeline that found them.

## What was found and what happened to it

| Rule                                   | Sev     | Count | Where                            | Disposition                                                             |
| -------------------------------------- | ------- | ----- | -------------------------------- | ----------------------------------------------------------------------- |
| `js/remote-property-injection`         | high    | 1     | `src/server/http/validation.ts`  | **fixed** — [detail](validation-prototype-remediation.md)               |
| `js/insufficient-password-hash`        | high    | 1     | `src/server/http/idempotency.ts` | **fixed structurally** — [detail](sensitive-idempotency-remediation.md) |
| `js/file-system-race`                  | high    | 9     | scripts + one unit test          | **fixed** (+2 unflagged sites)                                          |
| `js/incomplete-sanitization`           | high    | 6     | two inventory scripts            | **fixed**                                                               |
| `js/template-syntax-in-string-literal` | warning | 4     | one backend test                 | **fixed** — they were vacuous                                           |

**Fixed: 21. Refuted: 0. Dismissed: 0. Open: 0. Unreviewed: 0.**

Nothing was waived. `.github/ci-baselines/codeql-baseline.json` carries an empty
dismissal list and a `maximumOpenFindings` ceiling of zero.

## The documents

| Document                                                                         | What it is for                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`alert-inventory.md`](alert-inventory.md)                                       | Every alert, its dataflow, its reachability, its disposition |
| [`validation-prototype-remediation.md`](validation-prototype-remediation.md)     | The prototype finding — three defects in one line            |
| [`sensitive-idempotency-remediation.md`](sensitive-idempotency-remediation.md)   | Why a false positive still needed a structural fix           |
| [`iam-idempotency-replay-remediation.md`](iam-idempotency-replay-remediation.md) | CSA-22, and why the branch could not merge alone             |
| [`codeql-policy-gate.md`](codeql-policy-gate.md)                                 | The SARIF gate, and the AR-52 blind spot it closes           |
| [`test-strategy.md`](test-strategy.md)                                           | What is proven, how, and what is only asserted               |
| [`compatibility-and-rollout.md`](compatibility-and-rollout.md)                   | What changed for a caller, and what did not                  |
| [`review-adjudication.md`](review-adjudication.md)                               | Ten adversarial lenses and every verdict                     |
| [`accepted-dismissals.md`](accepted-dismissals.md)                               | Empty, and why that is the finished state                    |
| [`execution-checkpoint.md`](execution-checkpoint.md)                             | What happened, in order, including the mistakes              |
| [`evidence/hostile-mutations.md`](evidence/hostile-mutations.md)                 | 18 mutations, 18 caught, and the one that survived first     |

## The three things worth carrying out of this

**A false positive can still be a real hole.** The password CodeQL reported
could not reach the persisted digest — three independent barriers stopped it.
Nothing _enforced_ any of them. One `idempotent: true` on a future credential
route would have made the alert true, silently, with no test failing. The alert
was wrong about today and right about the shape.

**The scanner was right about the code, and wrong about the reason.** The
prototype finding named the object-local prototype swap. The measurement found
something larger underneath it: **Zod reads inherited properties**, so a polluted
`Object.prototype` would have parsed as _validated_ input across 24 routes.
CodeQL could not see that; running the code could.

**A gate is not evidence until it has objected to something.** The new SARIF
policy gate found a finding in its own author's new script on its first hosted
run, while GitHub's own CodeQL check reported success — because that check blocks
only on high and critical. A ceiling above zero would have been a budget for
exactly that.

## Baseline and scope

- Protected base: `develop` at `4cb0bbb018e69c7e1e94592c354144d8fe36c1a9`
- `origin/main`: `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched
- Migrations: 119, no `120`. **Not P1-22.** No deployment.
