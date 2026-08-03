# Phase 1-26 — known limitations

**Classification:** Confidential — Commercial Product and Pilot Planning

What this phase does **not** do, stated plainly. Every item below is a boundary
that was found and recorded, not a defect that was missed — and each is visible
in the interface as well as here, so an operator meets the limit with an
explanation rather than with a blank space.

---

## 1. A session lasts as long as its access token

`POST /api/v1/auth/login` returns a refresh token. There is **no
`/auth/refresh` operation in the route tree**, so nothing can spend it, and it is
discarded rather than stored.

**Consequence.** When the access token expires the operator is signed out and
must sign in again. There is no silent renewal.

**Why it was not built.** A refresh endpoint is Backend work, and P1-26 is
forbidden from Backend feature development. Recorded as `P1-26-OD-006`.

## 2. Five screens edit organization settings, not their own subject

Numbering rules, taxes, currencies, languages and system settings have database
tables and **no route handler exposes any of them**
(`P1-26-F-003` … `P1-26-F-007`). They are built on the approved, deliberately
decision-neutral organization-settings contracts.

**Consequence.** The values are exact and versioned and audited, but they are
stored under a settings key rather than in the typed table a later Backend phase
will expose. Moving them will be a data migration.

Every one of those screens says so on the page. The key namespace is
`P1-26-OD-001`, awaiting Owner ratification.

## 3. Companies and branches are shown by reference, not by name

There is no company or branch directory operation (`P1-26-F-008`), and
`GET /api/v1/auth/session` returns bare identifiers — **none at all** for an
unrestricted actor.

**Consequence.** Scope is displayed as UUIDs, and an unrestricted actor types the
identifier they want to work on. The server still decides:
`assertScopeWithinAuthority` runs **before** existence is checked, so an
identifier outside the caller's authority is refused identically whether or not
it names a real company. Typing one buys no information and no access.

## 4. A profile is read-only without an administrative permission

`PATCH /api/v1/iam/users/{userId}` requires `iam.user.manage`. There is no
self-service update operation (`P1-26-F-009`).

**Consequence.** Most accounts see their profile and cannot change it. The screen
says an administrator makes the change rather than presenting a form that would
be refused.

## 5. Account activation is administrative, and the invitee's screen says so

`iam.has_permission` returns false for a non-`active` account, and every write to
`iam.user_accounts` is gated on `iam.user.manage` — so an invitee cannot activate
itself and no request path exists that would let it.

**Consequence.** The invitee sets a password; an administrator activates. The
confirmation says exactly that. A screen claiming "your account is now active"
would be wrong every time.

## 6. The audit log has no export

There is no export operation for audit records. One built in the browser would be
a client-side copy of restricted data leaving through a path with no server-side
authorization and no export audit — precisely what the export policy exists to
prevent. The screen states that no export is offered.

## 7. Approval limits are not paginated by the server

`GET /api/v1/iam/approval-limits` takes filters and no cursor: it returns the
complete set (`P1-26-F-010`). The table pages it client-side and labels it as the
complete list. That is honest for a whole set; what the table never does is page
a _window_ and call it a set.

## 8. Roles cannot be deleted, and carry no assigned-user count

Neither operation exists. Archiving is offered because that is what the contract
supports; no user count is shown because a zero that means "not published" is
worse than no column at all.

## 9. Monitoring has an adapter boundary and no external service

`P1-26-DO-002` implements correlation-ID propagation, safe structured client
logging and the error-boundary surface. No external monitoring service is
configured and none is claimed to be operational — see `ci-evidence.md`.

## 10. Canonical DOCX documents are not re-synchronised

Carried forward from P1-25. Per `docs/governance/canonical-documents.md` this
does not block a phase gate; it blocks production release and formal external
delivery.

## 11. One DB/RLS observation is unexplained

`P1-26-F-012`: an outbox claim limited to 4 returned 6 rows, once, on the first
baseline measurement. It passes 3/3 in isolation and 1636/1636 as a tier on its
own, and the mechanism has not been established. It belongs to P1-5's
shared-services surface, not to P1-26, and is recorded as unexplained rather than
dismissed as flaky.
