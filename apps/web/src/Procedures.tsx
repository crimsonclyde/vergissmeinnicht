import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFor, PROCEDURE_ICONS, type Procedure, type ProcedureContent, type ProcedureIcon } from './api.ts';

/** Glyph plus text label for every trusted icon key; the label is what screen readers announce. */
const ICONS: Record<ProcedureIcon, { glyph: string; label: string }> = {
  checklist: { glyph: '☑️', label: 'Checklist' },
  home: { glyph: '🏠', label: 'Home' },
  kitchen: { glyph: '🍳', label: 'Kitchen' },
  cleaning: { glyph: '🧹', label: 'Cleaning' },
  laundry: { glyph: '🧺', label: 'Laundry' },
  garden: { glyph: '🌱', label: 'Garden' },
  pet: { glyph: '🐾', label: 'Pet' },
  car: { glyph: '🚗', label: 'Car' },
  travel: { glyph: '🧳', label: 'Travel' },
  tools: { glyph: '🛠️', label: 'Tools' },
  health: { glyph: '🩺', label: 'Health' },
  shopping: { glyph: '🛒', label: 'Shopping' },
  document: { glyph: '📄', label: 'Document' },
  security: { glyph: '🔒', label: 'Security' },
  star: { glyph: '⭐', label: 'Star' },
};

function Icon({ icon }: { icon: ProcedureIcon }) {
  return (
    <span role="img" aria-label={ICONS[icon].label} title={ICONS[icon].label}>
      {ICONS[icon].glyph}
    </span>
  );
}

const EMPTY: ProcedureContent = { title: '', description: '', icon: 'checklist', tags: [] };

function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

function ProcedureForm(props: {
  initial: ProcedureContent;
  submitLabel: string;
  onSubmit: (content: ProcedureContent) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(props.initial.title);
  const [description, setDescription] = useState(props.initial.description);
  const [icon, setIcon] = useState<ProcedureIcon>(props.initial.icon);
  const [tags, setTags] = useState(props.initial.tags.join(', '));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await props.onSubmit({ title, description, icon, tags: splitTags(tags) });
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {message !== null && <p role="alert">{message}</p>}
      <p>
        <label>
          Title
          <br />
          <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Description
          <br />
          <textarea rows={4} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Icon{' '}
          <select value={icon} onChange={(e) => setIcon(e.target.value as ProcedureIcon)}>
            {PROCEDURE_ICONS.map((key) => (
              <option key={key} value={key}>
                {ICONS[key].glyph} {ICONS[key].label}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Tags (comma-separated)
          <br />
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
      </p>
      <button type="submit" disabled={busy}>
        {props.submitLabel}
      </button>{' '}
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </form>
  );
}

type Mode = { kind: 'list' } | { kind: 'create' } | { kind: 'view'; id: string } | { kind: 'edit'; id: string };

/** Capabilities only adapt the UI; the server authorizes every request. */
export function Procedures({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const [procedures, setProcedures] = useState<Procedure[] | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.procedures(workspaceId).then(setProcedures, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId]);
  useEffect(refresh, [refresh]);

  const selected = mode.kind === 'view' || mode.kind === 'edit' ? procedures?.find((p) => p.id === mode.id) : undefined;

  async function remove(procedure: Procedure) {
    if (!window.confirm(`Delete “${procedure.title}”? Past Runs stay readable.`)) return;
    setMessage(null);
    try {
      await api.deleteProcedure(workspaceId, procedure.id);
      setMode({ kind: 'list' });
    } catch (caught) {
      setMessage(messageFor(caught));
    }
    refresh();
  }

  return (
    <section aria-labelledby="procedures-heading">
      <h4 id="procedures-heading">Procedures</h4>
      {message !== null && <p role="alert">{message}</p>}

      {mode.kind === 'create' && (
        <ProcedureForm
          initial={EMPTY}
          submitLabel="Create Procedure"
          onCancel={() => setMode({ kind: 'list' })}
          onSubmit={async (content) => {
            const created = await api.createProcedure(workspaceId, content);
            setMessage(null);
            refresh();
            setMode({ kind: 'view', id: created.id });
          }}
        />
      )}

      {mode.kind === 'edit' && selected !== undefined && (
        <ProcedureForm
          key={`${selected.id}-${selected.revision}`}
          initial={selected}
          submitLabel="Save changes"
          onCancel={() => setMode({ kind: 'view', id: selected.id })}
          onSubmit={async (content) => {
            try {
              await api.updateProcedure(workspaceId, selected.id, selected.revision, content);
              setMode({ kind: 'view', id: selected.id });
            } finally {
              refresh();
            }
          }}
        />
      )}

      {mode.kind === 'view' && selected !== undefined && (
        <article aria-labelledby="procedure-title">
          <h5 id="procedure-title">
            <Icon icon={selected.icon} /> {selected.title}
          </h5>
          {/* Plain text: React escapes it; line breaks are preserved by CSS only. */}
          {selected.description !== '' && <p style={{ whiteSpace: 'pre-wrap' }}>{selected.description}</p>}
          {selected.tags.length > 0 && <p>Tags: {selected.tags.join(', ')}</p>}
          <p>
            <button type="button" onClick={() => setMode({ kind: 'list' })}>
              Back to all Procedures
            </button>{' '}
            {canEdit && (
              <>
                <button type="button" onClick={() => setMode({ kind: 'edit', id: selected.id })}>
                  Edit
                </button>{' '}
                <button type="button" onClick={() => void remove(selected)}>
                  Delete
                </button>
              </>
            )}
          </p>
        </article>
      )}

      {(mode.kind === 'list' || ((mode.kind === 'view' || mode.kind === 'edit') && selected === undefined)) && (
        <>
          {procedures === null ? (
            <p>Loading…</p>
          ) : procedures.length === 0 ? (
            <p>No Procedures yet.</p>
          ) : (
            <ul aria-label="Procedures">
              {procedures.map((procedure) => (
                <li key={procedure.id}>
                  <button type="button" onClick={() => setMode({ kind: 'view', id: procedure.id })}>
                    <Icon icon={procedure.icon} /> {procedure.title}
                  </button>
                  {procedure.tags.length > 0 && <> ({procedure.tags.join(', ')})</>}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <button type="button" onClick={() => setMode({ kind: 'create' })}>
              New Procedure
            </button>
          )}
        </>
      )}
    </section>
  );
}
