"""Create image-only/mixed test PDFs from repository samples, without changing originals."""
from pathlib import Path
import fitz, unicodedata
root=Path(__file__).resolve().parents[1]
(root/'artifacts').mkdir(exist_ok=True)
for path in root.parent.glob('*.pdf'):
 name=unicodedata.normalize('NFC',path.name)
 if name not in ['공소장1.pdf','공소장2.pdf']:continue
 doc=fitz.open(path);n=1 if '1' in name else 2
 exact='\n'.join(page.get_text() for page in doc)
 assert exact==(root/f'tests/fixtures/sample{n}.txt').read_text(), 'Stored text fixture does not match actual PDF'
 if n==1:
  scan=fitz.open();page=scan.new_page(width=doc[0].rect.width,height=doc[0].rect.height);page.insert_image(page.rect,stream=doc[0].get_pixmap(matrix=fitz.Matrix(3,3)).tobytes('png'));scan.save(root/'artifacts/scanned-sample.pdf')
 else:
  mixed=fitz.open();mixed.insert_pdf(doc,from_page=0,to_page=0);page=mixed.new_page(width=doc[1].rect.width,height=doc[1].rect.height);page.insert_image(page.rect,stream=doc[1].get_pixmap(matrix=fitz.Matrix(3,3)).tobytes('png'));mixed.save(root/'artifacts/mixed-sample.pdf')
