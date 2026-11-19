"""Independent PDF verification for fixed counsel and folder-download fallback."""
from pathlib import Path
import os,json,fitz,numpy as np
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('CM_EDGE_ARTIFACTS',ROOT/'artifacts/edge-fixed'))
r=json.loads((OUT/'edge-fixed-browser-report.json').read_text());assert r['passed']
template=fitz.open(ROOT/'templates/형사메모(1).pdf');count=0

def check(ok,msg):
 global count
 if not ok:raise AssertionError(msg)
 count+=1

def pixels(page):
 p=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
 return np.frombuffer(p.samples,np.uint8).reshape(p.height,p.width,p.n)
def text(page,rect):return page.get_text(clip=fitz.Rect(rect)).strip()
def pdf(path):
 d=fitz.open(path);check(len(d)==2,path.name+': two pages')
 check(d[1].rect==template[1].rect and d[1].rotation==template[1].rotation,path.name+': second geometry')
 check(d[1].read_contents()==template[1].read_contents(),path.name+': original second stream')
 check(d[1].get_text('dict')==template[1].get_text('dict'),path.name+': original second text/fonts/positions')
 check(np.array_equal(pixels(d[1]),pixels(template[1])),path.name+': original second pixels')
 return d
for b in r['batches']:
 check(b['requested']==b['count'] and b['savedReported']==0,'batch requests never claim folder save')
 check(b['simulatedBlockedRequestsNotClaimedSaved'] and b['oneAtATimeRestart'],'blocked simulation and fresh-gesture restart')
 for i in range(b['count']):
  p=pdf(OUT/f"batch-{b['count']}-{i}.pdf")[0]
  check(text(p,(74,61,171,88))==f"2026고정{6000+b['count']*100+i}",'case filename uses existing rule')
for c in r['counselCases']:
 p=pdf(OUT/c['file'])[0]
 check(''.join(text(p,(385,78,497,98)).split())==''.join(c['expected'].split()),c['id']+': exact complete counsel format')
 check('500' not in text(p,(385,78,497,98)) and '명령' not in text(p,(385,78,497,98)),c['id']+': no opinion/payment text')
 check(text(p,(537,48,562,70))==c['detention'],c['id']+': detention X without field for 고정')
 check(text(p,(385,48,497,70))=='이가상',c['id']+': prosecutor unchanged')
 check(text(p,(231,247,461,267))=='2026.11.17',c['id']+': body filing priority unchanged')
 lower=[]
 for span in p.get_texttrace():
  for char in span['chars']:
   if chr(char[0]) in 'OX' and char[2][1]>480 and char[2][1]<540:lower.append((chr(char[0]),span['color'],char[2][1]))
 check(len(lower)==2 and all(g[0]=='O' and g[1]==(1,0,0) for g in lower),c['id']+': juvenile/jury red O unchanged')
 shapes=[d for d in p.get_drawings() if d['color']==(1,0,0) and fitz.Rect(d['rect']).intersects(fitz.Rect(108,510,165,526))]
 check(len(shapes)==int(c['kind']=='고단'),c['id']+': detained mandatory circle unchanged')
 if c['id']=='fixed-firm-long':p.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(334,43,505,102)).save(OUT/'fixed-firm-long.png')
before=pdf(OUT/'fixed-regular-before.pdf')[0];after=fitz.open(OUT/'fixed-regular.pdf')[0]
check(text(before,(385,78,497,98))=='' and text(after,(385,78,497,98))=='김가상','before unconfirmed blank -> exact name after boundary fix')
a,b=pixels(before),pixels(after);allowed=np.zeros(a.shape[:2],bool);allowed[152:202,766:1000]=True
check(np.count_nonzero(np.any(a!=b,2)&~allowed)==0,'before/after pixels identical outside counsel field')
for label,page in [('before',before),('after',after)]:page.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(334,43,505,103)).save(OUT/f'fixed-counsel-{label}.png')
after.get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(OUT/'fixed-counsel-first-page.png')
result={'checksPassed':count,'pdfsVerified':sum(b['count'] for b in r['batches'])+len(r['counselCases'])+1,'htmlSHA256':r['htmlSHA256'],'windowsEdge104Verified':False,'nativePickerSelectionVerified':False}
(OUT/'edge-fixed-pdf-report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
