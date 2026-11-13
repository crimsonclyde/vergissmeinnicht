import { t, formatClock } from '../i18n/index.ts';
import { useTodaySettings } from '../today-settings.ts';
import { useMinute } from '../TodayClock.tsx';
import { Link, paths } from '../router.tsx';
import { useForecast } from '../applets/ForecastProvider.tsx';
import { UiIcon } from '../ui-icons.tsx';
import { temperature } from '../weather-view.ts';

/**
 * The status items of the top bar (section 42): the temperature when the Weather card is on and a forecast
 * is already loaded with a current reading (no extra request), and the time when the Clock card is on. Each opens its page.
 */
export function GuideGlance({ userId }: { userId: string }) {
  const { settings, loaded } = useTodaySettings(userId);
  const clock = settings.cards.find(item => item.card.id === 'clock');
  const weather = settings.cards.find(item => item.card.id === 'weather');
  const { data } = useForecast();
  const degrees = data === null ? null : temperature(data.forecast.current?.temperature, data.unit);
  const now = useMinute();
  return <div className="guide-glance">
    {loaded && weather?.visible === true && degrees !== null && <Link href={paths.weather()} className="guide-weather" aria-label={t('navigation.weatherStatus', { temperature: degrees })}><UiIcon name="weatherStatus" /><span>{degrees}</span></Link>}
    {loaded && clock?.visible === true && <Link href={paths.clock()} className="guide-time" aria-label={t('guide.clockOpen')}><time dateTime={now.toISOString()}>{formatClock(now, clock.hour24).time}</time></Link>}
  </div>;
}
