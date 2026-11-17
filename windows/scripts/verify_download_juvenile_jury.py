"""Independent PDF text/geometry/colour/pixel checks for real browser artifacts."""
from pathlib import Path
import fitz,numpy as np,json,hashlib,unicodedata,os
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('CM_ARTIFACTS',ROOT/'artifacts'))
report=json.loads((OUT/'djj-browser-report.json').read_text());assert report['passed']
count=0

def check(ok,message):
 global count
 if not ok:raise AssertionError(message)
 count+=1

def pixels(page):
 p=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
 return np.frombuffer(p.samples,dtype=np.uint8).reshape(p.height,p.width,p.n)
BOXES={'youth':(168,723.5,207,731.5),'jury':(174,746,200,761),'mandatory':(109,746,165,761),'case':(74,61,171,88),'hearing':(34,548,101,590),'counsel':(385,78,497,98),'detention':(537,48,562,70)}
def text(page,key):return page.get_text(clip=fitz.Rect(BOXES[key])).strip()
def glyphs(page,key):
 out=[]
 for b in page.get_text('rawdict',clip=fitz.Rect(BOXES[key]))['blocks']:
  for l in b.get('lines',[]):
   for s in l['spans']:
    if s['font']=='Courier':
     for c in s['chars']:
      if c['c'] in 'OX':out.append({'text':c['c'],'color':s['color'],'size':s['size'],'box':fitz.Rect(c['bbox'])})
 return out

def marks(page,key,expected):
 actual=glyphs(page,key);wanted=[(i,c) for i,c in enumerate(expected) if c!=' ']
 check(''.join(g['text'] for g in actual)==''.join(c for _,c in wanted),key+': exact ordered glyphs without invented unknowns')
 if not wanted:return
 size=actual[0]['size'];cell=fitz.Rect(BOXES[key]);char_width=.6*size;start=cell.x0+(cell.width-len(expected)*char_width)/2
 for (index,char),g in zip(wanted,actual):
  check(g['color']==(0xff0000 if char=='O' else 0),key+': red O / black X')
  check(cell.contains(g['box']),key+': glyph inside measured box')
  check(abs(g['box'].x0-(start+index*char_width))<.05,key+': unknown positions and original order retained')
  if key=='youth':check(g['box'].y0>722.330 and g['box'].y1<732.124,key+': above label, below table line')
  else:check(g['box'].intersects(fitz.Rect(177.3838,748.1867,197.4126,758.6731)),key+': overlaps printed 국참')
second=ROOT/'templates/형사메모(2쪽).pdf';source=fitz.open(second)
check(len(report['emitted'])==len(set(report['emitted']))==54,'54 explicitly tracked PDFs, no ZIP output')
for name in report['emitted']:
 check(name.endswith('.pdf'),'individual PDF artifact: '+name)
 d=fitz.open(OUT/name);check(len(d)==2,name+': exactly two pages')
 check(d[1].rect==source[0].rect and d[1].rotation==source[0].rotation,name+': second page geometry unchanged')
 check(d[1].read_contents()==source[0].read_contents(),name+': second page content streams unchanged')
 check(d[1].get_text('dict')==source[0].get_text('dict'),name+': second page text, fonts and positions unchanged')
 check(np.array_equal(pixels(d[1]),pixels(source[0])),name+': second page all pixels identical')
for i,d in enumerate(report['definitions']):
 page=fitz.open(OUT/d['output'])[0];parent=fitz.open(OUT/f'djj-parent-{i}.pdf')[0]
 marks(page,'youth',d['youth']);marks(page,'jury',d['jury'])
 check(text(page,'case')==d['case'],'filename case preserved '+str(i))
 check(text(page,'hearing').splitlines()==['2026. 11. 18.',d['time'][:2]+':'+d['time'][2:]],'hearing preserved '+str(i))
 circles=[s for s in page.get_drawings() if s['color']==(1,0,0) and fitz.Rect(s['rect']).intersects(fitz.Rect(BOXES['mandatory']))]
 check(len(circles)==int(d['mandatory']),'mandatory circle exactly once or absent '+str(i))
 check(all(s['fill'] is None for s in circles),'mandatory mark transparent '+str(i))
 a,b=pixels(page),pixels(parent);allowed=np.zeros(a.shape[:2],bool)
 for box in [BOXES['youth'],BOXES['jury'],BOXES['mandatory'],(174,730,200,745)]:
  x0,y0,x1,y1=box;allowed[int((y0-2)*2):int((y1+2)*2)+1,int((x0-2)*2):int((x1+2)*2)+1]=True
 check(np.count_nonzero(np.any(a!=b,axis=2)&~allowed)==0,'first-page content and original table pixel-identical to b53ac20 outside requested marks '+str(i))
 if i in [2,7,9]:page.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(102,719,216,771)).save(OUT/f'djj-marks-{i}.png')
 if i==2:
  page.get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(OUT/'djj-first-page.png')
  fitz.open(OUT/d['output'])[1].get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(OUT/'djj-second-page.png')
marks(fitz.open(OUT/'djj-four-people.pdf')[0],'youth','OXOX')
for c in report['juryCases']:marks(fitz.open(OUT/f"djj-jury-{c['id']}.pdf")[0],'jury',c['jury'])
for c in report['counselCases']:
 p=fitz.open(OUT/f"djj-counsel-{c['id']}.pdf")[0]
 check(''.join(text(p,'counsel').split())==''.join(c['expected'].split()),'complete counsel unchanged '+c['id'])
page=fitz.open(OUT/'djj-missing-all.pdf')[0];marks(page,'jury','');marks(page,'youth','')
check(text(page,'case')=='2026고단9500','missing all information still retains filename case')
check(text(fitz.open(OUT/'djj-latest.pdf')[0],'hearing').splitlines()==['2026. 11. 18.','12:30'],'changed hearing replaces stale output')
for name,case in [('djj-two-0.pdf','2026고단7200'),('djj-two-1.pdf','2026고단7201')]:check(text(fitz.open(OUT/name)[0],'case')==case,'two-file outputs each use correct case')
# Tail values used in the synthetic input must not survive in generated text or reports.
tail=''.join(['6','4','2','8','5','1']);check(tail not in fitz.open(OUT/'djj-private-safe.pdf')[0].get_text(),'unused resident tail absent in generated memo')
check(tail not in json.dumps(report,ensure_ascii=False),'unused resident tail absent in diagnostic report')
result={'checksPassed':count,'pdfsVerified':len(report['emitted']),'secondTemplateSHA256':hashlib.sha256(second.read_bytes()).hexdigest(),'firstPageComparedTo':'b53ac20 shipped renderer, same drafts and inputs, new marks excluded','windowsEdge104Verified':False,'outputTransports':{kind:sum(t['transport']==kind for t in report.get('outputTransports',[])) for kind in {t['transport'] for t in report.get('outputTransports',[])}}}
(OUT/'djj-pdf-report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
