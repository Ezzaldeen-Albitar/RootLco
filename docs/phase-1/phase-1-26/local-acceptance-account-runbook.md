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

## 3a. `localhost` is the canonical local hostname

|                       |                                                               |
| --------------------- | ------------------------------------------------------------- |
| Web origin            | `http://localhost:3100`                                       |
| API origin            | `http://localhost:3000`                                       |
| API readiness         | `http://localhost:3000/api/v1/health/ready`                   |
| English login         | `http://localhost:3100/en/login`                              |
| Arabic login          | `http://localhost:3100/ar/login`                              |
| Start · status · stop | `npm run dev:all` · `npm run dev:status` · `npm run dev:stop` |

All of these come from `API_ORIGIN` and `WEB_ORIGIN` in
`scripts/dev/dev-config.mjs`. Nothing else states them.

**Why the name and not `127.0.0.1`.** A browser decides same-origin by comparing
host STRINGS, not by resolving them. `localhost` and `127.0.0.1` are therefore
two origins even though they reach one interface, and three separate mechanisms
act on that difference: Next refuses its own development resources across it
(`P1-26-F-048`, which leaves every table loading for ever), the CSP
`connect-src` is derived from the configured API origin, and a session cookie is
scoped to the host string that set it.

`127.0.0.1` still resolves — it is simply not the canonical origin, and since
both tiers are now started with `--hostname localhost` it is not served either.
That is deliberate: the wrong origin fails to connect instead of half-working.

## 3b. The local stack is single-instance

`npm run dev:all` may be run as many times as you like. The first run starts the
stack; every later run finds it, proves it belongs to this checkout, repairs the
state file and prints:

```
RootLco local stack is already running.
```

and exits **0**. **"Already running" is a success, not an error.** Nothing is
started, no credential is touched, and no fixture is reset.

| Command                              | Does                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| `npm run dev`                        | the same as `dev:all` — it used to start only the API |
| `npm run dev:all`                    | start, or adopt what is already running               |
| `npm run dev:status`                 | verify and report; changes nothing                    |
| `npm run dev:stop`                   | stop only verified RootLco processes                  |
| `npm run dev:api` / `dev:web`        | one tier, on its pinned port                          |
| `npm run dev:verify-single-instance` | prove the whole contract on this machine              |

### How it decides

Before anything is started the launcher asks the operating system which process
holds 3000 and 3100, then walks each listener's **parent chain** looking for a
`next dev apps/<tier>` belonging to this checkout. It reaches one of four
verdicts — adopt, start, repair the partial case, or refuse — and the adopt path
returns before the code that spawns anything.

It walks the parent chain because the process holding the port is not the one
that was started:

```
pid 24628  node .../next/dist/server/lib/start-server.js     <- holds :3000
  parent 6120   node .../bin/next dev apps/api --hostname localhost --port 3000
    parent 13284  node scripts/dev/start-local.mjs
```

The listener's own command line names neither the workspace nor the repository.

### Why it never falls back to 3001 or 3101

Both workspace commands pin `--hostname localhost --port <port>`, and the
launcher refuses a conflict rather than moving. A RootLco server on 3001 is not
a working stack, it is a second stack the Owner cannot tell apart from the first.

### If a port belongs to something else

The launcher prints the port, the owning pid, the process name, its command line
and the addresses it holds, then exits non-zero. **It never kills a process it
cannot prove it started.** Inspect it yourself:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000,3100 |
  Select-Object LocalAddress, LocalPort, OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" |
  Select-Object ProcessId, Name, CommandLine
```

### IPv4, IPv6 and why a "free" port was not free

A hostname binds one address family. On Windows `localhost` resolves to `::1`
first, so the stack listens on `[::1]:3000` and `[::1]:3100`.

The previous launcher decided a port was free by binding it — and a bind probe
only conflicts with a listener holding the **same** address. Measured against a
live stack on `::1`: binding `127.0.0.1`, `0.0.0.0` and `::` all succeeded, and
only binding `localhost` failed. So the check passed, Next spawned, Next binds
exclusively and died `EADDRINUSE`, and the readiness probe then got its 200 from
the server that was already there (`P1-26-F-063`). Ports are now identified by
listener, never by bind.

### Every route 404s in development, but the server is clearly up

A damaged `.next-dev` — seen twice: once as a corrupt `prerender-manifest.json`
and once as `/en/login` answering 404 on every request while the API was fine.
It is a cache, so deleting it costs a recompile and nothing else:

```powershell
npm run dev:stop
Remove-Item apps/web/.next-dev -Recurse -Force
npm run dev:all
```

The launcher clears a stale **production** build out of the way automatically;
it does not delete a development cache, because a healthy one is expensive to
rebuild and deleting it on a hunch would be the wrong default.

### Stale state and stale locks

`.local/dev-state.json` describes a stack; `.local/dev-launch.lock` describes a
launcher. Either can go stale independently, so neither is taken as proof of the
other. A lock whose launcher is dead is reclaimed automatically; a lock naming a
different checkout is never adopted. `dev:status` reports both, and a state file
that disagrees with the live processes is reported as disagreeing rather than
believed.

### Troubleshooting

**Every table sits loading, or sign-in redirects back to the login page.** You
are almost certainly on the wrong origin. Check the address bar; then check
`apps/web/.env.local`, which is git-ignored, is read in preference to every
default, and is invisible to every gate in this repository. `npm run dev:all`
warns when it contradicts the canonical API origin (`P1-26-F-062`).

**`dev:all` reports a port in use but nothing seems to be running.** A previous
launcher parent died and left its Next children holding the ports. `dev:status`
reports the recorded PIDs and whether they are alive; `dev:stop` kills only
processes this launcher started and exits non-zero if a port is still answering
afterwards rather than claiming success.

**Confirm what a process is really doing** — the printed URL is a claim, the
command line is the evidence:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, CommandLine
netstat -ano | Select-String ':3000|:3100'
```

Both tiers must show `--hostname localhost`. Note that a hostname binds **one**
address family: on Windows `localhost` resolves to `::1` first, so `netstat`
shows `[::1]:3100` and a probe of `127.0.0.1:3100` is refused. That is the fix
working, not a fault.

**Development and production build directories.** `next dev` builds into
`.next-dev` (`ROOTLCO_DIST_DIR`), `next build`/`next start` into `.next`. They
write incompatible manifests, so never point them at one directory — a
production build left in `.next` once made `next dev` invent a 404 that did not
exist (`P1-26-F-055`). The launcher clears a contaminated directory only after
proving both ports are free, and both directories are ignored by Git, ESLint and
Prettier.

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
rows. Both cannot be true at once, and **neither test is weakened to pretend
otherwise** (`P1-26-F-050`, `P1-26-F-057`).

The resolution is ordering, and it is a command rather than a habit:

```bash
npm run acceptance:full-cycle
```

Twelve steps, in the only sequence that keeps both invariants true:

| #   | Step                    | What it proves                                                 |
| --- | ----------------------- | -------------------------------------------------------------- |
| 1   | `reset-before`          | start from nothing, whatever the last run left                 |
| 2   | `verify-clean-before`   | the database is clean **by row count**, not by exit code       |
| 3   | `db-rls-pre-acceptance` | the full tier passes on a clean database                       |
| 4   | `create-fixtures`       | both tenants, five operators, three roles, ten settings        |
| 5   | `start-api`             | after creation — the API's database login is created in step 4 |
| 6   | `status-fixtures`       | the account signs in for real and resolves its permissions     |
| 7   | `authenticated-browser` | the authenticated tier against real fixtures                   |
| 8   | `reset-after`           | remove every fixture                                           |
| 9   | `verify-clean-after`    | every named counter is zero                                    |
| 10  | `db-rls-post-reset`     | the full tier passes again                                     |
| 11  | `git-clean`             | no fixture data reached the working tree                       |

Each step writes its log to `.local/acceptance-cycle/`. On failure the cycle
preserves that log, attempts a reset, reports whether the reset succeeded, names
the failing step and exits non-zero — fixtures left half-created are worse than
either extreme, because the next run then starts from a state nobody described.

Run the steps by hand only if you must:

```bash
npm run acceptance:reset-owner    # remove
npm run acceptance:verify-reset   # PROVE removed — exit code is not proof
npm run test:db                   # only ever on a clean database
npm run acceptance:create-owner   # recreate for the Owner session
```

**`acceptance:verify-reset` is the one to remember.** The reset exiting zero
means its statements succeeded, not that the right statements were chosen — the
version that skipped a misnamed audit table exited zero while leaving the whole
audit trail behind.

Separately, running `npm run test:backend` and then `npm run test:db` without a
reset between them produces well over a hundred failures on the Database tier's
_own_ fixtures. That ordering dependency predates this phase; `npm run
supabase:reset` clears it.

## 5b. `next dev` and `next start` must not share a build directory

They write incompatible manifests to `apps/web/.next`, and running one after the
other leaves the second reading the first one's output (`P1-26-F-055`). It has
taken the stack down mid-suite and, worse, manufactured a 404 on routes that were
correct — half an hour went into diagnosing a phantom.

The launcher now builds development into `.next-dev` via `ROOTLCO_DIST_DIR`, so
the two can never collide. If you run `next dev` by hand, either use the launcher
or clear `.next` first — and never clear it while a server is reading it.

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
