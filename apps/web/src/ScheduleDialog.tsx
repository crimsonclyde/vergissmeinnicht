import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { messageFor, type ReminderOffset, type ReminderUnit, type ScheduleInput } from './api.ts';
import { t } from './i18n/index.ts';
import { addDays, browserTimeZone, todayIn } from './schedule-dates.ts';

const PRESETS: readonly ReminderOffset[] = [
  { unit: 'DAYS', amount: 0 },
  { unit: 'DAYS', amount: 1 },
  { unit: 'DAYS', amount: 7 },
];
const LIMITS: Record<ReminderUnit, { min: number; max: number }> = { DAYS: { min: 0, max: 30 }, HOURS: { min: 1, max: 48 } };
const MAX_REMINDERS = 5;
const keyOf = (offset: ReminderOffset) => `${offset.unit}:${offset.amount}`;

/** "On the day", "1 day before", "3 hours before" (`inSentence`: "on the day"). */
export function reminderLabel(offset: ReminderOffset, inSentence = false): string {
  if (offset.unit === 'DAYS' && offset.amount === 0) return t(inSentence ? 'schedule.reminder.onTheDayInSentence' : 'schedule.reminder.onTheDay');
  return t(offset.unit === 'DAYS' ? 'schedule.reminder.daysBefore' : 'schedule.reminder.hoursBefore', { count: offset.amount });
}

/**
 * Schedule a Procedure for a date — or move a scheduled one (13.4, 13.10). A modal dialog: the date,
 * an optional time, and reminders (presets plus bounded custom offsets). Times are in the item's time
 * zone (the browser's for new items). The server validates everything again.
 */
export function ScheduleDialog(props: {
  procedureTitle: string;
  /** Moving an existing item: its current values. */
  initial?: ScheduleInput;
  onSubmit: (input: ScheduleInput) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const timeZone = props.initial?.timeZone ?? browserTimeZone();
  const today = todayIn(timeZone);
  const [date, setDate] = useState(props.initial?.date ?? addDays(today, 1));
  const [time, setTime] = useState(props.initial?.time ?? '');
  const [reminders, setReminders] = useState<readonly ReminderOffset[]>(props.initial?.reminders ?? [{ unit: 'DAYS', amount: 0 }]);
  const [customAmount, setCustomAmount] = useState('2');
  const [customUnit, setCustomUnit] = useState<ReminderUnit>('HOURS');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  const has = (offset: ReminderOffset) => reminders.some((r) => keyOf(r) === keyOf(offset));
  const toggle = (offset: ReminderOffset, on: boolean) =>
    setReminders((current) => (on ? [...current.filter((r) => keyOf(r) !== keyOf(offset)), offset] : current.filter((r) => keyOf(r) !== keyOf(offset))));
  const custom = reminders.filter((r) => !PRESETS.some((preset) => keyOf(preset) === keyOf(r)));
  const amount = Number(customAmount);
  const customValid = Number.isInteger(amount) && amount >= LIMITS[customUnit].min && amount <= LIMITS[customUnit].max;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await props.onSubmit({ date, time: time === '' ? null : time, timeZone, reminders });
      ref.current?.close();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={headingId} onClose={props.onClose}>
      <form onSubmit={(event) => void submit(event)} className="stack">
        <h2 id={headingId} style={{ margin: 0 }}>
          {t(props.initial === undefined ? 'schedule.heading' : 'schedule.moveHeading', { title: props.procedureTitle })}
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('schedule.explain')}
        </p>
        {message !== null && <p role="alert">{message}</p>}
        <div className="row">
          <label>
            {t('schedule.date')}
            <br />
            <input type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            {t('schedule.time')} {t('common.optional')}
            <br />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <small className="muted">{t('schedule.timeZone', { zone: timeZone })}</small>
        <fieldset>
          <legend>{t('schedule.reminders')}</legend>
          <div className="stack">
            {PRESETS.map((preset) => (
              <label key={keyOf(preset)} className="row" style={{ fontWeight: 400 }}>
                <input type="checkbox" checked={has(preset)} disabled={!has(preset) && reminders.length >= MAX_REMINDERS} onChange={(e) => toggle(preset, e.target.checked)} />
                {reminderLabel(preset)}
              </label>
            ))}
            {custom.map((offset) => (
              <span key={keyOf(offset)} className="row">
                {reminderLabel(offset)}
                <button type="button" className="quiet" onClick={() => toggle(offset, false)} aria-label={t('schedule.removeReminder', { reminder: reminderLabel(offset) })}>
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
                    <option value="HOURS">{t('schedule.unit.HOURS')}</option>
                    <option value="DAYS">{t('schedule.unit.DAYS')}</option>
                  </select>
                </label>
                <button type="button" disabled={!customValid} onClick={() => toggle({ unit: customUnit, amount }, true)}>
                  {t('schedule.addReminder')}
                </button>
              </div>
            )}
            <small className="muted">{t('schedule.remindersHint')}</small>
          </div>
        </fieldset>
        <div className="row">
          <button type="submit" className="primary" disabled={busy}>
            {t(props.initial === undefined ? 'schedule.submit' : 'schedule.submitMove')}
          </button>
          <button type="button" onClick={() => ref.current?.close()}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
