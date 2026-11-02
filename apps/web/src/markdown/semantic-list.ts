import {t} from '../i18n/index.ts';
import {$view} from '@milkdown/kit/utils';
import {listItemSchema} from '@milkdown/kit/preset/commonmark';
/** Native list semantics and a labelled keyboard-operable task checkbox. */
export const semanticListItems=$view(listItemSchema.node,()=> (initial,view,getPos)=>{
 let node=initial;const dom=document.createElement('li');const contentDOM=document.createElement('div');const target=document.createElement('label');target.className='markdown-task-target';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.contentEditable='false';checkbox.className='markdown-task';
 const update=()=>{target.hidden=node.attrs.checked==null;checkbox.hidden=node.attrs.checked==null;checkbox.checked=node.attrs.checked===true;checkbox.setAttribute('aria-label',node.textContent||t('markdown.task'));dom.dataset.task=String(node.attrs.checked!=null);};
 update();checkbox.addEventListener('change',()=>{const position=getPos();if(typeof position==='number'&&view.editable)view.dispatch(view.state.tr.setNodeMarkup(position,undefined,{...node.attrs,checked:checkbox.checked}));});target.append(checkbox);dom.append(target,contentDOM);
 return {dom,contentDOM,update(next){if(next.type!==node.type)return false;node=next;update();return true;},stopEvent:event=>event.target instanceof Node&&target.contains(event.target),ignoreMutation:mutation=>mutation.type!=='selection'&&!contentDOM.contains(mutation.target)};
});
