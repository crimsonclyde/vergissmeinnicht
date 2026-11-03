import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, isNetworkError, messageFor, type MyForecast } from '../api.ts';
import { offlineStore } from '../offline/store.ts';
import { showable } from '../weather-view.ts';
import { useTodaySettings } from '../today-settings.ts';
import { t, type MessageKey } from '../i18n/index.ts';

export type ShownForecast = Extract<MyForecast, { forecast: object }>;
interface ForecastState { data: ShownForecast | null; loading: boolean; message: string | null }
const ForecastContext = createContext<ForecastState>({ data: null, loading: false, message: null });
export const useForecast = (): ForecastState => useContext(ForecastContext);
const REASONS = ['no_location', 'unavailable', 'rate_limited', 'bad_response', 'not_covered', 'not_allowed', 'needs_credentials', 'invalid_credentials', 'quota_exhausted', 'budget_reached', 'needs_reentry'];

/** One request shared by header, Today and dedicated screen. The account/Workspace key owns all state. */
export function ForecastProvider({ userId, workspaceId, explicit, ready, children }: { userId: string; workspaceId: string | null; explicit: boolean; ready: boolean; children: ReactNode }) {
  const { settings, loaded } = useTodaySettings(userId);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('vmn-location-changed', refresh);
    window.addEventListener('vmn-weather-changed', refresh);
    return () => { window.removeEventListener('vmn-location-changed', refresh); window.removeEventListener('vmn-weather-changed', refresh); };
  }, []);
  const wanted = ready && (explicit || (loaded && settings.cards.some(item => item.card.id === 'weather' && item.visible)));
  const scope = `${userId}:${workspaceId ?? ''}:${revision}`;
  const [stored, setStored] = useState<{ scope: string; state: ForecastState } | null>(null);
  const state = stored?.scope === scope ? stored.state : { data: null, loading: true, message: null };
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!wanted) return;
    let active = true;
    const setState = (state: ForecastState) => setStored({ scope, state });
    api.myForecast(2, workspaceId ?? undefined).then(answer => {
      if (!active) return;
      if (answer.forecast === null) {
        const reason = REASONS.includes(answer.reason) ? answer.reason : 'unavailable';
        setState({ data: null, loading: false, message: t(`weather.noForecast.${reason}` as MessageKey) });
      } else {
        setState({ data: answer, loading: false, message: null });
        void offlineStore.saveForecast(userId, answer, workspaceId ?? undefined);
      }
    }, async (caught: unknown) => {
      // Authorization/server failures never fall back to private cached data.
      const saved = isNetworkError(caught) ? await offlineStore.loadForecast(userId, workspaceId ?? undefined) as ShownForecast | undefined : undefined;
      if (!active) return;
      setState(saved !== undefined && showable(saved.fetchedAt) ? { data: { ...saved, stale: true }, loading: false, message: null } : { data: null, loading: false, message: caught instanceof ApiError && caught.code === 'weather_off' ? t('weather.off') : messageFor(caught) });
    });
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [userId, workspaceId, wanted, scope]);
  const expired = state.data !== null && !showable(state.data.fetchedAt, now);
  const value = !wanted ? { data: null, loading: false, message: null } : expired ? { data: null, loading: false, message: t('weather.noForecast.unavailable') } : state;
  return <ForecastContext.Provider value={value}>{children}</ForecastContext.Provider>;
}
