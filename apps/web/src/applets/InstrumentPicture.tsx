import artwork from './art/clock-weather.webp';

/** Bundled decorative artwork. The clock's native hands alone depict an actual measurement. */
export function InstrumentPicture({ kind, now }: { kind: 'clock' | 'weather'; now?: Date }) {
  return <span className={`instrument-picture instrument-picture-${kind}`} aria-hidden="true">
    <img src={artwork} alt="" width={1400} height={700} draggable={false} />
    {kind === 'clock' && now !== undefined && <svg className="instrument-picture-hands" viewBox="0 0 1000 1000" focusable="false">
      <g transform="translate(508 406)"><line className="picture-hour-hand" x1="0" y1="15" x2="0" y2="-118" transform={`rotate(${(now.getHours() % 12 + now.getMinutes() / 60) * 30})`} /><line className="picture-minute-hand" x1="0" y1="18" x2="0" y2="-170" transform={`rotate(${now.getMinutes() * 6})`} /><circle r="7" /></g>
    </svg>}
  </span>;
}
