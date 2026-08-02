import type { Config } from 'tailwindcss';

/**
 * Tailwind holds NO design values — only references.
 *
 * ADR-020: Sass owns the tokens and emits them as CSS custom properties; every
 * entry below resolves `var(--…)`. That is what makes it impossible for the
 * Tailwind theme and the Sass tokens to drift apart: there is only one value,
 * and Tailwind is a syntax over it.
 *
 * Consequently a raw literal here (`#0f172a`, `14px`) is a defect, not a
 * shortcut, and `scripts/check-design-tokens.mjs` fails the build on one.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'app-background': 'var(--color-app-background)',
        'sidebar-background': 'var(--color-sidebar-background)',
        surface: 'var(--color-surface)',
        'surface-subtle': 'var(--color-surface-subtle)',
        'surface-raised': 'var(--color-surface-raised)',
        overlay: 'var(--color-overlay)',
        skeleton: 'var(--color-skeleton)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        'text-inverse': 'var(--color-text-inverse)',
        'text-disabled': 'var(--color-text-disabled)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        primary: 'var(--color-primary)',
        'primary-hover': 'var(--color-primary-hover)',
        'primary-active': 'var(--color-primary-active)',
        'primary-subtle': 'var(--color-primary-subtle)',
        'on-primary': 'var(--color-on-primary)',
        accent: 'var(--color-accent)',
        'focus-ring': 'var(--color-focus-ring)',
        disabled: 'var(--color-disabled)',
        success: 'var(--color-success)',
        'success-subtle': 'var(--color-success-subtle)',
        warning: 'var(--color-warning)',
        'warning-subtle': 'var(--color-warning-subtle)',
        error: 'var(--color-error)',
        'error-subtle': 'var(--color-error-subtle)',
        info: 'var(--color-info)',
        'info-subtle': 'var(--color-info-subtle)',
        'table-header': 'var(--color-table-header)',
        'table-row-hover': 'var(--color-table-row-hover)',
        'table-row-selected': 'var(--color-table-row-selected)',
        'table-border': 'var(--color-table-border)',
      },
      spacing: {
        0: 'var(--space-0)',
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        8: 'var(--space-8)',
        10: 'var(--space-10)',
        12: 'var(--space-12)',
        16: 'var(--space-16)',
        20: 'var(--space-20)',
        24: 'var(--space-24)',
      },
      borderRadius: {
        none: 'var(--radius-none)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        none: 'var(--shadow-none)',
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        overlay: 'var(--shadow-overlay)',
        focus: 'var(--shadow-focus)',
      },
      fontFamily: {
        sans: 'var(--font-family-sans)',
        mono: 'var(--font-family-mono)',
      },
      fontSize: {
        display: ['var(--font-size-display)', { lineHeight: 'var(--line-height-display)' }],
        'page-title': [
          'var(--font-size-page-title)',
          { lineHeight: 'var(--line-height-page-title)' },
        ],
        'section-title': [
          'var(--font-size-section-title)',
          { lineHeight: 'var(--line-height-section-title)' },
        ],
        body: ['var(--font-size-body)', { lineHeight: 'var(--line-height-body)' }],
        'body-large': [
          'var(--font-size-body-large)',
          { lineHeight: 'var(--line-height-body-large)' },
        ],
        supporting: [
          'var(--font-size-supporting)',
          { lineHeight: 'var(--line-height-supporting)' },
        ],
        label: ['var(--font-size-label)', { lineHeight: 'var(--line-height-label)' }],
        caption: ['var(--font-size-caption)', { lineHeight: 'var(--line-height-caption)' }],
        'table-header': [
          'var(--font-size-table-header)',
          { lineHeight: 'var(--line-height-table-header)' },
        ],
        'table-cell': [
          'var(--font-size-table-cell)',
          { lineHeight: 'var(--line-height-table-cell)' },
        ],
        button: ['var(--font-size-button)', { lineHeight: 'var(--line-height-button)' }],
      },
      zIndex: {
        base: 'var(--z-base)',
        raised: 'var(--z-raised)',
        sticky: 'var(--z-sticky)',
        sidebar: 'var(--z-sidebar)',
        header: 'var(--z-header)',
        dropdown: 'var(--z-dropdown)',
        overlay: 'var(--z-overlay)',
        dialog: 'var(--z-dialog)',
        toast: 'var(--z-toast)',
        tooltip: 'var(--z-tooltip)',
      },
      transitionDuration: {
        instant: 'var(--duration-instant)',
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
        overlay: 'var(--duration-overlay)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        enter: 'var(--ease-enter)',
        exit: 'var(--ease-exit)',
      },
      maxWidth: {
        content: 'var(--layout-content-max-width)',
      },
    },
  },
  plugins: [],
};

export default config;
