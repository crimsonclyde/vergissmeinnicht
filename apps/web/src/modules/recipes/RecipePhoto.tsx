import { useState } from 'react';

export function RecipePhoto({ src }: { src?: string | undefined }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'missing'>(src ? 'loading' : 'missing');
  return <span className="recipe-photo" data-photo={state} aria-hidden="true">
    {state === 'missing' && <svg viewBox="0 0 200 120" fill="none" stroke="currentColor" strokeWidth="1.25">
      <ellipse cx="100" cy="60" rx="44" ry="44" />
      <circle cx="100" cy="60" r="33" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M85 72c12-2 26-14 34-28m-23 22c-11-3-15-10-13-17 9 1 15 7 13 17Zm9-8c-5-8-4-15 1-20 7 6 6 14-1 20Zm0 0c7-5 15-3 19 4-7 5-15 3-19-4ZM45 87V49m-7-15v13a7 7 0 0 0 14 0V34m-7 0v18m110 35V35c-7 6-9 14-9 24h9" />
    </svg>}
    {src && state !== 'missing' && <img src={src} alt="" loading="lazy" decoding="async" onLoad={() => setState('loaded')} onError={() => setState('missing')} />}
  </span>;
}
