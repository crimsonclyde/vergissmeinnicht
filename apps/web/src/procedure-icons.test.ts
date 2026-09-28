import { PROCEDURE_ICONS } from '@vergissmeinnicht/domain';
import { describe, expect, it } from 'vitest';
import { hasMessage } from './i18n/index.ts';
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
});
