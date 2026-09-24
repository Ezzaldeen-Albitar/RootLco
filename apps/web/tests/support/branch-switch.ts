import { screen, waitFor, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { expect } from 'vitest';
import en from '../../src/i18n/messages/en.json';

/**
 * The three moves every "unsaved work and a branch switch" case makes.
 *
 * A screen declares its unsaved work with `useUnsavedGuard`; the working
 * context then ASKS before a switch would discard it. These drive a
 * `BranchSwitch` control and the shared discard question, so each screen's
 * suite states only what is particular to it: what makes the form dirty, and
 * what "kept" and "reset" look like on that form.
 */

type User = ReturnType<typeof userEvent.setup>;

const EN = en as Record<string, string>;

/** Presses the switch and returns the discard question it must raise. */
export async function switchExpectingQuestion(user: User, label: string): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: label }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText(EN['workingContext.discard.title'] as string)).toBeVisible();
  return dialog;
}

/** Answers "stay": the question closes and nothing moves. */
export async function stayOnBranch(user: User, dialog: HTMLElement): Promise<void> {
  await user.click(within(dialog).getByRole('button', { name: EN['overlay.cancel'] as string }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
}

/** Answers "discard and change branch". */
export async function discardAndSwitch(user: User, dialog: HTMLElement): Promise<void> {
  await user.click(
    within(dialog).getByRole('button', { name: EN['workingContext.discard.confirm'] as string })
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
}

/** Presses the switch and asserts no question was asked. */
export async function switchWithoutQuestion(user: User, label: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: label }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
}

/** The branch the working context holds, as the probe renders it. */
export function heldBranch(): string {
  return screen.getByTestId('working-branch-probe').textContent ?? '';
}

/**
 * Forgets the branch the provider remembered.
 *
 * The working context stores the operator's choice in browser storage, and
 * jsdom keeps that storage for the whole file. A case that ends holding a branch
 * every later snapshot still authorizes would hand that choice to the next
 * case, which then reads a list it expects to be withheld. Call it after every
 * case that switches.
 */
export function forgetRememberedBranch(): void {
  window.localStorage.clear();
}
