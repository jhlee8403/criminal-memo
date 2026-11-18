import {chromium} from 'playwright-core';
import {PDFDocument} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.CM_ARTIFACTS||resolve(root,'artifacts/batch-save-form'));
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
async function save(name,index=0,selector=null){
 const expected=(await page.evaluate(()=>CM.getEntries()))[index].filename;
 if(!report.fileMode){
  await page.evaluate(()=>{window.__downloadCapture=null;if(!window.__downloadOriginal){window.__downloadOriginal=CM.PDFExportService.download;CM.PDFExportService.download=(data,name)=>{window.__downloadCapture={data:data.slice(),name:name+'.pdf'};return window.__downloadOriginal(data,name);};}});
 }
 const pending=page.waitForEvent('download',{predicate:d=>d.suggestedFilename()===expected,timeout:report.fileMode?60000:1000}).then(d=>({d}),error=>({error}));
 await (selector?page.locator(selector):rows().nth(index).locator('.download-pdf')).click();const result=await pending;
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
 return '열람복사용 안내 출력자 가상 다운로드일시: 2026.11.18.\n가상법원 2026고단1001 제출일시: 2026.11.19. 13:55\n가상지방검찰청\n2026.11.17.\n사건번호 2024고정999999\n검 사 김가상 ( 인 )\nⅠ . 피고인 관련사항\n'+people.map((p,i)=>`${i+1}. 피고인 ${p.name||'박가상'} (${p.front||'840318'} - ${p.marker??'2'}${p.tail??'******'}), 75세\n${p.charges===null?'':`죄명 ${p.charges||'절도, 상해'}\n적용법조 가상법조\n`}${p.detention===null?'':(p.label||'구속여부')+' '+(p.detention||'불구속')+'\n'}${i===0?counsel:'변호인 없음'}`).join('\n')+'\nⅡ . 공소사실\n죄명 특수공갈\n변호인 본문가상변호';
}
const youth=()=>({front:'080318',marker:'3'}),adult=()=>({front:'840318',marker:'2'}),unknown=()=>({front:'080318',marker:'X'});
const definitions=[
 {people:[youth()],youth:'O',jury:'X',mandatory:false},
 {people:[adult()],youth:'X',jury:'X',mandatory:false},
 {people:[youth(),{...adult(),name:'이가상',charges:'특수상해'}],youth:'OX',jury:'O',mandatory:false},
 {people:[adult(),{...youth(),name:'이가상',charges:'특수공갈'}],youth:'XO',jury:'O',mandatory:false},
 {people:[youth(),{...youth(),name:'이가상',charges:'특정범죄가중처벌등에관한법률위반 ( 도주치상 )'}],youth:'OO',jury:'O',mandatory:false},
 {people:[adult(),{...adult(),name:'이가상',charges:'특정범죄가중처벌등에관한법률위반(도주치사)'}],youth:'XX',jury:'O',mandatory:false},
 {people:[youth(),{...unknown(),name:'이가상'},{...adult(),name:'최가상',charges:null}],youth:'O X',jury:'',mandatory:false},
 {people:[{front:'561117',marker:'1'},{...unknown(),name:'이가상'}],youth:'X ',jury:'X',mandatory:true},
 {people:[{...unknown(),charges:'특수상해'},{...unknown(),name:'이가상',charges:null}],youth:'  ',jury:'O',mandatory:false},
 {people:[{...adult(),detention:'2026. 10. 28. 구속(2026. 10. 26. 체포)',label:'구속여부.'},{...youth(),name:'이가상'}],youth:'XO',jury:'X',mandatory:true},
].map((d,i)=>({...d,case:`2026고단${7100+i}`,filename:`${1000+i*100} 2026고단${7100+i}.pdf`,output:`djj-memo-${i}.pdf`,time:String(1000+i*100)}));
const emitted=[];
async function saveMemo(name,index=0,selector=null){const suggested=await save(name,index,selector);emitted.push(name);return suggested;}
try{
 try{await page.goto(pathToFileURL(htmlPath).href);report.fileMode=true;}catch(e){if(!e.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR'))throw e;report.fileMode=false;report.fileError=e.message;await page.close();page=await context.newPage();attach();await page.evaluate(compatInit,mask);await page.setContent(await fs.readFile(htmlPath,'utf8'));}
 await wait(()=>!!window.CM && document.querySelector('#templateInfo').textContent.includes('최종 2페이지'));
 report.compatibility=await page.evaluate(()=>({before:window.__beforeCompat,atBoot:window.__atBootCompat,after:typeof Promise.withResolvers}));
 if(mask)assert.equal(report.compatibility.atBoot.withResolvers,'undefined');assert.equal(report.compatibility.after,'function');assert.equal(await page.evaluate(()=>typeof CM.createMemoZip),'undefined');
 await page.evaluate(()=>{window.__downloadCalls=[];window.__downloadOriginal=CM.PDFExportService.download;CM.PDFExportService.download=(data,name)=>{window.__downloadCapture={data:data.slice(),name:name+'.pdf'};window.__downloadCalls.push({name:name+'.pdf',length:data.length,magic:String.fromCharCode(...data.slice(0,4))});if(!window.__blockDownloads)return window.__downloadOriginal(data,name);};});
 const files=[];for(const d of definitions)files.push({name:d.case+'.pdf',mimeType:'application/pdf',buffer:await pdf(indictment(d.people))});
 await choose(files);assert.equal(await rows().count(),10);assert.equal(await page.locator('input[type=text]').count(),20);
 await date(0).fill('20261118');for(let i=0;i<10;i++){assert.equal(await date(i).inputValue(),'20261118');assert.equal(await time(i).inputValue(),'');await time(i).fill(definitions[i].time);}
 await run();let entries=await page.evaluate(()=>CM.getEntries());assert.equal(entries.filter(e=>e.generated).length,10);
 const firstDrafts=entries.map(e=>e.draft);report.extractionSummaries=entries.map(e=>({case:e.caseNumber,missingFields:e.missingFields,generated:e.generated}));assert.ok(entries[6].missingFields.includes('죄명'));assert.ok((await rows().nth(6).locator('.file-audit').textContent()).includes('추출 실패:'));assert.equal((await page.evaluate(()=>CM.getBatchSummary())).warnings,entries.filter(e=>e.warning).length);
 for(const [i,e]of entries.entries()){
  assert.equal(e.filename,definitions[i].filename);assert.equal(e.draft.prosecutor,'김가상');assert.equal(e.draft.filingDate,'2026-11-17');
  const marks=await page.evaluate(d=>({y:CM.juvenileGlyphs(d).map(g=>g.text).join(''),j:CM.juryGlyph(d).text.trim(),mandatory:CM.ageMarks(d).mandatory}),e.draft);
  assert.deepEqual(marks,{y:definitions[i].youth,j:definitions[i].jury,mandatory:definitions[i].mandatory});
 }
 // One genuine click -> exactly ONE download call, preserving file order.
 for(const [i,d]of definitions.entries()){
  const before=await page.evaluate(()=>window.__downloadCalls.length);
  assert.equal(await saveMemo(d.output,i,'#save'),d.filename);
  assert.equal(await page.evaluate(()=>window.__downloadCalls.length),before+1);
 }
 assert.equal(await page.locator('#save').isDisabled(),true);
 assert.ok((await page.evaluate(()=>CM.getEntries())).every(e=>e.downloadRequested&&e.saveStatus.includes('요청됨')&&!e.saveStatus.includes('저장 완료')));
 const downloads=await page.evaluate(()=>window.__downloadCalls);assert.ok(downloads.every(d=>d.magic==='%PDF'&&d.length>10000));report.tenDownloadRequests=downloads;
 // Simulated policy denial: it must NOT claim saved; an explicit row click can retry.
 await page.evaluate(()=>{window.__blockDownloads=true;});await rows().nth(0).locator('.download-pdf').click();
 assert.ok((await rows().nth(0).locator('.save-status').textContent()).includes('실제 저장 여부'));
 await page.evaluate(()=>{window.__blockDownloads=false;});assert.equal(await rows().nth(0).locator('.download-pdf').isEnabled(),true);
 report.blockedDownloadSimulation={notClaimedSaved:true,individualRetry:true};
 report.folderCapability=await page.evaluate(()=>({secure:isSecureContext,picker:typeof showDirectoryPicker,supported:CM.canChooseFolder()}));
 if(report.folderCapability.secure){
  // User-picked handle doubles validate writes/close sequencing without bypassing native security.
  const setupFolder=async(fail='')=>{
   await page.evaluate(fail=>{
    window.__folderFiles=new Map([['original.pdf',new Uint8Array([9,8,7])]]);window.__folderEvents=[];window.__writeFailure=fail;window.__pickerCalls=0;window.__pauseClose=true;window.__closePaused=false;window.__openStreams=0;window.__parallelWrite=false;
    window.showDirectoryPicker=async()=>{window.__pickerCalls++;window.__pickerGesture=navigator.userActivation.isActive;return {name:'사용자 선택 재현 폴더',queryPermission:async()=> 'granted',getFileHandle:async(name,options)=>{
     if(!window.__folderFiles.has(name)&&!options?.create)throw new DOMException('missing','NotFoundError');
     return {createWritable:async()=>{window.__openStreams++;if(window.__openStreams>1)window.__parallelWrite=true;window.__folderEvents.push('open '+name);let pending;return {
      write:async bytes=>{if(name===window.__writeFailure)throw new DOMException('시험 쓰기 실패','QuotaExceededError');pending=bytes.slice();window.__folderEvents.push('write '+name);},
      close:async()=>{if(window.__pauseClose){window.__pauseClose=false;window.__closePaused=true;await new Promise(r=>window.__resumeClose=r);}window.__folderFiles.set(name,pending);window.__openStreams--;window.__folderEvents.push('close '+name);},abort:async()=>{window.__openStreams--;window.__folderEvents.push('abort '+name);}};}};
    }};};
   },fail);
  };
  await setupFolder();await page.locator('#saveFolder').click();await wait(()=>window.__closePaused);assert.equal((await page.evaluate(()=>CM.getBatchSummary())).saved,0);assert.equal(await date(0).isDisabled(),true);assert.equal(await page.evaluate(()=>window.__pickerCalls),1);assert.equal(await page.evaluate(()=>window.__pickerGesture),true);await page.evaluate(()=>window.__resumeClose());await wait(()=>!document.querySelector('#analyze').disabled);
  const stored=await page.evaluate(()=>({names:[...window.__folderFiles.keys()],events:window.__folderEvents,parallel:window.__parallelWrite,source:Array.from(window.__folderFiles.get('original.pdf'))}));
  assert.equal(stored.parallel,false);assert.deepEqual(stored.source,[9,8,7]);assert.equal(stored.names.length,11);
  assert.deepEqual(stored.events,definitions.flatMap(d=>['open '+d.filename,'write '+d.filename,'close '+d.filename]));
  for(const [i,d]of definitions.entries()){assert.deepEqual(Buffer.from(await page.evaluate(name=>Array.from(window.__folderFiles.get(name)),d.filename)),await fs.readFile(resolve(out,d.output)));assert.ok((await rows().nth(i).locator('.save-status').textContent()).includes('폴더 저장 완료'));}
  await rows().nth(0).locator('.folder-save').click();await wait(()=>!document.querySelector('#analyze').disabled);assert.ok((await rows().nth(0).locator('.save-status').textContent()).includes('폴더 저장 완료'));assert.equal(await page.evaluate(()=>window.__folderEvents.length),30);
  await setupFolder(definitions[3].filename);await page.evaluate(()=>window.__pauseClose=false);await page.locator('#chooseFolder').click();await page.locator('#saveFolder').click();await wait(()=>!document.querySelector('#analyze').disabled);
  assert.equal(await page.evaluate(()=>window.__folderFiles.size),10);assert.ok((await rows().nth(3).locator('.save-status').textContent()).includes('시험 쓰기 실패'));
  assert.ok((await rows().nth(9).locator('.save-status').textContent()).includes('폴더 저장 완료'));
  report.initialSaveSummary=await page.evaluate(()=>CM.getBatchSummary());assert.equal(report.initialSaveSummary.saved,9);assert.equal(report.initialSaveSummary.saveFailed,1);
  const failedFields=(await page.evaluate(()=>CM.getEntries()))[3].missingFields;
  await page.evaluate(()=>window.__writeFailure='');await rows().nth(3).locator('.folder-save').click();await wait(()=>!document.querySelector('#analyze').disabled);
  assert.equal((await page.evaluate(()=>CM.getBatchSummary())).saved,10);assert.deepEqual((await page.evaluate(()=>CM.getEntries()))[3].missingFields,failedFields);
  await setupFolder();await page.evaluate(name=>{window.__pauseClose=false;window.__folderFiles.set(name,new Uint8Array([1,2,3]));},definitions[0].filename);await page.locator('#chooseFolder').click();await page.locator('#saveFolder').click();await wait(()=>!document.querySelector('#analyze').disabled);
  assert.ok((await rows().nth(0).locator('.save-status').textContent()).includes('덮어쓰지'));assert.deepEqual(await page.evaluate(name=>Array.from(window.__folderFiles.get(name)),definitions[0].filename),[1,2,3]);assert.equal((await page.evaluate(()=>CM.getBatchSummary())).saved,9);
  await page.evaluate(()=>{window.showDirectoryPicker=async()=>({name:'거부 폴더',queryPermission:async()=> 'denied',requestPermission:async()=> 'denied'});});
  await page.locator('#chooseFolder').click();await page.locator('#saveFolder').click();await wait(()=>!document.querySelector('#analyze').disabled);
  assert.ok((await rows().nth(0).locator('.save-status').textContent()).includes('저장 실패'));assert.ok((await rows().nth(9).locator('.save-status').textContent()).includes('저장 실패'));
  report.folderTest={nativeSelectionVerified:false,oneButtonPickerAndSave:true,waitedForClose:true,perFileRetry:true,simulatedWrites:10,byteExact:true,sequentialClose:true,partialFailureContinues:true,collisionPreserved:true,permissionFallback:true};
 }else{
  await page.locator('#saveFolder').click();await wait(()=>!document.querySelector('#analyze').disabled);assert.ok((await page.locator('#folderInfo').textContent()).includes('개별 다운로드'));assert.equal((await page.evaluate(()=>CM.getBatchSummary())).saved,0);assert.equal((await page.evaluate(()=>CM.getBatchSummary())).pending,10);
  report.folderTest={nativeSelectionVerified:false,insecureContextRejected:true,simulatedWrites:0};
 }
 // Two-file queue starts from the first PDF, even after a prior ten-file session.
 await choose(files.slice(0,2).map((f,i)=>({...f,name:`2026고단${7200+i}.pdf` })));await date(0).fill('20261118');await time(0).fill('1000');await time(1).fill('1100');await run();
 await page.evaluate(()=>{window.__blockDownloads=true;});await rows().nth(0).locator('.download-pdf').click();await page.evaluate(()=>{window.__blockDownloads=false;});
 assert.equal(await saveMemo('djj-two-0.pdf',0),'1000 2026고단7200.pdf');
 assert.equal(await saveMemo('djj-two-1.pdf',1,'#save'),'1100 2026고단7201.pdf');
 report.twoFileQueue=true;
 // Parent behavior diagnosis: both bytes/names exist, but it fires two requests in one task.
 const parentHTML=execFileSync('git',['show','44a0d39:windows/distribution/CriminalMemo/CriminalMemo.html'],{cwd:root,maxBuffer:30*1024*1024}).toString();
 const parentPath=resolve(out,'djj-parent.html');await fs.writeFile(parentPath,parentHTML);
 let parent=await context.newPage();
 try{await parent.goto(pathToFileURL(parentPath).href);}catch(e){if(!e.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR'))throw e;await parent.close();parent=await context.newPage();await parent.evaluate(compatInit,mask);await parent.setContent(parentHTML);}
 await parent.waitForFunction(()=>!!window.CM);
 const comparisonText='열람복사용 다운로드일시 2026.11.18.\n가상법원 사건번호 제출일시: 2026.11.12. 13:55\n가상지방검찰청 가상지청\n2026.11.10.\n검사 김가상\n피고인 이가상';
 report.filingComparison={before:await parent.evaluate(text=>CM.FilingDateParser.assess({text,height:842,lines:text.split('\n').map((text,i)=>({text,y:i*12}))}),comparisonText),after:await page.evaluate(text=>CM.FilingDateParser.assess({text,height:842,lines:text.split('\n').map((text,i)=>({text,y:i*12}))}),comparisonText)};
 assert.equal(report.filingComparison.before.date,null);assert.equal(report.filingComparison.after.date,'2026-11-10');
 await parent.close();
 // Required input, corruption, missing case and per-file invalidation retain existing behavior.
 await time(0).fill('1200');assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,false);
 await choose([{...files[0],name:'공소장.pdf'},{...files[0],name:'2026고단9001.pdf',buffer:Buffer.from('invalid PDF')},{...files[1],name:'2026고정9002.pdf'}]);await date(0).fill('20261118');for(let i=0;i<3;i++)await time(i).fill('1000');await run();
 entries=await page.evaluate(()=>CM.getEntries());assert.ok(entries[0].error);assert.ok(entries[1].error);assert.equal(entries[2].generated,true);await saveMemo('djj-partial.pdf',2);
 await choose([files[0]]);await fillFirst('20260229','2400');await run();assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,false);await fillFirst();await run();
 await page.evaluate(()=>{const original=CM.PDFTextExtractor.page;CM.PDFTextExtractor.page=async(...args)=>{CM.PDFTextExtractor.page=original;window.__paused=true;await new Promise(r=>window.__resume=r);return original(...args);};});
 await page.locator('#analyze').click();await wait(()=>window.__paused);await time(0).fill('1230');await page.evaluate(()=>window.__resume());await wait(()=>!document.querySelector('#analyze').disabled);assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,false);await run();await saveMemo('djj-latest.pdf');
 // A four-defendant run preserves all positions; bounded raw tail privacy test is synthetic.
 const names=['김가상','이가상','박가상','최가상','강가상','윤가상','한가상','정가상','조가상','송가상'];
 const four=names.slice(0,4).map((name,i)=>({...i%2?adult():youth(),name,charges:'절도'}));
 await choose([{name:'2026고단9300.pdf',mimeType:'application/pdf',buffer:await pdf(indictment(four))}]);await fillFirst();await run();assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,true);await saveMemo('djj-four-people.pdf');
 const tail=['6','4','2','8','5','1'].join('');await choose([{name:'2026고단9301.pdf',mimeType:'application/pdf',buffer:await pdf(indictment([{...youth(),tail}]))}]);await fillFirst();await run();
 await page.locator('#textTab').click();assert.ok(!(await page.locator('#rawText').textContent()).includes(tail));assert.ok(!JSON.stringify(await page.evaluate(()=>CM.getEntries())).includes(tail));await saveMemo('djj-private-safe.pdf');
 // Additional jury failure and exact-match variants, including a false substring match.
 const juryCases=[{id:'no-target',people:[{...adult(),charges:'특수상해미수'}],jury:'X'},{id:'unknown',people:[{...adult(),charges:'절도, 판독불가'}],jury:''},{id:'none',people:[{...adult(),charges:null}],jury:''},{id:'truncated',people:[{...adult(),charges:'특정범죄가중처벌등에관한법률위반(도주치'}],jury:''}];
 for(const [i,c]of juryCases.entries()){await choose([{name:`2026고단${9400+i}.pdf`,mimeType:'application/pdf',buffer:await pdf(indictment(c.people))}]);await fillFirst();await run();assert.equal(await page.evaluate(()=>CM.juryGlyph(CM.getDraft()).text.trim()),c.jury);await saveMemo(`djj-jury-${c.id}.pdf`);}
 // Missing extraction and completely blank PDF are still generated, with warnings.
 for(const [caseIndex,[id,text]]of [['all','가상 문서입니다. 공소장 정보가 전혀 없는 충분히 긴 시험 안내문입니다.'],['prosecutor',indictment([adult()]).replace('검 사 김가상 ( 인 )\n','')],['counsel',indictment([adult()],'변호인 판독불가')]].entries()){
  await choose([{name:`2026고단${9500+caseIndex}.pdf`,mimeType:'application/pdf',buffer:await pdf(text)}]);await fillFirst();await run();const e=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(e.generated,true);assert.ok(e.warning);await saveMemo(`djj-missing-${id}.pdf`);
 }
 const blank=await PDFDocument.create();blank.addPage([595,842]);await choose([{name:'2026고단9599.pdf',mimeType:'application/pdf',buffer:Buffer.from(await blank.save())}]);await fillFirst();await run();assert.equal((await page.evaluate(()=>CM.getEntries()))[0].generated,true);await saveMemo('djj-empty.pdf');
 // Existing sample parsers, counsel formats and OCR outcomes remain regressions.
 const namesInRepo=await fs.readdir(resolve(root,'..'));
 for(let i=1;i<=2;i++){
  const path=resolve(root,'..',namesInRepo.find(n=>n.normalize('NFC')===`공소장${i}.pdf`));
  await choose([{name:`2026고단90${i}.pdf`,mimeType:'application/pdf',buffer:await fs.readFile(path)}]);await fillFirst();await run();const e=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(e.generated,true);
  const fixture=await fs.readFile(resolve(root,`tests/fixtures/sample${i}.txt`),'utf8');const expected=await page.evaluate(text=>CM.IndictmentParser.parse({text,usedOCR:false,pages:[{text,height:842,lines:text.split('\n').map((text,i)=>({text,y:i*12}))}]}),fixture);
  const summary=d=>({prosecutor:d.prosecutor,filingDate:d.filingDate,people:d.defendants.map(p=>({name:p.name,birthDigits:p.birthDigits,birthCenturyDigit:p.birthCenturyDigit,charges:p.charges,counsel:p.counsel,detention:p.detention}))});assert.deepEqual(summary(e.draft),summary(expected));await saveMemo(`djj-original-${i}.pdf`);
 }
 const counselCases=JSON.parse(await fs.readFile(resolve(root,'tests/fixtures/counsel-output-cases.json'),'utf8'));
 for(const [i,c]of counselCases.entries()){
  await choose([{name:`2026고단${8000+i}.pdf`,mimeType:'application/pdf',buffer:await pdf(indictment([adult()],c.source.join('\n')))}]);await fillFirst();await run();const e=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(e.generated,true,c.id);assert.equal(e.draft.defendants[0].counsel.name,c.expected);await saveMemo(`djj-counsel-${c.id}.pdf`);
 }
 for(const [caseIndex,[id,source]]of [['scanned','scanned-sample.pdf'],['mixed','mixed-sample.pdf']].entries()){
  await choose([{name:`2026고단${9600+caseIndex}.pdf`,mimeType:'application/pdf',buffer:await fs.readFile(resolve(root,'artifacts',source))}]);await fillFirst();await run();const e=(await page.evaluate(()=>CM.getEntries()))[0];assert.equal(e.generated,true);assert.ok(e.draft.defendants.some(p=>p.birthReview));if(id==='mixed')assert.equal(e.draft.defendants.length,2);await saveMemo(`djj-${id}.pdf`);
 }
 assert.deepEqual(external,[]);assert.deepEqual(report.errors,[]);
 report.definitions=definitions;report.juryCases=juryCases;report.emitted=emitted;report.counselCases=counselCases.map(c=>({id:c.id,expected:c.expected}));report.passed=true;
}catch(e){report.passed=false;report.failure=e.stack;report.status=await page.locator('#status').textContent();throw e;}
finally{await fs.writeFile(resolve(out,'batch-save-form-browser-report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,browser:report.browser,fileMode:report.fileMode,failure:report.failure,emitted:emitted.length}));}
