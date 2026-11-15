import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  IndictmentParser,
  ProsecutorParser,
  FilingDateParser,
  DefendantParser,
  ChargeParser,
  CounselParser,
  DetentionParser,
  birthAssessment,
  parseDate,
  detentionGlyphs,
  counselText,
  ageMarks,
  numbered,
  validateDraft,
  emptyDefendant,
  AGE_RULES,
} from "../src/core.js";
const text = (n) =>
  fs.readFile(new URL(`fixtures/sample${n}.txt`, import.meta.url), "utf8");
const doc = (t) => ({
  text: t,
  usedOCR: false,
  pages: [
    {
      text: t,
      height: 842,
      lines: t.split("\n").map((text, i) => ({ text, y: i * 12 })),
    },
  ],
});
const person = (digits, age, year = "") => ({
  ...emptyDefendant(),
  name: "가상",
  birthDigits: digits,
  statedAge: age,
  confirmedYear: year,
});
test("repository sample1 fields, blank counsel and unconfirmed age", async () => {
  const d = IndictmentParser.parse(doc(await text(1)));
  assert.deepEqual(
    d.defendants.map((p) => p.name),
    ["이민주"],
  );
  assert.deepEqual(d.defendants[0].charges, ["상해", "폭행치상"]);
  assert.equal(d.prosecutor, "이승엽");
  assert.equal(d.filingDate, "2025-08-22");
  assert.equal(counselText(d), "");
  assert.equal(d.defendants[0].birthDigits, "841204");
  assert.deepEqual(detentionGlyphs(d.defendants), [
    { text: "O", color: "red" },
  ]);
  const a = birthAssessment(d.defendants[0], d.filingDate);
  assert.equal(a.birth, null);
  assert.equal(a.age, null);
  assert.equal(a.resolved, false);
});
test("actual sample2 cross-page defendant relationships", async () => {
  const d = IndictmentParser.parse(doc(await text(2)));
  assert.deepEqual(
    d.defendants.map((p) => p.name),
    ["김유나", "이영수"],
  );
  assert.deepEqual(
    d.defendants.map((p) => p.charges),
    [["공무집행방해"], ["상해", "절도"]],
  );
  assert.deepEqual(
    d.defendants.map((p) => p.birthDigits),
    ["720324", "710305"],
  );
  assert.equal(d.prosecutor, "이정현");
  assert.equal(d.filingDate, "2026-10-27");
  assert.equal(counselText(d), "윤상일(국선)");
  assert.equal(d.defendants[1].counsel.status, "absentMissing");
  assert.deepEqual(detentionGlyphs(d.defendants), [
    { text: "O", color: "red" },
    { text: "X", color: "black" },
  ]);
  assert.ok(
    d.defendants.every((p) => !birthAssessment(p, d.filingDate).resolved),
  );
});
test("suffix changes do not affect extraction or age", async () => {
  const original = await text(2);
  const a = IndictmentParser.parse(doc(original)),
    b = IndictmentParser.parse(
      doc(original.replace("5982346", "9999999").replace("1978346", "1111111")),
    );
  assert.deepEqual(
    a.defendants.map((p) => birthAssessment(p, a.filingDate)),
    b.defendants.map((p) => birthAssessment(p, b.filingDate)),
  );
  assert.ok(!JSON.stringify(a).includes("5982346"));
});
for (const digits of [
  "841284",
  "841304",
  "840431",
  "000000",
  "abcdef",
  "84120",
  "8412040",
])
  test("reject invalid front " + digits, () => {
    const a = birthAssessment(person(digits, 41), "2025-08-22");
    assert.equal(a.resolved, false);
    assert.equal(a.birth, null);
  });
test("auto-only never infers age from stated age or a manual year", () => {
  for (const p of [
    person("100101", 16, "2010"),
    person("500101", 76, "1950"),
  ]) {
    const assessment = birthAssessment(p, "2026-11-05");
    assert.equal(assessment.resolved, false);
    assert.equal(assessment.age, null);
    assert.deepEqual(ageMarks({ defendants: [p], filingDate: "2026-11-05" }), {
      juvenile: false,
      mandatory: false,
    });
  }
  assert.equal(AGE_RULES.juvenileUnder, 19);
});
for (const [states, expected] of [
  [["detained"], "O"],
  [["released"], "X"],
  [["detained", "released"], "OX"],
  [["released", "detained"], "XO"],
  [["detained", "detained"], "OO"],
  [["released", "released"], "XX"],
  [["detained", "released", "detained"], "OXO"],
])
  test("ordered colored single line " + expected, () => {
    const glyphs = detentionGlyphs(states.map((detention) => ({ detention })));
    assert.equal(glyphs.map((g) => g.text).join(""), expected);
    assert.deepEqual(
      glyphs.map((g) => g.color),
      [...expected].map((c) => (c === "O" ? "red" : "black")),
    );
  });
test("unknown detention rejects partial output", () =>
  assert.throws(() =>
    detentionGlyphs([{ detention: "detained" }, { detention: "unknown" }]),
  ));
for (const suffix of ["\n변호인 없음", "\n죄명 절도"])
  test("explicit or missing counsel is blank " + suffix, () => {
    const d = IndictmentParser.parse(doc("피고인 김가상" + suffix));
    assert.equal(counselText(d), "");
    assert.notEqual(d.defendants[0].counsel.status, "needsReview");
  });
test("OCR counsel and birth require confirmation", () => {
  const document = doc("피고인 김가상 (100101-9999999), 15세\n변호인 없음");
  document.usedOCR = true;
  const d = IndictmentParser.parse(document);
  assert.equal(d.defendants[0].counsel.status, "needsReview");
  assert.equal(counselText(d), "");
  assert.equal(birthAssessment(d.defendants[0], "2025-08-22").resolved, false);
  assert.ok(validateDraft(d).some((s) => s.includes("변호인")));
});
test("zero width and nonstandard spaces do not mix counsel", () => {
  const d = IndictmentParser.parse(
    doc(
      "1.\u200B 피 고 인 김가상\n변호인 윤상일\n2.\u200B 피\u00a0고\u00a0인 이가상\n죄명 상해",
    ),
  );
  assert.deepEqual(
    d.defendants.map((p) => p.name),
    ["김가상", "이가상"],
  );
  assert.equal(counselText(d), "윤상일");
});
test("single names and charges still numbered", () =>
  assert.equal(numbered(["절도"]), "1. 절도"));
test("filing date uses first-page header, not arrest date", () => {
  const d = IndictmentParser.parse(
    doc("2026. 10. 27.\n피고인 김가상\n구속여부 2026. 10. 15. 구속"),
  );
  assert.equal(d.filingDate, "2026-10-27");
  assert.equal(d.defendants[0].detention, "detained");
});
test("ambiguous header dates remain unknown", () => {
  const d = IndictmentParser.parse(
    doc("2026.10.27.\n2025.01.01.\n피고인 김가상"),
  );
  assert.equal(d.filingDate, null);
});
test("calendar dates reject rollover", () => {
  assert.equal(parseDate("2025.2.29."), null);
  assert.equal(parseDate("2024년 2월 29일"), "2024-02-29");
});
test("synthetic split labels, numbered defendants, multiline charges and body boundary", async () => {
  const t = await fs.readFile(
    new URL("fixtures/layout-variants.txt", import.meta.url),
    "utf8",
  );
  const d = IndictmentParser.parse(doc(t));
  assert.equal(d.prosecutor, "홍길동");
  assert.equal(d.filingDate, "2026-11-05");
  assert.deepEqual(
    d.defendants.map((p) => [p.name, p.birthDigits, p.charges, p.detention]),
    [
      ["김가상", "900101", ["사기", "도로교통법위반(음주운전)"], "released"],
      ["이가상", "920202", ["상해", "절도"], "detained"],
    ],
  );
  assert.equal(counselText(d), "박변호");
  assert.deepEqual(validateDraft(d), []);
});
for (const date of [
  "2026 . 11 . 5 .",
  "2026 - 11 - 05",
  "2026 / 11 / 5",
  "2026 년 11 월 5 일",
])
  test("date whitespace: " + date, () =>
    assert.equal(parseDate(date), "2026-11-05"),
  );
test("split header date, signature and Unicode spaces", () => {
  const d = IndictmentParser.parse(
    doc(
      "2026.\n11.\n5.\n검\u3000사：홍\u00a0길\u2009동 ___\n피고인：김가상\n죄명：절도",
    ),
  );
  assert.equal(d.filingDate, "2026-11-05");
  assert.equal(d.prosecutor, "홍길동");
  assert.equal(d.defendants[0].name, "김가상");
});
test("explicit invalid/conflicting dates and prosecutors stay unconfirmed", () => {
  for (const fields of [
    "기소일 2026.2.30.",
    "기소일\n2026.11.5.\n공소제기일 2026.11.6.",
  ]) {
    const d = IndictmentParser.parse(
      doc("2026.11.5.\n" + fields + "\n피고인 김가상"),
    );
    assert.equal(d.filingDate, null);
  }
  assert.equal(
    IndictmentParser.parse(doc("검사 홍길동\n검사 김검사")).prosecutor,
    "",
  );
});
test("separate identity fields and charges do not consume metadata", () => {
  const d = IndictmentParser.parse(
    doc(
      "피고인\n성명\n김가상\n생년월일 900101\n직업 회사원\n죄명\n절도\n상해\n적용법조\n형법 제329조\n구속여부 불구속\n변호인\n없음",
    ),
  );
  assert.equal(d.defendants[0].name, "김가상");
  assert.equal(d.defendants[0].birthDigits, "900101");
  assert.deepEqual(d.defendants[0].charges, ["절도", "상해"]);
  assert.equal(d.defendants[0].counsel.status, "absentExplicit");
});
test("repeated split defendant labels keep each person’s fields", () => {
  const d = IndictmentParser.parse(
    doc(
      "피고인\n김가상 (900101)\n죄명 사기\n변호인 박변호\n피고인\n이가상 (920202)\n죄명 절도\n구속여부 불구속",
    ),
  );
  assert.deepEqual(
    d.defendants.map((p) => p.name),
    ["김가상", "이가상"],
  );
  assert.deepEqual(
    d.defendants.map((p) => p.charges),
    [["사기"], ["절도"]],
  );
  assert.equal(d.defendants[1].counsel.status, "absentMissing");
});
test("numbered defendants with birth on separate lines and commas inside charge titles", () => {
  const d = IndictmentParser.parse(
    doc(
      "피고인\n1. 김가상\n주민등록번호 900101\n죄명 특정법위반(가, 나)\n절도\n2. 이가상\n생년월일 920202\n죄명 상해",
    ),
  );
  assert.deepEqual(
    d.defendants.map((p) => [p.name, p.birthDigits, p.charges]),
    [
      ["김가상", "900101", ["특정법위반(가, 나)", "절도"]],
      ["이가상", "920202", ["상해"]],
    ],
  );
});
test("address or job numbers cannot substitute for missing birth digits", () => {
  const d = IndictmentParser.parse(
    doc("피고인 김가상\n직업 123456\n주거 900101번지\n죄명 절도"),
  );
  assert.equal(d.defendants[0].birthDigits, "");
  assert.ok(validateDraft(d).some((s) => s.includes("생년월일")));
});

// v1.3 fixture is entirely fictional; no private source-document identifiers.
const latestText = () =>
  fs.readFile(
    new URL("fixtures/latest-structure-v13.txt", import.meta.url),
    "utf8",
  );
const latestCharges = [
  "특정범죄가중처벌등에관한법률위반(위험운전치사)",
  "도로교통법위반(음주운전)",
];
test("v1.3 direct parsers: supplied structure, metadata, body and attachment boundaries", async () => {
  const t = await latestText(),
    lines = t.split("\n");
  assert.equal(ProsecutorParser.parse(lines), "홍길동");
  const date = FilingDateParser.assess(doc(t).pages[0]);
  assert.equal(date.date, "2026-08-28");
  assert.deepEqual(
    date.candidates.filter((c) => c.source === "body"),
    [{ source: "body", date: "2026-08-28" }],
  );
  assert.ok(
    !date.candidates.some(
      (c) => c.date === "2026-11-12" || c.date === "2026-06-16",
    ),
  );
  const sections = DefendantParser.split(t);
  assert.equal(sections.length, 1);
  const person = DefendantParser.parse(sections[0], false);
  assert.equal(person.name, "홍길동");
  assert.equal(person.birthDigits, "601023");
  assert.equal("statedAge" in person, false);
  assert.deepEqual(ChargeParser.parse(sections[0].lines), latestCharges);
  assert.deepEqual(ChargeParser.parse(lines), latestCharges);
  assert.deepEqual(CounselParser.parse(sections[0].lines, false), {
    status: "named",
    name: "김가상, 박가상, 이가상",
    firm: "법무법인 가상",
    lawyers: ["김가상", "박가상", "이가상"],
  });
  assert.equal(DetentionParser.parse(sections[0].lines), "released");
  const draft = IndictmentParser.parse(doc(t));
  assert.deepEqual(validateDraft(draft), []);
  assert.deepEqual(detentionGlyphs(draft.defendants), [
    { text: "X", color: "black" },
  ]);
  assert.deepEqual(ageMarks(draft), { juvenile: false, mandatory: false });
  assert.equal(birthAssessment(person, draft.filingDate).age, null);
  assert.equal(counselText(draft), "김가상, 박가상, 이가상");
  assert.ok(!JSON.stringify(draft).includes("본문가상"));
  assert.ok(!JSON.stringify(draft).includes("첨부가상"));
  assert.ok(!JSON.stringify(sections).includes("다운로드일시"));
});
for (const stamp of ["(인)", "( 인 )", "(서명)", "( 서명 )", "（ 인 ）"]) {
  for (const separator of [" ", "\n"]) {
    test(
      "v1.3 prosecutor signature " + stamp + JSON.stringify(separator),
      () => {
        assert.equal(
          ProsecutorParser.parse(
            ("검 사" + separator + "홍길동 " + stamp + "\n제 목 공소장").split(
              "\n",
            ),
          ),
          "홍길동",
        );
      },
    );
  }
}
for (const title of [
  "Ⅱ . 공소사실",
  "II . 공 소 사 실",
  "Ⅱ．공소사실",
  "Ⅲ . 첨부",
  "III. 첨 부 서 류",
  "Ⅲ 첨부",
]) {
  test("v1.3 boundary " + title, () => {
    const t =
      "피고인 김가상 (900101-XXXXXXX)\n죄명 절도\n구속여부 불구속\n변호인 없음\n" +
      title +
      "\n피고인 본문가상인\n죄명 본문가상죄명\n변호인 본문가상변호";
    const draft = IndictmentParser.parse(doc(t));
    assert.deepEqual(
      draft.defendants.map((p) => p.name),
      ["김가상"],
    );
    assert.deepEqual(ChargeParser.parse(t.split("\n")), ["절도"]);
    assert.equal(
      CounselParser.parse(t.split("\n"), false).status,
      "absentExplicit",
    );
    assert.equal(counselText(draft), "");
  });
}
test("v1.3 dates: submission conflict is reported and blocks PDF validation", async () => {
  const t = (await latestText()).replaceAll(
    "제출일시: 2026.08.28",
    "제출일시: 2026.08.29",
  );
  const result = FilingDateParser.assess(doc(t).pages[0]);
  assert.equal(result.date, null);
  assert.match(result.reason, /본문 날짜.*제출일시.*다릅니다/);
  const draft = IndictmentParser.parse(doc(t));
  assert.ok(draft.warnings.includes(result.reason));
  assert.ok(validateDraft(draft).some((s) => s.includes(result.reason)));
});
test("v1.3 dates: submission/download/arrest/crime dates alone never establish filing date", async () => {
  const t = (await latestText()).replace(
    "가상지방검찰청\n2026. 8. 28.",
    "가상지방검찰청",
  );
  assert.equal(FilingDateParser.parse(doc(t).pages[0]), null);
  for (const value of [
    "다운로드일시: 2026.11.12",
    "제출일시: 2026.08.28",
    "구속여부 2026.08.27. 구속",
    "범죄일시: 2026.06.16",
  ]) {
    const result = FilingDateParser.assess(
      doc(value + "\n피고인 김가상").pages[0],
    );
    assert.equal(result.date, null);
    assert.ok(result.reason);
  }
});
test("v1.3 contextual body date works below top quarter and in OCR text", async () => {
  const d = doc(await latestText());
  d.pages[0].lines = d.pages[0].lines.map((l) => ({ ...l, y: l.y + 300 }));
  assert.equal(FilingDateParser.parse(d.pages[0]), "2026-08-28");
  assert.equal(
    FilingDateParser.parse({ ...d.pages[0], ocr: true }),
    "2026-08-28",
  );
});
test("v1.3 counsel never invents a named lawyer from a firm alone", () => {
  const c = CounselParser.parse(["변호인 법무법인 가상"], false);
  assert.equal(c.firm, "법무법인 가상");
  assert.deepEqual(c.lawyers, []);
  assert.equal(c.name, "");
  assert.equal(c.status, "needsReview");
});
test("v1.3 multiple defendants retain separate counsel, charges and detention", async () => {
  const t = (await latestText()).replace(
    "Ⅱ . 공소사실",
    "2. 피고인 이가상 (900101-XXXXXXX)\n죄명 절도\n구속여부 구속\n변호인 없음\nⅡ . 공소사실",
  );
  const draft = IndictmentParser.parse(doc(t));
  assert.deepEqual(
    draft.defendants.map((p) => p.charges),
    [latestCharges, ["절도"]],
  );
  assert.deepEqual(
    draft.defendants.map((p) => p.counsel.status),
    ["named", "absentExplicit"],
  );
  assert.deepEqual(detentionGlyphs(draft.defendants), [
    { text: "X", color: "black" },
    { text: "O", color: "red" },
  ]);
});
test("v1.3 birth front and age marks ignore masked suffix and stated age", async () => {
  const original = await latestText();
  const a = IndictmentParser.parse(doc(original));
  const b = IndictmentParser.parse(
    doc(original.replace("XXXXXXX), 65", "*******), 15")),
  );
  assert.deepEqual(
    birthAssessment(a.defendants[0], a.filingDate),
    birthAssessment(b.defendants[0], b.filingDate),
  );
  assert.deepEqual(ageMarks(a), { juvenile: false, mandatory: false });
});
test("v1.3 header fallback cannot consume standalone crime or arrest dates", () => {
  for (const t of [
    "Ⅱ . 공소사실\n2026.06.16.",
    "범죄일시\n2026.06.16.\n피고인 김가상",
    "구속일\n2026.06.16.\n피고인 김가상",
  ]) {
    assert.equal(FilingDateParser.parse(doc(t).pages[0]), null);
  }
});
test("v1.3 unreadable submission date remains unconfirmed", async () => {
  const t = (await latestText()).replaceAll(
    "제출일시: 2026.08.28 10:00",
    "제출일시: 판독불가",
  );
  const result = FilingDateParser.assess(doc(t).pages[0]);
  assert.equal(result.date, null);
  assert.match(result.reason, /제출일시.*판독/);
});
