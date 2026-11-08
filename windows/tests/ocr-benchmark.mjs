import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "artifacts"),
  cases = JSON.parse(
    await fs.readFile(path.join(out, "ocr-fixtures/manifest.json"), "utf8"),
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
try {
  await fs.access(path.join(out, "v20-baseline.html"));
} catch {
  await fs.writeFile(
    path.join(out, "v20-baseline.html"),
    execFileSync(
      "git",
      ["show", "f8e4c27:windows/distribution/CriminalMemo/CriminalMemo.html"],
      { cwd: root, maxBuffer: 32 * 1024 * 1024 },
    ),
  );
}
const report = {
  mode: "in-memory HTML diagnostic; NOT Windows Edge file://",
  browser: browser.version(),
  platform: process.platform,
  windowsEdgeVerified: false,
  offline: true,
  externalRequests: requests,
  cases: [],
  preprocessing: [],
  limitations: [
    "Synthetic public-repository fixtures, not independent production documents",
    "Heap API is approximate; renderer RSS is an after-completion Linux snapshot (OCR workers already terminated), not peak total memory; image memory is an allocation estimate",
    "Timing includes OCR worker initialization per document; no statistical claim from single runs",
  ],
};
const cdp = await browser.newBrowserCDPSession();
async function rssSnapshot() {
  try {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    let bytes = 0;
    for (const p of processInfo.filter((p) => p.type === "renderer")) {
      try {
        const status = await fs.readFile(`/proc/${p.id}/status`, "utf8");
        bytes += Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
      } catch {}
    }
    return bytes;
  } catch {
    return null;
  }
}
const compact = (v) => JSON.stringify(v)?.replace(/\s/g, "");
function score(result, expected) {
  const d = result.draft ?? { defendants: [] };
  const prosecutor = d.prosecutor === expected.prosecutor;
  const charges = expected.charges.map(
    (v, i) => compact(d.defendants[i]?.charges) === compact(v),
  );
  return {
    prosecutorCorrect: prosecutor,
    prosecutorWrong: !!d.prosecutor && !prosecutor,
    chargesCorrect: charges.filter(Boolean).length,
    chargeFields: charges.length,
    chargesWrong: charges.filter(
      (v, i) => !v && d.defendants[i]?.charges?.length,
    ).length,
    prosecutorCandidateCorrect: d.evidence
      ? (d.evidence.find((f) => f.key === "prosecutor")?.candidates ?? []).some(
          (c) => c.value === expected.prosecutor,
        )
      : prosecutor,
    chargeCandidateCorrect: !d.evidence
      ? charges.filter(Boolean).length
      : expected.charges
          .map((v, i) =>
            (
              d.evidence?.find((f) => f.key === `person.${i}.charges`)
                ?.candidates ?? []
            ).some((c) => compact(c.value) === compact(v)),
          )
          .filter(Boolean).length,
  };
}
try {
  for (const version of ["before", "after"]) {
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", version, e.message));
    const html = await fs.readFile(
      version === "before"
        ? path.join(out, "v20-baseline.html")
        : path.join(root, "distribution/CriminalMemo/CriminalMemo.html"),
      "utf8",
    );
    if (version === "after")
      report.htmlSHA256 = createHash("sha256").update(html).digest("hex");
    await page.setContent(html);
    await page.waitForFunction(() => !!window.CM);
    for (const c of cases) {
      console.log("START", version, c.name);
      await page.locator("#file").setInputFiles(c.path);
      await page.waitForFunction(
        () => !document.querySelector("#analyze").disabled,
      );
      const result = await page.evaluate(async () => {
        const start = performance.now(),
          pdf = await CM.PDFInputService.open(
            document.querySelector("#file").files[0],
          );
        try {
          const a = await CM.analyze(pdf, { verifyCritical: true });
          const d = a.draft ?? CM.IndictmentParser.parse(a);
          return {
            draft: d,
            elapsedMs: performance.now() - start,
            attempts:
              a.diagnostics?.attempts ?? a.pages.filter((p) => p.ocr).length,
            wholeOCR:
              a.diagnostics?.pages.flatMap((p) =>
                p.wholeOCR.map((r) => ({
                  page: p.page,
                  method: r.method,
                  confidence: r.confidence,
                  psm: r.psm,
                  elapsedMs: r.elapsedMs,
                })),
              ) ?? [],
            precision:
              a.diagnostics?.pages.flatMap((p) =>
                p.precision.map((r) => ({
                  key: r.key,
                  values: r.values,
                  confidence: r.confidence,
                  method: r.method,
                  psm: r.psm,
                  language: r.language,
                  elapsedMs: r.elapsedMs,
                  error: r.error,
                })),
              ) ?? [],
            quality: a.diagnostics?.pages.map((p) => p.quality) ?? [],
            limits: a.diagnostics?.limitReasons ?? [],
            heapBefore: a.diagnostics?.heapBefore ?? null,
            heapAfter:
              a.diagnostics?.heapAfter ??
              performance.memory?.usedJSHeapSize ??
              null,
            imageMemoryEstimate: a.diagnostics?.estimatedImagePeakBytes ?? null,
          };
        } catch (e) {
          return { error: e.message, elapsedMs: performance.now() - start };
        } finally {
          await pdf.destroy();
        }
      });
      result.rendererRSSAfterBytes = await rssSnapshot();
      const row = {
        version,
        name: c.name,
        kind: c.kind,
        expected: c.expected,
        ...result,
        score: score(result, c.expected),
      };
      report.cases.push(row);
      console.log(
        "RESULT",
        version,
        c.name,
        JSON.stringify(row.score),
        Math.round(result.elapsedMs),
        "ms",
      );
    }
    await page.close();
  }
  // Same annotated crop across methods: compare, do not assume preprocessing is beneficial.
  const page = await context.newPage();
  await page.setContent(
    await fs.readFile(
      path.join(root, "distribution/CriminalMemo/CriminalMemo.html"),
      "utf8",
    ),
  );
  await page.waitForFunction(() => !!CM);
  for (const c of cases.filter((c) => c.preprocessingRegions)) {
    await page.locator("#file").setInputFiles(c.path);
    await page.waitForFunction(
      () => !document.querySelector("#analyze").disabled,
    );
    const rows = await page.evaluate(async (regions) => {
      const pdf = await CM.PDFInputService.open(
          document.querySelector("#file").files[0],
        ),
        page = await pdf.getPage(1),
        ocr = new CM.OCRService(),
        rows = [];
      try {
        for (const region of regions) {
          const psm = region.field === "prosecutor" ? 7 : 6;
          for (const method of [
            "original",
            "grayscale",
            "contrast",
            "adaptive",
            "deskew-denoise",
          ])
            rows.push(
              ...(await CM.recognizeRegion(page, region, ocr, {
                psm,
                methods: [method],
              })),
            );
          for (const mode of [3, 11])
            rows.push(
              ...(await CM.recognizeRegion(page, region, ocr, {
                psm: mode,
                methods: ["original"],
              })),
            );
          rows.push(
            ...(await CM.recognizeRegion(page, region, ocr, {
              psm,
              language: "kor",
              methods: ["original"],
            })),
          );
        }
      } finally {
        await ocr.close();
        await pdf.destroy();
      }
      return rows.map((r) => ({
        field: r.field,
        method: r.method,
        psm: r.psm,
        language: r.language,
        values: r.values,
        confidence: r.confidence,
        elapsedMs: r.elapsedMs,
        angle: r.angle,
        effectiveDPI: r.effectiveDPI,
        estimatedPeakBytes: r.estimatedPeakBytes,
        error: r.error,
      }));
    }, c.preprocessingRegions);
    report.preprocessing.push(...rows.map((r) => ({ ...r, case: c.name })));
  }
  await page.close();
  report.summary = {};
  for (const version of ["before", "after"]) {
    const rows = report.cases.filter((c) => c.version === version);
    report.summary[version] = {
      documents: rows.length,
      prosecutorCorrect: rows.filter((r) => r.score.prosecutorCorrect).length,
      prosecutorWrong: rows.filter((r) => r.score.prosecutorWrong).length,
      prosecutorCandidateCorrect: rows.filter(
        (r) => r.score.prosecutorCandidateCorrect,
      ).length,
      chargeFields: rows.reduce((n, r) => n + r.score.chargeFields, 0),
      chargesCorrect: rows.reduce((n, r) => n + r.score.chargesCorrect, 0),
      chargesWrong: rows.reduce((n, r) => n + r.score.chargesWrong, 0),
      chargeCandidateCorrect: rows.reduce(
        (n, r) => n + r.score.chargeCandidateCorrect,
        0,
      ),
      elapsedMs: rows.reduce((n, r) => n + r.elapsedMs, 0),
      attempts: rows.reduce((n, r) => n + (r.attempts ?? 0), 0),
    };
  }
} finally {
  await fs.writeFile(
    path.join(out, "ocr-benchmark.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log("SUMMARY", JSON.stringify(report.summary));
}
