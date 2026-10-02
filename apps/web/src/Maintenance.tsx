import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  ApiError,
  api,
  messageFor,
  type ContactSummary,
  type DocumentLink,
  type MaintenanceColumn,
  type MaintenanceFilterValues,
  type MaintenanceRecord,
  type MaintenanceStatus,
  type MaintenanceSummary,
  type ProcedureCard,
  type RunSummary,
  type TrashedMaintenanceRecord,
} from './api.ts';
import { useContactsTool } from './contacts-tool.ts';
import { DocumentPicker, RemindDialog } from './DocumentLinks.tsx';
import { linkedKind, linkedRecordText } from './document-model.ts';
import { useDocumentsTool } from './documents-tool.ts';
import { FormDialog } from './FormDialog.tsx';
import { clearHandOver, handOver, handedOver } from './handoff.ts';
import { formatCalendarDate, formatDateTime, t } from './i18n/index.ts';
import {
  MAINTENANCE_LIMITS,
  STATUSES,
  STATUS_GLYPHS,
  STATUS_TONES,
  cardContext,
  costText,
  dateText,
  emptyMaintenanceForm,
  findCard,
  formOfRecord,
  inputOfForm,
  isMove,
  localToday,
  maintenanceListingParams,
  statusLabel,
  type MaintenanceForm,
} from './maintenance-model.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { Link, navigate, paths, type Route } from './router.tsx';
import { UiIcon } from './ui-icons.tsx';
import { UndoNotice } from './UndoNotice.tsx';

type MaintenanceRoute = Extract<Route, { page: 'maintenance' }>;

/** Other members' changes appear without reloading: the board asks this often while it is visible. */
const REFRESH_MS = 15_000;
const VIEW_KEY = 'vmn.maintenance.view';
const DRAG_TYPE = 'application/x-vmn-maintenance';

/** A record moved to Trash a moment ago: the page that follows offers to put it back. */
const DELETED_RECORD = 'deleted-maintenance';
interface DeletedRecord {
  readonly workspaceId: string;
  readonly recordId: string;
  readonly title: string;
}

/** The status as a word with its glyph — never colour alone. */
function StatusBadge({ status }: { status: MaintenanceStatus }) {
  return (
    <span className={`state-badge state-${STATUS_TONES[status]} maintenance-status`} data-status={status}>
      <span aria-hidden="true">{STATUS_GLYPHS[status]}</span> {statusLabel(status)}
    </span>
  );
}

/**
 * Changing a status, from wherever: one request that names the status and the revision the person
 * was looking at. Refused when someone else changed the record meanwhile — then the current state is
 * shown and nothing is overwritten. Completed gets the person's "today" as its completion date.
 */
function useStatusChange(workspaceId: string, onDone: (record: MaintenanceRecord, from: MaintenanceStatus) => void, onRefused: (message: string) => void) {
  return useCallback(
    (record: Pick<MaintenanceSummary, 'id' | 'revision' | 'status'>, to: MaintenanceStatus) => {
      if (record.status === to) return;
      api.setMaintenanceStatus(workspaceId, record.id, to, record.revision, to === 'COMPLETED' ? localToday() : undefined).then(
        (changed) => onDone(changed, record.status),
        (caught: unknown) => onRefused(caught instanceof ApiError && (caught.code === 'maintenance_conflict' || caught.code === 'maintenance_status_unchanged') ? t('maintenance.changedMeanwhile') : messageFor(caught)),
      );
    },
    [workspaceId, onDone, onRefused],
  );
}

/**
 * The status control: a labelled select on every card and on the record. It works with a keyboard, a
 * touch screen and a screen reader — dragging is a second way to do the same, never the only one.
 */
function StatusControl(props: { record: Pick<MaintenanceSummary, 'id' | 'title' | 'status' | 'revision'>; onChange: (to: MaintenanceStatus) => void }) {
  const id = useId();
  return (
    <span className="maintenance-status-control">
      <label htmlFor={id} className="visually-hidden">
        {t('maintenance.statusOf', { title: props.record.title })}
      </label>
      <select id={id} value={props.record.status} onChange={(event) => props.onChange(event.target.value as MaintenanceStatus)}>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_GLYPHS[status]} {statusLabel(status)}
          </option>
        ))}
      </select>
    </span>
  );
}

/** What a record says: only a title is required. The status is not here — it has its own control. */
function RecordDialog(props: { workspaceId: string; record: MaintenanceRecord | null; initialTitle?: string; filters: MaintenanceFilterValues | null; currencies: readonly string[]; onClose: () => void; onSaved: (record: MaintenanceRecord) => void }) {
  const id = useId();
  const contactsTool = useContactsTool();
  const { workspaceId, record } = props;
  const [form, setForm] = useState<MaintenanceForm>(() => (record === null ? emptyMaintenanceForm(props.initialTitle ?? '') : formOfRecord(record)));
  const [contacts, setContacts] = useState<readonly ContactSummary[] | null>(null);
  const set = (change: Partial<MaintenanceForm>) => setForm((current) => ({ ...current, ...change }));
  useEffect(() => {
    if (!contactsTool.enabled) return;
    api.contacts(workspaceId, '').then(
      (page) => setContacts(page.contacts),
      () => setContacts([]),
    );
  }, [workspaceId, contactsTool.enabled]);
  // The Contact already set stays choosable even when it is not on the first page of Contacts (or is deleted).
  const current = record?.contact ?? null;
  const options = [...(current !== null && !(contacts ?? []).some((contact) => contact.id === current.id) ? [{ id: current.id, name: current.name ?? t('contacts.deletedContact') }] : []), ...(contacts ?? []).map((contact) => ({ id: contact.id, name: contact.name }))];
  return (
    <FormDialog
      title={record === null ? t('maintenance.new.heading') : t('maintenance.edit.heading', { title: record.title })}
      submitLabel={t('maintenance.save')}
      submitDisabled={form.title.trim() === ''}
      onClose={props.onClose}
      onSubmit={async () => {
        const input = inputOfForm(form);
        props.onSaved(record === null ? await api.createMaintenance(workspaceId, input) : await api.updateMaintenance(workspaceId, record.id, input, record.revision));
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-title`}>
          {t('maintenance.field.title')} <span className="muted">{t('common.required')}</span>
        </label>
        <input id={`${id}-title`} required maxLength={MAINTENANCE_LIMITS.title} autoComplete="off" value={form.title} onChange={(event) => set({ title: event.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-category`}>{t('maintenance.field.category')}</label>
        <input id={`${id}-category`} maxLength={MAINTENANCE_LIMITS.category} list={`${id}-categories`} autoComplete="off" placeholder={t('maintenance.field.categoryExample')} value={form.category} onChange={(event) => set({ category: event.target.value })} />
        <datalist id={`${id}-categories`}>
          {(props.filters?.categories ?? []).map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
      </div>
      <div className="field">
        <label htmlFor={`${id}-date`}>{t('maintenance.field.date')}</label>
        <input id={`${id}-date`} type="date" min="1900-01-01" max="2200-12-31" value={form.date} aria-describedby={`${id}-date-hint`} onChange={(event) => set({ date: event.target.value })} />
        <small id={`${id}-date-hint`} className="muted">
          {t('maintenance.field.dateHint')}
        </small>
      </div>
      {contactsTool.enabled && (
        <div className="field">
          <label htmlFor={`${id}-contact`}>{t('maintenance.field.contact')}</label>
          <select id={`${id}-contact`} value={form.contactId} onChange={(event) => set({ contactId: event.target.value })}>
            <option value="">{contacts === null ? t('common.loading') : t('maintenance.field.noContact')}</option>
            {options.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <fieldset className="plain-fieldset">
        <legend>{t('maintenance.field.cost')}</legend>
        <div className="maintenance-cost-row">
          <div className="field">
            <label htmlFor={`${id}-amount`}>{t('maintenance.field.amount')}</label>
            <input id={`${id}-amount`} inputMode="decimal" maxLength={20} autoComplete="off" placeholder="120.00" value={form.amount} aria-describedby={`${id}-cost-hint`} onChange={(event) => set({ amount: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-currency`}>{t('maintenance.field.currency')}</label>
            <select id={`${id}-currency`} value={form.currency} onChange={(event) => set({ currency: event.target.value })}>
              {(props.currencies.length === 0 ? [form.currency] : props.currencies).map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
        </div>
        <small id={`${id}-cost-hint`} className="muted">
          {t('maintenance.field.costHint')}
        </small>
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-description`}>{t('maintenance.field.description')}</label>
        <textarea id={`${id}-description`} rows={4} maxLength={MAINTENANCE_LIMITS.description} value={form.description} onChange={(event) => set({ description: event.target.value })} />
      </div>
    </FormDialog>
  );
}

/** One card: the title (opens the record), one line of context, and the status control. Draggable for those who may change it. */
function Card(props: { workspaceId: string; record: MaintenanceSummary; canManage: boolean; onStatus: (to: MaintenanceStatus) => void; onDragging: (dragging: boolean) => void }) {
  const { record } = props;
  const context = cardContext(record);
  return (
    <li
      className="card maintenance-card"
      draggable={props.canManage}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, record.id);
        event.dataTransfer.setData('text/plain', record.title);
        event.dataTransfer.effectAllowed = 'move';
        props.onDragging(true);
      }}
      onDragEnd={() => props.onDragging(false)}
    >
      <Link href={paths.maintenanceRecord(props.workspaceId, record.id)} className="maintenance-card-title" draggable={false}>
        <strong>{record.title}</strong>
      </Link>
      {context !== '' && <small className="muted">{context}</small>}
      {props.canManage && <StatusControl record={record} onChange={props.onStatus} />}
    </li>
  );
}

/**
 * The board: one column per status — the four, never more. Dragging a card to another column changes
 * its status; so does the status control on the card. On a narrow screen one status is shown at a
 * time, chosen with the labelled switcher above; the page never scrolls sideways.
 */
function Board(props: { workspaceId: string; canManage: boolean; version: number; onAnnounce: (status: string, evidenceFor?: MaintenanceRecord) => void; onRefused: (message: string) => void }) {
  const { workspaceId, canManage } = props;
  const [columns, setColumns] = useState<readonly MaintenanceColumn[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [shown, setShown] = useState<MaintenanceStatus>('PLANNED');
  const [over, setOver] = useState<MaintenanceStatus | null>(null);
  const dragging = useRef(false);
  const load = useCallback(() => {
    api.maintenanceBoard(workspaceId).then(
      (loaded) => {
        setColumns(loaded);
        setMessage(null);
      },
      (caught: unknown) => setMessage(messageFor(caught)),
    );
  }, [workspaceId]);
  useEffect(load, [load, props.version]);
  useEffect(() => {
    // Not in the middle of a drag: the card under the pointer must not move away.
    const refresh = () => {
      if (document.visibilityState === 'visible' && !dragging.current) load();
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);
  const { onAnnounce, onRefused } = props;
  const change = useStatusChange(
    workspaceId,
    useCallback(
      (record: MaintenanceRecord) => {
        onAnnounce(t('maintenance.statusChanged', { title: record.title, status: statusLabel(record.status) }), record.status === 'COMPLETED' ? record : undefined);
        load();
      },
      [onAnnounce, load],
    ),
    useCallback(
      (refusal: string) => {
        onRefused(refusal);
        load();
      },
      [onRefused, load],
    ),
  );
  if (columns === null) return message === null ? <p>{t('common.loading')}</p> : <p role="alert">{message}</p>;
  const drop = (event: DragEvent, to: MaintenanceStatus) => {
    event.preventDefault();
    setOver(null);
    dragging.current = false;
    const record = findCard(columns, event.dataTransfer.getData(DRAG_TYPE));
    if (isMove(record, to)) change(record, to);
  };
  return (
    <>
      {message !== null && <p role="alert">{message}</p>}
      {/* Narrow screens: which status is shown. (Hidden where all four columns fit.) */}
      <div className="row home-filter maintenance-switcher" role="group" aria-label={t('maintenance.board.show')}>
        {columns.map((column) => (
          <button key={column.status} type="button" aria-pressed={shown === column.status} onClick={() => setShown(column.status)}>
            <span aria-hidden="true">{STATUS_GLYPHS[column.status]}</span> {statusLabel(column.status)} ({column.total})
          </button>
        ))}
      </div>
      <div className="maintenance-board">
        {columns.map((column) => (
          <section
            key={column.status}
            className="maintenance-column"
            data-status={column.status}
            data-current={shown === column.status}
            data-over={over === column.status}
            aria-labelledby={`maintenance-column-${column.status}`}
            onDragOver={
              canManage
                ? (event) => {
                    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    if (over !== column.status) setOver(column.status);
                  }
                : undefined
            }
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={canManage ? (event) => drop(event, column.status) : undefined}
          >
            <h3 id={`maintenance-column-${column.status}`} className="maintenance-column-heading">
              <span aria-hidden="true">{STATUS_GLYPHS[column.status]}</span> {statusLabel(column.status)} <span className="muted">({column.total})</span>
            </h3>
            {column.records.length === 0 ? (
              <p className="muted maintenance-empty">{t('maintenance.board.empty')}</p>
            ) : (
              <ul className="plain-list" aria-labelledby={`maintenance-column-${column.status}`}>
                {column.records.map((record) => (
                  <Card key={record.id} workspaceId={workspaceId} record={record} canManage={canManage} onStatus={(to) => change(record, to)} onDragging={(on) => (dragging.current = on)} />
                ))}
              </ul>
            )}
            {column.total > column.records.length && <p className="muted">{t('maintenance.board.more', { count: column.total - column.records.length })}</p>}
          </section>
        ))}
      </div>
      {canManage && <p className="muted maintenance-drag-hint">{t('maintenance.board.hint')}</p>}
    </>
  );
}

/** The List: every record, newest first, searched and filtered. Each row shows its status in words. */
function List(props: { workspaceId: string; canManage: boolean; version: number; filters: MaintenanceFilterValues | null; onAnnounce: (status: string, evidenceFor?: MaintenanceRecord) => void; onRefused: (message: string) => void }) {
  const { workspaceId, filters } = props;
  const id = useId();
  const contactsTool = useContactsTool();
  const [find, setFind] = useState({ q: '', status: '', category: '', contact: '', year: '' });
  const [records, setRecords] = useState<readonly MaintenanceSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(() => {
    const mine = ++request.current;
    api.maintenance(workspaceId, maintenanceListingParams(find)).then(
      (page) => {
        if (mine !== request.current) return;
        setRecords(page.records);
        setNext(page.nextCursor);
        setTotal(page.total);
        setMessage(null);
      },
      (caught: unknown) => mine === request.current && setMessage(messageFor(caught)),
    );
  }, [workspaceId, find]);
  useEffect(() => {
    const timer = window.setTimeout(load, find.q === '' ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [load, find.q, props.version]);
  const { onAnnounce, onRefused } = props;
  const change = useStatusChange(
    workspaceId,
    useCallback(
      (record: MaintenanceRecord) => {
        onAnnounce(t('maintenance.statusChanged', { title: record.title, status: statusLabel(record.status) }), record.status === 'COMPLETED' ? record : undefined);
        load();
      },
      [onAnnounce, load],
    ),
    useCallback(
      (refusal: string) => {
        onRefused(refusal);
        load();
      },
      [onRefused, load],
    ),
  );
  const select = (key: 'status' | 'category' | 'contact' | 'year', label: string, all: string, options: readonly { value: string; label: string }[]) => (
    <div className="field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <select id={`${id}-${key}`} value={find[key]} onChange={(event) => setFind({ ...find, [key]: event.target.value })}>
        <option value="">{all}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
  const filtering = Object.values(find).some((value) => value.trim() !== '');
  return (
    <>
      <div className="row contact-find maintenance-find">
        <div className="field">
          <label htmlFor={`${id}-q`}>{t('maintenance.find.search')}</label>
          <input id={`${id}-q`} type="search" maxLength={100} value={find.q} onChange={(event) => setFind({ ...find, q: event.target.value })} />
        </div>
        {select('status', t('maintenance.find.status'), t('maintenance.find.allStatuses'), STATUSES.map((status) => ({ value: status, label: statusLabel(status) })))}
        {(filters?.categories.length ?? 0) > 0 && select('category', t('maintenance.find.category'), t('maintenance.find.allCategories'), (filters?.categories ?? []).map((category) => ({ value: category, label: category })))}
        {contactsTool.enabled && (filters?.contacts.length ?? 0) > 0 && select('contact', t('maintenance.find.contact'), t('maintenance.find.allContacts'), (filters?.contacts ?? []).map((contact) => ({ value: contact.id, label: contact.name })))}
        {(filters?.years.length ?? 0) > 0 && select('year', t('maintenance.find.year'), t('maintenance.find.allYears'), (filters?.years ?? []).map((year) => ({ value: String(year), label: String(year) })))}
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {records === null ? (
        message === null && <p>{t('common.loading')}</p>
      ) : records.length === 0 ? (
        <p className="card calm">{t(filtering ? 'maintenance.find.none' : props.canManage ? 'maintenance.noneHint' : 'maintenance.none')}</p>
      ) : (
        <>
          {total !== null && (
            <p className="muted" aria-live="polite">
              {t(filtering ? 'maintenance.find.count' : 'maintenance.count', { count: total })}
            </p>
          )}
          <ul className="plain-list" aria-label={t('maintenance.list.label')}>
            {records.map((record) => {
              const context = cardContext(record);
              return (
                <li key={record.id} className="card maintenance-row">
                  <span className="item-body">
                    <Link href={paths.maintenanceRecord(workspaceId, record.id)} className="maintenance-card-title">
                      <strong>{record.title}</strong>
                    </Link>
                    {context !== '' && <small className="muted">{context}</small>}
                    {record.cost !== null && <small className="muted">{t('maintenance.costLine', { cost: costText(record.cost) })}</small>}
                  </span>
                  {props.canManage ? <StatusControl record={record} onChange={(to) => change(record, to)} /> : <StatusBadge status={record.status} />}
                </li>
              );
            })}
          </ul>
          {next !== null && (
            <button
              type="button"
              onClick={() =>
                void api.maintenance(workspaceId, maintenanceListingParams(find, next)).then(
                  (page) => {
                    setRecords([...records, ...page.records]);
                    setNext(page.nextCursor);
                  },
                  (caught: unknown) => setMessage(messageFor(caught)),
                )
              }
            >
              {t('common.showMore')}
            </button>
          )}
        </>
      )}
    </>
  );
}

/** Board and List of the Workspace's maintenance, with one-field create. */
function Overview(props: { workspaceId: string; canManage: boolean }) {
  const { workspaceId, canManage } = props;
  const id = useId();
  const [view, setView] = useState<'BOARD' | 'LIST'>(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === 'LIST' ? 'LIST' : 'BOARD';
    } catch {
      return 'BOARD';
    }
  });
  const [filters, setFilters] = useState<MaintenanceFilterValues | null>(null);
  const [currencies, setCurrencies] = useState<readonly string[]>([]);
  const [version, setVersion] = useState(0);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<MaintenanceRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(() => {
    const handed = handedOver<DeletedRecord>(DELETED_RECORD);
    return handed?.workspaceId === workspaceId ? handed : null;
  });
  useEffect(() => clearHandOver(DELETED_RECORD), []);
  useEffect(() => {
    api.maintenanceFilters(workspaceId).then(
      (loaded) => {
        setFilters(loaded.filters);
        setCurrencies(loaded.currencies);
      },
      () => undefined,
    );
  }, [workspaceId, version]);
  const announce = useCallback((text: string, completed?: MaintenanceRecord) => {
    setMessage(null);
    setStatus(text);
    setEvidenceFor(completed ?? null);
    setVersion((current) => current + 1);
  }, []);
  const refused = useCallback((text: string) => {
    setStatus(null);
    setEvidenceFor(null);
    setMessage(text);
  }, []);
  const choose = (next: 'BOARD' | 'LIST') => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Remembering the view is a convenience only.
    }
  };
  async function quickAdd(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === '') return;
    setSaving(true);
    try {
      const record = await api.createMaintenance(workspaceId, { title });
      setTitle('');
      announce(t('maintenance.added', { title: record.title }));
    } catch (caught) {
      refused(messageFor(caught));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section aria-labelledby="maintenance-heading">
      <div className="page-header page-header-tool">
        <div>
          <h2 id="maintenance-heading">{t('shell.maintenance')}</h2>
          <p className="muted page-lead">{t('maintenance.lead')}</p>
        </div>
        {canManage && <MoreMenu label={t('maintenance.moreActions')} items={[{ label: t('contacts.trash.open'), onSelect: () => navigate(paths.maintenanceTrash(workspaceId)) }]} />}
      </div>
      {canManage && (
        <form className="card stack" onSubmit={(event) => void quickAdd(event)} aria-label={t('maintenance.new.heading')}>
          <div className="row contact-quick-add">
            <div className="field">
              <label htmlFor={`${id}-new`}>{t('maintenance.new.label')}</label>
              <input id={`${id}-new`} maxLength={MAINTENANCE_LIMITS.title} autoComplete="off" placeholder={t('maintenance.new.example')} value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <button type="submit" className="primary" disabled={saving || title.trim() === ''}>
              {t('maintenance.new.add')}
            </button>
            <button type="button" onClick={() => setDetails(true)}>
              {t('contacts.new.more')}
            </button>
          </div>
        </form>
      )}
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" className={status === null ? 'visually-hidden' : 'card calm'}>
        {status ?? ''}
        {evidenceFor !== null && (
          <>
            {' '}
            <Link href={paths.maintenanceRecord(workspaceId, evidenceFor.id)}>{t('maintenance.addEvidence')}</Link>
          </>
        )}
      </p>
      <div className="row home-filter" role="group" aria-label={t('documents.find.view')}>
        {(['BOARD', 'LIST'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={view === value} onClick={() => choose(value)}>
            {t(value === 'BOARD' ? 'maintenance.view.BOARD' : 'maintenance.view.LIST')}
          </button>
        ))}
      </div>
      {view === 'BOARD' ? (
        <Board workspaceId={workspaceId} canManage={canManage} version={version} onAnnounce={announce} onRefused={refused} />
      ) : (
        <List workspaceId={workspaceId} canManage={canManage} version={version} filters={filters} onAnnounce={announce} onRefused={refused} />
      )}
      <UndoNotice
        notice={
          deleted === null
            ? null
            : {
                message: t('maintenance.deleted', { title: deleted.title }),
                undo: () =>
                  void api.restoreMaintenance(workspaceId, deleted.recordId).then(
                    () => announce(t('contacts.trash.restored', { name: deleted.title })),
                    (caught: unknown) => refused(messageFor(caught)),
                  ),
              }
        }
        onDismiss={() => setDeleted(null)}
      />
      {details && (
        <RecordDialog
          workspaceId={workspaceId}
          record={null}
          initialTitle={title}
          filters={filters}
          currencies={currencies}
          onClose={() => setDetails(false)}
          onSaved={(record) => {
            setTitle('');
            announce(t('maintenance.added', { title: record.title }));
          }}
        />
      )}
    </section>
  );
}

type LinkChoice = 'document' | 'procedure' | 'run' | 'remind';

/**
 * What a record is linked to: evidence (Documents), a Procedure, executions, Reminders. References —
 * nothing is copied and nobody gains access. An execution linked here never changes the record's
 * status, and the record never changes the execution.
 */
function RecordLinks(props: { workspaceId: string; record: MaintenanceRecord; canManage: boolean; canSchedule: boolean }) {
  const { workspaceId, record } = props;
  const documentsTool = useDocumentsTool();
  const id = useId();
  const [links, setLinks] = useState<readonly DocumentLink[]>([]);
  const [dialog, setDialog] = useState<LinkChoice | null>(null);
  const [procedures, setProcedures] = useState<readonly ProcedureCard[] | null>(null);
  const [runs, setRuns] = useState<readonly RunSummary[] | null>(null);
  const [choice, setChoice] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const load = useCallback(() => {
    void api.maintenanceLinks(workspaceId, record.id).then(setLinks, () => undefined);
  }, [workspaceId, record.id]);
  useEffect(load, [load]);
  const open = (next: LinkChoice) => {
    setChoice('');
    setDialog(next);
    if (next === 'procedure') void api.procedures(workspaceId).then(setProcedures, () => setProcedures([]));
    if (next === 'run') void api.runs(workspaceId).then((page) => setRuns(page.runs), () => setRuns([]));
  };
  const taken = (type: string) => links.filter((link) => link.record.type === type).map((link) => link.record.id);
  const hrefOf = (link: DocumentLink): string =>
    link.record.type === 'document' ? paths.document(workspaceId, link.record.id) : link.record.type === 'procedure' ? paths.procedure(workspaceId, link.record.id) : link.record.type === 'run' ? paths.run(workspaceId, link.record.id) : paths.reminders(workspaceId);
  if (!props.canManage && links.length === 0) return null;
  const options = dialog === 'procedure' ? (procedures ?? []).filter((each) => !taken('procedure').includes(each.id)).map((each) => ({ id: each.id, label: each.title })) : (runs ?? []).filter((each) => !taken('run').includes(each.id)).map((each) => ({ id: each.id, label: `${each.title} — ${formatDateTime(each.startedAt)} (${t(`runState.${each.state}`)})` }));
  return (
    <section className="stack" aria-labelledby={`${id}-heading`}>
      <h3 className="section-label" id={`${id}-heading`}>
        {t('links.heading')}
      </h3>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && (
        <p role="status" className="card calm">
          {status}
        </p>
      )}
      {links.length === 0 && <p className="muted">{t('maintenance.links.none')}</p>}
      {links.length > 0 && (
        <ul className="plain-list card">
          {links.map((link) => {
            const text = linkedRecordText(link.record);
            return (
              <li key={link.id} className="link-line">
                <span className="item-body">
                  <span>
                    <small className="muted">{linkedKind(link.record)}: </small>
                    {text.open ? <Link href={hrefOf(link)}>{text.title}</Link> : <span>{text.title}</span>}
                  </span>
                  {text.note !== null && <small className="muted">{text.note}</small>}
                </span>
                {props.canManage && (
                  <button
                    type="button"
                    className="quiet"
                    aria-label={t('links.removeNamed', { name: text.title })}
                    onClick={() =>
                      void api.removeMaintenanceLink(workspaceId, link.id).then(
                        () => {
                          setStatus(t('links.removed', { name: text.title }));
                          load();
                        },
                        (caught: unknown) => setMessage(messageFor(caught)),
                      )
                    }
                  >
                    {t('links.remove')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {props.canManage && (
        <div className="row">
          {documentsTool.enabled && (
            <button type="button" onClick={() => open('document')}>
              <UiIcon name="documents" /> {t('maintenance.links.addEvidence')}
            </button>
          )}
          <button type="button" onClick={() => open('procedure')}>
            {t('contacts.links.addProcedure')}
          </button>
          <button type="button" onClick={() => open('run')}>
            {t('maintenance.links.addRun')}
          </button>
          {props.canSchedule && (
            <button type="button" onClick={() => open('remind')}>
              {t('links.remind.button')}
            </button>
          )}
        </div>
      )}
      {dialog === 'remind' && (
        <RemindDialog
          workspaceId={workspaceId}
          heading={t('maintenance.remind.heading')}
          suggestedTitle={record.title}
          link={(scheduleId) => api.addMaintenanceLink(workspaceId, record.id, { type: 'schedule', id: scheduleId })}
          onClose={() => setDialog(null)}
          onDone={(title) => {
            setStatus(t('maintenance.remind.done', { name: title }));
            load();
          }}
        />
      )}
      {dialog !== null && dialog !== 'remind' && (
        <FormDialog
          title={t(dialog === 'document' ? 'maintenance.links.evidenceHeading' : dialog === 'procedure' ? 'maintenance.links.procedureHeading' : 'maintenance.links.runHeading', { title: record.title })}
          submitLabel={t('links.addConfirm')}
          submitDisabled={choice === ''}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            const link = await api.addMaintenanceLink(workspaceId, record.id, { type: dialog, id: choice });
            setStatus(t('links.added', { name: link.record.title ?? '' }));
            load();
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            {t(dialog === 'run' ? 'maintenance.links.runHint' : 'links.addHint')}
          </p>
          {dialog === 'document' ? (
            <DocumentPicker workspaceId={workspaceId} exclude={taken('document')} value={choice} onChange={setChoice} />
          ) : (
            <div className="field">
              <label htmlFor={`${id}-choice`}>{t(dialog === 'procedure' ? 'links.pick.procedure' : 'links.kind.run')}</label>
              <select id={`${id}-choice`} required value={choice} onChange={(event) => setChoice(event.target.value)}>
                <option value="">{(dialog === 'procedure' ? procedures : runs) === null ? t('common.loading') : options.length === 0 ? t('links.pick.none') : t('links.pick.choose')}</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </FormDialog>
      )}
    </section>
  );
}

/** One record: what it is, where it stands (with the status control), who is responsible, what it cost, and what it is linked to. */
function RecordPage(props: { workspaceId: string; recordId: string; canManage: boolean; canSchedule: boolean }) {
  const { workspaceId, recordId } = props;
  const contactsTool = useContactsTool();
  const [record, setRecord] = useState<MaintenanceRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filters, setFilters] = useState<MaintenanceFilterValues | null>(null);
  const [currencies, setCurrencies] = useState<readonly string[]>([]);
  const load = useCallback(() => {
    api.maintenanceRecord(workspaceId, recordId).then(setRecord, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId, recordId]);
  useEffect(load, [load]);
  const change = useStatusChange(
    workspaceId,
    useCallback((changed: MaintenanceRecord) => {
      setRecord(changed);
      setMessage(null);
      setStatus(t('maintenance.statusChanged', { title: changed.title, status: statusLabel(changed.status) }) + (changed.status === 'COMPLETED' ? ` ${t('maintenance.evidenceBelow')}` : ''));
    }, []),
    useCallback(
      (refusal: string) => {
        setStatus(null);
        setMessage(refusal);
        load();
      },
      [load],
    ),
  );
  const back = (
    <p className="back-row">
      <Link href={paths.maintenance(workspaceId)} className="back-link">
        <UiIcon name="back" /> {t('maintenance.back')}
      </Link>
    </p>
  );
  if (record === null) {
    return (
      <section>
        {back}
        {message !== null ? <p role="alert">{message}</p> : <p>{t('common.loading')}</p>}
      </section>
    );
  }
  const when = dateText(record);
  return (
    <section aria-labelledby="maintenance-record-heading" className="stack">
      {back}
      <div className="page-header page-header-tool">
        <div>
          <h2 id="maintenance-record-heading">{record.title}</h2>
          <p className="page-lead">
            <StatusBadge status={record.status} />
          </p>
        </div>
        {props.canManage && (
          <div className="row">
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                void api.maintenanceFilters(workspaceId).then(
                  (loaded) => {
                    setFilters(loaded.filters);
                    setCurrencies(loaded.currencies);
                  },
                  () => undefined,
                );
              }}
            >
              {t('contacts.edit.button')}
            </button>
            <MoreMenu label={t('contacts.moreActionsNamed', { name: record.title })} items={[{ label: t('contacts.delete.button'), danger: true, onSelect: () => setDeleting(true) }]} />
          </div>
        )}
      </div>
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" className={status === null ? 'visually-hidden' : 'card calm'}>
        {status ?? ''}
      </p>
      <div className="card stack contact-details">
        {props.canManage && (
          <div className="maintenance-status-line">
            <span id="maintenance-status-label" className="section-label">
              {t('maintenance.status')}
            </span>
            <StatusControl record={record} onChange={(to) => change(record, to)} />
          </div>
        )}
        {when !== null && <p style={{ margin: 0 }}>{when}</p>}
        {record.completedOn !== null && record.date !== null && <p className="muted" style={{ margin: 0 }}>{t('maintenance.wasPlannedFor', { date: formatCalendarDate(record.date) })}</p>}
        {record.category !== '' && (
          <div>
            <h3 className="section-label">{t('maintenance.field.category')}</h3>
            <p style={{ margin: 0 }}>{record.category}</p>
          </div>
        )}
        {record.contact !== null && (
          <div>
            <h3 className="section-label">{t('maintenance.field.contact')}</h3>
            <p style={{ margin: 0 }}>{record.contact.name !== null && contactsTool.enabled ? <Link href={paths.contact(workspaceId, record.contact.id)}>{record.contact.name}</Link> : t('contacts.deletedContact')}</p>
          </div>
        )}
        {record.cost !== null && (
          <div>
            <h3 className="section-label">{t('maintenance.field.cost')}</h3>
            <p style={{ margin: 0 }}>{costText(record.cost)}</p>
          </div>
        )}
        {record.description !== '' && (
          <div>
            <h3 className="section-label">{t('maintenance.field.description')}</h3>
            <p className="document-notes">{record.description}</p>
          </div>
        )}
        <small className="muted">{t('contacts.modified', { when: formatDateTime(record.modifiedAt), name: record.modifiedBy })}</small>
      </div>
      <RecordLinks workspaceId={workspaceId} record={record} canManage={props.canManage} canSchedule={props.canSchedule} />
      {editing && (
        <RecordDialog
          workspaceId={workspaceId}
          record={record}
          filters={filters}
          currencies={currencies}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setRecord(saved);
            setStatus(t('contacts.saved'));
          }}
        />
      )}
      {deleting && (
        <FormDialog
          title={t('contacts.delete.heading', { name: record.title })}
          submitLabel={t('contacts.delete.confirm')}
          danger
          onClose={() => setDeleting(false)}
          onSubmit={async () => {
            await api.deleteMaintenance(workspaceId, record.id);
            handOver(DELETED_RECORD, { workspaceId, recordId: record.id, title: record.title } satisfies DeletedRecord);
            navigate(paths.maintenance(workspaceId));
          }}
        >
          <p style={{ margin: 0 }}>{t('maintenance.delete.what')}</p>
        </FormDialog>
      )}
    </section>
  );
}

/** Records in Trash: restore one, or — a Workspace admin — delete for good. Nothing leaves Trash by itself. */
function Trash(props: { workspaceId: string; canPurge: boolean }) {
  const { workspaceId, canPurge } = props;
  const [records, setRecords] = useState<readonly TrashedMaintenanceRecord[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashedMaintenanceRecord | 'all' | null>(null);
  const load = useCallback(() => {
    api.maintenanceTrash(workspaceId).then(setRecords, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId]);
  useEffect(load, [load]);
  return (
    <section aria-labelledby="maintenance-trash-heading">
      <p className="back-row">
        <Link href={paths.maintenance(workspaceId)} className="back-link">
          <UiIcon name="back" /> {t('maintenance.back')}
        </Link>
      </p>
      <div className="page-header page-header-tool">
        <div>
          <h2 id="maintenance-trash-heading">{t('maintenance.trash.heading')}</h2>
          <p className="muted page-lead">{t(canPurge ? 'maintenance.trash.leadAdmin' : 'maintenance.trash.lead')}</p>
        </div>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && (
        <p role="status" className="card calm">
          {status}
        </p>
      )}
      {records === null ? (
        message === null && <p>{t('common.loading')}</p>
      ) : records.length === 0 ? (
        <p className="card calm">{t('contacts.trash.empty')}</p>
      ) : (
        <>
          {canPurge && (
            <div className="row select-bar">
              <button type="button" className="danger" onClick={() => setPurging('all')}>
                <UiIcon name="trash" /> {t('contacts.purge.all')}
              </button>
            </div>
          )}
          <ul className="plain-list trash-list">
            {records.map((record) => (
              <li key={record.id} className="card">
                <div className="trash-entry">
                  <span className="item-body">
                    <strong>{record.title}</strong>
                    <small className="muted">
                      {STATUS_GLYPHS[record.status]} {statusLabel(record.status)}
                    </small>
                    <small className="muted">{t('documents.trash.deletedBy', { name: record.deletedBy, when: formatDateTime(record.deletedAt) })}</small>
                  </span>
                </div>
                <div className="row">
                  <button
                    type="button"
                    aria-label={t('documents.trash.restoreNamed', { name: record.title })}
                    onClick={() =>
                      void api.restoreMaintenance(workspaceId, record.id).then(
                        () => {
                          setStatus(t('contacts.trash.restored', { name: record.title }));
                          load();
                        },
                        (caught: unknown) => setMessage(messageFor(caught)),
                      )
                    }
                  >
                    <UiIcon name="undo" /> {t('documents.trash.restore')}
                  </button>
                  {canPurge && (
                    <button type="button" className="quiet danger-text" aria-label={t('documents.purge.oneNamed', { name: record.title })} onClick={() => setPurging(record)}>
                      {t('documents.purge.one')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {purging !== null && (
        <FormDialog
          title={purging === 'all' ? t('maintenance.purge.allHeading') : t('contacts.purge.oneHeading', { name: purging.title })}
          submitLabel={t('documents.purge.confirm')}
          danger
          onClose={() => setPurging(null)}
          onSubmit={async () => {
            const purged = await api.purgeMaintenance(workspaceId, purging === 'all' ? 'all' : [purging.id]);
            setStatus(t('maintenance.purge.done', { count: purged }));
            load();
          }}
        >
          <p style={{ margin: 0 }}>
            <strong>{t('maintenance.purge.what', { count: purging === 'all' ? (records?.length ?? 0) : 1 })}</strong>
          </p>
          <p style={{ margin: 0 }}>{t('documents.purge.cannotUndo')}</p>
          <p className="muted" style={{ margin: 0 }}>
            {t('maintenance.purge.kept')}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {t('contacts.purge.backups')}
          </p>
        </FormDialog>
      )}
    </section>
  );
}

/**
 * The Maintenance tool (16.7): planned and done work, on a board and in a list. Everyone in the
 * Workspace sees it; `canManage` (USER and above) creates, edits, changes status, links and deletes to
 * Trash; `canPurge` (Workspace admins) deletes for good. The controls shown follow that — the server
 * decides on every request.
 */
export function Maintenance(props: { workspaceId: string; route: MaintenanceRoute; canManage: boolean; canPurge: boolean; canSchedule: boolean }) {
  const { workspaceId, route, canManage } = props;
  if (route.view === 'record' && route.recordId !== null) return <RecordPage workspaceId={workspaceId} recordId={route.recordId} canManage={canManage} canSchedule={props.canSchedule} />;
  if (route.view === 'trash') {
    return canManage ? (
      <Trash workspaceId={workspaceId} canPurge={props.canPurge} />
    ) : (
      <p role="alert">
        {t('maintenance.manageOnly')} <Link href={paths.maintenance(workspaceId)}>{t('maintenance.back')}</Link>
      </p>
    );
  }
  return <Overview workspaceId={workspaceId} canManage={canManage} />;
}
