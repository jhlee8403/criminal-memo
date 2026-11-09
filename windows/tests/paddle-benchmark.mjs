import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, ".."),
  cases = JSON.parse(
    await fs.readFile(
      path.join(root, "artifacts/ocr-fixtures/manifest.json"),
      "utf8",
    ),
  );
const html = await fs.readFile(
  path.join(
    root,
    "distribution-candidates/CriminalMemo-v2.2/CriminalMemo.html",
  ),
  "utf8",
);
const report = {
  version: "2.2",
  htmlSHA256: createHash("sha256").update(html).digest("hex"),
  mode: "offline in-memory Linux Chromium, NOT file:// or Windows Edge",
  models: {
    det: "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae",
    rec: "322f140154c820fcb83c3d24cfe42c9ec70dd1a1834163306a7338136e4f1eaa",
  },
  cases: [],
  preprocessing: [],
  externalRequests: [],
  limitations: [
    "Two repository examples plus synthetic derivatives; NOT production accuracy.",
    "Same 300DPI bounded source render, original preprocessing, one full-page pass per engine; same parser. Model detector internally resizes to max1280. One run, initialization included, engines sequential.",
    "autoCorrect/autoWrong refer to unreviewed OCR+parser proposals in this controlled track, NOT confirmed application values. Missing values count independently of confidence.",
    "Peak RSS is sampled every100ms over CDP-listed browser processes; shared pages are counted repeatedly, true instantaneous/private peak is not measured.",
  ],
};
function evaluateFields(d, expected) {
  const fields = [];
  for (const name of ["prosecutor", "filingDate"])
    fields.push({
      field: name,
      expected: expected[name],
      actual: d[name] ?? "",
    });
  expected.names.forEach((name, i) => {
    const p = d.defendants[i];
    for (const field of [
      "name",
      "charges",
      "counsel",
      "birthDigits",
      "detention",
    ])
      fields.push({
        field,
        index: i,
        expected: field === "name" ? name : expected[field][i],
        actual:
          field === "counsel"
            ? p
              ? (p.counsel.name ?? "")
              : null
            : (p?.[field] ?? null),
      });
  });
  const compact = (v) => JSON.stringify(v)?.replace(/\s/g, "");
  return fields.map((f) => {
    const absent =
      f.actual == null ||
      f.actual === "" ||
      f.actual === "unknown" ||
      (Array.isArray(f.actual) && !f.actual.length);
    const correct = compact(f.actual) === compact(f.expected);
    return {
      ...f,
      classification: correct
        ? "autoCorrect"
        : absent
          ? "unrecognized"
          : "autoWrong",
      requiresUserReview: true,
    };
  });
}
for (const engine of ["tesseract", "paddle"]) {
  const browser = await chromium.launch({
    executablePath: process.env.CM_CHROMIUM || "/usr/bin/chromium",
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const cdp = await browser.newBrowserCDPSession();
  report.browser = browser.version();
  try {
    for (const c of cases) {
      const ctx = await browser.newContext({ offline: true });
      await ctx.route(/^https?:/, (r) => {
        report.externalRequests.push(r.request().url());
        return r.abort();
      });
      const page = await ctx.newPage();
      await page.setContent(html, { timeout: 60000 });
      await page.waitForFunction(() => !!window.CM);
      const pids = (
        await cdp.send("SystemInfo.getProcessInfo")
      ).processInfo.map((p) => p.id);
      let peakRSS = 0,
        samples = 0;
      const sample = () => {
        let rss = 0;
        for (const pid of pids)
          try {
            rss +=
              Number(
                readFileSync(`/proc/${pid}/status`, "utf8").match(
                  /^VmRSS:\s+(\d+)/m,
                )?.[1] ?? 0,
              ) * 1024;
          } catch {}
        peakRSS = Math.max(peakRSS, rss);
        samples++;
      };
      sample();
      const timer = setInterval(sample, 100);
      try {
        const bytes = await fs.readFile(c.path);
        const value = await page.evaluate(
          async ({ base64, engine }) => {
            const pdf = await CM.PDFInputService.fromBytes(CM.bytes(base64)),
              pages = [],
              ocr = CM.createOCREngine(engine),
              start = performance.now();
            let attempts = 0;
            const errors = [];
            try {
              for (let n = 1; n <= pdf.numPages; n++) {
                const p = await pdf.getPage(n),
                  render = await CM.renderOCR(p, {
                    dpi: 300,
                    maxPixels: 9000000,
                  });
                try {
                  attempts++;
                  const r = await ocr.recognize(render.canvas, {
                    psm: 3,
                    timeout: 60000,
                  });
                  pages.push({
                    text: r.text,
                    lines: CM.normalizeOCRLines(r, render.plan.scale),
                    width: p.getViewport({ scale: 1 }).width,
                    height: p.getViewport({ scale: 1 }).height,
                    ocr: true,
                  });
                } catch (e) {
                  errors.push(e.message);
                  pages.push({ text: "", lines: [], width: 595, height: 842 });
                } finally {
                  render.canvas.width = render.canvas.height = 1;
                }
              }
              const d = CM.IndictmentParser.parse({
                pages,
                text: pages.map((p) => p.text).join("\n"),
                usedOCR: true,
              });
              return {
                draft: d,
                elapsedMs: performance.now() - start,
                attempts,
                errors,
                heapAfter: performance.memory?.usedJSHeapSize ?? null,
              };
            } finally {
              await ocr.close();
              await pdf.destroy();
            }
          },
          { base64: bytes.toString("base64"), engine },
        );
        sample();
        const fields = evaluateFields(value.draft, c.expected);
        report.cases.push({
          engine,
          name: c.name,
          kind: c.kind,
          fields,
          elapsedMs: value.elapsedMs,
          attempts: value.attempts,
          errors: value.errors,
          sampledPeakBrowserRSS: peakRSS,
          memorySamples: samples,
          heapAfter: value.heapAfter,
          unmatchedDefendants: Math.max(
            0,
            value.draft.defendants.length - c.expected.names.length,
          ),
        });
        console.log(
          engine,
          c.name,
          Math.round(value.elapsedMs) + "ms",
          fields.filter((f) => f.classification === "autoCorrect").length +
            "/" +
            fields.length,
        );
      } finally {
        clearInterval(timer);
        await ctx.close();
        await fs.writeFile(
          path.join(root, "artifacts/paddle-benchmark.json"),
          JSON.stringify(report, null, 2),
        );
      }
    }
  } finally {
    await browser.close();
  }
}
// Annotated manual ROIs are test ground truth, not fixed runtime coordinates.
const browser = await chromium.launch({
  executablePath: process.env.CM_CHROMIUM || "/usr/bin/chromium",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
try {
  const ctx = await browser.newContext({ offline: true });
  await ctx.route(/^https?:/, (r) => {
    report.externalRequests.push(r.request().url());
    return r.abort();
  });
  const page = await ctx.newPage();
  await page.setContent(html, { timeout: 60000 });
  await page.waitForFunction(() => !!window.CM);
  for (const c of cases.filter((c) => c.preprocessingRegions))
    for (const engine of ["tesseract", "paddle"]) {
      const data = await page.evaluate(
        async ({ base64, regions, engine }) => {
          const pdf = await CM.PDFInputService.fromBytes(CM.bytes(base64)),
            ocr = CM.createOCREngine(engine),
            rows = [];
          try {
            for (const r of regions) {
              const results = await CM.recognizeRegion(
                await pdf.getPage(r.page),
                r,
                ocr,
                {
                  psm: 7,
                  methods: [
                    "original",
                    "grayscale",
                    "contrast",
                    "adaptive",
                    "deskew-denoise",
                  ],
                },
              );
              rows.push(
                ...results.map((v) => ({
                  field: v.field,
                  method: v.method,
                  text: v.text,
                  values: v.values,
                  confidence: v.confidence,
                  elapsedMs: v.elapsedMs,
                  error: v.error,
                })),
              );
            }
            return rows;
          } finally {
            await ocr.close();
            await pdf.destroy();
          }
        },
        {
          base64: (await fs.readFile(c.path)).toString("base64"),
          regions: c.preprocessingRegions,
          engine,
        },
      );
      report.preprocessing.push({ name: c.name, engine, results: data });
      console.log("ROI", engine, c.name, data.length);
    }
} finally {
  await browser.close();
}
if (report.externalRequests.length) throw Error("Unexpected external requests");
report.completed = true;
await fs.writeFile(
  path.join(root, "artifacts/paddle-benchmark.json"),
  JSON.stringify(report, null, 2),
);
