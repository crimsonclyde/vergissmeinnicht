import {
  CALENDAR_FEED_FUTURE_DAYS,
  CALENDAR_FEED_PAST_DAYS,
  CALENDAR_FEED_TOUCH_MS,
  addDays,
  canAuthenticate,
  localDateAt,
  type CalendarFeed,
  type CalendarFeedScope,
  type LocalDate,
  type TimeZoneName,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { CALENDAR_MAX_DAYS, occurrencesInRange, type CalendarRange, type HomeDeps, type ProjectedOccurrence } from '../home/use-cases.ts';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { CalendarFeedRepository } from '../ports/calendar-feed-repository.ts';
import type { InvitationTokens } from '../ports/invitation-tokens.ts';
import type { ScheduledOccurrence } from '../ports/schedule-repository.ts';
import type { UserRepository } from '../ports/user-repository.ts';
import { ToolNotEnabledError } from '../documents/errors.ts';
import { userActor } from '../user-actor.ts';
import { WorkspaceNotFoundError } from '../workspaces/errors.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

export interface CalendarFeedDeps {
  readonly home: HomeDeps;
  readonly users: UserRepository;
  readonly feeds: CalendarFeedRepository;
  /** 256-bit CSPRNG tokens; only hashes are stored. */
  readonly tokens: InvitationTokens;
}

/** The link cannot be used: unknown or malformed token, or its owner may no longer see this calendar. One error for every case. */
export class CalendarFeedNotFoundError extends Error {
  constructor() {
    super('Calendar feed not found');
    this.name = 'CalendarFeedNotFoundError';
  }
}

const guard = { tool: 'CALENDAR' as const, actorMay: (role: Parameters<typeof roleHasCapability>[0]) => roleHasCapability(role, 'procedure.view') };

const authorize = (deps: CalendarFeedDeps, actor: User, workspaceId: WorkspaceId) => authorizeWorkspace(deps.home, actor, workspaceId, 'procedure.view', 'CALENDAR');

/** The person's own link for this Workspace's calendar, if they made one (never the token: it is not stored). */
export async function getCalendarFeed(deps: CalendarFeedDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<CalendarFeed | null> {
  await authorize(deps, input.actor, input.workspaceId);
  return (await deps.feeds.find(input.actor.id, input.workspaceId)) ?? null;
}

/**
 * Makes the person's link, or a new one in place of the old (which stops working at once). Anyone who may see the
 * calendar may make one for themselves. Returns the token exactly once.
 */
export async function createCalendarFeed(
  deps: CalendarFeedDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scope: CalendarFeedScope },
): Promise<{ readonly feed: CalendarFeed; readonly token: string }> {
  await authorize(deps, input.actor, input.workspaceId);
  const { token, hash } = deps.tokens.generate();
  const result = await deps.feeds.save({ workspaceId: input.workspaceId, tokenHash: hash, scope: input.scope, at: deps.home.clock.now() }, userActor(input.actor), guard);
  if (result.status === 'forbidden') throw new NotAuthorizedError();
  return { feed: result.feed, token };
}

/** Changes what the existing link includes; the link itself stays the same. */
export async function setCalendarFeedScope(
  deps: CalendarFeedDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scope: CalendarFeedScope },
): Promise<CalendarFeed> {
  await authorize(deps, input.actor, input.workspaceId);
  const result = await deps.feeds.setScope({ workspaceId: input.workspaceId, scope: input.scope, at: deps.home.clock.now() }, userActor(input.actor), guard);
  if (result.status === 'ok') return result.feed;
  throw result.status === 'not_found' ? new CalendarFeedNotFoundError() : new NotAuthorizedError();
}

/**
 * Turns the person's link off. Only membership is required (not the calendar tool), so a person can always
 * withdraw their own link, also after the calendar was switched off or their role changed.
 */
export async function deleteCalendarFeed(deps: CalendarFeedDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<void> {
  await authorizeWorkspace(deps.home, input.actor, input.workspaceId, 'procedure.view', null);
  if ((await deps.feeds.remove({ workspaceId: input.workspaceId, at: deps.home.clock.now() }, userActor(input.actor))) === 'not_found') throw new CalendarFeedNotFoundError();
}

export interface CalendarFeedContent {
  readonly workspaceId: WorkspaceId;
  readonly workspaceName: string;
  readonly scope: CalendarFeedScope;
  readonly occurrences: readonly ScheduledOccurrence[];
  readonly projected: readonly ProjectedOccurrence[];
  readonly truncated: boolean;
}

/**
 * What a calendar app receives for a token (39). The token is only a way to name the person: every fetch
 * re-checks that the account is ACTIVE, still a member allowed to see the calendar and the calendar tool is on —
 * exactly what the person would see in the app. Every failure is the same CalendarFeedNotFoundError.
 */
export async function openCalendarFeed(deps: CalendarFeedDeps, input: { readonly token: string }): Promise<CalendarFeedContent> {
  const hash = deps.tokens.hash(input.token);
  if (hash === undefined) throw new CalendarFeedNotFoundError();
  const feed = await deps.feeds.findByTokenHash(hash);
  if (feed === undefined) throw new CalendarFeedNotFoundError();
  const user = await deps.users.findById(feed.userId as User['id']);
  if (user === undefined || !canAuthenticate(user)) throw new CalendarFeedNotFoundError();
  const now = deps.home.clock.now();
  const today = localDateAt(now, 'UTC' as TimeZoneName);
  const ranges: CalendarRange[] = [];
  try {
    for (let from: LocalDate = addDays(today, -CALENDAR_FEED_PAST_DAYS), last = addDays(today, CALENDAR_FEED_FUTURE_DAYS); from <= last; from = addDays(from, CALENDAR_MAX_DAYS)) {
      const to = addDays(from, CALENDAR_MAX_DAYS - 1);
      ranges.push(await occurrencesInRange(deps.home, { actor: user, workspaceId: feed.workspaceId, from, to: to < last ? to : last }));
    }
  } catch (caught) {
    if (caught instanceof WorkspaceNotFoundError || caught instanceof NotAuthorizedError || caught instanceof ToolNotEnabledError) throw new CalendarFeedNotFoundError();
    throw caught;
  }
  const workspace = await deps.home.workspaces.findById(feed.workspaceId);
  if (workspace === undefined) throw new CalendarFeedNotFoundError();
  await deps.feeds.touch(hash, now, CALENDAR_FEED_TOUCH_MS);
  const responsible = (assignee: { readonly userId: string } | null) => feed.scope === 'ALL' || assignee === null || assignee.userId === user.id;
  return {
    workspaceId: feed.workspaceId,
    workspaceName: workspace.name,
    scope: feed.scope,
    occurrences: ranges.flatMap((range) => range.occurrences).filter((item) => item.occurrence.state !== 'SKIPPED' && responsible(item.occurrence.assignee ?? item.schedule.assignee)),
    projected: ranges.flatMap((range) => range.projected).filter((item) => responsible(item.schedule.assignee)),
    truncated: ranges.some((range) => range.truncated),
  };
}
