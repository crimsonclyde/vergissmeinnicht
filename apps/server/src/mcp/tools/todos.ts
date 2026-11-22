import { z } from 'zod';
import { renameList, deleteList, restoreList, getList, listLists, moveListItems, removeListItems, updateListItems, restoreListItems, listRemovedListItems } from '@vergissmeinnicht/application';
import { MAX_LIST_BATCH_ITEMS, type ListId } from '@vergissmeinnicht/domain';
import { batchItemIds, batchOperationId, define, groceryBatch, replayGroceryWrite, revision, uuid, workspace, destructive, type AssistantTool } from './shared.ts';

export const todosTools: AssistantTool[] = [
 define('list_todo_lists','List To-do Lists of the chosen Workspace with open and done counts.','todos.read','LISTS',false,workspace,async({services,actor,workspaceId})=>({lists:(await listLists(services.lists,{actor,workspaceId})).map(item=>({id:item.list.id,title:item.list.title,revision:item.list.revision,open:item.open,done:item.checked}))})),
 define('get_todo_list','Read the tasks of one To-do List with their exact ids and the List revision.','todos.read','LISTS',false,{...workspace,listId:uuid},async({services,actor,workspaceId},input)=>{const result=await getList(services.lists,{actor,workspaceId,listId:input.listId as ListId});return {id:result.list.id,title:result.list.title,revision:result.list.revision,tasks:result.items.map(item=>({id:item.id,title:item.title,done:item.checked!==null}))};}),
 define('create_todo_list','Create a To-do List when the user asks for one and no suitable List exists. Keep operationId and listId unchanged on retries.','todos.write','LISTS',true,{...workspace,listId:uuid,operationId:uuid,title:z.string().min(1).max(80)},async({services,actor,workspaceId},input)=>replayGroceryWrite(services.lists,{actor,workspaceId,clientChangeId:input.operationId,madeBy:actor.id,deviceTime:services.lists.clock.now(),change:{kind:'createList',listId:input.listId,title:input.title,listKind:'TODO'}})),
 define('add_todo_item','Append one task to a To-do List after identifying the destination; ask if several Lists or Workspaces match. Reuse operationId and itemId on retries. Never merges or replaces existing tasks.','todos.write','LISTS',true,{...workspace,listId:uuid,operationId:uuid,itemId:uuid,title:z.string().min(1).max(120)},async({services,actor,workspaceId},input)=>replayGroceryWrite(services.lists,{actor,workspaceId,clientChangeId:input.operationId,madeBy:actor.id,deviceTime:services.lists.clock.now(),change:{kind:'addItem',listId:input.listId,itemId:input.itemId,title:input.title,quantity:null,unit:null}})),
 define('update_todo_items','Rename tasks or mark them done (done true) or open again (done false) on one To-do List in one atomic operation. Read the List with get_todo_list first and use its exact ids and revision. Marking done what the user said they finished needs no extra confirmation; ask when it is unclear which tasks are meant. Keep operationId and payload unchanged on retries.','todos.write','LISTS',true,{...workspace,listId:uuid,items:z.array(z.strictObject({itemId:uuid,title:z.string().min(1).max(120).optional(),done:z.boolean().optional()})).min(1).max(MAX_LIST_BATCH_ITEMS).refine(edits=>new Set(edits.map(edit=>edit.itemId)).size===edits.length,{message:'duplicate_item_ids'}).refine(edits=>edits.every(edit=>Object.keys(edit).length>1),{message:'empty_edit'}).describe(`1 to ${MAX_LIST_BATCH_ITEMS} task changes, each task once.`),operationId:batchOperationId,expectedRevision:revision},async({services,actor,workspaceId},input)=>groceryBatch(async()=>{
  const result=await updateListItems(services.lists,{actor,workspaceId,listId:input.listId,edits:input.items.map(({itemId,title,done})=>({itemId,...(title===undefined?{}:{title}),...(done===undefined?{}:{checked:done})})),operationId:input.operationId,expectedRevision:input.expectedRevision});
  return {outcome:'UPDATED',duplicate:result.duplicate,updatedItemIds:result.itemIds,list:{id:input.listId,revision:result.revisions[input.listId]}};
 })),
 define('move_todo_items','Move the user-approved tasks from one To-do List to another To-do List of the same Workspace in one atomic operation. Read both Lists, show the user which tasks move where and wait for approval. Tasks keep their ids, titles and done state. Keep operationId and payload unchanged on retries.','todos.write','LISTS',true,{...workspace,sourceListId:uuid,destinationListId:uuid,itemIds:batchItemIds,operationId:batchOperationId,expectedSourceRevision:revision,expectedDestinationRevision:revision},async({services,actor,workspaceId},input)=>groceryBatch(async()=>{
  const result=await moveListItems(services.lists,{...input,actor,workspaceId});
  return {outcome:'MOVED',duplicate:result.duplicate,movedItemIds:result.itemIds,sourceList:{id:input.sourceListId,revision:result.revisions[input.sourceListId]},destinationList:{id:input.destinationListId,revision:result.revisions[input.destinationListId]}};
 })),
 destructive(define('delete_todo_items','Delete the user-approved tasks, done or not, from one To-do List in one atomic operation. Destructive: read the List, show exactly which tasks will be deleted and wait for explicit approval; once approved, do not ask again. Deleted tasks can be restored. Keep operationId and payload unchanged on retries.','todos.write','LISTS',true,{...workspace,listId:uuid,itemIds:batchItemIds,operationId:batchOperationId,expectedRevision:revision},async({services,actor,workspaceId},input)=>groceryBatch(async()=>{
  const result=await removeListItems(services.lists,{...input,actor,workspaceId});
  return {outcome:'DELETED',duplicate:result.duplicate,deletedItemIds:result.itemIds,list:{id:input.listId,revision:result.revisions[input.listId]}};
 }))),
 define('list_deleted_todo_items','Read the recently deleted tasks of one To-do List that can still be restored, most recent first (up to 100).','todos.read','LISTS',false,{...workspace,listId:uuid},async({services,actor,workspaceId},input)=>{
  const [list,removed]=await Promise.all([getList(services.lists,{actor,workspaceId,listId:input.listId as ListId}),listRemovedListItems(services.lists,{actor,workspaceId,listId:input.listId as ListId})]);
  return {id:list.list.id,title:list.list.title,revision:list.list.revision,deletedTasks:removed.map(entry=>({id:entry.item.id,title:entry.item.title,done:entry.item.checked!==null,deletedAt:entry.removedAt.toISOString(),deletedBy:entry.removedBy}))};
 }),
 define('restore_todo_items','Put deleted tasks back on their To-do List at their old places. Read them with list_deleted_todo_items and use those ids and the List revision. Keep operationId and payload unchanged on retries.','todos.write','LISTS',true,{...workspace,listId:uuid,itemIds:batchItemIds,operationId:batchOperationId,expectedRevision:revision},async({services,actor,workspaceId},input)=>groceryBatch(async()=>{
  const result=await restoreListItems(services.lists,{...input,actor,workspaceId});
  return {outcome:'RESTORED',duplicate:result.duplicate,restoredItemIds:result.itemIds,list:{id:input.listId,revision:result.revisions[input.listId]}};
 })),
 define('rename_todo_list','Rename a To-do List. expectedTitle is the name read with list_todo_lists; a rename by someone else meanwhile is refused.','todos.write','LISTS',true,{...workspace,listId:uuid,title:z.string().min(1).max(80),expectedTitle:z.string().max(200)},async({services,actor,workspaceId},input)=>{
  const result=await renameList(services.lists,{actor,workspaceId,listId:input.listId as ListId,title:input.title,expectedTitle:input.expectedTitle});
  return {outcome:'RENAMED',list:{id:result.list.id,title:result.list.title,revision:result.list.revision}};
 }),
 destructive(define('delete_todo_list','Delete a whole To-do List with its tasks when the user asks. It can be brought back with restore_todo_list.','todos.write','LISTS',true,{...workspace,listId:uuid},async({services,actor,workspaceId},input)=>{
  await deleteList(services.lists,{actor,workspaceId,listId:input.listId as ListId});
  return {outcome:'DELETED',listId:input.listId};
 })),
 define('restore_todo_list','Bring a deleted To-do List back with its tasks.','todos.write','LISTS',true,{...workspace,listId:uuid},async({services,actor,workspaceId},input)=>{
  const result=await restoreList(services.lists,{actor,workspaceId,listId:input.listId as ListId});
  return {outcome:'RESTORED',list:{id:result.list.id,title:result.list.title,revision:result.list.revision}};
 }),
];
