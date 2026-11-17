import { validDate } from './core.js';
export function normalizeHearingDate(value) {
  const s=String(value??'').trim();
  let m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s) || /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/.exec(s);
  if(!m || !validDate(+m[1],+m[2],+m[3])) return null;
  return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
}
export function normalizeHearingTime(value) {
  const s=String(value??'').trim();
  const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(s) || /^([01]\d|2[0-3])([0-5]\d)$/.exec(s);
  return m ? `${m[1]}:${m[2]}` : null;
}
export function assessFirstHearing(input = {}, {required=false} = {}) {
  const rawDate=String(input?.date??'').trim(),rawTime=String(input?.time??'').trim();
  const invalid=error=>({text:'',error});
  if(!rawDate && !rawTime && !required) return {text:'',error:''};
  if(!rawDate || !rawTime) return invalid('첫기일 날짜와 시간을 모두 입력하세요.');
  const date=normalizeHearingDate(rawDate),time=normalizeHearingTime(rawTime);
  if(!date) return invalid('첫기일 날짜는 실제 존재하는 YYYY-MM-DD 또는 YYYYMMDD 형식으로 입력하세요.');
  if(!time) return invalid('첫기일 시간은 24시간제 HH:mm 또는 HHmm 형식으로 입력하세요.');
  const [y,m,d]=date.split('-');
  return {text:`${y}. ${+m}. ${+d}.\n${time}`,error:''};
}
