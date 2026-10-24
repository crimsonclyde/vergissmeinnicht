import { useState, type CSSProperties } from 'react';

/** Up to two initials of a display name (letters of the first and last word). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter((word) => word !== '');
  const first = [...(words[0] ?? '')][0] ?? '';
  const last = words.length > 1 ? ([...(words.at(-1) ?? '')][0] ?? '') : '';
  return (first + last).toLocaleUpperCase() || '?';
}

/** A stable hue (0–359) for a person, so initials keep their colour. */
export function hueOf(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return hash;
}

/**
 * A person's round profile picture (section 29), or their initials on a calm colour when there is
 * none (or it cannot be loaded). Decorative: the name always stands next to it.
 */
export function Avatar(props: { name: string; seed: string; src: string | null; size?: 'small' | 'medium' | 'large' }) {
  const [failed, setFailed] = useState<string | null>(null);
  const size = props.size ?? 'small';
  if (props.src !== null && failed !== props.src) {
    return <img className="avatar" data-size={size} src={props.src} alt="" aria-hidden="true" decoding="async" onError={() => setFailed(props.src)} />;
  }
  return (
    <span className="avatar avatar-initials" data-size={size} aria-hidden="true" style={{ '--avatar-hue': hueOf(props.seed) } as CSSProperties}>
      {initials(props.name)}
    </span>
  );
}
