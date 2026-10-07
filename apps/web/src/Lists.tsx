import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ApiError, api, isNetworkError, messageFor, type ListChangeInput, type ListDetail, type ListItem, type ListItemInput, type ListSummary } from './api.ts';
import { FormDialog } from './FormDialog.tsx';
import { clearHandOver, handOver, handedOver } from './handoff.ts';
import { formatDateTime, formatRelative, hasMessage, t } from './i18n/index.ts';
import { amountLabel, isCurrent, splitItems, withChecked } from './list-model.ts';
import { activeChanges, summaryOf, waitingIds, withQueuedListChanges } from './offline/list-queue.ts';
import { useOffline } from './offline/OfflineProvider.tsx';
import { offlineStore, type SavedLists } from './offline/store.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { Link, navigate, paths } from './router.tsx';
import { UiIcon } from './ui-icons.tsx';
import { UndoNotice, type Undoable } from './UndoNotice.tsx';

/** Other members' changes appear without reloading: an open List asks this often while it is visible. */
const REFRESH_MS = 10_000;
const OVERVIEW_REFRESH_MS = 30_000;

/** A List deleted a moment ago: the overview that follows offers to put it back. */
const DELETED_LIST = 'deleted-list';
interface DeletedList {
  readonly workspaceId: string;
  readonly listId: string;
  readonly title: string;
  /** Deleted on this device and not sent yet (17.5): Undo takes the change back. */
  readonly clientChangeId?: string | undefined;
}

/**
 * The Lists of this Workspace as kept on this device (17.5): as last received, with this account's
 * changes that are not sent yet applied. `device` is true while the page shows this copy — offline,
 * or while changes of this Workspace are still on their way (so nothing jumps back and forth).
 */
function useDeviceLists(workspaceId: string) {
  const offline = useOffline();
  const { userId, listsVersion } = offline;
  const [saved, setSaved] = useState<SavedLists | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    void offlineStore.loadLists(userId, workspaceId).then((entry) => {
      if (current) setSaved(entry ?? null);
    });
    return () => {
      current = false;
    };
  }, [userId, workspaceId, listsVersion]);
  const pending = activeChanges(offline.listChanges, workspaceId);
  const lists = saved === undefined || saved === null ? null : withQueuedListChanges(saved.lists, pending, t('lists.you'));
  return { offline, saved, lists, pending, waiting: waitingIds(pending), device: !offline.online || pending.length > 0 };
}

/** "Offline — showing the Lists saved on this device at …", while that copy is shown without a connection. */
function DeviceCopyNote(props: { saved: SavedLists | null | undefined; online: boolean }) {
  if (props.online || props.saved === undefined || props.saved === null) return null;
  return <p className="muted list-device-note">{t('lists.offlineCopy', { time: formatDateTime(props.saved.savedAt) })}</p>;
}

const failure = (caught: unknown): string => (isNetworkError(caught) ? t('lists.offline') : messageFor(caught));

function useRefresh(load: () => void, everyMs: number) {
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = window.setInterval(refresh, everyMs);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, everyMs]);
}

/** The Lists of the Workspace: name, what is left to buy, and Open. `creating`: the New list dialog is open. */
function ListOverview(props: { workspaceId: string; creating: boolean; canEdit: boolean }) {
  const { workspaceId } = props;
  const local = useDeviceLists(workspaceId);
  const { offline, device } = local;
  const { reportReachable, reportUnreachable } = offline;
  const [fetched, setFetched] = useState<readonly ListSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<Undoable | null>(null);
  const [name, setName] = useState('');
  const created = useRef(false);

  const load = useCallback(() => {
    api.lists(workspaceId).then(
      (loaded) => {
        setFetched(loaded);
        setMessage(null);
        reportReachable();
      },
      (caught: unknown) => {
        // No answer: the copy on this device is shown instead (17.5).
        if (isNetworkError(caught)) reportUnreachable();
        else setMessage(failure(caught));
      },
    );
  }, [workspaceId, reportReachable, reportUnreachable]);
  useEffect(() => {
    if (!device) load();
  }, [load, device]);
  useRefresh(load, OVERVIEW_REFRESH_MS);
  const lists: readonly ListSummary[] | null = device ? (local.lists?.map(summaryOf) ?? null) : fetched;
  // Arriving here right after deleting a List: offer Undo.
  const [deleted, setDeleted] = useState(() => {
    const handed = handedOver<DeletedList>(DELETED_LIST);
    return handed?.workspaceId === workspaceId ? handed : null;
  });
  useEffect(() => clearHandOver(DELETED_LIST), []);
  const undoDelete = (gone: DeletedList) => {
    // Not sent yet: take the change back on this device. Sent: put the List back, which needs the server.
    if (gone.clientChangeId !== undefined && local.pending.some((change) => change.clientChangeId === gone.clientChangeId)) {
      void offline.removeListChanges([gone.clientChangeId]);
      return;
    }
    if (!offline.online) {
      setMessage(t('lists.offlineUndoNeedsConnection'));
      return;
    }
    void api.restoreList(workspaceId, gone.listId).then(
      () => {
        load();
        void offline.syncLists(workspaceId);
      },
      (caught: unknown) => setMessage(failure(caught)),
    );
  };
  const shownNotice: Undoable | null = deleted === null ? notice : { message: t('lists.deleted', { title: deleted.title }), undo: () => undoDelete(deleted) };
  /** A List made on this device while offline gets its id here and is created on the server once (17.5). */
  const createOnDevice = async (title: string) => {
    const listId = crypto.randomUUID();
    const id = await offline.enqueueList(workspaceId, { kind: 'createList', listId, title: title.trim() }, title.trim());
    if (id === null) throw new Error(t('offline.cannotSave', { title }));
    return listId;
  };

  return (
    <section aria-labelledby="lists-heading">
      <div className="page-header page-header-tool">
        <div>
          <h2 id="lists-heading">{t('shell.lists')}</h2>
          <p className="muted page-lead">{t('lists.lead')}</p>
        </div>
        {props.canEdit && (
          <button type="button" className="primary" onClick={() => navigate(paths.newList(workspaceId))}>
            <UiIcon name="add" /> {t('lists.new')}
          </button>
        )}
      </div>
      <DeviceCopyNote saved={local.saved} online={offline.online} />
      {message !== null && <p role="alert">{message}</p>}
      {lists === null ? (
        message === null && (device && local.saved === null ? <p role="alert">{t('lists.offline')}</p> : <p>{t('common.loading')}</p>)
      ) : lists.length === 0 ? (
        <p className="card calm">{t(props.canEdit ? 'lists.noneHint' : 'lists.none')}</p>
      ) : (
        <ul className="plain-list" aria-labelledby="lists-heading">
          {lists.map((list) => (
            <li key={list.id}>
              <Link href={paths.list(workspaceId, list.id)} className="card link-card" aria-label={t('lists.openNamed', { title: list.title })}>
                <span className="item-icon">
                  <UiIcon name="grocery" size="1.5em" />
                </span>
                <span className="item-body">
                  <strong>{list.title}</strong>
                  <small className="muted">
                    {list.open + list.checked === 0 ? t('lists.emptyShort') : `${t('lists.toBuy', { count: list.open })} · ${t('lists.purchasedCount', { count: list.checked })}`}
                  </small>
                  {local.waiting.has(list.id) && <small className="muted">{t('lists.offlineWaiting')}</small>}
                </span>
                <UiIcon name="chevron" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <UndoNotice
        notice={shownNotice}
        onDismiss={() => {
          setDeleted(null);
          setNotice(null);
        }}
      />
      {props.creating && props.canEdit && (
        <FormDialog
          title={t('lists.newHeading')}
          submitLabel={t('lists.create')}
          onClose={() => {
            if (!created.current) navigate(paths.lists(workspaceId), { replace: true });
          }}
          onSubmit={async () => {
            let listId: string;
            if (device) listId = await createOnDevice(name);
            else {
              try {
                listId = (await api.createList(workspaceId, name)).id;
              } catch (caught) {
                if (!isNetworkError(caught)) throw caught;
                offline.reportUnreachable();
                listId = await createOnDevice(name);
              }
            }
            created.current = true;
            navigate(paths.list(workspaceId, listId), { replace: true });
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            {t('lists.newHint')}
          </p>
          <label>
            {t('lists.name')}
            <br />
            <input required maxLength={80} value={name} placeholder={t('lists.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
          </label>
        </FormDialog>
      )}
    </section>
  );
}

type ItemField = 'title' | 'quantity' | 'unit';

/** The message of a refused item and the field it belongs to (the server names the field). */
function fieldError(caught: unknown): { field: ItemField; text: string } | null {
  if (!(caught instanceof ApiError)) return null;
  const field = caught.details.field;
  const key = `error.${caught.code}`;
  if ((field !== 'title' && field !== 'quantity' && field !== 'unit') || !hasMessage(key)) return null;
  return { field, text: t(key) };
}

/** Name, quantity and unit of an item — the same three fields for adding and for editing. */
function ItemFields({ value, onChange, error, titleRef }: { value: ListItemInput; onChange: (value: ListItemInput) => void; error: { field: ItemField; text: string } | null; titleRef?: RefObject<HTMLInputElement | null> }) {
  const id = useId();
  const describe = (field: ItemField) => (error?.field === field ? `${id}-error` : undefined);
  return (
    <>
      <div className="item-fields">
        <div className="field item-field-title">
          <label htmlFor={`${id}-title`}>{t('lists.item')}</label>
          <input
            ref={titleRef}
            id={`${id}-title`}
            required
            maxLength={120}
            value={value.title}
            placeholder={t('lists.itemPlaceholder')}
            enterKeyHint="done"
            aria-invalid={error?.field === 'title'}
            aria-describedby={describe('title')}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
        </div>
        <div className="field item-field-small">
          <label htmlFor={`${id}-quantity`}>{t('lists.quantity')}</label>
          <input
            id={`${id}-quantity`}
            inputMode="decimal"
            maxLength={10}
            value={value.quantity ?? ''}
            aria-invalid={error?.field === 'quantity'}
            aria-describedby={describe('quantity')}
            onChange={(e) => onChange({ ...value, quantity: e.target.value })}
          />
        </div>
        <div className="field item-field-small">
          <label htmlFor={`${id}-unit`}>{t('lists.unit')}</label>
          <input
            id={`${id}-unit`}
            maxLength={16}
            value={value.unit ?? ''}
            placeholder={t('lists.unitPlaceholder')}
            autoCapitalize="none"
            aria-invalid={error?.field === 'unit'}
            aria-describedby={describe('unit')}
            onChange={(e) => onChange({ ...value, unit: e.target.value })}
          />
        </div>
      </div>
      {error !== null && (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error.text}
        </span>
      )}
    </>
  );
}

const EMPTY_ITEM: ListItemInput = { title: '', quantity: '', unit: '' };
const cleaned = (value: ListItemInput): ListItemInput => ({ title: value.title, quantity: (value.quantity ?? '').trim() === '' ? null : value.quantity, unit: (value.unit ?? '').trim() === '' ? null : value.unit });

function EditItemDialog(props: { item: ListItem; onSave: (value: ListItemInput) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState<ListItemInput>({ title: props.item.title, quantity: props.item.quantity ?? '', unit: props.item.unit ?? '' });
  const [error, setError] = useState<{ field: ItemField; text: string } | null>(null);
  return (
    <FormDialog
      title={t('lists.editHeading', { title: props.item.title })}
      submitLabel={t('lists.save')}
      onClose={props.onClose}
      onSubmit={async () => {
        setError(null);
        try {
          await props.onSave(cleaned(value));
        } catch (caught) {
          const found = fieldError(caught);
          if (found === null) throw caught;
          setError(found);
          // Keeps the dialog open with what was entered; the message sits next to its field.
          throw new Error(t('lists.checkFields'), { cause: caught });
        }
      }}
    >
      <ItemFields value={value} onChange={setValue} error={error} />
    </FormDialog>
  );
}

/**
 * One grocery list: add items (Enter adds the next one), tick what is bought, edit or remove, and take
 * the last action back. Purchased items collect in a group that folds away. Nothing to start, no
 * Required or Critical, no Skip or N/A — a List is not a Procedure. Shared with the Workspace: other
 * members' changes appear within seconds; the server keeps the order of who was first.
 */
function ListPage(props: { workspaceId: string; listId: string; canEdit: boolean }) {
  const { workspaceId, listId } = props;
  const local = useDeviceLists(workspaceId);
  const { offline, device } = local;
  const { userId, reportReachable, reportUnreachable, enqueueList, removeListChanges } = offline;
  const [serverList, setList] = useState<ListDetail | null>(null);
  const shown = useRef<ListDetail | null>(null);
  /** Changes on their way: a refresh that started before one of them finished must not replace its answer. */
  const pending = useRef(0);
  const [message, setMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState<Undoable | null>(null);
  const [draft, setDraft] = useState<ListItemInput>(EMPTY_ITEM);
  const [addError, setAddError] = useState<{ field: ItemField; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ListItem | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  /** The List as the server answered, kept on this device too (17.5). */
  const keep = useCallback(
    (answer: ListDetail) => {
      shown.current = answer;
      setList(answer);
      void offlineStore.saveList(userId, workspaceId, listId, answer);
    },
    [userId, workspaceId, listId],
  );
  const load = useCallback(() => {
    if (pending.current > 0) return;
    api.list(workspaceId, listId).then(
      (loaded) => {
        if (pending.current === 0 && isCurrent(shown.current, loaded)) keep(loaded);
        setMessage(null);
        reportReachable();
      },
      (caught: unknown) => {
        // No answer: the copy on this device is shown instead (17.5).
        if (isNetworkError(caught)) {
          reportUnreachable();
          return;
        }
        if (caught instanceof ApiError && caught.status === 404) {
          setMissing(true);
          void offlineStore.saveList(userId, workspaceId, listId, null);
        }
        setMessage(failure(caught));
      },
    );
  }, [workspaceId, listId, userId, keep, reportReachable, reportUnreachable]);
  useEffect(() => {
    if (!device) load();
  }, [load, device]);
  useRefresh(load, REFRESH_MS);
  const deviceList = local.lists?.find((each) => each.id === listId) ?? null;
  const list = device ? deviceList : serverList;

  /** Kept on this device and sent when the server is reachable (17.5); `undo` is offered at once. */
  async function onDevice(next: ListChangeInput, label: string, undo?: Undoable): Promise<string | null> {
    setMessage(null);
    const id = await enqueueList(workspaceId, next, label);
    if (id === null) setMessage(t('offline.cannotSave', { title: label }));
    else if (undo !== undefined) setNotice(undo);
    return id;
  }

  /** Undo of a change kept on this device: taken back while it is not sent; otherwise `online` (needs the server). */
  const undoKept = (clientChangeId: string, online: () => void) => () =>
    void offlineStore.listChanges(userId).then((kept) => {
      if (kept.some((each) => each.clientChangeId === clientChangeId && each.refused === undefined)) void removeListChanges([clientChangeId]);
      else if (navigator.onLine) online();
      else setMessage(t('lists.offlineUndoNeedsConnection'));
    });

  /**
   * Sends a change; the answer is the canonical List. `undo` is offered once it is saved. When the
   * server cannot be reached, `instead` keeps the change on this device (17.5).
   */
  async function change(action: () => Promise<ListDetail>, undo?: Undoable, optimistic?: ListDetail, instead?: () => Promise<unknown>): Promise<boolean> {
    setMessage(null);
    setNotice(null);
    pending.current += 1;
    if (optimistic !== undefined) setList(optimistic);
    try {
      keep(await action());
      if (undo !== undefined) setNotice(undo);
      return true;
    } catch (caught) {
      // Back to what the server last said, with the reason — then ask it again (someone else may have changed it).
      setList(shown.current);
      if (instead !== undefined && isNetworkError(caught)) {
        reportUnreachable();
        await instead();
        return true;
      }
      setMessage(failure(caught));
      return false;
    } finally {
      pending.current -= 1;
    }
  }

  /** After a refused change: what is on the server now. */
  const changeOrReload = async (...args: Parameters<typeof change>) => {
    if (!(await change(...args))) load();
  };
  const checkChange = (item: ListItem, checked: boolean): ListChangeInput => ({ kind: 'checkItem', listId, itemId: item.id, checked });
  const setChecked = (item: ListItem, checked: boolean) => {
    const message = t(checked ? 'lists.checkedNotice' : 'lists.uncheckedNotice', { title: item.title });
    const back = () => onDevice(checkChange(item, !checked), item.title);
    const kept = () => onDevice(checkChange(item, checked), item.title, { message, undo: () => void back() });
    if (device) return void kept();
    void changeOrReload(
      () => api.checkListItem(workspaceId, listId, item.id, checked),
      { message, undo: () => void changeOrReload(() => api.checkListItem(workspaceId, listId, item.id, !checked), undefined, undefined, back) },
      list === null ? undefined : withChecked(list, item.id, checked, t('lists.you'), new Date().toISOString()),
      kept,
    );
  };
  const putBack = (item: ListItem) => () => void changeOrReload(() => api.restoreListItem(workspaceId, listId, item.id));
  const removeOnDevice = async (item: ListItem) => {
    const id = await onDevice({ kind: 'removeItem', listId, itemId: item.id }, item.title);
    if (id !== null) setNotice({ message: t('lists.removedNotice', { title: item.title }), undo: undoKept(id, putBack(item)) });
  };
  const remove = (item: ListItem) => {
    if (device) return void removeOnDevice(item);
    void changeOrReload(() => api.removeListItem(workspaceId, listId, item.id), { message: t('lists.removedNotice', { title: item.title }), undo: putBack(item) }, undefined, () => removeOnDevice(item));
  };

  async function add(event: FormEvent) {
    event.preventDefault();
    if (draft.title.trim() === '') return;
    setAddError(null);
    setAdding(true);
    pending.current += 1;
    const content = cleaned(draft);
    // The item's id is this device's, so it can be checked or edited before it reaches the server.
    const addOnDevice = async () => {
      const title = content.title.trim();
      if ((await onDevice({ kind: 'addItem', listId, itemId: crypto.randomUUID(), title, quantity: content.quantity, unit: content.unit }, title)) !== null) setDraft(EMPTY_ITEM);
    };
    try {
      if (device) await addOnDevice();
      else {
        keep(await api.addListItem(workspaceId, listId, content));
        setDraft(EMPTY_ITEM);
        setMessage(null);
      }
    } catch (caught) {
      if (isNetworkError(caught)) {
        reportUnreachable();
        await addOnDevice();
        return;
      }
      // What was typed stays; the message goes next to the field it is about.
      const found = fieldError(caught);
      if (found === null) setMessage(failure(caught));
      else setAddError(found);
    } finally {
      pending.current -= 1;
      setAdding(false);
      titleRef.current?.focus();
    }
  }

  async function deleteList() {
    if (list === null || !window.confirm(t('lists.deleteConfirm', { title: list.title }))) return;
    const title = list.title;
    const deleteOnDevice = async () => {
      const id = await onDevice({ kind: 'deleteList', listId }, title);
      if (id === null) return;
      handOver(DELETED_LIST, { workspaceId, listId, title, clientChangeId: id } satisfies DeletedList);
      navigate(paths.lists(workspaceId), { replace: true });
    };
    if (device) return deleteOnDevice();
    try {
      await api.deleteList(workspaceId, listId);
      void offlineStore.saveList(userId, workspaceId, listId, null);
      handOver(DELETED_LIST, { workspaceId, listId, title } satisfies DeletedList);
      navigate(paths.lists(workspaceId), { replace: true });
    } catch (caught) {
      if (isNetworkError(caught)) {
        reportUnreachable();
        await deleteOnDevice();
        return;
      }
      setMessage(failure(caught));
    }
  }

  const back = (
    <p className="back-row">
      <Link href={paths.lists(workspaceId)} className="back-link">
        <UiIcon name="back" /> {t('lists.back')}
      </Link>
    </p>
  );
  if (list === null) {
    // Offline and not on this device (never received, or deleted meanwhile): say so instead of an empty List.
    const unavailable = device && local.saved !== undefined ? t(local.saved === null ? 'lists.offline' : 'lists.offlineNotSaved') : null;
    return (
      <section aria-label={t('shell.lists')}>
        {back}
        {message !== null ? <p role="alert">{message}</p> : unavailable !== null ? <p role="alert">{unavailable}</p> : <p>{t('common.loading')}</p>}
      </section>
    );
  }
  const { toBuy, purchased } = splitItems(list.items);
  const editable = props.canEdit && (device || !missing);
  const row = (item: ListItem) => {
    const amount = amountLabel(item);
    const text = (
      <span className="list-row-text">
        <span className="list-row-title">{item.title}</span>
        {amount !== '' && <span className="muted list-row-amount">{amount}</span>}
        {item.checked !== null && (
          <small className="muted">
            <span aria-hidden="true">✓ </span>
            {t('lists.purchasedBy', { name: item.checked.by, ago: formatRelative(item.checked.at) })}
          </small>
        )}
        {local.waiting.has(item.id) && <small className="muted">{t('lists.offlineWaiting')}</small>}
      </span>
    );
    return (
      <li key={item.id} className="list-row" data-checked={item.checked !== null}>
        {editable ? (
          <label className="list-row-main">
            <input type="checkbox" className="list-check" checked={item.checked !== null} onChange={(e) => setChecked(item, e.target.checked)} />
            {text}
          </label>
        ) : (
          <span className="list-row-main">
            <span aria-hidden="true" className="list-glyph">
              {item.checked !== null ? '✓' : '○'}
            </span>
            {text}
          </span>
        )}
        {editable && (
          <MoreMenu
            label={t('lists.moreFor', { title: item.title })}
            items={[
              { label: t('lists.edit'), onSelect: () => setEditing(item) },
              { label: t('lists.remove'), danger: true, onSelect: () => remove(item) },
            ]}
          />
        )}
      </li>
    );
  };

  return (
    <section aria-labelledby="list-heading" className="list-page">
      {back}
      <div className="page-header page-header-tool">
        <div>
          <h2 id="list-heading">{list.title}</h2>
          <p className="muted page-lead">
            {list.items.length === 0 ? t('lists.emptyShort') : `${t('lists.toBuy', { count: toBuy.length })} · ${t('lists.purchasedCount', { count: purchased.length })}`}
          </p>
        </div>
        {editable && (
          <MoreMenu
            label={t('lists.moreForList', { title: list.title })}
            items={[
              {
                label: t('lists.rename'),
                onSelect: () => {
                  setNewName(list.title);
                  setRenaming(true);
                },
              },
              { label: t('lists.delete'), danger: true, onSelect: () => void deleteList() },
            ]}
          />
        )}
      </div>
      <DeviceCopyNote saved={local.saved} online={offline.online} />
      {message !== null && <p role="alert">{message}</p>}
      {editable && (
        <form className="card add-item" onSubmit={(event) => void add(event)} aria-label={t('lists.addHeading')}>
          <ItemFields
            value={draft}
            onChange={(value) => {
              setDraft(value);
              setAddError(null);
            }}
            error={addError}
            titleRef={titleRef}
          />
          <button type="submit" className="primary" disabled={adding}>
            <UiIcon name="add" /> {t('lists.add')}
          </button>
        </form>
      )}
      {list.items.length === 0 && <p className="card calm">{t(editable ? 'lists.emptyHint' : 'lists.empty')}</p>}
      {toBuy.length > 0 && (
        <section aria-labelledby="list-to-buy" className="home-section">
          <h3 id="list-to-buy" className="section-label">
            {t('lists.toBuyHeading')}
          </h3>
          <ul className="plain-list card list-items" aria-labelledby="list-to-buy">
            {toBuy.map(row)}
          </ul>
        </section>
      )}
      {list.items.length > 0 && toBuy.length === 0 && (
        <p className="card calm">
          <UiIcon name="check" size="1.4em" /> {t('lists.allPurchased')}
        </p>
      )}
      {purchased.length > 0 && (
        <details className="more-actions purchased">
          <summary>{t('lists.purchasedHeading', { count: purchased.length })}</summary>
          <ul className="plain-list card list-items" aria-label={t('lists.purchasedHeading', { count: purchased.length })}>
            {purchased.map(row)}
          </ul>
        </details>
      )}
      <UndoNotice notice={notice} onDismiss={() => setNotice(null)} />
      {editing !== null && (
        <EditItemDialog
          key={editing.id}
          item={editing}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            const edit: ListChangeInput = { kind: 'editItem', listId, itemId: editing.id, title: value.title.trim(), quantity: value.quantity, unit: value.unit };
            if (device) {
              await onDevice(edit, editing.title);
              return;
            }
            pending.current += 1;
            try {
              keep(await api.updateListItem(workspaceId, listId, editing.id, value, editing.revision));
            } catch (caught) {
              if (!isNetworkError(caught)) throw caught;
              reportUnreachable();
              await onDevice(edit, editing.title);
            } finally {
              pending.current -= 1;
              // Also after a refusal (e.g. someone else edited it): show what is on the server now.
              if (pending.current === 0 && !device) load();
            }
          }}
        />
      )}
      {renaming && (
        <FormDialog
          title={t('lists.renameHeading')}
          submitLabel={t('lists.save')}
          onClose={() => setRenaming(false)}
          onSubmit={async () => {
            const rename: ListChangeInput = { kind: 'renameList', listId, title: newName.trim() };
            if (device) {
              await onDevice(rename, newName.trim());
              return;
            }
            try {
              keep(await api.renameList(workspaceId, listId, newName, list.title));
            } catch (caught) {
              if (!isNetworkError(caught)) throw caught;
              reportUnreachable();
              await onDevice(rename, newName.trim());
            }
          }}
        >
          <label>
            {t('lists.name')}
            <br />
            <input required maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
        </FormDialog>
      )}
    </section>
  );
}

/** Lists (15.3): the overview, or one List. Capabilities only adapt the UI; the server authorizes every request. */
export function Lists(props: { workspaceId: string; listId: string | null; creating: boolean; canEdit: boolean }) {
  return props.listId === null ? (
    <ListOverview workspaceId={props.workspaceId} creating={props.creating} canEdit={props.canEdit} />
  ) : (
    <ListPage workspaceId={props.workspaceId} listId={props.listId} canEdit={props.canEdit} />
  );
}
