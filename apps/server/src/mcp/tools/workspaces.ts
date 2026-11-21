import { define, type AssistantTool } from './shared.ts';

export const workspacesTools: AssistantTool[] = [
 define('list_workspaces','List currently accessible Workspaces selected for this connection.','workspaces.read',null,false,{},async({services,actor,grantWorkspaceIds})=>({workspaces:(await services.workspaces.workspaces.listForUser(actor.id)).filter(row=>grantWorkspaceIds.includes(row.workspace.id)).map(row=>({id:row.workspace.id,name:row.workspace.name,role:row.role}))})),
];
