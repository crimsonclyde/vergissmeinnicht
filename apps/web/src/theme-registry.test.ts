import { THEME_REGISTRY } from '@vergissmeinnicht/domain';
import { describe, expect, it } from 'vitest';
import { resolveTheme, THEME_MODES, THEMES } from './theme.ts';

describe('theme registry in the web app (45.4)', () => {
  it('resolves every registry theme to a theme with its own style, in light and dark device mode', () => {
    for (const theme of THEME_REGISTRY) for (const dark of [false, true]) expect(THEMES).toContain(resolveTheme(theme.id, dark));
  });
  it('offers every registry theme except the `dark` alias in the picker', () => {
    expect(THEME_MODES).toEqual(THEME_REGISTRY.map((theme) => theme.id).filter((id) => id !== 'dark'));
  });
});
