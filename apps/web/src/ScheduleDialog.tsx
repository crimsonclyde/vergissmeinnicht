import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { messageFor, type PersonRef, type Recurrence, type RecurrenceUnit, type ReminderOffset, type ReminderUnit, type ScheduleInput } from './api.ts';
import { t } from './i18n/index.ts';
import { addDays, browserTimeZone, todayIn } from './schedule-dates.ts';

const PRESETS: readonly ReminderOffset[] = [
  { unit: 'DAYS', amount: 0 },
  { unit: 'DAYS', amount: 1 },
  { unit: 'WEEKS', amount: 1 },
  { unit: 'MONTHS', amount: 1 },
];
const LIMITS: Record<ReminderUnit, { min: number; max: number }> = {
  HOURS: { min: 1, max: 48 },
  DAYS: { min: 0, max: 366 },
  WEEKS: { min: 1, max: 52 },
  MONTHS: { min: 1, max: 12 },
};
const MAX_REMINDERS = 5;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const weekdayName = (day: number) =>
  t((['schedule.weekday.1', 'schedule.weekday.2', 'schedule.weekday.3', 'schedule.weekday.4', 'schedule.weekday.5', 'schedule.weekday.6', 'schedule.weekday.7'] as const)[day - 1] ?? 'schedule.weekday.1');
const keyOf = (offset: ReminderOffset) => `${offset.unit}:${offset.amount}`;

/** "On the due date", "1 day before", "2 weeks before", "1 month before", "3 hours before" (`inSentence`: lower-case start). */
export function reminderLabel(offset: ReminderOffset, inSentence = false): string {
  if (offset.unit === 'DAYS' && offset.amount === 0) return t(inSentence ? 'schedule.reminder.onTheDayInSentence' : 'schedule.reminder.onTheDay');
  return t(`schedule.reminder.${offset.unit}`, { count: offset.amount });
}

/** "Every year", "Every 2 weeks on Mon, Thu", "6 months after it is done", "Once". */
export function recurrenceLabel(recurrence: Recurrence): string {
  if (recurrence.kind === 'ONCE') return t('schedule.repeat.once');
  const every = t(`schedule.every.${recurrence.unit}`, { count: recurrence.interval });
  if (recurrence.kind === 'AFTER_COMPLETION') return t('schedule.repeat.afterLabel', { every: t(`schedule.interval.${recurrence.unit}`, { count: recurrence.interval }) });
  if (recurrence.weekdays !== null) return t('schedule.repeat.onWeekdays', { every, days: recurrence.weekdays.map(weekdayName).join(', ') });
  if (recurrence.lastDayOfMonth) return t('schedule.repeat.lastDay', { every });
  return every;
}

/** One group of options behind a summary that names its current value, so the default is visible while it stays folded. */
function Options(props: { label: string; value: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  return (
    <details className="option-group" open={props.open} onToggle={(event) => props.onToggle(event.currentTarget.open)}>
      <summary>
        <span className="option-label">{props.label}</span>
        <span className="muted option-value">{props.value}</span>
      </summary>
      <div className="stack option-body">{props.children}</div>
    </details>
  );
}

type OptionKey = 'notes' | 'repeat' | 'responsible' | 'reminders';

/**
 * Create or change a Schedule (14.1): a standalone Reminder or a scheduled Procedure; one-time, repeating
 * on fixed dates, or counted from the last completion; reminders (presets and bounded custom offsets);
 * an optional responsible member. Dates are in the Schedule's time zone (the browser's for new ones).
 * The server validates everything again.
 *
 * What matters most comes first (15.3): what, and when. Notes, repetition, the responsible person and
 * the notifications are folded behind summaries that show their current value — the defaults are the
 * same as before (once, shared, a reminder on the due date).
 */
export function ScheduleDialog(props: {
  kind: 'REMINDER' | 'PROCEDURE';
  /** The Procedure's title (PROCEDURE), or the Reminder's current title when editing. */
  title?: string;
  /** Editing an existing Schedule: its current values. */
  initial?: ScheduleInput;
  /** Members to choose a responsible person from; null when the viewer cannot list them. */
  members: readonly PersonRef[] | null;
  onSubmit: (input: ScheduleInput) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const everyId = useId();
  const unitId = useId();
  const responsibleId = useId();
  const initial = props.initial;
  const timeZone = initial?.timeZone ?? browserTimeZone();
  const today = todayIn(timeZone);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(initial?.date ?? addDays(today, 1));
  const [time, setTime] = useState(initial?.time ?? '');
  const [repeat, setRepeat] = useState<Recurrence['kind']>(initial?.recurrence.kind ?? 'ONCE');
  const initialRule = initial?.recurrence.kind === 'ONCE' || initial === undefined ? null : initial.recurrence;
  const [unit, setUnit] = useState<RecurrenceUnit>(initialRule?.unit ?? (props.kind === 'REMINDER' ? 'YEAR' : 'WEEK'));
  const [interval, setEvery] = useState(String(initialRule?.interval ?? 1));
  const [weekdays, setWeekdays] = useState<readonly number[]>(initialRule?.kind === 'FIXED' ? (initialRule.weekdays ?? []) : []);
  const [lastDay, setLastDay] = useState(initialRule?.kind === 'FIXED' && initialRule.lastDayOfMonth);
  const [reminders, setReminders] = useState<readonly ReminderOffset[]>(initial?.reminders ?? [{ unit: 'DAYS', amount: 0 }]);
  const [assignee, setAssignee] = useState(initial?.assigneeUserId ?? '');
  const [customAmount, setCustomAmount] = useState('3');
  const [customUnit, setCustomUnit] = useState<ReminderUnit>('HOURS');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // When editing, what differs from the defaults is shown right away.
  const [open, setOpen] = useState<Readonly<Record<OptionKey, boolean>>>({
    notes: (initial?.description ?? '') !== '',
    repeat: initial !== undefined && initial.recurrence.kind !== 'ONCE',
    responsible: (initial?.assigneeUserId ?? null) !== null,
    reminders: false,
  });
  const toggle = (key: OptionKey) => (next: boolean) => setOpen((current) => ({ ...current, [key]: next }));

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  const has = (offset: ReminderOffset) => reminders.some((r) => keyOf(r) === keyOf(offset));
  const setReminder = (offset: ReminderOffset, on: boolean) =>
    setReminders((current) => (on ? [...current.filter((r) => keyOf(r) !== keyOf(offset)), offset] : current.filter((r) => keyOf(r) !== keyOf(offset))));
  const custom = reminders.filter((r) => !PRESETS.some((preset) => keyOf(preset) === keyOf(r)));
  const amount = Number(customAmount);
  const customValid = Number.isInteger(amount) && amount >= LIMITS[customUnit].min && amount <= LIMITS[customUnit].max;

  function recurrence(): Recurrence {
    const n = Number(interval);
    if (repeat === 'ONCE') return { kind: 'ONCE' };
    if (repeat === 'AFTER_COMPLETION') return { kind: 'AFTER_COMPLETION', unit, interval: n };
    return { kind: 'FIXED', unit, interval: n, weekdays: unit === 'WEEK' && weekdays.length > 0 ? [...weekdays].sort() : null, lastDayOfMonth: unit === 'MONTH' && lastDay };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await props.onSubmit({
        ...(props.kind === 'REMINDER' ? { title, description } : {}),
        recurrence: recurrence(),
        date,
        time: time === '' ? null : time,
        timeZone,
        reminders,
        assigneeUserId: assignee === '' ? null : assignee,
      });
      ref.current?.close();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const heading =
    props.initial !== undefined
      ? t('schedule.editHeading', { title: props.title ?? '' })
      : props.kind === 'REMINDER'
        ? t('schedule.newReminderHeading')
        : t('schedule.heading', { title: props.title ?? '' });

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={headingId} onClose={props.onClose}>
      {/* A field in a folded group that cannot be submitted (e.g. an empty interval) must be shown, not silently block. */}
      <form onSubmit={(event) => void submit(event)} onInvalidCapture={() => setOpen({ notes: true, repeat: true, responsible: true, reminders: true })} className="stack">
        <h2 id={headingId} style={{ margin: 0 }}>
          {heading}
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          {t(props.kind === 'REMINDER' ? 'schedule.explainReminder' : 'schedule.explain')}
        </p>
        {message !== null && <p role="alert">{message}</p>}
        {props.kind === 'REMINDER' && (
          <label>
            {t('schedule.reminderTitle')}
            <br />
            <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('schedule.reminderTitlePlaceholder')} />
          </label>
        )}
        <div className="row">
          <label>
            {t(repeat === 'ONCE' ? 'schedule.date' : 'schedule.firstDate')}
            <br />
            <input type="date" required min={props.initial === undefined ? today : undefined} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            {t('schedule.time')} {t('common.optional')}
            <br />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <small className="muted">{t('schedule.timeZone', { zone: timeZone })}</small>
        {props.kind === 'REMINDER' && (
          <Options label={t('schedule.reminderDescription')} value={description.trim() === '' ? t('schedule.none') : t('schedule.notesAdded')} open={open.notes} onToggle={toggle('notes')}>
            <label>
              <span className="visually-hidden">{t('schedule.reminderDescription')}</span>
              <textarea rows={2} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </Options>
        )}
        <Options label={t('schedule.repeat')} value={recurrenceLabel(recurrence())} open={open.repeat} onToggle={toggle('repeat')}>
          <fieldset className="stack plain-fieldset">
            <legend className="visually-hidden">{t('schedule.repeat')}</legend>
          <label className="row" style={{ fontWeight: 400 }}>
            <input type="radio" name={`${headingId}-repeat`} checked={repeat === 'ONCE'} onChange={() => setRepeat('ONCE')} />
            {t('schedule.repeat.once')}
          </label>
          <label className="row" style={{ fontWeight: 400 }}>
            <input type="radio" name={`${headingId}-repeat`} checked={repeat === 'FIXED'} onChange={() => setRepeat('FIXED')} />
            {t('schedule.repeat.fixed')}
          </label>
          <label className="row" style={{ fontWeight: 400 }}>
            <input type="radio" name={`${headingId}-repeat`} checked={repeat === 'AFTER_COMPLETION'} onChange={() => setRepeat('AFTER_COMPLETION')} />
            {t('schedule.repeat.after')}
          </label>
          {repeat !== 'ONCE' && (
            <div className="stack">
              <div className="row">
                <div>
                  <label htmlFor={everyId}>{t('schedule.every')}</label>
                  <br />
                  <input id={everyId} type="number" inputMode="numeric" min={1} max={99} required value={interval} onChange={(e) => setEvery(e.target.value)} style={{ width: '5rem' }} />
                </div>
                <div>
                  <label htmlFor={unitId}>{t('schedule.unit')}</label>
                  <br />
                  <select id={unitId} value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)}>
                    {(['DAY', 'WEEK', 'MONTH', 'YEAR'] as const).map((value) => (
                      <option key={value} value={value}>
                        {t(`schedule.unitName.${value}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {repeat === 'FIXED' && unit === 'WEEK' && (
                <fieldset>
                  <legend>{t('schedule.weekdays')}</legend>
                  <div className="row">
                    {WEEKDAYS.map((day) => (
                      <label key={day} className="row" style={{ fontWeight: 400 }}>
                        <input
                          type="checkbox"
                          checked={weekdays.includes(day)}
                          onChange={(e) => setWeekdays((current) => (e.target.checked ? [...current, day] : current.filter((d) => d !== day)))}
                        />
                        {weekdayName(day)}
                      </label>
                    ))}
                  </div>
                  </fieldset>
              )}
              {repeat === 'FIXED' && unit === 'MONTH' && (
                <label className="row" style={{ fontWeight: 400 }}>
                  <input type="checkbox" checked={lastDay} onChange={(e) => setLastDay(e.target.checked)} />
                  {t('schedule.lastDayOfMonth')}
                </label>
              )}
              <small className="muted">{t(repeat === 'FIXED' ? 'schedule.repeat.fixedHint' : 'schedule.repeat.afterHint')}</small>
            </div>
          )}
          </fieldset>
        </Options>
        {props.members !== null && (
          <Options
            label={t('schedule.responsible')}
            value={assignee === '' ? t('schedule.shared') : (props.members.find((member) => member.id === assignee)?.name ?? t('schedule.shared'))}
            open={open.responsible}
            onToggle={toggle('responsible')}
          >
          <div>
            <label htmlFor={responsibleId}>{t('schedule.responsible')}</label>
            <br />
            <select id={responsibleId} value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-describedby={`${responsibleId}-hint`}>
              <option value="">{t('schedule.shared')}</option>
              {props.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <br />
            <small id={`${responsibleId}-hint`} className="muted">
              {t('schedule.responsibleHint')}
            </small>
          </div>
          </Options>
        )}
        <Options
          label={t('schedule.reminders')}
          value={reminders.length === 0 ? t('schedule.none') : reminders.map((reminder) => reminderLabel(reminder)).join(', ')}
          open={open.reminders}
          onToggle={toggle('reminders')}
        >
          <fieldset className="plain-fieldset">
            <legend className="visually-hidden">{t('schedule.reminders')}</legend>
          <div className="stack">
            {PRESETS.map((preset) => (
              <label key={keyOf(preset)} className="row" style={{ fontWeight: 400 }}>
                <input type="checkbox" checked={has(preset)} disabled={!has(preset) && reminders.length >= MAX_REMINDERS} onChange={(e) => setReminder(preset, e.target.checked)} />
                {reminderLabel(preset)}
              </label>
            ))}
            {custom.map((offset) => (
              <span key={keyOf(offset)} className="row">
                {reminderLabel(offset)}
                <button type="button" className="quiet" onClick={() => setReminder(offset, false)} aria-label={t('schedule.removeReminder', { reminder: reminderLabel(offset) })}>
                  ✕
                </button>
              </span>
            ))}
            {reminders.length < MAX_REMINDERS && (
              <div className="row">
                <label>
                  <span className="visually-hidden">{t('schedule.customAmount')}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={LIMITS[customUnit].min}
                    max={LIMITS[customUnit].max}
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    style={{ width: '5rem' }}
                  />
                </label>
                <label>
                  <span className="visually-hidden">{t('schedule.customUnit')}</span>
                  <select value={customUnit} onChange={(e) => setCustomUnit(e.target.value as ReminderUnit)}>
                    {(['HOURS', 'DAYS', 'WEEKS', 'MONTHS'] as const).map((value) => (
                      <option key={value} value={value}>
                        {t(`schedule.unit.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={!customValid} onClick={() => setReminder({ unit: customUnit, amount }, true)}>
                  {t('schedule.addReminder')}
                </button>
              </div>
            )}
            <small className="muted">{t('schedule.remindersHint')}</small>
          </div>
          </fieldset>
        </Options>
        <div className="row dialog-actions">
          <button type="submit" className="primary" disabled={busy}>
            {t(props.initial === undefined ? (props.kind === 'REMINDER' ? 'schedule.submitReminder' : 'schedule.submit') : 'schedule.submitMove')}
          </button>
          <button type="button" onClick={() => ref.current?.close()}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
