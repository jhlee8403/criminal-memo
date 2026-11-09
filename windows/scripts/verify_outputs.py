"""Independent PyMuPDF checks of PDFs downloaded by the browser test (not a renderer simulation)."""
from pathlib import Path
import fitz
import numpy as np
import json, hashlib, unicodedata
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'
BOXES={'defendants':(33,128,173,239),'charges':(180,78,331,239),'prosecutor':(385,48,497,70),'counsel':(385,78,497,98),'date':(231,247,405,267),'detention':(537,48,562,70),'juvenile':(174,730,200,745),'mandatory':(109,746,165,761)}
count=0

def check(ok,message):
 global count
 if not ok: raise AssertionError(message)
 count+=1
 print('PASS:',message)

def pixels(page):
 p=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
 return np.frombuffer(p.samples,dtype=np.uint8).reshape(p.height,p.width,p.n)

source=next(p for p in ROOT.parent.glob('*.pdf') if unicodedata.normalize('NFC',p.name)=='형사메모.pdf')
template=fitz.open(source)
check(source.read_bytes()==(ROOT/'distribution-candidates/CriminalMemo-v2.2/templates/형사메모.pdf').read_bytes(),'distributed template byte-identical to repository original')
for prefix in ['', 'paddle-']:
 for n in [1,2]:
  doc=fitz.open(OUT/f'{prefix}output{n}.pdf');page=doc[0]
  check(len(doc)==len(template),f'{prefix}output{n}: all actual template pages preserved ({len(template)})')
  check(page.rect==template[0].rect,f'{prefix}output{n}: page size preserved')
  counsel=page.get_text(clip=fitz.Rect(BOXES['counsel'])).strip()
  check(counsel==('' if n==1 else '윤상일(국선)'),f'{prefix}output{n}: counsel blank/name only')
  lines=[line for b in page.get_text('dict',clip=fitz.Rect(BOXES['detention']))['blocks'] for line in b.get('lines',[])]
  spans=[s for l in lines for s in l['spans']]
  check(''.join(s['text'] for s in spans)==('O' if n==1 else 'OX'),f'{prefix}output{n}: exact ordered detention text')
  check(len(lines)==1,f'{prefix}output{n}: detention on one line')
  check(all(s['color']==(0xFF0000 if s['text']=='O' else 0) for s in spans),f'{prefix}output{n}: O red / X black in actual PDF')
  check(all(fitz.Rect(BOXES['detention']).contains(fitz.Rect(s['bbox'])) for s in spans),f'{prefix}output{n}: detention glyph bounds inside cell')
  expected_names=['1. 이민주'] if n==1 else ['1. 김유나','2. 이영수']
  check(page.get_text(clip=fitz.Rect(BOXES['defendants'])).strip().splitlines()==expected_names,f'{prefix}output{n}: Korean names and numbering readable')
  original=pixels(template[0]);actual=pixels(page);allowed=np.zeros(original.shape[:2],dtype=bool)
  for x0,y0,x1,y1 in BOXES.values():allowed[int((y0-2)*2):int((y1+2)*2)+1,int((x0-2)*2):int((x1+2)*2)+1]=True
  changed=np.any(original!=actual,axis=2)
  check(np.count_nonzero(changed&~allowed)==0,f'{prefix}output{n}: zero changed pixels outside input fields (2pt margin)')
  for key in ['juvenile','mandatory']:
   x0,y0,x1,y1=BOXES[key]
   check(np.array_equal(original[y0*2:y1*2,x0*2:x1*2],actual[y0*2:y1*2,x0*2:x1*2]),f'{prefix}output{n}: no inappropriate age circle at {key}')
  fonts=[doc.extract_font(f[0]) for f in page.get_fonts() if 'Nanum' in f[3]]
  check(any(len(f[3])>1_000_000 for f in fonts),f'{prefix}output{n}: Korean font fully embedded')
  page.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(OUT/f'{prefix}output{n}.png')
two_source=fitz.open(OUT/'two-page-source.pdf');two_out=fitz.open(OUT/'two-page-output.pdf')
check(len(two_out)==1,'synthetic two-page template produces exactly one page')
check(len(two_source)==2,'synthetic source remains two pages and is not modified')
aged=fitz.open(OUT/'age-marks.pdf')[0]
for key in ['juvenile','mandatory']:
 r=fitz.Rect(BOXES[key]);before=template[0].get_pixmap(clip=r,alpha=False);after=aged.get_pixmap(clip=r,alpha=False)
 check(before.samples!=after.samples,f'confirmed age rule adds {key} circle')
 shapes=[d for d in aged.get_drawings() if d['color']==(1,0,0) and fitz.Rect(d['rect']).intersects(r)]
 check(any(d['fill'] is None for d in shapes),f'{key}: red transparent ellipse, original text retained')
report={'checksPassed':count,'actualTemplatePages':len(template),'syntheticMultiPageFirstPageOnlyVerified':True,'templateSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'outputSource':'browser Blob downloads from in-memory diagnostic; not Windows Edge file://'}
(OUT/'pdf-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('Checks:',count)
