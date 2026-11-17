import {chromium} from 'playwright-core';
import {PDFDocument} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
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
async function save(name,index=0){
 const expected=(await page.evaluate(()=>CM.getEntries()))[index].filename;
 if(!report.fileMode){
  await page.evaluate(()=>{window.__downloadCapture=null;if(!window.__downloadOriginal){window.__downloadOriginal=CM.PDFExportService.download;CM.PDFExportService.download=(data,name)=>{window.__downloadCapture={data:data.slice(),name:name+'.pdf'};return window.__downloadOriginal(data,name);};}});
 }
 const pending=page.waitForEvent('download',{predicate:d=>d.suggestedFilename()===expected,timeout:report.fileMode?60000:1000}).then(d=>({d}),error=>({error}));
 await rows().nth(index).locator('.download-pdf').click();const result=await pending;
 report.outputTransports??=[];
 if(result.d){await result.d.saveAs(resolve(out,name));report.outputTransports.push({file:name,transport:'browser download'});return result.d.suggestedFilename();}
 if(report.fileMode)throw result.error;
 const capture=await page.evaluate(()=>window.__downloadCapture&&({data:Array.from(window.__downloadCapture.data),name:window.__downloadCapture.name}));
 assert.ok(capture,'a diagnostic still requires an actual PDF download request');assert.equal(capture.name,expected);
 await fs.writeFile(resolve(out,name),Buffer.from(capture.data));report.outputTransports.push({file:name,transport:'in-memory diagnostic after blocked download request'});return capture.name;
}
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
 await wait(()=>!!window.CM && document.querySelector('#templateInfo').textContent.includes('최종 2페이지'));
 report.compatibility=await page.evaluate(()=>({before:window.__beforeCompat,atBoot:window.__atBootCompat,after:typeof Promise.withResolvers}));
 if(mask)assert.equal(report.compatibility.atBoot.withResolvers,'undefined');assert.equal(report.compatibility.after,'function');assert.equal(await page.evaluate(()=>typeof CM.createMemoZip),'undefined');
 const files=[];
 for(const [i,d]of definitions.entries())files.push({name:(i===0?'가상법원 ':'')+d.case+(i===0?' 구공판 공소장(신규)':'')+'.pdf',mimeType:'application/pdf',buffer:await pdf(indictment(d.people,d.counsel))});
 await choose(files);assert.equal(await rows().count(),10);assert.equal(await page.locator('input[type=text]').count(),20);
 await date(0).fill('20261118');for(let i=0;i<10;i++){assert.equal(await date(i).inputValue(),'20261118');assert.equal(await time(i).inputValue(),'');await time(i).fill(String(1000+i*10));}
 await date(4).fill('20261119');assert.equal(await date(3).inputValue(),'20261118');
 await date(0).fill('2026-11-18');for(let i=0;i<10;i++){assert.equal(await date(i).inputValue(),'2026-11-18');assert.equal(await time(i).inputValue(),String(1000+i*10));}
 // Times 1060+ are deliberately invalid; correct them before the successful batch.
 const times=['1000','1030','1100','1130','1200','1230','1300','1330','1400','1430'];for(let i=0;i<10;i++)await time(i).fill(times[i]);
 await run();let entries=await page.evaluate(()=>CM.getEntries());assert.equal(entries.filter(e=>e.generated).length,10,JSON.stringify(entries.map(e=>e.error)));
 report.firstPageDrafts=entries.map(e=>e.draft);
 for(const [i,e]of entries.entries()){
  assert.equal(e.caseNumber,definitions[i].case);assert.equal(e.filename,`${times[i]} ${definitions[i].case}.pdf`);
  assert.equal(e.draft.prosecutor,'김가상');assert.equal(e.draft.filingDate,'2026-11-17');
  assert.equal(e.draft.defendants.map(p=>p.detention==='detained'?'O':'X').join(''),definitions[i].states);
  assert.deepEqual(e.draft.defendants[0].charges,['상해','절도']);
 }
 for(const [i,d]of definitions.entries()){
  const name=`${times[i]} ${d.case}.pdf`;
  assert.equal(await save(`two-memo-${i}.pdf`,i),name);
  const data=await fs.readFile(resolve(out,`two-memo-${i}.pdf`));assert.equal((await PDFDocument.load(data)).getPageCount(),2);
  d.output=`two-memo-${i}.pdf`;d.filename=name;d.hearing=['2026. 11. 18.',`${times[i].slice(0,2)}:${times[i].slice(2)}`];
 }
 assert.ok((await page.evaluate(()=>CM.getEntries())).every(e=>e.saveStatus.includes('요청됨')&&!e.saveStatus.includes('완료')));
 // File System Access real feature detection in this file origin; headless cannot select a native folder.
 report.folderCapability=await page.evaluate(()=>({secure:isSecureContext,picker:typeof showDirectoryPicker,supported:CM.canChooseFolder()}));
 if(report.fileMode){
  await page.evaluate(()=>{window.__nativePicker=window.showDirectoryPicker;const b=document.createElement('button');b.id='probePicker';b.textContent='native picker probe';b.onclick=async()=>{try{const h=await window.__nativePicker({mode:'readwrite'});window.__pickerProbe={selected:true,kind:h.kind};}catch(e){window.__pickerProbe={selected:false,name:e.name,message:e.message};}};document.body.prepend(b);});
  await page.locator('#probePicker').click();
  try{await page.waitForFunction(()=>!!window.__pickerProbe,{}, {timeout:3000});report.nativePickerProbe=await page.evaluate(()=>window.__pickerProbe);}catch{report.nativePickerProbe={selected:false,note:'native chooser not automatable in headless environment'};}
  await page.locator('#probePicker').evaluate(e=>e.remove());
 }
 // Explicit picker/handle doubles exercise UI, bytes, collisions and policy-denied fallback.
 // These are NOT a claim of native Windows or managed-folder access.
 if(report.folderCapability.secure){
 await page.evaluate(()=>{
  window.__folderFiles=new Map([['original.pdf',new Uint8Array([9,8,7])]]);window.__folderWrites=0;
  window.showDirectoryPicker=async()=>({name:'사용자 선택 재현 폴더',queryPermission:async()=> 'granted',
   getFileHandle:async(name,options)=>{
    if(!window.__folderFiles.has(name)&&!options?.create)throw new DOMException('missing','NotFoundError');
    return {createWritable:async()=>{let pending;return {write:async bytes=>{pending=bytes.slice();},close:async()=>{window.__folderFiles.set(name,pending);window.__folderWrites++;},abort:async()=>{}};}};
   }});
 });
 await page.locator('#chooseFolder').click();assert.ok((await page.locator('#folderInfo').textContent()).includes('선택 폴더'));
 await page.locator('#saveFolder').click();await wait(()=>!document.querySelector('#analyze').disabled);
 const stored=await page.evaluate(()=>({names:[...window.__folderFiles.keys()],writes:window.__folderWrites,source:Array.from(window.__folderFiles.get('original.pdf'))}));
 assert.equal(stored.writes,10);assert.deepEqual(stored.source,[9,8,7]);assert.equal(stored.names.length,11);
 for(const [i,d]of definitions.entries()){
  const data=await page.evaluate(name=>Array.from(window.__folderFiles.get(name)),d.filename);
  assert.deepEqual(Buffer.from(data),await fs.readFile(resolve(out,d.output)));
  assert.ok((await rows().nth(i).locator('.save-status').textContent()).includes('폴더 저장 완료'));
 }
 await rows().nth(0).locator('.folder-save').click();await wait(()=>!document.querySelector('#analyze').disabled);
 assert.ok((await rows().nth(0).locator('.save-status').textContent()).includes('덮어쓰지'));
 assert.equal(await page.evaluate(()=>window.__folderWrites),10);
 await page.evaluate(()=>{window.showDirectoryPicker=async()=>{throw new DOMException('managed policy','SecurityError');};});
 await page.locator('#chooseFolder').click();assert.ok((await page.locator('#folderInfo').textContent()).includes('개별 다운로드'));
 await page.evaluate(()=>{window.showDirectoryPicker=async()=>({name:'권한 거부 폴더',queryPermission:async()=> 'denied',requestPermission:async()=> 'denied'});});
 await page.locator('#chooseFolder').click();await rows().nth(0).locator('.folder-save').click();await wait(()=>!document.querySelector('#analyze').disabled);
 assert.ok((await rows().nth(0).locator('.save-status').textContent()).includes('저장 실패'));assert.ok((await page.locator('#folderInfo').textContent()).includes('개별 다운로드'));
 assert.equal(await save('two-folder-fallback.pdf'),definitions[0].filename);
 await page.evaluate(()=>{delete window.showDirectoryPicker;});await page.locator('#chooseFolder').click();assert.ok((await page.locator('#folderInfo').textContent()).includes('지원하지'));
 report.folderTest={nativeSelectionVerified:false,simulatedHandleExactBytes:10,collisionPreserved:true,permissionAndPolicyFallback:true,unsupportedFallback:true};
 }else{
  await page.locator('#chooseFolder').click();assert.ok((await page.locator('#folderInfo').textContent()).includes('개별 다운로드'));
  assert.equal(await save('two-folder-fallback.pdf'),definitions[0].filename);
  report.folderTest={nativeSelectionVerified:false,simulatedHandleExactBytes:0,insecureContextRejected:true,unsupportedFallback:true,note:'folder UI handle simulations run in the separate secure file-origin Chromium 103 test'};
 }
 const downloads=[];const recordDownload=d=>downloads.push(d);page.on('download',recordDownload);
 await page.locator('#save').click();await wait(()=>CM.getEntries().every(e=>e.saveStatus.includes('요청됨')));await new Promise(r=>setTimeout(r,500));
 page.off('download',recordDownload);assert.ok(downloads.length<=10);if(report.fileMode)assert.ok(downloads.length>0);assert.ok(downloads.every(d=>d.suggestedFilename().endsWith('.pdf')));report.individualDownloads=downloads.map(d=>d.suggestedFilename());
 await time(0).fill('1500');assert.equal((await page.evaluate(()=>CM.getEntries())).filter(e=>e.generated).length,9);assert.equal(await page.locator('#outputTab').isDisabled(),true);
 report.checks.push('ten individual two-page PDFs, date propagation without time propagation, per-file invalidation; no ZIP');
 // Invalid rows cannot stop a later valid 고정 document.
 const bads=[{...files[0],name:'사건번호없음.pdf'},{...files[0],name:'2026고단1.pdf',buffer:Buffer.from('not a PDF')},{...files[1],name:'2026고정2.pdf'}];
 await choose(bads);await date(0).fill('20261118');for(let i=0;i<3;i++)await time(i).fill('1000');await run();entries=await page.evaluate(()=>CM.getEntries());
 assert.ok(entries[0].error.includes('사건번호'));assert.ok(entries[1].error);assert.equal(entries[2].generated,true);
 assert.equal(await save('two-partial.pdf',2),'1000 2026고정2.pdf');
 // Required/invalid hearing and single-file naming.
 await choose([files[0]]);await run();assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,false);
 for(const [d,t]of [['20261118',''],['20260229','1000'],['20261118','2400']]){await date(0).fill(d);await time(0).fill(t);await run();assert.ok((await page.evaluate(()=>CM.getEntries()))[0].error);}
 await fillFirst();await run();assert.equal(await save('two-single.pdf'),'1000 2026고단203948.pdf');
 // Editing while a real analysis is paused must discard that document's stale result.
 await page.evaluate(()=>{const original=CM.PDFTextExtractor.page;CM.PDFTextExtractor.page=async(...args)=>{CM.PDFTextExtractor.page=original;window.__batchPaused=true;await new Promise(r=>{window.__batchResume=r;});return original(...args);};});
 await page.locator('#analyze').click();await wait(()=>window.__batchPaused);assert.equal(await page.locator('#chooseFolder').isDisabled(),true);await time(0).fill('1100');await page.evaluate(()=>window.__batchResume());await wait(()=>!document.querySelector('#analyze').disabled);
 assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,false);await run();assert.equal(await save('two-single-latest.pdf'),'1100 2026고단203948.pdf');
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
  await save(`two-original-${i}.pdf`);
 }
 const counselCases=JSON.parse(await fs.readFile(resolve(root,'tests/fixtures/counsel-output-cases.json'),'utf8'));
 for(const [i,c]of counselCases.entries()){
  const file={name:`2026고단${8000+i}.pdf`,mimeType:'application/pdf',buffer:await pdf(indictment([{}],c.source.join('\n')))};
  await choose([file]);await fillFirst();await run();const entry=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(entry.generated,true,c.id+':'+entry.error);assert.equal(entry.draft.defendants[0].counsel.name,c.expected,c.id);
  await save(`two-counsel-${c.id}.pdf`);
 }
 // The OCR engine itself still reads a real image-only page; review policy is unchanged.
 await choose([{name:'2026고단9999.pdf',mimeType:'application/pdf',buffer:await fs.readFile(resolve(out,'scanned-sample.pdf'))}]);await fillFirst();await run();
 const scan=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(scan.draft.defendants[0].birthReview,true);assert.equal(scan.draft.defendants[0].counsel.status,'needsReview');assert.equal(scan.generated,true);assert.ok(scan.warning.includes('변호인'));await save('two-scanned.pdf');report.ocrUnchanged=true;
 await choose([{name:'2026고단9998.pdf',mimeType:'application/pdf',buffer:await fs.readFile(resolve(out,'mixed-sample.pdf'))}]);await fillFirst();await run();
 const mixed=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(mixed.draft.defendants.length,2);assert.ok(mixed.draft.defendants[1].charges.some(c=>c.includes('상해')));assert.ok(mixed.draft.defendants[1].charges.some(c=>c.includes('절도')));assert.equal(mixed.generated,true);await save('two-mixed.pdf');report.mixedOCRUnchanged=true;
 // Partial extraction never blocks valid PDF generation; unknown fields stay empty.
 const missingCases=[
  {id:'prosecutor',text:indictment([{}]).replace('검 사 김가상 ( 인 )\n',''),missing:'검사'},
  {id:'counsel',text:indictment([{}],'변호인 판독불가'),missing:'변호인'},
  {id:'all',text:'가상 문서입니다. 공소장 정보를 전혀 포함하지 않은 충분한 길이의 시험용 안내문입니다.',missing:'피고인'},
  {id:'detention',text:indictment([{detention:'미상'}]),missing:'구속'},
 ];
 for(const [i,c]of missingCases.entries()){
  await choose([{name:`2026고단${6000+i}.pdf`,mimeType:'application/pdf',buffer:await pdf(c.text)}]);await fillFirst();await run();
  const e=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(e.generated,true,c.id);assert.equal(e.error,'');assert.ok(e.warning.includes(c.missing),c.id);assert.ok(e.status.includes('추출 경고'));
  if(c.id==='prosecutor')assert.equal(e.draft.prosecutor,'');if(c.id==='counsel')assert.equal(e.draft.defendants[0].counsel.status,'needsReview');if(c.id==='all')assert.equal(e.draft.defendants.length,0);
  await save(`two-missing-${c.id}.pdf`);
 }
 // Completely blank valid PDF still generates after OCR reports no readable text.
 const blank=await PDFDocument.create();blank.addPage([595,842]);
 await choose([{name:'2026고단6100.pdf',mimeType:'application/pdf',buffer:Buffer.from(await blank.save())}]);await fillFirst();await run();
 const empty=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(empty.generated,true);assert.ok(empty.warning.includes('OCR'));await save('two-empty.pdf');
 // Adult X requires EVERY age resolved; a juvenile wins even with unresolved co-defendants.
 const ageCases=[
  {id:'adult',people:[{front:'071117',birth:'2007.11.17.'}],mark:'cross'},
  {id:'adults',people:[{front:'900101',birth:'1990.1.1.'},{name:'이가상',front:'561117',birth:'1956.11.17.'}],mark:'cross'},
  {id:'adult-unknown',people:[{front:'900101',birth:'1990.1.1.'},{name:'이가상',front:'071118'}],mark:''},
  {id:'juvenile-unknown',people:[{front:'071118',birth:'2007.11.18.'},{name:'이가상'}],mark:'circle'},
  {id:'filing-unknown',people:[{front:'900101',birth:'1990.1.1.'}],mark:''},
 ];
 for(const [i,c]of ageCases.entries()){
  let text=indictment(c.people);if(c.id==='filing-unknown')text=text.replace('2026.11.17.\n','');
  await choose([{name:`2026고단${6200+i}.pdf`,mimeType:'application/pdf',buffer:await pdf(text)}]);await fillFirst();await run();
  assert.equal(await page.evaluate(()=>CM.juvenileMark(CM.getDraft())),c.mark);await save(`two-age-${c.id}.pdf`);
 }
 // A missing/invalid embedded template remains a genuine generation error, isolated per file.
 await page.evaluate(()=>{window.__template=CM_DOCUMENTS.secondTemplate;CM_DOCUMENTS.secondTemplate=btoa('invalid');});
 await run();assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,false);assert.ok((await page.evaluate(()=>CM.getEntries()))[0].error);
 await page.evaluate(()=>{CM_DOCUMENTS.secondTemplate=window.__template;});await run();assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,true);
 report.partialCases=missingCases.map(c=>({id:c.id,missing:c.missing}));report.ageCases=ageCases;
 report.checks.push('missing prosecutor/counsel/all/detention and blank OCR generate with warnings; age X requires all adults; bad template fails');
 // Render the shipped parent version with identical draft/options for pixel comparison.
 const parentHTML=execFileSync('git',['show','f25b9b0:windows/distribution/CriminalMemo/CriminalMemo.html'],{cwd:root,maxBuffer:30*1024*1024}).toString();
 const baseline=await context.newPage();await baseline.setContent(parentHTML);await baseline.waitForFunction(()=>!!window.CM);
 for(const [i,d]of definitions.entries()){
  const data=await baseline.evaluate(async({draft,caseNumber,time})=>Array.from(await CM.MemoPDFRenderer.render(draft,{caseNumber,firstHearing:{date:'20261118',time}})),{draft:report.firstPageDrafts[i],caseNumber:d.case,time:times[i]});
  await fs.writeFile(resolve(out,`two-parent-${i}.pdf`),Buffer.from(data));
 }
 await baseline.close();delete report.firstPageDrafts;
 assert.deepEqual(external,[]);assert.deepEqual(report.errors,[]);
 report.definitions=definitions;report.counselCases=counselCases.map(c=>({id:c.id,expected:c.expected}));report.passed=true;
}catch(e){report.passed=false;report.failure=e.stack;report.status=await page.locator('#status').textContent();throw e;}
finally{await fs.writeFile(resolve(out,'two-page-browser-report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report,null,2));}
