import test from 'node:test';import assert from 'node:assert/strict';
import {mandatoryGlyphs,juryGlyphs,mandatoryAssessment,classificationWarnings,memoChargeLines,IndictmentParser} from '../src/core.js';
const adult=(x={})=>({name:'김가상',birthDigits:'840318',birthCenturyDigit:'1',birthReview:false,detention:'released',charges:['절도'],chargesComplete:true,chargeAttribution:'confirmed',counsel:{status:'absentMissing',name:''},...x});
const d=people=>({filingDate:'2026-11-17',defendants:people,warnings:[]});const seq=g=>g.map(g=>g.text).join('');
const fatal='특정범죄가중처벌등에관한법률위반(도주치사)';
for(const [id,p,want]of [
 ['detained',adult({detention:'detained'}),'O'],['18',adult({birthDigits:'081117',birthCenturyDigit:'3'}),'O'],['70',adult({birthDigits:'561117'}),'O'],['69',adult({birthDigits:'571117'}),'X'],
 ...[fatal,'특정범죄가중처벌등에관한법률위반 ( 위험운전치사 )','보건범죄단속에관한특별조치법'].map(t=>[t,adult({charges:[t]}),'O']),
 ['injury-only',adult({charges:['특정범죄가중처벌등에관한법률위반(도주치상)']}),'X'],['assault',adult({charges:['폭행']}),'X'],
 ['two-reasons',adult({detention:'detained',birthDigits:'561117'}),'O'],['minor-fatal',adult({birthDigits:'081117',birthCenturyDigit:'3',charges:[fatal]}),'O'],
 ['unknown-detained',adult({birthDigits:'',detention:'detained',charges:[],chargesComplete:false}),'O'],['unknown-fatal',adult({birthDigits:'',detention:'unknown',charges:[fatal],chargesComplete:false}),'O'],
 ['unknown-age',adult({birthDigits:''}),' '],['unknown-detention',adult({detention:'unknown'}),' '],['unknown-owner',adult({charges:[fatal],chargeAttribution:'unknown'}),' '],['incomplete',adult({chargesComplete:false}),' '],
 ['not-substring',adult({charges:[fatal+'미수']}),'X']
])test('mandatory '+id,()=>assert.equal(seq(mandatoryGlyphs(d([p]))),want));
for(const text of ['OO','OX','XO','XX','OXO',' OX'])test('both arrays and colors '+text,()=>{
 const people=[...text].map(c=>adult(c==='O'?{detention:'detained',charges:['특수상해']}:c===' '?{birthDigits:'',charges:[],chargesComplete:false}:{}));
 for(const glyphs of [mandatoryGlyphs(d(people)),juryGlyphs(d(people))]){assert.equal(seq(glyphs),text);assert.ok(glyphs.every(g=>g.color===(g.text==='O'?'red':'black')));}
});
const parse=body=>{const text='가상지방검찰청\n2026.11.17.\n검사 최가상\nⅠ. 피고인 관련사항\n'+body+'\nⅡ. 공소사실';return IndictmentParser.parse({text,usedOCR:false,pages:[{text,lines:text.split('\n').map((text,i)=>({text,y:i*12}))}]});};
const identity=(name)=>`피고인 ${name} (840318-1******)\n구속여부 불구속`;
for(const swapped of [false,true])test('separate local fields do not leak '+swapped,()=>{
 const p=parse(identity('김가상')+'\n죄명 '+(swapped?'절도':fatal)+'\n적용법조 가상법\n'+identity('이가상')+'\n죄명 '+(swapped?fatal:'절도')+'\n적용법조 가상법');
 assert.equal(seq(mandatoryGlyphs(p)),swapped?'XO':'OX');assert.equal(seq(juryGlyphs(p)),swapped?'XO':'OX');
 assert.deepEqual(p.defendants.map(p=>p.chargeAttribution),['confirmed','confirmed']);
});
for(const body of ['죄명 김가상: '+fatal+'\n이가상: 절도','죄명 피고인 김가상: '+fatal+'\n피고인 이가상: 절도',`죄명 ${fatal}(김가상)\n절도(이가상)`])test('explicit scopes in shared area '+body,()=>{
 const p=parse(identity('김가상')+'\n'+identity('이가상')+'\n'+body+'\n적용법조 가상법');assert.equal(p.defendants.length,2);assert.equal(seq(mandatoryGlyphs(p)),'OX');assert.equal(seq(juryGlyphs(p)),'OX');
});
test('explicit all-defendant common charge',()=>{const p=parse(identity('김가상')+'\n'+identity('이가상')+'\n죄명 피고인 전원: 특수상해\n적용법조 가상법');assert.equal(seq(juryGlyphs(p)),'OO');assert.equal(seq(mandatoryGlyphs(p)),'XX');assert.deepEqual(memoChargeLines(p),['특수상해(김가상, 이가상)']);});
test('unscoped common charge is never assigned to last or all; other positive reasons still hold',()=>{
 const p=parse(identity('김가상')+'\n'+identity('이가상')+'\n죄명 '+fatal+'\n적용법조 가상법');assert.equal(seq(mandatoryGlyphs(p)),'  ');assert.equal(seq(juryGlyphs(p)),'  ');assert.ok(p.warnings.length>=2);assert.deepEqual(p.unassignedCharges,[fatal]);assert.deepEqual(p.defendants.map(p=>p.charges),[[],[]]);assert.ok(memoChargeLines(p)[0].includes('귀속 미확인'));p.defendants[0].detention='detained';assert.equal(seq(mandatoryGlyphs(p)),'O ');assert.ok(classificationWarnings(p).some(s=>s.includes('피고인 2')));
});
test('grouping preserves original arrays, first order and owner order, exact normalization',()=>{
 const p=d([adult({charges:['절도','상해','절도']}),adult({name:'이가상',charges:['절 도','폭행']}),adult({name:'박가상',charges:['절도','상해','특수폭행']})]);const before=JSON.stringify(p);
 assert.deepEqual(memoChargeLines(p),['절도(김가상, 이가상, 박가상)','상해(김가상, 박가상)','폭행(이가상)','특수폭행(박가상)']);assert.equal(JSON.stringify(p),before);assert.deepEqual(memoChargeLines(d([adult({charges:['절도','상해']})])),['절도','상해']);
});
test('integrated grouped output and different classifications',()=>{
 const p=d([adult({charges:['특수상해','절도']}),adult({name:'이가상'})]);assert.deepEqual(memoChargeLines(p),['특수상해(김가상)','절도(김가상, 이가상)']);assert.equal(seq(juryGlyphs(p)),'OX');assert.equal(seq(mandatoryGlyphs(p)),'XX');
});
test('shared scopes preserve first source appearance even when owner 2 appears first',()=>{const p=parse(identity('김가상')+'\n'+identity('이가상')+'\n죄명 이가상: 폭행\n김가상: 절도\n적용법조 가상법');assert.deepEqual(memoChargeLines(p),['폭행(이가상)','절도(김가상)']);});
test('health-law suffix is not an exact target; age birthday boundaries use filing date',()=>{
 assert.equal(seq(mandatoryGlyphs(d([adult({charges:['보건범죄단속에관한특별조치법위반']})]))),'X');
 assert.equal(seq(mandatoryGlyphs(d([adult({birthDigits:'071118',birthCenturyDigit:'3'})]))),'O');
 assert.equal(seq(mandatoryGlyphs(d([adult({birthDigits:'071117',birthCenturyDigit:'3'})]))),'X');
 assert.equal(seq(mandatoryGlyphs(d([adult({birthDigits:'561118'})]))),'X');
});
test('a shared field preceding identities is retained without inventing owners',()=>{const p=parse('죄명 '+fatal+'\n적용법조 가상법\n'+identity('김가상')+'\n'+identity('이가상'));assert.equal(seq(juryGlyphs(p)),'  ');assert.deepEqual(p.unassignedCharges,[fatal]);assert.ok(memoChargeLines(p)[0].includes('귀속 미확인'));});
test('explicit scopes preceding identities are resolved after all names are known',()=>{const p=parse('죄명 김가상: '+fatal+'\n이가상: 절도\n적용법조 가상법\n'+identity('김가상')+'\n'+identity('이가상'));assert.equal(seq(mandatoryGlyphs(p)),'OX');});
test('missing ownership metadata cannot authorize a positive charge or a negative classification',()=>{const p=adult({charges:[fatal]});delete p.chargeAttribution;assert.equal(seq(mandatoryGlyphs(d([p]))),' ');assert.equal(seq(juryGlyphs(d([p]))),' ');p.detention='detained';assert.equal(seq(mandatoryGlyphs(d([p]))),'O');});
