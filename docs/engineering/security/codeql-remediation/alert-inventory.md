# Alert inventory

Every open CodeQL alert on `develop` at `4cb0bbb`, retrieved from the Code
Scanning API rather than from annotations, with its disposition.

Retrieved: `GET /repos/Ezzaldeen-Albitar/RootLco/code-scanning/alerts?state=open&ref=refs/heads/develop`
→ **21 alerts: 17 high, 4 warning.**

## Application source — 2

| #   | Rule                            | Sev  | Prec | File:line                                | Source → sink                                | Reachable                            | Disposition            |
| --- | ------------------------------- | ---- | ---- | ---------------------------------------- | -------------------------------------------- | ------------------------------------ | ---------------------- |
| 28  | `js/remote-property-injection`  | high | high | `src/server/http/validation.ts:39`       | `URLSearchParams.keys()` → `out[key] = …`    | **yes**, every GET to 24 list routes | **FIXED**              |
| 10  | `js/insufficient-password-hash` | high | —    | `src/server/http/idempotency.ts:169-179` | password body field → `createHash('sha256')` | **no** — see below                   | **FIXED structurally** |

### Alert 28 — what was actually reachable

CodeQL named the write. Measured with node, that line held three distinct
defects, and the one named was the least of them:

1. **Zod reads inherited properties.** Against a plain `{}`, a polluted
   `Object.prototype.role` parses as a _validated_ `role` field — `success:
true`. Measured directly.
2. The accumulator's own prototype was writable via `?__proto__=a&__proto__=b`
   (the setter ignores a string, accepts an array). `Object.prototype` itself
   was never reachable — the honest scope is object-local.
3. A parameter named `__proto__` was **silently dropped**: the assignment hit
   the setter, `Object.keys()` was empty, the field never reached Zod.

### Alert 10 — why it is unreachable, and why that was not enough

Three independent barriers, each verified:

- `route-handler.ts:302-316` computes a fingerprint **only** when
  `operation.idempotent === true`.
- Both password routes (`/auth/password-reset`, `/auth/password-reset/completion`)
  are `public: true` and declare no idempotency.
- `requestFingerprint` already refused a request with no authenticated principal.

And the one idempotent operation with a token-shaped body field —
`attachments/versions`, carrying `uploadToken` — carries
`base64url(JSON.stringify(claim))`: unsigned, unencrypted, **not a secret**, as
`attachment-policy.ts` states in its own comment.

So the alert was a false positive _about today_. Nothing enforced any of the
three barriers, which is why it was fixed rather than dismissed.

## CI and test tooling — 19

### `js/file-system-race` (CWE-367) — 9 alerts, all fixed

| #     | File:line                                        | Shape                                  | Fix                                       |
| ----- | ------------------------------------------------ | -------------------------------------- | ----------------------------------------- |
| 19    | `scripts/check-encoding.mjs:106`                 | `statSync().isFile()` → `readFileSync` | read directly; `EISDIR` is already caught |
| 20    | `scripts/check-operation-test-coverage.mjs:1627` | `statSync()` in a `readdirSync` loop   | `withFileTypes`                           |
| 21,22 | `scripts/p1-20-endpoint-inventory.mjs:604,619`   | same                                   | `withFileTypes`                           |
| 23,24 | `scripts/p1-21-endpoint-inventory.mjs:792,807`   | same                                   | `withFileTypes`                           |
| 25    | `scripts/p1-20-endpoint-inventory.mjs:963`       | `existsSync ? read : null` → `write`   | read and interpret `ENOENT`               |
| 26    | `scripts/p1-21-endpoint-inventory.mjs:1157`      | same                                   | same                                      |
| 27    | `tests/unit/p1-20-decimal.test.ts:255`           | `statSync()` in a walker               | `withFileTypes`                           |

**Two further sites of the identical shape were fixed although CodeQL did not
flag them** — `p1-20:448` and `p1-21:636`. Fixing only the reported lines would
have left the same defect two functions away.

Attacker control: **none**. Every path is derived from the repository tree
during a CI checkout. These are robustness fixes, and that is stated plainly in
[`test-strategy.md`](test-strategy.md) rather than dressed as vulnerability
remediation.

### `js/incomplete-sanitization` (CWE-20/80/116) — 6 alerts, all fixed

All six are `value.replace(/\./g, '\\.')` interpolated into `new RegExp`, cloned
three times per file across two near-identical inventory scripts:
`p1-20:676,702,716` and `p1-21:864,890,904`.

The escaped values are audit-action codes and event types read from the
repository's own catalogs — not attacker-controlled. The escaping is
nevertheless incomplete: the first identifier containing a metacharacter would
either throw at `new RegExp` or, worse, compile into a pattern matching
something else. All six now use the `escapeRegExp` already exported by
`check-workflow-security.mjs`, which carries mutation tests for both failure
modes.

Both scripts are live in CI (`_reusable-node-quality.yml:276-277`), so they were
fixed rather than deleted.

### `js/template-syntax-in-string-literal` — 4 alerts, all fixed

`tests/backend/p1-21-inventory-reads.test.ts:448,456,547,572`. Tagged
_correctness_, not security — and the most valuable four in the inventory,
because all four tests were **vacuous**.

Four URLs were single-quoted strings containing `${COMPANY_A1}`, so the literal
text went out as a UUID and every request 422'd:

- three tests asserted 422 and got it from the malformed UUID, not from the
  validation each claimed to test;
- the fourth asserted a **safety property** — _"leaves the ledger untouched — a
  reconciliation is a read"_ — while the reconciliation never ran, so the row
  count was trivially unchanged.

## Findings introduced by this initiative

Recorded because they exist, not because anything forced the disclosure.

| Rule                     | File                                     | How it was found                                            | Disposition                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/http-to-file-access` | `scripts/ci/check-commit-checks.mjs:196` | **this initiative's own new gate, on its first hosted run** | **superseded** — `safeText` bounded the content, but the network-to-file edge remained and became alert **#33**. Closed 2026-08-01 by removing the write entirely: [`SEC-CODEQL-033`](./sec-codeql-033-http-to-file-access.md) |

GitHub's own `CodeQL` check reported **success** for that run: it blocks on high
and critical, and this was medium. The repository-controlled ceiling of zero is
what caught it.

## Final state

| Measure    | Value |
| ---------- | ----- |
| Fixed      | 21    |
| Refuted    | 0     |
| Dismissed  | 0     |
| Open       | 0     |
| Unreviewed | 0     |
