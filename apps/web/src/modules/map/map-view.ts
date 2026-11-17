import { parseMapPlace, type MapPlace, type MapPoint } from '@vergissmeinnicht/domain';
import { t } from '../../i18n/index.ts';
import type { UiIconName } from '../../ui-icons.tsx';

export const categoryIcon: Record<MapPlace['category'], UiIconName> = {
  food: 'grocery', shopping: 'lists', historic: 'history', urbex: 'house', trailhead: 'gazetteMap', other: 'place',
};
export const pointLabel = (point: MapPoint) => t(`map.role.${point.role}`);
const decimal = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 15 });
export const coordinate = (point: Pick<MapPoint, 'latitude' | 'longitude'>) =>
  `${decimal.format(point.latitude)}, ${decimal.format(point.longitude)}`;
export const preferredPoint = (place: MapPlace) => place.points.find(point => point.preferred)
  ?? place.points.find(point => point.role === 'destination' && point.precision === 'exact')
  ?? place.points.find(point => point.precision === 'exact')
  ?? place.points[0];
export function direction(place: MapPlace) {
  const point = preferredPoint(place);
  if (point?.precision === 'approximate') {
    const url = new URL('https://www.google.com/maps/@');
    url.searchParams.set('api', '1');
    url.searchParams.set('map_action', 'map');
    url.searchParams.set('center', coordinate(point));
    url.searchParams.set('zoom', '14');
    return { url: url.href, label: t('map.viewArea') };
  }
  if (point) {
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('destination', coordinate(point));
    return { url: url.href, label: t(`map.go.${point.role}`) };
  }
  if (place.details.address) {
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('destination', place.details.address);
    if (place.details.externalId) url.searchParams.set('destination_place_id', place.details.externalId);
    return { url: url.href, label: t('map.go.destination') };
  }
  return place.details.originalUrl ? { url: place.details.originalUrl, label: t('map.originalLink') } : null;
}
export const editDraft = (place: MapPlace | null) => place ? {
  name: place.name, category: place.category, details: place.details, coverId: place.coverId, approachId: place.sharedApproach?.id ?? null, tagIds: place.tags.map(tag => tag.id),
  points: place.points.map(({ id, role, preferred }) => ({ pointId: id, role, preferred })),
} : parseMapPlace({ name: 'Place' });
export function parsePair(value: string): { latitude: number; longitude: number } | null {
  const pair = value.split(',').map(part => part.trim());
  if (pair.length !== 2 || !pair.every(part => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(part))) return null;
  const latitude = Number(pair[0]);
  const longitude = Number(pair[1]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}
