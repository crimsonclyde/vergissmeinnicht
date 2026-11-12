import {describe,expect,it} from 'vitest';
import {journalMarkdown,journalSummary,parseJournalMarkdown} from './portable.ts';
import {parseJournalContent} from './index.ts';

const A='00000000-0000-4000-8000-000000000001';
describe('portable Markdown entries',()=>{
 it('summarises text, the first own image and checklist progress without touching the body',()=>{
  const body=`## Visit\n\nReplaced the **pressure valve**.\n\n![valve](attachments/${A}.jpg)\n\n- [x] Bleed radiators\n- [ ] Check pressure\n\n\`\`\`\ncode stays out\n\`\`\``;
  const summary=journalSummary(body);
  expect(summary.excerpt).toBe('Visit · Replaced the pressure valve. · Bleed radiators · Check pressure');
  expect(summary.cover).toBe(`attachments/${A}.jpg`);
  expect(summary.tasks).toEqual({done:1,total:2});
  expect(journalSummary('x '.repeat(400),2,40).excerpt.length).toBeLessThanOrEqual(40);
  expect(journalSummary('Plain *text*',1).excerpt).toBe('Plain *text*');
 });
 it('reads the exported front matter and title heading back exactly',()=>{
  const body='Technician came.\n\n- [ ] Check\n';
  const exported=`---\ntitle: "Boiler: service"\ndate: "2026-11-03"\ncollection: "House"\ntags: ["heating","service"]\npinned: true\n---\n\n# Boiler: service\n\n${body}`;
  expect(parseJournalMarkdown(exported,'boiler.md')).toEqual({kind:'note',version:2,title:'Boiler: service',date:'2026-11-03',body,collection:'House',tags:['heating','service'],pinned:true});
  expect(parseJournalMarkdown('# Escaped \\*star\\*\n\nText','x.md').title).toBe('Escaped *star*');
 });
 it('accepts plain Markdown from other apps and stays inside the entry limits',()=>{
  const plain=parseJournalMarkdown('﻿Just text\r\nsecond line','garden_plan-2026.md');
  expect(plain).toMatchObject({title:'garden plan 2026',date:null,body:'Just text\nsecond line',collection:'',tags:[],pinned:false});
  const typed=parseJournalMarkdown('---\ntitle: Trip\nnotebook: Van\ntags: [a, #b, a]\ndate: 2026-02-30\n---\nBody','t.md');
  expect(typed).toMatchObject({title:'Trip',collection:'Van',tags:['a','b'],date:null,body:'Body'});
  const long=parseJournalMarkdown(`---\ntitle: ${'t'.repeat(400)}\ntags: [${Array.from({length:20},(_,i)=>'tag'+i).join(',')}]\n---\n`,'x.md');
  expect(()=>parseJournalContent(long)).not.toThrow();
  expect(long.tags).toHaveLength(10);
  // Different heading and front-matter title: the heading is content and stays in the body.
  expect(parseJournalMarkdown('---\ntitle: A\n---\n# B\n','x.md')).toMatchObject({title:'A',body:'# B\n'});
 });
 it('round-trips export and import for every kind of title and body',()=>{
  for(const content of [
   {kind:'note' as const,version:2 as const,title:'A [tricky] #title - with *stars*',date:'2024-02-29',body:'---\nnot front matter\n---\n\n# Inner heading\n\n```\ncode\n```\n',collection:'Van & Co',tags:['a','b c'],pinned:true},
   {kind:'note' as const,version:2 as const,title:'C# and F#',date:null,body:'',collection:'',tags:[],pinned:false},
   {kind:'note' as const,version:2 as const,title:'Only body',date:null,body:'\n\n  indented first line\n',collection:'',tags:[],pinned:false},
  ]) expect(parseJournalMarkdown(journalMarkdown(content),'x.md')).toEqual(content);
 });
});
