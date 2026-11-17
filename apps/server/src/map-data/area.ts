import { z } from 'zod';
export const areaSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).refine(s => !/[\p{Cc}\p{Cf}]/u.test(s)),
  latitude: z.number().min(-70).max(70), longitude: z.number().min(-175).max(175),
  radiusKm: z.number().int().min(10).max(200),
});
export type MapArea = z.infer<typeof areaSchema>;
export function areaBounds(area: MapArea): [number, number, number, number] {
  const checked = areaSchema.parse(area);
  const angular = checked.radiusKm / 6371.0088;
  const lat = angular * 180 / Math.PI;
  const lon = Math.asin(Math.sin(angular) / Math.cos(checked.latitude * Math.PI / 180)) * 180 / Math.PI;
  return [checked.longitude - lon, checked.latitude - lat, checked.longitude + lon, checked.latitude + lat];
}
