import { createContext, useContext } from 'react';
/** Navigation and cross-tool controls only; the server rechecks every request. */
export const CoreToolsContext = createContext<readonly string[]>([]);
export const useCoreTools = () => {
  const tools = useContext(CoreToolsContext);
  return { procedures: tools.includes('PROCEDURES'), reminders: tools.includes('REMINDERS'), lists: tools.includes('LISTS'), calendar: tools.includes('CALENDAR'), equipment:tools.includes('EQUIPMENT') };
};
