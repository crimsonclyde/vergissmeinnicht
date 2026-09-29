import { getHome } from '@vergissmeinnicht/application';
import { UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { procedureCardView } from './procedure-routes.ts';
import { summaryView } from './run-routes.ts';
import { scheduleView } from './schedule-routes.ts';
import { requireUser, type Principal } from './session.ts';

const workspaceParams = z.strictObject({ workspaceId: z.string().regex(UUID_V4) });

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Workspace Home (`/api/workspaces/{workspaceId}/home`, 13.9): Due, Upcoming, Active, Pinned, Recent. */
export async function homeRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const parsed = workspaceParams.safeParse(request.params);
    if (!parsed.success) throw new InvalidRequestError();
    const home = await getHome(services.home, { actor: principalOf(request).user, workspaceId: parsed.data.workspaceId as WorkspaceId });
    return {
      due: home.due.map((item) => ({ ...scheduleView(item), timeliness: item.timeliness })),
      upcoming: home.upcoming.map(scheduleView),
      active: home.active.map(summaryView),
      pinned: home.pinned.map(procedureCardView),
      recent: home.recent.map(procedureCardView),
      recentLimit: home.recentLimit,
    };
  });
}
