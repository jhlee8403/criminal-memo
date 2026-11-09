import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, ".."),
  htmlPath = path.join(
    root,
    "distribution-candidates/CriminalMemo-v2.2/CriminalMemo.html",
  );
const browser = await chromium.launch({
  executablePath: process.env.CM_CHROMIUM || "/usr/bin/chromium",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
const context = await browser.newContext({ offline: true });
const requests = [];
await context.route(/^https?:/, (r) => {
  requests.push(r.request().url());
  return r.abort();
});
let page = await context.newPage();
const report = {
  mode: "in-memory diagnostic, NOT file://",
  browser: browser.version(),
  windowsEdgeVerified: false,
  fileMode: null,
  externalRequests: requests,
  tests: [],
  htmlSHA256: createHash("sha256")
    .update(await fs.readFile(htmlPath))
    .digest("hex"),
};
page.on("console", (m) => {
  if (m.type() === "error") console.log("BROWSER", m.text().slice(0, 500));
});
try {
  try {
    await page.goto(pathToFileURL(htmlPath).href);
    report.fileMode = { passed: true };
    report.mode = "file:// Linux Chromium";
  } catch (e) {
    report.fileMode = { passed: false, error: e.message };
    if (!e.message.includes("ERR_BLOCKED_BY_ADMINISTRATOR")) throw e;
    await page.close();
    page = await context.newPage();
    await page.setContent(await fs.readFile(htmlPath, "utf8"), {
      timeout: 60000,
    });
  }
  await page.waitForFunction(() => !!window.CM);
  const files = await fs.readdir(path.join(root, "..")),
    sample = await fs.readFile(
      path.join(
        root,
        "..",
        files.find((x) => x.normalize("NFC") === "공소장1.pdf"),
      ),
    );
  const result = await page.evaluate(async (array) => {
    const pdf = await CM.PDFInputService.fromBytes(new Uint8Array(array)),
      p = await pdf.getPage(1);
    const c = await CM.renderOCR(p, { dpi: 180, maxPixels: 4000000 });
    const engine = new CM.PaddleOCRService((s) => console.log(s));
    const start = performance.now();
    try {
      const r = await engine.recognize(c.canvas, { timeout: 60000 });
      return { ...r, wallMs: performance.now() - start };
    } finally {
      await engine.close();
      await pdf.destroy();
    }
  }, Array.from(sample));
  const normalized = result.text.replace(/\s/g, "");
  for (const expected of [
    "검사이승엽",
    "죄명상해,폭행치상",
    "2025.8.22.",
    "피고인이민주",
    "841204",
    "구속여부구속",
    "변호인없음",
  ])
    assert.ok(normalized.includes(expected), expected);
  assert.ok(
    result.lines.every(
      (line) => line.words.length && line.bbox.x1 > line.bbox.x0,
    ),
  );
  report.tests.push({
    name: "actual detector+Korean recognizer in offline browser worker",
    result,
  });
  console.log(JSON.stringify(report.tests[0], null, 2));
  if (requests.length) throw Error("Unexpected external requests");
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = e.stack;
  console.log(e.stack);
  process.exitCode = 1;
} finally {
  await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, "artifacts/paddle-browser.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
