import clockArtwork from './art/clock.webp';
import sunArtwork from './art/weather-sun.webp';
import snowArtwork from './art/weather-snow.webp';
import rainArtwork from './art/weather-rain.webp';
import stormArtwork from './art/weather-storm.webp';
import fogArtwork from './art/weather-fog.webp';
import cloudyArtwork from './art/weather-cloudy.webp';
import partlyCloudyArtwork from './art/weather-partly-cloudy.webp';
import sleetArtwork from './art/weather-sleet.webp';
import { useState } from 'react';
import type { WeatherCondition } from '@vergissmeinnicht/domain';
import { conditionIcon } from '../weather-view.ts';
import { UiIcon } from '../ui-icons.tsx';

// Exhaustive: new canonical conditions must explicitly choose artwork or the native fallback.
const weatherArtwork: Record<WeatherCondition, string | undefined> = {
  CLEAR: sunArtwork, DRIZZLE: rainArtwork, RAIN: rainArtwork, SHOWERS: rainArtwork,
  SNOW: snowArtwork, SLEET: sleetArtwork, THUNDER: stormArtwork,
  FOG: fogArtwork, CLOUDY: cloudyArtwork, PARTLY_CLOUDY: partlyCloudyArtwork, UNKNOWN: undefined,
};

/** Bundled decorative artwork. The clock's native hands alone depict an actual measurement. */
export function InstrumentPicture({ kind, now, condition }: { kind: 'clock' | 'weather'; now?: Date; condition?: WeatherCondition | undefined }) {
  const [failedArtwork, setFailedArtwork] = useState<string>();
  const artwork = kind === 'clock' ? clockArtwork : weatherArtwork[condition ?? 'UNKNOWN'];
  return <span className={`instrument-picture instrument-picture-${kind}`} aria-hidden="true">
    {artwork !== undefined && (kind === 'clock' || artwork !== failedArtwork)
      ? <img key={artwork} src={artwork} alt="" width={700} height={700} draggable={false} onError={kind === 'weather' ? () => setFailedArtwork(artwork) : undefined} />
      : <span className="instrument-weather-symbol"><UiIcon name={conditionIcon(condition)} /></span>}
    {kind === 'clock' && now !== undefined && <svg className="instrument-picture-hands" viewBox="0 0 1000 1000" focusable="false">
      <g transform="translate(508 406)"><line className="picture-hour-hand" x1="0" y1="15" x2="0" y2="-118" transform={`rotate(${(now.getHours() % 12 + now.getMinutes() / 60) * 30})`} /><line className="picture-minute-hand" x1="0" y1="18" x2="0" y2="-170" transform={`rotate(${now.getMinutes() * 6})`} /><circle r="7" /></g>
    </svg>}
  </span>;
}

/** The same painted condition artwork for the Weather page (decorative; the condition is always written too). */
export function WeatherArt({ condition, className }: { condition: WeatherCondition | undefined; className?: string }) {
  const [failed, setFailed] = useState<string>();
  const artwork = weatherArtwork[condition ?? 'UNKNOWN'];
  return <span className={`weather-art${className === undefined ? '' : ` ${className}`}`} aria-hidden="true">
    {artwork !== undefined && artwork !== failed
      ? <img key={artwork} src={artwork} alt="" width={700} height={700} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(artwork)} />
      : <span className="weather-art-symbol"><UiIcon name={conditionIcon(condition)} /></span>}
  </span>;
}
