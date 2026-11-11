import { useId, useState } from 'react';
import { UiIcon, type UiIconName } from '../ui-icons.tsx';
import './readings.css';

/** One small reading: an icon and a value; `unit` sits beside the value (under it on phones). A tap explains it in one line. */
export interface Reading { readonly id: string; readonly icon: UiIconName; readonly label: string; readonly value: string; readonly unit?: string; readonly info: string; readonly level?: string }

/** The row of readings at the foot of a page's main card (Weather, Clock). Missing readings are simply not passed. */
export function Readings({ readings, label }: { readings: readonly Reading[]; label: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const infoId = useId();
  const shown = readings.find((reading) => reading.id === open);
  if (readings.length === 0) return null;
  return <div className="readings">
    <ul aria-label={label}>
      {/* A long reading (e.g. "7:18 AM – 5:06 PM") gets a double share of the row on phones. */}
      {readings.map((reading) => <li key={reading.id} className={reading.value.length + (reading.unit?.length ?? 0) > 12 ? 'is-wide' : undefined}>
        <button type="button" className="reading" data-level={reading.level} aria-expanded={open === reading.id} aria-controls={infoId} title={reading.label} onClick={() => setOpen(open === reading.id ? null : reading.id)}>
          <UiIcon name={reading.icon} />
          <span className="visually-hidden">{reading.label}: </span>
          <span className="reading-value">{reading.value}{reading.unit !== undefined && <small>{reading.unit}</small>}</span>
        </button>
      </li>)}
    </ul>
    <p id={infoId} className="reading-info" aria-live="polite" hidden={shown === undefined}>{shown === undefined ? null : <><strong>{shown.label}</strong> {shown.info}</>}</p>
  </div>;
}
