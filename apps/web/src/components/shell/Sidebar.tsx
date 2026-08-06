'use client';

import Link from 'next/link';
import { useCallback, useId, useState } from 'react';
import { BrandMark } from '@/components/brand';
import { Icon } from '@/components/primitives/Icon';
import type { NavigationGroup, NavigationItem } from '@/config/navigation';
import { containsActive, hrefFor, isActive } from '@/config/navigation';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * The module sidebar.
 *
 * Renders the navigation MODEL. It holds no list of modules of its own, which
 * is what lets the permission filter and the route matcher be tested without
 * rendering anything, and what stops this file becoming the one every feature
 * team has to edit.
 *
 * ## Direction
 *
 * There is not one physical-direction property in here. Padding, borders and
 * the collapse affordance are all logical (`ps-*`, `border-e`, `start-*`), so
 * Arabic RTL and English LTR are the same code path rather than a base layout
 * plus a pile of `[dir='rtl']` overrides that drift. The one exception is the
 * chevron's rotation, which lives in `styles/base/_navigation.scss` because
 * `transform` has no logical form.
 *
 * ## Collapsed mode (the 64px rail)
 *
 * Collapsing hides the labels, not the items. The accessible name survives —
 * it moves from visible text to `aria-label` on the link — so a screen-reader
 * user is unaffected by a purely visual affordance, and the `title` gives
 * sighted users the tooltip.
 *
 * In the rail a parent has no room for a submenu, so it becomes an ordinary
 * link to its own module route rather than a disclosure. That is why
 * `administration.overview` exists in the model: the rail needs somewhere for
 * `/administration` to point.
 *
 * ## Groups are an accordion (Owner acceptance)
 *
 * The Product Owner rejected the previous behaviour: "Administration navigation
 * is always expanded and has no clear expand/collapse arrow." Every parent is
 * now a real disclosure — a `<button>` with `aria-expanded` and `aria-controls`,
 * a chevron whose direction encodes the state, and a height transition.
 *
 * Two rules keep it from hiding the operator's own location:
 *
 *   - a group whose route (or any descendant's route) is the current page opens
 *     itself, so the current page is always visible without hunting;
 *   - a parent shows the active treatment when a CHILD is active, so a group the
 *     operator has deliberately closed still says "you are in here".
 *
 * Nothing is expanded permanently. Everything else starts closed, which is the
 * whole point — a sidebar where every group is open is a list, not navigation.
 *
 * ## Scrolling
 *
 * The navigation is a real scroll container and stays one. What changed at Owner
 * acceptance is the PAINTING of its scrollbar: Windows 11 draws a ~15px opaque
 * classic scrollbar, and on the shell's most prominent surface that read as a
 * permanent grey stripe. `subtle-scrollbar-on-dark` narrows it and shows the
 * thumb on interaction. See `styles/base/_scrollbars.scss` — there is no
 * JavaScript scroll simulation anywhere in this component.
 */

export interface SidebarProps {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly groups: readonly NavigationGroup[];
  readonly pathname: string;
  readonly collapsed: boolean;
  /** Rendered inside the tablet drawer, where the sidebar is not a landmark. */
  readonly withinDrawer?: boolean | undefined;
  readonly onNavigate?: (() => void) | undefined;
}

export function Sidebar({
  locale,
  messages,
  groups,
  pathname,
  collapsed,
  withinDrawer = false,
  onNavigate,
}: SidebarProps) {
  const labelId = useId();

  /*
   * Which groups the OPERATOR has opened or closed, by item key.
   *
   * Absent means "follow the route" — open if this group contains the current
   * page, closed otherwise. Present means the operator overrode that, and their
   * choice wins until they navigate somewhere the override would hide.
   *
   * State, not storage. `AppShell` lives in the dashboard layout, so this
   * component survives every client-side navigation and the choice persists for
   * the session without putting anything in the browser's storage. A reload
   * resets it — and lands on the route-derived state, which is correct by
   * construction.
   */
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const [lastPathname, setLastPathname] = useState(pathname);

  if (lastPathname !== pathname) {
    // Derived during render rather than in an effect: React documents this shape
    // for "reset state when a prop changes", and an effect would render the old
    // expansion once before correcting it — a visible flicker on every
    // navigation.
    setLastPathname(pathname);
    setOverrides((previous) => {
      const next: Record<string, boolean> = { ...previous };
      let changed = false;
      for (const group of groups) {
        for (const item of group.items) {
          // A group the operator closed reopens when the page moves inside it.
          // Otherwise clicking a search result that lives under a closed group
          // would leave them with no visible trace of where they are.
          if (next[item.key] === false && containsActive(pathname, locale, item)) {
            delete next[item.key];
            changed = true;
          }
        }
      }
      return changed ? next : previous;
    });
  }

  const toggle = useCallback((key: string, next: boolean) => {
    setOverrides((previous) => ({ ...previous, [key]: next }));
  }, []);

  const content = (
    <>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-4 text-sidebar-text">
        {/* The sidebar surface is navy, so the dark symbol needs inverting. */}
        <BrandMark collapsed={collapsed} onDark />
      </div>

      {/*
        The scrolling region. `min-h-0` is what lets it actually shrink: a flex
        child defaults to `min-height:auto` and refuses to go below its content,
        so `overflow-y-auto` alone would grow the column instead of scrolling.
        The brand block above is `shrink-0`, so it stays put while this moves.
      */}
      {/*
        `relative` for the same reason as `main`: this is a scroll container, and
        a scroll container that is not a containing block lets every
        `position:absolute` descendant — including `.sr-only` labels — resolve
        against the viewport and extend the document (`P1-26-F-069`).
        `overscroll-contain` stops a wheel gesture that reaches the end of the
        navigation from chaining outward.
      */}
      <nav
        aria-labelledby={labelId}
        data-testid="sidebar-navigation"
        className="subtle-scrollbar-on-dark relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-4"
      >
        <h2 id={labelId} className="sr-only">
          {translate(messages, 'nav.landmark')}
        </h2>
        <ul className="flex flex-col gap-6">
          {groups.map((group) => (
            <li key={group.key}>
              {/*
                The group heading is hidden visually when collapsed but stays in
                the accessibility tree: the grouping is structure, and structure
                does not disappear because the panel is narrower.
              */}
              <h3
                className={
                  collapsed
                    ? 'sr-only'
                    : 'px-3 pb-2 text-caption font-semibold uppercase tracking-wide text-sidebar-text-muted'
                }
              >
                {translate(messages, group.labelKey as keyof Messages)}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <SidebarEntry
                    key={item.key}
                    item={item}
                    locale={locale}
                    messages={messages}
                    pathname={pathname}
                    collapsed={collapsed}
                    overrides={overrides}
                    onToggle={toggle}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );

  if (withinDrawer) {
    return <div className="flex h-full flex-col bg-sidebar-background">{content}</div>;
  }

  return (
    <aside
      data-collapsed={collapsed ? 'true' : 'false'}
      className={[
        // `h-full`, not `h-dvh`: the shell is now exactly the viewport, so the
        // sidebar fills its column rather than declaring its own height and
        // then sliding away when the document grows past it.
        'hidden h-full min-h-0 shrink-0 flex-col border-e border-sidebar-border bg-sidebar-background lg:flex',
        'transition-[width] duration-base ease-standard',
        collapsed ? 'w-16' : 'w-64',
      ].join(' ')}
    >
      {content}
    </aside>
  );
}

const ROW_BASE = [
  'group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-body',
  'transition-colors duration-fast ease-standard',
].join(' ');

const ACTIVE_ROW = 'bg-sidebar-active-background font-medium text-sidebar-active';
const IDLE_ROW = 'text-sidebar-text-muted hover:bg-sidebar-surface hover:text-sidebar-text';

function SidebarEntry({
  item,
  locale,
  messages,
  pathname,
  collapsed,
  overrides,
  onToggle,
  onNavigate,
}: {
  readonly item: NavigationItem;
  readonly locale: Locale;
  readonly messages: Messages;
  readonly pathname: string;
  readonly collapsed: boolean;
  readonly overrides: Readonly<Record<string, boolean>>;
  readonly onToggle: (key: string, next: boolean) => void;
  readonly onNavigate?: (() => void) | undefined;
}) {
  const panelId = useId();
  const active = isActive(pathname, locale, item);
  const label = translate(messages, item.labelKey as keyof Messages);
  const planned = item.status === 'planned';
  const hasChildren = (item.children?.length ?? 0) > 0;

  // The rail has no room for a submenu, so a parent is a plain link there.
  const isDisclosure = hasChildren && !collapsed;
  const withinGroup = containsActive(pathname, locale, item);
  const expanded = overrides[item.key] ?? withinGroup;

  if (isDisclosure) {
    return (
      <li>
        <button
          type="button"
          // A native button, so Enter and Space both activate it with no key
          // handler of our own — and so the control is in the tab order, is
          // announced as a button, and gets the application's focus ring.
          onClick={() => onToggle(item.key, !expanded)}
          aria-expanded={expanded}
          aria-controls={panelId}
          // `aria-current` belongs to a link, not to a disclosure. The parent
          // still has to SAY it contains the current page, so it carries the
          // active treatment and a marker instead.
          data-active={withinGroup ? 'true' : 'false'}
          data-testid={`nav-disclosure-${item.key}`}
          className={[ROW_BASE, withinGroup ? ACTIVE_ROW : IDLE_ROW].join(' ')}
        >
          {withinGroup ? <ActiveMarker /> : null}
          <Icon name={item.icon} />
          <span className="truncate text-start">{label}</span>
          {planned ? (
            <span className="rounded-full bg-sidebar-surface px-2 py-0.5 text-caption text-sidebar-text-muted">
              {translate(messages, 'nav.planned')}
            </span>
          ) : null}
          <Chevron expanded={expanded} />
        </button>

        {/*
          The height transition, without measuring anything in JavaScript.

          A grid row of `0fr` collapses its content to zero and `1fr` gives it
          exactly the height it wants, and `grid-template-rows` is animatable —
          so this transitions to the content's real height without a
          `max-height` guess that is either too small (clipping the last item) or
          too large (making the animation appear to stall).

          `inert` is what stops a closed group being a set of invisible tab
          stops. Zero height is not zero focusability: without it, tabbing
          through a closed Administration group would move focus to six links
          nobody can see.
        */}
        <div
          id={panelId}
          inert={!expanded}
          className={[
            'grid transition-[grid-template-rows] duration-base ease-standard',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          ].join(' ')}
        >
          {/*
            `overflow-hidden` is what makes the row height mean anything. The
            padding is not decoration: the focus ring is drawn 2px outside the
            element with a 2px offset, so without room inside the clipping box a
            focused child would have its ring sliced off on the side and bottom.
          */}
          <ul className="flex flex-col gap-0.5 overflow-hidden ps-8 pe-1 pt-0.5 pb-1">
            {item.children?.map((child) => (
              <SidebarEntry
                key={child.key}
                item={child}
                locale={locale}
                messages={messages}
                pathname={pathname}
                collapsed={false}
                overrides={overrides}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      </li>
    );
  }

  if (planned) {
    // Deliberately NOT a link. A route whose screen does not exist yet must not
    // be clickable: an operator who clicks it and lands on a 404 learns that the
    // navigation lies, and stops trusting the rest of it.
    return (
      <li>
        <span
          aria-disabled="true"
          title={translate(messages, 'nav.plannedHint')}
          className={[
            ROW_BASE,
            collapsed ? 'justify-center' : '',
            'cursor-not-allowed text-sidebar-text-muted opacity-70',
          ].join(' ')}
        >
          <Icon name={item.icon} />
          {collapsed ? (
            <span className="sr-only">
              {label} — {translate(messages, 'nav.planned')}
            </span>
          ) : (
            <>
              <span className="truncate">{label}</span>
              <span className="ms-auto rounded-full bg-sidebar-surface px-2 py-0.5 text-caption text-sidebar-text-muted">
                {translate(messages, 'nav.planned')}
              </span>
            </>
          )}
        </span>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={hrefFor(locale, item)}
        {...(onNavigate ? { onClick: onNavigate } : {})}
        aria-current={active ? 'page' : undefined}
        {...(collapsed ? { 'aria-label': label, title: label } : {})}
        className={[
          ROW_BASE,
          collapsed ? 'justify-center' : '',
          active ? ACTIVE_ROW : IDLE_ROW,
        ].join(' ')}
      >
        {active ? <ActiveMarker /> : null}
        <Icon name={item.icon} />
        {collapsed ? null : <span className="truncate">{label}</span>}
      </Link>
    </li>
  );
}

/**
 * The active marker is a shape, not only a colour.
 *
 * Colour alone would fail WCAG 1.4.1 and would vanish for anyone with a
 * colour-vision difference — and it is the one piece of state in the sidebar
 * that matters at a glance.
 */
function ActiveMarker() {
  return (
    <span
      aria-hidden="true"
      className="absolute start-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sidebar-active"
    />
  );
}

/**
 * The disclosure arrow.
 *
 * `aria-hidden`, because `aria-expanded` on the button already carries the state
 * to assistive technology. Announcing the arrow as well would say the same thing
 * twice. The rotation — and its one direction branch — lives in
 * `styles/base/_navigation.scss`.
 */
function Chevron({ expanded }: { readonly expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-expanded={expanded ? 'true' : 'false'}
      data-testid="nav-chevron"
      className="nav-chevron ms-auto shrink-0"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  );
}
