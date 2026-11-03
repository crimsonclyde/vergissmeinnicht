import {useMemo} from 'react';
import {api,attachmentUrl,uploadJournalImage,type AttachmentClient} from '../../api.ts';
import {AttachmentPanel} from '../../attachments/AttachmentPanel.tsx';
export {imageReference} from '../../attachments/AttachmentPanel.tsx';
export function JournalImages({workspaceId,...props}:{workspaceId:string|undefined;initiallyOpen?:boolean;refreshVersion:number;onInsert:(text:string)=>void;onError:(text:string)=>void}){
 const client=useMemo<AttachmentClient>(()=>({list:()=>api.attachments(workspaceId),usage:()=>api.attachmentUsage(workspaceId),upload:file=>uploadJournalImage(workspaceId,file),regenerate:id=>api.regenerateAttachment(workspaceId,id),url:(id,kind)=>attachmentUrl(workspaceId,id,kind)}),[workspaceId]);
 return <AttachmentPanel client={client} {...props}/>;
}
