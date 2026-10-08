import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.ts';
import { offlineStore } from './offline/store.ts';
import { layoutOf, resolveTodayLayout, type TodaySettings } from './today-cards.ts';

/**
 * The signed-in person's Today layout (19.2): loaded from the account, kept on this device for offline
 * use (deleted on sign-out with the rest of the device data). Until it is known the defaults apply.
 * `save` shows the change at once and stores it; a refused save is reported and the saved state comes back.
 */
export function useTodaySettings(userId: string): { settings: TodaySettings; loaded: boolean; save: (next: TodaySettings | null) => Promise<void> } {
  const [stored, setStored] = useState<unknown>(undefined);

  useEffect(() => {
    let active = true;
    api.todayLayout().then(
      (layout) => {
        if (!active) return;
        setStored(layout);
        void offlineStore.saveTodayLayout(userId, layout);
      },
      async () => {
        const saved = await offlineStore.loadTodayLayout(userId);
        if (active) setStored(saved ?? null);
      },
    );
    return () => {
      active = false;
    };
  }, [userId]);

  const save = useCallback(
    async (next: TodaySettings | null) => {
      const layout = next === null ? null : layoutOf(next);
      setStored(layout);
      try {
        const saved = await api.saveTodayLayout(layout);
        setStored(saved);
        void offlineStore.saveTodayLayout(userId, saved);
      } catch (caught) {
        setStored(await api.todayLayout().catch(() => offlineStore.loadTodayLayout(userId)));
        throw caught;
      }
    },
    [userId],
  );

  const settings = useMemo(() => resolveTodayLayout(stored ?? null), [stored]);
  return { settings, loaded: stored !== undefined, save };
}
