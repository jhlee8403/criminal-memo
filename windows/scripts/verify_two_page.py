"""Inspect browser-downloaded PDFs using independent PyMuPDF raster/text/paths."""
from pathlib import Path
import fitz,numpy as np,json,unicodedata,hashlib
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts'
report=json.loads((OUT/'two-page-browser-report.json').read_text())
assert report['passed']
first=next(p for p in ROOT.parent.glob('*.pdf') if unicodedata.normalize('NFC',p.name)=='형사메모.pdf')
second=ROOT/'templates/형사메모(2쪽).pdf';original=fitz.open(second)
BOXES={'case':(74,61,171,88),'names':(33,128,173,239),'charges':(180,78,331,239),'prosecutor':(385,48,497,70),'counsel':(385,78,497,98),'date':(231,247,405,267),'hearing':(34,548,101,590),'detention':(537,48,562,70),'juvenile':(174,730,200,745),'mandatory':(109,746,165,761)}
count=0

def check(ok,msg):
 global count
 if not ok:raise AssertionError(msg)
 count+=1

def pixels(page):
 p=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
 return np.frombuffer(p.samples,dtype=np.uint8).reshape(p.height,p.width,p.n)
def text(page,key):return page.get_text(clip=fitz.Rect(BOXES[key])).strip()
def circles(page,key):return [s for s in page.get_drawings() if s['color']==(1,0,0) and fitz.Rect(s['rect']).intersects(fitz.Rect(BOXES[key]))]
def cross(page):return [s for s in page.get_drawings() if s['color']==(0,0,0) and abs(s['width']-1.5)<.01 and fitz.Rect(s['rect']).intersects(fitz.Rect(BOXES['juvenile'])) and all(i[0]=='l' and i[1].x!=i[2].x and i[1].y!=i[2].y for i in s['items'])]
check(first.read_bytes()==(ROOT/'distribution/CriminalMemo/templates/형사메모.pdf').read_bytes(),'first original unchanged')
check(second.read_bytes()==(ROOT/'distribution/CriminalMemo/templates/형사메모(2쪽).pdf').read_bytes(),'second original exact bytes distributed')
# Check every emitted PDF, including partial extraction, originals, counsel and OCR.
names=[d['output'] for d in report['definitions']]+[f"two-counsel-{c['id']}.pdf" for c in report['counselCases']]+[f"two-age-{c['id']}.pdf" for c in report['ageCases']]+[f"two-missing-{c['id']}.pdf" for c in report['partialCases']]+['two-folder-fallback.pdf','two-partial.pdf','two-single.pdf','two-single-latest.pdf','two-original-1.pdf','two-original-2.pdf','two-scanned.pdf','two-mixed.pdf','two-empty.pdf']
files=[OUT/name for name in names]
check(len(files)==54,'all 54 expected generation paths produced PDFs')
for file in files:
 d=fitz.open(file);check(len(d)==2,file.name+': exactly two pages')
 check(d[1].rect==original[0].rect and d[1].rotation==original[0].rotation,file.name+': second page exact dimensions/rotation')
 check(d[1].get_text('dict')==original[0].get_text('dict'),file.name+': second-page text/fonts/positions unchanged')
 check(d[1].read_contents()==original[0].read_contents(),file.name+': second-page content streams unchanged')
 check(np.array_equal(pixels(d[1]),pixels(original[0])),file.name+': second-page all pixels unchanged')
for i,definition in enumerate(report['definitions']):
 p=fitz.open(OUT/definition['output'])[0];parent=fitz.open(OUT/f'two-parent-{i}.pdf')[0]
 check(text(p,'case')==definition['case'],'filename case preserved '+str(i))
 check(text(p,'hearing').splitlines()==definition['hearing'],'hearing two lines preserved '+str(i))
 check(text(p,'prosecutor')=='김가상','prosecutor preserved '+str(i))
 check(text(p,'date')=='2026.11.17','filing date preserved '+str(i))
 check(text(p,'detention')==definition['states'],'ordered OX preserved '+str(i))
 a,b=pixels(p),pixels(parent)
 allowed=np.zeros(a.shape[:2],bool);x0,y0,x1,y1=BOXES['juvenile'];allowed[int((y0-2)*2):int((y1+2)*2)+1,int((x0-2)*2):int((x1+2)*2)+1]=True
 check(np.count_nonzero(np.any(a!=b,axis=2)&~allowed)==0,'first page pixel-identical to f25b9b0 except requested juvenile X '+str(i))
 check(len(circles(p,'juvenile'))==int(definition['juvenile']),'juvenile circle '+str(i))
 check(len(circles(p,'mandatory'))==int(definition['mandatory']),'mandatory circle unchanged '+str(i))
 expected_cross=i in [2,4]
 check(len(cross(p))==2*int(expected_cross),'adult X only if confirmed '+str(i))
 if i==0:
  p.get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(OUT/'two-page-first.png')
  fitz.open(OUT/definition['output'])[1].get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(OUT/'two-page-second.png')
for c in report['counselCases']:
 p=fitz.open(OUT/f"two-counsel-{c['id']}.pdf")[0]
 check(''.join(text(p,'counsel').split())==''.join(c['expected'].split()),'counsel all names exact '+c['id'])
for key,box in [('prosecutor','prosecutor'),('counsel','counsel'),('detention','detention')]:
 p=fitz.open(OUT/f'two-missing-{key}.pdf')[0]
 check(text(p,box)=='','failed extraction blank: '+key)
 check(text(p,'names')=='1. 박가상' and '상해' in text(p,'charges'),'successful fields preserved: '+key)
for file in ['two-missing-all.pdf','two-empty.pdf']:
 p=fitz.open(OUT/file)[0]
 check(all(not text(p,key) for key in ['names','charges','prosecutor','counsel','date','detention']),file+': all unextracted fields blank')
 check(text(p,'case').startswith('2026고단') and text(p,'hearing').splitlines()==['2026. 11. 18.','10:00'],file+': case and entered hearing retained')
for c in report['ageCases']:
 p=fitz.open(OUT/f"two-age-{c['id']}.pdf")[0]
 check(len(cross(p))==2*int(c['mark']=='cross'),'adult X '+c['id'])
 check(len(circles(p,'juvenile'))==int(c['mark']=='circle'),'juvenile priority '+c['id'])
 if c['mark']=='cross':
  word=next(fitz.Rect(w[:4]) for w in p.get_text('words') if w[4]=='소년')
  check(all(fitz.Rect(s['rect']).intersects(word) for s in cross(p)),'black diagonals overlap printed juvenile label '+c['id'])
  p.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(102,720,211,770)).save(OUT/'two-page-adult-X.png')
check(text(fitz.open(OUT/'two-single-latest.pdf')[0],'hearing').splitlines()==['2026. 11. 18.','11:00'],'input changes do not retain stale hearing')
result={'checksPassed':count,'pdfsVerified':len(files),'firstTemplateSHA256':hashlib.sha256(first.read_bytes()).hexdigest(),'secondTemplateSHA256':hashlib.sha256(second.read_bytes()).hexdigest(),'secondPageContentAndPixelsUnchanged':True,'browserOutputTransports':{kind:sum(t['transport']==kind for t in report.get('outputTransports',[])) for kind in {t['transport'] for t in report.get('outputTransports',[])}},'firstPageComparedTo':'f25b9b0 shipped HTML renderer, same draft/options','windowsEdge104Verified':False}
(OUT/'two-page-pdf-report.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
