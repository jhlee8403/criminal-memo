// Pure business rules: no browser, filesystem or network dependencies.
export const AGE_RULES = Object.freeze({
  juvenileUnder: 19,
  mandatoryOver: 70,
});
export const numbered = (v) =>
  v
    .filter((s) => s.trim())
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");
export const counselText = (d) =>
  d.defendants
    .filter((p) => p.counsel.status === "named")
    .map((p) => p.counsel.name.trim())
    .filter(Boolean)
    .join("\n");
export function detentionGlyphs(people) {
  if (people.some((p) => !["detained", "released"].includes(p.detention)))
    throw Error("피고인별 구속 여부를 확인하세요.");
  return people.map((p) => ({
    text: p.detention === "detained" ? "O" : "X",
    color: p.detention === "detained" ? "red" : "black",
  }));
}
export function validDate(y, m, d) {
  if (![y, m, d].every(Number.isInteger) || y < 1 || y > 9999) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(y, m - 1, d);
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
export function parseDate(s) {
  const m = s
    ?.trim()
    .match(/^(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})(?:[.일])?$/);
  if (!m || !validDate(+m[1], +m[2], +m[3])) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}
// v2.2: written age and resident-number suffix never participate in DOB resolution.
export function birthAssessment(person, filingDate) {
  const fail = (message) => ({
    resolved: false,
    birth: null,
    age: null,
    warnings: [message],
  });
  const manual = String(person.confirmedBirthDate ?? "").trim();
  const front = person.birthDigits ?? "";
  let birth;
  if (manual) {
    birth = parseDate(manual);
    if (!birth) return fail("직접 확인한 전체 생년월일이 유효하지 않습니다.");
  } else {
    if (!/^\d{6}$/.test(front))
      return fail("생년월일 앞 6자리 YYMMDD를 확인하세요.");
    const yy = +front.slice(0, 2),
      month = +front.slice(2, 4),
      day = +front.slice(4);
    let possible = false;
    for (let year = yy || 100; year <= 9999; year += 100)
      if (validDate(year, month, day)) {
        possible = true;
        break;
      }
    if (!possible) return fail("앞 6자리의 월·일이 실제 달력에 없습니다.");
    return fail(
      "앞 6자리만으로 출생 세기를 확정하지 않습니다. 전체 생년월일을 직접 확인하세요.",
    );
  }
  const filing = parseDate(filingDate);
  if (!filing) return { ...fail("기소일을 확인하세요."), birth };
  if (birth > filing) return fail("생년월일이 기소일보다 늦습니다.");
  const [by, bm, bd] = birth.split("-").map(Number),
    [fy, fm, fd] = filing.split("-").map(Number);
  return {
    birth,
    age: fy - by - (fm < bm || (fm === bm && fd < bd) ? 1 : 0),
    resolved: true,
    warnings: [],
  };
}
export function ageMarks(draft, rules = AGE_RULES) {
  const ages = draft.defendants.map((p) =>
    birthAssessment(p, draft.filingDate),
  );
  return {
    juvenile: ages.some((a) => a.resolved && a.age < rules.juvenileUnder),
    mandatory: ages.some((a) => a.resolved && a.age > rules.mandatoryOver),
  };
}
const clean = (s) =>
  s
    .normalize("NFC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u00a0\u3000]/g, " ");
const labelPattern = (label) => [...label].join("\\s*");
export const labelValue = (label, line) =>
  line.match(
    new RegExp(
      "^\\s*(?:\\d+[.)]\\s*)?" +
        labelPattern(label) +
        "(?:\\s*[:：]\\s*|\\s+)(.*?)\\s*$",
    ),
  )?.[1];
export const hasLabel = (label, line) =>
  new RegExp(
    "^\\s*(?:\\d+[.)]\\s*)?" + labelPattern(label) + "(?:\\s|[:：]|$)",
  ).test(line);
export const FIELD_LABELS = [
  "피고인",
  "죄명",
  "적용법조",
  "구속여부",
  "변호인",
  "기소일",
  "공소제기일",
  "직업",
  "주거",
  "등록기준지",
  "검사",
  "공소사실",
];
export function splitFieldLines(lines) {
  const labels = new RegExp(
    FIELD_LABELS.map(labelPattern).join("|") + "(?=\\s|[:：]|$)",
    "g",
  );
  return lines.flatMap((raw) => {
    const line = clean(raw),
      starts = [0];
    for (const m of line.matchAll(labels))
      if (m.index > 0 && /[\s,;|]/.test(line[m.index - 1]))
        starts.push(m.index);
    return [...new Set(starts)]
      .map((start, i, array) => line.slice(start, array[i + 1]).trim())
      .filter(Boolean);
  });
}
export function fieldBlock(label, lines) {
  const blocks = [];
  let active = null;
  for (const line of splitFieldLines(lines)) {
    if (hasLabel(label, line)) {
      active = [];
      blocks.push(active);
      const value = labelValue(label, line);
      if (value?.trim()) active.push(value);
    } else if (
      FIELD_LABELS.some((l) => hasLabel(l, line)) ||
      /^(?:[IVX]+[.)]\s*)?공\s*소\s*사\s*실/.test(line)
    ) {
      active = null;
    } else if (active && line.trim()) active.push(line);
  }
  return blocks;
}
export class DefendantParser {
  static split(text) {
    const sections = [];
    let names = false;
    for (const line of splitFieldLines(clean(text).split("\n"))) {
      if (/^(?:[IVX]+[.)]\s*)?공\s*소\s*사\s*실/.test(line)) break;
      const value = labelValue("피고인", line);
      if (value && !/관\s*련\s*사\s*항/.test(value)) {
        sections.push({ identity: value, lines: [] });
        names = true;
      } else if (hasLabel("피고인", line) && !/관\s*련\s*사\s*항/.test(line)) {
        names = true;
      } else if (names && /^\d+[.)]\s*.+/.test(line)) {
        sections.push({ identity: line.replace(/^\d+[.)]\s*/, ""), lines: [] });
      } else {
        if (line) names = false;
        sections.at(-1)?.lines.push(line);
      }
    }
    return sections;
  }
  static parse(section, ocr) {
    const front = section.identity.match(/(?<!\d)(\d{6})(?!\d)/)?.[1] ?? "";
    return {
      id: crypto.randomUUID?.() ?? Math.random().toString(36),
      name: section.identity
        .split(/[（(]/)[0]
        .replace(/\d{6}.*$/, "")
        .replace(/^\d+[.)]\s*/, "")
        .replace(/^[_、:：\s]+/, "")
        .trim(),
      birthDigits: front,
      confirmedBirthDate: "",
      birthReview: ocr,
      counsel: CounselParser.parse(section.lines, ocr),
      charges: ChargeParser.parse(section.lines),
      chargeNeedsReview: ChargeParser.ambiguous(section.lines),
      detention: DetentionParser.parse(section.lines),
    };
  }
}
const values = (label, lines) =>
  lines.map((l) => labelValue(label, l)).filter((v) => v !== undefined);
export class ChargeParser {
  static ambiguous(lines) {
    return fieldBlock("죄명", lines).some(
      (block) =>
        block.length > 1 &&
        block
          .slice(0, -1)
          .some(
            (v, i) =>
              !/[，,、;]\s*$/.test(v) &&
              !/^\s*\d+[.)]/.test(v) &&
              !/^\s*\d+[.)]/.test(block[i + 1]),
          ),
    );
  }
  static parse(lines) {
    return fieldBlock("죄명", lines)
      .flat()
      .flatMap((v) => v.split(/[,，、;]/))
      .map((v) => v.replace(/^\s*(?:[_、:：]+|\d+[.)])\s*/, "").trim())
      .filter((v) => v && !FIELD_LABELS.some((l) => hasLabel(l, v)));
  }
}
export class CounselParser {
  static parse(lines, ocr) {
    const list = values("변호인", lines),
      none = ["없음", "해당없음", "선임없음", "미선임", "X"];
    let status,
      name = "";
    if (!list.length && !lines.some((l) => hasLabel("변호인", l)))
      status = "absentMissing";
    else if (
      list.length &&
      list.every((v) => none.includes(v.replace(/\s/g, "")))
    )
      status = "absentExplicit";
    else if (
      !list.length ||
      list.some(
        (v) =>
          none.includes(v.replace(/\s/g, "")) ||
          /판독|확인불가|[?？�]|^[:：\s]*$/.test(v),
      )
    )
      status = "needsReview";
    else {
      status = "named";
      name = list.join("\n");
    }
    return { status: ocr ? "needsReview" : status, name };
  }
}
export class DetentionParser {
  static parse(lines) {
    const list = values("구속여부", lines);
    const states = list.map((s) => {
      s = s.replace(/\s/g, "");
      if (/^불구속(?:기소)?$/.test(s)) return "released";
      if (
        /^구속(?:기소)?$/.test(s) ||
        /^\d{4}[.년]\d{1,2}[.월]\d{1,2}[.일]?구속$/.test(s)
      )
        return "detained";
      return "unknown";
    });
    return states.length && states.every((s) => s === states[0])
      ? states[0]
      : "unknown";
  }
}
export class ProsecutorParser {
  static candidates(lines) {
    return [
      ...new Set(
        fieldBlock("검사", lines).flatMap((block) => {
          const names = [];
          for (const raw of block) {
            const value = raw
              .replace(/[_—─]+/g, "")
              .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "")
              .trim();
            const compact = value.replace(/\s/g, "");
            if (
              /^[가-힣]{2,8}$/.test(compact) &&
              !/공소장|피고인|관련사항|발신자|수신자/.test(compact)
            )
              names.push(compact);
            else if (value) break;
          }
          return names;
        }),
      ),
    ];
  }
  static parse(lines) {
    const names = this.candidates(lines);
    return names.length === 1 ? names[0] : "";
  }
}
export class FilingDateParser {
  static parse(firstPage) {
    const explicit = values("기소일", firstPage.text.split("\n")).concat(
      values("공소제기일", firstPage.text.split("\n")),
    );
    const header = firstPage.ocr
      ? firstPage.text.split("\n").slice(0, 8)
      : firstPage.lines
          .filter((l) => l.y <= firstPage.height * 0.25)
          .map((l) => l.text);
    const dates = [
      ...new Set(
        (explicit.length ? explicit : header).map(parseDate).filter(Boolean),
      ),
    ];
    return dates.length === 1 ? dates[0] : null;
  }
}
export class IndictmentParser {
  static parse(document) {
    const text = clean(document.text),
      sections = DefendantParser.split(text),
      lines = text.split("\n");
    const draft = {
      defendants: sections.map((s) =>
        DefendantParser.parse(s, document.usedOCR),
      ),
      prosecutor: ProsecutorParser.parse(
        document.pages[0].lines?.length
          ? document.pages[0].lines
              .filter((l) => l.y <= document.pages[0].height * 0.4)
              .map((l) => l.text)
          : document.pages[0].text.split(/피\s*고\s*인/)[0].split("\n"),
      ),
      filingDate: FilingDateParser.parse(document.pages[0]),
      warnings: [],
    };
    if (!draft.defendants.length)
      draft.warnings.push("피고인을 찾지 못했습니다. 직접 입력하세요.");
    if (!draft.prosecutor) draft.warnings.push("검사 이름을 확인하세요.");
    if (!draft.filingDate)
      draft.warnings.push("첫 페이지 기소일을 확정하지 못했습니다.");
    return draft;
  }
}
export function validateDraft(draft) {
  const errors = [];
  if (
    draft.incompleteAnalysis?.pages.length &&
    !draft.incompleteAnalysis.confirmed
  )
    errors.push("OCR 미처리 페이지의 원문을 확인하고 수동 보완해야 합니다.");
  for (const field of draft.evidence ?? [])
    if (field.required && field.needsReview && field.finalValue === null)
      errors.push(field.label + ": 후보를 확인하거나 직접 입력하세요.");
  if (!draft.prosecutor?.trim()) errors.push("검사 이름을 확인하세요.");
  if (!draft.defendants.length) errors.push("피고인이 없습니다.");
  if (!parseDate(draft.filingDate)) errors.push("기소일을 확인하세요.");
  draft.defendants.forEach((p, i) => {
    const prefix = `${i + 1}. ${p.name}: `;
    if (!p.charges?.length) errors.push(prefix + "죄명을 확인하세요.");
    if (p.chargeNeedsReview)
      errors.push(prefix + "죄명 줄바꿈이 별도 죄명인지 원문을 확인하세요.");
    if (!p.name.trim()) errors.push(prefix + "이름을 입력하세요.");
    if (p.detention === "unknown")
      errors.push(prefix + "구속 여부를 확인하세요.");
    if (p.counsel.status === "needsReview")
      errors.push(prefix + "변호인 기재 여부를 원문과 대조해 선택하세요.");
    if (p.counsel.status === "named" && !p.counsel.name.trim())
      errors.push(prefix + "변호인 이름을 입력하세요.");
  });
  return errors;
}
export function emptyDefendant() {
  return {
    id: crypto.randomUUID?.() ?? Math.random().toString(36),
    name: "",
    birthDigits: "",
    confirmedBirthDate: "",
    birthReview: false,
    charges: [],
    counsel: { status: "needsReview", name: "" },
    detention: "unknown",
  };
}
