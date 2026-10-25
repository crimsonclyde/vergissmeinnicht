import { memo, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useThemeMode } from '../theme.ts';
import { placeLight, type PlaceClock } from './atmosphere.ts';
import { placeLook, type PlaceProminence } from './look.ts';
import { PlaceBackdrop } from './PlaceBackdrop.tsx';
import { placeForTheme } from './registry.ts';
import { usePlaceSettings } from './settings-store.ts';
import { t } from '../i18n/index.ts';
import { UiIcon } from '../ui-icons.tsx';

/**
 * The Places background behind every page (section 30), only while a Places theme is shown. Before
 * sign-in (and without a Workspace) it is the country's illustration with the defaults; signed in, it is
 * the person's own look for the Workspace being shown.
 */
export function PlaceScene({ userId, workspaceId, prominence }: { userId?: string; workspaceId?: string | null; prominence: PlaceProminence }) {
  const [mode] = useThemeMode();
  const config = placeForTheme(mode);
  if (config === null) return null;
  return <Scene key={`${userId ?? 'public'}:${workspaceId ?? 'none'}`} configId={config.id} userId={userId} workspaceId={workspaceId ?? null} prominence={prominence} />;
}

/** Workspace locations already asked for in this tab (shared, optional metadata; no provider call). */
const clocks = new Map<string, PlaceClock>();

/** The Workspace's location and time zone (section 26), if it has one; null values otherwise. */
export function useWorkspaceClock(workspaceId: string | null, signedIn: boolean): PlaceClock {
  const [clock, setClock] = useState<PlaceClock>(() => (workspaceId === null ? { location: null, timeZone: null } : (clocks.get(workspaceId) ?? { location: null, timeZone: null })));
  useEffect(() => {
    if (workspaceId === null || !signedIn) return;
    let active = true;
    const load = () =>
      api.workspaceLocation(workspaceId).then(
        (place) => {
          const next = place === null ? { location: null, timeZone: null } : { location: { latitude: place.latitude, longitude: place.longitude }, timeZone: place.timeZone };
          clocks.set(workspaceId, next);
          if (active) setClock(next);
        },
        () => undefined,
      );
    if (!clocks.has(workspaceId)) void load();
    const changed = () => {
      clocks.delete(workspaceId);
      void load();
    };
    window.addEventListener('vmn-location-changed', changed);
    return () => {
      active = false;
      window.removeEventListener('vmn-location-changed', changed);
    };
  }, [workspaceId, signedIn]);
  return clock;
}

/** The current time, refreshed every ten minutes while the page is visible. */
export function useSlowClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      setNow(new Date());
      timer = window.setTimeout(update, 10 * 60 * 1000);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return now;
}

const Scene = memo(function Scene({ configId, userId, workspaceId, prominence }: { configId: string; userId: string | undefined; workspaceId: string | null; prominence: PlaceProminence }) {
  const config = placeForTheme(`places-${configId}`);
  const { settings, loaded, save } = usePlaceSettings(userId, workspaceId);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const clock = useWorkspaceClock(workspaceId, userId !== undefined);
  const now = useSlowClock();
  if (config === null) return null;
  // The weather integration point stays unused: no forecast is requested for decoration.
  const light = placeLight(now, clock, null);
  return <><PlaceBackdrop className="place-scene" look={placeLook(config, settings, workspaceId)} light={light} prominence={prominence} />
    {prominence === 'today' && userId !== undefined && workspaceId !== null && loaded && <aside className="place-scene-caption" aria-label={t('places.scene')}><div><UiIcon name="place" /><span><strong>{t(config.name)}</strong><small>{t(config.hint)}</small></span></div><button type="button" className="quiet" disabled={busy} aria-pressed={settings.preferences.atmosphere} onClick={() => { setBusy(true); setFailed(false); void save({ ...settings.preferences, atmosphere: !settings.preferences.atmosphere }).catch(() => setFailed(true)).finally(() => setBusy(false)); }}><UiIcon name="atmosphere" />{t(settings.preferences.atmosphere ? 'places.effectsOn' : 'places.effectsOff')}</button>{failed && <p role="status">{t('places.effectsError')}</p>}</aside>}
  </>;
});
