import { useEffect, useId, useMemo, useState } from 'react';
import type { WeatherLocation } from '@vergissmeinnicht/domain';
import { api } from './api.ts';
import { formatDateTime, formatMoonTime, formatNumber, t } from './i18n/index.ts';
import { moonAt } from './moon.ts';

function MoonDisc({ fraction, waxing }: { fraction: number; waxing: boolean }) {
  const id = useId();
  const radius = Math.abs(1 - 2 * fraction) * 44;
  const path = `M 50 6 A 44 44 0 0 1 50 94 A ${radius || 0.001} 44 0 0 ${fraction < 0.5 ? 0 : 1} 50 6 Z`;
  return <svg className="moon-disc" viewBox="0 0 100 100" aria-hidden="true">
    <defs><clipPath id={id}><circle cx="50" cy="50" r="44" /></clipPath></defs>
    <circle cx="50" cy="50" r="44" className="moon-dark" />
    <g clipPath={`url(#${id})`} transform={waxing ? undefined : 'translate(100 0) scale(-1 1)'}>
      <path d={path} className="moon-lit" />
      {[[37, 30, 11], [67, 59, 14], [34, 71, 9], [62, 24, 6], [76, 36, 5], [50, 49, 7]].map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} className="moon-crater" />)}
    </g>
    <circle cx="50" cy="50" r="44" fill="none" className="moon-rim" />
  </svg>;
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
  const moon = useMemo(() => location === undefined ? null : moonAt(now, location), [now, location]);
  if (!available || moon === null) return null;
  return <section className="card today-card today-moon" aria-label={t('moon.heading')} data-card="moon">
    <div className="row spread"><h3>{t('moon.heading')}</h3>{location != null && <small className="badge">{location.name}</small>}</div>
    <div className="moon-content"><MoonDisc fraction={moon.fraction} waxing={moon.waxing} /><div className="stack">
      <strong>{t(`moon.phase.${moon.phase}`)}</strong>
      <span className="muted">{t('moon.illumination', { percent: formatNumber(moon.fraction * 100) })}</span>
      {location != null && <dl className="moon-facts">
        <div><dt>{t('moon.rise')}</dt><dd>{moon.rise === null ? t('moon.noRise') : formatMoonTime(moon.rise, location.timeZone)}</dd></div>
        <div><dt>{t('moon.set')}</dt><dd>{moon.set === null ? t('moon.noSet') : formatMoonTime(moon.set, location.timeZone)}</dd></div>
      </dl>}
      <span className="muted">{t('moon.nextFull', { date: formatDateTime(moon.nextFull), days: Math.ceil((moon.nextFull.getTime() - now.getTime()) / 86_400_000) })}</span>
      {location === null && <small className="muted">{t('moon.noLocation')}</small>}
    </div></div>
  </section>;
}
