import { PassThrough } from 'node:stream';
import { authorizeRunSubscription } from '@vergissmeinnicht/application';
import type { RunChange, RunId, WorkspaceId } from '@vergissmeinnicht/domain';
import type { RunChangeHub } from '@vergissmeinnicht/realtime';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppServices } from '../composition.ts';
import { reauthenticate, type Principal } from './session.ts';

/** How often an open stream is re-authorized and a heartbeat comment is sent. */
export const RUN_EVENTS_HEARTBEAT_MS = 20_000;
/** Streams are closed after this long; the client reconnects (re-authenticated) and refetches. */
export const RUN_EVENTS_MAX_LIFETIME_MS = 15 * 60_000;
/** Reconnect delay suggested to EventSource clients. */
const RETRY_MS = 5000;

export interface RunEventsOptions {
  readonly heartbeatMs?: number;
  readonly maxLifetimeMs?: number;
}

/** What a subscriber learns about a change: no ids besides the Step, display name only. */
function changeView(change: RunChange) {
  return { revision: change.revision, kind: change.kind, stepId: change.stepId, by: change.by, at: change.at.toISOString() };
}

/**
 * `GET /api/workspaces/{workspaceId}/runs/{runId}/events` — Server-Sent Events for one ACTIVE Run.
 *
 * The stream only announces that the Run reached a new revision (and who changed what); clients
 * refetch the canonical Run over the normal API. It is authorized like reading the Run and
 * re-authorized (session, account status, membership) before every delivered change and at every
 * heartbeat, so a revoked session or removed member stops receiving events within one heartbeat.
 * Finished Runs answer `204`, which also tells EventSource not to reconnect.
 */
export function registerRunEvents(
  app: FastifyInstance,
  services: AppServices,
  hub: RunChangeHub,
  parseRun: (request: FastifyRequest) => { workspaceId: WorkspaceId; runId: RunId; principal: Principal },
  options: RunEventsOptions = {},
) {
  const heartbeatMs = options.heartbeatMs ?? RUN_EVENTS_HEARTBEAT_MS;
  const maxLifetimeMs = options.maxLifetimeMs ?? RUN_EVENTS_MAX_LIFETIME_MS;
  const openStreams = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const close of [...openStreams]) close();
  });

  app.get('/:runId/events', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (request, reply) => {
    const { workspaceId, runId, principal } = parseRun(request);
    const run = await authorizeRunSubscription(services.runs, { actor: principal.user, workspaceId, runId });
    if (run.state !== 'ACTIVE') return reply.code(204).send();

    const stream = new PassThrough();
    let closed = false;
    let queue = Promise.resolve();
    /** Serializes checks and writes so events keep their order. */
    const enqueue = (task: () => Promise<void>) => {
      queue = queue.then(task).catch(() => close());
    };
    const send = (event: string, data: unknown) => {
      if (!closed) stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    /** Current User if the subscription is still allowed; closes the stream otherwise. */
    const recheck = async () => {
      const user = await reauthenticate(services, request, principal);
      if (user === undefined) throw new Error('session ended');
      return authorizeRunSubscription(services.runs, { actor: user, workspaceId, runId });
    };

    const subscription = hub.subscribe(run.id, principal.user.id, (change) =>
      enqueue(async () => {
        await recheck();
        send('run', changeView(change));
        // A finished Run cannot change any more.
        if (change.kind !== 'STEP_STATE_CHANGED') close();
      }),
    );
    if (subscription === undefined) return reply.code(429).send({ error: 'too_many_streams' });

    const heartbeat = setInterval(
      () =>
        enqueue(async () => {
          await recheck();
          if (!closed) stream.write(': heartbeat\n\n');
        }),
      heartbeatMs,
    );
    const lifetime = setTimeout(() => close(), maxLifetimeMs);
    function close() {
      if (closed) return;
      closed = true;
      subscription?.unsubscribe();
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      openStreams.delete(close);
      stream.end();
    }
    openStreams.add(close);
    reply.raw.on('close', close);

    stream.write(`retry: ${RETRY_MS}\n\n`);
    // Read the revision again *after* subscribing: a change committed in between is either
    // included here or delivered as an event, so the client cannot miss it.
    enqueue(async () => {
      const current = await recheck();
      send('ready', { revision: current.revision, state: current.state });
      if (current.state !== 'ACTIVE') close();
    });

    return reply
      .header('content-type', 'text/event-stream; charset=utf-8')
      // Reverse proxies (nginx) must not buffer the stream.
      .header('x-accel-buffering', 'no')
      .send(stream);
  });
}
