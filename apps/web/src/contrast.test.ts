import { describe, expect, it } from 'vitest';
import css from './styles.css?raw';

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
const themes = { light, dark: { ...light, ...tokens(":root[data-theme='dark']") } };

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
  ['state-done-text', 'state-done', 4.5],
  // State badges: coloured text on the matching tint.
  ['state-pending', 'state-pending-bg', 4.5],
  ['state-done', 'state-done-bg', 4.5],
  ['state-skipped', 'state-skipped-bg', 4.5],
  ['state-na', 'state-na-bg', 4.5],
  // "Next" chip label on the pending colour.
  ['accent-text', 'state-pending', 4.5],
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
];

describe('theme contrast (WCAG AA)', () => {
  it('reads both token blocks from the stylesheet', () => {
    expect(Object.keys(light).length).toBeGreaterThanOrEqual(19);
    expect(Object.keys(tokens(":root[data-theme='dark']")).length).toBeGreaterThanOrEqual(19);
  });

  for (const [name, values] of Object.entries(themes)) {
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

  it('keeps the four Step states distinguishable from each other, not only by hue', () => {
    // Different glyph + text already carry the meaning; the colours must still differ visibly.
    for (const values of Object.values(themes)) {
      const states = ['state-pending', 'state-done', 'state-skipped', 'state-na'].map((key) => values[key] ?? '');
      expect(new Set(states).size).toBe(4);
    }
  });
});
