import type { ProcedureIcon as IconKey } from './api.ts';
import { t } from './i18n/index.ts';

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
};

export const iconLabel = (icon: IconKey): string => t(`icon.${icon}`);

export function Icon({ icon }: { icon: IconKey }) {
  return (
    <span role="img" aria-label={iconLabel(icon)} title={iconLabel(icon)}>
      {ICON_GLYPHS[icon]}
    </span>
  );
}
