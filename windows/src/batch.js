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
