import type { ToolManifest } from '@vergissmeinnicht/domain';
import type { FastifyInstance } from 'fastify';
import type { AppServices } from '../composition.ts';

/**
 * The server half of a tool's manifest (45.8): the shared manifest plus how the tool registers its API
 * routes under `/api`. Every route it registers must match one of `manifest.routes` (the tool-off sweep
 * in `route-security.test.ts` refuses unclassified routes), and its use-cases check the switch with
 * `requireTool` (45.2).
 */
export interface ServerToolModule {
  readonly manifest: ToolManifest;
  register(api: FastifyInstance, services: AppServices): Promise<void>;
}
