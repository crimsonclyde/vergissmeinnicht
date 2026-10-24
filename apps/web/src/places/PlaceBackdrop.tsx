import { useState, type CSSProperties } from 'react';
import type { PlaceLight } from './atmosphere.ts';
import { effectiveOverlay, type PlaceLook, type PlaceProminence } from './look.ts';

/**
 * The Places background (section 30): one drawing for the page and for the preview in the Places tab.
 * Pure decoration (aria-hidden, no pointer events). Layers, bottom to top: the country's palette
 * gradient (always — also while an image loads, and when it fails), the illustration or the person's
 * photo (cover, focal point, optional blur), the lit windows after dark, the light of the time of day,
 * quiet mist, the readability overlay in the page colour, and the vignette. Motion is CSS only and
 * stops for reduced motion.
 */
export function PlaceBackdrop(props: {
  look: PlaceLook;
  light: PlaceLight;
  prominence: PlaceProminence;
  /** Preview only: draw as a phone or a wide screen regardless of this window's size. */
  frame?: 'desktop' | 'mobile';
  className?: string;
}) {
  const { look, light, prominence, frame } = props;
  const [failed, setFailed] = useState<string | null>(null);
  const art = look.config.artwork;
  // A photo that cannot be loaded (removed elsewhere, offline) falls back to the illustration.
  // Remembers which address failed, so a new photo (new version) is tried again.
  const photoFailed = look.photoUrl !== null && failed === look.photoUrl;
  const background = look.background === 'photo' && photoFailed ? 'illustration' : look.background;
  const glow = look.atmosphere && background === 'illustration' && look.config.effects.includes('window-glow') ? light.windows : 0;
  const mist = look.atmosphere && (look.config.effects.includes('mist') || look.config.effects.includes('haze')) ? 0.35 + light.mist * 0.65 : light.mist;
  const style = {
    '--place-focus-d': `${look.focusDesktop.x}% ${look.focusDesktop.y}%`,
    '--place-focus-m': `${look.focusMobile.x}% ${look.focusMobile.y}%`,
    '--place-overlay': String(effectiveOverlay(look, prominence) / 100),
    '--place-blur': `${look.blur}px`,
    '--place-vignette': String(look.vignette / 100),
    '--place-warmth': String(look.atmosphere ? light.warmth : 0),
    '--place-darkness': String(look.atmosphere ? light.darkness : 0),
    '--place-windows': String(glow),
    '--place-mist': String(mist),
  } as CSSProperties;
  const small = frame !== undefined;
  const image = (set: typeof art.day, className: string, onError?: () => void) =>
    frame === undefined ? (
      <picture>
        <source media="(max-width: 37.5rem), (max-aspect-ratio: 4/5)" srcSet={`${set.portraitSmall} 600w, ${set.portrait} 960w`} sizes="100vw" />
        <img className={className} src={set.wide} srcSet={`${set.wideSmall} 1280w, ${set.wide} 1920w`} sizes="100vw" alt="" decoding="async" onError={onError} />
      </picture>
    ) : (
      <img className={className} src={frame === 'mobile' ? (small ? set.portraitSmall : set.portrait) : set.wideSmall} alt="" decoding="async" onError={onError} />
    );
  return (
    <div
      className={`place-backdrop${props.className === undefined ? '' : ` ${props.className}`}`}
      aria-hidden="true"
      data-background={background}
      data-prominence={prominence}
      data-phase={look.atmosphere ? light.phase : 'day'}
      data-blur={look.blur > 0}
      data-frame={frame}
      data-atmosphere={look.atmosphere}
      style={style}
    >
      <div className="place-gradient" />
      {background === 'illustration' && image(art.day, 'place-art')}
      {background === 'photo' && look.photoUrl !== null && <img className="place-art" src={look.photoUrl} alt="" decoding="async" onError={() => setFailed(look.photoUrl)} />}
      <div className="place-tint" />
      {glow > 0 && image(art.lights, 'place-art place-lights')}
      {mist > 0 && <div className="place-mist" />}
      <div className="place-overlay" />
      <div className="place-vignette" />
    </div>
  );
}
