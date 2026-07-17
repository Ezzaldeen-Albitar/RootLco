# Security Exceptions Register

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Adopted by owner instruction (2026-07-17); merges with the Phase 1-2 pull request — the Phase 1-2 exit gate is not decided ·
**Owner:** Eng. Ezzaldeen Al-Bitar ·
**Review:** [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)

---

## 1. Purpose

This register is the **only** place a deviation from an applicable security requirement
may be recorded. If a deviation is not here, it does not exist — and an applicable
requirement that is not met and not excepted is an **unresolved finding** under the
[Vulnerability Management Standard](./vulnerability-management-standard.md).

## 2. What is (and is not) an exception

An **exception** is an **owner-granted, time-bounded deviation from an applicable
security requirement** — a conscious decision to ship without a control, with a
compensating control and a deadline.

The following are **not** exceptions and must not be recorded here:

- **Planned work** — a requirement honestly marked `Planned` in a matrix with an owning
  phase is on schedule, not excepted.
- **Open items** — undecided owner questions (for example, the secret-store selection or
  the security contact channel) are tracked in their own documents.
- **`Not Applicable` judgments** — recorded with justification in the matrices.

## 3. Binding rules

1. **A `Critical` finding can never be excepted.** It blocks the merge, full stop
   ([Security Gate](./security-baseline.md)).
2. A `High` finding may be excepted only by **owner approval**, with an **expiry date**
   and a **stop condition**.
3. An **expired exception is an unresolved finding** — it re-blocks the next gate until
   renewed (a new owner decision) or resolved.
4. Exceptions are reviewed at **every phase exit gate**.
5. Only the owners may approve an exception. Self-granting is a policy violation, even
   under the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)
   — that policy delegates _review_, not _risk acceptance_.

## 4. Required fields

| Field                | Meaning                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Exception ID         | `SEC-EX-###`, sequential, never reused                                                                                      |
| Requirement(s)       | The `RL-` requirement IDs deviated from                                                                                     |
| Owner approval       | Approving owner's name and the approval date                                                                                |
| Reason               | Why the requirement cannot be met now                                                                                       |
| Compensating control | What reduces the risk in the meantime                                                                                       |
| Expiry date          | The date the exception dies automatically                                                                                   |
| Stop condition       | The event that forces closure **regardless of expiry** (e.g., "before any production deployment", "on first external user") |
| Status               | `Proposed` / `Active` / `Expired` / `Closed` / `Rejected`                                                                   |

## 5. Lifecycle

Requested → owner decision (`Active` or `Rejected`) → reviewed at every phase gate →
`Closed` when the requirement is met, or `Expired` when the date passes — and an
`Expired` entry immediately counts as an unresolved finding.

## 6. The register

| ID  | Requirement(s) | Owner approval | Reason                                                                 | Compensating control | Expiry | Stop condition | Status |
| --- | -------------- | -------------- | ---------------------------------------------------------------------- | -------------------- | ------ | -------------- | ------ |
| —   | —              | —              | _(none — no exception has been requested or granted as of 2026-07-17)_ | —                    | —      | —              | —      |

### Template for a future entry

```markdown
| SEC-EX-001 | RL-ASVS-x.y.z | Eng. <name>, YYYY-MM-DD | <why the requirement cannot be met now> | <what reduces the risk meanwhile> | YYYY-MM-DD | <event forcing closure regardless of expiry> | Active |
```

## 7. Relationship to other documents

- [security-baseline.md](./security-baseline.md) — the Security Gate that makes this
  register load-bearing.
- [vulnerability-management-standard.md](./vulnerability-management-standard.md) — what
  happens when an exception expires.
- [owasp-asvs-5-matrix.md](./owasp-asvs-5-matrix.md) and the Top-10 matrices — the
  `Exception` column of every row points here.

## 8. Honest limits

- An empty register proves nothing by itself; it is meaningful only together with the
  matrices' honest statuses. As of 2026-07-17 there are zero exceptions **and** zero
  known unresolved Critical or High findings — both facts are re-checked at every gate.
- This register does not authorize anything; it records owner decisions made elsewhere.
