import { describe, expect, it } from 'vitest';
import { monogram, toneOf } from './area-art.ts';

describe('area art', () => {
  it('builds a monogram of at most two letters', () => {
    expect(monogram('Marco Bianchi')).toBe('MB');
    expect(monogram('Stadtwerke')).toBe('S');
    expect(monogram('Dr. Anna Weber')).toBe('DW');
    expect(monogram('=HYPERLINK("http://evil.example")')).toBe('H');
    expect(monogram('  ')).toBe('·');
    expect(monogram('Élodie de la Tour')).toBe('ÉT');
  });
  it('keeps a word on one of five tints', () => {
    expect(toneOf('Heating')).toBe(toneOf('Heating'));
    expect(Number(toneOf('Plumber'))).toBeLessThan(5);
  });
});
