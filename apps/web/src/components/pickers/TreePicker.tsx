'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import {
  FieldHelper,
  useFieldWiring,
  type MuiFieldBaseProps,
} from '@/components/forms/mui/field-wiring';

/**
 * One record chosen from a GENUINE hierarchy — the MUI X Community tree view
 * (`@mui/x-tree-view`, MIT) with the `FieldFrame` contract (ADR-022: "use only
 * for genuine hierarchy"). Nothing from the commercial tree package is used: no
 * drag and drop, no lazy loading, no virtualisation.
 *
 * ## What it is for
 *
 * A taxonomy whose rows name their parent — the service categories
 * (`svc.service_categories.parent_category_id`, with a cycle guard in the
 * database) — read whole by the caller and handed over as a flat list. The tree
 * is drawn from that list and nothing else: it never fetches, filters or sorts;
 * the caller's order is the order drawn under each parent.
 *
 * ## A list the tree cannot place is still drawn
 *
 * A row whose parent is not in the list (the caller's read was capped, or the
 * parent is not visible to this reader) is drawn at the top level rather than
 * dropped, and so is any row the walk from the top never reaches. Every row the
 * caller passed can be chosen.
 *
 * ## One choice, and "none" is a choice
 *
 * Single selection. `noneLabel`, when given, is drawn first and choosing it
 * reports `''` — "any category" on a filter, "top level" on a parent. The
 * chosen row's ancestors are opened so the choice is visible, including a value
 * the caller sets later.
 *
 * ## The FieldFrame contract
 *
 * The tree is named by the label (`aria-labelledby`), described by the
 * description then the error (`aria-describedby`), carries `aria-invalid` only
 * while there is an error and `aria-required` when required — both supported on
 * the `tree` role. The error is the shared alert with a shape as well as a
 * colour. A refused form's first-invalid focus lands on the tree's focusable
 * item (`useFocusFirstInvalid` falls back to the first focusable descendant).
 * `onEdit` runs before `onChange` so a clear-on-correct form withdraws its
 * complaint on the choice.
 *
 * ## Keyboard and direction
 *
 * The tree view's own model: one tab stop, arrows move and open or close, the
 * first letter jumps, Space chooses, and Enter opens a row that has children or
 * chooses one that has none. Space on the chosen row does not unchoose it — the
 * "none" row is how a choice is lifted. Under a right-to-left theme the
 * horizontal arrows follow the page's direction. Styling is token classes only.
 */

export interface TreePickerItem {
  readonly id: string;
  /** The parent's id, or `null` for a top-level row. */
  readonly parentId: string | null;
  /** What the operator reads — a name, never an identifier. */
  readonly label: string;
}

export interface TreePickerProps extends MuiFieldBaseProps {
  readonly items: readonly TreePickerItem[];
  /** The chosen row's id, or `''` for none. */
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** Offered first; choosing it reports `''`. Omitted, nothing can be unchosen. */
  readonly noneLabel?: string | undefined;
}

/** The internal id of the "none" row. No caller id can collide: ids are uuids. */
export const TREE_NONE_ID = '__tree-picker-none__';

/** The rows under each parent, in the caller's order, and the top level. */
export function treeShape(items: readonly TreePickerItem[]): {
  readonly roots: readonly TreePickerItem[];
  readonly children: ReadonlyMap<string, readonly TreePickerItem[]>;
} {
  const known = new Set(items.map((item) => item.id));
  const children = new Map<string, TreePickerItem[]>();
  const roots: TreePickerItem[] = [];
  for (const item of items) {
    if (item.parentId === null || !known.has(item.parentId) || item.parentId === item.id) {
      roots.push(item);
      continue;
    }
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  // Whatever the walk from the top cannot reach (a cycle the list carries) is
  // drawn at the top level too, so every row can still be chosen.
  const reached = new Set<string>();
  const walk = (item: TreePickerItem) => {
    if (reached.has(item.id)) return;
    reached.add(item.id);
    for (const child of children.get(item.id) ?? []) walk(child);
  };
  roots.forEach(walk);
  for (const item of items) {
    if (!reached.has(item.id)) {
      roots.push(item);
      walk(item);
    }
  }
  return { roots, children };
}

/** The ids of a row's ancestors, nearest first; empty for an unknown or top-level row. */
export function ancestorsOf(items: readonly TreePickerItem[], id: string): readonly string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const found: string[] = [];
  let current = byId.get(id)?.parentId ?? null;
  while (current !== null && current !== id && byId.has(current) && !found.includes(current)) {
    found.push(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return found;
}

export function TreePicker({
  label,
  description,
  error,
  required,
  disabled,
  readOnly,
  describedBy,
  onEdit,
  testId,
  items,
  value,
  onChange,
  noneLabel,
}: TreePickerProps) {
  const wiring = useFieldWiring(description, error, describedBy);
  const labelId = `${wiring.controlId}-label`;
  const shape = useMemo(() => treeShape(items), [items]);
  const locked = Boolean(disabled || readOnly);

  const [expanded, setExpanded] = useState<readonly string[]>(() => ancestorsOf(items, value));
  // A value the caller sets later — or rows that arrive after it — opens the
  // choice's ancestors too. Adjusted during render, React's shape for "follow
  // a prop"; what the operator opened stays open.
  const followKey = `${value}|${items.length}`;
  const [followed, setFollowed] = useState(followKey);
  if (followed !== followKey) {
    setFollowed(followKey);
    const wanted = ancestorsOf(items, value).filter((id) => !expanded.includes(id));
    if (wanted.length > 0) setExpanded([...expanded, ...wanted]);
  }

  const selected = value === '' ? (noneLabel === undefined ? null : TREE_NONE_ID) : value;

  const render = (item: TreePickerItem): ReactNode => (
    <TreeItem
      key={item.id}
      itemId={item.id}
      label={<bdi>{item.label}</bdi>}
      disabled={locked}
      data-testid={testId ? `${testId}-item` : undefined}
    >
      {(shape.children.get(item.id) ?? []).map(render)}
    </TreeItem>
  );

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <span id={labelId} className="text-label font-medium text-text-primary">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-1 text-error">
            *
          </span>
        ) : null}
      </span>
      <SimpleTreeView
        id={wiring.controlId}
        aria-labelledby={labelId}
        aria-describedby={wiring.describedBy}
        aria-errormessage={wiring.errorId}
        aria-invalid={wiring.invalid || undefined}
        aria-required={required || undefined}
        className={`rounded-md border bg-surface p-2 ${wiring.invalid ? 'border-error' : 'border-border'}`}
        selectedItems={selected}
        onSelectedItemsChange={(_event, next) => {
          if (locked || next === null) return;
          onEdit?.();
          onChange(next === TREE_NONE_ID ? '' : next);
        }}
        expandedItems={[...expanded]}
        onExpandedItemsChange={(_event, next) => setExpanded(next)}
      >
        {noneLabel === undefined ? null : (
          <TreeItem itemId={TREE_NONE_ID} label={noneLabel} disabled={locked} />
        )}
        {shape.roots.map(render)}
      </SimpleTreeView>
      {description || error ? (
        <div className="text-supporting">
          <FieldHelper description={description} error={error} wiring={wiring} />
        </div>
      ) : null}
    </div>
  );
}
