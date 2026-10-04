import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, messageFor, type DocumentLink, type EquipmentFilters, type EquipmentInput, type EquipmentRecord, type ScheduleInput, type TrashedEquipment } from './api.ts';
import { ContactPicker } from './ContactPicker.tsx';
import { DocumentPicker, hrefOf, RemindDialog } from './DocumentLinks.tsx';
import { statusLabel } from './maintenance-model.ts';
import { linkedKind, linkedRecordText } from './document-model.ts';
import { handOver, handedOver, clearHandOver } from './handoff.ts';
import { FormDialog } from './FormDialog.tsx';
import { formatCalendarDate, t } from './i18n/index.ts';
import { Link, navigate, paths, type Route } from './router.tsx';
import { ScheduleDialog } from './ScheduleDialog.tsx';
const FIELDS = ['name', 'category', 'location', 'manufacturer', 'model', 'serialNumber', 'purchaseDate', 'warrantyExpiry', 'notes'] as const;
const empty = (): EquipmentInput => ({ name: '', category: '', location: '', manufacturer: '', model: '', serialNumber: '', purchaseDate: null, warrantyExpiry: null, notes: '' });
const contentOf = (record: EquipmentRecord): EquipmentInput => Object.fromEntries(FIELDS.map(key => [key, record[key]])) as unknown as EquipmentInput;
const contextOf = (record: EquipmentRecord) => [record.category, record.location, record.manufacturer].filter(Boolean).join(' · ');
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
function EquipmentForm(props: {
    workspaceId: string;
    record: EquipmentRecord | null;
    filters: EquipmentFilters | null;
    onClose: () => void;
    onSaved: (record: EquipmentRecord) => void;
}) {
    const id = useId();
    const [form, setForm] = useState<EquipmentInput>(() => props.record === null ? empty() : contentOf(props.record));
    return <FormDialog title={t(props.record === null ? 'equipment.add' : 'equipment.edit')} submitLabel={t('maintenance.save')} submitDisabled={form.name.trim() === ''} onClose={props.onClose} onSubmit={async () => props.onSaved(props.record === null ? await api.createEquipment(props.workspaceId, form) : await api.updateEquipment(props.workspaceId, props.record.id, form, props.record.revision))}>
  {FIELDS.map(key => {
            const suggestions = key === 'category' ? props.filters?.categories : key === 'location' ? props.filters?.locations : key === 'manufacturer' ? props.filters?.manufacturers : undefined;
            return <div className="field" key={key}><label htmlFor={`${id}-${key}`}>{t(`equipment.field.${key}`)}{key === 'name' && <span className="muted"> · {t('common.required')}</span>}</label>
    {key === 'notes' ? <textarea id={`${id}-${key}`} rows={4} maxLength={4000} value={form[key] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value })}/> : <input id={`${id}-${key}`} type={key === 'purchaseDate' || key === 'warrantyExpiry' ? 'date' : 'text'} required={key === 'name'} maxLength={key === 'category' ? 60 : 200} list={suggestions === undefined ? undefined : `${id}-${key}-suggestions`} value={form[key] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value })}/>}
    {suggestions !== undefined && <datalist id={`${id}-${key}-suggestions`}>{suggestions.map(value => <option key={value} value={value}/>)}</datalist>}
   </div>;
        })}
 </FormDialog>;
}
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
        navigate(paths.equipmentRecord(workspaceId, r.id));
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
    return <section aria-labelledby={`${id}-heading`}>
  <div className="page-header"><h2 id={`${id}-heading`}>{heading}</h2><div className="row">
   {route.view !== 'overview' && <Link href={paths.equipment(workspaceId)}>{t('shell.equipment')}</Link>}
   {route.view === 'overview' && props.canManage && <><button className="primary" type="button" onClick={() => setDialog('edit')}>{t('equipment.add')}</button><Link href={paths.equipmentTrash(workspaceId)}>{t('equipment.trash')}</Link></>}
   {record !== null && route.view === 'record' && props.canManage && <><button type="button" onClick={() => setDialog('edit')}>{t('equipment.edit')}</button><button type="button" onClick={() => setDialog('delete')}>{t('equipment.delete')}</button></>}
  </div></div>
  {message !== null && <p role="alert">{message}</p>}{status !== null && <p role="status">{status}</p>}
  {removed !== null && <p role="status">{t('equipment.deleted', { name: removed.name })} <button type="button" onClick={() => void api.restoreEquipment(workspaceId, removed.id).then(() => { setRemoved(null); load(); }, fail)}>{t('common.undo')}</button></p>}
  {route.view === 'overview' && <>
   <div className="filter-bar"><div className="field"><label htmlFor={`${id}-search`}>{t('equipment.search')}</label><input id={`${id}-search`} type="search" maxLength={100} value={find.q} onChange={e => setFind({ ...find, q: e.target.value })}/></div>
    {(['category', 'location', 'manufacturer'] as const).map(key => <div className="field" key={key}><label htmlFor={`${id}-filter-${key}`}>{t(`equipment.field.${key}`)}</label><select id={`${id}-filter-${key}`} value={find[key]} onChange={e => setFind({ ...find, [key]: e.target.value })}><option value="">{t('equipment.all')}</option>{(key === 'category' ? filters?.categories : key === 'location' ? filters?.locations : filters?.manufacturers)?.map(value => <option key={value} value={value}>{value}</option>)}</select></div>)}
   </div>
   {records === null ? message === null && <p>{t('common.loading')}</p> : records.length === 0 ? <p>{t('equipment.none')}</p> : <ul className="plain-list">{records.map(r => <li key={r.id} className="card"><Link href={paths.equipmentRecord(workspaceId, r.id)}><strong>{r.name}</strong></Link>{contextOf(r) !== '' && <p className="muted">{contextOf(r)}</p>}</li>)}</ul>}
   {next !== null && <button type="button" onClick={() => void api.equipment(workspaceId, query(next)).then(page => { setRecords([...(records ?? []), ...page.records]); setNext(page.nextCursor); }, fail)}>{t('equipment.more')}</button>}
  </>}
  {route.view === 'record' && record !== null && <>
   <dl className="card equipment-details">{FIELDS.filter(key => key !== 'name' && record[key]).map(key => <div key={key}><dt>{t(`equipment.field.${key}`)}</dt><dd className="equipment-value">{key === 'purchaseDate' || key === 'warrantyExpiry' ? formatCalendarDate(record[key] ?? '') : record[key]}</dd></div>)}</dl>
   <h3>{t('equipment.linked')}</h3>
   {warrantyChanged && props.canSchedule && props.tools.includes('REMINDERS') && <p role="status">{t('equipment.warrantyChanged')}</p>}
   <ul className="plain-list">{links.map(link => { const text = linkedRecordText(link.record); const href = hrefOf(workspaceId, link.record); return <li key={link.id} className="card"><small>{linkedKind(link.record)}</small><div>{text.open && href !== null ? <Link href={href}>{text.title}</Link> : text.title}</div>{link.record.maintenanceDate !== undefined && <p className="muted">{formatCalendarDate(link.record.maintenanceDate)} · {link.record.maintenanceStatus === undefined ? '' : statusLabel(link.record.maintenanceStatus)}</p>}{text.note !== null && <p className="muted">{text.note}</p>}{props.canManage && <button type="button" aria-label={t('equipment.unlinkNamed', { name: text.title })} onClick={() => void (link.sourceType === 'maintenance' ? api.removeMaintenanceLink(workspaceId, link.id) : api.removeEquipmentLink(workspaceId, link.id)).then(load, fail)}>{t('equipment.unlink')}</button>}{link.record.type === 'schedule' && link.record.scheduleKind === 'REMINDER' && props.canSchedule && <button type="button" onClick={() => void reviewReminder(link)}>{t('equipment.reviewReminder')}</button>}</li>; })}</ul>
   {props.canManage && <div className="row">{[['document', 'DOCUMENTS'], ['contact', 'CONTACTS'], ['maintenance', 'MAINTENANCE'], ['procedure', 'PROCEDURES']].filter(([, tool]) => props.tools.includes(tool ?? '')).map(([kind]) => <button type="button" key={kind} onClick={() => setDialog(kind ?? null)}>{t(`equipment.link.${kind as 'document' | 'contact' | 'maintenance' | 'procedure'}`)}</button>)}</div>}
   {props.canManage && props.canSchedule && (props.tools.includes('REMINDERS') || props.tools.includes('PROCEDURES')) && <div className="row"><button type="button" onClick={() => setDialog('remind')}>{t('links.remind.button')}</button>{props.tools.includes('REMINDERS') && record.warrantyExpiry !== null && <button type="button" onClick={() => setDialog('warranty')}>{t('equipment.warrantyReminder')}</button>}</div>}
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
