import { describe, expect, it } from 'vitest';
import css from './styles.css?raw';
import scene from './tokyo-nights.css?raw';
import everyday from './everyday-themes.css?raw';
import forest from './witch-forest.css?raw';
import { PLACE_LIST } from './places/registry.ts';

/** Token values of one `selector { … }` block of the stylesheet. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no block ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1] ?? '', (m[2] ?? '').toLowerCase()]));
}

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const light = tokens(':root');
const themes = {
  light,
  dark: { ...light, ...tokens(":root[data-theme='dark']") },
  'memento-mori': { ...light, ...tokens(":root[data-theme='memento-mori']") },
  'tokyo-nights': { ...light, ...tokens(":root[data-theme='tokyo-nights']") },
  'witch-forest': { ...light, ...tokens(":root[data-theme='witch-forest']") },
  // Witch Forest's grimoire pages (the Step card, "Pick up where you left off") have their own tokens.
  'witch-forest page': { ...light, ...tokens(":root[data-theme='witch-forest'] :is(.guide-card, .today-hero)") },
};

/** Places (section 30): each country defines every token itself, for the light and the dark scheme. */
const placeThemes: Record<string, Record<string, string>> = Object.fromEntries(
  PLACE_LIST.flatMap((place) => [
    [`places-${place.id} light`, { ...place.light.tokens }],
    [`places-${place.id} dark`, { ...place.dark.tokens }],
  ]),
);
const allThemes: Record<string, Record<string, string>> = { ...themes, ...placeThemes };

/** `fg` laid over `bg` with the given opacity, as one opaque colour. */
function blend(fg: string, alpha: number, bg: string): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(channel(fg, i) * alpha + channel(bg, i) * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
}

/** [foreground, background, minimum]: 4.5 for text (WCAG AA), 3 for non-text UI such as borders and focus rings. */
const PAIRS: readonly [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-muted', 4.5],
  ['text', 'accent-soft', 4.5],
  ['text-muted', 'surface', 4.5],
  ['text-muted', 'bg', 4.5],
  ['focus', 'surface', 4.5],
  ['focus', 'bg', 4.5],
  ['accent-text', 'accent', 4.5],
  // Current tab in the header, and the brand accent in the wordmark.
  ['brand', 'surface', 3],
  ['brand', 'bg', 3],
  ['link', 'surface', 4.5],
  ['link', 'bg', 4.5],
  ['state-done-text', 'state-done', 4.5],
  // State badges: coloured text on the matching tint.
  ['state-pending', 'state-pending-bg', 4.5],
  ['state-done', 'state-done-bg', 4.5],
  ['state-skipped', 'state-skipped-bg', 4.5],
  ['state-na', 'state-na-bg', 4.5],
  // "Next" chip and critical mark on the pending colour.
  ['on-pending', 'state-pending', 4.5],
  // Press-and-hold fill behind the button label.
  ['text', 'state-done-bg', 4.5],
  // State summary text on cards.
  ['state-pending', 'surface', 4.5],
  ['state-done', 'surface', 4.5],
  ['state-skipped', 'surface', 4.5],
  // Step borders and the progress bar on the card surface.
  ['state-pending', 'surface', 3],
  ['state-done', 'surface', 3],
  ['state-skipped', 'surface', 3],
  ['state-na', 'surface', 3],
  ['state-done', 'surface-muted', 3],
  // Menus, sheets and dialogs (15.1).
  ['text', 'surface-raised', 4.5],
  ['text-muted', 'surface-raised', 4.5],
  ['text-muted', 'surface-muted', 4.5],
  ['link', 'surface-raised', 4.5],
  // Edges of controls (inputs, buttons, switches) against everything they sit on.
  ['border-strong', 'bg', 3],
  ['border-strong', 'surface', 3],
  ['border-strong', 'surface-raised', 3],
  // Destructive actions and field errors: text and outline.
  ['danger', 'bg', 4.5],
  ['danger', 'surface', 4.5],
  ['danger', 'surface-raised', 4.5],
  // Section labels and the builder's state line directly on the page.
  ['state-pending', 'bg', 4.5],
  ['state-done', 'bg', 4.5],
  ['state-skipped', 'bg', 4.5],
  // The current destination: brand mark and bar next to text on the navigation surface.
  ['brand', 'surface-raised', 3],
  // Focus ring on raised surfaces.
  ['focus', 'surface-raised', 4.5],
];

/*
 * Tokyo Nights paints a few of its own surfaces (tokyo-nights.css): the arcade card on Today, the level
 * tiles and the "all clear" card. Text on them must meet the same minimum as on the token surfaces.
 */
const TOKYO_SURFACES: readonly [string, string, number][] = [
  // Pick up where you left off: muted text, the pink eyebrow and the cyan ring numbers on the cabinet.
  ['text-muted', '#1d1446', 4.5],
  ['brand', '#1d1446', 4.5],
  ['accent', '#1d1446', 4.5],
  ['text', '#1d1446', 4.5],
  // Level tiles: text and score on the tile, finished tile.
  ['text', '#191c3c', 4.5],
  ['text-muted', '#191c3c', 4.5],
  ['text', '#0f3329', 4.5],
  ['state-done', '#0f3329', 4.5],
  // The NEXT badge: dark text on the brand pink.
  ['#14031a', 'brand', 4.5],
  // All clear and the finish screen.
  ['text', '#181443', 4.5],
  ['text-muted', '#181443', 4.5],
  ['#f4f1ff', '#1b1442', 4.5],
  // Flip-clock tiles (both flaps) and the neon date on the clock card.
  ['#f4f1ff', '#262a56', 4.5],
  ['#f4f1ff', '#1d2047', 4.5],
  ['accent', '#1b1745', 4.5],
  // The greeting on the page.
  ['#f4f1ff', 'bg', 4.5],
];

/*
 * Witch Forest paints a few surfaces itself (witch-forest.css): the stepping stones, the "all clear" and
 * clock cards, the wax seal, the darkened edges of the paper pages, and the lit part of the progress moon
 * (the text colour at 20% over whatever is below). Text on them must meet the same minimum.
 */
const forestDark = themes['witch-forest'];
const forestPage = themes['witch-forest page'];
const PAGE_EDGE = blend('#6e5424', 0.18, forestPage.bg ?? 'missing');
const WITCH_SURFACES: readonly [string, string, number, Record<string, string>][] = [
  // Stepping stones: text, muted text and the moon's numbers on the stone; a finished, mossy stone.
  ['text', '#1c2822', 4.5, forestDark],
  ['text', '#121a16', 4.5, forestDark],
  ['text-muted', '#1c2822', 4.5, forestDark],
  ['text', '#1a3324', 4.5, forestDark],
  ['state-done', '#1a3324', 4.5, forestDark],
  // The wax seal ("Next"): light text on the wine-red wax, at its lightest and its darkest.
  ['#f2e6dc', '#7a3045', 4.5, forestDark],
  ['#f2e6dc', '#431624', 4.5, forestDark],
  // All clear and the finish screen.
  ['text', '#142019', 4.5, forestDark],
  ['text-muted', '#142019', 4.5, forestDark],
  // The clock's date in lichen green.
  ['#c9d8b4', 'surface', 4.5, forestDark],
  // The progress moon: numbers on its lit part, on cards, stones and paper.
  ['text', blend(forestDark.text ?? 'missing', 0.2, forestDark.surface ?? 'missing'), 4.5, forestDark],
  ['state-done', blend(forestDark.text ?? 'missing', 0.2, forestDark.surface ?? 'missing'), 4.5, forestDark],
  ['text', blend(forestDark.text ?? 'missing', 0.2, '#1c2822'), 4.5, forestDark],
  ['text', blend(forestPage.text ?? 'missing', 0.2, forestPage.bg ?? 'missing'), 4.5, forestPage],
  // Paper pages: ink at the darkened edges of the page, and on the paper's lighter top.
  ['text', PAGE_EDGE, 4.5, forestPage],
  ['text-muted', PAGE_EDGE, 4.5, forestPage],
  ['text-muted', '#e4dabd', 4.5, forestPage],
  ['accent', PAGE_EDGE, 4.5, forestPage],
];

describe('theme contrast (WCAG AA)', () => {
  it('witch-forest: text on the surfaces the preset paints itself meets its minimum', () => {
    expect(forest).toContain('rgb(110 84 36 / 18%)');
    expect(forest).toContain('color-mix(in srgb, var(--text) 20%, transparent)');
    // The fixed colours must still be the ones in the stylesheet, or this check would test nothing.
    for (const fixed of ['#1c2822', '#121a16', '#1a3324', '#f2e6dc', '#7a3045', '#431624', '#142019', '#c9d8b4', '#e4dabd']) expect(forest).toContain(fixed);
    const failures = WITCH_SURFACES.flatMap(([fg, bg, min, values]) => {
      const colour = (key: string): string => (key.startsWith('#') ? key : (values[key] ?? 'missing'));
      const ratio = contrast(colour(fg), colour(bg));
      return ratio >= min ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`];
    });
    expect(failures).toEqual([]);
  });

  it('tokyo-nights: text on the surfaces the preset paints itself meets its minimum', () => {
    const values = themes['tokyo-nights'];
    const colour = (key: string): string => (key.startsWith('#') ? key : (values[key] ?? 'missing'));
    const failures = TOKYO_SURFACES.flatMap(([fg, bg, min]) => {
      // The fixed colours must still be the ones in the stylesheet, or this check would test nothing.
      for (const fixed of [fg, bg].filter((key) => key.startsWith('#'))) if (!scene.includes(fixed)) return [`${fixed} is no longer in tokyo-nights.css`];
      const ratio = contrast(colour(fg), colour(bg));
      return ratio >= min ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`];
    });
    expect(failures).toEqual([]);
  });

  it('places: every country defines every token of the stylesheet, as #rrggbb, in both schemes', () => {
    for (const place of PLACE_LIST) {
      for (const scheme of [place.light, place.dark]) {
        expect(Object.keys(scheme.tokens).sort()).toEqual(Object.keys(light).sort());
        for (const value of [...Object.values(scheme.tokens), ...scheme.gradient]) expect(value).toMatch(/^#[0-9a-f]{6}$/);
        // Errors, warnings and success keep their established meaning: the same hue family as the fixed themes.
        expect(scheme.tokens.danger).not.toBe(scheme.tokens.accent);
      }
    }
  });

  it('reads every theme token block from the stylesheet, each complete', () => {
    expect(Object.keys(light).length).toBeGreaterThanOrEqual(24);
    // Presets must define every colour token themselves (no accidental fallback to light values).
    for (const selector of [":root[data-theme='dark']", ":root[data-theme='memento-mori']", ":root[data-theme='tokyo-nights']", ":root[data-theme='witch-forest']", ":root[data-theme='witch-forest'] :is(.guide-card, .today-hero)"]) {
      expect(Object.keys(tokens(selector)).sort()).toEqual(Object.keys(light).sort());
    }
  });

  for (const [name, values] of Object.entries(allThemes)) {
    it(`${name}: every text/background and UI pair meets its minimum`, () => {
      const failures = PAIRS.flatMap(([fg, bg, min]) => {
        const a = values[fg];
        const b = values[bg];
        if (a === undefined || b === undefined) return [`${fg} on ${bg}: missing token`];
        const ratio = contrast(a, b);
        return ratio >= min ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`];
      });
      expect(failures).toEqual([]);
    });
  }

  it('everyday themes: text and controls retain contrast on the tinted page corners', () => {
    expect(everyday).toContain('color-mix(in srgb, var(--brand) 6%, transparent)');
    for (const name of ['light', 'dark', 'memento-mori'] as const) {
      const values = themes[name];
      const tinted = blend(values.brand ?? '', 0.06, values.bg ?? '');
      for (const [foreground, background, minimum] of PAIRS.filter(([, background]) => background === 'bg')) {
        expect(contrast(values[foreground] ?? '', tinted), `${name}: ${foreground} on tinted ${background}`).toBeGreaterThanOrEqual(minimum);
      }
    }
  });

  it('everyday themes: line art and icons are readable on their soft surfaces', () => {
    for (const name of ['light', 'dark', 'memento-mori'] as const) {
      const values = themes[name];
      expect(contrast(values.brand ?? '', values['accent-soft'] ?? '')).toBeGreaterThanOrEqual(3);
    }
  });

  it('separates the surfaces of each theme from the page and from each other', () => {
    for (const values of Object.values(allThemes)) {
      expect(new Set([values.bg, values.surface, values['surface-muted'], values['surface-raised']]).size).toBeGreaterThanOrEqual(3);
      expect(values.surface).not.toBe(values.bg);
      // A primary (accent) button and a destructive (danger) one never look the same: different colour, and danger is an outline.
      expect(values.danger).not.toBe(values.accent);
    }
  });

  it('keeps the four Step states distinguishable from each other, not only by hue', () => {
    // Different glyph + text already carry the meaning; the colours must still differ visibly.
    for (const values of Object.values(allThemes)) {
      const states = ['state-pending', 'state-done', 'state-skipped', 'state-na'].map((key) => values[key] ?? '');
      expect(new Set(states).size).toBe(4);
    }
  });
});
