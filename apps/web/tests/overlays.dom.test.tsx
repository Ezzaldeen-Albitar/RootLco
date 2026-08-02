import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
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
import { getMessages } from '@/i18n/get-messages';
import { BOTH_DIRECTIONS, renderLtr } from './render';

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
  it('announces politely from a region that already exists', () => {
    // The region is rendered even when empty. A live region created at the
    // moment a message appears is silent — screen readers announce changes
    // WITHIN an existing region.
    const { rerender } = renderLtr(
      <ToastRegion messages={messages} toasts={[]} onDismiss={vi.fn()} />
    );
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toHaveAttribute('aria-live', 'polite');

    rerender(
      <ToastRegion
        messages={messages}
        toasts={[{ id: '1', tone: 'success', title: 'Saved' }]}
        onDismiss={vi.fn()}
      />
    );
    expect(region).toHaveTextContent('Saved');
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
