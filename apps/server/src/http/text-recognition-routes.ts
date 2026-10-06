import { setTextRecognition, textRecognitionSettings, type TextRecognitionSettings } from '@vergissmeinnicht/application';
import { UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const workspaceParams = z.strictObject({ workspaceId: z.string().regex(UUID_V4) });
const noQuery = z.strictObject({});
const switchBody = z.strictObject({ enabled: z.boolean() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Whether recognition is on and how many files are in each state — counts only, never names or text. */
const settingsView = (settings: TextRecognitionSettings) => ({ enabled: settings.enabled, files: settings.counts });

/**
 * Text recognition of a Workspace's Documents (16.9, P5), for Workspace admins
 * (`workspace.settings.manage`) and only while Documents is switched on (404 otherwise, for everyone).
 */
export async function textRecognitionRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.textRecognition;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    parse(noQuery, request.query);
    return { textRecognition: settingsView(await textRecognitionSettings(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId })) };
  });

  app.post('/', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    parse(noQuery, request.query);
    const body = parse(switchBody, request.body);
    return { textRecognition: settingsView(await setTextRecognition(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, enabled: body.enabled })) };
  });
}
