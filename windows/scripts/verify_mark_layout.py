"""Measure actual rasterized O/X ink, independent of JS layout-return values."""
from pathlib import Path
import os,json,fitz,numpy as np,unicodedata
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('CM_MARK_ARTIFACTS',ROOT/'artifacts/mark-layout'))
r=json.loads((OUT/'browser-report.json').read_text());assert r['passed']
REF={'juvenile':(177.383865,732.124207,20.028656,10.486389),'jury':(177.383865,748.186707,20.028656,10.486389)}
FIT={'juvenile':(169.398193,730.3674015,36,14),'jury':(174.398193,746.4299015,26,14)}
CROP={'juvenile':fitz.Rect(167,721.5,209,745.8),'jury':fitz.Rect(172,745.8,203,763)}
count=0

def check(value,message):
 global count
 if not value:raise AssertionError(message)
 count+=1

def raster(page,scale=2,clip=None):
 p=page.get_pixmap(matrix=fitz.Matrix(scale,scale),clip=clip,alpha=False)
 a=np.frombuffer(p.samples,np.uint8).reshape(p.height,p.width,p.n)
 return p,a[:,:,:3]
def ink(page,key):
 s=8;p,a=raster(page,s,CROP[key]);m=a.min(2)<210
 if not m.any():return None,[]
 ys,xs=np.where(m);bounds=[(p.x+xs.min())/s,(p.y+ys.min())/s,(xs.max()-xs.min()+1)/s,(ys.max()-ys.min()+1)/s]
 active=np.flatnonzero(m.any(0));groups=np.split(active,np.flatnonzero(np.diff(active)>1)+1);parts=[]
 for group in groups:
  sub=m[:,group[0]:group[-1]+1];cy,cx=np.where(sub)
  values=a[:,group[0]:group[-1]+1][sub]
  parts.append({'rect':[(p.x+group[0]+cx.min())/s,(p.y+cy.min())/s,(cx.max()-cx.min()+1)/s,(cy.max()-cy.min()+1)/s],
   'red':bool(np.any((values[:,0].astype(int)-values[:,1].astype(int)>40)&(values[:,1]<190)))})
 return bounds,parts

def fit_ink(page,key,expected):
 bounds,parts=ink(page,key);wanted=expected.replace(' ','')
 check(len(parts)==len(wanted),key+': one actual ink component per confirmed defendant/glyph')
 if not wanted:check(bounds is None,key+': unknown means no mark');return None
 x,y,w,h=REF[key];center=(x+w/2,y+h/2);fx,fy,fw,fh=FIT[key]
 for char,part in zip(wanted,parts):
  px,py,pw,ph=part['rect']
  check(part['red']==(char=='O'),key+': actual red O / black X')
  check(px>=fx-.25 and px+pw<=fx+fw+.25 and py>=fy-.25 and py+ph<=fy+fh+.25,key+': actual ink fits safe rectangle')
  check(abs(py+ph/2-center[1])<=.25,key+': actual vertical center on printed label')
  if len(expected)<=3:check(ph>=h-.25,key+': actual ink covers printed label height')
 bx,by,bw,bh=bounds
 if expected[0]!=' ' and expected[-1]!=' ':check(abs(bx+bw/2-center[0])<=.25,key+': actual run horizontally centered')
 if len(expected)==1:check(bw>=w-.25 and bh>=h,key+': single O/X covers both Korean characters')
 return bounds

original=next(p for p in ROOT.parent.glob('*.pdf') if unicodedata.normalize('NFC',p.name)=='형사메모.pdf')
source=fitz.open(original);second=fitz.open(ROOT/'templates/형사메모(2쪽).pdf')
for key,label in [('juvenile','소년'),('jury','국참')]:
 word=next(w for w in source[0].get_text('words') if w[4]==label);x,y,w,h=REF[key]
 check(max(abs(a-b) for a,b in zip(word[:4],(x,y,x+w,y+h)))<.0001,key+': reference rectangle matches actual original PDF')
rows=[];measures=[]
for case in r['cases']:
 ident=case['id'];before=fitz.open(OUT/f'{ident}-before.pdf');after=fitz.open(OUT/f'{ident}-after.pdf')
 diag_before=fitz.open(OUT/f'{ident}-before-ink.pdf');diag_after=fitz.open(OUT/f'{ident}-after-ink.pdf')
 for name,doc in [('before',before),('after',after),('before-ink',diag_before),('after-ink',diag_after)]:
  check(len(doc)==2,ident+' '+name+': exactly two pages')
  check(doc[1].rect==second[0].rect and doc[1].rotation==second[0].rotation,ident+' '+name+': second page dimensions and rotation unchanged')
  check(doc[1].read_contents()==second[0].read_contents(),ident+' '+name+': second page original content stream unchanged')
  check(np.array_equal(raster(doc[1])[1],raster(second[0])[1]),ident+' '+name+': second page pixel-identical')
 a,b=raster(after[0])[1],raster(before[0])[1];allowed=np.zeros(a.shape[:2],bool)
 for region in CROP.values():
  x0,y0,x1,y1=region;allowed[int(y0*2)-1:int(y1*2)+2,int(x0*2)-1:int(x1*2)+2]=True
 check(np.count_nonzero(np.any(a!=b,2)&~allowed)==0,ident+': first page pixel-identical outside the two mark regions')
 paths=lambda page:[{k:d[k] for k in ['items','color','fill','width','rect','type']} for d in page.get_drawings()]
 check(paths(after[0])==paths(before[0]),ident+': original table and all vector paths unchanged')
 measured={'id':ident,'youth':case['youth'],'jury':case['jury']}
 for key,seq in [('juvenile',case['youth']),('jury',case['jury'])]:
  new=fit_ink(diag_after[0],key,seq);old,_=ink(diag_before[0],key)
  measured[key]={'before':old,'after':new}
  if len(seq)==1 and seq.strip():
   check(new[3]>old[3]*1.5,key+': single mark actual height increased at least 50%')
   if key=='juvenile':check(abs((old[1]+old[3]/2)-(REF[key][1]+REF[key][3]/2))>5,'old juvenile was a superscript; new mark is centered')
 measures.append(measured)
 pair=[]
 for version,doc in [('before',before),('after',after)]:
  target=OUT/f'{ident}-{version}.png';doc[0].get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(102,719,216,771)).save(target)
  pair.append(Image.open(target).convert('RGB'))
 row=Image.new('RGB',(pair[0].width*2+28,pair[0].height+30),'white');draw=ImageDraw.Draw(row)
 draw.text((6,5),f"{ident} BEFORE | juvenile {case['youth']!r}, jury {case['jury']!r}",fill='black');draw.text((pair[0].width+22,5),'AFTER',fill='black')
 row.paste(pair[0],(0,26));row.paste(pair[1],(pair[0].width+28,26));rows.append(row)
 if ident=='01':
  before[0].get_pixmap(matrix=fitz.Matrix(1.25,1.25)).save(OUT/'before-first-page.png')
  after[0].get_pixmap(matrix=fitz.Matrix(1.25,1.25)).save(OUT/'after-first-page.png')
  after[1].get_pixmap(matrix=fitz.Matrix(1.25,1.25)).save(OUT/'after-second-page.png')
overview=Image.new('RGB',(rows[0].width,sum(i.height for i in rows)),'white');y=0
for row in rows:overview.paste(row,(0,y));y+=row.height
overview.save(OUT/'mark-layout-before-after.png')
result={'checksPassed':count,'cases':len(r['cases']),'pdfsVerified':len(r['cases'])*4,'measurements':measures,'windowsEdge104Verified':False,'htmlSHA256':r['htmlSHA256']}
(OUT/'pdf-report.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='measurements'},indent=2))
