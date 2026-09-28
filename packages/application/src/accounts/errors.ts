/** The account already has the requested status. */
export class AccountStatusUnchangedError extends Error {
  constructor() {
    super('The account already has this status');
    this.name = 'AccountStatusUnchangedError';
  }
}

/** Disabling the account would leave Workspaces without an active admin; promote someone else first. */
export class SoleWorkspaceManagerError extends Error {
  readonly workspaces: readonly { readonly id: string; readonly name: string }[];

  constructor(workspaces: readonly { readonly id: string; readonly name: string }[]) {
    super('The account is the only active admin of one or more Workspaces');
    this.name = 'SoleWorkspaceManagerError';
    this.workspaces = workspaces;
  }
}
