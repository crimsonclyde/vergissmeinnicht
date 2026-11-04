import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TodayInstruments } from '../TodayInstruments.tsx';
import { InstrumentPicture } from './InstrumentPicture.tsx';
import type { ShownForecast } from './ForecastProvider.tsx';

const weather: ShownForecast = { forecast: { provider: 'OPEN_METEO', days: [{ date: '2026-11-03', max: 20, condition: 'CLEAR' }] }, horizon: 1, location: { name: '<script>place</script>', timeZone: 'Europe/Berlin' }, fetchedAt: '2026-11-03T09:00:00Z', stale: true, fellBackFrom: null, unit: 'C', showTomorrow: false, history: [] };
it('shows no empty card or artwork without a chosen usable instrument, and never invents current temperature', () => {
  expect(renderToStaticMarkup(<TodayInstruments clock={undefined} weather={null} />)).toBe('');
  const html = renderToStaticMarkup(<TodayInstruments clock={undefined} weather={weather} />);
  expect(html).toContain('data-parts="1"');
  expect(html).toContain('Daily outlook');
  expect(html).toMatch(/instrument-half-value">—/);
  expect(html).not.toContain('20°');
  expect(html).toContain('&lt;script&gt;place');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('today-weather-open');
});
it('keeps live analogue hands consistent with the supplied device time without animation', () => {
  const first = renderToStaticMarkup(<InstrumentPicture kind="clock" now={new Date(2026, 10, 3, 10, 8)} />);
  const second = renderToStaticMarkup(<InstrumentPicture kind="clock" now={new Date(2026, 10, 3, 7, 45)} />);
  expect(first).toContain('rotate(304)');
  expect(first).toContain('rotate(48)');
  expect(second).toContain('rotate(232.5)');
  expect(second).toContain('rotate(270)');
  expect(first).not.toContain('<animate');
});
