import { useEffect, useState } from 'react';

/** Which people's items Today shows: everything, the person's own, or shared (unassigned) ones. */
export type HomeFilter = 'ALL' | 'MINE' | 'SHARED';
export const HOME_FILTERS: readonly HomeFilter[] = ['ALL', 'MINE', 'SHARED'];

const FILTER_KEY = 'vmn.homeFilter';
const FILTER_EVENT = 'vmn:home-filter';

function storedFilter(): HomeFilter {
  try {
    const value = window.localStorage.getItem(FILTER_KEY);
    return value === 'MINE' || value === 'SHARED' ? value : 'ALL';
  } catch {
    return 'ALL';
  }
}

/**
 * The per-viewer Today scope, shared by the Today page and the top bar: a choice is stored on this device
 * and announced to every mounted control, so both show the same scope at once.
 */
export function useHomeFilter(): [HomeFilter, (next: HomeFilter) => void] {
  const [filter, setFilter] = useState<HomeFilter>(storedFilter);
  useEffect(() => {
    const sync = (event: Event) => setFilter((event as CustomEvent<HomeFilter>).detail);
    window.addEventListener(FILTER_EVENT, sync);
    return () => window.removeEventListener(FILTER_EVENT, sync);
  }, []);
  const choose = (next: HomeFilter) => {
    try {
      window.localStorage.setItem(FILTER_KEY, next);
    } catch {
      /* per-viewer convenience only: the choice still applies for this visit */
    }
    window.dispatchEvent(new CustomEvent<HomeFilter>(FILTER_EVENT, { detail: next }));
  };
  return [filter, choose];
}
