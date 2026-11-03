import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { WeatherInstrument } from './WeatherInstrument.tsx';
import type { ShownForecast } from './ForecastProvider.tsx';

const fixture: ShownForecast = { forecast: { provider: 'OPEN_METEO', days: [{ date: '2026-11-03', max: 20, condition: 'RAIN', partial: true, windSpeedMax: 30 }] }, horizon: 1, location: { name: '<script>private</script>', timeZone: 'Europe/Berlin' }, fetchedAt: '2026-11-03T09:00:00Z', stale: true, fellBackFrom: 'MET_NORWAY', unit: 'C', showTomorrow: false };
it('keeps missing current conditions and optional measurements explicit, names fallback/cache and escapes place text', () => {
  const html = renderToStaticMarkup(<WeatherInstrument data={fixture} />);
  expect(html).toContain('Daily outlook');
  expect(html).toContain('rest of the day');
  expect(html).toContain('Showing a saved forecast');
  expect(html).toContain('MET Norway');
  expect(html).toContain('Maximum wind');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toMatch(/instrument-temperature">—/);
  expect(html).not.toContain('0 mm');
});
it('honors units and tomorrow choice, with current wind labelled distinctly', () => {
  const forecast = { ...fixture.forecast, current: { temperature: 0, windSpeed: 12, condition: 'CLEAR' as const }, days: [...fixture.forecast.days, { date: '2026-11-04', min: 1, max: 5 }] };
  const hidden = renderToStaticMarkup(<WeatherInstrument data={{ ...fixture, forecast, unit: 'F' }} />);
  expect(hidden).toContain('32°');
  expect(hidden).toContain('Wind now');
  expect(hidden).not.toContain('instrument-weather-tomorrow');
  expect(renderToStaticMarkup(<WeatherInstrument data={{ ...fixture, forecast, showTomorrow: true }} />)).toContain('instrument-weather-tomorrow');
});
