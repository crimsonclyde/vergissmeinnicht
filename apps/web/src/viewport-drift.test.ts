import { describe, expect, it } from 'vitest';
import { bottomDrift } from './viewport-drift.ts';

describe('bottom bar drift on iOS Safari', () => {
  it('is zero when what is visible matches the layout viewport', () => {
    expect(bottomDrift(800, { offsetTop: 0, height: 800, scale: 1 })).toBe(0);
  });

  it('measures how far the visible bottom lies below the layout bottom', () => {
    expect(bottomDrift(700, { offsetTop: 120, height: 800, scale: 1 })).toBe(220);
    expect(bottomDrift(800, { offsetTop: 24.4, height: 800, scale: 1 })).toBe(24);
  });

  it('ignores an open keyboard, rounding and zoom', () => {
    // Keyboard: the visible part is smaller, its bottom above the layout bottom.
    expect(bottomDrift(800, { offsetTop: 0, height: 480, scale: 1 })).toBe(0);
    expect(bottomDrift(800, { offsetTop: 0.4, height: 800, scale: 1 })).toBe(0);
    expect(bottomDrift(800, { offsetTop: 300, height: 400, scale: 2 })).toBe(0);
    expect(bottomDrift(800, { offsetTop: Number.NaN, height: 800, scale: 1 })).toBe(0);
  });
});
