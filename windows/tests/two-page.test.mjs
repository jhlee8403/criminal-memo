import test from 'node:test';
import assert from 'node:assert/strict';
import {juvenileMark,ageMarks,emptyDefendant,detentionGlyphs,validateDraft,IndictmentParser} from '../src/core.js';
import {canChooseFolder,chooseFolder,writeMemo,FolderUnavailable} from '../src/storage.js';
const person=(digits,birth,detention='released')=>({...emptyDefendant(),birthDigits:digits,birthDateEvidence:birth?[birth]:[],detention});
const draft=defendants=>({defendants,filingDate:'2026-11-17'});
for(const [name,people,expected]of[
 ['juvenile',[person('071118','2007-11-18')],'circle'],
 ['19th birthday',[person('071117','2007-11-17')],'cross'],
 ['adult',[person('900101','1990-01-01')],'cross'],
 ['century unknown',[person('071118')],''],
 ['no defendants',[],''],
 ['juvenile wins unknown',[person('071118'),person('071118','2007-11-18')],'circle'],
 ['adult and unknown',[person('900101','1990-01-01'),person('071118')],''],
 ['all adults',[person('900101','1990-01-01'),person('561118','1956-11-18')],'cross'],
])test('juvenile mark: '+name,()=>assert.equal(juvenileMark(draft(people)),expected));
test('unknown filing date, stated age and resident suffix cannot produce an X',()=>{
 const p={...person('071118'),statedAge:70,residentNumber:'071118-1000000'};
 assert.equal(juvenileMark(draft([p])),'');
 assert.equal(juvenileMark({...draft([person('900101','1990-01-01')]),filingDate:null}),'');
});
test('mandatory mark still includes detention despite uncertain age',()=>assert.deepEqual(ageMarks(draft([person('071118',null,'detained')])),{juvenile:false,mandatory:true}));
test('partial detention preserves defendant slots without inferring an X',()=>{
 const people=[person('900101',null,'detained'),person('920202',null,'unknown'),person('930303')];
 assert.throws(()=>detentionGlyphs(people));
 assert.deepEqual(detentionGlyphs(people,{partial:true}),[{text:'O',color:'red'},{text:' ',color:'black'},{text:'X',color:'black'}]);
});
test('validation diagnostics remain available for completely missing extraction',()=>{
 const text='가상 안내문으로 공소장에 필요한 모든 정보가 없는 재현 자료입니다.';
 const d=IndictmentParser.parse({text,usedOCR:false,pages:[{text,lines:[],height:842}]});
 assert.equal(d.prosecutor,'');assert.equal(d.filingDate,null);assert.equal(d.defendants.length,0);
 assert.ok(validateDraft(d).some(v=>v.includes('검사')));assert.ok(validateDraft(d).some(v=>v.includes('피고인')));
});
test('folder detection requires secure context and actual picker',async()=>{
 assert.equal(canChooseFolder({isSecureContext:true,showDirectoryPicker(){}}),true);
 for(const scope of [{isSecureContext:false,showDirectoryPicker(){}},{isSecureContext:true},{}]){
  assert.equal(canChooseFolder(scope),false);await assert.rejects(chooseFolder(scope),FolderUnavailable);
 }
 let options;const handle={name:'사용자 선택'};
 assert.equal(await chooseFolder({isSecureContext:true,showDirectoryPicker:async value=>(options=value,handle)}),handle);
 assert.deepEqual(options,{mode:'readwrite'});
});
function memoryFolder({permission='granted',existing=false,writeError=null,closeError=null}={}){
 const events=[],files=new Map();if(existing)files.set('1000 2026고단1.pdf',new Uint8Array([9]));
 const h={name:'선택 폴더',queryPermission:async()=>permission,requestPermission:async()=>permission,
  async getFileHandle(name,options){events.push(['open',name,options]);if(!files.has(name)&&!options?.create)throw new DOMException('missing','NotFoundError');
   return {async createWritable(){events.push(['writable']);let data;return {async write(bytes){if(writeError)throw writeError;data=bytes;},async close(){if(closeError)throw closeError;files.set(name,data);events.push(['closed']);},async abort(){events.push(['abort']);}};}};}};
 return {h,events,files};
}
test('explicit selected folder receives individual exact PDF bytes only after close',async()=>{
 const {h,events,files}=memoryFolder(),bytes=new Uint8Array([37,80,68,70]);
 await writeMemo(h,'1000 2026고단1.pdf',bytes);
 assert.deepEqual(files.get('1000 2026고단1.pdf'),bytes);assert.deepEqual(events.at(-1),['closed']);assert.equal(files.size,1);
});
test('existing source/output collision is never opened for writing or overwritten',async()=>{
 const {h,events,files}=memoryFolder({existing:true});
 await assert.rejects(writeMemo(h,'1000 2026고단1.pdf',new Uint8Array([1])),/덮어쓰지/);
 assert.deepEqual([...files.values()][0],new Uint8Array([9]));assert.equal(events.length,1);
});
test('permission denial never creates a file and signals download fallback',async()=>{
 const {h,events}=memoryFolder({permission:'denied'});
 await assert.rejects(writeMemo(h,'1000 2026고단1.pdf',new Uint8Array([1])),FolderUnavailable);assert.deepEqual(events,[]);
});
for(const stage of ['writeError','closeError'])test('failure at '+stage+' aborts and never claims a saved file',async()=>{
 const {h,events,files}=memoryFolder({[stage]:new DOMException('policy','NotAllowedError')});
 await assert.rejects(writeMemo(h,'1000 2026고단1.pdf',new Uint8Array([1])),FolderUnavailable);assert.ok(events.some(e=>e[0]==='abort'));assert.equal(files.size,0);
});
test('invalid path/filename cannot reach folder access',async()=>{
 const {h,events}=memoryFolder();for(const name of ['../x.pdf','1000 2026고단1.pdf/evil','1000 2026고단1.zip'])await assert.rejects(writeMemo(h,name,new Uint8Array([1])));
 assert.deepEqual(events,[]);
});
