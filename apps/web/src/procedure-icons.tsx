import type { ProcedureIcon as IconKey } from './api.ts';

/** Glyph plus text label for every trusted icon key; the label is what screen readers announce. */
export const ICONS: Record<IconKey, { glyph: string; label: string }> = {
  checklist: { glyph: '☑️', label: 'Checklist' },
  home: { glyph: '🏠', label: 'Home' },
  kitchen: { glyph: '🍳', label: 'Kitchen' },
  cleaning: { glyph: '🧹', label: 'Cleaning' },
  laundry: { glyph: '🧺', label: 'Laundry' },
  garden: { glyph: '🌱', label: 'Garden' },
  pet: { glyph: '🐾', label: 'Pet' },
  car: { glyph: '🚗', label: 'Car' },
  travel: { glyph: '🧳', label: 'Travel' },
  tools: { glyph: '🛠️', label: 'Tools' },
  health: { glyph: '🩺', label: 'Health' },
  shopping: { glyph: '🛒', label: 'Shopping' },
  document: { glyph: '📄', label: 'Document' },
  security: { glyph: '🔒', label: 'Security' },
  star: { glyph: '⭐', label: 'Star' },
};

export function Icon({ icon }: { icon: IconKey }) {
  return (
    <span role="img" aria-label={ICONS[icon].label} title={ICONS[icon].label}>
      {ICONS[icon].glyph}
    </span>
  );
}
