import { MAP_CATEGORIES, MAP_POINT_PRECISIONS, MAP_POINT_ROLES, UUID_V4 } from '@vergissmeinnicht/domain';
import { z } from 'zod';

const uuid = z.string().regex(UUID_V4);
const short = z.string().max(240).optional();
const narrative = z.string().max(1600).optional();
const date = z.string().max(10).optional();
const url = z.string().max(2048);
const source = z.strictObject({ url, title: short, publisher: short, checkedOn: date, supports: narrative });
const pointFields = z.strictObject({
  label: z.string().max(120), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  precision: z.enum(MAP_POINT_PRECISIONS), provenance: z.string().max(500).default(''),
});
const pointRole = { role: z.enum(MAP_POINT_ROLES), preferred: z.boolean().default(false) };
const point = z.union([z.strictObject({ ...pointRole, pointId: uuid }), z.strictObject({ ...pointRole, newPoint: pointFields })]);
const details = z.strictObject({
  locality: short, address: short, description: narrative, website: url.optional(), hours: z.string().max(320).optional(),
  hoursCheckedOn: date, originalUrl: url.optional(), externalId: z.string().max(256).optional(),
  approach: narrative, walkMinutes: z.number().int().positive().max(1440).nullable().optional(),
  walkMeters: z.number().int().positive().max(100000).nullable().optional(), terrain: z.string().max(320).optional(),
  routeAccess: narrative, buildingAccess: narrative, hazards: narrative, conditionsCheckedOn: date, sources: z.array(source).max(12).optional(),
});
const common = {
  approachId: uuid.nullable().optional(),
  category: z.enum(MAP_CATEGORIES).optional(), details: details.optional(),
  points: z.array(point).max(12).optional(), tagIds: z.array(uuid).max(16).optional(),
};
export const mapPlaceInput = z.strictObject({ ...common, name: z.string().max(120) });
export const mapPlaceChanges = z.strictObject({ ...common, name: z.string().max(120).optional() })
  .refine(value => Object.keys(value).length > 0, { message: 'empty_edit' });
