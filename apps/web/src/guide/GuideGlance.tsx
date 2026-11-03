import { t, formatTime } from '../i18n/index.ts';
import { useTodaySettings } from '../today-settings.ts';
import { useMinute } from '../TodayClock.tsx';
import { useMyForecast } from '../TodayWeather.tsx';
import { formatClock } from '../i18n/index.ts';
import { conditionIcon, temperature } from '../weather-view.ts';
import { UiIcon } from '../ui-icons.tsx';
import { Link, paths } from '../router.tsx';

/** Same opt-in and forecast contract as Today; mounting a header never enables weather. */
export function GuideGlance({ userId }: { userId: string }) {
  const { settings, loaded } = useTodaySettings(userId);
  const clock = settings.cards.find(item => item.card.id === 'clock');
  const wanted = loaded && settings.cards.some(item => item.card.id === 'weather' && item.visible);
  const weather = useMyForecast(wanted);
  const now = useMinute();
  const condition = weather?.forecast.current?.condition ?? weather?.forecast.days[0]?.condition;
  const degrees = weather === null ? null : temperature(weather.forecast.current?.temperature, weather.unit);
  return <div className="guide-glance">
    {loaded && clock?.visible === true && <Link href={paths.clock()} className="guide-time" aria-label={t('guide.clockOpen')}><time dateTime={now.toISOString()}>{formatClock(now, clock.hour24).time}</time></Link>}
    {weather !== null && <Link href={paths.weather()} className="guide-weather" aria-label={`${t('guide.weatherOpen', { condition: t(`weather.condition.${condition ?? 'UNKNOWN'}`), temperature: degrees ?? '—', unit: weather.unit })}${weather.stale ? ` ${t('guide.stale')} ${formatTime(weather.fetchedAt)}` : ''}`}><UiIcon name={conditionIcon(condition)} /><span>{degrees ?? '—'}</span>{weather.stale && <small>{t('guide.stale')}</small>}</Link>}
  </div>;
}
