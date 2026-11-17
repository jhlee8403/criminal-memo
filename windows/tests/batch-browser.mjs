import {chromium} from 'playwright-core';
import {PDFDocument} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {unzipSync} from 'fflate';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'artifacts');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CM_CHROMIUM||'/usr/bin/chromium',headless:true,
 args:['--disable-dev-shm-usage',...(process.env.CM_SOFTWARE_GL==='1'?['--use-gl=angle','--use-angle=swiftshader']:[])]});
const context=await browser.newContext({offline:true,acceptDownloads:true});
const external=[];context.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
const mask=process.env.CM_NO_MODERN_APIS==='1';
const compatInit=(mask)=>{
 const read=()=>({withResolvers:typeof Promise.withResolvers,toSorted:typeof Uint8Array.prototype.toSorted,setUnion:typeof Set.prototype.union});
 window.__beforeCompat=read();
 if(mask){delete Promise.withResolvers;delete Object.getPrototypeOf(Uint8Array.prototype).toSorted;delete ArrayBuffer.prototype.transfer;for(const k of ['union','intersection','difference','symmetricDifference','isDisjointFrom','isSubsetOf','isSupersetOf'])delete Set.prototype[k];delete AbortSignal.any;}
 window.__atBootCompat=read();
};
await context.addInitScript(compatInit,mask);
const htmlPath=resolve(root,'distribution/CriminalMemo/CriminalMemo.html');
const report={browser:browser.version(),platform:process.platform,htmlSHA256:createHash('sha256').update(await fs.readFile(htmlPath)).digest('hex'),windowsEdge104Verified:false,maskRequested:mask,softwareGL:process.env.CM_SOFTWARE_GL==='1',externalRequests:external,errors:[],checks:[]};
let page=await context.newPage();
const attach=()=>{page.on('pageerror',e=>report.errors.push(e.message));page.setDefaultTimeout(60000);};attach();
const wait=(fn)=>page.waitForFunction(fn,{}, {polling:100,timeout:180000});
const rows=()=>page.locator('.batch-item');
const date=i=>rows().nth(i).locator('[data-field=date]');
const time=i=>rows().nth(i).locator('[data-field=time]');
async function run(){await page.locator('#analyze').click();await wait(()=>!document.querySelector('#analyze').disabled);await wait(()=>!!document.querySelector('#canvasHost canvas'));}
async function save(name){const pending=page.waitForEvent('download');await page.locator('#save').click();const d=await pending;await d.saveAs(resolve(out,name));return d.suggestedFilename();}
async function choose(files){await page.locator('#file').setInputFiles(files);await wait(()=>!!document.querySelector('#canvasHost canvas'));}
async function fillFirst(d='20261118',t='1000'){await date(0).fill(d);await time(0).fill(t);}
const fontBytes=await fs.readFile(resolve(root,'vendor/NanumGothic-Regular.ttf'));
async function pdf(text){const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const font=await doc.embedFont(fontBytes);let p=doc.addPage([595,842]),y=810;for(const line of text.split('\n')){if(y<30){p=doc.addPage([595,842]);y=810;}p.drawText(line,{x:20,y,size:8,font});y-=15;}return Buffer.from(await doc.save());}
function indictment(people,counsel='변호인 없음'){
 return '가상지방검찰청\n2026.11.17.\n사건번호 2024고정999999\n검 사 김가상 ( 인 )\nⅠ . 피고인 관련사항\n'+people.map((p,i)=>`${i+1}. 피고인 ${p.name||'박가상'} (${p.front||'900101'}-XXXXXXX), 15세\n${p.birth?'생년월일 '+p.birth+'\n':''}죄명 상해, 절도\n적용법조 가상법조\n${p.detention===null?'':(p.label||'구속여부')+' '+(p.detention||'불구속')+'\n'}${i===0?counsel:'변호인 없음'}`).join('\n')+'\nⅡ . 공소사실\n죄명 본문가상죄명\n변호인 본문가상변호';
}
const definitions=[
 {case:'2026고단203948',people:[{detention:'2026. 10. 28. 구속(2026. 10. 26. 체포)',label:'구속여부.'}],states:'O',mandatory:true,juvenile:false},
 {case:'2025고정1382',people:[{detention:null}],states:'X',mandatory:false,juvenile:false},
 {case:'2026고단203950',people:[{front:'561117',birth:'1956.11.17.'}],states:'X',mandatory:true,juvenile:false},
 {case:'2026고단203951',people:[{front:'071118',birth:'2007.11.18.'}],states:'X',mandatory:false,juvenile:true},
 {case:'2026고단203952',people:[{front:'401101',birth:'1940.11.1.',detention:'구속'}],states:'O',mandatory:true,juvenile:false},
 {case:'2026고단203953',people:[{detention:'구속'}, {name:'이가상'}],states:'OX',mandatory:true,juvenile:false},
 {case:'2026고단203954',people:[{}, {name:'이가상',front:'071118',birth:'2007.11.18.'}],states:'XX',mandatory:false,juvenile:true},
 {case:'2026고단203955',people:[{detention:'구속'}, {name:'이가상',detention:'구속'}],states:'OO',mandatory:true,juvenile:false},
 {case:'2026고단203956',people:[{front:'071118'}],states:'X',mandatory:false,juvenile:false,counsel:'변 호 인 법무법인 가상(담당변호사 김가상, 박가상, 이가상, 최가상)'},
 {case:'2026고정203957',people:[{detention:null}],states:'X',mandatory:false,juvenile:false,counsel:'국선변호인 변호사 김가상'},
];
try{
 try{await page.goto(pathToFileURL(htmlPath).href);report.fileMode=true;}catch(e){if(!e.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR'))throw e;report.fileMode=false;report.fileError=e.message;await page.close();page=await context.newPage();attach();await page.evaluate(compatInit,mask);await page.setContent(await fs.readFile(htmlPath,'utf8'));}
 await wait(()=>!!window.CM && document.querySelector('#templateInfo').textContent.includes('1페이지'));
 report.compatibility=await page.evaluate(()=>({before:window.__beforeCompat,atBoot:window.__atBootCompat,after:typeof Promise.withResolvers}));
 if(mask)assert.equal(report.compatibility.atBoot.withResolvers,'undefined');assert.equal(report.compatibility.after,'function');
 const files=[];
 for(const [i,d]of definitions.entries())files.push({name:(i===0?'가상법원 ':'')+d.case+(i===0?' 구공판 공소장(신규)':'')+'.pdf',mimeType:'application/pdf',buffer:await pdf(indictment(d.people,d.counsel))});
 await choose(files);assert.equal(await rows().count(),10);assert.equal(await page.locator('input[type=text]').count(),20);
 await date(0).fill('20261118');for(let i=0;i<10;i++){assert.equal(await date(i).inputValue(),'20261118');assert.equal(await time(i).inputValue(),'');await time(i).fill(String(1000+i*10));}
 await date(4).fill('20261119');assert.equal(await date(3).inputValue(),'20261118');
 await date(0).fill('2026-11-18');for(let i=0;i<10;i++){assert.equal(await date(i).inputValue(),'2026-11-18');assert.equal(await time(i).inputValue(),String(1000+i*10));}
 // Times 1060+ are deliberately invalid; correct them before the successful batch.
 const times=['1000','1030','1100','1130','1200','1230','1300','1330','1400','1430'];for(let i=0;i<10;i++)await time(i).fill(times[i]);
 await run();let entries=await page.evaluate(()=>CM.getEntries());assert.equal(entries.filter(e=>e.generated).length,10,JSON.stringify(entries.map(e=>e.error)));
 for(const [i,e]of entries.entries()){
  assert.equal(e.caseNumber,definitions[i].case);assert.equal(e.filename,`${times[i]} ${definitions[i].case}.pdf`);
  assert.equal(e.draft.prosecutor,'김가상');assert.equal(e.draft.filingDate,'2026-11-17');
  assert.equal(e.draft.defendants.map(p=>p.detention==='detained'?'O':'X').join(''),definitions[i].states);
  assert.deepEqual(e.draft.defendants[0].charges,['상해','절도']);
 }
 assert.equal(await save('batch-ten.zip'),'criminal-memo-batch.zip');
 const zipped=unzipSync(await fs.readFile(resolve(out,'batch-ten.zip')));assert.equal(Object.keys(zipped).length,10);
 for(const [i,d]of definitions.entries()){
  const name=`${times[i]} ${d.case}.pdf`,data=zipped[name];assert.ok(data);assert.equal((await PDFDocument.load(data)).getPageCount(),1);
  await fs.writeFile(resolve(out,`batch-memo-${i}.pdf`),data);d.output=`batch-memo-${i}.pdf`;d.filename=name;d.hearing=['2026. 11. 18.',`${times[i].slice(0,2)}:${times[i].slice(2)}`];
 }
 await time(0).fill('1500');assert.equal((await page.evaluate(()=>CM.getEntries())).filter(e=>e.generated).length,9);assert.equal(await page.locator('#outputTab').isDisabled(),true);
 report.checks.push('ten PDFs, date propagation without time propagation, ZIP with exact names, per-file invalidation');
 // Invalid rows cannot stop a later valid 고정 document.
 const bads=[{...files[0],name:'사건번호없음.pdf'},{...files[0],name:'2026고단1.pdf',buffer:Buffer.from('not a PDF')},{...files[1],name:'2026고정2.pdf'}];
 await choose(bads);await date(0).fill('20261118');for(let i=0;i<3;i++)await time(i).fill('1000');await run();entries=await page.evaluate(()=>CM.getEntries());
 assert.ok(entries[0].error.includes('사건번호'));assert.ok(entries[1].error);assert.equal(entries[2].generated,true);
 await save('batch-partial.zip');assert.deepEqual(Object.keys(unzipSync(await fs.readFile(resolve(out,'batch-partial.zip')))),['1000 2026고정2.pdf']);
 // Required/invalid hearing and single-file naming.
 await choose([files[0]]);await run();assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,false);
 for(const [d,t]of [['20261118',''],['20260229','1000'],['20261118','2400']]){await date(0).fill(d);await time(0).fill(t);await run();assert.ok((await page.evaluate(()=>CM.getEntries()))[0].error);}
 await fillFirst();await run();assert.equal(await save('batch-single.pdf'),'1000 2026고단203948.pdf');
 // Editing while a real analysis is paused must discard that document's stale result.
 await page.evaluate(()=>{const original=CM.PDFTextExtractor.page;CM.PDFTextExtractor.page=async(...args)=>{CM.PDFTextExtractor.page=original;window.__batchPaused=true;await new Promise(r=>{window.__batchResume=r;});return original(...args);};});
 await page.locator('#analyze').click();await wait(()=>window.__batchPaused);await time(0).fill('1100');await page.evaluate(()=>window.__batchResume());await wait(()=>!document.querySelector('#analyze').disabled);
 assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,false);await run();assert.equal(await save('batch-single-latest.pdf'),'1100 2026고단203948.pdf');
 // Duplicate names are errors, never silent ZIP overwrites.
 await choose([{...files[0],name:'A 2026고단1.pdf'},{...files[0],name:'B 2026고단1.pdf'}]);await date(0).fill('20261118');await time(0).fill('1000');await time(1).fill('10:00');await run();assert.ok((await page.evaluate(()=>CM.getEntries())).every(e=>!e.generated&&e.error.includes('중복')));
 report.checks.push('partial failure isolation, required/invalid hearing, single PDF name, stale analysis rejection, duplicate rejection');
 // Original PDF and counsel regression: compare the original pure parser to the UI extraction.
 const names=await fs.readdir(resolve(root,'..'));
 for(let i=1;i<=2;i++){
  const path=resolve(root,'..',names.find(n=>n.normalize('NFC')===`공소장${i}.pdf`));
  await choose([{name:`2026고단90${i}.pdf`,mimeType:'application/pdf',buffer:await fs.readFile(path)}]);await fillFirst();await run();
  const d=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(d.generated,true);
  const fixture=await fs.readFile(resolve(root,`tests/fixtures/sample${i}.txt`),'utf8');
  const expected=await page.evaluate(text=>CM.IndictmentParser.parse({text,usedOCR:false,pages:[{text,height:842,lines:text.split('\n').map((text,i)=>({text,y:i*12}))}]}),fixture);
  const summary=d=>({prosecutor:d.prosecutor,filingDate:d.filingDate,people:d.defendants.map(p=>({name:p.name,birthDigits:p.birthDigits,charges:p.charges,counsel:p.counsel,detention:p.detention}))});
  assert.deepEqual(summary(d.draft),summary(expected),'original PDF extraction must match the existing text regression fixture');
  await save(`batch-original-${i}.pdf`);
 }
 const counselCases=JSON.parse(await fs.readFile(resolve(root,'tests/fixtures/counsel-output-cases.json'),'utf8'));
 for(const [i,c]of counselCases.entries()){
  const file={name:`2026고단${8000+i}.pdf`,mimeType:'application/pdf',buffer:await pdf(indictment([{}],c.source.join('\n')))};
  await choose([file]);await fillFirst();await run();const entry=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(entry.generated,true,c.id+':'+entry.error);assert.equal(entry.draft.defendants[0].counsel.name,c.expected,c.id);
  await save(`batch-counsel-${c.id}.pdf`);
 }
 // The OCR engine itself still reads a real image-only page; review policy is unchanged.
 await choose([{name:'2026고단9999.pdf',mimeType:'application/pdf',buffer:await fs.readFile(resolve(out,'scanned-sample.pdf'))}]);await fillFirst();await run();
 const scan=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(scan.draft.defendants[0].birthReview,true);assert.equal(scan.draft.defendants[0].counsel.status,'needsReview');assert.equal(scan.generated,false);report.ocrUnchanged=true;
 await choose([{name:'2026고단9998.pdf',mimeType:'application/pdf',buffer:await fs.readFile(resolve(out,'mixed-sample.pdf'))}]);await fillFirst();await run();
 const mixed=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(mixed.draft.defendants.length,2);assert.ok(mixed.draft.defendants[1].charges.some(c=>c.includes('상해')));assert.ok(mixed.draft.defendants[1].charges.some(c=>c.includes('절도')));report.mixedOCRUnchanged=true;
 assert.deepEqual(external,[]);assert.deepEqual(report.errors,[]);
 report.definitions=definitions;report.counselCases=counselCases.map(c=>({id:c.id,expected:c.expected}));report.passed=true;
}catch(e){report.passed=false;report.failure=e.stack;report.status=await page.locator('#status').textContent();throw e;}
finally{await fs.writeFile(resolve(out,'batch-browser-report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report,null,2));}
