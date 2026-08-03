# Phase 1-26 — administration workflows

**Classification:** Confidential — Commercial Product and Pilot Planning

Eleven screens, what each one calls, and what each one deliberately does not do.

---

## 1. The hub — `/[locale]/administration`

A map, not a dashboard. No counts, no queues, no "12 users pending": there is no
operation that returns those numbers, and a screen of plausible zeros reads as a
working product that happens to be empty.

Each card appears only when the actor holds the permission its screen needs — the
same rule the sidebar uses. An entry an operator cannot open is a door with no
handle.

## 2. Users — `iam.user.read`

| Action                  | Operation                               | Guard                                  |
| ----------------------- | --------------------------------------- | -------------------------------------- |
| List                    | `GET /iam/users`                        | cursor page, `status` filter, `search` |
| Invite                  | `POST /iam/invitations`                 | `iam.user.manage`                      |
| Activate                | `POST /iam/invitations/{id}/activation` | reason; provider must confirm          |
| Cancel invitation       | `DELETE /iam/invitations/{id}`          | reason                                 |
| Lock / unlock / archive | `POST /iam/users/{id}/status`           | reason; `+ iam.session.view_all`       |
| Sign out everywhere     | `DELETE /iam/users/{id}/sessions`       | reason; `+ iam.session.view_all`       |

**Every row action is a confirmation with a written reason.** Not decoration:
four of these operations take a `reason` that becomes an audit record and the
backend refuses an empty one. The reason stays in component state until submit —
it is free text about an operational decision and belongs in neither a store nor
a URL.

**Only legal transitions are offered.** `invited` → activate or cancel;
`active` → lock or archive; `locked` → unlock or archive; `archived` is
**terminal and offers nothing**. A disabled Archive on an archived account
invites the operator to wonder what is wrong with the button.

**Search never enters the URL.** The term is sent to the backend as a parameter
of a POST-backed Server Action; the table's URL policy keeps free text out of
history, proxy logs and the `Referer` header.

## 3. Roles — `iam.role.read`

`GET /iam/roles` (cursor), `POST /iam/roles`, `PATCH /iam/roles/{id}` with
`If-Match`.

**There is no delete and no detail operation.** Archiving is
`PATCH … {archive:true}` and that is what the screen offers; a Delete button
would be a promise the platform cannot keep. **No assigned-user count is shown**,
because none is published and a zero meaning "not published" is worse than no
column.

A **system role** offers no actions and says why — the backend refuses it
outright.

## 4. Permissions — `iam.role.read`

`GET /iam/permissions` (the whole catalogue), `GET|POST|PATCH|DELETE
/iam/roles/{id}/permissions[...]`.

Grouped by domain, with the risk level the catalogue publishes. An unrecognised
risk level is shown **verbatim** rather than mapped to "low" — inventing a
reassuring value for something the platform added later is the wrong direction to
fail.

The notice at the top is the point of the screen: _what you see here is a
convenience; every request is checked by the service, and its decision is the one
that applies._ A screen that lists permissions invites the belief that the list
**is** the access control. It is a view of `iam.role_permissions`, and the
database decides.

Escalation is refused by `assertDelegable` server-side. This screen **warns**
before a high-risk grant and does not re-implement the rule.

## 5. Approval limits — `iam.approval.manage`

`GET|POST /iam/approval-limits`, `PATCH /iam/approval-limits/{id}` with
`If-Match`.

**Money is a decimal string from the keyboard to the wire.** The amount field is
`inputMode="decimal"`, **not** `type="number"` — a number input hands back a
value the browser has already coerced, drops trailing zeros, and differs between
locales on the decimal separator. It is validated by the contract's own pattern
and submitted unchanged.

`limitType` and `currency` are operator-supplied. The contract fixes their shape,
not their meaning, so **no default limit type and no default currency** is
offered, and no ordering between types is implied — an approval hierarchy is a
business rule nobody has approved.

The list operation takes no cursor and returns the **complete set**, so the table
is given a real total, pages it client-side, and the screen says so. Client-side
paging of a complete set is arithmetic; paging a _window_ and calling it a set is
the thing that must never happen.

## 6. Organization — `org.tenant.read`

`GET|PATCH /org/tenant`, `GET|POST /org/companies/{id}/settings`,
`GET|POST /org/branches/{id}/settings`.

`tenantCode` and `status` are shown as facts and have **no control** — they are
absent from the update contract by design, and tenant status is an
owner/operator capability (ADR-008). A disabled input would imply someone inside
this application could enable it.

Locale and timezone are foreign keys to catalogues **no operation publishes**, so
the screen does not offer a list it does not have; the backend's "not a
registered platform value" verdict is the authority.

Settings are **append-only versioned rows**. A concurrent writer that takes the
version first produces `ERR-CON-001`, reported as a conflict — never retried,
because a silent re-submit would overwrite whatever the other writer just
decided.

A **sensitive** setting comes back with its value **withheld**, and the screen
says "configured, value withheld" rather than showing an empty cell.

## 7. Numbering rules · Taxes · Currencies — settings-backed

None of these has a dedicated operation (`P1-26-F-003` … `P1-26-F-005`). All
three are the same settings editor, narrowed by key prefix, with a notice on the
page saying so.

- **Numbering** — also states that there is no preview operation, and that
  numbers are **always** allocated by the service; nothing on the screen produces
  one.
- **Taxes** — no country, no rate, no effective date. The rate is stored as a
  **string**, not a number: it is money-adjacent and exact in the database.
- **Currencies** — no base currency, no exchange rate. Codes are validated for
  shape and never against a list the Frontend does not have.

The key namespace is an engineering decision recorded as `P1-26-OD-001`.

## 8. Languages — `org.tenant.read`

Two different things, not conflated:

- **What this application serves** — Arabic and English, from the single i18n
  authority. Not runtime-configurable, because a locale with no message catalogue
  is a screen full of translation keys.
- **What the workspace defaults to** — `defaultLocale` on the tenant record,
  through the approved contract.

`shared.languages` has no read operation, so the screen does not claim to manage
the platform's language registry.

## 9. Audit log — `iam.audit.view`

`GET /audit-events` (mandatory `from`/`to`, cursor), `GET /audit-events/{id}`.

**Read-only, and it says so.** Opening the screen is itself recorded
(`iam.audit.viewed`), and the page states that too rather than letting an
operator discover it in their own trail.

The range is required, so the screen opens on the **last seven days**, computed
**server-side** — computing it in the browser would make the first request depend
on the visitor's clock, so two operators in different time zones would open the
same screen on different windows and neither would know why.

A withheld detail value is shown as **withheld**, distinct from a value that is
genuinely absent. Rendering both as an empty cell would merge two different
facts.

**No export.** There is no export operation, and one built in the browser would
be a client-side copy of restricted data leaving through a path with no
server-side authorization and no export audit.

## 10. System settings — `org.company.read` or `org.branch.read`

The general settings editor at both addressable scopes. `shared.system_settings`
carries a platform scope that no operation exposes, and the page says so rather
than leaving an operator hunting for a level that is not reachable.

Anything the narrowed screens write is visible here too, which is the correct
relationship between a specific view and the general one.
