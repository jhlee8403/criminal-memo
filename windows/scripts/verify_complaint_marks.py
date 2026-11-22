"""Verify exact title-driven marks, measured geometry, transparency and page preservation."""
from pathlib import Path
import fitz, numpy as np, json, os, subprocess, hashlib
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('CM_COMPLAINT_ARTIFACTS','/tmp/complaint-marks'))
r=json.loads((OUT/'browser-report.json').read_text());assert r['passed']
original=fitz.open(ROOT/'templates/형사메모(1).pdf')
RECTS={'opposition':fitz.Rect(517.1,149,564.5,170.4),'complaint':fitz.Rect(517.2,126.2,548.7,146.8)}
CELLS={'opposition':fitz.Rect(516.442,148.278,565.496,171.772),'complaint':fitz.Rect(516.442,124.784,565.496,148.278)}
count=0

def check(ok,msg):
 global count
 if not ok:raise AssertionError(msg)
 count+=1

def pixels(p,scale=2,clip=None):
 q=p.get_pixmap(matrix=fitz.Matrix(scale,scale),clip=clip,alpha=False)
 return q,np.frombuffer(q.samples,np.uint8).reshape(q.height,q.width,q.n)

def verify(path,expected):
 d=fitz.open(path);p=d[0]
 check(len(d)==2,path.name+': exactly two pages')
 check(d[1].rect==original[1].rect and d[1].rotation==original[1].rotation,path.name+': page two geometry')
 check(d[1].read_contents()==original[1].read_contents(),path.name+': page two original stream')
 check(d[1].get_text('dict')==original[1].get_text('dict'),path.name+': page two original text/fonts')
 check(np.array_equal(pixels(d[1])[1],pixels(original[1])[1]),path.name+': page two original pixels')
 for key,rect in RECTS.items():
  shapes=[s for s in p.get_drawings() if s['color']==(1,0,0) and fitz.Rect(s['rect']).intersects(CELLS[key])]
  check(len(shapes)==int(expected[key]),path.name+': '+key+' expected presence only')
  for shape in shapes:
   check(max(abs(a-b)for a,b in zip(shape['rect'],rect))<.001,key+': measured ellipse bounds')
   check(shape['fill'] is None and shape['type']=='s' and shape['width']==1,key+': red stroke only, transparent inside')
   outer=rect+(-.5,-.5,.5,.5)
   cell=CELLS[key]
   check(cell.contains(outer),key+': ellipse stroke inside cell, no table line overlap')
   # Pixel-based ink containment: the original printed glyph pixels lie inside the inner ellipse.
   q,a=pixels(original[0],8,rect)
   yy,xx=np.where(a.min(2)<100);x=(xx+q.x+.5)/8;y=(yy+q.y+.5)/8
   cx,cy=(rect.x0+rect.x1)/2,(rect.y0+rect.y1)/2
   score=((x-cx)/(rect.width/2-.5))**2+((y-cy)/(rect.height/2-.5))**2
   check(score.max()<1,key+': all printed glyph ink enclosed within inner red stroke')
 return d

for c in r['cases']:
 doc=verify(OUT/f"{c['id']}-after.pdf",c['expected'])
 if c['paired']:
  before=fitz.open(OUT/f"{c['id']}-before.pdf")
  _,a=pixels(before[0],4);_,b=pixels(doc[0],4);allowed=np.zeros(a.shape[:2],bool)
  for key,rect in RECTS.items():
   if c['expected'][key]:
    rr=rect+(-1,-1,1,1);allowed[int(rr.y0*4):int(np.ceil(rr.y1*4)),int(rr.x0*4):int(np.ceil(rr.x1*4))]=True
  check(np.count_nonzero(np.any(a!=b,2)&~allowed)==0,c['id']+': no pixel changes outside added circles; existing marks preserved')
  check(before[0].get_text('dict')==doc[0].get_text('dict'),c['id']+': all original text/font positions unchanged; no X added')
 if c['id']=='both':
  doc[0].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(OUT/'complaint-first-page.png')
  doc[1].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(OUT/'complaint-second-page.png')
  for label,page in [('before',fitz.open(OUT/'both-before.pdf')[0]),('after',doc[0])]:page.get_pixmap(matrix=fitz.Matrix(5,5),clip=fitz.Rect(514,122,567,174)).save(OUT/f'complaint-marks-{label}.png')
for upload in r['uploads']:verify(OUT/upload['file'],upload['expected'])
check(not subprocess.check_output(['git','diff','5e341b7','--','windows/templates','windows/src/app.js','windows/src/storage.js','windows/src/mark-layout.js','windows/src/batch-save.js','windows/scripts/build.mjs','windows/vendor'],cwd=ROOT.parent),'template/UI/storage/OCR libraries/build unchanged')
result={'checksPassed':count,'pdfsVerified':len(r['cases'])+sum(c['paired'] for c in r['cases'])+len(r['uploads']),'measuredEllipseBounds':{k:list(v)for k,v in RECTS.items()},'htmlSHA256':r['htmlSHA256'],'templateSHA256':hashlib.sha256((ROOT/'templates/형사메모(1).pdf').read_bytes()).hexdigest(),'windowsEdge104Verified':False}
(OUT/'pdf-report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
