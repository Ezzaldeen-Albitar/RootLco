'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrandMark } from '@/components/brand';
import { brandIsProvisional } from '@/components/brand/theme';
import { Icon } from '@/components/primitives/Icon';
import { NAVIGATION } from '@/config/navigation';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { NO_CAPABILITIES, visibleNavigation, type ActorCapabilities } from '@/lib/permissions';
import { usePersistedFlag } from '@/lib/use-persisted-flag';
import { Sidebar } from './Sidebar';

/**
 * The application shell.
 *
 * One layout for every operational screen: sidebar, header, a main region, and
 * an optional secondary panel. Business screens supply content; they never
 * reproduce chrome, which is what keeps a workshop's twenty screens looking
 * like one product.
 *
 * ## Capabilities
 *
 * `capabilities` defaults to NO_CAPABILITIES rather than to "everything". A
 * shell rendered before the permission set arrives shows an empty sidebar, which
 * is the honest appearance of "we do not know yet" — and it means a failure to
 * load capabilities can never accidentally reveal a module.
 *
 * ## Collapse state
 *
 * Persisted, because an operator who collapses the sidebar means it. It is a
 * single boolean under a namespaced key and it is NOT sensitive: it names no
 * customer, no tenant, no route, and reveals nothing about what the actor may
 * see. Everything else about this session stays out of browser storage.
 *
 * It is read through `usePersistedFlag`, which uses `useSyncExternalStore` so
 * the stored value is committed without a second render — see that file for why
 * the `useState` + `useEffect` shape is wrong here and visibly flashes.
 */

const COLLAPSE_KEY = 'rootlco.shell.sidebarCollapsed';

export interface AppShellProps {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly capabilities?: ActorCapabilities;
  readonly children: ReactNode;
  /** Optional right-hand (inline-end) panel — filters, detail, activity. */
  readonly secondaryPanel?: ReactNode;
  /**
   * The account control in the header.
   *
   * Passed in rather than built here because it is rendered from the SESSION,
   * and the session is resolved on the server. A client component that fetched
   * it would have to render the header once without it — which is the flash
   * this architecture exists to avoid.
   */
  readonly account?: ReactNode;
}

export function AppShell({
  locale,
  messages,
  capabilities = NO_CAPABILITIES,
  children,
  secondaryPanel,
  account,
}: AppShellProps) {
  const pathname = usePathname() ?? `/${locale}`;
  const [collapsed, setCollapsed] = usePersistedFlag(COLLAPSE_KEY, false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Focus moves INTO the drawer when it opens and BACK to the trigger when it
  // closes. Without the return trip a keyboard user is dropped at the top of the
  // document every time they dismiss it.
  useEffect(() => {
    if (drawerOpen) drawerCloseRef.current?.focus();
    else drawerTriggerRef.current?.focus({ preventScroll: true });
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const groups = visibleNavigation(NAVIGATION, capabilities);

  return (
    /*
     * The shell is EXACTLY the viewport, and nothing outside it scrolls.
     *
     * It used to be `min-h-dvh`, which lets the document grow with the content.
     * Measured on `/en/administration/users`: viewport 900, document 991, so
     * the page scrolled — and because the page scrolled, the sidebar (a fixed
     * `h-dvh` box, not sticky) travelled up and off the screen with it. Its
     * `overflow-y-auto` never engaged, because the nav was not the thing
     * overflowing; the document was (`P1-26-F-064`).
     *
     * `h-dvh` + `overflow-hidden` here is what makes every inner region's own
     * scrolling meaningful: the sidebar stays put, the header stays put, and the
     * main region scrolls inside its own box however many rows arrive.
     */
    <div className="flex h-dvh overflow-hidden bg-app-background text-text-primary">
      <Sidebar
        locale={locale}
        messages={messages}
        groups={groups}
        pathname={pathname}
        collapsed={collapsed}
      />

      {drawerOpen ? (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label={translate(messages, 'shell.closeNavigation')}
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-overlay bg-overlay"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={translate(messages, 'nav.landmark')}
            className="fixed inset-y-0 start-0 z-dialog w-72 shadow-overlay"
          >
            <div className="flex justify-end p-2">
              <button
                ref={drawerCloseRef}
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label={translate(messages, 'shell.closeNavigation')}
                className="rounded-md p-2 text-text-secondary hover:bg-surface-subtle"
              >
                <Icon name="overview" size={18} />
              </button>
            </div>
            <Sidebar
              locale={locale}
              messages={messages}
              groups={groups}
              pathname={pathname}
              collapsed={false}
              withinDrawer
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          messages={messages}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(!collapsed)}
          onOpenDrawer={() => setDrawerOpen(true)}
          drawerTriggerRef={drawerTriggerRef}
          account={account}
        />
        <div className="flex min-h-0 flex-1">
          {/*
            `tabIndex={-1}` is what makes the skip link work. Without it the
            browser moves the scroll position to #main but leaves focus in the
            document, so the next Tab returns to the navigation the user just
            skipped.
          */}
          {/*
            `min-h-0` is not decoration. A flex child's default `min-height:auto`
            refuses to shrink below its content, so without it `overflow-y-auto`
            here has nothing to overflow — the box grows instead and the page
            scrolls again, which is the defect this is fixing.
          */}
          <main
            id="main"
            tabIndex={-1}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto focus:outline-none"
          >
            {children}
          </main>
          {secondaryPanel ? (
            <aside
              aria-label={translate(messages, 'shell.secondaryPanel')}
              className="hidden w-80 shrink-0 overflow-y-auto border-s border-border bg-surface xl:block"
            >
              {secondaryPanel}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AppHeader({
  messages,
  collapsed,
  onToggleCollapsed,
  onOpenDrawer,
  drawerTriggerRef,
  account,
}: {
  readonly messages: Messages;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onOpenDrawer: () => void;
  readonly drawerTriggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly account?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-header flex h-16 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-4 shadow-xs">
      <button
        ref={drawerTriggerRef}
        type="button"
        onClick={onOpenDrawer}
        aria-label={translate(messages, 'shell.openNavigation')}
        className="rounded-lg p-2 text-text-secondary transition-colors duration-150 hover:bg-primary-subtle hover:text-primary lg:hidden"
      >
        <Icon name="overview" size={18} />
      </button>

      {/*
        Below `lg` the sidebar is a drawer, so the brand it carries is off
        screen and the application is unnamed until the drawer is opened. The
        header carries the compact mark for exactly that range and stands down
        above it, because two marks on one screen is duplication, not branding.
      */}
      <span className="text-text-heading lg:hidden">
        <BrandMark collapsed />
      </span>

      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-pressed={collapsed}
        aria-label={translate(messages, 'shell.collapseNavigation')}
        className="hidden rounded-lg p-2 text-text-secondary transition-colors duration-150 hover:bg-primary-subtle hover:text-primary lg:inline-flex"
      >
        <Icon name="overview" size={18} />
      </button>

      <div className="ms-auto flex items-center gap-2">
        {/*
          Rendered only WHILE the brand is provisional. It was unconditional
          until this guard was added, which quietly falsified the phase's
          central claim: flipping `isProvisional` to false would have left the
          shipped product still announcing "final brand pending" in its header.
          The notice is a statement about brand state, so brand state decides it.
        */}
        {brandIsProvisional ? (
          <span className="rounded-full bg-warning-subtle px-3 py-1 text-caption text-text-secondary">
            {translate(messages, 'app.provisionalBrand')}
          </span>
        ) : null}
        {account}
      </div>
    </header>
  );
}
