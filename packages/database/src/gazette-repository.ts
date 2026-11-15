import { createHash, randomInt, randomUUID } from 'node:crypto';
import { AttachmentError, StorageFullError, GazetteConflictError, GazetteNotFoundError, GazetteOperationConflictError, NotAuthorizedError, type GazetteRepository, type GazetteWatchRepository, type StoredGazetteSettings } from '@vergissmeinnicht/application';
import { DomainValidationError, GAZETTE_WATCH_LIMITS, MAX_GAZETTE_HEADER_IMAGES, DEFAULT_GAZETTE_HEADER, type GazetteHeaderSettings, DEFAULT_GAZETTE_WATCH_SETTINGS, gazetteAmazonAsin, gazetteOfferTotal, type GazetteWatchFields, defaultGazetteSettings, type GazetteWatchItemView, type GazetteWatchPrice, gazetteOldestKept, parseTimeZone, type GazetteEdition, type GazetteSettings, type LocalDate, type TimeZoneName, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability, type WorkspaceCapability } from '@vergissmeinnicht/permissions';
import { and, asc, count, desc, eq, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { actorAllowed, IMMEDIATE, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { gazetteEditions, gazetteHeaderImages, gazetteHeaderSettings, gazetteOperations, gazetteSettings, gazetteWatchItems, gazetteWatchPrices, gazetteWeatherForecasts, gazetteWeatherObservations, users, workspaces } from './schema.ts';
import { globalStorageAllows, workspaceReservationBytesIn } from './attachment-repository.ts';
import { storageUsageIn } from './storage-usage.ts';
import { recordSecurityEvent } from './security-events.ts';

type Reader = Pick<Transaction, 'select'>;
const actorStamp = (actor: User) => ({ kind: 'user' as const, userId: actor.id, displayName: actor.displayName });
const guard = (tx: Transaction, workspaceId: WorkspaceId, actor: User, capability: WorkspaceCapability) =>
  actorAllowed(tx, workspaceId, actorStamp(actor), { tool: 'GAZETTE', actorMay: role => roleHasCapability(role, capability) });

/** Operation receipts are kept this long: a retry is expected within minutes, a day-old retry is a new import. */
export const GAZETTE_OPERATION_RETENTION_MS = 3 * 86_400_000;

function workspaceZone(tx: Reader, workspaceId: string): TimeZoneName | null {
  const zone = tx.select({ location: workspaces.location }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.location?.timeZone;
  if (!zone) return null;
  try { return parseTimeZone(zone); } catch { return null; }
}
export function storedGazetteSettings(tx: Reader, workspaceId: string): StoredGazetteSettings {
  const row = tx.select().from(gazetteSettings).where(eq(gazetteSettings.workspaceId, workspaceId)).get();
  return row ? { settings: row.settings, revision: row.revision } : { settings: defaultGazetteSettings(workspaceZone(tx, workspaceId)), revision: 0 };
}

const view = (row: typeof gazetteEditions.$inferSelect): GazetteEdition => ({
  id: row.id, date: row.editionDate as LocalDate, state: row.state, title: row.content.title, revision: row.revision,
  publishedAt: row.publishedAt ?? null, updatedAt: row.updatedAt, updatedBy: row.updatedBy, content: row.content, header: row.header,
});
const summary = (edition: GazetteEdition) => ({ id: edition.id, date: edition.date, state: edition.state, title: edition.title, revision: edition.revision, publishedAt: edition.publishedAt, updatedAt: edition.updatedAt, updatedBy: edition.updatedBy });
const priceView = (row: typeof gazetteWatchPrices.$inferSelect): GazetteWatchPrice => ({ price: row.price, verified: row.verified, checkedAt: row.checkedAt.toISOString(), source: row.source, url: row.url, shipping: row.shipping, vatIncluded: row.vatIncluded });
function watchViews(tx: Reader, rows: readonly (typeof gazetteWatchItems.$inferSelect)[]): GazetteWatchItemView[] {
  const prices = rows.length === 0 ? [] : tx.select().from(gazetteWatchPrices).where(inArray(gazetteWatchPrices.itemId, rows.map(row => row.id))).orderBy(asc(gazetteWatchPrices.checkedAt)).all();
  return rows.map(row => {
    const history = prices.filter(price => price.itemId === row.id).map(priceView);
    return {
      id: row.id, name: row.name, variant: row.variant, condition: row.condition, market: row.market, shop: row.shop, url: row.url, currency: row.currency,
      target: row.target, typical: row.typical, notes: row.notes, active: row.active, revision: row.revision, updatedAt: row.updatedAt.toISOString(),
      latest: history.at(-1) ?? null, history, discountThreshold: row.discountThreshold,
      lowestVerified: history.reduce<GazetteWatchPrice | null>((low, price) => price.verified && price.source !== '' && (low === null || gazetteOfferTotal(price) < gazetteOfferTotal(low)) ? price : low, null),
    };
  });
}
const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function headerRow(tx: Reader, workspaceId: string) {
  return tx.select().from(gazetteHeaderSettings).where(eq(gazetteHeaderSettings.workspaceId, workspaceId)).get()
    ?? { settings: DEFAULT_GAZETTE_HEADER, revision: 0, sequence: 0 };
}

function reclaimHeaders(tx: Transaction, workspaceId: string, settings: GazetteHeaderSettings) {
  const existing = tx.select({ id: gazetteHeaderImages.id }).from(gazetteHeaderImages).where(eq(gazetteHeaderImages.workspaceId, workspaceId)).all();
  const headers = tx.select({ header: gazetteEditions.header }).from(gazetteEditions).where(eq(gazetteEditions.workspaceId, workspaceId)).all();
  const live = new Set([...settings.images.map(image => image.id), ...headers.map(({ header }) => header?.id)]);
  const obsolete = existing.filter(image => !live.has(image.id)).map(image => image.id);
  if (obsolete.length > 0) tx.delete(gazetteHeaderImages).where(inArray(gazetteHeaderImages.id, obsolete)).run();
  return existing.length - obsolete.length;
}

function chooseHeader(tx: Transaction, workspaceId: string, date: LocalDate) {
  const { settings, sequence } = headerRow(tx, workspaceId);
  const { images, mode, fixed } = settings;
  if (images.length === 0 || mode === 'default') return null;
  if (mode === 'fixed') return images.find(image => image.id === fixed) ?? null;
  if (mode === 'random') return images[randomInt(images.length)] ?? null;
  if (mode === 'daily') return images[Math.floor(Date.parse(date) / 86_400_000) % images.length] ?? null;
  tx.update(gazetteHeaderSettings).set({ sequence: sequence + 1 }).where(eq(gazetteHeaderSettings.workspaceId, workspaceId)).run();
  return images[sequence % images.length] ?? null;
}

function writeHeaderSettings(tx: Transaction, workspaceId: WorkspaceId, actor: User, settings: GazetteHeaderSettings, revision: number, at: Date, action: string) {
  tx.insert(gazetteHeaderSettings).values({ workspaceId, settings, revision: revision + 1 })
    .onConflictDoUpdate({ target: gazetteHeaderSettings.workspaceId, set: { settings, revision: revision + 1 } }).run();
  recordSecurityEvent(tx, { type: 'GAZETTE_SETTINGS_CHANGED', actor: actorStamp(actor), subjectType: 'workspace', subjectId: workspaceId, occurredAt: at, metadata: { action, revision: revision + 1 } });
}

function manageHeader(tx: Transaction, workspaceId: WorkspaceId, actor: User, revision: number) {
  if (!guard(tx, workspaceId, actor, 'gazette.manage')) throw new NotAuthorizedError();
  const current = headerRow(tx, workspaceId);
  if (current.revision !== revision) throw new GazetteConflictError();
  return current.settings;
}

export function createGazetteRepository({ db }: AppDatabase): GazetteRepository & GazetteWatchRepository {
  const nameOf = (tx: Transaction, actor: User) => tx.select({ name: users.name }).from(users).where(eq(users.id, actor.id)).get()?.name ?? actor.displayName;
  const event = (tx: Transaction, actor: User, workspaceId: WorkspaceId, at: Date, edition: { id: string; editionDate: string; state: string; revision: number }, action: string) =>
    recordSecurityEvent(tx, { type: 'GAZETTE_EDITION_CHANGED', actor: actorStamp(actor), subjectType: 'workspace', subjectId: workspaceId, occurredAt: at, metadata: { editionId: edition.id, date: edition.editionDate, state: edition.state, revision: edition.revision, action } });
  return {
    async headerSettings(workspaceId) {
      const { settings, revision } = headerRow(db, workspaceId);
      return { settings, revision };
    },
    async saveHeaderSettings(workspaceId, actor, settings, revision, at) {
      db.transaction(tx => {
        const current = manageHeader(tx, workspaceId, actor, revision);
        if (settings.images.length !== current.images.length || settings.images.some(image => !current.images.some(old => old.id === image.id))) throw new GazetteNotFoundError();
        writeHeaderSettings(tx, workspaceId, actor, settings, revision, at, 'header_settings');
      }, IMMEDIATE);
    },
    async addHeaderImage(workspaceId, actor, jpeg, replace, revision, at) {
      db.transaction(tx => {
        const current = manageHeader(tx, workspaceId, actor, revision);
        if (replace !== null && !current.images.some(image => image.id === replace)) throw new GazetteNotFoundError();
        const stored = reclaimHeaders(tx, workspaceId, current);
        if ((replace === null && current.images.length >= MAX_GAZETTE_HEADER_IMAGES) || stored >= MAX_GAZETTE_HEADER_IMAGES * 2)
          throw new DomainValidationError('header', 'gazette_list_size', 'Too many Gazette header images');
        const retained = replace !== null && tx.select({ header: gazetteEditions.header }).from(gazetteEditions)
          .where(eq(gazetteEditions.workspaceId, workspaceId)).all().some(row => row.header?.id === replace);
        if (replace !== null && !retained) tx.delete(gazetteHeaderImages).where(and(eq(gazetteHeaderImages.workspaceId, workspaceId), eq(gazetteHeaderImages.id, replace))).run();
        const usage = storageUsageIn(tx, workspaceId, new Date(at.getTime() - 86_400_000));
        if (usage.used + workspaceReservationBytesIn(tx, workspaceId) + jpeg.byteLength > usage.limit) throw new StorageFullError(usage);
        if (!globalStorageAllows(tx, jpeg.byteLength)) throw new AttachmentError('attachment_quota');
        const id = randomUUID();
        tx.insert(gazetteHeaderImages).values({ id, workspaceId, jpeg: Buffer.from(jpeg) }).run();
        const images = replace === null ? [...current.images, { id, x: 50, y: 50 }] : current.images.map(image => image.id === replace ? { ...image, id } : image);
        writeHeaderSettings(tx, workspaceId, actor, { ...current, images, fixed: replace !== null && current.fixed === replace ? id : current.fixed }, revision, at, replace ? 'header_replaced' : 'header_uploaded');
      }, IMMEDIATE);
    },
    async removeHeaderImage(workspaceId, actor, id, revision, at) {
      db.transaction(tx => {
        const current = manageHeader(tx, workspaceId, actor, revision);
        if (!current.images.some(image => image.id === id)) throw new GazetteNotFoundError();
        tx.delete(gazetteHeaderImages).where(and(eq(gazetteHeaderImages.workspaceId, workspaceId), eq(gazetteHeaderImages.id, id))).run();
        tx.update(gazetteEditions).set({ header: null }).where(and(eq(gazetteEditions.workspaceId, workspaceId), sql`json_extract(${gazetteEditions.header}, '$.id') = ${id}`)).run();
        const mode = current.mode === 'fixed' && current.fixed === id ? 'default' : current.mode;
        writeHeaderSettings(tx, workspaceId, actor, { mode, fixed: current.fixed === id ? null : current.fixed, images: current.images.filter(image => image.id !== id) }, revision, at, 'header_deleted');
      }, IMMEDIATE);
    },
    async readHeaderImage(workspaceId, id) {
      return db.select({ jpeg: gazetteHeaderImages.jpeg }).from(gazetteHeaderImages).where(and(eq(gazetteHeaderImages.workspaceId, workspaceId), eq(gazetteHeaderImages.id, id))).get()?.jpeg;
    },
    async overrideHeader(workspaceId, actor, date, id, revision, at) {
      db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.manage')) throw new NotAuthorizedError();
        const published = tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.editionDate, date), eq(gazetteEditions.state, 'PUBLISHED'))).get();
        if (!published) throw new GazetteNotFoundError();
        if (published.revision !== revision) throw new GazetteConflictError();
        const header = id === null ? null : headerRow(tx, workspaceId).settings.images.find(image => image.id === id);
        if (header === undefined) throw new GazetteNotFoundError();
        const changed = { ...published, revision: published.revision + 1 };
        tx.update(gazetteEditions).set({ header, revision: changed.revision, updatedAt: at, updatedBy: nameOf(tx, actor), updatedByUserId: actor.id }).where(eq(gazetteEditions.id, published.id)).run();
        event(tx, actor, workspaceId, at, changed, 'header_override');
      }, IMMEDIATE);
    },
    async settings(workspaceId) { return storedGazetteSettings(db, workspaceId); },

    async saveSettings(workspaceId, actor, settings, expectedRevision, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.manage')) throw new NotAuthorizedError();
        const current = storedGazetteSettings(tx, workspaceId);
        if (current.revision !== expectedRevision) throw new GazetteConflictError();
        const revision = expectedRevision + 1;
        if (settings.watchlist === undefined && current.settings.watchlist !== undefined) settings = { ...settings, watchlist: current.settings.watchlist };
        if (current.revision === 0) tx.insert(gazetteSettings).values({ workspaceId, settings, revision, updatedAt: at, updatedByUserId: actor.id }).run();
        else tx.update(gazetteSettings).set({ settings, revision, updatedAt: at, updatedByUserId: actor.id }).where(eq(gazetteSettings.workspaceId, workspaceId)).run();
        recordSecurityEvent(tx, { type: 'GAZETTE_SETTINGS_CHANGED', actor: actorStamp(actor), subjectType: 'workspace', subjectId: workspaceId, occurredAt: at, metadata: { revision, retentionDays: settings.retentionDays, sections: settings.sections.length } });
        return { settings, revision };
      }, IMMEDIATE);
    },

    async write(workspaceId, actor, input, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.publish')) throw new NotAuthorizedError();
        const payloadHash = hashOf({ content: input.clientContent ?? input.content, publish: input.publish });
        if (input.operationId) {
          const done = tx.select().from(gazetteOperations).where(eq(gazetteOperations.id, input.operationId)).get();
          if (done) {
            if (done.workspaceId !== workspaceId || done.payloadHash !== payloadHash) throw new GazetteOperationConflictError();
            const row = tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.id, done.editionId), eq(gazetteEditions.workspaceId, workspaceId))).get()
              ?? tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.editionDate, done.editionDate), eq(gazetteEditions.state, 'PUBLISHED'))).get();
            if (!row) throw new GazetteNotFoundError();
            return { edition: view(row), duplicate: true };
          }
        }
        const state = input.publish ? 'PUBLISHED' as const : 'DRAFT' as const;
        const date = input.content.date;
        const existing = tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.editionDate, date), eq(gazetteEditions.state, state))).get();
        if (input.expectedRevision !== null && input.expectedRevision !== (existing?.revision ?? 0)) throw new GazetteConflictError();
        const name = nameOf(tx, actor);
        const header = existing ? existing.header : input.publish ? chooseHeader(tx, workspaceId, date) : null;
        const stamps = { header, content: input.content, revision: (existing?.revision ?? 0) + 1, publishedAt: input.publish ? at : null, updatedAt: at, updatedByUserId: actor.id, updatedBy: name };
        let id: string;
        if (existing) { id = existing.id; tx.update(gazetteEditions).set(stamps).where(eq(gazetteEditions.id, id)).run(); }
        else { id = randomUUID(); tx.insert(gazetteEditions).values({ id, workspaceId, editionDate: date, state, createdAt: at, createdByUserId: actor.id, ...stamps }).run(); }
        if (input.operationId) tx.insert(gazetteOperations).values({ id: input.operationId, workspaceId, userId: actor.id, payloadHash, editionId: id, editionDate: date, at }).run();
        const saved = tx.select().from(gazetteEditions).where(eq(gazetteEditions.id, id)).get();
        if (!saved) throw new GazetteNotFoundError();
        event(tx, actor, workspaceId, at, saved, existing ? 'replaced' : 'created');
        return { edition: view(saved), duplicate: false };
      }, IMMEDIATE);
    },

    async publish(workspaceId, actor, editionId, expectedRevision, revalidate, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.publish')) throw new NotAuthorizedError();
        const row = tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.id, editionId), eq(gazetteEditions.workspaceId, workspaceId))).get();
        if (!row) throw new GazetteNotFoundError();
        // Publishing the edition that is already published is a no-op: retries are safe.
        if (row.state === 'PUBLISHED') { if (row.revision !== expectedRevision) throw new GazetteConflictError(); return view(row); }
        if (row.revision !== expectedRevision) throw new GazetteConflictError();
        const content = revalidate(row.content);
        const old = tx.select({ header: gazetteEditions.header }).from(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.editionDate, row.editionDate), eq(gazetteEditions.state, 'PUBLISHED'))).get();
        const header = old ? old.header : chooseHeader(tx, workspaceId, row.editionDate as LocalDate);
        tx.delete(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.editionDate, row.editionDate), eq(gazetteEditions.state, 'PUBLISHED'))).run();
        tx.update(gazetteEditions).set({ state: 'PUBLISHED', content, header, revision: row.revision + 1, publishedAt: at, updatedAt: at, updatedByUserId: actor.id, updatedBy: nameOf(tx, actor) }).where(eq(gazetteEditions.id, editionId)).run();
        const saved = tx.select().from(gazetteEditions).where(eq(gazetteEditions.id, editionId)).get();
        if (!saved) throw new GazetteNotFoundError();
        event(tx, actor, workspaceId, at, saved, 'published');
        return view(saved);
      }, IMMEDIATE);
    },

    async deleteDraft(workspaceId, actor, editionId, at) {
      db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.publish')) throw new NotAuthorizedError();
        const row = tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.id, editionId), eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.state, 'DRAFT'))).get();
        if (!row) throw new GazetteNotFoundError();
        tx.delete(gazetteEditions).where(eq(gazetteEditions.id, editionId)).run();
        event(tx, actor, workspaceId, at, row, 'draft_deleted');
      }, IMMEDIATE);
    },

    async list(workspaceId, oldest, includeDrafts) {
      return db.select().from(gazetteEditions)
        .where(and(eq(gazetteEditions.workspaceId, workspaceId), gte(gazetteEditions.editionDate, oldest), includeDrafts ? undefined : eq(gazetteEditions.state, 'PUBLISHED')))
        .orderBy(desc(gazetteEditions.editionDate), desc(gazetteEditions.state)).limit(100).all().map(row => summary(view(row)));
    },
    async findById(workspaceId, id) {
      const row = db.select().from(gazetteEditions).where(and(eq(gazetteEditions.id, id), eq(gazetteEditions.workspaceId, workspaceId))).get();
      return row ? view(row) : undefined;
    },
    async findByDate(workspaceId, date, state) {
      const row = db.select().from(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.editionDate, date), eq(gazetteEditions.state, state))).get();
      return row ? view(row) : undefined;
    },
    async watchItems(workspaceId) {
      const rows = db.select().from(gazetteWatchItems).where(eq(gazetteWatchItems.workspaceId, workspaceId)).orderBy(desc(gazetteWatchItems.active), asc(gazetteWatchItems.name)).all();
      return watchViews(db, rows);
    },
    async importWatchItems(workspaceId, actor, items, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.publish')) throw new NotAuthorizedError();
        const minimum = storedGazetteSettings(tx, workspaceId).settings.watchlist?.minimumEur ?? DEFAULT_GAZETTE_WATCH_SETTINGS.minimumEur;
        const existing = tx.select().from(gazetteWatchItems).where(eq(gazetteWatchItems.workspaceId, workspaceId)).all();
        const seen = new Set<string>();
        const result = { created: 0, updated: 0, skipped: 0 };
        for (const item of items) {
          if (item.typical !== null && item.typical < minimum) { result.skipped++; continue; }
          const asin = gazetteAmazonAsin(item.url);
          // A different currency, condition or market can have incomparable historical prices.
          const exact = (row: GazetteWatchFields) => row.currency === item.currency && row.condition === item.condition && row.market === item.market;
          const identity = (row: GazetteWatchFields) => JSON.stringify([row.name, row.variant, row.shop, row.url]);
          const key = JSON.stringify([item.condition, item.market, asin ?? identity(item)]);
          if (seen.has(key)) { result.skipped++; continue; }
          seen.add(key);
          const matches = existing.filter(row => exact(row) && (asin !== null ? gazetteAmazonAsin(row.url) === asin : identity(row) === identity(item)));
          if (matches.length > 1) throw new GazetteConflictError();
          const row = matches[0];
          if (row) {
            // Reimport only the supplied reference. Never overwrite curated identity, archive state or history.
            if (!row.active || item.typical === null || row.typical === item.typical) { result.skipped++; continue; }
            tx.update(gazetteWatchItems).set({ typical: item.typical, revision: row.revision + 1, updatedAt: at, updatedByUserId: actor.id }).where(eq(gazetteWatchItems.id, row.id)).run();
            result.updated++;
          } else {
            if (existing.length + result.created >= GAZETTE_WATCH_LIMITS.items) throw new DomainValidationError('items', 'gazette_list_size', 'Too many watched items');
            tx.insert(gazetteWatchItems).values({ ...item, id: randomUUID(), workspaceId, revision: 1, createdAt: at, createdByUserId: actor.id, updatedAt: at, updatedByUserId: actor.id }).run();
            result.created++;
          }
        }
        return result;
      }, IMMEDIATE);
    },
    async createWatchItem(workspaceId, actor, fields, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.publish')) throw new NotAuthorizedError();
        const total = tx.select({ n: count() }).from(gazetteWatchItems).where(eq(gazetteWatchItems.workspaceId, workspaceId)).get()?.n ?? 0;
        if (total >= GAZETTE_WATCH_LIMITS.items) throw new DomainValidationError('item', 'gazette_list_size', 'Too many watched items');
        const id = randomUUID();
        tx.insert(gazetteWatchItems).values({ id, workspaceId, ...fields, revision: 1, createdAt: at, createdByUserId: actor.id, updatedAt: at, updatedByUserId: actor.id }).run();
        return watchViews(tx, tx.select().from(gazetteWatchItems).where(eq(gazetteWatchItems.id, id)).all())[0] as GazetteWatchItemView;
      }, IMMEDIATE);
    },
    async updateWatchItem(workspaceId, actor, id, fields, expectedRevision, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.publish')) throw new NotAuthorizedError();
        const row = tx.select().from(gazetteWatchItems).where(and(eq(gazetteWatchItems.id, id), eq(gazetteWatchItems.workspaceId, workspaceId))).get();
        if (!row) throw new GazetteNotFoundError();
        if (row.revision !== expectedRevision) throw new GazetteConflictError();
        const hasPrices = tx.select({ id: gazetteWatchPrices.id }).from(gazetteWatchPrices).where(eq(gazetteWatchPrices.itemId, id)).get();
        const beforeAsin = gazetteAmazonAsin(row.url);
        const afterAsin = gazetteAmazonAsin(fields.url);
        if (hasPrices && (row.currency !== fields.currency || row.condition !== fields.condition || row.market !== fields.market || (beforeAsin !== null && afterAsin !== beforeAsin))) throw new GazetteConflictError();
        tx.update(gazetteWatchItems).set({ ...fields, revision: row.revision + 1, updatedAt: at, updatedByUserId: actor.id }).where(eq(gazetteWatchItems.id, id)).run();
        return watchViews(tx, tx.select().from(gazetteWatchItems).where(eq(gazetteWatchItems.id, id)).all())[0] as GazetteWatchItemView;
      }, IMMEDIATE);
    },
    async removeWatchItem(workspaceId, actor, id, revision, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.manage')) throw new NotAuthorizedError();
        const item = and(eq(gazetteWatchItems.workspaceId, workspaceId), eq(gazetteWatchItems.id, id));
        const row = tx.select().from(gazetteWatchItems).where(item).get();
        if (!row) throw new GazetteNotFoundError();
        if (row.active || row.revision !== revision) throw new GazetteConflictError();
        tx.delete(gazetteWatchPrices).where(and(eq(gazetteWatchPrices.workspaceId, workspaceId), eq(gazetteWatchPrices.itemId, id))).run();
        tx.delete(gazetteWatchItems).where(item).run();
        recordSecurityEvent(tx, { type: 'GAZETTE_WATCH_ITEM_REMOVED', actor: actorStamp(actor), subjectType: 'workspace', subjectId: workspaceId, occurredAt: at, metadata: { itemId: id, revision } });
      }, IMMEDIATE);
    },
    async recordPrices(workspaceId, actor, observations, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.publish')) throw new NotAuthorizedError();
        const ids = [...new Set(observations.map(entry => entry.itemId))];
        const known = tx.select({ id: gazetteWatchItems.id }).from(gazetteWatchItems).where(and(eq(gazetteWatchItems.workspaceId, workspaceId), inArray(gazetteWatchItems.id, ids))).all();
        if (known.length !== ids.length) throw new GazetteNotFoundError();
        for (const entry of observations) {
          tx.insert(gazetteWatchPrices).values({ id: randomUUID(), workspaceId, itemId: entry.itemId, price: entry.price, verified: entry.verified, checkedAt: new Date(entry.checkedAt), source: entry.source, url: entry.url, shipping: entry.shipping, vatIncluded: entry.vatIncluded, createdAt: at, createdByUserId: actor.id }).run();
        }
        // Keep the newest observations per item only.
        for (const itemId of ids) {
          const old = tx.select({ id: gazetteWatchPrices.id }).from(gazetteWatchPrices).where(eq(gazetteWatchPrices.itemId, itemId)).orderBy(desc(gazetteWatchPrices.checkedAt), desc(gazetteWatchPrices.createdAt)).limit(100_000).offset(GAZETTE_WATCH_LIMITS.pricesPerItem).all();
          if (old.length > 0) tx.delete(gazetteWatchPrices).where(inArray(gazetteWatchPrices.id, old.map(row => row.id))).run();
        }
        return observations.length;
      }, IMMEDIATE);
    },
    async latestPublished(workspaceId, onOrBefore) {
      const row = db.select().from(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.state, 'PUBLISHED'), lte(gazetteEditions.editionDate, onOrBefore)))
        .orderBy(desc(gazetteEditions.editionDate)).limit(1).get();
      return row ? view(row) : undefined;
    },
  };
}

/**
 * Retention (43): per Workspace, editions dated before the oldest kept day (in the Workspace's Gazette time
 * zone) are deleted — except the newest published edition, which stays until a newer one replaces it, so the
 * Dashboard never goes empty only because an import was missed. Old operation receipts go too. Settings and
 * anything outside the Gazette are never touched. One transaction.
 */
export function purgeGazette({ db }: Pick<AppDatabase, 'db'>, now: Date = new Date()): { readonly editions: number; readonly operations: number } {
  return db.transaction(tx => {
    const workspaceIds = [...new Set(tx.selectDistinct({ id: gazetteEditions.workspaceId }).from(gazetteEditions).all().map(row => row.id))];
    let editions = 0;
    for (const workspaceId of workspaceIds) {
      const settings: GazetteSettings = storedGazetteSettings(tx, workspaceId).settings;
      const oldest = gazetteOldestKept(settings, now);
      const keep = tx.select({ id: gazetteEditions.id }).from(gazetteEditions)
        .where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.state, 'PUBLISHED')))
        .orderBy(desc(gazetteEditions.editionDate)).limit(1).get()?.id;
      editions += tx.delete(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), lt(gazetteEditions.editionDate, oldest), keep ? ne(gazetteEditions.id, keep) : undefined))
        .returning({ id: gazetteEditions.id }).all().length;
    }
    for (const { workspaceId, settings } of tx.select({ workspaceId: gazetteHeaderSettings.workspaceId, settings: gazetteHeaderSettings.settings }).from(gazetteHeaderSettings).all()) reclaimHeaders(tx, workspaceId, settings);
    const operations = tx.delete(gazetteOperations).where(lt(gazetteOperations.at, new Date(now.getTime() - GAZETTE_OPERATION_RETENTION_MS))).returning({ id: gazetteOperations.id }).all().length;
    // Weather verification rows (43.7): derived, kept 60 days.
    const before = new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
    tx.delete(gazetteWeatherForecasts).where(lt(gazetteWeatherForecasts.targetDate, before)).run();
    tx.delete(gazetteWeatherObservations).where(lt(gazetteWeatherObservations.date, before)).run();
    return { editions, operations };
  }, IMMEDIATE);
}
