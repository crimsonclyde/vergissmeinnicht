import type { ReactNode } from 'react';
import type { ProcedureIcon as IconKey } from './api.ts';
import { t, type MessageKey } from './i18n/index.ts';

/**
 * Artwork for icons without a fitting emoji (drawn in the colourful emoji style; decorative — the
 * label comes from `iconLabel`). Gas is a gas bottle: a flame would read as fire.
 */
const GasArt = () => (
  <svg className="icon-art" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect x="11" y="1.5" width="10" height="3" rx="1.5" fill="#5b6570" />
    <rect x="14" y="4" width="4" height="5" fill="#7b8794" />
    <rect x="7.5" y="8.5" width="17" height="22" rx="6.5" fill="#2f7fd0" stroke="#1d4f82" strokeWidth="1.5" />
    <rect x="8.3" y="15" width="15.4" height="4" fill="#e8eef5" />
    <path d="M11 24.5h10" stroke="#1d4f82" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ChimneyArt = () => (
  <svg className="icon-art" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <circle cx="21.5" cy="6" r="2.4" fill="#9aa3ad" />
    <circle cx="24.8" cy="3.4" r="1.9" fill="#b6bec7" />
    <circle cx="18.6" cy="3" r="1.4" fill="#b6bec7" />
    <rect x="18" y="10" width="7" height="12" fill="#b5523b" />
    <path d="M18 14h7M18 18h7M21.5 10v4M20 14v4M23 14v4M21.5 18v4" stroke="#7d3424" strokeWidth="0.8" />
    <rect x="17" y="8.5" width="9" height="2.5" rx="0.6" fill="#7d3424" />
    <rect x="6" y="23" width="20" height="7.5" fill="#ecd9b4" stroke="#8a6a4a" strokeWidth="1" />
    <path d="M2.5 25 16 13l13.5 12Z" fill="#6b4a3a" stroke="#4a3126" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

/** Artwork for every trusted icon key; the text label (what screen readers announce) is `iconLabel`. */
export const ICON_GLYPHS: Record<IconKey, ReactNode> = {
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
  gas: <GasArt />,
  heating: '🌡️',
  chimney: <ChimneyArt />,
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
  { name: 'iconGroup.utilities', icons: ['power', 'water', 'gas', 'heating', 'chimney', 'internet', 'wifi', 'lights', 'trash', 'recycling'] },
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
