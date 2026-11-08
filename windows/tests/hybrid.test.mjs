import test from "node:test";
import assert from "node:assert/strict";
import {
  ProsecutorParser,
  ChargeParser,
  IndictmentParser,
  emptyDefendant,
  validateDraft,
} from "../src/core.js";
import {
  textQuality,
  locateRegions,
  buildEvidence,
  reconcile,
  applyEvidence,
  chooseField,
  precisionValues,
  searchLabel,
  normalizeOCRLines,
  anchorRows,
  OCR_LIMITS,
} from "../src/diagnostics.js";
import { renderPlan } from "../src/image-processing.js";
for (const line of [
  "검사 이승엽",
  "검 사 이승엽",
  "검  사   이 승 엽",
  "검사:이승엽",
  "검사： 이승엽",
  "검사\n이승엽",
])
  test("prosecutor variation " + line, () =>
    assert.equal(ProsecutorParser.parse(line.split("\n")), "이승엽"),
  );
test("multiple prosecutor candidates are not guessed", () => {
  assert.deepEqual(
    ProsecutorParser.candidates(["검사 이승엽", "검사 이정현"]),
    ["이승엽", "이정현"],
  );
  assert.equal(ProsecutorParser.parse(["검사 이승엽", "검사 이정현"]), "");
});
for (const lines of [
  ["죄명", "상해, 폭행치상", "적용법조 형법 제257조"],
  ["죄 명 상해,", "폭행치상", "적용법조", "형법 제257조"],
  ["죄명:상해, 폭행치상 적용법조 형법 제257조"],
])
  test("multiline/adjacent charge boundary " + lines[0], () =>
    assert.deepEqual(ChargeParser.parse(lines), ["상해", "폭행치상"]),
  );
test("unnumbered charge lines remain separate without guessing joined crime", () =>
  assert.deepEqual(
    ChargeParser.parse(["죄명", "공무집행", "방해", "구속여부 구속"]),
    ["공무집행", "방해"],
  ));
test("multiple defendant charges stay within own section", () => {
  const text =
    "피고인 김가상\n죄명\n공무집행방해\n적용법조 형법\n피고인 이가상\n죄명 상해,\n절도\n적용법조 형법";
  const d = IndictmentParser.parse({
    text,
    usedOCR: false,
    pages: [{ text, height: 800, lines: [] }],
  });
  assert.deepEqual(
    d.defendants.map((p) => p.charges),
    [["공무집행방해"], ["상해", "절도"]],
  );
});
test("20+ corrupt characters still trigger OCR path", () => {
  const q = textQuality(
    { text: "검사 홍�동\n죄명 상해\n피고인 김가상\n" + "자료".repeat(30) },
    0,
  );
  assert.ok(q.useful > 20);
  assert.equal(q.suspect, true);
  assert.ok(q.reasons.some((r) => r.includes("깨진")));
});
test("missing essential prosecutor triggers routing despite long text", () =>
  assert.equal(
    textQuality({ text: "피고인 김가상\n죄명 상해\n" + "내용".repeat(50) }, 0)
      .suspect,
    true,
  ));
test("valid text is not replaced by full OCR merely for character count", () =>
  assert.equal(
    textQuality(
      { text: "검사 이승엽\n피고인 김가상\n죄명 상해\n적용법조 형법 제257조" },
      0,
    ).suspect,
    false,
  ));
test("regions follow label locations and cross-page defendant cursor", () => {
  const a = locateRegions([
    {
      width: 600,
      height: 800,
      lines: [
        { text: "검사 이승엽", x: 50, y: 300, h: 10 },
        { text: "피고인 김가상", x: 20, y: 350, h: 10 },
        { text: "죄명 상해", x: 40, y: 400, h: 10 },
        { text: "피고인 이가상", x: 20, y: 500, h: 10 },
      ],
    },
    {
      width: 600,
      height: 800,
      lines: [{ text: "죄명 절도", x: 200, y: 100, h: 10 }],
    },
  ]);
  assert.equal(a.find((r) => r.key === "prosecutor").box[0], 40);
  assert.equal(a.find((r) => r.key === "person.1.charges").page, 2);
  assert.equal(a.find((r) => r.key === "person.1.charges").box[0], 190);
});
test("relative header fallback is only an untrusted search range", () => {
  const r = locateRegions([{ width: 600, height: 800, lines: [] }])[0];
  assert.equal(r.method, "relative-header-fallback");
  assert.equal(r.anchor, "");
});
const draft = () => ({
  prosecutor: "이승엽",
  filingDate: "2025-08-22",
  defendants: [
    {
      ...emptyDefendant(),
      name: "김가상",
      charges: ["상해"],
      detention: "detained",
      counsel: { status: "absentMissing", name: "" },
    },
  ],
  warnings: [],
});
test("conflict preserves both source candidates and clears final", () => {
  const d = draft(),
    other = draft();
  other.prosecutor = "이정현";
  const evidence = buildEvidence(d, [
    { kind: "embedded", draft: d, trusted: true },
    { kind: "ocr", draft: other, trusted: false },
  ]);
  const f = evidence.find((f) => f.key === "prosecutor");
  assert.equal(f.conflict, true);
  assert.equal(f.finalValue, null);
  assert.deepEqual(
    f.candidates.map((c) => c.source),
    ["embedded", "ocr"],
  );
  applyEvidence(d, evidence);
  assert.equal(d.prosecutor, "");
  assert.ok(validateDraft(d).some((e) => e.includes("검사")));
});
test("high confidence alone never auto confirms OCR", () => {
  const f = {
    candidates: [
      {
        value: "이승옆",
        source: "precision",
        confidence: 99.99,
        trusted: false,
      },
    ],
    required: true,
  };
  reconcile(f);
  assert.equal(f.needsReview, true);
  assert.equal(f.finalValue, null);
});
test("manual edit survives later conflicting OCR candidates", () => {
  const d = draft(),
    e = buildEvidence(d, [{ kind: "embedded", draft: d, trusted: true }]);
  applyEvidence(d, e);
  chooseField(d, "prosecutor", "직접확인", true);
  const f = e.find((f) => f.key === "prosecutor");
  f.candidates.push({ value: "다른후보", trusted: false });
  reconcile(f);
  assert.equal(f.finalValue, "직접확인");
  assert.equal(f.manualValue, "직접확인");
  assert.equal(f.conflict, true);
  assert.equal(f.needsReview, false);
});
test("different person identity cannot silently acquire charges", () => {
  const d = draft(),
    other = draft();
  other.defendants[0].name = "다른사람";
  other.defendants[0].charges = ["사기"];
  const e = buildEvidence(d, [
    { kind: "embedded", draft: d, trusted: true },
    { kind: "ocr", draft: other, trusted: false },
  ]);
  assert.deepEqual(
    e.find((f) => f.key === "person.0.charges").candidates.map((c) => c.value),
    [["상해"]],
  );
});
test("unknown detention is not trusted as a final candidate", () => {
  const d = draft();
  d.defendants[0].detention = "unknown";
  const e = buildEvidence(d, [{ kind: "embedded", draft: d, trusted: true }]);
  assert.equal(e.find((f) => f.key === "person.0.detention").needsReview, true);
});
test("field candidates retain page and position", () => {
  const d = draft(),
    e = buildEvidence(
      d,
      [{ kind: "embedded", draft: d, trusted: true }],
      [{ key: "prosecutor", page: 2, box: [10, 20, 100, 30] }],
    );
  assert.equal(e[0].candidates[0].page, 2);
  assert.deepEqual(e[0].candidates[0].box, [10, 20, 100, 30]);
});
test("render allocation bounded at requested DPI", () => {
  const p = renderPlan(595, 842);
  assert.ok(p.width * p.height <= OCR_LIMITS.maxPixels);
  assert.ok(p.effectiveDPI <= 300);
  assert.ok(p.effectiveDPI > 295);
  const huge = renderPlan(5000, 6000);
  assert.ok(huge.width * huge.height <= OCR_LIMITS.maxPixels);
  assert.ok(Math.max(huge.width, huge.height) <= OCR_LIMITS.maxSide);
});
test("small selected regions can use 400DPI without whole-page enlargement", () => {
  const p = renderPlan(180, 30, {
    dpi: 400,
    maxPixels: OCR_LIMITS.maxRegionPixels,
  });
  assert.equal(p.effectiveDPI, 400);
  assert.ok(p.estimatedRGBABytes < 1_000_000);
});
test("six fields accept independent precision parsing", () => {
  assert.deepEqual(precisionValues("name", "김가상"), ["김가상"]);
  assert.deepEqual(precisionValues("counsel", "윤상일(국선)"), [
    { status: "named", name: "윤상일(국선)" },
  ]);
  assert.deepEqual(precisionValues("detention", "불구속"), ["released"]);
  assert.deepEqual(precisionValues("filingDate", "2025.8.22."), ["2025-08-22"]);
});

test("whole and two ROI variants may propose one consistent critical value", () => {
  const f = {
    key: "prosecutor",
    required: true,
    candidates: [
      { source: "ocr", value: "이승엽", trusted: false },
      {
        source: "precision",
        value: "이승엽",
        method: "original",
        trusted: false,
      },
      {
        source: "precision",
        value: "이승엽",
        method: "contrast",
        trusted: false,
      },
    ],
  };
  reconcile(f);
  assert.equal(f.finalValue, "이승엽");
  assert.ok(f.autoSelectionReason);
});
test("ROI agreement never overrides text/OCR conflict", () => {
  const f = {
    key: "prosecutor",
    required: true,
    candidates: [
      { source: "embedded", value: "홍길동", trusted: true },
      { source: "ocr", value: "이승엽", trusted: false },
      {
        source: "precision",
        value: "이승엽",
        method: "original",
        trusted: false,
      },
      {
        source: "precision",
        value: "이승엽",
        method: "contrast",
        trusted: false,
      },
    ],
  };
  reconcile(f);
  assert.equal(f.finalValue, null);
  assert.equal(f.conflict, true);
});

test("fuzzy role labels locate only, never rewrite a crime", () => {
  assert.equal(searchLabel("죄명", "죄멍 상해"), true);
  assert.equal(searchLabel("검사", "검시 이승엽"), true);
  assert.deepEqual(ChargeParser.parse(["죄멍 상해"]), []);
});
test("OCR words retain boxes with a bottom-y baseline approximation", () => {
  const [line] = normalizeOCRLines(
    {
      lines: [
        {
          text: "검사 이승엽",
          bbox: { x0: 10, y0: 20, x1: 100, y1: 40 },
          confidence: 90,
          words: [
            {
              text: "이승엽",
              bbox: { x0: 50, y0: 20, x1: 100, y1: 40 },
              confidence: 90,
            },
          ],
        },
      ],
    },
    2,
  );
  assert.equal(line.y, 20);
  assert.deepEqual(line.box, [5, 10, 45, 10]);
  assert.equal(line.items[0].x, 25);
});
test("budget-skipped verification stays pending despite native candidate", () => {
  const f = {
    key: "prosecutor",
    required: true,
    verificationIncomplete: true,
    candidates: [{ value: "이승엽", trusted: true, source: "embedded" }],
  };
  reconcile(f);
  assert.equal(f.finalValue, null);
  assert.equal(f.needsReview, true);
});

test("role labels in a shared row use their own word coordinates", () => {
  const [row] = anchorRows([
    {
      text: "수신자 법원 검사 이승엽",
      y: 100,
      h: 10,
      items: [
        { str: "수신자 법원", x: 10, w: 100, h: 10 },
        { str: "검", x: 300, w: 10, h: 10 },
        { str: "사", x: 320, w: 10, h: 10 },
        { str: "이승엽", x: 350, w: 40, h: 10 },
      ],
    },
  ]);
  assert.equal(row.x, 300);
  assert.equal(row.text, "검 사 이승엽");
});
test("fact narrative does not create new prosecutor or charge regions", () => {
  const regions = locateRegions([
    {
      width: 600,
      height: 800,
      lines: [
        { text: "검사 이승엽", y: 100, h: 10 },
        { text: "II. 공소사실", y: 400, h: 10 },
        { text: "검사 결과", y: 450, h: 10 },
      ],
    },
  ]);
  assert.equal(regions.filter((r) => r.field === "prosecutor").length, 1);
});

test("unnumbered delimiter-free wrapping requires human interpretation", () => {
  assert.equal(
    ChargeParser.ambiguous(["죄명 공무집행", "방해", "적용법조 형법"]),
    true,
  );
  assert.equal(
    ChargeParser.ambiguous(["죄명 상해,", "절도", "적용법조 형법"]),
    false,
  );
});
test("incomplete analysis cannot silently generate a memo", () => {
  const d = draft();
  d.incompleteAnalysis = { pages: [2], confirmed: false };
  assert.ok(validateDraft(d).some((e) => e.includes("미처리")));
  d.incompleteAnalysis.confirmed = true;
  assert.ok(!validateDraft(d).some((e) => e.includes("미처리")));
});

test("repeated OCR cannot settle ambiguous crime wrapping by agreement alone", () => {
  const f = {
    key: "person.0.charges",
    required: true,
    candidates: [
      {
        value: ["공무집행", "방해"],
        source: "ocr",
        trusted: false,
        ambiguous: true,
      },
      {
        value: ["공무집행", "방해"],
        source: "precision",
        method: "original",
        trusted: false,
      },
      {
        value: ["공무집행", "방해"],
        source: "precision",
        method: "contrast",
        trusted: false,
      },
    ],
  };
  reconcile(f);
  assert.equal(f.finalValue, null);
  assert.equal(f.needsReview, true);
});
