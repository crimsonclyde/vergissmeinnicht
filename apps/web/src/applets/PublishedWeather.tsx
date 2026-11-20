import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { GazettePreviewWeather } from '@vergissmeinnicht/domain';
import { api } from '../api.ts';

/**
 * One weather source for the Dashboard tile and the top bar (46): when The Daily Planet is on and today's
 * edition is published with a weather section, its report is shown (owner: "only what the AI publishes");
 * otherwise both keep the Workspace weather (ForecastProvider). Today's preview is one small request that the
 * Daily Planet card makes as well; it is refreshed when the page becomes visible again and every 15 minutes,
 * so an edition published during the day appears without a reload.
 */
export interface PublishedWeather {
  /** The first place of the edition; the tile and the bar show one place. */
  readonly place: GazettePreviewWeather;
  readonly date: string;
  readonly workspaceId: string;
}

const PublishedWeatherContext = createContext<PublishedWeather | null>(null);
export const usePublishedWeather = (): PublishedWeather | null => useContext(PublishedWeatherContext);

const REFRESH_MS = 15 * 60_000;

/** Today's published weather, or null (Daily Planet off, nothing published yet, no weather section, offline). */
export function pickPublishedWeather(workspaceId: string, preview: { readonly isToday: boolean; readonly publishedAt: string | null; readonly date: string; readonly weather: readonly GazettePreviewWeather[] } | null): PublishedWeather | null {
  if (preview === null || !preview.isToday || preview.publishedAt === null) return null;
  const place = preview.weather.find(item => item.high !== null || item.low !== null) ?? null;
  return place === null ? null : { place, date: preview.date, workspaceId };
}

export function PublishedWeatherProvider({ workspaceId, enabled, children }: { workspaceId: string | null; enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<{ key: string; value: PublishedWeather | null } | null>(null);
  const key = enabled && workspaceId !== null ? workspaceId : null;
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api.gazetteToday(key).then(
        result => { if (live) setState({ key, value: pickPublishedWeather(key, result.preview) }); },
        // A failure keeps the Workspace weather: nothing published is ever guessed.
        () => { if (live) setState({ key, value: null }); },
      );
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', load);
    return () => { live = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [key]);
  const value = key !== null && state?.key === key ? state.value : null;
  return <PublishedWeatherContext.Provider value={value}>{children}</PublishedWeatherContext.Provider>;
}
