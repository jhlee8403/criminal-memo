// Optional user-supplied hearing only; indictment extraction remains automatic.
import { validDate } from './core.js';
export function assessFirstHearing(input = {}) {
  const date = String(input?.date ?? '').trim();
  const time = String(input?.time ?? '').trim();
  const invalid = error => ({ text: '', error });
  if (!date && !time) return { text: '', error: '' };
  if (!date || !time) return invalid('첫기일 날짜와 시간을 모두 입력하세요.');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || !validDate(+match[1], +match[2], +match[3]))
    return invalid('첫기일 날짜는 실제 존재하는 YYYY-MM-DD 형식으로 입력하세요.');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
    return invalid('첫기일 시간은 24시간제 HH:mm 형식으로 입력하세요.');
  return { text: `${match[1]}. ${+match[2]}. ${+match[3]}.\n${time}`, error: '' };
}
