import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import Tesseract from "tesseract.js";
import { assessFirstHearing } from "./first-hearing.js";
import {
  counselText,
  numbered,
  detentionGlyphs,
  ageMarks,
  juvenileGlyphs,
  juryGlyph,
  redactResidentNumbers,
} from "./core.js";
export const bytes = (b64) =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const boxes = {
  // Measured case cell x=69.203..176.665, y=43.872..100.570 pt.
  caseNumber: [74, 61, 97, 27],
  defendants: [33, 128, 140, 111],
  charges: [180, 78, 151, 161],
  prosecutor: [385, 48, 112, 22],
  counsel: [385, 78, 112, 20],
  filingDate: [231, 247, 174, 20],
  // Measured original cell: x=29.744..106.263, y=540.1292..600.9031 pt.
  firstHearing: [34, 548, 67, 42],
  detention: [537, 48, 25, 22],
  // Free band: table top 722.330, printed 소년 starts 732.124pt.
  juvenile: [168, 723.5, 39, 8],
  // Printed 국참 bounds x177.384..197.413, y748.187..758.673.
  jury: [174, 746, 26, 15],
  mandatory: [109, 746, 56, 15],
};
class LocalCMapReaderFactory {
  async fetch({ name }) {
    const data = window.CM_DOCUMENTS.cmaps[name + ".bcmap"];
    if (!data) throw Error("내장 CMap이 없습니다: " + name);
    return { cMapData: bytes(data), compressionType: 1 };
  }
}
class LocalStandardFontDataFactory {
  async fetch({ filename }) {
    const data = window.CM_DOCUMENTS.standardFonts[filename];
    if (!data) throw Error("내장 PDF 기본 글꼴이 없습니다: " + filename);
    return bytes(data);
  }
}
export class PDFInputService {
  static async open(file) {
    if (file.size > 50 * 1024 * 1024)
      throw Error("50MB 이하 PDF를 선택하세요.");
    const buffer = await file.arrayBuffer();
    return this.fromBytes(new Uint8Array(buffer));
  }
  static async fromBytes(data) {
    const pdf = await window.pdfjsLib.getDocument({
      data: data.slice(),
      isEvalSupported: false,
      useSystemFonts: false,
      disableAutoFetch: true,
      useWorkerFetch: false,
      CMapReaderFactory: LocalCMapReaderFactory,
      StandardFontDataFactory: LocalStandardFontDataFactory,
    }).promise;
    if (pdf.numPages < 1 || pdf.numPages > 100) {
      await pdf.destroy();
      throw Error("1~100페이지 PDF만 지원합니다.");
    }
    return pdf;
  }
}
export class PDFTextExtractor {
  static async page(page) {
    const content = await page.getTextContent();
    const view = page.getViewport({ scale: 1 });
    const items = content.items
      .filter((i) => i.str?.trim())
      .map((i) => {
        const [x, y] = view.convertToViewportPoint(
          i.transform[4],
          i.transform[5],
        );
        return { str: i.str, x, y, w: i.width, h: i.height };
      });
    const rows = [];
    for (const i of items.sort((a, b) => a.y - b.y || a.x - b.x)) {
      let row = rows.find(
        (r) => Math.abs(r.y - i.y) < Math.max(2, Math.min(i.h, 10) * 0.3),
      );
      if (!row) {
        row = { y: i.y, items: [] };
        rows.push(row);
      }
      row.items.push(i);
    }
    const lines = rows
      .sort((a, b) => a.y - b.y)
      .map((r) => ({
        y: r.y,
        text: redactResidentNumbers(r.items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join(" ")),
      }));
    const safeText=redactResidentNumbers(lines.map(l=>l.text).join("\n"));
    const safeLines=safeText.split("\n");
    return {
      text: safeText,
      lines: lines.map((line,i)=>({...line,text:safeLines[i]})),
      width: view.width,
      height: view.height,
    };
  }
  static async render(page, scale = 2) {
    const view = page.getViewport({
      scale: Math.min(
        scale,
        2800 /
          Math.max(page.view[2] - page.view[0], page.view[3] - page.view[1]),
      ),
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(view.width);
    canvas.height = Math.ceil(view.height);
    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport: view,
    }).promise;
    return canvas;
  }
}
export class OCRService {
  constructor(progress = () => {}) {
    this.progress = progress;
    this.worker = null;
    this.url = null;
  }
  async init() {
    if (this.worker) return;
    this.url = URL.createObjectURL(
      new Blob([window.CM_OCR_WORKER], { type: "application/javascript" }),
    );
    this.worker = await Tesseract.createWorker("kor+eng", 1, {
      workerPath: this.url,
      workerBlobURL: false,
      corePath: "cm-local://unused.js",
      langPath: "cm-local://lang",
      cacheMethod: "none",
      gzip: true,
      logger: (m) => this.progress(m.status, m.progress),
      errorHandler: (e) => this.progress(String(e), 0),
    });
  }
  async recognize(canvas) {
    await this.init();
    const { data } = await this.worker.recognize(canvas);
    if (!data.text.trim()) throw Error("OCR에서 텍스트를 읽지 못했습니다.");
    return data;
  }
  async close() {
    if (this.worker) await this.worker.terminate();
    if (this.url) URL.revokeObjectURL(this.url);
    this.worker = null;
    this.url = null;
  }
}
export async function analyze(
  pdf,
  { forceOCR = false, progress = () => {} } = {},
) {
  const pages = [], warnings = [],
    ocr = new OCRService(progress);
  let usedOCR = false;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      progress(`페이지 ${n}/${pdf.numPages}`, 0);
      const page = await pdf.getPage(n);
      let result;
      try { result = await PDFTextExtractor.page(page); }
      catch (error) { result = {text:"",lines:[],height:page.getViewport({scale:1}).height}; warnings.push(`페이지 ${n}: 텍스트 추출 실패 · ${error.message}`); }
      if (forceOCR || result.text.replace(/[^\p{L}\p{N}]/gu, "").length < 20) {
        try {
        const data = await ocr.recognize(
          await PDFTextExtractor.render(page, 3),
        );
        result = {
          ...result,
          text: redactResidentNumbers(data.text),
          lines: redactResidentNumbers(data.text).split("\n").map((text, i) => ({ text, y: i * 12 })),
          ocr: true,
          confidence: data.confidence,
        };
        usedOCR = true;
        } catch (error) { warnings.push(`페이지 ${n}: OCR 추출 실패 · ${error.message}`); }
      }
      pages.push(result);
    }
  } finally {
    await ocr.close();
  }
  return { pages, usedOCR, warnings, text: pages.map((p) => p.text).join("\n") };
}
export class MemoPDFRenderer {
  static async render(draft, { templateBytes, secondTemplateBytes, firstHearing, caseNumber } = {}) {
    const hearing = assessFirstHearing(firstHearing);
    if (hearing.error) throw Error(hearing.error);
    const glyphs = detentionGlyphs(draft.defendants, {partial:true});
    const doc = await PDFDocument.load(
      templateBytes ?? bytes(window.CM_DOCUMENTS.template),
    );
    if (doc.getPageCount() !== 1) throw Error("첫 페이지 원본 양식은 1페이지여야 합니다.");
    const second = await PDFDocument.load(secondTemplateBytes ?? bytes(window.CM_DOCUMENTS.secondTemplate));
    if (second.getPageCount() !== 1) throw Error("두 번째 원본 양식은 1페이지여야 합니다.");
    const fontData = bytes(window.CM_DOCUMENTS.font);
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontData, { subset: false });
    const mono = await doc.embedFont("Courier");
    const page = doc.getPage(0),
      { width, height } = page.getSize();
    if (
      Math.abs(width - 595) > 1 ||
      Math.abs(height - 841) > 1 ||
      page.getRotation().angle !== 0
    )
      throw Error("양식 크기/회전이 분석한 좌표와 다릅니다.");
    const draw = (value, key) => {
      if (!value) return;
      const [x, y, w, h] = boxes[key];
      // Only the counsel cell may shrink further to preserve all listed lawyers.
      for (let size = 11; size >= (key === "counsel" ? 4 : 8); size -= 0.5) {
        // A hearing must stay exactly two lines; shrink instead of wrapping its date.
        if (key === "firstHearing" && value.split("\n").some(l => font.widthOfTextAtSize(l, size) > w)) continue;
        const lines = [];
        for (const raw of value.split("\n")) {
          let line = "";
          for (const c of raw) {
            if (font.widthOfTextAtSize(line + c, size) > w) {
              if (!line) throw Error(`${key}: 칸을 넘는 글자입니다.`);
              lines.push(line);
              line = c;
            } else line += c;
          }
          lines.push(line);
        }
        const lineHeight = size * 1.25;
        if (lines.length * lineHeight <= h) {
          lines.forEach((l, i) =>
            page.drawText(l, {
              x,
              y: height - y - size - i * lineHeight,
              size,
              font,
              color: rgb(0, 0, 0),
            }),
          );
          return;
        }
      }
      throw Error(`${key}: 내용이 칸을 넘습니다. 줄여 주세요.`);
    };
    draw(caseNumber, "caseNumber");
    draw(numbered(draft.defendants.map((p) => p.name)), "defendants");
    draw(
      numbered(
        draft.defendants.flatMap((p) =>
          p.charges.map((c) =>
            draft.defendants.length > 1 && p.name ? `${c} (${p.name})` : c,
          ),
        ),
      ),
      "charges",
    );
    draw(draft.prosecutor, "prosecutor");
    draw(counselText(draft), "counsel");
    draw(draft.filingDate?.replaceAll("-", ".") ?? "", "filingDate");
    draw(hearing.text, "firstHearing");
    const [x, y, w, h] = boxes.detention;
    let fitted = false;
    for (let size = 14; size >= 8; size -= 0.5) {
      const text = glyphs.map((g) => g.text).join("");
      const width = mono.widthOfTextAtSize(text, size);
      if (width <= w && size * 1.249 <= h) {
        let dx = x + (w - width) / 2;
        for (const g of glyphs) {
          page.drawText(g.text, {
            x: dx,
            y: height - (y + (h - size * 1.249) / 2 + size * 0.932),
            size,
            font: mono,
            color: g.color === "red" ? rgb(1, 0, 0) : rgb(0, 0, 0),
          });
          dx += mono.widthOfTextAtSize(g.text, size);
        }
        fitted = true;
        break;
      }
    }
    if (!fitted) throw Error("구속 표시가 한 줄에 들어가지 않습니다.");
    const marks = ageMarks(draft);
    for (const key of ["mandatory"]) {
      if (marks[key]) {
        const [cx, cy, cw, ch] = boxes[key];
        page.drawEllipse({
          x: cx + cw / 2,
          y: height - cy - ch / 2,
          xScale: cw / 2,
          yScale: ch / 2,
          borderColor: rgb(1, 0, 0),
          borderWidth: 1.3,
        });
      }
    }
    const drawGlyphs=(items,key)=>{
      if(!items.some(g=>g.text.trim()))return;
      const [gx,gy,gw,gh]=boxes[key];
      for(let size=14;size>=3;size-=.25){
        const width=mono.widthOfTextAtSize(items.map(g=>g.text).join(''),size);
        if(width>gw || size*1.249>gh)continue;
        let dx=gx+(gw-width)/2;
        for(const g of items){
          page.drawText(g.text,{x:dx,y:height-(gy+(gh-size*1.249)/2+size*.932),size,font:mono,color:g.color==='red'?rgb(1,0,0):rgb(0,0,0)});
          dx+=mono.widthOfTextAtSize(g.text,size);
        }
        return;
      }
      throw Error(`${key}: 표시가 한 줄에 들어가지 않습니다.`);
    };
    drawGlyphs(juvenileGlyphs(draft),'juvenile');
    drawGlyphs([juryGlyph(draft)],'jury');
    const [secondPage] = await doc.copyPages(second, [0]);
    doc.addPage(secondPage);
    return await doc.save();
  }
}
export class PDFExportService {
  static download(data, name) {
    const url = URL.createObjectURL(
      new Blob([data], { type: "application/pdf" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download =
      (name.trim() || "형사신건메모").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") +
      ".pdf";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
