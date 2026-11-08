import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
const root = resolve(import.meta.dirname, "..");
const files = await fs.readdir(resolve(root, ".."));
const pdf = resolve(
  root,
  "..",
  files.find((f) => f.normalize("NFC") === "공소장1.pdf"),
);
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  acceptDownloads: true,
  offline: true,
});
const network = [];
await context.route(/^https?:/, (route) => {
  network.push(route.request().url());
  return route.abort();
});
const page = await context.newPage();
page.on("console", (m) =>
  console.log("BROWSER", m.type(), m.text().slice(0, 300)),
);
page.on("pageerror", (e) => console.log("ERROR", e.message));
try {
  await page.setContent(
    await fs.readFile(
      resolve(root, "distribution/CriminalMemo/CriminalMemo.html"),
      "utf8",
    ),
  );
  await page.waitForFunction(() => !!window.CM);
  console.log("in-memory HTML diagnostic loaded (NOT file://)");
  await page.locator("#file").setInputFiles(pdf);
  console.log(
    await page.evaluate(async () => {
      const doc = await CM.PDFInputService.open(
        document.querySelector("#file").files[0],
      );
      window.probeDoc = doc;
      const page = await doc.getPage(1);
      const txt = await CM.PDFTextExtractor.page(page);
      const canvas = await CM.PDFTextExtractor.render(page, 2);
      window.probeCanvas = canvas;
      return {
        pages: doc.numPages,
        textCharacters: txt.text.length,
        canvas: [canvas.width, canvas.height],
      };
    }),
  );
  console.log("OCR START");
  console.log(
    await page.evaluate(async () => {
      const ocr = new CM.OCRService((s, p) => console.log("ocr", s, p));
      try {
        const result = await ocr.recognize(window.probeCanvas);
        return {
          confidence: result.confidence,
          hasKoreanName: result.text.replace(/\s/g, "").includes("이민주"),
        };
      } finally {
        await ocr.close();
      }
    }),
  );
  console.log("network", network);
} finally {
  await browser.close();
}
