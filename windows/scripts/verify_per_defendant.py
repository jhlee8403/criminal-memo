from pathlib import Path
import fitz,numpy as np,json,os,hashlib,subprocess
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('CM_PER_DEF_ARTIFACTS','/tmp/per-def-marks'));r=json.loads((OUT/'browser-report.json').read_text());assert r['passed']
template=fitz.open(ROOT/'templates/형사메모(1).pdf');count=0
BOX={'mandatory':fitz.Rect(108,510,165,527),'jury':fitz.Rect(201,508,233,530)}
def check(ok,msg):
 global count
 if not ok:raise AssertionError(msg)
 count+=1
def raster(p,scale=3):
 q=p.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False);return np.frombuffer(q.samples,np.uint8).reshape(q.height,q.width,q.n)
def verify(file,c):
 d=fitz.open(OUT/file);p=d[0]
 check(len(d)==2,file+': exactly 2 pages')
 check(d[1].read_contents()==template[1].read_contents(),file+': second stream preserved')
 check(d[1].get_text('dict')==template[1].get_text('dict') and np.array_equal(raster(d[1]),raster(template[1])),file+': second text/positions/pixels preserved')
 for key,rect in BOX.items():
  glyphs=[]
  for span in p.get_texttrace():
   for ch in span['chars']:
    if chr(ch[0])in'OX' and ch[2][1]>510 and (rect+(-8,-4,8,4)).contains(fitz.Point(ch[2])):glyphs.append((ch[2][0],chr(ch[0]),span['color']))
  glyphs.sort();expected=c[key]
  check(''.join(g[1]for g in glyphs)==expected.replace(' ',''),file+': '+key+' exact ordered symbols')
  check(all(g[2]==((1,0,0)if g[1]=='O'else(0,0,0))for g in glyphs),file+': independent colors '+key)
  if expected.startswith(' ') and glyphs:check(glyphs[0][0]>(128 if key=='mandatory'else 208),file+': retained leading unknown slot '+key)
 check(not [s for s in p.get_drawings()if s['color']==(1,0,0)and fitz.Rect(s['rect']).intersects(BOX['mandatory'])],file+': old mandatory ellipse absent')
 actual=''.join(p.get_text(clip=fitz.Rect(180,78,331,239)).split())
 expected=''.join(''.join(f'{i+1}. {line}'.split())for i,line in enumerate(c['chargeLines']))
 check(actual==expected,file+': exact grouped numbered charge output, no lost owner names')
 return d
for c in r['cases']:
 d=verify(c['id']+'-after.pdf',c);before=fitz.open(OUT/(c['id']+'-before.pdf'))
 a,b=raster(before[0]),raster(d[0]);allowed=np.zeros(a.shape[:2],bool)
 for rr in [BOX['mandatory']+(-1,0,1,0),BOX['jury'],fitz.Rect(179,77,332,240)]:allowed[int(rr.y0*3):int(rr.y1*3),int(rr.x0*3):int(rr.x1*3)]=True
 check(np.count_nonzero(np.any(a!=b,2)&~allowed)==0,c['id']+': all unrelated fields/juvenile/detention/complaint circles pixel identical')
 if c['id']in['OO','OX','XO','XX','_OX','different']:
  d[0].get_pixmap(matrix=fitz.Matrix(5,5),clip=fitz.Rect(105,485,239,530)).save(OUT/(c['id']+'-marks.png'))
 if c['id']=='different':
  d[0].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(OUT/'first-page.png');d[1].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(OUT/'second-page.png')
  before[0].get_pixmap(matrix=fitz.Matrix(3,3),clip=fitz.Rect(175,73,335,243)).save(OUT/'charges-before.png');d[0].get_pixmap(matrix=fitz.Matrix(3,3),clip=fitz.Rect(175,73,335,243)).save(OUT/'charges-after.png')
for c in r['uploads']:verify(c['file'],c)
check(not subprocess.check_output(['git','diff','3375e0d','--','windows/templates','windows/src/storage.js','windows/src/batch.js','windows/src/first-hearing.js','windows/scripts/build.mjs','windows/vendor'],cwd=ROOT.parent),'template/storage/OCR assets/build/first hearing unchanged')
result={'checksPassed':count,'pdfsVerified':len(r['cases'])*2+len(r['uploads']),'htmlSHA256':r['htmlSHA256'],'windowsEdge104Verified':False};(OUT/'pdf-report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
