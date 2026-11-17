import { zipSync } from 'fflate';
import { assessFirstHearing, normalizeHearingTime } from './first-hearing.js';
export function caseFromFilename(name) {
  const matches = [...String(name).normalize('NFC').matchAll(/(20\d{2})(고단|고정)(\d+)/g)];
  const cases = [...new Set(matches.map(m => m[0]))];
  if (cases.length !== 1) return { caseNumber: '', caseType: '', error: cases.length ? '파일명에 사건번호가 여러 개 있어 확정할 수 없습니다.' : '파일명에서 사건번호(20YY고단/고정+숫자)를 찾지 못했습니다.' };
  return { caseNumber: cases[0], caseType: cases[0].includes('고정') ? '고정' : '고단', error: '' };
}
export function memoFilename(caseNumber, firstHearing) {
  if (!/^20\d{2}(?:고단|고정)\d+$/.test(caseNumber)) throw Error('파일명 사건번호가 없습니다.');
  const assessment = assessFirstHearing(firstHearing, {required:true});
  if (assessment.error) throw Error(assessment.error);
  return `${normalizeHearingTime(firstHearing.time).replace(':','')} ${caseNumber}.pdf`;
}
export function createMemoZip(entries) {
  const files = Object.create(null);
  for (const entry of entries) {
    if (!entry.bytes) continue;
    if (Object.hasOwn(files, entry.name)) throw Error(`중복 저장 파일명: ${entry.name}. 사건번호와 시간을 확인하세요.`);
    files[entry.name] = entry.bytes;
  }
  if (!Object.keys(files).length) throw Error('생성된 메모가 없습니다.');
  return zipSync(files, {level:6});
}
