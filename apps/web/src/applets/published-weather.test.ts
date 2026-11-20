import { describe, expect, it } from 'vitest';
import { pickPublishedWeather } from './PublishedWeather.tsx';

const place = { name: 'Triora', condition: 'CLEAR' as const, high: 16, low: 8, precipitationProbability: 10, precipitationMm: 0 };
const preview = { isToday: true, publishedAt: '2026-11-20T06:45:00Z', date: '2026-11-20', weather: [place] };

describe('Published Daily Planet weather (46)', () => {
  it('uses only today\'s published edition with a weather place', () => {
    expect(pickPublishedWeather('ws', preview)).toEqual({ place, date: '2026-11-20', workspaceId: 'ws' });
    expect(pickPublishedWeather('ws', null)).toBeNull();
    expect(pickPublishedWeather('ws', { ...preview, publishedAt: null })).toBeNull();
    expect(pickPublishedWeather('ws', { ...preview, isToday: false })).toBeNull();
    expect(pickPublishedWeather('ws', { ...preview, weather: [] })).toBeNull();
  });

  it('skips a place without temperatures rather than showing an empty reading', () => {
    const empty = { ...place, name: 'Nowhere', high: null, low: null };
    expect(pickPublishedWeather('ws', { ...preview, weather: [empty, place] })?.place.name).toBe('Triora');
    expect(pickPublishedWeather('ws', { ...preview, weather: [empty] })).toBeNull();
  });
});
