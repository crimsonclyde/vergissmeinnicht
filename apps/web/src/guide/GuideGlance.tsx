import { t, formatClock } from '../i18n/index.ts';
import { useTodaySettings } from '../today-settings.ts';
import { useMinute } from '../TodayClock.tsx';
import { Link, paths } from '../router.tsx';

/** The time in the top bar, shown when the Clock card is on. The bar shows no weather: Today and the Weather page keep it. */
export function GuideGlance({ userId }: { userId: string }) {
  const { settings, loaded } = useTodaySettings(userId);
  const clock = settings.cards.find(item => item.card.id === 'clock');
  const now = useMinute();
  return <div className="guide-glance">
    {loaded && clock?.visible === true && <Link href={paths.clock()} className="guide-time" aria-label={t('guide.clockOpen')}><time dateTime={now.toISOString()}>{formatClock(now, clock.hour24).time}</time></Link>}
  </div>;
}
