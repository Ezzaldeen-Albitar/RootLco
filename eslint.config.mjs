import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts']),

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
