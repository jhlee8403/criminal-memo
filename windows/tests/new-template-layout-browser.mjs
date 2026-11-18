import {chromium} from 'playwright-core';
import {PDFDocument} from 'pdf-lib';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.CM_MARK_ARTIFACTS||resolve(root,'artifacts/new-template-layout'));
await fs.mkdir(out,{recursive:true});
const htmlPath=resolve(root,'distribution/CriminalMemo/CriminalMemo.html');
const html=await fs.readFile(htmlPath,'utf8');

const browser=await chromium.launch({executablePath:process.env.CM_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage',...(process.env.CM_SOFTWARE_GL==='1'?['--use-gl=angle','--use-angle=swiftshader']:[])]});
const context=await browser.newContext({offline:true});
const report={browser:browser.version(),htmlSHA256:createHash('sha256').update(html).digest('hex'),windowsEdge104Verified:false,externalRequests:[],errors:[],cases:[]};
context.on('request',r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url());});
const mask=process.env.CM_NO_MODERN_APIS==='1';
const init=()=>{delete Promise.withResolvers;delete Object.getPrototypeOf(Uint8Array.prototype).toSorted;delete ArrayBuffer.prototype.transfer;for(const name of ['union','intersection','difference','symmetricDifference','isDisjointFrom','isSubsetOf','isSupersetOf'])delete Set.prototype[name];delete AbortSignal.any;window.__withoutResolvers=typeof Promise.withResolvers;};
if(mask)await context.addInitScript(init);
async function load(path,content){
 let p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 let fileMode=true;
 try{await p.goto(pathToFileURL(path).href);}catch(e){if(!e.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR'))throw e;fileMode=false;await p.close();p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));if(mask)await p.evaluate(init);await p.setContent(content);}
 await p.waitForFunction(()=>!!window.CM && document.querySelector('#templateInfo').textContent.includes('최종 2페이지'));
 return {p,fileMode};
}
const blank=await PDFDocument.create();blank.addPage([595,841]);const original=await PDFDocument.load(await fs.readFile(resolve(root,'templates/형사메모(1).pdf')));const [p2]=await blank.copyPages(original,[1]);blank.addPage(p2);const blankBytes=Array.from(await blank.save());
const cases=[['O','O'],['X','X'],['OX','O'],['XO','X'],['OO','O'],['XX','X'],['OXX','O'],['XOO','X'],['OXOX','O'],['O X',''],[' ',''],[' XO ','O']];
const names=['김가상','이가상','박가상','최가상'];
try{
 const current=await load(htmlPath,html);
 report.fileMode=current.fileMode;report.maskRequested=mask;
 if(mask)assert.equal(await current.p.evaluate(()=>window.__withoutResolvers),'undefined');
 assert.equal(await current.p.evaluate(()=>typeof Promise.withResolvers),'function');
 for(const [i,[seq,jury]]of cases.entries()){
  const draft={prosecutor:'김가상',filingDate:'2026-11-17',warnings:[],defendants:[...seq].map((c,index)=>({name:names[index],birthDigits:c==='X'?'840318':'080318',birthCenturyDigit:c==='X'?'2':c==='O'?'3':'',birthReview:false,detention:i===6&&index===0?'detained':'released',counsel:index===0?{status:'named',name:'가상) 김가상 이가상 박가상'}:{status:'absentMissing',name:''},charges:jury===''?[]:jury==='O'&&index===0?['특수상해']:['절도'],chargesComplete:jury!==''}))};
  const expected={youth:seq,jury};
  const actual=await current.p.evaluate(d=>({youth:CM.juvenileGlyphs(d).map(g=>g.text).join(''),jury:CM.juryGlyph(d).text.trim()}),draft);
  assert.deepEqual(actual,expected);
  const id=String(i).padStart(2,'0');
  for(const [version,target]of [['after',current.p]])for(const diagnostic of [false,true]){
   const filename=`${id}-${version}${diagnostic?'-ink':''}.pdf`;
   const bytes=await target.evaluate(async({draft,blank})=>Array.from(await CM.MemoPDFRenderer.render(draft,{caseNumber:'2026고단8000',firstHearing:{date:'20261118',time:'1000'},...(blank?{templateBytes:Uint8Array.from(blank)}:{})})),{draft,blank:diagnostic?blankBytes:null});
   await fs.writeFile(resolve(out,filename),Buffer.from(bytes));assert.equal((await PDFDocument.load(Uint8Array.from(bytes))).getPageCount(),2);
  }
  report.cases.push({id,...expected});
 }
 assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.passed=false;report.failure=e.stack;throw e;}
finally{await fs.writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,browser:report.browser,fileMode:report.fileMode,cases:report.cases.length}));}
