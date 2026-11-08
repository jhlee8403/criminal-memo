"""Synthetic, reproducible OCR stress fixtures; never modifies repository PDFs."""
from pathlib import Path
import fitz,unicodedata,json,random
from PIL import Image
root=Path(__file__).resolve().parents[1];out=root/'artifacts/ocr-fixtures';out.mkdir(parents=True,exist_ok=True)
files={unicodedata.normalize('NFC',p.name):p for p in root.parent.glob('*.pdf')}
expected1={'names':['이민주'],'prosecutor':'이승엽','charges':[['상해','폭행치상']]}
expected2={'names':['김유나','이영수'],'prosecutor':'이정현','charges':[['공무집행방해'],['상해','절도']]}
cases=[]
def add(name,path,expected,kind):cases.append({'name':name,'path':str(path.resolve()),'expected':expected,'kind':kind})
def scan(source,target,dpi=300,skew=0):
 d=fitz.open(source);outdoc=fitz.open()
 for original in d:
  pix=original.get_pixmap(matrix=fitz.Matrix(dpi/72,dpi/72));im=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
  if skew:
   im=im.rotate(skew,resample=Image.Resampling.BICUBIC,fillcolor='white');rng=random.Random(12);px=im.load()
   for _ in range(int(im.width*im.height*.001)):px[rng.randrange(im.width),rng.randrange(im.height)]=(0,0,0)
  import io
  stream=io.BytesIO();im.save(stream,format='PNG');page=outdoc.new_page(width=original.rect.width,height=original.rect.height);page.insert_image(page.rect,stream=stream.getvalue())
 outdoc.save(target)
for n in (1,2):add(f'native{n}',files[f'공소장{n}.pdf'],expected1 if n==1 else expected2,'native')
for dpi in [300,90]:
 p=out/f'scan-{dpi}.pdf';scan(files['공소장1.pdf'],p,dpi);add(f'scan{dpi}',p,expected1,'scan')
p=out/'skew-noise.pdf';scan(files['공소장1.pdf'],p,160,skew=2);add('skew-noise',p,expected1,'scan-skew')
# A text PDF with shifted role locations, small type and unnumbered multiline charge values.
for name,size in [('shifted',11),('small',6)]:
 d=fitz.open();page=d.new_page(width=596,height=842);page.insert_font(fontname='nano',fontfile=str(root/'vendor/NanumGothic-Regular.ttf'))
 lines=[(55,70,'2025. 8. 22.'),(55,135,'검사:'),(55,155,'이승엽'),(55,240,'피고인 이민주 (841204-7293746), 41세'),(280,300,'죄명'),(280,320,'상해,'),(280,335,'폭행치상'),(55,390,'적용법조 형법 제257조 제1항'),(55,430,'구속여부 구속'),(55,460,'변호인 없음')]
 for x,y,text in lines:page.insert_text((x,y),text,fontname='nano',fontsize=size)
 original=out/f'{name}-text.pdf';d.save(original)
 target=original
 if name=='small':target=out/'small-scan.pdf';scan(original,target,150)
 add(name,target,expected1,'shifted-text' if name=='shifted' else 'small-scan')
# A visibly correct scan with a selectable but WRONG text layer at matching positions.
source=fitz.open(files['공소장1.pdf'])
for name,broken in [('wrong-selectable',False),('broken-selectable',True)]:
 d=fitz.open();page=d.new_page(width=source[0].rect.width,height=source[0].rect.height);page.insert_image(page.rect,stream=source[0].get_pixmap(matrix=fitz.Matrix(3,3)).tobytes('png'))
 page.insert_font(fontname='nano',fontfile=str(root/'vendor/NanumGothic-Regular.ttf'))
 for block in source[0].get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   for span in line['spans']:
    text=span['text'].replace('이승엽','홍길동' if not broken else '홍�동').replace('상해, 폭행치상','사기')
    page.insert_text(span['origin'],text,fontname='nano',fontsize=span['size'],render_mode=3)
 target=out/f'{name}.pdf';d.save(target);add(name,target,expected1,'bad-text-layer')
# Mixed, two pages, second defendant's charges continue on a scanned second page.
d=fitz.open(files['공소장2.pdf']);mix=fitz.open();mix.insert_pdf(d,from_page=0,to_page=0);page=mix.new_page(width=d[1].rect.width,height=d[1].rect.height);page.insert_image(page.rect,stream=d[1].get_pixmap(matrix=fitz.Matrix(3,3)).tobytes('png'));p=out/'mixed-two.pdf';mix.save(p);add('mixed-two',p,expected2,'mixed')
# Ground-truth regions are benchmark annotations only, never runtime fixed coordinates.
for case in cases:
 if case['name'] not in ['native1','skew-noise']:continue
 annotations=[]
 for field,label in [('prosecutor','이승엽'),('charges','상해, 폭행치상')]:
  rect=source[0].search_for(label)[0]
  padding=12 if case['name']=='skew-noise' else 4
  rect=rect+(-padding,-padding,padding,padding)
  annotations.append({'field':field,'key':'prosecutor' if field=='prosecutor' else 'person.0.charges','page':1,'personIndex':None if field=='prosecutor' else 0,'box':[rect.x0,rect.y0,rect.width,rect.height],'valueOnly':True,'singleLine':True,'textHeight':12,'method':'manual','anchor':''})
 case['preprocessingRegions']=annotations
(out/'manifest.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2));print('Prepared',len(cases),'OCR cases in',out)
