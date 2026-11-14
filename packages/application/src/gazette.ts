import {
  assertGazetteDateWritable, gazetteOldestKept, gazettePreview, gazetteToday, parseGazetteEdition, parseGazetteSettings, parseLocalDate,
  type GazetteEdition, type GazetteEditionContent, type GazetteEditionSummary, type GazettePreview, type GazetteSettings, type LocalDate, type User, type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { authorizeTool, type ToolDeps } from './documents/tools.ts';
import { NotAuthorizedError } from './invitations/errors.ts';
import type { UserRepository } from './ports/user-repository.ts';

export class GazetteNotFoundError extends Error {}
/** A stale `expectedRevision` (settings or a draft edited meanwhile). */
export class GazetteConflictError extends Error {}
/** An operation id was reused with a different payload: never applied, never guessed. */
export class GazetteOperationConflictError extends Error {}

export interface StoredGazetteSettings { readonly settings: GazetteSettings; readonly revision: number }
export interface GazetteWriteInput {
  readonly operationId: string | null;
  readonly content: GazetteEditionContent;
  readonly publish: boolean;
  /** Required to change an existing draft by hand; imports with an operation id may omit it. */
  readonly expectedRevision: number | null;
}
export interface GazetteRepository {
  settings(workspaceId: WorkspaceId): Promise<StoredGazetteSettings>;
  saveSettings(workspaceId: WorkspaceId, actor: User, settings: GazetteSettings, expectedRevision: number, at: Date): Promise<StoredGazetteSettings>;
  /** Validated content only. One transaction: a failure leaves every stored edition as it was. */
  write(workspaceId: WorkspaceId, actor: User, input: GazetteWriteInput, at: Date): Promise<{ readonly edition: GazetteEdition; readonly duplicate: boolean }>;
  publish(workspaceId: WorkspaceId, actor: User, editionId: string, expectedRevision: number, revalidate: (content: GazetteEditionContent) => GazetteEditionContent, at: Date): Promise<GazetteEdition>;
  deleteDraft(workspaceId: WorkspaceId, actor: User, editionId: string, at: Date): Promise<void>;
  list(workspaceId: WorkspaceId, oldest: LocalDate, includeDrafts: boolean): Promise<GazetteEditionSummary[]>;
  findById(workspaceId: WorkspaceId, id: string): Promise<GazetteEdition | undefined>;
  findByDate(workspaceId: WorkspaceId, date: LocalDate, state: 'DRAFT' | 'PUBLISHED'): Promise<GazetteEdition | undefined>;
  /** The newest published edition on or before `date`. */
  latestPublished(workspaceId: WorkspaceId, onOrBefore: LocalDate): Promise<GazetteEdition | undefined>;
}
export interface GazetteDeps extends ToolDeps { readonly users: UserRepository; readonly gazette: GazetteRepository }

type Level = 'view' | 'publish' | 'manage';
export async function authorizeGazette(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, level: Level = 'view') {
  const current = await deps.users.findById(actor.id);
  if (current?.status !== 'ACTIVE') throw new NotAuthorizedError();
  await authorizeTool(deps, current, workspaceId, 'GAZETTE', `gazette.${level}`);
}
async function canPublish(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId): Promise<boolean> {
  try { await authorizeGazette(deps, actor, workspaceId, 'publish'); return true; } catch (error) { if (error instanceof NotAuthorizedError) return false; throw error; }
}

export async function getGazetteSettings(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId) {
  await authorizeGazette(deps, actor, workspaceId);
  const stored = await deps.gazette.settings(workspaceId);
  return { ...stored, today: gazetteToday(stored.settings, deps.clock.now()), oldest: gazetteOldestKept(stored.settings, deps.clock.now()) };
}

export async function saveGazetteSettings(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, settings: unknown, expectedRevision: number) {
  await authorizeGazette(deps, actor, workspaceId, 'manage');
  return deps.gazette.saveSettings(workspaceId, actor, parseGazetteSettings(settings), expectedRevision, deps.clock.now());
}

/**
 * Writes an edition from a client or an import: validated against the current section definitions and the
 * date window before anything is stored. `publish` replaces today's published edition atomically.
 */
export async function writeGazetteEdition(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, input: { readonly operationId: string | null; readonly content: unknown; readonly publish: boolean; readonly expectedRevision: number | null }) {
  await authorizeGazette(deps, actor, workspaceId, 'publish');
  const { settings } = await deps.gazette.settings(workspaceId);
  const content = parseGazetteEdition(input.content, settings.sections);
  assertGazetteDateWritable(settings, content.date, deps.clock.now());
  return deps.gazette.write(workspaceId, actor, { operationId: input.operationId, content, publish: input.publish, expectedRevision: input.expectedRevision }, deps.clock.now());
}

export async function publishGazetteDraft(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, editionId: string, expectedRevision: number) {
  await authorizeGazette(deps, actor, workspaceId, 'publish');
  const { settings } = await deps.gazette.settings(workspaceId);
  const now = deps.clock.now();
  // Section definitions may have changed since the draft was written: validate again, inside the transaction.
  return deps.gazette.publish(workspaceId, actor, editionId, expectedRevision, content => {
    const parsed = parseGazetteEdition(content, settings.sections);
    assertGazetteDateWritable(settings, parsed.date, now);
    return parsed;
  }, now);
}

export async function deleteGazetteDraft(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, editionId: string) {
  await authorizeGazette(deps, actor, workspaceId, 'publish');
  await deps.gazette.deleteDraft(workspaceId, actor, editionId, deps.clock.now());
}

export async function listGazetteEditions(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId) {
  await authorizeGazette(deps, actor, workspaceId);
  const { settings } = await deps.gazette.settings(workspaceId);
  const now = deps.clock.now();
  const editions = await deps.gazette.list(workspaceId, gazetteOldestKept(settings, now), await canPublish(deps, actor, workspaceId));
  return { today: gazetteToday(settings, now), editions };
}

/** A published edition by date; drafts only for those who may publish. */
export async function getGazetteEdition(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, date: string, state: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED'): Promise<GazetteEdition> {
  await authorizeGazette(deps, actor, workspaceId, state === 'DRAFT' ? 'publish' : 'view');
  let day: LocalDate;
  try { day = parseLocalDate(date); } catch { throw new GazetteNotFoundError(); }
  const edition = await deps.gazette.findByDate(workspaceId, day, state);
  if (!edition) throw new GazetteNotFoundError();
  return edition;
}

export async function getGazetteEditionById(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, id: string): Promise<GazetteEdition> {
  await authorizeGazette(deps, actor, workspaceId);
  const edition = await deps.gazette.findById(workspaceId, id);
  if (!edition || (edition.state === 'DRAFT' && !(await canPublish(deps, actor, workspaceId)))) throw new GazetteNotFoundError();
  return edition;
}

/**
 * The Dashboard card: the newest published edition up to today, as a compact preview. An older edition is
 * returned with its real date and `isToday: false` (and no weather), never as today's.
 */
export async function gazetteDashboard(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId): Promise<{ readonly today: LocalDate; readonly preview: GazettePreview | null }> {
  await authorizeGazette(deps, actor, workspaceId);
  const { settings } = await deps.gazette.settings(workspaceId);
  const today = gazetteToday(settings, deps.clock.now());
  const edition = await deps.gazette.latestPublished(workspaceId, today);
  return { today, preview: edition ? gazettePreview(edition, settings, today) : null };
}
