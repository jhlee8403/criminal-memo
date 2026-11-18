import {parseDate,birthAssessment} from './core.js';
import {writeMemo} from './storage.js';
export function extractionFailures(draft) {
  if(!draft)return [];
  const missing=new Set();
  if(!draft.prosecutor?.trim())missing.add('검사');
  if(!parseDate(draft.filingDate))missing.add('기소일');
  if(!draft.defendants.length)for(const label of ['피고인','생년월일','죄명','변호인','구속 여부'])missing.add(label);
  for(const p of draft.defendants){
    if(!p.name?.trim())missing.add('피고인');
    if(!/^\d{6}$/.test(p.birthDigits||''))missing.add('생년월일');
    if(!birthAssessment(p,draft.filingDate).resolved)missing.add('나이 판정');
    if(!p.charges.length || p.chargesComplete===false)missing.add('죄명');
    if(p.counsel.status==='needsReview' || p.counsel.status==='named'&&!p.counsel.name?.trim())missing.add('변호인');
    if(!['detained','released'].includes(p.detention))missing.add('구속 여부');
  }
  return [...missing];
}
export function batchSummary(entries) {
  return {total:entries.length,generated:entries.filter(e=>!!e.bytes).length,
    saved:entries.filter(e=>e.bytes&&e.saveState==='saved'&&e.saveRevision===e.revision).length,
    saveFailed:entries.filter(e=>e.bytes&&e.saveState==='failed').length,
    warnings:entries.filter(e=>e.missingFields?.length || e.hasWarnings).length,
    generationFailed:entries.filter(e=>e.generationState==='failed').length,
    pending:entries.filter(e=>e.bytes&&e.saveState!=='failed'&&!(e.saveState==='saved'&&e.saveRevision===e.revision)).length};
}
// Each close is awaited before the next write. Source File objects are never modified.
export async function saveMemosToFolder(entries,folder,{onChange=()=>{},writer=writeMemo}={}) {
  for(const e of entries){
    if(!e.bytes)continue;
    if(e.saveState==='saved'&&e.saveRevision===e.revision&&e.savedFolder===folder)continue;
    const data=e.bytes,filename=e.filename,revision=e.revision;
    e.saveState='saving';e.saveError='';onChange(e);
    try{
      await writer(folder,filename,data);
      if(e.revision!==revision){e.saveState='deferred';e.saveError='이전 입력값의 파일이 저장되었습니다. 현재 입력으로 다시 생성하세요.';}
      else{e.saveState='saved';e.saveRevision=revision;e.savedFolder=folder;}
    }catch(error){e.saveState='failed';e.saveError=error.message||String(error);}
    onChange(e);
  }
}
