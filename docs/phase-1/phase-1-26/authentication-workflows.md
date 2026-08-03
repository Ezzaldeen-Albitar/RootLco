# Phase 1-26 — authentication workflows

**Classification:** Confidential — Commercial Product and Pilot Planning

What happens, in order, on each authentication screen — and the reasoning behind
the decisions that are not obvious from the code.

---

## 1. Sign in

```
/[locale]/login
  ↳ loginAction (Server Action)
      → POST /api/v1/auth/login  { tenantId, email, password }
      → writeSession(accessToken, expiresAt)     httpOnly cookie
      → writeTenantHint(tenantId)                non-sensitive, pre-fill only
      → redirect(/[locale])
```

**Three fields, and the workspace identifier is one of them.** The contract
requires `tenantId`, so the form collects it. It is a **lookup key, never a
grant**: the account must exist inside it and hold the provider subject the
provider just verified, and a caller who guesses one gets the same generic
failure as a wrong password. Collecting it discloses nothing, and it is
remembered in a non-`httpOnly` cookie so it does not have to be retyped.

**Every credential failure is one answer.** The backend collapses wrong password,
unknown address, unknown tenant, unconfirmed identity, disabled identity,
`invited`, `locked`, `archived` and tenant mismatch into `ERR-IAM-002` with one
message. The action preserves that: one banner, one sentence, no per-field "no
account with that address".

Two failures **are** distinguishable, and neither is a credential verdict:

- **Rate-limited.** The same answer for every address; it tells an attacker
  nothing they did not cause themselves, and hiding it would leave an operator
  staring at a wrong-password message while the real problem is that they must
  wait.
- **Unavailable.** An outage is an operational fact, not a verdict.

**Double submit** is blocked by `useFormStatus`, which is owned by React and
cannot be left stuck by an action that redirects or throws.

**The transition is a redirect, not a render.** It replaces the sign-in entry in
history, and it starts a fresh server render — which is what resolves the session
and its scope.

## 2. Forgotten password

```
/[locale]/forgot-password
  ↳ requestPasswordResetAction
      → POST /api/v1/auth/password-reset  { email }
      → always the same success state
```

The backend answers **202 for every address**: it does not look the address up
locally and writes no row. The interface preserves that — any failure other than
a rate limit or an outage is _reported as success_, because a 4xx surfaced here
would say what the backend refuses to say.

The form is **replaced** by the confirmation rather than left beneath it. A
submit button under a "check your email" message invites a second request the
rate limiter will refuse, and the refusal reads as the reset having failed.

`redirectTo` is deliberately **not sent**. The backend matches it exactly against
a configured allow-list and falls back to the first entry when absent; the web
tier does not hold that allow-list, so any value it invented would either be
refused or force someone to widen the list to make the form work — and the link
being redirected carries a single-use credential.

## 3. Password reset

```
/[locale]/reset-password?token=…   or   #access_token=…
  ↳ RecoveryTokenBridge reads the token, ERASES the fragment
  ↳ completePasswordResetAction
      → POST /api/v1/auth/password-reset/completion  { token, password }
```

**The token can arrive in a fragment**, which is never sent to the server. A
server-only implementation would show "this link is not complete" to every user
of a provider that uses that shape. `RecoveryTokenBridge` reads it with
`useSyncExternalStore` — not an effect, which would render the fallback for one
frame first, and on a page reached from an email that flash reads as a broken
link.

**The fragment is erased** with `history.replaceState` on first read: no
navigation, no history entry. That stops the credential from being read back out
of the address bar, from being copied with the URL, and from being restored when
the tab is reopened. It is erased whether or not it was usable — a malformed
fragment is still a credential-shaped string in the address bar.

The token is never written to storage, a cookie, a query parameter, a log or a
returned state — including a validation error, which is the quiet way a
credential ends up in a log index.

**Expired, invalid and already-used are one message.** The backend does not
distinguish them, and all three have the same useful next step: ask for a new
link.

**There is no `next`, `returnTo` or `redirect` parameter anywhere in this flow.**
An open redirect on the page that completes a credential change is the
highest-value one in any application: the visitor arrived from an email and is
primed to trust whatever it shows them next.

## 4. Account activation

```
/[locale]/activate-account?token=…   (same bridge, same operation)
```

**This page does not activate the account, and says so.**
`iam.has_permission` returns false for a non-`active` account and every write to
`iam.user_accounts` is gated on `iam.user.manage`, so an invitee cannot activate
itself and no request path exists that would let it. That is the schema's
deliberate position: a lifecycle transition has an accountable administrative
actor.

What the invitee _can_ do is set a password with the provider token their
invitation carried. The administrator then activates from the Users screen, and
`activate()` asks the provider whether the identity is confirmed and **refuses**
if it is not — so the invitee's step is a verified precondition, not a formality.

The confirmation says exactly that. "Your account is now active" would be wrong
every time.

## 5. Invitation

```
Users screen → Invite
  ↳ inviteUserAction
      → POST /api/v1/iam/invitations  { email, displayName, mfaRequired?, roleIds? }
```

Requires `iam.user.manage`. Role choices are bounded by the inviter's own
delegable authority server-side; the picker filters system roles out because the
backend refuses them outright, so offering one would waste the operator's time
and then blame them.

A duplicate address is `ERR-RES-002` — a **deterministic conflict**, not a silent
re-invite, because re-inviting would issue a second live token for the same
identity. It is reported with its own sentence.

The dialog does not close itself on success. An auto-close takes the confirmation
off screen before it has been read.

## 6. Profile

```
/[locale]/profile
  ↳ GET /api/v1/auth/session                       always
  ↳ GET /api/v1/iam/users/{id}   only with iam.user.manage
  ↳ PATCH /api/v1/iam/users/{id} + If-Match        only with iam.user.manage
```

There is **no self-service profile operation**. Without `iam.user.manage` the
screen is read-only and says an administrator makes the change, rather than
presenting a form that will be refused.

The action reads `session.userId` and the form carries **no identifier**. If it
did, an actor holding `iam.user.manage` could edit any account from the profile
screen — a privilege-escalation path created entirely by a hidden field.

## 7. Session expiration and sign-out

```
(dashboard)/layout → requireSession(locale)
   no cookie                → redirect /login?reason=signed-out
   cookie the backend rejects → clearSession() → redirect /login?reason=expired
   backend unreachable      → redirect /login?reason=unavailable
```

**The check runs in the layout**, before any child page's markup exists — which
is what makes "no protected-content flash" structural rather than something every
page has to remember.

**A rejected cookie is cleared on the way out.** That is what makes the redirect
terminal: a cookie that is present but rejected would otherwise send the operator
to the dashboard, back to sign-in, and around again.

**The sign-in page performs no session check**, which is the other half of that
guarantee.

Sign-out is a **form, not a link**: it ends a session, so it is a POST. A
`GET /logout` link is followed by prefetchers, antivirus scanners and anything
that walks the page. The action clears the cookie **first** and tells the backend
second — if the remote call fails the operator has still pressed Sign out, and
leaving a usable token in their browser because a network call failed is the
wrong way round.

Mid-action expiry is reported as `expired` with a route back to sign-in, not as a
generic failure the operator is invited to retry.
