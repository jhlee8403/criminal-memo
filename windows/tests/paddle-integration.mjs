import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, ".."),
  html = await fs.readFile(
    path.join(
      root,
      "distribution-candidates/CriminalMemo-v2.2/CriminalMemo.html",
    ),
    "utf8",
  );
const browser = await chromium.launch({
  executablePath: process.env.CM_CHROMIUM || "/usr/bin/chromium",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({ offline: true, acceptDownloads: true }),
  requests = [];
await ctx.route(/^https?:/, (r) => {
  requests.push(r.request().url());
  return r.abort();
});
const page = await ctx.newPage(),
  report = {
    htmlSHA256: createHash("sha256").update(html).digest("hex"),
    mode: "offline in-memory, NOT Windows Edge file://",
    checks: [],
    externalRequests: requests,
  };
const files = await fs.readdir(path.join(root, ".."));
async function analyze(file, engine) {
  await page.locator("#file").setInputFiles(file);
  await page.waitForFunction(
    () => !document.querySelector("#analyze").disabled,
  );
  await page.locator("#ocrEngine").selectOption(engine);
  await page.locator("#analyze").click();
  await page.waitForFunction(
    () => !!CM.getDraft() && !document.querySelector("#analyze").disabled,
    {},
    { timeout: 180000 },
  );
}
async function choose(key, value) {
  const entry = await page.evaluate(
    ({ key, value }) => {
      const f = CM.getDraft().evidence.find((f) => f.key === key);
      const c = f?.candidates.find(
        (c) => JSON.stringify(c.value) === JSON.stringify(value),
      );
      return c ? { label: f.label, value: JSON.stringify(c.value) } : null;
    },
    { key, value },
  );
  assert.ok(entry, "missing candidate " + key);
  const card = page
    .locator("#evidence .evidence-card")
    .filter({ has: page.locator("strong", { hasText: entry.label }) });
  // Cards currently use h4 headings; match their text independent of semantic tag.
  const actualCard = (await card.count())
    ? card
    : page.locator("#evidence .evidence-card").filter({ hasText: entry.label });
  const row = actualCard
    .locator("div")
    .filter({ has: page.locator("span").filter({ hasText: entry.value }) })
    .first();
  await row.getByRole("button", { name: "이 후보 적용", exact: true }).click();
}
try {
  await page.setContent(html, { timeout: 60000 });
  await page.waitForFunction(() => !!window.CM);
  assert.equal(await page.locator("#ocrEngine").inputValue(), "tesseract");
  await analyze(path.join(root, "artifacts/scanned-sample.pdf"), "paddle");
  let draft = await page.evaluate(() => CM.getDraft());
  for (const [key, value] of [
    ["prosecutor", "이승엽"],
    ["filingDate", "2025-08-22"],
    ["person.0.name", "이민주"],
    ["person.0.charges", ["상해", "폭행치상"]],
    ["person.0.detention", "detained"],
    ["person.0.birthDigits", "841204"],
  ])
    await choose(key, value);
  await page
    .locator("#people label")
    .filter({ hasText: "변호인 기재 상태" })
    .locator("select")
    .selectOption("absentExplicit");
  await page
    .getByLabel("직접 확인한 전체 생년월일 YYYY-MM-DD", { exact: true })
    .fill("1984-12-04");
  await page.locator("#reviewed").check();
  await page.locator("#generate").click();
  await page.locator("#export").waitFor({ state: "visible", timeout: 60000 });
  let event = page.waitForEvent("download");
  await page.locator("#save").click();
  await (await event).saveAs(path.join(root, "artifacts/paddle-output1.pdf"));
  report.checks.push(
    "Paddle scan analysis, actual candidate buttons, manual full DOB and counsel confirmation, PDF download",
  );
  await analyze(
    path.join(
      root,
      "..",
      files.find((f) => f.normalize("NFC") === "공소장2.pdf"),
    ),
    "paddle",
  );
  draft = await page.evaluate(() => CM.getDraft());
  assert.deepEqual(
    draft.defendants.map((p) => p.name),
    ["김유나", "이영수"],
  );
  assert.equal(
    await page.evaluate(() => CM.counselText(CM.getDraft())),
    "윤상일(국선)",
  );
  await page.locator("#reviewed").check();
  await page.locator("#generate").click();
  await page.locator("#export").waitFor({ state: "visible", timeout: 60000 });
  event = page.waitForEvent("download");
  await page.locator("#save").click();
  await (await event).saveAs(path.join(root, "artifacts/paddle-output2.pdf"));
  report.checks.push(
    "Paddle two-page input, per-person charges and counsel, OX, one-page memo download",
  );
  await analyze(
    path.join(root, "artifacts/ocr-fixtures/wrong-selectable.pdf"),
    "compare",
  );
  const comparison = await page.evaluate(() => ({
    draft: CM.getDraft(),
    diag: CM.getAnalysis().diagnostics,
  }));
  assert.ok(comparison.diag.comparison);
  assert.ok(
    comparison.draft.evidence.find((f) => f.key === "prosecutor").conflict,
  );
  assert.equal(comparison.draft.prosecutor, "");
  assert.ok(
    comparison.diag.pages[0].wholeOCR.some((r) => r.engine === "paddle"),
  );
  report.checks.push(
    "Explicit two-engine sequential comparison retains source conflicts and requires a selection",
  );
  assert.deepEqual(requests, []);
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = e.stack;
  process.exitCode = 1;
  console.log(e.stack);
} finally {
  await fs.writeFile(
    path.join(root, "artifacts/paddle-integration.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
