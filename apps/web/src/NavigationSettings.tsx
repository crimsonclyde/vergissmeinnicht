import { orderedNavigationTools, type NavigationTool } from '@vergissmeinnicht/domain';
import { useState } from 'react';
import { messageFor } from './api.ts';
import { t, type MessageKey } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';

const LABELS: Record<NavigationTool, MessageKey> = { PROCEDURES: 'shell.procedures', LISTS: 'shell.lists', REMINDERS: 'shell.reminders', CALENDAR: 'shell.calendar', JOURNAL: 'journal.heading', DOCUMENTS: 'shell.documents', CONTACTS: 'shell.contacts', MAINTENANCE: 'shell.maintenance', EQUIPMENT: 'shell.equipment' };

/** One account-wide order, filtered by each Workspace's enabled tools. Save is explicit. */
export function NavigationSettings({ tools }: { tools: readonly string[] | null }) {
  const { preferences, update } = usePreferences();
  const [draft, setDraft] = useState<readonly NavigationTool[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const order = orderedNavigationTools(draft === undefined ? preferences.navigationOrder : draft);
  const visible = order.filter(tool => tools?.includes(tool));
  function move(tool: NavigationTool, direction: number) {
    const next = [...order];
    const neighbor = visible[visible.indexOf(tool) + direction];
    if (neighbor === undefined) return;
    const first = next.indexOf(tool); const second = next.indexOf(neighbor);
    next[first] = neighbor; next[second] = tool;
    setDraft(next); setMessage(null);
  }
  async function save() {
    if (draft === undefined) return;
    setBusy(true); setMessage(null);
    try { await update({ navigationOrder: draft }); setDraft(undefined); setMessage({ error: false, text: t('navigation.saved') }); }
    catch (error) { setMessage({ error: true, text: messageFor(error) }); }
    finally { setBusy(false); }
  }
  return <section className="card stack navigation-settings" aria-labelledby="navigation-order-heading">
    <h3 id="navigation-order-heading">{t('navigation.heading')}</h3>
    <p className="muted">{t('navigation.hint')}</p>
    <p><strong>{t('shell.today')}</strong> · {t('navigation.fixedFirst')}</p>
    <ol className="plain-list today-settings-cards" aria-label={t('navigation.heading')}>
      {visible.map((tool, index) => <li key={tool} className="today-settings-card today-settings-row"><strong>{t(LABELS[tool])}</strong><span className="today-settings-move">
        <button type="button" className="quiet" disabled={busy || index === 0} aria-label={t('todaySettings.moveUp', { title: t(LABELS[tool]) })} onClick={() => move(tool, -1)}>↑</button>
        <button type="button" className="quiet" disabled={busy || index === visible.length - 1} aria-label={t('todaySettings.moveDown', { title: t(LABELS[tool]) })} onClick={() => move(tool, 1)}>↓</button>
      </span></li>)}
    </ol>
    <p><strong>{t('shell.more')}</strong> · {t('navigation.fixedLast')}</p>
    {visible.length === 0 && <p className="muted">{t('navigation.noTools')}</p>}
    {message && <p role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    <div className="row"><button type="button" className="primary" disabled={busy || draft === undefined} onClick={() => void save()}>{t('navigation.save')}</button>
      <button type="button" disabled={busy || draft === undefined} onClick={() => { setDraft(undefined); setMessage(null); }}>{t('common.cancel')}</button>
      <button type="button" className="quiet" disabled={busy} onClick={() => { setDraft(null); setMessage(null); }}>{t('navigation.reset')}</button></div>
  </section>;
}
