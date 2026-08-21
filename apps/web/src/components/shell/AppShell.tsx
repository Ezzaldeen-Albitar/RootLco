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
import { LocaleSwitcher } from './LocaleSwitcher';
import { Sidebar } from './Sidebar';
import { useScrollRestoration } from './use-scroll-restoration';

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

/**
 * What Tab can reach. Kept identical to the one in `Overlays.tsx`, deliberately.
 *
 * The navigation drawer is hand-rolled rather than built on `Drawer` because it
 * renders a `Sidebar` rather than arbitrary children — but "modal" has to mean
 * the same thing in both, or a keyboard user learns that some overlays trap
 * focus and some do not.
 */
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

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
  const drawerPanelRef = useRef<HTMLDivElement | null>(null);

  // Has the drawer ever been open? Focus is returned to the trigger only after a
  // real close.
  //
  // Without this the effect runs on MOUNT with `drawerOpen === false` and takes
  // the "closed" branch, so every page load below `lg` moved focus to the
  // hamburger button (`P1-26-F-073`). Measured, not inferred: at 900px the
  // `activeElement` after load was `BUTTON[aria-label="Open navigation"]`.
  //
  // The cost is not cosmetic. A keyboard user starts each page inside the
  // chrome rather than at the top of the document, a screen reader announces
  // "Open navigation, button" before the page has a chance to say what it is,
  // and the skip link — which is supposed to be the first stop — has already
  // been passed.
  const hasOpened = useRef(false);

  useEffect(() => {
    if (drawerOpen) {
      hasOpened.current = true;
      drawerCloseRef.current?.focus();
      return;
    }
    // Only on the way BACK from an open drawer, never on first render.
    if (hasOpened.current) drawerTriggerRef.current?.focus({ preventScroll: true });
  }, [drawerOpen]);

  // Escape closes, and Tab is TRAPPED inside.
  //
  // The drawer claims `aria-modal="true"`, and a modal that a keyboard can tab
  // out of is lying to assistive technology: the page behind is announced as
  // inert and is reachable anyway (`P1-26-F-074`). Measured: Tab from the last
  // item inside the drawer landed on a control outside it.
  //
  // `Overlays.tsx` has solved this once, for Dialog and Drawer. This drawer is
  // hand-rolled because it renders a `Sidebar` rather than arbitrary children,
  // so it borrows the behaviour rather than reimplementing it.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = drawerPanelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [drawerOpen]);

  // Repays the cost of moving the scroll out of the document (ADR-021): the
  // browser restores `window.scrollY` for free and a `<div>`'s `scrollTop`
  // never.
  useScrollRestoration('main');

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
    <div className="relative flex h-dvh overflow-hidden bg-app-background text-text-primary">
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
          {/*
            `flex flex-col` with a `shrink-0` close row and a `min-h-0 flex-1`
            body, because the panel is exactly the viewport and the close row is
            part of it.

            It used to be a plain block with the close row and the navigation as
            siblings: the row took 56px off the top and the `h-full` navigation
            below it still asked for the WHOLE viewport, so the drawer's content
            ran 98px past the bottom of the screen. Measured at 900x700 — fifteen
            links, the last one's bottom at 798 against a 700px viewport — so the
            last modules were simply unreachable (`P1-26-F-075`).

            That is the same defect this phase exists to fix, in the one surface
            the desktop measurements could not see, because the drawer does not
            exist above `lg`.

            `border-e` supplies a WIDTH. The panel previously had only
            `shadow-overlay` to separate it from the page, and a shadow is
            suppressed under forced colours and in print, so on Windows High
            Contrast the drawer had no visible edge at all.
          */}
          <div
            ref={drawerPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label={translate(messages, 'nav.landmark')}
            className="fixed inset-y-0 start-0 z-dialog flex w-72 flex-col border-e border-border bg-sidebar-background shadow-overlay"
          >
            <div className="flex shrink-0 justify-end p-2">
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
            {/* `min-h-0 flex-1` is what lets the navigation inside scroll
                rather than run off the bottom of the panel. */}
            <div className="min-h-0 flex-1">
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
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          locale={locale}
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
          {/*
            `relative` is what actually stops the document scrolling, and it is
            the least obvious line in this file (`P1-26-F-069`).

            `overflow-y-auto` clips descendants in FLOW. It does not clip an
            absolutely positioned descendant whose containing block resolved past
            this element — and while `main` was `position:static`, every
            `.sr-only` element resolved its containing block to the INITIAL
            containing block, i.e. the viewport. `.sr-only` is the standard
            visually-hidden pattern and uses `position:absolute`, so each
            screen-reader table caption was laid out at DOCUMENT coordinates.
            `/administration/permissions` renders seventeen tables; the deepest
            caption landed at y≈7200 and the document grew to 7075px against a
            900px viewport — 6175px of blank overscroll produced entirely by
            1px accessibility text.

            Measured, not reasoned: `html`/`body` `height:100%; overflow:hidden`
            changed nothing at all. `position:relative` here fixed it completely
            while `main` kept its own scrolling (7136/836). `relative` with
            `z-index:auto` creates a containing block WITHOUT creating a stacking
            context, so nothing that has to escape — dropdown, dialog, toast —
            is trapped by it, and `position:sticky` table headers still stick to
            this scrollport because sticky follows the scrolling ancestor.
          */}
          <main
            id="main"
            tabIndex={-1}
            data-scroll-region="main"
            /*
             * `flex flex-col` so a screen can opt into filling the scrollport
             * (`PageBody fill`) instead of growing with its content. An ordinary
             * screen is a single auto-height child and behaves exactly as it did
             * under block layout; a `fill` screen becomes a flex child that can
             * shrink, which is what lets a table's pager stay on screen.
             */
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain focus:outline-none"
          >
            {children}
          </main>
          {secondaryPanel ? (
            <aside
              aria-label={translate(messages, 'shell.secondaryPanel')}
              className="relative hidden w-80 shrink-0 overflow-y-auto overscroll-contain border-s border-border bg-surface xl:block"
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
  locale,
  messages,
  collapsed,
  onToggleCollapsed,
  onOpenDrawer,
  drawerTriggerRef,
  account,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onOpenDrawer: () => void;
  readonly drawerTriggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly account?: ReactNode;
}) {
  return (
    // NOT `sticky`. It used to be, from when the document scrolled — and since
    // the shell became exactly the viewport this header's containing block never
    // scrolls, so `sticky top-0` had nothing to stick to and was inert.
    // `shrink-0` inside a fixed-height column is what actually keeps it in place.
    //
    // Removing it matters beyond tidiness: an inert `sticky` invites the next
    // person to "fix" a scrolling problem by adding `overflow` somewhere in the
    // chain, which is how the containing-block contract gets broken. `z-header`
    // stays — that is what keeps it above a table's `z-sticky` header.
    <header className="z-header flex h-16 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-4 shadow-xs">
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
          <span className="hidden rounded-full bg-warning-subtle px-3 py-1 text-caption text-text-secondary sm:inline">
            {translate(messages, 'app.provisionalBrand')}
          </span>
        ) : null}
        {/*
          The language control lives in the HEADER, not in the sidebar.
          The sidebar collapses to a 16-unit rail and becomes a drawer below
          `lg`, so a control placed there is unreachable in exactly the two
          states where a user is most likely to be hunting for it. The header is
          present, and identical, in every state.

          It is the same component the sign-in screen uses. Two switchers would
          be two chances for the route-preservation rule to be wrong.
        */}
        <LocaleSwitcher locale={locale} messages={messages} />
        {account}
      </div>
    </header>
  );
}
