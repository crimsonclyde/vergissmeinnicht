import { createHash, randomUUID } from 'node:crypto';
import {
  AttachmentError, MapConflictError, MapMatchError, MapNotFoundError, MapOperationReusedError, NotAuthorizedError, editableMapPlace, type MapContext, type MapQuery, type MapRepository,
} from '@vergissmeinnicht/application';
import { EMPTY_MAP_PERSONAL_STATE, parseMapPlace, type MapPlace, type MapPlaceInput } from '@vergissmeinnicht/domain';
import { roleHasCapability, type WorkspaceCapability } from '@vergissmeinnicht/permissions';
import { and, asc, desc, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import { attachmentView, type AttachmentConsumerPolicy } from './attachment-repository.ts';
import { currentDelegation } from './delegation-context.ts';
import { actorAllowed, IMMEDIATE, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { attachments, mapApproaches, mapVisitPhotos, mapOperations, mapPersonal, mapPlacePoints, mapPlaces, mapPlaceTags, mapPoints, mapTags, mapVisits } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

type Reader = Pick<Transaction, 'select'>;
type PlaceRow = typeof mapPlaces.$inferSelect;
const PAGE_SIZE = 30;
const RECEIPT_MS = 3 * 86_400_000;
const userActor = (actor: MapContext['actor']) => ({ kind: 'user' as const, userId: actor.id, displayName: actor.displayName });
const key = (value: string) => value.normalize('NFKC').toLowerCase();

function guard(tx: Transaction, context: MapContext, capability: WorkspaceCapability) {
  if (!actorAllowed(tx, context.workspaceId, userActor(context.actor), { tool: 'MAP', actorMay: role => roleHasCapability(role, capability) })) {
    throw new NotAuthorizedError();
  }
}
function placeRow(tx: Reader, workspaceId: string, id: string, includeArchived = false) {
  const row = tx.select().from(mapPlaces).where(and(eq(mapPlaces.workspaceId, workspaceId), eq(mapPlaces.id, id),
    includeArchived ? undefined : eq(mapPlaces.archived, false))).get();
  if (!row) throw new MapNotFoundError();
  return row;
}

function placeViews(tx: Reader, workspaceId: string, rows: PlaceRow[]): MapPlace[] {
  if (rows.length === 0) return [];
  const ids = rows.map(row => row.id);
  const points = tx.select({
    placeId: mapPlacePoints.placeId, id: mapPoints.id, role: mapPlacePoints.role, preferred: mapPlacePoints.preferred,
    label: mapPoints.label, latitude: mapPoints.latitude, longitude: mapPoints.longitude, precision: mapPoints.precision, provenance: mapPoints.provenance,
  }).from(mapPlacePoints).innerJoin(mapPoints, and(eq(mapPoints.workspaceId, mapPlacePoints.workspaceId), eq(mapPoints.id, mapPlacePoints.pointId)))
    .where(and(eq(mapPlacePoints.workspaceId, workspaceId), inArray(mapPlacePoints.placeId, ids))).orderBy(asc(mapPlacePoints.role), asc(mapPoints.label), asc(mapPoints.id)).all();
  const tags = tx.select({ placeId: mapPlaceTags.placeId, id: mapTags.id, name: mapTags.name }).from(mapPlaceTags)
    .innerJoin(mapTags, and(eq(mapTags.workspaceId, mapPlaceTags.workspaceId), eq(mapTags.id, mapPlaceTags.tagId)))
    .where(and(eq(mapPlaceTags.workspaceId, workspaceId), inArray(mapPlaceTags.placeId, ids))).orderBy(asc(mapTags.nameKey)).all();
  const approachIds = rows.flatMap(row => row.approachId ? [row.approachId] : []);
  const approaches = approachIds.length ? tx.select().from(mapApproaches).where(and(eq(mapApproaches.workspaceId, workspaceId), inArray(mapApproaches.id, approachIds))).all() : [];
  return rows.map(row => ({
    sharedApproach: approaches.filter(approach => approach.id === row.approachId).map(({ id, details }) => ({ id, ...details }))[0] ?? null,
    id: row.id, name: row.name, coverId: row.coverId, category: row.category, details: row.details, revision: row.revision, archived: row.archived,
    points: points.filter(point => point.placeId === row.id).map(({ id, role, preferred, label, latitude, longitude, precision, provenance }) => ({ id, role, preferred, label, latitude, longitude, precision, provenance })),
    tags: tags.filter(tag => tag.placeId === row.id).map(({ id, name }) => ({ id, name })),
  }));
}

function identity(input: MapPlaceInput): string | null {
  if (input.details.externalId) return 'google:' + input.details.externalId;
  if (!input.details.originalUrl) return null;
  const url = new URL(input.details.originalUrl);
  if (url.hostname === 'maps.app.goo.gl' && /^\/[A-Za-z0-9]+\/?$/.test(url.pathname)) {
    return 'maps-link:' + url.pathname.replace(/\/$/, '');
  }
  if ((url.hostname === 'www.google.com' || url.hostname === 'google.com') && /^\/maps(?:\/|$)/.test(url.pathname)) {
    const providerId = url.searchParams.get('query_place_id') ?? /^place_id:([A-Za-z0-9_-]+)$/.exec(url.searchParams.get('q') ?? '')?.[1];
    if (providerId && /^[A-Za-z0-9_-]{3,256}$/.test(providerId)) return 'google:' + providerId;
    const cid = url.searchParams.get('cid');
    if (cid && /^\d{1,24}$/.test(cid)) return 'google-cid:' + cid;
  }
  return null;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, entry: unknown) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
})).digest('hex');

function matchPlaces(tx: Reader, context: MapContext, input: MapPlaceInput, includeArchived = false) {
  const lookup = identity(input);
  const local = eq(mapPlaces.workspaceId, context.workspaceId);
  const exact = lookup ? tx.select({ id: mapPlaces.id }).from(mapPlaces)
    .where(and(local, eq(mapPlaces.identity, lookup), includeArchived ? undefined : eq(mapPlaces.archived, false))).get()?.id ?? null : null;
  const candidates = tx.select().from(mapPlaces).where(and(local, eq(mapPlaces.archived, false),
    sql`lower(${mapPlaces.name}) = lower(${input.name})`)).limit(30).all();
  const destination = input.points.find(point => point.role === 'destination')?.newPoint;
  const possible = placeViews(tx, context.workspaceId, candidates).filter(place => place.id !== exact && (
    (input.details.locality && key(place.details.locality) === key(input.details.locality))
    || (destination && place.points.some(point => point.role === 'destination' &&
      Math.abs(point.latitude - destination.latitude) < .005 && Math.abs(point.longitude - destination.longitude) < .005))
  )).map(place => place.id);
  return { exact, possible };
}

function mergeDefined<T extends object>(base: T, patch: object): T {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  return { ...base, ...Object.fromEntries(entries) };
}
function attachPoints(tx: Transaction, workspaceId: string, placeId: string, points: MapPlaceInput['points']) {
  const linked = new Set<string>();
  for (const point of points) {
    const id = point.pointId ?? randomUUID();
    if (point.newPoint) tx.insert(mapPoints).values({ ...point.newPoint, workspaceId, id }).run();
    else if (!tx.select({ id: mapPoints.id }).from(mapPoints).where(and(eq(mapPoints.workspaceId, workspaceId), eq(mapPoints.id, id))).get()) throw new MapNotFoundError();
    const identity = id + ':' + point.role;
    if (linked.has(identity)) throw new MapConflictError();
    linked.add(identity);
    tx.insert(mapPlacePoints).values({ workspaceId, placeId, pointId: id, role: point.role, preferred: point.preferred }).run();
  }
}
function attachTags(tx: Transaction, workspaceId: string, placeId: string, ids: string[]) {
  if (!ids.length) return;
  const tags = tx.select({ id: mapTags.id }).from(mapTags).where(and(eq(mapTags.workspaceId, workspaceId), inArray(mapTags.id, ids))).all();
  if (tags.length !== ids.length) throw new MapNotFoundError();
  tx.insert(mapPlaceTags).values(ids.map(tagId => ({ workspaceId, placeId, tagId }))).run();
}
function ownPlace(context: MapContext, id: string) {
  return and(eq(mapPersonal.workspaceId, context.workspaceId), eq(mapPersonal.placeId, id), eq(mapPersonal.userId, context.actor.id));
}
function visitScope(context: MapContext, id: string) {
  return and(eq(mapVisits.workspaceId, context.workspaceId), eq(mapVisits.placeId, id), eq(mapVisits.userId, context.actor.id));
}
function ownState(tx: Reader, context: MapContext, id: string) {
  placeRow(tx, context.workspaceId, id);
  const state = tx.select({ favorite: mapPersonal.favorite, want: mapPersonal.want }).from(mapPersonal).where(ownPlace(context, id)).get();
  const visits = tx.select({ id: mapVisits.id, date: mapVisits.date, note: mapVisits.note, rating: mapVisits.rating }).from(mapVisits)
    .where(visitScope(context, id)).orderBy(desc(mapVisits.createdAt), desc(mapVisits.id)).limit(100).all();
  const photos = visits.length ? tx.select({ visitId: mapVisitPhotos.visitId, id: mapVisitPhotos.attachmentId }).from(mapVisitPhotos).where(and(
    eq(mapVisitPhotos.workspaceId, context.workspaceId), eq(mapVisitPhotos.userId, context.actor.id),
    inArray(mapVisitPhotos.visitId, visits.map(visit => visit.id)))).orderBy(asc(mapVisitPhotos.attachmentId)).all() : [];
  return { ...(state ?? EMPTY_MAP_PERSONAL_STATE), visits: visits.map(visit => ({ ...visit, photoIds: photos.filter(photo => photo.visitId === visit.id).map(photo => photo.id) })) };
}
function queryCondition(tx: Reader, context: MapContext, query: MapQuery) {
  const { workspaceId, actor } = context;
  const tag = tx.select({ id: mapPlaceTags.placeId }).from(mapPlaceTags)
    .where(and(eq(mapPlaceTags.workspaceId, workspaceId), eq(mapPlaceTags.tagId, query.tagId ?? '')));
  const tagNames = tx.select({ id: mapPlaceTags.placeId }).from(mapPlaceTags)
    .innerJoin(mapTags, and(eq(mapTags.workspaceId, mapPlaceTags.workspaceId), eq(mapTags.id, mapPlaceTags.tagId)))
    .where(and(eq(mapPlaceTags.workspaceId, workspaceId), sql`instr(lower(${mapTags.name}), ${query.search ?? ''}) > 0`));
  const personal = tx.select({ id: mapPersonal.placeId }).from(mapPersonal)
    .where(and(eq(mapPersonal.workspaceId, workspaceId), eq(mapPersonal.userId, actor.id), query.favorite ? eq(mapPersonal.favorite, true) : undefined, query.want ? eq(mapPersonal.want, true) : undefined));
  const bounds = query.bounds;
  const markers = bounds ? tx.select({ id: mapPlacePoints.placeId }).from(mapPlacePoints).innerJoin(mapPoints,
    and(eq(mapPoints.workspaceId, mapPlacePoints.workspaceId), eq(mapPoints.id, mapPlacePoints.pointId)))
    .where(and(eq(mapPlacePoints.workspaceId, workspaceId), gte(mapPoints.latitude, bounds.south), lte(mapPoints.latitude, bounds.north),
      bounds.east >= bounds.west ? and(gte(mapPoints.longitude, bounds.west), lte(mapPoints.longitude, bounds.east))
        : or(gte(mapPoints.longitude, bounds.west), lte(mapPoints.longitude, bounds.east)))) : null;
  return and(eq(mapPlaces.workspaceId, workspaceId), eq(mapPlaces.archived, query.archived ?? false),
    query.town ? sql`json_extract(${mapPlaces.details}, '$.locality') = ${query.town}` : undefined,
    query.category ? eq(mapPlaces.category, query.category) : undefined,
    query.tagId ? inArray(mapPlaces.id, tag) : undefined,
    query.favorite || query.want ? inArray(mapPlaces.id, personal) : undefined,
    markers ? inArray(mapPlaces.id, markers) : undefined,
    query.search ? or(sql`instr(lower(${mapPlaces.name}), ${query.search}) > 0`,
      sql`instr(lower(json_extract(${mapPlaces.details}, '$.locality')), ${query.search}) > 0`, inArray(mapPlaces.id, tagNames)) : undefined);
}

export function createMapRepository({ db }: AppDatabase): MapRepository {
  return {
    async browse(context, query) {
      return db.transaction(tx => {
        guard(tx, context, query.archived ? 'map.edit' : query.favorite || query.want ? 'map.visit' : 'map.view');
        const offset = query.offset ?? 0;
        const rows = tx.select().from(mapPlaces).where(queryCondition(tx, context, { ...query, search: query.search?.trim().toLowerCase() ?? '' }))
          .orderBy(asc(mapPlaces.name), asc(mapPlaces.id)).limit(PAGE_SIZE + 1).offset(offset).all();
        const tags = tx.select({ id: mapTags.id, name: mapTags.name }).from(mapTags).where(eq(mapTags.workspaceId, context.workspaceId)).orderBy(asc(mapTags.nameKey)).all();
        const locality = sql<string>`json_extract(${mapPlaces.details}, '$.locality')`;
        const towns = tx.selectDistinct({ locality }).from(mapPlaces).where(and(eq(mapPlaces.workspaceId, context.workspaceId),
          eq(mapPlaces.archived, query.archived ?? false), sql`${locality} != ''`)).orderBy(asc(locality)).limit(400).all().map(row => row.locality);
        const name = sql<string>`json_extract(${mapApproaches.details}, '$.name')`;
        const approaches = tx.select({ id: mapApproaches.id, name }).from(mapApproaches).where(eq(mapApproaches.workspaceId, context.workspaceId))
          .orderBy(asc(name)).limit(500).all();
        const reusable = tx.select({ id: mapPlacePoints.pointId }).from(mapPlacePoints).innerJoin(mapPlaces,
          and(eq(mapPlaces.id, mapPlacePoints.placeId), eq(mapPlaces.workspaceId, mapPlacePoints.workspaceId)))
          .where(and(eq(mapPlacePoints.workspaceId, context.workspaceId), ne(mapPlacePoints.role, 'destination'), eq(mapPlaces.archived, false)));
        const sharedPoints = tx.select({ id: mapPoints.id, label: mapPoints.label, latitude: mapPoints.latitude, longitude: mapPoints.longitude,
          precision: mapPoints.precision, provenance: mapPoints.provenance }).from(mapPoints)
          .where(and(eq(mapPoints.workspaceId, context.workspaceId), inArray(mapPoints.id, reusable))).orderBy(asc(mapPoints.label)).limit(200).all();
        return { places: placeViews(tx, context.workspaceId, rows.slice(0, PAGE_SIZE)), tags, towns, approaches, sharedPoints, nextOffset: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null };
      });
    },
    async get(context, id, includeArchived) {
      return db.transaction(tx => {
        guard(tx, context, includeArchived ? 'map.edit' : 'map.view');
        const [place] = placeViews(tx, context.workspaceId, [placeRow(tx, context.workspaceId, id, includeArchived)]);
        if (!place) throw new MapNotFoundError();
        return place;
      });
    },
    async lookup(context, input) {
      return db.transaction(tx => {
        guard(tx, context, 'map.view');
        return matchPlaces(tx, context, input);
      });
    },
    async write(context, raw, operationId, at, change, checkMatches) {
      return db.transaction(tx => {
        guard(tx, context, 'map.edit');
        const { workspaceId, actor } = context;
        const payloadHash = hash([raw, change ?? null, checkMatches ?? false]);
        const receipt = tx.select().from(mapOperations).where(and(eq(mapOperations.workspaceId, workspaceId),
          eq(mapOperations.userId, actor.id), eq(mapOperations.id, operationId))).get();
        if (receipt) {
          if (receipt.hash !== payloadHash) throw new MapOperationReusedError();
          return { id: receipt.placeId, duplicate: true };
        }
        const current = change ? placeRow(tx, workspaceId, change.id, true) : null;
        if (current && current.revision !== change?.revision) throw new MapConflictError();
        const [view] = current && change?.patch ? placeViews(tx, workspaceId, [current]) : [];
        const base = view ? editableMapPlace(view) : null;
        const patchedDetails = raw.details && typeof raw.details === 'object' ? raw.details : {};
        const input = base ? parseMapPlace({ ...mergeDefined(base, raw), details: mergeDefined(base.details, patchedDetails) }) : parseMapPlace(raw);
        if (!current && checkMatches) {
          const matches = matchPlaces(tx, context, input, true);
          if (matches.exact) throw new MapMatchError('exact');
          if (matches.possible.length) throw new MapMatchError('possible');
        }
        const id = current?.id ?? randomUUID();
        const unique = identity(input);
        if (unique && tx.select({ id: mapPlaces.id }).from(mapPlaces)
          .where(and(eq(mapPlaces.workspaceId, workspaceId), eq(mapPlaces.identity, unique), ne(mapPlaces.id, id))).get()) throw new MapConflictError();
        if (input.coverId !== (current?.coverId ?? null) && currentDelegation()) throw new NotAuthorizedError();
        if (input.coverId && input.coverId !== current?.coverId && !fileForUser(tx, context, input.coverId, 'map_cover')) {
          throw new AttachmentError('attachment_not_found');
        }
        if (input.approachId && !tx.select({ id: mapApproaches.id }).from(mapApproaches)
          .where(and(eq(mapApproaches.workspaceId, workspaceId), eq(mapApproaches.id, input.approachId))).get()) throw new MapNotFoundError();
        const revision = (current?.revision ?? 0) + 1;
        const place = { name: input.name, category: input.category, details: input.details, identity: unique, coverId: input.coverId, approachId: input.approachId,
          revision, archived: change?.archived ?? current?.archived ?? false, updatedBy: actor.id, updatedAt: at };
        if (current) {
          tx.update(mapPlaces).set(place).where(and(eq(mapPlaces.workspaceId, workspaceId), eq(mapPlaces.id, id))).run();
          tx.delete(mapPlacePoints).where(and(eq(mapPlacePoints.workspaceId, workspaceId), eq(mapPlacePoints.placeId, id))).run();
          tx.delete(mapPlaceTags).where(and(eq(mapPlaceTags.workspaceId, workspaceId), eq(mapPlaceTags.placeId, id))).run();
        } else {
          tx.insert(mapPlaces).values({ ...place, id, workspaceId, createdBy: actor.id, createdAt: at }).run();
        }
        attachPoints(tx, workspaceId, id, input.points);
        attachTags(tx, workspaceId, id, input.tagIds);
        tx.delete(mapPoints).where(and(eq(mapPoints.workspaceId, workspaceId), sql`not exists (select 1 from ${mapPlacePoints}
          where ${mapPlacePoints.workspaceId} = ${workspaceId} and ${mapPlacePoints.pointId} = ${mapPoints.id})`)).run();
        tx.delete(mapOperations).where(and(eq(mapOperations.workspaceId, workspaceId),
          lt(mapOperations.at, new Date(at.getTime() - RECEIPT_MS)))).run();
        tx.insert(mapOperations).values({ id: operationId, workspaceId, userId: actor.id, placeId: id, hash: payloadHash, at }).run();
        recordSecurityEvent(tx, { type: 'MAP_PLACE_CHANGED', actor: userActor(actor), subjectType: 'workspace', subjectId: workspaceId,
          occurredAt: at, metadata: { placeId: id, revision, archived: place.archived } });
        return { id, duplicate: false };
      }, IMMEDIATE);
    },
    async tag(context, name, id, at) {
      return db.transaction(tx => {
        guard(tx, context, 'map.taxonomy');
        const { workspaceId, actor } = context;
        const nameKey = key(name);
        if (tx.select({ id: mapTags.id }).from(mapTags).where(and(eq(mapTags.workspaceId, workspaceId), eq(mapTags.nameKey, nameKey),
          id ? ne(mapTags.id, id) : undefined)).get()) throw new MapConflictError();
        if (id) {
          const result = tx.update(mapTags).set({ name, nameKey }).where(and(eq(mapTags.workspaceId, workspaceId), eq(mapTags.id, id))).run();
          if (!result.changes) throw new MapNotFoundError();
        } else {
          const tags = tx.select({ id: mapTags.id }).from(mapTags).where(eq(mapTags.workspaceId, workspaceId)).limit(250).all();
          if (tags.length === 250) throw new MapConflictError();
          id = randomUUID();
          tx.insert(mapTags).values({ id, workspaceId, name, nameKey }).run();
        }
        recordSecurityEvent(tx, { type: 'MAP_TAG_CHANGED', actor: userActor(actor), subjectType: 'workspace', subjectId: workspaceId,
          occurredAt: at, metadata: { tagId: id } });
        return { id, name };
      }, IMMEDIATE);
    },
    async addApproach(context, input, at) {
      return db.transaction(tx => {
        guard(tx, context, 'map.edit');
        const { workspaceId, actor } = context;
        const scope = eq(mapApproaches.workspaceId, workspaceId);
        const rows = tx.select().from(mapApproaches).where(scope).limit(500).all();
        const prior = rows.find(row => JSON.stringify(row.details) === JSON.stringify(input));
        if (prior) return { id: prior.id, ...prior.details };
        if (rows.length === 500) throw new MapConflictError();
        const id = randomUUID();
        tx.insert(mapApproaches).values({ id, workspaceId, details: input }).run();
        recordSecurityEvent(tx, { type: 'MAP_APPROACH_ADDED', actor: userActor(actor), subjectType: 'workspace', subjectId: workspaceId,
          occurredAt: at, metadata: { approachId: id } });
        return { id, ...input };
      }, IMMEDIATE);
    },
    async personal(context, id) {
      return db.transaction(tx => {
        guard(tx, context, 'map.visit');
        return ownState(tx, context, id);
      });
    },
    async setPersonal(context, id, state) {
      return db.transaction(tx => {
        guard(tx, context, 'map.visit');
        placeRow(tx, context.workspaceId, id);
        tx.insert(mapPersonal).values({ ...state, workspaceId: context.workspaceId, placeId: id, userId: context.actor.id })
          .onConflictDoUpdate({ target: [mapPersonal.workspaceId, mapPersonal.placeId, mapPersonal.userId], set: state }).run();
        return ownState(tx, context, id);
      }, IMMEDIATE);
    },
    async visit(context, id, visit, at) {
      return db.transaction(tx => {
        guard(tx, context, 'map.visit');
        placeRow(tx, context.workspaceId, id);
        const visits = tx.select({ id: mapVisits.id }).from(mapVisits).where(visitScope(context, id)).limit(100).all();
        if (visits.length === 100) throw new MapConflictError();
        const visitId = randomUUID();
        const { photoIds, ...fields } = visit;
        for (const photoId of photoIds) {
          if (!fileForUser(tx, context, photoId, 'map_visit')) throw new AttachmentError('attachment_not_found');
        }
        tx.insert(mapVisits).values({ ...fields, id: visitId, workspaceId: context.workspaceId, placeId: id, userId: context.actor.id, createdAt: at }).run();
        if (photoIds.length) tx.insert(mapVisitPhotos).values(photoIds.map(attachmentId => ({
          workspaceId: context.workspaceId, visitId, userId: context.actor.id, attachmentId,
        }))).run();
        return ownState(tx, context, id);
      }, IMMEDIATE);
    },
  };
}

const MAP_MEDIA_KEYS = { cover: 'map_cover', visit: 'map_visit' } as const;
function fileForUser(tx: Reader, context: MapContext, id: string, key: string) {
  return tx.select().from(attachments).where(and(eq(attachments.workspaceId, context.workspaceId), eq(attachments.id, id),
    eq(attachments.policyKey, key), eq(attachments.uploadedBy, context.actor.id), eq(attachments.deleting, false))).get();
}

export function mapAttachmentPolicy(purpose: keyof typeof MAP_MEDIA_KEYS): AttachmentConsumerPolicy {
  return {
    key: MAP_MEDIA_KEYS[purpose],
    guard: (tx, scope, actor) => !currentDelegation() && 'workspaceId' in scope && actorAllowed(tx, scope.workspaceId as MapContext['workspaceId'],
      userActor(actor), { tool: 'MAP', actorMay: role => roleHasCapability(role, purpose === 'cover' ? 'map.edit' : 'map.visit') }),
    visible: (_scope, actor) => eq(attachments.uploadedBy, actor.id),
  };
}
export function createMapMediaRepository({ db }: AppDatabase) {
  return {
    cover(context: MapContext, placeId: string, id: string) {
      return db.transaction(tx => {
        guard(tx, context, 'map.view');
        if (placeRow(tx, context.workspaceId, placeId).coverId !== id) throw new MapNotFoundError();
        const row = tx.select().from(attachments).where(and(eq(attachments.workspaceId, context.workspaceId), eq(attachments.id, id),
          eq(attachments.policyKey, 'map_cover'), eq(attachments.deleting, false))).get();
        if (!row) throw new MapNotFoundError();
        return attachmentView(row);
      });
    },
    visit(context: MapContext, placeId: string, id: string) {
      return db.transaction(tx => {
        guard(tx, context, 'map.visit');
        placeRow(tx, context.workspaceId, placeId);
        const binding = tx.select({ id: mapVisitPhotos.attachmentId }).from(mapVisitPhotos).innerJoin(mapVisits,
          and(eq(mapVisits.id, mapVisitPhotos.visitId), eq(mapVisits.workspaceId, mapVisitPhotos.workspaceId), eq(mapVisits.userId, mapVisitPhotos.userId)))
          .where(and(eq(mapVisitPhotos.attachmentId, id), eq(mapVisits.placeId, placeId), eq(mapVisits.workspaceId, context.workspaceId), eq(mapVisits.userId, context.actor.id))).get();
        const row = binding && fileForUser(tx, context, id, 'map_visit');
        if (!row) throw new MapNotFoundError();
        return attachmentView(row);
      });
    },
  };
}
