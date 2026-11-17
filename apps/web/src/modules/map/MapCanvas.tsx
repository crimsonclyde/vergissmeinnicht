import { useEffect, useRef, useState } from 'react';
import { addProtocol, Map as Atlas, Marker, setWorkerUrl, type FilterSpecification, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { PMTiles, Protocol } from 'pmtiles';
import type { MapPlace, MapPoint } from '@vergissmeinnicht/domain';
import { t } from '../../i18n/index.ts';
import 'maplibre-gl/dist/maplibre-gl.css';

const protocol = new Protocol();
setWorkerUrl(workerUrl);
function validResource(url: string): boolean {
  const parsed = new URL(url, window.location.origin);
  return parsed.origin === window.location.origin && /^\/map-assets\/(?:managed\/[0-9a-f-]{36}\/)?(?:region\.pmtiles|fonts\/Noto(?:%20| )Sans(?:%20| )Regular\/(?:\{range\}|\d+-\d+)\.pbf)$/.test(parsed.pathname);
}
addProtocol('pmtiles', async (request, controller) => {
  const value = request.url.slice('pmtiles://'.length);
  const archiveUrl = value.replace(/\/\d+\/\d+\/\d+$/, '');
  if (!request.url.startsWith('pmtiles://') || !validResource(archiveUrl) || !archiveUrl.endsWith('/region.pmtiles')) throw new Error('Unexpected Map tile request');
  const result = await protocol.tilev4(request, controller);
  if (result.data === null || typeof result.data !== 'object') throw new Error('Invalid Map resource');
  return { data: result.data, cacheControl: result.cacheControl ?? null, expires: result.expires ?? null };
});
const LIMIT = 85.05112878;
const tileLatitude = (latitude: number) => Math.max(-LIMIT, Math.min(LIMIT, latitude));
type Position = [longitude: number, latitude: number];
export interface Viewport { center: Position; zoom: number }
interface Props {
  places: MapPlace[]; selected: string; active: boolean; viewport: Viewport;
  focus: MapPoint | null; pick: boolean; onSelect: (id: string) => void;
  onDrop: (longitude: number, latitude: number) => void;
  onMove: (viewport: Viewport, bounds: string) => void;
}

function cartography(element: HTMLElement, glyphsInstalled: boolean, archive: string, glyphRoot: string): StyleSpecification {
  const token = getComputedStyle(element);
  const color = (name: string, fallback: string) => token.getPropertyValue('--map-' + name).trim() || fallback;
  const paths: FilterSpecification = ['any',
    ['in', ['coalesce', ['get', 'kind_detail'], ['get', 'pmap:kind_detail'], ''], ['literal', ['path', 'track', 'pedestrian', 'bridleway', 'steps']]],
    ['==', ['coalesce', ['get', 'kind'], ['get', 'pmap:kind'], ''], 'path'],
  ];
  return {
    version: 8,
    ...(glyphsInstalled ? { glyphs: glyphRoot + '{fontstack}/{range}.pbf' } : {}),
    sources: { region: { type: 'vector', url: 'pmtiles://' + archive, attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>' + (glyphsInstalled ? ' · <a href="' + glyphRoot + 'OFL.txt" target="_blank" rel="noreferrer">Noto Sans license</a>' : '') } },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-color': color('paper', '#e5e9d6') } },
      { id: 'land', type: 'fill', source: 'region', 'source-layer': 'landuse', paint: { 'fill-color': color('land', '#c7d3b3'), 'fill-opacity': 0.52 } },
      { id: 'wood', type: 'fill', source: 'region', 'source-layer': 'landcover', paint: { 'fill-color': color('land', '#c7d3b3'), 'fill-opacity': 0.5 } },
      { id: 'water', type: 'fill', source: 'region', 'source-layer': 'water', paint: { 'fill-color': color('water', '#78a4ae') } },
      { id: 'roads', type: 'line', source: 'region', 'source-layer': 'roads', filter: ['!', paths], paint: { 'line-color': color('road', '#9b7e58'), 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.35, 14, 1.65] } },
      { id: 'trails', type: 'line', source: 'region', 'source-layer': 'roads', filter: paths, paint: { 'line-color': color('trail', '#665945'), 'line-dasharray': [2, 3], 'line-width': 1.2 } },
      ...(glyphsInstalled ? [{ id: 'localities', type: 'symbol' as const, source: 'region', 'source-layer': 'places', minzoom: 7, layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''], 'text-font': ['Noto Sans Regular'], 'text-size': 13,
      }, paint: { 'text-color': color('ink', '#283c33'), 'text-halo-color': color('paper', '#e5e9d6'), 'text-halo-width': 1.5 } },
      { id: 'road-names', type: 'symbol', source: 'region', 'source-layer': 'roads', minzoom: 13, filter: ['has', 'name'], layout: {
        'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11,
      }, paint: { 'text-color': color('ink', '#283c33'), 'text-halo-color': color('paper', '#e5e9d6'), 'text-halo-width': 1.5 } },
      ] satisfies StyleSpecification['layers'] : []),
    ],
  };
}

interface MarkerGroup { point: MapPoint; places: MapPlace[] }
function markerGroups(map: Atlas, places: MapPlace[]) {
  const shared = new Map<string, MarkerGroup>();
  for (const place of places) {
    for (const point of place.points) {
      const existing = shared.get(point.id);
      if (existing) {
        if (!existing.places.some(entry => entry.id === place.id)) existing.places.push(place);
      } else shared.set(point.id, { point, places: [place] });
    }
  }
  const cells = new Map<string, MarkerGroup[]>();
  for (const item of shared.values()) {
    const projected = map.project([item.point.longitude, tileLatitude(item.point.latitude)]);
    const key = map.getZoom() < 12 ? `${Math.round(projected.x / 46)}:${Math.round(projected.y / 46)}` : item.point.id;
    const cell = cells.get(key);
    if (cell) cell.push(item);
    else cells.set(key, [item]);
  }
  return [...cells.values()];
}

export function MapCanvas(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Atlas | null>(null);
  const home = useRef<Viewport>(props.viewport);
  const callbacks = useRef(props);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [shared, setShared] = useState<MapPlace[]>([]);
  const [markerRevision, setMarkerRevision] = useState(0);
  useEffect(() => { callbacks.current = props; }, [props]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let active = true;
    const controller = new AbortController();
    let atlas: Atlas | null = null;
    let theme: MutationObserver | undefined;
    function moved() {
      if (!atlas) return;
      const center = atlas.getCenter().wrap();
      const box = atlas.getBounds();
      const west = box.getWest();
      const east = box.getEast();
      const wrap = (angle: number) => (angle + 540) % 360 - 180;
      const longitudes = east - west >= 360 ? [-180, 180] : [wrap(west), wrap(east)];
      const bounds = [Math.max(-90, box.getSouth()), Math.min(90, box.getNorth()), ...longitudes].join(',');
      callbacks.current.onMove({ center: [center.lng, center.lat], zoom: atlas.getZoom() }, bounds);
      setMarkerRevision(current => current + 1);
    }
    const elementForMap = element;
    async function initialize() {
      const element = elementForMap;
      const config = await fetch('/map-assets/current.json', { credentials: 'same-origin', redirect: 'error', signal: controller.signal })
        .then(async response => response.ok ? await response.json() as { archive: string; glyphRoot: string } : null);
      const archive = new URL(config?.archive ?? '/map-assets/region.pmtiles', window.location.origin).href;
      const glyphRoot = new URL(config?.glyphRoot ?? '/map-assets/fonts/', window.location.origin).href;
      if (!validResource(archive) || !validResource(glyphRoot + 'Noto%20Sans%20Regular/0-255.pbf')) throw new Error('Unexpected Map resource');
      const tiles = new PMTiles(archive); protocol.add(tiles);
      const header = await tiles.getHeader();
      const glyphsInstalled = await fetch(glyphRoot + 'Noto%20Sans%20Regular/0-255.pbf', {
        method: 'HEAD', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
      }).then(response => response.ok).catch(() => false);
      if (!active) return;
      // PMTiles directory, format and coverage are checked before allocating the WebGL context.
      if (header.tileType !== 1) throw new Error('A vector PMTiles archive is required');
      const { viewport } = callbacks.current;
      const coverage = viewport.zoom < 5 ? {
        center: [header.centerLon, tileLatitude(header.centerLat)] as Position,
        zoom: Math.max(2, Math.min(18, header.centerZoom)),
      } : viewport;
      home.current = coverage;
      atlas = new Atlas({
        container: element, style: cartography(element, glyphsInstalled, archive, glyphRoot), center: coverage.center, zoom: coverage.zoom, minZoom: 2, maxZoom: 18,
        dragRotate: false, pitchWithRotate: false,
        transformRequest(url) {
          if (url.startsWith('pmtiles://')) return { url };
          const parsed = new URL(url, window.location.origin);
          if (!validResource(parsed.href)) throw new Error('Unexpected Map resource');
          return { url: parsed.href };
        },
      });
      map.current = atlas;
      theme = new MutationObserver(() => atlas?.setStyle(cartography(element, glyphsInstalled, archive, glyphRoot)));
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-scheme'] });
      atlas.on('load', () => { if (active) { setReady(true); moved(); } });
      atlas.on('error', event => {
        if (active && (!atlas?.isStyleLoaded() || /pmtiles|archive|range|tile/i.test(event.error.message))) setUnavailable(true);
      });
      atlas.on('moveend', moved);
      atlas.on('click', event => {
        if (callbacks.current.pick) callbacks.current.onDrop(event.lngLat.wrap().lng, event.lngLat.lat);
      });
    }
    void initialize().catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; controller.abort(); map.current = null; theme?.disconnect(); atlas?.remove(); };
  }, []);
  useEffect(() => {
    if (!props.active || !ready) return;
    const frame = requestAnimationFrame(() => map.current?.resize());
    return () => cancelAnimationFrame(frame);
  }, [props.active, ready]);
  useEffect(() => {
    const point = props.focus;
    if (ready && point) map.current?.jumpTo({ center: [point.longitude, tileLatitude(point.latitude)], zoom: Math.max(13, map.current.getZoom()) });
  }, [props.focus, ready]);
  useEffect(() => {
    const atlas = map.current;
    if (!ready || !atlas || unavailable) return;
    const markers: Marker[] = [];
    for (const cluster of markerGroups(atlas, props.places)) {
      const first = cluster[0];
      const firstPlace = first?.places[0];
      if (!first || !firstPlace) continue;
      const { point } = first;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'vmn-map-pin';
      el.dataset.role = point.role;
      el.dataset.precision = point.precision;
      const selected = cluster.some(item => item.places.some(place => place.id === props.selected));
      el.setAttribute('aria-pressed', String(selected));
      el.setAttribute('aria-label', cluster.length > 1 ? t('map.cluster', { count: cluster.length })
        : t('map.marker', { name: first.places.length > 1 ? point.label : firstPlace.name,
          role: t(`map.role.${point.role}`), precision: t(`map.precision.${point.precision}`) }));
      el.textContent = cluster.length > 1 ? String(cluster.length) : point.role === 'destination' ? '◆' : point.role === 'parking' ? 'P' : '▲';
      el.onclick = event => {
        event.stopPropagation();
        if (cluster.length > 1) atlas.jumpTo({ center: [point.longitude, tileLatitude(point.latitude)], zoom: Math.max(12, atlas.getZoom() + 2) });
        else if (first.places.length > 1) setShared(first.places);
        else callbacks.current.onSelect(firstPlace.id);
      };
      markers.push(new Marker({ element: el }).setLngLat([point.longitude, tileLatitude(point.latitude)]).addTo(atlas));
    }
    return () => { for (const marker of markers) marker.remove(); };
  }, [ready, unavailable, markerRevision, props.places, props.selected]);
  return <>
    <div className="vmn-map-atlas">
      <div ref={container} className="vmn-map-canvas" aria-label={t('map.navigation')} hidden={unavailable} />
      {unavailable ? <p className="vmn-map-fallback" role="status">{t('map.tilesUnavailable')}</p>
        : ready ? <div className="vmn-map-zoom">
          <button type="button" aria-label={t('map.zoomIn')} onClick={() => map.current?.zoomIn({ duration: 0 })}>+</button>
          <button type="button" aria-label={t('map.zoomOut')} onClick={() => map.current?.zoomOut({ duration: 0 })}>−</button>
          <button type="button" onClick={() => map.current?.jumpTo(home.current)}>{t('map.recenter')}</button>
        </div> : <p className="vmn-map-fallback" role="status">{t('map.loading')}</p>}
    </div>
    {shared.length > 0 && <section className="card vmn-map-shared">
      <strong>{t('map.sharedPoint')}</strong>
      {shared.map(place => <button type="button" key={place.id} onClick={() => { props.onSelect(place.id); setShared([]); }}>{place.name}</button>)}
      <button type="button" onClick={() => setShared([])}>{t('common.close')}</button>
    </section>}
  </>;
}
