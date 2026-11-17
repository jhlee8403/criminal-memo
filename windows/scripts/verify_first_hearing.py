"""Independently inspect real browser downloads and measured original hearing cell."""
from pathlib import Path
import fitz, numpy as np, json, unicodedata, hashlib
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'
source=next(p for p in ROOT.parent.glob('*.pdf') if unicodedata.normalize('NFC',p.name)=='형사메모.pdf')
original=fitz.open(source)
# Original drawing coordinates (top-left pt), not reused from another field.
CELL=fitz.Rect(29.744,540.12915,106.263,600.9031)
TEXT=fitz.Rect(34,548,101,590)
HEADER=fitz.Rect(29.744,510.2821,106.263,540.12915)
count=0

def check(ok,message):
 global count
 if not ok:raise AssertionError(message)
 count+=1
 print('PASS:',message)

def pixels(page):
 pix=page.get_pixmap(matrix=fitz.Matrix(3,3),alpha=False)
 return np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.height,pix.width,pix.n)

check(source.read_bytes()==(ROOT/'distribution/CriminalMemo/templates/형사메모.pdf').read_bytes(),'original PDF bytes preserved')
check(CELL.contains(TEXT),'text box is inside measured first hearing cell')
check(any('기' in line and '일' in line for line in original[0].get_text(clip=HEADER).splitlines()),'measured header is the original 기 일 cell')
blank=fitz.open(OUT/'first-hearing-empty.pdf')
check(len(blank)==1,'empty hearing still generates one page')
check(blank[0].get_text(clip=CELL).strip()=='','empty hearing cell is blank')
check(pixels(blank[0])[int(CELL.y0*3)+2:int(CELL.y1*3)-2,int(CELL.x0*3)+2:int(CELL.x1*3)-2].tobytes()==pixels(original[0])[int(CELL.y0*3)+2:int(CELL.y1*3)-2,int(CELL.x0*3)+2:int(CELL.x1*3)-2].tobytes(),'blank hearing leaves original cell unchanged')
for file,expected in [
 ('first-hearing-example.pdf',['2026. 11. 18.','10:00']),
 ('first-hearing-changed.pdf',['2026. 11. 19.','11:30']),
 ('first-hearing-race-final.pdf',['2026. 12. 1.','09:15']),
]:
 doc=fitz.open(OUT/file);page=doc[0]
 check(len(doc)==1,file+': one page')
 lines=[line for b in page.get_text('dict',clip=CELL)['blocks'] for line in b.get('lines',[])]
 check([''.join(s['text'] for s in l['spans']) for l in lines]==expected,file+': exactly two correct lines')
 spans=[s for l in lines for s in l['spans']]
 check(all(TEXT.contains(fitz.Rect(s['bbox'])) for s in spans),file+': text inside new box')
 check(all(s['size']>=8 for s in spans),file+': readable font size')
 check(page.get_text(clip=HEADER)==original[0].get_text(clip=HEADER),file+': existing 기 일 header text preserved')
 before=pixels(blank[0]);after=pixels(page);changed=np.any(before!=after,axis=2)
 x0,y0,x1,y1=[int(v*3) for v in TEXT]
 changed[y0:y1+1,x0:x1+1]=False
 check(np.count_nonzero(changed)==0,file+': zero changed pixels outside hearing text box')
 # Exact raster identity of the surrounding table rules and printed heading.
 for region in [HEADER,fitz.Rect(29,539,107,541),fitz.Rect(29,600,107,602),fitz.Rect(29,540,31,601),fitz.Rect(105,540,107,601)]:
  check(page.get_pixmap(matrix=fitz.Matrix(3,3),clip=region).samples==original[0].get_pixmap(matrix=fitz.Matrix(3,3),clip=region).samples,file+': original header/table boundary pixels preserved')
 if file=='first-hearing-example.pdf':
  page.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(OUT/'first-hearing-example.png')
  page.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(23,505,146,608)).save(OUT/'first-hearing-cell.png')
report={'checksPassed':count,'measuredCell':list(CELL),'textBox':list(TEXT),'templateSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'visualExample':'first-hearing-cell.png'}
(OUT/'first-hearing-pdf-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('Checks:',count)
