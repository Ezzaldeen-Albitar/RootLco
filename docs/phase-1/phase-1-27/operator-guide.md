# Phase 1-27 — operator guide: CRM and Vehicles

**Classification:** Confidential — Commercial Product and Pilot Planning

What the CRM and Vehicle screens do, what they deliberately do **not** do, and
what each refusal means for the person using them. Written for the operator, not
for the developer — `developer-guide.md` is the other half.

Every "not available" below is a decision with a reason. None of them is a bug,
and none of them is a screen that half-works.

---

## Customers

### Finding a customer

Search runs **when you ask it to** — press Search or press Enter. It does not
search while you type. Typing a twelve-character name would otherwise spend
twelve of the thirty searches the system allows each minute, and you would run
out mid-shift.

You can search by name (matches from the beginning), by customer number (must
match exactly), by type and by status. **Phone and email search do not exist
yet** — the backend does not publish them, and a box that quietly ignored what
you typed would be worse than no box.

Results show Previous and Next, not "page 4 of 37". The system does not count
the whole result set, so a page number would be a guess that is right on the
first page and wrong afterwards.

### Creating a customer

Individual and company customers are different forms because they are different
records, not one form with a toggle.

When you enter details that resemble an existing customer, the screen checks for
possible duplicates **once, when you ask it to** — not on every keystroke. That
check is recorded in the audit log, which is why it is not run casually.

### The customer profile

Eight sections: contacts, addresses, communication preferences, consents, notes,
alerts, tags and restrictions.

Each needs its **own** permission to change, and they are not interchangeable.
Being able to add a note does not let you record a consent decision, and being
able to raise an alert does not let you impose a restriction — refusing to serve
someone and flagging them are different authorities.

If a section shows "You do not have access", you are not seeing an error and you
are not seeing an empty section. You are being told the records exist and are
not yours to see.

**Notes may be incomplete.** When some notes are restricted from you, the screen
says so above the list. An operator who cannot tell "there are three notes" from
"there are three notes you may read" will act on the wrong picture.

### Possible duplicate customers

Reachable from the sidebar, and only if you hold the duplicate-review
permission — a separate permission from being able to read a customer.

The queue shows pairs the system believes may be the same person. You can
**dismiss** a pair, with a reason, when the two records are genuinely different
people.

**You cannot combine two customer records.** The rules for combining them have
not been decided, and until they are there is no control anywhere on the page
that starts one. This is not a permission you are missing; the capability is not
present for anyone.

Neither record in a pair is "the duplicate". The order is the order the detector
happened to record them in, and the screen does not present one as the original.

---

## Vehicles

### Finding a vehicle

Same rule as customers: search on intent, never while typing, and at least one
criterion is required. An unfiltered vehicle search is a scan of every vehicle in
the tenant, and the screen refuses it and says so instead of running it.

VIN search is exact. The screen shows you how it will read what you typed before
it searches. Note that **I, O and Q are preserved exactly as entered** — a real
VIN never contains them, so silently "correcting" them to 1 and 0 would hide the
fact that the number you have is not a valid VIN.

### The vehicle profile

Eight tabs: overview, owners, plates, odometer, EV details, linked vehicles,
documents, and change history.

**A merged vehicle is still shown, and shown as frozen.** It is not hidden,
because live work orders may still reference it. Every editing control is
withdrawn and the reason is stated, rather than left to fail when you press it.

Editing a vehicle's description, changing its lifecycle status and managing its
relationships are **three different permissions**. Holding one does not show you
the others.

### Documents

The Documents tab needs the **document-management** permission, which comes from
a different part of the system than vehicle access. This is the one place where
those two do not line up: you may be able to see everything about a vehicle and
still not its documents, or the reverse.

The list shows a document reference and nothing else — no name, type or date.
The document service does not publish those to this screen, and the tab says so
rather than showing four empty columns that look like missing data.

**Downloading a document does not start from this page.** That is a separately
audited action.

### Photos and media

**Not available.** Accepted file types, size limits and storage have not been
decided, and nothing is uploaded or stored until they are. There is no partially
working upload anywhere in the product.

### Change history

The Change History tab shows changes to **the vehicle's own details** — its
colour, its model year, its description. It is not a combined timeline of
everything that ever happened to the vehicle.

Owners, plates, odometer readings and linked vehicles each have their own tab
with their own history, because the system stores them separately. Merging them
into one list would mean inventing a single sequence that does not exist, and it
would disagree with each tab that shows the real one.

### Possible duplicate vehicles

Same shape as the customer queue, same separate permission, same single
decision: dismiss with a reason. **Combining two vehicle records is not
available**, for the same undecided rules.

The list does **not** search for new duplicates when you open it. Finding new
pairs is a separate, audited process, and a queue that searched every time
somebody looked at it would fill the audit log with people looking.

---

## What a failure message means

Five different things can go wrong and they read differently, because the right
next step is different for each.

| what you see                     | what happened                               | what to do                                                  |
| -------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| **You do not have access**       | The records exist; they are not yours       | Ask an administrator; retrying will not help                |
| **Service unavailable** + Retry  | Too many requests, or the service hiccupped | Wait a moment and press Retry. Quote the reference          |
| **Your session has ended**       | You have been signed out                    | Sign in again. There is no Retry, because it cannot work    |
| **Something went wrong** + Retry | A genuine fault                             | Retry once, then report it with the reference               |
| **Not found**                    | The record is not there                     | Check the reference you followed; there is nothing to retry |

**The reference code** shown with a failure is what lets support find your exact
request in the system log. Quote it. Without it a report is "it broke this
morning", which cannot be traced.

Before this phase all five of these read as "something went wrong", including the
one that just meant you were searching quickly.

The wording above is quoted from the product, not paraphrased. Two of these rows
used to say "You do not have permission" and "Temporarily unavailable" — phrases
that read well and appear on no screen, so an operator searching for what this
guide told them to look for would have found nothing. The check that keeps them
honest now reads the message catalogue rather than this page.

---

## Two things this product will never do

**No screen shows you a total row count.** Not "1–25 of 431". The system reports
whether there is a next page and nothing more, and a number computed in the
browser would be right on the first page and quietly wrong afterwards.

**No screen decides what you may see.** Every permission is enforced by the
server. Hiding a button is a courtesy so you do not press something that will
fail — it is never the thing that stops an action.

<!-- `DOC-002`, the guidance half. An operator cannot check this page against
     the product, so the page is checked against the product instead.

     Three claims are proved by `validate:p1-27-doc-counts`:

       - the search budget, read out of the API's own rate-limit policy AND out
         of the binding on customer search, because either half alone is
         satisfiable while the sentence is false;
       - the failure vocabulary, derived from the `ReadFailureStatus` union and
         resolved in BOTH message catalogues. The web suite reads `en.json` only
         (`D-01`), so "quoted from the product" was proved for one locale of
         two, on a page whose readers are half Arabic;
       - the three capabilities this page promises are absent, each backed by a
         rule in the ownership gate. Drop the rule and the promise stops being
         enforced, so the promise must not survive it.

     An unknown claim name below is a build failure, not a silent pass. -->

<!-- checked: operator-guide/search-budget -->
<!-- checked: operator-guide/failure-states -->
<!-- checked: operator-guide/absent-capabilities -->
