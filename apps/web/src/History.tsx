import { useState } from 'react';
import { messageFor, type HistoryEvent } from './api.ts';
import { formatDateTime, hasMessage, t, type MessageKey } from './i18n/index.ts';

const text = (value: unknown): string => (typeof value === 'string' ? value : String(value ?? ''));
/** Known Step states in their words; anything else is shown as stored. */
const stateText = (value: unknown): string => {
  const key = `state.${text(value)}`;
  return hasMessage(key) ? t(key) : text(value);
};
/** "1 Step added", "2 Steps added"; nothing for 0. */
const count = (value: unknown, key: MessageKey): string | null =>
  typeof value === 'number' && value > 0 ? t(key, { count: value }) : null;

/** Plain-language description of one audit event (rendered as text, never as HTML). */
export function describeEvent(event: HistoryEvent): string {
  const m = event.metadata;
  const reason = typeof m.reason === 'string' ? t('history.reason', { reason: m.reason }) : '';
  switch (event.type) {
    case 'RUN_STARTED':
      return t('history.RUN_STARTED', { revision: text(m.procedureRevision), count: typeof m.steps === 'number' ? m.steps : 0 });
    case 'STEP_STATE_CHANGED':
      return (
        t('history.STEP_STATE_CHANGED', { title: text(m.stepTitle), from: stateText(m.from), to: stateText(m.to) }) +
        (m.undo === true ? t('history.undo') : '') +
        reason
      );
    case 'RUN_COMPLETED':
      return t('history.RUN_COMPLETED');
    case 'RUN_ABORTED':
      return t('history.RUN_ABORTED') + reason;
    case 'PROCEDURE_CREATED':
      return t(
        m.origin === 'imported'
          ? 'history.PROCEDURE_IMPORTED'
          : m.origin === 'duplicated'
            ? 'history.PROCEDURE_DUPLICATED'
            : 'history.PROCEDURE_CREATED',
      );
    case 'PROCEDURE_UPDATED': {
      const fields = Array.isArray(m.fields) ? m.fields.filter((f) => f !== 'structure') : [];
      const structure = [
        count(m.sectionsAdded, 'history.sectionsAdded'),
        count(m.sectionsRemoved, 'history.sectionsRemoved'),
        count(m.sectionsChanged, 'history.sectionsChanged'),
        count(m.stepsAdded, 'history.stepsAdded'),
        count(m.stepsRemoved, 'history.stepsRemoved'),
        count(m.stepsChanged, 'history.stepsChanged'),
      ].filter((part): part is string => part !== null);
      const parts = [...(fields.length > 0 ? [t('history.changedFields', { fields: fields.join(', ') })] : []), ...structure];
      return t('history.revision', { changes: parts.join('; '), revision: text(m.revision) });
    }
    case 'PROCEDURE_DELETED':
      return t('history.PROCEDURE_DELETED');
    case 'PROCEDURE_RESTORED':
      return t('history.PROCEDURE_RESTORED');
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
        {t(open ? 'history.hide' : 'history.show')}
      </button>
      {open && message !== null && <p role="alert">{message}</p>}
      {open &&
        message === null &&
        (events === null ? (
          <p>{t('common.loading')}</p>
        ) : (
          <ol>
            {events.map((event) => (
              <li key={event.id}>
                <time dateTime={event.at}>{formatDateTime(event.at)}</time> — <strong>{event.actor}</strong>{' '}
                {describeEvent(event)}
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}
