'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * Overlays: dialog, alert dialog, drawer, sheet, popover, dropdown, tabs,
 * tooltip, toast, and the three confirmation kinds.
 *
 * ## Focus is the whole problem
 *
 * An overlay that does not manage focus is not an overlay, it is a floating div.
 * Three properties, implemented once in `useDialogBehaviour` so no individual
 * overlay can be added without them:
 *
 *   1. Focus moves INTO the overlay when it opens, to a safe element.
 *   2. Tab is TRAPPED inside while it is open. Without this the user tabs
 *      behind the overlay into content they cannot see, and the page under a
 *      modal is still reachable by keyboard.
 *   3. Focus RETURNS to whatever opened it on close. Without this a keyboard
 *      user is dropped at the top of the document every time they dismiss
 *      something.
 *
 * ## Safe initial focus
 *
 * A destructive confirmation never receives default focus on its destructive
 * button. Enter-to-dismiss is muscle memory, and a dialog that deletes on Enter
 * turns a reflex into data loss. Cancel is focused instead, and the destructive
 * action must be reached deliberately.
 *
 * ## Motion
 *
 * Opacity and a two-pixel translate over a token duration. Under
 * `prefers-reduced-motion` every duration token is already 0ms — see
 * `src/styles/tokens/_index.scss` — so nothing here needs its own media query.
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useDialogBehaviour({
  open,
  onClose,
  containerRef,
  initialFocusRef,
  closeOnOutsideClick = true,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  readonly closeOnOutsideClick?: boolean;
}) {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    const target =
      initialFocusRef?.current ?? container?.querySelector<HTMLElement>(FOCUSABLE) ?? container;
    target?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (focusable.length === 0) {
        // Nothing to move to, so keep focus where it is rather than letting it
        // escape to the page behind.
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, [open, onClose, containerRef, initialFocusRef]);

  const onBackdropClick = useCallback(() => {
    if (closeOnOutsideClick) onClose();
  }, [closeOnOutsideClick, onClose]);

  return { onBackdropClick };
}

// --- dialog ------------------------------------------------------------------

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly messages: Messages;
  /** `alertdialog` for a decision the user must resolve before continuing. */
  readonly role?: 'dialog' | 'alertdialog';
  readonly initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  readonly closeOnOutsideClick?: boolean;
  readonly width?: 'sm' | 'md' | 'lg';
}

const DIALOG_WIDTH = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  messages,
  role = 'dialog',
  initialFocusRef,
  closeOnOutsideClick = true,
  width = 'md',
}: DialogProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const base = useId();
  const { onBackdropClick } = useDialogBehaviour({
    open,
    onClose,
    containerRef,
    initialFocusRef,
    closeOnOutsideClick: role === 'alertdialog' ? false : closeOnOutsideClick,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onBackdropClick}
        className="absolute inset-0 bg-overlay transition-opacity duration-overlay ease-standard"
      />
      <div
        ref={containerRef}
        role={role}
        aria-modal="true"
        aria-labelledby={`${base}-title`}
        aria-describedby={description ? `${base}-description` : undefined}
        tabIndex={-1}
        className={`relative w-full ${DIALOG_WIDTH[width]} rounded-lg border border-border bg-surface shadow-overlay transition-[opacity,transform] duration-overlay ease-enter focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={`${base}-title`} className="text-section-title font-semibold text-text-primary">
              {title}
            </h2>
            {description ? (
              <p id={`${base}-description`} className="mt-1 text-body text-text-secondary">
                {description}
              </p>
            ) : null}
          </div>
          {role === 'dialog' ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={translate(messages, 'overlay.close')}
              className="shrink-0 rounded-md p-1 text-text-muted hover:bg-surface-subtle hover:text-text-primary"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          ) : null}
        </div>
        {children ? <div className="px-5 py-4">{children}</div> : null}
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- drawer / sheet ----------------------------------------------------------

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  messages,
  side = 'end',
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly messages: Messages;
  /** Logical side. `end` is the right in LTR and the left in RTL. */
  readonly side?: 'start' | 'end' | 'bottom';
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const base = useId();
  const { onBackdropClick } = useDialogBehaviour({ open, onClose, containerRef });

  if (!open) return null;

  const position =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 max-h-[80dvh] w-full rounded-t-lg'
      : side === 'start'
        ? 'inset-y-0 start-0 h-full w-full max-w-md'
        : 'inset-y-0 end-0 h-full w-full max-w-md';

  return (
    <div className="fixed inset-0 z-dialog">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onBackdropClick}
        className="absolute inset-0 bg-overlay"
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${base}-title`}
        tabIndex={-1}
        className={`absolute ${position} flex flex-col border-border bg-surface shadow-overlay transition-transform duration-overlay ease-enter focus:outline-none`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <h2 id={`${base}-title`} className="text-section-title font-semibold text-text-primary">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={translate(messages, 'overlay.close')}
            className="rounded-md p-1 text-text-muted hover:bg-surface-subtle hover:text-text-primary"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- tabs --------------------------------------------------------------------

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  readonly panel: ReactNode;
}

export function Tabs({
  tabs,
  label,
  initialId,
}: {
  readonly tabs: readonly TabDefinition[];
  readonly label: string;
  readonly initialId?: string;
}) {
  const base = useId();
  const [activeId, setActiveId] = useState(initialId ?? tabs[0]?.id ?? '');
  const listRef = useRef<HTMLDivElement | null>(null);

  // Arrow keys move between tabs, which is what the tabs pattern requires —
  // Tab itself must move OUT of the tab list to the panel, not between tabs.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.id === activeId);
    if (index < 0) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    setActiveId(target.id);
    listRef.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(`${base}-tab-${target.id}`)}`)
      ?.focus();
  };

  return (
    <div>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 border-b border-border"
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              id={`${base}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              // Only the active tab is tabbable. A tab list where every tab is
              // in the tab order forces a keyboard user through all of them to
              // reach the panel.
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-body transition-colors duration-fast ease-standard ${
                selected
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${base}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={tab.id !== activeId}
          tabIndex={0}
          className="py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {tab.id === activeId ? tab.panel : null}
        </div>
      ))}
    </div>
  );
}

// --- toast -------------------------------------------------------------------

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  /**
   * `| undefined` is explicit because `exactOptionalPropertyTypes` is on: a
   * caller building this from an optional field passes `undefined` rather than
   * omitting the key, and the type has to admit what the callers actually do.
   */
  readonly description?: string | undefined;
}

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'border-info bg-info-subtle',
  success: 'border-success bg-success-subtle',
  warning: 'border-warning bg-warning-subtle',
  error: 'border-error bg-error-subtle',
};

export function ToastRegion({
  toasts,
  onDismiss,
  messages,
}: {
  readonly toasts: readonly ToastMessage[];
  readonly onDismiss: (id: string) => void;
  readonly messages: Messages;
}) {
  // Two politeness levels, one authority.
  //
  // A failure announced `polite` waits for whatever is already speaking — which,
  // after a form submission, is usually the form. The user acts on stale
  // information in the gap. Splitting by tone puts errors on `assertive` and
  // everything else on `polite`, while keeping ONE component, ONE mount and one
  // labelled region: two hosts would be two authorities, but two live children
  // inside one host are just correct politeness.
  const assertive = toasts.filter((toast) => toast.tone === 'error');
  const polite = toasts.filter((toast) => toast.tone !== 'error');

  return (
    // Live regions that persist across toasts. Creating a live region at the
    // moment a message appears is the classic mistake — screen readers announce
    // changes WITHIN an existing region, so a region born with its content is
    // silent. Both lists below are therefore always rendered, empty or not.
    <div
      role="region"
      aria-label={translate(messages, 'overlay.notifications')}
      data-testid="notification-region"
      /*
       * Pinned to the viewport's top inline-end corner: top-right in English,
       * top-left in Arabic, from ONE declaration. `end-4` is
       * `inset-inline-end`, so direction is the browser's job and not a second
       * RTL branch that can drift from the first.
       *
       * Top rather than bottom, because the bottom of a bounded table region is
       * exactly where pagination lives and a toast that covers the control the
       * user is about to press is worse than no toast. It is also where a mobile
       * keyboard appears.
       *
       * `fixed` keeps it out of layout entirely, so it cannot add document
       * height, cannot move a table row, and stays put while `main` scrolls.
       * `pointer-events-none` on the region with `pointer-events-auto` on each
       * toast means the empty column never swallows a click meant for the page
       * beneath it.
       */
      className="pointer-events-none fixed end-4 top-4 z-toast flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 pt-[env(safe-area-inset-top)] pe-[env(safe-area-inset-right)]"
    >
      <ol aria-live="assertive" className="contents">
        {assertive.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} messages={messages} />
        ))}
      </ol>
      <ol aria-live="polite" className="contents">
        {polite.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} messages={messages} />
        ))}
      </ol>
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
  messages,
}: {
  readonly toast: ToastMessage;
  readonly onDismiss: (id: string) => void;
  readonly messages: Messages;
}) {
  return (
    <li
      data-testid="notification"
      data-tone={toast.tone}
      /*
       * `break-words` because a backend message is not length-checked by the
       * interface, and a long unbroken token would otherwise widen the card past
       * the viewport instead of wrapping.
       *
       * There is deliberately NO entrance transition. `prefers-reduced-motion`
       * already collapses every duration token to zero, so an animation here
       * would be honoured correctly — but a toast has nothing to animate FROM:
       * it mounts at its final opacity and position. A `transition-opacity` with
       * no opacity change is a class that documents an animation which does not
       * exist, and this file has been burned by unproven claims before.
       */
      className={`pointer-events-auto flex w-full max-w-md items-start gap-3 break-words rounded-md border p-3 shadow-md ${TONE_CLASS[toast.tone]}`}
    >
      {/*
        The tone, for anyone who cannot see the colour. Four tones distinguished
        only by border and background collapse to one appearance under Windows
        High Contrast, and to nothing at all for a screen-reader user.
      */}
      <span className="sr-only">
        {translate(messages, `overlay.tone.${toast.tone}` as keyof Messages)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-text-primary">{toast.title}</p>
        {toast.description ? (
          <p className="text-supporting text-text-secondary">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={translate(messages, 'overlay.dismiss')}
        className="shrink-0 rounded-md p-1 text-text-muted hover:text-text-primary"
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </li>
  );
}

// --- confirmations -----------------------------------------------------------

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  messages,
  destructive = false,
  pending = false,
  error,
}: {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly confirmLabel: string;
  readonly messages: Messages;
  readonly destructive?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      messages={messages}
      role="alertdialog"
      width="sm"
      // Cancel takes initial focus on a destructive confirmation. Enter is
      // muscle memory, and a dialog that deletes on Enter turns a reflex into
      // data loss.
      initialFocusRef={destructive ? cancelRef : undefined}
      footer={
        <>
          {error ? (
            <p role="alert" className="me-auto text-supporting text-error">
              {error}
            </p>
          ) : null}
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border bg-surface px-4 py-2 text-button text-text-secondary hover:bg-surface-subtle disabled:cursor-not-allowed"
          >
            {translate(messages, 'overlay.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending || undefined}
            className={`rounded-md px-4 py-2 text-button font-medium text-text-inverse transition-colors duration-fast ease-standard disabled:cursor-not-allowed ${
              destructive ? 'bg-error hover:opacity-90' : 'bg-primary hover:bg-primary-hover'
            }`}
          >
            {pending ? translate(messages, 'overlay.working') : confirmLabel}
          </button>
        </>
      }
    />
  );
}

/**
 * Confirmation that requires a written reason.
 *
 * Used for actions that are auditable rather than merely destructive — a
 * refused reception, a reopened work order. The reason is a business record,
 * so an empty or whitespace-only one is refused rather than sent as `""`.
 *
 * It stays LOCAL to this component until submit: an audit reason is free text
 * about an operational decision, and holding it in a store or a URL would put
 * it somewhere it does not belong.
 */
export function ReasonConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  reasonLabel,
  messages,
  destructive = false,
  pending = false,
  error,
}: {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (reason: string) => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly confirmLabel: string;
  readonly reasonLabel: string;
  readonly messages: Messages;
  readonly destructive?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const base = useId();

  const empty = reason.trim().length === 0;
  const showEmptyError = touched && empty;

  // Reset when the dialog closes, adjusted DURING render rather than in an
  // effect. React documents this shape for deriving state from a changed prop:
  // an effect would render the stale reason once before clearing it, which for a
  // reason box means the previous refusal's text is briefly visible in the next
  // one.  catches that, and it is right.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setReason('');
      setTouched(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      messages={messages}
      role="alertdialog"
      width="sm"
      initialFocusRef={destructive ? cancelRef : undefined}
      footer={
        <>
          {error ? (
            <p role="alert" className="me-auto text-supporting text-error">
              {error}
            </p>
          ) : null}
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border bg-surface px-4 py-2 text-button text-text-secondary hover:bg-surface-subtle disabled:cursor-not-allowed"
          >
            {translate(messages, 'overlay.cancel')}
          </button>
          <button
            type="button"
            disabled={pending || empty}
            aria-busy={pending || undefined}
            onClick={() => {
              setTouched(true);
              if (empty) return;
              onConfirm(reason.trim());
            }}
            className={`rounded-md px-4 py-2 text-button font-medium text-text-inverse transition-colors duration-fast ease-standard disabled:cursor-not-allowed disabled:opacity-60 ${
              destructive ? 'bg-error hover:opacity-90' : 'bg-primary hover:bg-primary-hover'
            }`}
          >
            {pending ? translate(messages, 'overlay.working') : confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${base}-reason`} className="text-label font-medium text-text-primary">
          {reasonLabel}
          <span aria-hidden="true" className="ms-1 text-error">
            *
          </span>
        </label>
        <textarea
          id={`${base}-reason`}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-required="true"
          aria-invalid={showEmptyError || undefined}
          aria-errormessage={showEmptyError ? `${base}-reason-error` : undefined}
          className={`w-full resize-y rounded-md border bg-surface px-3 py-2 text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
            showEmptyError ? 'border-error' : 'border-border'
          }`}
        />
        {showEmptyError ? (
          <p id={`${base}-reason-error`} role="alert" className="text-supporting text-error">
            {translate(messages, 'overlay.reasonRequired')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
