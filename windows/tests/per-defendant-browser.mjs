import {chromium} from 'playwright-core';import {PDFDocument} from 'pdf-lib';import fontkit from '@pdf-lib/fontkit';import fs from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.CM_PER_DEF_ARTIFACTS||'/tmp/per-def-marks');await fs.mkdir(out,{recursive:true});
const html=resolve(root,'distribution/CriminalMemo/CriminalMemo.html'),old=resolve(out,'before.html');await fs.writeFile(old,execFileSync('git',['show','3375e0d:windows/distribution/CriminalMemo/CriminalMemo.html'],{cwd:root,maxBuffer:32*1024*1024}));
const browser=await chromium.launch({executablePath:process.env.CM_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage',...(process.env.CM_SOFTWARE_GL==='1'?['--use-gl=angle','--use-angle=swiftshader']:[])]});
const ctx=await browser.newContext({offline:true,acceptDownloads:true}),report={browser:browser.version(),htmlSHA256:createHash('sha256').update(await fs.readFile(html)).digest('hex'),fileMode:true,windowsEdge104Verified:false,externalRequests:[],errors:[],cases:[],uploads:[]};ctx.on('request',r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url());});
async function open(path){const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));await p.goto(pathToFileURL(path).href);await p.waitForFunction(()=>!!window.CM&&document.querySelector('#templateInfo').textContent.includes('최종 2페이지'));return p;}
const fatal='특정범죄가중처벌등에관한법률위반(도주치사)';
const person=(i,x={})=>({name:['김가상','이가상','박가상','최가상','윤가상','한가상'][i],birthDigits:'840318',birthCenturyDigit:'1',detention:'released',charges:['절도'],chargesComplete:true,chargeAttribution:'confirmed',counsel:i===0?{status:'named',name:'가상) 정가상 송가상'}:{status:'absentMissing',name:''},...x});
try{
 const p=await open(html),b=await open(old);
 const cases=['O','X','OO','OX','XO','XX','OXO',' OX','OXOXO'].map(seq=>({id:seq.replaceAll(' ','_'),mandatory:seq,jury:seq,people:[...seq].map((c,i)=>person(i,c==='O'?{charges:[fatal]}:c===' '?{birthDigits:'',charges:[],chargesComplete:false,chargeAttribution:'unknown'}:{}))}));
 cases.push({id:'different',mandatory:'XX',jury:'OX',people:[person(0,{charges:['특수상해','절도','폭행','모욕']}),person(1)]},{id:'causes',mandatory:'OOOX',jury:'XXXX',people:[person(0,{detention:'detained'}),person(1,{birthDigits:'081117',birthCenturyDigit:'3'}),person(2,{birthDigits:'561117'}),person(3)]});
 for(const c of cases){const draft={prosecutor:'최가상',filingDate:'2026-11-17',warnings:[],defendants:c.people};
  const actual=await p.evaluate(d=>({mandatory:CM.mandatoryGlyphs(d).map(g=>g.text).join(''),jury:CM.juryGlyphs(d).map(g=>g.text).join(''),chargeLines:CM.memoChargeLines(d)}),draft);assert.equal(actual.mandatory,c.mandatory);assert.equal(actual.jury,c.jury);
  for(const [label,page]of [['after',p],['before',b]]){const data=await page.evaluate(async draft=>Array.from(await CM.MemoPDFRenderer.render(draft,{caseNumber:'2026고단9000',firstHearing:{date:'20261118',time:'1000'}})),draft);await fs.writeFile(resolve(out,`${c.id}-${label}.pdf`),Buffer.from(data));}
  report.cases.push({id:c.id,...actual});
 }
 // Actual parser -> UI warnings -> multi-file analysis -> individual downloads.
 const fontBytes=await fs.readFile(resolve(root,'vendor/NanumGothic-Regular.ttf'));
 const identity=name=>`피고인 ${name} (840318-1******)\n구속여부 불구속`;
 const casesText=[
  {id:'separate',body:identity('김가상')+'\n죄명 '+fatal+'\n적용법조 가상법\n'+identity('이가상')+'\n죄명 절도\n적용법조 가상법',mandatory:'OX',jury:'OX'},
  {id:'scoped',body:identity('김가상')+'\n'+identity('이가상')+'\n죄명 김가상: 특수상해, 절도\n이가상: 절도\n적용법조 가상법',mandatory:'XX',jury:'OX'},
  {id:'shared',body:identity('김가상')+'\n'+identity('이가상')+'\n죄명 피고인 전원: '+fatal+'\n적용법조 가상법',mandatory:'OO',jury:'OO'},
  {id:'ambiguous',body:identity('김가상')+'\n'+identity('이가상')+'\n죄명 '+fatal+'\n적용법조 가상법',mandatory:'  ',jury:'  '},
 ];
 const files=[];for(const [i,c]of casesText.entries()){const text='가상지방검찰청\n2026.11.17.\n검사 최가상\nⅠ. 피고인 관련사항\n'+c.body+'\nⅡ. 공소사실';const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const font=await doc.embedFont(fontBytes);const page=doc.addPage([595,842]);text.split('\n').forEach((line,j)=>page.drawText(line,{x:20,y:810-j*17,size:9,font}));files.push({name:`2026고단${9500+i}.pdf`,mimeType:'application/pdf',buffer:Buffer.from(await doc.save())});}
 await p.locator('#file').setInputFiles(files);await p.locator('[data-field=date]').nth(0).fill('20261118');for(let i=0;i<files.length;i++)await p.locator('[data-field=time]').nth(i).fill(String(1000+i*100));await p.locator('#analyze').click();await p.waitForFunction(()=>!document.querySelector('#analyze').disabled,{}, {timeout:180000});
 const entries=await p.evaluate(()=>CM.getEntries());assert.ok(entries.every(e=>e.generated));
 for(const [i,c]of casesText.entries()){const actual=await p.evaluate(i=>{const d=CM.getEntries()[i].draft;return {mandatory:CM.mandatoryGlyphs(d).map(g=>g.text).join(''),jury:CM.juryGlyphs(d).map(g=>g.text).join(''),chargeLines:CM.memoChargeLines(d)};},i);assert.equal(actual.mandatory,c.mandatory);assert.equal(actual.jury,c.jury);if(c.id==='ambiguous')assert.ok(entries[i].warning.includes('귀속'));
  const pending=p.waitForEvent('download');await p.locator('.download-pdf').nth(i).click();const download=await pending;const file=`upload-${c.id}.pdf`;await download.saveAs(resolve(out,file));report.uploads.push({id:c.id,file,...actual,warning:entries[i].warning});
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.passed=true;
}finally{await fs.writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,uploads:report.uploads.length}));
