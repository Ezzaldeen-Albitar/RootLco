# Phase 1-26 — local acceptance account runbook

**Classification:** Confidential — Commercial Product and Pilot Planning

How to bring up the local system, create the Owner acceptance account, verify it,
and take it down again. Everything here is **local only** and refuses to run
against anything else.

---

## 1. What exists, and what it is not

|                     |                                                                  |
| ------------------- | ---------------------------------------------------------------- |
| Environment         | **local only** — three independent guards, below                 |
| Account             | `owner.acceptance@crm.local`, status `active`                    |
| Tenant              | `CRM Owner Acceptance Tenant` (`acceptance_a`)                   |
| Company             | `CRM Owner Acceptance Company` (`acceptance_co_a`)               |
| Branch              | `Main Acceptance Branch` (`main`)                                |
| Role                | `Owner Acceptance Administrator` (`acceptance_administrator`)    |
| Permissions         | **14** — the complete approved administration set                |
| Database privileges | **none.** No superuser, no BYPASSRLS, no direct database access  |
| Service-role key    | **never** reaches the browser                                    |
| Password            | generated at runtime, written only to `.local/`, never committed |

The account is an ordinary application identity. It holds its capability through
`iam.role_grants` exactly as a customer's administrator would, so if
authorization is wrong it discovers that the same way a customer would — which
is the entire reason to have the Owner click through it rather than read a
report about it.

## 2. The guards

`npm run acceptance:create-owner` refuses unless **all three** hold:

1. `ROOTLCO_ENV` is exactly `local-acceptance`.
2. The database is a loopback host on port **54322** — the Supabase local port.
3. `NEXT_PUBLIC_APP_ENV` is `local`, if it is set at all.

Each refusal exits **2** with a message naming the condition. All three are
exercised; see `owner-acceptance-runtime-evidence.md`.

The API itself runs as `rootlco_acceptance_runtime` — a member of `app_runtime`
with `NOSUPERUSER` and `NOBYPASSRLS`. Connecting it as `postgres` would make
every authorization check in the Owner's session meaningless, because `postgres`
carries BYPASSRLS in the Supabase local stack. Readiness proves the constraint:
`database.role.no-bypassrls: true`.

## 3. Bring it up

```bash
npm run supabase:start          # Kong 54321 · DB 54322 · Studio 54323 · Mailpit 54324
npm run supabase:reset          # 119 migrations + the platform seeds

$env:ROOTLCO_ENV = 'local-acceptance'   # PowerShell
npm run acceptance:create-owner

npm run dev:all                 # API 3000 · Web 3100
npm run acceptance:status-owner # proves the account can actually sign in
```

**Open `http://localhost:3100`, never `http://127.0.0.1:3100`.** They are
different origins to Next's development server, and the wrong one leaves every
table loading for ever — `P1-26-F-048`, and the launcher now prints the right
one.

## 4. What `create-owner` does

1. Creates `rootlco_acceptance_runtime` and grants it `app_runtime`, then
   asserts it can log in and holds neither SUPERUSER nor BYPASSRLS.
2. Repairs `apps/api/.env.local` **only where it is broken** — a `DATABASE_URL`
   whose role cannot log in, and the three settings that are individually
   optional but jointly mandatory for login (`SUPABASE_SERVICE_ROLE_KEY`,
   `AUTH_JWT_SECRET`, `AUTH_JWT_ISSUER`). A working value is never overwritten.
3. Aligns the identity provider's token signing with the Backend's contract —
   see `P1-26-F-045` — and **fails** if the resulting token is not HS256.
4. Creates Tenant A: company, branch, two roles, four operators.
5. Creates Tenant B: company, branch, one role, one operator, **no membership
   for any Tenant A principal**.
6. Writes ten company settings so the settings-backed screens are not empty.
7. Writes the credentials to `.local/owner-acceptance-account.json`.

It is idempotent. Re-running reconciles rather than duplicating; the password is
the one thing regenerated, because a password that survives a re-run is one
nobody can recover when it is lost.

## 5. Verify it

```bash
npm run acceptance:status-owner
```

Reads the database **and**, when the API is reachable, performs a real sign-in
and a real `GET /api/v1/auth/session`, asserting all 14 permission codes come
back. Rows can be perfectly correct and the account still unusable; only the
round trip proves otherwise. It prints no password and no token, and says
explicitly when it did **not** attempt a live sign-in rather than reporting
green over an untested claim.

## 5a. The Database tier and the fixtures are mutually exclusive

Two Database tests assert the database holds **no business rows** — the runtime
enforcement of the no-fake-data policy. The acceptance fixtures are business
rows. Both cannot be true at once, and neither test is weakened to pretend
otherwise (`P1-26-F-050`).

So the order matters:

```bash
npm run test:db                  # requires a clean database
npm run acceptance:create-owner  # for the Owner session
npm run acceptance:reset-owner   # BEFORE running the Database tier again
```

Measured: clean **1636/1636** · with fixtures **1634/1636** · after reset
**1636/1636**.

Separately, running `npm run test:backend` and then `npm run test:db` without a
reset between them produces well over a hundred failures on the Database tier's
_own_ fixtures. That ordering dependency predates this phase; `npm run
supabase:reset` clears it.

## 6. Take it down

```bash
npm run acceptance:reset-owner
```

Deletes only the two synthetic tenants, by deterministic identifier, in reverse
dependency order — every foreign key here is `ON DELETE RESTRICT`, so a wrong
order is refused by the database rather than cascaded. It never truncates and
never deletes by pattern. If the identifiers changed it removes nothing rather
than guessing: a reset that deletes more than it made is worse than one that
fails. It also removes the GoTrue identities and the `.local` handoff file.

## 7. The other principals

| Identity                       | Status  | Purpose                                                       |
| ------------------------------ | ------- | ------------------------------------------------------------- |
| `owner.acceptance@crm.local`   | active  | the Owner's account — all 14 permissions, unrestricted scope  |
| `reader.acceptance@crm.local`  | active  | read-only, branch-scoped — evidences permission-denied states |
| `invited.acceptance@crm.local` | invited | a real lifecycle state on the users screen                    |
| `locked.acceptance@crm.local`  | locked  | a real lifecycle state on the users screen                    |
| `operator.tenantb@crm.local`   | active  | Tenant B only — the isolation counterpart                     |

## 8. Identifiers, and one that matters

```
Tenant A   c0000000-0000-4000-8000-00000000000a
Tenant B   c0000000-0000-4000-8000-00000000000b
Company A  c1000000-0000-4000-8000-00000000000a
Branch A   c1100000-0000-4000-8000-00000000000a
```

The `c…` family is deliberate. `tests/db/helpers.ts` owns `aaaaaaaa-…` and
`bbbbbbbb-…` and `cleanFixtures` deletes exactly those — and `npm run test:db`
and `npm run test:backend` both call it. Reusing them would let an ordinary test
run delete the Owner's account halfway through an acceptance session.

## 9. Where the credentials live

`.local/owner-acceptance-account.json`, which `.gitignore` excludes at line 84
(`/.local/`). Never in documentation, never in a test fixture, never in
`.env.example`, never in a log, never in a screenshot, never in the repository —
`scripts/check-tracked-secrets.mjs` scans tracked files and
`scripts/ci/scan-history.mjs` scans the whole history, so a credential committed
once fails for ever.

The database connection is built as an object, field by field, rather than as a
connection URL carrying an inline password — so that string never exists to be
found.

### What the file's permissions actually are — `P1-26-F-053`

The bootstrap writes it with `{ mode: 0o600 }`. **POSIX honours that. Windows
ignores it**: Node does not translate a POSIX mode to an ACL, so the file simply
inherits the directory's. Measured on the Owner's machine:

```
.local\owner-acceptance-account.json  <owner SID>:(I)(M)
                                      NT AUTHORITY\SYSTEM:(I)(F)
                                      BUILTIN\Administrators:(I)(F)
```

There is no `Everyone` entry, so it is **not** world-readable — but SYSTEM and
any local administrator can read it, which is wider than `0600`. The mode
argument is kept because it is correct where it works; it is documented here
because a flag that is accepted and ignored reads exactly like a flag that works.

To narrow it on Windows, and only if you want to:

```powershell
icacls .local\owner-acceptance-account.json /inheritance:r /grant:r "$env:USERNAME:(R,W)"
```

The simpler answer is `npm run acceptance:reset-owner` when acceptance is over:
it deletes the file along with everything else it created.

> This paragraph quoted the offending shape verbatim in its first version, and
> the hosted scan failed on the sentence explaining why it must not appear —
> the fourth time in this phase that a rule was broken inside the text stating
> it.
>
> It passed **locally** for a reason worth knowing: `check-tracked-secrets.mjs`
> reads **tracked** files, and the file was still untracked when the local scan
> ran. A gate run before `git add` cannot see the thing being added. Run
> `npm run security:all` **after** staging, or CI is the first thing that looks
> at your new file.
