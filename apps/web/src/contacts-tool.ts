import { createContext, useContext } from 'react';

/**
 * Whether the Contacts tool is switched on in the Workspace shown, and whether the viewer may manage
 * Contacts. Pages of other tools (a Procedure, a Document) read this to decide whether to show linked
 * Contacts at all — where the tool is off, nothing of it appears. The server decides on every request.
 */
export interface ContactsTool {
  readonly enabled: boolean;
  readonly canManage: boolean;
}

export const ContactsToolContext = createContext<ContactsTool>({ enabled: false, canManage: false });
export const useContactsTool = (): ContactsTool => useContext(ContactsToolContext);
