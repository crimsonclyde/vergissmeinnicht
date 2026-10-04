import type { WorkspaceSummary } from './api.ts';

/** The open Workspace and the caller's capabilities in it (for adapting the UI; never a security boundary). */
export interface WorkspaceContext {
  readonly workspace: WorkspaceSummary;
  readonly capabilities: readonly string[];
  /** The optional tools switched on in this Workspace (16.2): what the navigation offers. */
  readonly tools: readonly string[];
  readonly toolsRevision: number;
}
