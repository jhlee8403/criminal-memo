import {chromium} from 'playwright-core';
import {PDFDocument} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.CM_EDGE_ARTIFACTS||resolve(root,'artifacts/edge-fixed'));
await fs.mkdir(out,{recursive:true});
const htmlPath=resolve(root,'distribution/CriminalMemo/CriminalMemo.html'),html=await fs.readFile(htmlPath,'utf8');
const browser=await chromium.launch({executablePath:process.env.CM_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage',...(process.env.CM_SOFTWARE_GL==='1'?['--use-gl=angle','--use-angle=swiftshader']:[])]});
const report={browser:browser.version(),htmlSHA256:createHash('sha256').update(html).digest('hex'),windowsEdge104Verified:false,nativePickerSelectionVerified:false,externalRequests:[],errors:[],batches:[],counselCases:[]};
const mask=process.env.CM_NO_MODERN_APIS==='1';
const init=()=>{delete Promise.withResolvers;delete Object.getPrototypeOf(Uint8Array.prototype).toSorted;delete ArrayBuffer.prototype.transfer;window.__noResolvers=typeof Promise.withResolvers;};
async function open(){
 const ctx=await browser.newContext({offline:true,acceptDownloads:true});if(mask)await ctx.addInitScript(init);
 ctx.on('request',r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url());});
 let page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));let fileMode=true;
 try{await page.goto(pathToFileURL(htmlPath).href);}catch(e){if(!e.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR'))throw e;fileMode=false;await page.close();page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));if(mask)await page.evaluate(init);await page.setContent(html);}
 await page.waitForFunction(()=>!!window.CM&&document.querySelector('#templateInfo').textContent.includes('최종 2페이지'));
 if(mask)assert.equal(await page.evaluate(()=>window.__noResolvers),'undefined');
 assert.equal(await page.evaluate(()=>typeof Promise.withResolvers),'function');
 return {ctx,page,fileMode};
}
const fontBytes=await fs.readFile(resolve(root,'vendor/NanumGothic-Regular.ttf'));
async function makePDF(text){const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const font=await doc.embedFont(fontBytes);let p=doc.addPage([595,842]),y=810;for(const line of text.split('\n')){if(y<30){p=doc.addPage([595,842]);y=810;}p.drawText(line,{x:20,y,size:9,font});y-=15;}return Buffer.from(await doc.save());}
function indictment(counsel,kind='고정'){
 return '열람복사용 출력자 가상 다운로드일시: 2026.11.19.\n가상법원 제출일시: 2026.11.18.\n가상지방검찰청\n2026.11.17.\n검사 이가상\nⅠ. 피고인 관련사항\n피고인 박가상 (080318-3******)\n죄명 특수상해\n적용법조 가상법률 제1조\n제2조\n'+(kind==='고단'?'구속여부 구속\n':'')+counsel.join('\n')+'\n의 견 벌금 500만 원\n가 납 명 령 청 구\nⅡ. 공소사실\n변호사 본문가상\nⅢ. 첨부\n가상 첨부목록';
}
async function analyze(page,files){
 await page.locator('#file').setInputFiles(files);await page.locator('[data-field=date]').nth(0).fill('20261120');
 for(let i=0;i<files.length;i++)await page.locator('[data-field=time]').nth(i).fill(String(1000+i*100));
 await page.locator('#analyze').click();await page.waitForFunction(()=>!document.querySelector('#analyze').disabled,{}, {timeout:180000});
 assert.ok((await page.evaluate(()=>CM.getEntries())).every(e=>e.generated));
}
const companyError='이 폴더를 열 수 없습니다. 시스템 파일이 포함되어 있기 때문에 file://(으)로는 이 폴더를 열 수 없습니다.';
try{
 for(const count of [2,10]){
  const {ctx,page,fileMode}=await open();const files=[];
  for(let i=0;i<count;i++)files.push({name:`2026고정${6000+count*100+i}.pdf`,mimeType:'application/pdf',buffer:await makePDF(indictment(['변 호 인 변호사 김가상']))});
  await analyze(page,files);
  const names=(await page.evaluate(()=>CM.getEntries())).map(e=>e.filename);
  await page.evaluate(message=>{
   window.__calls=[];window.__payloads=[];window.__pickerCalls=0;
   window.showDirectoryPicker=async()=>{window.__pickerCalls++;throw new DOMException(message,'SecurityError');};
   const original=CM.PDFExportService.download;CM.PDFExportService.download=(bytes,name)=>{window.__calls.push({name:name+'.pdf',bytes:bytes.length,header:String.fromCharCode(...bytes.slice(0,4)),gesture:navigator.userActivation.isActive});window.__payloads.push(bytes.slice());if(!window.__suppressLinks)return original(bytes,name);};
  },companyError);
  await page.locator('#saveFolder').click();await page.waitForFunction(()=>!document.querySelector('#analyze').disabled);
  assert.equal(await page.evaluate(()=>window.__calls.length),0,'picker failure must not auto-download after lost activation');
  assert.equal(await page.evaluate(()=>CM.getSaveMode()),'downloads');assert.equal((await page.evaluate(()=>CM.getBatchSummary())).saved,0);
  assert.ok((await page.locator('#fallbackInfo').textContent()).includes('단정할 수 없습니다'));
  const observed=[];page.on('download',d=>observed.push(d.suggestedFilename()));
  await page.locator('#saveFolder').click();await new Promise(r=>setTimeout(r,1000));
  const observedBatchNames=[...observed];const calls=await page.evaluate(()=>window.__calls);assert.equal(calls.length,count);assert.deepEqual(calls.map(c=>c.name),names);assert.ok(calls.every(c=>c.header==='%PDF'&&c.gesture));
  assert.equal((await page.evaluate(()=>CM.getBatchSummary())).saved,0);assert.ok((await page.locator('#fallbackResult').textContent()).includes('실제 저장 완료는 확인할 수 없습니다'));
  const entries=await page.evaluate(()=>CM.getEntries());assert.ok(entries.every(e=>e.saveState==='deferred'&&e.downloadRequested&&e.saveStatus.includes('요청됨')&&!e.saveStatus.includes('저장 완료')));
  for(let i=0;i<count;i++){const data=Buffer.from(await page.evaluate(i=>Array.from(window.__payloads[i]),i));assert.equal((await PDFDocument.load(data)).getPageCount(),2);await fs.writeFile(resolve(out,`batch-${count}-${i}.pdf`),data);}
  // A per-file button remains available even if the batch request is blocked.
  const receivedIndex=Math.max(0,names.findIndex(n=>!observed.includes(n)));
  const event=page.waitForEvent('download',{timeout:1500}).then(d=>d.suggestedFilename(),()=>null);
  await page.locator('.download-pdf').nth(receivedIndex).click();const individualObserved=await event;
  assert.equal(await page.evaluate(()=>window.__calls.length),count+1);
  assert.equal(await page.locator('.download-pdf').nth(receivedIndex).isEnabled(),true);
  report.batches.push({count,fileMode,requested:count,observedBatchNames,individualRetryRequested:true,individualObserved,savedReported:0,requestsBeforePickerFailure:0,pickerCalls:await page.evaluate(()=>window.__pickerCalls),nativeFolderTest:false});
  await page.evaluate(()=>window.__suppressLinks=true);const beforeBlocked=await page.evaluate(()=>window.__calls.length);
  await page.locator('#downloadAll').click();assert.equal(await page.evaluate(()=>window.__calls.length),beforeBlocked+count);assert.equal((await page.evaluate(()=>CM.getBatchSummary())).saved,0);
  await page.evaluate(()=>window.__suppressLinks=false);const beforeRestart=await page.evaluate(()=>window.__calls.length);
  await page.locator('#restartDownloads').click();assert.equal(await page.evaluate(()=>window.__calls.length),beforeRestart+1);assert.equal(await page.locator('#save').isEnabled(),true);
  report.batches[report.batches.length-1].simulatedBlockedRequestsNotClaimedSaved=true;report.batches[report.batches.length-1].oneAtATimeRestart=true;
  // AbortError (protected dialog dismissal or cancellation) must also expose fallback.
  await page.evaluate(()=>{window.showDirectoryPicker=async()=>{throw new DOMException('The user aborted a request.','AbortError');};});
  await page.locator('#chooseFolder').click();assert.equal(await page.locator('#downloadFallback').isVisible(),true);assert.equal((await page.evaluate(()=>CM.getBatchSummary())).saved,0);
  if(await page.evaluate(()=>isSecureContext)){
   await page.evaluate(()=>{window.__writes=new Map();window.showDirectoryPicker=async()=>({name:'허용된 폴더 재현',queryPermission:async()=> 'granted',getFileHandle:async(name,options)=>{if(!window.__writes.has(name)&&!options?.create)throw new DOMException('missing','NotFoundError');return {createWritable:async()=>{let data;return {write:async b=>{data=b.slice();},close:async()=>window.__writes.set(name,data),abort:async()=>{}};}};}});});
   await page.locator('#chooseFolder').click();assert.equal(await page.evaluate(()=>CM.getSaveMode()),'folder');await page.locator('#saveFolder').click();await page.waitForFunction(()=>!document.querySelector('#analyze').disabled);
   assert.equal((await page.evaluate(()=>CM.getBatchSummary())).saved,count);assert.equal(await page.evaluate(()=>window.__writes.size),count);
  }
  await ctx.close();
 }
 const {ctx,page,fileMode}=await open();
 const source=execFileSync('git',['show','c5c40a0:windows/src/core.js'],{cwd:root}).toString();
 const old=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {values};').toString('base64'));
 const fixtures=JSON.parse(await fs.readFile(resolve(root,'tests/fixtures/counsel-output-cases.json'),'utf8'));
 const long=fixtures.find(c=>c.id==='firm-twelve-4-rows-comma');
 const cases=[
  {id:'regular',lines:['변 호 인 변호사 김가상'],expected:'김가상'},
  {id:'regular-lines',lines:['변 호 인','변호사','김가상'],expected:'김가상'},
  {id:'appointed',lines:['국선변호인 변호사 김가상'],expected:'김가상(국선)'},
  {id:'appointed-lines',lines:['변호인','국선변호사','김가상'],expected:'김가상(국선)'},
  {id:'firm-wrap',lines:['변 호 인 법무법인 가상(담당변호사 김가상, 강','가상, 박가상)'],expected:'가상) 김가상 강가상 박가상'},
  {id:'firm-long',lines:long.source,expected:long.expected},
  {id:'none',lines:['변호인 없음'],expected:''},
  {id:'missing',lines:[],expected:''},
 ];
 for(const kind of ['고정','고단'])for(const [index,c]of cases.entries()){
  const text=indictment(c.lines,kind);await analyze(page,[{name:`2026${kind}${8000+index}.pdf`,mimeType:'application/pdf',buffer:await makePDF(text)}]);
  const draft=await page.evaluate(()=>CM.getDraft());assert.equal(draft.defendants[0].counsel.name,c.expected);assert.equal(draft.defendants[0].detention,kind==='고정'?'released':'detained');
  assert.equal(draft.prosecutor,'이가상');assert.equal(draft.filingDate,'2026-11-17');assert.deepEqual(draft.defendants[0].charges,['특수상해']);
  const data=await page.evaluate(async()=>Array.from(await CM.MemoPDFRenderer.render(CM.getDraft(),{caseNumber:CM.getEntries()[0].caseNumber,firstHearing:{date:'20261120',time:'1000'}})));
  const id=`${kind==='고정'?'fixed':'ordinary'}-${c.id}`;await fs.writeFile(resolve(out,id+'.pdf'),Buffer.from(data));
  const before=old.IndictmentParser.parse({text,usedOCR:false,pages:[{text,height:842,lines:[]}]},{caseType:kind});
  if(c.id==='regular'&&kind==='고정'){
   assert.equal(before.defendants[0].counsel.status,'needsReview');
   // This comparison fixture has exactly one defendant; migrate its legacy schema.
   before.defendants[0].chargeAttribution='confirmed';
   const beforeBytes=await page.evaluate(async d=>Array.from(await CM.MemoPDFRenderer.render(d,{caseNumber:'2026고정8000',firstHearing:{date:'20261120',time:'1000'}})),before);await fs.writeFile(resolve(out,'fixed-regular-before.pdf'),Buffer.from(beforeBytes));
   report.boundaryComparison={beforeValue:old.values('변호인',text.split('\n')),beforeStatus:before.defendants[0].counsel.status,afterName:c.expected};
  }
  report.counselCases.push({id,kind,expected:c.expected,detention:kind==='고정'?'X':'O',file:id+'.pdf'});
 }
 report.fileMode=fileMode;report.passed=true;assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.errors,[]);await ctx.close();
}catch(e){report.passed=false;report.failure=e.stack;throw e;}
finally{await fs.writeFile(resolve(out,'edge-fixed-browser-report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,browser:report.browser,batches:report.batches.map(b=>({count:b.count,received:b.observedBatchNames.length})),cases:report.counselCases.length,failure:report.failure}));}
