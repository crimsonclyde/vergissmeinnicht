import {
  mapId, mapNumber, mapText, parseMapApproach, parseMapPlace, parseMapVisit,
  type MapApproach, type MapCategory, type MapPersonalState, type MapPlace, type MapPlaceInput, type MapPointFields, type MapTag, type MapVisit, type User, type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { authorizeTool, type ToolDeps } from './documents/tools.ts';

export class MapNotFoundError extends Error {}
export class MapConflictError extends Error {}
export class MapOperationReusedError extends Error {}
export class MapMatchError extends Error {
  readonly kind: 'exact' | 'possible';
  constructor(kind: 'exact' | 'possible') { super('Place needs match review'); this.kind = kind; }
}
export interface MapBounds { south: number; north: number; west: number; east: number }
export interface MapQuery {
  search?: string | undefined; category?: MapCategory | undefined; tagId?: string | undefined;
  offset?: number | undefined; archived?: boolean | undefined; favorite?: boolean | undefined; want?: boolean | undefined;
  bounds?: MapBounds | undefined; town?: string | undefined;
}
export interface MapContext { actor: User; workspaceId: WorkspaceId }
export interface MapPlacePatch {
  name?: unknown; category?: unknown; details?: unknown; points?: unknown; tagIds?: unknown; coverId?: unknown; approachId?: unknown;
}
export interface MapRepository {
  browse(context: MapContext, query: MapQuery): Promise<{ places: MapPlace[]; tags: MapTag[]; approaches: Pick<MapApproach, 'id' | 'name'>[]; sharedPoints: (MapPointFields & { id: string })[]; towns: string[]; nextOffset: number | null }>;
  get(context: MapContext, id: string, includeArchived: boolean): Promise<MapPlace>;
  lookup(context: MapContext, place: MapPlaceInput): Promise<{ exact: string | null; possible: string[] }>;
  write(context: MapContext, input: MapPlacePatch, operationId: string, at: Date, change?: { id: string; revision: number; archived?: boolean; patch?: boolean }, checkMatches?: boolean): Promise<{ id: string; duplicate: boolean }>;
  tag(context: MapContext, name: string, id: string | null, at: Date): Promise<MapTag>;
  addApproach(context: MapContext, input: Omit<MapApproach, 'id'>, at: Date): Promise<MapApproach>;
  personal(context: MapContext, id: string): Promise<MapPersonalState>;
  setPersonal(context: MapContext, id: string, state: { favorite: boolean; want: boolean }): Promise<MapPersonalState>;
  visit(context: MapContext, id: string, visit: Omit<MapVisit, 'id'>, at: Date): Promise<MapPersonalState>;
}
export interface MapDeps extends ToolDeps { map: MapRepository }

export async function browseMap(deps: MapDeps, context: MapContext, query: MapQuery) {
  await authorizeTool(deps, context.actor, context.workspaceId, 'MAP', query.archived ? 'map.edit' : query.favorite || query.want ? 'map.visit' : 'map.view');
  return deps.map.browse(context, query);
}
export async function getMapPlace(deps: MapDeps, context: MapContext, id: string, includeArchived = false) {
  await authorizeTool(deps, context.actor, context.workspaceId, 'MAP', includeArchived ? 'map.edit' : 'map.view');
  return deps.map.get(context, mapId(id, 'placeId'), includeArchived);
}
export async function previewMapPlace(deps: MapDeps, context: MapContext, raw: unknown) {
  await authorizeTool(deps, context.actor, context.workspaceId, 'MAP', 'map.view');
  const place = parseMapPlace(raw);
  const matches = await deps.map.lookup(context, place);
  return { ...matches, place, unresolved: !place.points.length && Boolean(place.details.originalUrl) };
}
export async function saveMapPlace(deps: MapDeps, context: MapContext, raw: unknown, operationId: string, change?: { id: string; revision: number; archived: boolean }, checkMatches = false) {
  await authorizeTool(deps, context.actor, context.workspaceId, 'MAP', 'map.edit');
  return deps.map.write(context, parseMapPlace(raw), mapId(operationId, 'operationId'), deps.clock.now(), change, checkMatches);
}
export async function updateMapPlaceFields(deps: MapDeps, context: MapContext, patch: MapPlacePatch, operationId: string, id: string, revision: number) {
  await authorizeTool(deps, context.actor, context.workspaceId, 'MAP', 'map.edit');
  return deps.map.write(context, patch, mapId(operationId, 'operationId'), deps.clock.now(), { id, revision, patch: true });
}
export function editableMapPlace(place: MapPlace): MapPlaceInput {
  return {
    name: place.name, category: place.category, details: place.details, coverId: place.coverId, approachId: place.sharedApproach?.id ?? null, tagIds: place.tags.map(tag => tag.id),
    points: place.points.map(({ id, role, preferred }) => ({ pointId: id, role, preferred })),
  };
}
export async function changeMapTag(deps: MapDeps, context: MapContext, name: unknown, id: string | null) {
  await authorizeTool(deps, context.actor, context.workspaceId, 'MAP', 'map.taxonomy');
  return deps.map.tag(context, mapText(name, 'tag.name', 60, true), id, deps.clock.now());
}
export async function addMapApproach(deps: MapDeps, context: MapContext, raw: unknown) {
  await authorizeTool(deps, context.actor, context.workspaceId, 'MAP', 'map.edit');
  return deps.map.addApproach(context, parseMapApproach(raw), deps.clock.now());
}
export async function mapPersonalState(deps: MapDeps, context: MapContext, id: string) {
  await authorizeTool(deps, context.actor, context.workspaceId, 'MAP', 'map.visit');
  return deps.map.personal(context, id);
}
export async function saveMapPersonalState(deps: MapDeps, context: MapContext, id: string, state: { favorite: boolean; want: boolean }) {
  await authorizeTool(deps, context.actor, context.workspaceId, 'MAP', 'map.visit');
  return deps.map.setPersonal(context, id, state);
}
export async function recordMapVisit(deps: MapDeps, context: MapContext, id: string, raw: unknown) {
  await authorizeTool(deps, context.actor, context.workspaceId, 'MAP', 'map.visit');
  return deps.map.visit(context, id, parseMapVisit(raw), deps.clock.now());
}
export function checkedMapBounds(bounds: MapBounds): MapBounds {
  return {
    south: mapNumber(bounds.south, 'south', -90, 90), north: mapNumber(bounds.north, 'north', bounds.south, 90),
    west: mapNumber(bounds.west, 'west', -180, 180), east: mapNumber(bounds.east, 'east', -180, 180),
  };
}
