# Template approval witness — execution record

**One append-only table that lets an asynchronous consumer prove approval without
reading a template.** The worker's question is not "is this version approved now"
but "was it validly approved for the carried scope when it was selected", and only
the second is answerable at consumption time.

|                      |                                                               |
| -------------------- | ------------------------------------------------------------- |
| Branch               | `remediation/p1-29-backend-template-approval-witness`         |
| Base                 | `e9c195e8` — `origin/develop` at the enqueue-authority merge  |
| Ownership profile    | `p1-29-backend` — resolved before the branch was created      |
| New migrations       | **1** — `20260828090000_shared_template_approval_witness.sql` |
| New tables           | **1** — `shared.template_version_approvals`                   |
| New policies         | **2** — its SELECT and INSERT                                 |
| New functions        | **0** — the guard is REPLACED, not added                      |
| New permission codes | **0**                                                         |
| `security_definer`   | **0**, unchanged — and load-bearing                           |

---

## 1. The defect, measured rather than argued

`shared.outbound_messages` carries a BEFORE INSERT trigger,
`shared.guard_outbound_message_scope()`, which is `SECURITY INVOKER` and — whenever
`template_version_id IS NOT NULL` — runs
`SELECT tenant_id, status FROM shared.template_versions … FOR SHARE`. It draws
THREE conclusions from that one read: the version exists, it belongs to this tenant
or to the platform, and its status is `approved`.

`app_worker` holds nothing on that table. Measured on a live database:

```
INSERT … template_version_id  ->  permission denied for table template_versions
has_table_privilege('app_worker','shared.template_versions','SELECT')  ->  false
```

So a worker could not name a template version at all, and the column had to be left
NULL. That is not a design; it is a hole where provenance should be.

**The enqueue-authority slice missed this**, and the way it missed it is worth
recording: its suite's INSERT column list simply never named `template_version_id`,
so the guard's early return applied and every case passed. A passing test hid the
gap. The refusal is now asserted explicitly in that same suite.

## 2. Why a composite foreign key alone cannot close it

Referential-integrity checks DO run with the constraint's rights rather than the
caller's — which is why the same role gets
`violates foreign key constraint fk_outbound_messages_tenant` rather than a
permission error on a bad tenant. So existence and tenancy **can** be made
declarative.

`status` cannot. It is **mutable**; PostgreSQL cannot use a partial unique index as
a foreign-key target; and folding the status into the referenced key would make the
key refuse the UPDATE that retires any version a message was ever sent from. A
constraint that forbids retirement is worse than the problem it solves.

## 3. What was searched before anything was added

| candidate                  | append-only?                               | proves witness↔version?                               | platform scope?          |
| -------------------------- | ------------------------------------------ | ----------------------------------------------------- | ------------------------ |
| `shared.status_history`    | yes, `UNIQUE (tenant_id, id)`              | **no** — polymorphic `entity_type`/`entity_id`, no FK | no, `tenant_id` NOT NULL |
| `iam.audit_records`        | yes — app_runtime holds INSERT+SELECT only | **no** — nullable polymorphic `entity_id`, no FK      | no, `tenant_id` NOT NULL |
| `template_versions.status` | **no** — mutable UPDATE                    | it is the thing being snapshotted                     | n/a                      |

Neither history table is written by the approval path, and neither can be the
target of a foreign key that proves correspondence to a version. **No second
approval ledger is created**: this records one fact the platform did not durably
record anywhere.

An incidental finding, recorded because it shapes the backfill: `approveVersion`
filters `WHERE tenant_id = $1`, so a PLATFORM version can never be approved through
the API at all. Platform content is seeded, not authored.

## 4. The mechanism, and why each piece is forced

**`UNIQUE (id, template_version_id, owner_tenant_id)`** on the witness is redundant
as a uniqueness claim — `id` is already the primary key — and exists solely to be
referenced. It is what makes "this witness belongs to this version, in this scope" a
database fact in ONE constraint rather than three application sentences.

**Both new `outbound_messages` columns are NULLABLE**, and the worker's requirement
is carried by its RESTRICTIVE policy rather than a table-wide CHECK. This is the
difference between this migration and a rejected earlier attempt: making the pairing
globally mandatory broke every existing request-path writer at once.

**`owner_tenant_id` is `GENERATED` and NOT NULL.** `template_versions.tenant_id` is
nullable because NULL is how a platform version is represented, and a MATCH SIMPLE
composite never matches NULL — so a key built directly on `tenant_id` would silently
make every platform version unreferenceable, a capability narrowing disguised as an
integrity fix. The repository had no sentinel convention; this introduces one.

**The guard's early return keys on `approval_witness_id`**, a column whose integrity
two foreign keys establish — not on a role, and not on an application assumption.
And it deliberately does not re-read mutable status.

## 5. Snapshot semantics, stated as a rule

A version approved when an event was published may be retired before the event is
consumed. That must not retroactively invalidate the event, and it must not make
asynchronous delivery depend on state the publisher no longer controls.

So the worker-side invariant is **"this version was validly approved for the carried
scope"**, never "this version is still approved". The request path keeps the
stronger current-state check, because it has live template access and can afford it.
The two paths are deliberately NOT symmetrical, and the request path was not
weakened to make them so.

## 6. Proofs — sixteen, as restricted roles

| proof                                                            | result                               |
| ---------------------------------------------------------------- | ------------------------------------ |
| witness maps to exactly one version, in that version's own scope | ✅                                   |
| a second witness for the same version                            | refused                              |
| a witness claiming a scope the version does not have             | refused (FK)                         |
| no application role holds UPDATE or DELETE on the witness        | asserted as a list AND as an absence |
| `app_worker` reading, creating, or rewriting a witness           | denied                               |
| worker enqueue persists the ACTUAL `template_version_id`         | ✅, `pending`                        |
| worker falling back to a NULL `template_version_id`              | refused by RLS                       |
| worker naming a version with no witness                          | `permission denied`                  |
| witness of a DIFFERENT version / nonexistent / cross-tenant      | refused                              |
| worker reads on `template_versions`, `message_templates`, `tech` | denied                               |
| worker controlling `status`, or DELETEing                        | denied                               |
| `SECURITY DEFINER` across all 13 app schemas                     | **0**                                |
| **retire the version, then enqueue**                             | **succeeds**                         |
| the request path, same retired version                           | still refused                        |
| the constraints all of the above depend on, by name and shape    | asserted                             |

### 6.1 The last row is the anti-vacuity guard

Every refusal above is produced by a named constraint or policy, and an INSERT that
stops failing is indistinguishable from one that was never attempted. So the
three-column shape of `fk_outbound_messages_approval_witness` and the three
predicates of the worker policy are asserted directly: drop any of them and that
case goes red immediately, instead of the others silently going green.

### 6.2 Two proofs failed first, and both taught something

The teardown could not delete a witness while a message still cited it —
`ON DELETE RESTRICT` doing its job, so the teardown was reordered rather than the
constraint relaxed.

And the request path refuses the retired version with `does not exist`, not
`is not approved`: the guard's `FOR SHARE` is a LOCKING read, which under RLS
additionally needs an UPDATE policy, so a sender without `org.settings.manage` sees
no row rather than a retired one. That is the documented P1-15-R-001 mechanism, and
the assertion names it rather than papering over it.

## 7. What this does not do

It does not change `job.assigned`, and it does not restore `template_version_id` to
the worker's enqueue path in application code — that belongs to the v2 slice, which
syncs onto this once it is merged. Until then the worker path is proven at the
database layer and unused above it.

**Assigning a technician still notifies nobody.** No screen may claim otherwise.
