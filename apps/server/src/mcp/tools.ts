/**
 * Every MCP tool of the assistant connection, in the order the client lists them. Each Workspace tool
 * keeps its MCP tools in its own file under `mcp/tools/` (48.3); shared schemas, views and errors are in
 * `mcp/tools/shared.ts`. The coverage test (`mcp-coverage.test.ts`) checks every tool against the
 * `mcp` entry of its manifest.
 */
import { randomUUID } from 'node:crypto';
import { calendarTools } from './tools/calendar.ts';
import { contactsTools } from './tools/contacts.ts';
import { documentsTools } from './tools/documents.ts';
import { equipmentTools } from './tools/equipment.ts';
import { gazetteTools } from './tools/gazette.ts';
import { groceriesTools } from './tools/groceries.ts';
import { listCoversTools } from './tools/list-covers.ts';
import { maintenanceTools } from './tools/maintenance.ts';
import { notesTools } from './tools/notes.ts';
import { placesTools } from './tools/places.ts';
import { proceduresTools } from './tools/procedures.ts';
import { recipesTools } from './tools/recipes.ts';
import type { AssistantTool } from './tools/shared.ts';
import { todosTools } from './tools/todos.ts';
import { workspacesTools } from './tools/workspaces.ts';

export { AssistantOperationReusedError, GroceryBatchToolError, groceryBatchError, RecipeCoverRequiredError, type AssistantTool } from './tools/shared.ts';

export const assistantTools: AssistantTool[] = [
  ...workspacesTools,
  ...proceduresTools,
  ...groceriesTools,
  ...todosTools,
  ...calendarTools,
  ...notesTools,
  ...listCoversTools,
  ...recipesTools,
  ...placesTools,
  ...gazetteTools,
  ...equipmentTools,
  ...maintenanceTools,
  ...contactsTools,
  ...documentsTools,
];
// Server chooses identities and time. The client supplies no actor, role or execution code.
export const newAssistantOperationId = () => randomUUID();
