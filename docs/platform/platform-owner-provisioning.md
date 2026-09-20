# Establishing the Platform Owner

**Status:** descriptive. Every statement below was read out of the code it cites. Sections 1–9 were
read at `develop` `5b2c7840da1821f973438d5429665ef4448132f2` on 2026-09-18; sections 2, 4, 5, 8 and
9 were re-read and extended on 2026-09-20 when `scripts/platform/add-platform-operator.mjs` was
added.

**Deployment status, stated plainly:** RootLco runs locally and only locally (ADR-012). No staging
and no production environment exists. Nothing below is a claim that any of the three scripts has
been run anywhere, that a hosted database exists, or that an owner identity has been established. It
is the supported procedure, not a record of one.

**No credential appears in this document.** No password, key, token or example value of any of them
is written here, and none may be added.

**One dated exception, recorded because it is true.** On the local acceptance environment the first
platform-authority account was created by a direct insert on a privileged database connection,
before `add-platform-operator.mjs` existed — at that time genesis was one-time and the grant script
refused an account holding nothing, so there was no supported path for a second holder and the gap
was bridged by hand. That act is not repeatable through this document and is not a procedure: it is
history, stated so nobody reads section 1 and concludes it never happened. No address and no
credential from it is written here.

---

## 1. Why there is no screen for this

The Platform Owner is the holder of platform authority: the person who creates organisations, sets
the plans they subscribe to, and can suspend one. That authority is recorded in
`iam.platform_grants`, and **the product has no write path to that table**. No operation writes it,
no policy admits an application role to it, and a gate under `scripts/ci` keeps it that way.

So platform authority cannot be created from inside the product, by anyone, in either area of it. It
is established by an operator act on a privileged database connection — three scripts, and nothing
else.

That is not an omission. A screen that could mint platform authority would be a screen that could
mint the authority to use itself.

## 2. The three scripts, and which one you need

| Script                                           | Use it when                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/platform/genesis-platform-operator.mjs` | **No platform owner exists yet.** This establishes the first one.                                                                                |
| `scripts/platform/add-platform-operator.mjs`     | **An owner exists and you want ANOTHER one.** An existing owner proves who they are and grants a subset of their own authority to a new account. |
| `scripts/platform/grant-platform-authority.mjs`  | **An owner already exists but lacks a code** — typically one established before a code was added to the catalogue.                               |

Genesis stays one-time: it refuses the moment any active platform grant belongs to a different
account, and adding a second owner does not reopen it. The grant script still cannot create an
owner: it refuses unless the account it names already holds at least one unrevoked platform grant.
The addition script is the only one that mints an owner after genesis, and it can only do so on
behalf of an owner who proved their identity first (section 4a).

## 3. What genesis creates, in one transaction

1. **A home tenant reserved for platform operators.** Operator accounts live in a tenant that holds
   no business data.
2. **The operator's account in it**, `active`, with its status-history row.
3. **The platform grants**, one per code in `PLATFORM_AUTHORITY_CODES`:
   - `platform.organization.provision`
   - `platform.organization.lifecycle`
   - `platform.organization.read`
   - `platform.organization.manage`
   - `platform.subscription.manage`
   - `platform.billing.read`
   - `platform.billing.manage`
   - `platform.statistics.read`
   - `platform.audit.read`
4. **An audit record** in the home tenant, `platform.operator.genesis`, naming the account and the
   grants — identifiers only.
5. **Optionally, the `app_platform` LOGIN role** the application's `PLATFORM_DATABASE_URL` must use,
   created with a password supplied in the environment if the role does not already exist.

**Every write is in one transaction.** Any refusal rolls all of them back and the script exits
non-zero. There is no half-established owner to tidy up after.

### `platform.organization.read` is the base entitlement, and all three scripts enforce it

`GET /api/v1/platform/session` — the first request every console page makes — declares
`platform.organization.read` and nothing else. So an owner granted, say, `platform.audit.read` alone
is refused at that session read and bounced out of the console before any page gate could admit them:
real grants, completely unusable.

All three scripts therefore refuse a grant set that omits that code, through the same function
(`platformGrantSetRefusal`), before a connection is opened. Granting platform authority means
granting the base code **plus** whatever else the owner needs, never a subset without it.

## 4. The refusals each script applies before it writes anything

**Common to all three**

- **Owner-controlled.** `--confirm <email>` must repeat the address given in the environment, and
  `ROOTLCO_ENV` must be exactly one of the two named gates. A run that does not repeat the address
  is refused.
- **Fail-closed.** Any refusal rolls everything back and exits non-zero.
- **Evidence without secrets.** The JSON each writes carries identifiers, timestamps and the database
  host — never a password, key or token.

**Genesis only**

- **One-time.** It refuses when any active platform grant already exists for a **different** account.
- **Idempotent.** A second run for the same address that already holds every grant is a no-op that
  reports the existing identifiers and exits zero.
- **It writes rows, not privileges.** It creates no policy and grants nothing to `app_runtime`. The
  only role it may create is a LOGIN member of `app_platform`, the archetype whose privileges the
  migrations define.
- **Not reachable by an application role.** It needs `INSERT` on `iam.platform_grants`, which no
  application role holds.

**Grant-authority only**

- **It cannot mint an owner.** It refuses unless the named account is `active`, not deleted, and
  already holds at least one unrevoked platform grant.
- **It cannot invent a code.** A `--codes` list naming anything outside `PLATFORM_AUTHORITY_CODES` is
  refused before a connection is opened.
- **It cannot narrow an owner to an unusable set.** A requested set without
  `platform.organization.read` is refused.
- **It adds, never removes.** It inserts a grant for each requested code the account does not already
  hold, attributed to the catalogue's own actor rather than to the account itself.
- **Idempotent.** An owner who already holds every requested code is a no-op that writes nothing —
  not even an audit record — and exits zero.

## 4a. Adding another owner: the supported procedure, step by step

`scripts/platform/add-platform-operator.mjs` is the only path that mints an owner after genesis, and
every run is performed **on behalf of an owner who already holds authority**. There is no
unauthenticated mode and no bootstrap: with nobody holding platform authority, no grantor can be
proved and the run is refused.

**What happens, in order**

1. **The grantor proves who they are.** The script signs the grantor in at the identity provider
   with the grantor's own password. The password is read from a no-echo terminal prompt, or — for a
   non-interactive run only — from `ADD_OPERATOR_GRANTOR_PASSWORD`, which is transient: export it for
   the single command and unset it immediately. It is never a command-line argument, never logged
   and never written to the evidence file. With no terminal attached and no value supplied, the run
   is refused.
2. **The proved identity is resolved in the database**, inside the transaction, to an account that
   is `active`, lives in the operators' home tenant, and holds at least one unrevoked platform
   grant. Anything else is refused.
3. **The new owner's identity is found or invited** at the provider, and the address is serialized
   with the same advisory lock the product's own invitation path takes, so a concurrent invitation
   of that address cannot be handed the same identity.
4. **One transaction writes** the new account in the home tenant (`active`, with its status-history
   row and **no tenant role of any kind**), one grant per requested code with `granted_by` set to the
   grantor's account, and `platform.operator.authority_granted` in the home tenant naming the
   grantor, the new account and the codes — identifiers only.
5. **The same rules are asserted again by SQL inside that transaction**, over the rows just written
   rather than over the variables that wrote them. A disagreement rolls everything back.

**Which codes the new owner gets.** `--codes a,b,…` names them; omitting the flag requests the
**grantor's own full set**. Either way the set must contain `platform.organization.read` and must be
a subset of what the grantor holds.

**What it refuses, and why**

- **No grantor proof** — the sign-in failed, or the provider was unreachable. Nothing is read from
  the database at all.
- **A grantor who is an organisation's own account** — refused twice over: the account is not in the
  operators' home tenant, and it holds no platform grant. An organisation's administrator, however
  privileged inside that organisation, cannot escalate through this path.
- **A grantor who is suspended, deleted, or holds no unrevoked grant.**
- **A requested set without the console base entitlement**, or naming a code outside the catalogue's
  platform authority list.
- **A requested set wider than the grantor's own** — nobody hands out authority they do not hold.
  The message names the codes the grantor lacks.
- **The grantor and the new owner being one address** — refused before a row exists to collide with
  the database's own self-grant constraint. Adding codes to your own account is the grant script.
- **An address already seated in the operators' home tenant** — the message points at
  `grant-platform-authority.mjs`, which is the script for completing an existing owner.
- **An address belonging to an account in any other tenant** — an organisation's own user does not
  become a platform owner through this path.

**Partial failure, and the remedy.** The provider identity is established before the transaction
opens, because the account row needs its subject. If the transaction then fails, the script deletes
**exactly the identity this run created**, by the id this run was handed — never by address, so a
pre-existing identity that happens to share one is never touched. An identity that already existed
is never deleted. If the deletion itself fails, the script prints the identity id and says plainly
that it must be removed by hand at the identity provider; no account row was written, so nothing
else is left orphaned.

**Revocation is not in this script.** Taking authority away has its own refusals — the last holder
of the base entitlement, the last owner on the platform — and its own database proof. It is not
folded in as a flag, and there is no supported revocation procedure in this repository yet.

## 5. Running them

**Always dry-run first.** All three scripts accept `--dry-run`, and in that mode they read, print
what a real run would do, and write nothing to the database: no row is inserted, no audit record is
appended and no evidence file is written. One caveat specific to the addition script: a dry run
still proves the grantor at the identity provider, and if the new owner's identity did not exist it
is invited and kept — the provider is not a transaction, and a dry run that deleted it again would
send a second invitation on the real run.

The inputs each script reads are listed in its own header comment, and they are named there rather
than repeated here so there is one list to keep correct:

- `scripts/platform/genesis-platform-operator.mjs` — the environment gate, the privileged database
  connection, the operator's address and display name, the identity provider and either an existing
  provider subject or the credentials to invite one, the home tenant code, optionally the
  `app_platform` login role and its password, and an evidence path.
- `scripts/platform/add-platform-operator.mjs` — the environment gate, the privileged database
  connection, the new owner's address and display name, the grantor's address and (transiently)
  their password, the identity provider with the keys the sign-in and the invitation need, the home
  tenant code, and an evidence path.
- `scripts/platform/grant-platform-authority.mjs` — the environment gate, the privileged database
  connection, the operator's address and an evidence path.

Read the header of the script you are about to run, in the checkout you are about to run it from,
and supply exactly what it names. Every one of those values is supplied by the Owner or by the
database provider; none can be invented in this repository, and none is written down in it.

The command shape is the same for all three:

```
node scripts/platform/<script>.mjs --confirm <operator-email> --dry-run
```

Drop `--dry-run` only after the dry run printed what you expected. `grant-platform-authority.mjs`
additionally accepts `--codes a,b,…`; omitting it requests every code in `PLATFORM_AUTHORITY_CODES`.
`add-platform-operator.mjs` accepts the same flag, and `--confirm` there repeats the **new** owner's
address — the grantor's address is supplied in the environment, and their password is prompted for.

**What a successful genesis prints:** the outcome, the operator account identifier, the home tenant
identifier, the grants established, the audit record identifier, and where the evidence file was
written. Identifiers, not secrets.

## 6. What the Platform Owner is — and is not

**The owner holds no role in any organisation.** Their account lives in a tenant that holds no
business data, and no platform authority code grants access to any organisation's records. They
cannot open a customer, a vehicle, a work order, an invoice or a stock figure anywhere on the
platform.

**They therefore cannot open a tenant dashboard at all.** The workspace's own session read,
`GET /api/v1/auth/session`, declares the tenant permission `iam.user.read`. The owner holds no tenant
role by construction, so that read refuses them — which is correct, and is exactly why the console's
session read is a separate operation on a separate authority.

What the application does with that refusal is route them, not strand them: when the workspace
session is refused and the platform session answers, the owner is sent to `/{locale}/platform`.

## 7. How each person signs in

**There is one sign-in page, and no separate console address to remember.**

| Who                                       | What they type                                      | Where they land                                   |
| ----------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| The **platform owner**                    | Their own address and password on `/{locale}/login` | `/{locale}/platform` — the Platform Owner Console |
| A **subscribing company's administrator** | Their own address and password on the same page     | `/{locale}` — their organisation's workspace      |

The destination is decided from what the account holds, not from anything either person chooses. An
organisation's administrator has no platform authority, so the console's session read refuses them
and no console page is built for them.

**Where a subscribing company's administrator comes from.** The platform owner creates the
organisation in the console, and that one act also creates its first company, its first branch and
its first administrator. That administrator receives an email with a link, sets their own password
through it, and can then sign in — their account is created `active`, so no further activation step
is needed for the first one. Everybody after them is invited from **Administration → Users** inside
the workspace, and does need an administrator to activate them.

No password is ever set, sent or seen by the platform owner, for anybody.

## 8. What is deliberately not here

- **No credential, key, token or example password.** None may be added to this file.
- **No claim that any of the three scripts has been run.** None was run as part of writing this
  document, and no evidence file from any of them is cited.
- **No hosted procedure.** The two environment gates the scripts accept are named in their headers;
  which one applies is a decision for whoever is running them, in an environment this repository does
  not have.
- **No recovery procedure for a lost owner.** If **every** account holding platform authority is
  lost, all three scripts refuse: genesis because an active grant exists for a different account,
  grant-authority because it cannot mint an owner, and the addition script because no grantor can be
  proved. What to do in that case is not built and is not described here rather than guessed at.
  Keeping more than one owner — which section 4a now makes possible — is what avoids reaching it.
- **No revocation.** Removing an owner's authority has no script.

## 9. Sources

- `scripts/platform/genesis-platform-operator.mjs` — the transaction, `PLATFORM_AUTHORITY_CODES`,
  `PLATFORM_BASE_AUTHORITY_CODE`, `platformGrantSetRefusal`, the one-time and idempotence refusals,
  the `--dry-run` behaviour and the printed result.
- `scripts/platform/add-platform-operator.mjs` — the grantor proof, `grantorRefusal`,
  `overGrantRefusal`, `selfGrantRefusal`, `granteeAddressRefusal`, the replicated address lock, the
  in-transaction SQL re-assertion, the identity compensation and the printed result.
- `scripts/platform/grant-platform-authority.mjs` — `requestedGrantSetRefusal`, `readGrantInput`, the
  requirement that the account already hold a platform grant, the catalogue actor used for
  `granted_by`, and the no-op exit.
- `tests/ci/platform-grant-base-entitlement.test.ts` — the enumeration of the three writers of
  `iam.platform_grants`, and every refusal above driven as a pure function.
- `tests/backend/p1-32-pre-od-add-platform-operator.test.ts` — the addition proved on a database
  replayed from the committed migrations and seeds.
- `apps/api/src/modules/iam/data/identity-repository.ts` — `lockInvitationAddress`, the address lock
  the addition script replicates.
- `apps/api/src/app/api/v1/platform/session/route.ts` — `platform.session-read`, declaring
  `platform.organization.read`, and why that set is not widened.
- `apps/web/src/features/authentication/actions/login.ts` and
  `apps/web/src/features/authentication/api/session.ts` — the sign-in destination, and the redirect
  to the console when the workspace session is forbidden and the platform session answers.
- `apps/web/src/app/[locale]/(platform)/layout.tsx` — the platform session resolved before any
  console markup exists.
- `apps/api/src/modules/iam/data/tenant-bootstrap-repository.ts` — the first administrator's account
  inserted `active`.
- `supabase/seeds/04_iam_permission_catalog.sql` — where the platform authority codes are seeded.
- Related reading: [`environment-configuration.md`](environment-configuration.md) §15 for the values
  only the Owner or a provider can supply, and the user manual's Part 2A
  (`../user-manual/02a-platform-owner-console.md`) for the console itself.
