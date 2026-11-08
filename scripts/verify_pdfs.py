#!/usr/bin/env python3
"""Verify actual repository PDFs and generate coordinate diagnostics (not iOS output).

Requires PyMuPDF==1.26.6 and numpy. Does not modify source PDFs.
Run from any directory: python scripts/verify_pdfs.py
"""
import hashlib
import json
from pathlib import Path
import unicodedata

import fitz
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "pdf-validation"
OUT.mkdir(parents=True, exist_ok=True)
LAYOUT = json.loads((ROOT / "Sources/MemoCore/Resources/template-layout.json").read_text())
CHECK_COUNT = 0
PDFS = {unicodedata.normalize("NFC", p.name): p for p in ROOT.glob("*.pdf")}
TEMPLATE = PDFS["형사메모.pdf"]


def check(condition, message):
    global CHECK_COUNT
    if not condition:
        raise AssertionError(message)
    CHECK_COUNT += 1
    print("PASS:", message)


def box(name):
    x, y, width, height = LAYOUT["fields"][name]
    return fitz.Rect(x, y, x + width, y + height)


def main():
    original_hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in PDFS.values()}
    digest = original_hashes[TEMPLATE]
    check(digest == LAYOUT["templateSHA256"], "coordinate map matches exact original template hash")
    check((ROOT / "App/Resources/memo-template.pdf").read_bytes() == TEMPLATE.read_bytes(), "bundled template is byte-identical")
    source = fitz.open(TEMPLATE)
    page = source[0]
    check(len(source) == 1 and page.rotation == 0, "actual template has one unrotated page")
    check(abs(page.rect.width - LAYOUT["width"]) < 0.01 and abs(page.rect.height - LAYOUT["height"]) < 0.01, "actual media box matches map")
    circles = {"juvenile", "mandatoryCounsel"}
    words = page.get_text("words")
    table_lines = [item for drawing in page.get_drawings() for item in drawing["items"]
                   if item[0] == "l" and abs(item[1] - item[2]) > 20]
    for name in LAYOUT["fields"]:
        rect = box(name)
        check(page.rect.contains(rect), f"{name}: entirely inside original page")
        if name in circles:
            target = "소년" if name == "juvenile" else "필요적국선"
            matches = page.search_for(target)
            check(len(matches) == 1 and rect.contains(matches[0]), f"{name}: circle encloses original target label")
            continue
        check(not any(rect.intersects(fitz.Rect(w[:4])) for w in words), f"{name}: does not cover original printed text")
        check(not any(rect.intersects(fitz.Rect(item[1], item[2]) + (-0.2, -0.2, 0.2, 0.2)) for item in table_lines), f"{name}: does not cross table lines")

    mapping = fitz.open(TEMPLATE)
    for name in LAYOUT["fields"]:
        rect = box(name)
        mapping[0].draw_rect(rect, color=(0, 0.3, 1), width=0.6)
        mapping[0].insert_text((rect.x0 + 1, rect.y0 + 6), name, fontsize=5, color=(0, 0.2, 1))
    mapping.save(OUT / "coordinate-map.pdf")
    mapping[0].get_pixmap(matrix=fitz.Matrix(1.8, 1.8)).save(OUT / "coordinate-map.png")

    simulation = fitz.open(TEMPLATE)
    fields = {"defendants": "1. 가상피고인\n2. 시험피고인", "charges": "1. 가상죄명\n2. 시험죄명", "prosecutor": "가상검사", "counsel": "윤상일(국선)", "indictmentDate": "2025.08.22"}
    for name, text in fields.items():
        remaining = simulation[0].insert_textbox(box(name), text, fontname="korea", fontsize=11)
        check(remaining >= 0, f"simulation {name}: complete text fits in mapped field")
    detention = box("detention")
    # Coordinate simulation only: Courier approximates the app's monospaced font.
    # Draw contiguous glyph advances on one baseline, preserving individual colors.
    font = fitz.Font("cour")
    font_size = 12
    advance = font.text_length("O", fontsize=font_size)
    start_x = (detention.x0 + detention.x1) / 2 - advance
    line_height = (font.ascender - font.descender) * font_size
    baseline = detention.y0 + (detention.height - line_height) / 2 + font.ascender * font_size
    for index, (character, color) in enumerate([("O", (1,0,0)), ("X", (0,0,0))]):
        simulation[0].insert_text((start_x + index * advance, baseline), character,
                                  fontname="cour", fontsize=font_size, color=color)
    lines = [line for block in simulation[0].get_text("dict", clip=detention)["blocks"]
             for line in block.get("lines", [])]
    spans = [span for line in lines for span in line["spans"]]
    check("".join(span["text"] for span in spans) == "OX", "simulation detention is exactly OX without separators")
    check(len(lines) == 1 and all(detention.contains(fitz.Rect(span["bbox"])) for span in spans), "simulation detention fits on one line inside original cell")
    check([(span["text"], span["color"]) for span in spans] == [("O",0xFF0000),("X",0)], "simulation O is red and X is black")
    counsel_text = simulation[0].get_text(clip=box("counsel")).strip()
    check("".join(counsel_text.split()) == "윤상일(국선)", "simulation counsel contains name only, no number or X")
    for name in circles:
        simulation[0].draw_oval(box(name), color=(1, 0, 0), width=1.3)
    simulation.save(OUT / "sample-output-simulation.pdf")
    simulation[0].get_pixmap(matrix=fitz.Matrix(1.8, 1.8)).save(OUT / "sample-output-simulation.png")
    check(len(simulation) == len(source), "simulation preserves all template pages")
    a = page.get_pixmap(matrix=fitz.Matrix(2,2), alpha=False)
    b = simulation[0].get_pixmap(matrix=fitz.Matrix(2,2), alpha=False)
    before = np.frombuffer(a.samples, dtype=np.uint8).reshape(a.height, a.width, a.n)
    after = np.frombuffer(b.samples, dtype=np.uint8).reshape(b.height, b.width, b.n)
    allowed = np.zeros((a.height, a.width), dtype=bool)
    for name in LAYOUT["fields"]:
        r = box(name) + (-2,-2,2,2)
        allowed[max(0,int(r.y0*2)):int(r.y1*2)+1,max(0,int(r.x0*2)):int(r.x1*2)+1] = True
    changed = np.any(before != after, axis=2)
    check(np.count_nonzero(changed & ~allowed) == 0, "simulation changes zero pixels outside mapped fields (2pt margin)")
    samples = []
    for number in (1,2):
        doc = fitz.open(PDFS[f"공소장{number}.pdf"])
        text = "\n".join(p.get_text() for p in doc)
        fixture = (ROOT / f"Tests/MemoCoreTests/Fixtures/sample{number}.txt").read_text()
        check(text == fixture, f"sample {number}: Swift fixture is extracted from actual PDF")
        check(len(doc) == (1 if number == 1 else 2) and len(text.strip()) > 100, f"sample {number}: text extraction succeeds")
        samples.append({"file": f"공소장{number}.pdf", "pages":len(doc), "textCharacters":len(text.strip())})
    check(all(hashlib.sha256(p.read_bytes()).hexdigest() == digest for p, digest in original_hashes.items()), "all three original PDFs remain unchanged")
    report = {"templateSHA256":digest,"templatePages":len(source),"fields":LAYOUT["fields"],"samples":samples,"outsideFieldChangedPixels":int(np.count_nonzero(changed & ~allowed)),"renderer":"PyMuPDF coordinate simulation; NOT the iOS renderer", "iOSBuildTested":False,"checksPassed":CHECK_COUNT}
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n")
    print("Artifacts:", OUT)


if __name__ == "__main__":
    main()
