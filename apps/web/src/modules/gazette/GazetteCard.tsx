import { useEffect, useState } from 'react';
import { api, type GazetteTodayView } from '../../api.ts';
import { formatCalendarDate, formatNumber, formatShortTime, t } from '../../i18n/index.ts';
import { Link, paths } from '../../router.tsx';
import { UiIcon } from '../../ui-icons.tsx';
import { conditionIcon } from '../../weather-view.ts';
import { GazetteLandscape } from './GazetteArt.tsx';
import './gazette.css';

/**
 * The Gazette on the Dashboard (43.2): a compact, atmospheric preview of the newest published edition.
 * The whole card is one link (touchscreens: no small "Read more" target, nothing else inside it is
 * interactive). An older edition shows its real date and an amber chip, never today's weather.
 */
export function GazetteCard({ workspaceId, refreshKey }: { workspaceId: string; refreshKey?: number }) {
  const [view, setView] = useState<GazetteTodayView | null | 'error'>(null);
  useEffect(() => {
    let live = true;
    api.gazetteToday(workspaceId).then(result => { if (live) setView(result); }, () => { if (live) setView('error'); });
    return () => { live = false; };
  }, [workspaceId, refreshKey]);
  if (view === null || view === 'error') return null;
  const preview = view.preview;
  if (preview === null) {
    return (
      <section className="card gazette-tile gazette-tile-empty" data-card="gazette" aria-label={t('gazette.heading')}>
        <div className="gazette-tile-band"><GazetteLandscape className="gazette-art" /><div className="gazette-tile-mast"><strong>{t('gazette.masthead')}</strong><small>{t('gazette.notYet')}</small></div></div>
        <p className="gazette-tile-empty-text muted"><UiIcon name="gazette" size="1.6em" /><span>{t('gazette.firstEdition')}</span></p>
      </section>
    );
  }
  const stale = !preview.isToday;
  const label = stale ? t('gazette.openOlder', { date: formatCalendarDate(preview.date) }) : t('gazette.openToday', { date: formatCalendarDate(preview.date) });
  return (
    <Link href={paths.gazette(workspaceId, stale ? preview.date : undefined)} className={stale ? 'card gazette-tile gazette-tile-stale' : 'card gazette-tile'} data-card="gazette" aria-label={label}>
      <div className="gazette-tile-band">
        <GazetteLandscape className="gazette-art" />
        <div className="gazette-tile-mast">
          <strong>{preview.title || t('gazette.masthead')}</strong>
          <small>{stale ? formatCalendarDate(preview.date) : preview.publishedAt === null ? t('gazette.today') : t('gazette.todayAt', { time: formatShortTime(preview.publishedAt) })}</small>
        </div>
        <span className="gazette-tile-go" aria-hidden="true"><UiIcon name="forward" /></span>
      </div>
      <div className="gazette-tile-body">
        {stale && <span className="gazette-chip gazette-chip-warn"><UiIcon name="calendar" size="1em" />{t('gazette.olderEdition')}</span>}
        {preview.greeting !== '' && <p className="gazette-tile-greeting">{preview.greeting}</p>}
        {preview.weather.length > 0 && (
          <div className="gazette-tile-weather">
            {preview.weather.map(place => (
              <span key={place.name} className="gazette-tile-place">
                <UiIcon name={conditionIcon(place.condition)} size="1.5em" />
                <span>
                  <b>{place.high === null ? '–' : `${formatNumber(place.high)}°`}{place.low !== null && <span className="muted"> {formatNumber(place.low)}°</span>}</b>
                  <small>{place.name}</small>
                </span>
              </span>
            ))}
          </div>
        )}
        {preview.headlines.length > 0 && (
          <ul className="plain-list gazette-tile-heads">
            {preview.headlines.map(head => <li key={`${head.sectionId}:${head.title}`}><span className="gazette-kicker">{head.section}</span><span className="gazette-tile-head">{head.title}</span></li>)}
          </ul>
        )}
      </div>
      <div className="gazette-tile-foot">
        <span className="gazette-chip"><UiIcon name="gazette" size="1em" />{t('gazette.sections', { count: preview.sectionCount })}</span>
        {preview.priceDrops > 0 && <span className="gazette-chip gazette-chip-good"><UiIcon name="moveDown" size="1em" />{t('gazette.priceDrops', { count: preview.priceDrops })}</span>}
      </div>
    </Link>
  );
}
