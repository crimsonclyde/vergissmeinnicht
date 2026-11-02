export const DEFAULT_ATTACHMENT_UPLOAD_BYTES = 20_000_000;
export const DEFAULT_ATTACHMENT_QUOTA_BYTES = 500_000_000;
export const ATTACHMENT_DERIVATIVE_BUDGET = 2_000_000;
export type AttachmentScope = {readonly workspaceId:string} | {readonly ownerId:string};
export interface AttachmentRecord {
 readonly id:string;readonly scope:AttachmentScope;readonly uploadedBy:string|null;readonly name:string;readonly format:'JPEG'|'PNG';readonly bytes:number;readonly sha256:string;
 readonly originalKey:string;readonly previewKey:string;readonly previewBytes:number;readonly previewHash:string;readonly thumbnailKey:string;readonly thumbnailBytes:number;readonly thumbnailHash:string;readonly width:number;readonly height:number;readonly at:Date;
}
export interface AttachmentPolicy {readonly maxUploadBytes:number;readonly defaultQuotaBytes:number;readonly serverLimitBytes:number|null;readonly formats:readonly ('JPEG'|'PNG')[]}
export interface AttachmentUsage {readonly used:number;readonly reserved:number;readonly limit:number;readonly remaining:number}
