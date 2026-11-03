import { t } from '../i18n/index.ts';
import { navigate, paths, Link } from '../router.tsx';
import { MobileActionBar } from '../mobile/MobileActionBar.tsx';
import { useForecast } from './ForecastProvider.tsx';
import { WeatherInstrument } from './WeatherInstrument.tsx';

export function WeatherScreen({ onBack }: { onBack: () => void }) {
  const { data, loading, message } = useForecast();
  return <section className="applet-screen stack" aria-labelledby="weather-heading">
    <h1 id="weather-heading">{t('weather.heading')}</h1>
    {data !== null ? <WeatherInstrument data={data} screen /> : <p role="status">{loading ? t('common.loading') : message ?? t('weather.noForecast.unavailable')}</p>}
    <Link href={paths.account('weather')}>{t('weather.forecastSettings')}</Link>
    <MobileActionBar label={t('weather.actions')} actions={[{ id: 'back', icon: 'back', label: t('common.back'), onClick: onBack }]} primary={{ id: 'settings', icon: 'settings', label: t('weather.forecastSettings'), onClick: () => navigate(paths.account('weather')) }} />
  </section>;
}
