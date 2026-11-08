import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  IndictmentParser,
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
test("actual sample1 fields, blank counsel and age mismatch", async () => {
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
  assert.equal(a.birth, "1984-12-04");
  assert.equal(a.age, 40);
  assert.equal(a.resolved, false);
  assert.match(a.warnings[0], /41세/);
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
  assert.deepEqual(
    d.defendants.map((p) => birthAssessment(p, d.filingDate).age),
    [54, 55],
  );
  assert.ok(
    d.defendants.every((p) => birthAssessment(p, d.filingDate).resolved),
  );
});
for (const [digits, year, age, date] of [
  ["100101", "2010", 16, "2026-10-27"],
  ["710305", "1971", 55, "2026-10-27"],
  ["000101", "2000", 26, "2026-10-27"],
])
  test("stated age resolves century " + year, () => {
    const a = birthAssessment(person(digits, age), date);
    assert.equal(a.birth.slice(0, 4), year);
    assert.equal(a.resolved, true);
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
test("leap day respects actual century", () => {
  assert.equal(
    birthAssessment(person("000229", null, "1900"), "2025-08-22").birth,
    null,
  );
  assert.equal(
    birthAssessment(person("000229", null, "2000"), "2025-08-22").age,
    25,
  );
});
test("age18/19 boundary", () => {
  assert.equal(
    birthAssessment(person("060823", null, "2006"), "2025-08-22").age,
    18,
  );
  assert.equal(
    birthAssessment(person("060823", null, "2006"), "2025-08-23").age,
    19,
  );
});
test("age70/71 boundary", () => {
  assert.equal(
    birthAssessment(person("540823", null, "1954"), "2025-08-22").age,
    70,
  );
  assert.equal(
    birthAssessment(person("540823", null, "1954"), "2025-08-23").age,
    71,
  );
});
test("no age means no assumed century", () => {
  assert.equal(
    birthAssessment(person("100101", null), "2025-08-22").resolved,
    false,
  );
});
test("invalid manual edit never falls back", () => {
  assert.equal(
    birthAssessment(person("720324", 54, "197"), "2026-10-27").resolved,
    false,
  );
  assert.equal(
    birthAssessment(person("720324", 54, "1984"), "2026-10-27").birth,
    null,
  );
});
test("future birth rejected", () => {
  assert.equal(
    birthAssessment(person("250101", null, "2025"), "2024-01-01").birth,
    null,
  );
});
test("manual confirmation keeps mismatch warning but enables marks", () => {
  const p = person("101204", 15);
  const d = { defendants: [p], filingDate: "2025-08-22" };
  assert.equal(ageMarks(d).juvenile, false);
  p.confirmedYear = "2010";
  assert.equal(ageMarks(d).juvenile, true);
  assert.ok(birthAssessment(p, d.filingDate).warnings.length);
});
test("age rules are independently configurable", () => {
  const d = {
    defendants: [
      person("060822", null, "2006"),
      person("550822", null, "1955"),
    ],
    filingDate: "2025-08-22",
  };
  assert.deepEqual(ageMarks(d), { juvenile: false, mandatory: false });
  assert.deepEqual(ageMarks(d, { juvenileUnder: 20, mandatoryOver: 69 }), {
    juvenile: true,
    mandatory: true,
  });
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
