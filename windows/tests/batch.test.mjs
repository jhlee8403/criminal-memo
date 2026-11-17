import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {caseFromFilename,memoFilename,createMemoZip} from '../src/batch.js';
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
test('ZIP contains separate exact PDF byte arrays and refuses collisions',()=>{
 const a=new TextEncoder().encode('%PDF-one'),b=new TextEncoder().encode('%PDF-two');
 const result=unzipSync(createMemoZip([{name:'1000 2026고단1.pdf',bytes:a},{name:'1030 2026고정2.pdf',bytes:b}]));
 assert.deepEqual(Object.keys(result),['1000 2026고단1.pdf','1030 2026고정2.pdf']);
 assert.equal(strFromU8(result['1000 2026고단1.pdf']),'%PDF-one');
 assert.throws(()=>createMemoZip([{name:'same.pdf',bytes:a},{name:'same.pdf',bytes:b}]),/중복/);
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
const person=(digits,birth,detention='released')=>({...emptyDefendant(),birthDigits:digits,birthDateEvidence:birth?[birth]:[],detention});
for(const [digits,birth,filing,age,juvenile,mandatory]of[
 ['561118','1956-11-18','2026-11-18',70,false,true],
 ['561118','1956-11-18','2026-11-17',69,false,false],
 ['071118','2007-11-18','2026-11-17',18,true,false],
 ['071118','2007-11-18','2026-11-18',19,false,false],
])test('age boundary '+age,()=>{
 const p=person(digits,birth);
 assert.equal(birthAssessment(p,filing).age,age);
 assert.deepEqual(ageMarks({defendants:[p],filingDate:filing}),{juvenile,mandatory});
});
test('no century is inferred from suffix, stated age, or untrusted evidence',()=>{
 const p={...person('071118'),statedAge:18,confirmedYear:'2007'};
 assert.equal(birthAssessment(p,'2026-11-17').resolved,false);
 for(const birth of ['1907-11-18','2007-11-18']){
  const a=person('071118',birth);a.birthReview=true;
  assert.equal(birthAssessment(a,'2026-11-17').resolved,false);
 }
 const conflicting=person('071118','2007-11-18');conflicting.birthDateEvidence.push('1907-11-18');
 assert.equal(birthAssessment(conflicting,'2026-11-17').resolved,false);
 assert.equal(birthAssessment(person('071118','2007-11-19'),'2026-11-17').resolved,false);
 const invalid=person('071118','2007-11-18');invalid.birthDateEvidence.push('판독불가');
 assert.equal(birthAssessment(invalid,'2026-11-17').resolved,false);
});
test('any detained or qualifying defendant marks once without assigning an age',()=>{
 const people=[person('900101'),person('920202',null,'detained')];
 assert.deepEqual(ageMarks({defendants:people,filingDate:'2026-11-18'}),{juvenile:false,mandatory:true});
 const d={defendants:[...people,person('071118','2007-11-18')],filingDate:'2026-11-17'};
 assert.deepEqual(ageMarks(d),{juvenile:true,mandatory:true});
});
test('full birth-date evidence is read only from explicit per-person DOB fields',()=>{
 const text='공소제기일 2026.11.18.\n피고인 김가상 (561118-XXXXXXX), 15세\n생년월일 1956.11.18.\n죄명 절도\n구속여부 불구속';
 const d=IndictmentParser.parse({text,usedOCR:false,pages:[{text,lines:[],height:842}]});
 assert.equal(birthAssessment(d.defendants[0],d.filingDate).age,70);
 assert.equal(ageMarks(d).mandatory,true);
});
