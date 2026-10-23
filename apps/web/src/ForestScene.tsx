import { memo, useEffect, useState, type CSSProperties } from 'react';
import { api } from './api.ts';
import { forestLight, type ForestLocation } from './forest-light.ts';
import { useThemeMode } from './theme.ts';
import wide from './witch-forest/old-forest-wide.webp';
import medium from './witch-forest/old-forest-medium.webp';
import portrait from './witch-forest/old-forest-portrait-768.webp';
import smallPortrait from './witch-forest/old-forest-portrait-480.webp';

/** Independent artwork, CSS mist and sparse fireflies. Never an interaction or content surface. */
export function ForestScene({ userId, workspaceId }: { userId?: string; workspaceId?: string | undefined }) {
  const [mode] = useThemeMode();
  return mode === 'witch-forest' ? <Forest key={`${userId ?? 'public'}:${workspaceId ?? 'personal'}`} userId={userId} workspaceId={workspaceId} /> : null;
}

/** Fixed seed, generated once at module load: unrelated renders never move a firefly. */
function fireflies(): CSSProperties[] {
  let seed = 253;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: 10 }, () => ({
    left: `${8 + random() * 84}%`,
    bottom: `${7 + random() * 44}%`,
    width: `${1 + random() * 1.2}px`,
    height: `${1 + random() * 1.2}px`,
    animationDuration: `${19 + random() * 18}s, ${13 + random() * 23}s`,
    animationDelay: `${-random() * 35}s, ${-random() * 37}s`,
  }));
}
const FLIES = fireflies();

const Forest = memo(function Forest({ userId, workspaceId }: { userId: string | undefined; workspaceId: string | undefined }) {
  const [location, setLocation] = useState<ForestLocation | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [paused, setPaused] = useState(() => document.hidden);

  useEffect(() => {
    if (userId === undefined) return;
    let active = true;
    // Existing own-account settings only: never a forecast, provider call, device location or new cache.
    // If Weather is disabled, unavailable or unconfigured, the phase-only baseline remains complete.
    let lastRequest = 0;
    const load = () => {
      if (Date.now() - lastRequest < 60_000) return;
      lastRequest = Date.now();
      api.myWeather(workspaceId).then((answer) => {
        const place = answer.settings.location;
        if (active) setLocation(place === null ? null : { latitude: place.latitude, longitude: place.longitude });
      }, () => { if (active) setLocation(null); });
    };
    load();
    const changed = () => { lastRequest = 0; load(); };
    window.addEventListener('vmn-location-changed', changed);
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); window.removeEventListener('vmn-location-changed', changed); };
  }, [userId, workspaceId]);

  useEffect(() => {
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      setPaused(document.hidden);
      if (document.hidden) return;
      setNow(new Date());
      timer = window.setTimeout(update, 10 * 60 * 1000);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', update); };
  }, []);

  const light = forestLight(now, location);
  return (
    <div className="forest" aria-hidden="true" data-paused={paused}>
      <picture>
        <source media="(max-width: 37.5rem)" srcSet={`${smallPortrait} 480w, ${portrait} 768w`} sizes="100vw" />
        <img className="forest-art" src={wide} srcSet={`${medium} 1024w, ${wide} 1536w`} sizes="100vw" alt="" decoding="async" />
      </picture>
      <div className="forest-moonlight" style={{ opacity: 0.12 + light.moonlight * 0.18 }} />
      <div className="forest-stars" style={{ opacity: 0.15 + light.starlight * 0.25 }} />
      <div className="forest-fog forest-fog-far" />
      <div className="forest-fog forest-fog-near" />
      <div className="forest-shade" />
      <div className="forest-fireflies">
        {FLIES.map((style, index) => <span key={index} style={style} />)}
      </div>
      <div className="forest-ivy forest-ivy-right" />
    </div>
  );
});
