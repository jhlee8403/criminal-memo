import test from "node:test";
import assert from "node:assert/strict";
import {
  ctcDecode,
  detectionPlan,
  normalizeRGB,
  dbBoxes,
  restoreLines,
} from "../src/ocr/paddle-core.js";
import { mergeEngineResults } from "../src/ocr/comparison.js";
import { emptyDefendant, birthAssessment, ageMarks } from "../src/core.js";
test("CTC removes blanks/repeats but preserves blank-separated repetitions", () => {
  const labels = [1, 1, 0, 1, 2, 3],
    data = new Float32Array(labels.length * 4);
  labels.forEach((c, i) => (data[i * 4 + c] = 1));
  assert.deepEqual(ctcDecode(data, [1, labels.length, 4], ["김", "유"]), {
    text: "김김유",
    confidence: 100,
  });
  assert.throws(() => ctcDecode(data, [1, 6, 4], ["가"]), /mismatch/);
});
test("detector plan is multiple-of-32 bounded and RGB channels are normalized independently", () => {
  const p = detectionPlan(2480, 3508);
  assert.ok(Math.max(p.width, p.height) <= 1280);
  assert.equal(p.width % 32, 0);
  const v = normalizeRGB(new Uint8Array([255, 0, 128, 255]), 1, 1, "rec");
  assert.equal(v[0], 1);
  assert.equal(v[1], -1);
  assert.ok(Math.abs(v[2] - 1 / 255) < 1e-7);
});
test("DB threshold components remain separate and noisy low scores do not create text", () => {
  const m = new Float32Array(30 * 10);
  for (let y = 2; y < 7; y++) for (let x = 2; x < 10; x++) m[y * 30 + x] = 0.9;
  for (let y = 2; y < 7; y++) for (let x = 20; x < 28; x++) m[y * 30 + x] = 0.4;
  const boxes = dbBoxes(m, 30, 10);
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0].x0 < 2);
  assert.ok(boxes[0].score > 0.8);
});
test("OCR geometry restores left-to-right row ordering without losing boxes", () => {
  const words = [
    {
      text: "이승엽",
      confidence: 80,
      bbox: { x0: 60, y0: 10, x1: 100, y1: 25 },
    },
    { text: "검 사", confidence: 90, bbox: { x0: 5, y0: 11, x1: 40, y1: 26 } },
  ];
  const lines = restoreLines(words);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "검 사 이승엽");
  assert.equal(lines[0].words[0].bbox.x0, 5);
});
const field = (key, value) => ({
  key,
  required: true,
  candidates: [{ value, source: "ocr", method: "whole", trusted: false }],
  finalValue: value,
  selectedValue: value,
  needsReview: false,
});
const result = (name, charges, prosecutor = "이승엽") => ({
  draft: {
    prosecutor,
    defendants: [{ ...emptyDefendant(), name, birthDigits: "841204", charges }],
    evidence: [
      field("prosecutor", prosecutor),
      field("person.0.charges", charges),
    ],
  },
  diagnostics: { pages: [], attempts: 1, elapsedMs: 1 },
});
test("engine comparison keeps disagreements unresolved and labeled", () => {
  const a = result("이민주", ["상해"]),
    b = result("이민주", ["사기"], "홍길동");
  const r = mergeEngineResults(a, b);
  assert.equal(r.draft.prosecutor, "");
  assert.deepEqual(r.draft.defendants[0].charges, []);
  assert.ok(r.draft.evidence.every((f) => f.conflict));
  assert.equal(r.draft.evidence[0].candidates[1].engine, "paddle");
});
test("unmatched defendants never receive another engine persons crimes", () => {
  const r = mergeEngineResults(
    result("김유나", ["상해"]),
    result("이영수", ["절도"]),
  );
  assert.deepEqual(r.draft.defendants[0].charges, ["상해"]);
  assert.equal(r.diagnostics.comparison.unmatched.length, 1);
});
test("stated age and legacy confirmed year do not determine a century", () => {
  const p = {
    ...emptyDefendant(),
    birthDigits: "841204",
    statedAge: 41,
    confirmedYear: "1984",
  };
  assert.equal(birthAssessment(p, "2025-08-22").resolved, false);
  p.statedAge = 400;
  assert.equal(birthAssessment(p, "2025-08-22").resolved, false);
});
test("user can correct complete DOB including month/day; stale stated age is ignored", () => {
  const p = {
    ...emptyDefendant(),
    birthDigits: "841204",
    confirmedBirthDate: "2010-06-01",
    statedAge: 41,
  };
  assert.deepEqual(birthAssessment(p, "2025-08-22"), {
    resolved: true,
    birth: "2010-06-01",
    age: 15,
    warnings: [],
  });
  assert.deepEqual(ageMarks({ defendants: [p], filingDate: "2025-08-22" }), {
    juvenile: true,
    mandatory: false,
  });
  p.confirmedBirthDate = "2010-02-30";
  assert.equal(birthAssessment(p, "2025-08-22").resolved, false);
});

test("model files and official dictionary match the pinned research manifest", async () => {
  const fs = await import("node:fs/promises"),
    { createHash } = await import("node:crypto");
  const manifest = JSON.parse(
    await fs.readFile(
      new URL("../experimental/paddle/MODEL_MANIFEST.json", import.meta.url),
      "utf8",
    ),
  );
  for (const [file, meta] of Object.entries(manifest.files)) {
    const data = await fs.readFile(
      new URL("../experimental/paddle/models/" + file, import.meta.url),
    );
    assert.equal(data.length, meta.bytes);
    assert.equal(createHash("sha256").update(data).digest("hex"), meta.sha256);
  }
  assert.equal(manifest.recognizerUpstreamParityVerified, false);
});

test("Paddle request timeout terminates its worker without silent fallback", async () => {
  const { PaddleOCRService } = await import("../src/ocr/paddle.js");
  const engine = new PaddleOCRService();
  let terminated = false;
  engine.worker = {
    postMessage() {},
    terminate() {
      terminated = true;
    },
  };
  await assert.rejects(engine.request({ type: "test" }, [], 5), /시간 한도/);
  assert.equal(terminated, true);
  assert.equal(engine.pending.size, 0);
  assert.equal(engine.worker, null);
});

test("score report distinguishes a correct candidate from automatic agreement and absent defendants", async () => {
  const { scoreHybrid } = await import("./ocr-scoring.mjs");
  const draft = {
    prosecutor: "",
    filingDate: null,
    defendants: [],
    evidence: [
      {
        key: "prosecutor",
        needsReview: true,
        finalValue: null,
        candidates: [{ value: "이승엽" }, { value: "홍길동" }],
      },
    ],
  };
  const fields = scoreHybrid(draft, {
    prosecutor: "이승엽",
    filingDate: "2025-08-22",
    names: ["이민주"],
    charges: [["상해"]],
    counsel: [""],
    birthDigits: ["841204"],
    detention: ["detained"],
  });
  assert.equal(
    fields.find((f) => f.field === "prosecutor").classification,
    "candidateIncluded",
  );
  assert.equal(
    fields.find((f) => f.field === "counsel").classification,
    "unrecognized",
  );
});
