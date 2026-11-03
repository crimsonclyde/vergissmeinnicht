import { createContext, useContext, useState, type ReactNode } from 'react';
import { idleTiming, type Timing } from './clock-tools.ts';

type Mode = 'clock' | 'stopwatch' | 'timer';
interface ClockTools { mode: Mode; stopwatch: Timing; timer: Timing; minutes: number; laps: readonly number[] }
const ClockToolsContext = createContext<{ state: ClockTools; update: (change: Partial<ClockTools>) => void } | null>(null);

/** Account-keyed memory only: navigation keeps timers; reload/sign-out drops them. No notifications. */
export function ClockToolsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ClockTools>({ mode: 'clock', stopwatch: idleTiming(), timer: idleTiming(), minutes: 25, laps: [] });
  return <ClockToolsContext.Provider value={{ state, update: change => setState(previous => ({ ...previous, ...change })) }}>{children}</ClockToolsContext.Provider>;
}
export function useClockTools() {
  const value = useContext(ClockToolsContext);
  if (value === null) throw new Error('ClockToolsProvider missing');
  return value;
}
