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
export function birthAssessment(person, filingDate) {
  const fail = (message) => ({
    resolved: false,
    birth: null,
    age: null,
    warnings: [message],
  });
  const front = person.birthDigits ?? "";
  if (!/^\d{6}$/.test(front))
    return fail("생년월일 앞 6자리 YYMMDD를 확인하세요.");
  const yy = +front.slice(0, 2),
    month = +front.slice(2, 4),
    day = +front.slice(4);
  let calendarPossible = false;
  for (let y = yy || 100; y <= 9999; y += 100)
    if (validDate(y, month, day)) {
      calendarPossible = true;
      break;
    }
  if (!calendarPossible)
    return fail("앞 6자리의 월·일이 실제 달력에 없습니다.");
  const filing = parseDate(filingDate);
  const manual = String(person.confirmedYear ?? "").trim();
  let year;
  if (manual) {
    if (
      !/^\d{4}$/.test(manual) ||
      +manual % 100 !== yy ||
      !validDate(+manual, month, day)
    )
      return fail("확인한 출생 연도가 YY와 다르거나 날짜가 유효하지 않습니다.");
    year = +manual;
  } else {
    if (!filing || !Number.isInteger(person.statedAge) || person.statedAge < 0)
      return fail("기소일·기재 나이 또는 직접 확인한 출생 연도가 필요합니다.");
    const fy = +filing.slice(0, 4);
    const candidates = [
      fy - person.statedAge - 1,
      fy - person.statedAge,
    ].filter((y) => y > 0 && y % 100 === yy && validDate(y, month, day));
    if (candidates.length !== 1)
      return fail("출생 세기를 확정할 수 없습니다. 출생 연도를 확인하세요.");
    year = candidates[0];
  }
  const birth = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!filing) return { ...fail("기소일을 확인하세요."), birth };
  if (birth > filing) return fail("생년월일이 기소일보다 늦습니다.");
  const [fy, fm, fd] = filing.split("-").map(Number);
  const age = fy - year - (fm < month || (fm === month && fd < day) ? 1 : 0);
  const warnings = [];
  const mismatch =
    Number.isInteger(person.statedAge) && person.statedAge !== age;
  if (mismatch)
    warnings.push(
      `계산한 만 ${age}세와 기재 ${person.statedAge}세가 다릅니다. 출생 연도를 확인하세요.`,
    );
  if (person.birthReview && !manual)
    warnings.push(
      "OCR 생년월일과 기재 나이를 원문과 대조하고 출생 연도를 확인하세요.",
    );
  return {
    birth,
    age,
    resolved: !!manual || (!mismatch && !person.birthReview),
    warnings,
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
        "\\s*[:：]?\\s+(.+?)\\s*$",
    ),
  )?.[1];
const hasLabel = (label, line) =>
  new RegExp(
    "^\\s*(?:\\d+[.)]\\s*)?" + labelPattern(label) + "(?:\\s|[:：]|$)",
  ).test(line);
export class DefendantParser {
  static split(text) {
    const sections = [];
    let names = false;
    for (const line of clean(text)
      .split("\n")
      .map((s) => s.trim())) {
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
    const age = section.identity.match(/(?<!\d)(\d{1,3})\s*세/)?.[1];
    return {
      id: crypto.randomUUID?.() ?? Math.random().toString(36),
      name: section.identity
        .split(/[（(]/)[0]
        .replace(/\d{6}.*$/, "")
        .replace(/^\d+[.)]\s*/, "")
        .replace(/^[_、:：\s]+/, "")
        .trim(),
      birthDigits: front,
      statedAge: age === undefined ? null : +age,
      confirmedYear: "",
      birthReview: ocr,
      counsel: CounselParser.parse(section.lines, ocr),
      charges: ChargeParser.parse(section.lines),
      detention: DetentionParser.parse(section.lines),
    };
  }
}
const values = (label, lines) =>
  lines.map((l) => labelValue(label, l)).filter((v) => v !== undefined);
export class ChargeParser {
  static parse(lines) {
    const output = [];
    let active = false;
    for (const line of lines) {
      const value = labelValue("죄명", line);
      if (value) {
        output.push(value);
        active = true;
      } else if (hasLabel("죄명", line)) {
        active = true;
      } else if (
        active &&
        /^\d+[.)]\s*/.test(line) &&
        !["피고인", "적용법조", "구속여부", "변호인"].some((l) =>
          hasLabel(l, line),
        )
      ) {
        output.push(line);
      } else if (line.trim()) active = false;
    }
    return output
      .flatMap((v) => v.split(/[,，、;]/))
      .map((v) => v.replace(/^\d+[.)]\s*/, "").trim())
      .filter(Boolean);
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
  static parse(lines) {
    const names = [
      ...new Set(values("검사", lines).map((s) => s.replace(/[_\s]+$/, ""))),
    ];
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
      prosecutor: ProsecutorParser.parse(lines),
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
  if (!draft.defendants.length) errors.push("피고인이 없습니다.");
  if (!parseDate(draft.filingDate)) errors.push("기소일을 확인하세요.");
  draft.defendants.forEach((p, i) => {
    const prefix = `${i + 1}. ${p.name}: `;
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
    statedAge: null,
    confirmedYear: "",
    birthReview: false,
    charges: [],
    counsel: { status: "needsReview", name: "" },
    detention: "unknown",
  };
}
