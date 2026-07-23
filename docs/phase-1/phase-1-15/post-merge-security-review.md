# Phase 1-15 — Post-merge security review

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Reviewed state:** protected `origin/develop` = **`0b843bf`** (the PR #61 merge) ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. Why this review exists, and why it is not the feature review repeated

The feature security review ran against the branch. This one runs against the **merged protected
state**, and its first rule is that it inherits no disposition. Every bound the feature review
recorded was re-tested rather than re-quoted — including the one that said P1-15-SR-014 could be left
open.

Thirty attack surfaces were reviewed independently; every candidate finding was then handed to three
further reviewers with different lenses (does the code do what the claim says; does a database
control already prevent it; could a failing test be written today), each instructed to default to
**refuted**. A finding needed a majority to survive. **Agent agreement was not treated as evidence:**
every finding recorded below was then reproduced by hand — by source reading, by an executed probe
against the live database as `rootlco_test_runtime`, or both — before it was acted on.

**21 candidates were raised. Seven were refuted outright. The rest are recorded below with their
dispositions, including the ones this remediation does not fix.**

## 2. The two that changed the gate

### PMR-001 — the SR-004 fix silently downgraded the four unauthenticated auth routes · **High** · **Fixed**

**Evidence.** `policyFor()` in `src/server/http/route-handler.ts` substituted `public-probe` for
**every** `public: true` operation, unconditionally. Six operations are public: the two health probes
and `iam.auth-login`, `iam.auth-logout`, `iam.auth-password-reset`,
`iam.auth-password-reset-completion`.

The four auth operations declare `auth-adjacent`: **10 requests a minute, `securityRelevant: true`**.
The substitution replaced it with `public-probe`: **120 a minute, `securityRelevant: false`**.

**Root cause.** The SR-004 fix reasoned "a public request has no tenant or user, so its policy must
be replaced" and applied that to the operation's `public` flag rather than to the property that
actually mattered — whether the _declared policy_ is keyed on something a sessionless request has.
`auth-adjacent` is already keyed on `['operation', 'ip']`; it never needed replacing.

**Impact.** Credential stuffing against `/auth/login` received twelve times the intended budget, and
a breach stopped raising a security-relevant signal. Each route's own committed `publicReason` text
still read "Bounded by the auth-adjacent rate-limit policy", which was then false. This is a
regression introduced by P1-15 into P1-14's surface — the class of change the review model exists to
catch, found on the merged state rather than before it.

**Fix.** A declared policy that is already sessionless is **kept**; only a session-keyed declaration
— or no declaration at all — is replaced by `public-probe`. Substitution can now only make a public
route _more_ throttled, never less.

**Regression test.** `tests/foundation/p1-15-public-policy-resolution.test.ts` (11 proofs), including
a scan of the committed registrations that asserts the four auth routes resolve to `auth-adjacent`
and the two probes to `public-probe`, and a check that `public-probe` is the looser of the two so the
direction of the substitution is not a matter of opinion.

### PMR-002 — a public operation declaring no policy was throttled by nothing · **Medium** · **Fixed**

**Evidence.** The same function returned `undefined` on `if (!name) return undefined` **before**
reaching the public branch, and `defineOperation()` does not require a `rateLimitPolicy`.

**Impact.** Latent, not live: all six current public registrations declare one. But it left the
SR-004 defect reachable again the moment someone added a public route without a policy — the exact
hole the fix was written to close.

**Fix and test.** Absent is now treated like session-keyed: `public-probe`. Pinned by
"substitutes public-probe when a public operation declares no policy at all" and "never resolves a
public operation to no policy".

## 3. The numbering findings

### PMR-003 / P1-15-SR-014 — a stale transaction clock rewound the run · **Medium** · **Fixed**

Reproduced on `0b843bf`, closed by migration 118. Full record in
[DBCR-P1-15-002](../../database/change-requests/DBCR-P1-15-002-number-sequence-period-hardening.md)
and [security-review.md](security-review.md) §5.3.

### PMR-004 — the regression guard could be bypassed by inventing a period · **Medium** · **Fixed**

**Evidence.** `shared.guard_number_sequence_regression()` refused a `next_value` decrease **only when
the period was unchanged**, and refused a `current_period` change **only on never-resetting
sequences**. `app_runtime` holds `UPDATE (next_value, current_period)`, so on a yearly, monthly or
daily sequence a writer could change the period and lower the counter in one statement and pass both
arms.

**Reproduction, as `rootlco_test_runtime` against a yearly sequence at `next_value = 42`:**

| Statement                                     | Draft 118 (forward-only)                          | Final 118                           |
| --------------------------------------------- | ------------------------------------------------- | ----------------------------------- |
| `SET current_period = NULL`                   | **accepted**                                      | `23514`                             |
| `SET next_value = 1, current_period = '2099'` | **accepted**                                      | `23514`                             |
| commit the first, then allocate               | issued **`FXY-2026-001`** — a number already used | run untouched, next number is `042` |

**This is why the first draft of migration 118 was not enough**, and the record says so rather than
presenting the final version as the original plan. "May only move forward" reads like the right rule
and is not: NULL and a far-future key both satisfy it, and either restarts the run.

**Fix.** The guard now compares against the clock, not against the old value: on a period-resetting
sequence whose reset rule is unchanged, `current_period` may only be left alone or set to the key the
database clock yields now. `app_runtime` holds no grant on `period_reset_rule`, so the
rule-changed escape is administrator-only.

**Regression test.** `tests/db/p1-15-number-sequence-period-hardening.test.ts` (19 proofs), including
the three rows above and the end-to-end "the run cannot be restarted by clearing the period and
allocating again".

**Consequence worth recording.** Two existing fixtures staged a past period with an `UPDATE`, which
the tightened guard now refuses — for the admin connection too, because a `BEFORE UPDATE` trigger
does not care who you are. They were changed to provision by `INSERT`. That is the contract change
working, and it is recorded here so nobody reads the edit as a test bent to fit a result.

## 4. The scope finding

### PMR-005 — notification enqueue resolved its scope three times · **Medium** · **Fixed**

**Evidence.** `SharedNotificationService.queueMessageWithRendering` resolved the company as
`input.companyId ?? context.companyIds[0] ?? null` for the message row, and as
`input.companyId ?? null` for both the audit record and the outbox event.

**Impact.** A caller naming a branch but leaving the company to the session wrote a message row with
`(company, branch)` and an outbox row with `(null, branch)`, which
`ck_event_outbox_branch_requires_company` refuses — a valid branch-scoped enqueue faulting as
`ERR-SYS-001`. Even without a branch the audit record recorded a narrower scope than the row it
described.

**Fix and test.** The scope is resolved once and spread into all three. Pinned by "resolves one scope
for the row, the audit record and the event" in
`tests/backend/p1-15-attachments-notifications.test.ts`.

## 5. Confirmed, recorded, and NOT fixed here

These survived verification. None is Critical or High. They are recorded with their evidence so the
next cycle starts from a finding rather than a rediscovery — and so that nobody reads their absence
from §2–4 as a refutation.

| ID      | Severity | Finding                                                                                                                                                                                                                            | Why not now                                                                                                                                                                                                                                                                       |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PMR-006 | Medium   | The four unauthenticated auth routes are, in **this** deployment, throttled by nothing: `resolveClientAddress()` returns null unless the platform supplies a peer address or `TRUSTED_PROXY_IPS` names a proxy, and neither holds. | Closing it needs a peer address plumbed from the platform — an infrastructure decision, not an application one. PMR-001's fix restores the _correct_ policy; it cannot manufacture a client address. Recorded as **R-14**.                                                        |
| PMR-007 | Medium   | A keyset cursor carries its sort value as an ISO string with millisecond precision, while `timestamptz` keeps microseconds; two rows inside the same millisecond can straddle a page edge and one be skipped.                      | A P1-13 foundation contract used by every paginated module. Changing the cursor's value encoding is a cross-module change that needs its own review, and no P1-15 surface ships a paginated list yet. Recorded as **R-15**.                                                       |
| PMR-008 | Medium   | No executable dependency-vulnerability control runs in CI.                                                                                                                                                                         | Unchanged, deliberate, and already recorded — see [risk-register.md](risk-register.md). Two of three verifiers refuted it as a defect on the ground that it is a documented owner decision; it is listed here because the _fact_ is true, not because the classification changed. |
| PMR-009 | Low      | `isProvisioned()` / `describe()` apply neither of the two scope validations `allocate()` applies, so they answer for company/branch scopes the session does not hold.                                                              | A read that returns a boolean about configuration, under RLS, for a scope the caller named. No data crosses a tenant. Worth aligning; not worth widening this remediation.                                                                                                        |
| PMR-010 | Low      | `shared.document.upload_authorized` omits the company/branch scope that every sibling attachment audit record carries.                                                                                                             | Audit completeness, no security boundary. Batch with the next audit-catalog change.                                                                                                                                                                                               |
| PMR-011 | Low      | Outbox `aggregate_version` mixes a child version number with the aggregate's `record_version`, producing repeated and non-monotonic values on one stream.                                                                          | A consumer-ordering concern for a consumer that does not exist yet; the outbox worker is P1-13 scaffolding with no registered consumer.                                                                                                                                           |
| PMR-012 | Low      | An RLS scope denial on notification enqueue surfaces as `ERR-SYS-001`, not `ERR-IAM-001`; the mapped branch is unreachable because the policy denies by matching zero rows rather than raising.                                    | Same class as P1-15-SR-006 and understood; the honest fix is to detect the zero-row denial, which touches the repository contract.                                                                                                                                                |
| PMR-013 | Low      | `verify()` throws `URIError` instead of refusing when a signed-URL path carries a malformed percent-escape.                                                                                                                        | A malformed URL is refused either way; the shape of the refusal is wrong, not the outcome.                                                                                                                                                                                        |
| PMR-014 | Low      | Timestamp filter validation accepts calendar-invalid dates (e.g. `2026-02-31`), turning a client error into a database error.                                                                                                      | Bounded, no injection, no disclosure. Belongs with PMR-007 in a query-primitives pass.                                                                                                                                                                                            |
| PMR-015 | Low      | The readiness probe abandons its in-flight transaction on timeout, holding a pooled connection past its own budget.                                                                                                                | Resource behaviour under a dependency stall, not a security property. Recorded for the scalability work P1-OD-027 already owns.                                                                                                                                                   |
| PMR-016 | Info     | The audit-contract document states a catalog size and one action code that the committed catalog does not contain.                                                                                                                 | Documentation accuracy; corrected when the audit catalog is next touched.                                                                                                                                                                                                         |

## 6. Refuted

Seven candidates were refuted by a majority of their verifiers and are not carried: three restatements
of the `isProvisioned`/`describe` scope reading judged not-a-defect on the controls lens, the
IPv4-mapped-address normalisation asymmetry (both forms normalise consistently for the purpose the
function serves), the claim that the documented `TRUSTED_PROXY_IPS` remediation is unreachable, the
dependency-scanning claim as a _defect_ rather than a recorded decision, and the readiness-probe
cancellation claim in its stronger form.

Recording refutations matters as much as recording findings: a review that reports only what survived
cannot be audited for what it dismissed.

## 7. Disposition

| Severity     | Raised | Fixed here | Recorded, not fixed | Refuted |
| ------------ | ------ | ---------- | ------------------- | ------- |
| **Critical** | 0      | 0          | 0                   | 0       |
| **High**     | 1      | **1**      | 0                   | 0       |
| **Medium**   | 6      | **3**      | 3                   | 0       |
| **Low**      | 9      | 0          | 7                   | 2       |
| Info         | 5      | 0          | 1                   | 4       |

**Unresolved Critical: 0. Unresolved High: 0.** Three Mediums (PMR-006, PMR-007, PMR-008) are
recorded rather than fixed, each with a stated reason that is about scope and review discipline, not
about difficulty.

**The Phase 1-15 owner gate therefore remains Pending.** It is not converted by this remediation, and
it may not be converted while any of it is unmerged.
