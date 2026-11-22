import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultGazetteSettings, parseGazetteEdition, sampleGazetteEdition, type GazetteEdition, type TimeZoneName } from '@vergissmeinnicht/domain';
import { startTestApp } from './test-harness.ts';

/**
 * The Daily Planet's workspace weather (43.7) end to end. Provider answers are the real ones recorded on
 * 2026-11-15 (packages/weather/src/fixtures), with their dates moved to today so the edition is current.
 */
const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../../../../packages/weather/src/fixtures', name), 'utf8');
const DAY = 86_400_000;
const isoDay = (offset = 0) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const TRIORA = { name: 'Triora', latitude: 43.99, longitude: 7.76, timeZone: 'Europe/Rome', elevation: 780 };
const GOGGENHOFEN = { name: 'Göggenhofen', latitude: 48.22, longitude: 11.04, timeZone: 'Europe/Berlin', elevation: 520 };

function must<T>(value: T | undefined): T { if (value === undefined) throw new Error('missing'); return value; }

type Down = 'open-meteo' | 'brightsky' | 'met' | 'meteoalarm' | 'allerta';

describe('The Daily Planet workspace weather (43.7)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>; let workspace: string; let guest: string;
  let requests: URL[]; let down: Set<Down>; let disagree: boolean; let badRain: boolean;
  const base = () => `/api/workspaces/${workspace}/gazette`;
  const json = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  /** Open-Meteo's recorded answer for the place, its days starting today. */
  function openMeteo(url: URL) {
    const body = JSON.parse(fixture(Number(url.searchParams.get('latitude')) > 46 ? 'gazette-open-meteo-goggenhofen.json' : 'gazette-open-meteo-triora.json')) as { daily: Record<string, (number | string | null)[]> };
    body.daily.time = must(body.daily.time).map((_, index) => isoDay(index));
    if (disagree) for (const [key, values] of Object.entries(body.daily)) if (key.startsWith('precipitation_sum_ecmwf')) body.daily[key] = values.map(() => 30);
    if (badRain) must(body.daily.precipitation_sum_ecmwf_ifs025)[4] = -0.2;
    return json(body);
  }
  const alert = (event: string, severity: string) => ({ id: 1, alert_id: randomUUID(), effective: new Date(Date.now() - DAY / 4).toISOString(), onset: new Date(Date.now() - DAY / 4).toISOString(), expires: new Date(Date.now() + DAY).toISOString(), category: 'met', severity, certainty: 'likely', urgency: 'immediate', event_en: event, headline_en: `Official WARNING of ${event.toUpperCase()}`, description_en: '', status: 'actual' });

  beforeEach(async () => {
    requests = []; down = new Set(); disagree = false; badRain = false;
    t = await startTestApp({ weatherFetch: (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      if (url.host === 'api.open-meteo.com') return down.has('open-meteo') ? json('{"error":true,"reason":"Daily API request limit exceeded"}', 429) : openMeteo(url);
      if (url.host === 'api.met.no') return down.has('met') ? new Response('', { status: 503 }) : json(fixture('met-norway-compact.json'));
      if (url.host === 'api.brightsky.dev') {
        if (down.has('brightsky')) return new Response('', { status: 502 });
        if (url.pathname === '/alerts') return json({ alerts: [alert('fog', 'minor'), alert('storm gusts', 'moderate')], location: null });
        return json({ weather: [], sources: [] });
      }
      if (url.host === 'feeds.meteoalarm.org') return down.has('meteoalarm') ? new Response('', { status: 503 }) : json({ warnings: [] });
      if (url.host === 'allertaliguria.regione.liguria.it') return down.has('allerta') ? new Response('', { status: 503 }) : new Response(fixture('gazette-allerta-liguria.html'), { headers: { 'content-type': 'text/html' } });
      throw new TypeError(`unexpected host ${url.host}`);
    }) as typeof fetch });
    workspace = await t.createWorkspace('Casa Nostra');
    guest = await t.invite('guest@example.org', 'Guest'); await t.addMember(workspace, 'guest@example.org', 'GUEST');
    expect((await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'GAZETTE', enabled: true }, t.admin)).statusCode).toBe(200);
    expect((await t.post(`${base()}/settings`, { settings: defaultGazetteSettings('UTC' as TimeZoneName), expectedRevision: 0 }, t.admin)).statusCode).toBe(200);
  });
  afterEach(() => t.close());

  const setLocation = async (location: unknown) => {
    const current = (await t.get(`/api/workspaces/${workspace}/location`, t.admin)).json().location;
    expect((await t.post(`/api/workspaces/${workspace}/location`, { location, expectedLocation: current }, t.admin)).statusCode).toBe(200);
  };
  /** What the automation sends for weather: only the summary; VMN fills in the rest. */
  const content = (date: string) => {
    const sample = sampleGazetteEdition(date);
    return { ...sample,
      localNotices: [{ kind: 'road_closure', place: 'Triora', text: 'Road closed at the bridge.', source: 'Example road authority', url: 'https://roads.example.org/closure', checkedAt: `${date}T07:00:00.000Z` }],
      sections: sample.sections.map(section => section.type === 'weather' ? { sectionId: section.sectionId, type: 'weather', summary: 'Weather for today.' } : section) };
  };
  const publish = async (date = isoDay(), operationId: string = randomUUID()) => {
    const answer = await t.post(`${base()}/editions`, { operationId, content: content(date), publish: true }, t.admin);
    expect(answer.statusCode, answer.body).toBeLessThan(300);
    return answer.json().edition as GazetteEdition;
  };
  const weatherOf = (edition: GazetteEdition) => must(edition.content.sections.find(section => section.type === 'weather'));
  const placeOf = (weather: ReturnType<typeof weatherOf>) => must(weather.locations?.[0]);

  it('forecasts only the Workspace location, from several sources, and keeps the client summary', async () => {
    await setLocation(TRIORA);
    const edition = await publish();
    expect(edition.content).toMatchObject({ localNotices: [{ kind: 'road_closure', place: 'Triora' }] });
    const weather = weatherOf(edition);
    expect(weather).toMatchObject({ status: 'ok', generatedBy: 'vmn', summary: 'Weather for today.' });
    expect(weather.locations).toHaveLength(1);
    const place = placeOf(weather);
    expect(place.name).toBe('Triora');
    expect(place.days).toHaveLength(7);
    expect(place.days[0]?.date).toBe(isoDay());
    // Days 4–7 are never shown as confident.
    expect(place.days.slice(3).every(day => day.confidence === 'low')).toBe(true);
    const forecast = place.sources.filter(source => source.role === 'forecast');
    expect(forecast.map(source => source.name)).toEqual(expect.arrayContaining(['ItaliaMeteo ARPAE ICON-2I', 'ECMWF IFS', 'DWD ICON-EU']));
    expect(forecast.every(source => typeof source.model === 'string' && typeof source.retrievedAt === 'string')).toBe(true);
    expect(place.models?.length).toBeGreaterThanOrEqual(3);
    // Liguria's official alert level for the zone the town is in (Triora: zone A).
    expect(place.warnings.find(w => w.source === 'AllertaLiguria')?.text).toContain('zone A');
    // Never the other house, and nothing from ChatGPT's own location.
    expect(JSON.stringify(weather)).not.toContain('Göggenhofen');
    expect(requests.every(url => url.host !== 'api.open-meteo.com' || url.searchParams.get('latitude') === '43.99')).toBe(true);
    // Members read it; the edition hash is the client's content, so a retry is still a duplicate.
    expect((await t.get(`${base()}/editions/${isoDay()}`, guest)).json().edition.content.sections.find((s: { type: string }) => s.type === 'weather').locations[0].name).toBe('Triora');
  });

  it('follows a location change in new editions and leaves archived editions alone', async () => {
    await setLocation(TRIORA);
    // Today's edition, then moved to yesterday as the archive would hold it.
    const archived = await publish();
    t.database.sqlite.prepare("UPDATE gazette_editions SET edition_date = ?, content = json_set(content, '$.date', ?) WHERE id = ?").run(isoDay(-1), isoDay(-1), archived.id);
    await setLocation(GOGGENHOFEN);
    const today = weatherOf(await publish());
    expect(placeOf(today).name).toBe('Göggenhofen');
    expect(placeOf(today).sources.map(source => source.name)).toEqual(expect.arrayContaining(['DWD ICON-D2']));
    expect(placeOf(today).warnings.map(w => `${w.level} ${w.text}`)).toEqual(expect.arrayContaining(['yellow Official WARNING of FOG', 'orange Official WARNING of STORM GUSTS']));
    expect(JSON.stringify(today)).not.toContain('Triora');
    // The archived edition keeps its place, also when it is republished after the move.
    const stored = (await t.get(`${base()}/editions/${isoDay(-1)}`, guest)).json().edition;
    expect(stored.content.sections.find((s: { type: string }) => s.type === 'weather').locations[0].name).toBe('Triora');
    const republished = weatherOf(await publish(isoDay(-1)));
    expect(placeOf(republished).name).toBe('Triora');
    expect(republished.summary).toBe('Weather for today.');
  });

  it('says plainly when the Workspace has no location, and fetches nothing', async () => {
    const weather = weatherOf(await publish());
    expect(weather).toMatchObject({ status: 'no_location', locations: [] });
    expect(requests).toEqual([]);
    const view = (await t.get(`${base()}/weather`, guest)).json();
    expect(view.place).toBeNull(); expect(view.result.status).toBe('no_location');
  });

  it('degrades: one provider down is named, all down is unavailable, never invented', async () => {
    await setLocation(GOGGENHOFEN);
    down = new Set(['met', 'brightsky']);
    const partial = weatherOf(await publish());
    expect(partial.status).toBe('ok');
    expect(placeOf(partial).sources.map(source => source.name)).not.toContain('MET Norway');
    expect(JSON.stringify(placeOf(partial))).toMatch(/not available|unavailable|failed|missing/i);
    down = new Set(['open-meteo', 'met', 'brightsky']);
    // Tomorrow's edition asks for another range, so no cached answer helps: nothing is made up.
    const tomorrow = weatherOf(await publish(isoDay(1)));
    expect(tomorrow).toMatchObject({ status: 'unavailable', locations: [], summary: 'Weather for today.' });
  });

  it('shows disagreement between model families as a range instead of a single number', async () => {
    await setLocation(GOGGENHOFEN);
    disagree = true;
    const place = placeOf(weatherOf(await publish()));
    expect(place.days.some(day => typeof day.precipitationMm === 'object' && day.precipitationMm !== null && /disagree on accumulation/.test(day.note ?? ''))).toBe(true);
  });

  it('publishes the original edition with a missing model accumulation and keeps valid peer rain', async () => {
    await setLocation(TRIORA);
    badRain = true;
    down.add('met');
    const date = isoDay();
    const operationId = randomUUID();
    const edition = await publish(date, operationId);
    const weather = weatherOf(edition);
    expect(weather.summary).toBe('Weather for today.');
    const place = placeOf(weather);
    expect(place.days[4]?.precipitationMm).toBe(5.4);
    expect(place.models?.find(model => model.model === 'ecmwf_ifs025')?.days[4]).toMatchObject({
      date: isoDay(4), precipitationMm: null, high: 15.9,
    });
    expect(edition.content.sections.filter(section => section.type !== 'weather')).toEqual(
      parseGazetteEdition(content(date), defaultGazetteSettings('UTC' as TimeZoneName).sections).sections.filter(section => section.type !== 'weather'),
    );
    expect(await publish(date, operationId)).toMatchObject({ id: edition.id, revision: edition.revision });
  });

  it('retries idempotently with the same operation and serves the weather view to members only', async () => {
    await setLocation(TRIORA);
    const operationId = randomUUID();
    const first = await t.post(`${base()}/editions`, { operationId, content: content(isoDay()), publish: true }, t.admin);
    const again = await t.post(`${base()}/editions`, { operationId, content: content(isoDay()), publish: true }, t.admin);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode, again.body).toBe(200); expect(again.json().duplicate).toBe(true);
    const view = await t.get(`${base()}/weather`, guest);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({ date: isoDay(), place: { name: 'Triora' }, plan: { region: 'liguria', alertZone: 'A' } });
    const other = await t.createWorkspace('Van');
    expect((await t.get(`/api/workspaces/${other}/gazette/weather`, guest)).statusCode).toBe(404);
    expect([400, 404]).toContain((await t.get(`${base()}/weather?date=2020-01-01`, guest)).statusCode);
  });

  it('keeps a client-written weather section when automatic weather is off', async () => {
    await setLocation(TRIORA);
    const settings = (await t.get(`${base()}/settings`, t.admin)).json();
    expect((await t.post(`${base()}/settings`, { settings: { ...settings.settings, weather: { automatic: false, sources: [], alertZone: null, learn: true } }, expectedRevision: settings.revision }, t.admin)).statusCode).toBe(200);
    const sample = sampleGazetteEdition(isoDay());
    const edition = (await t.post(`${base()}/editions`, { operationId: randomUUID(), content: sample, publish: true }, t.admin)).json().edition;
    const weather = edition.content.sections.find((s: { type: string }) => s.type === 'weather');
    expect(weather.generatedBy).toBeUndefined();
    expect(weather.locations.map((l: { name: string }) => l.name)).toEqual(['Triora', 'Göggenhofen']);
    expect(requests).toEqual([]);
  });
});
