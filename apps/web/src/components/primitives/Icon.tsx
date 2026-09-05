import type { IconName } from '@/config/navigation';

/**
 * The icon set.
 *
 * Drawn here as plain paths on a 24×24 grid rather than pulled from an icon
 * package or traced from the design reference. Two reasons, in order of
 * importance: the reference shot's icons are the designer's property and are
 * explicitly out of scope, and an icon dependency is a runtime dependency that
 * ships to every browser for the sake of fifteen glyphs.
 *
 * `currentColor` throughout, so an icon inherits the colour of the thing it
 * sits in and never needs a colour token of its own.
 *
 * Icons are DECORATIVE by default (`aria-hidden`) because they accompany a text
 * label everywhere they are used. When one must stand alone — an icon-only
 * button — the accessible name belongs on the BUTTON, not here; a `<title>` on
 * the svg produces a tooltip the keyboard cannot reach and a name screen readers
 * announce twice.
 */

const PATHS: Record<IconName, readonly string[]> = {
  overview: ['M4 13h6V4H4v9Z', 'M14 20h6v-9h-6v9Z', 'M4 20h6v-4H4v4Z', 'M14 8h6V4h-6v4Z'],
  customers: [
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    'M2.5 19.5a6.5 6.5 0 0 1 13 0',
    'M16 11.5a3 3 0 1 0 0-6',
    'M17 14.2a5.5 5.5 0 0 1 4.5 5.3',
  ],
  vehicles: [
    'M3 13.5 4.8 8.4A2.5 2.5 0 0 1 7.2 6.7h9.6a2.5 2.5 0 0 1 2.4 1.7L21 13.5',
    'M3 13.5h18v4.2a1 1 0 0 1-1 1h-1.6a1 1 0 0 1-1-1v-.9H6.6v.9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4.2Z',
    'M6.6 16.1h.01',
    'M17.4 16.1h.01',
  ],
  // A triangle with an exclamation: "look at this and decide". Deliberately not
  // an error glyph — the detector is warning, never deciding.
  'duplicate-review': ['M12 4.4 21 19.6H3L12 4.4Z', 'M12 10.2v4', 'M12 16.7h.01'],
  appointments: [
    'M4 6.8A1.8 1.8 0 0 1 5.8 5h12.4A1.8 1.8 0 0 1 20 6.8v11.4A1.8 1.8 0 0 1 18.2 20H5.8A1.8 1.8 0 0 1 4 18.2V6.8Z',
    'M4 10h16',
    'M8.5 3.5v3',
    'M15.5 3.5v3',
    'M8.6 14.2h3',
  ],
  // A clipboard with a check: a vehicle received and its intake recorded.
  receptions: [
    'M8.8 4.6H7A1.6 1.6 0 0 0 5.4 6.2v13.2A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V6.2A1.6 1.6 0 0 0 17 4.6h-1.8',
    'M9.4 3h5.2v3.2H9.4V3Z',
    'm9 13.4 2.1 2.1 3.9-4.1',
  ],
  'work-orders': [
    'M6 3.8h8.5L19 8.3v11.9A1.8 1.8 0 0 1 17.2 22H6a1.8 1.8 0 0 1-1.8-1.8V5.6A1.8 1.8 0 0 1 6 3.8Z',
    'M14.2 3.8v4.6H19',
    'M8 12.7h7',
    'M8 16.4h4.6',
  ],
  technicians: [
    'M12 11.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z',
    'M5 20.4a7 7 0 0 1 14 0',
    'M15.6 13.8 18 11.4l2.2 2.2-2.4 2.4',
  ],
  catalog: [
    'M4 6.4A1.6 1.6 0 0 1 5.6 4.8h12.8A1.6 1.6 0 0 1 20 6.4v11.2a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 17.6V6.4Z',
    'M8 9.2h8',
    'M8 12.6h8',
    'M8 16h4.5',
  ],
  pricing: [
    'M4 4.6h7.2l8.6 8.6-7.2 7.2L4 11.8V4.6Z',
    'M8.2 8.8h.01',
    'M7.4 8.8a.8.8 0 1 0 1.6 0 .8.8 0 0 0-1.6 0Z',
  ],
  inventory: [
    'M12 3.2 20.4 7.8v8.4L12 20.8 3.6 16.2V7.8L12 3.2Z',
    'M3.6 7.8 12 12.4l8.4-4.6',
    'M12 12.4v8.4',
  ],
  billing: [
    'M5.4 3.6h13.2v16.8l-2.6-1.6-2.6 1.6-2.4-1.6-2.6 1.6-3-1.6V3.6Z',
    'M9 8.4h6',
    'M9 12.2h6',
  ],
  delivery: [
    'M2.8 7.4h10.4v8.4H2.8V7.4Z',
    'M13.2 10.4h3.6l2.8 2.9v2.5h-6.4v-5.4Z',
    'M6.6 18.6a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z',
    'M17 18.6a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z',
  ],
  documents: [
    'M6.4 3.6h7.2l4.4 4.4v12.4H6.4V3.6Z',
    'M13.4 3.6V8h4.6',
    'M9.2 12.4h5.6',
    'M9.2 16h3.6',
  ],
  notifications: [
    'M12 4a5.4 5.4 0 0 0-5.4 5.4c0 4.2-1.6 5.6-1.6 5.6h14s-1.6-1.4-1.6-5.6A5.4 5.4 0 0 0 12 4Z',
    'M10.4 18.4a1.9 1.9 0 0 0 3.2 0',
  ],
  reports: ['M4.4 19.6h15.2', 'M7.6 19.6V11', 'M12 19.6V5.6', 'M16.4 19.6v-5.4'],
  administration: [
    'M12 4.2 19.4 7v5.1c0 4-3 6.9-7.4 8-4.4-1.1-7.4-4-7.4-8V7L12 4.2Z',
    'M9.4 12.1l1.9 1.9 3.5-3.6',
  ],
  settings: [
    'M12 15.1a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z',
    'M19.2 14.1a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.5 1.1v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-2.6-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.5H4.4a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.1-2.6l-.1-.1A1.8 1.8 0 1 1 8.1 4.4l.1.1a1.5 1.5 0 0 0 2.5-1.1V3.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 2.5 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.5h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4 1Z',
  ],
  gallery: [
    'M4 6.2A1.8 1.8 0 0 1 5.8 4.4h12.4A1.8 1.8 0 0 1 20 6.2v11.6a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.8V6.2Z',
    'M4 14.6l3.8-3.4 3.4 3 3-2.6L20 15',
    'M9.2 9.2h.01',
  ],
};

export interface IconProps {
  readonly name: IconName;
  /** Rendered size in pixels. Matches the text it sits beside by default. */
  readonly size?: number;
  readonly className?: string;
}

export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Every icon the set defines. Used by the gallery and by the coverage test. */
export const ICON_NAMES = Object.freeze(Object.keys(PATHS) as IconName[]);
