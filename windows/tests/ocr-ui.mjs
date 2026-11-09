import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, ".."),
  browser = await chromium.launch({
    executablePath: process.env.CM_CHROMIUM || "/usr/bin/chromium",
    headless: true,
  });
const context = await browser.newContext({
    offline: true,
    viewport: { width: 1500, height: 1200 },
  }),
  requests = [];
await context.route(/^https?:/, (r) => {
  requests.push(r.request().url());
  return r.abort();
});
const page = await context.newPage();
const report = {
  mode: "memory diagnostic; NOT file://",
  checks: [],
  externalRequests: requests,
};
try {
  await page.setContent(
    await fs.readFile(
      path.join(
        root,
        "distribution-candidates/CriminalMemo-v2.2/CriminalMemo.html",
      ),
      "utf8",
    ),
  );
  await page.waitForFunction(() => !!CM);
  const select = async (p) => {
    await page.locator("#file").setInputFiles(p);
    await page.waitForFunction(
      () => !document.querySelector("#analyze").disabled,
    );
    await page.locator("#analyze").click();
    await page.waitForFunction(
      () => !!CM.getDraft() && !document.querySelector("#analyze").disabled,
      {},
      { timeout: 180000 },
    );
  };
  await select(path.join(root, "artifacts/ocr-fixtures/wrong-selectable.pdf"));
  const field = await page.evaluate(() =>
    CM.getDraft().evidence.find((f) => f.key === "prosecutor"),
  );
  assert.equal(field.conflict, true);
  assert.equal(field.finalValue, null);
  assert.ok(field.candidates.some((c) => c.value === "이승엽"));
  assert.ok(field.candidates.some((c) => c.value === "홍길동"));
  report.checks.push(
    "bad selectable text triggers OCR even with 20+ chars; conflict retained",
  );
  await page.locator("#reviewed").check();
  await page.locator("#generate").click();
  await page.waitForFunction(
    () => !document.querySelector("#generate").disabled,
  );
  assert.equal(await page.locator("#export").isVisible(), false);
  report.checks.push("unresolved conflict blocks PDF");
  const card = page.locator(".evidence-card").first();
  await card
    .getByRole("button", { name: "이 후보 적용" })
    .nth(field.candidates.findIndex((c) => c.value === "이승엽"))
    .click();
  assert.equal(await page.locator("#prosecutor").inputValue(), "이승엽");
  assert.equal(
    (await page.evaluate(() => CM.getDraft().evidence[0])).finalValue,
    "이승엽",
  );
  report.checks.push("user selects actual candidate via review button");
  await page.locator("#prosecutor").fill("사용자수정");
  assert.equal(
    (await page.evaluate(() => CM.getDraft().evidence[0])).manualValue,
    "사용자수정",
  );
  report.checks.push("manual correction recorded separately");
  await page.locator("#diagnosticStage").selectOption("whole");
  await page.waitForFunction(() =>
    document.querySelector("#diagnosticText").textContent.includes("이승엽"),
  );
  report.checks.push("whole OCR and embedded text independently inspectable");
  if (process.env.CM_REGION_ENGINE)
    await page
      .locator("#regionEngine")
      .selectOption(process.env.CM_REGION_ENGINE);
  await page.locator("#regionMode").check();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("#canvasHost").scrollTop = 0;
  });
  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector("#canvasHost canvas"),
      r = canvas.getBoundingClientRect(),
      region = CM.getAnalysis()
        .diagnostics.fields.find((f) => f.key === "prosecutor")
        .candidates.find((c) => c.source === "ocr" && c.box)?.box;
    return {
      r: { x: r.x, y: r.y, w: r.width, h: r.height },
      box: region,
      page: CM.getAnalysis().pages[0],
    };
  });
  const { r, box, pag } = geometry;
  const width = geometry.page.width,
    height = geometry.page.height;
  const x = r.x + (box[0] / width) * r.w,
    y = r.y + (box[1] / height) * r.h,
    w = (box[2] / width) * r.w,
    h = (box[3] / height) * r.h;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + w, y + h, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    () => !document.querySelector("#rerunRegion").disabled,
  );
  await page.locator("#rerunRegion").click();
  await page.waitForFunction(
    () => !document.querySelector("#rerunRegion").disabled,
    {},
    { timeout: 60000 },
  );
  const records = await page.evaluate(
    () => CM.getAnalysis().diagnostics.pages[0].precision,
  );
  assert.ok(records.some((r) => r.method === "original" && r.anchor === ""));
  assert.ok(
    records.some((r) => r.anchor === "" && r.values.includes("이승엽")),
  );
  report.checks.push("mouse-drag ROI recognition runs independently");
  const skew = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 1000;
    const x = c.getContext("2d");
    x.fillStyle = "white";
    x.fillRect(0, 0, 800, 1000);
    x.translate(400, 500);
    x.rotate((2 * Math.PI) / 180);
    x.fillStyle = "black";
    x.font = "20px Arial";
    for (let i = 0; i < 20; i++)
      x.fillText(
        "Criminal memo prosecutor and charges horizontal text",
        -350,
        -400 + i * 38,
      );
    const r = CM.preprocess(c, "deskew-denoise");
    return r.angle;
  });
  assert.ok(Math.abs(skew + 2) <= 1);
  report.checks.push("synthetic skew correction chooses compensating angle");
  const cap = await page.evaluate(async () => {
    const doc = await CM.PDFInputService.open(
      document.querySelector("#file").files[0],
    );
    try {
      const a = await CM.analyze(doc, { limits: { maxAttempts: 0 } });
      return {
        attempts: a.diagnostics.attempts,
        pending: a.draft.evidence.filter((f) => f.required && f.needsReview)
          .length,
      };
    } finally {
      await doc.destroy();
    }
  });
  assert.equal(cap.attempts, 0);
  assert.ok(cap.pending > 0);
  report.checks.push(
    "retry budget exhaustion stops jobs and preserves review requirements",
  );
  assert.deepEqual(requests, []);
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = e.stack;
  throw e;
} finally {
  await fs.writeFile(
    path.join(
      root,
      `artifacts/ocr-${process.env.CM_REGION_ENGINE ?? "tesseract"}-ui-report.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(report);
}
