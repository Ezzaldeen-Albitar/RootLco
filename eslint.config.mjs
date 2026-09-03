import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // `apps/**` is ignored HERE and only here. Each application composes this
  // policy from its own `eslint.config.mjs`, where flat-config `files` patterns
  // resolve against that application's directory — which is what makes
  // `src/**` below mean the right tree. Linting a workspace from the repository
  // root would resolve those same patterns at the root, match nothing, and
  // report a clean run over an unchecked application.
  // `.local/**` is the repository's designated local-only directory — dev state,
  // acceptance credentials, the dedicated Chrome profile. It is git-ignored, but
  // ESLint does not read `.gitignore`, so it walked a browser profile's bundled
  // scripts and reported 25,508 problems in files no one here wrote. CI never
  // has the directory, so the failure only ever reaches a developer
  // (P1-26-F-060).
  //
  // `supabase/.temp/**` is the SAME defect, found again during P1-27 Owner
  // acceptance (`P1-27-F-001`). `supabase start` — the project's own documented
  // local setup — writes the Edge Runtime's bundled `main/index.ts` there, a
  // single minified line. Root ESLint then reported 154 errors at column 30,000
  // in vendor code, which fails `verify:repository`, a REQUIRED aggregate.
  // Hosted CI never runs `supabase start` before linting, so once again the
  // failure only ever reaches a developer — and it reaches every developer who
  // follows the setup instructions.
  //
  // The whole directory is ignored rather than the one file: its contents are
  // CLI-version-dependent (`pgdelta`, `start-secrets`, `cli-latest` today), so
  // naming a file would fix this machine and break on the next CLI release.
  // `.tmp/**` is the SAME defect a THIRD time (PRE-P1-29-BR-06). It is the
  // repository's git-ignored scratch directory and currently holds the B1 pg_net
  // investigation's working files — hand-written probe scripts, not application
  // code. Root ESLint walked them and reported parsing errors and unused-variable
  // warnings in files no gate is meant to police, failing `lint` for developers
  // while hosted CI, which checks out a clean tree, never sees the directory at
  // all.
  //
  // Ignoring the directory is the fix rather than deleting its contents: those
  // files are evidence for an OPEN security blocker, and a lint gate is not a
  // reason to destroy them.
  globalIgnores([
    '.next/**',
    '.tmp/**',
    '.next-dev/**',
    '.local/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    'apps/**',
    'supabase/.temp/**',
    'supabase/.branches/**',
  ]),

  {
    rules: {
      // `_`-prefixed bindings are the conventional signal for "deliberately
      // discarded". Needed for the destructuring-omit idiom used in the tests,
      // e.g. `const { NEXT_PUBLIC_SUPABASE_URL: _omitted, ...rest } = VALID`.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    // Modular-monolith boundary enforcement (ADR-001).
    //
    // Rule: a module is imported ONLY through its public surface
    // (`@/modules/<name>`). Reaching into `@/modules/<name>/data/...` couples
    // callers to internals and dissolves the boundary that makes later service
    // extraction possible.
    //
    // `src/modules/` is intentionally empty at Phase 1-1, so this rule currently
    // matches nothing. It is committed now so the boundary is enforced from the
    // first module written in Phase 1-2 onward, rather than retrofitted after
    // violations already exist.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/*'],
              message:
                'Import a module only through its public surface: "@/modules/<name>". Reaching into module internals breaks the modular-monolith boundary (ADR-001).',
            },
            {
              group: ['../../modules/*', '../../../modules/*'],
              message:
                'Use the "@/modules/<name>" alias rather than a relative path into a module.',
            },
          ],
        },
      ],
    },
  },

  {
    // `@/shared` and `@/lib` are the foundation. If they import a module, the
    // dependency graph inverts and the foundation becomes unusable in isolation.
    files: ['src/shared/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}', 'src/config/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules', '@/modules/*', '@/modules/**'],
              message:
                'src/shared, src/lib and src/config must never depend on a domain module. Dependencies point inward only (ADR-001).',
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
