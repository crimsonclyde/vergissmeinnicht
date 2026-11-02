import {and,eq,lt,sql} from 'drizzle-orm';
import type {AttachmentStore} from '@vergissmeinnicht/application';
import {markdownAttachments} from '@vergissmeinnicht/domain';
import type {AppDatabase} from './connection.ts';
import {attachments,attachmentReservations,journalDrafts,journalAttachmentReferences,privateJournalAttachmentReferences,recipeAttachmentReferences} from './schema.ts';
import {IMMEDIATE} from './actor-guard.ts';
/** Journal lifecycle adapter. Unknown future policies retain files until their own lifecycle is registered. */
export async function purgeAttachmentFiles({db}:AppDatabase,store:AttachmentStore,now=new Date()){
 const expired=db.select().from(attachmentReservations).where(lt(attachmentReservations.expiresAt,now)).all();
 for(const reservation of expired){for(const key of reservation.keys)await store.remove(key);db.delete(attachmentReservations).where(and(eq(attachmentReservations.id,reservation.id),lt(attachmentReservations.expiresAt,now))).run();}
 const before=new Date(now.getTime()-86400000);let files=0;
 const released=db.transaction(tx=>{
  const draftRefs=new Set(tx.select().from(journalDrafts).all().flatMap(row=>markdownAttachments(row.content.body).map(ref=>ref.id)));
  const unreferenced=tx.select().from(attachments).where(and(sql`${attachments.policyKey} in ('journal','recipes')`,lt(attachments.at,before),sql`not exists(select 1 from ${journalAttachmentReferences} where ${journalAttachmentReferences.attachmentId}=${attachments.id}) and not exists(select 1 from ${privateJournalAttachmentReferences} where ${privateJournalAttachmentReferences.attachmentId}=${attachments.id}) and not exists(select 1 from ${recipeAttachmentReferences} where ${recipeAttachmentReferences.attachmentId}=${attachments.id})`)).all().filter(row=>!draftRefs.has(row.id));
  // Keep rows charged until the objects are removed below; a new reference after this transaction
  // is refused by the consumer/SQL deleting guards. No await occurs inside this transaction.
  for(const row of unreferenced)tx.update(attachments).set({deleting:true}).where(eq(attachments.id,row.id)).run();return unreferenced;
 },IMMEDIATE);
 for(const row of released){for(const key of [row.originalKey,row.previewKey,row.thumbnailKey])await store.remove(key);db.delete(attachments).where(and(eq(attachments.id,row.id),eq(attachments.deleting,true))).run();files++;}
 return {files};
}
