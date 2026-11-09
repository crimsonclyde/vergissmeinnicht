import { createHash, randomUUID } from 'node:crypto';
import { RecipeConflictError, RecipeNotFoundError, NotAuthorizedError, type RecipeRepository } from '@vergissmeinnicht/application';
import { markdownAttachments, DomainValidationError, MAX_ITEMS_PER_LIST, scaleRecipeIngredients, parseRecipeContent,normalizeListItemTitle,normalizeListItemQuantity,normalizeListItemUnit,type RecipeContent,type RecipeTransfer,type Recipe, type User, type WorkspaceId, type AttachmentScope } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { actorAllowed, IMMEDIATE, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { recipeMealOperations,recipes, recipeAttachmentReferences, recipeShoppingOperations, attachments, lists, listItems, users } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

const view = (row: typeof recipes.$inferSelect): Recipe => ({ ...row.content, id: row.id, revision: row.revision, archived: row.archived, updatedAt: row.updatedAt, updatedBy: row.updatedBy });
const actorStamp = (actor: User) => ({ kind: 'user' as const, userId: actor.id, displayName: actor.displayName });
const guard = (tx: Transaction, workspaceId: WorkspaceId, actor: User, write = false) => actorAllowed(tx, workspaceId, actorStamp(actor), { tool: 'RECIPES', actorMay: role => roleHasCapability(role, write ? 'recipe.manage' : 'recipe.view') });
const invalid = (message: string): never => { throw new DomainValidationError('recipe', 'invalid_recipe', message); };

export const recipeAttachmentPolicy: import('./attachment-repository.ts').AttachmentConsumerPolicy = {
  key: 'recipes',
  uploadTargetExists: (tx, workspaceId, id) => !!tx.select({ id: recipes.id }).from(recipes)
    .where(and(eq(recipes.id,id),eq(recipes.workspaceId,workspaceId),eq(recipes.archived,false))).get(),
  guard: (tx, scope: AttachmentScope, actor) => 'workspaceId' in scope && guard(tx, scope.workspaceId as WorkspaceId, actor, true),
  visible: (_scope, actor) => sql`(${attachments.uploadedBy} = ${actor.id} or exists(select 1 from ${recipeAttachmentReferences} r where r.attachment_id = ${attachments.id}))`,
};

export function createRecipeRepository({ db }: AppDatabase): RecipeRepository {
  const saveTx=(tx:Transaction,workspaceId:WorkspaceId,actor:User,id:string|undefined,revision:number,content:RecipeContent,archived:boolean,at:Date):Recipe=>{
        if (!guard(tx, workspaceId, actor, true)) throw new NotAuthorizedError();
        const previous = id ? tx.select().from(recipes).where(and(eq(recipes.id, id), eq(recipes.workspaceId, workspaceId))).get() : undefined;
        if (id && !previous) throw new RecipeNotFoundError();
        if (revision !== (previous?.revision ?? 0)) throw new RecipeConflictError();
        if (!previous && tx.select({ id: recipes.id }).from(recipes).where(eq(recipes.workspaceId, workspaceId)).limit(1000).all().length >= 1000) invalid('Recipe limit reached');
        const recipeId = id ?? randomUUID();
        const name = tx.select().from(users).where(eq(users.id, actor.id)).get()?.name ?? actor.displayName;
        const stamps = { revision: revision + 1, updatedAt: at, updatedByUserId: actor.id, updatedBy: name, content, archived };
        const references = markdownAttachments(content.instructions);
        // References are retained after editing, so earlier original uploads cannot disappear silently.
        for (const ref of references) {
          const file = tx.select().from(attachments).where(and(eq(attachments.id, ref.id), eq(attachments.policyKey, 'recipes'), eq(attachments.workspaceId, workspaceId), eq(attachments.deleting, false))).get();
          if (!file || (file.uploadedBy !== actor.id && !tx.select().from(recipeAttachmentReferences).where(eq(recipeAttachmentReferences.attachmentId, ref.id)).get())) throw new NotAuthorizedError();
          if (!ref.url.endsWith(file.format === 'PNG' ? '.png' : '.jpg')) invalid('Image extension does not match');
        }
        if (previous) tx.update(recipes).set(stamps).where(eq(recipes.id, recipeId)).run();
        else tx.insert(recipes).values({ id: recipeId, workspaceId, createdAt: at, createdByUserId: actor.id, createdBy: name, ...stamps }).run();
        for (const ref of references) tx.insert(recipeAttachmentReferences).values({ recipeId, workspaceId, attachmentId: ref.id }).onConflictDoNothing().run();
        recordSecurityEvent(tx, { type: 'RECIPE_CHANGED', actor: actorStamp(actor), subjectType: 'workspace', subjectId: workspaceId, occurredAt: at, metadata: { recipeId, revision: stamps.revision, archived } });
        return { ...content, id: recipeId, revision: stamps.revision, archived, updatedAt: at, updatedBy: name };
        };
  const transferTx=(tx:Transaction,workspaceId:WorkspaceId,actor:User,id:string,input:RecipeTransfer,at:Date)=>{
        if (!guard(tx, workspaceId, actor) || !actorAllowed(tx, workspaceId, actorStamp(actor), { tool: 'LISTS', actorMay: role => roleHasCapability(role, 'list.edit') })) throw new NotAuthorizedError();
        const hash = createHash('sha256').update(JSON.stringify({ id, input })).digest('hex');
        const prior = tx.select().from(recipeShoppingOperations).where(eq(recipeShoppingOperations.id, input.operationId)).get();
        if (prior) {
          if (prior.workspaceId !== workspaceId || prior.userId !== actor.id || prior.payloadHash !== hash) throw new RecipeConflictError();
          return { itemIds: prior.itemIds, duplicate: true };
        }
        const recipe = tx.select().from(recipes).where(and(eq(recipes.id, id), eq(recipes.workspaceId, workspaceId))).get();
        const list = tx.select().from(lists).where(and(eq(lists.id, input.listId), eq(lists.workspaceId, workspaceId), isNull(lists.deletedAt))).get();
        if (!recipe || !list || recipe.archived) throw new RecipeNotFoundError();
        if (recipe.revision !== input.recipeRevision || list.revision !== input.listRevision) throw new RecipeConflictError();
        if (!Number.isInteger(input.servings) || input.servings < 1 || input.servings > 1000 || input.items.length < 1 || input.items.length > 100 || new Set(input.items.map(item => item.ingredient)).size !== input.items.length || input.items.some(item => !Number.isInteger(item.ingredient) || item.ingredient < 0 || item.ingredient >= recipe.content.ingredients.length)) invalid('Invalid ingredient selection');
        const current = tx.select({ id: listItems.id }).from(listItems).where(and(eq(listItems.listId, list.id), isNull(listItems.deletedAt))).all();
        if (current.length + input.items.length > MAX_ITEMS_PER_LIST) invalid('Grocery list item limit reached');
        const position = Number(tx.select({ n: sql<number>`coalesce(max(${listItems.position}), -1)` }).from(listItems).where(eq(listItems.listId, list.id)).get()?.n ?? -1) + 1;
        const name = tx.select().from(users).where(eq(users.id, actor.id)).get()?.name ?? actor.displayName;
        const itemIds = input.items.map((item, offset) => {
          const itemId = randomUUID();
          tx.insert(listItems).values({ id: itemId, listId: list.id, workspaceId, position: position + offset, title: item.title, quantity: item.quantity, unit: item.unit, revision: 1, createdByUserId: actor.id, createdByDisplayName: name, createdAt: at, contentChangedAt: at, contentChangedByDisplayName: name, checkChangedAt: at, checkChangedByDisplayName: name }).run();
          return itemId;
        });
        tx.update(lists).set({ revision: list.revision + 1, updatedAt: at }).where(eq(lists.id, list.id)).run();
        tx.insert(recipeShoppingOperations).values({ id: input.operationId, userId: actor.id, workspaceId, payloadHash: hash, itemIds, at }).run();
        recordSecurityEvent(tx, { type: 'RECIPE_SHOPPING_TRANSFERRED', actor: actorStamp(actor), subjectType: 'workspace', subjectId: workspaceId, occurredAt: at, metadata: { recipeId: id, listId: list.id, count: itemIds.length, servings: input.servings } });
        return { itemIds, duplicate: false };
        };
  return {
    async list(workspaceId, query, archived, offset) {
      const rows = db.select().from(recipes).where(and(eq(recipes.workspaceId, workspaceId), eq(recipes.archived, archived))).orderBy(desc(recipes.updatedAt), desc(recipes.id)).limit(1000).all();
      const needle = query.toLocaleLowerCase();
      const matches = rows.filter(row => [row.content.title, row.content.instructions, ...row.content.tags, ...row.content.ingredients.map(item => item.name)].join('\n').toLocaleLowerCase().includes(needle));
      return { recipes: matches.slice(offset, offset + 30).map(view), more: matches.length > offset + 30 };
    },
    async find(workspaceId, id) { const row = db.select().from(recipes).where(and(eq(recipes.id, id), eq(recipes.workspaceId, workspaceId))).get(); return row ? view(row) : undefined; },
    async save(workspaceId,actor,id,revision,content,archived,at){return db.transaction(tx=>saveTx(tx,workspaceId,actor,id,revision,content,archived,at),IMMEDIATE);},
    async transfer(workspaceId,actor,id,input,at){return db.transaction(tx=>transferTx(tx,workspaceId,actor,id,input,at),IMMEDIATE);},
    async createWithOperation(workspaceId,actor,operationId,content,at){return db.transaction(tx=>{
     if(!guard(tx,workspaceId,actor,true))throw new NotAuthorizedError();const hash=createHash('sha256').update(JSON.stringify({kind:'createRecipe',content})).digest('hex');const previous=tx.select().from(recipeMealOperations).where(eq(recipeMealOperations.id,operationId)).get();
     if(previous){if(previous.userId!==actor.id||previous.workspaceId!==workspaceId||previous.payloadHash!==hash)throw new RecipeConflictError();return {recipeId:previous.recipeId,duplicate:true};}
     const recipe=saveTx(tx,workspaceId,actor,undefined,0,content,false,at);tx.insert(recipeMealOperations).values({id:operationId,workspaceId,userId:actor.id,payloadHash:hash,recipeId:recipe.id,itemIds:[],at}).run();return {recipeId:recipe.id,duplicate:false};
    },IMMEDIATE);},
    async meal(workspaceId,actor,input,at){return db.transaction(tx=>{
     if(!guard(tx,workspaceId,actor,true)||!actorAllowed(tx,workspaceId,actorStamp(actor),{tool:'LISTS',actorMay:role=>roleHasCapability(role,'list.edit')}))throw new NotAuthorizedError();
     const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');const previous=tx.select().from(recipeMealOperations).where(eq(recipeMealOperations.id,input.operationId)).get();
     if(previous){if(previous.userId!==actor.id||previous.workspaceId!==workspaceId||previous.payloadHash!==hash)throw new RecipeConflictError();return {recipeId:previous.recipeId,itemIds:previous.itemIds,duplicate:true};}
     // The operation records the new Recipe id atomically; no partially committed Recipe is possible.
     const existing=input.recipeId?tx.select().from(recipes).where(and(eq(recipes.id,input.recipeId),eq(recipes.workspaceId,workspaceId))).get():undefined;
     if(input.recipeId&&(!existing||existing.archived))throw new RecipeNotFoundError();
     if(!existing&&(!input.content||markdownAttachments(input.content.instructions).length===0))invalid('A new meal Recipe requires an image');
     const recipe=existing?view(existing):saveTx(tx,workspaceId,actor,undefined,0,parseRecipeContent(input.content),false,at);
     if(existing&&input.recipeRevision!==existing.revision)throw new RecipeConflictError();
     const projection=scaleRecipeIngredients(recipe,input.servings);if(projection.some(item=>item.requiresReview))invalid('Ingredient quantities require explicit review through the regular transfer');
     const result=transferTx(tx,workspaceId,actor,recipe.id,{operationId:input.operationId,recipeRevision:recipe.revision,listId:input.listId,listRevision:input.listRevision,servings:input.servings,items:projection.map((item,ingredient)=>({ingredient,title:normalizeListItemTitle(item.name),quantity:normalizeListItemQuantity(item.quantity),unit:normalizeListItemUnit(item.unit||null)}))},at);
     tx.insert(recipeMealOperations).values({id:input.operationId,workspaceId,userId:actor.id,payloadHash:hash,recipeId:recipe.id,itemIds:result.itemIds,at}).run();return {recipeId:recipe.id,itemIds:result.itemIds,duplicate:false};
    },IMMEDIATE);},
  };
}
