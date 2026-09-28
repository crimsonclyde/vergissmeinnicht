import type { ProcedureIcon as IconKey } from './api.ts';
import { t, type MessageKey } from './i18n/index.ts';

/** Glyph for every trusted icon key; the text label (what screen readers announce) is `iconLabel`. */
export const ICON_GLYPHS: Record<IconKey, string> = {
  checklist: '☑️',
  home: '🏠',
  kitchen: '🍳',
  cleaning: '🧹',
  laundry: '🧺',
  garden: '🌱',
  pet: '🐾',
  car: '🚗',
  travel: '🧳',
  tools: '🛠️',
  health: '🩺',
  shopping: '🛒',
  document: '📄',
  security: '🔒',
  star: '⭐',
  power: '⚡',
  water: '💧',
  gas: '🔥',
  heating: '🌡️',
  internet: '🌐',
  wifi: '📶',
  lights: '💡',
  trash: '🗑️',
  recycling: '♻️',
  door: '🚪',
  window: '🪟',
  key: '🔑',
  plant: '🪴',
  bed: '🛏️',
  bath: '🛁',
  onboarding: '🤝',
  offboarding: '👋',
  team: '👥',
  work: '💼',
  calendar: '📅',
  mail: '✉️',
  phone: '📱',
  school: '🎒',
  computer: '💻',
  server: '🖥️',
  backup: '💾',
  update: '🔄',
  launch: '🚀',
  medication: '💊',
  baby: '🍼',
  food: '🍽️',
  coffee: '☕',
  fitness: '🏃',
  'fire-safety': '🧯',
  warning: '⚠️',
  alarm: '🔔',
  bike: '🚲',
  weather: '☂️',
  snow: '❄️',
  sun: '☀️',
  delivery: '📦',
  money: '💶',
  clock: '⏰',
  settings: '⚙️',
  camera: '📷',
};

/** Groups of the icon picker, in display order; every icon appears in exactly one group. */
export const ICON_GROUPS: readonly { readonly name: MessageKey; readonly icons: readonly IconKey[] }[] = [
  { name: 'iconGroup.general', icons: ['checklist', 'star', 'document', 'tools', 'settings', 'clock', 'calendar', 'money', 'camera'] },
  { name: 'iconGroup.utilities', icons: ['power', 'water', 'gas', 'heating', 'internet', 'wifi', 'lights', 'trash', 'recycling'] },
  { name: 'iconGroup.home', icons: ['home', 'kitchen', 'cleaning', 'laundry', 'bed', 'bath', 'door', 'window', 'key', 'garden', 'plant'] },
  { name: 'iconGroup.people', icons: ['onboarding', 'offboarding', 'team', 'work', 'mail', 'phone', 'school'] },
  { name: 'iconGroup.tech', icons: ['computer', 'server', 'backup', 'update', 'launch'] },
  { name: 'iconGroup.care', icons: ['health', 'medication', 'baby', 'pet', 'food', 'coffee', 'fitness'] },
  { name: 'iconGroup.safety', icons: ['security', 'fire-safety', 'warning', 'alarm'] },
  { name: 'iconGroup.outdoors', icons: ['car', 'bike', 'travel', 'delivery', 'shopping', 'weather', 'sun', 'snow'] },
];

export const iconLabel = (icon: IconKey): string => t(`icon.${icon}`);

export function Icon({ icon }: { icon: IconKey }) {
  return (
    <span role="img" aria-label={iconLabel(icon)} title={iconLabel(icon)}>
      {ICON_GLYPHS[icon]}
    </span>
  );
}
