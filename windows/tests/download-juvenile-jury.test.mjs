import test from 'node:test';
import assert from 'node:assert/strict';
import {residentBirth,redactResidentNumbers,birthAssessment,juvenileGlyphs,juryGlyph,chargesComplete,ageMarks,IndictmentParser,emptyDefendant} from '../src/core.js';
const person=(front,marker,extra={})=>({...emptyDefendant(),birthDigits:front,birthCenturyDigit:marker,...extra});
const draft=people=>({filingDate:'2026-11-17',defendants:people});
const doc=text=>({text,usedOCR:false,pages:[{text,height:842,lines:[]}]});
for(const [front,marker,birth]of[['840318','1','1984-03-18'],['840318','2','1984-03-18'],['080318','3','2008-03-18'],['120318','4','2012-03-18']])test('century from marker '+marker,()=>{
 assert.equal(birthAssessment(person(front,marker),'2026-11-17').birth,birth);
 for(const identity of [`김가상 (${front}-${marker}******)`,`김가상 (${front} - ${marker}******)`,`김가상\n${front} -\n${marker}******`,`김가상 ${front}-${marker}****** 75세`])assert.deepEqual(residentBirth(identity),{birthDigits:front,birthCenturyDigit:marker});
});
for(const [front,marker,filing,expected]of[
 ['071118','3','2026-11-17',18],['071118','3','2026-11-18',19],['071118','4','2026-11-19',19],
 ['561118','1','2026-11-17',69],['561118','2','2026-11-18',70],['561118','1','2026-11-19',70],
 ['000229','3','2026-02-28',25],['000229','3','2026-03-01',26],
])test('birthday boundary '+front+' '+filing,()=>{
 const p=person(front,marker);assert.equal(birthAssessment(p,filing).age,expected);
 assert.equal(ageMarks({...draft([p]),filingDate:filing}).mandatory,expected>=70);
});
test('invalid or incomplete resident numbers cannot infer century',()=>{
 for(const identity of ['080318-5******','080318-X******','080318','08031-3******','080318-3***','080318-3','080318-3*******','080318-3******\n주민등록번호 080318-4******','080318-3******\n주민등록번호 080318-9******'])assert.equal(residentBirth(identity).birthCenturyDigit,'');
 for(const [front,marker]of[['000229','1'],['120230','3'],['271118','3'],['840318','5']])assert.equal(birthAssessment(person(front,marker),'2026-11-17').resolved,false);
 assert.equal(birthAssessment(person('080318','3'),'잘못된 기소일').resolved,false);
 assert.equal(birthAssessment(person('080318','3',{birthReview:true}),'2026-11-17').resolved,false);
 assert.equal(birthAssessment(person('080318','',{statedAge:18,birthDateEvidence:['2008-03-18']}),'2026-11-17').resolved,false);
});
test('only safe fields flow from defendant parser into age assessment',()=>{
 const text='공소제기일 2026.11.17.\n피고인 김가상 (080318 - 3******), 75세\n죄명 절도\n구속여부 불구속';
 const p=IndictmentParser.parse(doc(text)).defendants[0];
 assert.equal(p.birthDigits,'080318');assert.equal(p.birthCenturyDigit,'3');assert.equal(birthAssessment(p,'2026-11-17').age,18);
 assert.ok(!('residentNumber' in p));assert.ok(!('statedAge' in p));assert.ok(!('birthDateEvidence' in p));
});
test('tail digits are immediately redacted and never change retained fields',()=>{
 const front='080318',first='3',tailA=['6','4','2','8','5','1'].join(''),tailB=['9','8','7','6','5','4'].join('');
 const source=tail=>'공소제기일 2026.11.17.\n피고인 김가상 ('+front+' - '+first+tail+')\n죄명 특수상해\n구속여부 불구속';
 for(const tail of [tailA,tailB]){
  const safe=redactResidentNumbers(source(tail));assert.ok(!safe.includes(tail));assert.ok(safe.includes('3******'));
  assert.ok(!JSON.stringify(IndictmentParser.parse(doc(source(tail)))).includes(tail));
 }
 const a=IndictmentParser.parse(doc(source(tailA))).defendants[0],b=IndictmentParser.parse(doc(source(tailB))).defendants[0];
 assert.deepEqual({...a,id:''},{...b,id:''});
});
const juvenile=()=>person('080318','3'),adult=()=>person('840318','2'),unknown=()=>person('080318','');
for(const [name,people,expected]of[
 ['O',[juvenile()],'O'],['X',[adult()],'X'],['OX',[juvenile(),adult()],'OX'],['XO',[adult(),juvenile()],'XO'],['OO',[juvenile(),juvenile()],'OO'],['XX',[adult(),adult()],'XX'],
 ['three',[juvenile(),unknown(),adult()],'O X'],['four',[unknown(),adult(),juvenile(),unknown()],' XO '],['ten',Array.from({length:10},(_,i)=>i%2?adult():juvenile()),'OXOXOXOXOX'],
])test('ordered juvenile glyphs '+name,()=>{
 const glyphs=juvenileGlyphs(draft(people));assert.equal(glyphs.map(g=>g.text).join(''),expected);
 for(const g of glyphs)assert.equal(g.color,g.text==='O'?'red':'black');
});
test('detention still marks mandatory counsel without a resolved birthday',()=>assert.equal(ageMarks(draft([person('080318','',{detention:'detained'})])).mandatory,true));
const charged=(charges,complete=true)=>({...adult(),charges,chargesComplete:complete});
for(const title of ['특수상해','특수공갈','특정범죄가중처벌등에관한법률위반(도주치상)','특정범죄가중처벌등에관한법률위반(도주치사)','특정범죄가중처벌등에관한법률위반 ( 도주치상 )','특정범죄가중처벌등에관한법률위반（ 도주치사 ）'])test('jury exact positive '+title,()=>assert.deepEqual(juryGlyph(draft([charged([title])])),{text:'O',color:'red'}));
test('jury negatives use complete information and no substring matching',()=>{
 for(const title of ['절도','특수상해미수','특수공갈미수','특정범죄가중처벌등에관한법률위반(위험운전치사)','특정범죄가중처벌등에관한법률위반(도주치상등)'])assert.deepEqual(juryGlyph(draft([charged([title])])),{text:'X',color:'black'});
 assert.equal(juryGlyph(draft([charged(['절도']),charged([],false)])).text,' ');
 assert.equal(juryGlyph(draft([charged(['절도'],false)])).text,' ');
 assert.equal(juryGlyph(draft([])).text,' ');
 assert.equal(juryGlyph(draft([charged(['절도']),charged(['특수공갈'])])).text,'O');
 assert.equal(juryGlyph(draft([charged([],false),charged(['특수상해'],false)])).text,'O');
});
test('charge completeness metadata leaves existing charge parser output untouched',()=>{
 assert.equal(chargesComplete(['죄명 절도, 상해','적용법조 가상법조']),true);
 for(const lines of [[],['죄명'],['죄명 절도,'],['죄명 절도, 판독불가'],['죄명 특수상'],['죄명 법률위반(도주치상'],['죄명 상해 외 1개'],['죄명 절'],['죄명 절도, ?']])assert.equal(chargesComplete(lines),false);
 assert.equal(chargesComplete(['죄명 절도'],true),false);
 const d=IndictmentParser.parse(doc('피고인 김가상 (080318-3******)\n죄명 절도\n피고인 이가상 (840318-2******)\n변호인 없음'));
 assert.deepEqual(d.defendants.map(p=>p.chargesComplete),[true,false]);assert.equal(juryGlyph(d).text,' ');
});

test('a separately labelled resident number reaches age assessment across lines',()=>{
 const text='공소제기일 2026.11.17.\n피고인\n김가상\n주민등록번호\n080318 - 3******\n죄명 절도\n구속여부 불구속';
 const p=IndictmentParser.parse(doc(text)).defendants[0];assert.equal(p.birthCenturyDigit,'3');assert.equal(birthAssessment(p,'2026-11-17').age,18);
});
