import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, messageFor } from './api.ts';
import { t } from './i18n/index.ts';
import { UiIcon } from './ui-icons.tsx';
import { usePreferences } from './preferences.tsx';
import { chooseCelebration, type CelebrationStyle } from './modules/gamification/celebrations.tsx';

type Cheer = { amount: number; style: CelebrationStyle; sequence: number };
const ProgressContext = createContext<{ points: number | null; enabled: boolean }>({ points: null, enabled: false });
export const useGamification = () => useContext(ProgressContext).enabled;
export function ProgressPoints({ history = false }: { history?: boolean }) {
  const { points, enabled } = useContext(ProgressContext);
  return points === null || (!enabled && !history) ? null : <span className="personal-points"><UiIcon name="star" /> {t('progress.points', { count: points })}</span>;
}
export function ProgressSummary() {
  const { preferences, update } = usePreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(enabled: boolean) {
    setBusy(true); setError(null);
    try { await update({ privateGamification: enabled }); }
    catch (caught) { setError(messageFor(caught)); }
    finally { setBusy(false); }
  }
  return <section className="card progress-summary"><h3>{t('progress.personalHeading')}</h3><ProgressPoints history /><p className="muted">{t('progress.hint')}</p><label className="row"><input type="checkbox" checked={preferences.privateGamification} disabled={busy} onChange={event => void change(event.target.checked)} />{t('gamification.private')}</label><p className="muted">{t('gamification.privateHint')}</p>{error && <p role="alert">{error}</p>}</section>;
}
/** One presentation for every tool. Only confirmed increases from the server claim earned points. */
export function ProgressProvider({ userId, workspaceId, tools, privateScope, children }: { userId: string; workspaceId: string | null; tools: readonly string[]; privateScope: boolean; children: ReactNode }) {
  const { preferences } = usePreferences();
  const hint = privateScope ? preferences.privateGamification : workspaceId !== null && tools.includes('GAMIFICATION');
  const [points, setPoints] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [cheer, setCheer] = useState<Cheer | null>(null);
  const last = useRef<number | null>(null);
  const scope = `${workspaceId ?? 'account'}:${privateScope}:${hint}`;
  const [receivedScope, setReceivedScope] = useState(scope);
  if (receivedScope !== scope) { setReceivedScope(scope); setCheer(null); setEnabled(false); }
  useEffect(() => {
    let active = true; let timer = 0; let request = 0; let sequence = 0; let pending = false;
    last.current = null;
    const load = (celebrate = false) => {
      if (document.hidden) return;
      const current = ++request;
      const gate = privateScope ? Promise.resolve(preferences.privateGamification) : workspaceId === null ? Promise.resolve(false) : api.workspace(workspaceId).then(result => result.tools.includes('GAMIFICATION'));
      void Promise.all([api.personalProgress(), gate]).then(([{ points: next }, on]) => {
        if (!active || current !== request) return;
        setEnabled(on);
        if (!on) setCheer(null);
        else if (celebrate && last.current !== null && next > last.current) setCheer({ amount: next - last.current, style: chooseCelebration(), sequence: ++sequence });
        last.current = next; setPoints(next);
      }, () => { if (active && current === request) { setEnabled(false); setCheer(null); } });
    };
    const changed = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      pending ||= path !== undefined && (privateScope ? path.startsWith('/account/journal') : workspaceId !== null && path.startsWith(`/workspaces/${workspaceId}/`));
      window.clearTimeout(timer); timer = window.setTimeout(() => { const celebrate = pending; pending = false; load(celebrate); }, 250);
    };
    const refresh = () => load();
    load();
    const poll = window.setInterval(refresh, 30_000);
    window.addEventListener('vmn-mutation-succeeded', changed);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(poll); window.removeEventListener('vmn-mutation-succeeded', changed); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [userId, workspaceId, privateScope, preferences.privateGamification, hint]);
  useEffect(() => { if (!cheer) return; const timer = window.setTimeout(() => setCheer(null), 6000); return () => window.clearTimeout(timer); }, [cheer]);
  const on = enabled;
  return <ProgressContext.Provider value={{ points, enabled: on }}>{children}{on && cheer && <div key={cheer.sequence} className="progress-cheer" role="status" data-celebration={cheer.style.id}>{cheer.style.render()}<div className="progress-cheer-copy">{cheer.style.name && <small className="progress-companion-name">{cheer.style.name}</small>}<strong>{t('progress.cheer')}</strong><small>{t('progress.earned', { count: cheer.amount })}</small></div><button type="button" className="quiet icon-button" aria-label={t('progress.dismiss')} onClick={() => setCheer(null)}><UiIcon name="close" /></button></div>}</ProgressContext.Provider>;
}
