# Phase 1-26 — Owner acceptance runtime evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

The system running locally, the account signing in, and the guards refusing
everything else. Measured, not described.

---

## 1. The stack

| Component       | Address           | State                                  |
| --------------- | ----------------- | -------------------------------------- |
| Supabase (Kong) | `127.0.0.1:54321` | running                                |
| PostgreSQL      | `127.0.0.1:54322` | 119 migrations, platform seeds applied |
| Studio          | `127.0.0.1:54323` | running                                |
| Mailpit         | `127.0.0.1:54324` | running — local mail capture           |
| API             | `localhost:3000`  | running                                |
| Web             | `localhost:3100`  | running                                |

`npm run supabase:reset` reported: **3 currencies, 2 timezones, 2 languages, 104
permissions, 12 units, 3 payment methods**. No business rows — that is the seed
policy and it is unchanged.

## 2. API readiness

```
GET /api/v1/health/ready  ->  200
{"status":"ready","checks":[
  {"name":"database.reachable","ok":true},
  {"name":"database.role.no-bypassrls","ok":true},
  {"name":"capability.audit.append","ok":true},
  {"name":"capability.outbox.publish","ok":true},
  {"name":"capability.idempotency.store","ok":true},
  {"name":"capability.security-event.record","ok":true}]}
```

`database.role.no-bypassrls: true` is the one that matters. The API runs as
`rootlco_acceptance_runtime`, a member of `app_runtime` with `NOSUPERUSER` and
`NOBYPASSRLS`. Running it as `postgres` would make every authorization check in
the Owner's session meaningless, because `postgres` carries BYPASSRLS in the
Supabase local stack.

## 3. The account, verified end to end

`npm run acceptance:status-owner` against the running API:

```
  tenant A exists                yes  CRM Owner Acceptance Tenant
  tenant B exists                yes  CRM Isolation Tenant B
  company exists                 yes  CRM Owner Acceptance Company
  branch exists                  yes  Main Acceptance Branch
  administrator role exists      yes  Owner Acceptance Administrator
  role permission count          yes  14 of 14
  owner account exists           yes  owner.acceptance@crm.local
  owner account active           yes  active
  role grant active              yes  1 grant(s)
  company settings present       yes  10 row(s)
  tenant A users                 yes  4
  tenant B users                 yes  1

  API readiness                  yes  200
  live sign-in                   yes  200
  bearer token issued            yes  (not printed)
  session read                   yes  200
  resolved permissions           yes  14 code(s)

  Owner acceptance account: READY
```

The last four lines are the ones that mean anything. Rows can be perfectly
correct and the account still unusable — only the round trip through
`POST /auth/login` and `GET /auth/session` proves the Backend agrees.

## 4. The guards, exercised

Each refusal was run and its exit code recorded.

| Attempt                  | Result                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| `ROOTLCO_ENV` unset      | **exit 2** — _"must be exactly 'local-acceptance'. Received (unset)"_ |
| `DB_HOST=db.example.com` | **exit 2** — _"must be a loopback address"_                           |
| `DB_PORT=5432`           | **exit 2** — _"must be 54322, the Supabase local database port"_      |
| All three satisfied      | **exit 0**                                                            |

## 5. Idempotency

Run twice in succession:

|                    | First run | Second run                                           |
| ------------------ | --------- | ---------------------------------------------------- |
| Active role grants | 3         | **3**                                                |
| Owner permissions  | 14 of 14  | 14 of 14                                             |
| JWT alignment      | realigned | _unchanged — already signing with the shared secret_ |

`iam.role_grants` needed an explicit existence check rather than `ON CONFLICT`:
its only unique key is `(tenant_id, id)` and `id` is generated, so every insert
is "new" and a second run silently accumulated a duplicate active grant. That
defect was caught by counting, and the count is now part of the status report.

## 6. Fixtures

| Table                      | Tenant A | Tenant B |
| -------------------------- | -------- | -------- |
| `org.tenants`              | 1        | 1        |
| `org.legal_companies`      | 1        | 1        |
| `org.branches`             | 1        | 1        |
| `iam.roles`                | 2        | 1        |
| `iam.user_accounts`        | 4        | 1        |
| `iam.role_grants` (active) | 2        | 1        |
| `org.company_settings`     | 10       | 0        |

Every row created at runtime by a guarded script. **No business row is
committed**, so the permanent no-fake-data policy is untouched: it is a policy
about what ships, and `check-no-fake-data.mjs` scans tracked files — 1816 of
them, clean.

## 7. Settings and `P1-26-OD-001`

Ten company settings across the `numbering.`, `tax.` and `currency.` prefixes,
plus one neutral `acceptance.p1_26.checked`. Values are labelled as acceptance
fixtures in their own content where the type allows — `tax.name` reads
_"Acceptance fixture rate — not a production default"_.

`tax.rate_percent` is stored as the **string** `"16.0000"`. A rate is exact in
the database and a JavaScript number would round it on the way through,
invisibly.

None of this ratifies `P1-26-OD-001`. The settings key namespace remains the
Owner's decision; these are local fixture values chosen to exercise the screens,
and they are recorded as such rather than presented as defaults.

## 8. What running it found

Five defects, none of which any existing tier could have caught:

|               |                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `P1-26-F-045` | the local provider signed ES256; the API verifies HMAC only. Login returned 200 and the next request 401 |
| `P1-26-F-046` | no page had a `<title>`, on any route, in either language                                                |
| `P1-26-F-047` | malformed definition lists on two screens                                                                |
| `P1-26-F-048` | **no client component ever ran locally** — every table empty for ever                                    |
| `P1-26-F-049` | the approved symbol was invisible on the navy surfaces                                                   |

Every one was found by starting the system and looking at it. That is the whole
argument for this remediation existing.
