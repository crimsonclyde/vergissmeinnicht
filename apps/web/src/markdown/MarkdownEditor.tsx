import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { IconBold, IconItalic, IconH2, IconList, IconQuote, IconArrowBackUp, IconArrowForwardUp, IconDots } from '@tabler/icons-react';
import { t } from '../i18n/index.ts';
import { Markdown, needsSourceMode } from './Markdown.tsx';
import '@milkdown/crepe/theme/common/style.css';
import './markdown.css';

const FORMATS = ['bold','italic','heading','list','quote','undo','redo'] as const;
type Format = typeof FORMATS[number];
const FORMAT_LABELS = {bold:'markdown.bold',italic:'markdown.italic',heading:'markdown.heading',list:'markdown.list',quote:'markdown.quote',undo:'markdown.undo',redo:'markdown.redo'} as const;
const FORMAT_ICONS = {bold:IconBold,italic:IconItalic,heading:IconH2,list:IconList,quote:IconQuote,undo:IconArrowBackUp,redo:IconArrowForwardUp};

/** One editor for all consumers. Uploads/URLs come from the authorized feature adapter. */
export function MarkdownEditor({value,onChange,resolveImage,upload,sourceMode,onSourceModeChange,visualOnly=false}: {visualOnly?:boolean;sourceMode?:boolean;onSourceModeChange?:(source:boolean)=>void;value:string;onChange:(value:string)=>void;resolveImage?:(path:string)=>string|undefined;upload?:(file:File)=>Promise<string>}) {
 const [moreFormats,setMoreFormats]=useState(false);
 const lifecycle=useRef<Promise<unknown>>(Promise.resolve());
 const commands=useRef<Partial<Record<Format,()=>void>>>({});
 const id=useId(); const root=useRef<HTMLDivElement>(null); const latest=useRef({value,onChange,resolveImage,upload,onSourceModeChange});const edited=useRef(false);
 useLayoutEffect(()=>{latest.current={value,onChange,resolveImage,upload,onSourceModeChange};},[value,onChange,resolveImage,upload,onSourceModeChange]);
 const [requestedSource,setSource]=useState(()=>sourceMode===true||needsSourceMode(value));const [error,setError]=useState(false);const [loading,setLoading]=useState(()=>!(sourceMode===true||needsSourceMode(value)));
 const source=requestedSource&&(!visualOnly||needsSourceMode(value)||error);
 useEffect(()=>{
  if(source || !root.current) return;
  let cancelled=false; let cleanup:(()=>Promise<unknown>)|undefined;
  setLoading(true);
  const previous=lifecycle.current;
  const initialization=(async()=>{
   // A quick source/visual switch must finish creation before teardown and the next editor.
   await previous;if(cancelled)return;
   const [{Crepe},{languages},{$prose,callCommand},{Plugin},{serializerCtx,editorViewOptionsCtx,editorViewCtx},{HighlightStyle,syntaxHighlighting},{tags},{EditorView:CodeEditorView},{semanticListItems},commonmark,history]=await Promise.all([import('@milkdown/crepe'),import('@codemirror/language-data'),import('@milkdown/kit/utils'),import('@milkdown/kit/prose/state'),import('@milkdown/kit/core'),import('@codemirror/language'),import('@lezer/highlight'),import('@codemirror/view'),import('./semantic-list.ts'),import('@milkdown/kit/preset/commonmark'),import('@milkdown/kit/plugin/history')]);
   if(cancelled || !root.current) return;
   const uploader=async(file:File)=>{if(!latest.current.upload) throw new Error('Image upload unavailable');return latest.current.upload(file);};
   const crepe=new Crepe({root:root.current,defaultValue:latest.current.value,features:{[Crepe.Feature.AI]:false,[Crepe.Feature.ListItem]:false,[Crepe.Feature.Latex]:false},featureConfigs:{
    [Crepe.Feature.ImageBlock]:{onUpload:uploader,inlineOnUpload:uploader,blockOnUpload:uploader,proxyDomURL:url=>latest.current.resolveImage?.(url) ?? '',onImageLoadError:()=>{}},
    [Crepe.Feature.Table]:{addRowIcon:t('markdown.addRow'),addColIcon:t('markdown.addColumn'),deleteRowIcon:t('markdown.deleteRow'),deleteColIcon:t('markdown.deleteColumn')},
    [Crepe.Feature.CodeMirror]:{languages,extensions:[CodeEditorView.contentAttributes.of({'aria-label':t('markdown.code')}),syntaxHighlighting(HighlightStyle.define([{tag:tags.keyword,color:'var(--accent)',fontWeight:'bold'},{tag:tags.string,color:'var(--text)',fontStyle:'italic'},{tag:tags.comment,color:'var(--text-muted)'},{tag:tags.number,color:'var(--text)'},{tag:tags.name,color:'var(--text)'}]))]},
   }});
   let ready=false;edited.current=false;crepe.setReadonly(true);
   // The library listener is debounced. Observe canonical transactions synchronously so a mode
   // switch or immediate Save cannot discard the last keystroke.
   crepe.editor.use(semanticListItems);
   crepe.editor.config(ctx=>ctx.update(editorViewOptionsCtx,previous=>({...previous,attributes:{role:'textbox','aria-label':t('journal.body'),'aria-multiline':'true'}})));
   crepe.editor.use($prose(ctx=>new Plugin({props:{handleDOMEvents:{beforeinput:()=>{edited.current=true;return false;},input:()=>{edited.current=true;return false;}}},view:()=>({update:(view,previous)=>{if(ready&&!cancelled&&(edited.current||view.hasFocus())&&!view.state.doc.eq(previous.doc)){latest.current.onChange(ctx.get(serializerCtx)(view.state.doc));}}})})));
   cleanup=()=>crepe.destroy();
   await crepe.create();
   if(cancelled)return;
   ready=true;crepe.setReadonly(false);
   const run=(command:()=>void)=>{edited.current=true;command();crepe.editor.action(ctx=>ctx.get(editorViewCtx).focus());};
   commands.current={
    bold:()=>run(()=>crepe.editor.action(callCommand(commonmark.toggleStrongCommand.key))),
    italic:()=>run(()=>crepe.editor.action(callCommand(commonmark.toggleEmphasisCommand.key))),
    heading:()=>run(()=>crepe.editor.action(callCommand(commonmark.wrapInHeadingCommand.key,2))),
    list:()=>run(()=>crepe.editor.action(callCommand(commonmark.wrapInBulletListCommand.key))),
    quote:()=>run(()=>crepe.editor.action(callCommand(commonmark.wrapInBlockquoteCommand.key))),
    undo:()=>run(()=>crepe.editor.action(callCommand(history.undoCommand.key))),
    redo:()=>run(()=>crepe.editor.action(callCommand(history.redoCommand.key))),
   };
   setLoading(false);
  })().catch(()=>{if(!cancelled){setError(true);setSource(true);setLoading(false);}});
  return ()=>{cancelled=true;commands.current={};lifecycle.current=initialization.then(()=>cleanup?.()).catch(()=>undefined);};
 },[source]);
 return <div className="stack markdown-editor">
  {!visualOnly&&<div className="markdown-modes" role="group" aria-label={t('markdown.mode')}>
   <button type="button" aria-pressed={!source} disabled={needsSourceMode(value)} onClick={()=>{setSource(false);onSourceModeChange?.(false);}}>{t('markdown.visual')}</button>
   <button type="button" aria-pressed={source} onClick={()=>{setSource(true);onSourceModeChange?.(true);}}>{t('markdown.source')}</button>
  </div>}
  {!source&&<div className="markdown-formatting" data-expanded={moreFormats} role="group" aria-label={t('markdown.formatting')}>{FORMATS.map(format=>{const Icon=FORMAT_ICONS[format];return <button key={format} type="button" aria-label={t(FORMAT_LABELS[format])} title={t(FORMAT_LABELS[format])} disabled={loading} onMouseDown={event=>event.preventDefault()} onClick={()=>commands.current[format]?.()}><Icon size={20} aria-hidden="true"/><span>{t(FORMAT_LABELS[format])}</span></button>;})}<button className="markdown-more" type="button" aria-label={t('markdown.moreFormatting')} title={t('markdown.moreFormatting')} aria-expanded={moreFormats} onClick={()=>setMoreFormats(value=>!value)}><IconDots size={20} aria-hidden="true"/></button></div>}
  {visualOnly&&source&&!error&&<p role="status">{t('markdown.phonePreserve')}</p>}
  {!visualOnly&&needsSourceMode(value) && <small className="muted">{t('markdown.preserve')}</small>}
  {error && <p role="status">{t(visualOnly?'markdown.phoneLoadError':'markdown.loadError')}</p>}
  {source&&visualOnly?<Markdown source={value} {...(resolveImage?{resolveImage}:{})}/>:source?<><label htmlFor={id}>{t('markdown.source')}</label><textarea id={id} className="markdown-source" value={value} maxLength={50000} onChange={event=>onChange(event.target.value)}/></>:<><label id={id}>{t('journal.body')}</label>{loading&&<p role="status">{t('journal.loading')}</p>}<div ref={root} inert={loading} onInputCapture={()=>{edited.current=true;}} onPasteCapture={()=>{edited.current=true;}} onDropCapture={()=>{edited.current=true;}} onClickCapture={()=>{edited.current=true;}} onKeyDownCapture={()=>{edited.current=true;}} className="milkdown-host" aria-labelledby={id}/></>}
 </div>;
}
