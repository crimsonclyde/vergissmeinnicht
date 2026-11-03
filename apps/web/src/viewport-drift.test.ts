import { describe, expect, it } from 'vitest';
import { bottomDrift, keyboardInset } from './viewport-drift.ts';

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


describe('focused phone action bar above the keyboard', () => {
  it('lifts only by the obscured bottom, including a panned visual viewport', () => {
    expect(keyboardInset(800, {offsetTop:0,height:480,scale:1})).toBe(320);
    expect(keyboardInset(800, {offsetTop:100,height:480,scale:1})).toBe(220);
    expect(keyboardInset(480, {offsetTop:0,height:480,scale:1})).toBe(0);
  });
  it('does not mistake Safari drift, rounding, zoom or invalid measurements for a keyboard', () => {
    expect(keyboardInset(700, {offsetTop:120,height:800,scale:1})).toBe(0);
    expect(keyboardInset(800, {offsetTop:0,height:799.6,scale:1})).toBe(0);
    expect(keyboardInset(800, {offsetTop:0,height:400,scale:2})).toBe(0);
    expect(keyboardInset(800, {offsetTop:Number.NaN,height:400,scale:1})).toBe(0);
  });
});
