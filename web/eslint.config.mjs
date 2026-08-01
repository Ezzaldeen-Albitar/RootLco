import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**'],
  },
  {
    rules: {
      // A brand value or a design value reaching a component is an architecture
      // failure, not a style preference. The dedicated scripts enforce the
      // colour and brand rules; this keeps the obvious unsafe escape hatch shut.
      'react/no-danger': 'error',
    },
  },
];

export default config;
