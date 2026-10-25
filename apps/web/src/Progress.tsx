import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import { t } from './i18n/index.ts';
import { UiIcon } from './ui-icons.tsx';

const ProgressContext = createContext<number | null>(null);
export function ProgressPoints() {
  const points = useContext(ProgressContext);
  return points === null ? null : <span className="personal-points"><UiIcon name="star" /> {t('progress.points', { count: points })}</span>;
}
export function ProgressSummary() {
  return <section className="card progress-summary"><h3>{t('progress.personalHeading')}</h3><ProgressPoints /><p className="muted">{t('progress.hint')}</p></section>;
}
/** Live own-account total, never stored offline or used to authorize anything. */
export function ProgressProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [points, setPoints] = useState<number | null>(null);
  const [cheer, setCheer] = useState(0);
  const last = useRef<number | null>(null);
  useEffect(() => {
    let active = true; let timer = 0; let request = 0;
    const load = () => {
      if (document.hidden) return;
      const current = ++request;
      void api.personalProgress().then(({ points: next }) => {
        if (!active || current !== request) return;
        if (last.current !== null && next > last.current) setCheer(next - last.current);
        last.current = next; setPoints(next);
      }, () => undefined);
    };
    const added = () => setCheer(-1);
    const changed = () => { window.clearTimeout(timer); timer = window.setTimeout(load, 250); };
    load();
    window.addEventListener('vmn-equipment-added', added);
    window.addEventListener('vmn-mutation-succeeded', changed);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => { active = false; window.clearTimeout(timer); window.removeEventListener('vmn-equipment-added', added); window.removeEventListener('vmn-mutation-succeeded', changed); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load); };
  }, [userId]);
  useEffect(() => { if (cheer === 0) return; const timer = window.setTimeout(() => setCheer(0), 6000); return () => window.clearTimeout(timer); }, [cheer]);
  return <ProgressContext.Provider value={points}>{children}{cheer !== 0 && <div className="progress-cheer" role="status"><span className="progress-seedling" aria-hidden="true"><span>• ‿ •</span></span><div><strong>{t('progress.cheer')}</strong><small>{cheer > 0 ? t('progress.earned', { count: cheer }) : t('progress.savedCheer')}</small></div><button type="button" className="quiet icon-button" aria-label={t('progress.dismiss')} onClick={() => setCheer(0)}><UiIcon name="close" /></button></div>}</ProgressContext.Provider>;
}
