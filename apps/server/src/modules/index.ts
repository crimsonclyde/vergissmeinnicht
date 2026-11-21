import { equipmentModule } from './equipment/index.ts';
import type { ServerToolModule } from './server-tool-module.ts';

/** Tools wired in as modules (45.9). The other tools still register in `app.ts` and move here one by one. */
export const SERVER_TOOL_MODULES: readonly ServerToolModule[] = [equipmentModule];
