import { PROCEDURE_ICONS } from '@vergissmeinnicht/domain';
import { describe, expect, it } from 'vitest';
import { hasMessage } from './i18n/index.ts';
import { SUGGESTED_ICONS } from './IconPicker.tsx';
import { ICON_GLYPHS, ICON_GROUPS } from './procedure-icons.tsx';

describe('icons', () => {
  it('have artwork and a name, and every icon is in exactly one picker group', () => {
    for (const icon of PROCEDURE_ICONS) {
      expect(ICON_GLYPHS[icon], icon).toBeTruthy();
      expect(hasMessage(`icon.${icon}`), icon).toBe(true);
    }
    const grouped = ICON_GROUPS.flatMap((group) => group.icons);
    expect([...grouped].sort()).toEqual([...PROCEDURE_ICONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('includes the utilities and people icons asked for', () => {
    for (const icon of ['power', 'water', 'gas', 'internet', 'onboarding', 'offboarding'] as const) expect(PROCEDURE_ICONS).toContain(icon);
  });

  it('suggests a few distinct, existing icons first (13.16)', () => {
    expect(SUGGESTED_ICONS.length).toBeGreaterThanOrEqual(6);
    expect(SUGGESTED_ICONS.length).toBeLessThanOrEqual(10);
    expect(new Set(SUGGESTED_ICONS).size).toBe(SUGGESTED_ICONS.length);
    for (const icon of SUGGESTED_ICONS) expect(PROCEDURE_ICONS).toContain(icon);
  });
});
