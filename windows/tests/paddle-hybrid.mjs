import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { scoreHybrid } from "./ocr-scoring.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  cases = JSON.parse(
    await fs.readFile(
      path.join(root, "artifacts/ocr-fixtures/manifest.json"),
      "utf8",
    ),
  );
const report = {
  mode: "offline in-memory Linux Chromium hybrid comparison; NOT Windows Edge file://",
  cases: [],
  externalRequests: [],
  htmlHashes: {},
  completed: false,
};
for (const engine of ["tesseract", "paddle"]) {
  const file =
      engine === "tesseract"
        ? "distribution/CriminalMemo/CriminalMemo.html"
        : "distribution-candidates/CriminalMemo-v2.2/CriminalMemo.html",
    html = await fs.readFile(path.join(root, file), "utf8");
  report.htmlHashes[engine] = createHash("sha256").update(html).digest("hex");
  const browser = await chromium.launch({
    executablePath: process.env.CM_CHROMIUM || "/usr/bin/chromium",
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const cdp = await browser.newBrowserCDPSession();
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
      await page.locator("#file").setInputFiles(c.path);
      await page.waitForFunction(
        () => !document.querySelector("#analyze").disabled,
      );
      const pids = (
        await cdp.send("SystemInfo.getProcessInfo")
      ).processInfo.map((p) => p.id);
      let peak = 0;
      const sample = () => {
        let n = 0;
        for (const pid of pids)
          try {
            n +=
              Number(
                readFileSync(`/proc/${pid}/status`, "utf8").match(
                  /^VmRSS:\s+(\d+)/m,
                )?.[1] ?? 0,
              ) * 1024;
          } catch {}
        peak = Math.max(peak, n);
      };
      sample();
      const timer = setInterval(sample, 100);
      try {
        const value = await page.evaluate(async (engine) => {
          const pdf = await CM.PDFInputService.open(
            document.querySelector("#file").files[0],
          );
          try {
            const result = await CM.analyze(pdf, {
              engine,
              verifyCritical: true,
            });
            return {
              draft: result.draft,
              elapsedMs: result.diagnostics.elapsedMs,
              attempts: result.diagnostics.attempts,
              errors: result.diagnostics.pages.flatMap((p) =>
                [...p.wholeOCR, ...p.precision]
                  .filter((r) => r.error)
                  .map((r) => r.error),
              ),
              incomplete: result.draft.incompleteAnalysis,
            };
          } finally {
            await pdf.destroy();
          }
        }, engine);
        sample();
        const fields = scoreHybrid(value.draft, c.expected);
        report.cases.push({
          engine,
          name: c.name,
          kind: c.kind,
          fields,
          elapsedMs: value.elapsedMs,
          attempts: value.attempts,
          errors: value.errors,
          sampledPeakBrowserRSS: peak,
          incomplete: value.incomplete,
        });
        console.log(
          engine,
          c.name,
          Math.round(value.elapsedMs) + "ms",
          fields.filter((f) => f.classification === "autoCorrect").length +
            " auto correct, " +
            fields.filter((f) => f.classification === "candidateIncluded")
              .length +
            " candidate",
        );
      } finally {
        clearInterval(timer);
        await ctx.close();
        await fs.writeFile(
          path.join(root, "artifacts/paddle-hybrid.json"),
          JSON.stringify(report, null, 2),
        );
      }
    }
  } finally {
    await browser.close();
  }
}
if (report.externalRequests.length) throw Error("Unexpected external request");
report.completed = true;
await fs.writeFile(
  path.join(root, "artifacts/paddle-hybrid.json"),
  JSON.stringify(report, null, 2),
);
