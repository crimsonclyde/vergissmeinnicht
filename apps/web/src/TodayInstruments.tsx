import { ClockCard } from './TodayClock.tsx';
import { PublishedWeatherCard, WeatherCard } from './TodayWeather.tsx';
import { usePublishedWeather } from './applets/PublishedWeather.tsx';
import type { ShownForecast } from './applets/ForecastProvider.tsx';
import { t } from './i18n/index.ts';
import './applets/combined-instruments.css';
import './applets/sky-card.css';

/** Presentation group only: the existing independent personal settings still own each instrument. */
export function TodayInstruments({ clock, weather, weatherOn = weather !== null }: { clock: { hour24: boolean } | undefined; weather: ShownForecast | null; weatherOn?: boolean }) {
  // Today's published Daily Planet weather comes first; the Workspace weather is the fallback (46).
  const latest = usePublishedWeather();
  const published = weatherOn ? latest : null;
  const shown = published !== null || weather !== null;
  const parts = Number(clock !== undefined) + Number(shown);
  if (parts === 0) return null;
  return <section className="card today-card instrument today-instruments sky-card" data-parts={parts} aria-label={parts === 2 ? t('today.instruments') : clock !== undefined ? t('today.clock') : t('today.weather')}>
    {clock !== undefined && <ClockCard hour24={clock.hour24} />}
    {published !== null ? <PublishedWeatherCard published={published} unit={weather?.unit ?? 'C'} /> : weather !== null && <WeatherCard data={weather} />}
  </section>;
}
