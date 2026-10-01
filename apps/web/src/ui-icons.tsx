import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowLeft,
  IconArrowRight,
  IconBell,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDatabase,
  IconDeviceFloppy,
  IconDots,
  IconGripVertical,
  IconHistory,
  IconHome,
  IconList,
  IconListDetails,
  IconLogout,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconSettings,
  IconShoppingCart,
  IconUser,
  IconX,
} from '@tabler/icons-react';

/**
 * Icons of the app's own controls (navigation, buttons): Tabler artwork, chosen here at build time by
 * static imports. Unlike Procedure and Step icons (`procedure-icons.tsx`) they are never selected by
 * stored data. Always decorative — the control carries the text or the accessible name.
 */
const ICONS = {
  today: IconHome,
  procedures: IconListDetails,
  reminders: IconBell,
  lists: IconList,
  calendar: IconCalendar,
  history: IconHistory,
  settings: IconSettings,
  more: IconDots,
  add: IconPlus,
  back: IconArrowLeft,
  forward: IconArrowRight,
  chevron: IconChevronRight,
  expand: IconChevronDown,
  grip: IconGripVertical,
  grocery: IconShoppingCart,
  preview: IconPlayerPlay,
  save: IconDeviceFloppy,
  paste: IconCopy,
  profile: IconUser,
  server: IconDatabase,
  close: IconX,
  check: IconCheck,
  signOut: IconLogout,
  photo: IconPhoto,
  warning: IconAlertTriangle,
  undo: IconArrowBackUp,
} as const;

export type UiIconName = keyof typeof ICONS;

export function UiIcon({ name, size }: { name: UiIconName; size?: number | string }) {
  const Art = ICONS[name];
  return (
    <span className="ui-icon" aria-hidden="true">
      <Art size={size ?? '1.25em'} stroke={1.75} aria-hidden="true" focusable="false" />
    </span>
  );
}
