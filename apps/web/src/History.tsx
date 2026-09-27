import { useState } from 'react';
import { messageFor, type HistoryEvent } from './api.ts';

const STATE_TEXT: Record<string, string> = {
  PENDING: 'Pending',
  DONE: 'Done',
  SKIPPED: 'Skipped',
  NOT_APPLICABLE: 'Not applicable',
};

const text = (value: unknown): string => (typeof value === 'string' ? value : String(value ?? ''));
/** "1 Step added", "2 Steps added"; nothing for 0. */
const count = (value: unknown, noun: string, verb: string): string | null =>
  typeof value === 'number' && value > 0 ? `${value} ${noun}${value === 1 ? '' : 's'} ${verb}` : null;

/** Plain-language description of one audit event (rendered as text, never as HTML). */
export function describeEvent(event: HistoryEvent): string {
  const m = event.metadata;
  const reason = typeof m.reason === 'string' ? ` — reason: ${m.reason}` : '';
  switch (event.type) {
    case 'RUN_STARTED':
      return `started the Run (Procedure revision ${text(m.procedureRevision)}, ${text(m.steps)} Steps)`;
    case 'STEP_STATE_CHANGED':
      return `${text(m.stepTitle)}: ${STATE_TEXT[text(m.from)] ?? text(m.from)} → ${STATE_TEXT[text(m.to)] ?? text(m.to)}${m.undo === true ? ' (undo)' : ''}${reason}`;
    case 'RUN_COMPLETED':
      return 'completed the Run';
    case 'RUN_ABORTED':
      return `aborted the Run${reason}`;
    case 'PROCEDURE_CREATED':
      return m.origin === 'imported'
        ? 'imported the Procedure from a file'
        : m.origin === 'duplicated'
          ? 'created the Procedure as a copy'
          : 'created the Procedure';
    case 'PROCEDURE_UPDATED': {
      const fields = Array.isArray(m.fields) ? m.fields.filter((f) => f !== 'structure') : [];
      const structure = [
        count(m.sectionsAdded, 'Section', 'added'),
        count(m.sectionsRemoved, 'Section', 'removed'),
        count(m.sectionsChanged, 'Section', 'changed'),
        count(m.stepsAdded, 'Step', 'added'),
        count(m.stepsRemoved, 'Step', 'removed'),
        count(m.stepsChanged, 'Step', 'changed'),
      ].filter((part): part is string => part !== null);
      const parts = [...(fields.length > 0 ? [`changed ${fields.join(', ')}`] : []), ...structure];
      return `${parts.join('; ')} (revision ${text(m.revision)})`;
    }
    case 'PROCEDURE_DELETED':
      return 'deleted the Procedure';
    case 'PROCEDURE_RESTORED':
      return 'restored the Procedure';
    default:
      return event.type;
  }
}

/** Collapsible, read-only history. The list is loaded on demand. */
export function History(props: { label: string; load: () => Promise<HistoryEvent[]> }) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setMessage(null);
    try {
      setEvents(await props.load());
    } catch (caught) {
      setMessage(messageFor(caught));
    }
  }

  return (
    <section aria-label={props.label}>
      <button type="button" aria-expanded={open} onClick={() => void toggle()}>
        {open ? 'Hide history' : 'Show history'}
      </button>
      {open && message !== null && <p role="alert">{message}</p>}
      {open &&
        message === null &&
        (events === null ? (
          <p>Loading…</p>
        ) : (
          <ol>
            {events.map((event) => (
              <li key={event.id}>
                <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time> — <strong>{event.actor}</strong>{' '}
                {describeEvent(event)}
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}
