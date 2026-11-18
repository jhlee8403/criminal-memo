import * as services from './services.js';
import * as core from './core.js';
import * as hearing from './first-hearing.js';
import * as batch from './batch.js';
import * as storage from './storage.js';
import * as saving from './batch-save.js';
const $=id=>document.getElementById(id);
const state={entries:[],selected:null,busy:false,tab:'source',previewDoc:null,token:0,zoom:1,folder:null,saving:false};
function status(text,error=false){$('status').textContent=core.redactResidentNumbers(text);$('status').classList.toggle('error',error);}
const firstHearing=e=>({date:e.dateInput.value,time:e.timeInput.value});
const successful=()=>state.entries.filter(e=>e.bytes);
function updateDownload(){
  const outputs=successful();
  $('export').hidden=state.busy || !outputs.length;
  const pending=outputs.filter(e=>!e.downloadRequested);
  $('save').textContent=pending.length?`다음 메모 다운로드 (${outputs.length-pending.length+1}/${outputs.length}) · ${pending[0].filename}`:'모든 메모 다운로드 요청됨';
  $('save').disabled=state.busy||!pending.length;
  $('saveFolder').disabled=state.busy || !outputs.length;
  for(const e of state.entries){e.downloadButton.disabled=state.busy||!e.bytes;e.folderButton.disabled=state.busy||!e.bytes||!state.folder;e.dateInput.disabled=state.saving;e.timeInput.disabled=state.saving;updateAudit(e);}
  updateSummary();
}
function resetSave(e){e.saveState='idle';e.saveError='';e.saveRevision=-1;e.savedFolder=null;}
function updateSummary(){
  const r=saving.batchSummary(state.entries);
  $('batchSummary').textContent=`전체 공소장 ${r.total}개 / 메모 생성 성공 ${r.generated}개 / 저장 성공 ${r.saved}개 / 저장 실패 ${r.saveFailed}개 / 추출 경고 사건 ${r.warnings}개 / 생성 실패 ${r.generationFailed}개 / 미저장·보류 ${r.pending}개`;
}
function updateAudit(e){
  const label={idle:'미저장',saving:'저장 중',saved:'폴더 저장 완료',failed:'저장 실패',deferred:'저장 보류'}[e.saveState]||'미저장';
  e.auditText.textContent=`${e.card.dataset.index*1+1}번 파일 / ${e.meta.caseNumber||'사건번호 없음'} / 추출 실패: ${e.draft?(e.missingFields.join(', ')||'없음'):e.generationState==='failed'?'분석 불가':'분석 전'} / ${e.bytes?'메모 생성 완료':e.generationState==='failed'?'메모 생성 실패':'메모 미생성'} / ${label}`;
  e.savedText.textContent=label+(e.saveError?' · '+core.redactResidentNumbers(e.saveError):'')+(e.downloadRequested?' · 다운로드 요청됨(실제 저장 여부는 브라우저에서 확인)':'');
}
function acceptFolder(folder){state.folder=folder;for(const e of state.entries)resetSave(e);$('folderInfo').textContent=`선택 폴더: ${folder.name} · 전체 메모 저장 또는 사건별 폴더 저장을 누르세요.`;}
function setBusy(value){state.busy=value;$('file').disabled=value;$('analyze').disabled=value||!state.entries.length;$('forceOCR').disabled=value;$('chooseFolder').disabled=value;updateDownload();}
function setRow(e,text,error=false){e.statusText.textContent=text;e.statusText.classList.toggle('error',error);}
function validateEntry(e){return e.meta.error || hearing.assessFirstHearing(firstHearing(e),{required:true}).error;}
function invalidate(e){
  e.revision++;e.bytes=null;e.filename='';resetSave(e);e.generationState='pending';e.missingFields=[];e.hasWarnings=false;e.savedText.textContent='';e.warningText.textContent='';e.downloadRequested=false;
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
      `소년: ${core.juvenileGlyphs(d).map(g=>g.text).join('')}`,`국참(지정 죄명 자동 분류): ${core.juryGlyph(d).text.trim()||'보류'}`,
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
  const e={file,meta:batch.caseFromFilename(file.name),revision:0,bytes:null,filename:'',draft:null,rawText:'',downloadRequested:false,generationState:'pending',missingFields:[],hasWarnings:false,saveState:'idle',saveRevision:-1,saveError:'',savedFolder:null};
  const card=document.createElement('section');card.className='batch-item';card.dataset.index=String(index);
  const title=document.createElement('h3');title.textContent=`${index+1}. ${core.redactResidentNumbers(file.name)}`;
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
  e.warningText=document.createElement('p');e.warningText.className='warning';e.warningText.setAttribute('role','status');
  e.auditText=document.createElement('p');e.auditText.className='file-audit';
  e.savedText=document.createElement('p');e.savedText.className='save-status';
  e.downloadButton=document.createElement('button');e.downloadButton.type='button';e.downloadButton.className='download-pdf';e.downloadButton.textContent='이 메모 다운로드';e.downloadButton.disabled=true;e.downloadButton.onclick=()=>downloadEntry(e);
  e.folderButton=document.createElement('button');e.folderButton.type='button';e.folderButton.className='folder-save secondary';e.folderButton.textContent='이 메모 폴더 저장';e.folderButton.disabled=true;e.folderButton.onclick=()=>saveToFolder(e);
  const show=document.createElement('button');show.type='button';show.className='secondary';show.textContent='이 파일 보기';show.onclick=()=>selectEntry(e,e.bytes?'output':'source');
  card.append(e.auditText,e.errorText,e.warningText,e.statusText,e.savedText,show,e.downloadButton,e.folderButton);e.card=card;
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
  // Refuse duplicate planned names before generation and folder saving.
  const planned=new Map(),duplicates=new Set();
  for(const e of state.entries){
    e.bytes=null;e.filename='';e.errorText.textContent='';e.warningText.textContent='';e.savedText.textContent='';e.draft=null;e.rawText='';e.downloadRequested=false;resetSave(e);e.generationState='pending';e.missingFields=[];e.hasWarnings=false;
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
        e.rawText=core.redactResidentNumbers(extracted.text);
        try { e.draft=core.IndictmentParser.parse(extracted,{caseType:e.meta.caseType}); }
        catch (error) { e.draft={prosecutor:'',filingDate:null,defendants:[],warnings:[`정보 해석 실패: ${error.message}`]}; }
        const warnings=[...new Set([...core.validateDraft(e.draft),...e.draft.warnings,...e.draft.defendants.flatMap((p,i)=>core.birthAssessment(p,e.draft.filingDate).warnings.map(w=>`피고인 ${i+1}: ${w}`)),...(core.juryGlyph(e.draft).text===' '?['죄명 정보가 불완전하여 국참 자동 분류 표시를 보류합니다.']:[]),...(extracted.warnings||[])])];
        e.missingFields=saving.extractionFailures(e.draft);e.hasWarnings=warnings.length>0||e.missingFields.length>0;
        e.warningText.textContent=e.hasWarnings?'추출 경고 · 확인되지 않은 항목은 빈칸으로 생성합니다: '+(warnings.length?warnings.join(' / '):e.missingFields.join(', ')):'';
        setRow(e,'메모 생성 중');
        const bytes=await services.MemoPDFRenderer.render(e.draft,{firstHearing:first,caseNumber:e.meta.caseNumber});
        if(e.revision!==revision)throw Error('분석 중 입력값이 변경되었습니다. 다시 분석하세요.');
        e.bytes=bytes;e.filename=filename;e.generationState='generated';setRow(e,`생성 완료${e.hasWarnings?' (추출 경고 있음)':''} · ${filename}`);
      }catch(error){e.bytes=null;e.filename='';e.generationState='failed';e.errorText.textContent=core.redactResidentNumbers(error.message);setRow(e,'생성 오류 · 제외',true);}
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
function downloadEntry(e){
  if(state.busy||!e.bytes)return;
  services.PDFExportService.download(e.bytes,e.filename.replace(/\.pdf$/,''));
  e.downloadRequested=true;
  updateAudit(e);
  updateDownload();
}
async function writeSelected(entries){
  if(state.busy||!entries.some(e=>e.bytes))return;
  state.saving=true;setBusy(true);
  try{
    if(!state.folder)acceptFolder(await storage.chooseFolder());
    await saving.saveMemosToFolder(entries,state.folder,{onChange:()=>{for(const e of entries)updateAudit(e);updateSummary();}});
    const result=saving.batchSummary(state.entries);
    status(`전체 저장 작업 종료 · 저장 성공 ${result.saved}개 / 실패 ${result.saveFailed}개. 사건별 상태와 추출 경고를 확인하세요.`,result.saveFailed>0);
  }catch(error){
    if(error.name!=='AbortError'){
      for(const e of entries)if(e.bytes&&e.saveState!=='saved'){e.saveState='deferred';e.saveError=error.message;}
      $('folderInfo').textContent='폴더 직접 저장 불가 · '+core.redactResidentNumbers(error.message)+' 사건별 또는 다음 메모 다운로드를 사용하세요.';
      status('폴더에 저장하지 못했습니다. 개별 다운로드를 사용할 수 있습니다.',true);
    }else status('저장 폴더 선택을 취소했습니다. 저장 완료로 처리하지 않았습니다.');
  }finally{state.saving=false;setBusy(false);}
}
async function saveToFolder(e){await writeSelected([e]);}
$('chooseFolder').onclick=async()=>{
  if(state.busy)return;
  try{acceptFolder(await storage.chooseFolder());}
  catch(error){if(error.name!=='AbortError')$('folderInfo').textContent='폴더 선택 불가 · '+core.redactResidentNumbers(error.message)+' 개별 다운로드를 사용하세요.';}
  updateDownload();
};
$('saveFolder').onclick=()=>writeSelected(successful());
$('save').onclick=()=>{
  if(state.busy)return;
  const next=successful().find(e=>!e.downloadRequested);
  if(next)downloadEntry(next);
  status('한 번 클릭할 때 메모 하나만 다운로드 요청합니다. 다음 메모 버튼을 계속 누르세요. 차단되거나 저장되지 않은 파일은 각 사건의 이 메모 다운로드 버튼을 누르세요. 실제 저장 완료는 브라우저에서 확인하세요.');
};
$('folderInfo').textContent=storage.canChooseFolder()?'폴더를 직접 선택해 저장할 수 있습니다. 회사 정책에 따라 제한될 수 있습니다.':'폴더 직접 저장을 지원하지 않는 환경입니다. 각 사건의 개별 다운로드를 사용하세요.';
for(const [id,tab]of[['sourceTab','source'],['outputTab','output'],['textTab','text']])$(id).onclick=()=>{state.tab=tab;void preview();};
for(const [id,delta]of[['zoomIn',.25],['zoomOut',-.25]])$(id).onclick=()=>{state.zoom=Math.max(.5,Math.min(2,state.zoom+delta));$('zoomLabel').textContent=Math.round(state.zoom*100)+'%';void preview();};
window.CM={...services,...core,...hearing,...batch,...storage,...saving,getDraft:()=>state.selected?.draft,getBatchSummary:()=>saving.batchSummary(state.entries),
  getEntries:()=>state.entries.map(e=>({name:core.redactResidentNumbers(e.file.name),...e.meta,firstHearing:firstHearing(e),filename:e.filename,status:e.statusText.textContent,error:e.errorText.textContent,warning:e.warningText.textContent,saveStatus:e.savedText.textContent,downloadRequested:e.downloadRequested,generationState:e.generationState,missingFields:e.missingFields,saveState:e.saveState,saveError:e.saveError,generated:!!e.bytes,draft:e.draft}))};
services.PDFInputService.fromBytes(services.bytes(window.CM_DOCUMENTS.template)).then(async pdf=>{
  try{if(pdf.numPages!==2)throw Error('원본 양식은 2페이지여야 합니다.');$('templateInfo').textContent='내장 새 원본 양식: 2페이지 · 최종 2페이지';}finally{await pdf.destroy();}
}).catch(error=>status('원본 양식 로딩 오류: '+error.message,true));
status('공소장 파일들을 선택하세요. 사건번호는 파일명에서 추출합니다.');
