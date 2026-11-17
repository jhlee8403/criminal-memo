import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import {markTextRects,markFitRects,markFontMetrics,fitOverlayMarks} from '../src/mark-layout.js';
const metrics=markFontMetrics(fontkit.create(fs.readFileSync(new URL('../vendor/NanumGothic-Regular.ttf',import.meta.url))));
const items=text=>[...text].map(text=>({text,color:text==='O'?'red':'black'}));
for(const text of ['O','X','OX','XO','OO','XX','OXX','XOO','OXOX','O X',' XO ','OXOXOXOXOX'])test('actual outline fit and centers '+JSON.stringify(text),()=>{
 const reference=markTextRects.juvenile,box=markFitRects.juvenile;
 const l=fitOverlayMarks(items(text),reference,box,metrics);
 assert.ok(l.fontSize>0);assert.equal(l.runs.length,text.replaceAll(' ','').length);
 for(const r of l.runs){
  const [x,y,w,h]=r.inkRect;
  assert.ok(x>=box[0]-.0001&&x+w<=box[0]+box[2]+.0001&&y>=box[1]-.0001&&y+h<=box[1]+box[3]+.0001);
  assert.ok(Math.abs(y+h/2-reference[1]-reference[3]/2)<1e-8);
  assert.equal(r.color,r.text==='O'?'red':'black');
 }
 const left=l.runs[0].inkRect,right=l.runs.at(-1).inkRect;
 if(!text.includes(' '))assert.ok(Math.abs((left[0]+right[0]+right[2])/2-reference[0]-reference[2]/2)<1e-8);
 if(text.length<=3){assert.ok(l.runs.every(r=>r.inkRect[3]>=reference[3]));}
 if(text.length===1)assert.ok(l.runs[0].inkRect[2]>=reference[2]-.0001);
});
for(const text of ['O','X'])test('jury single mark covers both printed characters '+text,()=>{
 const r=fitOverlayMarks(items(text),markTextRects.jury,markFitRects.jury,metrics).runs[0].inkRect;
 assert.ok(r[2]>=markTextRects.jury[2]-.0001&&r[3]>markTextRects.jury[3]);
 assert.ok(Math.abs(r[0]+r[2]/2-markTextRects.jury[0]-markTextRects.jury[2]/2)<1e-8);
});
test('fit decreases with long runs and preserves unconfirmed slots',()=>{
 const fit=t=>fitOverlayMarks(items(t),markTextRects.juvenile,markFitRects.juvenile,metrics);
 assert.ok(fit('OOO').fontSize<fit('O').fontSize);assert.ok(fit('OOOO').fontSize<fit('OOO').fontSize);
 assert.deepEqual(fit('   ').runs,[]);
 assert.deepEqual(fit('O X').runs.map(r=>r.index),[0,2]);
 assert.throws(()=>fit('Y'));
});
