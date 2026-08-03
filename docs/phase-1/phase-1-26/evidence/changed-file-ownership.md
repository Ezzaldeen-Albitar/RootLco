# Phase 1-26 — changed-file ownership

**Classification:** Confidential — Commercial Product and Pilot Planning

Generated from `git diff --name-only -M --diff-filter=ACMRD 3598de62...HEAD`.
The machine-readable form is `changed-file-ownership.json`.

|               |                                            |
| ------------- | ------------------------------------------ |
| Base          | `3598de624dbc181b742cc40700464115ba5c4fc6` |
| Candidate     | `3e1f9e3ef56b4fc1320242f16951d8ae578d3f31` |
| Tree          | `5bdb10d481efc6cb8a7aaddad190fadc8137af65` |
| Changed files | **119**                                    |

## Buckets

| Bucket       | Files |
| ------------ | ----- |
| `docs`       | 30    |
| `rootConfig` | 1     |
| `tests`      | 1     |
| `tooling`    | 2     |
| `web`        | 85    |

## Invariants

```
APPS_API_CHANGED_FILES=0
SUPABASE_CHANGED_FILES=0
MIGRATION_CHANGED_FILES=0
UNCLASSIFIED_CHANGED_FILES=0
```

Enforced by `scripts/ci/check-phase-ownership.mjs p1-26-frontend`, which fails on
an unclassified file: a file nobody predicted is exactly the one worth looking at.

## Every changed file

### `docs` — 30

- `docs/engineering/ci-automation/pull-request-body.md`
- `docs/phase-1/phase-1-26/accessibility-evidence.md`
- `docs/phase-1/phase-1-26/administration-workflows.md`
- `docs/phase-1/phase-1-26/api-contract-evidence.md`
- `docs/phase-1/phase-1-26/architecture.md`
- `docs/phase-1/phase-1-26/authentication-workflows.md`
- `docs/phase-1/phase-1-26/browser-evidence.md`
- `docs/phase-1/phase-1-26/ci-evidence.md`
- `docs/phase-1/phase-1-26/concurrency-idempotency-evidence.md`
- `docs/phase-1/phase-1-26/developer-guide.md`
- `docs/phase-1/phase-1-26/evidence/changed-file-ownership.json`
- `docs/phase-1/phase-1-26/evidence/changed-file-ownership.md`
- `docs/phase-1/phase-1-26/evidence/index.md`
- `docs/phase-1/phase-1-26/evidence/task-traceability.json`
- `docs/phase-1/phase-1-26/evidence/task-traceability.md`
- `docs/phase-1/phase-1-26/evidence/test-register.json`
- `docs/phase-1/phase-1-26/evidence/test-register.md`
- `docs/phase-1/phase-1-26/execution-checkpoint.md`
- `docs/phase-1/phase-1-26/file-ownership.md`
- `docs/phase-1/phase-1-26/findings.md`
- `docs/phase-1/phase-1-26/isolation-evidence.md`
- `docs/phase-1/phase-1-26/known-limitations.md`
- `docs/phase-1/phase-1-26/open-decisions.md`
- `docs/phase-1/phase-1-26/operator-guide.md`
- `docs/phase-1/phase-1-26/performance-evidence.md`
- `docs/phase-1/phase-1-26/permission-and-scope-standard.md`
- `docs/phase-1/phase-1-26/qa-evidence.md`
- `docs/phase-1/phase-1-26/risk-evidence.md`
- `docs/phase-1/phase-1-26/security-evidence.md`
- `docs/phase-1/phase-1-26/task-register.md`

### `rootConfig` — 1

- `package.json`

### `tests` — 1

- `tests/ci/p1-26-frontend-gate.test.ts`

### `tooling` — 2

- `scripts/ci/check-command-coverage.mjs`
- `scripts/ci/check-p1-26-frontend.mjs`

### `web` — 85

- `apps/web/src/app/[locale]/(auth)/activate-account/page.tsx`
- `apps/web/src/app/[locale]/(auth)/forgot-password/page.tsx`
- `apps/web/src/app/[locale]/(auth)/layout.tsx`
- `apps/web/src/app/[locale]/(auth)/login/page.tsx`
- `apps/web/src/app/[locale]/(auth)/reset-password/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/approval-limits/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/audit-log/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/currencies/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/languages/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/numbering-rules/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/organization/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/permissions/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/roles/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/system-settings/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/taxes/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/administration/users/page.tsx`
- `apps/web/src/app/[locale]/(dashboard)/error.tsx`
- `apps/web/src/app/[locale]/(dashboard)/layout.tsx`
- `apps/web/src/app/[locale]/(dashboard)/profile/page.tsx`
- `apps/web/src/app/[locale]/(design)/gallery/page.tsx`
- `apps/web/src/app/[locale]/(design)/layout.tsx`
- `apps/web/src/components/data-table/DataTable.tsx`
- `apps/web/src/components/data-table/table-state.ts`
- `apps/web/src/components/data-table/use-cursor-pages.ts`
- `apps/web/src/components/shell/AppShell.tsx`
- `apps/web/src/config/navigation.ts`
- `apps/web/src/features/administration/access/actions.ts`
- `apps/web/src/features/administration/access/api.ts`
- `apps/web/src/features/administration/access/components/ApprovalLimitsScreen.tsx`
- `apps/web/src/features/administration/access/components/PermissionsScreen.tsx`
- `apps/web/src/features/administration/access/components/RolesScreen.tsx`
- `apps/web/src/features/administration/access/types.ts`
- `apps/web/src/features/administration/audit/api.ts`
- `apps/web/src/features/administration/audit/components/AuditLogScreen.tsx`
- `apps/web/src/features/administration/audit/types.ts`
- `apps/web/src/features/administration/organization/actions.ts`
- `apps/web/src/features/administration/organization/api.ts`
- `apps/web/src/features/administration/organization/components/SettingsEditor.tsx`
- `apps/web/src/features/administration/organization/components/TenantForm.tsx`
- `apps/web/src/features/administration/organization/types.ts`
- `apps/web/src/features/administration/shared/api.ts`
- `apps/web/src/features/administration/shared/components/ScreenStates.tsx`
- `apps/web/src/features/administration/shared/components/SettingsBackedScreen.tsx`
- `apps/web/src/features/administration/shared/permissions.ts`
- `apps/web/src/features/administration/shared/settings-keys.ts`
- `apps/web/src/features/administration/shared/use-server-table.ts`
- `apps/web/src/features/administration/users/actions.ts`
- `apps/web/src/features/administration/users/api.ts`
- `apps/web/src/features/administration/users/components/UsersScreen.tsx`
- `apps/web/src/features/authentication/actions/login.ts`
- `apps/web/src/features/authentication/actions/logout.ts`
- `apps/web/src/features/authentication/actions/password-reset.ts`
- `apps/web/src/features/authentication/actions/profile.ts`
- `apps/web/src/features/authentication/api/profile.ts`
- `apps/web/src/features/authentication/api/recovery-token.ts`
- `apps/web/src/features/authentication/api/session.ts`
- `apps/web/src/features/authentication/components/AccountMenu.tsx`
- `apps/web/src/features/authentication/components/AuthCard.tsx`
- `apps/web/src/features/authentication/components/ForgotPasswordForm.tsx`
- `apps/web/src/features/authentication/components/FormFeedback.tsx`
- `apps/web/src/features/authentication/components/LoginForm.tsx`
- `apps/web/src/features/authentication/components/MissingToken.tsx`
- `apps/web/src/features/authentication/components/ProfileForm.tsx`
- `apps/web/src/features/authentication/components/RecoveryTokenBridge.tsx`
- `apps/web/src/features/authentication/components/SetPasswordForm.tsx`
- `apps/web/src/features/authentication/components/SubmitButton.tsx`
- `apps/web/src/features/authentication/schemas/credentials.ts`
- `apps/web/src/features/authentication/types/session.ts`
- `apps/web/src/i18n/messages/ar.json`
- `apps/web/src/i18n/messages/en.json`
- `apps/web/src/lib/api/client.ts`
- `apps/web/src/lib/api/server-client.ts`
- `apps/web/src/lib/api/session-cookie.ts`
- `apps/web/src/lib/env.ts`
- `apps/web/src/lib/forms/action-result.ts`
- `apps/web/src/lib/observability/client-log.ts`
- `apps/web/tests/administration.test.ts`
- `apps/web/tests/api-client.test.ts`
- `apps/web/tests/authentication.test.ts`
- `apps/web/tests/data-table.dom.test.tsx`
- `apps/web/tests/e2e/foundation.spec.ts`
- `apps/web/tests/gallery-and-print.dom.test.tsx`
- `apps/web/tests/navigation.test.ts`
- `apps/web/tests/observability.test.ts`
