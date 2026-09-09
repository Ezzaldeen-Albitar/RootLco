# CLAUDE.md — rootlco-platform

Instructions for an AI coding assistant working in this repository. Everything here is a
property of the repository, not of any one machine or session: no local paths, no tool
versions of a particular workstation, no session configuration.

## A. Role contract (read first)

A session that plans is not a session that writes. The planning session explores, decides and
reviews; implementation is delegated to executor subagents that run in an isolated context.
The token economy of this repository depends on that isolation: an executor's file reads,
failed attempts and long command output must never enter the planning thread.

**Operating loop — follow it in order, every time:**

1. **Explore.** Read only what is needed to decide. Prefer targeted searches and single-range
   reads over whole files.
2. **Plan.** Write a short plan: the files to change, the intended change per file, the
   acceptance criteria, and the verification command to run afterwards.
3. **Get the user's approval.** Never delegate an unapproved plan. Schema and migration
   changes, anything under `.github/workflows/`, `.github/actions/`, `.github/ci-baselines/`
   or `scripts/ci/`, and any new npm script always need explicit approval before delegation.
4. **Delegate to an executor** with a self-contained prompt.
5. **Review the returned summary** against the acceptance criteria. If a summary is vague, ask
   the executor for specifics rather than reading the diff in the planning thread.
6. **Delegate verification** as its own task, and report the exact result.

**The planner must never itself:** create, edit or delete a file; run a build, test, lint,
format or validate command; start or stop the local stack; run a migration; or make a git
commit, branch or push. Those are executor work, without exception.

**The planner may:** read files, search, reason, plan, and review summaries.

**Delegated prompts are self-contained.** An executor cannot see the planning conversation.
Every prompt carries the file paths, the full change to make, the acceptance criteria, the
exact verification command, and every rule from section C that applies to those files. Never
write "as discussed", "the file we looked at", or "continue the previous task".

**Parallelism.** Independent tasks are delegated in parallel. Tasks that touch the same file,
or that depend on each other's output, are delegated in sequence.

**Return contract for every executor.** A compact summary: the paths changed, one line each on
what changed, the commands actually run with their pass or fail result, and any deviation or
open risk. Never file contents, diffs, or long command output.

**Honesty.** A check that was not executed is reported as not executed, never as passing
(CONTRIBUTING.md section 4). Do not assert that a gate passed, that an environment exists, or
that an approval was granted unless it is demonstrably true.

## B. Project facts and verification

**Layout.** npm-workspaces monorepo `rootlco-platform`, Node >= 22, npm >= 10, developed on
Windows. Two workspaces under `apps/*`:

- `@rootlco/api` at `apps/api` — backend only. Route Handlers in `apps/api/src/app/api/v1/**`,
  domain modules in `apps/api/src/modules/<name>/{application,data,domain,index.ts}`,
  foundation code in `apps/api/src/{server,shared,lib,config}`.
- `@rootlco/web` at `apps/web` — frontend only. App Router in `apps/web/src/app/[locale]/**`,
  feature folders in `apps/web/src/features`, shared UI in `apps/web/src/components`, the only
  HTTP layer in `apps/web/src/lib/api`, and `apps/web/src/proxy.ts` in place of a middleware
  file.
- Schema in `supabase/migrations/**` and `supabase/seeds/**`; checkers in `scripts/`,
  `scripts/ci/` and `scripts/db/`.

**The `@/` alias is ambiguous:** it means `apps/api/src` at the repository root and inside
`apps/api`, but `apps/web/src` inside `apps/web`. Prefer `@api` in new root-level test code.

**Cheap verification chain** — no database, no container runtime, no network:

    npm run typecheck
    npm run lint
    npm run format:check
    npm run style:check
    npm run test
    npm run security:all

`npm run verify:repository` bundles typecheck, lint, format:check, the unit tier and
`security:all`. `security:all` already runs the tracked-secret, browser-secret,
scope-exclusion and no-fake-data guards, so those four are not invoked separately.
`format:check` is Prettier over every tracked text file, this one included. `style:check` is
Stylelint at zero warnings over the web stylesheets and is not part of `verify:repository`.

**The root chain does not cover the workspaces.** Root ESLint ignores `apps/**` and the root
TypeScript project excludes them, so run `npm run typecheck:api`, `npm run lint:api`,
`npm run typecheck:web`, `npm run lint:web`, `npm run format:check:api`,
`npm run format:check:web` and `npm run test:web` for the workspace that changed. Targeted
checkers worth running on a matching change: `validate:module-boundaries`,
`validate:api-backend-only`, `validate:web-boundary`, `validate:web-topology`,
`validate:web-tokens`, `validate:web-theme`, `validate:authorization-coverage`,
`validate:openapi`, `validate:exact-money`, `validate:plain-language`, `validate:encoding`,
and `validate:command-coverage` after adding, renaming or removing any npm script.

**Full aggregate** — `npm run verify:workspaces`. It is expensive: two production builds and
the browser smoke. Delegate it as its own task, never as a casual step.

**The database tier is separate** and is never covered by the aggregate. `npm run test:db` and
`npm run test:backend` need a live PostgreSQL. A change under `supabase/migrations/**` or
`supabase/seeds/**` needs, with the user's approval, `npm run supabase:start`,
`npm run supabase:reset` and `npm run verify:database`.

**Local stack, only when the user asks:** `npm run dev:all`, `npm run dev:status` (read-only),
`npm run dev:stop`. Never kill node processes broadly.

## C. Guardrails — tripping one blocks the merge

Most of these are enforced by a script that scans every tracked file, documentation included.

**Module boundaries (apps/api).** A module is reached only through `@/modules/<name>`; never
reach into another module's internals. Nothing under `server/`, `shared/`, `lib/` or `config/`
may import `modules/**`; nothing outside `app/` may import `app/**`. A Route Handler parses
input, calls one module application service and returns — it may not import `server/db`,
`server/events`, `server/audit`, `server/worker` or `server/contracts`. A module's `domain/`
may not import `server/db`, the `pg` package, or any module's `provider/**`. Backend code uses
`@/server/observability/logger`. No computed import specifiers and no symlinks.

**Web boundaries (apps/web).** Never import API source, Supabase or database code, and never a
Node-only module (`fs`, `child_process`, `net`, `pg`, bare or `node:`-prefixed). `fetch` lives
only in `apps/web/src/lib/api`, with one documented exception for the presigned-store upload.
`dangerouslySetInnerHTML` is banned. One brand authority, one token authority, one router root,
one notification host mounted once.

**apps/api stays backend-only:** no pages, stylesheets, client components, React hooks or
imports of the web workspace; `document`, `navigator`, `localStorage` and `sessionStorage` are
restricted globals and `window` only inside a `typeof window !== 'undefined'` guard.

**Authorization.** Every API route carries a literal `defineOperation({...})` with a literal id
and permission codes — or `public: true` with a `publicReason` — and, when `auditClass` is not
`'none'`, an audit action registered in the catalogue. A computed declaration is invisible to
the gate and its route is reported as unguarded.

**Database.** Never edit a committed migration; correct forward with a new timestamp-prefixed
file. Schema first, then row-level security, then application code. Every tenant-scoped table
lands with RLS enabled and forced, an explicit policy, and a test that exercises tenant
isolation — application filtering is never a substitute. Seed data goes in `supabase/seeds/`
and must be registered in `supabase/config.toml`, or it is never applied.

**Content rules that fail the build on a single word.**

- The pilot tenant and the out-of-scope inspection vendor named in CONTRIBUTING.md section 10
  must not appear — as a name, slug or UUID, in a conditional or a literal — anywhere in the
  tracked tree. Tenants are configuration and seed data.
- No fabricated business records anywhere outside `tests/`: nothing invented and shipped or
  auto-inserted, no identity-generation library, no showcase data path, no stubbed HTTP layer
  in application code. The guard matches noun phrases in prose as well as in code, and it
  scans this file.
- Never give a secret a `NEXT_PUBLIC_` prefix, and never commit a credential-shaped value in
  any directory, documentation and tests included.
- Never fabricate a compliance, certification, audit or penetration-test claim.
- User-facing strings in the web message catalogues are plain language: no field names, no
  `null`, no "payload", no dotted error codes.
- Money: inside the financial module trees, no `Number()`, `parseFloat`, `Math.*`, `toFixed`,
  unary plus, or JSON `number` schemas for amounts. The driver returns numeric as a string —
  keep it a string.
- SCSS: `@use` and `@forward` only, relative paths rather than the `@/` alias, CSS logical
  properties only, maximum nesting depth 2, and `!important` only with a documented
  suppression.
- Tailwind and vendored primitives are adopted by ADR-020. Sass owns every design value and
  emits CSS custom properties; the Tailwind theme holds only `var(--…)` references, so a raw
  literal in the Tailwind configuration is a defect. A colour utility that is not registered in
  the theme renders nothing while every test still passes — never invent a utility name. Do not
  introduce a second utility framework or an installed component library, and do not invent
  brand colours.
- A `'use server'` module exports async functions and nothing else.
- The product name has exactly two authorities, one for the web tier and one for the API tier.
  They move in lockstep: either both hold a recognised placeholder or both hold the same
  approved value, never one of each. No other runtime source may name the product.
- Never commit generated artefacts, and never hand-edit a generated file — they are
  regenerated and diffed.
- Never work around a failing gate. Fix the cause. Do not widen an allow-list, add a
  suppression, or reword prose to slip past a scanner. `@ts-ignore`, `@ts-expect-error`,
  `eslint-disable` and `stylelint-disable` need a written justification and reviewer agreement.
- Test honesty is enforced: no `.only`, no undocumented `.skip` or `.todo`, no test file
  without an assertion, no tautological assertion, no retry configuration, and no command
  suffix that discards a failing exit code.

**Branches and commits.** Work branches are cut from `develop`, never `main`; pull requests
target `develop`; there is no direct push to either and no history rewriting. Prefixes:
`feature/ fix/ chore/ docs/ test/ refactor/ security/`, lowercase and hyphenated, carrying the
phase task id. Commit subjects start with that id — `P1-NN-XXX-NNN: imperative summary`, at
most 72 characters, no trailing full stop — and must not claim that a gate passed or that an
approval was granted. Every branch must match a rule in `.github/ci-baselines/`
`phase-ownership-profiles.json`, which declares what it is allowed to change; a branch that
matches none is refused.

**Worktrees.** Several git worktrees are registered against this repository and some hold
unmerged work. Never run `git worktree prune`, never remove one, and never assume one is
current.
