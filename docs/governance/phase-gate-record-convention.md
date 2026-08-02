# Phase gate-record convention

Three conventions for the same document exist in this repository, which is two too many.
This settles which one new phases use, and records why the older ones stay where they are.

## The three that exist

| Convention                | Used by            | Example                                              |
| ------------------------- | ------------------ | ---------------------------------------------------- |
| `phase-1-N-owner-gate.md` | phases 1-1 … 1-20  | `docs/phase-1/phase-1-14/phase-1-14-owner-gate.md`   |
| `gate-record.md`          | phases 1-21 … 1-24 | `docs/phase-1/phase-1-24/gate-record.md`             |
| `phase-1-N-gate.md`       | **nothing**        | prescribed by `phase-gate-record-template.md` line 9 |

The third is prescribed by the governance template and has never been used. A template
whose instruction no phase follows is not a standard — it is a trap for whoever reads it
first and a source of "the record is missing" for whoever greps second.

## The decision

**New phase gate records are `docs/phase-1/phase-1-N/gate-record.md`.**

It is the most recent convention, it is what the four most recently closed phases use, it
does not repeat the phase number that the directory already carries, and it sorts beside
the other phase artefacts rather than between them.

`phase-gate-record-template.md` is corrected to prescribe it.

## Existing records are not renamed

Phases 1-1 … 1-20 keep `phase-1-N-owner-gate.md`. Renaming a merged gate record would
break every citation of it in evidence tied to an earlier SHA, and would edit the record
of a decision that was correctly made under the convention of its day. The cost of the
inconsistency is that anything looking for a gate record must accept both names — which
is cheap, and which `scripts/ci/check-p1-26-readiness.mjs` already does deliberately,
checking all three so it cannot report a missing record for a phase that has one.

## Consequence for P1-25

P1-25's gate record, when the Owner's fidelity decision makes one honest to write, is:

```text
docs/phase-1/phase-1-25/gate-record.md
```

following the structure of `docs/phase-1/phase-1-24/gate-record.md`: a header table
carrying the final decision, the protected SHA and tree, the feature PR and merge SHA;
numbered sections for evidence; and closure conditions that are ticked against facts
rather than asserted.
