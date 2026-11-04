import { createContext, useContext } from 'react';

/**
 * Top-bar slots for Today's controls (the scope dropdown and Add) in the guide layout. AppShell renders the
 * elements and reports them here; Today portals its controls into them. Both are null until the header mounts.
 */
export interface GuideSlots {
  readonly scope: HTMLElement | null;
  readonly actions: HTMLElement | null;
}

const GuideSlotsContext = createContext<GuideSlots>({ scope: null, actions: null });
export const GuideSlotsProvider = GuideSlotsContext.Provider;
export const useGuideSlots = () => useContext(GuideSlotsContext);
