import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import {
  ConfirmDialog,
  Dialog,
  Drawer,
  ReasonConfirmDialog,
  Tabs,
  ToastRegion,
} from '@/components/overlays/Overlays';
import { ConfirmDialog as MuiConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { REDUCED_MOTION_QUERY } from '@/components/ui-foundation/use-reduced-motion';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { BOTH_DIRECTIONS, renderLtr, renderRtl } from './render';

const messages = getMessages('en');

/** A realistic host: a trigger button, so focus has somewhere to return to. */
function DialogHost({ destructive = false }: { readonly destructive?: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {destructive ? (
        <ConfirmDialog
          open={open}
          onCancel={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
          messages={messages}
          destructive
          title="Delete this?"
          confirmLabel="Delete"
        />
      ) : (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          messages={messages}
          title="A dialog"
          description="Some description"
        >
          <button type="button">inside one</button>
          <button type="button">inside two</button>
        </Dialog>
      )}
    </>
  );
}

describe('dialog focus behaviour', () => {
  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup();
    renderLtr(<DialogHost />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('returns focus to the trigger when it closes', async () => {
    const user = userEvent.setup();
    renderLtr(<DialogHost />);
    const trigger = screen.getByRole('button', { name: 'open' });
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    // The property a keyboard user notices immediately when it is missing: they
    // are otherwise dropped at the top of the document on every dismissal.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('traps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    renderLtr(<DialogHost />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    const dialog = await screen.findByRole('dialog');
    for (let index = 0; index < 8; index += 1) {
      await user.tab();
      expect(
        dialog.contains(document.activeElement),
        `focus escaped the dialog after ${index + 1} tabs`
      ).toBe(true);
    }
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderLtr(<DialogHost />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('names itself from its title and description', async () => {
    const user = userEvent.setup();
    renderLtr(<DialogHost />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('A dialog');
    expect(dialog).toHaveAccessibleDescription('Some description');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('focuses CANCEL on a destructive confirmation, never the destructive action', async () => {
    const user = userEvent.setup();
    renderLtr(<DialogHost destructive />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByRole('alertdialog');
    // Enter-to-dismiss is muscle memory. A dialog that deletes on Enter turns a
    // reflex into data loss.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    );
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Delete' }));
  });

  it('does not dismiss an alert dialog by clicking outside it', async () => {
    const user = userEvent.setup();
    renderLtr(<DialogHost destructive />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    const alert = await screen.findByRole('alertdialog');
    fireEvent.click(document.body);
    expect(alert).toBeInTheDocument();
  });
});

describe('the reason confirmation', () => {
  function ReasonHost({ onConfirm }: { readonly onConfirm: (reason: string) => void }) {
    const [open, setOpen] = useState(true);
    return (
      <ReasonConfirmDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={(reason) => {
          onConfirm(reason);
          setOpen(false);
        }}
        messages={messages}
        title="Refuse this"
        reasonLabel="Reason"
        confirmLabel="Refuse"
      />
    );
  }

  it('refuses an empty reason and says so', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderLtr(<ReasonHost onConfirm={onConfirm} />);
    const confirm = screen.getByRole('button', { name: 'Refuse' });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('refuses a whitespace-only reason', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderLtr(<ReasonHost onConfirm={onConfirm} />);
    await user.type(screen.getByLabelText(/Reason/), '    ');
    expect(screen.getByRole('button', { name: 'Refuse' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('submits a trimmed reason', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderLtr(<ReasonHost onConfirm={onConfirm} />);
    await user.type(screen.getByLabelText(/Reason/), '  parts unavailable  ');
    await user.click(screen.getByRole('button', { name: 'Refuse' }));
    expect(onConfirm).toHaveBeenCalledWith('parts unavailable');
  });

  it('associates the empty-reason error with the field', async () => {
    const user = userEvent.setup();
    renderLtr(<ReasonHost onConfirm={vi.fn()} />);
    const textarea = screen.getByLabelText(/Reason/);
    await user.click(textarea);
    await user.tab();
    await waitFor(() => expect(textarea).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByRole('alert')).toHaveTextContent('A reason is required.');
  });
});

describe('tabs', () => {
  const tabs = [
    { id: 'a', label: 'Alpha', panel: <p>Panel alpha</p> },
    { id: 'b', label: 'Beta', panel: <p>Panel beta</p> },
    { id: 'c', label: 'Gamma', panel: <p>Panel gamma</p> },
  ];

  it('exposes exactly one tab in the tab order', () => {
    renderLtr(<Tabs tabs={tabs} label="Sections" />);
    const tabbable = screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0);
    // A tab list where every tab is tabbable forces a keyboard user through all
    // of them to reach the panel.
    expect(tabbable).toHaveLength(1);
  });

  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    renderLtr(<Tabs tabs={tabs} label="Sections" />);
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows only the selected panel', async () => {
    const user = userEvent.setup();
    renderLtr(<Tabs tabs={tabs} label="Sections" />);
    expect(screen.getByText('Panel alpha')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(screen.getByText('Panel beta')).toBeVisible();
    expect(screen.queryByText('Panel alpha')).toBeNull();
  });
});

describe('toasts', () => {
  it('announces from live regions that already exist, at two politeness levels', () => {
    // Both lists are rendered even when empty. A live region created at the
    // moment a message appears is silent — screen readers announce changes
    // WITHIN an existing region.
    const { container, rerender } = renderLtr(
      <ToastRegion messages={messages} toasts={[]} onDismiss={vi.fn()} />
    );
    const region = screen.getByRole('region', { name: 'Notifications' });
    const polite = container.querySelector('[aria-live="polite"]');
    const assertive = container.querySelector('[aria-live="assertive"]');
    expect(polite, 'the polite list must exist before any message does').not.toBeNull();
    expect(assertive, 'the assertive list must exist before any message does').not.toBeNull();

    rerender(
      <ToastRegion
        messages={messages}
        toasts={[{ id: '1', tone: 'success', title: 'Saved' }]}
        onDismiss={vi.fn()}
      />
    );
    expect(region).toHaveTextContent('Saved');
    expect(polite).toHaveTextContent('Saved');
    expect(assertive, 'a success must not interrupt').not.toHaveTextContent('Saved');
  });

  it('routes an error to the assertive region, so a failure does not queue', () => {
    // A denial announced politely waits behind whatever is already speaking —
    // usually the form the operator just submitted — and they act on stale
    // information in the gap.
    const { container } = renderLtr(
      <ToastRegion
        messages={messages}
        toasts={[{ id: 'e', tone: 'error', title: 'Update failed' }]}
        onDismiss={vi.fn()}
      />
    );
    expect(container.querySelector('[aria-live="assertive"]')).toHaveTextContent('Update failed');
    expect(container.querySelector('[aria-live="polite"]')).not.toHaveTextContent('Update failed');
  });

  it('names the tone for anyone who cannot see the colour', () => {
    // Four tones distinguished only by border and background collapse to one
    // appearance under Windows High Contrast, and to nothing at all for a
    // screen-reader user.
    renderLtr(
      <ToastRegion
        messages={messages}
        toasts={[{ id: 'w', tone: 'warning', title: 'Careful' }]}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText('Warning:')).toBeInTheDocument();
  });

  it('dismisses by id', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderLtr(
      <ToastRegion
        messages={messages}
        toasts={[{ id: 'abc', tone: 'info', title: 'Note' }]}
        onDismiss={onDismiss}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith('abc');
  });
});

describe('drawer', () => {
  it('is a modal dialog with an accessible name', () => {
    renderLtr(
      <Drawer open onClose={vi.fn()} messages={messages} title="Filters">
        <p>content</p>
      </Drawer>
    );
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveAccessibleName('Filters');
    expect(drawer).toHaveAttribute('aria-modal', 'true');
  });
});

describe('overlays are accessible in both directions', () => {
  it.each(BOTH_DIRECTIONS)('has no axe violations in %s', async (_locale, renderIn) => {
    const { container } = renderIn(
      <Dialog open onClose={vi.fn()} messages={messages} title="A dialog" description="Detail">
        <button type="button">action</button>
      </Dialog>
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});

/*
 * The decision dialogs on Material UI (`components/dialogs`, ADR-022 PR1).
 *
 * The same contract as the dialogs above — named, described, focus in, Tab
 * trapped, focus back, Escape cancels, a click outside does not, Cancel first
 * on a destructive action — plus what Material adds a risk to: a closed dialog
 * must leave the accessibility tree AT ONCE (Material keeps one mounted through
 * its exit transition), and "reduce motion" must turn the fade off.
 */
function inFoundation(ui: ReactElement, locale: Locale = 'en') {
  const catalogue = getMessages(locale);
  const renderIn = locale === 'ar' ? renderRtl : renderLtr;
  return renderIn(
    <UiFoundationProvider locale={locale} text={muiTextOf(catalogue)}>
      {ui}
    </UiFoundationProvider>
  );
}

function MuiConfirmHost({
  destructive = false,
  pending = false,
  error,
  onConfirm = () => undefined,
  onCancel = () => undefined,
}: {
  readonly destructive?: boolean;
  readonly pending?: boolean;
  readonly error?: string;
  readonly onConfirm?: () => void;
  readonly onCancel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <MuiConfirmDialog
        open={open}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        messages={messages}
        title="Delete this?"
        description="It cannot be brought back."
        confirmLabel="Delete"
        destructive={destructive}
        pending={pending}
        error={error}
        testId="mui-confirm"
      />
    </>
  );
}

async function openMuiConfirm(ui: ReactElement) {
  const user = userEvent.setup();
  inFoundation(ui);
  const trigger = screen.getByRole('button', { name: 'open' });
  await user.click(trigger);
  const dialog = await screen.findByRole('alertdialog');
  return { user, trigger, dialog };
}

function reducedMotionAnswer(reduce: boolean) {
  return (query: string) =>
    ({
      matches: reduce && query === REDUCED_MOTION_QUERY,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
}

describe('the Material UI confirmation', () => {
  it('is an alert dialog named by its title and described by its sentence', async () => {
    const { dialog } = await openMuiConfirm(<MuiConfirmHost />);
    expect(dialog).toHaveAccessibleName('Delete this?');
    expect(dialog).toHaveAccessibleDescription('It cannot be brought back.');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-testid', 'mui-confirm');
  });

  it('focuses CANCEL on a destructive action, never the destructive button', async () => {
    const { dialog } = await openMuiConfirm(<MuiConfirmHost destructive />);
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(document.activeElement).not.toBe(within(dialog).getByRole('button', { name: 'Delete' }));
  });

  it('draws a destructive action in the error colour and marks it', async () => {
    const { dialog } = await openMuiConfirm(<MuiConfirmHost destructive />);
    const action = within(dialog).getByRole('button', { name: 'Delete' });
    expect(action).toHaveAttribute('data-destructive', 'true');
    expect(action.className).toMatch(/MuiButton-colorError/);
  });

  it('does not mark or colour an ordinary confirmation as destructive', async () => {
    // Falsification of the case above: the marking follows the prop, it is not
    // simply always on.
    const { dialog } = await openMuiConfirm(<MuiConfirmHost />);
    const action = within(dialog).getByRole('button', { name: 'Delete' });
    expect(action).not.toHaveAttribute('data-destructive');
    expect(action.className).not.toMatch(/MuiButton-colorError/);
  });

  it('traps Tab inside the dialog, both ways', async () => {
    const { user, dialog } = await openMuiConfirm(<MuiConfirmHost destructive />);
    for (let index = 0; index < 6; index += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `escaped after ${index + 1} tabs`).toBe(true);
    }
    for (let index = 0; index < 6; index += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement), `escaped after ${index + 1} back-tabs`).toBe(
        true
      );
    }
  });

  it('cancels on Escape, and returns focus to what opened it', async () => {
    const onCancel = vi.fn();
    const { user, trigger } = await openMuiConfirm(<MuiConfirmHost onCancel={onCancel} />);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('leaves the accessibility tree the moment it is answered, with no exit transition', async () => {
    const { user, dialog } = await openMuiConfirm(<MuiConfirmHost />);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    // Synchronously — not after a transition a test would have to wait out. A
    // dialog still in the tree after its answer is a second, stale decision.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.querySelector('.MuiDialog-root')).toBeNull();
  });

  it('is not dismissed by a click outside it', async () => {
    const onCancel = vi.fn();
    const { user } = await openMuiConfirm(<MuiConfirmHost onCancel={onCancel} />);
    const backdrop = document.querySelector('.MuiBackdrop-root');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('while pending: both buttons are disabled, the action says so, and Escape does nothing', async () => {
    const onCancel = vi.fn();
    const { dialog } = await openMuiConfirm(<MuiConfirmHost pending onCancel={onCancel} />);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    const action = within(dialog).getByRole('button', { name: 'Working…' });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute('aria-busy', 'true');
    // Dispatched on the dialog itself: with both buttons disabled nothing inside
    // holds focus, and a key sent to the page would prove nothing.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('announces a refusal inside the dialog', async () => {
    const { dialog } = await openMuiConfirm(
      <MuiConfirmHost error="The record changed meanwhile." />
    );
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The record changed meanwhile.');
  });

  it('confirms through the action button', async () => {
    const onConfirm = vi.fn();
    const { user, dialog } = await openMuiConfirm(<MuiConfirmHost onConfirm={onConfirm} />);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('turns the fade off under "reduce motion", and keeps it otherwise', async () => {
    const original = window.matchMedia;
    try {
      window.matchMedia = reducedMotionAnswer(true);
      const reduced = await openMuiConfirm(<MuiConfirmHost />);
      const still = document.querySelector('.MuiDialog-container') as HTMLElement;
      await waitFor(() => expect(still.style.transition).toMatch(/opacity 0ms/));
      await reduced.user.keyboard('{Escape}');
      cleanup();

      window.matchMedia = reducedMotionAnswer(false);
      await openMuiConfirm(<MuiConfirmHost />);
      const moving = document.querySelector('.MuiDialog-container') as HTMLElement;
      await waitFor(() => expect(moving.style.transition).toMatch(/opacity [1-9]\d*ms/));
    } finally {
      window.matchMedia = original;
    }
  });

  it.each(BOTH_DIRECTIONS)('has no axe violations in %s', async (locale) => {
    const catalogue = getMessages(locale);
    inFoundation(
      <MuiConfirmDialog
        open
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        messages={catalogue}
        title={catalogue['workingContext.discard.title']}
        description={catalogue['workingContext.discard.description']}
        confirmLabel={catalogue['workingContext.discard.confirm']}
        destructive
      />,
      locale
    );
    const dialog = await screen.findByRole('alertdialog');
    const results = await axe(dialog);
    expect(results.violations).toEqual([]);
  });
});

describe('the Material UI reason dialog', () => {
  function MuiReasonHost({
    onConfirm,
    destructive = false,
    reasonError,
  }: {
    readonly onConfirm: (reason: string) => void;
    readonly destructive?: boolean;
    readonly reasonError?: string;
  }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          reopen
        </button>
        <ReasonDialog
          open={open}
          onCancel={() => setOpen(false)}
          onConfirm={(reason) => {
            onConfirm(reason);
            setOpen(false);
          }}
          messages={messages}
          title="Refuse this"
          reasonLabel="Reason"
          confirmLabel="Refuse"
          destructive={destructive}
          reasonError={reasonError}
        />
      </>
    );
  }

  it('opens on the reason box, because writing it is the next thing to do', async () => {
    inFoundation(<MuiReasonHost onConfirm={vi.fn()} />);
    const box = await screen.findByRole('textbox', { name: /Reason/ });
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it('opens on Cancel instead when the action is destructive', async () => {
    inFoundation(<MuiReasonHost onConfirm={vi.fn()} destructive />);
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    );
  });

  it('refuses an empty or whitespace-only reason, and keeps the action disabled', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    inFoundation(<MuiReasonHost onConfirm={onConfirm} />);
    const action = await screen.findByRole('button', { name: 'Refuse' });
    expect(action).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), '    ');
    expect(action).toBeDisabled();
    await user.click(action);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('marks the box itself when the reason is left empty — a field error, not a page one', async () => {
    const user = userEvent.setup();
    inFoundation(<MuiReasonHost onConfirm={vi.fn()} />);
    const box = await screen.findByRole('textbox', { name: /Reason/ });
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(box).toHaveAttribute('aria-required', 'true');
    expect(box).not.toHaveAttribute('required');
    await user.click(box);
    await user.tab();
    await waitFor(() => expect(box).toHaveAttribute('aria-invalid', 'true'));
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('A reason is required.');
    expect(box.getAttribute('aria-describedby') ?? '').toContain(error.id);
    expect(box).toHaveAttribute('aria-errormessage', error.id);
  });

  it("draws the server's refusal of the reason on the same box", async () => {
    inFoundation(<MuiReasonHost onConfirm={vi.fn()} reasonError="Keep the reason shorter." />);
    const box = await screen.findByRole('textbox', { name: /Reason/ });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Keep the reason shorter.');
  });

  it('sends the reason trimmed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    inFoundation(<MuiReasonHost onConfirm={onConfirm} />);
    await user.type(
      await screen.findByRole('textbox', { name: /Reason/ }),
      '  parts unavailable  '
    );
    await user.click(screen.getByRole('button', { name: 'Refuse' }));
    expect(onConfirm).toHaveBeenCalledWith('parts unavailable');
  });

  it('forgets the reason when it closes: the next one starts empty', async () => {
    const user = userEvent.setup();
    inFoundation(<MuiReasonHost onConfirm={vi.fn()} />);
    await user.type(await screen.findByRole('textbox', { name: /Reason/ }), 'first reason');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'reopen' }));
    expect(await screen.findByRole('textbox', { name: /Reason/ })).toHaveValue('');
  });

  it('traps Tab across the box and both buttons', async () => {
    const user = userEvent.setup();
    inFoundation(<MuiReasonHost onConfirm={vi.fn()} />);
    const dialog = await screen.findByRole('alertdialog');
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'late');
    for (let index = 0; index < 6; index += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `escaped after ${index + 1} tabs`).toBe(true);
    }
  });
});
