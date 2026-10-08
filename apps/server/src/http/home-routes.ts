import { getTodayProgress, getHome, occurrencesInRange } from '@vergissmeinnicht/application';
import { UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { procedureCardView } from './procedure-routes.ts';
import { summaryView } from './run-routes.ts';
import { occurrenceView, projectedView } from './schedule-routes.ts';
import { requireUser, type Principal } from './session.ts';

const workspaceParams = z.strictObject({ workspaceId: z.string().regex(UUID_V4) });
// Coarse transport bounds; the use-case validates the dates and the range.
const rangeQuery = z.strictObject({ from: z.string().max(10), to: z.string().max(10) });

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Workspace Home (`/api/workspaces/{workspaceId}/home`, 13.9, 14.2): Overdue, Today, Upcoming, recently done, Active, Pinned, Recent. */
export async function homeRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const parsed = workspaceParams.safeParse(request.params);
    if (!parsed.success) throw new InvalidRequestError();
    // `recentSince`: the start of the viewer's Recently completed window (an ISO instant; the use-case bounds it).
    const query = z.strictObject({ filter: z.enum(['ALL', 'MINE', 'SHARED']).default('ALL'), recentSince: z.iso.datetime().optional() }).safeParse(request.query);
    if (!query.success) throw new InvalidRequestError();
    const recentSince = query.data.recentSince === undefined ? undefined : new Date(query.data.recentSince);
    const progress = await getTodayProgress(services.today, { actor: principalOf(request).user, workspaceId: parsed.data.workspaceId as WorkspaceId, filter: query.data.filter, recentSince });
    const home = await getHome(services.home, { actor: principalOf(request).user, workspaceId: parsed.data.workspaceId as WorkspaceId, filter: query.data.filter });
    return {
      progress,
      overdue: home.overdue.map(occurrenceView),
      today: home.today.map(occurrenceView),
      upcoming: home.upcoming.map(occurrenceView),
      later: home.later,
      recentlyDone: home.recentlyDone.map(occurrenceView),
      active: home.active.map(summaryView),
      pinned: home.pinned.map(procedureCardView),
      recent: home.recent.map(procedureCardView),
      recentLimit: home.recentLimit,
    };
  });
}

/**
 * Calendar (`/api/workspaces/{workspaceId}/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`, 14.4): the Occurrences
 * due in the range plus projected dates of active fixed series. Read-only (`procedure.view`).
 */
export async function calendarRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const params = workspaceParams.safeParse(request.params);
    const query = rangeQuery.safeParse(request.query);
    if (!params.success || !query.success) throw new InvalidRequestError();
    const range = await occurrencesInRange(services.home, { actor: principalOf(request).user, workspaceId: params.data.workspaceId as WorkspaceId, ...query.data });
    return {
      from: range.from,
      to: range.to,
      occurrences: range.occurrences.map(occurrenceView),
      projected: range.projected.map(projectedView),
      truncated: range.truncated,
    };
  });
}
