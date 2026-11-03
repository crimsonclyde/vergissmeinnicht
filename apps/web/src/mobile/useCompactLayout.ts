import { useSyncExternalStore } from 'react';

export const COMPACT_QUERY = '(max-width: 40rem)';
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(COMPACT_QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
/** Shared breakpoint for phone workflows and their action bars; never an access boundary. */
export function useCompactLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(COMPACT_QUERY).matches, () => false);
}
