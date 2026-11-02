import {describe,expect,it} from 'vitest';
import {markdownAttachments,remapMarkdownAttachments,remapMarkdownRecordLinks,markdownOutline} from './markdown.ts';
const A='00000000-0000-4000-8000-000000000001';const B='00000000-0000-4000-8000-000000000002';
describe('portable Markdown references',()=>{
 it('rewrites actual destinations without changing code, alt text, titles or unsupported source',()=>{
  const url=`attachments/${A}.png`;
  const source=`![${url}](${url} "${url}")\n\n![angle](<${url}>)\n\n![reference][photo]\n\n[photo]: ${url}\n\n\`${url}\`\n\n\`\`\`markdown\n![code](${url})\n\`\`\`\n\n:::unsupported\n`;
  expect(markdownAttachments(source)).toHaveLength(3);
  const result=remapMarkdownAttachments(source,()=>B);
  expect(result).toContain(`![${url}](attachments/${B}.png "${url}")`);expect(result).toContain(`![angle](<attachments/${B}.png>)`);expect(result).toContain(`[photo]: attachments/${B}.png`);expect(result).toContain(`![code](${url})`);expect(result).toContain(':::unsupported');
 });
 it('remaps record links structurally and generates distinct heading anchors',()=>{
  const url=`/w/${A}/notes/${B}`;const source=`[Note](<${url}>)\n\n\`[literal](${url})\``;
  expect(remapMarkdownRecordLinks(source,()=> 'note.md')).toBe(`[Note](<note.md>)\n\n\`[literal](${url})\``);
  expect(markdownOutline('# A\n\n## A\n\n### Café')).toEqual([{text:'A',anchor:'a',depth:1},{text:'A',anchor:'a-1',depth:2},{text:'Café',anchor:'café',depth:3}]);
 });
});
