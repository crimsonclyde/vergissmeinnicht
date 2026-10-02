import { createContext, useContext } from 'react';

/**
 * Whether the Documents tool is switched on in the Workspace shown, and whether the viewer may manage
 * Documents. Pages of other tools (Procedures, Reminders, executions) read this to decide whether to
 * show linked Documents at all — where the tool is off, nothing of it appears. The server decides on
 * every request; this only spares requests that would be answered "not found".
 */
export interface DocumentsTool {
  readonly enabled: boolean;
  readonly canManage: boolean;
  /** A Workspace admin: may remove a document that a finished execution keeps (with a reason). */
  readonly canRemoveKept: boolean;
}

export const DocumentsToolContext = createContext<DocumentsTool>({ enabled: false, canManage: false, canRemoveKept: false });
export const useDocumentsTool = (): DocumentsTool => useContext(DocumentsToolContext);
