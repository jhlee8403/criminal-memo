import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFirstHearing} from '../src/first-hearing.js';
test('hearing is optional and formats exactly two lines',()=>{
  assert.deepEqual(assessFirstHearing(),{text:'',error:''});
  assert.deepEqual(assessFirstHearing({date:' ',time:''}),{text:'',error:''});
  assert.deepEqual(assessFirstHearing({date:'2026-11-18',time:'10:00'}),{text:'2026. 11. 18.\n10:00',error:''});
  assert.equal(assessFirstHearing({date:'2024-02-29',time:'00:00'}).text,'2024. 2. 29.\n00:00');
  assert.equal(assessFirstHearing({date:'9999-12-31',time:'23:59'}).text,'9999. 12. 31.\n23:59');
});
for(const [date,time] of [
  ['2026-11-18',''],['','10:00'],['2026-02-29','10:00'],['2026-04-31','10:00'],
  ['0000-01-01','10:00'],['2026-13-01','10:00'],['2026-11-18','24:00'],
  ['2026-11-18','10:60'],['2026-11-18','1:00'],['2026-11-18','10:00:00'],
  ['2026-1-2','10:00'],['invalid','10:00'],['2026-11-18','invalid'],
])test(`reject incomplete or invalid hearing ${date} ${time}`,()=>{
  const result=assessFirstHearing({date,time});assert.ok(result.error);assert.equal(result.text,'');
});
