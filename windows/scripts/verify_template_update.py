"""Compare the actual upload, embedded template, and paired old/new PDF output."""
from pathlib import Path
import fitz, numpy as np, json, os, subprocess, hashlib, re, base64
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('CM_TEMPLATE_ARTIFACTS','/tmp/template-update-comparison'))
old=fitz.open(OUT/'old-template.pdf');source=ROOT/'templates/형사메모(1).pdf';new=fitz.open(source)
count=0

def check(ok,msg):
 global count
 if not ok:raise AssertionError(msg)
 count+=1

def pix(p,scale=2):
 q=p.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
 return np.frombuffer(q.samples,np.uint8).reshape(q.height,q.width,q.n)

def equal_page(a,b,label):
 check(a.rect==b.rect and a.mediabox==b.mediabox and a.cropbox==b.cropbox and a.rotation==b.rotation,label+': dimensions/crop/rotation')
 check(a.get_text('dict')==b.get_text('dict'),label+': text/fonts/coordinates')
 check(a.get_drawings()==b.get_drawings(),label+': drawings/coordinates')
 check(a.read_contents()==b.read_contents(),label+': content stream')
 for scale in [1,2,4]:check(np.array_equal(pix(a,scale),pix(b,scale)),label+f': identical pixels {scale}x')

check(len(old)==len(new)==2,'old/new both two pages')
check(hashlib.sha256(source.read_bytes()).hexdigest()=='b16fcb041110090725863c5a4934a03b80ea935f6086d9bcf7111528aeb6f75c','upload hash')
equal_page(old[0],new[0],'original first page')
check(not np.array_equal(pix(old[1]),pix(new[1])),'second page actually changed')
# No application, parser, coordinates, OCR, CSS or build changes allowed.
for path in ['src','scripts/build.mjs','package.json','package-lock.json','vendor']:
 check(not subprocess.check_output(['git','diff','783b158','--',f'windows/{path}'],cwd=ROOT.parent),path+': unchanged')
oldhtml=subprocess.check_output(['git','show','783b158:windows/distribution/CriminalMemo/CriminalMemo.html'],cwd=ROOT.parent).decode()
html=(ROOT/'distribution/CriminalMemo/CriminalMemo.html').read_text()
pattern=r'<script>([\s\S]*?)</script>'
a=re.findall(pattern,oldhtml);b=re.findall(pattern,html)
check(len(a)==len(b)==5,'same script structure')
check(a[1:]==b[1:],'OCR/PDF.js/app bundled scripts unchanged')
check(re.sub(pattern,'<script></script>',oldhtml)==re.sub(pattern,'<script></script>',html),'all HTML/CSS/UI outside scripts unchanged')
docs=json.loads(b[0].removeprefix('window.CM_DOCUMENTS=').strip().removesuffix(';'))
check(base64.b64decode(docs['template'])==source.read_bytes(),'exact upload embedded in HTML')
report=json.loads((OUT/'browser-report.json').read_text());check(report['passed'] and report['fileMode'],'offline actual file browser test passed')
for case in report['cases']:
 a,b=[fitz.open(OUT/f'{case}-{version}.pdf')for version in ['old','new']]
 check(len(a)==len(b)==2,case+': exactly two pages')
 equal_page(a[0],b[0],case+': generated first page unchanged')
 equal_page(b[1],new[1],case+': generated second original unchanged')
 if case=='multiple-OX':
  for i in range(2):b[i].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(OUT/f'generated-page-{i+1}.png')
for version,doc in [('old',old),('new',new)]:
 for i in range(2):doc[i].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(OUT/f'{version}-page-{i+1}.png')
difference=np.any(pix(old[1])!=pix(new[1]),axis=2)
result={'checksPassed':count,'firstPageSize':list(new[0].rect),'firstPagePixelDifference':0,'secondPageChangedPixelsAt2x':int(difference.sum()),'pairedOutputCases':len(report['cases']),'templateSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'htmlSHA256':report['htmlSHA256'],'windowsEdge104Verified':False}
(OUT/'pdf-report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
