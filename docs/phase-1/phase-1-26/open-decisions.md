# Phase 1-26 — open decisions

**Classification:** Confidential — Commercial Product and Pilot Planning

Decisions this phase could not make for itself, and engineering decisions it did
make that the Owner should ratify.

Nothing here was invented. Where a business decision was required and absent, the
implementation is **decision-neutral** — it provides a place for the answer and
supplies none.

---

## P1-26-OD-001 — the settings key namespace

**Type:** engineering decision, Owner ratification requested · **Status:** Open

Five screens store what an operator enters in the organization-settings store,
because the platform publishes no dedicated operation for their subject
(`P1-26-F-003` … `P1-26-F-007`). Something had to name the keys.

| Screen          | Prefix       | Keys                                                                            |
| --------------- | ------------ | ------------------------------------------------------------------------------- |
| Numbering rules | `numbering.` | `numbering.invoice.prefix`, `.suffix`, `.padding`, `.start_at`, `.reset_period` |
| Taxes           | `tax.`       | `tax.code`, `tax.name`, `tax.rate_percent`, `tax.effective_from`, `tax.active`  |
| Currencies      | `currency.`  | `currency.enabled_codes`                                                        |

**What this is.** The equivalent of choosing a column name. It says _where_ a
value lives; it does not say what the value should be, and none of them ships
with one.

**Why it needs ratification.** Changing the namespace after values exist is a
data migration, and a later Backend phase that exposes
`sal.invoice_numbering_configs` or `org.tax_rates` properly will need to know
where the interim values were put.

**Recommendation.** Ratify as-is, or supply a namespace. Either answer is cheap
now and expensive after a pilot has entered data.

---

## P1-26-OD-002 — tax jurisdiction and rates

**Type:** business decision · **Status:** Open — implemented decision-neutrally

No country is assumed. Jordan is not hard-coded. No rate, no tax code and no
effective date is supplied. The Taxes screen offers empty slots and states on the
page that every value is one the organization decided.

**What is needed to close it.** The tax regime the pilot operates under, and
whether rates are per-company or per-branch.

---

## P1-26-OD-003 — base currency and enabled currencies

**Type:** business decision · **Status:** Open — implemented decision-neutrally

No base currency is chosen. No exchange rate is held or calculated. Currency
codes are validated for shape (`^[A-Z]{3}$`, the same expression the
approval-limit contract uses) and never against a list, because
`shared.currencies` has no read operation.

---

## P1-26-OD-004 — numbering formats

**Type:** business decision · **Status:** Open — implemented decision-neutrally

No prefix, suffix, padding, start value or reset period is presumed. Numbers
themselves are **always** allocated by the service; nothing on the screen
produces one, and the screen says so.

---

## P1-26-OD-005 — approval-limit types

**Type:** business decision · **Status:** Open — implemented decision-neutrally

`limitType` is operator-supplied and the contract fixes only its shape. No
default type is offered and **no ordering between types is implied** — the
screen presents a flat list, because an approval hierarchy is a business rule
nobody has approved.

---

## P1-26-OD-006 — session lifetime and re-authentication

**Type:** business decision · **Status:** Open — see `known-limitations.md`

`POST /api/v1/auth/login` returns a refresh token and there is **no
`/auth/refresh` operation in the route tree**. The refresh token is therefore
discarded: storing a credential nothing can spend would be worse than not having
it.

The consequence is that a session lasts exactly as long as its access token, and
an operator is signed out when it expires rather than being renewed silently.

**What is needed to close it.** Either the acceptable session lifetime, or
authorisation for a Backend phase to publish a refresh operation. Neither is
P1-26's to decide.

---

## P1-26-OD-007 — the audit-log default window

**Type:** presentation default, Owner ratification requested · **Status:** Open

`GET /api/v1/audit-events` requires a bounded `from`/`to` range, so the screen
must open on something. It opens on the **last seven days**, computed
server-side so two operators in different time zones see the same window.

Seven days is a presentation default the operator changes freely, stated on the
page as such. It is not a retention period and not a business rule.

---

## P1-26-OD-008 — the gallery is reachable without a session

**Type:** engineering decision, recorded · **Status:** Recorded, no action needed

Every screen under `(dashboard)` requires a session. The gallery does not: it
renders fixed fixtures, holds no customer or business data, exposes no
privileged capability, and is already gated by `galleryEnabled()`, which serves a
404 in production unless a deployment opts in.

Putting it behind the session would have been more locked down and would have
broken the design-review workflow it exists for — a reviewer looking at
components does not necessarily hold an account in a tenant. Recorded here so the
reasoning is re-made rather than inherited if a second screen is ever added to
that route group; a test asserts the group holds only the gallery.
