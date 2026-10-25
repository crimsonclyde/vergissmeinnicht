import type { CSSProperties, ReactNode } from 'react';
import herrFuchsky from '../../companions/herr-fuchsky.webp';
import countDuckula from '../../companions/count-duckula-v2.webp';
import festerFiesta from '../../companions/fester-fiesta-v2.webp';

export interface CelebrationStyle {
  readonly id: string;
  readonly name?: string;
  readonly render: () => ReactNode;
}

/** Bundled presentation only: no downloaded plugins, persisted style ids or scoring rules. */
export const CELEBRATION_STYLES = [
  { id: 'herr-fuchsky', name: 'Herr Fuchsky', render: () => <img className="progress-companion" src={herrFuchsky} alt="" width="72" height="72" /> },
  { id: 'count-duckula', name: 'Count Duckula', render: () => <img className="progress-companion" src={countDuckula} alt="" width="72" height="72" /> },
  { id: 'fester-fiesta', name: 'Fester Fiesta', render: () => <img className="progress-companion" src={festerFiesta} alt="" width="72" height="72" /> },
  { id: 'confetti', render: () => <span className="celebration-confetti" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <span key={index} style={{ left: `${(index * 37) % 100}%`, animationDelay: `${(index % 6) * 45}ms`, '--confetti-drift': `${(index % 7 - 3) * 12}px` } as CSSProperties} />)}</span> },
] as const satisfies readonly CelebrationStyle[];

export function chooseCelebration(): CelebrationStyle {
  return CELEBRATION_STYLES[Math.floor(Math.random() * CELEBRATION_STYLES.length)] ?? CELEBRATION_STYLES[0];
}
