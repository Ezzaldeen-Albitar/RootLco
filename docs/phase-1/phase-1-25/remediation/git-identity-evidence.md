# P1-25 remediation — Git and GitHub identity evidence

Verified live before any remediation commit was created, on 2026-08-02.

## Push and PR authentication

|                              |                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated GitHub account | `Ezzaldeen-Albitar` (id `123809664`)                                                                                                                                 |
| Verified via                 | `GET https://api.github.com/user` with the credential-helper token                                                                                                   |
| Repository remote            | `git@github.com:Ezzaldeen-Albitar/RootLco.git`                                                                                                                       |
| `gh` CLI                     | not installed on this machine — the GitHub REST API with the owner's stored credential performs the same operations, as it has for every prior PR in this repository |

## Commit identity

|                                            |                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `user.name`                                | `Ezzaldeen-Albitar` (from `~/.gitconfig`; no local override needed)                                                |
| `user.email`                               | the owner's established address, matching every direct commit on `develop`                                         |
| `GIT_AUTHOR_IDENT` / `GIT_COMMITTER_IDENT` | both resolve to the same owner identity                                                                            |
| Classification                             | personal address, consistent with the repository's entire direct-commit history — not guessed, read from `git log` |

## Rules applied to every remediation commit

- Author and committer are the owner identity above — verified with
  `git show -s --format=fuller HEAD` after each commit.
- **No assistant, bot, or automation identity appears as author or committer.**
- **No AI co-author trailer is added.** Commits earlier in P1-25's history carry such
  trailers; per the owner's direction they end at this remediation. Message _bodies_
  remain factual engineering prose.
- GitHub-generated merge commits show GitHub's platform committer
  (`GitHub <noreply@github.com>`) with the owner as author — normal platform metadata;
  the merge operation itself executes under the owner's authenticated account.

No token, secret value, or private configuration content is reproduced in this document.
