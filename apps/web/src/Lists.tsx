import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ApiError, api, isNetworkError, messageFor, type ListDetail, type ListItem, type ListItemInput, type ListSummary } from './api.ts';
import { FormDialog } from './FormDialog.tsx';
import { clearHandOver, handOver, handedOver } from './handoff.ts';
import { formatRelative, hasMessage, t } from './i18n/index.ts';
import { amountLabel, isCurrent, splitItems, withChecked } from './list-model.ts';
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
  const [lists, setLists] = useState<readonly ListSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<Undoable | null>(null);
  const [name, setName] = useState('');
  const created = useRef(false);

  const load = useCallback(() => {
    api.lists(workspaceId).then(
      (loaded) => {
        setLists(loaded);
        setMessage(null);
      },
      (caught: unknown) => setMessage(failure(caught)),
    );
  }, [workspaceId]);
  useEffect(load, [load]);
  useRefresh(load, OVERVIEW_REFRESH_MS);
  // Arriving here right after deleting a List: offer Undo.
  const [deleted, setDeleted] = useState(() => {
    const handed = handedOver<DeletedList>(DELETED_LIST);
    return handed?.workspaceId === workspaceId ? handed : null;
  });
  useEffect(() => clearHandOver(DELETED_LIST), []);
  const shownNotice: Undoable | null =
    deleted === null
      ? notice
      : {
          message: t('lists.deleted', { title: deleted.title }),
          undo: () => void api.restoreList(workspaceId, deleted.listId).then(load, (caught: unknown) => setMessage(failure(caught))),
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
      {message !== null && <p role="alert">{message}</p>}
      {lists === null ? (
        message === null && <p>{t('common.loading')}</p>
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
            const list = await api.createList(workspaceId, name);
            created.current = true;
            navigate(paths.list(workspaceId, list.id), { replace: true });
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
  const [list, setList] = useState<ListDetail | null>(null);
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

  const show = useCallback((next: ListDetail) => {
    if (!isCurrent(shown.current, next)) return;
    shown.current = next;
    setList(next);
  }, []);
  const load = useCallback(() => {
    if (pending.current > 0) return;
    api.list(workspaceId, listId).then(
      (loaded) => {
        if (pending.current === 0) show(loaded);
        setMessage(null);
      },
      (caught: unknown) => {
        if (caught instanceof ApiError && caught.status === 404) setMissing(true);
        setMessage(failure(caught));
      },
    );
  }, [workspaceId, listId, show]);
  useEffect(load, [load]);
  useRefresh(load, REFRESH_MS);

  /** Sends a change; the answer is the canonical List. `undo` is offered once it is saved. */
  async function change(action: () => Promise<ListDetail>, undo?: Undoable, optimistic?: ListDetail): Promise<boolean> {
    setMessage(null);
    setNotice(null);
    pending.current += 1;
    if (optimistic !== undefined) setList(optimistic);
    try {
      const answer = await action();
      shown.current = answer;
      setList(answer);
      if (undo !== undefined) setNotice(undo);
      return true;
    } catch (caught) {
      // Back to what the server last said, with the reason — then ask it again (someone else may have changed it).
      setList(shown.current);
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
  const setChecked = (item: ListItem, checked: boolean) =>
    void changeOrReload(
      () => api.checkListItem(workspaceId, listId, item.id, checked),
      { message: t(checked ? 'lists.checkedNotice' : 'lists.uncheckedNotice', { title: item.title }), undo: () => void changeOrReload(() => api.checkListItem(workspaceId, listId, item.id, !checked)) },
      list === null ? undefined : withChecked(list, item.id, checked, t('lists.you'), new Date().toISOString()),
    );
  const remove = (item: ListItem) =>
    void changeOrReload(() => api.removeListItem(workspaceId, listId, item.id), {
      message: t('lists.removedNotice', { title: item.title }),
      undo: () => void changeOrReload(() => api.restoreListItem(workspaceId, listId, item.id)),
    });

  async function add(event: FormEvent) {
    event.preventDefault();
    if (draft.title.trim() === '') return;
    setAddError(null);
    setAdding(true);
    pending.current += 1;
    try {
      const answer = await api.addListItem(workspaceId, listId, cleaned(draft));
      shown.current = answer;
      setList(answer);
      setDraft(EMPTY_ITEM);
      setMessage(null);
    } catch (caught) {
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
    try {
      await api.deleteList(workspaceId, listId);
      handOver(DELETED_LIST, { workspaceId, listId, title: list.title } satisfies DeletedList);
      navigate(paths.lists(workspaceId), { replace: true });
    } catch (caught) {
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
    return (
      <section aria-label={t('shell.lists')}>
        {back}
        {message !== null ? <p role="alert">{message}</p> : <p>{t('common.loading')}</p>}
      </section>
    );
  }
  const { toBuy, purchased } = splitItems(list.items);
  const editable = props.canEdit && !missing;
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
            pending.current += 1;
            try {
              const answer = await api.updateListItem(workspaceId, listId, editing.id, value, editing.revision);
              shown.current = answer;
              setList(answer);
            } finally {
              pending.current -= 1;
              // Also after a refusal (e.g. someone else edited it): show what is on the server now.
              if (pending.current === 0) load();
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
            const answer = await api.renameList(workspaceId, listId, newName, list.title);
            shown.current = answer;
            setList(answer);
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
