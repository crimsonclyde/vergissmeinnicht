import { describe, expect, it } from 'vitest';
import { panelShift } from './MoreMenu.tsx';

describe('menu panel placement', () => {
  it('leaves a panel inside the viewport where it is', () => {
    expect(panelShift(100, 300, 390)).toBe(0);
  });
  it('moves a panel that opens past the left edge back on screen', () => {
    expect(panelShift(-150, 180, 390)).toBe(158);
  });
  it('moves a panel that opens past the right edge back on screen', () => {
    expect(panelShift(200, 420, 390)).toBe(-38);
  });
  it('keeps the left edge visible when the panel is wider than the viewport', () => {
    expect(panelShift(20, 500, 390)).toBe(-12);
  });
});
