import test from 'node:test';
import assert from 'node:assert/strict';
import {complaintMarks,IndictmentParser} from '../src/core.js';
const draft=(...lists)=>({defendants:lists.map(charges=>({charges}))});
for(const title of ['폭행','존속폭행','과실치상','협박','존속협박','명예훼손','출판물에의한명예훼손','근로기준법위반','근로자퇴직급여보장법위반'])test(title+' only opposition',()=>assert.deepEqual(complaintMarks(draft([title])),{opposition:true,complaint:false}));
for(const title of ['사자명예훼손','모욕','비밀침해','업무상비밀누설'])test(title+' only complaint',()=>assert.deepEqual(complaintMarks(draft([title])),{opposition:false,complaint:true}));
for(const title of ['특수폭행','특수협박','업무상과실치상','절도','폭행치상','존속폭행치상','모욕미수','명예훼손(가상)','불명','판정불가',''])test('no substring match '+title,()=>assert.deepEqual(complaintMarks(draft([title])),{opposition:false,complaint:false}));
test('spaces normalized; all defendants; lists independent and deduplicated',()=>{
 assert.deepEqual(complaintMarks(draft(['절도'],['출판물에 의한\n명예훼손','모 욕','폭행','폭행'])),{opposition:true,complaint:true});
 assert.deepEqual(complaintMarks(draft(['사자 명예훼손'])),{opposition:false,complaint:true});
});
test('empty/unresolved charges leave both blank; other incomplete information does not hide a known exact match',()=>{
 for(const d of [draft(),draft([]),draft([],[])])assert.deepEqual(complaintMarks(d),{opposition:false,complaint:false});
 assert.deepEqual(complaintMarks({defendants:[{charges:['폭행'],chargesComplete:false},{charges:[],chargesComplete:false}]}),{opposition:true,complaint:false});
});
test('automatic parsed charge list drives both marks without changing parser',()=>{
 const text='가상지방검찰청\n2026.11.17.\n검사 김가상\nⅠ. 피고인 관련사항\n피고인 이가상 (080318-3******)\n죄명 폭행, 모욕\n적용법조 가상법 제1조\n구속여부 불구속\n변호인 없음\nⅡ. 공소사실';
 const parsed=IndictmentParser.parse({text,usedOCR:false,pages:[{text,lines:text.split('\n').map((text,i)=>({text,y:i*12}))}]});
 assert.deepEqual(parsed.defendants[0].charges,['폭행','모욕']);
 assert.deepEqual(complaintMarks(parsed),{opposition:true,complaint:true});
});
