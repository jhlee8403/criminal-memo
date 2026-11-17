import * as services from './services.js';
import * as core from './core.js';
import * as hearing from './first-hearing.js';
import * as batch from './batch.js';
const $=id=>document.getElementById(id);
const state={entries:[],selected:null,busy:false,tab:'source',previewDoc:null,token:0,zoom:1};
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
const firstHearing=e=>({date:e.dateInput.value,time:e.timeInput.value});
const successful=()=>state.entries.filter(e=>e.bytes);
function updateDownload(){
  const outputs=successful();
  $('export').hidden=state.busy || !outputs.length;
  $('save').textContent=state.entries.length>1?`메모 ZIP 다운로드 (${outputs.length}개)`:'PDF 다운로드';
}
function setBusy(value){state.busy=value;$('file').disabled=value;$('analyze').disabled=value||!state.entries.length;$('forceOCR').disabled=value;updateDownload();}
function setRow(e,text,error=false){e.statusText.textContent=text;e.statusText.classList.toggle('error',error);}
function validateEntry(e){return e.meta.error || hearing.assessFirstHearing(firstHearing(e),{required:true}).error;}
function invalidate(e){
  e.revision++;e.bytes=null;e.filename='';
  const error=validateEntry(e);e.errorText.textContent=error;
  setRow(e,error?'입력 오류':'설정 변경 · 다시 분석하세요',!!error);
  if(state.selected===e && state.tab==='output'){state.tab='source';void preview();}
  updateDownload();
  if(!state.busy)status(`입력 변경 · 현재 생성된 메모 ${successful().length}개. 변경한 파일은 다시 분석하세요.`);
}
async function preview(){
  const token=++state.token;
  const entry=state.selected;
  $('canvasHost').replaceChildren();
  $('rawText').hidden=state.tab!=='text';$('canvasHost').hidden=state.tab==='text';
  $('outputTab').disabled=!entry?.bytes;
  $('people').replaceChildren();
  if(entry?.draft){
    const d=entry.draft;
    const lines=[`사건: ${entry.meta.caseNumber}`,`검사: ${d.prosecutor}`,`기소일: ${d.filingDate}`,
      ...d.defendants.flatMap((p,i)=>[`피고인 ${i+1}: ${p.name}`,`생년월일 앞 6자리: ${p.birthDigits}`,`죄명: ${p.charges.join(', ')}`,`변호인: ${p.counsel.status==='named'?p.counsel.name:p.counsel.status==='needsReview'?'판정 불가':'기재 없음'}`,`구속: ${p.detention==='detained'?'O':p.detention==='released'?'X':'판정 불가'}`]),
      ...d.warnings];
    for(const text of lines){const p=document.createElement('p');p.textContent=text;$('people').append(p);}
  }
  $('rawText').textContent=entry?.rawText||'';
  if(state.previewDoc){void state.previewDoc.destroy();state.previewDoc=null;}
  if(!entry || state.tab==='text')return;
  try{
    const doc=state.tab==='output'&&entry.bytes?await services.PDFInputService.fromBytes(entry.bytes):await services.PDFInputService.open(entry.file);
    if(token!==state.token){await doc.destroy();return;}
    state.previewDoc=doc;
    for(let n=1;n<=doc.numPages;n++){
      const canvas=await services.PDFTextExtractor.render(await doc.getPage(n),state.zoom*1.25);
      if(token!==state.token)return;
      $('canvasHost').append(canvas);
    }
  }catch(error){if(token===state.token)status(`미리보기 오류: ${error.message}`,true);}
}
function selectEntry(entry,tab='source'){state.selected=entry;state.tab=tab;void preview();}
function entryRow(file,index){
  const e={file,meta:batch.caseFromFilename(file.name),revision:0,bytes:null,filename:'',draft:null,rawText:''};
  const card=document.createElement('section');card.className='batch-item';card.dataset.index=String(index);
  const title=document.createElement('h3');title.textContent=`${index+1}. ${file.name}`;
  const caseText=document.createElement('p');caseText.textContent=e.meta.caseNumber||'사건번호 추출 실패';
  const input=(label,kind,placeholder)=>{
    const l=document.createElement('label');l.textContent=label;
    const i=document.createElement('input');i.type='text';i.inputMode='numeric';i.autocomplete='off';i.placeholder=placeholder;i.dataset.field=kind;l.append(i);card.append(l);return i;
  };
  card.append(title,caseText);
  e.dateInput=input('첫기일 날짜','date','20261118 또는 2026-11-18');
  e.timeInput=input('첫기일 시간','time','1000 또는 10:00');
  e.errorText=document.createElement('p');e.errorText.className='error';e.errorText.setAttribute('role','alert');
  e.statusText=document.createElement('p');e.statusText.setAttribute('role','status');
  const show=document.createElement('button');show.type='button';show.className='secondary';show.textContent='이 파일 보기';show.onclick=()=>selectEntry(e,e.bytes?'output':'source');
  card.append(e.errorText,e.statusText,show);e.card=card;
  e.dateInput.oninput=()=>{
    invalidate(e);
    if(index===0)for(const other of state.entries.slice(1)){
      if(other.dateInput.value!==e.dateInput.value){other.dateInput.value=e.dateInput.value;invalidate(other);}
    }
  };
  e.timeInput.oninput=()=>invalidate(e);
  e.errorText.textContent=e.meta.error;setRow(e,e.meta.error?'생성 제외 · 사건번호 오류':'첫기일 날짜와 시간을 입력하세요',!!e.meta.error);
  return e;
}
$('file').onchange=async()=>{
  if(state.busy)return;
  ++state.token;
  state.entries=Array.from($('file').files).map(entryRow);
  $('batchList').replaceChildren(...state.entries.map(e=>e.card));
  $('fileInfo').textContent=`${state.entries.length}개 파일 선택`;
  state.selected=state.entries[0]||null;state.tab='source';
  setBusy(false);
  status('첫 번째 날짜는 나머지 파일에도 복사됩니다. 시간은 파일마다 입력하세요.');
  await preview();
};
$('analyze').onclick=async()=>{
  if(state.busy||!state.entries.length)return;
  setBusy(true);
  const forceOCR=$('forceOCR').checked;
  // Refuse collisions before generation; a ZIP must never overwrite an earlier memo.
  const planned=new Map(),duplicates=new Set();
  for(const e of state.entries){
    e.bytes=null;e.filename='';e.errorText.textContent='';
    if(validateEntry(e))continue;
    const name=batch.memoFilename(e.meta.caseNumber,firstHearing(e));
    if(planned.has(name)){duplicates.add(e);duplicates.add(planned.get(name));}else planned.set(name,e);
  }
  try{
    for(const [index,e] of state.entries.entries()){
      const revision=e.revision;
      let pdf;
      try{
        const error=validateEntry(e);if(error)throw Error(error);
        if(duplicates.has(e))throw Error('같은 사건번호·시간의 저장 파일명이 중복됩니다. 입력을 확인하세요.');
        const first=firstHearing(e),filename=batch.memoFilename(e.meta.caseNumber,first);
        if(state.entries.some(other=>other!==e&&other.bytes&&other.filename===filename))throw Error('저장 파일명이 다른 생성 결과와 중복됩니다.');
        setRow(e,'분석 중');status(`${index+1}/${state.entries.length}: ${e.file.name}`);
        pdf=await services.PDFInputService.open(e.file);
        const extracted=await services.analyze(pdf,{forceOCR,progress:(text,p)=>setRow(e,`분석 중 · ${text}${Number.isFinite(p)?` ${Math.round(p*100)}%`:''}`)});
        e.rawText=extracted.text;e.draft=core.IndictmentParser.parse(extracted,{caseType:e.meta.caseType});
        const errors=core.validateDraft(e.draft);if(errors.length)throw Error(errors.join(' / '));
        setRow(e,'메모 생성 중');
        const bytes=await services.MemoPDFRenderer.render(e.draft,{firstHearing:first,caseNumber:e.meta.caseNumber});
        if(e.revision!==revision)throw Error('분석 중 입력값이 변경되었습니다. 다시 분석하세요.');
        e.bytes=bytes;e.filename=filename;setRow(e,`생성 완료 · ${filename}`);
      }catch(error){e.bytes=null;e.filename='';e.errorText.textContent=error.message;setRow(e,'오류 · 생성 제외',true);}
      finally{if(pdf)await pdf.destroy();}
    }
  }finally{
    setBusy(false);
    const outputs=successful();
    status(`생성 완료 ${outputs.length}/${state.entries.length}개. 오류·변경 파일은 목록의 사유를 확인하세요.`,outputs.length!==state.entries.length);
    state.selected=outputs[0]||state.entries[0];state.tab=outputs.length?'output':'source';
    await preview();
  }
};
$('save').onclick=()=>{
  if(state.busy)return;
  try{
    const outputs=successful();
    if(state.entries.length>1){
      const zip=batch.createMemoZip(outputs.map(e=>({name:e.filename,bytes:e.bytes})));
      services.PDFExportService.download(zip,'criminal-memo-batch',{zip:true});
    }else if(outputs[0])services.PDFExportService.download(outputs[0].bytes,outputs[0].filename.replace(/\.pdf$/,''));
  }catch(error){status(error.message,true);}
};
for(const [id,tab]of[['sourceTab','source'],['outputTab','output'],['textTab','text']])$(id).onclick=()=>{state.tab=tab;void preview();};
for(const [id,delta]of[['zoomIn',.25],['zoomOut',-.25]])$(id).onclick=()=>{state.zoom=Math.max(.5,Math.min(2,state.zoom+delta));$('zoomLabel').textContent=Math.round(state.zoom*100)+'%';void preview();};
window.CM={...services,...core,...hearing,...batch,getDraft:()=>state.selected?.draft,
  getEntries:()=>state.entries.map(e=>({name:e.file.name,...e.meta,firstHearing:firstHearing(e),filename:e.filename,status:e.statusText.textContent,error:e.errorText.textContent,generated:!!e.bytes,draft:e.draft}))};
services.PDFInputService.fromBytes(services.bytes(window.CM_DOCUMENTS.template)).then(async pdf=>{
  $('templateInfo').textContent=`내장 원본 양식: ${pdf.numPages}페이지`;await pdf.destroy();
}).catch(error=>status(error.message,true));
status('공소장 파일들을 선택하세요. 사건번호는 파일명에서 추출합니다.');
