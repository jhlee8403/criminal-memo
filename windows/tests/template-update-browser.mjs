// Template-only comparison: run the identical renderer/drafts with old/new originals.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.CM_TEMPLATE_ARTIFACTS||'/tmp/template-update-comparison');
await fs.mkdir(out,{recursive:true});
const old=execFileSync('git',['show','783b158:windows/templates/형사메모(1).pdf'],{cwd:root});
await fs.writeFile(resolve(out,'old-template.pdf'),old);
const html=resolve(root,'distribution/CriminalMemo/CriminalMemo.html');
const browser=await chromium.launch({executablePath:process.env.CM_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage',...(process.env.CM_SOFTWARE_GL==='1'?['--use-gl=angle','--use-angle=swiftshader']:[])]});
const ctx=await browser.newContext({offline:true});
const report={browser:browser.version(),htmlSHA256:createHash('sha256').update(await fs.readFile(html)).digest('hex'),fileMode:true,windowsEdge104Verified:false,externalRequests:[],errors:[],cases:[]};
ctx.on('request',r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url());});
try{
 const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(pathToFileURL(html).href);
 await page.waitForFunction(()=>!!window.CM&&document.querySelector('#templateInfo').textContent.includes('최종 2페이지'));
 const people=seq=>[...seq].map((c,i)=>({name:['김가상','이가상','박가상'][i],birthDigits:c==='O'?'080318':'840318',birthCenturyDigit:c==='O'?'3':'2',birthReview:false,detention:i===0?'detained':'released',charges:i===0?['특수상해']:['절도'],chargesComplete:true,counsel:i===0?{status:'named',name:'가상) 김가상 이가상 박가상 최가상 강가상 윤가상 한가상 정가상 조가상 송가상 임가상 오가상'}:{status:'absentMissing',name:''}}));
 const drafts=[
  {id:'case-only',draft:{prosecutor:'',filingDate:'',warnings:[],defendants:[]}},
  {id:'single',draft:{prosecutor:'최가상',filingDate:'2026-11-17',warnings:[],defendants:people('X')}},
  {id:'appointed',draft:{prosecutor:'최가상',filingDate:'2026-11-17',warnings:[],defendants:[{...people('O')[0],counsel:{status:'named',name:'김가상(국선)'}}]}},
  ...['OX','XO','OXX'].map(seq=>({id:'multiple-'+seq,draft:{prosecutor:'최가상',filingDate:'2026-11-17',warnings:[],defendants:people(seq)}})),
 ];
 for(const {id,draft}of drafts){
  for(const version of ['old','new']){
   const data=await page.evaluate(async({draft,old})=>Array.from(await CM.MemoPDFRenderer.render(draft,{caseNumber:'2026고단9000',firstHearing:{date:'20261118',time:'1000'},...(old?{templateBytes:Uint8Array.from(old)}:{})})),{draft,old:version==='old'?Array.from(old):null});
   await fs.writeFile(resolve(out,`${id}-${version}.pdf`),Buffer.from(data));
  }
  report.cases.push(id);
 }
 assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await fs.writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
