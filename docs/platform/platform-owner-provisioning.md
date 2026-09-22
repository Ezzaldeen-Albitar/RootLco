# Establishing the Platform Owner

**Status:** descriptive. Every statement below was read out of the code it cites. Sections 1–9 were
read at `develop` `5b2c7840da1821f973438d5429665ef4448132f2` on 2026-09-18; sections 2, 4, 5, 8 and
9 were re-read and extended on 2026-09-20 when `scripts/platform/add-platform-operator.mjs` was
added; sections 2, 4, 4a, 4b, 5, 8 and 9 were re-read and extended on 2026-09-22 when
`scripts/platform/revoke-platform-operator.mjs` was added.

**Deployment status, stated plainly:** RootLco runs locally and only locally (ADR-012). No staging
and no production environment exists. Nothing below is a claim that any of the four scripts has
been run anywhere, that a hosted database exists, or that an owner identity has been established. It
is the supported procedure, not a record of one.

**No credential appears in this document.** No password, key, token or example value of any of them
is written here, and none may be added.

**The Platform Owner's login address on the local environment is `owner@rootlco.com`.** That is an
address, not a credential, and it is written here because an operator running any of the four
scripts below has to name it. **Its password is not in this repository and may never be put in
one.** It is kept in `orchestration/handover/platform-owner-credentials.md` **on the Owner's own
machine**, outside this repository and outside any checkout of it. If that file is lost, the section
8 note about a lost owner applies.

**One dated exception, recorded because it is true.** On the local acceptance environment a
platform-authority account was created by a direct insert on a privileged database connection,
outside all three scripts, before `add-platform-operator.mjs` existed. At that time the only
supported paths were genesis, which refuses the moment an unrevoked grant belongs to another
account, and the grant script, which refuses an account holding no grant at all — so an account
that neither script would admit was seated by hand. That act is not repeatable through this
document and is not a procedure: it is history, stated so nobody reads section 1 and concludes it
never happened. Which holder it was, and whether genesis had run before it, is not recorded here
because this document states only what it can cite. No address and no credential from it is
written here.

---

## 1. Why there is no screen for this

The Platform Owner is the holder of platform authority: the person who creates organisations, sets
the plans they subscribe to, and can suspend one. That authority is recorded in
`iam.platform_grants`, and **the product has no write path to that table**. No operation writes it,
no policy admits an application role to it, and a gate under `scripts/ci` keeps it that way.

So platform authority cannot be created from inside the product, by anyone, in either area of it. It
is established by an operator act on a privileged database connection — four scripts, and nothing
else. Taking it away is the fourth of them, and is equally outside the product.

That is not an omission. A screen that could mint platform authority would be a screen that could
mint the authority to use itself.

## 2. The four scripts, and which one you need

| Script                                           | Use it when                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/platform/genesis-platform-operator.mjs` | **No platform owner exists yet.** This establishes the first one.                                                                                |
| `scripts/platform/add-platform-operator.mjs`     | **An owner exists and you want ANOTHER one.** An existing owner proves who they are and grants a subset of their own authority to a new account. |
| `scripts/platform/grant-platform-authority.mjs`  | **An owner already exists but lacks a code** — typically one established before a code was added to the catalogue.                               |
| `scripts/platform/revoke-platform-operator.mjs`  | **An owner should no longer hold platform authority.** An existing owner proves who they are and revokes all of another account's authority.     |

Genesis stays one-time: it refuses the moment any active platform grant belongs to a different
account, and adding a second owner does not reopen it. The grant script still cannot create an
owner: it refuses unless the account it names already holds at least one unrevoked platform grant.
The addition script is the only one that mints an owner after genesis, and it can only do so on
behalf of an owner who proved their identity first (section 4a). The revocation script is the only
one that takes authority away, it never creates or deletes anything, and it refuses the first owner
and the last owner (section 4b).

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

### `platform.organization.read` is the base entitlement, and all three granting scripts enforce it

`GET /api/v1/platform/session` — the first request every console page makes — declares
`platform.organization.read` and nothing else. So an owner granted, say, `platform.audit.read` alone
is refused at that session read and bounced out of the console before any page gate could admit them:
real grants, completely unusable.

All three granting scripts therefore refuse a grant set that omits that code, through the same
function (`platformGrantSetRefusal`), before a connection is opened. Granting platform authority
means granting the base code **plus** whatever else the owner needs, never a subset without it.

The revocation script takes the same rule from the other end: it has no `--codes` flag and always
revokes **all** of an account's authority. A partial revocation would either be a no-op on the base
code, or would leave exactly the unusable set the three granting scripts refuse to create. Narrowing
an owner is done by revoking them and adding them again with the narrower set.

## 4. The refusals each script applies before it writes anything

**Common to all four**

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

**Revocation only**

- **It cannot revoke the first owner.** Section 4b states how that account is identified.
- **It cannot revoke the last owner.** A run that would leave nobody holding platform authority is
  refused.
- **It cannot create anything, and it deletes nothing.** It only sets `revoked_at` and `revoked_by`
  on grants that exist, and `revoked_at` with a reason on sessions that exist.
- **It cannot narrow an owner.** There is no `--codes` flag: a run takes all of an account's
  authority or none of it.
- **It requires a stated reason.** `REVOKE_OPERATOR_REASON` must be non-blank; it is written on
  every session the run ends and into the audit record.

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
2. **The transaction opens and takes the address lock** — the same advisory lock the product's own
   invitation path takes, before the first read of the address, so a concurrent invitation of that
   address cannot be handed the same identity.
3. **The proved identity is resolved in the database**, inside that transaction, to an account that
   is `active`, lives in the operators' home tenant, and holds at least one unrevoked platform
   grant. The requested set and the new owner's address are checked next. Anything else is refused,
   and every one of these refusals happens **before the provider is written to**, so a refused run
   sends no invitation.
4. **The new owner's identity is found or invited** at the provider — reused when it exists and
   belongs to no account, invited otherwise — while the lock is held, which is the order the
   product's invitation path uses.
5. **The same transaction writes** the new account in the home tenant (`active`, with its
   status-history row and **no tenant role of any kind**), one grant per requested code with
   `granted_by` set to the grantor's account, and `platform.operator.authority_granted` in the home
   tenant naming the grantor, the new account and the codes — identifiers only.
6. **The same rules are asserted again by SQL inside that transaction**, over the rows just written
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

**Partial failure, and the remedy.** The provider identity is established inside the transaction —
after every refusal above, because the account row needs its subject and nothing before that point
should reach the provider — but the provider is not part of that transaction, so a rollback does not
undo it. If the transaction then fails, the script deletes
**exactly the identity this run created**, by the id this run was handed — never by address, so a
pre-existing identity that happens to share one is never touched. An identity that already existed
is never deleted. If the deletion itself fails, the script prints the identity id and says plainly
that it must be removed by hand at the identity provider; no account row was written, so nothing
else is left orphaned.

**Revocation is not in this script — it is its own one.** Taking authority away has refusals the
addition does not have and its own database proof, so it is a sibling script rather than a flag:
`scripts/platform/revoke-platform-operator.mjs`, section 4b. No screen performs it, and adding one
is not planned, for the reason section 1 gives.

**Nothing in section 4a has been run.** The procedure above is read out of the script it cites. No
measurement so far has executed it, in any mode, and this document claims no run of it.

## 4b. Revoking an operator: the supported procedure, step by step

`scripts/platform/revoke-platform-operator.mjs` is the only path that sets `revoked_at` on
`iam.platform_grants`. Like the addition, every run is performed **on behalf of an owner who already
holds authority**, and there is no unauthenticated mode.

**What happens, in order**

1. **The revoker proves who they are.** The script signs the revoker in at the identity provider
   with the revoker's own password, read from a no-echo terminal prompt or — for a non-interactive
   run only — from `REVOKE_OPERATOR_GRANTOR_PASSWORD`, which is transient: export it for the single
   command and unset it immediately. It is never a command-line argument, never logged and never
   written to the evidence file. With no terminal attached and no value supplied, the run is
   refused.
2. **The transaction opens.** The proved identity is resolved to an account that is `active`, lives
   in the operators' home tenant, and holds at least one unrevoked platform grant.
3. **The named account is resolved** by address. It must live in the operators' home tenant and hold
   at least one unrevoked platform grant; an address nobody holds, an organisation's own user, and
   an owner whose authority is already revoked are each refused with their own message.
4. **The two lock-out rules are applied** — the first owner and the last owner, below.
5. **The same transaction writes** `revoked_at` and `revoked_by` on every unrevoked grant of that
   account, `revoked_at` and the stated reason on every unrevoked row it holds in
   `iam.user_sessions`, and `platform.operator.authority_revoked` in the home tenant naming the
   revoker, the account and the codes — identifiers only. The audit record identifier is printed.
6. **The same rules are asserted again by SQL inside that transaction**, over the rows just written
   rather than over the variables that wrote them. A disagreement rolls everything back.

**The first owner cannot be revoked through this script.** Genesis records its act as an
`iam.audit_records` row with action `platform.operator.genesis` naming the account it established,
and **that record is how the first owner is identified** — nothing on `iam.platform_grants`
distinguishes a genesis grant from a granted one, because genesis and the grant script both
attribute `granted_by` to the same catalogue actor. On the local environment that account is the one
whose login address is named at the top of this document, and the refusal names the genesis record
rather than the address, so it holds in an environment where the address is different.

**Where that record is absent, the rule falls back to position.** On a platform whose audit history
does not reach back to its genesis, the account holding the **earliest unrevoked platform grant** is
treated as the first owner and refused. That fallback can refuse an account which is not in fact the
first owner; it cannot admit one which is, and for a lock-out rule that is the direction to fail in.
If you meet that refusal and believe it is wrong, the answer is not to work around it — it is to
raise the case, because the platform has no genesis record and that is itself worth knowing.

**The last owner cannot be revoked at all.** A run that would leave no account holding an unrevoked
platform grant is refused before it writes anything. That state is unrecoverable with what this
repository has: genesis refuses once a grant exists for another account, the grant script cannot
mint an owner, and the addition script cannot prove a grantor when none exists. Add another owner
first. The rule does not exempt the revoker: an owner revoking themselves while they are the last
holder is refused for the same reason.

**What happens to the revoked owner's sessions, stated exactly**

- **Their rows in `iam.user_sessions` are revoked** in the same transaction, carrying the reason the
  run was given. Context resolution refuses a bearer whose session row is revoked, so every request
  from a session that existed before the run is refused from the commit onwards.
- **The identity provider is not reached, and that is a limitation rather than a choice.** GoTrue
  2.x has no endpoint that ends every session of a user id — the product's own adapter records this
  and its `revokeAllSessions(subject)` is deliberately a no-op that says so — and `signOutEverywhere`
  needs the target's **own** access token, which an operator revoking somebody else does not have.
  So an access token already issued to the revoked owner keeps verifying at the provider until it
  expires (one hour on the local stack). That is the residual recorded as W9-R1, unchanged by this
  script.
- **It buys the holder nothing.** `iam.has_platform_authority` requires an unrevoked grant, so every
  `platform.` permission answers false and every console request is denied `ERR-IAM-001` from the
  commit onwards, whichever token is presented.
- **The account is not disabled by this script** and its identity is not deleted. If the person
  should also lose the ability to sign in at all, that is a separate act at the identity provider.

**Nothing is ever deleted.** No row is removed by this script, in any table, in any mode. The
revoked grants keep their rows and carry who revoked them and when, so the record states the
removal rather than losing the grant. The account itself is left `active`, in the home tenant, with
its history: an account and the authority it holds are different facts.

**Nothing in section 4b has been run against a deployed environment.** The procedure above is read
out of the script it cites, and the behaviour it describes is proved on a database replayed from the
committed migrations and seeds by `tests/backend/p1-29-w9-platform-genesis.test.ts`, cases R1–R4.
This document claims no run of it anywhere else.

## 5. Running them

**Always dry-run first.** All four scripts accept `--dry-run`, and in that mode they read, print
what a real run would do, and write nothing to the database: no row is inserted, nothing is
revoked, no audit record is appended and no evidence file is written. One caveat specific to the
addition script: a dry run still proves the grantor at the identity provider, and — if it passed
every refusal and the new owner's identity did not already exist — that identity is invited and
kept. The provider is not a transaction, and a dry run that deleted it again would send a second
invitation on the real run. The run says so on its last line. A dry run of the revocation script has
no provider effect at all: the only provider call it makes is the revoker's own sign-in.

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
- `scripts/platform/revoke-platform-operator.mjs` — the environment gate, the privileged database
  connection, the address of the owner being revoked, the reason, the revoker's address and
  (transiently) their password, the identity provider with the key the sign-in needs, the home
  tenant code, and an evidence path.

Read the header of the script you are about to run, in the checkout you are about to run it from,
and supply exactly what it names. Every one of those values is supplied by the Owner or by the
database provider; none can be invented in this repository, and none is written down in it.

The command shape is the same for all four:

```
node scripts/platform/<script>.mjs --confirm <operator-email> --dry-run
```

Drop `--dry-run` only after the dry run printed what you expected. `grant-platform-authority.mjs`
additionally accepts `--codes a,b,…`; omitting it requests every code in `PLATFORM_AUTHORITY_CODES`.
`add-platform-operator.mjs` accepts the same flag, and `--confirm` there repeats the **new** owner's
address — the grantor's address is supplied in the environment, and their password is prompted for.
`revoke-platform-operator.mjs` has no `--codes` flag at all, and `--confirm` there repeats the
address of the owner **being revoked** — the revoker's address is supplied in the environment, and
their password is prompted for.

**What a successful revocation prints:** the outcome, the revoked account identifier, the revoker,
the home tenant, the codes revoked, how many sessions were ended, how many owners are left, the
audit record identifier, the plain statement that provider sessions were not ended, and where the
evidence file was written. Identifiers, not secrets.

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
- **No claim that any of the four scripts has been run.** None was run as part of writing this
  document, and no evidence file from any of them is cited.
- **No hosted procedure.** The two environment gates the scripts accept are named in their headers;
  which one applies is a decision for whoever is running them, in an environment this repository does
  not have.
- **No recovery procedure for a lost owner.** If **every** account holding platform authority is
  lost, all four scripts refuse: genesis because an active grant exists for a different account,
  grant-authority because it cannot mint an owner, the addition script because no grantor can be
  proved, and the revocation script because it has nothing to act on and no revoker to prove. What
  to do in that case is not built and is not described here rather than guessed at. Keeping more
  than one owner — which section 4a makes possible — is what avoids reaching it, and the revocation
  script refuses to take the last one away precisely so it cannot be reached by accident.
- **No revocation from inside the product.** Section 4b is an operator command on a privileged
  connection. No screen revokes platform authority and none is planned, for the reason section 1
  gives.
- **No partial revocation.** There is no way to take one code away and leave the rest.
- **No provider-side sign-out of somebody else.** Section 4b states what that means and why.

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
- `scripts/platform/revoke-platform-operator.mjs` — the revoker proof, `revokerRefusal`,
  `targetRefusal`, `firstOwnerRefusal`, `lastOperatorRefusal`, the genesis marker and its structural
  fallback, the grant and session updates, the in-transaction SQL re-assertion and the printed
  result.
- `tests/ci/platform-grant-base-entitlement.test.ts` — the enumeration of the three writers of
  `iam.platform_grants`, the enumeration of the single path that revokes one, and every refusal
  above driven as a pure function.
- `tests/backend/p1-29-w9-platform-genesis.test.ts` — cases A1–A7, the addition, and cases R1–R4,
  the revocation, both proved on a database replayed from the committed migrations and seeds. They
  sit in that file rather than one of their own because a new file under `tests/backend` moves a
  count a sealed P1-27 record states.
- `apps/api/src/server/auth/authorization.ts` and
  `supabase/migrations/20260831090000_iam_platform_authority.sql` —
  `iam.has_platform_authority`, the predicate every `platform.` code is answered by and the reason a
  revoked grant becomes `ERR-IAM-001` on the next request.
- `apps/api/src/modules/iam/provider/supabase-provider.ts` — `revokeAllSessions` and
  `signOutEverywhere`, and what each can and cannot end at the identity provider.
- `apps/api/src/server/context/resolve-context.ts` — the refusal of a bearer whose session row is
  revoked.
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
