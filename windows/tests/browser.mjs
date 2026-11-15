import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
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
      resolve(root, "distribution/CriminalMemo/CriminalMemo.html"),
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
        resolve(root, "distribution/CriminalMemo/CriminalMemo.html"),
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
        resolve(root, "distribution/CriminalMemo/CriminalMemo.html"),
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
    assert.equal(await page.locator("#people input").count(), 0);
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
  // Synthetic format fixture, not a real latest indictment.
  const syntheticText = await fs.readFile(
    resolve(root, "tests/fixtures/layout-variants.txt"),
    "utf8",
  );
  const syntheticPDF = await page.evaluate(async (text) => {
    const draft = CM.IndictmentParser.parse({
      text,
      usedOCR: false,
      pages: [
        {
          text,
          height: 842,
          lines: text.split("\n").map((text, i) => ({ text, y: i * 12 })),
        },
      ],
    });
    return Array.from(await CM.MemoPDFRenderer.render(draft));
  }, syntheticText);
  assert.equal(
    (await PDFDocument.load(new Uint8Array(syntheticPDF))).getPageCount(),
    1,
  );
  await fs.writeFile(
    resolve(out, "synthetic-layout-output.pdf"),
    new Uint8Array(syntheticPDF),
  );
  report.syntheticLayoutOnePage = true;
  // A synthetic two-page template proves all pages survive; it is not a replacement for the actual one-page original.
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
      confirmedYear: "2010",
    });
    Object.assign(d.defendants[1], {
      birthDigits: "500101",
      statedAge: 75,
      confirmedYear: "1950",
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
  assert.equal(scan.draft.defendants[0].name, "이민주");
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
  assert.ok(mixed.defendants[1].charges.some((c) => c.includes("상해")));
  assert.ok(mixed.defendants[1].charges.some((c) => c.includes("절도")));
  report.mixedPDF = { passed: true, defendants: 2, crossPageCharges: true };
  // Auto-only: OCR uncertainty blocks output; there is no manual input/review bypass.
  assert.equal(await page.locator("#export").isVisible(), false);
  assert.equal(
    await page
      .locator("#reviewed, #generate, #addPerson, #people input")
      .count(),
    0,
  );
  // Recreate the reported structure as a fictional, paginated text PDF and
  // exercise the same File API -> extraction -> automatic memo flow as the UI.
  const v13Text = await fs.readFile(
    resolve(root, "tests/fixtures/latest-structure-v13.txt"),
    "utf8",
  );
  const v13Input = await PDFDocument.create();
  v13Input.registerFontkit(fontkit);
  const v13Font = await v13Input.embedFont(
    await fs.readFile(resolve(root, "vendor/NanumGothic-Regular.ttf")),
  );
  let inputPage = v13Input.addPage([595, 842]),
    y = 810;
  for (const line of v13Text.trim().split("\n")) {
    inputPage.drawText(line, { x: 20, y, size: 8, font: v13Font });
    y -= 15;
    if (line === "- 1 -" || line === "2 / 3") {
      inputPage = v13Input.addPage([595, 842]);
      y = 810;
    }
  }
  const inputPath = resolve(out, "synthetic-v13-input.pdf");
  await fs.writeFile(inputPath, await v13Input.save());
  await page.locator("#file").setInputFiles(inputPath);
  await page.waitForFunction(
    () => !document.querySelector("#analyze").disabled,
  );
  await page.locator("#analyze").click();
  await page.waitForFunction(
    () => !!CM.getDraft() && !document.querySelector("#analyze").disabled,
  );
  const v13Draft = await page.evaluate(() => CM.getDraft());
  assert.equal(v13Draft.prosecutor, "홍길동");
  assert.equal(v13Draft.filingDate, "2026-08-28");
  assert.equal(v13Draft.defendants.length, 1);
  assert.equal(v13Draft.defendants[0].name, "홍길동");
  assert.equal(v13Draft.defendants[0].birthDigits, "601023");
  assert.deepEqual(v13Draft.defendants[0].charges, [
    "특정범죄가중처벌등에관한법률위반(위험운전치사)",
    "도로교통법위반(음주운전)",
  ]);
  assert.equal(v13Draft.defendants[0].counsel.name, "가상) 김가상 박가상 이가상");
  assert.equal(v13Draft.defendants[0].detention, "released");
  assert.equal(
    await page.locator("#people input, #reviewed, #generate").count(),
    0,
  );
  await page.locator("#export").waitFor({ state: "visible", timeout: 60000 });
  const v13Download = page.waitForEvent("download");
  await page.locator("#save").click();
  const outputPath = resolve(out, "synthetic-v13-output.pdf");
  await (await v13Download).saveAs(outputPath);
  assert.equal(
    (await PDFDocument.load(await fs.readFile(outputPath))).getPageCount(),
    1,
  );
  report.v13SyntheticStructure = {
    inputPages: 3,
    autoGeneratedMemoPages: 1,
    namesAndChargesVerified: true,
    counselVerified: true,
    manualInputs: false,
  };
  const counselCases = JSON.parse(await fs.readFile(resolve(root, "tests/fixtures/counsel-output-cases.json"), "utf8"));
  for (const item of counselCases) {
    const input = await PDFDocument.create();
    input.registerFontkit(fontkit);
    const font = await input.embedFont(await fs.readFile(resolve(root, "vendor/NanumGothic-Regular.ttf")));
    const text = v13Text.replace(/변 호 인[\s\S]*?(?=Ⅱ \. 공소사실)/, item.source.join("\n") + "\n");
    let inputPage = input.addPage([595, 842]), y = 810;
    for (const line of text.trim().split("\n")) {
      inputPage.drawText(line, {x:20, y, size:8, font});
      y -= 15;
      if (line === "- 1 -" || line === "2 / 3") {
        inputPage = input.addPage([595, 842]);
        y = 810;
      }
    }
    const inputPath = resolve(out, `counsel-${item.id}-input.pdf`);
    await fs.writeFile(inputPath, await input.save());
    await page.locator("#file").setInputFiles(inputPath);
    await page.waitForFunction(() => !document.querySelector("#analyze").disabled);
    await page.locator("#analyze").click();
    await page.waitForFunction(() => !!CM.getDraft() && !document.querySelector("#analyze").disabled);
    assert.equal(await page.evaluate(() => CM.counselText(CM.getDraft())), item.expected, item.id);
    await page.locator("#export").waitFor({state:"visible", timeout:60000});
    const download = page.waitForEvent("download");
    await page.locator("#save").click();
    await (await download).saveAs(resolve(out, `counsel-${item.id}.pdf`));
  }
  report.counselOutputCases = counselCases.map(c => c.id);
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
