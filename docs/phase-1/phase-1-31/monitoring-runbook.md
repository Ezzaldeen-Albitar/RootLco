# P1-31 local fault monitoring and alert routing

Implementation record for P1-31-DO-002. Final candidate verification is recorded in the change-control register. No external notification is claimed.

## Scope and ownership

The backend already emits structured JSON and sends sanitized exceptions through
`RecordingErrorMonitor`. The local router consumes those records for the operations in the P1-31
access allowlist. It prepares a local alert queue for the technical reviewer. Report-export
failures and security-code faults also reach the security-reviewer queue. These roles are already
assigned to Eng. Ezzaldeen Al-Bitar under the solo-developer review policy. Routing is a request
for review; it neither certifies a control nor proves that an audit failure caused an export fault.

The router makes no network connection and does not claim to page a recipient. Only Local exists
under ADR-012. A future external transport requires its own deployment configuration and evidence.
The separate D-10 report/event-consumption decision remains unresolved by this fault-monitoring work.

## Run with explicit environment and paths

Use a restricted local folder readable only by the operator and the existing review owner.
Keep raw application logs in that folder; they may contain opaque tenant/actor references.
Run under an account that can read the chosen input and create the new output file. The command
requires neither database credentials nor administrator rights. On Windows, verify the folder's
ACL; the requested POSIX file mode alone does not establish a Windows ACL.

```powershell
node scripts/ops/p1-31-monitor-alerts.mjs --input C:/restricted/p131/api-test.jsonl --output C:/restricted/p131/alerts-test-new.jsonl --environment test
```

Select `local` only for input whose explicit `env` is `local`; select `test` for tests. Other
environment names are refused. Mismatched input records are ignored rather than relabelled.
Use a new output path every time. The command opens it exclusively and will not overwrite an
earlier queue, including one from a failed run. A bounded file can be routed repeatedly through
new output files, but deduplication applies within one invocation, not across invocations.

## What is routed

Only phase-owned operation records whose `result` is `failure` and whose severity is `error`
or `fatal` qualify. Expected permission denials, validation responses, throttling, successes and
unrelated operations are ignored. The operation must occur in the controlled phase allowlist,
the error code must occur in the backend catalog, and timestamp/correlation fields must validate.

Every queue entry contains only environment, time, correlation ID, operation, error code and
routing roles. Message text, error names, stacks, request fields, headers, tenant/actor references
and arbitrary context are not copied. Use the correlation ID to inspect the original log only
within the authorized local environment; do not paste the raw record into tickets or messages.

## Completion, bounds and failure

The command prints counts for records read, ignored, malformed, deduplicated and routed, plus
input bytes and a completion flag. Inspect both the exit code and that flag. A successful empty
queue means no qualifying fault was found in the selected input; it does not prove system health.

Limits are 32 MiB input, 64 KiB per line and 1,000 distinct alerts. Oversized input, oversized
lines, capacity exhaustion or read/write errors fail visibly. Malformed records make the run
incomplete even if valid records were also routed. A partial output file from a failed run is
preserved for inspection and must never be labelled a completed queue. Correct the source or
split a bounded input intentionally, then run to a new output path. Do not silently truncate.

## Response and rollback

The named reviewer inspects an alert using its correlation ID and original environment.
For an export fault, determine whether generation, authorization or disclosure auditing failed
before deciding the corrective action. Do not grant permissions to make a fault disappear.

Stop routing when output cannot be protected, source environment is wrong, identifiers fail
validation, or alert volume exceeds the bound. Keep the failing input/output and exit result
locally as evidence. Disabling this command stops creation of new local queues and makes no
application, database or permission change. The existing structured logging and monitor capture
remain available. Resume with a new output path after a focused fix and revalidation.

## Verification and reproducible rehearsal

Bind the command and tests to the actual source SHA. Record a real
`captureException` → `RecordingErrorMonitor` → JSON log → local queue rehearsal, including an
injected secret canary that must be absent from the output. Record the actual test verdict,
queue digest and completion counts. Include refusal of wrong environments, malformed identifiers,
unregistered codes, duplicate incidents, size/capacity bounds and existing output paths.
No human review, security certification or externally delivered alert is inferred from a passing test.

Run `npx vitest run tests/unit/p1-31-monitor-alerts.test.ts` from the repository root.
To retain the captured test input, set `ROOTLCO_P131_MONITOR_REHEARSAL_DIR` to a new absolute
directory outside the checkout before running that test. The test refuses an existing directory.
It saves the actual logger output as `captured.jsonl` and the in-memory routing result as
`in-memory-alerts.json`. Then run the command above with that captured input, a new queue path,
and `--environment test`. Record the source SHA, test result, CLI exit code, completion counts,
and input/output SHA-256 digests together. Check that the canary is absent from both routing
outputs. Clear the rehearsal environment variable afterward. The retained input is an injected
test fault, not a production incident or a business acceptance result.
