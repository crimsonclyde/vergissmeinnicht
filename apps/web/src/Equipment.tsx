import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, messageFor, type DocumentLink, type EquipmentFilters, type EquipmentRecord, type ScheduleInput, type TrashedEquipment } from './api.ts';
import { ContactPicker } from './ContactPicker.tsx';
import { DocumentPicker, hrefOf, RemindDialog } from './DocumentLinks.tsx';
import { statusLabel } from './maintenance-model.ts';
import { linkedKind, linkedRecordText } from './document-model.ts';
import { handOver, handedOver, clearHandOver } from './handoff.ts';
import { FormDialog } from './FormDialog.tsx';
import { formatCalendarDate, formatRelativeDay, t } from './i18n/index.ts';
import { Link, navigate, paths, type Route } from './router.tsx';
import { ScheduleDialog } from './ScheduleDialog.tsx';
import { MoreMenu } from './MoreMenu.tsx';
import { UiIcon } from './ui-icons.tsx';
import { EquipmentForm, EQUIPMENT_FIELDS } from './EquipmentForm.tsx';
import { MaintenanceAreaHead, MaintenanceCover } from './MaintenanceArea.tsx';
import { localDate } from './Timeline.tsx';
const VIEW_KEY = 'vmn.equipmentView';
/** A stable tint per category, so a kind of equipment keeps its colour; decoration only. */
const toneOf = (category: string) => String([...category].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 5);
/** "in 40 days" while a warranty ends within 90 days. */
function warrantySoon(record: EquipmentRecord, today: string, limit: string): string | null {
  if (record.warrantyExpiry === null) return null;
  return record.warrantyExpiry >= today && record.warrantyExpiry <= limit ? formatRelativeDay(record.warrantyExpiry, today) : null;
}
const FIELDS = EQUIPMENT_FIELDS;
const contextOf = (record: EquipmentRecord) => [record.category, record.location].filter(Boolean).join(' · ');
type Props = {
    workspaceId: string;
    route: Extract<Route, {
        page: 'equipment';
    }>;
    canManage: boolean;
    canPurge: boolean;
    canSchedule: boolean;
    tools: readonly string[];
};
function PickLink(props: {
    workspaceId: string;
    kind: string;
    exclude: readonly string[];
    onClose: () => void;
    onLink: (id: string) => Promise<void>;
}) {
    const id = useId();
    const [selected, setSelected] = useState('');
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState<readonly {
        id: string;
        name: string;
    }[] | null>(null);
    useEffect(() => {
        if (props.kind === 'document' || props.kind === 'contact')
            return;
        let active = true;
        const q = new URLSearchParams(query.trim() === '' ? {} : { q: query }).toString();
        const load = props.kind === 'maintenance' ? api.maintenance(props.workspaceId, q).then(page => page.records.map(r => ({ id: r.id, name: r.title }))) : props.kind === 'equipment' ? api.equipment(props.workspaceId, q).then(page => page.records.map(r => ({ id: r.id, name: r.name }))) : api.procedures(props.workspaceId).then(rows => rows.filter(r => query === '' || r.title.toLowerCase().includes(query.toLowerCase())).map(r => ({ id: r.id, name: r.title })));
        load.then(rows => active && setOptions(rows), () => active && setOptions([]));
        return () => { active = false; };
    }, [props.workspaceId, props.kind, query]);
    return <FormDialog title={t('equipment.linkHeading')} submitLabel={t('links.addConfirm')} submitDisabled={selected === ''} onClose={props.onClose} onSubmit={() => props.onLink(selected)}>
  {props.kind === 'contact' ? <ContactPicker workspaceId={props.workspaceId} value={selected} exclude={props.exclude} onChange={setSelected}/> : props.kind === 'document' ? <DocumentPicker workspaceId={props.workspaceId} value={selected} exclude={props.exclude} onChange={setSelected}/> : <><div className="field"><label htmlFor={`${id}-q`}>{t('equipment.search')}</label><input id={`${id}-q`} type="search" maxLength={100} value={query} onChange={e => { setQuery(e.target.value); setSelected(''); }}/></div><div className="field"><label htmlFor={`${id}-select`}>{t('equipment.chooseRecord')}</label><select id={`${id}-select`} value={selected} onChange={e => setSelected(e.target.value)}><option value="">{t(options === null ? 'common.loading' : 'links.pick.choose')}</option>{(options ?? []).filter(r => !props.exclude.includes(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div></>}
 </FormDialog>;
}
/** Used from Maintenance as well; a Link is the only relation, never a change to either record. */
export function EquipmentPickerDialog(props: {
    workspaceId: string;
    exclude: readonly string[];
    onClose: () => void;
    onLink: (id: string) => Promise<void>;
}) {
    return <PickLink {...props} kind="equipment"/>;
}
/** What an Equipment record can be linked to, each offered only while its tool is on. */
const LINK_KINDS = [['document', 'DOCUMENTS'], ['contact', 'CONTACTS'], ['maintenance', 'MAINTENANCE'], ['procedure', 'PROCEDURES']] as const;

export function Equipment(props: Props) {
    const { workspaceId, route } = props;
    const id = useId();
    const [records, setRecords] = useState<readonly EquipmentRecord[] | null>(null);
    const [record, setRecord] = useState<EquipmentRecord | null>(null);
    const [trash, setTrash] = useState<readonly TrashedEquipment[] | null>(null);
    const [filters, setFilters] = useState<EquipmentFilters | null>(null);
    const [links, setLinks] = useState<readonly DocumentLink[]>([]);
    const [next, setNext] = useState<string | null>(null);
    const [find, setFind] = useState({ q: '', category: '', location: '', manufacturer: '' });
    const [message, setMessage] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [dialog, setDialog] = useState<string | null>(null);
    const [purge, setPurge] = useState<TrashedEquipment | 'all' | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [days] = useState(() => ({ today: localDate(new Date()), limit: localDate(new Date(Date.now() + 90 * 86_400_000)) }));
    const [view, setView] = useState<'CARDS' | 'LIST'>(() => { try { return window.localStorage.getItem(VIEW_KEY) === 'LIST' ? 'LIST' : 'CARDS'; } catch { return 'CARDS'; } });
    const [removed, setRemoved] = useState<{
        id: string;
        name: string;
    } | null>(() => { const saved = handedOver<{
        workspaceId: string;
        id: string;
        name: string;
    }>('deleted-equipment'); return saved?.workspaceId === workspaceId ? saved : null; });
    const [warrantyChanged, setWarrantyChanged] = useState(false);
    const [schedule, setSchedule] = useState<{
        id: string;
        revision: number;
        input: ScheduleInput;
    } | null>(null);
    useEffect(() => clearHandOver('deleted-equipment'), []);
    const request = useRef(0);
    const query = useCallback((cursor?: string) => new URLSearchParams([...Object.entries(find).filter(([, v]) => v !== ''), ...(cursor === undefined ? [] : [['cursor', cursor]])]).toString(), [find]);
    const load = useCallback(() => {
        const current = ++request.current;
        const work = route.view === 'trash' ? api.equipmentTrash(workspaceId).then(rows => { if (current === request.current)
            setTrash(rows); }) : route.recordId !== null ? Promise.all([api.equipmentRecord(workspaceId, route.recordId), api.equipmentLinks(workspaceId, route.recordId)]).then(([r, l]) => { if (current === request.current) {
            setRecord(r);
            setLinks(l);
        } }) : api.equipment(workspaceId, query()).then(page => { if (current === request.current) {
            setRecords(page.records);
            setNext(page.nextCursor);
        } });
        work.then(() => current === request.current && setMessage(null), (caught: unknown) => current === request.current && setMessage(messageFor(caught)));
        api.equipmentFilters(workspaceId).then(f => current === request.current && setFilters(f), () => undefined);
    }, [workspaceId, route.view, route.recordId, query]);
    useEffect(() => { const timer = window.setTimeout(load, find.q === '' ? 0 : 250); return () => { window.clearTimeout(timer); }; }, [load, find.q]);
    useEffect(() => { const timer = window.setInterval(() => { if (document.visibilityState === 'visible' && dialog === null)
        load(); }, 30000); return () => window.clearInterval(timer); }, [load, dialog]);
    const fail = (caught: unknown) => setMessage(messageFor(caught));
    const saved = (r: EquipmentRecord) => {
        setWarrantyChanged(record !== null && record.warrantyExpiry !== r.warrantyExpiry && links.some(l => l.record.type === 'schedule' && l.record.scheduleKind === 'REMINDER'));
        setDialog(null);
        setStatus(t('equipment.saved'));
        setRecord(r);
        navigate(paths.equipmentRecord(workspaceId, r.id), { force: true });
        load();
    };
    async function reviewReminder(link: DocumentLink) {
        try {
            const loaded = (await api.schedules(workspaceId)).find(s => s.id === link.record.id);
            if (loaded === undefined)
                throw new Error(t('shell.notFound'));
            setSchedule({ id: loaded.id, revision: loaded.revision, input: { title: loaded.title, description: loaded.description, date: warrantyChanged ? (record?.warrantyExpiry ?? loaded.date) : loaded.date, time: loaded.time, timeZone: loaded.timeZone, recurrence: loaded.recurrence, reminders: loaded.reminders, assigneeUserId: loaded.assignee?.id ?? null } });
        }
        catch (caught) {
            fail(caught);
        }
    }
    const heading = route.view === 'trash' ? t('equipment.trash') : record?.name ?? t('shell.equipment');
    const chip = (key: 'category' | 'location', value: string) => setFind({ ...find, [key]: find[key] === value ? '' : value });
    const choose = (next: 'CARDS' | 'LIST') => { setView(next); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* a convenience only */ } };
    return <section className="area equipment-page" aria-labelledby={`${id}-heading`}>
  {route.view !== 'overview' && <p className="back-row"><Link href={paths.equipment(workspaceId)} className="back-link"><UiIcon name="back" /> {t('shell.equipment')}</Link></p>}
  {route.view === 'overview' ? <MaintenanceAreaHead workspaceId={workspaceId} current="equipment" headingId={`${id}-heading`} count={records !== null && next === null ? records.length : null} lead={t('equipment.referenceHint')}>
   {props.canManage && <><Link className="area-round" href={paths.equipmentTrash(workspaceId)} aria-label={t('equipment.trash')} title={t('equipment.trash')}><UiIcon name="trash" /></Link><button className="primary" type="button" onClick={() => setDialog('edit')}><UiIcon name="add" /> {t('equipment.add')}</button></>}
  </MaintenanceAreaHead> : <div className="page-header"><h2 id={`${id}-heading`} className="area-heading">{heading}</h2><div className="row">
   {record !== null && route.view === 'record' && props.canManage && <><button type="button" onClick={() => setDialog('edit')}><UiIcon name="edit" /> {t('equipment.edit')}</button><MoreMenu label={t('equipment.moreActionsNamed', { name: record.name })} items={[{ label: t('equipment.delete'), danger: true, onSelect: () => setDialog('delete') }]} /></>}
  </div></div>}
  {message !== null && <p role="alert">{message}</p>}{status !== null && <p role="status">{status}</p>}
  {removed !== null && <p role="status">{t('equipment.deleted', { name: removed.name })} <button type="button" onClick={() => void api.restoreEquipment(workspaceId, removed.id).then(() => { setRemoved(null); load(); }, fail)}>{t('common.undo')}</button></p>}
  {route.view === 'overview' && <>
   <MaintenanceCover workspaceId={workspaceId} equipment={records} />
   <div className="ma-find" role="search" aria-label={t('equipment.search')}>
    <div className="ma-find-row">
     <label className="ma-search"><UiIcon name="search" /><input id={`${id}-search`} type="search" maxLength={100} aria-label={t('equipment.search')} placeholder={t('equipment.searchHint')} value={find.q} onChange={e => setFind({ ...find, q: e.target.value })}/></label>
     <div className="ma-segment" role="group" aria-label={t('documents.find.view')}>
      <button type="button" aria-pressed={view === 'CARDS'} aria-label={t('equipment.view.cards')} title={t('equipment.view.cards')} onClick={() => choose('CARDS')}><UiIcon name="grid" /></button>
      <button type="button" aria-pressed={view === 'LIST'} aria-label={t('equipment.view.list')} title={t('equipment.view.list')} onClick={() => choose('LIST')}><UiIcon name="lists" /></button>
     </div>
    </div>
    {((filters?.categories.length ?? 0) > 0 || (filters?.locations.length ?? 0) > 0) && <div className="ma-chips" role="group" aria-label={t('documents.find.filters')}>
     <button type="button" aria-pressed={find.category === '' && find.location === ''} onClick={() => setFind({ ...find, category: '', location: '' })}>{t('equipment.all')}</button>
     {filters?.categories.map(value => <button key={`c-${value}`} type="button" aria-pressed={find.category === value} onClick={() => chip('category', value)}>{value}</button>)}
     {(filters?.locations.length ?? 0) > 0 && (filters?.categories.length ?? 0) > 0 && <span className="ma-chips-rule" aria-hidden="true" />}
     {filters?.locations.map(value => <button key={`l-${value}`} type="button" data-kind="place" aria-pressed={find.location === value} aria-label={t('equipment.placeChip', { place: value })} onClick={() => chip('location', value)}><UiIcon name="place" /> {value}</button>)}
    </div>}
    {(filters?.manufacturers.length ?? 0) > 0 && <details className="calendar-filter-box" open={filtersOpen} onToggle={e => setFiltersOpen(e.currentTarget.open)}><summary>{t('equipment.field.manufacturer')}</summary><div className="filter-bar">
     <div className="field"><label htmlFor={`${id}-filter-manufacturer`}>{t('equipment.field.manufacturer')}</label><select id={`${id}-filter-manufacturer`} value={find.manufacturer} onChange={e => setFind({ ...find, manufacturer: e.target.value })}><option value="">{t('equipment.all')}</option>{filters?.manufacturers.map(value => <option key={value} value={value}>{value}</option>)}</select></div>
    </div></details>}
   </div>
   {records === null ? message === null && <p>{t('common.loading')}</p> : records.length === 0 ? <p className="ma-glance-calm">{t('equipment.none')}</p> : view === 'CARDS'
    ? <ul className="plain-list ma-cards">{records.map(r => { const warranty = warrantySoon(r, days.today, days.limit); return <li key={r.id}><Link href={paths.equipmentRecord(workspaceId, r.id)} className="ma-card" data-tone={toneOf(r.category)}><span className="ma-card-art"><UiIcon name="equipment" />{warranty !== null && <span className="ma-card-badge"><UiIcon name="security" /> {warranty}</span>}</span><span className="ma-card-body">{r.category !== '' && <small>{r.category}</small>}<strong>{r.name}</strong>{(r.manufacturer || r.model) && <span className="equipment-model">{[r.manufacturer, r.model].filter(Boolean).join(' · ')}</span>}{r.replacementParts && <small className="equipment-parts-preview">{r.replacementParts}</small>}{r.location !== '' && <span className="ma-card-place"><UiIcon name="place" /> {r.location}</span>}</span></Link></li>; })}</ul>
    : <ul className="plain-list area-rows ma-rows">{records.map(r => <li key={r.id}><Link href={paths.equipmentRecord(workspaceId, r.id)} className="area-row"><span className="area-row-icon"><UiIcon name="equipment" /></span><span className="item-body"><strong>{r.name}</strong>{[[r.manufacturer, r.model].filter(Boolean).join(' · '), contextOf(r)].filter(Boolean).length > 0 && <small className="muted">{[[r.manufacturer, r.model].filter(Boolean).join(' · '), contextOf(r)].filter(Boolean).join(' — ')}</small>}</span><UiIcon name="chevron" /></Link></li>)}</ul>}
   {next !== null && <div className="area-more"><button type="button" className="area-round" onClick={() => void api.equipment(workspaceId, query(next)).then(page => { setRecords([...(records ?? []), ...page.records]); setNext(page.nextCursor); }, fail)}>{t('equipment.more')}</button></div>}
  </>}
  {route.view === 'record' && record !== null && <>
   <EquipmentReference record={record} warranty={warrantySoon(record, days.today, days.limit)} onStatus={setStatus} />
   {(FIELDS.some(key => !['name', 'manufacturer', 'model', 'replacementParts'].includes(key) && Boolean(record[key])) || record.customFields.length > 0) && <dl className="card card-facts document-facts">{FIELDS.filter(key => !['name', 'manufacturer', 'model', 'replacementParts'].includes(key) && record[key]).map(key => <div key={key}><dt>{t(`equipment.field.${key}`)}</dt><dd className="equipment-value">{key === 'purchaseDate' || key === 'warrantyExpiry' ? formatCalendarDate(record[key] ?? '') : record[key]}</dd></div>)}{record.customFields.map(field => <div key={field.label}><dt>{field.label}</dt><dd className="equipment-value">{field.value}</dd></div>)}</dl>}
   <h3>{t('equipment.linked')}</h3>
   {warrantyChanged && props.canSchedule && props.tools.includes('REMINDERS') && <p role="status">{t('equipment.warrantyChanged')}</p>}
   {links.length > 0 && <ul className="card plain-list">{links.map(link => { const text = linkedRecordText(link.record); const href = hrefOf(workspaceId, link.record); return <li key={link.id} className="link-line"><span className="item-body"><span><small className="muted">{linkedKind(link.record)}: </small>{text.open && href !== null ? <Link href={href}>{text.title}</Link> : text.title}</span>{link.record.maintenanceDate !== undefined && <small className="muted">{formatCalendarDate(link.record.maintenanceDate)} · {link.record.maintenanceStatus === undefined ? '' : statusLabel(link.record.maintenanceStatus)}</small>}{text.note !== null && <small className="muted">{text.note}</small>}</span><span className="row">{props.canManage && <button type="button" className="quiet icon-button" title={t('equipment.unlink')} aria-label={t('equipment.unlinkNamed', { name: text.title })} onClick={() => void (link.sourceType === 'maintenance' ? api.removeMaintenanceLink(workspaceId, link.id) : api.removeEquipmentLink(workspaceId, link.id)).then(load, fail)}><UiIcon name="unlink" /></button>}{link.record.type === 'schedule' && link.record.scheduleKind === 'REMINDER' && props.canSchedule && <button type="button" onClick={() => void reviewReminder(link)}>{t('equipment.reviewReminder')}</button>}</span></li>; })}</ul>}
   {props.canManage && <div className="row section-actions"><MoreMenu label={t('links.add')} buttonText={<><UiIcon name="link" /> {t('links.add')}</>} items={LINK_KINDS.filter(([, tool]) => props.tools.includes(tool)).map(([kind]) => ({ label: t(`equipment.link.${kind}`), onSelect: () => setDialog(kind) }))} /></div>}
   {props.canManage && props.canSchedule && (props.tools.includes('REMINDERS') || props.tools.includes('PROCEDURES')) && <div className="row"><button type="button" onClick={() => setDialog('remind')}><UiIcon name="reminders" /> {t('links.remind.button')}</button>{props.tools.includes('REMINDERS') && record.warrantyExpiry !== null && <button type="button" onClick={() => setDialog('warranty')}><UiIcon name="reminders" /> {t('equipment.warrantyReminder')}</button>}</div>}
  </>}
  {route.view === 'trash' && <>
   {props.canPurge && (trash?.length ?? 0) > 0 && <button type="button" onClick={() => setPurge('all')}>{t('contacts.purge.all')}</button>}
   {trash === null ? message === null && <p>{t('common.loading')}</p> : <ul className="plain-list">{trash.map(r => <li key={r.id} className="card"><strong>{r.name}</strong><div className="row"><button type="button" onClick={() => void api.restoreEquipment(workspaceId, r.id).then(load, fail)}>{t('equipment.restore')}</button>{props.canPurge && <button type="button" onClick={() => setPurge(r)}>{t('documents.purge.one')}</button>}</div></li>)}</ul>}
  </>}
  {dialog === 'edit' && <EquipmentForm workspaceId={workspaceId} record={route.view === 'record' ? record : null} filters={filters} onClose={() => setDialog(null)} onSaved={saved}/>}
  {dialog === 'delete' && record !== null && <FormDialog title={t('equipment.delete')} submitLabel={t('equipment.delete')} danger onClose={() => setDialog(null)} onSubmit={async () => { await api.deleteEquipment(workspaceId, record.id); handOver('deleted-equipment', { workspaceId, id: record.id, name: record.name }); setRemoved({ id: record.id, name: record.name }); setDialog(null); setRecord(null); navigate(paths.equipment(workspaceId)); load(); }}><p>{t('equipment.deleteHint')}</p></FormDialog>}
  {purge !== null && <FormDialog title={t('equipment.purge')} submitLabel={t('documents.purge.confirm')} danger onClose={() => setPurge(null)} onSubmit={async () => { await api.purgeEquipment(workspaceId, purge === 'all' ? 'all' : [purge.id]); setPurge(null); load(); }}><p>{t('documents.purge.cannotUndo')}</p><p>{t('contacts.purge.backups')}</p><p>{t('equipment.purgeHint')}</p></FormDialog>}
  {record !== null && dialog !== null && ['document', 'contact', 'maintenance', 'procedure'].includes(dialog) && <PickLink workspaceId={workspaceId} kind={dialog} exclude={links.filter(l => l.record.type === dialog).map(l => l.record.id)} onClose={() => setDialog(null)} onLink={async (targetId) => { await api.addEquipmentLink(workspaceId, record.id, { type: dialog, id: targetId }); setDialog(null); load(); }}/>}
  {dialog === 'remind' && record !== null && <RemindDialog workspaceId={workspaceId} suggestedTitle={record.name} link={scheduleId => api.addEquipmentLink(workspaceId, record.id, { type: 'schedule', id: scheduleId })} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }}/>}
  {dialog === 'warranty' && record !== null && <ScheduleDialog kind="REMINDER" suggestedTitle={t('equipment.warrantyTitle', { name: record.name }).slice(0, 120)} {...(record.warrantyExpiry === null ? {} : { suggestedDate: record.warrantyExpiry })} suggestedReminders={[{ unit: 'MONTHS', amount: 1 }]} members={null} onClose={() => setDialog(null)} onSubmit={async (input) => { const created = await api.createSchedule(workspaceId, input); await api.addEquipmentLink(workspaceId, record.id, { type: 'schedule', id: created.id }); setDialog(null); load(); }}/>}
  {schedule !== null && <ScheduleDialog kind="REMINDER" initial={schedule.input} members={null} onClose={() => setSchedule(null)} onSubmit={async (input) => { await api.updateSchedule(workspaceId, schedule.id, schedule.revision, input); setSchedule(null); setWarrantyChanged(false); load(); }}/>}
 </section>;
}

function EquipmentReference({ record, warranty, onStatus }: { record: EquipmentRecord; warranty: string | null; onStatus: (text: string) => void }) {
  async function copy(value: string) {
    try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(value); onStatus(t('equipment.copied')); }
    catch { onStatus(t('equipment.copyFallback')); }
  }
  return <article className="card equipment-reference ma-card ma-ref" data-tone={toneOf(record.category)}><span className="ma-card-art" aria-hidden="true"><UiIcon name="equipment" />{warranty !== null && <span className="ma-card-badge"><UiIcon name="security" /> {warranty}</span>}</span><div className="ma-ref-inner"><div className="equipment-reference-heading"><span className="equipment-reference-icon"><UiIcon name="equipment" size="2em" /></span><div><p className="muted">{t('equipment.identity')}</p><h3>{[record.manufacturer, record.model].filter(Boolean).join(' · ') || t('equipment.identityMissing')}</h3></div>{record.model && <button type="button" onClick={() => void copy(record.model)}><UiIcon name="paste" /> {t('equipment.copyModel')}</button>}</div>{record.replacementParts && <div className="equipment-replacement"><h3>{t('equipment.field.replacementParts')}</h3><p className="equipment-value">{record.replacementParts}</p><button type="button" className="quiet" onClick={() => void copy(record.replacementParts)}><UiIcon name="paste" /> {t('equipment.copyParts')}</button></div>}</div></article>;
}
