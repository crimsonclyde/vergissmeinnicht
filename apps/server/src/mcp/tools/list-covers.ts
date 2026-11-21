import { z } from 'zod';
import { authorizeListAppearance, changeListAppearance, listLists } from '@vergissmeinnicht/application';
import { type ListId } from '@vergissmeinnicht/domain';
import { MCP_IMAGE_BASE64_LENGTH, uploadDelegatedImage, uploadDelegatedImageFile } from '../recipe-upload.ts';
import { chatGptFile, define, fileUpload, otherClients, revision, uuid, workspace, type AssistantTool } from './shared.ts';

export const listCoversTools: AssistantTool[] = [
 define('list_cover_targets','Find Shopping and To-do Lists for an explicitly requested cover change. Ask which List and Workspace if the destination is ambiguous. Returns cover status and the current revision, without checklist entries.','lists.covers.write','LISTS',false,workspace,async({services,actor,workspaceId})=>({lists:(await listLists(services.lists,{actor,workspaceId})).map(({list})=>({id:list.id,title:list.title,kind:list.kind,revision:list.revision,coverId:list.coverId}))})),
 otherClients(define('open_list_cover_upload','Open the file picker for a List cover. Resolve the List and Workspace first. Then use set_list_cover to apply the returned attachment to the reviewed List revision.','lists.covers.write','LISTS',true,{...workspace,listId:uuid},async({services,actor,workspaceId},input)=>{
  await authorizeListAppearance(services.lists,{actor,workspaceId,listId:input.listId as ListId});
  return {workspaceId,listId:input.listId};
 })),
 otherClients(define('upload_list_cover','Upload real JPEG or PNG bytes as canonical base64 for an existing List, up to 20 MB. Keep the operation ID and payload on retries. Use set_list_cover with the returned attachment id and the reviewed revision to save it.','lists.covers.write','LISTS',true,{...workspace,listId:uuid,operationId:uuid,fileName:z.string().min(1).max(255),imageBase64:z.string().min(4).max(MCP_IMAGE_BASE64_LENGTH)},async({services,actor,workspaceId},input)=>{
  const authorize=()=>authorizeListAppearance(services.lists,{actor,workspaceId,listId:input.listId as ListId});
  return uploadDelegatedImage(services.listAttachments,actor,workspaceId,authorize,{...input,targetId:input.listId});
 })),
 fileUpload(define('upload_list_cover_file','Upload a JPEG, PNG or WebP image available as a file in ChatGPT (generated, attached or extracted). Resolve the List and Workspace first. Use the returned attachment ID with set_list_cover at the reviewed revision. Reuse the operation ID for the same file on retries.','lists.covers.write','LISTS',true,{...workspace,listId:uuid,operationId:uuid,file:chatGptFile},async({services,actor,workspaceId},input)=>{
  const authorize=()=>authorizeListAppearance(services.lists,{actor,workspaceId,listId:input.listId as ListId});
  return uploadDelegatedImageFile(services.listAttachments,actor,workspaceId,authorize,services.chatGptFileSource,{...input,targetId:input.listId},services.chatGptFileHosts);
 })),
 define('set_list_cover','Set or replace a List cover with the uploaded attachment ID, or pass null to remove it when explicitly requested. Resolve the target and use its reviewed revision.','lists.covers.write','LISTS',true,{...workspace,listId:uuid,expectedRevision:revision,coverId:uuid.nullable()},async({services,actor,workspaceId},input)=>{
  const {list}=await changeListAppearance(services.lists,{actor,workspaceId,listId:input.listId as ListId,expectedRevision:input.expectedRevision,appearance:{coverId:input.coverId}});
  return {id:list.id,revision:list.revision,coverId:list.coverId};
 }),
];
