import { CalendarFeedNotFoundError, createCalendarFeed, deleteCalendarFeed, getCalendarFeed, openCalendarFeed, setCalendarFeedScope } from '@vergissmeinnicht/application';
import { CALENDAR_FEED_SCOPES, UUID_V4, type CalendarFeed, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { renderCalendarFeed } from './calendar-feed-ics.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const MINUTE_MS = 60_000;
const workspaceParams = z.strictObject({ workspaceId: z.string().regex(UUID_V4) });
const scopeBody = z.strictObject({ scope: z.enum(CALENDAR_FEED_SCOPES) });
/** `{token}.ics`: the token is 32 random bytes in unpadded base64url. */
const FEED_FILE = /^([A-Za-z0-9_-]{43})\.ics$/;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Never the token or its hash: the token is shown once, when the link is made. */
const feedView = (feed: CalendarFeed) => ({ scope: feed.scope, createdAt: feed.createdAt.toISOString(), lastUsedAt: feed.lastUsedAt?.toISOString() ?? null });

export const calendarFeedUrl = (publicOrigin: string, token: string) => `${publicOrigin}/api/calendar-feed/${token}.ics`;

/**
 * The signed-in person's own calendar subscription link for one Workspace (39,
 * `/api/workspaces/{workspaceId}/calendar-feed`). Authorization is in the use-cases.
 */
export async function workspaceCalendarFeedRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.calendarFeeds;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const feed = await getCalendarFeed(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    return { feed: feed === null ? null : feedView(feed) };
  });

  // Makes the link, or a new one in place of the old one.
  app.post('/', { bodyLimit: 1024, config: { rateLimit: { max: 20, timeWindow: 15 * MINUTE_MS } } }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { scope } = parse(scopeBody, request.body);
    const { feed, token } = await createCalendarFeed(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, scope });
    // The only time the token leaves the server; it is not stored.
    return reply.code(201).send({ feed: feedView(feed), url: calendarFeedUrl(services.publicOrigin, token) });
  });

  app.post('/scope', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { scope } = parse(scopeBody, request.body);
    const feed = await setCalendarFeedScope(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, scope });
    return { feed: feedView(feed) };
  });

  app.post('/delete', async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    await deleteCalendarFeed(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    return reply.code(204).send();
  });
}

/**
 * `GET /api/calendar-feed/{token}.ics` (39): what Apple Calendar, Google Calendar and other calendar apps fetch.
 * Calendar apps cannot sign in, so the unguessable token in the path names the person — and nothing more: the
 * use-case re-checks account, membership, permission and the calendar tool on every fetch. Every failure is the
 * same plain 404. The path is redacted from logs (`apps/server/src/logging.ts`).
 */
export async function publicCalendarFeedRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.get('/:file', { config: { rateLimit: { max: 30, timeWindow: MINUTE_MS } } }, async (request, reply) => {
    const file = (request.params as { file?: unknown }).file;
    const token = typeof file === 'string' ? FEED_FILE.exec(file)?.[1] : undefined;
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    if (token === undefined) return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    try {
      const content = await openCalendarFeed(services.calendarFeeds, { token });
      return reply
        .type('text/calendar; charset=utf-8')
        .header('Content-Disposition', 'inline; filename="vergissmeinnicht.ics"')
        .send(renderCalendarFeed(content, { publicOrigin: services.publicOrigin, now: services.calendarFeeds.home.clock.now() }));
    } catch (caught) {
      if (caught instanceof CalendarFeedNotFoundError) return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
      throw caught;
    }
  });
}
