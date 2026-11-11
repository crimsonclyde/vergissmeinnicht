import { describe, expect, it } from 'vitest';
import type { WeatherHour } from '@vergissmeinnicht/domain';
import { dayMoments, historyColumns, historyRuns, hourOf, rainIndication, rainSoon, shiftDate, showable, smoothPath, sourceLabel, temperature, uvLevel, uvWindow, wallTimeAt } from './weather-view.ts';

describe('weather on Today (19.4)', () => {
  it('converts only in the browser and only for display; a missing value stays missing', () => {
    expect(temperature(16.2, 'C')).toBe('16°');
    expect(temperature(16.2, 'F')).toBe('61°');
    expect(temperature(-0.4, 'C')).toBe('0°');
    expect(temperature(undefined, 'C')).toBeNull();
  });

  it('shows rain as the provider gives it — a chance where there is one, else an amount, else nothing', () => {
    expect(rainIndication({ date: '2026-10-08', precipitationProbabilityMax: 70, precipitationSum: 3.4 })).toEqual({ kind: 'probability', value: 70 });
    expect(rainIndication({ date: '2026-10-08', precipitationSum: 11.9 })).toEqual({ kind: 'amount', value: 11.9 });
    expect(rainIndication({ date: '2026-10-08' })).toBeNull();
    expect(rainIndication(undefined)).toBeNull();
  });

  it('names who supplied the forecast, with the model when one was chosen', () => {
    expect(sourceLabel('OPEN_METEO', 'best_match')).toBe('Open-Meteo');
    expect(sourceLabel('OPEN_METEO', 'italia_meteo_arpae_icon_2i')).toBe('Open-Meteo · ItaliaMeteo ARPAE ICON-2I');
    expect(sourceLabel('MET_NORWAY', undefined)).toBe('MET Norway');
  });

  it('never shows a forecast older than 6 hours', () => {
    const now = new Date('2026-10-08T16:00:00Z');
    expect(showable('2026-10-08T10:00:00Z', now)).toBe(true);
    expect(showable('2026-10-08T09:59:00Z', now)).toBe(false);
  });
});

describe('weather history layout (Weather page)', () => {
  it('shifts calendar dates across month and year boundaries', () => {
    expect(shiftDate('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('lays out 14 columns oldest first and leaves a day without a reading empty', () => {
    const columns = historyColumns('2026-03-03', [
      { date: '2026-02-28', min: 1, max: 4 },
      { date: '2026-03-03', min: 5, max: 9 },
    ]);
    expect(columns).toHaveLength(14);
    expect(columns[0]?.date).toBe('2026-02-18');
    expect(columns[13]?.date).toBe('2026-03-03');
    expect(columns.find((column) => column.date === '2026-02-28')?.range).toEqual({ date: '2026-02-28', min: 1, max: 4 });
    expect(columns.find((column) => column.date === '2026-03-01')?.range).toBeNull();
  });
});

describe('Weather page readings (hours, rain soon, UV)', () => {
  const hour = (time: string, temperature: number, extra: Partial<WeatherHour> = {}): WeatherHour => ({ time, temperature, ...extra });

  it('reads the place\'s wall time, whatever the browser\'s zone', () => {
    expect(wallTimeAt(new Date('2026-11-11T06:30:00Z'), 'Europe/Rome')).toBe('2026-11-11T07:30');
    expect(wallTimeAt(new Date('2026-11-11T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-11-12T08:30');
    expect(hourOf('2026-11-11T07:30')).toBe(7.5);
  });

  it('picks the forecast hour nearest to each moment and leaves a moment without one out', () => {
    const hours = [hour('2026-11-11T09:00', 6), hour('2026-11-11T12:00', 10), hour('2026-11-11T14:00', 11), hour('2026-11-11T16:00', 9)];
    expect(dayMoments(hours).map(({ id, hour: chosen }) => `${id} ${chosen.time.slice(11)}`)).toEqual(['morning 09:00', 'midday 12:00', 'afternoon 14:00']);
  });

  it('says when rain starts from the quarter hours, ignoring the past and drizzle below 0.1 mm', () => {
    const quarters = [
      { time: '2026-11-11T07:00', precipitation: 2 },
      { time: '2026-11-11T07:15', precipitation: 0.05 },
      { time: '2026-11-11T07:30', precipitation: 0 },
      { time: '2026-11-11T07:45', precipitation: 0.4 },
    ];
    expect(rainSoon(quarters, '2026-11-11T07:20')).toEqual({ kind: 'in', minutes: 25 });
    expect(rainSoon(quarters, '2026-11-11T07:50')).toEqual({ kind: 'now' });
    expect(rainSoon(quarters, '2026-11-11T08:00')).toBeNull();
    expect(rainSoon(undefined, '2026-11-11T08:00')).toBeNull();
  });

  it('rates UV on the WHO scale and finds the hours that need sun protection', () => {
    expect([0, 2.4, 3, 5.6, 7, 10.4, 11].map(uvLevel)).toEqual(['low', 'low', 'moderate', 'high', 'high', 'veryHigh', 'extreme']);
    const hours = [hour('2026-07-01T10:00', 20, { uvIndex: 2.4 }), hour('2026-07-01T11:00', 22, { uvIndex: 4 }), hour('2026-07-01T15:00', 25, { uvIndex: 3.2 }), hour('2026-07-01T16:00', 24, { uvIndex: 1 })];
    expect(uvWindow(hours)).toEqual({ from: '2026-07-01T11:00', to: '2026-07-01T16:00' });
    expect(uvWindow([hour('2026-11-11T12:00', 9, { uvIndex: 2 })])).toBeNull();
  });

  it('draws one smooth line through the points and splits the history where a day has no reading', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 0, y: 50 }, { x: 50, y: 10 }, { x: 100, y: 50 }])).toMatch(/^M0 50 C[\d. ,]+50 10 C[\d. ,]+100 50$/);
    const columns = historyColumns('2026-10-14', [{ date: '2026-10-01', min: 1, max: 5 }, { date: '2026-10-02', min: 2, max: 6 }, { date: '2026-10-14', min: 3, max: 7 }]);
    expect(historyRuns(columns).map((run) => run.map(({ index }) => index))).toEqual([[0, 1], [13]]);
  });
});
