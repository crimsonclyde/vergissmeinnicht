import type { WorkspaceSummary } from './api.ts';

/** The open Workspace and the caller's capabilities in it (for adapting the UI; never a security boundary). */
export interface WorkspaceContext {
  readonly workspace: WorkspaceSummary;
  readonly capabilities: readonly string[];
}
