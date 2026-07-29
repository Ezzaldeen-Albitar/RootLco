# Pre-promotion measurement log

Produced on the frozen baseline. Every number in the promotion documents
comes from a command below.

## Refs

```
origin/develop      d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de
origin/develop^{tree} 13c1280e73c506b103380f853a130ef29ea13e3d
origin/main         491c4e0882763b5d5864737e63b4e31ca708a6b5
origin/main^{tree}  96a01e738c71da55435f68ce7107a812a3e5c4eb
merge-base          f326e24c0340e2ce97a94a768868a26d0cfbb04f
```

## main carries no unique content

```
$ git rev-list --count origin/develop..origin/main
15
$ git rev-list --no-merges --count origin/develop..origin/main
0
$ git rev-parse 'merge-base^{tree}'   (== main tree?)
96a01e738c71da55435f68ce7107a812a3e5c4eb
```

## The merge result, computed without touching a ref

```
$ git merge-tree --write-tree origin/main origin/develop
13c1280e73c506b103380f853a130ef29ea13e3d
exit: 0
$ git rev-parse origin/develop^{tree}
13c1280e73c506b103380f853a130ef29ea13e3d
```

## The two uncontained branches

```
$ git cherry origin/develop origin/chore/remove-dead-shared-app-error
+ f3dbba994f1e499ce7718d439a57a1bca4714d69
$ git diff --name-status origin/develop...origin/chore/remove-dead-shared-app-error
D	src/shared/errors/app-error.ts
M	vitest.config.ts

$ git cat-file -e origin/develop:src/shared/errors/app-error.ts ; echo $?
exit=128 (non-zero = absent)
$ git rev-parse origin/chore/remove-dead-shared-app-error:vitest.config.ts
fea9dfe0ec52acf5554f035b2aaa0b7fbd5dc95f
$ git rev-parse origin/develop:vitest.config.ts
fea9dfe0ec52acf5554f035b2aaa0b7fbd5dc95f

$ git cherry origin/develop origin/fix/p1-14-idempotency-replay-evidence
- c27b2a06680b1325a76b08c0f7f6ff51e2174711
  ('-' means an equivalent commit already exists on develop)
$ git rev-parse origin/fix/p1-14-idempotency-replay-evidence:tests/backend/p1-14-idempotency-replay.test.ts
98cf6798efd6bbe659c6c5f865704d2181839295
$ git rev-parse origin/develop:tests/backend/p1-14-idempotency-replay.test.ts
98cf6798efd6bbe659c6c5f865704d2181839295
```

## Baseline totals

```
migrations (.sql):     119
migration 120 files:   0
highest migration:     supabase/migrations/20260730090000_crm_customer_notes_write_capability.sql
route modules:         170
test files:            252
ci scripts:            26
workflows:             16
```

## Forbidden future work

```
$ git ls-tree -r --name-only origin/develop | grep -i 'phase-1-22|p1-22'
docs/phase-1/phase-1-11/phase-1-11-p1-22-backend-contract.md
$ git grep -l -i 'p1-22' origin/develop -- src tests scripts supabase
origin/develop:supabase/migrations/20260724090000_salwtyrpt_schemas.sql
(empty above = no P1-22 implementation)
```
