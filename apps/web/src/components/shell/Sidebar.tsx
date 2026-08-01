'use client';

import Link from 'next/link';
import { useId } from 'react';
import { BrandMark } from '@/components/brand';
import { Icon } from '@/components/primitives/Icon';
import type { NavigationGroup, NavigationItem } from '@/config/navigation';
import { hrefFor, isActive } from '@/config/navigation';
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
 * plus a pile of `[dir='rtl']` overrides that drift.
 *
 * ## Collapsed mode
 *
 * Collapsing hides the labels, not the items. The accessible name survives —
 * it moves from visible text to `aria-label` on the link — so a screen-reader
 * user is unaffected by a purely visual affordance, and the `title` gives
 * sighted users the tooltip.
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

  const content = (
    <>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
        <BrandMark collapsed={collapsed} />
      </div>

      <nav aria-labelledby={labelId} className="flex-1 overflow-y-auto px-2 py-4">
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
                    : 'px-3 pb-2 text-caption font-semibold uppercase tracking-wide text-text-muted'
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
        'hidden h-dvh shrink-0 flex-col border-e border-border bg-sidebar-background lg:flex',
        'transition-[width] duration-base ease-standard',
        collapsed ? 'w-16' : 'w-64',
      ].join(' ')}
    >
      {content}
    </aside>
  );
}

function SidebarEntry({
  item,
  locale,
  messages,
  pathname,
  collapsed,
  onNavigate,
}: {
  readonly item: NavigationItem;
  readonly locale: Locale;
  readonly messages: Messages;
  readonly pathname: string;
  readonly collapsed: boolean;
  readonly onNavigate?: (() => void) | undefined;
}) {
  const active = isActive(pathname, locale, item);
  const label = translate(messages, item.labelKey as keyof Messages);
  const planned = item.status === 'planned';

  const shared = [
    'group relative flex items-center gap-3 rounded-md px-3 py-2 text-body',
    'transition-colors duration-fast ease-standard',
    collapsed ? 'justify-center' : '',
  ];

  if (planned) {
    // Deliberately NOT a link. A route whose screen does not exist yet must not
    // be clickable: an operator who clicks it and lands on a 404 learns that the
    // navigation lies, and stops trusting the rest of it.
    return (
      <li>
        <span
          aria-disabled="true"
          title={translate(messages, 'nav.plannedHint')}
          className={[...shared, 'cursor-not-allowed text-text-disabled'].join(' ')}
        >
          <Icon name={item.icon} />
          {collapsed ? (
            <span className="sr-only">
              {label} — {translate(messages, 'nav.planned')}
            </span>
          ) : (
            <>
              <span className="truncate">{label}</span>
              <span className="ms-auto rounded-full bg-surface-subtle px-2 py-0.5 text-caption text-text-muted">
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
          ...shared,
          active
            ? 'bg-primary-subtle font-medium text-primary'
            : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary',
        ].join(' ')}
      >
        {/*
          The active marker is a shape, not only a colour. Colour alone would
          fail WCAG 1.4.1 and would vanish for anyone with a colour-vision
          difference — and it is the one piece of state in the sidebar that
          matters at a glance.
        */}
        {active ? (
          <span
            aria-hidden="true"
            className="absolute start-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
          />
        ) : null}
        <Icon name={item.icon} />
        {collapsed ? null : <span className="truncate">{label}</span>}
      </Link>
      {!collapsed && item.children && item.children.length > 0 ? (
        <ul className="mt-0.5 flex flex-col gap-0.5 ps-8">
          {item.children.map((child) => (
            <SidebarEntry
              key={child.key}
              item={child}
              locale={locale}
              messages={messages}
              pathname={pathname}
              collapsed={false}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
