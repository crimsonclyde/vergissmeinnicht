import { toolManifest } from '@vergissmeinnicht/domain';
import type { ServerToolModule } from '../server-tool-module.ts';
import { equipmentRoutes } from './routes.ts';

/**
 * Equipment as a module (45.9, the template for moving the other tools). The shared manifest
 * (`TOOL_MANIFESTS`: family, capability group, routes, backup tables) and this server module are all a
 * tool needs to be wired in; the core registers it from `SERVER_TOOL_MODULES`. Use-cases and the
 * repository stay in their layers (`packages/application/src/equipment`, `packages/database/src/
 * equipment-repository.ts`), the web pages live in `apps/web/src/modules/equipment/`.
 */
export const equipmentModule: ServerToolModule = {
  manifest: toolManifest('EQUIPMENT'),
  async register(api, services) {
    await api.register(equipmentRoutes, { prefix: '/workspaces/:workspaceId', services });
  },
};
