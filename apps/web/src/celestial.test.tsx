import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { lunarLightPath } from './CelestialArt.tsx';
import { CelestialCard } from './TodayMoon.tsx';

it('projects the lunar terminator from new through quarter to full', () => {
  expect(lunarLightPath(0)).toBe('');
  expect(lunarLightPath(.25)).toContain('A 40 80 0 0 0');
  expect(lunarLightPath(.5)).toContain('A 0.001 80');
  expect(lunarLightPath(.75)).toContain('A 40 80 0 0 1');
  expect(lunarLightPath(1)).toContain('A 80 80 0 0 1');
});
it('preserves phase/next full with no location and labels all four missing event times', () => {
  const html = renderToStaticMarkup(<CelestialCard now={new Date('2024-04-08T18:21:00Z')} location={null} />);
  expect(html).toContain('New moon'); expect(html).toContain('Next full moon');
  expect(html.match(/Location needed/g)).toHaveLength(4);
  for (const label of ['Sunrise', 'Sunset', 'Moonrise', 'Moonset']) expect(html).toContain(label);
});
