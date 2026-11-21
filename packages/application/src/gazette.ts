import {
  assertGazetteDateWritable, parseGazetteWatchFields, parseGazetteWatchImport, parseGazettePriceObservations, type GazetteWatchFields, type GazettePriceObservationInput, type GazetteWatchItemView, gazetteOldestKept, gazettePreview, gazetteToday, parseGazetteEdition, parseGazetteSettings, parseLocalDate,
  parseGazetteHeaderSettings, addDays, DEFAULT_GAZETTE_WEATHER_SETTINGS, gazetteWeatherPlan, type GazetteHeaderSettings, type GazetteEdition, type GazetteEditionContent, type GazetteEditionSummary, type GazettePreview, type GazetteSettings, type LocalDate, type User, type WorkspaceId,
} from '@vergissmeinnicht/domain';
import type { ToolDeps } from './documents/tools.ts';
import { requireTool } from './tools/require-tool.ts';
import { NotAuthorizedError } from './invitations/errors.ts';
import type { PlaceBackgroundProcessor } from './ports/places.ts';
import type { UserRepository } from './ports/user-repository.ts';
import { buildGazetteWeather, gazetteWeatherVerification, withGazetteWeather, type GazetteWeatherDeps } from './gazette-weather.ts';

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
  /** What the client sent, for operation-id retries: VMN's own weather (43.7) is added afterwards and may differ per try. */
  readonly clientContent?: GazetteEditionContent;
}
export interface GazetteRepository {
  headerSettings(workspaceId: WorkspaceId): Promise<{ settings: GazetteHeaderSettings; revision: number }>;
  saveHeaderSettings(workspaceId: WorkspaceId, actor: User, settings: GazetteHeaderSettings, revision: number, at: Date): Promise<void>;
  addHeaderImage(workspaceId: WorkspaceId, actor: User, jpeg: Uint8Array, replace: string | null, revision: number, at: Date): Promise<void>;
  removeHeaderImage(workspaceId: WorkspaceId, actor: User, id: string, revision: number, at: Date): Promise<void>;
  readHeaderImage(workspaceId: WorkspaceId, id: string): Promise<Uint8Array | undefined>;
  overrideHeader(workspaceId: WorkspaceId, actor: User, date: LocalDate, id: string | null, revision: number, at: Date): Promise<void>;
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
export interface GazetteWatchRepository {
  importWatchItems(workspaceId: WorkspaceId, actor: User, items: readonly GazetteWatchFields[], at: Date): Promise<{ created: number; updated: number; skipped: number }>;
  removeWatchItem(workspaceId: WorkspaceId, actor: User, id: string, revision: number, at: Date): Promise<void>;
  watchItems(workspaceId: WorkspaceId): Promise<GazetteWatchItemView[]>;
  createWatchItem(workspaceId: WorkspaceId, actor: User, fields: GazetteWatchFields, at: Date): Promise<GazetteWatchItemView>;
  /** Refuses a stale revision; the item must belong to the Workspace. */
  updateWatchItem(workspaceId: WorkspaceId, actor: User, id: string, fields: GazetteWatchFields, expectedRevision: number, at: Date): Promise<GazetteWatchItemView>;
  /** All or nothing: an unknown item (or one of another Workspace) refuses the whole batch. */
  recordPrices(workspaceId: WorkspaceId, actor: User, observations: readonly GazettePriceObservationInput[], at: Date): Promise<number>;
}
export interface GazetteDeps extends ToolDeps { readonly users: UserRepository; readonly headerProcessor: PlaceBackgroundProcessor; readonly gazette: GazetteRepository & GazetteWatchRepository; readonly forecast?: GazetteWeatherDeps }

type Level = 'view' | 'publish' | 'manage';
export async function authorizeGazette(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, level: Level = 'view') {
  const current = await deps.users.findById(actor.id);
  if (current?.status !== 'ACTIVE') throw new NotAuthorizedError();
  await requireTool(deps, current, workspaceId, 'GAZETTE', `gazette.${level}`);
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
  const now = deps.clock.now();
  assertGazetteDateWritable(settings, content.date, now);
  const existing = deps.forecast === undefined ? undefined : (await deps.gazette.findByDate(workspaceId, content.date, 'PUBLISHED'))?.content;
  const withWeather = parseGazetteEdition(await withGazetteWeather(deps.forecast, { workspaceId, settings, content, existing, now }), settings.sections);
  return deps.gazette.write(workspaceId, actor, { operationId: input.operationId, content: withWeather, clientContent: content, publish: input.publish, expectedRevision: input.expectedRevision }, deps.clock.now());
}

export async function publishGazetteDraft(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, editionId: string, expectedRevision: number) {
  await authorizeGazette(deps, actor, workspaceId, 'publish');
  const { settings } = await deps.gazette.settings(workspaceId);
  const now = deps.clock.now();
  // A fresh forecast at publication (43.7), prepared outside the transaction and used only for the draft it was made from.
  const draft = deps.forecast === undefined ? undefined : await deps.gazette.findById(workspaceId, editionId);
  const existing = draft === undefined ? undefined : (await deps.gazette.findByDate(workspaceId, draft.date, 'PUBLISHED'))?.content;
  const prepared = draft === undefined || draft.state !== 'DRAFT' ? undefined : await withGazetteWeather(deps.forecast, { workspaceId, settings, content: draft.content, existing, now });
  // Section definitions may have changed since the draft was written: validate again, inside the transaction.
  return deps.gazette.publish(workspaceId, actor, editionId, expectedRevision, content => {
    const parsed = parseGazetteEdition(prepared !== undefined && draft !== undefined && JSON.stringify(content) === JSON.stringify(draft.content) ? prepared : content, settings.sections);
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

/** The persistent watchlist (43.3): everyone with the tool reads it; publishers (EDITOR+) change it. */
export async function listGazetteWatchItems(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId) {
  await authorizeGazette(deps, actor, workspaceId);
  return deps.gazette.watchItems(workspaceId);
}
export async function createGazetteWatchItem(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, fields: unknown) {
  await authorizeGazette(deps, actor, workspaceId, 'publish');
  return deps.gazette.createWatchItem(workspaceId, actor, parseGazetteWatchFields(fields), deps.clock.now());
}
export async function updateGazetteWatchItem(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, id: string, fields: unknown, expectedRevision: number) {
  await authorizeGazette(deps, actor, workspaceId, 'publish');
  return deps.gazette.updateWatchItem(workspaceId, actor, id, parseGazetteWatchFields(fields), expectedRevision, deps.clock.now());
}
export async function recordGazettePrices(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, observations: unknown) {
  await authorizeGazette(deps, actor, workspaceId, 'publish');
  const now = deps.clock.now();
  return { recorded: await deps.gazette.recordPrices(workspaceId, actor, parseGazettePriceObservations(observations, now), now) };
}


export async function importGazetteWatchItems(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, items: unknown) {
  await authorizeGazette(deps, actor, workspaceId, 'publish');
  return deps.gazette.importWatchItems(workspaceId, actor, parseGazetteWatchImport(items), deps.clock.now());
}

export async function getGazetteHeaderSettings(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId) {
  await authorizeGazette(deps, actor, workspaceId, 'manage');
  return deps.gazette.headerSettings(workspaceId);
}
export async function saveGazetteHeaderSettings(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, value: unknown, revision: number) {
  await authorizeGazette(deps, actor, workspaceId, 'manage');
  await deps.gazette.saveHeaderSettings(workspaceId, actor, parseGazetteHeaderSettings(value), revision, deps.clock.now());
  return deps.gazette.headerSettings(workspaceId);
}
export async function addGazetteHeaderImage(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, bytes: Uint8Array, replace: string | null, revision: number) {
  await authorizeGazette(deps, actor, workspaceId, 'manage');
  const { jpeg } = await deps.headerProcessor.background(bytes);
  await deps.gazette.addHeaderImage(workspaceId, actor, jpeg, replace, revision, deps.clock.now());
  return deps.gazette.headerSettings(workspaceId);
}
export async function removeGazetteHeaderImage(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, id: string, revision: number) {
  await authorizeGazette(deps, actor, workspaceId, 'manage');
  await deps.gazette.removeHeaderImage(workspaceId, actor, id, revision, deps.clock.now());
  return deps.gazette.headerSettings(workspaceId);
}
export async function readGazetteHeaderImage(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, id: string) {
  await authorizeGazette(deps, actor, workspaceId);
  const jpeg = await deps.gazette.readHeaderImage(workspaceId, id);
  if (!jpeg) throw new GazetteNotFoundError();
  return jpeg;
}
export async function overrideGazetteHeader(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, date: string, id: string | null, revision: number) {
  await authorizeGazette(deps, actor, workspaceId, 'manage');
  await deps.gazette.overrideHeader(workspaceId, actor, parseLocalDate(date), id, revision, deps.clock.now());
}

export async function removeGazetteWatchItem(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, id: string, revision: number) {
  await authorizeGazette(deps, actor, workspaceId, 'manage');
  return deps.gazette.removeWatchItem(workspaceId, actor, id, revision, deps.clock.now());
}

/**
 * The forecast VMN would put into today's edition (43.7), for the page's settings and for MCP clients that
 * write the summary: the Workspace place, the source plan, the combined days and what failed. Nothing is
 * stored in an edition by reading it.
 */
export async function getGazetteWeather(deps: GazetteDeps, actor: User, workspaceId: WorkspaceId, date?: string) {
  await authorizeGazette(deps, actor, workspaceId);
  const { settings } = await deps.gazette.settings(workspaceId);
  const now = deps.clock.now();
  const today = gazetteToday(settings, now);
  let day: LocalDate = today;
  if (date !== undefined) { try { day = parseLocalDate(date); } catch { throw new GazetteNotFoundError(); } }
  if (day < today || day > addDays(today, 1)) throw new GazetteNotFoundError();
  const workspace = await deps.workspaces.findById(workspaceId);
  const place = workspace?.location ?? null;
  const weather = settings.weather ?? DEFAULT_GAZETTE_WEATHER_SETTINGS;
  const plan = place === null ? null : gazetteWeatherPlan(place, weather);
  if (deps.forecast === undefined) return { date: day, place, settings: weather, plan, result: { status: 'unavailable' as const, failed: [], reason: 'weather_off' as const }, verification: null };
  const result = await buildGazetteWeather(deps.forecast, workspaceId, settings, day);
  const verification = place === null ? null : await gazetteWeatherVerification(deps.forecast, workspaceId, place, today).catch(() => null);
  return { date: day, place, settings: weather, plan, result: result.status === 'ok' ? { status: result.status, location: result.location, failed: result.failed } : result.status === 'unavailable' ? { status: result.status, failed: result.failed, reason: result.reason } : result, verification };
}
