import { describe, expect, it } from 'vitest';
import { DomainValidationError } from './errors.ts';
import {
  assertGazetteDateWritable, defaultGazetteSettings, gazetteOldestKept, gazettePreview, gazetteSectionsOf, gazetteToday, parseGazetteEdition, parseGazetteSettings, visibleGazetteSections,
  type GazetteEdition, type GazetteSettings,
} from './gazette.ts';
import { sampleGazetteEdition } from './gazette-sample.ts';
import type { LocalDate, TimeZoneName } from './schedule.ts';

const settings = defaultGazetteSettings('Europe/Rome' as TimeZoneName);
const failure = (action: () => unknown) => { try { action(); } catch (error) { if (error instanceof DomainValidationError) return { field: error.field, code: error.code }; throw error; } throw new Error('accepted'); };
const edition = (content = parseGazetteEdition(sampleGazetteEdition('2026-11-14'), settings.sections), date = '2026-11-14'): GazetteEdition =>
  ({ id: 'e1', date: date as LocalDate, state: 'PUBLISHED', title: content.title, revision: 1, publishedAt: new Date(), updatedAt: new Date(), updatedBy: 'Clyde', content });

describe('Gazette settings', () => {
  it('round-trips the defaults and keeps section ids stable when titles change', () => {
    const parsed = parseGazetteSettings(JSON.parse(JSON.stringify(settings)));
    expect(parsed).toEqual(settings);
    const renamed = parseGazetteSettings({ ...settings, sections: settings.sections.map(s => s.id === 'liguria' ? { ...s, title: 'Liguria oggi' } : s) });
    expect(renamed.sections.find(s => s.id === 'liguria')?.title).toBe('Liguria oggi');
  });
  it('refuses duplicate ids, unknown types, bad retention and unknown fields', () => {
    expect(failure(() => parseGazetteSettings({ ...settings, sections: [...settings.sections, settings.sections[0]] })).code).toBe('gazette_duplicate_id');
    expect(failure(() => parseGazetteSettings({ ...settings, sections: [{ id: 'x', type: 'stocks', title: 'X' }] })).field).toBe('settings.sections[0].type');
    expect(failure(() => parseGazetteSettings({ ...settings, retentionDays: 0 })).field).toBe('settings.retentionDays');
    expect(failure(() => parseGazetteSettings({ ...settings, retentionDays: 32 })).field).toBe('settings.retentionDays');
    expect(failure(() => parseGazetteSettings({ ...settings, timeZone: 'Mars/Olympus' })).field).toBe('settings.timeZone');
    expect(failure(() => parseGazetteSettings({ ...settings, extra: 1 })).code).toBe('gazette_unknown_field');
  });
  it('lets a new topic be a new section of an existing type, with defaults filled in', () => {
    const next = parseGazetteSettings({ ...settings, sections: [...settings.sections, { id: 'astronomy', type: 'articles', title: 'Sky tonight' }] });
    expect(next.sections.at(-1)).toMatchObject({ id: 'astronomy', icon: 'news', enabled: true, language: 'en', dashboard: true, collapsed: false, sources: [] });
  });
});

describe('Gazette editions', () => {
  it('accepts the sample edition and normalizes it', () => {
    const content = parseGazetteEdition(sampleGazetteEdition('2026-11-14'), settings.sections);
    expect(content.sections).toHaveLength(6);
    const weather = content.sections[0];
    if (weather?.type !== 'weather') throw new Error('weather first');
    expect(weather.locations[0]?.days[3]).toMatchObject({ precipitationMm: { min: 4, max: 22 }, disagreement: true });
    expect(parseGazetteEdition(JSON.parse(JSON.stringify(content)), settings.sections)).toEqual(content);
    expect(parseGazetteEdition(content, gazetteSectionsOf(content))).toEqual(content);
  });
  it('refuses unknown sections and mismatched renderer types instead of guessing', () => {
    const sample = sampleGazetteEdition('2026-11-14');
    expect(failure(() => parseGazetteEdition({ ...sample, sections: [{ sectionId: 'sports', type: 'articles', items: [] }] }, settings.sections)).code).toBe('gazette_unknown_section');
    expect(failure(() => parseGazetteEdition({ ...sample, sections: [{ sectionId: 'liguria', type: 'rich', body: 'x' }] }, settings.sections)).code).toBe('gazette_section_type_mismatch');
    expect(failure(() => parseGazetteEdition({ ...sample, version: 2 }, settings.sections)).code).toBe('gazette_unsupported_version');
  });
  it('refuses HTML, unsafe links, duplicate stories and missing sources, naming the path', () => {
    const sample = sampleGazetteEdition('2026-11-14');
    const tech = (items: unknown[]) => ({ ...sample, sections: [{ sectionId: 'it-open-source', type: 'articles', items }] });
    const story = sample.sections[1]?.items?.[0] as Record<string, unknown>;
    expect(failure(() => parseGazetteEdition({ ...sample, intro: 'Hi <script>alert(1)</script>' }, settings.sections))).toEqual({ field: 'edition.intro', code: 'gazette_html_not_allowed' });
    for (const url of ['http://example.org/a', 'javascript:alert(1)', 'https://user:pw@example.org/', 'https://localhost/x', 'https://exa mple.org', 'https://example.org\\@evil.org'])
      expect(failure(() => parseGazetteEdition(tech([{ ...story, url }]), settings.sections))).toEqual({ field: 'edition.sections[0].items[0].url', code: 'gazette_invalid_url' });
    expect(failure(() => parseGazetteEdition(tech([story, { ...story, id: 'other' }]), settings.sections)).code).toBe('gazette_duplicate_article');
    expect(failure(() => parseGazetteEdition(tech([{ ...story, publishedAt: 'yesterday' }]), settings.sections)).code).toBe('gazette_invalid_time');
    const weather = sample.sections[0] as { locations: Record<string, unknown>[] };
    expect(failure(() => parseGazetteEdition({ ...sample, sections: [{ ...weather, locations: [{ ...weather.locations[0], sources: [] }] }] }, settings.sections)).code).toBe('gazette_source_required');
  });
  it('refuses watch prices without the time they were checked', () => {
    const sample = sampleGazetteEdition('2026-11-14');
    const item = { id: 'p', name: 'Kettle', currency: 'EUR', change: 'new', verified: true, price: 20 };
    expect(failure(() => parseGazetteEdition({ ...sample, sections: [{ sectionId: 'watchlist', type: 'watchlist', items: [item] }] }, settings.sections)).field).toBe('edition.sections[0].items[0].checkedAt');
  });
});

describe('Gazette dates, retention and the Dashboard preview', () => {
  it('uses the Gazette time zone for today and keeps exactly seven days including today', () => {
    const late = new Date('2026-11-14T23:30:00Z');
    expect(gazetteToday({ timeZone: 'Europe/Rome' as TimeZoneName }, late)).toBe('2026-11-15');
    expect(gazetteToday({ timeZone: 'UTC' as TimeZoneName }, late)).toBe('2026-11-14');
    expect(gazetteOldestKept({ timeZone: 'UTC' as TimeZoneName, retentionDays: 7 }, late)).toBe('2026-11-08');
    expect(gazetteOldestKept({ timeZone: 'UTC' as TimeZoneName, retentionDays: 1 }, late)).toBe('2026-11-14');
  });
  it('allows writing for kept days and tomorrow only', () => {
    const now = new Date('2026-11-14T08:00:00Z'); const utc = { timeZone: 'UTC' as TimeZoneName, retentionDays: 7 };
    for (const ok of ['2026-11-08', '2026-11-14', '2026-11-15']) expect(() => assertGazetteDateWritable(utc, ok as LocalDate, now)).not.toThrow();
    for (const bad of ['2026-11-07', '2026-11-16']) expect(failure(() => assertGazetteDateWritable(utc, bad as LocalDate, now)).code).toBe('gazette_date_out_of_range');
  });
  it('shows sections in the settings order, hiding disabled ones', () => {
    const reordered: GazetteSettings = { ...settings, sections: [...settings.sections].reverse().map(s => s.id === 'liguria' ? { ...s, enabled: false } : s) };
    expect(visibleGazetteSections(edition().content, reordered).map(s => s.definition.id)).toEqual(['watchlist', 'good-news', 'europe-world', 'it-open-source', 'weather']);
  });
  it('builds a compact preview, one headline per section first, and never shows an old forecast as today', () => {
    const today = gazettePreview(edition(), settings, '2026-11-14' as LocalDate);
    expect(today).toMatchObject({ isToday: true, sectionCount: 6, priceDrops: 1 });
    expect(today.headlines.map(h => h.sectionId)).toEqual(['it-open-source', 'liguria', 'europe-world', 'good-news']);
    expect(today.weather).toEqual([{ name: 'Triora', condition: 'CLEAR', high: 16, low: 8 }, { name: 'Göggenhofen', condition: 'FOG', high: 6, low: 1 }]);
    const later = gazettePreview(edition(), settings, '2026-11-15' as LocalDate);
    expect(later).toMatchObject({ isToday: false, date: '2026-11-14', weather: [], greeting: '' });
  });
});
