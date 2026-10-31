import { useEffect, useMemo, useState } from 'react';
import type { WeatherLocation } from '@vergissmeinnicht/domain';
import { api } from './api.ts';
import { formatMoonDateTime, formatMoonTime, formatNumber, t } from './i18n/index.ts';
import { moonAt } from './moon.ts';
import { CelestialArt } from './CelestialArt.tsx';

function EventIcon({ setting }: { setting: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="celestial-event-icon" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 18h20M5 15a7 7 0 0 1 14 0" /><path d="M12 1v6m-3-3 3-3 3 3" transform={setting ? 'translate(0 8) scale(1 -1)' : undefined} /></svg>;
}

/** Reusable presentation; receives absolute instants, never calculates from artwork. */
export function CelestialCard({ now, location }: { now: Date; location: WeatherLocation | null }) {
  const moon = useMemo(() => moonAt(now, location), [now, location]);
  const zone = location?.timeZone;
  const event = (label: 'moon.sunrise' | 'moon.sunset' | 'moon.rise' | 'moon.set', value: Date | null, missing: 'moon.noSunrise' | 'moon.noSunset' | 'moon.noRise' | 'moon.noSet', setting: boolean) => <div className="celestial-event">
    <dt><EventIcon setting={setting} />{t(label)}</dt>
    <dd>{zone === undefined ? t('moon.eventLocation') : value === null ? t(missing) : <time dateTime={value.toISOString()}>{formatMoonTime(value, zone, false)}</time>}</dd>
  </div>;
  return <section className="card today-card today-moon" aria-label={t('moon.heading')} data-card="moon">
    <div className="celestial-instrument">
      <header className="celestial-heading">{location !== null && <span>{location.name}</span>}<h3>{t('moon.heading')}</h3><i aria-hidden="true" /></header>
      <CelestialArt fraction={moon.fraction} waxing={moon.waxing} />
      <div className="celestial-sun celestial-readings"><h4>{t('moon.sun')}</h4><dl>{event('moon.sunrise', moon.sunrise, 'moon.noSunrise', false)}{event('moon.sunset', moon.sunset, 'moon.noSunset', true)}</dl></div>
      <div className="celestial-moon celestial-readings"><h4>{t('moon.moon')}</h4><p className="celestial-phase">{t(`moon.phase.${moon.phase}`)}</p><p className="celestial-illumination">{t('moon.illumination', { percent: formatNumber(moon.fraction * 100) })}</p><dl>{event('moon.rise', moon.rise, 'moon.noRise', false)}{event('moon.set', moon.set, 'moon.noSet', true)}</dl></div>
      <footer className="celestial-footer">{zone !== undefined && <span className="celestial-zone">{zone}</span>}{location === null && <p>{t('moon.noLocation')}</p>}<span>{t('moon.nextFull', { date: formatMoonDateTime(moon.nextFull, zone), days: Math.ceil((moon.nextFull.getTime() - now.getTime()) / 86_400_000) })}</span></footer>
    </div>
  </section>;
}

/** Workspace-admin gate is authoritative on the metadata route; no personal Weather or location fallback. */
export function MoonCard({ workspaceId }: { workspaceId: string }) {
  const [location, setLocation] = useState<WeatherLocation | null | undefined>(undefined);
  const [now, setNow] = useState(() => new Date());
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true; let timer = 0;
    const load = () => api.moon(workspaceId).then((answer) => { if (active) { setLocation(answer.location); setAvailable(true); } }, () => { if (active) { setAvailable(false); setLocation(undefined); } });
    const refresh = () => { window.clearTimeout(timer); if (document.hidden) return; setNow(new Date()); void load(); timer = window.setTimeout(refresh, 10 * 60_000); };
    const changed = () => { void load(); };
    refresh(); document.addEventListener('visibilitychange', refresh); window.addEventListener('vmn-location-changed', changed); window.addEventListener('focus', refresh);
    return () => { active = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('vmn-location-changed', changed); window.removeEventListener('focus', refresh); };
  }, [workspaceId]);
  if (!available || location === undefined) return null;
  return <CelestialCard now={now} location={location} />;
}
