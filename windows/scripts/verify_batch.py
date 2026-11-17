"""Inspect browser ZIPs and actual memo PDFs with an independent PDF engine."""
from pathlib import Path
import fitz,numpy as np,json,zipfile,unicodedata,hashlib
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts'
report=json.loads((OUT/'batch-browser-report.json').read_text())
source=next(p for p in ROOT.parent.glob('*.pdf') if unicodedata.normalize('NFC',p.name)=='형사메모.pdf')
template=fitz.open(source)
BOXES={'case':(74,61,171,88),'names':(33,128,173,239),'charges':(180,78,331,239),'prosecutor':(385,48,497,70),'counsel':(385,78,497,98),'date':(231,247,405,267),'hearing':(34,548,101,590),'detention':(537,48,562,70),'juvenile':(174,730,200,745),'mandatory':(109,746,165,761)}
count=0

def check(ok,msg):
 global count
 if not ok:raise AssertionError(msg)
 count+=1;print('PASS:',msg)

def text(page,box):return page.get_text(clip=fitz.Rect(BOXES[box])).strip()
def pixels(page):
 pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
 return np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.height,pix.width,pix.n)

check(source.read_bytes()==(ROOT/'distribution/CriminalMemo/templates/형사메모.pdf').read_bytes(),'distributed original template bytes unchanged')
with zipfile.ZipFile(OUT/'batch-ten.zip') as archive:
 check(len(archive.namelist())==10,'ten PDFs in one ZIP')
 check(set(archive.namelist())=={d['filename'] for d in report['definitions']},'exact Windows-safe filenames, date excluded')
 check(archive.testzip() is None,'ZIP CRC checks pass')
 for d in report['definitions']:check(archive.read(d['filename'])==(OUT/d['output']).read_bytes(),'ZIP member matches generated PDF '+d['case'])
words={w[4]:fitz.Rect(w[:4]) for w in template[0].get_text('words')}
for i,d in enumerate(report['definitions']):
 doc=fitz.open(OUT/d['output']);page=doc[0]
 check(len(doc)==1,d['case']+': one page')
 check(text(page,'case').replace('\n','')==d['case'],d['case']+': filename-derived case in top left cell')
 case_spans=[s for b in page.get_text('dict',clip=fitz.Rect(BOXES['case']))['blocks'] for l in b.get('lines',[]) for s in l['spans']]
 check(all(fitz.Rect(69.203,43.8721,176.665,100.5701).contains(fitz.Rect(s['bbox'])) for s in case_spans),d['case']+': case glyphs inside measured cell')
 check(text(page,'prosecutor')=='김가상',d['case']+': prosecutor unchanged')
 check(text(page,'date')=='2026.11.17',d['case']+': filing date unchanged')
 check(text(page,'hearing').splitlines()==d['hearing'],d['case']+': normalized date/time in two lines')
 expected_names=[str(n+1)+'. '+p.get('name','박가상') for n,p in enumerate(d['people'])]
 check(text(page,'names').splitlines()==expected_names,d['case']+': defendant order preserved')
 lines=[l for b in page.get_text('dict',clip=fitz.Rect(BOXES['detention']))['blocks'] for l in b.get('lines',[])]
 spans=[s for l in lines for s in l['spans']]
 check(len(lines)==1 and ''.join(s['text'] for s in spans)==d['states'],d['case']+': ordered detention glyphs on one line')
 check(all(s['color']==(0xFF0000 if char=='O' else 0) for s in spans for char in s['text']),d['case']+': O red and X black')
 drawings=[s for s in page.get_drawings() if s['color']==(1,0,0)]
 for key,word in [('mandatory','필요적국선'),('juvenile','소년')]:
  shapes=[shape for shape in drawings if fitz.Rect(shape['rect']).intersects(fitz.Rect(BOXES[key]))]
  check(len(shapes)==int(d[key]),d['case']+': '+key+' exactly once or absent')
  if shapes:
   check(shapes[0]['fill'] is None and fitz.Rect(shapes[0]['rect']).intersects(words[word]),d['case']+': transparent red circle over printed '+word)
 before=pixels(template[0]);after=pixels(page);allowed=np.zeros(before.shape[:2],dtype=bool)
 for x0,y0,x1,y1 in BOXES.values():allowed[int((y0-2)*2):int((y1+2)*2)+1,int((x0-2)*2):int((x1+2)*2)+1]=True
 check(np.count_nonzero(np.any(before!=after,axis=2)&~allowed)==0,d['case']+': original table and non-input content pixel-identical')
 if i==0:
  page.get_pixmap(matrix=fitz.Matrix(3,3),clip=fitz.Rect(23,35,180,108)).save(OUT/'batch-case-output.png')
  page.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(102,720,211,770)).save(OUT/'batch-detained-mark.png')
 if d['juvenile']:page.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(102,720,211,770)).save(OUT/'batch-juvenile-mark.png')
for c in report['counselCases']:
 page=fitz.open(OUT/f"batch-counsel-{c['id']}.pdf")[0]
 check(''.join(text(page,'counsel').split())==''.join(c['expected'].split()),'counsel all names/format unchanged: '+c['id'])
 spans=[s for b in page.get_text('dict',clip=fitz.Rect(BOXES['counsel']))['blocks'] for l in b.get('lines',[]) for s in l['spans']]
 check(all(fitz.Rect(BOXES['counsel']).contains(fitz.Rect(s['bbox'])) for s in spans),'counsel text inside original cell: '+c['id'])
page=fitz.open(OUT/'batch-single-latest.pdf')[0]
check(text(page,'hearing').splitlines()==['2026. 11. 18.','11:00'],'single rerun reflects latest time without stale values')
with zipfile.ZipFile(OUT/'batch-partial.zip') as archive:check(archive.namelist()==['1000 2026고정2.pdf'],'partial ZIP excludes missing case and corrupt PDF')
result={'checksPassed':count,'originalTemplateSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'source':'actual browser downloads / ZIP members','windowsEdge104Verified':False}
(OUT/'batch-pdf-report.json').write_text(json.dumps(result,indent=2)+'\n')
print('Checks:',count)
