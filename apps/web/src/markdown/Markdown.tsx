import {markdownHasOpaqueSyntax,markdownOutline} from '@vergissmeinnicht/domain';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t } from '../i18n/index.ts';

export const attachmentDestination = /^attachments\/([0-9a-f-]{36})\.(jpg|png)$/;
export function headingAnchor(text: string): string { return text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-') || 'heading'; }
/** External image addresses are never fetched. References resolve only through authenticated routes. */
export function Markdown({source, resolveImage,resolveOriginal}: {source:string;resolveImage?:(path:string)=>string|undefined;resolveOriginal?:(path:string)=>string|undefined}) {
 const outline=markdownOutline(source);let headingIndex=0;
 const heading=(Tag:'h1'|'h2'|'h3'|'h4'|'h5'|'h6',children:import('react').ReactNode)=><Tag id={outline[headingIndex++]?.anchor}>{children}</Tag>;
 return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url,key)=>key==='src' ? (attachmentDestination.test(url)?url:'') : /^(?:https?:|mailto:|#|\/w\/)/i.test(url)?url:''} components={{
 h1:({children})=>heading('h1',children),h2:({children})=>heading('h2',children),h3:({children})=>heading('h3',children),h4:({children})=>heading('h4',children),h5:({children})=>heading('h5',children),h6:({children})=>heading('h6',children),
 img:({src,alt})=>{const url=src ? resolveImage?.(src) : undefined;return url?<figure><img src={url} alt={alt??''} loading="lazy"/><figcaption>{alt} · {t('journal.previewLabel')} {src&&resolveOriginal?.(src)&&<a href={resolveOriginal(src)} download>{t('journal.downloadOriginal')}</a>}</figcaption></figure>:<span>{alt || t('markdown.imageUnavailable')}</span>;},
 a:({href,children})=><a href={href} rel="noopener noreferrer">{children}</a>,
 table:({children})=><div className="markdown-table"><table>{children}</table></div>,
 }}>{source}</ReactMarkdown></div>;
}
/** Unknown extensions remain editable in source without a lossy parse/serialize pass. */
export function needsSourceMode(source:string):boolean {
 return markdownHasOpaqueSyntax(source) || /(^\s*\[[^\]]+\]:|^\s*:::|^\s*<|\$\$|\[\^|\{[%{]|^---\s*\n[\s\S]*?\n---)/m.test(source);
}
