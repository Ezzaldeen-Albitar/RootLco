# P1-31 — the Owner's decisions of 2026-09-16

**Status:** RECORDED · **Authority:** the Product Owner, 2026-09-16 · **Scope:** items **O-2**,
**O-3**, **O-4**, **O-10**, **O-20**, **O-21** and **O-1** of
[`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md), recorded here in that
order as **D-32** … **D-38**.

**Source, stated once.** Every quotation in this file is byte-exact from **the Product Owner's
message of 2026-09-16 to the coordinator**. Nothing inside a quotation mark is paraphrased,
shortened or reordered. Where this file says what a decision does or does not settle, it says it in
the Owner's own terms wherever the Owner supplied them.

**Numbering.** The highest decision number already in use is **D-31**, in the Owner's decisions of
2026-09-13, which are preserved outside this repository at
`orchestration/evidence/p1-31/closeout-drafts/queue2/owner-decisions-2026-09-13.md`. The seven
decisions below take the next free numbers and **nothing is renumbered**.

These are NEW decisions taken on 2026-09-16. They do not reopen
[`owner-decisions-2026-09-09.md`](./owner-decisions-2026-09-09.md),
[`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md),
[`owner-decisions-2026-09-12.md`](./owner-decisions-2026-09-12.md) or anything recorded in
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md).

**Nothing here asserts that any gate ran, that any environment exists, that any determination was
made, or that any of the work below has been built.** It is a record of decisions. Every measured
fact quoted below was read at protected `develop`
**`7a1e1eefeca38533b507bf128206c8a71eb1b4b9`**, the merge of pull request #403.

## 0. The sentence that governs this whole file

From **O-1**, in the Owner's words:

> Keep three facts separate:
>
> - the Owner's conditional decision;
> - the actual QA/Security determinations;
> - whether the formal P1-G31 prerequisites are satisfied.

**How the three read at `7a1e1eef`, so no section below can be read as merging them.**

1. **The Owner's conditional decision exists**, and it is **D-38**.
2. **The actual QA and Security determinations do not exist.** The nine decision fields
   **QA-C1** … **QA-C5** and **SEC-C1** … **SEC-C4** in § 7 of
   [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) are **empty**,
   and this file leaves them empty.
3. **The formal gate P1-G31 prerequisites are NOT satisfied**, because gate conditions **2** and
   **3** require exactly those two human determinations, and the Owner's own instruction is that "If
   a required human determination is absent, preserve that condition explicitly. Do not change gate
   rules or claim that the conditional decision itself satisfies the missing certification."

**Nothing in this file states that the conditional decision supplies a determination, that a
self-review is independent, that a Pass is unconditional, that anything is 100% verified, that
anything is production-ready, or that a certification has been issued. No signature is written on
anybody's behalf.**

## 1. D-32 — the reviewer is retained, and a disclosed authorized self-review is accepted for this phase (answers O-2)

**The Owner's words.**

> Retain Eng. Ezzaldeen Al-Bitar as the designated human technical, QA, and Security reviewer. I
> accept a disclosed, authorized internal/self-review for this phase instead of requiring
> recruitment of another reviewer.
>
> Record this as an explicit Owner decision concerning reviewer independence. Do not describe a
> self-review as independent. This does not authorize GitHub self-approval contrary to repository
> rules.
>
> Use the existing evidence packet for QA-C1 through QA-C5 and SEC-C1 through SEC-C4. Do not launch
> new tests merely to prepare those determinations.
>
> This decision appoints and authorizes the reviewer; it does not manufacture his determinations. Do
> not sign for him or substitute an AI review for a human certification.

**The packet item it answers.** **O-2** — "which reading governs gate conditions 2 and 3" —
[`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md) § 3, which set out two
readings, Confirmation and Appointment, and recorded that "**Engineering may not decide it in either
direction**". The same question is § 3 of
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md), which carried it
to the Owner and resolved nothing.

**What it decides.** The **Confirmation** reading, stated as an Owner decision about independence:
the assigned holder is retained in all three roles, and a **disclosed, authorized internal/self-review
is accepted for this phase** in place of recruiting another reviewer. The open independence question
of Field 11 of [`canonical-plan.md`](./canonical-plan.md) is therefore answered **for this phase** by
an Owner decision rather than by an appointment.

**What it does NOT decide, in the Owner's own terms.**

- "**Do not describe a self-review as independent.**" No record may call the review independent, and
  this decision does not make it so.
- "**This does not authorize GitHub self-approval contrary to repository rules.**" Branch protection
  and the review rules are untouched.
- "**This decision appoints and authorizes the reviewer; it does not manufacture his
  determinations.**" **Gate conditions 2 and 3 stay unsatisfied.**
- "**Do not sign for him or substitute an AI review for a human certification.**"
- "**Do not launch new tests merely to prepare those determinations.**" The nine items are answered
  against the existing evidence packet or not at all.

**Measured facts at `7a1e1eef` (not part of the decision).**

- The nine decision fields at
  [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 7 are
  **empty**, under the packet's own sentence that "A blank row is not a refusal and is not a pending
  approval; it is an act that has not been performed."
- The role assignment already existed: `docs/governance/solo-developer-review-policy.md:18-20` and
  the Owner-Approved Combined-Role Model at
  [`phase-1-1-owner-gate.md`](../phase-1-1/phase-1-1-owner-gate.md)`:135-136`.
- `docs/governance/standing-technical-authorization-policy.md:192-194` keeps **P1-EC-016** — an
  independent security reviewer before production release — **open**. This decision is for this
  phase and does not close it.
- The disclosure sentence every determination must carry is § 2 of the certification packet, and it
  is unchanged.

**Effect on each record.**

| record                                  | what changes                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `certification-and-clearance-packet.md` | § 3 gains a dated note recording the question as answered by this decision; the disclosure sentence stays mandatory; § 7's nine fields stay EMPTY and say so |
| `closure-record.md`                     | § 4 conditions 2 and 3 gain a dated note: the reading is fixed, the determinations are still absent, both conditions remain unsatisfied                      |
| `change-control-2026-09-08.md`          | § 75 records the decision; **CC-60 (d)** is not closed by it and is marked **NOT COVERED BY O-3** in the carry table of § 2.1 below                          |
| `owner-decision-packet-2026-09-16.md`   | O-2 gains a dated note recording that it is answered, with the answer in one sentence and a citation here                                                    |

## 2. D-33 — the existing documented non-blocking limitations and deferred work are carried forward, with their restrictions preserved (answers O-3)

**The Owner's words.**

> I authorize carrying forward the existing documented non-blocking limitations and deferred work,
> with their restrictions preserved.
>
> Attach or reference the exact existing disposition list. For each carried item, retain its
> identifier, actual obligation, owner, operational restriction, and appropriate destination or
> release condition. Do this as one mechanical recording pass, not another investigation.
>
> Do not mark carried items fixed or completed. Do not silently downgrade an actual blocker. This
> instruction creates no new acceptance of an unresolved critical defect or an unresolved
> security/isolation blocker.
>
> Preserve previously approved dispositions. Escalate only a concrete contradiction that prevents
> the requested action; continue unaffected work.

**The packet item it answers.** **O-3** — "formal acceptance, or refusal, of the open dispositions" —
[`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md) § 3, whose **(e)** and
its dated note of 2026-09-16 re-derive the set the Owner is asked about as **47 open identifiers**.
It is the limb Definition-of-Done bullet 2 calls "formally accepted by the authorized owner"
([`canonical-plan.md`](./canonical-plan.md)`:458-459`).

**What it decides.** The **existing documented non-blocking limitations and deferred work are carried
forward**, each keeping its identifier, obligation, owner, operational restriction and destination.
The list is § 2.1 below, derived mechanically from § 70.7 of
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) as re-derived by § 74.3 — no row
re-investigated, no row re-classified, no row's words replaced.

**What it does NOT decide, in the Owner's own terms.**

- "**Do not mark carried items fixed or completed.**" Nothing in § 2.1 is marked fixed, closed or
  completed, and no state cell in the register is moved by this decision.
- "**Do not silently downgrade an actual blocker.**"
- "**This instruction creates no new acceptance of an unresolved critical defect or an unresolved
  security/isolation blocker.**" Three rows meet that description on their own cells and are marked
  **NOT COVERED BY O-3** in § 2.1. They are named, not downgraded, and the Owner's acceptance does
  not reach them.
- "**Preserve previously approved dispositions.**" None is altered.
- It decides nothing about the **four identifiers that state no usable disposition** — **CC-25**,
  **CC-26**, **CC-40** and **CC-48** — which § 70.7 counts separately and which are outside the set
  of 47.

**Measured facts at `7a1e1eef` (not part of the decision).**

- The open set is **47 identifiers**, by § 70.7's own counting rule, quoted: "**a state cell counts
  as open unless that cell, or a dated note beside it, records a closure**". The derivation is
  § 70.7's: 41 open at `849a8e9a`, minus **CC-54 (d)** which closes, plus the five open sub-rows § 70
  raises, = **45**; plus the two open sub-rows § 73 raises = **47**; then **CC-64 (a)** closes at
  § 74.4 and **CC-65 (a)** is raised open, so 47 − 1 + 1 = **47**.
- **Four further identifiers state no usable disposition** — CC-25, CC-26, CC-40, CC-48 — unchanged
  at four.
- **CC-31** and **CC-52 (c)** are excluded from the set by name at § 70.7, each because a recorded
  measurement closes it while its own cell still reads open. **CC-50 (a)** is excluded by name and is
  determined closed at § 74.2. This decision does not ask about, reopen or accept any of the three.

### 2.1 The carry table — every open disposition at `7a1e1eef`, one row each

**This table is the "exact existing disposition list" the Owner asked to be attached.** It is a
mechanical recording pass over the 47 identifiers § 70.7 names, and it is **not an
investigation**: every obligation cell is the register's own line for that row, every owner cell is
that row's own owner column, and every restriction is the restriction that row already records.
**No state cell in the register is moved by this table, and nothing in it is marked fixed or
completed.**

**How the mark is decided, stated before it is applied.** A row is **NOT COVERED BY O-3** when its
own cell records an **unresolved** condition that is a defect in access control, tenant or branch
isolation, or the disclosure a refusal makes — or a prerequisite of the security determination
itself. Everything else, including absent evidence, deferred features, performance, presentation,
documentation and scope questions, is **CARRIED UNDER O-3**.

| identifier    | actual obligation, in the register's own words                                                                                                                                                                                    | owner                                                                                     | operational restriction it keeps                                                                                                                          | destination or release condition                                                                                                          | mark                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **CC-04**     | the platform-wide export permission code is "excluded from the bundle although shipped operations declare it" (§ 3)                                                                                                               | Backend reporting and export lane, with P-11 and P-12; re-opening needs an Owner decision | a freshly provisioned administrator is refused the two export reads and cannot delegate the code; the exclusion is deliberate least privilege             | the slice that publishes the export contract, when the need is demonstrated                                                               | CARRIED UNDER O-3      |
| **CC-06**     | "the checklist-results read does not close P1-27-INT-088" (§ 8)                                                                                                                                                                   | P1-22 under Field 13, with P-9                                                            | the gap side stays exactly as recorded, and the published results read must not be read as closing it                                                     | P1-22 under Field 13; closing it needs a schema decision about the missing template reference                                             | CARRIED UNDER O-3      |
| **CC-12**     | "two Backend docblocks still say navigation names `sal.delivery.read`" (§ 22)                                                                                                                                                     | P-13 / P-14                                                                               | a Frontend lane must not carry API source; no behaviour depends on either sentence                                                                        | the documentation lane P-13 / P-14, which owns the profile that can carry it                                                              | CARRIED UNDER O-3      |
| **CC-16**     | "organisations provisioned before P-10 cannot administer warranty policies. A runbook now documents the act; CC-16 closes on the run" (§ 29.2)                                                                                    | operator, after merge                                                                     | an operator act on a privileged connection; **a runbook is not a run**, and no run is claimed anywhere                                                    | the operator; it closes on the run, and becomes current on an environment at the moment that environment is provisioned                   | CARRIED UNDER O-3      |
| **CC-20**     | "organisations provisioned before the P-10/P-11 widenings hold neither new code. Same distinction" (§ 34.2)                                                                                                                       | operator, after merge                                                                     | **one** run covers both newly approved codes; it is not a repeat of the earlier backfill, and it preserves tenant customizations and denials              | the operator; it closes on the run, on CC-16's terms exactly                                                                              | CARRIED UNDER O-3      |
| **CC-23**     | "no index was added for the list ordering, and no migration was written" (§ 37.2)                                                                                                                                                 | a later `sal` performance slice, if measurement warrants it                               | the permission was reused, not minted, and no policy changed; a reversal must be a deliberate measurement                                                 | a later performance slice, on measurement                                                                                                 | CARRIED UNDER O-3      |
| **CC-24**     | "no batch variant of the four fact sources, so a page of N costs about 5N round trips" (§ 39.2)                                                                                                                                   | later slice                                                                               | the page stays bounded — default 20, maximum 50, refused at the boundary rather than clamped                                                              | a later slice, after batch fact ports exist in the three modules named as the prerequisite                                                | CARRIED UNDER O-3      |
| **CC-27 (b)** | "the open half of CC-27, carried in CC-27's own state cell rather than in a row of its own" (§ 40.2) — the catalogue-merge rule                                                                                                   | the Owner                                                                                 | the rule is implemented and visible in the wire; making a configuration row a precondition would leave every report unreachable                           | the Owner                                                                                                                                 | CARRIED UNDER O-3      |
| **CC-29**     | "four delivering-employee recommendations remain pending Owner approval" (§ 41.2)                                                                                                                                                 | Owner, before the next employee slice                                                     | all four carry the register label RECOMMENDATION PENDING OWNER APPROVAL and none may be read as approved                                                  | the Owner — routed as packet items **O-14** … **O-17**, unanswered                                                                        | CARRIED UNDER O-3      |
| **CC-30**     | "an operator without `sal.finance.view` is refused the whole queue" (§ 42.3)                                                                                                                                                      | a tenant administrator                                                                    | D-3 forbids broadening finance permissions, and a reduced view was already refused at the operation                                                       | a permission grant by a tenant administrator                                                                                              | CARRIED UNDER O-3      |
| **CC-32**     | "the printed sheet carries a reference where a person's name belongs" (§ 44.2)                                                                                                                                                    | later slice                                                                               | no name may be invented, and none may be resolved from a live directory read onto a printed sheet                                                         | the D-12 slice                                                                                                                            | CARRIED UNDER O-3      |
| **CC-34**     | "D-4 names a transfer the ledger cannot express. **State cell ambiguous** — `recorded — no action here`; filed open, not resolved" (§ 46.2)                                                                                       | Owner                                                                                     | the report shows no transfer bucket, because an empty one reads as a real zero for a concept that does not exist                                          | the Owner; the ambiguity of the cell is disclosed here and is not resolved by this pass                                                   | CARRIED UNDER O-3      |
| **CC-37 (a)** | "eleven `wty.`/`rpt.` writes are held to no payload-mirror gate" (§ 49.3)                                                                                                                                                         | a later slice                                                                             | widening another phase's gate is not a documentation slice's act; the row is annotated, never rewritten                                                   | the lane that owns the row's own section, which re-dispositions it                                                                        | CARRIED UNDER O-3      |
| **CC-37 (b)** | "the report-configuration write family has no consumer outside a generated manifest" (§ 49.3)                                                                                                                                     | Owner / a later slice                                                                     | no screen is invented to justify them and no operation is withdrawn                                                                                       | whoever owns the writer; the consumer question is the Owner's                                                                             | CARRIED UNDER O-3      |
| **CC-38**     | "amounts, quantities and durations display as the server's raw exact strings" (§ 50.3)                                                                                                                                            | a later Frontend slice                                                                    | no browser-side formatter may guess the scale or the currency; D-4 and D-20 keep every calculation on the server                                          | a later Frontend slice, with a decision about where a cell's currency comes from                                                          | CARRIED UNDER O-3      |
| **CC-38 (a)** | "two of three drill-through targets have no screen in this application" (§ 50.3)                                                                                                                                                  | a later Frontend slice                                                                    | the reference renders as a reference; no link may point at a route that answers as missing                                                                | the later Frontend slice that builds those screens                                                                                        | CARRIED UNDER O-3      |
| **CC-41**     | "the overview is four report runs, not one summary read" (§ 53.3)                                                                                                                                                                 | a later Backend slice                                                                     | each read asks for the smallest page the route admits; no published request shape is changed for it                                                       | a later Backend slice, if a summary contract is ever added                                                                                | CARRIED UNDER O-3      |
| **CC-43**     | "**closed in part; one cause open, stated**" — twenty-five of thirty-four committed browser cases did not pass against a real world (§ 54.4)                                                                                      | the Frontend lane                                                                         | recorded rather than fixed by a documentation slice; editing a committed spec obliges a re-record of the web tier                                         | the Frontend lane that owns those spec files                                                                                              | CARRIED UNDER O-3      |
| **CC-44**     | "the handoff-gated reporting cases pass only where the browser credentials are overridden" (§ 54.7)                                                                                                                               | the Frontend lane                                                                         | the acceptance account's grants must **not** be widened to make them pass                                                                                 | the lane that owns how the browser tier signs in                                                                                          | CARRIED UNDER O-3      |
| **CC-46 (c)** | "the OpenAPI bare-object success-schema shortfall is chapter-wide, not `sal.delivery-*`" (§ 56.4)                                                                                                                                 | a later slice                                                                             | the generated contract file was not edited and must never be hand-edited                                                                                  | a later slice; routed to the Owner as packet item **O-9**, unanswered                                                                     | CARRIED UNDER O-3      |
| **CC-47**     | "this register carried no index of its open dispositions"; its own cell reads `open, indexed` (§ 57.3)                                                                                                                            | the register lane                                                                         | "an index is not a closure of the findings it lists", and an index moves no state                                                                         | the register lane, at each re-derivation                                                                                                  | CARRIED UNDER O-3      |
| **CC-52 (b)** | "a gate accepts a provenance word without reading the ledger behind it" (§ 62)                                                                                                                                                    | the CI-automation lane                                                                    | "deliberately not worked around" — nothing may be widened or relaxed for it, and no marker may claim a provenance it does not have                        | the CI-automation lane that owns the gate                                                                                                 | CARRIED UNDER O-3      |
| **CC-54 (a)** | "the business date and the report bucket are in different timezones" (§ 64)                                                                                                                                                       | a later backend lane / Owner                                                              | "recorded, not fixed" — no source in either application was changed for it                                                                                | "a follow-up item outside P1-31", reported to the Owner                                                                                   | CARRIED UNDER O-3      |
| **CC-55 (a)** | "the ledger this read publishes has one row on every record the product can create" (§ 65)                                                                                                                                        | a later `wty` slice                                                                       | the read is not shaped to the one row it can return, and no status writer may be invented to make the ledger look fuller                                  | a later warranty slice, after a product decision about a status writer                                                                    | CARRIED UNDER O-3      |
| **CC-55 (c)** | the phase operation pin moved with the operation the slice published — "**open — pending the hosted `integration-tests` job of the head under review**" (§ 65)                                                                    | that slice, then the head under review                                                    | the measurement moved, not the assertion: no assertion weakened, no case skipped, no outcome widened; the file was run against a disposable database only | the hosted integration job of the head under review                                                                                       | CARRIED UNDER O-3      |
| **CC-56 (b)** | "the same defect survives outside this phase's operation set" — six open sites answer a refusal that discloses whether the target exists (§ 66.9, rows 1 and 3 – 7)                                                               | the lane that owns P1-30 inventory master data (row 1); the IAM lane (rows 3, 4, 5, 6, 7) | none of the six is changed; each is a decision by cited authority for the lane that owns it, not a code normalised by a slice passing through             | its existing owner — two lanes, named above                                                                                               | **NOT COVERED BY O-3** |
| **CC-56 (d)** | "the P1-30 case that crosses the TENANT boundary on a body-scoped create asserts an EITHER/OR outcome" (§ 66)                                                                                                                     | the P1-30 backend area                                                                    | the case pins neither code and no figure may be read as pinning one; the create is refused under either                                                   | the P1-30 backend area. **Which** code it should be is CC-56 (b)'s subject, which is NOT COVERED below                                    | CARRIED UNDER O-3      |
| **CC-57 (a)** | "the seven PENDING operations remain unreachable, and this gate discloses that rather than closing it" (§ 67)                                                                                                                     | the lane that builds each surface                                                         | "recorded, not fixed, and deliberately not manufactured" — no adapter may be written to clear a PENDING entry without the surface                         | the lane that builds each surface; three of the seven are the checklist-template writes deferred by **D-36** to the named backlog item    | CARRIED UNDER O-3      |
| **CC-57 (b)** | "the sourcing gate judges the SEND, not the screen state behind it" (§ 67)                                                                                                                                                        | the acceptance re-run lane                                                                | no figure from that gate may be quoted as a runtime property                                                                                              | the acceptance re-run lane                                                                                                                | CARRIED UNDER O-3      |
| **CC-58 (a)** | "SE-5M cannot see a service-level authority requirement for 45 of the 46 operations" (§ 68)                                                                                                                                       | a later security-assurance slice                                                          | "no claim in this section reads past the limit"; it is a **disclosed input** to a security determination that does not exist                              | a later security-assurance slice                                                                                                          | CARRIED UNDER O-3      |
| **CC-58 (b)** | "the assurance evidence index reads two constraint suites as isolation evidence they did not carry" (§ 68)                                                                                                                        | the final integration                                                                     | the code half is repaired so the entry is true at this head, but "it was not true when written" and the index is not rewritten by this lane               | the final integration                                                                                                                     | CARRIED UNDER O-3      |
| **CC-58 (c)** | the concurrency suite "states a replay coverage it did not have, and that statement is why it asserted none" (§ 68)                                                                                                               | this lane, recorded for the final integration                                             | the header is left as written and annotated rather than rewritten                                                                                         | the final integration; the gap the header hid is closed at § 68.3                                                                         | CARRIED UNDER O-3      |
| **CC-59 (b)** | "the access allow-list is edited by two branches at once" (§ 69.7)                                                                                                                                                                | whichever of the two branches merges second                                               | a textual conflict and not a semantic one; the second merge re-runs the gate and both pins                                                                | "open until the second merge re-derives the list"                                                                                         | CARRIED UNDER O-3      |
| **CC-59 (e)** | "the same composed-key defect remains at sixteen sites across nine files outside this phase" (§ 69.7)                                                                                                                             | a platform follow-up lane                                                                 | "listed and NOT fixed, deliberately" — not rewritten from a branch whose subject is one panel                                                             | the platform follow-up lane that owns those features                                                                                      | CARRIED UNDER O-3      |
| **CC-61**     | the report-export contract is "recorded as landed in source, and NOT recorded as closed" (§ 69.13)                                                                                                                                | that slice, then the integration that consumes it                                         | no baseline export entitlement, role grant or bootstrap widening; the platform export code stays withheld under CC-04                                     | its own sub-rows are what it closes on                                                                                                    | CARRIED UNDER O-3      |
| **CC-61 (b)** | "the export has no separate daily allowance — only the shared expensive-read policy and a size bound" (§ 69.13.3)                                                                                                                 | a future policy decision                                                                  | recorded as a product limitation; the limit the operation actually enforces is written down rather than implied                                           | a future policy decision, which has an Owner input                                                                                        | CARRIED UNDER O-3      |
| **CC-61 (c)** | "the disclosure audit cannot identify the exact bytes that were downloaded" (§ 69.13.3)                                                                                                                                           | a future contract change                                                                  | the audit is "deliberately not described as durable-file provenance"; it is a **disclosed input** to the security determination                           | a future contract change                                                                                                                  | CARRIED UNDER O-3      |
| **CC-62 (b)** | "no hosted run, and no execution of the declared fixture command, is recorded at this head" (§ 71.6)                                                                                                                              | the pull request                                                                          | "a collection is not a pass; a declaration is not an execution"                                                                                           | the browser run owed as run (8) of the baseline's own observation log, and the fixture proof owed as the operator step its entry names    | CARRIED UNDER O-3      |
| **CC-62 (c)** | "the hosted job summary renders one register or the other, not both" (§ 71.6)                                                                                                                                                     | the CI-automation lane                                                                    | the workflow directory is owner-protected and was not edited                                                                                              | the lane that owns the workflow                                                                                                           | CARRIED UNDER O-3      |
| **CC-63 (a)** | "the download authorization does not refuse a caller whose file-access grant is scoped to another branch" (§ 72.6)                                                                                                                | security certification review                                                             | "recorded limitation of the documented tenant-scope design"; one-case proof only; "carried for the security certifier to weigh"                           | the security determination, which does not exist at this head                                                                             | **NOT COVERED BY O-3** |
| **CC-60 (c)** | "the decision packet of 2026-09-13 asked the Owner for acts that cited authority or later engineering has since settled" — "the decisions themselves are OPEN and are the Owner's" (§ 70.8)                                       | the Owner                                                                                 | no item asks for blanket acceptance, and no recommendation is written as an answer                                                                        | the Owner. Seven items are answered by this file; **the row is not closed here** and the rest stay open                                   | CARRIED UNDER O-3      |
| **CC-60 (d)** | "gate conditions 2 and 3 had no items a named reviewer could answer" — "**No certificate is issued and engineering cannot issue one**"; what is outstanding is "an **unissued certification and an unissued clearance**" (§ 70.8) | the assigned reviewer; the Owner                                                          | engineering cannot issue either; the nine decision fields stay EMPTY                                                                                      | the assigned reviewer's nine determinations. **D-32 appoints and authorizes and supplies none of them**                                   | **NOT COVERED BY O-3** |
| **CC-60 (e)** | "'the operator acts on every other environment' quantified over an inventory nobody had stated" — "**PENDING as a statement, OPEN as an act**" (§ 70.8)                                                                           | the Owner; the operator                                                                   | "**No deployment is invented and no environment is claimed.**" CC-16 and CC-20 stay open, because a runbook is not a run                                  | the operator, binding at the moment an environment is provisioned. **O-6 stays unanswered in both limbs**                                 | CARRIED UNDER O-3      |
| **CC-60 (f)** | "the closing run carries residual limitations that would otherwise reach nobody" — "**carried, each named, and neither turned into a blocker nor accepted**" (§ 70.8)                                                             | the certifier; the Owner                                                                  | no item is accepted by being listed; the load-bearing ones for the certifier are named in the cell                                                        | the certifier's determinations and the Owner. One of its named items, the branch-scope proof on download, is CC-63 (a) and is NOT COVERED | CARRIED UNDER O-3      |
| **CC-60 (g)** | "the five instruments the run of record used live outside the repository, unversioned" — "**recorded, not closed**" (§ 70.8)                                                                                                      | a later lane                                                                              | identity rests on the digests the runner compared against its pins before anything ran                                                                    | a later lane that brings the instruments under version control                                                                            | CARRIED UNDER O-3      |
| **CC-64 (b)** | "the coverage figures stay local although the hosted `web-quality` job ran" — "**open**" (§ 73.6, on the corrected wording of its own dated note)                                                                                 | the coverage and CI-automation lane                                                       | "the `LOCAL` labelling is kept" and limitation **L-2** is not lifted                                                                                      | a hosted read of those figures through the artefact reader that now exists                                                                | CARRIED UNDER O-3      |
| **CC-65 (a)** | "two Owner limbs — FE-004's scope allocation and DOC-002's acknowledgement — vanished without adjudication" — "**OPEN, and the Owner's**" (§ 74.8)                                                                                | the Owner                                                                                 | "**Neither task row moves**, and neither limb is treated as closed by the fact that it stopped being asked"                                               | the Owner — both limbs are answered in this file at **D-36** and **D-37**; **the row's own state is not moved here**                      | CARRIED UNDER O-3      |

**The counts, so they can be checked rather than believed.** **47 rows. 44 CARRIED UNDER O-3. 3 NOT
COVERED BY O-3**, and every one of the three is named here as well as in its row: **CC-56 (b)**,
**CC-60 (d)** and **CC-63 (a)**. 44 + 3 = 47.

**What "NOT COVERED BY O-3" means, and what it does not.** It means the Owner's carry-forward does
**not** extend to that row, on the Owner's own sentence that the instruction "creates no new
acceptance of an unresolved critical defect or an unresolved security/isolation blocker". It does
**not** downgrade the row, close it, reclassify it, or move it out of its owner's hands: each keeps
its identifier, its cell, its owner and its restriction exactly as the register holds them.

**One concrete contradiction, recorded and not allowed to stop the pass.** § 70.7's own closing
sentence says the acceptance or refusal "is the Owner's, as O-3", while the same subsection carries
two superseded figures (43 and 47 from a second reading) that it keeps "rather than removed". The
figure this table is built on is the one § 70.7 and § 74.3 state at this head — **47** — and the
superseded readings are not used. This is recorded under the Owner's instruction to "Escalate only a
concrete contradiction that prevents the requested action; continue unaffected work": it did not
prevent the pass, and the pass continued.

**Effect on each record.**

| record                                | what changes                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| this file                             | § 2.1 is the attached list                                                                                                                                                                      |
| `owner-decision-packet-2026-09-16.md` | O-3 gains a dated note recording the answer and citing § 2.1                                                                                                                                    |
| `closure-record.md`                   | § 4 condition 1 is re-stated against Definition-of-Done bullet 2: "formally accepted by the authorized owner" is satisfied for the CARRIED rows only, and unsatisfied for every NOT COVERED row |
| `change-control-2026-09-08.md`        | § 75 records the carry and points at § 2.1; **no state cell moves and nothing is marked fixed**                                                                                                 |

## 3. D-34 — P1-31 closes at its documented delivered scope, as a conditional closure with explicit carry-forward obligations (answers O-4)

**The Owner's words.**

> Close the P1-31 implementation cycle at its documented delivered scope, using a conditional
> closure with explicit carry-forward obligations.
>
> Do not expand P1-31 to absorb every platform improvement. Preserve each task's actual
> implementation and evidence state. A phase decision must not automatically turn all 29 tasks into
> 'end-to-end verified.'
>
> Carry validation work into P1-32 only when it belongs to P1-32's canonical scope. Keep unrelated
> backend/platform work with its existing owner or backlog.

**The packet item it answers.** **O-4** — "what P1-31 closes at, and what is carried" —
[`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md) § 3.

**What it decides.** The **implementation cycle** closes at the **documented delivered scope**, as a
**conditional** closure whose carry-forward obligations are explicit — the 47 rows of § 2.1, each
with the destination its own cell already names.

**What it does NOT decide, in the Owner's own terms.**

- "**Do not expand P1-31 to absorb every platform improvement.**"
- "**Preserve each task's actual implementation and evidence state.**"
- "**A phase decision must not automatically turn all 29 tasks into 'end-to-end verified.'**" **No
  task state moves because of this decision**, and [`task-matrix.md`](./task-matrix.md) records that
  in a dated note of 2026-09-16.
- "**Carry validation work into P1-32 only when it belongs to P1-32's canonical scope. Keep
  unrelated backend/platform work with its existing owner or backlog.**" In § 2.1 **no row is routed
  to P1-32**: every destination cell is the row's own existing owner, lane, operator, backlog
  destination or the Owner. P1-32's canonical scope is frontend validation, and no row of the 47 has
  that subject on its own cell.
- It decides nothing about gate P1-G31. The conditions are unchanged and conditions 2 and 3 are
  unsatisfied.

**Measured facts at `7a1e1eef` (not part of the decision).**

- The account is **16** `end-to-end verified`, **2** `merged (write path)`, **2**
  `merged (read-only/partial)`, **0** `in open PR`, **9** `phase-level incomplete` — the totals
  [`task-matrix.md`](./task-matrix.md) and [`closure-record.md`](./closure-record.md) §§ 2.10 and
  2.11 carry. **This decision moves none of them.**
- The union of the four non-`none` remaining categories is **seventeen** distinct rows
  ([`closure-record.md`](./closure-record.md) § 2.11).
- **Zero** of the 47 carried rows is routed to P1-32 by § 2.1.

**Effect on each record.**

| record                                | what changes                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `task-matrix.md`                      | a dated note at the top recording that the decisions of 2026-09-16 change **no row's state** |
| `closure-record.md`                   | § 4 condition 1 and § 7.4 gain dated notes; no state and no total moves                      |
| `owner-decision-packet-2026-09-16.md` | O-4 gains a dated note recording the answer                                                  |
| `change-control-2026-09-08.md`        | § 75 records the closure boundary and that no row travels to P1-32                           |

## 4. D-35 — the repository evidence convention is approved (answers O-10)

**The Owner's words.**

> Approve the existing repository evidence convention.
>
> Maintain the controlled acceptance index with stable references to retained evidence, commits,
> runs, and artifacts. Preserve accurate distinctions between local and hosted results, executed and
> skipped cases, and injected-failure rehearsals and real incidents.
>
> Repair broken references mechanically where the evidence already exists. Retire a test identifier
> only when its obsolescence is established and its disposition or replacement remains traceable. Do
> not retire a missing required test to make a gate appear satisfied.
>
> Do not regenerate, relocate, or rerun complete evidence packs unnecessarily.

**The packet item it answers.** **O-10** — "D-16: which task owns the cited test ids, and where phase
evidence lands" — [`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md) § 4,
in its **evidence-convention** limb. Its **(c)** asked for one of two conventions to be ratified.

**What it decides.** The **existing repository convention** is the approved one: phase evidence lands
in the phase's own directory as the controlled acceptance index —
[`acceptance-record.md`](./acceptance-record.md),
[`security-and-qa-evidence.md`](./security-and-qa-evidence.md),
[`coverage-record.md`](./coverage-record.md) and their siblings — with stable references to retained
evidence, commits, runs and artefacts. Broken references are **repaired mechanically where the
evidence already exists**.

**What it does NOT decide, in the Owner's own terms.**

- It does **not** retire any test identifier. "**Retire a test identifier only when its obsolescence
  is established and its disposition or replacement remains traceable. Do not retire a missing
  required test to make a gate appear satisfied.**" **D-16's cited identifiers are not retired
  here**: they resolve outside this repository with unexecuted result columns
  ([`canonical-reference-map.md`](./canonical-reference-map.md)), their disposition stays traceable,
  and their **ownership limb** — which task owns which identifier — is **not answered by this
  decision and stays open**.
- "**Do not regenerate, relocate, or rerun complete evidence packs unnecessarily.**" Nothing is
  regenerated, relocated or re-run.
- It does not place anything in `phase-1/_acceptance/`. That directory still holds its README and
  nothing else, and placing an artefact there remains the certifier's and the Owner's act
  ([`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 10).

**Measured facts at `7a1e1eef` (not part of the decision).**

- **One reference is repaired by this pass.** The dated note beside the **CC-31** row at
  [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 43.3 cites
  "[`acceptance-record.md`](./acceptance-record.md) §§ 11.4 and 11.6" for a run that "read the
  warranty transition ledger in its journey". **§ 11.4 does not carry that read.** Its text records
  740 steps, 740 ok, 0 not ok, 0 findings, five harness notes, one pacing row and fifteen published
  browser fixtures, and it states that "The journey's step-by-step table is `steps.md`; it is not
  reproduced in this section." **No section of the acceptance record names a warranty
  transition-ledger step.** **§ 11.6 does carry the browser limb** — five `warranty` cases executed
  in each of `authenticated-en`, `authenticated-ar` and `authenticated-tablet`, 0 failed, with the
  run's only skips being 369 legacy cases and the three export-case entries. The repair is recorded
  as a dated note beside each citation; **the original words are kept**, and **CC-31's closure
  condition — the browser proof at the closing head — is unaffected, because it rests on § 11.6.**
- The same clause appears in the dated note beside **CC-59** and **CC-59 (a)** at § 69.7, and the
  same repair is recorded there.
- **The five proposed evidence references** at
  `orchestration/evidence/p1-31/closeout-drafts/_acceptance-proposed/` are therefore **superseded by
  the in-repository index**. They are **not deleted**, they are outside every git working tree, and
  nothing is copied in from them.

**Effect on each record.**

| record                                  | what changes                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `change-control-2026-09-08.md`          | dated notes beside the CC-31 citation at § 43.3 and beside the CC-59 / CC-59 (a) citation at § 69.7; § 75 records the repair and the supersession |
| `certification-and-clearance-packet.md` | § 10's proposed artefacts are recorded as superseded, in § 75, without being deleted                                                              |
| `owner-decision-packet-2026-09-16.md`   | O-10 gains a dated note recording that the convention limb is answered and the ownership limb stays open                                          |

## 5. D-36 — checklist-template administration is deferred to a named follow-up backlog item (answers O-20)

**The Owner's words.**

> Delivery checklist execution remains within P1-31.
>
> The separate checklist-template administration screen is deferred to an explicitly named follow-up
> backlog item. It is not a P1-31 closure requirement and must not be inserted into P1-32, whose
> purpose is frontend validation rather than new administration features.

**The packet item it answers.** **O-20** — "whether checklist-template administration is inside
FE-004 or a later phase" —
[`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md) Group D. Its **(c)**
offered three limbs; the Owner takes the deferral limb.

**What it decides.** Checklist **execution** stays inside P1-31. The **template administration
screen** is **deferred** to an explicitly named follow-up backlog item, recorded as
**`P1-31-FU-001`** at § 75.4 of [`change-control-2026-09-08.md`](./change-control-2026-09-08.md).
Because the packet's own (f) line says that in this limb the item "blocks nothing",
**Definition-of-Done bullet 1 is satisfiable for FE-004 on the evidence already recorded**, and
FE-004 carries nothing further for the screen.

**What it does NOT decide, in the Owner's own terms.**

- "**It is not a P1-31 closure requirement**" — so nothing in P1-31 waits on it.
- "**and must not be inserted into P1-32, whose purpose is frontend validation rather than new
  administration features.**" The backlog item's own record carries that sentence.
- It does not build, schedule or resource the screen, and it **does not close** the coverage hole
  **H-1** or the register rows that name the same surface. **CC-57 (a)** keeps its state.
- It moves no task state: FE-004 stays exactly as the matrix records it.

**Measured facts at `7a1e1eef` (not part of the decision).**

- The delivery-checklist template family publishes **eight** operations. Two are consumed by the
  handover record screen; the other **six are writes with no adapter, no screen and therefore no
  component test** ([`coverage-record.md`](./coverage-record.md), hole **H-1**).
- The write-shape gate records the same fact from the other side: **five of its nine pending mirror
  entries** are checklist-template writes, each carrying the reason "P1-31 FE-004 owes the mirror,
  on the frontend lane" ([`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 4).
- **Three of the seven operations CC-57 (a) names** are checklist-template writes.
- **No screen exists.** Nothing is built, and nothing here builds anything.
- **The repository has no cross-phase backlog register.** The nearest existing convention is a
  per-phase follow-up register inside the phase's own README — `docs/phase-1/phase-1-18/README.md`
  § 7.1, "Follow-up register — open items, plus closed and attributed records", with phase-scoped
  identifiers. **P1-31 has no README**, so the item is recorded as a register sub-row instead, and
  this sentence says so.

**Effect on each record.**

| record                                | what changes                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `change-control-2026-09-08.md`        | § 75.4 creates the named backlog item **`P1-31-FU-001`** with its scope, the Owner's words and its exclusions |
| `task-matrix.md`                      | a dated note on FE-004 recording the deferral and naming the backlog item; **the row does not move**          |
| `owner-decision-packet-2026-09-16.md` | O-20 gains a dated note recording the answer                                                                  |
| `coverage-record.md`                  | **nothing.** H-1 stays open on its own terms                                                                  |

## 6. D-37 — receipt of the controlled record is acknowledged (answers O-21)

**The Owner's words.**

> Record my acknowledgement of receiving the controlled P1-31 report and its disclosed limitations.
> This acknowledgement does not replace QA or Security determinations.

**The packet item it answers.** **O-21** — "the approval owner's acknowledgement of the routed
controlled record" —
[`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md) Group D, whose **(d)**
distinguished receipt from verdict.

**What it decides.** The approval owner **acknowledges receipt** of the controlled P1-31 report and
of its **disclosed limitations**. DOC-002's canonical obligation ends in "route the result to the
named approval owner"; the routing was performed, and the acknowledgement half now has an answer on
the record.

**What it does NOT decide, in the Owner's own terms.**

- "**This acknowledgement does not replace QA or Security determinations.**" It is not a
  certification, not a clearance, and not a verdict — the verdict is **D-38**.
- It accepts no limitation. Acknowledging that a limitation was disclosed is not accepting it.
- It moves no task state. **DOC-002 stays `merged (read-only/partial)`**, because its other
  completion condition is engineering work owed independently.

**Measured facts at `7a1e1eef` (not part of the decision).**

- Before this decision, **no reply, acknowledgement or approval was recorded anywhere**, and none
  was claimed — [`closure-record.md`](./closure-record.md) § 2.5 and § 2.10's DOC-002 row.
- What "the controlled record" refers to at this head: the register through § 74,
  [`acceptance-record.md`](./acceptance-record.md) § 11 and the two Owner decision packets.
- The disclosed limitations are the eleven at [`acceptance-record.md`](./acceptance-record.md)
  § 11.12 and the set at [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md)
  § 9, carried under **CC-60 (f)** "neither turned into a blocker nor accepted".

**Effect on each record.**

| record                                | what changes                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `task-matrix.md`                      | a dated note on DOC-002 recording the acknowledgement; **the row does not move** |
| `change-control-2026-09-08.md`        | § 75.5 records it; **CC-65 (a)** is not marked fixed                             |
| `owner-decision-packet-2026-09-16.md` | O-21 gains a dated note recording the answer                                     |

## 7. D-38 — the Owner's phase decision is CONDITIONAL PASS (answers O-1)

**The Owner's words.**

> Record my Owner decision as CONDITIONAL PASS for the documented P1-31 scope, subject to the
> applicable certification, security, and carried-obligation conditions.
>
> Do not record an unconditional Pass, '100% verified,' production readiness, or an issued human
> certification.
>
> Keep three facts separate:
>
> - the Owner's conditional decision;
> - the actual QA/Security determinations;
> - whether the formal P1-G31 prerequisites are satisfied.
>
> If a required human determination is absent, preserve that condition explicitly. Do not change
> gate rules or claim that the conditional decision itself satisfies the missing certification.

**The packet item it answers.** **O-1** — "the phase verdict" —
[`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md) § 3, whose **(c)**
asked for one of the four values with conditions, and which is gate condition **4**.

**What it decides.** **CONDITIONAL PASS** for the **documented P1-31 scope**, dated **2026-09-16**,
recorded as the Owner's own act. Gate condition **4** — "the approval owner records Pass /
Conditional Pass / Fail / Deferred with conditions" — is **answered**.

**The conditions, in the Owner's words:** "subject to the applicable certification, security, and
carried-obligation conditions." Read against the records at this head, those are:

1. the **certification** condition — the QA certification, **QA-C1** … **QA-C5**, **absent**;
2. the **security** condition — the security clearance, **SEC-C1** … **SEC-C4**, **absent**;
3. the **carried-obligation** condition — the 47 rows of § 2.1, **44 carried under D-33** and **3 not
   covered**, each keeping its restriction.

**What it does NOT decide, in the Owner's own terms.**

- "**Do not record an unconditional Pass, '100% verified,' production readiness, or an issued human
  certification.**" None of the four is recorded anywhere by this file or by any record it touches.
- "**If a required human determination is absent, preserve that condition explicitly.**" Both are
  absent and both are preserved explicitly, here and at
  [`closure-record.md`](./closure-record.md) § 4.
- "**Do not change gate rules or claim that the conditional decision itself satisfies the missing
  certification.**" **The gate rules are unchanged. Gate conditions 2 and 3 are NOT satisfied.
  Condition 1 is not satisfied.** A conditional decision on condition 4 satisfies condition 4 and
  nothing else, and the four conditions are conjunctive.
- It authorises **no promotion**. `main` is not moved, and promotion stays ineligible
  ([`closure-record.md`](./closure-record.md) § 6).
- It moves **no task state** (**D-34**).

**Measured facts at `7a1e1eef` (not part of the decision).**

- Before this decision the verdict field at [`closure-record.md`](./closure-record.md) § 4 was
  **empty**, and "No recorded Owner decision file carries a phase verdict".
- The account is **16 / 2 / 2 / 0 / 9**, unmoved.
- The engineering result and the Owner decision are different things and stay different things: the
  acceptance record's engineering verdict is an engineering result for the run it describes, and
  § 11.13 of that record disclaims any Owner verdict. **This decision is the Owner's and is not an
  engineering result.**
- The four gate conditions at this head, after this decision: **1 not satisfied**, **2 not
  satisfied**, **3 not satisfied**, **4 answered**.

**Effect on each record.**

| record                                | what changes                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `closure-record.md`                   | § 4's verdict field records the Owner's CONDITIONAL PASS of 2026-09-16, cited here; conditions 1, 2 and 3 are stated unsatisfied; § 6 keeps promotion NOT eligible; § 7.4's verdict line records the Owner's decision as the Owner's and keeps the engineering result distinct |
| `acceptance-record.md`                | § 11.13 gains a dated note: the Owner's conditional decision now exists, and it is neither the engineering PASS nor a human determination                                                                                                                                      |
| `security-and-qa-evidence.md`         | § 17.8 gains the same dated note                                                                                                                                                                                                                                               |
| `change-control-2026-09-08.md`        | § 75.6 records the gate status after the decisions                                                                                                                                                                                                                             |
| `owner-decision-packet-2026-09-16.md` | O-1 gains a dated note recording the answer                                                                                                                                                                                                                                    |

## 8. What this file does not do

- **It issues no certification and no clearance**, and it fills none of the nine decision fields.
- **It describes no review as independent.**
- **It signs for nobody**, and it substitutes no automated reading for a human determination.
- **It moves no task state**, no register state cell, and no total.
- **It marks no carried item fixed or completed.**
- **It claims no gate run, no hosted execution, no environment and no approval** beyond the seven
  decisions recorded above.
- **It authorises no promotion.**
