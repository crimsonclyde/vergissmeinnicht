import { DomainValidationError } from './errors.ts';
import { UUID_V4 } from './user.ts';

export const MAP_CATEGORIES = ['food', 'shopping', 'historic', 'urbex', 'trailhead', 'other'] as const;
export const MAP_POINT_ROLES = ['destination', 'parking', 'trailhead'] as const;
export const MAP_POINT_PRECISIONS = ['exact', 'approximate'] as const;
export type MapCategory = typeof MAP_CATEGORIES[number];
export type MapPointRole = typeof MAP_POINT_ROLES[number];
export type MapPointPrecision = typeof MAP_POINT_PRECISIONS[number];

export interface MapSource { url: string; title: string; publisher: string; checkedOn: string; supports: string }
export interface MapPlaceDetails {
  locality: string; address: string; description: string; website: string; hours: string; hoursCheckedOn: string;
  originalUrl: string; externalId: string; approach: string; walkMinutes: number | null; walkMeters: number | null;
  terrain: string; routeAccess: string; buildingAccess: string; hazards: string; conditionsCheckedOn: string; sources: MapSource[];
}
export interface MapApproach {
  id: string; name: string; description: string; walkMinutes: number | null; walkMeters: number | null;
  terrain: string; routeAccess: string; checkedOn: string; sourceUrl: string;
}
export interface MapPointFields {
  label: string; latitude: number; longitude: number; precision: MapPointPrecision; provenance: string;
}
export type MapPointInput = { role: MapPointRole; preferred: boolean } & ({ pointId: string; newPoint?: never } | { newPoint: MapPointFields; pointId?: never });
export type MapPoint = MapPointFields & { id: string; role: MapPointRole; preferred: boolean };
export interface MapTag { id: string; name: string }
export interface MapPlaceInput { name: string; category: MapCategory; details: MapPlaceDetails; points: MapPointInput[]; tagIds: string[]; coverId: string | null; approachId: string | null }
export interface MapPlace {
  id: string; name: string; category: MapCategory; details: MapPlaceDetails; points: MapPoint[];
  tags: MapTag[]; coverId: string | null; sharedApproach: MapApproach | null; revision: number; archived: boolean;
}
export interface MapVisit { id: string; date: string | null; note: string; rating: number | null; photoIds: string[] }
export interface MapPersonalState { favorite: boolean; want: boolean; visits: MapVisit[] }
export const EMPTY_MAP_PERSONAL_STATE: MapPersonalState = { favorite: false, want: false, visits: [] };

const fail = (field: string): never => { throw new DomainValidationError(field, 'invalid_map_field', 'Invalid Map field'); };
// eslint-disable-next-line no-control-regex -- Reject terminal and bidirectional controls in imported text.
const disallowed = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(field);
  return value as Record<string, unknown>;
}
export function mapText(value: unknown, field: string, limit: number, required = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > limit || disallowed.test(value)) return fail(field);
  const text = value.trim();
  if (required && !text) return fail(field);
  return text;
}
function https(value: unknown, field: string, required = false): string {
  if ((value === undefined || value === '') && !required) return '';
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value) || disallowed.test(value)) return fail(field);
  if (!/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:[/?#].*)?$/iu.test(value)) return fail(field);
  return value;
}
export function mapDate(value: unknown, field: string): string {
  if (value === undefined || value === '' || value === null) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail(field);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return fail(field);
  return value;
}
export function mapNumber(value: unknown, field: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) return fail(field);
  return value;
}
function optionalNumber(value: unknown, field: string, min: number, max: number): number | null {
  return value == null ? null : mapNumber(value, field, min, max, true);
}
function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) return fail(field);
  return value as T;
}
function array(value: unknown, field: string, limit: number): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) return fail(field);
  return value;
}
export function mapId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail(field);
  return value;
}
export function parseMapDetails(value: unknown): MapPlaceDetails {
  const row = object(value ?? {}, 'details');
  return {
    locality: mapText(row.locality, 'locality', 120), address: mapText(row.address, 'address', 240),
    description: mapText(row.description, 'description', 1600), website: https(row.website, 'website'),
    hours: mapText(row.hours, 'hours', 320), hoursCheckedOn: mapDate(row.hoursCheckedOn, 'hoursCheckedOn'),
    originalUrl: https(row.originalUrl, 'originalUrl'), externalId: mapText(row.externalId, 'externalId', 256),
    approach: mapText(row.approach, 'approach', 1600), walkMinutes: optionalNumber(row.walkMinutes, 'walkMinutes', 1, 1440),
    walkMeters: optionalNumber(row.walkMeters, 'walkMeters', 1, 100_000), terrain: mapText(row.terrain, 'terrain', 320),
    routeAccess: mapText(row.routeAccess, 'routeAccess', 600), buildingAccess: mapText(row.buildingAccess, 'buildingAccess', 600),
    hazards: mapText(row.hazards, 'hazards', 1000), conditionsCheckedOn: mapDate(row.conditionsCheckedOn, 'conditionsCheckedOn'),
    sources: array(row.sources, 'sources', 12).map(value => {
      const source = object(value, 'source');
      return { url: https(source.url, 'source.url', true), title: mapText(source.title, 'source.title', 160),
        publisher: mapText(source.publisher, 'source.publisher', 120), checkedOn: mapDate(source.checkedOn, 'source.checkedOn'),
        supports: mapText(source.supports, 'source.supports', 500) };
    }),
  };
}
function parsePoint(value: unknown): MapPointInput {
  const point = object(value, 'point');
  const role = enumValue(point.role, MAP_POINT_ROLES, 'point.role');
  if (point.preferred !== undefined && typeof point.preferred !== 'boolean') return fail('point.preferred');
  const preferred = point.preferred === true;
  if (point.pointId !== undefined && point.newPoint !== undefined) return fail('point');
  if (point.pointId !== undefined) return { role, preferred, pointId: mapId(point.pointId, 'point.id') };
  const fields = object(point.newPoint, 'point.newPoint');
  return { role, preferred, newPoint: {
    label: mapText(fields.label, 'point.label', 120, true),
    latitude: mapNumber(fields.latitude, 'point.latitude', -90, 90),
    longitude: mapNumber(fields.longitude, 'point.longitude', -180, 180),
    precision: enumValue(fields.precision ?? 'exact', MAP_POINT_PRECISIONS, 'point.precision'),
    provenance: mapText(fields.provenance, 'point.provenance', 500),
  } };
}
export function parseMapApproach(value: unknown): Omit<MapApproach, 'id'> {
  const row = object(value, 'approach');
  return {
    name: mapText(row.name, 'approach.name', 120, true), description: mapText(row.description, 'approach.description', 1600),
    walkMinutes: optionalNumber(row.walkMinutes, 'approach.walkMinutes', 1, 1440),
    walkMeters: optionalNumber(row.walkMeters, 'approach.walkMeters', 1, 100_000),
    terrain: mapText(row.terrain, 'approach.terrain', 320), routeAccess: mapText(row.routeAccess, 'approach.routeAccess', 600),
    checkedOn: mapDate(row.checkedOn, 'approach.checkedOn'), sourceUrl: https(row.sourceUrl, 'approach.sourceUrl'),
  };
}
export function parseMapPlace(value: unknown): MapPlaceInput {
  const row = object(value, 'place');
  const points = array(row.points, 'points', 12).map(parsePoint);
  if (points.filter(p => p.preferred).length > 1) return fail('points.preferred');
  const tagIds = array(row.tagIds, 'tagIds', 16).map(id => mapId(id, 'tagId'));
  if (new Set(tagIds).size !== tagIds.length) return fail('tagIds');
  return { name: mapText(row.name, 'name', 120, true), category: enumValue(row.category ?? 'other', MAP_CATEGORIES, 'category'),
    details: parseMapDetails(row.details), points, tagIds, coverId: row.coverId == null ? null : mapId(row.coverId, 'coverId'),
    approachId: row.approachId == null ? null : mapId(row.approachId, 'approachId') };
}
export function parseMapVisit(value: unknown): Omit<MapVisit, 'id'> {
  const row = object(value, 'visit');
  const photoIds = array(row.photoIds, 'photoIds', 6).map(id => mapId(id, 'photoId'));
  if (new Set(photoIds).size !== photoIds.length) return fail('photoIds');
  return { photoIds, date: mapDate(row.date, 'visit.date') || null, note: mapText(row.note, 'visit.note', 4000),
    rating: optionalNumber(row.rating, 'visit.rating', 1, 5) };
}
