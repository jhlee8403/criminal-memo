import test from 'node:test';
import assert from 'node:assert/strict';
import {caseFromFilename,memoFilename} from '../src/batch.js';
import {assessFirstHearing} from '../src/first-hearing.js';
import {birthAssessment,ageMarks,DetentionParser,IndictmentParser,emptyDefendant,detentionGlyphs} from '../src/core.js';
for(const [file,expected]of[
 ['가상법원 2026고단203948 구공판 공소장(신규).pdf','2026고단203948'],
 ['2025고정1382.pdf','2025고정1382'],['2027고단1','2027고단1'],
])test('case metadata '+file,()=>assert.equal(caseFromFilename(file).caseNumber,expected));
test('missing/ambiguous filenames never select an arbitrary case',()=>{
  assert.ok(caseFromFilename('공소장.pdf').error);
  assert.ok(caseFromFilename('2026고단1 2026고단2.pdf').error);
});
for(const date of ['2026-11-18','20261118','2026.11.18','2026. 11. 18.'])
 for(const time of ['10:00','1000'])test(`flexible hearing ${date} ${time}`,()=>{
   assert.equal(assessFirstHearing({date,time},{required:true}).text,'2026. 11. 18.\n10:00');
   assert.equal(memoFilename('2026고단203948',{date,time}),'1000 2026고단203948.pdf');
 });
test('batch requires both date/time and valid calendar/clock',()=>{
 for(const [date,time]of[['',''],['20261118',''],['','1000'],['20260229','1000'],['20261118','2400'],['20261301','1000']])
  assert.throws(()=>memoFilename('2026고단1',{date,time}));
});
for(const label of ['구속여부','구속여부.'])test('detention annotation '+label,()=>{
 assert.equal(DetentionParser.parse([label+' 2026. 10. 28. 구속(2026. 10. 26. 체포)']),'detained');
 assert.equal(DetentionParser.parse([label+' 불구속']),'released');
 assert.equal(DetentionParser.parse([label+' 구속 영장 청구중']),'unknown');
});
test('고정 default applies only to missing fields, per defendant',()=>{
 const text='피고인 김가상 (900101-XXXXXXX)\n죄명 절도\n피고인 박가상 (920202-XXXXXXX)\n죄명 상해\n구속여부 구속';
 const document={text,usedOCR:false,pages:[{text,height:842,lines:[]}]};
 const d=IndictmentParser.parse(document,{caseType:'고정'});
 assert.equal(d.defendants[0].detention,'released');
 assert.deepEqual(detentionGlyphs(d.defendants).map(g=>g.text),['X','O']);
 assert.equal(IndictmentParser.parse(document,{caseType:'고단'}).defendants[0].detention,'unknown');
 assert.equal(DetentionParser.parse(['구속여부'],{caseType:'고정'}),'unknown');
});
