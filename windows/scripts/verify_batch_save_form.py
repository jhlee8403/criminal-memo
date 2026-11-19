"""Inspect the new original, all generated PDFs, and isolated mark ink independently."""
from pathlib import Path
import fitz,numpy as np,json,os,hashlib
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('CM_ARTIFACTS',ROOT/'artifacts/batch-save-form'));LAYOUT=Path(os.environ.get('CM_MARK_ARTIFACTS',OUT/'layout'))
r=json.loads((OUT/'batch-save-form-browser-report.json').read_text());l=json.loads((LAYOUT/'browser-report.json').read_text());assert r['passed'] and l['passed']
source=ROOT/'templates/형사메모(1).pdf';original=fitz.open(source)
BOX={'case':(74,61,171,88),'names':(33,128,173,239),'charges':(180,78,331,239),'prosecutor':(385,48,497,70),'counsel':(385,78,497,98),'filing':(231,247,461,267),'hearing':(34,573,101,617),'detention':(537,48,562,70),'youth':(198.242798,491.310227,234.242798,505.310227),'jury':(203.242798,511.328338,229.242798,525.328338),'mandatory':(108.245914,510.828339,164.245914,525.828339)}
CELL={'case':(69.203,43.872,176.665,100.570),'names':(29.744,124.784,176.665,242.495),'charges':(176.665,73.599,335.22,242.495),'prosecutor':(381.275,43.872,500.731,73.599),'counsel':(381.275,73.599,500.731,100.570),'filing':(227.518,242.495,465.829,268.986),'hearing':(29.744,562.305,106.263,681.455),'detention':(533.353,43.872,565.496,73.599)}
count=0

def check(ok,msg):
 global count
 if not ok:raise AssertionError(msg)
 count+=1

def raster(page,scale=2,clip=None):
 p=page.get_pixmap(matrix=fitz.Matrix(scale,scale),clip=clip,alpha=False);a=np.frombuffer(p.samples,np.uint8).reshape(p.height,p.width,p.n)
 return p,a[:,:,:3]
def text(page,key):return page.get_text(clip=fitz.Rect(BOX[key])).strip()
def check_second(doc,name):
 check(len(doc)==2,name+': exactly two pages')
 check(doc[1].rect==original[1].rect and doc[1].rotation==original[1].rotation,name+': second-page dimensions and rotation')
 check(doc[1].read_contents()==original[1].read_contents(),name+': second-page original streams unchanged')
 check(doc[1].get_text('dict')==original[1].get_text('dict'),name+': second-page text/fonts/positions unchanged')
 check(np.array_equal(raster(doc[1])[1],raster(original[1])[1]),name+': second page pixel-identical')
check(len(original)==2,'provided original actually has two pages')
check(hashlib.sha256(source.read_bytes()).hexdigest()=='b16fcb041110090725863c5a4934a03b80ea935f6086d9bcf7111528aeb6f75c','source bytes equal upload')
check(source.read_bytes()==(ROOT/'distribution/CriminalMemo/templates/형사메모(1).pdf').read_bytes(),'distributed source unchanged')
check(len(r['emitted'])==54,'54 PDFs tracked individually, no ZIP')
for name in r['emitted']:check_second(fitz.open(OUT/name),name)
for i,d in enumerate(r['definitions']):
 p=fitz.open(OUT/d['output'])[0]
 check(text(p,'case')==d['case'],'filename case '+str(i))
 check(text(p,'filing')=='2026.11.17','body filing date, ignoring later submission '+str(i))
 check(text(p,'prosecutor')=='김가상','prosecutor '+str(i))
 check(text(p,'hearing').splitlines()==['2026. 11. 18.',d['time'][:2]+':'+d['time'][2:]],'new hearing cell, two lines '+str(i))
 check(text(p,'names').splitlines()==[f"{n+1}. {v.get('name','박가상')}" for n,v in enumerate(d['people'])],'names and order '+str(i))
 expected=''.join('O' if v.get('detention') and '구속' in v['detention'] and '불구속' not in v['detention'] else 'X' for v in d['people'])
 check(text(p,'detention')==expected,'detention order '+str(i))
 for key,cell in CELL.items():
  spans=[s for b in p.get_text('dict',clip=fitz.Rect(BOX[key]))['blocks'] for line in b.get('lines',[]) for s in line['spans']]
  check(all(fitz.Rect(cell).contains(fitz.Rect(s['bbox'])) for s in spans),'all '+key+' text fits measured new cell '+str(i))
 circles=[s for s in p.get_drawings() if s['color']==(1,0,0) and fitz.Rect(s['rect']).intersects(fitz.Rect(BOX['mandatory']))]
 check(len(circles)==int(d['mandatory']),'new mandatory circle exactly once/absent '+str(i))
 if circles:
  label=next(fitz.Rect(w[:4]) for w in original[0].get_text('words') if w[4]=='필요적국선')
  check(circles[0]['fill'] is None and fitz.Rect(circles[0]['rect']).contains(label),'new mandatory circle covers actual printed label')
 a=raster(original[0])[1];b=raster(p)[1];allowed=np.zeros(a.shape[:2],bool)
 for x0,y0,x1,y1 in BOX.values():allowed[int((y0-2)*2):int((y1+2)*2)+1,int((x0-2)*2):int((x1+2)*2)+1]=True
 check(np.count_nonzero(np.any(a!=b,2)&~allowed)==0,'original first-page non-input pixels unchanged '+str(i))
 paths=lambda page:[{k:d[k] for k in ['items','color','fill','width','rect','type']} for d in page.get_drawings() if d['color']!=(1,0,0)]
 check(paths(p)==paths(original[0]),'all original table/vector paths unchanged '+str(i))
 for rect in [fitz.Rect(106,721,210,766),fitz.Rect(34,548,101,570)]:
  check(np.array_equal(raster(original[0],clip=rect)[1],raster(p,clip=rect)[1]),'no stale old-position marks/hearing '+str(i))
 if i==7:p.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(100,483,245,532)).save(OUT/'new-mandatory.png')
for c in r['counselCases']:
 p=fitz.open(OUT/f"djj-counsel-{c['id']}.pdf")[0]
 check(''.join(text(p,'counsel').split())==''.join(c['expected'].split()),'counsel full output '+c['id'])
for id,key in [('prosecutor','prosecutor'),('counsel','counsel')]:check(text(fitz.open(OUT/f'djj-missing-{id}.pdf')[0],key)=='','missing extraction blank '+id)
p=fitz.open(OUT/'djj-missing-all.pdf')[0];check(all(not text(p,k) for k in ['names','charges','prosecutor','counsel','filing','detention']),'all extraction absent leaves blanks')
check(r['filingComparison']['before']['date'] is None and r['filingComparison']['after']['date']=='2026-11-10','before/after submission mismatch comparison')
# Isolated ink on the white first-page diagnostic preserves the original second page.
REF={'youth':(206.288193,493.33429,19.90921,9.951874),'jury':(206.288193,513.352417,19.90921,9.951843)}
CROP={'youth':fitz.Rect(196,488,237,508),'jury':fitz.Rect(201,508,232,530)}
def marks(page,key,expected):
 p,a=raster(page,8,CROP[key]);m=a.min(2)<210;active=np.flatnonzero(m.any(0));groups=np.split(active,np.flatnonzero(np.diff(active)>1)+1) if active.size else []
 check(len(groups)==len(expected.replace(' ','')),key+': confirmed glyph count and blank slots')
 x,y,w,h=REF[key];cx,cy=x+w/2,y+h/2
 for char,group in zip(expected.replace(' ',''),groups):
  sub=m[:,group[0]:group[-1]+1];yy,xx=np.where(sub);v=a[:,group[0]:group[-1]+1][sub];red=bool(np.any((v[:,0].astype(int)-v[:,1].astype(int)>40)&(v[:,1]<190)))
  rx=(p.x+group[0]+xx.min())/8;ry=(p.y+yy.min())/8;rw=(xx.max()-xx.min()+1)/8;rh=(yy.max()-yy.min()+1)/8
  check(red==(char=='O'),key+': correct red O/black X')
  check(abs(ry+rh/2-cy)<.25,key+': actual vertical center')
  if len(expected)<=3:check(rh>=h-.25,key+': sufficiently large to cover new printed label')
  if len(expected)==1:check(rw>=w-.25,key+': single covers two characters')
 if active.size and expected[0]!=' ' and expected[-1]!=' ':check(abs((p.x+(active.min()+active.max()+1)/2)/8-cx)<.25,key+': whole string horizontally centered')
for c in l['cases']:
 doc=fitz.open(LAYOUT/f"{c['id']}-after.pdf");diag=fitz.open(LAYOUT/f"{c['id']}-after-ink.pdf")
 check_second(doc,c['id']+' layout');check_second(diag,c['id']+' ink')
 marks(diag[0],'youth',c['youth']);marks(diag[0],'jury',c['jury'])
 if c['id']=='06':
  doc[0].get_pixmap(matrix=fitz.Matrix(1.4,1.4)).save(OUT/'new-first-page.png');doc[1].get_pixmap(matrix=fitz.Matrix(1.4,1.4)).save(OUT/'new-second-page.png');doc[0].get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(100,483,245,532)).save(OUT/'new-mark-layout.png')
result={'checksPassed':count,'browserPDFs':len(r['emitted']),'layoutPDFs':len(l['cases'])*2,'templateSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'htmlSHA256':r['htmlSHA256'],'filingBefore':r['filingComparison']['before']['date'],'filingAfter':r['filingComparison']['after']['date'],'windowsEdge104Verified':False,'folderTest':r['folderTest']}
(OUT/'batch-save-form-pdf-report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
