import { awardProgress } from '../progress-repository.ts';
import { randomUUID } from 'node:crypto';
import { journalMayWrite, JournalConsentError, JournalConflictError, NotAuthorizedError, type JournalRepository } from '@vergissmeinnicht/application';
import { DomainValidationError, markdownAttachments, JOURNAL_NOTICE_VERSION, type JournalContent, type JournalEntry, type JournalScope, type WorkspaceId } from '@vergissmeinnicht/domain';
import { and, count, desc, eq, lt, sql } from 'drizzle-orm';
import { IMMEDIATE, actorAllowed } from '../actor-guard.ts';
import type { AppDatabase } from '../connection.ts';
import { journalEntries, privateJournalEntries, journalRevisions, privateJournalRevisions, journalDrafts, journalAcknowledgements, attachments, journalAttachmentReferences, privateJournalAttachmentReferences, users } from '../schema.ts';
import { recordSecurityEvent } from '../security-events.ts';

const target = (scope: JournalScope) => 'workspaceId' in scope
  ? { table: journalEntries, filter: eq(journalEntries.workspaceId, scope.workspaceId) }
  : { table: privateJournalEntries, filter: eq(privateJournalEntries.ownerId, scope.ownerId) };
const view = (row: Omit<typeof journalEntries.$inferSelect, 'workspaceId'>): JournalEntry => ({ id: row.id, kind: row.kind, version: row.version as 1 | 2, collection: row.collection, tags: row.tags, pinned: row.pinned, title: row.title, date: row.date, body: row.body, revision: row.revision, archived: row.archived, createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy });
const contentOf = (row: Parameters<typeof view>[0]): JournalContent => { const {kind, version, title, date, body, collection, tags, pinned} = view(row); return {kind, version, title, date, body, collection:collection ?? '', tags:tags ?? [], pinned:pinned ?? false}; };
export function createJournalRepository({ db }: AppDatabase): JournalRepository {
  function guard(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], scope: JournalScope, actor: import('@vergissmeinnicht/domain').User) {
   const current = tx.select().from(users).where(eq(users.id, actor.id)).get();
   if (current?.status !== 'ACTIVE') return false;
   if ('workspaceId' in scope) return actorAllowed(tx, scope.workspaceId as WorkspaceId, {kind:'user',userId:actor.id,displayName:current.name}, {tool:'JOURNAL',actorMay:journalMayWrite});
   if (scope.ownerId !== actor.id) return false;
   if (tx.select().from(journalAcknowledgements).where(eq(journalAcknowledgements.userId, actor.id)).get()?.version !== JOURNAL_NOTICE_VERSION) throw new JournalConsentError();
   return true;
  }
  return {
    async privacy(actor, acknowledge = false) {
     return db.transaction(tx => {
      if (tx.select().from(users).where(eq(users.id, actor.id)).get()?.status !== 'ACTIVE') throw new NotAuthorizedError();
      const previous = tx.select().from(journalAcknowledgements).where(eq(journalAcknowledgements.userId, actor.id)).get();
      if (acknowledge && previous?.version !== JOURNAL_NOTICE_VERSION) {
       tx.insert(journalAcknowledgements).values({userId:actor.id,version:JOURNAL_NOTICE_VERSION,at:new Date()}).onConflictDoUpdate({target:journalAcknowledgements.userId,set:{version:JOURNAL_NOTICE_VERSION,at:new Date()}}).run();
       recordSecurityEvent(tx,{type:'JOURNAL_PRIVACY_ACKNOWLEDGED',actor:{kind:'user',userId:actor.id,displayName:actor.displayName},subjectType:'user',subjectId:actor.id,occurredAt:new Date(),metadata:{version:JOURNAL_NOTICE_VERSION}});
      }
      return acknowledge || previous?.version === JOURNAL_NOTICE_VERSION;
     },IMMEDIATE);
    },
    async history(scope, id, before) {
     const table = 'workspaceId' in scope ? journalRevisions : privateJournalRevisions;
     const filter = 'workspaceId' in scope ? eq(journalRevisions.workspaceId,scope.workspaceId) : eq(privateJournalRevisions.ownerId,scope.ownerId);
     return db.select().from(table).where(and(filter,eq(table.entryId,id),lt(table.revision,before))).orderBy(desc(table.revision)).limit(30).all().map(row=>({revision:row.revision,content:row.content,archived:row.archived,at:row.at,by:row.by}));
    },
    async draft(scope, actor, input) {
     return db.transaction(tx=>{
      if (!guard(tx,scope,actor)) throw new NotAuthorizedError();
      const key = actor.id + ':' + ('workspaceId' in scope ? scope.workspaceId : 'private');
      if (input === null) tx.delete(journalDrafts).where(eq(journalDrafts.key,key)).run();
      else if (input !== undefined) {
       const existing=tx.select().from(journalDrafts).where(eq(journalDrafts.key,key)).get();if(existing&&existing.entryId!==input.entryId)throw new JournalConflictError();
       if (input.entryId !== null) {
        const {table,filter}=target(scope);
        if (!tx.select({id:table.id}).from(table).where(and(filter,eq(table.id,input.entryId))).get()) throw new NotAuthorizedError();
       }
       for(const ref of markdownAttachments(input.content.body)){const file=tx.select().from(attachments).where(eq(attachments.id,ref.id)).get();if(!file||file.policyKey!=='journal'||file.deleting||('workspaceId' in scope?file.workspaceId!==scope.workspaceId:file.ownerId!==scope.ownerId))throw new NotAuthorizedError();const refs='workspaceId' in scope?journalAttachmentReferences:privateJournalAttachmentReferences;if(file.uploadedBy!==actor.id&&!tx.select().from(refs).where(eq(refs.attachmentId,ref.id)).get())throw new NotAuthorizedError();if(!ref.url.endsWith(file.format==='PNG'?'.png':'.jpg'))throw new DomainValidationError('entry','invalid_journal_entry','Image extension does not match');}
       tx.insert(journalDrafts).values({...input,key,userId:actor.id,workspaceId:'workspaceId' in scope ? scope.workspaceId : null}).onConflictDoUpdate({target:journalDrafts.key,set:input}).run();
      }
      if (input !== undefined) recordSecurityEvent(tx,{type:'JOURNAL_DRAFT_CHANGED',actor:{kind:'user',userId:actor.id,displayName:actor.displayName},subjectType:'user',subjectId:actor.id,occurredAt:new Date(),metadata:{scope:'workspaceId' in scope?'workspace':'private',discarded:input===null}});
      const row=tx.select().from(journalDrafts).where(eq(journalDrafts.key,key)).get();
      return row ? {entryId:row.entryId,expectedRevision:row.expectedRevision,content:row.content,archived:row.archived,updatedAt:row.updatedAt} : null;
     },IMMEDIATE);
    },
    async list(scope, query, archived, offset) {
      const { table, filter } = target(scope);
      const rows = db.select().from(table).where(and(filter, eq(table.archived, archived), sql`instr(lower(${table.title} || char(10) || ${table.body} || char(10) || ${table.collection} || char(10) || ${table.tags}), lower(${query})) > 0`)).orderBy(desc(table.pinned), desc(table.updatedAt), desc(table.id)).limit(31).offset(offset).all();
      return { entries: rows.slice(0, 30).map(view), more: rows.length > 30 };
    },
    async find(scope, id) {
      const { table, filter } = target(scope);
      const row = db.select().from(table).where(and(filter, eq(table.id, id))).get();
      return row === undefined ? undefined : view(row);
    },
    async save(scope, actor, entry, id, expectedRevision, archived, at) {
      return db.transaction((tx) => {
        if (!guard(tx,scope,actor)) return 'forbidden';
        const current = tx.select().from(users).where(eq(users.id,actor.id)).get();if(!current)return 'forbidden';
        const { table, filter } = target(scope);
        const previous = id === undefined ? undefined : tx.select().from(table).where(and(filter, eq(table.id, id))).get();
        if (id !== undefined && previous === undefined) return 'missing';
        if (expectedRevision !== (previous?.revision ?? 0)) return 'conflict';
        if(previous?.version===2&&entry.version===1)throw new DomainValidationError('entry','invalid_journal_entry','Cannot downgrade Markdown');
        const nextId = id ?? randomUUID();
        const history = 'workspaceId' in scope ? journalRevisions : privateJournalRevisions;
        if (previous && !tx.select().from(history).where(and(eq(history.entryId,nextId),eq(history.revision,previous.revision))).get()) {
         const values={entryId:nextId,revision:previous.revision,content:contentOf(previous),archived:previous.archived,at:previous.updatedAt,by:previous.updatedBy,byUserId:previous.updatedByUserId};
         if ('workspaceId' in scope) tx.insert(journalRevisions).values({...values,workspaceId:scope.workspaceId}).run();
         else tx.insert(privateJournalRevisions).values({...values,ownerId:scope.ownerId}).run();
        }
        if ((tx.select({n:count()}).from(history).where(eq(history.entryId,nextId)).get()?.n ?? 0) >= 1000) throw new DomainValidationError('entry','journal_revision_limit','This entry has reached its revision limit');
        if (previous === undefined) {
          const n = tx.select({ n: count() }).from(table).where(filter).get()?.n ?? 0;
          if (n >= 1000) throw new DomainValidationError('entry', 'journal_limit', 'This journal has reached its entry limit');
          const values = { ...entry, tags:[...(entry.tags ?? [])], id: nextId, revision: 1, archived, createdByUserId: actor.id, createdBy: current.name, updatedByUserId: actor.id, updatedBy: current.name, createdAt: at, updatedAt: at };
          if ('workspaceId' in scope) tx.insert(journalEntries).values({ ...values, workspaceId: scope.workspaceId }).run();
          else tx.insert(privateJournalEntries).values({ ...values, ownerId: scope.ownerId }).run();
        } else {
          tx.update(table).set({ version:entry.version, collection:entry.collection ?? '', tags:[...(entry.tags ?? [])], pinned:entry.pinned ?? false, title: entry.title, date: entry.date, body: entry.body, revision: previous.revision + 1, archived, updatedByUserId: actor.id, updatedBy: current.name, updatedAt: at }).where(and(filter, eq(table.id, nextId), eq(table.revision, expectedRevision))).run();
        }
        if (previous === undefined) awardProgress(tx, actor.id, 'workspaceId' in scope ? { workspaceId: scope.workspaceId } : { private: true }, nextId, 'JOURNAL_CREATED', at);
        recordSecurityEvent(tx, { type: 'JOURNAL_ENTRY_CHANGED', actor: { kind: 'user', userId: actor.id, displayName: current.name }, subjectType: 'workspaceId' in scope ? 'workspace' : 'user', subjectId: 'workspaceId' in scope ? scope.workspaceId : scope.ownerId, occurredAt: at, metadata: { scope: 'workspaceId' in scope ? 'workspace' : 'private', revision: (previous?.revision ?? 0) + 1, archived } });
        const result = tx.select().from(table).where(and(filter, eq(table.id, nextId))).get();
        if (result === undefined) throw new Error('Journal save lost its row');
        // Bind immutable file references for all retained revisions, never just the current body.
        const imageIds=entry.version===2?markdownAttachments(entry.body).map(ref=>ref.id):[];
        for(const attachmentId of new Set(imageIds)) {
         const file=tx.select().from(attachments).where(eq(attachments.id,attachmentId)).get();
         if(!file || file.policyKey!=='journal' || file.deleting || ('workspaceId' in scope ? file.workspaceId!==scope.workspaceId : file.ownerId!==scope.ownerId))throw new NotAuthorizedError();
         const refs='workspaceId' in scope?journalAttachmentReferences:privateJournalAttachmentReferences;
         const bound=tx.select().from(refs).where(eq(refs.attachmentId,attachmentId)).get();
         if(!bound && file.uploadedBy!==actor.id)throw new NotAuthorizedError();
         if(!markdownAttachments(entry.body).filter(ref=>ref.id===attachmentId).every(ref=>ref.url.endsWith(file.format==='PNG'?'.png':'.jpg')))throw new DomainValidationError('entry','invalid_journal_entry','Image extension does not match');
         if('workspaceId' in scope)tx.insert(journalAttachmentReferences).values({entryId:nextId,workspaceId:scope.workspaceId,attachmentId}).onConflictDoNothing().run();
         else tx.insert(privateJournalAttachmentReferences).values({entryId:nextId,ownerId:scope.ownerId,attachmentId}).onConflictDoNothing().run();
        }
        const snapshot={entryId:nextId,revision:result.revision,content:contentOf(result),archived:result.archived,at,by:current.name,byUserId:actor.id};
        if ('workspaceId' in scope) tx.insert(journalRevisions).values({...snapshot,workspaceId:scope.workspaceId}).run();
        else tx.insert(privateJournalRevisions).values({...snapshot,ownerId:scope.ownerId}).run();
        const draftKey=actor.id+':'+('workspaceId' in scope?scope.workspaceId:'private');const pendingDraft=tx.select().from(journalDrafts).where(eq(journalDrafts.key,draftKey)).get();if(pendingDraft&&(pendingDraft.entryId===nextId||(previous===undefined&&pendingDraft.entryId===null)))tx.delete(journalDrafts).where(eq(journalDrafts.key,draftKey)).run();
        return view(result);
      }, IMMEDIATE);
    },
  };
}

export function journalAttachmentGuard(tx:import('../actor-guard.ts').Transaction,scope:JournalScope,actor:import('@vergissmeinnicht/domain').User):boolean {
 const current=tx.select().from(users).where(eq(users.id,actor.id)).get();
 if(current?.status!=='ACTIVE')return false;
 if('workspaceId' in scope)return actorAllowed(tx,scope.workspaceId as WorkspaceId,{kind:'user',userId:actor.id,displayName:current.name},{tool:'JOURNAL',actorMay:journalMayWrite});
 return scope.ownerId===actor.id&&tx.select().from(journalAcknowledgements).where(eq(journalAcknowledgements.userId,actor.id)).get()?.version===JOURNAL_NOTICE_VERSION;
}

export const journalAttachmentPolicy:import('../attachment-repository.ts').AttachmentConsumerPolicy={key:'journal',guard:journalAttachmentGuard,visible:(_scope,actor)=>sql`(${attachments.uploadedBy} = ${actor.id} or exists(select 1 from ${journalAttachmentReferences} where ${journalAttachmentReferences.attachmentId} = ${attachments.id}) or exists(select 1 from ${privateJournalAttachmentReferences} where ${privateJournalAttachmentReferences.attachmentId} = ${attachments.id}))`};
