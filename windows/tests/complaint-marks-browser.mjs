import {chromium} from 'playwright-core';
import {PDFDocument} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.CM_COMPLAINT_ARTIFACTS||'/tmp/complaint-marks');
await fs.mkdir(out,{recursive:true});
const htmlPath=resolve(root,'distribution/CriminalMemo/CriminalMemo.html');
const before=resolve(out,'before.html');await fs.writeFile(before,execFileSync('git',['show','5e341b7:windows/distribution/CriminalMemo/CriminalMemo.html'],{cwd:root,maxBuffer:32*1024*1024}));
const browser=await chromium.launch({executablePath:process.env.CM_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage',...(process.env.CM_SOFTWARE_GL==='1'?['--use-gl=angle','--use-angle=swiftshader']:[])]});
const ctx=await browser.newContext({offline:true,acceptDownloads:true});
const report={browser:browser.version(),htmlSHA256:createHash('sha256').update(await fs.readFile(htmlPath)).digest('hex'),fileMode:true,windowsEdge104Verified:false,cases:[],externalRequests:[],errors:[]};
ctx.on('request',r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url());});
async function open(path){const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));await p.goto(pathToFileURL(path).href);await p.waitForFunction(()=>!!window.CM&&document.querySelector('#templateInfo').textContent.includes('최종 2페이지'));return p;}
const person=charges=>({name:'김가상',birthDigits:'080318',birthCenturyDigit:'3',detention:'detained',charges,chargesComplete:charges.length>0,counsel:{status:'named',name:'이가상(국선)'}});
try{
 const p=await open(htmlPath),b=await open(before);
 const targets=['폭행','존속폭행','과실치상','협박','존속협박','명예훼손','출판물에의한명예훼손','근로기준법위반','근로자퇴직급여보장법위반','사자명예훼손','모욕','비밀침해','업무상비밀누설'];
 const cases=targets.map((c,i)=>({id:`target-${i+1}`,lists:[[c]],expected:{opposition:i<9,complaint:i>=9}}));
 cases.push(
  {id:'none',lists:[['특수폭행','특수협박','업무상과실치상','절도']],expected:{opposition:false,complaint:false}},
  {id:'both',lists:[['폭행','모욕','명예훼손']],expected:{opposition:true,complaint:true}},
  {id:'multiple',lists:[['절도'],['출판물에 의한 명예훼손'],['사자 명예훼손']],expected:{opposition:true,complaint:true}},
  {id:'unknown',lists:[[]],expected:{opposition:false,complaint:false}},
  {id:'jury',lists:[['특수상해','폭행','모욕']],expected:{opposition:true,complaint:true}},
 );
 for(const c of cases){
  const draft={prosecutor:'최가상',filingDate:'2026-11-17',warnings:[],defendants:c.lists.map(person)};
  assert.deepEqual(await p.evaluate(d=>CM.complaintMarks(d),draft),c.expected);
  const paired=['none','both','multiple','unknown','jury'].includes(c.id);
  for(const [label,page]of paired?[['after',p],['before',b]]:[['after',p]]){
   const bytes=await page.evaluate(async draft=>Array.from(await CM.MemoPDFRenderer.render(draft,{caseNumber:'2026고단9000',firstHearing:{date:'20261118',time:'1000'}})),draft);
   await fs.writeFile(resolve(out,`${c.id}-${label}.pdf`),Buffer.from(bytes));
  }
  report.cases.push({...c,paired});
 }
 // Actual PDF selection -> analysis -> preview -> download, then a two-file batch.
 const fontBytes=await fs.readFile(resolve(root,'vendor/NanumGothic-Regular.ttf'));
 async function source(charges){
  const text=`가상지방검찰청\n2026.11.17.\n검사 최가상\nⅠ. 피고인 관련사항\n피고인 김가상 (080318-3******)\n죄명 ${charges}\n적용법조 가상법 제1조\n구속여부 구속\n변호인 국선변호사 이가상\nⅡ. 공소사실`;
  const d=await PDFDocument.create();d.registerFontkit(fontkit);const f=await d.embedFont(fontBytes);const page=d.addPage([595,842]);text.split('\n').forEach((line,i)=>page.drawText(line,{x:20,y:810-i*18,size:10,font:f}));return Buffer.from(await d.save());
 }
 const sources=[{name:'2026고단9100.pdf',mimeType:'application/pdf',buffer:await source('폭행, 모욕')},{name:'2026고정9101.pdf',mimeType:'application/pdf',buffer:await source('특수폭행')}];
 report.uploads=[];
 for(const count of [1,2]){
  await p.locator('#file').setInputFiles(sources.slice(0,count));await p.locator('[data-field=date]').nth(0).fill('20261118');
  for(let i=0;i<count;i++)await p.locator('[data-field=time]').nth(i).fill(i?'1030':'1000');
  await p.locator('#analyze').click();await p.waitForFunction(()=>!document.querySelector('#analyze').disabled,{}, {timeout:180000});
  const entries=await p.evaluate(()=>CM.getEntries());assert.ok(entries.every(e=>e.generated));
  for(let i=0;i<count;i++){
   const expected=i?{opposition:false,complaint:false}:{opposition:true,complaint:true};
   assert.deepEqual(await p.evaluate(i=>CM.complaintMarks(CM.getEntries()[i].draft),i),expected);
   const pending=p.waitForEvent('download');await p.locator('.download-pdf').nth(i).click();const download=await pending;
   assert.equal(download.suggestedFilename(),entries[i].filename);
   const file=`upload-${count}-${i}.pdf`;await download.saveAs(resolve(out,file));report.uploads.push({file,expected,name:download.suggestedFilename()});
  }
  await p.locator('#outputTab').click();await p.waitForFunction(()=>!!document.querySelector('#canvasHost canvas'));
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.passed=true;
}finally{await fs.writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,uploads:report.uploads?.length}));
