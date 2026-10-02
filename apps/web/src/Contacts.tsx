import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  api,
  contactExportUrl,
  messageFor,
  type Contact,
  type ContactDuplicate,
  type ContactFileFormat,
  type ContactImportEntry,
  type ContactInput,
  type ContactProcedureLink,
  type ContactSummary,
  type DocumentLink,
  type ProcedureCard,
  type ProcedureContactLink,
  type TrashedContact,
} from './api.ts';
import {
  CONTACT_LIMITS,
  contactContext,
  contactListingParams,
  defaultImportSelection,
  duplicateText,
  emptyContactForm,
  formOf,
  importFormatOf,
  importProblemText,
  importRefusalText,
  importSummary,
  inputOf,
  isPossibleDuplicate,
  safeHref,
  worthChecking,
  type ContactForm,
  type PointForm,
} from './contact-model.ts';
import { useContactsTool } from './contacts-tool.ts';
import { DocumentPicker } from './DocumentLinks.tsx';
import { linkedRecordText } from './document-model.ts';
import { useDocumentsTool } from './documents-tool.ts';
import { FormDialog } from './FormDialog.tsx';
import { clearHandOver, handOver, handedOver } from './handoff.ts';
import { formatDateTime, t } from './i18n/index.ts';
import { MoreMenu, type MoreMenuItem } from './MoreMenu.tsx';
import { Link, navigate, paths, type Route } from './router.tsx';
import { UiIcon } from './ui-icons.tsx';
import { UndoNotice } from './UndoNotice.tsx';

type ContactsRoute = Extract<Route, { page: 'contacts' }>;

/** A Contact moved to Trash a moment ago: the list that follows offers to put it back. */
const DELETED_CONTACT = 'deleted-contact';
interface DeletedContact {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly name: string;
}

/** "Possibly the same as …": pointed out, each with a link — never merged, never a reason to refuse. */
function DuplicateHint(props: { workspaceId: string; duplicates: readonly ContactDuplicate[]; links?: boolean }) {
  if (props.duplicates.length === 0) return null;
  return (
    <div className="card calm duplicate-hint" role="note">
      <strong>{t('contacts.duplicate.heading')}</strong>
      <ul>
        {props.duplicates.map((duplicate) => (
          <li key={duplicate.id}>{props.links === false ? duplicateText(duplicate) : <Link href={paths.contact(props.workspaceId, duplicate.id)}>{duplicateText(duplicate)}</Link>}</li>
        ))}
      </ul>
      <small className="muted">{t('contacts.duplicate.kept')}</small>
    </div>
  );
}

/** Email addresses or phone numbers of the form: any number of rows, each with an optional label. */
function PointRows(props: { kind: 'email' | 'phone'; rows: readonly PointForm[]; onChange: (rows: PointForm[]) => void }) {
  const id = useId();
  const { kind, rows } = props;
  const set = (index: number, change: Partial<PointForm>) => props.onChange(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
  return (
    <fieldset className="stack plain-fieldset">
      <legend>{t(kind === 'email' ? 'contacts.field.emails' : 'contacts.field.phones')}</legend>
      {rows.map((row, index) => (
        <div key={index} className="contact-point-row">
          <div className="field">
            <label htmlFor={`${id}-${index}-value`}>{t(kind === 'email' ? 'contacts.field.email' : 'contacts.field.phone', { n: index + 1 })}</label>
            <input
              id={`${id}-${index}-value`}
              type={kind === 'email' ? 'email' : 'tel'}
              inputMode={kind === 'email' ? 'email' : 'tel'}
              autoComplete="off"
              maxLength={kind === 'email' ? CONTACT_LIMITS.email : CONTACT_LIMITS.phone}
              value={row.value}
              onChange={(event) => set(index, { value: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-${index}-label`}>{t('contacts.field.label', { n: index + 1 })}</label>
            <input id={`${id}-${index}-label`} maxLength={CONTACT_LIMITS.label} placeholder={t(kind === 'email' ? 'contacts.field.labelEmailExample' : 'contacts.field.labelPhoneExample')} value={row.label} onChange={(event) => set(index, { label: event.target.value })} />
          </div>
          <button type="button" className="quiet" aria-label={t(kind === 'email' ? 'contacts.field.removeEmail' : 'contacts.field.removePhone', { n: index + 1 })} onClick={() => props.onChange(rows.filter((_, position) => position !== index))}>
            <UiIcon name="close" />
          </button>
        </div>
      ))}
      {rows.length < CONTACT_LIMITS.points && (
        <div>
          <button type="button" onClick={() => props.onChange([...rows, { value: '', label: '' }])}>
            <UiIcon name="add" /> {t(kind === 'email' ? 'contacts.field.addEmail' : 'contacts.field.addPhone')}
          </button>
        </div>
      )}
    </fieldset>
  );
}

/**
 * Everything a Contact can hold. Only the name is required. While it is filled in, Contacts that may
 * be the same are pointed out below the form — a hint: saving is never refused because of it.
 */
function ContactDialog(props: { workspaceId: string; contact: Contact | null; initialName?: string; categories: readonly string[]; onClose: () => void; onSaved: (contact: Contact, duplicates: readonly ContactDuplicate[]) => void }) {
  const id = useId();
  const { workspaceId, contact } = props;
  const [form, setForm] = useState<ContactForm>(() => (contact === null ? { ...emptyContactForm(props.initialName ?? ''), phones: [{ value: '', label: '' }] } : formOf(contact)));
  const [duplicates, setDuplicates] = useState<readonly ContactDuplicate[]>([]);
  const set = (change: Partial<ContactForm>) => setForm((current) => ({ ...current, ...change }));
  // Asked a moment after typing stops. What cannot be checked yet (an unfinished address) is simply not compared.
  useEffect(() => {
    if (!worthChecking(form)) return;
    let current = true;
    const timer = window.setTimeout(() => {
      api.contactDuplicates(workspaceId, inputOf(form), contact?.id).then(
        (found) => current && setDuplicates(found),
        () => current && setDuplicates([]),
      );
    }, 500);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [workspaceId, contact?.id, form]);
  return (
    <FormDialog
      title={contact === null ? t('contacts.new.heading') : t('contacts.edit.heading', { name: contact.name })}
      submitLabel={t('contacts.save')}
      submitDisabled={form.name.trim() === ''}
      onClose={props.onClose}
      onSubmit={async () => {
        const saved = contact === null ? await api.createContact(workspaceId, inputOf(form)) : await api.updateContact(workspaceId, contact.id, inputOf(form), contact.revision);
        props.onSaved(saved.contact, saved.duplicates);
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-name`}>
          {t('contacts.field.name')} <span className="muted">{t('common.required')}</span>
        </label>
        <input id={`${id}-name`} required maxLength={CONTACT_LIMITS.name} autoComplete="off" value={form.name} aria-describedby={`${id}-name-hint`} onChange={(event) => set({ name: event.target.value })} />
        <small id={`${id}-name-hint`} className="muted">
          {t('contacts.field.nameHint')}
        </small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-category`}>{t('contacts.field.category')}</label>
        <input id={`${id}-category`} maxLength={CONTACT_LIMITS.category} list={`${id}-categories`} autoComplete="off" placeholder={t('contacts.field.categoryExample')} value={form.category} onChange={(event) => set({ category: event.target.value })} />
        <datalist id={`${id}-categories`}>
          {props.categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
      </div>
      <div className="field">
        <label htmlFor={`${id}-organisation`}>{t('contacts.field.organisation')}</label>
        <input id={`${id}-organisation`} maxLength={CONTACT_LIMITS.organisation} autoComplete="off" value={form.organisation} onChange={(event) => set({ organisation: event.target.value })} />
      </div>
      <PointRows kind="phone" rows={form.phones} onChange={(phones) => set({ phones })} />
      <PointRows kind="email" rows={form.emails} onChange={(emails) => set({ emails })} />
      <div className="field">
        <label htmlFor={`${id}-address`}>{t('contacts.field.address')}</label>
        <textarea id={`${id}-address`} rows={3} maxLength={CONTACT_LIMITS.address} autoComplete="off" value={form.address} onChange={(event) => set({ address: event.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-website`}>{t('contacts.field.website')}</label>
        <input id={`${id}-website`} inputMode="url" maxLength={CONTACT_LIMITS.website} autoComplete="off" placeholder="https://" value={form.website} aria-describedby={`${id}-website-hint`} onChange={(event) => set({ website: event.target.value })} />
        <small id={`${id}-website-hint`} className="muted">
          {t('contacts.field.websiteHint')}
        </small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-notes`}>{t('contacts.field.notes')}</label>
        <textarea id={`${id}-notes`} rows={4} maxLength={CONTACT_LIMITS.notes} value={form.notes} onChange={(event) => set({ notes: event.target.value })} />
      </div>
      <DuplicateHint workspaceId={workspaceId} duplicates={worthChecking(form) ? duplicates : []} links={false} />
    </FormDialog>
  );
}

/** Calling and writing: links the server built from checked values; what does not look like one stays text. */
function PointLink(props: { point: { value: string; label: string; href: string }; kind: 'tel' | 'mailto' }) {
  const href = safeHref(props.point.href, props.kind);
  const label = props.point.label === '' ? null : <small className="muted"> · {props.point.label}</small>;
  return (
    <li>
      {href === null ? (
        <span>{props.point.value}</span>
      ) : (
        <a className="contact-action" href={href} aria-label={t(props.kind === 'tel' ? 'contacts.call' : 'contacts.write', { value: props.point.value })}>
          {props.point.value}
        </a>
      )}
      {label}
    </li>
  );
}

/** The list: every Contact by name, found by name, organisation, category, number or address. */
function ContactList(props: { workspaceId: string; canManage: boolean; canExport: boolean }) {
  const { workspaceId, canManage } = props;
  const id = useId();
  const [find, setFind] = useState({ q: '', category: '' });
  const [contacts, setContacts] = useState<readonly ContactSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState(false);
  const [added, setAdded] = useState<{ contact: Contact; duplicates: readonly ContactDuplicate[] } | null>(null);
  const [deleted, setDeleted] = useState(() => {
    const handed = handedOver<DeletedContact>(DELETED_CONTACT);
    return handed?.workspaceId === workspaceId ? handed : null;
  });
  useEffect(() => clearHandOver(DELETED_CONTACT), []);
  const request = useRef(0);

  const load = useCallback(() => {
    const mine = ++request.current;
    api.contacts(workspaceId, contactListingParams(find)).then(
      (page) => {
        // An answer to an older search must not replace a newer one.
        if (mine !== request.current) return;
        setContacts(page.contacts);
        setNext(page.nextCursor);
        setTotal(page.total);
        setMessage(null);
      },
      (caught: unknown) => mine === request.current && setMessage(messageFor(caught)),
    );
    void api.contactCategories(workspaceId).then(setCategories, () => undefined);
  }, [workspaceId, find]);
  useEffect(() => {
    const timer = window.setTimeout(load, find.q === '' ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [load, find.q]);

  async function quickAdd(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '') return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api.createContact(workspaceId, { name });
      setName('');
      setAdded(saved);
      setStatus(t('contacts.added', { name: saved.contact.name }));
      load();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setSaving(false);
    }
  }
  const menu: MoreMenuItem[] = [
    ...(canManage ? [{ label: t('contacts.import.open'), onSelect: () => navigate(paths.contactImport(workspaceId)) }] : []),
    ...(props.canExport
      ? [
          { label: t('contacts.export.csv'), onSelect: () => window.location.assign(contactExportUrl(workspaceId, 'csv')) },
          { label: t('contacts.export.vcard'), onSelect: () => window.location.assign(contactExportUrl(workspaceId, 'vcard')) },
        ]
      : []),
    ...(canManage ? [{ label: t('contacts.trash.open'), onSelect: () => navigate(paths.contactTrash(workspaceId)) }] : []),
  ];
  const searching = find.q.trim() !== '' || find.category !== '';
  return (
    <section aria-labelledby="contacts-heading">
      <div className="page-header page-header-tool">
        <div>
          <h2 id="contacts-heading">{t('shell.contacts')}</h2>
          <p className="muted page-lead">{t('contacts.lead')}</p>
        </div>
        {menu.length > 0 && <MoreMenu label={t('contacts.moreActions')} items={menu} />}
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {canManage && (
        <form className="card stack" onSubmit={(event) => void quickAdd(event)} aria-label={t('contacts.new.heading')}>
          <div className="row contact-quick-add">
            <div className="field">
              <label htmlFor={`${id}-new`}>{t('contacts.new.label')}</label>
              <input id={`${id}-new`} maxLength={CONTACT_LIMITS.name} autoComplete="off" placeholder={t('contacts.new.example')} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <button type="submit" className="primary" disabled={saving || name.trim() === ''}>
              {t('contacts.save')}
            </button>
            <button type="button" onClick={() => setDetails(true)}>
              {t('contacts.new.more')}
            </button>
          </div>
        </form>
      )}
      <p role="status" className={status === null ? 'visually-hidden' : 'card calm'}>
        {status ?? ''}
        {added !== null && (
          <>
            {' '}
            <Link href={paths.contact(workspaceId, added.contact.id)}>{t('contacts.addedOpen')}</Link>
          </>
        )}
      </p>
      {added !== null && <DuplicateHint workspaceId={workspaceId} duplicates={added.duplicates} />}
      <div className="row contact-find">
        <div className="field">
          <label htmlFor={`${id}-q`}>{t('contacts.find.search')}</label>
          <input id={`${id}-q`} type="search" maxLength={100} value={find.q} onChange={(event) => setFind({ ...find, q: event.target.value })} />
        </div>
        {categories.length > 0 && (
          <div className="field">
            <label htmlFor={`${id}-category`}>{t('contacts.find.category')}</label>
            <select id={`${id}-category`} value={find.category} onChange={(event) => setFind({ ...find, category: event.target.value })}>
              <option value="">{t('contacts.find.allCategories')}</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {contacts === null ? (
        message === null && <p>{t('common.loading')}</p>
      ) : contacts.length === 0 ? (
        <p className="card calm">{t(searching ? 'contacts.find.none' : canManage ? 'contacts.noneHint' : 'contacts.none')}</p>
      ) : (
        <>
          {total !== null && (
            <p className="muted" aria-live="polite">
              {t(searching ? 'contacts.find.count' : 'contacts.count', { count: total })}
            </p>
          )}
          <ul className="plain-list" aria-labelledby="contacts-heading">
            {contacts.map((contact) => {
              const phone = contact.phones[0];
              const href = phone === undefined ? null : safeHref(phone.href, 'tel');
              const context = contactContext(contact);
              return (
                <li key={contact.id} className="card contact-card">
                  <Link href={paths.contact(workspaceId, contact.id)} className="contact-card-main" aria-label={t('contacts.openNamed', { name: contact.name })}>
                    <span className="item-icon">
                      <UiIcon name="contacts" size="1.5em" />
                    </span>
                    <span className="item-body">
                      <strong>{contact.name}</strong>
                      {context !== '' && <small className="muted">{context}</small>}
                    </span>
                  </Link>
                  {phone !== undefined && href !== null && (
                    <a className="button contact-action" href={href} aria-label={t('contacts.callNamed', { name: contact.name, value: phone.value })}>
                      {phone.value}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          {next !== null && (
            <button
              type="button"
              onClick={() =>
                void api.contacts(workspaceId, contactListingParams(find, next)).then(
                  (page) => {
                    setContacts([...contacts, ...page.contacts]);
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
      <UndoNotice
        notice={
          deleted === null
            ? null
            : {
                message: t('contacts.deleted', { name: deleted.name }),
                undo: () => void api.restoreContact(workspaceId, deleted.contactId).then(load, (caught: unknown) => setMessage(messageFor(caught))),
              }
        }
        onDismiss={() => setDeleted(null)}
      />
      {details && (
        <ContactDialog
          workspaceId={workspaceId}
          contact={null}
          initialName={name}
          categories={categories}
          onClose={() => setDetails(false)}
          onSaved={(contact, duplicates) => {
            setName('');
            setAdded({ contact, duplicates });
            setStatus(t('contacts.added', { name: contact.name }));
            load();
          }}
        />
      )}
    </section>
  );
}

/** What a Contact is linked to: Procedures, and — where the Documents tool is on — Documents. References only. */
function ContactLinks(props: { workspaceId: string; contact: Contact; canManage: boolean }) {
  const { workspaceId, contact } = props;
  const documentsTool = useDocumentsTool();
  const id = useId();
  const [procedures, setProcedures] = useState<readonly ContactProcedureLink[]>([]);
  const [documents, setDocuments] = useState<readonly DocumentLink[]>([]);
  const [dialog, setDialog] = useState<'procedure' | 'document' | null>(null);
  const [options, setOptions] = useState<readonly ProcedureCard[] | null>(null);
  const [choice, setChoice] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const load = useCallback(() => {
    void api.contactProcedures(workspaceId, contact.id).then(setProcedures, () => undefined);
    if (documentsTool.enabled) void api.linkedDocuments(workspaceId, { type: 'contact', id: contact.id }).then(setDocuments, () => undefined);
  }, [workspaceId, contact.id, documentsTool.enabled]);
  useEffect(load, [load]);
  const canLinkDocuments = documentsTool.enabled && documentsTool.canManage;
  if (!props.canManage && procedures.length === 0 && documents.length === 0) return null;
  const removed = (name: string) => () => {
    setStatus(t('links.removed', { name }));
    load();
  };
  const failed = (caught: unknown) => setMessage(messageFor(caught));
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
      {procedures.length === 0 && documents.length === 0 && <p className="muted">{t('contacts.links.none')}</p>}
      {(procedures.length > 0 || documents.length > 0) && (
        <ul className="plain-list card">
          {procedures.map((link) => {
            const title = link.title ?? t('links.recordGone');
            return (
              <li key={link.id} className="link-line">
                <span className="item-body">
                  <span>
                    <small className="muted">{t('links.kind.procedure')}: </small>
                    {link.state === 'ok' ? <Link href={paths.procedure(workspaceId, link.procedureId)}>{title}</Link> : <span>{title}</span>}
                  </span>
                  {link.state === 'deleted' && <small className="muted">{t('links.procedureDeleted')}</small>}
                </span>
                {props.canManage && (
                  <button type="button" className="quiet" aria-label={t('links.removeNamed', { name: title })} onClick={() => void api.unlinkContactProcedure(workspaceId, link.id).then(removed(title), failed)}>
                    {t('links.remove')}
                  </button>
                )}
              </li>
            );
          })}
          {documents.map((link) => {
            const text = linkedRecordText(link.record);
            return (
              <li key={link.id} className="link-line">
                <span className="item-body">
                  <span>
                    <small className="muted">{t('links.kind.document')}: </small>
                    {text.open ? <Link href={paths.document(workspaceId, link.record.id)}>{text.title}</Link> : <span>{text.title}</span>}
                  </span>
                  {text.note !== null && <small className="muted">{text.note}</small>}
                </span>
                {canLinkDocuments && (
                  <button type="button" className="quiet" aria-label={t('links.removeNamed', { name: text.title })} onClick={() => void api.removeDocumentLink(workspaceId, link.id).then(removed(text.title), failed)}>
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
          <button
            type="button"
            onClick={() => {
              setChoice('');
              setDialog('procedure');
              void api.procedures(workspaceId).then(setOptions, () => setOptions([]));
            }}
          >
            {t('contacts.links.addProcedure')}
          </button>
          {canLinkDocuments && (
            <button type="button" onClick={() => (setChoice(''), setDialog('document'))}>
              {t('contacts.links.addDocument')}
            </button>
          )}
        </div>
      )}
      {dialog !== null && (
        <FormDialog
          title={t(dialog === 'procedure' ? 'contacts.links.procedureHeading' : 'contacts.links.documentHeading', { name: contact.name })}
          submitLabel={t('links.addConfirm')}
          submitDisabled={choice === ''}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            if (dialog === 'procedure') {
              const link = await api.linkContactProcedure(workspaceId, contact.id, choice);
              setStatus(t('links.added', { name: link.title ?? '' }));
            } else {
              await api.addDocumentLink(workspaceId, choice, { type: 'contact', id: contact.id });
              setStatus(t('contacts.links.documentAdded'));
            }
            load();
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            {t('links.addHint')}
          </p>
          {dialog === 'procedure' ? (
            <div className="field">
              <label htmlFor={`${id}-procedure`}>{t('links.pick.procedure')}</label>
              <select id={`${id}-procedure`} required value={choice} onChange={(event) => setChoice(event.target.value)}>
                <option value="">{options === null ? t('common.loading') : t('links.pick.choose')}</option>
                {(options ?? [])
                  .filter((each) => !procedures.some((link) => link.procedureId === each.id))
                  .map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.title}
                    </option>
                  ))}
              </select>
            </div>
          ) : (
            <DocumentPicker workspaceId={workspaceId} exclude={documents.map((link) => link.record.id)} value={choice} onChange={setChoice} />
          )}
        </FormDialog>
      )}
    </section>
  );
}

/** One Contact: who they are, how to reach them (tap a number to call), what they are linked to. */
function ContactPage(props: { workspaceId: string; contactId: string; canManage: boolean }) {
  const { workspaceId, contactId } = props;
  const [contact, setContact] = useState<Contact | null>(null);
  const [duplicates, setDuplicates] = useState<readonly ContactDuplicate[]>([]);
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    api.contact(workspaceId, contactId).then(
      (loaded) => {
        setContact(loaded.contact);
        setDuplicates(loaded.duplicates);
      },
      (caught: unknown) => setMessage(messageFor(caught)),
    );
  }, [workspaceId, contactId]);
  const back = (
    <p className="back-row">
      <Link href={paths.contacts(workspaceId)} className="back-link">
        <UiIcon name="back" /> {t('contacts.back')}
      </Link>
    </p>
  );
  if (contact === null) {
    return (
      <section>
        {back}
        {message !== null ? <p role="alert">{message}</p> : <p>{t('common.loading')}</p>}
      </section>
    );
  }
  const context = contactContext(contact);
  const website = safeHref(contact.website, 'web');
  return (
    <section aria-labelledby="contact-heading" className="stack">
      {back}
      <div className="page-header page-header-tool">
        <div>
          <h2 id="contact-heading">{contact.name}</h2>
          {context !== '' && <p className="muted page-lead">{context}</p>}
        </div>
        {props.canManage && (
          <div className="row">
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                void api.contactCategories(workspaceId).then(setCategories, () => undefined);
              }}
            >
              {t('contacts.edit.button')}
            </button>
            <MoreMenu label={t('contacts.moreActionsNamed', { name: contact.name })} items={[{ label: t('contacts.delete.button'), danger: true, onSelect: () => setDeleting(true) }]} />
          </div>
        )}
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && (
        <p role="status" className="card calm">
          {status}
        </p>
      )}
      <DuplicateHint workspaceId={workspaceId} duplicates={duplicates} />
      <div className="card stack contact-details">
        {contact.phones.length > 0 && (
          <div>
            <h3 className="section-label">{t('contacts.field.phones')}</h3>
            <ul className="plain-list">
              {contact.phones.map((phone) => (
                <PointLink key={phone.value} point={phone} kind="tel" />
              ))}
            </ul>
          </div>
        )}
        {contact.emails.length > 0 && (
          <div>
            <h3 className="section-label">{t('contacts.field.emails')}</h3>
            <ul className="plain-list">
              {contact.emails.map((email) => (
                <PointLink key={email.value} point={email} kind="mailto" />
              ))}
            </ul>
          </div>
        )}
        {contact.website !== '' && (
          <div>
            <h3 className="section-label">{t('contacts.field.website')}</h3>
            {/* A new tab that cannot reach back into this page, and that is not told where it was opened from. */}
            {website === null ? (
              <span>{contact.website}</span>
            ) : (
              <a className="contact-action" href={website} target="_blank" rel="noopener noreferrer">
                {contact.website}
              </a>
            )}
          </div>
        )}
        {contact.address !== '' && (
          <div>
            <h3 className="section-label">{t('contacts.field.address')}</h3>
            <p className="document-notes">{contact.address}</p>
          </div>
        )}
        {contact.notes !== '' && (
          <div>
            <h3 className="section-label">{t('contacts.field.notes')}</h3>
            <p className="document-notes">{contact.notes}</p>
          </div>
        )}
        {contact.phones.length + contact.emails.length === 0 && contact.website === '' && contact.address === '' && contact.notes === '' && <p className="muted">{t(props.canManage ? 'contacts.emptyHint' : 'contacts.empty')}</p>}
        <small className="muted">{t('contacts.modified', { when: formatDateTime(contact.modifiedAt), name: contact.modifiedBy })}</small>
      </div>
      <ContactLinks workspaceId={workspaceId} contact={contact} canManage={props.canManage} />
      {editing && (
        <ContactDialog
          workspaceId={workspaceId}
          contact={contact}
          categories={categories}
          onClose={() => setEditing(false)}
          onSaved={(saved, found) => {
            setContact(saved);
            setDuplicates(found);
            setStatus(t('contacts.saved'));
          }}
        />
      )}
      {deleting && (
        <FormDialog
          title={t('contacts.delete.heading', { name: contact.name })}
          submitLabel={t('contacts.delete.confirm')}
          danger
          onClose={() => setDeleting(false)}
          onSubmit={async () => {
            await api.deleteContact(workspaceId, contact.id);
            handOver(DELETED_CONTACT, { workspaceId, contactId: contact.id, name: contact.name } satisfies DeletedContact);
            navigate(paths.contacts(workspaceId));
          }}
        >
          <p style={{ margin: 0 }}>{t('contacts.delete.what')}</p>
        </FormDialog>
      )}
    </section>
  );
}

/** Contacts in Trash: restore one, or — a Workspace admin — delete for good. Nothing leaves Trash by itself. */
function ContactTrash(props: { workspaceId: string; canPurge: boolean }) {
  const { workspaceId, canPurge } = props;
  const [contacts, setContacts] = useState<readonly TrashedContact[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashedContact | 'all' | null>(null);
  const load = useCallback(() => {
    api.contactTrash(workspaceId).then(setContacts, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId]);
  useEffect(load, [load]);
  return (
    <section aria-labelledby="contact-trash-heading">
      <p className="back-row">
        <Link href={paths.contacts(workspaceId)} className="back-link">
          <UiIcon name="back" /> {t('contacts.back')}
        </Link>
      </p>
      <div className="page-header page-header-tool">
        <div>
          <h2 id="contact-trash-heading">{t('contacts.trash.heading')}</h2>
          <p className="muted page-lead">{t(canPurge ? 'contacts.trash.leadAdmin' : 'contacts.trash.lead')}</p>
        </div>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && (
        <p role="status" className="card calm">
          {status}
        </p>
      )}
      {contacts === null ? (
        message === null && <p>{t('common.loading')}</p>
      ) : contacts.length === 0 ? (
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
            {contacts.map((contact) => (
              <li key={contact.id} className="card">
                <div className="trash-entry">
                  <span className="item-icon">
                    <UiIcon name="contacts" size="1.5em" />
                  </span>
                  <span className="item-body">
                    <strong>{contact.name}</strong>
                    {contact.organisation !== '' && <small className="muted">{contact.organisation}</small>}
                    <small className="muted">{t('documents.trash.deletedBy', { name: contact.deletedBy, when: formatDateTime(contact.deletedAt) })}</small>
                  </span>
                </div>
                <div className="row">
                  <button
                    type="button"
                    aria-label={t('documents.trash.restoreNamed', { name: contact.name })}
                    onClick={() =>
                      void api.restoreContact(workspaceId, contact.id).then(
                        () => {
                          setStatus(t('contacts.trash.restored', { name: contact.name }));
                          load();
                        },
                        (caught: unknown) => setMessage(messageFor(caught)),
                      )
                    }
                  >
                    <UiIcon name="undo" /> {t('documents.trash.restore')}
                  </button>
                  {canPurge && (
                    <button type="button" className="quiet danger-text" aria-label={t('documents.purge.oneNamed', { name: contact.name })} onClick={() => setPurging(contact)}>
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
          title={purging === 'all' ? t('contacts.purge.allHeading') : t('contacts.purge.oneHeading', { name: purging.name })}
          submitLabel={t('documents.purge.confirm')}
          danger
          onClose={() => setPurging(null)}
          onSubmit={async () => {
            const purged = await api.purgeContacts(workspaceId, purging === 'all' ? 'all' : [purging.id]);
            setStatus(t('contacts.purge.done', { count: purged }));
            load();
          }}
        >
          <p style={{ margin: 0 }}>
            <strong>{t('contacts.purge.what', { count: purging === 'all' ? (contacts?.length ?? 0) : 1 })}</strong>
          </p>
          <p style={{ margin: 0 }}>{t('documents.purge.cannotUndo')}</p>
          <p className="muted" style={{ margin: 0 }}>
            {t('contacts.purge.links')}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {t('contacts.purge.backups')}
          </p>
        </FormDialog>
      )}
    </section>
  );
}

/** One entry of the preview: what would be saved, what it may be the same as — or why it cannot be imported. */
function ImportEntry(props: { entry: ContactImportEntry; entries: readonly ContactImportEntry[]; chosen: boolean; onChoose: (chosen: boolean) => void }) {
  const { entry } = props;
  const id = useId();
  const contact = entry.contact;
  if (contact === null) {
    return (
      <li className="card import-entry import-entry-problem">
        <span className="item-body">
          <strong>{entry.name === '' ? t('contacts.import.noName') : entry.name}</strong>
          <small>
            {t('contacts.import.cannot', { line: entry.line })} {entry.problem === null ? '' : importProblemText(entry.problem)}
          </small>
        </span>
      </li>
    );
  }
  const facts = [contact.category, contact.organisation, ...(contact.phones ?? []).map((phone) => phone.value), ...(contact.emails ?? []).map((email) => email.value)].filter((fact) => fact !== undefined && fact !== '');
  return (
    <li className="card import-entry">
      <input id={id} type="checkbox" checked={props.chosen} onChange={(event) => props.onChoose(event.target.checked)} />
      <span className="item-body">
        <label htmlFor={id}>
          <strong>{contact.name}</strong>
        </label>
        {facts.length > 0 && <small className="muted">{facts.join(' · ')}</small>}
        {isPossibleDuplicate(entry) && (
          <small role="note">
            <strong>{t('contacts.duplicate.heading')}</strong>{' '}
            {[...entry.duplicates.map(duplicateText), ...entry.sameAs.map((same) => t('contacts.import.sameAsEntry', { name: props.entries[same.entry]?.name ?? '', line: props.entries[same.entry]?.line ?? 0 }))].join('; ')}
            {'. '}
            {t(props.chosen ? 'contacts.import.duplicateIn' : 'contacts.import.duplicateOut')}
          </small>
        )}
      </span>
    </li>
  );
}

/**
 * Import of a CSV or vCard file in two steps: the file is read by the server and shown — every entry,
 * the possible duplicates, what cannot be imported and what was not used — and only what stays ticked
 * is saved when the person confirms. Nothing is merged and nothing is left out unseen.
 */
function ContactImport(props: { workspaceId: string }) {
  const { workspaceId } = props;
  const id = useId();
  const [format, setFormat] = useState<ContactFileFormat | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<{ entries: readonly ContactImportEntry[]; ignored: readonly string[] } | null>(null);
  const [chosen, setChosen] = useState<readonly number[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  async function read(file: File | undefined) {
    setPreview(null);
    setDone(null);
    setMessage(null);
    if (file === undefined) return;
    const detected = importFormatOf(file.name);
    setFileName(file.name);
    if (detected === null) return setMessage(t('contacts.import.wrongType'));
    if (file.size > CONTACT_LIMITS.importBytes) return setMessage(t('contacts.importRefused.contact_import_too_large'));
    setBusy(true);
    try {
      const loaded = await api.previewContactImport(workspaceId, detected, file);
      setFormat(detected);
      setPreview(loaded);
      setChosen(defaultImportSelection(loaded.entries));
    } catch (caught) {
      setMessage(caught instanceof ApiError && caught.code === 'contact_import_refused' ? importRefusalText(caught.details.reason, caught.details.line) : caught instanceof ApiError && caught.status === 413 ? t('contacts.importRefused.contact_import_too_large') : messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (preview === null || format === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const contacts = chosen.flatMap((index): ContactInput[] => {
        const contact = preview.entries[index]?.contact;
        return contact === null || contact === undefined ? [] : [contact];
      });
      setDone(await api.importContacts(workspaceId, format, contacts));
      setPreview(null);
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  const summary = preview === null ? null : importSummary(preview.entries);
  return (
    <section aria-labelledby="contact-import-heading" className="stack">
      <p className="back-row">
        <Link href={paths.contacts(workspaceId)} className="back-link">
          <UiIcon name="back" /> {t('contacts.back')}
        </Link>
      </p>
      <div className="page-header page-header-tool">
        <div>
          <h2 id="contact-import-heading">{t('contacts.import.heading')}</h2>
          <p className="muted page-lead">{t('contacts.import.lead')}</p>
        </div>
      </div>
      <div className="card stack">
        <div className="field">
          <label htmlFor={`${id}-file`}>{t('contacts.import.file')}</label>
          <input id={`${id}-file`} type="file" accept=".csv,.vcf,.vcard,text/csv,text/vcard" disabled={busy} aria-describedby={`${id}-file-hint`} onChange={(event) => void read(event.target.files?.[0])} />
          <small id={`${id}-file-hint`} className="muted">
            {t('contacts.import.fileHint')}
          </small>
        </div>
      </div>
      {busy && <p>{t('common.loading')}</p>}
      {message !== null && <p role="alert">{message}</p>}
      {done !== null && (
        <p role="status" className="card calm">
          {t('contacts.import.done', { count: done })} <Link href={paths.contacts(workspaceId)}>{t('contacts.back')}</Link>
        </p>
      )}
      {preview !== null && summary !== null && (
        <>
          <div className="card import-summary" role="status">
            <strong>{t('contacts.import.found', { count: summary.total, file: fileName })}</strong>
            {summary.duplicates > 0 && <span>{t('contacts.import.duplicates', { count: summary.duplicates })}</span>}
            {summary.problems > 0 && <span>{t('contacts.import.problems', { count: summary.problems })}</span>}
            {preview.ignored.length > 0 && <span className="muted">{t('contacts.import.ignored', { names: preview.ignored.join(', ') })}</span>}
            <span className="muted">{t('contacts.import.nothingSavedYet')}</span>
          </div>
          <div className="row select-bar">
            <button type="button" onClick={() => setChosen(preview.entries.flatMap((entry, index) => (entry.contact === null ? [] : [index])))}>
              {t('contacts.import.selectAll')}
            </button>
            <button type="button" onClick={() => setChosen(defaultImportSelection(preview.entries))}>
              {t('contacts.import.selectNew')}
            </button>
            <button type="button" onClick={() => setChosen([])}>
              {t('contacts.import.selectNone')}
            </button>
          </div>
          <ul className="plain-list" aria-label={t('contacts.import.entries')}>
            {/* Possible duplicates and what cannot be imported first: that is where a decision is needed. */}
            {preview.entries
              .map((entry, index) => ({ entry, index }))
              .sort((a, b) => Number(isPossibleDuplicate(b.entry) || b.entry.contact === null) - Number(isPossibleDuplicate(a.entry) || a.entry.contact === null) || a.index - b.index)
              .map(({ entry, index }) => (
                <ImportEntry
                  key={index}
                  entry={entry}
                  entries={preview.entries}
                  chosen={chosen.includes(index)}
                  onChoose={(on) => setChosen(on ? [...chosen, index] : chosen.filter((each) => each !== index))}
                />
              ))}
          </ul>
          <div className="row import-confirm">
            <button type="button" className="primary" disabled={busy || chosen.length === 0} onClick={() => void save()}>
              {t('contacts.import.confirm', { count: chosen.length })}
            </button>
            <span className="muted">{t('contacts.import.leftOut', { count: summary.total - chosen.length })}</span>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The Contacts linked to a Procedure — whom to call — folded away, and only there when the Contacts
 * tool is on and something is linked. A deleted Contact is said to be one, not named.
 */
export function LinkedContacts(props: { workspaceId: string; procedureId: string }) {
  const tool = useContactsTool();
  const { workspaceId, procedureId } = props;
  const [links, setLinks] = useState<readonly ProcedureContactLink[]>([]);
  useEffect(() => {
    if (!tool.enabled) return;
    let current = true;
    // A failure here is not worth a message: the page works without this list.
    api.procedureContacts(workspaceId, procedureId).then(
      (loaded) => current && setLinks(loaded),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [tool.enabled, workspaceId, procedureId]);
  if (!tool.enabled || links.length === 0) return null;
  return (
    <details className="more-actions linked-documents">
      <summary>{t('contacts.linked', { count: links.length })}</summary>
      <ul className="plain-list">
        {links.map((link) => {
          const phone = link.contact?.phones[0];
          const href = phone === undefined ? null : safeHref(phone.href, 'tel');
          return (
            <li key={link.id} className="link-line">
              <span className="item-body">
                {link.contact === null ? <span>{t('contacts.deletedContact')}</span> : <Link href={paths.contact(workspaceId, link.contact.id)}>{link.contact.name}</Link>}
                {link.contact !== null && contactContext(link.contact) !== '' && <small className="muted">{contactContext(link.contact)}</small>}
              </span>
              {link.contact !== null && phone !== undefined && href !== null && (
                <a className="contact-action" href={href} aria-label={t('contacts.callNamed', { name: link.contact.name, value: phone.value })}>
                  {phone.value}
                </a>
              )}
              {link.contact === null && tool.canManage && (
                <button type="button" className="quiet" aria-label={t('links.removeNamed', { name: t('contacts.deletedContact') })} onClick={() => void api.unlinkContactProcedure(workspaceId, link.id).then(() => setLinks(links.filter((each) => each.id !== link.id)), () => undefined)}>
                  {t('links.remove')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * The Contacts tool (16.6): the people and organisations of the Workspace. Everyone in the Workspace
 * reads them; `canManage` (USER and above) adds, edits, deletes to Trash and imports; `canExport`
 * saves them as a file; `canPurge` (Workspace admins) deletes for good. The controls shown follow
 * that — the server decides on every request.
 */
export function Contacts(props: { workspaceId: string; route: ContactsRoute; canManage: boolean; canExport: boolean; canPurge: boolean }) {
  const { workspaceId, route, canManage } = props;
  const readOnly = (
    <p role="alert">
      {t('contacts.manageOnly')} <Link href={paths.contacts(workspaceId)}>{t('contacts.back')}</Link>
    </p>
  );
  if (route.view === 'contact' && route.contactId !== null) return <ContactPage workspaceId={workspaceId} contactId={route.contactId} canManage={canManage} />;
  if (route.view === 'import') return canManage ? <ContactImport workspaceId={workspaceId} /> : readOnly;
  if (route.view === 'trash') return canManage ? <ContactTrash workspaceId={workspaceId} canPurge={props.canPurge} /> : readOnly;
  return <ContactList workspaceId={workspaceId} canManage={canManage} canExport={props.canExport} />;
}
