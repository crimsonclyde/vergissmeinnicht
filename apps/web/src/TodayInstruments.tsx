import { ClockCard } from './TodayClock.tsx';
import { WeatherCard } from './TodayWeather.tsx';
import type { ShownForecast } from './applets/ForecastProvider.tsx';
import { t } from './i18n/index.ts';
import './applets/combined-instruments.css';
import './applets/sky-card.css';

/** Presentation group only: the existing independent personal settings still own each instrument. */
export function TodayInstruments({ clock, weather }: { clock: { hour24: boolean } | undefined; weather: ShownForecast | null }) {
  const parts = Number(clock !== undefined) + Number(weather !== null);
  if (parts === 0) return null;
  return <section className="card today-card instrument today-instruments sky-card" data-parts={parts} aria-label={parts === 2 ? t('today.instruments') : clock !== undefined ? t('today.clock') : t('today.weather')}>
    {clock !== undefined && <ClockCard hour24={clock.hour24} />}
    {weather !== null && <WeatherCard data={weather} />}
  </section>;
}
