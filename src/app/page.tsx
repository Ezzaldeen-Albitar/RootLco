import { PRODUCT_NAME_PLACEHOLDER, VENDOR_NAME } from '@/shared/constants/app';
import styles from './page.module.scss';

/**
 * Phase 1-1 foundation verification page.
 *
 * Purpose: prove, in a rendered page, that the styling foundation works —
 * global SCSS loads, the SCSS Module compiles and scopes, CSS custom
 * properties resolve, and logical/RTL-safe styling applies.
 *
 * This is NOT a product screen and contains NO business functionality.
 * It is replaced when real frontend work begins (Phase 1-25 onward, after
 * the Phase 1-1 owner gate and the intervening phases).
 */
export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{PRODUCT_NAME_PLACEHOLDER}</h1>
        <p className={styles.subtitle}>
          Phase 1-1 development-readiness foundation — {VENDOR_NAME}
        </p>

        <ul className={styles.list}>
          <li className={styles.item}>
            <span className={styles.itemLabel}>Global SCSS</span>
            <span className={styles.itemDetail}>
              src/styles/globals.scss loaded via the root layout
            </span>
          </li>
          <li className={styles.item}>
            <span className={styles.itemLabel}>SCSS Module</span>
            <span className={styles.itemDetail}>this page is styled by page.module.scss</span>
          </li>
          <li className={styles.item}>
            <span className={styles.itemLabel}>Design tokens</span>
            <span className={styles.itemDetail}>
              colours, spacing and radii resolve from CSS custom properties
            </span>
          </li>
          <li className={styles.item}>
            <span className={styles.itemLabel}>Direction-safe styling</span>
            <span className={styles.itemDetail}>
              logical properties throughout; this arrow mirrors under RTL{' '}
              <span className={styles.directionArrow} aria-hidden>
                &rarr;
              </span>
            </span>
          </li>
        </ul>

        <a className={styles.healthLink} href="/api/health">
          Service health: /api/health
        </a>

        <p className={styles.confidential}>
          Confidential — Commercial Product and Pilot Planning. No business functionality exists at
          this phase.
        </p>
      </div>
    </main>
  );
}
