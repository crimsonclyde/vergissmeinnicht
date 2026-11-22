import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';

/** Mixed vector layers must be filtered by geometry before fill triangulation. */
export function regionalMapStyle(color: (name: string, fallback: string) => string, glyphsInstalled: boolean, archive: string, glyphRoot: string): StyleSpecification {
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
      { id: 'land', type: 'fill', source: 'region', 'source-layer': 'landuse', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': color('land', '#c7d3b3'), 'fill-opacity': 0.52 } },
      { id: 'wood', type: 'fill', source: 'region', 'source-layer': 'landcover', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': color('land', '#c7d3b3'), 'fill-opacity': 0.5 } },
      { id: 'water', type: 'fill', source: 'region', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': color('water', '#78a4ae') } },
      { id: 'waterways', type: 'line', source: 'region', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'LineString'], paint: {
        'line-color': color('water', '#83aeb7'), 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 14, 1.8],
      } },
      { id: 'buildings', type: 'fill', source: 'region', 'source-layer': 'buildings', minzoom: 13,
        filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': color('building', '#b3ab96'), 'fill-opacity': 0.75 } },
      { id: 'road-casing', type: 'line', source: 'region', 'source-layer': 'roads', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', paths]],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color('road-case', '#f6efdb'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.7, 12, 2.7, 16, 7] } },
      { id: 'roads', type: 'line', source: 'region', 'source-layer': 'roads', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', paths]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color('road', '#9b7e58'), 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 12, 1.2, 16, 5] } },
      { id: 'major-roads', type: 'line', source: 'region', 'source-layer': 'roads', filter: ['all', ['==', ['geometry-type'], 'LineString'],
        ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
          'line-color': color('major-road', '#c3954c'), 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 12, 2.2, 16, 6] } },
      { id: 'trails', type: 'line', source: 'region', 'source-layer': 'roads', filter: ['all', ['==', ['geometry-type'], 'LineString'], paths], paint: { 'line-color': color('trail', '#665945'), 'line-dasharray': [2, 3], 'line-width': 1.2 } },
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
