import test from 'node:test';
import assert from 'node:assert/strict';
import {FilingDateParser,IndictmentParser,emptyDefendant,ageMarks} from '../src/core.js';
import {batchSummary,extractionFailures,saveMemosToFolder} from '../src/batch-save.js';
const page=text=>({text,height:842,lines:text.split('\n').map((text,i)=>({text,y:i*12}))});
const body='가상지방검찰청 가상지청\n2026. 11. 10.\n검 사 김가상 (인)\n제 목 공소장\nⅠ. 피고인 관련사항\n피고인 이가상 (080318-3******)\n죄명 절도\n구속여부 불구속\n변호인 없음\nⅡ. 공소사실\n범죄일시 2026.1.2.';
for(const [id,header]of[
 ['same','제출일시: 2026.11.10. 13:55'],['later','제출일시: 2026.11.12. 13:55'],['earlier','제출일시: 2026.11.08. 13:55'],
 ['download differs','다운로드일시 2026.11.15. 14:00\n제출일시: 2026.11.12.'],['no submission','열람복사용 안내 출력자 가상'],['ordinary',''],['broken submission','제출일시: 판독불가'],
])test('body date ignores copy metadata: '+id,()=>{
 const d=FilingDateParser.assess(page(header+'\n'+body));assert.equal(d.date,'2026-11-10');assert.equal(d.reason,'');assert.ok(d.candidates.every(c=>c.source!=='submission'));
});
test('body candidates conflict without borrowing download/submission dates',()=>{
 const d=FilingDateParser.assess(page('제출일시 2026.11.10.\n가상지방검찰청\n2026.11.10.\n다른검찰청\n2026.11.11.\n검사 김가상\n피고인 이가상'));
 assert.equal(d.date,null);assert.match(d.reason,/충돌/);
});
test('explicit filing field takes priority over agency body date, but explicit conflicts stay unresolved',()=>{
 for(const text of ['기소일 2026.11.09.\n'+body,body.replace('검 사','기소일\n2026.11.09.\n검 사')])assert.equal(FilingDateParser.parse(page(text)),'2026-11-09');
 assert.equal(FilingDateParser.parse(page('기소일 2026.11.09.\n공소제기일 2026.11.08.\n'+body)),null);
});
test('submission alone, crime/arrest/detention/DOB dates cannot supply filing date',()=>{
 for(const text of ['제출일시: 2026.11.12.','열람복사용\n다운로드일시:2026.11.12.\n가상지방검찰청\n피고인 이가상', '범죄일시\n2026.1.2.\n피고인 이가상','구속일\n2026.1.2.\n피고인 이가상','체포일\n2026.1.2.\n피고인 이가상'])assert.equal(FilingDateParser.parse(page(text)),null);
});
test('repeated copy headers across pages have no effect on the first-page body date or other fields',()=>{
 const header='열람복사용 안내 출력자 가상 다운로드일시: 2026.11.18.\n가상법원 2026고단1001 제출일시:2026.11.12.';
 const p=page(header+'\n'+body),p2=page(header+'\nⅢ. 첨부\n가상 첨부목록');
 const d=IndictmentParser.parse({text:p.text+'\n'+p2.text,pages:[p,p2],usedOCR:false});
 assert.equal(d.filingDate,'2026-11-10');assert.equal(d.prosecutor,'김가상');assert.deepEqual(d.defendants[0].charges,['절도']);assert.equal(d.defendants[0].detention,'released');
});
const entry=i=>({bytes:new Uint8Array([37,80,68,70,i]),filename:`1000 2026고단${1000+i}.pdf`,revision:0,saveRevision:-1,saveState:'idle',generationState:'generated',missingFields:[],hasWarnings:false});
test('one batch operation sequentially writes all 10 files and awaits close completion',async()=>{
 const entries=Array.from({length:10},(_,i)=>entry(i)),folder={};let open=0;const events=[];
 await saveMemosToFolder(entries,folder,{writer:async(f,n,b)=>{assert.equal(f,folder);assert.equal(open,0);open++;events.push(n);await Promise.resolve();assert.equal(b[0],37);open--;}});
 assert.deepEqual(events,entries.map(e=>e.filename));assert.equal(batchSummary(entries).saved,10);
 await saveMemosToFolder(entries,folder,{writer:async()=>assert.fail('already saved entries must not be overwritten')});
});
test('partial save failure is isolated, leaves extraction status alone, and can retry one file',async()=>{
 const entries=[entry(1),entry(2),entry(3)],folder={};entries[1].missingFields=['검사','기소일'];entries[1].hasWarnings=true;
 await saveMemosToFolder(entries,folder,{writer:async(f,n)=>{if(n===entries[1].filename)throw Error('시험 쓰기 실패');}});
 assert.deepEqual(entries.map(e=>e.saveState),['saved','failed','saved']);assert.equal(entries[1].saveError,'시험 쓰기 실패');
 assert.deepEqual(batchSummary(entries),{total:3,generated:3,saved:2,saveFailed:1,warnings:1,generationFailed:0,pending:0});
 await saveMemosToFolder([entries[1]],folder,{writer:async()=>{}});assert.equal(batchSummary(entries).saved,3);assert.deepEqual(entries[1].missingFields,['검사','기소일']);
});
test('generation failures, pending/download requests and actual saves have distinct summary counts',()=>{
 const a=entry(0),b={...entry(1),bytes:null,generationState:'failed'},c={...entry(2),downloadRequested:true};
 assert.deepEqual(batchSummary([a,b,c]),{total:3,generated:2,saved:0,saveFailed:0,warnings:0,generationFailed:1,pending:2});
});
test('stale input while writing is never presented as current saved result',async()=>{
 const e=entry(1);await saveMemosToFolder([e],{},{writer:async()=>{e.revision++;}});assert.equal(e.saveState,'deferred');assert.equal(batchSummary([e]).saved,0);
});
test('extraction failures are named separately from generation and saving status',()=>{
 const d={prosecutor:'',filingDate:null,defendants:[{...emptyDefendant(),name:'이가상',charges:[]}]};
 const missing=extractionFailures(d);for(const key of ['검사','기소일','생년월일','죄명','변호인','구속 여부'])assert.ok(missing.includes(key));
 assert.deepEqual(extractionFailures(null),[]);
});

test('two conflicting dates under the same explicit field remain unconfirmed',()=>{
 assert.equal(FilingDateParser.parse(page('기소일 2026.11.09.\n2026.11.10.\n'+body)),null);
});

test('body date also drives age marks, rather than a later copy-submission birthday',()=>{
 const text='제출일시 2026.11.12.\n'+body.replace('080318-3******','561111-1******');
 const d=IndictmentParser.parse({text,pages:[page(text)],usedOCR:false});assert.equal(d.filingDate,'2026-11-10');assert.equal(ageMarks(d).mandatory,false);
});
