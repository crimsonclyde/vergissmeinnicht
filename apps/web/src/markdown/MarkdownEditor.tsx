import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { needsSourceMode } from './Markdown.tsx';
import '@milkdown/crepe/theme/common/style.css';
import './markdown.css';

/** One editor for all consumers. Uploads/URLs come from the authorized feature adapter. */
export function MarkdownEditor({value,onChange,resolveImage,upload,sourceMode,onSourceModeChange}: {sourceMode?:boolean;onSourceModeChange?:(source:boolean)=>void;value:string;onChange:(value:string)=>void;resolveImage?:(path:string)=>string|undefined;upload?:(file:File)=>Promise<string>}) {
 const id=useId(); const root=useRef<HTMLDivElement>(null); const latest=useRef({value,onChange,resolveImage,upload,onSourceModeChange});const edited=useRef(false);
 useLayoutEffect(()=>{latest.current={value,onChange,resolveImage,upload,onSourceModeChange};},[value,onChange,resolveImage,upload,onSourceModeChange]);
 const [source,setSource]=useState(()=>sourceMode===true||needsSourceMode(value));const [error,setError]=useState(false);const [loading,setLoading]=useState(false);
 useEffect(()=>{
  if(source || !root.current) return;
  let cancelled=false; let cleanup:(()=>Promise<unknown>)|undefined;
  setLoading(true);
  void (async()=>{
   const [{Crepe},{languages},{$prose},{Plugin},{serializerCtx,editorViewOptionsCtx},{HighlightStyle,syntaxHighlighting},{tags},{EditorView:CodeEditorView},{semanticListItems}]=await Promise.all([import('@milkdown/crepe'),import('@codemirror/language-data'),import('@milkdown/kit/utils'),import('@milkdown/kit/prose/state'),import('@milkdown/kit/core'),import('@codemirror/language'),import('@lezer/highlight'),import('@codemirror/view'),import('./semantic-list.ts')]);
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
   crepe.editor.use($prose(ctx=>new Plugin({view:()=>({update:(view,previous)=>{if(ready&&!cancelled&&edited.current&&!view.state.doc.eq(previous.doc)){latest.current.onChange(ctx.get(serializerCtx)(view.state.doc));}}})})));
   cleanup=()=>crepe.destroy();
   await crepe.create();
   if(cancelled){await crepe.destroy();return;}
   ready=true;crepe.setReadonly(false);setLoading(false);
  })().catch(()=>{if(!cancelled){setError(true);setSource(true);setLoading(false);}});
  return ()=>{cancelled=true;void cleanup?.();};
 },[source]);
 return <div className="stack markdown-editor">
  <div className="row wrap" aria-label={t('markdown.mode')}>
   <button type="button" aria-pressed={!source} disabled={needsSourceMode(value)} onClick={()=>{setSource(false);onSourceModeChange?.(false);}}>{t('markdown.visual')}</button>
   <button type="button" aria-pressed={source} onClick={()=>{setSource(true);onSourceModeChange?.(true);}}>{t('markdown.source')}</button>
  </div>
  {needsSourceMode(value) && <small className="muted">{t('markdown.preserve')}</small>}
  {error && <p role="status">{t('markdown.loadError')}</p>}
  {source?<><label htmlFor={id}>{t('markdown.source')}</label><textarea id={id} className="markdown-source" value={value} maxLength={50000} onChange={event=>onChange(event.target.value)}/></>:<><label id={id}>{t('journal.body')}</label>{loading&&<p role="status">{t('journal.loading')}</p>}<div ref={root} onInputCapture={()=>{edited.current=true;}} onPasteCapture={()=>{edited.current=true;}} onDropCapture={()=>{edited.current=true;}} onClickCapture={()=>{edited.current=true;}} onKeyDownCapture={()=>{edited.current=true;}} className="milkdown-host" aria-labelledby={id}/></>}
 </div>;
}
