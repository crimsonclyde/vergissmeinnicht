import type { ReactNode } from 'react';
import { TodaySettingsContext, useTodaySettings } from '../today-settings.ts';

export function TodaySettingsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const value = useTodaySettings(userId);
  return <TodaySettingsContext.Provider value={value}>{children}</TodaySettingsContext.Provider>;
}
