import {
  addMember,
  changeMemberRole,
  createWorkspace,
  getWorkspace,
  listMembers,
  listMyWorkspaces,
  removeMember,
  renameWorkspace,
  type VisibleMember,
} from '@vergissmeinnicht/application';
import {
  UUID_V4,
  WORKSPACE_ROLES,
  normalizeEmail,
  type UserId,
  type Workspace,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const MINUTE_MS = 60_000;

// Lower-case UUIDv4 only, like the domain parsers: one canonical spelling per id.
const uuid = z.string().regex(UUID_V4);
const role = z.enum(WORKSPACE_ROLES);
const name = z.string().max(256);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const memberParams = z.strictObject({ workspaceId: uuid, userId: uuid });
const nameBody = z.strictObject({ name });
const addMemberBody = z.strictObject({ email: z.string().max(320), role });
const roleBody = z.strictObject({ role });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

function workspaceView(workspace: Workspace) {
  return { id: workspace.id, name: workspace.name };
}

function memberView(member: VisibleMember) {
  return {
    userId: member.userId,
    displayName: member.displayName,
    role: member.role,
    memberSince: member.memberSince.toISOString(),
    // Present only for members who manage the Workspace (decided in the use-case).
    ...(member.email === undefined ? {} : { email: member.email }),
    ...(member.status === undefined ? {} : { status: member.status }),
  };
}

/**
 * Workspaces and Memberships. Every route requires a session; Workspace membership and role
 * capabilities are enforced inside the use-cases (non-members get 404, missing capability 403).
 */
export async function workspaceRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.workspaces;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const mine = await listMyWorkspaces(deps, { actor: principalOf(request).user });
    return { workspaces: mine.map(({ workspace, role }) => ({ ...workspaceView(workspace), role })) };
  });

  app.post('/', { bodyLimit: 1024 }, async (request, reply) => {
    const body = parse(nameBody, request.body);
    const workspace = await createWorkspace(deps, { actor: principalOf(request).user, name: body.name });
    return reply.code(201).send({ workspace: { ...workspaceView(workspace), role: 'ADMIN' } });
  });

  app.get('/:workspaceId', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const result = await getWorkspace(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    return { workspace: { ...workspaceView(result.workspace), role: result.role }, capabilities: result.capabilities };
  });

  app.post('/:workspaceId/rename', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(nameBody, request.body);
    await renameWorkspace(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      name: body.name,
    });
    return reply.code(204).send();
  });

  app.get('/:workspaceId/members', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const members = await listMembers(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    return { members: members.map(memberView) };
  });

  app.post(
    '/:workspaceId/members',
    // Adding by email tells a Workspace admin whether an active account exists; keep probing slow.
    { bodyLimit: 1024, config: { rateLimit: { max: 30, timeWindow: 15 * MINUTE_MS } } },
    async (request, reply) => {
      const { workspaceId } = parse(workspaceParams, request.params);
      const body = parse(addMemberBody, request.body);
      const member = await addMember(deps, {
        actor: principalOf(request).user,
        workspaceId: workspaceId as WorkspaceId,
        email: normalizeEmail(body.email),
        role: body.role,
      });
      return reply.code(201).send({ member: memberView(member) });
    },
  );

  app.post('/:workspaceId/members/:userId/role', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, userId } = parse(memberParams, request.params);
    const body = parse(roleBody, request.body);
    await changeMemberRole(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      userId: userId as UserId,
      role: body.role,
    });
    return reply.code(204).send();
  });

  app.post('/:workspaceId/members/:userId/remove', async (request, reply) => {
    const { workspaceId, userId } = parse(memberParams, request.params);
    await removeMember(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      userId: userId as UserId,
    });
    return reply.code(204).send();
  });
}
