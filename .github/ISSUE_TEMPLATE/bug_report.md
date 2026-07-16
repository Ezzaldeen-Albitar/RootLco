---
name: Bug report
about: Report a defect in the Commercial Multi-Tenant Automotive CRM and ERP Platform
title: '[Bug] '
labels: bug
assignees: ''
---

## Summary

State the defect in one or two complete sentences. Describe the observed
behaviour, not a proposed solution.

## Environment

Complete every row. Write "Unknown" rather than guessing.

| Field                  | Value                                              |
| ---------------------- | -------------------------------------------------- |
| Operating system       | e.g. Windows 11 Pro 10.0.26200                     |
| Docker Engine version  | e.g. 29.5.3                                        |
| Docker Compose version | e.g. v5.1.4                                        |
| Node.js version        | e.g. v24.16.0                                      |
| npm version            | e.g. 11.13.0                                       |
| Branch                 | e.g. chore/p1-01-development-readiness             |
| Commit (short SHA)     | e.g. a6e0af4                                       |
| Environment            | Local (the only environment currently implemented) |

Only the Local environment exists. Development, Staging and Production are
planned and not provisioned, so they must not be selected here.

## Steps to reproduce

1.
2.
3.

State whether the defect reproduces consistently or intermittently, and how many
attempts were made.

## Expected

Describe the behaviour that the source-of-truth documentation or the accepted
technical direction requires.

## Actual

Describe the behaviour that actually occurred, including any error messages
exactly as displayed.

## Logs

> **Warning — redact before pasting.** Never paste the contents of `.env` or any
> other environment file, and never paste API keys, access tokens, service-role
> keys, database connection strings, passwords or session cookies. Replace any
> such value with `[REDACTED]` before submitting. Tenant data must also be
> redacted or replaced with representative placeholder values.

```text
Paste redacted log output, stack traces or console output here.
```

## Phase / task ID

Record the phase and, where applicable, the task identifier that the defect
relates to (for example `P1-01-DO-002` or `P1-01-QA-009`). Write "Not linked to
a task" if no identifier applies.

- Phase:
- Task ID:

## Severity

Select one and delete the remainder.

| Severity | Meaning                                                             |
| -------- | ------------------------------------------------------------------- |
| Critical | Blocks all work, causes data loss, or breaches tenant isolation.    |
| High     | Blocks a phase task or a documented entry criterion; no workaround. |
| Medium   | Impairs a task; an acceptable workaround exists.                    |
| Low      | Cosmetic, documentation or minor inconvenience.                     |

State the reasoning for the chosen severity in one sentence.

## Reporter notes

Do not assert that a test passed, that an approval was granted, or that a gate
was cleared unless that outcome is independently recorded. Independent quality
assurance ownership is not yet assigned; technical verification is currently
performed by Eng. Ezzaldeen Al-Bitar, and that limitation should be stated where
it affects confidence in this report.
