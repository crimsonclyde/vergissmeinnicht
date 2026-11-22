import { describe, expect, it, vi } from 'vitest';
import { AddressSearchBusy, AddressSearchUnavailable, createAddressSearch } from './address-search.ts';
const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [7.7, 43.9] }, properties: { name: 'Pub', street: 'Via Roma', housenumber: '2', city: 'Soldano', osm_type: 'N', osm_id: 123, type: 'house' } };
const response = () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature] }));
describe('reviewed address search', () => {
  it('uses only the fixed provider, bounded request and isolated cache; returns typed suggestions', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
    const search = createAddressSearch(fetcher);
    const candidates = await search('A', 'Via Roma 2, Soldano');
    expect(candidates).toMatchObject([{ latitude: 43.9, longitude: 7.7, approximate: false, sourceUrl: 'https://www.openstreetmap.org/node/123' }]);
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://photon.komoot.io/api/?q=Via+Roma+2%2C+Soldano&limit=5&lang=en');
    expect(options).toMatchObject({ redirect: 'error', credentials: 'omit' });
    if (candidates[0]) candidates[0].label = 'Changed';
    expect((await search('A', 'Via Roma 2, Soldano'))[0]?.label).not.toBe('Changed');
    await expect(search('B', 'Via Roma 2, Soldano')).rejects.toBeInstanceOf(AddressSearchBusy);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [{ ...feature, geometry: { type: 'Point', coordinates: [7, 91] } }] })),
    () => new Response('x'.repeat(256_001)),
    () => new Response('{}', { status: 302, headers: { location: 'http://localhost/' } }),
    () => new Response('not JSON'),
  ])('refuses malformed, oversized and redirected responses without leaking provider diagnostics', async make => {
    await expect(createAddressSearch(async () => make())('A', 'Soldano')).rejects.toBeInstanceOf(AddressSearchUnavailable);
  });
  it('rejects control characters and oversized queries before any network request', async () => {
    const fetcher = vi.fn<typeof fetch>(); const search = createAddressSearch(fetcher);
    await expect(search('A', 'abc\nsecret')).rejects.toThrow();
    await expect(search('A', 'x'.repeat(361))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
it('admits only one provider request at a time', async () => {
  let release: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const search = createAddressSearch(async () => { await waiting; return response(); });
  const first = search('A', 'Soldano');
  await expect(search('B', 'Triora')).rejects.toBeInstanceOf(AddressSearchBusy);
  release?.(); await first;
});
