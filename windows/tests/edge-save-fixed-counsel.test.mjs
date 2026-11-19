import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parserInternals} from './parser-internals.mjs';
import {CounselParser,IndictmentParser,detentionGlyphs} from '../src/core.js';
import {folderFailureNotice} from '../src/storage.js';
const P=await parserInternals();
const beforeSource=execFileSync('git',['show','c5c40a0:windows/src/core.js'],{cwd:new URL('../..',import.meta.url)}).toString();
const B=await import('data:text/javascript;base64,'+Buffer.from(beforeSource+'\nexport {fields,values};').toString('base64'));
const document=text=>({text,usedOCR:false,pages:[{text,height:842,lines:text.split('\n').map((text,i)=>({text,y:i*12}))}]});
const indictment=(counsel,tail,detention='')=>'가상지방검찰청\n2026.11.17.\n검사 김가상\nⅠ. 피고인 관련사항\n피고인 이가상 (080318-3******)\n죄명 절도\n적용법조 가상법률 제1조\n제2조\n'+detention+counsel.join('\n')+'\n'+tail.join('\n')+'\nⅡ. 공소사실\n변호사 본문가상\nⅢ. 첨부\n가상첨부문장';
const counselCases=[
 {id:'regular',source:['변 호 인 변호사 김가상'],expected:'김가상'},
 {id:'regular-lines',source:['변 호 인','변호사','김가상'],expected:'김가상'},
 {id:'appointed',source:['변 호 인 국선변호사 김가상'],expected:'김가상(국선)'},
 {id:'appointed-lines',source:['국선변호인','변호사','김가상'],expected:'김가상(국선)'},
 {id:'firm',source:['변 호 인 법무법인 가상(담당변호사 김가상, 이가상, 박가상)'],expected:'가상) 김가상 이가상 박가상'},
 {id:'firm-wrap',source:['변 호 인 법무법인 가상(담당변호사 김가상, 강','가상, 박가상)'],expected:'가상) 김가상 강가상 박가상'},
];
for(const c of counselCases)for(const tail of [
 ['의 견 벌금 500만 원','가납명령청구'],
 ['의견 (벌금 500만 원)','가 납 명 령 청 구'],
 ['의 견','벌금 500만 원','가 납 명 령 청 구'],
 ['가 납 명 령 청 구'],
])test('fixed boundary '+c.id+' '+tail.join('/'),()=>{
 const lines=[...c.source,...tail,'Ⅱ. 공소사실','변호사 본문가상'];
 const expectedParts=c.source.map((v,i)=>i===0?v.replace(/^변\s*호\s*인\s*/,''):v).filter(Boolean);
 assert.deepEqual(P.values('변호인',lines),[expectedParts.join('\n')]);
 const fields=P.fields(lines);assert.equal(fields.find(f=>f.label==='변호인').parts.join('\n'),expectedParts.join('\n'));
 assert.ok(!P.values('변호인',lines)[0].includes('500'));assert.ok(!P.values('변호인',lines)[0].includes('명령'));
 const d=IndictmentParser.parse(document(indictment(c.source,tail)),{caseType:'고정'});
 assert.equal(d.defendants[0].counsel.status,'named');assert.equal(d.defendants[0].counsel.name,c.expected);
 assert.equal(d.defendants[0].detention,'released');assert.deepEqual(detentionGlyphs(d.defendants),[{text:'X',color:'black'}]);
 assert.equal(d.prosecutor,'김가상');assert.equal(d.filingDate,'2026-11-17');assert.deepEqual(d.defendants[0].charges,['절도']);
});
test('before/after proves opinion contamination rather than a missing counsel regex',()=>{
 const lines=['변 호 인 변호사 김가상','의 견 벌금 500만 원','가납명령청구','Ⅱ. 공소사실'];
 assert.deepEqual(B.values('변호인',lines),['변호사 김가상\n의 견 벌금 500만 원\n가납명령청구']);
 assert.equal(B.CounselParser.parse(lines,false).status,'needsReview');
 assert.deepEqual(P.values('변호인',lines),['변호사 김가상']);assert.equal(CounselParser.parse(lines,false).name,'김가상');
});
test('고단 ordering and OCR review are unchanged',()=>{
 for(const c of counselCases){
  const text=indictment(c.source,[],'구속여부 구속\n');
  const old=B.IndictmentParser.parse(document(text),{caseType:'고단'}),now=IndictmentParser.parse(document(text),{caseType:'고단'});
  assert.deepEqual(now.defendants.map(p=>p.counsel),old.defendants.map(p=>p.counsel));
  assert.equal(now.defendants[0].detention,'detained');
  assert.equal(CounselParser.parse([...c.source,'의견 벌금 500만 원'],true).status,'needsReview');
 }
});
test('picker messages explain uncertainty, cancellation, unsupported and security denial without claiming saved',()=>{
 for(const [name,message]of [['SecurityError','이 폴더를 열 수 없습니다. 시스템 파일이 포함되어 있기 때문에 file://(으)로는 이 폴더를 열 수 없습니다.'],['NotAllowedError','policy'],['AbortError','The user aborted a request.'],['FolderUnavailable','unsupported']]){
  const notice=folderFailureNotice({name,message});assert.equal(notice.code,name);assert.equal(notice.detail,message);
  assert.ok(notice.guidance.includes('단정할 수 없습니다'));assert.ok(notice.guidance.includes('다운로드'));
  if(name==='AbortError')assert.ok(notice.message.includes('취소되었거나'));
  assert.ok(!notice.message.includes('저장 완료'));
 }
});
