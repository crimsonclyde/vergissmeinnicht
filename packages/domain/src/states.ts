export const RUN_STATES = ['ACTIVE', 'COMPLETED', 'ABORTED'] as const;
export type RunState = (typeof RUN_STATES)[number];

/** SKIPPED and NOT_APPLICABLE are semantically different and must not be merged. */
export const STEP_STATES = ['PENDING', 'DONE', 'SKIPPED', 'NOT_APPLICABLE'] as const;
export type StepState = (typeof STEP_STATES)[number];

export const WORKSPACE_ROLES = ['GUEST', 'USER', 'EDITOR', 'ADMIN'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
