# `src/modules/` — domain modules

This directory is **intentionally empty at Phase 1-1.**

Phase 1-1 is _Source-of-Truth Validation and Development Readiness_. It establishes the
foundation only. Creating business-domain modules here now would be Phase 1-2+ work and is
explicitly out of scope.

## What belongs here later

Each module owns its own domain code behind a strict boundary — the modular monolith
described in [ADR-001](../../docs/adr/ADR-001-modular-monolith-architecture.md):

```
src/modules/<domain>/
  api/          route handlers / server actions for this domain
  domain/       entities, business rules, invariants
  data/         repositories; the only place that talks to the database
  ui/           components owned by this domain
  index.ts      the module's PUBLIC surface — the only legal import path
```

## Boundary rules

- A module may be imported **only** through its `index.ts`. Never reach into another
  module's internals (`@/modules/other/data/...`).
- Modules may depend on `@/shared` and `@/lib`. `@/shared` and `@/lib` must **never**
  depend on a module.
- Cross-module communication goes through the public surface, or through events —
  never by sharing a repository.
- No tenant name may appear in a module, in any form. Tenants — including Benzene —
  are configuration and seed data, never code. See [ADR-008](../../docs/adr/ADR-008-configuration-driven-tenant-onboarding.md)
  and [ADR-009](../../docs/adr/ADR-009-benzene-as-first-configured-pilot-tenant.md).

## Sequence

Modules are populated **after** the database exists. Schema first, then backend, then
frontend — see [ADR-005](../../docs/adr/ADR-005-database-first-delivery-sequence.md).
The database schema begins at Phase 1-2, which is blocked until the owners record a
Go or Conditional Go on the Phase 1-1 gate.
