# The phase seal lifecycle — ACTIVE and ARCHIVED

**Classification:** Confidential — Commercial Product and Pilot Planning

**Applies to:** the QA-005 closing seal. P1-28 is the first phase to reach ARCHIVED.

A phase closing seal has two states. This page says what each one means, what
decides which one applies, and — because that is the part that matters — what
archival deliberately does **not** stop checking.

## 1. Why a lifecycle exists at all

The seal exists to keep one promise: **every figure in the package describes the
frozen candidate.** While a phase is being built, keeping that promise requires
the live tree to stay byte-identical to the candidate across `apps/**` and
`supabase/**`. A fix that quietly changes a product file makes every measurement
in the package describe a tree nobody has.

That rule is correct, and it is not relaxed anywhere below.

What the rule had no way to express is that a phase eventually **finishes**. Once
the Owner has accepted and the accepted tree has reached `main`, the package
stops being a claim about the working repository and becomes a record of what was
accepted. Holding the live tree to it forever does not protect the record — it
makes every later phase impossible.

And the only escape the seal offered was to **re-freeze** the candidate onto the
new work. That is the one act that would genuinely destroy the record: the Owner
accepted a tree, and re-freezing silently replaces it with a tree they never saw.

**Archival preserves the acceptance. It is not a relaxation of it.**

## 2. The two states

|                                                           | ACTIVE                    | ARCHIVED              |
| --------------------------------------------------------- | ------------------------- | --------------------- |
| The phase is                                              | being built or remediated | accepted and promoted |
| The live product tree must equal the candidate            | **yes**                   | no                    |
| Later executable commits must be named as successors      | **yes**                   | no                    |
| Re-freezing on a product change                           | required                  | **forbidden**         |
| The candidate must exist and still name its recorded tree | yes                       | **yes**               |
| The recorded successor history must be intact             | yes                       | **yes**               |
| Digests, matrix, tier figures, unclosed tasks             | judged                    | **judged**            |

ACTIVE is the strict state and the **default**. Anything unproven leaves the seal
ACTIVE.

## 3. What decides it — five computed facts

Archival is never granted by a field. A package that wrote `"archived": true`
about itself would let an unfinished phase escape the product rule by editing its
own paperwork, which is the opposite of a seal.

|       | condition                                       | where it comes from                       |
| ----- | ----------------------------------------------- | ----------------------------------------- |
| **A** | the verdict is exactly `OWNER ACCEPTANCE: PASS` | `ownerAcceptance.verdict`                 |
| **B** | the recorded candidate exists                   | `git cat-file -e <sha>^{commit}`          |
| **C** | it still names the tree the package records     | `git rev-parse <sha>^{tree}`              |
| **D** | it is contained in the promotion branch         | `git merge-base --is-ancestor <sha> main` |
| **E** | the closure record reports the phase CLOSED     | `closure-record.md`                       |

**D is the condition that cannot be faked from inside the package.** A verdict
typed into a file proves nothing until the tree it describes has actually been
promoted, and that is Git ancestry rather than prose. A and E can be written by
whoever edits the package; D cannot.

## 4. Fail closed

Every unproven condition leaves the seal ACTIVE, and the gate says which one
failed. Two kinds of answer are kept apart, because they call for different
actions:

- a **refusal** — "this is not true". The verdict is missing, the candidate is
  not in `main`, the closure record is absent or reopened.
- an **unknown** — "Git would not say". The promotion branch could not be
  resolved at all, which is the shape a shallow clone has.

An unknown is never read as a satisfied condition. A checkout that cannot see
`main` does not archive a phase by accident; it applies the strict rules and
reports why.

## 5. What archival stops, exactly

Two questions, and both are about the **current** tree rather than the record:

1. does the live checkout still match the candidate across `apps/**` and
   `supabase/**`?
2. are the commits after the candidate named as successors of this phase?

The second is worth stating plainly. It asks where a commit sits in
`git log <head> --not <candidate> <base>` — a question with an answer while the
phase is in flight and **none** afterwards. The base moves on; every historical
successor leaves that range the moment the phase lands. Asked of a finished
phase, it reports that phase's own accepted history as fabricated.

## 6. What archival does NOT stop

The historical package stays **tamper-evident**. Under ARCHIVED the seal still
refuses:

- a candidate that names no commit, or no longer names its recorded tree — these
  are conditions **B** and **C**, so failing them does not archive the phase at
  all, it returns it to ACTIVE
- a successor recorded without a 40-character commit id
- a successor naming a commit this repository does not have
- a successor that does not follow the candidate
- one commit recorded in both `successors` and `absorbedSuccessors`

and every other reporter — digests over bytes, the manifest, the task matrix, the
tier figures, the unclosed-task set, the Owner acceptance record — is untouched
by the lifecycle and judges exactly as before.

**The past is not rewritten.** `successors`, `absorbedSuccessors` and the
re-freeze history remain exactly as they are: they are the audit trail explaining
how the accepted candidate was reached. What archival stops is _future_
accumulation.

## 7. The state today

All five conditions hold:

```
A  ownerAccepted        OWNER ACCEPTANCE: PASS, 2026-08-20
B  candidateExists      e8a4200d
C  treeMatches          the recorded tree, unchanged
D  containedInPromoted  contained in `main`
E  closureClosed        Status: CLOSED — OWNER ACCEPTANCE: PASS
```

P1-28 is **ARCHIVED**. The accepted candidate is `e8a4200d` and it has not moved,
its tree has not moved, and the acceptance means what it meant on the day it was
given.
