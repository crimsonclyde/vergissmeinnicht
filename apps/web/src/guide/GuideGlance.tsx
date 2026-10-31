import { useState } from 'react';
import { t, formatTime } from '../i18n/index.ts';
import { useTodaySettings } from '../today-settings.ts';
import { useMinute, ClockCard } from '../TodayClock.tsx';
import { useMyForecast, WeatherCard } from '../TodayWeather.tsx';
import { formatClock } from '../i18n/index.ts';
import { conditionIcon, temperature } from '../weather-view.ts';
import { UiIcon } from '../ui-icons.tsx';
import { GuideDialog } from './GuideDialog.tsx';

/** Same opt-in and forecast contract as Today; mounting a header never enables weather. */
export function GuideGlance({ userId, workspaceId }: { userId: string; workspaceId: string | null }) {
  const { settings, loaded } = useTodaySettings(userId);
  const clock = settings.cards.find(item => item.card.id === 'clock');
  const wanted = loaded && settings.cards.some(item => item.card.id === 'weather' && item.visible);
  const weather = useMyForecast(userId, wanted, workspaceId ?? undefined);
  const now = useMinute();
  const [detail, setDetail] = useState<'clock' | 'weather' | null>(null);
  const condition = weather?.forecast.current?.condition ?? weather?.forecast.days[0]?.condition;
  const degrees = weather === null ? null : temperature(weather.forecast.current?.temperature, weather.unit);
  return <div className="guide-glance">
    {loaded && clock?.visible === true && <button type="button" className="guide-time" aria-label={t('guide.clockOpen')} aria-haspopup="dialog" onClick={() => setDetail('clock')}><time dateTime={now.toISOString()}>{formatClock(now, clock.hour24).time}</time></button>}
    {weather !== null && <button type="button" className="guide-weather" aria-haspopup="dialog" aria-label={`${t('guide.weatherOpen', { condition: t(`weather.condition.${condition ?? 'UNKNOWN'}`), temperature: degrees ?? '—', unit: weather.unit })}${weather.stale ? ` ${t('guide.stale')} ${formatTime(weather.fetchedAt)}` : ''}`} onClick={() => setDetail('weather')}><UiIcon name={conditionIcon(condition)} /><span>{degrees ?? '—'}</span>{weather.stale && <small>{t('guide.stale')}</small>}</button>}
    {detail === 'clock' && <GuideDialog title={t('today.clock')} onClose={() => setDetail(null)}><ClockCard hour24={clock?.hour24 ?? false} /></GuideDialog>}
    {detail === 'weather' && weather !== null && <GuideDialog title={t('weather.heading')} onClose={() => setDetail(null)}><WeatherCard data={weather} /></GuideDialog>}
  </div>;
}
