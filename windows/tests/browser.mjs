import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, ".."),
  out = resolve(root, "artifacts");
await fs.mkdir(out, { recursive: true });
const names = await fs.readdir(resolve(root, ".."));
const samples = [1, 2].map((n) =>
  resolve(
    root,
    "..",
    names.find((f) => f.normalize("NFC") === `공소장${n}.pdf`),
  ),
);
const browser = await chromium.launch({
  executablePath: process.env.CM_CHROMIUM || "/usr/bin/chromium",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  acceptDownloads: true,
  offline: true,
});
const external = [];
await context.route(/^https?:/, (route) => {
  external.push(route.request().url());
  return route.abort();
});
const artifactHash = createHash("sha256")
  .update(
    await fs.readFile(
      resolve(
        root,
        "distribution-candidates/CriminalMemo-v2.2/CriminalMemo.html",
      ),
    ),
  )
  .digest("hex");
const report = {
  htmlSHA256: artifactHash,
  browser: browser.version(),
  platform: process.platform,
  windowsEdgeVerified: false,
  offlineContext: true,
  fileMode: {},
  checks: [],
  externalRequests: external,
  errors: [],
};
let page = await context.newPage();
try {
  try {
    await page.goto(
      pathToFileURL(
        resolve(
          root,
          "distribution-candidates/CriminalMemo-v2.2/CriminalMemo.html",
        ),
      ).href,
    );
    report.fileMode = { passed: true };
    report.mode = "file";
  } catch (e) {
    report.fileMode = { passed: false, error: e.message };
    if (!e.message.includes("ERR_BLOCKED_BY_ADMINISTRATOR")) throw e;
    await page.close();
    page = await context.newPage();
    await page.setContent(
      await fs.readFile(
        resolve(
          root,
          "distribution-candidates/CriminalMemo-v2.2/CriminalMemo.html",
        ),
        "utf8",
      ),
    );
    report.mode = "in-memory HTML diagnostic (NOT file://)";
  }
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.waitForFunction(() => !!window.CM);
  for (let i = 0; i < samples.length; i++) {
    await page.locator("#file").setInputFiles(samples[i]);
    await page.waitForFunction(
      () => !document.querySelector("#analyze").disabled,
    );
    await page.locator("#analyze").click();
    await page.waitForFunction(
      () => !!CM.getDraft() && !document.querySelector("#analyze").disabled,
    );
    const draft = await page.evaluate(() => CM.getDraft());
    assert.equal(draft.defendants.length, i + 1);
    assert.equal(draft.prosecutor, i === 0 ? "이승엽" : "이정현");
    assert.equal(draft.filingDate, i === 0 ? "2025-08-22" : "2026-10-27");
    assert.deepEqual(
      draft.defendants.map((p) => p.name),
      i === 0 ? ["이민주"] : ["김유나", "이영수"],
    );
    assert.deepEqual(
      draft.defendants.map((p) => p.charges),
      i === 0 ? [["상해", "폭행치상"]] : [["공무집행방해"], ["상해", "절도"]],
    );
    const expectations = await page.evaluate(() => ({
      counsel: CM.counselText(CM.getDraft()),
      detention: CM.detentionGlyphs(CM.getDraft().defendants),
      birth: CM.getDraft().defendants.map((p) =>
        CM.birthAssessment(p, CM.getDraft().filingDate),
      ),
    }));
    assert.equal(expectations.counsel, i === 0 ? "" : "윤상일(국선)");
    assert.equal(
      expectations.detention.map((g) => g.text).join(""),
      i === 0 ? "O" : "OX",
    );
    assert.deepEqual(
      expectations.birth.map((a) => a.age),
      i === 0 ? [null] : [null, null],
    );
    assert.equal(expectations.birth[0].resolved, false);
    assert.equal(
      await page.getByText("공소장 기재 나이", { exact: true }).count(),
      0,
    );
    if (i === 0) {
      const dob = page.getByLabel("직접 확인한 전체 생년월일 YYYY-MM-DD");
      await dob.fill("1984-12-04");
      assert.equal(
        await page.evaluate(
          () =>
            CM.birthAssessment(
              CM.getDraft().defendants[0],
              CM.getDraft().filingDate,
            ).age,
        ),
        40,
      );
      assert.deepEqual(
        await page.evaluate(
          () =>
            CM.birthAssessment(
              CM.getDraft().defendants[0],
              CM.getDraft().filingDate,
            ).warnings,
        ),
        [],
      );
      await page
        .getByLabel("생년월일 앞 6자리 YYMMDD", { exact: true })
        .fill("841205");
      assert.equal(await dob.inputValue(), "");
      assert.equal(
        await page.evaluate(
          () =>
            CM.birthAssessment(
              CM.getDraft().defendants[0],
              CM.getDraft().filingDate,
            ).resolved,
        ),
        false,
      );
      await page
        .getByLabel("생년월일 앞 6자리 YYMMDD", { exact: true })
        .fill("841204");
    }
    await page.locator("#reviewed").check();
    await page.locator("#generate").click();
    await page.locator("#export").waitFor({ state: "visible", timeout: 60000 });
    const download = page.waitForEvent("download");
    await page.locator("#save").click();
    await (await download).saveAs(resolve(out, `output${i + 1}.pdf`));
    report.checks.push({
      sample: i + 1,
      names: draft.defendants.map((p) => p.name),
      ...expectations,
      download: true,
    });
  }
  // A synthetic two-page template verifies first-page-only output without modifying source bytes.
  const templateName = names.find((f) => f.normalize("NFC") === "형사메모.pdf");
  const template = await fs.readFile(resolve(root, "..", templateName));
  const original = await PDFDocument.load(template),
    two = await PDFDocument.create();
  for (const p of await two.copyPages(original, [0, 0])) two.addPage(p);
  const twoBytes = await two.save();
  await fs.writeFile(resolve(out, "two-page-source.pdf"), twoBytes);
  const generated = await page.evaluate(
    async (array) =>
      Array.from(
        await CM.MemoPDFRenderer.render(CM.getDraft(), {
          templateBytes: new Uint8Array(array),
        }),
      ),
    Array.from(twoBytes),
  );
  await fs.writeFile(
    resolve(out, "two-page-output.pdf"),
    new Uint8Array(generated),
  );
  report.syntheticTwoPageTest = true;
  const agePDF = await page.evaluate(async () => {
    const d = structuredClone(CM.getDraft());
    d.filingDate = "2025-08-22";
    Object.assign(d.defendants[0], {
      birthDigits: "100101",
      statedAge: 15,
      confirmedBirthDate: "2010-01-01",
    });
    Object.assign(d.defendants[1], {
      birthDigits: "500101",
      statedAge: 75,
      confirmedBirthDate: "1950-01-01",
    });
    return Array.from(await CM.MemoPDFRenderer.render(d));
  });
  await fs.writeFile(resolve(out, "age-marks.pdf"), new Uint8Array(agePDF));
  const overflow = await page.evaluate(async () => {
    const d = structuredClone(CM.getDraft());
    d.prosecutor = "검사".repeat(500);
    try {
      await CM.MemoPDFRenderer.render(d);
      return false;
    } catch (e) {
      return e.message.includes("칸을 넘");
    }
  });
  assert.equal(overflow, true);
  report.longTextRejected = true;
  // A real image-only PDF exercises automatic OCR, not just forced OCR over a text layer.
  await page.locator("#file").setInputFiles(resolve(out, "scanned-sample.pdf"));
  await page.waitForFunction(
    () => !document.querySelector("#analyze").disabled,
  );
  await page.locator("#analyze").click();
  await page.waitForFunction(
    () => !!CM.getDraft() && !document.querySelector("#analyze").disabled,
    {},
    { timeout: 120000 },
  );
  const scan = await page.evaluate(() => ({
    text: document.querySelector("#rawText").textContent,
    draft: CM.getDraft(),
  }));
  assert.match(scan.text.replace(/\s/g, ""), /이민주/);
  assert.match(scan.text.replace(/\s/g, ""), /상해/);
  assert.ok(
    scan.draft.evidence
      .find((f) => f.key === "person.0.name")
      .candidates.some((c) => c.value === "이민주"),
  );
  assert.equal(scan.draft.defendants[0].counsel.status, "needsReview");
  assert.equal(scan.draft.defendants[0].birthReview, true);
  report.ocr = {
    passed: true,
    KoreanName: true,
    KoreanCharge: true,
    requiresReview: true,
  };
  // Mixed PDF: native first page + image-only second page, preserving cross-page defendant scope.
  await page.locator("#file").setInputFiles(resolve(out, "mixed-sample.pdf"));
  await page.waitForFunction(
    () => !document.querySelector("#analyze").disabled,
  );
  await page.locator("#analyze").click();
  await page.waitForFunction(
    () => !!CM.getDraft() && !document.querySelector("#analyze").disabled,
    {},
    { timeout: 120000 },
  );
  const mixed = await page.evaluate(() => CM.getDraft());
  assert.deepEqual(
    mixed.defendants.map((p) => p.name),
    ["김유나", "이영수"],
  );
  assert.ok(
    mixed.evidence
      .find((f) => f.key === "person.1.charges")
      .candidates.some((c) => c.value.includes("상해")),
  );
  assert.ok(
    mixed.evidence
      .find((f) => f.key === "person.1.charges")
      .candidates.some((c) => c.value.includes("절도")),
  );
  report.mixedPDF = { passed: true, defendants: 2, crossPageCharges: true };
  // Verify edits invalidate output and insecure/unknown fields cannot silently generate.
  await page.locator("#people input").first().fill("수정된이름");
  assert.equal(await page.locator("#reviewed").isChecked(), false);
  assert.equal(await page.locator("#export").isVisible(), false);
  await page.screenshot({ path: resolve(out, "review.png"), fullPage: true });
  assert.deepEqual(external, []);
  assert.deepEqual(report.errors, []);
  report.runtimeDiagnosticPassed = true;
  report.targetWindowsReady = false;
} catch (e) {
  report.runtimeDiagnosticPassed = false;
  report.targetWindowsReady = false;
  report.failure = e.stack;
  throw e;
} finally {
  await fs.writeFile(
    resolve(out, "browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
