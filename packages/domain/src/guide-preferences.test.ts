import { expect, it } from 'vitest';
import { DEFAULT_GUIDE_PREFERENCES, GUIDE_CARD_STYLES, readGuidePreferences } from './preferences.ts';

it('accepts bounded presentation copies and rejects malformed values without coercion', () => {
  for (const cardOpacity of [0, 28, 100]) expect(readGuidePreferences({ ...DEFAULT_GUIDE_PREFERENCES, cardOpacity })?.cardOpacity).toBe(cardOpacity);
  for (const cardStyle of GUIDE_CARD_STYLES) expect(readGuidePreferences({ ...DEFAULT_GUIDE_PREFERENCES, cardStyle })?.cardStyle).toBe(cardStyle);
  for (const value of [null, [], {}, { ...DEFAULT_GUIDE_PREFERENCES, cardStyle: 'url(evil)' }, { ...DEFAULT_GUIDE_PREFERENCES, cardStyle: 'Forest' }, { ...DEFAULT_GUIDE_PREFERENCES, cardOpacity: -1 }, { ...DEFAULT_GUIDE_PREFERENCES, cardOpacity: 101 }, { ...DEFAULT_GUIDE_PREFERENCES, cardOpacity: '50' }, { ...DEFAULT_GUIDE_PREFERENCES, images: 1 }, { ...DEFAULT_GUIDE_PREFERENCES, layout: { toString: () => 'guide' } }, { ...DEFAULT_GUIDE_PREFERENCES, extra: 'url(evil)' }]) expect(readGuidePreferences(value)).toBeNull();
});
