import type { BringContent, BringStatus } from '@vergissmeinnicht/domain';
import { useCallback, useEffect, useState } from 'react';
import { api, messageFor, type BringView, type PersonRef } from './api.ts';
import { formatCalendarDate, formatDateTime, t } from './i18n/index.ts';
import { setNavigationGuard } from './router.tsx';
import { UndoNotice, type Undoable } from './UndoNotice.tsx';
import { browserTimeZone, todayIn } from './schedule-dates.ts';
const STATUS_LABEL = { OPEN: 'bring.OPEN', COMPLETED: 'bring.COMPLETED', CANCELLED: 'bring.CANCELLED' } as const;
const empty: BringContent = { title: '', from: '', to: '', dueDate: null, assigneeId: null, notes: '' };
const contentOf = (item: BringView): BringContent => ({ title: item.title, from: item.from, to: item.to, dueDate: item.dueDate, assigneeId: item.assigneeId, notes: item.notes });
export const bringContext = (item: Pick<BringView, 'from' | 'to' | 'dueDate'>) => [item.from || item.to ? [item.from, item.to].filter(Boolean).join(' → ') : '', item.dueDate === null ? '' : item.dueDate < todayIn(browserTimeZone()) ? t('bring.overdue', { date: formatCalendarDate(item.dueDate) }) : formatCalendarDate(item.dueDate)].filter(Boolean).join(' · ');
export function BringPage({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
 const [items, setItems] = useState<BringView[] | null>(null);
 const [members, setMembers] = useState<PersonRef[]>([]);
 const [places, setPlaces] = useState<string[]>([]);
 const [status, setStatus] = useState<BringStatus>('OPEN');
 const [filter, setFilter] = useState('ALL');
 const [offset, setOffset] = useState(0);
 const [total, setTotal] = useState(0);
 const [editor, setEditor] = useState<{ item?: BringView; content: BringContent; original: string } | null>(null);
 const [message, setMessage] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 const [refresh, setRefresh] = useState(0);
 const [notice, setNotice] = useState<Undoable | null>(null);
 const dirty = editor !== null && JSON.stringify(editor.content) !== editor.original;
 const leave = useCallback(() => !dirty || window.confirm(t('bring.unsaved')), [dirty]);
 useEffect(() => {
  setNavigationGuard(leave);
  const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  return () => { setNavigationGuard(null); window.removeEventListener('beforeunload', warn); };
 }, [dirty, leave]);
 const load = useCallback(() => { setItems(null); setRefresh(value => value + 1); }, []);
 useEffect(() => {
  let active = true;
  api.bring(workspaceId, status, filter, offset).then(result => {
   if (active) { setItems(result.items); setPlaces(result.places); setTotal(result.total); }
  }, (error: unknown) => { if (active) { setItems(null); setMessage(messageFor(error)); } });
  return () => { active = false; };
 }, [workspaceId, status, filter, offset, refresh]);
 useEffect(() => { if (canManage) api.members(workspaceId).then(rows => setMembers(rows.filter(row => row.status === 'ACTIVE').map(row => ({ id: row.userId, name: row.displayName }))), () => undefined); }, [workspaceId, canManage]);
 async function act(action: () => Promise<BringView>, undo?: (result: BringView) => Promise<BringView>, text: 'bring.completed' | 'bring.restore' = 'bring.completed') {
  if (busy) return;
  setBusy(true); setMessage(null);
  try {
   const result = await action();
   if (undo !== undefined) setNotice({ message: t(text), undo: () => { void act(() => undo(result)); } });
   load();
  } catch (error) { setMessage(messageFor(error)); load(); }
  finally { setBusy(false); }
 }
 const groups = Map.groupBy(items ?? [], item => item.to || t('bring.noDestination'));
 return <section className="stack bring" aria-labelledby="bring-heading">
  <div className="page-header"><h2 id="bring-heading">{t('bring.heading')}</h2></div>
  {message !== null && <p role="alert">{message}</p>}
  {editor !== null ? <form className="card stack" onSubmit={event => {
   event.preventDefault(); if (busy) return; setBusy(true); setMessage(null);
   api.saveBring(workspaceId, editor.content, editor.item).then(() => { setEditor(null); return load(); }, (error: unknown) => setMessage(messageFor(error))).finally(() => setBusy(false));
  }}>
   <fieldset className="stack" disabled={busy}><legend>{t(editor.item === undefined ? 'bring.new' : 'bring.edit')}</legend>
    <label>{t('bring.title')}<input required maxLength={120} value={editor.content.title} onChange={e => setEditor({ ...editor, content: { ...editor.content, title: e.target.value } })} /></label>
    <details open={editor.item !== undefined}><summary>{t('bring.options')}</summary><div className="stack">
     {(['from', 'to'] as const).map(key => <label key={key}>{t(key === 'from' ? 'bring.from' : 'bring.to')}<input maxLength={80} list="bring-places" value={editor.content[key]} onChange={e => setEditor({ ...editor, content: { ...editor.content, [key]: e.target.value } })} /></label>)}
     <datalist id="bring-places">{places.map(place => <option key={place} value={place} />)}</datalist>
     <label>{t('bring.dueDate')}<input type="date" value={editor.content.dueDate ?? ''} onChange={e => setEditor({ ...editor, content: { ...editor.content, dueDate: e.target.value || null } })} /></label>
     <label>{t('bring.assignee')}<select value={editor.content.assigneeId ?? ''} onChange={e => setEditor({ ...editor, content: { ...editor.content, assigneeId: e.target.value || null } })}><option value="">{t('bring.unassigned')}</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
     <label>{t('bring.notes')}<textarea maxLength={2000} value={editor.content.notes} onChange={e => setEditor({ ...editor, content: { ...editor.content, notes: e.target.value } })} /></label>
    </div></details>
    <div className="row wrap"><button type="submit" className="primary">{t('bring.save')}</button><button type="button" onClick={() => { if (leave()) setEditor(null); }}>{t('bring.cancel')}</button></div>
   </fieldset>
  </form> : <>
   <div className="row wrap">{canManage && <button type="button" className="primary" onClick={() => setEditor({ content: { ...empty }, original: JSON.stringify(empty) })}>{t('bring.new')}</button>}
    <label>{t('bring.history')}<select disabled={busy} aria-label={t('bring.history')} value={status} onChange={e => { setItems(null); setStatus(e.target.value as BringStatus); setOffset(0); }}>{(['OPEN', 'COMPLETED', 'CANCELLED'] as const).map(value => <option value={value} key={value}>{t(STATUS_LABEL[value])}</option>)}</select></label>
    <label>{t('bring.assignee')}<select disabled={busy} aria-label={t('bring.assignee')} value={filter} onChange={e => { setItems(null); setFilter(e.target.value); setOffset(0); }}><option value="ALL">{t('bring.all')}</option><option value="MINE">{t('bring.mine')}</option><option value="SHARED">{t('bring.shared')}</option></select></label>
   </div>
   {items === null ? <p>{message === null ? t('common.loading') : ''}</p> : items.length === 0 ? <p className="muted">{t('bring.empty')}</p> : [...groups].map(([destination, rows]) => <section className="stack" key={destination}><h3>{destination}</h3><ul className="plain-list stack">{rows.map(item => <li className="card stack" key={item.id}>
    <div className="row wrap"><div className="item-body"><strong>{item.title}</strong><small>{bringContext(item)}</small>{item.assigneeId !== null && <small>{item.assigneeName ?? t('bring.assignee')}</small>}</div>
    {canManage && item.status === 'OPEN' && <button type="button" disabled={busy} aria-label={t('bring.doneNamed', { title: item.title })} onClick={() => void act(() => api.bringStatus(workspaceId, item, 'COMPLETED'), result => api.bringStatus(workspaceId, result, 'OPEN'))}>{t('bring.done')}</button>}
    {canManage && <details><summary aria-label={t('bring.edit')}>⋯</summary><div className="stack">
     {item.status === 'OPEN' ? <><button type="button" disabled={busy} onClick={() => { const content = contentOf(item); setEditor({ item, content, original: JSON.stringify(content) }); }}>{t('bring.edit')}</button><button type="button" disabled={busy} onClick={() => void act(() => api.bringStatus(workspaceId, item, 'CANCELLED'))}>{t('bring.cancel')}</button></> : <button type="button" disabled={busy} onClick={() => void act(() => api.bringStatus(workspaceId, item, 'OPEN'))}>{t('bring.reopen')}</button>}
     <button type="button" disabled={busy} onClick={() => void act(() => api.bringDelete(workspaceId, item), result => api.bringDelete(workspaceId, result, true), 'bring.restore')}>{t('bring.delete')}</button>
    </div></details>}</div>
    {item.notes && <details><summary>{t('bring.notes')}</summary><p className="journal-note">{item.notes}</p></details>}
    {item.status !== 'OPEN' && <small>{t(STATUS_LABEL[item.status])} · {t('bring.attribution', { name: item.completedBy ?? item.cancelledBy ?? item.updatedBy, date: formatDateTime(item.completedAt ?? item.cancelledAt ?? item.updatedAt) })}</small>}
   </li>)}</ul></section>)}
   <div className="row wrap">{offset > 0 && <button type="button" onClick={() => { setItems(null); setOffset(Math.max(0, offset - 30)); }}>{t('bring.previous')}</button>}{offset + 30 < total && <button type="button" onClick={() => { setItems(null); setOffset(offset + 30); }}>{t('bring.more')}</button>}</div>
  </>}
  <UndoNotice notice={notice} onDismiss={() => setNotice(null)} />
 </section>;
}
