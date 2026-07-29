# Pull-request reconciliation

Retrieved through the authenticated GitHub API, `state=all`, paginated.

| State                  | Count  |
| ---------------------- | ------ |
| **Open**               | **0**  |
| Merged                 | 92     |
| Closed without merging | 2      |
| **Total**              | **94** |

## Open pull requests: none

There is no open pull request against this repository, so **no approved work can
be stranded in one**. This is the strongest form the §6 condition can take: not
"every open PR was reviewed and excluded", but "there are none".

## Merged pull requests — containment

- **71 merged into `develop`.** Every merge commit is an ancestor of
  `origin/develop`. Not one is missing.
- **21 merged into `main`.** Every merge commit is an ancestor of `origin/main`.

Measured with `git merge-base --is-ancestor <mergeSha> <branch>` for all 92.
Zero failures in either direction.

### The chain that matters for this gate

| PR                                | Into    | Head      | Merge     | Contained in develop |
| --------------------------------- | ------- | --------- | --------- | -------------------- |
| #87 P1-21 inventory feature       | develop | `96c93ca` | `28df255` | ✅                   |
| #88 P1-21 gate                    | develop | `3a7f8c6` | `0f8268e` | ✅                   |
| #89 CI/CD platform                | develop | `acde82f` | `3ec66c9` | ✅                   |
| #90 CI/CD gate                    | develop | `c98ac70` | `44ae31d` | ✅                   |
| #91 CodeQL self-introduced alerts | develop | `1fcf78b` | `4cb0bbb` | ✅                   |
| #92 CodeQL remediation            | develop | `c0831e5` | `e83c6b6` | ✅                   |
| #93 dataflow elimination          | develop | `108a4ed` | `4683357` | ✅                   |
| #94 CodeQL gate record            | develop | `dfa90ed` | `d9a2c1d` | ✅                   |

`d9a2c1d` is `origin/develop` itself — PR #94's merge commit is the promotion
source.

### P1-14 replay evidence

Never merged as a pull request. It reached `develop` by **cherry-pick** as
`b32024c`, with authorship preserved, inside PR #92 — because the evidence and
the removal of its ten waiver entries had to land in the same change or the
idempotency gate would have failed. Contained. See
[`branch-reconciliation.md`](branch-reconciliation.md).

## Closed without merging — 2

| PR                                                                                  | Into    | Head      | Verdict    |
| ----------------------------------------------------------------------------------- | ------- | --------- | ---------- |
| #22 _P1-05: open shared-services phase with initial audit and count reconciliation_ | develop | `806ca66` | superseded |
| #23 _Feature/p1 05 shared services database_                                        | develop | `67511b8` | superseded |

Both are earlier attempts on `feature/p1-05-shared-services-database`. That branch
was ultimately merged twice — **#24** (`3d110f2` → `ee3b1de`) and **#26**
(`da73b1f` → `4f68b6a`) — and its final head `da73b1f` is a **full ancestor of
`develop`** with zero unique files. The superseding work is present; the abandoned
attempts carry nothing that is not.

## Conclusion

- Approved work missing from `develop`: **0**
- Relevant pending pull requests: **0**
- Pull requests that must be merged before promotion: **0**

`develop` may be frozen for promotion.
